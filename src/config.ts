
export const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com";
export const CODE_ASSIST_API_VERSION = "v1internal";

export const GEMINI_API_ENDPOINT = "https://generativelanguage.googleapis.com";

export const KV_APIKEY_POOL_KEY = "apikey_pool";

export const API_MODEL_SUFFIX = ":api";
export const CLI_MODEL_SUFFIX = ":cli";

// Published public-client credentials from @google/gemini-cli-core, required for byte-identical parity.
export const OAUTH_CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com";
export const OAUTH_CLIENT_SECRET = "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";
export const OAUTH_REFRESH_URL = "https://oauth2.googleapis.com/token";

export const OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

export const OAUTH_SCOPES = [
	"https://www.googleapis.com/auth/cloud-platform",
	"https://www.googleapis.com/auth/userinfo.email",
	"https://www.googleapis.com/auth/userinfo.profile",
	"openid"
].join(" ");

export const KV_OAUTH_STATE_PREFIX = "oauth_state";
export const OAUTH_STATE_TTL = 600;

export const TOKEN_BUFFER_TIME = 5 * 60 * 1000;

export const KV_TOKEN_KEY = "oauth_token_cache";

export const KV_ACCOUNT_POOL_KEY = "account_pool";

export const KV_TOKEN_KEY_PREFIX = "oauth_token_cache";

export const KV_PROJECT_KEY_PREFIX = "project_id";

export const KV_ACCOUNT_COOLDOWN_PREFIX = "account_cooldown";

export const PROJECT_ID_CACHE_TTL = 30 * 24 * 60 * 60;

export const DEFAULT_ACCOUNT_COOLDOWN_SECONDS = 90;

export const DEFAULT_ACCOUNT_SELECTION_STRATEGY = "random";

export const OPENAI_CHAT_COMPLETION_OBJECT = "chat.completion.chunk";
export const OPENAI_MODEL_OWNER = "google-gemini-cli";
