import { NativeToolResponse } from "./types/native-tools";

export type SafetyThreshold =
	| "OFF"
	| "BLOCK_NONE"
	| "BLOCK_FEW"
	| "BLOCK_SOME"
	| "BLOCK_ONLY_HIGH"
	| "HARM_BLOCK_THRESHOLD_UNSPECIFIED";

export interface Env {
	GCP_SERVICE_ACCOUNT: string;
	GEMINI_PROJECT_ID?: string;
	ACCOUNT_SELECTION_STRATEGY?: string;
	ACCOUNT_COOLDOWN_SECONDS?: string;
	DEBUG_LOGS?: string;
	LOG_LEVEL?: string;
	GEMINI_CLI_USER_AGENT?: string;
	GOOG_API_CLIENT?: string;
	GEMINI_CLI_PROXY?: string;
	GEMINI_API_KEYS?: string;
	GEMINI_API_BASE_URL?: string;
	PORT?: string;
	HOST?: string;
	OPENAI_API_KEY?: string;
	ENABLE_REAL_THINKING?: string;
	STREAM_THINKING_AS_CONTENT?: string;
	ENABLE_AUTO_MODEL_SWITCHING?: string;
	PREFERRED_ACCOUNT_KIND?: string;
	GEMINI_MODERATION_HARASSMENT_THRESHOLD?: SafetyThreshold;
	GEMINI_MODERATION_HATE_SPEECH_THRESHOLD?: SafetyThreshold;
	GEMINI_MODERATION_SEXUALLY_EXPLICIT_THRESHOLD?: SafetyThreshold;
	GEMINI_MODERATION_DANGEROUS_CONTENT_THRESHOLD?: SafetyThreshold;

	ENABLE_GEMINI_NATIVE_TOOLS?: string;
	ENABLE_GOOGLE_SEARCH?: string;
	ENABLE_URL_CONTEXT?: string;
	GEMINI_TOOLS_PRIORITY?: string;
	DEFAULT_TO_NATIVE_TOOLS?: string;
	ALLOW_REQUEST_TOOL_CONTROL?: string;

	ENABLE_INLINE_CITATIONS?: string;
	INCLUDE_GROUNDING_METADATA?: string;
	INCLUDE_SEARCH_ENTRY_POINT?: string;

	CORS_ALLOWED_ORIGINS?: string;
}

export interface OAuth2Credentials {
	access_token: string;
	refresh_token: string;
	scope: string;
	token_type: string;
	id_token: string;
	expiry_date: number;
}

export type AccountSelectionStrategy = "random" | "round-robin" | "failover";

export type AccountKind = "oauth" | "apikey";

export type AccountSource = "oauth" | "env" | "apikey" | "apikey-env";

export interface AccountCredential {
	id: string;
	index: number;
	kind: AccountKind;
	credentials?: OAuth2Credentials;
	apiKey?: string;
	email?: string;
	disabled?: boolean;
	source?: AccountSource;
}

export interface ModelInfo {
	maxTokens: number;
	contextWindow: number;
	supportsImages: boolean;
	supportsAudios: boolean;
	supportsVideos: boolean;
	supportsPdfs: boolean;
	supportsPromptCache: boolean;
	inputPrice: number;
	outputPrice: number;
	description: string;
	thinking: boolean;
}

export type EffortLevel = "none" | "low" | "medium" | "high";

export type ThinkingLevel = "minimal" | "low" | "medium" | "high";

export interface Tool {
	type: "function";
	function: {
		name: string;
		description?: string;
		parameters?: Record<string, unknown>;
	};
}

export type ToolChoice = "none" | "auto" | { type: "function"; function: { name: string } };

export interface ChatCompletionRequest {
	model: string;
	messages: ChatMessage[];
	stream?: boolean;
	thinking_budget?: number;
	reasoning_effort?: EffortLevel;
	tools?: Tool[];
	tool_choice?: ToolChoice;

	extra_body?: {
		reasoning_effort?: EffortLevel;
		enable_search?: boolean;
		enable_url_context?: boolean;
		enable_native_tools?: boolean;
		native_tools_priority?: "native" | "custom" | "mixed";
	};
	model_params?: {
		reasoning_effort?: EffortLevel;
		enable_search?: boolean;
		enable_url_context?: boolean;
		enable_native_tools?: boolean;
		native_tools_priority?: "native" | "custom" | "mixed";
	};

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

	enable_search?: boolean;
	enable_url_context?: boolean;
	enable_native_tools?: boolean;
	native_tools_priority?: "native" | "custom" | "mixed";
}

export interface ToolCall {
	id: string;
	type: "function";
	function: {
		name: string;
		arguments: string;
	};

	thought_signature?: string;
}

export interface ChatMessage {
	role: string;
	content: string | MessageContent[];
	tool_calls?: ToolCall[];
	tool_call_id?: string;
}

export interface VideoMetadata {
	startOffset: string;
	endOffset: string;
	fps?: number;
}

export interface MessageContent {
	type: "text" | "image_url" | "input_audio" | "input_video" | "input_pdf";
	text?: string;
	image_url?: {
		url: string;
		detail?: "low" | "high" | "auto";
	};
	input_audio?: {
		data: string;
		format: string;
	};
	input_video?: {
		data: string;
		format: string;
		url?: string;
		videoMetadata?: VideoMetadata;
	};
	input_pdf?: {
		data: string;

	};
}

export interface ChatCompletionResponse {
	id: string;
	object: "chat.completion";
	created: number;
	model: string;
	choices: ChatCompletionChoice[];
	usage?: ChatCompletionUsage;
}

export interface ChatCompletionChoice {
	index: number;
	message: ChatCompletionMessage;
	finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
}

export interface ChatCompletionMessage {
	role: "assistant";
	content: string | null;
	tool_calls?: ToolCall[];
}

export interface ChatCompletionUsage {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
}

export interface GeminiFunctionCall {
	name: string;
	args: object;
	thought_signature?: string;
}

export interface UsageData {
	inputTokens: number;
	outputTokens: number;
}

export interface ReasoningData {
	reasoning: string;
	toolCode?: string;
}

export interface StreamChunk {
	type:
		| "text"
		| "usage"
		| "reasoning"
		| "thinking_content"
		| "real_thinking"
		| "tool_code"
		| "native_tool"
		| "grounding_metadata";
	data: string | UsageData | ReasoningData | GeminiFunctionCall | NativeToolResponse;
}
