import { Env } from "./types";
import { getKV } from "./runtime/kv";

const KV_ACCOUNT_META = "webui_account_meta";
const KV_SETTINGS = "webui_settings";
const KV_METRICS = "webui_metrics";

const HISTORY_DAYS = 30;

export interface AccountMeta {
	email?: string;
	disabled?: boolean;
	source?: "oauth" | "env" | "apikey" | "apikey-env";
	addedAt?: number;
}
export type AccountMetaMap = Record<string, AccountMeta>;

export interface WebuiSettings {
	selectionStrategy?: "random" | "round-robin" | "failover";
	cooldownSeconds?: number;
	enableRealThinking?: boolean;
	streamThinkingAsContent?: boolean;
	enableAutoModelSwitching?: boolean;
	uiPassword?: string;
	devMode?: boolean;

	requestQuota?: number;

	apiKeyDailyQuota?: number;

	modelVisibility?: Record<string, boolean>;

	preferredAccountKind?: "cli" | "api";

	uiPasswordInitialized?: boolean;
}

export const DEFAULT_SETTINGS: Required<
	Pick<WebuiSettings, "cooldownSeconds" | "selectionStrategy" | "requestQuota" | "apiKeyDailyQuota">
> = {
	cooldownSeconds: 90,
	selectionStrategy: "random",
	requestQuota: 1000,
	apiKeyDailyQuota: 500
};

export async function getAccountMeta(_env: Env): Promise<AccountMetaMap> {
	try {
		const raw = await getKV().get(KV_ACCOUNT_META, "json");
		return raw && typeof raw === "object" ? (raw as AccountMetaMap) : {};
	} catch {
		return {};
	}
}

export async function setAccountMeta(env: Env, id: string, patch: Partial<AccountMeta>): Promise<void> {
	const all = await getAccountMeta(env);
	all[id] = { ...all[id], ...patch };
	await getKV().put(KV_ACCOUNT_META, JSON.stringify(all));
}

export async function deleteAccountMeta(env: Env, id: string): Promise<void> {
	const all = await getAccountMeta(env);
	if (id in all) {
		delete all[id];
		await getKV().put(KV_ACCOUNT_META, JSON.stringify(all));
	}
}

export async function getSettings(_env: Env): Promise<WebuiSettings> {
	try {
		const raw = await getKV().get(KV_SETTINGS, "json");
		return raw && typeof raw === "object" ? (raw as WebuiSettings) : {};
	} catch {
		return {};
	}
}

export async function patchSettings(env: Env, patch: Partial<WebuiSettings>): Promise<WebuiSettings> {
	const cur = await getSettings(env);
	const next = { ...cur, ...patch };
	await getKV().put(KV_SETTINGS, JSON.stringify(next));
	return next;
}

export async function effectiveConfig(env: Env): Promise<{
	selectionStrategy: "random" | "round-robin" | "failover";
	cooldownSeconds: number;
	enableRealThinking: boolean;
	streamThinkingAsContent: boolean;
	enableAutoModelSwitching: boolean;
	requestQuota: number;
	apiKeyDailyQuota: number;
	devMode: boolean;
	uiPassword?: string;
	modelVisibility: Record<string, boolean>;
	preferredAccountKind: "cli" | "api";
}> {
	const s = await getSettings(env);
	const strat = s.selectionStrategy || env.ACCOUNT_SELECTION_STRATEGY || DEFAULT_SETTINGS.selectionStrategy;
	const envPref = (env.PREFERRED_ACCOUNT_KIND || "").trim().toLowerCase();
	const preferredAccountKind: "cli" | "api" =
		s.preferredAccountKind === "api" || s.preferredAccountKind === "cli"
			? s.preferredAccountKind
			: envPref === "api"
				? "api"
				: "cli";
	return {
		selectionStrategy: (strat === "round-robin" || strat === "failover" ? strat : "random") as
			| "random"
			| "round-robin"
			| "failover",
		cooldownSeconds: pickPositiveInt(
			s.cooldownSeconds,
			Number(env.ACCOUNT_COOLDOWN_SECONDS),
			DEFAULT_SETTINGS.cooldownSeconds
		),
		enableRealThinking: s.enableRealThinking ?? env.ENABLE_REAL_THINKING === "true",
		streamThinkingAsContent: s.streamThinkingAsContent ?? env.STREAM_THINKING_AS_CONTENT === "true",
		enableAutoModelSwitching: s.enableAutoModelSwitching ?? env.ENABLE_AUTO_MODEL_SWITCHING === "true",
		requestQuota: s.requestQuota ?? DEFAULT_SETTINGS.requestQuota,
		apiKeyDailyQuota: pickPositiveInt(s.apiKeyDailyQuota, DEFAULT_SETTINGS.apiKeyDailyQuota),
		devMode: s.devMode ?? false,
		uiPassword: s.uiPassword,
		modelVisibility: s.modelVisibility ?? {},
		preferredAccountKind
	};
}

interface MetricsBucket {
	total: number;
	models: Record<string, number>;
}

interface MetricsState {
	byAccount: Record<string, Record<string, MetricsBucket>>;
}

function pickPositiveInt(...candidates: Array<number | undefined>): number {
	for (const c of candidates) {
		if (typeof c === "number" && Number.isFinite(c) && c > 0) return Math.floor(c);
	}
	return 1;
}

function hourKey(ts = Date.now()): string {
	const d = new Date(ts);
	d.setUTCMinutes(0, 0, 0);
	return d.toISOString();
}

function dayPrefix(ts = Date.now()): string {
	return new Date(ts).toISOString().slice(0, 10);
}

function modelFamily(modelId: string): string {
	const lower = modelId.toLowerCase();
	if (lower.includes("claude")) return "claude";
	if (lower.includes("gemini")) return "gemini";
	return "other";
}

async function readMetrics(_env: Env): Promise<MetricsState> {
	try {
		const raw = await getKV().get(KV_METRICS, "json");
		if (raw && typeof raw === "object" && (raw as MetricsState).byAccount) {
			return migrateMetricsIfNeeded(raw as MetricsState);
		}
	} catch {
	}
	return { byAccount: {} };
}

// Old day-keyed buckets collapse to the 00:00:00Z hour for forward compatibility.
function migrateMetricsIfNeeded(m: MetricsState): MetricsState {
	const next: MetricsState = { byAccount: {} };
	for (const [aId, buckets] of Object.entries(m.byAccount)) {
		const out: Record<string, MetricsBucket> = {};
		for (const [k, slot] of Object.entries(buckets)) {
			const key = k.length === 10 ? `${k}T00:00:00.000Z` : k;
			out[key] = slot;
		}
		next.byAccount[aId] = out;
	}
	return next;
}

export async function recordUsage(env: Env, accountId: string, modelId: string): Promise<void> {
	try {
		const m = await readMetrics(env);
		const hour = hourKey();
		const acct = (m.byAccount[accountId] ??= {});
		const slot = (acct[hour] ??= { total: 0, models: {} });
		slot.total += 1;
		slot.models[modelId] = (slot.models[modelId] || 0) + 1;

		const cutoffMs = Date.now() - HISTORY_DAYS * 86400000;
		for (const aId of Object.keys(m.byAccount)) {
			for (const h of Object.keys(m.byAccount[aId])) {
				if (new Date(h).getTime() < cutoffMs) delete m.byAccount[aId][h];
			}
		}
		await getKV().put(KV_METRICS, JSON.stringify(m));
	} catch (e) {
		console.error("recordUsage failed (non-fatal):", e);
	}
}

export interface AccountUsage {
	today: number;
	total: number;
	models: Record<string, number>;
}

export async function usageForAccounts(env: Env, ids: string[]): Promise<Record<string, AccountUsage>> {
	const m = await readMetrics(env);
	const todayPrefix = dayPrefix();
	const out: Record<string, AccountUsage> = {};
	for (const id of ids) {
		const hours = m.byAccount[id] || {};
		let total = 0;
		let today = 0;
		const todayModels: Record<string, number> = {};
		for (const [hourIso, slot] of Object.entries(hours)) {
			total += slot.total;
			if (hourIso.startsWith(todayPrefix)) {
				today += slot.total;
				for (const [mId, count] of Object.entries(slot.models)) {
					todayModels[mId] = (todayModels[mId] || 0) + count;
				}
			}
		}
		out[id] = { today, total, models: todayModels };
	}
	return out;
}

export type UsageHistoryBucket = {
	_total: number;
} & Record<string, { _subtotal: number } & Record<string, number>>;

export type UsageHistoryMap = Record<string, UsageHistoryBucket>;

export async function usageHistory(env: Env): Promise<UsageHistoryMap> {
	const m = await readMetrics(env);
	const out: UsageHistoryMap = {};
	for (const buckets of Object.values(m.byAccount)) {
		for (const [hourIso, slot] of Object.entries(buckets)) {
			const bucket = (out[hourIso] ??= { _total: 0 } as UsageHistoryBucket);
			bucket._total += slot.total;
			for (const [mId, count] of Object.entries(slot.models)) {
				const family = modelFamily(mId);
				const fam = (bucket[family] ??= { _subtotal: 0 } as { _subtotal: number } & Record<string, number>);
				fam._subtotal += count;
				fam[mId] = (fam[mId] || 0) + count;
			}
		}
	}
	return out;
}
