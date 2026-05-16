

export const DEFAULT_THINKING_BUDGET = -1;
export const DISABLED_THINKING_BUDGET = 0;

export const DEFAULT_TEMPERATURE = 0.7;

export const AUTO_SWITCH_MODEL_MAP = {
	"gemini-3.1-pro-preview": "gemini-3-flash-preview",
	"gemini-3-pro-preview": "gemini-3-flash-preview",
	"gemini-3-flash-preview": "gemini-2.5-pro",
	"gemini-3.5-flash": "gemini-2.5-flash",
	"gemini-3.1-flash-lite-preview": "gemini-2.5-flash",
	"gemini-2.5-pro": "gemini-2.5-flash"
} as const;

export const RATE_LIMIT_STATUS_CODES = [429, 503] as const;

export const REASONING_EFFORT_BUDGETS = {
	none: 0,
	low: 1024,
	medium: {
		flash: 12288,
		default: 16384
	},
	high: {
		flash: 24576,
		default: 32768
	}
} as const;

export const GEMINI3_EFFORT_TO_THINKING_LEVEL = {
	none: { pro: "low", flash: "minimal" },
	low: { pro: "low", flash: "low" },
	medium: { pro: "low", flash: "medium" },
	high: { pro: "high", flash: "high" }
} as const;

export const GEMINI_SAFETY_CATEGORIES = {
	HARASSMENT: "HARM_CATEGORY_HARASSMENT",
	HATE_SPEECH: "HARM_CATEGORY_HATE_SPEECH",
	SEXUALLY_EXPLICIT: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
	DANGEROUS_CONTENT: "HARM_CATEGORY_DANGEROUS_CONTENT"
} as const;

export const NATIVE_TOOLS_DEFAULTS = {
	ENABLE_GEMINI_NATIVE_TOOLS: false,
	ENABLE_GOOGLE_SEARCH: false,
	ENABLE_URL_CONTEXT: false,
	GEMINI_TOOLS_PRIORITY: "native_first",
	DEFAULT_TO_NATIVE_TOOLS: true,
	ALLOW_REQUEST_TOOL_CONTROL: true,
	ENABLE_INLINE_CITATIONS: false,
	INCLUDE_GROUNDING_METADATA: true,
	INCLUDE_SEARCH_ENTRY_POINT: false
} as const;

export const MIME_TYPE_MAP: Record<string, string> = {
	mp3: "audio/mpeg",
	mp4: "audio/mp4",
	mpeg: "audio/mpeg",
	mpga: "audio/mpeg",
	m4a: "audio/mp4",
	wav: "audio/wav",
	webm: "audio/webm",
	ogg: "audio/ogg",
	oga: "audio/ogg",
	flac: "audio/flac",
	mov: "video/quicktime",
	mpg: "video/mpeg",
	avi: "video/x-msvideo",
	wmv: "video/x-ms-wmv",
	flv: "video/x-flv"
};
