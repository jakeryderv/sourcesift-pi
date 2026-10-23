/** Limits and optional JSON configuration; credentials belong to pi. */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { type Source, validateSource } from "./sources.ts";

export interface Limits {
	maxSources: number;
	maxItems: number;
	maxItemsPerSource: number;
	maxArticles: number;
	maxHttpRequests: number;
	httpTimeoutSeconds: number;
	maxResponseBytes: number;
	maxItemChars: number;
	maxEvidenceChars: number;
}

export interface Config {
	timezone: string;
	recentDays: number;
	disabled: string[];
	custom: Source[];
	limits: Limits;
}

export const DEFAULT_LIMITS: Limits = {
	maxSources: 3,
	maxItems: 18,
	maxItemsPerSource: 6,
	maxArticles: 6,
	maxHttpRequests: 24,
	httpTimeoutSeconds: 10,
	maxResponseBytes: 2 * 1024 * 1024,
	maxItemChars: 10000,
	maxEvidenceChars: 60000,
};

export function defaultConfigPath(): string {
	const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
	return join(base, "sourcesift", "config.json");
}

function validTimezone(value: unknown): string {
	if (typeof value !== "string") throw new Error("timezone must be an IANA zone name");
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: value });
	} catch {
		throw new Error("timezone must be an IANA zone name");
	}
	return value;
}

/** Load defaults, then the optional JSON file at SOURCESIFT_CONFIG or the user path. */
export function loadConfig(path: string | undefined = process.env.SOURCESIFT_CONFIG): Config {
	const selected = path ?? defaultConfigPath();
	let raw: Record<string, unknown> = {};
	try {
		raw = JSON.parse(readFileSync(selected, "utf8")) as Record<string, unknown>;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== "ENOENT" || path !== undefined) {
			throw new Error(`Cannot read SourceSift configuration at ${selected}: ${(error as Error).message}`);
		}
	}
	const limits: Limits = { ...DEFAULT_LIMITS };
	for (const key of Object.keys(DEFAULT_LIMITS) as (keyof Limits)[]) {
		const value = (raw.limits as Record<string, unknown> | undefined)?.[key];
		if (value !== undefined) {
			if (typeof value !== "number" || !(value > 0)) throw new Error(`limits.${key} must be a positive number`);
			limits[key] = value;
		}
	}
	const custom = Array.isArray(raw.custom) ? raw.custom.map((item) => validateSource(item)) : [];
	const disabled = Array.isArray(raw.disabled) ? raw.disabled.map(String) : [];
	return {
		timezone: raw.timezone === undefined ? "UTC" : validTimezone(raw.timezone),
		recentDays: typeof raw.recent_days === "number" ? Math.min(90, Math.max(1, raw.recent_days)) : 7,
		disabled,
		custom,
		limits,
	};
}
