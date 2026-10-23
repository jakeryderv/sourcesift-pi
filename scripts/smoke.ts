/** Retrieval-only smoke check: no model, one registered feed, one article follow-up. */

import { loadConfig } from "../src/config.ts";
import { Fetcher } from "../src/http.ts";
import { Research } from "../src/research.ts";
import { BUILTIN_SOURCES, SourceRegistry } from "../src/sources.ts";

const sourceId = process.argv[2] ?? "npr";
const config = loadConfig();
const registry = new SourceRegistry(BUILTIN_SOURCES);
const research = new Research(config, registry, new Fetcher(config.limits), "smoke test");

const reply = await research.research([sourceId], [], [], "recent");
console.log(`window: ${reply.window?.start} → ${reply.window?.end} (${reply.window?.timezone})`);
console.log(`evidence: ${reply.evidence.length}, http requests: ${research.httpRequests}`);
for (const item of reply.evidence) {
	console.log(`  ${item.id} ${item.published_at ?? "undated"} ${item.title.slice(0, 70)} [${item.text.length} chars]`);
}
for (const note of reply.limitations) console.log(`  note: ${note}`);

const first = reply.evidence[0];
if (first) {
	const followUp = await research.readArticle(first.url);
	const article = followUp.evidence.find((item) => item.id === first.id);
	console.log(
		`\nread_article ${first.id}: kind=${article?.kind} text=${article?.text.length ?? 0} chars publisher=${article?.publisher}`,
	);
	for (const note of followUp.limitations.filter((n) => !reply.limitations.includes(n))) console.log(`  note: ${note}`);
}
console.log(`\ntotal http requests: ${research.httpRequests}`);
