/** Fetch one URL through the bounded fetcher and show the underlying failure, if any. */
import { loadConfig } from "../src/config.ts";
import { Fetcher } from "../src/http.ts";

const url = process.argv[2];
if (!url) throw new Error("usage: node scripts/debug-fetch.ts <url>");
const fetcher = new Fetcher(loadConfig().limits);
const started = Date.now();
try {
	const page = await fetcher.get(url);
	console.log(`ok ${page.url} status=200 bytes=${page.body.length} type=${page.contentType} in ${Date.now() - started}ms, requests=${fetcher.requests}`);
} catch (error) {
	const err = error as Error & { cause?: unknown };
	console.log(`failed after ${Date.now() - started}ms, requests=${fetcher.requests}: ${err.message}`);
	if (err.cause) console.log("cause:", err.cause);
}
