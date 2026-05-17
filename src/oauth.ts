import { OAuth2Credentials } from "./types";
import { OAUTH_AUTHORIZE_URL, OAUTH_TOKEN_URL, OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, OAUTH_SCOPES } from "./config";

export interface GoogleTokenResponse {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
	scope?: string;
	token_type?: string;
	id_token?: string;
	error?: string;
	error_description?: string;
}

export function buildAuthorizeUrl(redirectUri: string, state: string): string {
	const u = new URL(OAUTH_AUTHORIZE_URL);
	u.searchParams.set("client_id", OAUTH_CLIENT_ID);
	u.searchParams.set("redirect_uri", redirectUri);
	u.searchParams.set("response_type", "code");
	u.searchParams.set("scope", OAUTH_SCOPES);
	u.searchParams.set("access_type", "offline");
	u.searchParams.set("prompt", "consent select_account");
	u.searchParams.set("state", state);
	return u.toString();
}

export async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<GoogleTokenResponse> {
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
	const json = (await resp.json()) as GoogleTokenResponse;
	if (!resp.ok) {
		const detail = json.error_description || json.error || `HTTP ${resp.status}`;
		throw new Error(`Token exchange failed: ${detail}`);
	}
	if (!json.refresh_token) {
		throw new Error(
			"Google did not return a refresh_token. Revoke prior access at https://myaccount.google.com/permissions and retry."
		);
	}
	return json;
}

export function credentialsFromTokenResponse(t: GoogleTokenResponse): OAuth2Credentials {
	return {
		access_token: t.access_token || "",
		refresh_token: t.refresh_token || "",
		scope: t.scope || OAUTH_SCOPES,
		token_type: t.token_type || "Bearer",
		id_token: t.id_token || "",
		expiry_date: Date.now() + (t.expires_in || 3600) * 1000
	};
}

function b64urlDecode(input: string): string {
	const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
	const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
	const bin = atob(b64);

	const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}

export function emailFromIdToken(idToken: string | undefined | null): string | null {
	if (!idToken) return null;
	const parts = idToken.split(".");
	if (parts.length < 2) return null;
	try {
		const payload = JSON.parse(b64urlDecode(parts[1])) as { email?: string };
		return typeof payload.email === "string" ? payload.email : null;
	} catch {
		return null;
	}
}

export function accountIdentityFromIdToken(idToken: string | undefined | null): string | null {
	if (!idToken) return null;
	const parts = idToken.split(".");
	if (parts.length < 2) return null;
	try {
		const payload = JSON.parse(b64urlDecode(parts[1])) as { sub?: string; email?: string };
		if (typeof payload.sub === "string" && payload.sub) return "sub:" + payload.sub;
		if (typeof payload.email === "string" && payload.email) return "email:" + payload.email.toLowerCase();
		return null;
	} catch {
		return null;
	}
}

export function extractCodeFromInput(input: string): { code: string; state?: string } {
	const trimmed = input.trim();
	try {
		const u = new URL(trimmed);
		const code = u.searchParams.get("code");
		if (code) return { code, state: u.searchParams.get("state") || undefined };
	} catch {

	}

	const m = trimmed.match(/code=([^&\s]+)/);
	if (m) {
		const sm = trimmed.match(/state=([^&\s]+)/);
		return { code: decodeURIComponent(m[1]), state: sm ? decodeURIComponent(sm[1]) : undefined };
	}
	return { code: trimmed };
}
