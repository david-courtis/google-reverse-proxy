import { Env, OAuth2Credentials, AccountCredential, AccountKind, AccountSelectionStrategy } from "./types";
import { logInfo } from "./log";
import { KV_ACCOUNT_COOLDOWN_PREFIX, KV_ACCOUNT_POOL_KEY, KV_APIKEY_POOL_KEY } from "./config";
import { getKV } from "./runtime/kv";
import { getAccountMeta, effectiveConfig } from "./webui-store";
import { emailFromIdToken, accountIdentityFromIdToken } from "./oauth";

function stableKey(creds: OAuth2Credentials): string {
	return accountIdentityFromIdToken(creds.id_token) || "rt:" + (creds.refresh_token || "");
}

const RR_COUNTER_KEY = "account_rr_counter";

function secondsUntilPacificMidnight(now: Date = new Date()): number {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: "America/Los_Angeles",
		hour12: false,
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit"
	}).formatToParts(now);
	const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
	let h = get("hour");
	if (h === 24) h = 0; // some ICU builds emit "24" at midnight
	const elapsed = h * 3600 + get("minute") * 60 + get("second");
	return Math.max(60, 86400 - elapsed + 60);
}

export function nextPacificMidnightISO(now: Date = new Date()): string {
	return new Date(now.getTime() + secondsUntilPacificMidnight(now) * 1000).toISOString();
}

async function deriveAccountId(refreshToken: string): Promise<string> {
	const data = new TextEncoder().encode(refreshToken);
	const digest = await crypto.subtle.digest("SHA-256", data);
	const bytes = new Uint8Array(digest);
	let hex = "";
	for (let i = 0; i < 4; i++) {
		hex += bytes[i].toString(16).padStart(2, "0");
	}
	return hex;
}

export async function accountIdFor(refreshToken: string): Promise<string> {
	return deriveAccountId(refreshToken);
}

async function deriveApiKeyId(apiKey: string): Promise<string> {
	const data = new TextEncoder().encode(apiKey);
	const digest = await crypto.subtle.digest("SHA-256", data);
	const bytes = new Uint8Array(digest);
	let hex = "";
	for (let i = 0; i < 6; i++) {
		hex += bytes[i].toString(16).padStart(2, "0");
	}
	return "ak" + hex;
}

export function maskApiKey(apiKey: string): string {
	const tail = apiKey.slice(-4);
	return `AI Studio ····${tail}`;
}

function normalizeApiKeys(raw: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const k of raw) {
		const key = (k || "").trim();
		if (key && !seen.has(key)) {
			seen.add(key);
			out.push(key);
		}
	}
	return out;
}

function parseEnvApiKeys(env: Env): string[] {
	const raw = env.GEMINI_API_KEYS;
	if (!raw || !raw.trim()) return [];
	const trimmed = raw.trim();
	if (trimmed.startsWith("[")) {
		try {
			const parsed = JSON.parse(trimmed);
			if (Array.isArray(parsed)) {
				return normalizeApiKeys(parsed.map((v) => String(v)));
			}
		} catch (e) {
			console.error("Invalid GEMINI_API_KEYS JSON; falling back to delimiter split:", e);
		}
	}
	return normalizeApiKeys(trimmed.split(/[\s,]+/));
}

export async function readKvApiKeys(_env: Env): Promise<string[]> {
	try {
		const raw = await getKV().get(KV_APIKEY_POOL_KEY, "json");
		if (Array.isArray(raw)) {
			return normalizeApiKeys((raw as unknown[]).map((v) => String(v)));
		}
	} catch (e) {
		console.error("Failed to read KV API-key pool:", e);
	}
	return [];
}

async function writeKvApiKeys(_env: Env, keys: string[]): Promise<void> {
	await getKV().put(KV_APIKEY_POOL_KEY, JSON.stringify(normalizeApiKeys(keys)));
}

export async function addApiKeyToKvPool(
	env: Env,
	apiKey: string
): Promise<{ id: string; total: number; replaced: boolean }> {
	const key = (apiKey || "").trim();
	if (!key) throw new Error("Cannot add account: API key is empty.");
	const id = await deriveApiKeyId(key);
	const current = await readKvApiKeys(env);
	const replaced = current.includes(key);
	const next = replaced ? current : [...current, key];
	await writeKvApiKeys(env, next);
	return { id, total: next.length, replaced };
}

export async function removeApiKeyFromKvPool(env: Env, id: string): Promise<{ removed: boolean; total: number }> {
	const current = await readKvApiKeys(env);
	const kept: string[] = [];
	let removed = false;
	for (const k of current) {
		if ((await deriveApiKeyId(k)) === id) {
			removed = true;
		} else {
			kept.push(k);
		}
	}
	if (removed) await writeKvApiKeys(env, kept);
	return { removed, total: kept.length };
}

function parseEnvCreds(env: Env): OAuth2Credentials[] {
	if (!env.GCP_SERVICE_ACCOUNT) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(env.GCP_SERVICE_ACCOUNT);
	} catch (parseError) {
		const msg = parseError instanceof Error ? parseError.message : String(parseError);
		throw new Error(`Invalid GCP_SERVICE_ACCOUNT JSON: ${msg}. Provide a single OAuth object or a JSON array.`);
	}
	const list = Array.isArray(parsed) ? parsed : [parsed];
	return list.filter((c): c is OAuth2Credentials => !!c && typeof c === "object");
}

export async function readKvPoolCreds(_env: Env): Promise<OAuth2Credentials[]> {
	try {
		const raw = await getKV().get(KV_ACCOUNT_POOL_KEY, "json");
		if (Array.isArray(raw)) {
			return (raw as OAuth2Credentials[]).filter((c) => !!c && !!c.refresh_token);
		}
	} catch (e) {
		console.error("Failed to read KV account pool:", e);
	}
	return [];
}

async function writeKvPoolCreds(_env: Env, creds: OAuth2Credentials[]): Promise<void> {
	await getKV().put(KV_ACCOUNT_POOL_KEY, JSON.stringify(creds));
}

export async function addAccountToKvPool(
	env: Env,
	creds: OAuth2Credentials
): Promise<{ id: string; total: number; replaced: boolean }> {
	if (!creds.refresh_token) {
		throw new Error("Cannot add account: credentials missing refresh_token.");
	}
	const id = await deriveAccountId(creds.refresh_token);
	const key = stableKey(creds);
	const current = await readKvPoolCreds(env);

	const idx = current.findIndex((c) => stableKey(c) === key);

	let replaced = false;
	if (idx >= 0) {
		current[idx] = creds;
		replaced = true;
	} else {
		current.push(creds);
	}
	await writeKvPoolCreds(env, current);
	return { id, total: current.length, replaced };
}

export async function removeAccountFromKvPool(env: Env, id: string): Promise<{ removed: boolean; total: number }> {
	const current = await readKvPoolCreds(env);
	const kept: OAuth2Credentials[] = [];
	let removed = false;
	for (const c of current) {
		if ((await deriveAccountId(c.refresh_token)) === id) {
			removed = true;
		} else {
			kept.push(c);
		}
	}
	if (removed) await writeKvPoolCreds(env, kept);
	return { removed, total: kept.length };
}

export async function clearKvPool(_env: Env): Promise<void> {
	try {
		await getKV().delete(KV_ACCOUNT_POOL_KEY);
	} catch (e) {
		console.error("Failed to clear KV account pool:", e);
	}
}

export async function clearKvApiKeyPool(_env: Env): Promise<void> {
	try {
		await getKV().delete(KV_APIKEY_POOL_KEY);
	} catch (e) {
		console.error("Failed to clear KV API-key pool:", e);
	}
}

export async function loadCredentialPool(env: Env): Promise<AccountCredential[]> {
	const kvCreds = await readKvPoolCreds(env);
	const envCreds = parseEnvCreds(env);
	const merged = [...kvCreds, ...envCreds];

	const kvApiKeys = await readKvApiKeys(env);
	const envApiKeys = parseEnvApiKeys(env);
	const mergedApiKeys = [...kvApiKeys, ...envApiKeys];

	if (merged.length === 0 && mergedApiKeys.length === 0) {
		throw new Error(
			"No accounts configured. Open /v1/auth/login to add an OAuth account, set GCP_SERVICE_ACCOUNT, or add a Google AI Studio API key (web UI / GEMINI_API_KEYS)."
		);
	}

	const meta = await getAccountMeta(env);
	const kvCount = kvCreds.length;

	const pool: AccountCredential[] = [];
	const seenIds = new Set<string>();
	const seenKeys = new Set<string>();
	for (let i = 0; i < merged.length; i++) {
		const creds = merged[i];
		if (!creds || typeof creds !== "object" || !creds.refresh_token) {
			continue;
		}
		const id = await deriveAccountId(creds.refresh_token);
		const key = stableKey(creds);
		if (seenIds.has(id) || seenKeys.has(key)) {
			console.warn(`Duplicate account in pool (id=${id}) ignored.`);
			continue;
		}
		seenIds.add(id);
		seenKeys.add(key);
		const m = meta[id] || {};
		pool.push({
			id,
			index: pool.length,
			kind: "oauth",
			credentials: creds,
			email: m.email || emailFromIdToken(creds.id_token) || undefined,
			disabled: m.disabled === true,
			source: m.source || (i < kvCount ? "oauth" : "env")
		});
	}

	const kvApiKeyCount = kvApiKeys.length;
	for (let i = 0; i < mergedApiKeys.length; i++) {
		const apiKey = mergedApiKeys[i];
		const id = await deriveApiKeyId(apiKey);
		if (seenIds.has(id)) {
			console.warn(`Duplicate API-key account in pool (id=${id}) ignored.`);
			continue;
		}
		seenIds.add(id);
		const m = meta[id] || {};
		pool.push({
			id,
			index: pool.length,
			kind: "apikey",
			apiKey,
			email: m.email || maskApiKey(apiKey),
			disabled: m.disabled === true,
			source: m.source === "apikey" || m.source === "apikey-env" ? m.source : i < kvApiKeyCount ? "apikey" : "apikey-env"
		});
	}

	if (pool.length === 0) {
		throw new Error("No usable accounts (all OAuth entries missing refresh_token and no API keys).");
	}
	return pool;
}

export class AccountPool {
	private env: Env;
	private accounts: AccountCredential[];

	private strategyValue: AccountSelectionStrategy;
	private cooldownValue: number;

	private constructor(
		env: Env,
		accounts: AccountCredential[],
		strategy: AccountSelectionStrategy,
		cooldownSeconds: number
	) {
		this.env = env;
		this.accounts = accounts;
		this.strategyValue = strategy;
		this.cooldownValue = cooldownSeconds;
	}

	static async create(env: Env): Promise<AccountPool> {
		const accounts = await loadCredentialPool(env);
		const cfg = await effectiveConfig(env);
		return new AccountPool(env, accounts, cfg.selectionStrategy, cfg.cooldownSeconds);
	}

	get size(): number {
		return this.accounts.length;
	}

	get all(): AccountCredential[] {
		return this.accounts;
	}

	private get strategy(): AccountSelectionStrategy {
		return this.strategyValue;
	}

	private get cooldownSeconds(): number {
		return this.cooldownValue;
	}

	private cooldownKey(id: string): string {
		return `${KV_ACCOUNT_COOLDOWN_PREFIX}:${id}`;
	}

	async isCoolingDown(id: string): Promise<boolean> {
		try {
			return (await getKV().get(this.cooldownKey(id))) !== null;
		} catch {
			return false; 
		}
	}

	async cooldownInfo(id: string): Promise<{ coolingDown: boolean; reason: string | null }> {
		try {
			const raw = await getKV().get(this.cooldownKey(id));
			if (!raw) return { coolingDown: false, reason: null };
			try {
				const parsed = JSON.parse(raw) as { reason?: string };
				return { coolingDown: true, reason: parsed.reason || "cooldown" };
			} catch {
				return { coolingDown: true, reason: "cooldown" };
			}
		} catch {
			return { coolingDown: false, reason: null };
		}
	}

	async reportRateLimited(id: string): Promise<void> {
		await this.writeCooldown(id, this.cooldownSeconds, "rate-limited");
	}

	async reportDead(id: string): Promise<void> {
		await this.writeCooldown(id, Math.max(this.cooldownSeconds, 3600), "auth-dead");
	}

	async reportDailyExhausted(id: string): Promise<void> {
		await this.writeCooldown(id, secondsUntilPacificMidnight(), "daily-exhausted");
	}

	private async writeCooldown(id: string, ttlSeconds: number, reason: string): Promise<void> {
		try {
			await getKV().put(
				this.cooldownKey(id),
				JSON.stringify({ reason, at: Date.now() }),
				{ expirationTtl: Math.max(60, ttlSeconds) } 
			);
			logInfo(`Account ${id} cooling down for ${ttlSeconds}s (${reason}).`);
		} catch (e) {
			console.error(`Failed to write cooldown for account ${id}:`, e);
		}
	}

	async selectionOrder(kind?: AccountKind): Promise<AccountCredential[]> {
		const healthy: AccountCredential[] = [];
		const cooling: AccountCredential[] = [];
		for (const acct of this.accounts) {
			if (acct.disabled) continue;
			if (kind && acct.kind !== kind) continue;
			if (await this.isCoolingDown(acct.id)) {
				cooling.push(acct);
			} else {
				healthy.push(acct);
			}
		}

		const ordered = this.applyStrategy(healthy);
		return [...ordered, ...cooling];
	}

	async selectionOrderForRoute(route: "cli" | "api" | "either", preferred: "cli" | "api"): Promise<AccountCredential[]> {
		if (route === "cli") return this.selectionOrder("oauth");
		if (route === "api") return this.selectionOrder("apikey");
		const primaryKind: AccountKind = preferred === "cli" ? "oauth" : "apikey";
		const secondaryKind: AccountKind = preferred === "cli" ? "apikey" : "oauth";
		const [primary, secondary] = await Promise.all([
			this.selectionOrder(primaryKind),
			this.selectionOrder(secondaryKind)
		]);
		return [...primary, ...secondary];
	}

	private applyStrategy(healthy: AccountCredential[]): AccountCredential[] {
		if (healthy.length <= 1) return healthy;

		switch (this.strategy) {
			case "failover":

				return [...healthy].sort((a, b) => a.index - b.index);
			case "round-robin":

				return this.rotateRoundRobin(healthy);
			case "random":
			default: {
				const shuffled = [...healthy];
				for (let i = shuffled.length - 1; i > 0; i--) {
					const j = Math.floor(Math.random() * (i + 1));
					[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
				}
				return shuffled;
			}
		}
	}

	private rotateRoundRobin(healthy: AccountCredential[]): AccountCredential[] {
		const sorted = [...healthy].sort((a, b) => a.index - b.index);

		const offset = this.rrOffset;
		this.bumpRoundRobinCounter();
		const rotated = sorted.slice(offset % sorted.length).concat(sorted.slice(0, offset % sorted.length));
		return rotated;
	}

	private rrOffset = 0;

	private bumpRoundRobinCounter(): void {

		getKV().get(RR_COUNTER_KEY)
			.then((raw) => {
				const cur = Number(raw) || 0;
				this.rrOffset = cur;
				return getKV().put(RR_COUNTER_KEY, String(cur + 1));
			})
			.catch(() => {

			});
	}

	async status(): Promise<
		Array<{
			id: string;
			index: number;
			email?: string;
			disabled: boolean;
			coolingDown: boolean;
			reason: string | null;
		}>
	> {
		const out = [];
		for (const acct of this.accounts) {
			const ci = await this.cooldownInfo(acct.id);
			out.push({
				id: acct.id,
				index: acct.index,
				email: acct.email,
				disabled: acct.disabled === true,
				coolingDown: ci.coolingDown,
				reason: ci.reason
			});
		}
		return out;
	}
}
