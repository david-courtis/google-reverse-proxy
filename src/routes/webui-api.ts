import { Hono } from "hono";
import { Env, OAuth2Credentials } from "../types";
import {
	KV_TOKEN_KEY_PREFIX,
	KV_PROJECT_KEY_PREFIX,
	KV_ACCOUNT_COOLDOWN_PREFIX,
	KV_OAUTH_STATE_PREFIX,
	OAUTH_STATE_TTL
} from "../config";
import {
	AccountPool,
	addAccountToKvPool,
	removeAccountFromKvPool,
	readKvPoolCreds,
	addApiKeyToKvPool,
	removeApiKeyFromKvPool,
	readKvApiKeys,
	maskApiKey
} from "../account-pool";
import { getQuotasForAccounts } from "../quota";
import {
	effectiveConfig,
	patchSettings,
	setAccountMeta,
	deleteAccountMeta,
	usageForAccounts,
	WebuiSettings
} from "../webui-store";
import {
	buildAuthorizeUrl,
	exchangeCodeForTokens,
	credentialsFromTokenResponse,
	emailFromIdToken,
	extractCodeFromInput
} from "../oauth";
import { getKV } from "../runtime/kv";

export const WebuiApiRoute = new Hono<{ Bindings: Env }>();

async function resolveAccount(env: Env, key: string) {
	const decoded = decodeURIComponent(key);
	const pool = await AccountPool.create(env);
	return pool.all.find((a) => a.id === decoded || a.email === decoded) || null;
}

const MAX_ACCOUNTS = 50;

async function configPayload(env: Env) {
	const cfg = await effectiveConfig(env);
	return {
		status: "ok",
		config: {
			devMode: cfg.devMode,
			selectionStrategy: cfg.selectionStrategy,
			cooldownSeconds: cfg.cooldownSeconds,
			enableRealThinking: cfg.enableRealThinking,
			streamThinkingAsContent: cfg.streamThinkingAsContent,
			enableAutoModelSwitching: cfg.enableAutoModelSwitching,
			requestQuota: cfg.requestQuota,
			apiKeyDailyQuota: cfg.apiKeyDailyQuota,
			preferredAccountKind: cfg.preferredAccountKind,
			modelVisibility: cfg.modelVisibility,
			hasPassword: !!cfg.uiPassword,
			maxAccounts: MAX_ACCOUNTS
		}
	};
}

WebuiApiRoute.get("/config", async (c) => c.json(await configPayload(c.env)));
WebuiApiRoute.get("/settings", async (c) => c.json(await configPayload(c.env)));

WebuiApiRoute.post("/config", async (c) => {
	let body: Partial<WebuiSettings> = {};
	try {
		body = await c.req.json();
	} catch {

	}
	const allowed: Partial<WebuiSettings> = {};
	if (body.selectionStrategy) allowed.selectionStrategy = body.selectionStrategy;
	if (typeof body.cooldownSeconds === "number") allowed.cooldownSeconds = body.cooldownSeconds;
	if (typeof body.enableRealThinking === "boolean") allowed.enableRealThinking = body.enableRealThinking;
	if (typeof body.streamThinkingAsContent === "boolean") allowed.streamThinkingAsContent = body.streamThinkingAsContent;
	if (typeof body.enableAutoModelSwitching === "boolean")
		allowed.enableAutoModelSwitching = body.enableAutoModelSwitching;
	if (typeof body.requestQuota === "number") allowed.requestQuota = body.requestQuota;
	if (typeof body.apiKeyDailyQuota === "number") allowed.apiKeyDailyQuota = body.apiKeyDailyQuota;
	if (typeof body.devMode === "boolean") allowed.devMode = body.devMode;
	if (body.preferredAccountKind === "cli" || body.preferredAccountKind === "api") {
		allowed.preferredAccountKind = body.preferredAccountKind;
	}
	if (body.modelVisibility && typeof body.modelVisibility === "object") allowed.modelVisibility = body.modelVisibility;
	await patchSettings(c.env, allowed);
	return c.json(await configPayload(c.env));
});

WebuiApiRoute.post("/config/password", async (c) => {
	let body: { password?: string } = {};
	try {
		body = await c.req.json();
	} catch {

	}
	await patchSettings(c.env, {
		uiPassword: body.password ? String(body.password) : undefined,
		uiPasswordInitialized: true
	});
	return c.json({ status: "ok" });
});

WebuiApiRoute.post("/models/config", async (c) => {
	let body: { modelVisibility?: Record<string, boolean>; model?: string; visible?: boolean } = {};
	try {
		body = await c.req.json();
	} catch {

	}
	const cfg = await effectiveConfig(c.env);
	const vis = { ...cfg.modelVisibility };
	if (body.modelVisibility) Object.assign(vis, body.modelVisibility);
	if (body.model) vis[body.model] = body.visible !== false;
	await patchSettings(c.env, { modelVisibility: vis });
	return c.json({ status: "ok", modelVisibility: vis });
});

WebuiApiRoute.get("/accounts", async (c) => {
	try {
		const pool = await AccountPool.create(c.env);
		const [status, usage, quotas] = await Promise.all([
			pool.status(),
			usageForAccounts(
				c.env,
				pool.all.map((a) => a.id)
			),
			getQuotasForAccounts(c.env, pool.all)
		]);
		const accounts = pool.all.map((a) => {
			const s = status.find((x) => x.id === a.id);
			const q = quotas[a.id];
			const invalid = s?.reason === "auth-dead";
			const rl = !!s?.coolingDown && !invalid;
			return {
				id: a.id,
				email: a.email || a.id,
				source: a.source || "env",
				enabled: !a.disabled,
				status: invalid ? "invalid" : a.disabled ? "disabled" : rl ? "rate-limited" : "ok",
				tokens: usage[a.id]?.today || 0,
				tier: a.kind === "apikey" ? "free" : q?.plan || "unknown",
				tierLabel: a.kind === "apikey" ? "AI Studio (API key)" : q?.tierLabel || q?.tierName || q?.tierId || "unknown",
				quotaSource: q && q.ok ? "google" : "local"
			};
		});
		const available = accounts.filter((a) => a.status === "ok").length;
		const rateLimited = accounts.filter((a) => a.status === "rate-limited").length;
		const invalid = accounts.filter((a) => a.status === "invalid").length;
		return c.json({
			status: "ok",
			accounts,
			summary: { total: accounts.length, available, rateLimited, invalid }
		});
	} catch (e) {
		return c.json({ status: "error", error: e instanceof Error ? e.message : String(e) }, 500);
	}
});

WebuiApiRoute.post("/accounts/reload", (c) => c.json({ status: "ok" }));

// Returns raw credentials, so we hard-require a dashboard password regardless of webuiPasswordGate.
WebuiApiRoute.get("/accounts/export", async (c) => {
	const cfg = await effectiveConfig(c.env);
	if (!cfg.uiPassword) {
		return c.json(
			{
				status: "error",
				error: "Account export requires a dashboard password. Set one in Settings → Dashboard Password, then retry."
			},
			403
		);
	}
	const accounts = await readKvPoolCreds(c.env);
	const apiKeys = await readKvApiKeys(c.env);
	return c.json({ status: "ok", accounts, apiKeys });
});

WebuiApiRoute.post("/accounts/apikey", async (c) => {
	let body: { keys?: string | string[]; key?: string } = {};
	try {
		body = await c.req.json();
	} catch {
		return c.json({ status: "error", error: "Invalid JSON" }, 400);
	}
	const raw = body.keys ?? body.key ?? [];
	const list = (Array.isArray(raw) ? raw : String(raw).split(/[\s,]+/))
		.map((k) => String(k).trim())
		.filter(Boolean);
	if (list.length === 0) {
		return c.json({ status: "error", error: "No API keys provided" }, 400);
	}
	let added = 0;
	let total = 0;
	for (const key of list) {
		const { id, total: t, replaced } = await addApiKeyToKvPool(c.env, key);
		await setAccountMeta(c.env, id, { email: maskApiKey(key), source: "apikey", addedAt: Date.now() });
		if (!replaced) added++;
		total = t;
	}
	return c.json({ status: "ok", added, total });
});

WebuiApiRoute.post("/accounts/import", async (c) => {
	let body: { accounts?: OAuth2Credentials[]; apiKeys?: string[] } | OAuth2Credentials[] = {};
	try {
		body = await c.req.json();
	} catch {
		return c.json({ status: "error", error: "Invalid JSON" }, 400);
	}
	const list = Array.isArray(body) ? body : body.accounts || [];
	const apiKeys = Array.isArray(body) ? [] : body.apiKeys || [];
	let imported = 0;
	let apiKeysImported = 0;
	let total = 0;
	for (const key of apiKeys) {
		const k = String(key || "").trim();
		if (!k) continue;
		const { id, total: t } = await addApiKeyToKvPool(c.env, k);
		await setAccountMeta(c.env, id, { email: maskApiKey(k), source: "apikey", addedAt: Date.now() });
		apiKeysImported++;
		total = t;
	}
	for (const creds of list) {
		if (creds && creds.refresh_token) {
			const { id, total: t } = await addAccountToKvPool(c.env, creds);
			await setAccountMeta(c.env, id, {
				email: emailFromIdToken(creds.id_token) || undefined,
				source: "oauth",
				addedAt: Date.now()
			});
			imported++;
			total = t;
		}
	}
	return c.json({ status: "ok", imported, apiKeysImported, total });
});

WebuiApiRoute.post("/accounts/:key/refresh", async (c) => {
	const acct = await resolveAccount(c.env, c.req.param("key"));
	if (!acct) return c.json({ status: "error", error: "Account not found" }, 404);
	await Promise.all([
		getKV().delete(`${KV_TOKEN_KEY_PREFIX}:${acct.id}`),
		getKV().delete(`${KV_PROJECT_KEY_PREFIX}:${acct.id}`),
		getKV().delete(`${KV_ACCOUNT_COOLDOWN_PREFIX}:${acct.id}`)
	]);
	return c.json({ status: "ok" });
});

WebuiApiRoute.post("/accounts/:key/toggle", async (c) => {
	const acct = await resolveAccount(c.env, c.req.param("key"));
	if (!acct) return c.json({ status: "error", error: "Account not found" }, 404);
	let body: { enabled?: boolean } = {};
	try {
		body = await c.req.json();
	} catch {

	}
	const enabled = body.enabled !== false;
	await setAccountMeta(c.env, acct.id, { disabled: !enabled });
	return c.json({ status: "ok", enabled });
});

WebuiApiRoute.patch("/accounts/:key", async (c) => {
	const acct = await resolveAccount(c.env, c.req.param("key"));
	if (!acct) return c.json({ status: "error", error: "Account not found" }, 404);
	return c.json({ status: "ok" });
});

WebuiApiRoute.delete("/accounts/:key", async (c) => {
	const acct = await resolveAccount(c.env, c.req.param("key"));
	if (!acct) return c.json({ status: "error", error: "Account not found" }, 404);
	if (acct.source === "env") {
		return c.json(
			{ status: "error", error: "This account comes from GCP_SERVICE_ACCOUNT (env); remove it there." },
			400
		);
	}
	if (acct.source === "apikey-env") {
		return c.json(
			{ status: "error", error: "This API key comes from GEMINI_API_KEYS (env); remove it there." },
			400
		);
	}
	const { removed, total } =
		acct.kind === "apikey"
			? await removeApiKeyFromKvPool(c.env, acct.id)
			: await removeAccountFromKvPool(c.env, acct.id);
	await deleteAccountMeta(c.env, acct.id);
	return c.json({ status: removed ? "ok" : "error", pool_size: total });
});

WebuiApiRoute.get("/auth/url", async (c) => {
	const state = crypto.randomUUID();
	const redirectUri = `${new URL(c.req.url).origin}/v1/auth/callback`;
	try {
		await getKV().put(`${KV_OAUTH_STATE_PREFIX}:${state}`, redirectUri, {
			expirationTtl: OAUTH_STATE_TTL
		});
	} catch (e) {
		return c.json({ status: "error", error: e instanceof Error ? e.message : String(e) }, 500);
	}
	return c.json({ status: "ok", url: buildAuthorizeUrl(redirectUri, state), state });
});

WebuiApiRoute.post("/auth/complete", async (c) => {
	let body: { callbackInput?: string; state?: string } = {};
	try {
		body = await c.req.json();
	} catch {
		return c.json({ status: "error", error: "Invalid JSON" }, 400);
	}
	if (!body.callbackInput || !body.state) {
		return c.json({ status: "error", error: "Missing callbackInput or state" }, 400);
	}
	const stateKey = `${KV_OAUTH_STATE_PREFIX}:${body.state}`;
	const redirectUri = await getKV().get(stateKey);
	if (!redirectUri) {
		return c.json({ status: "error", error: "Invalid or expired state. Restart the add-account flow." }, 400);
	}
	await getKV().delete(stateKey);

	try {
		const { code } = extractCodeFromInput(body.callbackInput);
		const tokens = await exchangeCodeForTokens(code, redirectUri);
		const creds = credentialsFromTokenResponse(tokens);
		const { id, total } = await addAccountToKvPool(c.env, creds);
		const email = emailFromIdToken(creds.id_token) || undefined;
		await setAccountMeta(c.env, id, { email, source: "oauth", addedAt: Date.now() });
		return c.json({ status: "ok", id, email: email || id, total });
	} catch (e) {
		return c.json({ status: "error", error: e instanceof Error ? e.message : String(e) }, 400);
	}
});

WebuiApiRoute.get("/strategy/health", async (c) => {
	try {
		const pool = await AccountPool.create(c.env);
		const status = await pool.status();
		const cfg = await effectiveConfig(c.env);
		const healthy = status.filter((s) => !s.coolingDown && !s.disabled).length;
		return c.json({
			status: "ok",
			strategy: cfg.selectionStrategy,
			total: pool.size,
			healthy,
			accounts: status
		});
	} catch (e) {
		return c.json({ status: "error", error: e instanceof Error ? e.message : String(e) }, 200);
	}
});
