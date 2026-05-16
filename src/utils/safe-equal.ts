import { createHash, timingSafeEqual } from "node:crypto";

export function safeEqual(a: string, b: string): boolean {
	const ah = createHash("sha256").update(a, "utf8").digest();
	const bh = createHash("sha256").update(b, "utf8").digest();
	return timingSafeEqual(ah, bh);
}
