import type {
	GenerateContentParameters,
	GenerateContentResponse,
	CountTokensParameters,
	CountTokensResponse
} from "@google/genai";

// Callers must not invoke requestPost or getOperation on apikey bridges, they throw.
export interface UpstreamBridge {
	generateContentStream(req: GenerateContentParameters): Promise<AsyncGenerator<GenerateContentResponse>>;
	generateContent(req: GenerateContentParameters): Promise<GenerateContentResponse>;
	countTokens(req: CountTokensParameters): Promise<CountTokensResponse>;
	getAccessToken(): Promise<string | null>;
	requestPost<T = unknown>(method: string, body: object): Promise<T>;
	getOperation(name: string): Promise<unknown>;
	onTokens(cb: (tokens: { access_token?: string | null; expiry_date?: number | null }) => void): void;
	setProject(projectId: string): void;
	getProject(): string | undefined;
}
