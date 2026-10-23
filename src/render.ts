/** Plain-text rendering of references and limitations, shared by TUI and print output. */

import type { Reference } from "./research.ts";

/** Wrap text in an OSC 8 terminal hyperlink; pi-tui accounts for the escape when measuring width. */
export function hyperlink(url: string, text: string = url): string {
	return `\u001b]8;;${url}\u0007${text}\u001b]8;;\u0007`;
}

export function renderReferences(
	references: Reference[],
	limitations: string[],
	options: { links?: boolean } = {},
): string {
	const lines: string[] = [];
	if (references.length) {
		lines.push("References:");
		for (const ref of references) {
			lines.push(
				`[${ref.id}] ${ref.title} — ${ref.publisher} (${ref.kind.replace("_", " ")})`,
				`    ${options.links ? hyperlink(ref.url) : ref.url}`,
				`    Published: ${ref.published_at ?? "unknown"}; updated: ${ref.updated_at ?? "unknown"}; retrieved: ${ref.retrieved_at}`,
			);
		}
	}
	if (limitations.length) {
		if (lines.length) lines.push("");
		for (const item of limitations) lines.push(`Note: ${item}`);
	}
	return lines.join("\n");
}
