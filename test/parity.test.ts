import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getLocal, type Mockttp } from "mockttp";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_USER_AGENT } from "../src/identity/identity";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(HERE, "e2e", "fixtures", "golden.json");

let server: Mockttp;
let captured: { headers: Record<string, string>; body: string } | null = null;

const ACCOUNT = {
	access_token: "ya29.parity",
	refresh_token: "parity-refresh-token",
	scope: "",
	token_type: "Bearer",
	id_token: "",
	expiry_date: Date.now() + 3600 * 1000
};

const SSE_CHUNK =
	'data: {"response":{"candidates":[{"content":{"parts":[{"text":"hi"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":1,"totalTokenCount":4}}}\n\n';

async function runChatThroughBridge(): Promise<void> {
	server = getLocal();
	await server.start();

	await server.forAnyRequest().thenCallback(async (req) => {
		const url = req.url;
		if (url.includes(":loadCodeAssist")) {
			return {
				statusCode: 200,
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ cloudaicompanionProject: "parity-project", currentTier: { id: "standard-tier" } })
			};
		}
		if (url.includes(":streamGenerateContent")) {
			captured = { headers: req.headers as Record<string, string>, body: await req.body.getText() };
			return { statusCode: 200, headers: { "content-type": "text/event-stream" }, body: SSE_CHUNK };
		}
		return { statusCode: 404, body: "unexpected upstream call: " + url };
	});

	process.env.GEMINI_CLI_OPENAI_HOME = mkdtempSync(join(tmpdir(), "gco-parity-"));
	process.env.CODE_ASSIST_ENDPOINT = server.url;
	process.env.CODE_ASSIST_API_VERSION = "v1internal";
	process.env.GCP_SERVICE_ACCOUNT = JSON.stringify(ACCOUNT);
	process.env.GEMINI_CLI_USER_AGENT = DEFAULT_USER_AGENT;
	delete process.env.OPENAI_API_KEY;
	delete process.env.GEMINI_PROJECT_ID;

	const { default: app } = await import("../src/app");

	const res = await app.fetch(
		new Request("http://local/v1/chat/completions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: "gemini-2.5-pro",
				stream: true,
				messages: [
					{ role: "system", content: "You are a parity probe." },
					{ role: "user", content: "ping" }
				]
			})
		})
	);
	await res.text();
}

beforeAll(async () => {
	await runChatThroughBridge();
}, 90000);

afterAll(async () => {
	if (server) await server.stop();
});

describe("vendored-core wire parity", () => {
	it("captured the upstream streamGenerateContent request", () => {
		expect(captured).not.toBeNull();
	});

	it("app-controlled headers are the official client's", () => {
		const h = captured!.headers;
		expect(h["content-type"]).toBe("application/json");
		expect(h["user-agent"]).toBe(DEFAULT_USER_AGENT);
		expect(h["authorization"]).toBe("Bearer ya29.parity");
		expect(h["x-goog-api-client"]).toMatch(/^gl-node\//);
	});

	it("user-agent is not double-suffixed by google-auth-library", () => {
		const occurrences = captured!.headers["user-agent"].split("google-api-nodejs-client/").length - 1;
		expect(occurrences).toBe(1);
	});

	it("request envelope is shaped by the core converter (no enabled_credit_types)", () => {
		const body = JSON.parse(captured!.body);
		expect(Object.keys(body).sort()).toEqual(["model", "project", "request", "user_prompt_id"]);
		expect(body).not.toHaveProperty("enabled_credit_types");
		expect(body.model).toBe("gemini-2.5-pro");
		expect(body.project).toBe("parity-project");
		expect(body.user_prompt_id).toMatch(/^[0-9a-f-]{36}$/i);
		expect(body.request.session_id).toMatch(/^[0-9a-f-]{36}$/i);
		expect(Array.isArray(body.request.contents)).toBe(true);
		expect(body.request.systemInstruction?.parts?.[0]?.text).toBe("You are a parity probe.");
		const flat = JSON.stringify(body.request.contents);
		expect(flat).not.toContain("You are a parity probe.");
		expect(body.request.generationConfig).toBeTruthy();
	});

	it("matches the committed golden envelope (regression guard)", () => {
		const body = JSON.parse(captured!.body);
		const normalized = {
			headers: {
				"content-type": captured!.headers["content-type"],
				"user-agent": captured!.headers["user-agent"],
				authorization: "Bearer <REDACTED>",
				"x-goog-api-client": "<GL_NODE>"
			},
			body: {
				...body,
				project: "<PROJECT>",
				user_prompt_id: "<UUID>",
				request: { ...body.request, session_id: "<UUID>" }
			}
		};
		if (!existsSync(GOLDEN)) {
			mkdirSync(dirname(GOLDEN), { recursive: true });
			writeFileSync(GOLDEN, JSON.stringify(normalized, null, 2) + "\n");
		}
		expect(normalized).toEqual(JSON.parse(readFileSync(GOLDEN, "utf8")));
	});
});
