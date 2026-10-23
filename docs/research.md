# Research and sources

Ask naturally: “check news,” “check tech and AI,” or “find developments relevant to
this project.” The model selects sources from their descriptions and your context.
There is no keyword router, category flag, search engine, or persistent history.

## Initial catalog

The initial general-news scope is US national news. Individual feeds also contain
international stories; their presence does not establish comprehensive global or
local coverage. The catalog is deliberately small and can miss relevant reporting.

| ID | Publication | Coverage | Feed |
|---|---|---|---|
| `npr` | NPR | US national affairs and major world stories | [RSS](https://feeds.npr.org/1001/rss.xml) |
| `pbs` | PBS NewsHour | US public-interest news, politics, policy | [RSS](https://www.pbs.org/newshour/feeds/rss/headlines) |
| `ars-technica` | Ars Technica | Computing, science, security, AI | [RSS](https://feeds.arstechnica.com/arstechnica/index) |
| `techcrunch` | TechCrunch | Startups, technology businesses, commercial AI | [RSS](https://techcrunch.com/feed/) |
| `mit-technology-review` | MIT Technology Review | Emerging technology, AI research and impacts | [RSS](https://www.technologyreview.com/feed/) |
| `marketing-dive` | Marketing Dive | Advertising, brands, campaigns, marketing platforms | [RSS](https://www.marketingdive.com/feeds/news/) |
| `federal-reserve` | Federal Reserve | Primary US monetary-policy and banking announcements | [RSS](https://www.federalreserve.gov/feeds/press_all.xml) |
| `cnbc` | CNBC | Business, companies, markets, economics | [RSS](https://www.cnbc.com/id/100003114/device/rss/rss.html) |

Feeds are public recent-entry sources, not historical archives. A reachable feed
does not imply that every linked article is accessible; subscriptions, robots
restrictions, JavaScript, and extraction failures can limit article access.
Custom source definitions use the same adapters; see [configuration](configuration.md)
and [SDK registration](sdk.md#source-definitions).

## Selection and retrieval

The `research` tool receives the agent's chosen sources, direct URLs, named-only
constraints, and window. Follow-up calls may add sources within the same window
and constraints. `read_article` can fetch a link from retained evidence or the
original task. URLs embedded only in background documents do not authorize retrieval.

A request such as “use only NPR” should select NPR or explain why it is unavailable.
The model interprets the restriction; Python enforces the declared named-only list
once supplied. Unknown or disabled named sources never silently fall back to others.
This is a semantic constraint, not a domain sandbox: a feed can link or redirect
to another publisher, whose actual hostname is preserved in the reference. Direct
URLs combined with named-only restrictions must use the registered feed path.

HTTP retrieves only public HTTP(S) addresses on standard ports. Each destination,
including redirects, resolves to public IP addresses and is pinned for the connection
while retaining the original Host and TLS server name. Private, loopback, link-local,
reserved, and multicast destinations are rejected. Retrieval uses no environment
proxies, authentication, or retained cookies. Publisher robots rules are checked;
missing robots files (404/410) permit access, while unavailable rules fail closed.
Requests are sequential and bounded; there is no general crawl or paywall bypass.

RSS and Atom summaries are parsed with feedparser. If a source has no explicit
feed URL, declared RSS/Atom links are discovered from its website. HTML article
text is extracted with Trafilatura from bytes already fetched by the bounded HTTP
adapter. PDF, browser rendering, and arbitrary website search are unsupported.

## Dates and evidence

The run captures a UTC clock. `sources.timezone` defaults to UTC and controls local
calendar boundaries; it is never inferred from the machine's locale.

- **Recent:** the preceding `recent_days` (default seven rolling days).
- **Today:** local midnight through the run's start.
- **This week:** Monday at local midnight through the run's start, including DST.
- **Any:** no lower date bound, normally used for a direct article summary.

Known publication dates determine freshness. An update date is used only when
publication is unknown, and is labeled as such. Missing or zone-less dates remain
unknown; those items may be shown with an explicit unverified-freshness warning.
Future and out-of-window dated entries are excluded. Retrieval time never proves
publication time. Explicit article dates take precedence over feed dates; missing
article dates can retain the feed's date. Arbitrary historical ranges are unsupported.

URLs are normalized by removing fragments and common tracking parameters. Identical
normalized URLs or identical normalized title/text pairs are deduplicated within
the run. This does not detect all syndicated stories or different reports about
the same event. Retained evidence and text are capped; feed entries are considered
newest dated first, so older or undated relevant items can be omitted by the cap.

Each citation such as `[S1]` maps to a typed reference with the title, final article
URL, requested retrieval URL, actual feed/page fetched, publisher hostname, source
ID, available author/dates, retrieval timestamp, and limitations. A `feed_summary`
reference means the feed supplied the text; it does not claim the article was
fetched. Article follow-ups replace that evidence while preserving its citation ID
unless it merges with an already known final URL.

The runtime rejects invented citation IDs and asks once for missing citations when
retrieved evidence exists. If retrieval yields no usable evidence, it returns an
explicit inability to verify information. Citation existence is checked in Python;
claim-level support, relevance, and honest geographic scope still depend on the
model and require evaluation. Untrusted documents and tool text are explicitly
separated from instructions, but prompt instructions alone are not a guarantee
against every prompt-injection attack.

## Validation and live evaluation

Normal CI uses deterministic model calls and authored fixtures: RSS/Atom, discovery,
article extraction, date windows/DST, duplicates, redirects, HTTP limits, partial
failures, named-only restrictions, and citation repair. Live models are disabled.
Hypothesis additionally checks URL-normalization idempotence.

Run the fixed eight-case evaluation explicitly from a checkout:

```sh
export SOURCESIFT_MODEL=openai/gpt-6.1-sol
export SOURCESIFT_REASONING_EFFORT=medium
uv run --locked python scripts/research_eval.py
# Or one case:
uv run --locked python scripts/research_eval.py --case named-only
```

Set `OPENROUTER_API_KEY` securely first. To deliberately load a local ignored `.env`,
use `uv run --env-file .env ...`; the application never loads it automatically.
This evaluation incurs model usage and contacts public publishers. Two cases use
a live model with synthetic unavailable/date/duplicate source fixtures. No other
case substitutes publisher content. Default output is ignored `evaluation-results/`.

Records include the exact request/context, model/effort, selected sources, window,
answer, references, evidence, elapsed time, and reported usage. Automatic selection
and evidence-presence checks are smoke checks; fill in the separate human-review
fields after checking relevance, each citation's support, and freshness disclosures.
Keep these records private if prompts/context are private. They are not persisted
by normal application requests.

The Phase 2 acceptance baseline (2026-10-15 UTC / October 14 US Central) used
`openai/gpt-6.1-sol` at medium effort. All eight source-selection/evidence-presence
checks passed, taking 4.27–16.54 seconds and two or three model requests per case.
Codex reviewed the 12 cited references against captured evidence; the observed
claims were supported, missing dates/access were disclosed, and the named-only
cases did not substitute other publications. A separate actual CLI check fetched
and summarized a direct article URL with clean plain-text output.

The committed `evaluations/baseline.json` records prompts, settings, source sets,
windows, usage, timings, and review notes without reproducing publisher articles.
This is a small agent-reviewed acceptance baseline, not an independent human
assessment or a measured general accuracy rate. Before expanding the catalog,
require these eight checks to stay green, zero unknown citation IDs, explicit
unknown-date handling, and review every cited claim in the fixed cases. Add labeled
cases for the new coverage before setting broader relevance targets.
