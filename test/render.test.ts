import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compactNotes, formatInstant, hyperlink, noteLines, referenceLines, renderReferences } from "../src/render.ts";
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

describe("formatInstant", () => {
	it("prints a short UTC stamp and drops the day when it matches", () => {
		assert.equal(formatInstant("2026-10-23T11:05:00Z"), "Oct 23 11:05 UTC");
		assert.equal(formatInstant("2026-10-23T14:53:57.048Z", "2026-10-23T11:00:00Z"), "14:53 UTC");
		assert.equal(formatInstant("2026-10-24T01:00:00Z", "2026-10-23T11:00:00Z"), "Oct 24 01:00 UTC");
		assert.equal(formatInstant(null), "unknown");
		assert.equal(formatInstant("nope"), "unknown");
	});
});

describe("compactNotes", () => {
	it("shortens the window note and merges per-source caps, keeping other notes verbatim", () => {
		const notes = compactNotes([
			"Coverage window: 2026-10-16T14:53:54.245Z to 2026-10-23T14:53:54.245Z (UTC); this is a limited source sample.",
			"NPR: feed selection is capped at 6 items; coverage is partial.",
			"Only the feed summary was retrieved, not the full article.",
			"PBS NewsHour: feed selection is capped at 6 items; coverage is partial.",
		]);
		assert.deepEqual(notes, [
			"Window: Oct 16 to Oct 23 (UTC); limited source sample.",
			"Only the feed summary was retrieved, not the full article.",
			"Feed selection capped at 6 items for NPR and PBS NewsHour; coverage is partial.",
		]);
		assert.deepEqual(
			compactNotes(["Coverage window: unbounded to 2026-10-23T15:00:00Z (UTC); this is a limited source sample."]),
			["Window: any date to Oct 23 (UTC); limited source sample."],
		);
		assert.deepEqual(compactNotes(["Ars Technica: feed selection is capped at 6 items; coverage is partial."]), [
			"Feed selection capped at 6 items for Ars Technica; coverage is partial.",
		]);
	});
});

describe("renderReferences", () => {
	it("lists references with compact timestamps, then notes", () => {
		const text = renderReferences([reference], ["Coverage is partial."]);
		assert.equal(
			text,
			[
				"References:",
				"[S2] A headline — example.com (feed summary)",
				"    https://example.com/story",
				"    published Oct 23 11:00 UTC · retrieved 12:00 UTC",
				"",
				"Note: Coverage is partial.",
			].join("\n"),
		);
	});

	it("shows an update time only when there is one and handles unknown dates", () => {
		const lines = referenceLines([
			{ ...reference, published_at: null, updated_at: "2026-10-23T13:25:15Z", kind: "article" },
		]);
		assert.equal(lines[0], "[S2] A headline — example.com (article)");
		assert.equal(lines[2], "    published unknown · updated Oct 23 13:25 UTC · retrieved 12:00 UTC");
	});

	it("returns an empty string when there is nothing to say", () => {
		assert.equal(renderReferences([], []), "");
		assert.deepEqual(noteLines([]), []);
	});

	it("wraps URLs in terminal hyperlinks on request", () => {
		const text = renderReferences([reference], [], { links: true });
		assert.ok(text.includes(hyperlink("https://example.com/story")));
		assert.equal(hyperlink("https://x.example/", "x"), "\u001b]8;;https://x.example/\u0007x\u001b]8;;\u0007");
	});
});
