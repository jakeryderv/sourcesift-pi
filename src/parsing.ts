/** Pure feed/HTML parsing of already bounded bytes; no hidden network access. */

import readability from "@mozilla/readability";
import { parseHTML } from "linkedom";
import Parser from "rss-parser";

import type { Page } from "./http.ts";
import { normalizeUrl, RetrievalError } from "./urls.ts";

const { Readability } = readability;

export interface ParsedItem {
	title: string;
	url: string;
	text: string;
	author: string | null;
	publishedAt: Date | null;
	updatedAt: Date | null;
}

/** Strip markup, executable text, and excess whitespace from feed fields. */
export function plainText(value: string | undefined | null): string {
	if (!value) return "";
	if (!/[<&]/.test(value)) return value.split(/\s+/).filter(Boolean).join(" ");
	const { document } = parseHTML(`<!doctype html><html><body>${value}</body></html>`);
	for (const node of document.querySelectorAll("script,style")) node.remove();
	return (document.body?.textContent ?? "").split(/\s+/).filter(Boolean).join(" ");
}

const ISO_ZONED = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;
const RFC_ZONED = /\s(?:Z|UT|GMT|UTC|EST|EDT|CST|CDT|MST|MDT|PST|PDT|[+-]\d{4})$/i;

/** Preserve unknown or zone-less timestamps as unknown rather than guessing their zone. */
export function timestamp(value: unknown): Date | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (!trimmed || !(ISO_ZONED.test(trimmed) || RFC_ZONED.test(trimmed))) return null;
	const date = new Date(trimmed);
	return Number.isNaN(date.getTime()) ? null : date;
}

type FeedItem = Parser.Item & Record<string, unknown>;

function rawField(item: FeedItem, key: string): string | undefined {
	const value = item[key];
	if (typeof value === "string") return value;
	if (value && typeof value === "object" && typeof (value as { _?: unknown })._ === "string") {
		return (value as { _: string })._;
	}
	return undefined;
}

/** Parse RSS/Atom entries; the caller bounds and filters the returned items. */
export async function parseFeed(page: Page): Promise<{ items: ParsedItem[]; malformed: boolean }> {
	const parser = new Parser({ customFields: { item: ["published", "updated", "dc:date"] } });
	let feed: Parser.Output<FeedItem>;
	try {
		feed = (await parser.parseString(page.body.toString("utf8"))) as unknown as Parser.Output<FeedItem>;
	} catch {
		return { items: [], malformed: true };
	}
	const items: ParsedItem[] = [];
	for (const entry of feed.items.slice(0, 200)) {
		if (!entry.link) continue;
		let url: string;
		try {
			url = normalizeUrl(new URL(entry.link, page.url).toString());
		} catch {
			continue;
		}
		const title = plainText(entry.title ?? "Untitled").slice(0, 512);
		const text = plainText(entry.content ?? rawField(entry, "content:encoded") ?? rawField(entry, "summary") ?? entry.contentSnippet);
		const published = rawField(entry, "published");
		const updated = rawField(entry, "updated");
		const atom = published !== undefined || updated !== undefined;
		items.push({
			title,
			url,
			text: text || title,
			author: plainText(entry.creator ?? rawField(entry, "author") ?? "").slice(0, 256) || null,
			publishedAt: timestamp(atom ? published : (entry.pubDate ?? rawField(entry, "dc:date"))),
			updatedAt: timestamp(atom ? updated : undefined),
		});
	}
	return { items, malformed: false };
}

/** Discover at most four unique declared RSS/Atom URLs from an HTML page. */
export function discoverFeeds(page: Page): string[] {
	const { document } = parseHTML(page.body.toString("utf8"));
	const urls: string[] = [];
	for (const link of document.querySelectorAll("link[rel][href]")) {
		const rel = (link.getAttribute("rel") ?? "").toLowerCase().split(/\s+/);
		const type = (link.getAttribute("type") ?? "").toLowerCase();
		if (!rel.includes("alternate") || !["application/rss+xml", "application/atom+xml"].includes(type)) continue;
		try {
			const url = normalizeUrl(new URL(link.getAttribute("href") ?? "", page.url).toString());
			if (!urls.includes(url)) urls.push(url);
		} catch {
			// skip undeclared or invalid links
		}
	}
	return urls.slice(0, 4);
}

/** Extract main HTML text and explicit metadata, without crawling or date guesses. */
export function parseArticle(page: Page, maxChars: number): ParsedItem {
	const head = page.body.subarray(0, 512).toString("utf8").trimStart().toLowerCase();
	if (!page.contentType.toLowerCase().includes("html") && !head.startsWith("<!doctype html") && !head.startsWith("<html")) {
		throw new RetrievalError("Article is not an HTML document.");
	}
	const html = page.body.toString("utf8");
	const { document } = parseHTML(html);
	const meta = new Map<string, string>();
	for (const node of document.querySelectorAll("meta[content]")) {
		const key = (node.getAttribute("property") ?? node.getAttribute("name") ?? "").toLowerCase();
		const content = node.getAttribute("content");
		if (key && content && !meta.has(key)) meta.set(key, content);
	}
	const headTitle = document.querySelector("title")?.textContent ?? "";
	const article = new Readability(parseHTML(html).document as unknown as Document, { charThreshold: 80 }).parse();
	const text = (article?.textContent ?? "")
		.replace(/[ \t ]+/g, " ")
		.replace(/\s*\n\s*/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	if (text.length < 80) throw new RetrievalError("No usable article text; the page may require login or JavaScript.");
	const title = meta.get("og:title") || article?.title || headTitle || "Untitled article";
	return {
		title: plainText(title).slice(0, 512),
		url: page.url,
		text: text.slice(0, maxChars + 1),
		author: plainText(meta.get("author") ?? article?.byline ?? "").slice(0, 256) || null,
		publishedAt: timestamp(meta.get("article:published_time") ?? meta.get("datepublished")),
		updatedAt: timestamp(meta.get("article:modified_time") ?? meta.get("datemodified")),
	};
}
