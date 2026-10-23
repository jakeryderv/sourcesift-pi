/** Small HTTP adapter: bounded bodies, manual redirects, robots, pinned public addresses. */

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

import robotsParserModule from "robots-parser";
import { Agent, fetch, type Response } from "undici";

import type { Limits } from "./config.ts";
import { hostname, isGlobalAddress, normalizeUrl, RetrievalError } from "./urls.ts";

interface RobotsPolicy {
	isAllowed(url: string, userAgent?: string): boolean | undefined;
}
const robotsParser = robotsParserModule as unknown as (url: string, contents: string) => RobotsPolicy;

// Some CDNs (NPR via Akamai, observed 2026-10-23) stall requests whose agent string contains a URL.
export const USER_AGENT = "SourceSift/0.6";
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export interface Page {
	requestedUrl: string;
	url: string;
	body: Buffer;
	contentType: string;
	/** When the bytes were actually fetched; earlier than now for cached pages. */
	fetchedAt: Date;
}

/** Resolve a hostname once, reject any non-public answer, and connect to that exact address. */
function pinnedLookup(host: string, options: { all?: boolean }, callback: (...args: never[]) => void): void {
	const done = callback as (error: Error | null, address?: unknown, family?: number) => void;
	dnsLookup(host, { all: true })
		.then((answers) => {
			if (!answers.length || answers.some((answer) => !isGlobalAddress(answer.address))) {
				throw new RetrievalError("Non-public network addresses are not accessible.");
			}
			// Prefer IPv4 where a site advertises IPv6 but the user's network lacks it.
			const chosen = answers.find((answer) => answer.family === 4) ?? answers[0];
			if (options.all) done(null, [chosen]);
			else done(null, chosen.address, chosen.family);
		})
		.catch((error: unknown) => {
			done(error instanceof RetrievalError ? error : new RetrievalError("Hostname could not be resolved."));
		});
}

let agent: Agent | undefined;

/** Shared dispatcher: every new connection goes through the pinned lookup; no proxies, no cookies. */
function dispatcher(): Agent {
	agent ??= new Agent({
		connect: { lookup: pinnedLookup, timeout: 10_000 },
		keepAliveTimeout: 4_000,
	});
	return agent;
}

/** Session-scoped page cache so follow-up turns do not refetch unchanged feeds. */
export class PageCache {
	private readonly pages = new Map<string, Page>();
	private readonly ttlMs: number;

	constructor(ttlSeconds: number) {
		this.ttlMs = ttlSeconds * 1000;
	}

	get(url: string): Page | undefined {
		const page = this.pages.get(url);
		if (!page) return undefined;
		if (Date.now() - page.fetchedAt.getTime() > this.ttlMs) {
			this.pages.delete(url);
			return undefined;
		}
		return page;
	}

	set(url: string, page: Page): void {
		this.pages.set(url, page);
	}

	clear(): void {
		this.pages.clear();
	}
}

/** Surface a RetrievalError raised inside the connector (for example a pinned-lookup rejection). */
function retrievalFailure(error: unknown): RetrievalError {
	let cause: unknown = error;
	for (let depth = 0; depth < 4 && cause; depth++) {
		if (cause instanceof RetrievalError) return cause;
		cause = (cause as { cause?: unknown }).cause;
	}
	return new RetrievalError("HTTP request failed or timed out.", { cause: error });
}

async function readBounded(response: Response, max: number): Promise<Buffer> {
	if (!response.body) return Buffer.alloc(0);
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > max) {
			await reader.cancel();
			throw new RetrievalError("Response exceeds the byte limit.");
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks);
}

/** One run's HTTP budget and robots cache. No cookies, auth, retries, or proxies. */
export class Fetcher {
	requests = 0;
	private readonly limits: Limits;
	private readonly cache: PageCache | undefined;
	private readonly robots = new Map<string, Promise<RobotsPolicy>>();

	constructor(limits: Limits, cache?: PageCache) {
		this.limits = limits;
		this.cache = cache;
	}

	/** Fetch public content with one timeout covering DNS, redirects, and body. */
	async get(url: string, options: { robots?: boolean; cache?: boolean } = {}): Promise<Page> {
		const normalized = normalizeUrl(url);
		if (options.cache && this.cache) {
			const cached = this.cache.get(normalized);
			if (cached) return cached;
		}
		const signal = AbortSignal.timeout(this.limits.httpTimeoutSeconds * 1000);
		let page: Page;
		try {
			page = await this.fetch(normalized, options.robots ?? true, signal);
		} catch (error) {
			throw retrievalFailure(error);
		}
		if (options.cache && this.cache) this.cache.set(normalized, page);
		return page;
	}

	private async fetch(url: string, robots: boolean, signal: AbortSignal): Promise<Page> {
		const requested = normalizeUrl(url);
		let current = requested;
		for (let hop = 0; hop < 5; hop++) {
			if (robots) await this.checkRobots(current, signal);
			if (this.requests >= this.limits.maxHttpRequests) throw new RetrievalError("HTTP request limit reached.");
			if (!isIP(hostname(current).replace(/^\[|\]$/g, "")) && !hostname(current)) {
				throw new RetrievalError("URL has no hostname.");
			}
			this.requests += 1;
			const response = await fetch(current, {
				dispatcher: dispatcher(),
				redirect: "manual",
				signal,
				headers: { "user-agent": USER_AGENT, "accept-encoding": "identity" },
			});
			if (REDIRECTS.has(response.status)) {
				const location = response.headers.get("location");
				await response.body?.cancel();
				if (!location) throw new RetrievalError("Redirect has no destination.");
				current = normalizeUrl(new URL(location, current).toString());
				continue;
			}
			if (!robots && (response.status === 404 || response.status === 410)) {
				await response.body?.cancel();
				return {
					requestedUrl: requested,
					url: current,
					body: Buffer.alloc(0),
					contentType: "text/plain",
					fetchedAt: new Date(),
				};
			}
			if (response.status !== 200) {
				await response.body?.cancel();
				throw new RetrievalError(`HTTP ${response.status}; content unavailable.`);
			}
			const body = await readBounded(response, this.limits.maxResponseBytes);
			return {
				requestedUrl: requested,
				url: current,
				body,
				contentType: response.headers.get("content-type") ?? "",
				fetchedAt: new Date(),
			};
		}
		throw new RetrievalError("Redirect limit reached.");
	}

	private async checkRobots(url: string, signal: AbortSignal): Promise<void> {
		const origin = new URL(url).origin;
		let pending = this.robots.get(origin);
		if (!pending) {
			pending = this.fetch(`${origin}/robots.txt`, false, signal).then((page) =>
				robotsParser(`${origin}/robots.txt`, page.body.toString("utf8")),
			);
			this.robots.set(origin, pending);
			pending.catch(() => this.robots.delete(origin));
		}
		const policy = await pending;
		if (policy.isAllowed(url, "SourceSift") === false) {
			throw new RetrievalError("Publisher robots policy disallows retrieval.");
		}
	}
}
