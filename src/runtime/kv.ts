import { NodeKV } from "./node-kv";
import { runtimeHome } from "./config";

export interface KVPutOptions {
	expirationTtl?: number;
	expiration?: number;
}

export interface KV {
	get(key: string): Promise<string | null>;
	get(key: string, type: "text"): Promise<string | null>;
	get(key: string, type: "json"): Promise<unknown>;
	put(key: string, value: string, options?: KVPutOptions): Promise<void>;
	delete(key: string): Promise<void>;
}

let instance: KV | null = null;

export function getKV(): KV {
	if (!instance) {
		instance = new NodeKV(runtimeHome());
	}
	return instance;
}

export function setKVForTesting(kv: KV | null): void {
	instance = kv;
}
