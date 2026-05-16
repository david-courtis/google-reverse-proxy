import { Env } from "./types";

let debugEnabled = false;

export function setDebugFromEnv(env: Env): void {
	debugEnabled = env.DEBUG_LOGS === "true" || env.LOG_LEVEL === "debug";
}

export function isDebug(): boolean {
	return debugEnabled;
}

const useColor = !!process.stdout.isTTY && process.env.NO_COLOR === undefined;

const C = {
	reset: useColor ? "\x1b[0m" : "",
	dim: useColor ? "\x1b[2m" : "",
	bold: useColor ? "\x1b[1m" : "",
	cyan: useColor ? "\x1b[36m" : "",
	green: useColor ? "\x1b[32m" : "",
	yellow: useColor ? "\x1b[33m" : "",
	red: useColor ? "\x1b[31m" : "",
	magenta: useColor ? "\x1b[35m" : ""
};

export const color = C;

function statusColor(status: number): string {
	if (status >= 500) return C.red;
	if (status >= 400) return C.yellow;
	if (status >= 300) return C.cyan;
	return C.green;
}

export function logAccess(method: string, path: string, status: number, ms: number): void {
	const t = new Date().toISOString().slice(11, 19);
	const m = method.padEnd(6);
	const p = path.length > 48 ? path.slice(0, 47) + "…" : path.padEnd(48);
	const sc = statusColor(status);
	console.log(`${C.dim}${t}${C.reset}  ${C.bold}${m}${C.reset} ${p} ${sc}${status}${C.reset} ${C.dim}${ms}ms${C.reset}`);
}

function clock(): string {
	const d = new Date();
	const p = (n: number, l = 2) => String(n).padStart(l, "0");
	return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

export function logReq(msg: string): void {
	console.log(`${C.dim}${clock()}${C.reset}  ${C.green}INFO${C.reset} ${C.cyan}gemini${C.reset}: [REQ] ${msg}`);
}

export function logFin(status: number, ms: number): void {
	const sc = statusColor(status);
	console.log(
		`${C.dim}${clock()}${C.reset}  ${C.green}INFO${C.reset} ${C.cyan}gemini${C.reset}: ` +
			`[FIN] ${sc}${status}${C.reset}, elapsed: ${(ms / 1000).toFixed(3)}s`
	);
}

export function logInfo(...args: unknown[]): void {
	if (debugEnabled) console.log(...args);
}

export function logWarn(...args: unknown[]): void {
	console.warn(...args);
}

export function logError(...args: unknown[]): void {
	console.error(...args);
}
