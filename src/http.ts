/** Small HTTP adapter: bounded bodies, manual redirects, robots, public-address checks. */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import robotsParserModule from "robots-parser";

interface RobotsPolicy {
	isAllowed(url: string, userAgent?: string): boolean | undefined;
}
const robotsParser = robotsParserModule as unknown as (url: string, contents: string) => RobotsPolicy;

import type { Limits } from "./config.ts";
import { hostname, isGlobalAddress, normalizeUrl, RetrievalError } from "./urls.ts";

// Some CDNs (NPR via Akamai, observed 2026-10-23) stall requests whose agent string contains a URL.
export const USER_AGENT = "SourceSift/0.6";
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export interface Page {
	requestedUrl: string;
	url: string;
	body: Buffer;
	contentType: string;
}

/** Resolve once and reject any non-public answer. The connection is not pinned (spike). */
async function assertPublicHost(host: string): Promise<void> {
	const literal = host.startsWith("[") ? host.slice(1, -1) : host;
	if (isIP(literal)) return; // validated by normalizeUrl
	let answers: { address: string }[];
	try {
		answers = await lookup(host, { all: true });
	} catch {
		throw new RetrievalError("Hostname could not be resolved.");
	}
	if (!answers.length || answers.some((answer) => !isGlobalAddress(answer.address))) {
		throw new RetrievalError("Non-public network addresses are not accessible.");
	}
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
	private readonly robots = new Map<string, RobotsPolicy>();

	constructor(limits: Limits) {
		this.limits = limits;
	}

	/** Fetch public content with one timeout covering DNS, redirects, and body. */
	async get(url: string, options: { robots?: boolean } = {}): Promise<Page> {
		const signal = AbortSignal.timeout(this.limits.httpTimeoutSeconds * 1000);
		try {
			return await this.fetch(url, options.robots ?? true, signal);
		} catch (error) {
			if (error instanceof RetrievalError) throw error;
			throw new RetrievalError("HTTP request failed or timed out.", { cause: error });
		}
	}

	private async fetch(url: string, robots: boolean, signal: AbortSignal): Promise<Page> {
		const requested = normalizeUrl(url);
		let current = requested;
		for (let hop = 0; hop < 5; hop++) {
			if (robots) await this.checkRobots(current, signal);
			if (this.requests >= this.limits.maxHttpRequests) throw new RetrievalError("HTTP request limit reached.");
			await assertPublicHost(hostname(current));
			this.requests += 1;
			const response = await fetch(current, {
				redirect: "manual",
				signal,
				credentials: "omit",
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
				return { requestedUrl: requested, url: current, body: Buffer.alloc(0), contentType: "text/plain" };
			}
			if (response.status !== 200) {
				await response.body?.cancel();
				throw new RetrievalError(`HTTP ${response.status}; content unavailable.`);
			}
			const body = await readBounded(response, this.limits.maxResponseBytes);
			return { requestedUrl: requested, url: current, body, contentType: response.headers.get("content-type") ?? "" };
		}
		throw new RetrievalError("Redirect limit reached.");
	}

	private async checkRobots(url: string, signal: AbortSignal): Promise<void> {
		const origin = new URL(url).origin;
		let policy = this.robots.get(origin);
		if (!policy) {
			const page = await this.fetch(`${origin}/robots.txt`, false, signal);
			policy = robotsParser(`${origin}/robots.txt`, page.body.toString("utf8"));
			this.robots.set(origin, policy);
		}
		if (policy.isAllowed(url, "SourceSift") === false) {
			throw new RetrievalError("Publisher robots policy disallows retrieval.");
		}
	}
}
