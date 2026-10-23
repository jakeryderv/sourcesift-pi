/** Human-facing rendering of references and notes, shared by the TUI and print output. */

import type { Reference } from "./research.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Wrap text in an OSC 8 terminal hyperlink; pi-tui accounts for the escape when measuring width. */
export function hyperlink(url: string, text: string = url): string {
	return `\u001b]8;;${url}\u0007${text}\u001b]8;;\u0007`;
}

function dayOf(iso: string): string {
	const date = new Date(iso);
	return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function timeOf(iso: string): string {
	const date = new Date(iso);
	return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

/** "Oct 23 11:22 UTC", or only the time when the day matches `sameDayAs`. */
export function formatInstant(iso: string | null, sameDayAs?: string | null): string {
	if (!iso || Number.isNaN(new Date(iso).getTime())) return "unknown";
	const sameDay = sameDayAs && !Number.isNaN(new Date(sameDayAs).getTime()) && dayOf(sameDayAs) === dayOf(iso);
	return `${sameDay ? "" : `${dayOf(iso)} `}${timeOf(iso)} UTC`;
}

/** Merge repetitive per-source notes and shorten the window note; the stored notes stay verbatim. */
export function compactNotes(notes: string[]): string[] {
	const result: string[] = [];
	const capped = new Map<number, string[]>();
	for (const note of notes) {
		const window = note.match(/^Coverage window: (.+?) to (.+?) \((.+?)\); this is a limited source sample\.$/);
		if (window) {
			const [, start, end, zone] = window;
			const from = start === "unbounded" ? "any date" : dayOf(start);
			result.push(`Window: ${from} to ${dayOf(end)} (${zone}); limited source sample.`);
			continue;
		}
		const cap = note.match(/^(.+?): feed selection is capped at (\d+) items; coverage is partial\.$/);
		if (cap) {
			const count = Number(cap[2]);
			capped.set(count, [...(capped.get(count) ?? []), cap[1]]);
			continue;
		}
		result.push(note);
	}
	for (const [count, sources] of capped) {
		const list = sources.length > 1 ? `${sources.slice(0, -1).join(", ")} and ${sources.at(-1)}` : sources[0];
		result.push(`Feed selection capped at ${count} items for ${list}; coverage is partial.`);
	}
	return result;
}

export function referenceLines(references: Reference[], options: { links?: boolean } = {}): string[] {
	const lines: string[] = [];
	if (!references.length) return lines;
	lines.push("References:");
	for (const ref of references) {
		const when = [`published ${formatInstant(ref.published_at)}`];
		if (ref.updated_at) when.push(`updated ${formatInstant(ref.updated_at, ref.published_at)}`);
		when.push(`retrieved ${formatInstant(ref.retrieved_at, ref.published_at ?? ref.updated_at)}`);
		lines.push(
			`[${ref.id}] ${ref.title} — ${ref.publisher} (${ref.kind.replace("_", " ")})`,
			`    ${options.links ? hyperlink(ref.url) : ref.url}`,
			`    ${when.join(" · ")}`,
		);
	}
	return lines;
}

export function noteLines(limitations: string[]): string[] {
	return compactNotes(limitations).map((note) => `Note: ${note}`);
}

export function renderReferences(
	references: Reference[],
	limitations: string[],
	options: { links?: boolean } = {},
): string {
	const refs = referenceLines(references, options);
	const notes = noteLines(limitations);
	return [...refs, ...(refs.length && notes.length ? [""] : []), ...notes].join("\n");
}
