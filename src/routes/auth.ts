import { Hono } from "hono";
import { Env, OAuth2Credentials } from "../types";
import {
	OAUTH_AUTHORIZE_URL,
	OAUTH_TOKEN_URL,
	OAUTH_CLIENT_ID,
	OAUTH_CLIENT_SECRET,
	OAUTH_SCOPES,
	KV_OAUTH_STATE_PREFIX,
	OAUTH_STATE_TTL
} from "../config";
import { addAccountToKvPool, removeAccountFromKvPool, clearKvPool, clearKvApiKeyPool, AccountPool } from "../account-pool";
import { onboardAccount } from "../onboard";
import { KV_QUOTA_CACHE_PREFIX } from "../quota";
import { getKV } from "../runtime/kv";

export const AuthRoute = new Hono<{ Bindings: Env }>();

function esc(s: unknown): string {
	return String(s ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function page(title: string, bodyHtml: string): string {
	return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:64px auto;padding:0 16px;line-height:1.5}
code{background:#f2f2f2;padding:2px 6px;border-radius:4px}a.btn{display:inline-block;margin:8px 8px 0 0;padding:10px 16px;
background:#1a73e8;color:#fff;text-decoration:none;border-radius:6px}a.btn.secondary{background:#5f6368}</style>
</head><body><h2>${title}</h2>${bodyHtml}</body></html>`;
}

function redirectUriFor(reqUrl: string): string {
	return `${new URL(reqUrl).origin}/v1/auth/callback`;
}

AuthRoute.get("/login", async (c) => {
	const state = crypto.randomUUID();
	const redirectUri = redirectUriFor(c.req.url);

	try {
		await getKV().put(`${KV_OAUTH_STATE_PREFIX}:${state}`, redirectUri, {
			expirationTtl: OAUTH_STATE_TTL
		});
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return c.html(page("Login error", `<p>Could not start login (KV error): <code>${esc(msg)}</code></p>`), 500);
	}

	const authUrl = new URL(OAUTH_AUTHORIZE_URL);
	authUrl.searchParams.set("client_id", OAUTH_CLIENT_ID);
	authUrl.searchParams.set("redirect_uri", redirectUri);
	authUrl.searchParams.set("response_type", "code");
	authUrl.searchParams.set("scope", OAUTH_SCOPES);
	authUrl.searchParams.set("access_type", "offline"); 
	authUrl.searchParams.set("prompt", "consent select_account"); 
	authUrl.searchParams.set("state", state);

	return c.redirect(authUrl.toString(), 302);
});

AuthRoute.get("/callback", async (c) => {
	const code = c.req.query("code");
	const state = c.req.query("state");
	const oauthError = c.req.query("error");

	if (oauthError) {
		return c.html(
			page(
				"Login cancelled",
				`<p>Google returned: <code>${esc(oauthError)}</code></p>
			<p><a class="btn" href="/v1/auth/login">Try again</a></p>`
			),
			400
		);
	}
	if (!code || !state) {
		return c.html(page("Login error", `<p>Missing <code>code</code> or <code>state</code>.</p>`), 400);
	}

	const stateKey = `${KV_OAUTH_STATE_PREFIX}:${state}`;
	let redirectUri: string | null = null;
	try {
		redirectUri = await getKV().get(stateKey);
	} catch {
		redirectUri = null;
	}
	if (!redirectUri) {
		return c.html(
			page("Login error", `<p>Invalid or expired login state. <a class="btn" href="/v1/auth/login">Restart</a></p>`),
			400
		);
	}
	try {
		await getKV().delete(stateKey);
	} catch {

	}

	let tokenJson: {
		access_token?: string;
		refresh_token?: string;
		expires_in?: number;
		scope?: string;
		token_type?: string;
		id_token?: string;
		error?: string;
		error_description?: string;
	};
	try {
		const resp = await fetch(OAUTH_TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				code,
				client_id: OAUTH_CLIENT_ID,
				client_secret: OAUTH_CLIENT_SECRET,
				redirect_uri: redirectUri,
				grant_type: "authorization_code"
			})
		});
		tokenJson = (await resp.json()) as typeof tokenJson;
		if (!resp.ok) {
			return c.html(
				page(
					"Token exchange failed",
					`<p><code>${esc(tokenJson.error || resp.status)}</code>: ${esc(tokenJson.error_description || "")}</p>
					<p>If this says <code>redirect_uri_mismatch</code>, the OAuth client does not allow
					<code>${esc(redirectUri)}</code> as a loopback redirect.</p>
					<p><a class="btn" href="/v1/auth/login">Try again</a></p>`
				),
				400
			);
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return c.html(page("Token exchange error", `<p><code>${esc(msg)}</code></p>`), 500);
	}

	if (!tokenJson.refresh_token) {
		return c.html(
			page(
				"No refresh token",
				`<p>Google did not return a <code>refresh_token</code>. This usually means the account
				previously authorized this app. Revoke it at
				<a href="https://myaccount.google.com/permissions" target="_blank">Google account permissions</a>
				then <a class="btn" href="/v1/auth/login">try again</a>.</p>`
			),
			400
		);
	}

	const creds: OAuth2Credentials = {
		access_token: tokenJson.access_token || "",
		refresh_token: tokenJson.refresh_token,
		scope: tokenJson.scope || OAUTH_SCOPES,
		token_type: tokenJson.token_type || "Bearer",
		id_token: tokenJson.id_token || "",
		expiry_date: Date.now() + (tokenJson.expires_in || 3600) * 1000
	};

	try {
		const { id, total, replaced } = await addAccountToKvPool(c.env, creds);
		return c.html(
			page(
				replaced ? "Account updated" : "Account added",
				`<p>${replaced ? "Refreshed" : "Added"} account <code>${esc(id)}</code>. The pool now has
				<strong>${esc(total)}</strong> account(s).</p>
				<p>You can close this tab and return to the dashboard, it updates automatically.</p>
				<p><a class="btn" href="/v1/auth/login">Add another account</a>
				<a class="btn secondary" href="/v1/auth/accounts">View pool</a></p>
				<script>try{if(window.opener){window.opener.postMessage({type:"gca-account-added"},window.location.origin);}}catch(e){}</script>`
			)
		);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return c.html(page("Could not save account", `<p><code>${esc(msg)}</code></p>`), 500);
	}
});

AuthRoute.get("/accounts", async (c) => {
	try {
		const pool = await AccountPool.create(c.env);
		return c.json({
			status: "ok",
			pool_size: pool.size,
			selection_strategy: c.env.ACCOUNT_SELECTION_STRATEGY || "random",
			accounts: await pool.status()
		});
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return c.json({ status: "empty", message: msg, hint: "Open /v1/auth/login to add an account" }, 200);
	}
});

AuthRoute.post("/remove", async (c) => {
	const id = c.req.query("id");
	if (!id) {
		return c.json({ status: "error", message: "Provide ?id=<accountId> (see /v1/auth/accounts)" }, 400);
	}
	const { removed, total } = await removeAccountFromKvPool(c.env, id);
	return c.json({ status: removed ? "removed" : "not_found", id, pool_size: total });
});

AuthRoute.get("/onboard", async (c) => {
	const id = c.req.query("id");
	if (!id) {
		return c.json({ status: "error", message: "Provide ?id=<accountId> (see /v1/auth/accounts)" }, 400);
	}
	let pool: AccountPool;
	try {
		pool = await AccountPool.create(c.env);
	} catch (e) {
		return c.json({ status: "error", message: e instanceof Error ? e.message : String(e) }, 500);
	}
	const account = pool.all.find((a) => a.id === id);
	if (!account) {
		return c.json({ status: "error", message: "Account not found" }, 404);
	}
	const result = await onboardAccount(c.env, account);

	try {
		await getKV().delete(`${KV_QUOTA_CACHE_PREFIX}:${id}`);
	} catch {

	}
	if (result.ok) {
		return c.json({
			status: "ok",
			id,
			projectId: result.projectId,
			alreadyOnboarded: !!result.alreadyOnboarded
		});
	}
	return c.json(
		{
			status: result.state || "error",
			id,
			error: result.error,
			appealUrl: result.appealUrl,
			validationUrl: result.validationUrl
		},
		result.state === "banned" || result.state === "verify" ? 400 : 502
	);
});

AuthRoute.post("/reset", async (c) => {
	if (c.req.query("confirm") !== "yes") {
		return c.json({ status: "error", message: "Add ?confirm=yes to clear the entire account pool" }, 400);
	}
	await clearKvPool(c.env);
	await clearKvApiKeyPool(c.env);
	return c.json({ status: "cleared" });
});
