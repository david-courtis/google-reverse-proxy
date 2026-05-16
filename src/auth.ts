import { Env, OAuth2Credentials, AccountCredential, AccountKind } from "./types";
import { logInfo } from "./log";
import { TOKEN_BUFFER_TIME, KV_TOKEN_KEY_PREFIX, KV_PROJECT_KEY_PREFIX, PROJECT_ID_CACHE_TTL } from "./config";
import { loadCredentialPool } from "./account-pool";
import { getKV } from "./runtime/kv";
import { AccountBridge } from "./bridge/code-assist-bridge";
import { ApiKeyBridge } from "./bridge/api-key-bridge";
import type { UpstreamBridge } from "./bridge/upstream-bridge";
import { upstreamStatus, upstreamBody, isInvalidGrant } from "./bridge/errors";

interface CachedTokenData {
	access_token: string;
	expiry_date: number;
	cached_at: number;
}

interface TokenCacheInfo {
	cached: boolean;
	account_id?: string;
	cached_at?: string;
	expires_at?: string;
	time_until_expiry_seconds?: number;
	is_expired?: boolean;
	message?: string;
	error?: string;
}

export class InvalidGrantError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidGrantError";
	}
}

const INVALID_GRANT_MESSAGE =
	"Token refresh failed: refresh_token is invalid or revoked. Re-authenticate with `gemini` and update the account credentials.";

export class AuthManager {
	private env: Env;
	private account: AccountCredential | null;
	private bridge: UpstreamBridge | null = null;
	private accessToken: string | null = null;

	constructor(env: Env, account?: AccountCredential | null) {
		this.env = env;
		this.account = account ?? null;
	}

	private async resolveAccount(): Promise<AccountCredential> {
		if (this.account) return this.account;
		const pool = await loadCredentialPool(this.env);
		this.account = pool[0];
		return this.account;
	}

	public getAccountId(): string | null {
		return this.account?.id ?? null;
	}

	public async getAccountKind(): Promise<AccountKind> {
		return (await this.resolveAccount()).kind;
	}

	private tokenKey(accountId: string): string {
		return `${KV_TOKEN_KEY_PREFIX}:${accountId}`;
	}

	private projectKey(accountId: string): string {
		return `${KV_PROJECT_KEY_PREFIX}:${accountId}`;
	}

	public async getBridge(): Promise<UpstreamBridge> {
		if (this.bridge) return this.bridge;
		const account = await this.resolveAccount();

		if (account.kind === "apikey") {
			if (!account.apiKey) {
				throw new Error(`Account ${account.id} is missing its API key.`);
			}
			this.bridge = ApiKeyBridge.fromApiKey(this.env, account.apiKey);
			return this.bridge;
		}

		const creds: OAuth2Credentials | undefined = account.credentials;
		if (!creds || !creds.refresh_token) {
			throw new Error(`Account ${account.id} is missing refresh_token. Please provide valid OAuth2 credentials.`);
		}

		const init: { projectId?: string; accessToken?: string; expiryDate?: number } = {};
		const cachedProject = await this.getCachedProjectId();
		if (cachedProject) init.projectId = cachedProject;

		try {
			const cached = (await getKV().get(this.tokenKey(account.id), "json")) as CachedTokenData | null;
			if (cached && cached.access_token && cached.expiry_date - Date.now() > TOKEN_BUFFER_TIME) {
				init.accessToken = cached.access_token;
				init.expiryDate = cached.expiry_date;
				this.accessToken = cached.access_token;
				logInfo(`Using cached token for ${account.id}`);
			}
		} catch (e) {
			logInfo(`No cached token for account ${account.id} or KV error:`, e);
		}

		if (!init.accessToken && creds.access_token && creds.expiry_date - Date.now() > TOKEN_BUFFER_TIME) {
			init.accessToken = creds.access_token;
			init.expiryDate = creds.expiry_date;
			this.accessToken = creds.access_token;
			logInfo(`Using configured token for ${account.id}`);
		}

		const bridge = AccountBridge.fromRefreshToken(this.env, creds.refresh_token, init);
		bridge.onTokens((t) => {
			if (t.access_token) {
				this.accessToken = t.access_token;
				const expiry = t.expiry_date ?? Date.now() + 3600 * 1000;
				void this.cacheTokenInKV(this.tokenKey(account.id), t.access_token, expiry);
			}
		});
		this.bridge = bridge;
		return bridge;
	}

	public async initializeAuth(): Promise<void> {
		try {
			const bridge = await this.getBridge();
			const token = await bridge.getAccessToken();
			if (token) this.accessToken = token;
		} catch (e: unknown) {
			if (e instanceof InvalidGrantError) throw e;
			if (isInvalidGrant(e)) throw new InvalidGrantError(INVALID_GRANT_MESSAGE);
			const id = this.account?.id ?? "(unresolved)";
			console.error(`Failed to initialize authentication for account ${id}:`, e);
			throw new Error("Authentication failed: " + (e instanceof Error ? e.message : String(e)));
		}
	}

	private async cacheTokenInKV(key: string, accessToken: string, expiryDate: number): Promise<void> {
		try {
			const tokenData: CachedTokenData = {
				access_token: accessToken,
				expiry_date: expiryDate,
				cached_at: Date.now()
			};
			const ttlSeconds = Math.floor((expiryDate - Date.now()) / 1000) - 300;
			if (ttlSeconds > 0) {
				await getKV().put(key, JSON.stringify(tokenData), { expirationTtl: ttlSeconds });
				logInfo(`Token cached in KV (${key}) TTL ${ttlSeconds}s`);
			}
		} catch (kvError) {
			console.error("Failed to cache token in KV storage:", kvError);
		}
	}

	public async clearTokenCache(): Promise<void> {
		try {
			const account = await this.resolveAccount();
			await getKV().delete(this.tokenKey(account.id));
			logInfo(`Cleared cached token for account ${account.id}`);
		} catch (kvError) {
			logInfo("Error clearing KV cache:", kvError);
		}
		this.bridge = null;
		this.accessToken = null;
	}

	public async getCachedTokenInfo(): Promise<TokenCacheInfo> {
		try {
			const account = await this.resolveAccount();
			const cachedToken = (await getKV().get(this.tokenKey(account.id), "json")) as CachedTokenData | null;
			if (cachedToken) {
				const timeUntilExpiry = cachedToken.expiry_date - Date.now();
				return {
					cached: true,
					account_id: account.id,
					cached_at: new Date(cachedToken.cached_at).toISOString(),
					expires_at: new Date(cachedToken.expiry_date).toISOString(),
					time_until_expiry_seconds: Math.floor(timeUntilExpiry / 1000),
					is_expired: timeUntilExpiry < 0
				};
			}
			return { cached: false, account_id: account.id, message: "No token found in cache" };
		} catch (e: unknown) {
			return { cached: false, error: e instanceof Error ? e.message : String(e) };
		}
	}

	public async getCachedProjectId(): Promise<string | null> {
		try {
			const account = await this.resolveAccount();
			const v = await getKV().get(this.projectKey(account.id));
			return v || null;
		} catch {
			return null;
		}
	}

	public async setCachedProjectId(projectId: string): Promise<void> {
		try {
			const account = await this.resolveAccount();
			await getKV().put(this.projectKey(account.id), projectId, { expirationTtl: PROJECT_ID_CACHE_TTL });
		} catch (e) {
			console.error("Failed to cache project id:", e);
		}
		if (this.bridge) this.bridge.setProject(projectId);
	}

	public async callEndpoint(method: string, body: Record<string, unknown>, isRetry: boolean = false): Promise<unknown> {
		const bridge = await this.getBridge();
		try {
			return await bridge.requestPost(method, body as object);
		} catch (e: unknown) {
			if (isInvalidGrant(e)) throw new InvalidGrantError(INVALID_GRANT_MESSAGE);
			const status = upstreamStatus(e);
			if (status === 401 && !isRetry) {
				logInfo("Got 401, clearing token cache and retrying...");
				await this.clearTokenCache();
				return this.callEndpoint(method, body, true);
			}
			throw new Error(`API call failed with status ${status ?? "unknown"}: ${upstreamBody(e)}`);
		}
	}

	public async getOperation(name: string): Promise<unknown> {
		const bridge = await this.getBridge();
		try {
			return await bridge.getOperation(name);
		} catch (e: unknown) {
			if (isInvalidGrant(e)) throw new InvalidGrantError(INVALID_GRANT_MESSAGE);
			const status = upstreamStatus(e);
			throw new Error(`getOperation failed with status ${status ?? "unknown"}: ${upstreamBody(e)}`);
		}
	}

	public getAccessToken(): string | null {
		return this.accessToken;
	}
}
