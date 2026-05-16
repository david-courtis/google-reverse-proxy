import type { GenerateContentResponse } from "@google/genai";

export interface AdaptedGeminiResponse {
	response: {
		candidates?: unknown[];
		usageMetadata?: unknown;
	};
}

export function adaptGenaiResponse(resp: GenerateContentResponse): AdaptedGeminiResponse {
	return {
		response: {
			candidates: resp.candidates as unknown[] | undefined,
			usageMetadata: resp.usageMetadata
		}
	};
}
