import type { Env } from "../types";

export const DEFAULT_USER_AGENT =
	"CloudCodeVSCode/0.42.0 (aidev_client; os_type=Windows; os_version=10.0.26200; arch=x64; host_path=VSCode/unknown; proxy_client=geminicli) google-api-nodejs-client/9.15.1";

export const DEFAULT_GOOG_API_CLIENT = "gl-node/24.11.1";

export interface Identity {
	userAgent: string;
	googApiClient: string;
}

export function resolveIdentity(env?: Pick<Env, "GEMINI_CLI_USER_AGENT" | "GOOG_API_CLIENT">): Identity {
	return {
		userAgent: env?.GEMINI_CLI_USER_AGENT || DEFAULT_USER_AGENT,
		googApiClient: env?.GOOG_API_CLIENT || DEFAULT_GOOG_API_CLIENT
	};
}

export function buildHttpOptions(env?: Pick<Env, "GEMINI_CLI_USER_AGENT" | "GOOG_API_CLIENT">): {
	headers: Record<string, string>;
} {
	const id = resolveIdentity(env);
	return {
		headers: {
			"User-Agent": id.userAgent,
			"x-goog-api-client": id.googApiClient
		}
	};
}

export const APP_CONTROLLED_HEADERS = ["content-type", "user-agent", "x-goog-api-client", "authorization"] as const;

export const TRANSPORT_HEADERS = ["accept", "accept-encoding", "connection", "host", "content-length"] as const;
