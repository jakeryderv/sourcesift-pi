/** Public HTTP URL normalization shared by sources and retrieval. */

import { isIP } from "node:net";

export class RetrievalError extends Error {
	override name = "RetrievalError";
}

const MESSAGE = "URL must be public HTTP(S), without credentials or an unusual port.";
const TRACKING = new Set(["fbclid", "gclid", "mc_cid", "mc_eid"]);

function ipv4ToInt(address: string): number {
	return address.split(".").reduce((acc, part) => acc * 256 + Number(part), 0) >>> 0;
}

function inRange(value: number, cidr: string): boolean {
	const [base, bits] = cidr.split("/");
	const mask = bits === "0" ? 0 : (~0 << (32 - Number(bits))) >>> 0;
	return (value & mask) >>> 0 === (ipv4ToInt(base) & mask) >>> 0;
}

const PRIVATE_V4 = [
	"0.0.0.0/8",
	"10.0.0.0/8",
	"100.64.0.0/10",
	"127.0.0.0/8",
	"169.254.0.0/16",
	"172.16.0.0/12",
	"192.0.0.0/24",
	"192.0.2.0/24",
	"192.168.0.0/16",
	"198.18.0.0/15",
	"198.51.100.0/24",
	"203.0.113.0/24",
	"224.0.0.0/4",
	"240.0.0.0/4",
];

/** Reject loopback, private, link-local, reserved, multicast, and documentation ranges. */
export function isGlobalAddress(address: string): boolean {
	const version = isIP(address);
	if (version === 4) {
		const value = ipv4ToInt(address);
		return !PRIVATE_V4.some((cidr) => inRange(value, cidr));
	}
	if (version !== 6) return false;
	const lower = address.toLowerCase();
	const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
	if (mapped) return isGlobalAddress(mapped[1]);
	if (lower === "::" || lower === "::1") return false;
	if (lower.startsWith("64:ff9b:")) return false;
	if (/^f[cd]/.test(lower)) return false; // fc00::/7 unique local
	if (/^fe[89ab]/.test(lower)) return false; // fe80::/10 link local
	if (lower.startsWith("ff")) return false; // multicast
	if (lower.startsWith("2001:db8:")) return false; // documentation
	if (lower.startsWith("100::")) return false; // discard
	return true;
}

/** Normalize public HTTP(S) URLs, dropping fragments and tracking parameters. */
export function normalizeUrl(value: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters in URLs is the point
	if (value.length > 4096 || /[\u0000- \u007f\\]/.test(value)) {
		throw new RetrievalError(MESSAGE);
	}
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new RetrievalError(MESSAGE);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new RetrievalError(MESSAGE);
	if (url.username || url.password) throw new RetrievalError(MESSAGE);
	const host = url.hostname.toLowerCase();
	if (!host) throw new RetrievalError(MESSAGE);
	if (url.port && url.port !== "80" && url.port !== "443") throw new RetrievalError(MESSAGE);
	const bare = host.replace(/\.$/, "");
	if (bare === "localhost" || bare.endsWith(".localhost") || bare.endsWith(".local")) {
		throw new RetrievalError(MESSAGE);
	}
	const literal = host.startsWith("[") ? host.slice(1, -1) : host;
	if (isIP(literal) && !isGlobalAddress(literal)) throw new RetrievalError(MESSAGE);
	const kept = new URLSearchParams();
	for (const [key, item] of new URLSearchParams(url.search)) {
		const lower = key.toLowerCase();
		if (lower.startsWith("utm_") || TRACKING.has(lower)) continue;
		kept.append(key, item);
	}
	url.hostname = host;
	url.search = kept.toString();
	url.hash = "";
	if (!url.pathname) url.pathname = "/";
	return url.toString();
}

/** Return a normalized hostname for provenance, not a publisher claim. */
export function hostname(url: string): string {
	try {
		return new URL(url).hostname.toLowerCase();
	} catch {
		return "";
	}
}
