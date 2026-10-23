import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hostname, isGlobalAddress, normalizeUrl, RetrievalError } from "../src/urls.ts";

describe("normalizeUrl", () => {
	it("lowercases the host, drops fragments and tracking parameters, and keeps the rest", () => {
		assert.equal(
			normalizeUrl("HTTPS://Example.COM/a/b?utm_source=x&id=7&fbclid=1&q=#top"),
			"https://example.com/a/b?id=7&q=",
		);
	});

	it("is idempotent", () => {
		const once = normalizeUrl("https://example.com/path?b=2&a=1");
		assert.equal(normalizeUrl(once), once);
	});

	it("adds a root path and keeps a non-default standard port", () => {
		assert.equal(normalizeUrl("http://example.com"), "http://example.com/");
		assert.equal(normalizeUrl("http://example.com:443/x"), "http://example.com:443/x");
		assert.equal(normalizeUrl("https://example.com:443/x"), "https://example.com/x");
	});

	it("encodes international hostnames", () => {
		assert.equal(normalizeUrl("https://bücher.example/"), "https://xn--bcher-kva.example/");
	});

	for (const bad of [
		"ftp://example.com/",
		"https://user:pw@example.com/",
		"https://example.com:8080/",
		"http://localhost/",
		"http://api.localhost/",
		"http://printer.local/",
		"http://127.0.0.1/",
		"http://[::1]/",
		"http://10.1.2.3/",
		"http://169.254.169.254/latest/meta-data/",
		"http://example.com/a b",
		"http://example.com/a\\b",
		"not a url",
	]) {
		it(`rejects ${bad}`, () => {
			assert.throws(() => normalizeUrl(bad), RetrievalError);
		});
	}
});

describe("isGlobalAddress", () => {
	it("accepts public IPv4 and IPv6", () => {
		assert.equal(isGlobalAddress("23.211.127.5"), true);
		assert.equal(isGlobalAddress("2600:1404:ec00:25::17dc:a319"), true);
	});

	for (const address of [
		"0.0.0.0",
		"10.0.0.1",
		"100.64.1.1",
		"127.0.0.1",
		"169.254.1.1",
		"172.16.0.1",
		"192.168.1.1",
		"192.0.2.1",
		"224.0.0.1",
		"255.255.255.255",
		"::1",
		"::",
		"fc00::1",
		"fe80::1",
		"ff02::1",
		"::ffff:10.0.0.1",
		"2001:db8::1",
	]) {
		it(`rejects ${address}`, () => {
			assert.equal(isGlobalAddress(address), false);
		});
	}

	it("rejects things that are not addresses", () => {
		assert.equal(isGlobalAddress("example.com"), false);
	});
});

describe("hostname", () => {
	it("returns a lowercase hostname or an empty string", () => {
		assert.equal(hostname("https://WWW.Example.com/x"), "www.example.com");
		assert.equal(hostname("nope"), "");
	});
});
