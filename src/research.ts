/** Per-run retrieval state: source constraints, evidence, freshness, and budgets. */

import { createHash } from "node:crypto";

import type { Config } from "./config.ts";
import type { Fetcher, Page } from "./http.ts";
import { discoverFeeds, type ParsedItem, parseArticle, parseFeed } from "./parsing.ts";
import type { Source, SourceRegistry } from "./sources.ts";
import { hostname, normalizeUrl, RetrievalError } from "./urls.ts";

export type WindowName = "recent" | "today" | "this_week" | "any";
export const WINDOW_NAMES: WindowName[] = ["recent", "today", "this_week", "any"];
export const CITATION = /\[S(\d+)\]/g;

export interface ResearchWindow {
	label: WindowName;
	timezone: string;
	start: string | null;
	end: string;
}

/** Retrieved evidence behind one citation; URLs and dates come from adapters. */
export interface Reference {
	id: string;
	title: string;
	url: string;
	requested_url: string;
	retrieved_from: string;
	publisher: string;
	source_id: string | null;
	author: string | null;
	published_at: string | null;
	updated_at: string | null;
	retrieved_at: string;
	kind: "feed_summary" | "article";
	limitations: string[];
}

export interface Evidence extends Reference {
	text: string;
}

export interface Reply {
	window: ResearchWindow | null;
	evidence: Evidence[];
	limitations: string[];
}

interface ZoneParts {
	year: number;
	month: number;
	day: number;
	weekday: number;
}

function zoneParts(date: Date, timeZone: string): ZoneParts {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })
			.formatToParts(date)
			.map((part) => [part.type, part.value]),
	);
	return {
		year: Number(parts.year),
		month: Number(parts.month),
		day: Number(parts.day),
		weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday),
	};
}

function zoneOffsetMs(date: Date, timeZone: string): number {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-US", {
			timeZone,
			hourCycle: "h23",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		})
			.formatToParts(date)
			.map((part) => [part.type, part.value]),
	);
	const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
	return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Local midnight for the calendar day `daysBack` before now in the zone, as a UTC instant. */
export function localMidnight(now: Date, timeZone: string, daysBack = 0): Date {
	const local = zoneParts(now, timeZone);
	const naive = Date.UTC(local.year, local.month - 1, local.day - daysBack);
	let guess = new Date(naive - zoneOffsetMs(new Date(naive), timeZone));
	guess = new Date(naive - zoneOffsetMs(guess, timeZone));
	return guess;
}

/** Today/week use local midnight (Monday for week); recent is a rolling window. */
export function makeWindow(label: WindowName, config: Config, now: Date): ResearchWindow {
	let start: Date | null = null;
	if (label === "recent") {
		start = new Date(now.getTime() - config.recentDays * 86_400_000);
	} else if (label === "today") {
		start = localMidnight(now, config.timezone);
	} else if (label === "this_week") {
		const weekday = zoneParts(now, config.timezone).weekday;
		start = localMidnight(now, config.timezone, (weekday + 6) % 7);
	}
	return { label, timezone: config.timezone, start: start ? start.toISOString() : null, end: now.toISOString() };
}

function unique(values: Iterable<string>): string[] {
	return [...new Set(values)];
}

interface FeedPage {
	page: Page;
	items: ParsedItem[];
	malformed: boolean;
}

/** Bounded shared tool implementation, independent of the agent framework. */
export class Research {
	readonly now: Date;
	window: ResearchWindow | null = null;
	readonly selected: string[] = [];
	readonly evidence = new Map<string, Evidence>();
	readonly previous: Map<string, Evidence>;
	readonly allowed = new Set<string>();
	readonly direct = new Set<string>();
	only: string[] | null = null;
	attempted = false;
	articles = 0;
	private readonly config: Config;
	private readonly registry: SourceRegistry;
	private readonly fetcher: Fetcher;
	private readonly notes: string[] = [];
	private readonly read = new Set<string>();
	private nextIdValue: number;
	private readonly fingerprints = new Map<string, string>();

	constructor(
		config: Config,
		registry: SourceRegistry,
		fetcher: Fetcher,
		prompt: string,
		options: { now?: Date; previous?: Map<string, Evidence>; nextId?: number } = {},
	) {
		this.config = config;
		this.registry = registry;
		this.fetcher = fetcher;
		this.now = options.now ?? new Date();
		this.previous = new Map(options.previous ?? []);
		this.nextIdValue = options.nextId ?? 1;
		for (const match of prompt.matchAll(/https?:\/\/[^\s<>"']+/g)) {
			try {
				this.direct.add(normalizeUrl(match[0].replace(/[.,;:!?)\]}]+$/, "")));
			} catch {
				// not a usable URL
			}
		}
		for (const url of this.direct) this.allowed.add(url);
		for (const url of this.previous.keys()) this.allowed.add(url);
	}

	/** Current evidence supersedes earlier snapshots with the same identity. */
	allEvidence(): Map<string, Evidence> {
		return new Map([...this.previous, ...this.evidence]);
	}

	get nextId(): number {
		return this.nextIdValue;
	}

	get httpRequests(): number {
		return this.fetcher.requests;
	}

	note(text: string): void {
		if (!this.notes.includes(text)) this.notes.push(text);
	}

	/** Combine run-wide gaps with limitations of the evidence actually cited. */
	limitationsFor(references: Reference[]): string[] {
		const notes = [...this.notes];
		if (this.attempted && this.evidence.size === 0) {
			notes.push("No usable evidence was retrieved for this window; current reporting could not be verified.");
		}
		for (const reference of references) notes.push(...reference.limitations);
		return unique(notes);
	}

	get limitations(): string[] {
		return this.limitationsFor([...this.evidence.values()]);
	}

	private reply(): Reply {
		return { window: this.window, evidence: [...this.evidence.values()], limitations: this.limitations };
	}

	async research(
		sourceIds: string[],
		directUrls: string[],
		onlySources: string[],
		window: WindowName = "recent",
	): Promise<Reply> {
		this.attempted = true;
		if (this.window === null) {
			this.window = makeWindow(window, this.config, this.now);
			this.only = [...onlySources];
		} else if (window !== this.window.label || onlySources.join("\n") !== (this.only ?? []).join("\n")) {
			this.note("Source constraints and time window cannot change during a request.");
			return this.reply();
		}
		const resolvedOnly = (this.only ?? []).map((name) => this.registry.resolve(name));
		if (resolvedOnly.some((source) => source === undefined)) {
			this.note("A requested publication is unknown or disabled; no substitute sources were retrieved.");
			return this.reply();
		}
		const allowedIds = new Set(resolvedOnly.map((source) => (source as Source).id));
		const chosen: Source[] = [];
		for (const name of sourceIds) {
			const source = this.registry.resolve(name);
			if (!source) {
				this.note("A selected source is unknown or disabled.");
				continue;
			}
			if (this.only?.length && !allowedIds.has(source.id)) {
				this.note("A source outside the requested publications was skipped.");
				continue;
			}
			if (this.selected.includes(source.id)) continue;
			if (this.selected.length >= this.config.limits.maxSources) {
				this.note("Source limit reached; coverage is partial.");
				break;
			}
			this.selected.push(source.id);
			chosen.push(source);
		}
		// Fetch sources concurrently, then ingest in selection order so citation IDs are deterministic.
		const fetched = await Promise.all(
			chosen.map(async (source) => {
				try {
					return { source, pages: await this.fetchSource(source) };
				} catch (error) {
					this.note(`${source.name}: ${messageOf(error)}`);
					return { source, pages: [] as FeedPage[] };
				}
			}),
		);
		for (const { source, pages } of fetched) this.ingestSource(source, pages);
		for (const url of directUrls.slice(0, this.config.limits.maxArticles)) {
			try {
				const normalized = normalizeUrl(url);
				if (!this.direct.has(normalized)) throw new RetrievalError("Direct URL was not present in the task.");
				if (this.only?.length) {
					throw new RetrievalError("Use the named publication's registered feed for a named-only request.");
				}
				await this.readArticleUrl(normalized);
			} catch (error) {
				this.note(messageOf(error));
			}
		}
		if (directUrls.length > this.config.limits.maxArticles) this.note("Article limit reached; coverage is partial.");
		return this.reply();
	}

	async readArticle(url: string): Promise<Reply> {
		this.attempted = true;
		try {
			if (this.window === null) {
				if (!this.previous.has(normalizeUrl(url))) {
					throw new RetrievalError("Call research first to establish a window and source constraints.");
				}
				this.window = makeWindow("any", this.config, this.now);
				this.only = [];
			}
			const normalized = normalizeUrl(url);
			if (!this.allowed.has(normalized) || (this.only?.length && !this.evidence.has(normalized))) {
				throw new RetrievalError("Article URL is outside the retrieved evidence or original task.");
			}
			await this.readArticleUrl(normalized);
		} catch (error) {
			this.note(messageOf(error));
		}
		return this.reply();
	}

	/** Network half of reading a source: feed discovery and page fetches, no evidence mutation. */
	private async fetchSource(source: Source): Promise<FeedPage[]> {
		if (!source.capabilities.includes("feed")) throw new RetrievalError("This source does not offer feed access.");
		let feeds = source.feeds;
		if (!feeds.length) {
			feeds = discoverFeeds(await this.fetcher.get(source.website, { cache: true }));
			if (!feeds.length) throw new RetrievalError("No RSS/Atom feed was declared by the website.");
		}
		const pages: FeedPage[] = [];
		for (const url of feeds) {
			try {
				const page = await this.fetcher.get(url, { cache: true });
				const { items, malformed } = await parseFeed(page);
				pages.push({ page, items, malformed });
			} catch (error) {
				this.note(`${source.name}: ${messageOf(error)}`);
			}
		}
		return pages;
	}

	/** Deterministic half: window filtering, caps, dedup, and citation IDs in selection order. */
	private ingestSource(source: Source, pages: FeedPage[]): void {
		let count = 0;
		for (const { page, items, malformed } of pages) {
			if (malformed) this.note(`${source.name}: feed is malformed; only usable entries were considered.`);
			if (!items.length) this.note(`${source.name}: feed contained no usable entries.`);
			const ordered = [...items].sort((a, b) => dateValue(b) - dateValue(a));
			for (const item of ordered) {
				if (this.add(item, page, source.id, "feed_summary")) count += 1;
				if (count >= this.config.limits.maxItemsPerSource) {
					this.note(`${source.name}: feed selection is capped at ${count} items; coverage is partial.`);
					return;
				}
			}
		}
	}

	private async readArticleUrl(url: string): Promise<void> {
		if (this.read.has(url)) return;
		if (this.articles >= this.config.limits.maxArticles) throw new RetrievalError("Article limit reached.");
		const known = this.allEvidence().get(url);
		const source = known?.source_id ? this.registry.resolve(known.source_id) : undefined;
		if (source && !source.capabilities.includes("article")) {
			throw new RetrievalError("This source does not offer article access.");
		}
		this.articles += 1;
		this.read.add(url);
		const page = await this.fetcher.get(url);
		let item = parseArticle(page, this.config.limits.maxItemChars);
		const previous = this.allEvidence().get(url);
		if (previous) {
			item = {
				...item,
				author: item.author ?? previous.author,
				publishedAt: item.publishedAt ?? (previous.published_at ? new Date(previous.published_at) : null),
				updatedAt: item.updatedAt ?? (previous.updated_at ? new Date(previous.updated_at) : null),
			};
		}
		let sourceId = previous?.source_id ?? null;
		if (hostname(page.url).replace(/^www\./, "") !== hostname(url).replace(/^www\./, "")) {
			sourceId = null;
			this.note("An article redirected to a different publisher; see its final URL and publisher.");
		}
		this.add(item, page, sourceId, "article", previous ? url : null);
	}

	private drop(url: string): void {
		this.evidence.delete(url);
		this.previous.delete(url);
		this.fingerprints.delete(url);
	}

	private add(
		item: ParsedItem,
		page: Page,
		sourceId: string | null,
		kind: Reference["kind"],
		replacing: string | null = null,
	): boolean {
		if (!this.window) throw new Error("window is not set");
		const date = item.publishedAt ?? item.updatedAt;
		if (
			date &&
			(date.toISOString() > this.window.end || (this.window.start !== null && date.toISOString() < this.window.start))
		) {
			this.note("Entries outside the requested date window were excluded; feeds do not provide archive search.");
			if (replacing) this.drop(replacing);
			return false;
		}
		const all = this.allEvidence();
		const existing = all.get(item.url) ?? all.get(replacing ?? item.url);
		if (this.evidence.has(item.url) && kind === "feed_summary") return false;
		const digest = createHash("sha256")
			.update(`${item.title} ${item.text}`.toLowerCase().split(/\s+/).join(" "))
			.digest("hex");
		for (const [url, value] of this.fingerprints) {
			if (value === digest && url !== item.url && url !== replacing) return false;
		}
		if (replacing && replacing !== item.url) this.drop(replacing);
		const limits = this.config.limits;
		if (!this.evidence.has(item.url) && this.evidence.size >= limits.maxItems) {
			this.note("Evidence item limit reached; coverage is partial.");
			return false;
		}
		let used = 0;
		for (const value of this.evidence.values()) if (value !== existing) used += value.text.length;
		const remaining = limits.maxEvidenceChars - used;
		if (remaining <= 0) {
			this.note("Evidence text limit reached; coverage is partial.");
			return false;
		}
		const text = item.text.slice(0, Math.min(limits.maxItemChars, remaining));
		const warnings: string[] = [];
		if (!date) warnings.push("Publication/update date is unknown; freshness is unverified.");
		else if (!item.publishedAt)
			warnings.push("Only an update date is available; original publication date is unknown.");
		if (text.length < item.text.length) warnings.push("Evidence text was truncated to the configured limit.");
		if (kind === "feed_summary") warnings.push("Only the feed summary was retrieved, not the full article.");
		const reference: Evidence = {
			id: existing ? existing.id : `S${this.nextIdValue}`,
			title: item.title,
			url: item.url,
			requested_url: page.requestedUrl,
			retrieved_from: page.url,
			publisher: hostname(item.url),
			source_id: sourceId,
			author: item.author,
			published_at: item.publishedAt ? item.publishedAt.toISOString() : null,
			updated_at: item.updatedAt ? item.updatedAt.toISOString() : null,
			retrieved_at: page.fetchedAt.toISOString(),
			kind,
			limitations: warnings,
			text,
		};
		if (replacing) this.evidence.delete(replacing);
		if (!existing) this.nextIdValue += 1;
		this.fingerprints.set(item.url, digest);
		this.evidence.set(item.url, reference);
		this.allowed.add(item.url);
		return true;
	}

	/** Cited references in first-citation order, never fabricated URLs. */
	references(answer: string): Reference[] {
		const byId = new Map([...this.allEvidence().values()].map((item) => [item.id, item]));
		const references: Reference[] = [];
		for (const id of citationIds(answer)) {
			const item = byId.get(id);
			if (!item) continue;
			const { text: _text, ...reference } = item;
			references.push(reference);
		}
		return references;
	}
}

/** Unique citation IDs in first-appearance order. */
export function citationIds(answer: string): string[] {
	return unique([...answer.matchAll(CITATION)].map((match) => `S${match[1]}`));
}

/** Normalize a user-typed citation such as "S4", "[S4]", or "4" to an evidence ID. */
export function parseCitation(value: string): string | undefined {
	const match = value.trim().match(/^\[?S?(\d+)\]?$/i);
	return match ? `S${match[1]}` : undefined;
}

function dateValue(item: ParsedItem): number {
	return (item.publishedAt ?? item.updatedAt)?.getTime() ?? Number.NEGATIVE_INFINITY;
}

function messageOf(error: unknown): string {
	return error instanceof RetrievalError ? error.message : "Retrieval failed.";
}
