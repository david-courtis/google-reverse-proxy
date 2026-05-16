import { Env, Tool } from "../types";
import {
	GroundingMetadata,
	NativeTool,
	NativeToolsConfiguration,
	NativeToolsEnvSettings,
	NativeToolsRequestParams
} from "../types/native-tools";
import { CitationsProcessor } from "./citations-processor";
import { NATIVE_TOOLS_DEFAULTS } from "../constants";

export class NativeToolsManager {
	private envSettings: NativeToolsEnvSettings;
	private citationsProcessor: CitationsProcessor;

	constructor(env: Env) {
		this.envSettings = this.parseEnvironmentSettings(env);
		this.citationsProcessor = new CitationsProcessor(env);
	}

	public determineToolConfiguration(
		customTools: Tool[],
		requestParams: NativeToolsRequestParams,
		modelId: string
	): NativeToolsConfiguration {

		if (!this.envSettings.enableNativeTools) {
			return this.createCustomOnlyConfig(customTools);
		}

		const searchAndUrlRequested =
			this.shouldEnableGoogleSearch(requestParams) || this.shouldEnableUrlContext(requestParams);

		if (searchAndUrlRequested) {
			return this.createSearchAndUrlConfig(requestParams, customTools, modelId);
		}

		return this.createCustomOnlyConfig(customTools);
	}

	public createNativeToolsArray(params: NativeToolsRequestParams, modelId: string): NativeTool[] {
		const tools: NativeTool[] = [];

		if (this.shouldEnableGoogleSearch(params)) {
			if (!this.isLegacyModel(modelId)) {
				tools.push({ google_search: {} });
			}
		}

		if (this.shouldEnableUrlContext(params) && !this.shouldEnableGoogleSearch(params)) {
			tools.push({ url_context: {} });
		}

		return tools;
	}

	public processCitationsInText(text: string, groundingMetadata?: GroundingMetadata): string {
		return this.citationsProcessor.processChunk(text, groundingMetadata);
	}

	private createSearchAndUrlConfig(
		requestParams: NativeToolsRequestParams,
		customTools: Tool[],
		modelId: string
	): NativeToolsConfiguration {
		const nativeTools = this.createNativeToolsArray(requestParams, modelId);

		if (this.envSettings.priority === "native_first" || requestParams.nativeToolsPriority === "native") {
			return {
				useNativeTools: true,
				useCustomTools: false,
				nativeTools,
				priority: "native",
				toolType: "search_and_url"
			};
		} else if (this.envSettings.priority === "custom_first" && customTools.length > 0) {
			return this.createCustomOnlyConfig(customTools);
		} else {

			return {
				useNativeTools: true,
				useCustomTools: false,
				nativeTools,
				priority: "native",
				toolType: "search_and_url"
			};
		}
	}

	private createCustomOnlyConfig(customTools: Tool[]): NativeToolsConfiguration {
		return {
			useNativeTools: false,
			useCustomTools: true,
			nativeTools: [],
			customTools,
			priority: "custom",
			toolType: "custom_only"
		};
	}

	private shouldEnableGoogleSearch(params: NativeToolsRequestParams): boolean {
		if (params.enableSearch === false) return false;
		if (params.enableSearch === true) return true;
		return this.envSettings.enableGoogleSearch;
	}

	private shouldEnableUrlContext(params: NativeToolsRequestParams): boolean {
		if (params.enableUrlContext === false) return false;
		if (params.enableUrlContext === true) return true;
		return this.envSettings.enableUrlContext;
	}

	private isLegacyModel(modelId: string): boolean {
		return modelId.includes("gemini-1.5");
	}

	private parseEnvironmentSettings(env: Env): NativeToolsEnvSettings {
		return {
			enableNativeTools: env.ENABLE_GEMINI_NATIVE_TOOLS === "true",
			enableGoogleSearch: env.ENABLE_GOOGLE_SEARCH === "true",
			enableUrlContext: env.ENABLE_URL_CONTEXT === "true",
			priority:
				(env.GEMINI_TOOLS_PRIORITY as NativeToolsEnvSettings["priority"]) ||
				NATIVE_TOOLS_DEFAULTS.GEMINI_TOOLS_PRIORITY,
			defaultToNativeTools: env.DEFAULT_TO_NATIVE_TOOLS !== "false",
			allowRequestControl: env.ALLOW_REQUEST_TOOL_CONTROL !== "false",
			enableInlineCitations: env.ENABLE_INLINE_CITATIONS === "true",
			includeGroundingMetadata: env.INCLUDE_GROUNDING_METADATA !== "false",
			includeSearchEntryPoint: env.INCLUDE_SEARCH_ENTRY_POINT === "true"
		};
	}
}
