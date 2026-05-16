import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { KV, KVPutOptions } from "./kv";

interface Entry {
	v: string;
	e: number | null;
}

export class NodeKV implements KV {
	private file: string;
	private map: Map<string, Entry> | null = null;
	private loading: Promise<void> | null = null;
	private writeChain: Promise<void> = Promise.resolve();
	private dirty = false;
	private flushTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(home: string) {
		this.file = join(home, "kv.json");
	}

	private async ensureLoaded(): Promise<void> {
		if (this.map) return;
		if (!this.loading) {
			this.loading = (async () => {
				const m = new Map<string, Entry>();
				try {
					const raw = await fs.readFile(this.file, "utf8");
					const obj = JSON.parse(raw) as Record<string, Entry>;
					for (const k of Object.keys(obj)) m.set(k, obj[k]);
				} catch {
					m.clear();
				}
				this.map = m;
			})();
		}
		await this.loading;
	}

	private expired(e: Entry): boolean {
		return e.e !== null && Date.now() >= e.e;
	}

	private scheduleFlush(): void {
		this.dirty = true;
		if (this.flushTimer) return;
		this.flushTimer = setTimeout(() => {
			this.flushTimer = null;
			void this.flush();
		}, 25);
	}

	private flush(): Promise<void> {
		if (!this.dirty || !this.map) return this.writeChain;
		this.dirty = false;
		const snapshot = this.map;
		this.writeChain = this.writeChain.then(async () => {
			const obj: Record<string, Entry> = {};
			for (const [k, e] of snapshot) {
				if (!this.expired(e)) obj[k] = e;
			}
			const tmp = this.file + "." + process.pid + "." + Date.now() + ".tmp";
			await fs.mkdir(join(this.file, ".."), { recursive: true, mode: 0o700 });
			await fs.writeFile(tmp, JSON.stringify(obj), { encoding: "utf8", mode: 0o600 });
			await fs.rename(tmp, this.file);
		}).catch((err) => {
			console.error("NodeKV flush failed:", err);
		});
		return this.writeChain;
	}

	async get(key: string, type?: "text" | "json"): Promise<string | null> {
		await this.ensureLoaded();
		const e = this.map!.get(key);
		if (!e) return null;
		if (this.expired(e)) {
			this.map!.delete(key);
			this.scheduleFlush();
			return null;
		}
		if (type === "json") {
			try {
				return JSON.parse(e.v) as never;
			} catch {
				return null as never;
			}
		}
		return e.v;
	}

	async put(key: string, value: string, options?: KVPutOptions): Promise<void> {
		await this.ensureLoaded();
		let expiresAt: number | null = null;
		if (options?.expiration) {
			expiresAt = options.expiration * 1000;
		} else if (options?.expirationTtl) {
			expiresAt = Date.now() + options.expirationTtl * 1000;
		}
		this.map!.set(key, { v: value, e: expiresAt });
		this.scheduleFlush();
		await this.flush();
	}

	async delete(key: string): Promise<void> {
		await this.ensureLoaded();
		if (this.map!.delete(key)) {
			this.scheduleFlush();
			await this.flush();
		}
	}
}
