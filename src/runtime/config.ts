import { homedir } from "node:os";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { randomBytes } from "node:crypto";
import type { Env } from "../types";

let homeCache: string | null = null;

export function runtimeHome(): string {
	if (homeCache) return homeCache;
	const raw = process.env.GEMINI_CLI_OPENAI_HOME;
	const dir = raw && raw.length > 0 ? (isAbsolute(raw) ? raw : join(process.cwd(), raw)) : join(homedir(), ".gemini-cli-openai");
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	homeCache = dir;
	return dir;
}

let configCache: Env | null = null;

export function loadConfig(): Env {
	let fileLayer: Record<string, unknown> = {};
	const cfgPath = join(runtimeHome(), "config.json");
	if (existsSync(cfgPath)) {
		try {
			fileLayer = JSON.parse(readFileSync(cfgPath, "utf8")) as Record<string, unknown>;
		} catch (e) {
			console.error("Failed to parse config.json, ignoring:", e);
		}
	}

	const envLayer: Record<string, string> = {};
	for (const [k, v] of Object.entries(process.env)) {
		if (typeof v === "string") envLayer[k] = v;
	}

	const merged = { ...fileLayer, ...envLayer } as unknown as Env;

	if (!merged.GCP_SERVICE_ACCOUNT && (process.env.DEBUG_LOGS === "true" || process.env.LOG_LEVEL === "debug")) {
		console.debug("GCP_SERVICE_ACCOUNT is not set. The account pool will rely on in-app logins persisted to local KV.");
	}

	return merged;
}

export function getConfig(): Env {
	if (!configCache) configCache = loadConfig();
	return configCache;
}

export function setConfigForTesting(env: Env | null): void {
	configCache = env;
}

export function ensureOpenAIApiKey(env: Env): { key: string; generated: boolean } {
	const userEnvKey = (process.env.OPENAI_API_KEY || "").trim();
	if (userEnvKey) {
		env.OPENAI_API_KEY = userEnvKey;
		return { key: userEnvKey, generated: false };
	}

	const cfgPath = join(runtimeHome(), "config.json");
	let fileLayer: Record<string, unknown> = {};
	if (existsSync(cfgPath)) {
		try {
			fileLayer = JSON.parse(readFileSync(cfgPath, "utf8")) as Record<string, unknown>;
		} catch {
			fileLayer = {};
		}
	}

	const existing = typeof fileLayer.OPENAI_API_KEY === "string" ? fileLayer.OPENAI_API_KEY.trim() : "";
	if (existing) {
		env.OPENAI_API_KEY = existing;
		return { key: existing, generated: false };
	}

	const key = "sk-" + randomBytes(24).toString("hex");
	fileLayer.OPENAI_API_KEY = key;
	try {
		writeFileSync(cfgPath, JSON.stringify(fileLayer, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
	} catch (e) {
		console.error("Failed to persist generated OPENAI_API_KEY:", e);
	}
	env.OPENAI_API_KEY = key;
	return { key, generated: true };
}
