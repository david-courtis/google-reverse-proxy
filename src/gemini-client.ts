import {
	Env,
	StreamChunk,
	UsageData,
	ChatMessage,
	Tool,
	ToolChoice,
	GeminiFunctionCall
} from "./types";
import { AuthManager, InvalidGrantError } from "./auth";
import { logInfo } from "./log";
import { buildGenaiRequest } from "./translate/to-genai";
import { adaptGenaiResponse } from "./translate/from-genai";
import { upstreamStatus, upstreamBody, isInvalidGrant } from "./bridge/errors";
import type { GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import { validateContent } from "./utils/validation";
import { GenerationConfigValidator } from "./helpers/generation-config-validator";
import { AutoModelSwitchingHelper } from "./helpers/auto-model-switching";
import { NativeToolsManager } from "./helpers/native-tools-manager";
import { CitationsProcessor } from "./helpers/citations-processor";
import { encodeSignatureInToolCallId, extractSignatureFromToolCallId } from "./helpers/thought-signature";
import { GeminiUrlContextMetadata, GroundingMetadata, NativeToolsRequestParams } from "./types/native-tools";

interface GeminiCandidate {
	content?: {
		parts?: Array<{ text?: string }>;
	};
	groundingMetadata?: GroundingMetadata;
}

interface GeminiUsageMetadata {
	promptTokenCount?: number;
	candidatesTokenCount?: number;
}

interface GeminiResponse {
	response?: {
		candidates?: GeminiCandidate[];
		usageMetadata?: GeminiUsageMetadata;
	};
}

export interface GeminiPart {
	text?: string;
	thought?: boolean;
	thoughtSignature?: string;
	functionCall?: {
		name: string;
		args: object;
	};
	functionResponse?: {
		name: string;
		response: {
			result: string;
		};
	};
	inlineData?: {
		mimeType: string;
		data: string;
	};
	fileData?: {
		mimeType: string;
		fileUri: string;
	};
	url_context_metadata?: GeminiUrlContextMetadata;

	videoMetadata?: {
		startOffset?: string;
		endOffset?: string;
		fps?: number;
	};
}

interface GeminiFormattedMessage {
	role: string;
	parts: GeminiPart[];
}

interface ProjectDiscoveryResponse {
	cloudaicompanionProject?: string;
}

export class GeminiApiClient {
	private env: Env;
	private authManager: AuthManager;
	private projectId: string | null = null;
	private autoSwitchHelper: AutoModelSwitchingHelper;
	private suppressModelSwitch = false;

	constructor(env: Env, authManager: AuthManager) {
		this.env = env;
		this.authManager = authManager;
		this.autoSwitchHelper = new AutoModelSwitchingHelper(env);
	}

	public setModelSwitchSuppressed(suppressed: boolean): void {
		this.suppressModelSwitch = suppressed;
	}

	private isSingleAccount(): boolean {
		const raw = (this.env.GCP_SERVICE_ACCOUNT || "").trimStart();
		return !raw.startsWith("[");
	}

	public async discoverProjectId(): Promise<string> {
		if (this.projectId) {
			return this.projectId;
		}

		if ((await this.authManager.getAccountKind()) === "apikey") {
			this.projectId = "";
			return "";
		}

		if (this.env.GEMINI_PROJECT_ID && this.isSingleAccount()) {
			this.projectId = this.env.GEMINI_PROJECT_ID;
			await this.authManager.setCachedProjectId(this.projectId);
			return this.projectId;
		}

		const cached = await this.authManager.getCachedProjectId();
		if (cached) {
			this.projectId = cached;
			return cached;
		}

		try {

			const initialProjectId = undefined;
			const loadResponse = (await this.authManager.callEndpoint("loadCodeAssist", {
				cloudaicompanionProject: initialProjectId,
				metadata: { duetProject: initialProjectId }
			})) as ProjectDiscoveryResponse;

			if (loadResponse.cloudaicompanionProject) {
				this.projectId = loadResponse.cloudaicompanionProject;
				await this.authManager.setCachedProjectId(loadResponse.cloudaicompanionProject);
				return loadResponse.cloudaicompanionProject;
			}
			throw new Error("Project ID discovery failed. Please set the GEMINI_PROJECT_ID environment variable.");
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error("Failed to discover project ID:", errorMessage);
			throw new Error(
				"Could not discover project ID. Make sure you're authenticated and consider setting GEMINI_PROJECT_ID."
			);
		}
	}

	private messageToGeminiFormat(msg: ChatMessage): GeminiFormattedMessage {
		const role = msg.role === "assistant" ? "model" : "user";

		if (msg.role === "tool") {
			return {
				role: "user",
				parts: [
					{
						functionResponse: {
							name: msg.tool_call_id || "unknown_function",
							response: {
								result: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
							}
						}
					}
				]
			};
		}

		if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
			const parts: GeminiPart[] = [];

			if (typeof msg.content === "string" && msg.content.trim()) {
				parts.push({ text: msg.content });
			}

			for (const toolCall of msg.tool_calls) {
				if (toolCall.type === "function") {
					const functionCallPart: GeminiPart = {
						functionCall: {
							name: toolCall.function.name,
							args: JSON.parse(toolCall.function.arguments)
						}
					};

					const signature = extractSignatureFromToolCallId(toolCall.id) || toolCall.thought_signature;
					if (signature) {
						functionCallPart.thoughtSignature = signature;
					}

					parts.push(functionCallPart);
				}
			}

			return { role: "model", parts };
		}

		if (typeof msg.content === "string") {

			return {
				role,
				parts: [{ text: msg.content }]
			};
		}

		if (Array.isArray(msg.content)) {

			const parts: GeminiPart[] = [];

			for (const content of msg.content) {
				if (content.type === "text") {
					parts.push({ text: content.text });
				} else if (content.type === "image_url" && content.image_url) {
					const imageUrl = content.image_url.url;

					const { isValid, error, mimeType } = validateContent("image_url", content);
					if (!isValid) {
						throw new Error(`Invalid image: ${error}`);
					}

					if (imageUrl.startsWith("data:")) {

						const [mimeType, base64Data] = imageUrl.split(",");
						const mediaType = mimeType.split(":")[1].split(";")[0];

						parts.push({
							inlineData: {
								mimeType: mediaType,
								data: base64Data
							}
						});
					} else {

						const part = {
							fileData: {
								mimeType: mimeType || "image/jpeg",
								fileUri: imageUrl
							}
						};
						parts.push(part);
					}
				} else if (content.type === "input_audio" && content.input_audio) {
					parts.push({
						inlineData: {
							mimeType: content.input_audio.format,
							data: content.input_audio.data
						}
					});
				} else if (content.type === "input_video" && content.input_video) {
					if (content.input_video.data && content.input_video.format) {

						const part: GeminiPart = {
							inlineData: {
								mimeType: content.input_video.format,
								data: content.input_video.data
							}
						};

						if (content.input_video.videoMetadata) {
							const { startOffset, endOffset, fps } = content.input_video.videoMetadata;
							if (startOffset || endOffset || fps) {
								part.videoMetadata = {};

								if (startOffset) part.videoMetadata.startOffset = startOffset;
								if (endOffset) part.videoMetadata.endOffset = endOffset;
								if (fps) part.videoMetadata.fps = fps;
							}
						}
						parts.push(part);
					}
				} else if (content.type === "input_pdf" && content.input_pdf) {
					if (content.input_pdf.data) {

						const { isValid, error } = validateContent("input_pdf", content);
						if (!isValid) {
							throw new Error(`Invalid PDF: ${error}`);
						}

						parts.push({
							inlineData: {
								mimeType: "application/pdf",
								data: content.input_pdf.data
							}
						});
					}
				}
			}

			return { role, parts };
		}

		return {
			role,
			parts: [{ text: String(msg.content) }]
		};
	}

	async *streamContent(
		modelId: string,
		systemPrompt: string,
		messages: ChatMessage[],
		options?: {
			includeReasoning?: boolean;
			thinkingBudget?: number;
			tools?: Tool[];
			tool_choice?: ToolChoice;
			max_tokens?: number;
			temperature?: number;
			top_p?: number;
			stop?: string | string[];
			presence_penalty?: number;
			frequency_penalty?: number;
			seed?: number;
			response_format?: {
				type: "text" | "json_object";
			};
			reasoning_effort?: "none" | "low" | "medium" | "high";
		} & NativeToolsRequestParams
	): AsyncGenerator<StreamChunk> {
		await this.authManager.initializeAuth();
		await this.discoverProjectId();

		const contents = messages.map((msg) => this.messageToGeminiFormat(msg));

		const isRealThinkingEnabled = this.env.ENABLE_REAL_THINKING === "true";
		const streamThinkingAsContent = this.env.STREAM_THINKING_AS_CONTENT === "true";
		const includeReasoning = options?.includeReasoning || false;

		const req = {
			thinking_budget: options?.thinkingBudget,
			tools: options?.tools,
			tool_choice: options?.tool_choice,
			max_tokens: options?.max_tokens,
			temperature: options?.temperature,
			top_p: options?.top_p,
			stop: options?.stop,
			presence_penalty: options?.presence_penalty,
			frequency_penalty: options?.frequency_penalty,
			seed: options?.seed,
			response_format: options?.response_format,
			reasoning_effort: options?.reasoning_effort
		};

		const nativeToolsManager = new NativeToolsManager(this.env);
		const nativeToolsParams = this.extractNativeToolsParams(options as Record<string, unknown>);
		const toolConfig = nativeToolsManager.determineToolConfiguration(options?.tools || [], nativeToolsParams, modelId);

		const { tools, toolConfig: finalToolConfig } = GenerationConfigValidator.createFinalToolConfiguration(
			toolConfig,
			options
		);

		const generationConfig = GenerationConfigValidator.createValidatedConfig(
			modelId,
			req,
			isRealThinkingEnabled,
			includeReasoning
		);

		const safetySettings = GenerationConfigValidator.createSafetySettings(this.env);

		const genaiReq = buildGenaiRequest({
			model: modelId,
			contents,
			systemPrompt,
			generationConfig: generationConfig as Record<string, unknown>,
			tools: tools as unknown[] | undefined,
			toolConfig: finalToolConfig,
			safetySettings
		});

		yield* this.performStreamRequest(
			genaiReq,
			false,
			includeReasoning && streamThinkingAsContent,
			modelId,
			nativeToolsManager
		);
	}

	private async *performStreamRequest(
		genaiReq: GenerateContentParameters,
		isRetry: boolean = false,
		realThinkingAsContent: boolean = false,
		originalModel?: string,
		nativeToolsManager?: NativeToolsManager
	): AsyncGenerator<StreamChunk> {
		const citationsProcessor = new CitationsProcessor(this.env);
		const retryDelays = [500, 1000, 2000, 3000];
		let currentModel = originalModel;
		const req = genaiReq;
		let stream: AsyncGenerator<GenerateContentResponse> | null = null;

		while (true) {
			let lastStatus: number | undefined;
			let acquired = false;

			for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
				try {
					const bridge = await this.authManager.getBridge();
					stream = await bridge.generateContentStream(req);
					acquired = true;
					break;
				} catch (err: unknown) {
					if (err instanceof InvalidGrantError) throw err;
					if (isInvalidGrant(err)) throw new InvalidGrantError(upstreamBody(err));
					const status = upstreamStatus(err);
					lastStatus = status;

					if (status === 401 && !isRetry) {
						logInfo("Got 401 error in stream request, clearing token cache and retrying...");
						await this.authManager.clearTokenCache();
						await this.authManager.initializeAuth();
						isRetry = true;
						continue;
					}

					if (status !== undefined && this.autoSwitchHelper.isRateLimitStatus(status)) {
						if (attempt < retryDelays.length) {
							const delay = retryDelays[attempt];
							logInfo(
								`Got ${status} for ${currentModel}, retrying in ${delay}ms (attempt ${attempt + 1}/${retryDelays.length})`
							);
							await new Promise((resolve) => setTimeout(resolve, delay));
							continue;
						}
						break;
					}

					console.error(`[GeminiAPI] Stream request failed: ${status}`, upstreamBody(err));
					throw new Error(`Stream request failed: ${status ?? "unknown"}`);
				}
			}

			if (acquired) {
				break;
			}

			if (lastStatus !== undefined && this.autoSwitchHelper.isRateLimitStatus(lastStatus) && currentModel) {
				const fallbackModel = this.autoSwitchHelper.getFallbackModel(currentModel);
				if (fallbackModel && this.autoSwitchHelper.isEnabled() && !this.suppressModelSwitch) {
					logInfo(`Switching from ${currentModel} to fallback: ${fallbackModel}`);

					yield {
						type: "text",
						data: this.autoSwitchHelper.createSwitchNotification(currentModel, fallbackModel)
					};

					req.model = fallbackModel;
					currentModel = fallbackModel;
					continue;
				}
			}

			throw new Error(`Stream request failed: ${lastStatus ?? "unknown"}`);
		}

		if (!stream) {
			throw new Error("Response has no body");
		}

		let hasClosedThinking = false;
		let hasStartedThinking = false;

		for await (const genResp of stream) {
			const jsonData = adaptGenaiResponse(genResp) as unknown as GeminiResponse;
			const candidate = jsonData.response?.candidates?.[0];

			if (candidate?.content?.parts) {
				for (const part of candidate.content.parts as GeminiPart[]) {

					if (part.thought === true && part.text) {
						const thinkingText = part.text;

						if (realThinkingAsContent) {

							if (!hasStartedThinking) {
								yield {
									type: "thinking_content",
									data: "<thinking>\n"
								};
								hasStartedThinking = true;
							}

							yield {
								type: "thinking_content",
								data: thinkingText
							};
						} else {

							yield {
								type: "real_thinking",
								data: thinkingText
							};
						}
					}

					else if (part.text && part.text.includes("<think>")) {
						if (realThinkingAsContent) {

							const thinkingMatch = part.text.match(/<think>(.*?)<\/think>/s);
							if (thinkingMatch) {
								if (!hasStartedThinking) {
									yield {
										type: "thinking_content",
										data: "<thinking>\n"
									};
									hasStartedThinking = true;
								}

								yield {
									type: "thinking_content",
									data: thinkingMatch[1]
								};
							}

							const nonThinkingContent = part.text.replace(/<think>.*?<\/think>/gs, "").trim();
							if (nonThinkingContent) {
								if (hasStartedThinking && !hasClosedThinking) {
									yield {
										type: "thinking_content",
										data: "\n</thinking>\n\n"
									};
									hasClosedThinking = true;
								}
								yield { type: "text", data: nonThinkingContent };
							}
						} else {

							const thinkingMatch = part.text.match(/<think>(.*?)<\/think>/s);
							if (thinkingMatch) {
								yield {
									type: "real_thinking",
									data: thinkingMatch[1]
								};
							}

							const nonThinkingContent = part.text.replace(/<think>.*?<\/think>/gs, "").trim();
							if (nonThinkingContent) {
								yield { type: "text", data: nonThinkingContent };
							}
						}
					}

					else if (part.text && !part.thought && !part.text.includes("<think>")) {

						if (realThinkingAsContent && hasStartedThinking && !hasClosedThinking) {
							yield {
								type: "thinking_content",
								data: "\n</thinking>\n\n"
							};
							hasClosedThinking = true;
						}

						let processedText = part.text;
						if (nativeToolsManager) {
							processedText = citationsProcessor.processChunk(
								part.text,
								jsonData.response?.candidates?.[0]?.groundingMetadata
							);
						}
						yield { type: "text", data: processedText };
					}

					else if (part.functionCall) {

						if (realThinkingAsContent && hasStartedThinking && !hasClosedThinking) {
							yield {
								type: "thinking_content",
								data: "\n</thinking>\n\n"
							};
							hasClosedThinking = true;
						}

						const functionCallData: GeminiFunctionCall = {
							name: part.functionCall.name,
							args: part.functionCall.args
						};

						if (part.thoughtSignature) {
							functionCallData.thought_signature = part.thoughtSignature;
						}

						yield {
							type: "tool_code",
							data: functionCallData
						};
					}

				}
			}

			if (jsonData.response?.usageMetadata) {
				const usage = jsonData.response.usageMetadata;
				const usageData: UsageData = {
					inputTokens: usage.promptTokenCount || 0,
					outputTokens: usage.candidatesTokenCount || 0
				};
				yield {
					type: "usage",
					data: usageData
				};
			}
		}
	}

	async getCompletion(
		modelId: string,
		systemPrompt: string,
		messages: ChatMessage[],
		options?: {
			includeReasoning?: boolean;
			thinkingBudget?: number;
			tools?: Tool[];
			tool_choice?: ToolChoice;
			max_tokens?: number;
			temperature?: number;
			top_p?: number;
			stop?: string | string[];
			presence_penalty?: number;
			frequency_penalty?: number;
			seed?: number;
			response_format?: {
				type: "text" | "json_object";
			};
			reasoning_effort?: "none" | "low" | "medium" | "high";
		} & NativeToolsRequestParams
	): Promise<{
		content: string;
		usage?: UsageData;
		tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
	}> {
		try {
			let content = "";
			let usage: UsageData | undefined;
			const tool_calls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = [];

			for await (const chunk of this.streamContent(modelId, systemPrompt, messages, options)) {
				if (chunk.type === "text" && typeof chunk.data === "string") {
					content += chunk.data;
				} else if (chunk.type === "usage" && typeof chunk.data === "object") {
					usage = chunk.data as UsageData;
				} else if (chunk.type === "tool_code" && typeof chunk.data === "object") {
					const toolData = chunk.data as GeminiFunctionCall;
					const toolCall: { id: string; type: "function"; function: { name: string; arguments: string } } = {
						id: encodeSignatureInToolCallId(toolData.thought_signature),
						type: "function",
						function: {
							name: toolData.name,
							arguments: JSON.stringify(toolData.args)
						}
					};
					tool_calls.push(toolCall);
				}

			}

			return {
				content,
				usage,
				tool_calls: tool_calls.length > 0 ? tool_calls : undefined
			};
		} catch (error: unknown) {

			if (this.autoSwitchHelper.isRateLimitError(error) && !this.suppressModelSwitch) {
				const fallbackResult = await this.autoSwitchHelper.handleNonStreamingFallback(
					modelId,
					systemPrompt,
					messages,
					options,
					this.streamContent.bind(this)
				);
				if (fallbackResult) {
					return fallbackResult;
				}
			}

			throw error;
		}
	}

	private extractNativeToolsParams(options?: Record<string, unknown>): NativeToolsRequestParams {
		return {
			enableSearch: this.extractBooleanParam(options, "enable_search"),
			enableUrlContext: this.extractBooleanParam(options, "enable_url_context"),
			enableNativeTools: this.extractBooleanParam(options, "enable_native_tools"),
			nativeToolsPriority: this.extractStringParam(
				options,
				"native_tools_priority",
				(v): v is "native" | "custom" | "mixed" => ["native", "custom", "mixed"].includes(v)
			)
		};
	}

	private extractBooleanParam(options: Record<string, unknown> | undefined, key: string): boolean | undefined {
		const value =
			options?.[key] ??
			(options?.extra_body as Record<string, unknown>)?.[key] ??
			(options?.model_params as Record<string, unknown>)?.[key];
		return typeof value === "boolean" ? value : undefined;
	}

	private extractStringParam<T extends string>(
		options: Record<string, unknown> | undefined,
		key: string,
		guard: (v: string) => v is T
	): T | undefined {
		const value =
			options?.[key] ??
			(options?.extra_body as Record<string, unknown>)?.[key] ??
			(options?.model_params as Record<string, unknown>)?.[key];
		if (typeof value === "string" && guard(value)) {
			return value;
		}
		return undefined;
	}
}
