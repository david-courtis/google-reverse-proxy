import { Hono } from "hono";
import { Env } from "../types";
import { AccountPool, nextPacificMidnightISO } from "../account-pool";
import { getAllModelIds } from "../models";
import { API_MODEL_SUFFIX, CLI_MODEL_SUFFIX } from "../config";
import { effectiveConfig, usageHistory, usageForAccounts } from "../webui-store";
import { getQuotasForAccounts } from "../quota";

export const AccountLimitsRoute = new Hono<{ Bindings: Env }>();

AccountLimitsRoute.get("/", async (c) => {
	const includeHistory = c.req.query("includeHistory") === "true";

	let pool: AccountPool;
	try {
		pool = await AccountPool.create(c.env);
	} catch {
		return c.json({
			accounts: [],
			models: [],
			modelConfig: {},
			modelVisibility: {},
			globalQuotaThreshold: 0,
			...(includeHistory ? { history: {} } : {})
		});
	}

	const cfg = await effectiveConfig(c.env);
	const [status, quotas, usage] = await Promise.all([
		pool.status(),
		getQuotasForAccounts(c.env, pool.all),
		usageForAccounts(
			c.env,
			pool.all.map((a) => a.id)
		)
	]);

	const visibleStatic = getAllModelIds().filter((m) => cfg.modelVisibility[m] !== false);
	const cliTwins = visibleStatic.map((m) => `${m}${CLI_MODEL_SUFFIX}`);
	const apiTwins = visibleStatic.map((m) => `${m}${API_MODEL_SUFFIX}`);
	const modelIdSet = new Set<string>([...visibleStatic, ...cliTwins, ...apiTwins]);

	const accounts = pool.all.map((acct) => {
		const s = status.find((x) => x.id === acct.id);
		const q = quotas[acct.id];
		const invalid = s?.reason === "auth-dead";
		const disabled = acct.disabled === true;
		const poolRateLimited = !!s?.coolingDown && !invalid;

		const models: Record<
			string,
			{ used: number; limit: number; remaining?: number; remainingFraction?: number | null; resetTime?: string }
		> = {};

		let maxTokens: number;
		let tokens: number;
		let quotaSource: "google" | "local";

		const isApiKey = acct.kind === "apikey";
		const planKeyword = isApiKey ? "free" : q?.plan || "unknown";
		const tierLabel = isApiKey
			? "AI Studio (API key)"
			: q?.tierLabel || q?.tierName || q?.tierId || "Gemini account";
		let resetTime: string | undefined;
		let quotaExhausted = false;

		if (q && q.ok && q.models.length > 0) {
			quotaSource = "google";
			for (const m of q.models) {
				modelIdSet.add(m.modelId);
				const row = {
					used: m.used,
					limit: m.limit,
					remaining: m.remaining,
					remainingFraction: m.remainingFraction,
					resetTime: m.resetTime
				};
				models[m.modelId] = row;
				const cliTwin = `${m.modelId}${CLI_MODEL_SUFFIX}`;
				modelIdSet.add(cliTwin);
				models[cliTwin] = row;
			}
			const primary = q.primary || q.models[0];
			maxTokens = primary.limit;
			tokens = primary.used;
			resetTime = primary.resetTime;
			quotaExhausted = primary.remaining <= 0;
		} else if (isApiKey) {
			quotaSource = "local";
			maxTokens = cfg.apiKeyDailyQuota;
			tokens = Math.min(usage[acct.id]?.today || 0, maxTokens);
			resetTime = nextPacificMidnightISO();
			quotaExhausted = tokens >= maxTokens;
			const remaining = Math.max(0, maxTokens - tokens);
			const remainingFraction = maxTokens > 0 ? remaining / maxTokens : 0;
			const row = {
				used: tokens,
				limit: maxTokens,
				remaining,
				remainingFraction,
				resetTime: quotaExhausted ? resetTime : undefined
			};
			for (const base of visibleStatic) {
				models[base] = row;
				models[`${base}${API_MODEL_SUFFIX}`] = row;
			}
		} else {

			quotaSource = "local";
			maxTokens = 0;
			tokens = 0;
		}

		const quotaRateLimited = !!(q && q.rateLimited);
		const rateLimited = poolRateLimited || quotaExhausted || quotaRateLimited;
		const banned = q?.state === "banned";
		const verify = q?.state === "verify";
		const needsOnboarding = q?.state === "needs-onboarding";
		const accStatus = invalid
			? "invalid"
			: banned
				? "banned"
				: verify
					? "verify"
					: disabled
						? "disabled"
						: rateLimited
							? "rate-limited"
							: "ok";

		return {
			email: acct.email || acct.id,
			id: acct.id,
			source: acct.source || "env",
			enabled: !disabled,
			status: accStatus,
			error: invalid
				? "Auth invalid, re-add this account"
				: q && q.error
					? q.error
					: poolRateLimited
						? "Rate-limited (cooling down)"
						: null,
			hasTokens: true,
			isUsable: !disabled && !invalid && !rateLimited,
			healthScore: invalid ? 0 : disabled ? 25 : rateLimited ? 50 : 100,
			consecutiveFailures: 0,
			maxTokens,
			tokens,
			quotaThreshold: 0,
			quotaSource,
			resetTime,
			subscription: {
				tier: planKeyword,
				tierLabel,
				tierId: q?.tierId || null,
				projectId: q?.projectId || null
			},
			appealUrl: q?.appealUrl || null,
			validationUrl: q?.validationUrl || null,
			needsOnboarding,

			limits: models,
			models
		};
	});

	const models = Array.from(modelIdSet).sort();

	return c.json({
		accounts,
		models,
		modelConfig: {},
		modelVisibility: cfg.modelVisibility,
		globalQuotaThreshold: 0,
		...(includeHistory ? { history: await usageHistory(c.env) } : {})
	});
});
