import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BUILTIN_SOURCES, SourceRegistry } from "../src/sources.ts";

describe("SourceRegistry", () => {
	it("resolves IDs, names, and aliases case-insensitively and never substitutes", () => {
		const registry = new SourceRegistry(BUILTIN_SOURCES);
		assert.equal(registry.resolve("npr")?.id, "npr");
		assert.equal(registry.resolve("  pbs news hour ")?.id, "pbs");
		assert.equal(registry.resolve("ARS")?.id, "ars-technica");
		assert.equal(registry.resolve("The Daily Planet"), undefined);
	});

	it("rejects duplicate identities", () => {
		const [npr] = BUILTIN_SOURCES;
		assert.throws(() => new SourceRegistry([npr, { ...npr, id: "npr-2", name: "Other", aliases: ["NPR"] }]), /unique/);
		assert.throws(() => new SourceRegistry([npr, { ...npr, name: "Other", aliases: [] }]), /unique/);
	});

	it("ships eight verified built-in sources with feeds", () => {
		assert.equal(BUILTIN_SOURCES.length, 8);
		for (const source of BUILTIN_SOURCES) {
			assert.ok(source.feeds.length >= 1, source.id);
			assert.ok(
				source.feeds.every((feed) => feed.startsWith("https://")),
				source.id,
			);
		}
	});
});
