export interface ImageValidationResult {
	isValid: boolean;
	error?: string;
	mimeType?: string;
	format?: string;
}

export interface DataUrlComponents {
	mimeType: string;
	data: string;
}

export interface ModelInfo {
	supportsImages?: boolean;
}

export type ModelRegistry = Record<string, ModelInfo>;

export function validateImageUrl(imageUrl: string): ImageValidationResult {
	if (!imageUrl) {
		return { isValid: false, error: "Image URL is required" };
	}

	if (imageUrl.startsWith("data:image/")) {

		const [mimeTypePart, base64Part] = imageUrl.split(",");

		if (!base64Part) {
			return { isValid: false, error: "Invalid base64 image format" };
		}

		const mimeType = mimeTypePart.split(":")[1].split(";")[0];
		const format = mimeType.split("/")[1];

		const supportedFormats = ["jpeg", "jpg", "png", "gif", "webp"];
		if (!supportedFormats.includes(format.toLowerCase())) {
			return {
				isValid: false,
				error: `Unsupported image format: ${format}. Supported formats: ${supportedFormats.join(", ")}`
			};
		}

		try {
			atob(base64Part.substring(0, 100)); 
		} catch {
			return { isValid: false, error: "Invalid base64 encoding" };
		}

		return { isValid: true, mimeType, format };
	}

	if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {

		try {
			new URL(imageUrl);
			return { isValid: true, mimeType: "image/jpeg" }; 
		} catch {
			return { isValid: false, error: "Invalid URL format" };
		}
	}

	return { isValid: false, error: "Image URL must be a base64 data URL or HTTP/HTTPS URL" };
}

export function parseDataUrl(dataUrl: string): DataUrlComponents | null {
	if (!dataUrl.startsWith("data:")) {
		return null;
	}

	const [mimeTypePart, data] = dataUrl.split(",");
	const mimeType = mimeTypePart.split(":")[1].split(";")[0];

	return { mimeType, data };
}

export function modelSupportsImages(modelId: string, models: ModelRegistry): boolean {
	return models[modelId]?.supportsImages || false;
}

export function estimateImageTokens(imageUrl: string, detail: "low" | "high" | "auto" = "auto"): number {
	if (detail === "low") {
		return 85; 
	}

	if (imageUrl.startsWith("data:")) {
		const base64Data = imageUrl.split(",")[1];
		const sizeKB = (base64Data.length * 3) / 4 / 1024; 

		if (sizeKB < 100) return 170; 
		if (sizeKB < 500) return 340; 
		return 680; 
	}

	return 340; 
}
