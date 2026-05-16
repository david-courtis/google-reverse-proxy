
export function validatePdfBase64(base64String: string): boolean {
	try {

		const cleanBase64 = base64String.replace(/^data:application\/pdf;base64,/, "");

		const decoded = atob(cleanBase64.substring(0, 20));

		return decoded.startsWith("%PDF-");
	} catch {
		return false;
	}
}
