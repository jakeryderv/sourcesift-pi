/** Plain-text rendering of references and limitations, shared by TUI and print output. */

import type { Reference } from "./research.ts";

export function renderReferences(references: Reference[], limitations: string[]): string {
	const lines: string[] = [];
	if (references.length) {
		lines.push("References:");
		for (const ref of references) {
			lines.push(
				`[${ref.id}] ${ref.title} — ${ref.publisher} (${ref.kind.replace("_", " ")})`,
				`    ${ref.url}`,
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
