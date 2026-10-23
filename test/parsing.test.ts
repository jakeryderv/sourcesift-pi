import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Page } from "../src/http.ts";
import { discoverFeeds, parseArticle, parseFeed, plainText, timestamp } from "../src/parsing.ts";
import { RetrievalError } from "../src/urls.ts";

function page(body: string, url = "https://example.com/feed.xml", contentType = "application/xml"): Page {
	return {
		requestedUrl: url,
		url,
		body: Buffer.from(body, "utf8"),
		contentType,
		fetchedAt: new Date("2026-10-23T12:00:00Z"),
	};
}

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel><title>Example</title>
<item><title><![CDATA[First &amp; <b>bold</b>]]></title><link>/stories/1?utm_source=rss</link>
  <description><![CDATA[<p>Summary <script>alert(1)</script>one</p>]]></description>
  <pubDate>Fri, 23 Oct 2026 10:00:00 GMT</pubDate><dc:creator>Ann Author</dc:creator></item>
<item><title>No link</title><description>skipped</description></item>
<item><title>Undated</title><link>https://example.com/stories/2</link><description>two</description></item>
<item><title>Zone-less</title><link>https://example.com/stories/3</link><pubDate>2026-10-23 09:00:00</pubDate></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title>
<entry><title>Entry</title><link href="https://example.com/a/1"/>
  <published>2026-10-22T08:00:00Z</published><updated>2026-10-23T09:30:00+02:00</updated>
  <summary>Atom summary</summary></entry>
<entry><title>Updated only</title><link href="https://example.com/a/2"/>
  <updated>2026-10-23T07:00:00Z</updated><content type="html">&lt;p&gt;Body&lt;/p&gt;</content></entry>
</feed>`;

describe("timestamp", () => {
	it("parses zoned ISO and RFC 2822 values to UTC", () => {
		assert.equal(timestamp("2026-10-23T09:30:00+02:00")?.toISOString(), "2026-10-23T07:30:00.000Z");
		assert.equal(timestamp("Fri, 23 Oct 2026 10:00:00 GMT")?.toISOString(), "2026-10-23T10:00:00.000Z");
		assert.equal(timestamp("Fri, 23 Oct 2026 06:00:00 -0400")?.toISOString(), "2026-10-23T10:00:00.000Z");
		assert.equal(timestamp("Fri, 23 Oct 2026 05:00:00 EST")?.toISOString(), "2026-10-23T10:00:00.000Z");
	});

	it("treats zone-less, empty, and garbage values as unknown", () => {
		assert.equal(timestamp("2026-10-23T09:30:00"), null);
		assert.equal(timestamp("2026-10-23"), null);
		assert.equal(timestamp("yesterday"), null);
		assert.equal(timestamp(""), null);
		assert.equal(timestamp(undefined), null);
		assert.equal(timestamp(12), null);
	});
});

describe("plainText", () => {
	it("strips markup and executable text and collapses whitespace", () => {
		assert.equal(plainText("<p>Hello <script>evil()</script> <b>world</b></p>\n\n  again"), "Hello world again");
		assert.equal(plainText("plain   text"), "plain text");
		assert.equal(plainText(""), "");
	});
});

describe("parseFeed", () => {
	it("parses RSS items with resolved links, clean text, dates, and authors", async () => {
		const { items, malformed } = await parseFeed(page(RSS));
		assert.equal(malformed, false);
		assert.deepEqual(
			items.map((item) => item.url),
			["https://example.com/stories/1", "https://example.com/stories/2", "https://example.com/stories/3"],
		);
		const [first, undated, zoneless] = items;
		assert.equal(first.title, "First & bold");
		assert.equal(first.text, "Summary one");
		assert.equal(first.author, "Ann Author");
		assert.equal(first.publishedAt?.toISOString(), "2026-10-23T10:00:00.000Z");
		assert.equal(first.updatedAt, null);
		assert.equal(undated.publishedAt, null);
		assert.equal(undated.text, "two");
		assert.equal(zoneless.publishedAt, null);
		assert.equal(zoneless.text, "Zone-less", "falls back to the title when there is no summary");
	});

	it("keeps Atom published and updated dates distinct", async () => {
		const { items } = await parseFeed(page(ATOM));
		assert.equal(items[0].publishedAt?.toISOString(), "2026-10-22T08:00:00.000Z");
		assert.equal(items[0].updatedAt?.toISOString(), "2026-10-23T07:30:00.000Z");
		assert.equal(items[0].text, "Atom summary");
		assert.equal(items[1].publishedAt, null);
		assert.equal(items[1].updatedAt?.toISOString(), "2026-10-23T07:00:00.000Z");
		assert.equal(items[1].text, "Body");
	});

	it("reports malformed XML without throwing", async () => {
		const { items, malformed } = await parseFeed(page("<rss><channel><item><title>x"));
		assert.equal(malformed, true);
		assert.deepEqual(items, []);
	});
});

describe("discoverFeeds", () => {
	it("finds declared RSS and Atom links, resolves and dedupes them, and caps at four", () => {
		const html = `<html><head>
			<link rel="alternate" type="application/rss+xml" href="/feed.xml">
			<link rel="alternate" type="application/atom+xml" href="https://example.com/atom.xml">
			<link rel="alternate" type="application/rss+xml" href="/feed.xml?utm_source=site">
			<link rel="stylesheet" href="/style.css">
			<link rel="alternate" type="text/html" href="/other">
			<link rel="alternate" type="application/rss+xml" href="/f3"><link rel="alternate" type="application/rss+xml" href="/f4">
			<link rel="alternate" type="application/rss+xml" href="/f5">
		</head></html>`;
		const feeds = discoverFeeds(page(html, "https://example.com/", "text/html"));
		assert.deepEqual(feeds, [
			"https://example.com/feed.xml",
			"https://example.com/atom.xml",
			"https://example.com/f3",
			"https://example.com/f4",
		]);
	});
});

describe("parseArticle", () => {
	const body = "Paragraph one of the article body which is long enough to count as real text. ".repeat(3);
	const html = `<!doctype html><html><head><title>Head title</title>
		<meta property="og:title" content="OG title">
		<meta name="author" content="Bea Byline">
		<meta property="article:published_time" content="2026-10-23T08:00:00Z">
		<meta property="article:modified_time" content="2026-10-23T09:00:00Z">
		</head><body><nav>menu menu</nav><article><h1>OG title</h1><p>${body}</p><p>${body}</p></article></body></html>`;

	it("extracts text and explicit metadata", () => {
		const item = parseArticle(page(html, "https://example.com/story", "text/html; charset=utf-8"), 10_000);
		assert.equal(item.title, "OG title");
		assert.equal(item.author, "Bea Byline");
		assert.equal(item.publishedAt?.toISOString(), "2026-10-23T08:00:00.000Z");
		assert.equal(item.updatedAt?.toISOString(), "2026-10-23T09:00:00.000Z");
		assert.ok(item.text.includes("Paragraph one of the article body"));
		assert.ok(!item.text.includes("menu menu"));
	});

	it("keeps one character beyond the limit so callers can detect truncation", () => {
		const item = parseArticle(page(html, "https://example.com/story", "text/html"), 50);
		assert.equal(item.text.length, 51);
	});

	it("rejects non-HTML and pages without usable text", () => {
		assert.throws(() => parseArticle(page("{}", "https://example.com/x", "application/json"), 1000), RetrievalError);
		assert.throws(
			() => parseArticle(page("<html><body><p>short</p></body></html>", "https://example.com/x", "text/html"), 1000),
			RetrievalError,
		);
	});
});
