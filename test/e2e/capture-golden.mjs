import { getLocal } from "mockttp";
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "fixtures", "golden.real.json");
const UPSTREAM = "https://cloudcode-pa.googleapis.com";

function sanitize(body) {
	try {
		const j = JSON.parse(body);
		if (j.project) j.project = "<PROJECT>";
		if (j.user_prompt_id) j.user_prompt_id = "<UUID>";
		if (j.request && j.request.session_id) j.request.session_id = "<UUID>";
		return j;
	} catch {
		return body;
	}
}

const server = getLocal();
await server.start();
let captured = null;

await server.forAnyRequest().thenForwardTo(UPSTREAM, {
	beforeRequest: async (req) => {
		if (req.url.includes(":streamGenerateContent")) {
			captured = {
				headers: {
					"content-type": req.headers["content-type"],
					"user-agent": req.headers["user-agent"],
					"x-goog-api-client": req.headers["x-goog-api-client"],
					authorization: "Bearer <REDACTED>"
				},
				body: sanitize(await req.body.getText())
			};
		}
		return {};
	}
});

console.log(`[capture-golden] recorder at ${server.url}`);
console.log("[capture-golden] running the REAL gemini CLI (this hits Google; requires prior `gemini` auth)");

const child = spawn('gemini --skip-trust --prompt "say hi in one word"', {
	cwd: tmpdir(),
	env: { ...process.env, CODE_ASSIST_ENDPOINT: server.url, CODE_ASSIST_API_VERSION: "v1internal" },
	stdio: "inherit",
	shell: true
});

child.on("exit", async () => {
	await server.stop();
	if (!captured) {
		console.error("[capture-golden] no streamGenerateContent captured (auth/model issue?)");
		process.exit(1);
	}
	mkdirSync(dirname(OUT), { recursive: true });
	writeFileSync(OUT, JSON.stringify(captured, null, 2) + "\n");
	console.log(`[capture-golden] wrote ${OUT}`);
});
