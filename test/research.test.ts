import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type Config, DEFAULT_LIMITS } from "../src/config.ts";
import { Fetcher, type Page } from "../src/http.ts";
import { citationIds, localMidnight, makeWindow, parseCitation, Research } from "../src/research.ts";
import { type Source, SourceRegistry, validateSource } from "../src/sources.ts";
import { normalizeUrl, RetrievalError } from "../src/urls.ts";

const NOW = new Date("2026-10-23T12:00:00Z");
const FETCHED = new Date("2026-10-23T11:59:00Z");

function config(overrides: Partial<Config["limits"]> = {}): Config {
	return {
		guidancePath: "",
		timezone: "America/Chicago",
		recentDays: 7,
		disabled: [],
		custom: [],
		limits: { ...DEFAULT_LIMITS, maxItemsPerSource: 3, maxArticles: 2, ...overrides },
	};
}

interface Item {
	title: string;
	link: string;
	date?: string;
	text?: string;
}

function rss(items: Item[]): string {
	const body = items
		.map(
			(item) =>
				`<item><title>${item.title}</title><link>${item.link}</link>` +
				`${item.date ? `<pubDate>${item.date}</pubDate>` : ""}` +
				`<description>${item.text ?? `${item.title} summary`}</description></item>`,
		)
		.join("");
	return `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${body}</channel></rss>`;
}

function article(title: string, options: { published?: string } = {}): string {
	const paragraph =
		`${title} full article text that is comfortably longer than the eighty character threshold. `.repeat(3);
	const published = options.published ? `<meta property="article:published_time" content="${options.published}">` : "";
	return `<!doctype html><html><head><title>${title}</title>${published}</head><body><article><p>${paragraph}</p><p>${paragraph}</p></article></body></html>`;
}

function page(url: string, body: string, contentType: string, finalUrl = url): Page {
	return { requestedUrl: url, url: finalUrl, body: Buffer.from(body), contentType, fetchedAt: FETCHED };
}

type Route = Page | Error | (() => Promise<Page>);

class FakeFetcher extends Fetcher {
	readonly routes: Record<string, Route>;
	constructor(routes: Record<string, Route>) {
		super(config().limits);
		this.routes = routes;
	}
	override async get(url: string): Promise<Page> {
		this.requests += 1;
		const route = this.routes[normalizeUrl(url)];
		if (!route) throw new RetrievalError("HTTP 404; content unavailable.");
		if (route instanceof Error) throw route;
		return typeof route === "function" ? route() : route;
	}
}

const alpha: Source = validateSource({
	id: "alpha",
	name: "Alpha Times",
	aliases: ["Alpha"],
	website: "https://alpha.example/",
	feeds: ["https://alpha.example/feed.xml"],
	description: "General news.",
	topics: ["news"],
});
const beta: Source = validateSource({
	id: "beta",
	name: "Beta Wire",
	website: "https://beta.example/",
	feeds: ["https://beta.example/feed.xml"],
	description: "Tech news.",
	topics: ["technology"],
});
const registry = new SourceRegistry([alpha, beta]);

const alphaFeed = rss([
	{ title: "Older", link: "https://alpha.example/older", date: "Tue, 20 Oct 2026 10:00:00 GMT" },
	{ title: "Newest", link: "https://alpha.example/newest?utm_source=rss", date: "Fri, 23 Oct 2026 10:00:00 GMT" },
	{ title: "Middle", link: "https://alpha.example/middle", date: "Thu, 22 Oct 2026 10:00:00 GMT" },
	{ title: "Fourth", link: "https://alpha.example/fourth", date: "Wed, 21 Oct 2026 10:00:00 GMT" },
]);

function build(
	routes: Record<string, Route>,
	prompt = "check news",
	options: { previous?: Map<string, never>; limits?: Partial<Config["limits"]> } = {},
) {
	const fetcher = new FakeFetcher(routes);
	const research = new Research(config(options.limits), registry, fetcher, prompt, {
		now: NOW,
		previous: options.previous,
	});
	return { research, fetcher };
}

describe("windows", () => {
	it("computes a rolling recent window", () => {
		const window = makeWindow("recent", config(), NOW);
		assert.equal(window.start, "2026-10-16T12:00:00.000Z");
		assert.equal(window.end, NOW.toISOString());
		assert.equal(window.timezone, "America/Chicago");
	});

	it("uses local midnight across the DST change", () => {
		const fallBack = new Date("2026-11-01T06:30:00Z"); // 01:30 CDT, the morning clocks go back
		assert.equal(makeWindow("today", config(), fallBack).start, "2026-11-01T05:00:00.000Z");
		assert.equal(makeWindow("this_week", config(), fallBack).start, "2026-10-26T05:00:00.000Z");
		const winter = new Date("2026-01-15T03:00:00Z"); // 21:00 CST the previous evening
		assert.equal(makeWindow("today", config(), winter).start, "2026-01-14T06:00:00.000Z");
		assert.equal(localMidnight(winter, "UTC").toISOString(), "2026-01-15T00:00:00.000Z");
	});

	it("leaves any unbounded", () => {
		assert.equal(makeWindow("any", config(), NOW).start, null);
	});
});

describe("research", () => {
	it("reads a selected feed newest first, caps items, strips tracking, and numbers evidence", async () => {
		const { research, fetcher } = build({
			"https://alpha.example/feed.xml": page("https://alpha.example/feed.xml", alphaFeed, "application/rss+xml"),
		});
		const reply = await research.research(["Alpha"], [], []);
		assert.deepEqual(research.selected, ["alpha"]);
		assert.deepEqual(
			reply.evidence.map((item) => [item.id, item.url]),
			[
				["S1", "https://alpha.example/newest"],
				["S2", "https://alpha.example/middle"],
				["S3", "https://alpha.example/fourth"],
			],
		);
		assert.equal(reply.evidence[0].kind, "feed_summary");
		assert.equal(reply.evidence[0].retrieved_at, FETCHED.toISOString());
		assert.equal(reply.evidence[0].source_id, "alpha");
		assert.ok(reply.limitations.includes("Alpha Times: feed selection is capped at 3 items; coverage is partial."));
		assert.ok(reply.limitations.includes("Only the feed summary was retrieved, not the full article."));
		assert.equal(fetcher.requests, 1);
		assert.equal(research.nextId, 4);
	});

	it("excludes out-of-window and future items and flags undated ones", async () => {
		const feed = rss([
			{ title: "Ancient", link: "https://alpha.example/ancient", date: "Mon, 01 Jun 2026 10:00:00 GMT" },
			{ title: "Future", link: "https://alpha.example/future", date: "Sat, 24 Oct 2026 10:00:00 GMT" },
			{ title: "Undated", link: "https://alpha.example/undated" },
		]);
		const { research } = build({
			"https://alpha.example/feed.xml": page("https://alpha.example/feed.xml", feed, "application/rss+xml"),
		});
		const reply = await research.research(["alpha"], [], []);
		assert.deepEqual(
			reply.evidence.map((item) => item.url),
			["https://alpha.example/undated"],
		);
		assert.ok(reply.evidence[0].limitations.includes("Publication/update date is unknown; freshness is unverified."));
		assert.ok(
			reply.limitations.some((note) => note.startsWith("Entries outside the requested date window were excluded")),
		);
	});

	it("deduplicates repeated URLs and identical content", async () => {
		const feed = rss([
			{ title: "Same", link: "https://alpha.example/same", date: "Fri, 23 Oct 2026 10:00:00 GMT", text: "body" },
			{ title: "Same", link: "https://alpha.example/same", date: "Fri, 23 Oct 2026 10:00:00 GMT", text: "body" },
			{ title: "SAME", link: "https://alpha.example/other", date: "Fri, 23 Oct 2026 09:00:00 GMT", text: "Body" },
			{ title: "Different", link: "https://alpha.example/different", date: "Fri, 23 Oct 2026 08:00:00 GMT", text: "x" },
		]);
		const { research } = build({
			"https://alpha.example/feed.xml": page("https://alpha.example/feed.xml", feed, "application/rss+xml"),
		});
		const reply = await research.research(["alpha"], [], []);
		assert.deepEqual(
			reply.evidence.map((item) => item.url),
			["https://alpha.example/same", "https://alpha.example/different"],
		);
	});

	it("never substitutes for an unknown named publication and skips sources outside the restriction", async () => {
		const routes = {
			"https://alpha.example/feed.xml": page("https://alpha.example/feed.xml", alphaFeed, "application/rss+xml"),
		};
		const unknown = build(routes);
		const reply = await unknown.research.research(["alpha"], [], ["Unregistered Gazette"]);
		assert.equal(reply.evidence.length, 0);
		assert.equal(unknown.fetcher.requests, 0);
		assert.ok(
			reply.limitations.includes(
				"A requested publication is unknown or disabled; no substitute sources were retrieved.",
			),
		);

		const restricted = build(routes);
		const second = await restricted.research.research(["beta", "alpha"], [], ["Alpha Times"]);
		assert.deepEqual(restricted.research.selected, ["alpha"]);
		assert.equal(second.evidence.length, 3);
		assert.ok(second.limitations.includes("A source outside the requested publications was skipped."));
	});

	it("locks the window and constraints for the whole run", async () => {
		const { research, fetcher } = build({
			"https://alpha.example/feed.xml": page("https://alpha.example/feed.xml", alphaFeed, "application/rss+xml"),
		});
		await research.research(["alpha"], [], [], "today");
		const reply = await research.research(["beta"], [], [], "recent");
		assert.equal(fetcher.requests, 1);
		assert.ok(reply.limitations.includes("Source constraints and time window cannot change during a request."));
	});

	it("fetches sources concurrently but numbers evidence in selection order", async () => {
		const betaFeed = rss([
			{ title: "Beta item", link: "https://beta.example/one", date: "Fri, 23 Oct 2026 11:00:00 GMT" },
		]);
		const { research } = build({
			"https://alpha.example/feed.xml": () =>
				new Promise((resolve) =>
					setTimeout(() => resolve(page("https://alpha.example/feed.xml", alphaFeed, "application/rss+xml")), 30),
				),
			"https://beta.example/feed.xml": page("https://beta.example/feed.xml", betaFeed, "application/rss+xml"),
		});
		const reply = await research.research(["alpha", "beta"], [], []);
		assert.deepEqual(
			reply.evidence.map((item) => [item.id, item.source_id]),
			[
				["S1", "alpha"],
				["S2", "alpha"],
				["S3", "alpha"],
				["S4", "beta"],
			],
		);
	});

	it("reports a failed source and still returns the others", async () => {
		const betaFeed = rss([
			{ title: "Beta item", link: "https://beta.example/one", date: "Fri, 23 Oct 2026 11:00:00 GMT" },
		]);
		const { research } = build({
			"https://alpha.example/feed.xml": new RetrievalError("HTTP 503; content unavailable."),
			"https://beta.example/feed.xml": page("https://beta.example/feed.xml", betaFeed, "application/rss+xml"),
		});
		const reply = await research.research(["alpha", "beta"], [], []);
		assert.equal(reply.evidence.length, 1);
		assert.ok(reply.limitations.includes("Alpha Times: HTTP 503; content unavailable."));
	});

	it("enforces the source limit", async () => {
		const { research } = build({}, "check", { limits: { maxSources: 1 } });
		const reply = await research.research(["alpha", "beta"], [], []);
		assert.deepEqual(research.selected, ["alpha"]);
		assert.ok(reply.limitations.includes("Source limit reached; coverage is partial."));
	});
});

describe("direct URLs and articles", () => {
	const url = "https://alpha.example/newest";
	const routes = {
		"https://alpha.example/feed.xml": page("https://alpha.example/feed.xml", alphaFeed, "application/rss+xml"),
		[url]: page(url, article("Newest", { published: "2026-10-23T09:00:00Z" }), "text/html"),
		"https://alpha.example/middle": page(
			"https://alpha.example/middle",
			article("Middle"),
			"text/html",
			"https://syndicated.example/middle",
		),
		"https://alpha.example/fourth": page("https://alpha.example/fourth", article("Fourth"), "text/html"),
	};

	it("reads a direct URL only when it appears in the task", async () => {
		const absent = build(routes, "summarize the news");
		const denied = await absent.research.research([], [url], [], "any");
		assert.equal(denied.evidence.length, 0);
		assert.ok(denied.limitations.includes("Direct URL was not present in the task."));

		const present = build(routes, `Summarize ${url}.`);
		const reply = await present.research.research([], [url], [], "any");
		assert.equal(reply.evidence.length, 1);
		assert.equal(reply.evidence[0].kind, "article");
		assert.equal(reply.evidence[0].published_at, "2026-10-23T09:00:00.000Z");
		assert.equal(reply.evidence[0].source_id, null);
		assert.ok(reply.window?.start === null);

		const named = build(routes, `Summarize ${url} using only Alpha Times.`);
		const refused = await named.research.research([], [url], ["Alpha Times"], "any");
		assert.ok(refused.limitations.includes("Use the named publication's registered feed for a named-only request."));
	});

	it("upgrades a feed summary to an article in place and tracks publisher changes", async () => {
		const { research } = build(routes);
		await research.research(["alpha"], [], []);
		const upgraded = await research.readArticle(url);
		const newest = upgraded.evidence.find((item) => item.url === url);
		assert.equal(newest?.id, "S1");
		assert.equal(newest?.kind, "article");
		assert.equal(newest?.source_id, "alpha");
		assert.ok(newest?.text.includes("Newest full article text"));
		assert.equal(newest?.published_at, "2026-10-23T09:00:00.000Z", "explicit article date wins over the feed date");
		assert.ok(!newest?.limitations.includes("Only the feed summary was retrieved, not the full article."));

		const redirected = await research.readArticle("https://alpha.example/middle");
		const middle = redirected.evidence.find((item) => item.id === "S2");
		assert.equal(middle?.url, "https://syndicated.example/middle");
		assert.equal(middle?.source_id, null);
		assert.ok(
			redirected.limitations.includes(
				"An article redirected to a different publisher; see its final URL and publisher.",
			),
		);

		const limited = await research.readArticle("https://alpha.example/fourth");
		assert.ok(limited.limitations.includes("Article limit reached."));
	});

	it("refuses articles outside the evidence and requires research first", async () => {
		const { research } = build(routes);
		const early = await research.readArticle(url);
		assert.ok(early.limitations.includes("Call research first to establish a window and source constraints."));
		await research.research(["alpha"], [], []);
		const outside = await research.readArticle("https://beta.example/secret");
		assert.ok(outside.limitations.includes("Article URL is outside the retrieved evidence or original task."));
	});

	it("lets a follow-up turn read retained evidence directly", async () => {
		const first = build(routes);
		await first.research.research(["alpha"], [], []);
		const retained = first.research.allEvidence();
		const second = new Research(config(), registry, new FakeFetcher(routes), "read the first one", {
			now: NOW,
			previous: retained,
			nextId: first.research.nextId,
		});
		const reply = await second.readArticle(url);
		assert.equal(reply.window?.label, "any");
		assert.equal(reply.evidence[0].id, "S1");
		assert.equal(reply.evidence[0].kind, "article");
		assert.equal(second.allEvidence().size, 3);
		assert.equal(second.references("See [S1] and [S3].").length, 2);
	});
});

describe("citations", () => {
	it("returns references in first-citation order without text and ignores unknown IDs", async () => {
		const { research } = build({
			"https://alpha.example/feed.xml": page("https://alpha.example/feed.xml", alphaFeed, "application/rss+xml"),
		});
		await research.research(["alpha"], [], []);
		const references = research.references("Second [S2] then first [S1] again [S2] and bogus [S9].");
		assert.deepEqual(
			references.map((reference) => reference.id),
			["S2", "S1"],
		);
		assert.ok(!("text" in references[0]));
	});

	it("parses citation IDs and user-typed forms", () => {
		assert.deepEqual(citationIds("[S3] x [S1] y [S3]"), ["S3", "S1"]);
		assert.equal(parseCitation("S4"), "S4");
		assert.equal(parseCitation("[S4]"), "S4");
		assert.equal(parseCitation(" 4 "), "S4");
		assert.equal(parseCitation("s04"), "S04");
		assert.equal(parseCitation("four"), undefined);
	});
});
