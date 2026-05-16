import { geminiCliModels } from "../models";
import { logInfo } from "../log";
import {
	DEFAULT_THINKING_BUDGET,
	DEFAULT_TEMPERATURE,
	REASONING_EFFORT_BUDGETS,
	GEMINI_SAFETY_CATEGORIES,
	GEMINI3_EFFORT_TO_THINKING_LEVEL
} from "../constants";
import { ChatCompletionRequest, Env, EffortLevel, ThinkingLevel, SafetyThreshold } from "../types";
import { NativeToolsConfiguration } from "../types/native-tools";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export class GenerationConfigValidator {

	static mapEffortToThinkingBudget(effort: EffortLevel, modelId: string): number {
		const isFlashModel = modelId.includes("flash");

		switch (effort) {
			case "none":
				return REASONING_EFFORT_BUDGETS.none;
			case "low":
				return REASONING_EFFORT_BUDGETS.low;
			case "medium":
				return isFlashModel ? REASONING_EFFORT_BUDGETS.medium.flash : REASONING_EFFORT_BUDGETS.medium.default;
			case "high":
				return isFlashModel ? REASONING_EFFORT_BUDGETS.high.flash : REASONING_EFFORT_BUDGETS.high.default;
			default:
				return DEFAULT_THINKING_BUDGET;
		}
	}

	static mapEffortToThinkingLevel(effort: EffortLevel, modelId: string): ThinkingLevel {
		const isFlashModel = modelId.includes("flash");
		const mapping = GEMINI3_EFFORT_TO_THINKING_LEVEL[effort];
		return isFlashModel ? mapping.flash : mapping.pro;
	}

	static isValidEffortLevel(value: unknown): value is EffortLevel {
		return typeof value === "string" && ["none", "low", "medium", "high"].includes(value);
	}

	private static createThinkingConfig(
		budget: number,
		includeThoughts: boolean = false
	): { thinkingBudget: number; includeThoughts: boolean } {
		return { thinkingBudget: budget, includeThoughts };
	}

	private static createGemini3ThinkingConfig(
		level: ThinkingLevel,
		includeThoughts: boolean = false
	): { thinkingLevel: ThinkingLevel; includeThoughts: boolean } {
		return { thinkingLevel: level, includeThoughts };
	}

	private static cleanSchema(schema: JsonValue): JsonValue {
		if (!schema || typeof schema !== "object") return schema;

		if (Array.isArray(schema)) {
			return schema.map((item) => this.cleanSchema(item));
		}

		const cleaned: { [key: string]: JsonValue } = {};
		const unsupportedKeys = ["strict", "const", "additionalProperties", "exclusiveMaximum", "exclusiveMinimum"];

		for (const [key, value] of Object.entries(schema)) {

			if (key.startsWith("$") || unsupportedKeys.includes(key)) {
				continue;
			}

			cleaned[key] = this.cleanSchema(value);
		}
		return cleaned;
	}

	static createSafetySettings(env: Env): Array<{ category: string; threshold: SafetyThreshold }> {
		const safetySettings: Array<{ category: string; threshold: SafetyThreshold }> = [];

		if (env.GEMINI_MODERATION_HARASSMENT_THRESHOLD) {
			safetySettings.push({
				category: GEMINI_SAFETY_CATEGORIES.HARASSMENT,
				threshold: env.GEMINI_MODERATION_HARASSMENT_THRESHOLD
			});
		}

		if (env.GEMINI_MODERATION_HATE_SPEECH_THRESHOLD) {
			safetySettings.push({
				category: GEMINI_SAFETY_CATEGORIES.HATE_SPEECH,
				threshold: env.GEMINI_MODERATION_HATE_SPEECH_THRESHOLD
			});
		}

		if (env.GEMINI_MODERATION_SEXUALLY_EXPLICIT_THRESHOLD) {
			safetySettings.push({
				category: GEMINI_SAFETY_CATEGORIES.SEXUALLY_EXPLICIT,
				threshold: env.GEMINI_MODERATION_SEXUALLY_EXPLICIT_THRESHOLD
			});
		}

		if (env.GEMINI_MODERATION_DANGEROUS_CONTENT_THRESHOLD) {
			safetySettings.push({
				category: GEMINI_SAFETY_CATEGORIES.DANGEROUS_CONTENT,
				threshold: env.GEMINI_MODERATION_DANGEROUS_CONTENT_THRESHOLD
			});
		}

		return safetySettings;
	}

	static validateThinkingBudget(modelId: string, thinkingBudget: number): number {
		const modelInfo = geminiCliModels[modelId];

		if (modelInfo?.thinking) {

			if (thinkingBudget === 0) {
				logInfo(`[GenerationConfig] Model '${modelId}' doesn't support thinking_budget: 0, using -1 instead`);
				return DEFAULT_THINKING_BUDGET; 
			}

			if (thinkingBudget < -1) {
				logInfo(
					`[GenerationConfig] Invalid thinking_budget: ${thinkingBudget} for model '${modelId}', using -1 instead`
				);
				return DEFAULT_THINKING_BUDGET; 
			}
		}

		return thinkingBudget;
	}

	static createValidatedConfig(
		modelId: string,
		options: Partial<ChatCompletionRequest> = {},
		isRealThinkingEnabled: boolean,
		includeReasoning: boolean
	): Record<string, unknown> {
		const generationConfig: Record<string, unknown> = {
			temperature: options.temperature ?? DEFAULT_TEMPERATURE,
			maxOutputTokens: options.max_tokens,
			topP: options.top_p,
			stopSequences: typeof options.stop === "string" ? [options.stop] : options.stop,
			presencePenalty: options.presence_penalty,
			frequencyPenalty: options.frequency_penalty,
			seed: options.seed
		};

		if (options.response_format?.type === "json_object") {
			generationConfig.responseMimeType = "application/json";
		}

		const modelInfo = geminiCliModels[modelId];
		const isThinkingModel = modelInfo?.thinking || false;
		const isGemini3Model = modelId.includes("gemini-3");

		if (isGemini3Model) {
			const reasoning_effort =
				options.reasoning_effort || options.extra_body?.reasoning_effort || options.model_params?.reasoning_effort;

			if (this.isValidEffortLevel(reasoning_effort)) {
				const level = this.mapEffortToThinkingLevel(reasoning_effort, modelId);
				generationConfig.thinkingConfig = this.createGemini3ThinkingConfig(level, reasoning_effort !== "none");
				logInfo(`[GenerationConfig] Gemini 3 thinkingLevel set to '${level}' for '${modelId}'`);
			}

			Object.keys(generationConfig).forEach(
				(key) => generationConfig[key] === undefined && delete generationConfig[key]
			);
			return generationConfig;
		}

		else if (isThinkingModel) {
			let thinkingBudget = options.thinking_budget ?? DEFAULT_THINKING_BUDGET;

			const reasoning_effort =
				options.reasoning_effort || options.extra_body?.reasoning_effort || options.model_params?.reasoning_effort;

			if (this.isValidEffortLevel(reasoning_effort)) {
				thinkingBudget = this.mapEffortToThinkingBudget(reasoning_effort, modelId);
				includeReasoning = reasoning_effort !== "none";
			}

			const validatedBudget = this.validateThinkingBudget(modelId, thinkingBudget);

			if (isRealThinkingEnabled && includeReasoning) {

				generationConfig.thinkingConfig = this.createThinkingConfig(validatedBudget, true);
				logInfo(`[GenerationConfig] Real thinking enabled for '${modelId}' with budget: ${validatedBudget}`);
			} else {

				generationConfig.thinkingConfig = this.createThinkingConfig(
					this.validateThinkingBudget(modelId, DEFAULT_THINKING_BUDGET)
				);
			}
		}

		Object.keys(generationConfig).forEach((key) => generationConfig[key] === undefined && delete generationConfig[key]);
		return generationConfig;
	}

	static createValidateTools(options: Partial<ChatCompletionRequest> = {}) {
		const tools = [];
		let toolConfig = {};

		if (Array.isArray(options.tools) && options.tools.length > 0) {
			const functionDeclarations = options.tools.map((tool) => {

				const parameters = this.cleanSchema(tool.function.parameters as JsonValue); 
				return {
					name: tool.function.name,
					description: tool.function.description,
					parameters
				};
			});

			tools.push({ functionDeclarations });

			if (options.tool_choice) {
				if (options.tool_choice === "auto") {
					toolConfig = { functionCallingConfig: { mode: "AUTO" } };
				} else if (options.tool_choice === "none") {
					toolConfig = { functionCallingConfig: { mode: "NONE" } };
				} else if (typeof options.tool_choice === "object" && options.tool_choice.function) {
					toolConfig = {
						functionCallingConfig: {
							mode: "ANY",
							allowedFunctionNames: [options.tool_choice.function.name]
						}
					};
				}
			}
		}

		return { tools, toolConfig };
	}
	static createFinalToolConfiguration(
		config: NativeToolsConfiguration,
		options: Partial<ChatCompletionRequest> = {}
	): {
		tools: unknown[] | undefined;
		toolConfig: unknown | undefined;
	} {
		if (config.useCustomTools && config.customTools && config.customTools.length > 0) {
			const { tools, toolConfig } = this.createValidateTools(options);
			return {
				tools,
				toolConfig
			};
		}

		if (config.useNativeTools && config.nativeTools && config.nativeTools.length > 0) {
			return {
				tools: config.nativeTools.map((tool) => {
					if (tool.google_search) {
						return { google_search: tool.google_search };
					}
					if (tool.url_context) {
						return { url_context: tool.url_context };
					}
					return tool;
				}),
				toolConfig: undefined 
			};
		}

		return { tools: undefined, toolConfig: undefined };
	}
}
