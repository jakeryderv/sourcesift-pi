/** SourceSift as a pi extension: research tools, grounding rules, and citation checks. */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

import { type Config, loadConfig } from "./config.ts";
import { Fetcher } from "./http.ts";
import { buildInstructions } from "./prompt.ts";
import { renderReferences } from "./render.ts";
import {
	citationIds,
	type Evidence,
	type Reference,
	type Reply,
	Research,
	WINDOW_NAMES,
	type WindowName,
} from "./research.ts";
import { BUILTIN_SOURCES, SourceRegistry } from "./sources.ts";

const TOOL_NAMES = ["research", "read_article"];
const STATE_ENTRY = "sourcesift-state";
const RESULT_MESSAGE = "sourcesift-result";
const REPAIR_MESSAGE = "sourcesift-repair";
const NO_RETRIEVAL = "No external sources were retrieved; current information has not been verified.";

interface SessionState {
	evidence: Record<string, Evidence>;
	nextId: number;
	limitations: string[];
	turns: number;
}

/** The application-validated outcome of one completed turn. */
export interface TurnResult {
	answer: string;
	references: Reference[];
	limitations: string[];
	httpRequests: number;
}

export interface SourceSiftOptions {
	/** Resolved configuration; loaded from disk when omitted. */
	config?: Config;
	/** Called after each committed turn, for hosts that render results themselves. */
	onResult?: (result: TurnResult) => void;
}

function buildRegistry(config: Config): SourceRegistry {
	const catalog = new SourceRegistry([...BUILTIN_SOURCES, ...config.custom]);
	const known = new Set(catalog.list().map((source) => source.id));
	for (const id of config.disabled) {
		if (!known.has(id)) throw new Error(`Disabled source ID is not in the catalog: ${id}`);
	}
	return new SourceRegistry(catalog.list().filter((source) => !config.disabled.includes(source.id)));
}

function textOf(message: AssistantMessage): string {
	return message.content
		.filter((part): part is Extract<AssistantMessage["content"][number], { type: "text" }> => part.type === "text")
		.map((part) => part.text)
		.join("");
}

function summarize(reply: Reply): string {
	const items = reply.evidence.length;
	const notes = reply.limitations.length;
	const window = reply.window ? `${reply.window.label} window` : "no window";
	return `${items} evidence item${items === 1 ? "" : "s"} · ${window} · ${notes} note${notes === 1 ? "" : "s"}`;
}

/** Build the extension factory; the CLI passes its own config and result hook. */
export function createSourceSiftExtension(options: SourceSiftOptions = {}) {
	return function sourcesift(pi: ExtensionAPI): void {
		const config = options.config ?? loadConfig();
		const registry = buildRegistry(config);

		// Session-scoped state, restored from the active branch so /resume and /fork work.
		let evidence = new Map<string, Evidence>();
		let nextId = 1;
		let limitations: string[] = [];
		let turns = 0;
		// Run-scoped state.
		let current: Research | null = null;
		let repairs = 0;

		function restore(ctx: ExtensionContext): void {
			evidence = new Map();
			nextId = 1;
			limitations = [];
			turns = 0;
			for (const entry of ctx.sessionManager.getBranch()) {
				if (entry.type === "custom" && entry.customType === STATE_ENTRY && entry.data) {
					const state = entry.data as SessionState;
					evidence = new Map(Object.entries(state.evidence));
					nextId = state.nextId;
					limitations = state.limitations;
					turns = state.turns;
				}
			}
			ctx.ui.setStatus("sourcesift", `${registry.list().length} sources · ${evidence.size} evidence`);
		}

		pi.on("session_start", (_event, ctx) => {
			if (ctx.mode === "tui") ctx.ui.setTitle("SourceSift");
			restore(ctx);
		});
		pi.on("session_tree", (_event, ctx) => restore(ctx));
		pi.on("session_shutdown", (_event, ctx) => ctx.ui.setStatus("sourcesift", undefined));

		pi.on("before_agent_start", (event) => {
			pi.setActiveTools(TOOL_NAMES);
			const prompt = event.messageType === "user" ? event.prompt : "";
			current = new Research(config, registry, new Fetcher(config.limits), prompt, { previous: evidence, nextId });
			repairs = 0;
			return {
				systemPrompt: buildInstructions({
					config,
					catalog: registry.list(),
					now: current.now,
					retained: [...evidence.values()],
					previousLimitations: limitations,
					session: turns > 0,
				}),
			};
		});

		pi.registerTool(
			defineTool({
				name: "research",
				label: "Research",
				description:
					"Read selected registered feeds or user-supplied URLs; call before read_article. " +
					"Select source_ids semantically from the catalog. For a request limited to named publications, " +
					"pass their exact names in only_sources (even if unknown); an unknown publication never falls back " +
					"to another source. Pass direct_urls only for links present in the task. window is recent " +
					"(configured rolling days), today, this_week (Monday), or any for an article summary with no " +
					"freshness requirement. Constraints cannot change mid-run. Feed summaries are evidence, not proof " +
					"that a full article was fetched.",
				promptSnippet: "Retrieve recent entries from registered sources or task URLs",
				parameters: Type.Object({
					source_ids: Type.Array(Type.String(), { description: "Catalog IDs or names to read" }),
					direct_urls: Type.Array(Type.String(), { description: "URLs that appear verbatim in the task" }),
					only_sources: Type.Array(Type.String(), {
						description: "Exact publication names when the task restricts sources",
					}),
					window: Type.Optional(
						Type.Union(
							WINDOW_NAMES.map((name) => Type.Literal(name)),
							{ description: "recent (default), today, this_week, or any" },
						),
					),
				}),
				executionMode: "sequential",
				async execute(_toolCallId, params) {
					if (!current) throw new Error("No active research run.");
					const reply = await current.research(
						params.source_ids,
						params.direct_urls,
						params.only_sources,
						(params.window ?? "recent") as WindowName,
					);
					return { content: [{ type: "text", text: JSON.stringify(reply) }], details: reply };
				},
				renderResult(result, _options, theme) {
					return new Text(theme.fg("muted", summarize(result.details as Reply)), 0, 0);
				},
			}),
		);

		pi.registerTool(
			defineTool({
				name: "read_article",
				label: "Read article",
				description:
					"Read a returned article link for detail, within the original constraints. Only user-provided URLs " +
					"or links in retrieved evidence are eligible. Links may redirect or cite other publishers: use the " +
					"actual publisher and provenance, and never attribute linked reporting to the original source.",
				promptSnippet: "Fetch the full text of an article already in evidence or the task",
				parameters: Type.Object({ url: Type.String({ description: "Article URL from evidence or the task" }) }),
				executionMode: "sequential",
				async execute(_toolCallId, params) {
					if (!current) throw new Error("No active research run.");
					const reply = await current.readArticle(params.url);
					return { content: [{ type: "text", text: JSON.stringify(reply) }], details: reply };
				},
				renderResult(result, _options, theme) {
					return new Text(theme.fg("muted", summarize(result.details as Reply)), 0, 0);
				},
			}),
		);

		pi.on("turn_end", (event, ctx) => {
			if (!current || event.message.role !== "assistant") return;
			const message = event.message as AssistantMessage;
			if (message.content.some((part) => part.type === "toolCall")) return;
			if (message.stopReason === "error" || message.stopReason === "aborted") return;
			const answer = textOf(message);
			const research = current;
			const ids = citationIds(answer);
			const known = new Set([...research.allEvidence().values()].map((item) => item.id));
			const unknown = ids.filter((id) => !known.has(id));
			const missing = research.evidence.size > 0 && ids.length === 0;

			if ((unknown.length || missing) && repairs < 1 && message.stopReason === "stop") {
				repairs += 1;
				return {
					continue: true,
					entries: [
						{
							type: "custom_message" as const,
							customType: REPAIR_MESSAGE,
							display: false,
							content:
								"Citation check failed: " +
								(unknown.length
									? `unknown evidence IDs ${unknown.join(", ")}. `
									: "retrieved evidence exists but nothing was cited. ") +
								"Rewrite the complete answer using only existing evidence IDs, citing supporting evidence as [S1].",
						},
					],
				};
			}

			// Commit the turn: references, limitations, and the retained evidence snapshot.
			const references = research.references(answer);
			const notes = research.attempted || references.length ? research.limitationsFor(references) : [NO_RETRIEVAL];
			if (references.some((ref) => !research.evidence.has(ref.url))) {
				notes.push(
					"Some cited evidence is retained from earlier turns, not freshly retrieved; see retrieval timestamps.",
				);
				notes.push(...limitations);
			}
			if (unknown.length) notes.push(`The answer cites IDs with no retrieved evidence: ${unknown.join(", ")}.`);
			if (research.window) {
				notes.unshift(
					`Coverage window: ${research.window.start ?? "unbounded"} to ${research.window.end} (${research.window.timezone}); this is a limited source sample.`,
				);
			}
			if (message.stopReason === "length")
				notes.push("The model reached its output token limit; the answer may be incomplete.");
			const finalNotes = [...new Set(notes)];

			evidence = research.allEvidence();
			nextId = research.nextId;
			limitations = finalNotes;
			turns += 1;
			current = null;
			const state: SessionState = { evidence: Object.fromEntries(evidence), nextId, limitations, turns };
			ctx.ui.setStatus("sourcesift", `${registry.list().length} sources · ${evidence.size} evidence`);
			options.onResult?.({ answer, references, limitations: finalNotes, httpRequests: research.httpRequests });
			return {
				entries: [
					{ type: "custom" as const, customType: STATE_ENTRY, data: state },
					{
						type: "custom_message" as const,
						customType: RESULT_MESSAGE,
						display: true,
						content: renderReferences(references, finalNotes),
						details: { references, limitations: finalNotes, http_requests: research.httpRequests },
					},
				],
			};
		});

		pi.registerMessageRenderer(RESULT_MESSAGE, (message, _options, theme) => {
			const content = typeof message.content === "string" ? message.content : "";
			if (!content) return undefined;
			const styled = content
				.split("\n")
				.map((line) =>
					line.startsWith("Note:")
						? theme.fg("warning", line)
						: line.startsWith("[S")
							? theme.fg("accent", line)
							: theme.fg("muted", line),
				)
				.join("\n");
			return new Text(styled, 0, 0);
		});

		pi.registerCommand("sources", {
			description: "List the registered sources available for research",
			handler: async (_args, ctx) => {
				const lines = registry.list().map((source) => `${source.id}: ${source.name} — ${source.topics.join(", ")}`);
				ctx.ui.notify(lines.join("\n"), "info");
			},
		});

		pi.registerCommand("evidence", {
			description: "List evidence retained in this conversation",
			handler: async (_args, ctx) => {
				if (!evidence.size) {
					ctx.ui.notify("No evidence retained yet.", "info");
					return;
				}
				const lines = [...evidence.values()].map(
					(item) => `[${item.id}] ${item.title} — ${item.publisher} (${item.kind}, retrieved ${item.retrieved_at})`,
				);
				ctx.ui.notify(lines.join("\n"), "info");
			},
		});
	};
}

/** Loading this file as a plain pi extension uses on-disk configuration. */
export default function sourcesift(pi: ExtensionAPI): void {
	createSourceSiftExtension()(pi);
}
