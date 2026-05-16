import { randomUUID } from "node:crypto";
import { CodeAssistServer, LlmRole } from "@google/gemini-cli-core";
import { OAuth2Client } from "google-auth-library";
import type {
	GenerateContentParameters,
	GenerateContentResponse,
	CountTokensParameters,
	CountTokensResponse
} from "@google/genai";
import { OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET } from "../config";
import { buildHttpOptions } from "../identity/identity";
import type { Env } from "../types";
import type { UpstreamBridge } from "./upstream-bridge";

type AuthClientArg = ConstructorParameters<typeof CodeAssistServer>[0];

export interface BridgeInit {
	projectId?: string;
	accessToken?: string;
	expiryDate?: number;
}

export class AccountBridge implements UpstreamBridge {
	private env: Env;
	private client: OAuth2Client;
	private server: CodeAssistServer;
	private sessionId: string;
	private projectId?: string;

	private constructor(env: Env, client: OAuth2Client, projectId?: string) {
		this.env = env;
		this.client = client;
		this.sessionId = randomUUID();
		this.projectId = projectId;
		this.server = this.build();
	}

	private build(): CodeAssistServer {
		return new CodeAssistServer(
			this.client as unknown as AuthClientArg,
			this.projectId,
			buildHttpOptions(this.env),
			this.sessionId
		);
	}

	static fromRefreshToken(env: Env, refreshToken: string, init?: BridgeInit): AccountBridge {
		const proxy = env.GEMINI_CLI_PROXY;
		const client = new OAuth2Client({
			clientId: OAUTH_CLIENT_ID,
			clientSecret: OAUTH_CLIENT_SECRET,
			...(proxy ? { transporterOptions: { proxy } } : {})
		});
		const creds: Record<string, unknown> = { refresh_token: refreshToken };
		if (init?.accessToken) creds.access_token = init.accessToken;
		if (init?.expiryDate) creds.expiry_date = init.expiryDate;
		client.setCredentials(creds);
		return new AccountBridge(env, client, init?.projectId);
	}

	onTokens(cb: (tokens: { access_token?: string | null; expiry_date?: number | null }) => void): void {
		this.client.on("tokens", cb);
	}

	setProject(projectId: string): void {
		if (!projectId || this.projectId === projectId) return;
		this.projectId = projectId;
		this.server = this.build();
	}

	getProject(): string | undefined {
		return this.projectId;
	}

	async getAccessToken(): Promise<string | null> {
		try {
			const r = await this.client.getAccessToken();
			return r.token ?? null;
		} catch {
			return null;
		}
	}

	requestPost<T = unknown>(method: string, body: object): Promise<T> {
		return this.server.requestPost<T>(method, body);
	}

	getOperation(name: string): Promise<unknown> {
		return this.server.getOperation(name);
	}

	async generateContentStream(req: GenerateContentParameters): Promise<AsyncGenerator<GenerateContentResponse>> {
		return this.server.generateContentStream(req, randomUUID(), LlmRole.MAIN);
	}

	generateContent(req: GenerateContentParameters): Promise<GenerateContentResponse> {
		return this.server.generateContent(req, randomUUID(), LlmRole.MAIN);
	}

	countTokens(req: CountTokensParameters): Promise<CountTokensResponse> {
		return this.server.countTokens(req);
	}
}
