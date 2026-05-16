import { GoogleGenAI } from "@google/genai";
import type {
	GenerateContentParameters,
	GenerateContentResponse,
	CountTokensParameters,
	CountTokensResponse
} from "@google/genai";
import { GEMINI_API_ENDPOINT } from "../config";
import type { Env } from "../types";
import type { UpstreamBridge } from "./upstream-bridge";

const API_KEY_ONLY = "This operation is not supported for Google AI Studio API-key accounts.";

export class ApiKeyBridge implements UpstreamBridge {
	private ai: GoogleGenAI;

	private constructor(ai: GoogleGenAI) {
		this.ai = ai;
	}

	static fromApiKey(env: Env, apiKey: string): ApiKeyBridge {
		const baseUrl = env.GEMINI_API_BASE_URL?.trim() || GEMINI_API_ENDPOINT;
		const ai = new GoogleGenAI({
			apiKey,
			httpOptions: { baseUrl }
		});
		return new ApiKeyBridge(ai);
	}

	async generateContentStream(req: GenerateContentParameters): Promise<AsyncGenerator<GenerateContentResponse>> {
		return this.ai.models.generateContentStream(req);
	}

	generateContent(req: GenerateContentParameters): Promise<GenerateContentResponse> {
		return this.ai.models.generateContent(req);
	}

	countTokens(req: CountTokensParameters): Promise<CountTokensResponse> {
		return this.ai.models.countTokens(req);
	}

	async getAccessToken(): Promise<string | null> {
		return null;
	}

	requestPost<T = unknown>(_method: string, _body: object): Promise<T> {
		return Promise.reject(new Error(API_KEY_ONLY));
	}

	getOperation(_name: string): Promise<unknown> {
		return Promise.reject(new Error(API_KEY_ONLY));
	}

	onTokens(_cb: (tokens: { access_token?: string | null; expiry_date?: number | null }) => void): void {
	}

	setProject(_projectId: string): void {
	}

	getProject(): string | undefined {
		return undefined;
	}
}
