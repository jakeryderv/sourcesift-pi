/** Source records and an immutable per-session catalog; no plugin discovery. */

import { normalizeUrl, type RetrievalError } from "./urls.ts";

export type Capability = "feed" | "article";

export interface Source {
	id: string;
	name: string;
	website: string;
	description: string;
	feeds: string[];
	topics: string[];
	geography: string;
	language: string;
	aliases: string[];
	capabilities: Capability[];
}

function strings(value: unknown, field: string, max: number): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		throw new Error(`source ${field} must be a list of strings`);
	}
	if (value.length > max) throw new Error(`source ${field} allows at most ${max} entries`);
	return value as string[];
}

/** Validate a source definition from configuration or SDK input. */
export function validateSource(input: unknown): Source {
	const raw = (input ?? {}) as Record<string, unknown>;
	const id = String(raw.id ?? "");
	if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new Error(`invalid source id: ${id || "(empty)"}`);
	const name = String(raw.name ?? "").trim();
	if (!name || name.length > 120) throw new Error(`source ${id}: name is required`);
	const description = String(raw.description ?? "").trim();
	if (!description || description.length > 1200) throw new Error(`source ${id}: description is required`);
	let website: string;
	try {
		website = normalizeUrl(String(raw.website ?? ""));
	} catch (error) {
		throw new Error(`source ${id}: ${(error as RetrievalError).message}`);
	}
	const feeds = strings(raw.feeds, "feeds", 4).map((feed) => {
		try {
			return normalizeUrl(feed);
		} catch (error) {
			throw new Error(`source ${id}: ${(error as RetrievalError).message}`);
		}
	});
	const capabilities = (
		raw.capabilities === undefined ? ["feed", "article"] : strings(raw.capabilities, "capabilities", 2)
	) as Capability[];
	if (capabilities.some((item) => item !== "feed" && item !== "article")) {
		throw new Error(`source ${id}: capabilities must be feed or article`);
	}
	if (feeds.length && !capabilities.includes("feed"))
		throw new Error(`source ${id}: feed URLs require the feed capability`);
	return {
		id,
		name,
		website,
		description,
		feeds,
		topics: strings(raw.topics, "topics", 12),
		geography: typeof raw.geography === "string" ? raw.geography.slice(0, 200) : "Unspecified",
		language: typeof raw.language === "string" ? raw.language : "en",
		aliases: strings(raw.aliases, "aliases", 8),
		capabilities,
	};
}

/** Validated catalog. Duplicate IDs, names, or aliases fail explicitly. */
export class SourceRegistry {
	private readonly sources = new Map<string, Source>();
	private readonly names = new Map<string, string>();

	constructor(sources: Iterable<Source>) {
		for (const source of sources) {
			const keys = new Set([source.id, source.name, ...source.aliases].map((value) => value.toLowerCase().trim()));
			if (this.sources.has(source.id) || [...keys].some((key) => this.names.has(key))) {
				throw new Error(`Source IDs, names, and aliases must be unique (${source.id}).`);
			}
			this.sources.set(source.id, source);
			for (const key of keys) this.names.set(key, source.id);
		}
	}

	/** Enabled definitions in registration order. */
	list(): Source[] {
		return [...this.sources.values()];
	}

	/** Resolve a known ID/name/alias; never silently substitute a publication. */
	resolve(name: string): Source | undefined {
		const id = this.names.get(name.toLowerCase().trim());
		return id ? this.sources.get(id) : undefined;
	}
}

const define = (source: Partial<Source> & Pick<Source, "id" | "name" | "website" | "description">): Source =>
	validateSource({ language: "en", ...source });

export const BUILTIN_SOURCES: Source[] = [
	define({
		id: "npr",
		name: "NPR",
		website: "https://www.npr.org/",
		feeds: ["https://feeds.npr.org/1001/rss.xml"],
		description:
			"General news for a US audience: national affairs, politics, society, and major international developments. Select for a general US news briefing.",
		topics: ["news", "politics"],
		geography: "US national focus; also international reporting",
	}),
	define({
		id: "pbs",
		name: "PBS NewsHour",
		website: "https://www.pbs.org/newshour/",
		feeds: ["https://www.pbs.org/newshour/feeds/rss/headlines"],
		aliases: ["PBS", "PBS News Hour"],
		description:
			"US national public-interest news, politics, policy, and major world stories. Complements NPR for general news.",
		topics: ["news", "politics", "business"],
		geography: "US national focus; also international reporting",
	}),
	define({
		id: "ars-technica",
		name: "Ars Technica",
		website: "https://arstechnica.com/",
		feeds: ["https://feeds.arstechnica.com/arstechnica/index"],
		aliases: ["Ars"],
		description:
			"Technology, software, computing, science, security, and AI developments for technically interested readers.",
		topics: ["technology", "ai", "science"],
		geography: "US-based; international technology coverage",
	}),
	define({
		id: "techcrunch",
		name: "TechCrunch",
		website: "https://techcrunch.com/",
		feeds: ["https://techcrunch.com/feed/"],
		description: "Technology businesses, startups, venture capital, software products, and commercial AI developments.",
		topics: ["technology", "ai", "business"],
		geography: "US-based; international startup coverage",
	}),
	define({
		id: "mit-technology-review",
		name: "MIT Technology Review",
		website: "https://www.technologyreview.com/",
		feeds: ["https://www.technologyreview.com/feed/"],
		aliases: ["MIT Tech Review"],
		description:
			"Emerging technology, artificial intelligence research and impacts, and technology policy. Some articles require a subscription; feed summaries may be all that is available.",
		topics: ["technology", "ai"],
		geography: "International technology coverage",
	}),
	define({
		id: "marketing-dive",
		name: "Marketing Dive",
		website: "https://www.marketingdive.com/",
		feeds: ["https://www.marketingdive.com/feeds/news/"],
		description:
			"Marketing and advertising industry news: brands, campaigns, agencies, advertising technology, and business strategy.",
		topics: ["marketing", "business"],
		geography: "US industry focus",
	}),
	define({
		id: "federal-reserve",
		name: "Federal Reserve",
		website: "https://www.federalreserve.gov/",
		feeds: ["https://www.federalreserve.gov/feeds/press_all.xml"],
		aliases: ["Fed"],
		description:
			"Official US central bank press releases on monetary policy, banking regulation, and financial-system actions. Primary policy evidence, not a general market news service.",
		topics: ["finance", "economics"],
		geography: "United States",
	}),
	define({
		id: "cnbc",
		name: "CNBC",
		website: "https://www.cnbc.com/",
		feeds: ["https://www.cnbc.com/id/100003114/device/rss/rss.html"],
		description:
			"Business, financial markets, companies, and economic news for a US audience. Recent top stories; no historical market data or investment recommendations.",
		topics: ["business", "finance", "economics"],
		geography: "US focus; global markets",
	}),
];
