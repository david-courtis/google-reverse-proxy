import { ModelInfo } from "./types";
import { API_MODEL_SUFFIX, CLI_MODEL_SUFFIX } from "./config";

export type ModelRoute = "cli" | "api" | "either";

export const geminiCliModels: Record<string, ModelInfo> = {
	"gemini-3.1-pro-preview": {
		maxTokens: 65536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsAudios: true,
		supportsVideos: true,
		supportsPdfs: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Google's Gemini 3.1 Pro Preview model via OAuth (free tier)",
		thinking: true
	},
	"gemini-3-pro-preview": {
		maxTokens: 65536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsAudios: true,
		supportsVideos: true,
		supportsPdfs: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Google's Gemini 3.0 Pro Preview model via OAuth (free tier)",
		thinking: true
	},
	"gemini-3-flash-preview": {
		maxTokens: 65536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsAudios: true,
		supportsVideos: true,
		supportsPdfs: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Google's Gemini 3.0 Flash Preview model via OAuth (free tier)",
		thinking: true
	},
	"gemini-3.5-flash": {
		maxTokens: 65536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsAudios: true,
		supportsVideos: true,
		supportsPdfs: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Google's Gemini 3.5 Flash model",
		thinking: true
	},
	"gemini-3.1-flash-lite-preview": {
		maxTokens: 65536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsAudios: true,
		supportsVideos: true,
		supportsPdfs: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Google's Gemini 3.1 Flash Lite Preview model via OAuth (free tier)",
		thinking: true
	},
	"gemini-2.5-pro": {
		maxTokens: 65536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsAudios: true,
		supportsVideos: true,
		supportsPdfs: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Google's Gemini 2.5 Pro model via OAuth (free tier)",
		thinking: true
	},
	"gemini-2.5-flash": {
		maxTokens: 65536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsAudios: true,
		supportsVideos: true,
		supportsPdfs: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Google's Gemini 2.5 Flash model via OAuth (free tier)",
		thinking: true
	},
	"gemini-2.5-flash-lite": {
		maxTokens: 65536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsAudios: true,
		supportsVideos: true,
		supportsPdfs: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Google's Gemini 2.5 Flash Lite model via OAuth (free tier)",
		thinking: true
	}
};

export const DEFAULT_MODEL = "gemini-2.5-flash";

export function parseModelId(modelId: string): { baseModel: string; route: ModelRoute } {
	if (modelId.endsWith(API_MODEL_SUFFIX)) {
		return { baseModel: modelId.slice(0, -API_MODEL_SUFFIX.length), route: "api" };
	}
	if (modelId.endsWith(CLI_MODEL_SUFFIX)) {
		return { baseModel: modelId.slice(0, -CLI_MODEL_SUFFIX.length), route: "cli" };
	}
	return { baseModel: modelId, route: "either" };
}

export function getModelInfo(modelId: string): ModelInfo | null {
	return geminiCliModels[parseModelId(modelId).baseModel] || null;
}

export function getAllModelIds(): string[] {
	return Object.keys(geminiCliModels);
}

export function getAllModelIdsWithVariants(): string[] {
	const base = Object.keys(geminiCliModels);
	return [
		...base,
		...base.map((m) => `${m}${CLI_MODEL_SUFFIX}`),
		...base.map((m) => `${m}${API_MODEL_SUFFIX}`)
	];
}

export function isValidModel(modelId: string): boolean {
	return parseModelId(modelId).baseModel in geminiCliModels;
}
