import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { configHome, DEFAULT_LIMITS, loadConfig } from "../src/config.ts";

function withEnv<T>(values: Record<string, string | undefined>, run: () => T): T {
	const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	try {
		return run();
	} finally {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

describe("configHome", () => {
	it("prefers SOURCESIFT_HOME, then XDG_CONFIG_HOME", () => {
		assert.equal(withEnv({ SOURCESIFT_HOME: "/tmp/ss", XDG_CONFIG_HOME: "/tmp/xdg" }, configHome), "/tmp/ss");
		assert.equal(
			withEnv({ SOURCESIFT_HOME: undefined, XDG_CONFIG_HOME: "/tmp/xdg" }, configHome),
			"/tmp/xdg/sourcesift",
		);
	});
});

describe("loadConfig", () => {
	it("returns defaults when the default file is absent", () => {
		const dir = mkdtempSync(join(tmpdir(), "ssift-"));
		const config = withEnv({ SOURCESIFT_HOME: dir, SOURCESIFT_CONFIG: undefined }, () => loadConfig());
		assert.equal(config.timezone, "UTC");
		assert.equal(config.recentDays, 7);
		assert.deepEqual(config.disabled, []);
		assert.deepEqual(config.custom, []);
		assert.deepEqual(config.limits, DEFAULT_LIMITS);
		assert.equal(config.guidancePath, join(dir, "guidance.md"));
	});

	it("fails when an explicitly selected file is missing", () => {
		assert.throws(() => loadConfig("/nonexistent/config.json"), /Cannot read SourceSift configuration/);
	});

	it("loads custom sources, disabled IDs, timezone, limits, and guidance", () => {
		const dir = mkdtempSync(join(tmpdir(), "ssift-"));
		const path = join(dir, "config.json");
		writeFileSync(
			path,
			JSON.stringify({
				timezone: "America/Chicago",
				recent_days: 3,
				disabled: ["cnbc"],
				guidance: "/tmp/g.md",
				limits: { maxSources: 5, feedCacheSeconds: 30 },
				custom: [
					{
						id: "example",
						name: "Example",
						website: "https://example.com",
						feeds: ["https://example.com/feed.xml?utm_source=x"],
						description: "Example coverage.",
						topics: ["research"],
					},
				],
			}),
		);
		const config = loadConfig(path);
		assert.equal(config.timezone, "America/Chicago");
		assert.equal(config.recentDays, 3);
		assert.deepEqual(config.disabled, ["cnbc"]);
		assert.equal(config.guidancePath, "/tmp/g.md");
		assert.equal(config.limits.maxSources, 5);
		assert.equal(config.limits.feedCacheSeconds, 30);
		assert.equal(config.limits.maxItems, DEFAULT_LIMITS.maxItems);
		assert.equal(config.custom[0].website, "https://example.com/");
		assert.deepEqual(config.custom[0].feeds, ["https://example.com/feed.xml"]);
		assert.deepEqual(config.custom[0].capabilities, ["feed", "article"]);
	});

	it("rejects invalid timezones, limits, and sources", () => {
		const dir = mkdtempSync(join(tmpdir(), "ssift-"));
		const write = (data: unknown) => {
			const path = join(dir, `${Math.random()}.json`);
			writeFileSync(path, JSON.stringify(data));
			return path;
		};
		assert.throws(() => loadConfig(write({ timezone: "Mars/Olympus" })), /IANA zone/);
		assert.throws(() => loadConfig(write({ limits: { maxSources: -1 } })), /positive number/);
		assert.throws(
			() =>
				loadConfig(write({ custom: [{ id: "Bad Id", name: "x", website: "https://x.example/", description: "d" }] })),
			/invalid source id/,
		);
		assert.throws(
			() => loadConfig(write({ custom: [{ id: "ok", name: "x", website: "http://localhost/", description: "d" }] })),
			/public HTTP/,
		);
		assert.throws(
			() =>
				loadConfig(
					write({
						custom: [
							{
								id: "ok",
								name: "x",
								website: "https://x.example/",
								description: "d",
								feeds: ["https://x.example/f"],
								capabilities: ["article"],
							},
						],
					}),
				),
			/feed capability/,
		);
	});
});
