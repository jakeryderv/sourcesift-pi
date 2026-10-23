import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hyperlink, renderReferences } from "../src/render.ts";
import type { Reference } from "../src/research.ts";

const reference: Reference = {
	id: "S2",
	title: "A headline",
	url: "https://example.com/story",
	requested_url: "https://example.com/story",
	retrieved_from: "https://example.com/story",
	publisher: "example.com",
	source_id: "example",
	author: null,
	published_at: "2026-10-23T11:00:00.000Z",
	updated_at: null,
	retrieved_at: "2026-10-23T12:00:00.000Z",
	kind: "feed_summary",
	limitations: [],
};

describe("renderReferences", () => {
	it("lists references then notes", () => {
		const text = renderReferences([reference], ["Coverage is partial."]);
		assert.match(
			text,
			/^References:\n\[S2\] A headline — example.com \(feed summary\)\n {4}https:\/\/example.com\/story\n/,
		);
		assert.match(text, /Published: 2026-10-23T11:00:00.000Z; updated: unknown; retrieved: 2026-10-23T12:00:00.000Z/);
		assert.match(text, /\n\nNote: Coverage is partial.$/);
	});

	it("returns an empty string when there is nothing to say", () => {
		assert.equal(renderReferences([], []), "");
	});

	it("wraps URLs in terminal hyperlinks on request", () => {
		const text = renderReferences([reference], [], { links: true });
		assert.ok(text.includes(hyperlink("https://example.com/story")));
		assert.equal(hyperlink("https://x.example/", "x"), "\u001b]8;;https://x.example/\u0007x\u001b]8;;\u0007");
	});
});
