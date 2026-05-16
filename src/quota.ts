import { Env, AccountCredential } from "./types";
import { AuthManager } from "./auth";
import { getKV } from "./runtime/kv";

export const KV_QUOTA_CACHE_PREFIX = "quota_cache";
const CACHE_TTL_SECONDS = 60;
const RPC_TIMEOUT_MS = 8000;

interface BucketInfo {
	remainingAmount?: string;
	remainingFraction?: number;
	resetTime?: string;
	tokenType?: string;
	modelId?: string;
}
interface RetrieveUserQuotaResponse {
	buckets?: BucketInfo[];
}
interface GeminiUserTier {
	id?: string;
	name?: string;
	description?: string;
}
interface LoadCodeAssistResponse {
	currentTier?: GeminiUserTier | null;
	paidTier?: GeminiUserTier | null;
	cloudaicompanionProject?: string | null;
}

export interface ModelQuota {
	modelId: string;
	remaining: number;
	limit: number;
	remainingFraction: number;
	used: number;
	resetTime?: string;
}

export interface AccountQuota {
	ok: boolean;
	source: "google" | "error";
	error?: string;

	rawError?: string;
	tierId?: string;
	tierName?: string;
	paidTierId?: string;
	paidTierName?: string;

	plan: "pro" | "ultra" | "free" | "unknown";

	tierLabel?: string;

	tierKnown?: boolean;

	rateLimited?: boolean;

	state?: "ok" | "rate-limited" | "banned" | "verify" | "needs-onboarding" | "error";
	appealUrl?: string;
	validationUrl?: string;
	projectId?: string;
	models: ModelQuota[];

	primary?: ModelQuota;
	fetchedAt: number;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
	return Promise.race([
		p,
		new Promise<T>((_resolve, reject) => {
			setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
		})
	]);
}

function normalizeBucket(b: BucketInfo): ModelQuota | null {
	if (!b.modelId) return null;
	let remaining: number;
	let limit: number;
	if (b.remainingAmount != null && b.remainingAmount !== "") {
		remaining = parseInt(b.remainingAmount, 10);
		if (!Number.isFinite(remaining)) return null;
		limit = b.remainingFraction && b.remainingFraction > 0 ? Math.round(remaining / b.remainingFraction) : remaining; 
	} else if (b.remainingFraction != null) {
		limit = 100;
		remaining = Math.round(b.remainingFraction * 100);
	} else {
		return null; 
	}
	if (!Number.isFinite(limit) || limit <= 0) return null;
	const frac = limit > 0 ? Math.max(0, Math.min(1, remaining / limit)) : 0;
	return {
		modelId: b.modelId,
		remaining,
		limit,
		remainingFraction: frac,
		used: Math.max(0, limit - remaining),
		resetTime: b.resetTime
	};
}

function cacheKey(id: string): string {
	return `${KV_QUOTA_CACHE_PREFIX}:${id}`;
}

interface CachedQuota {
	tierId?: string;
	tierName?: string;
	paidTierId?: string;
	paidTierName?: string;
	projectId?: string;
	buckets: BucketInfo[];
	fetchedAt: number;
}

function derivePlan(parts: Array<string | undefined>): "pro" | "ultra" | "free" | "unknown" {
	const hay = parts.filter(Boolean).join(" ").toLowerCase();
	if (!hay) return "unknown";
	if (hay.includes("ultra")) return "ultra";
	if (hay.includes("g1-pro-tier") || hay.includes("ai pro") || /\bpro\b/.test(hay)) return "pro";
	return "free"; 
}

async function readCache(_env: Env, id: string): Promise<CachedQuota | null> {
	try {
		const raw = await getKV().get(cacheKey(id), "json");
		if (raw && typeof raw === "object" && Array.isArray((raw as CachedQuota).buckets)) {
			return raw as CachedQuota;
		}
	} catch {

	}
	return null;
}

async function writeCache(_env: Env, id: string, data: CachedQuota): Promise<void> {
	try {
		await getKV().put(cacheKey(id), JSON.stringify(data), { expirationTtl: CACHE_TTL_SECONDS });
	} catch (e) {
		console.error(`quota cache write failed for ${id}:`, e);
	}
}

function buildResult(c: CachedQuota): AccountQuota {
	const models = (c.buckets || []).map(normalizeBucket).filter((m): m is ModelQuota => m !== null);
	let primary: ModelQuota | undefined;
	for (const m of models) {
		if (!primary || m.remainingFraction < primary.remainingFraction) primary = m;
	}
	return {
		ok: true,
		source: "google",
		tierId: c.tierId,
		tierName: c.tierName,
		paidTierId: c.paidTierId,
		paidTierName: c.paidTierName,
		plan: derivePlan([c.paidTierId, c.paidTierName, c.tierId, c.tierName]),
		tierLabel: c.paidTierName || c.tierName || c.paidTierId || c.tierId,
		tierKnown: !!(c.tierId || c.tierName || c.paidTierId),
		state: "ok",
		projectId: c.projectId,
		models,
		primary,
		fetchedAt: c.fetchedAt
	};
}

export function classifyApiError(msg: string): {
	state: "banned" | "verify" | "rate-limited" | "error";
	appealUrl?: string;
	validationUrl?: string;
} {
	if (/\b429\b|RESOURCE_EXHAUSTED/i.test(msg)) return { state: "rate-limited" };
	const lower = msg.toLowerCase();
	if (lower.includes("violation of terms of service") || msg.includes("appeal_url")) {
		const m = msg.match(/"appeal_url"\s*:\s*"([^"]+)"/);
		return { state: "banned", appealUrl: m ? m[1] : "https://forms.gle/hGzM9MEUv2azZsrb9" };
	}
	if (msg.includes("VALIDATION_REQUIRED") || lower.includes("verify your account")) {
		const m = msg.match(/"validation_url"\s*:\s*"([^"]+)"/);
		return { state: "verify", validationUrl: m ? m[1] : undefined };
	}
	return { state: "error" };
}

function friendlyStateError(state: "banned" | "verify" | "rate-limited" | "error"): string {
	switch (state) {
		case "banned":
			return "Account banned";
		case "verify":
			return "Account verification required";
		case "rate-limited":
			return "Quota check rate-limited (429)";
		default:
			return "Quota temporarily unavailable for this account";
	}
}

export async function getAccountQuota(env: Env, account: AccountCredential, force = false): Promise<AccountQuota> {
	const fresh = await readCache(env, account.id);
	if (!force && fresh && Date.now() - fresh.fetchedAt < CACHE_TTL_SECONDS * 1000) {
		return buildResult(fresh);
	}

	let tierId: string | undefined;
	let tierName: string | undefined;
	let paidTierId: string | undefined;
	let paidTierName: string | undefined;
	let loadClass: {
		state: "banned" | "verify" | "rate-limited" | "error";
		appealUrl?: string;
		validationUrl?: string;
	} | null = null;

	try {
		const am = new AuthManager(env, account);
		await withTimeout(am.initializeAuth(), RPC_TIMEOUT_MS, "initializeAuth");

		let projectId = await am.getCachedProjectId();
		try {
			const load = (await withTimeout(
				am.callEndpoint("loadCodeAssist", {
					cloudaicompanionProject: projectId || undefined,
					metadata: {
						ideType: "IDE_UNSPECIFIED",
						platform: "PLATFORM_UNSPECIFIED",
						pluginType: "GEMINI",
						duetProject: projectId || undefined
					},
					mode: "HEALTH_CHECK"
				}),
				RPC_TIMEOUT_MS,
				"loadCodeAssist"
			)) as LoadCodeAssistResponse;
			paidTierId = load.paidTier?.id || undefined;
			paidTierName = load.paidTier?.name || load.paidTier?.description || undefined;
			tierId = load.currentTier?.id || paidTierId || undefined;
			tierName = load.currentTier?.name || load.currentTier?.description || paidTierName || undefined;
			if (load.cloudaicompanionProject) {
				projectId = load.cloudaicompanionProject;
				await am.setCachedProjectId(projectId);
			}
		} catch (e) {
			const lm = e instanceof Error ? e.message : String(e);
			console.error(`loadCodeAssist failed for ${account.id}:`, lm);
			loadClass = classifyApiError(lm);
		}

		if (!projectId) {
			const banned = loadClass?.state === "banned";
			const verify = loadClass?.state === "verify";
			return {
				ok: false,
				source: "error",
				error: banned
					? "Account banned. Gemini disabled for a Terms of Service violation, appeal available."
					: verify
						? "Account verification required by Google before this account can be used"
						: "Account not onboarded yet. No Code Assist project provisioned.",
				tierId,
				tierName,
				paidTierId,
				paidTierName,
				plan: derivePlan([paidTierId, paidTierName, tierId, tierName]),
				tierLabel: paidTierName || tierName || paidTierId || tierId,
				tierKnown: !!(tierId || tierName || paidTierId),
				state: banned ? "banned" : verify ? "verify" : "needs-onboarding",
				appealUrl: loadClass?.appealUrl,
				validationUrl: loadClass?.validationUrl,
				models: [],
				fetchedAt: Date.now()
			};
		}

		const quota = (await withTimeout(
			am.callEndpoint("retrieveUserQuota", { project: projectId }),
			RPC_TIMEOUT_MS,
			"retrieveUserQuota"
		)) as RetrieveUserQuotaResponse;

		const cached: CachedQuota = {
			tierId,
			tierName,
			paidTierId,
			paidTierName,
			projectId,
			buckets: Array.isArray(quota.buckets) ? quota.buckets : [],
			fetchedAt: Date.now()
		};
		await writeCache(env, account.id, cached);
		return buildResult(cached);
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e);
		console.error(`getAccountQuota failed for ${account.id}:`, error);
		if (fresh) return buildResult(fresh);
		const cls = loadClass || classifyApiError(error);
		return {
			ok: false,
			source: "error",
			error: friendlyStateError(cls.state),
			rawError: error,
			tierId,
			tierName,
			paidTierId,
			paidTierName,
			plan: derivePlan([paidTierId, paidTierName, tierId, tierName]),
			tierLabel: paidTierName || tierName || paidTierId || tierId,
			tierKnown: !!(tierId || tierName || paidTierId),
			rateLimited: cls.state === "rate-limited",
			state: cls.state,
			appealUrl: cls.appealUrl,
			validationUrl: cls.validationUrl,
			models: [],
			fetchedAt: Date.now()
		};
	}
}

export async function getQuotasForAccounts(
	env: Env,
	accounts: AccountCredential[],
	force = false
): Promise<Record<string, AccountQuota>> {
	const active = accounts.filter((a) => a.disabled !== true && a.kind !== "apikey");
	const entries = await Promise.allSettled(
		active.map(async (a) => [a.id, await getAccountQuota(env, a, force)] as const)
	);
	const out: Record<string, AccountQuota> = {};
	for (let i = 0; i < entries.length; i++) {
		const r = entries[i];
		if (r.status === "fulfilled") {
			out[r.value[0]] = r.value[1];
		} else {
			out[active[i].id] = {
				ok: false,
				source: "error",
				error: String(r.reason),
				plan: "unknown",
				models: [],
				fetchedAt: Date.now()
			};
		}
	}
	return out;
}
