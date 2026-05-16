import type { GenerateContentParameters } from "@google/genai";

export interface GenaiRequestInput {
	model: string;
	contents: unknown[];
	systemPrompt?: string;
	generationConfig?: Record<string, unknown>;
	tools?: unknown[];
	toolConfig?: unknown;
	safetySettings?: unknown[];
}

export function buildGenaiRequest(input: GenaiRequestInput): GenerateContentParameters {
	const config: Record<string, unknown> = { ...(input.generationConfig || {}) };

	if (input.systemPrompt) {
		config.systemInstruction = { role: "user", parts: [{ text: input.systemPrompt }] };
	}
	if (Array.isArray(input.tools) && input.tools.length > 0) {
		config.tools = input.tools;
	}
	if (input.toolConfig && Object.keys(input.toolConfig as object).length > 0) {
		config.toolConfig = input.toolConfig;
	}
	if (Array.isArray(input.safetySettings) && input.safetySettings.length > 0) {
		config.safetySettings = input.safetySettings;
	}

	return {
		model: input.model,
		contents: input.contents,
		config
	} as unknown as GenerateContentParameters;
}
