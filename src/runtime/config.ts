import { homedir } from "node:os";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { randomBytes } from "node:crypto";
import { parse as parseYaml } from "yaml";
import type { Env } from "../types";

export interface RuntimeSettings {
	selectionStrategy: "random" | "round-robin" | "failover";
	cooldownSeconds: number;
	apiKeyDailyQuota: number;
	preferredAccountKind: "cli" | "api";
	enableRealThinking: boolean;
	streamThinkingAsContent: boolean;
	enableAutoModelSwitching: boolean;
	modelVisibility: Record<string, boolean>;
}

const DEFAULT_SETTINGS: RuntimeSettings = {
	selectionStrategy: "random",
	cooldownSeconds: 90,
	apiKeyDailyQuota: 500,
	preferredAccountKind: "cli",
	enableRealThinking: false,
	streamThinkingAsContent: false,
	enableAutoModelSwitching: false,
	modelVisibility: {}
};

let homeCache: string | null = null;
let envCache: Env | null = null;
let settingsCache: RuntimeSettings | null = null;

export function runtimeHome(): string {
	if (homeCache) return homeCache;
	const raw = process.env.GEMINI_CLI_OPENAI_HOME;
	const dir = raw && raw.length > 0 ? (isAbsolute(raw) ? raw : join(process.cwd(), raw)) : join(homedir(), ".gemini-cli-openai");
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	homeCache = dir;
	return dir;
}

function findConfigPath(): string | null {
	const explicit = process.env.CONFIG_PATH;
	if (explicit && existsSync(explicit)) return explicit;
	const cwd = join(process.cwd(), "config.yaml");
	if (existsSync(cwd)) return cwd;
	const home = join(runtimeHome(), "config.yaml");
	if (existsSync(home)) return home;
	return null;
}

type RawYaml = {
	server?: {
		port?: number;
		host?: string;
		bearer_token?: string | null;
		cors_allowed_origins?: string[] | string | null;
	};
	accounts?: {
		oauth?: unknown;
		api_keys?: string[] | string | null;
		project_id?: string | null;
	};
	pool?: {
		selection_strategy?: "random" | "round-robin" | "failover";
		cooldown_seconds?: number;
		preferred_account_kind?: "cli" | "api";
		api_key_daily_quota?: number;
		enable_auto_model_switching?: boolean;
	};
	thinking?: { enabled?: boolean; stream_inline?: boolean };
	native_tools?: {
		enabled?: boolean;
		google_search?: boolean;
		url_context?: boolean;
		priority?: "native" | "custom" | "mixed";
		default_to_native?: boolean;
		allow_request_control?: boolean;
	};
	citations?: {
		inline_markers?: boolean;
		grounding_metadata?: boolean;
		search_entry_point?: boolean;
	};
	moderation?: {
		harassment?: string | null;
		hate_speech?: string | null;
		sexually_explicit?: string | null;
		dangerous_content?: string | null;
	};
	upstream?: {
		api_base_url?: string | null;
		proxy?: string | null;
		user_agent?: string | null;
		goog_api_client?: string | null;
	};
	logging?: { debug?: boolean; level?: string };
};

function readYaml(): RawYaml {
	const p = findConfigPath();
	if (!p) return {};
	try {
		return (parseYaml(readFileSync(p, "utf8")) as RawYaml) || {};
	} catch (e) {
		console.error(`Failed to parse ${p}, ignoring:`, e);
		return {};
	}
}

function toEnv(y: RawYaml): Env {
	const env: Partial<Env> = {};
	const stringify = (v: unknown): string | undefined => {
		if (v === null || v === undefined) return undefined;
		if (typeof v === "string") return v;
		if (typeof v === "number" || typeof v === "boolean") return String(v);
		return JSON.stringify(v);
	};

	if (y.server?.port !== undefined) env.PORT = String(y.server.port);
	if (y.server?.host) env.HOST = y.server.host;
	if (y.server?.bearer_token) env.OPENAI_API_KEY = y.server.bearer_token;
	if (y.server?.cors_allowed_origins) {
		env.CORS_ALLOWED_ORIGINS = Array.isArray(y.server.cors_allowed_origins)
			? y.server.cors_allowed_origins.join(",")
			: y.server.cors_allowed_origins;
	}

	if (y.accounts?.oauth !== undefined && y.accounts.oauth !== null) {
		env.GCP_SERVICE_ACCOUNT = typeof y.accounts.oauth === "string"
			? y.accounts.oauth
			: JSON.stringify(y.accounts.oauth);
	}
	if (y.accounts?.api_keys) {
		env.GEMINI_API_KEYS = Array.isArray(y.accounts.api_keys)
			? y.accounts.api_keys.join(",")
			: y.accounts.api_keys;
	}
	if (y.accounts?.project_id) env.GEMINI_PROJECT_ID = y.accounts.project_id;

	if (y.pool?.selection_strategy) env.ACCOUNT_SELECTION_STRATEGY = y.pool.selection_strategy;
	if (y.pool?.cooldown_seconds !== undefined) env.ACCOUNT_COOLDOWN_SECONDS = String(y.pool.cooldown_seconds);
	if (y.pool?.preferred_account_kind) env.PREFERRED_ACCOUNT_KIND = y.pool.preferred_account_kind;
	if (y.pool?.enable_auto_model_switching !== undefined) {
		env.ENABLE_AUTO_MODEL_SWITCHING = String(y.pool.enable_auto_model_switching);
	}

	if (y.thinking?.enabled !== undefined) env.ENABLE_REAL_THINKING = String(y.thinking.enabled);
	if (y.thinking?.stream_inline !== undefined) env.STREAM_THINKING_AS_CONTENT = String(y.thinking.stream_inline);

	if (y.native_tools?.enabled !== undefined) env.ENABLE_GEMINI_NATIVE_TOOLS = String(y.native_tools.enabled);
	if (y.native_tools?.google_search !== undefined) env.ENABLE_GOOGLE_SEARCH = String(y.native_tools.google_search);
	if (y.native_tools?.url_context !== undefined) env.ENABLE_URL_CONTEXT = String(y.native_tools.url_context);
	if (y.native_tools?.priority) env.GEMINI_TOOLS_PRIORITY = y.native_tools.priority;
	if (y.native_tools?.default_to_native !== undefined) {
		env.DEFAULT_TO_NATIVE_TOOLS = String(y.native_tools.default_to_native);
	}
	if (y.native_tools?.allow_request_control !== undefined) {
		env.ALLOW_REQUEST_TOOL_CONTROL = String(y.native_tools.allow_request_control);
	}

	if (y.citations?.inline_markers !== undefined) env.ENABLE_INLINE_CITATIONS = String(y.citations.inline_markers);
	if (y.citations?.grounding_metadata !== undefined) {
		env.INCLUDE_GROUNDING_METADATA = String(y.citations.grounding_metadata);
	}
	if (y.citations?.search_entry_point !== undefined) {
		env.INCLUDE_SEARCH_ENTRY_POINT = String(y.citations.search_entry_point);
	}

	if (y.moderation?.harassment) env.GEMINI_MODERATION_HARASSMENT_THRESHOLD = y.moderation.harassment as Env["GEMINI_MODERATION_HARASSMENT_THRESHOLD"];
	if (y.moderation?.hate_speech) env.GEMINI_MODERATION_HATE_SPEECH_THRESHOLD = y.moderation.hate_speech as Env["GEMINI_MODERATION_HATE_SPEECH_THRESHOLD"];
	if (y.moderation?.sexually_explicit) {
		env.GEMINI_MODERATION_SEXUALLY_EXPLICIT_THRESHOLD = y.moderation.sexually_explicit as Env["GEMINI_MODERATION_SEXUALLY_EXPLICIT_THRESHOLD"];
	}
	if (y.moderation?.dangerous_content) {
		env.GEMINI_MODERATION_DANGEROUS_CONTENT_THRESHOLD = y.moderation.dangerous_content as Env["GEMINI_MODERATION_DANGEROUS_CONTENT_THRESHOLD"];
	}

	if (y.upstream?.api_base_url) env.GEMINI_API_BASE_URL = y.upstream.api_base_url;
	if (y.upstream?.proxy) env.GEMINI_CLI_PROXY = y.upstream.proxy;
	if (y.upstream?.user_agent) env.GEMINI_CLI_USER_AGENT = y.upstream.user_agent;
	if (y.upstream?.goog_api_client) env.GOOG_API_CLIENT = y.upstream.goog_api_client;

	if (y.logging?.debug !== undefined) env.DEBUG_LOGS = String(y.logging.debug);
	if (y.logging?.level) env.LOG_LEVEL = y.logging.level;

	void stringify;
	return env as Env;
}

function toSettings(y: RawYaml): RuntimeSettings {
	return {
		selectionStrategy: y.pool?.selection_strategy ?? DEFAULT_SETTINGS.selectionStrategy,
		cooldownSeconds: y.pool?.cooldown_seconds ?? DEFAULT_SETTINGS.cooldownSeconds,
		apiKeyDailyQuota: y.pool?.api_key_daily_quota ?? DEFAULT_SETTINGS.apiKeyDailyQuota,
		preferredAccountKind: y.pool?.preferred_account_kind ?? DEFAULT_SETTINGS.preferredAccountKind,
		enableRealThinking: y.thinking?.enabled ?? DEFAULT_SETTINGS.enableRealThinking,
		streamThinkingAsContent: y.thinking?.stream_inline ?? DEFAULT_SETTINGS.streamThinkingAsContent,
		enableAutoModelSwitching: y.pool?.enable_auto_model_switching ?? DEFAULT_SETTINGS.enableAutoModelSwitching,
		modelVisibility: {}
	};
}

export function loadConfig(): Env {
	const y = readYaml();
	const yEnv = toEnv(y);
	const envLayer: Record<string, string> = {};
	for (const [k, v] of Object.entries(process.env)) {
		if (typeof v === "string") envLayer[k] = v;
	}
	const merged = { ...yEnv, ...envLayer } as unknown as Env;
	if (!merged.GCP_SERVICE_ACCOUNT && !merged.GEMINI_API_KEYS) {
		console.warn("No accounts configured. Add an OAuth payload or AI Studio keys to config.yaml, or set GCP_SERVICE_ACCOUNT / GEMINI_API_KEYS.");
	}
	envCache = merged;
	settingsCache = toSettings(y);
	return merged;
}

export function getConfig(): Env {
	if (!envCache) loadConfig();
	return envCache!;
}

export function effectiveConfig(_env: Env): RuntimeSettings {
	if (!settingsCache) loadConfig();
	return settingsCache!;
}

export function setConfigForTesting(env: Env | null, settings: RuntimeSettings | null): void {
	envCache = env;
	settingsCache = settings;
}

export function ensureOpenAIApiKey(env: Env): { key: string; generated: boolean } {
	const userEnvKey = (process.env.OPENAI_API_KEY || "").trim();
	if (userEnvKey) {
		env.OPENAI_API_KEY = userEnvKey;
		return { key: userEnvKey, generated: false };
	}
	if (env.OPENAI_API_KEY) {
		return { key: env.OPENAI_API_KEY, generated: false };
	}
	const cachePath = join(runtimeHome(), "bearer.key");
	if (existsSync(cachePath)) {
		const cached = readFileSync(cachePath, "utf8").trim();
		if (cached) {
			env.OPENAI_API_KEY = cached;
			return { key: cached, generated: false };
		}
	}
	const key = "sk-" + randomBytes(24).toString("hex");
	try {
		writeFileSync(cachePath, key + "\n", { encoding: "utf8", mode: 0o600 });
	} catch (e) {
		console.error("Failed to persist generated OPENAI_API_KEY:", e);
	}
	env.OPENAI_API_KEY = key;
	return { key, generated: true };
}
