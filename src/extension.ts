/** SourceSift as a pi extension: research tools, grounding rules, citation checks, and the chat UI. */

import { readFileSync } from "node:fs";

import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	defineTool,
	type ExtensionAPI,
	type ExtensionContext,
	getSettingsListTheme,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { type SettingItem, SettingsList, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";

import { type Config, loadConfig } from "./config.ts";
import { Fetcher, PageCache } from "./http.ts";
import { buildInstructions } from "./prompt.ts";
import { renderReferences } from "./render.ts";
import {
	citationIds,
	type Evidence,
	parseCitation,
	type Reference,
	type Reply,
	Research,
	WINDOW_NAMES,
	type WindowName,
} from "./research.ts";
import { BUILTIN_SOURCES, SourceRegistry } from "./sources.ts";

const TOOL_NAMES = ["research", "read_article"];
const STATE_ENTRY = "sourcesift-state";
const SOURCES_ENTRY = "sourcesift-sources";
const RESULT_MESSAGE = "sourcesift-result";
const REPAIR_MESSAGE = "sourcesift-repair";
const NO_RETRIEVAL = "No external sources were retrieved; current information has not been verified.";
const MAX_GUIDANCE_BYTES = 32 * 1024;
const COLLAPSED_ITEMS = 6;

interface SessionState {
	evidence: Record<string, Evidence>;
	nextId: number;
	limitations: string[];
	turns: number;
}

interface SourcesState {
	disabled: string[];
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

function packageVersion(): string {
	try {
		return (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string })
			.version;
	} catch {
		return "dev";
	}
}

function buildCatalog(config: Config): SourceRegistry {
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

function evidenceLine(item: Evidence, theme: Theme, width: number): string {
	const date = item.published_at?.slice(0, 10) ?? item.updated_at?.slice(0, 10) ?? "undated";
	const kind = item.kind === "article" ? " · article" : "";
	const tail = theme.fg("dim", ` — ${item.publisher} · ${date}${kind}`);
	const budget = Math.max(20, width - visibleWidth(tail) - item.id.length - 4);
	const title = item.title.length > budget ? `${item.title.slice(0, budget - 1)}…` : item.title;
	return `${theme.fg("accent", `[${item.id}]`)} ${title}${tail}`;
}

function renderReply(result: { details?: unknown }, expanded: boolean, theme: Theme, width = 100): Text {
	const reply = result.details as Reply | undefined;
	if (!reply) return new Text(theme.fg("muted", "no result"), 0, 0);
	const lines = [theme.fg("muted", summarize(reply))];
	const shown = expanded ? reply.evidence : reply.evidence.slice(0, COLLAPSED_ITEMS);
	for (const item of shown) lines.push(evidenceLine(item, theme, width));
	if (!expanded && reply.evidence.length > shown.length) {
		lines.push(theme.fg("dim", `… ${reply.evidence.length - shown.length} more (expand to see all)`));
	}
	if (expanded) for (const note of reply.limitations) lines.push(theme.fg("warning", `note: ${note}`));
	return new Text(lines.join("\n"), 0, 0);
}

function readGuidance(path: string): string {
	try {
		const text = readFileSync(path, "utf8");
		return text.length > MAX_GUIDANCE_BYTES ? text.slice(0, MAX_GUIDANCE_BYTES) : text;
	} catch {
		return "";
	}
}

/** Build the extension factory; the CLI passes its own config and result hook. */
export function createSourceSiftExtension(options: SourceSiftOptions = {}) {
	return function sourcesift(pi: ExtensionAPI): void {
		const config = options.config ?? loadConfig();
		const catalog = buildCatalog(config);
		const version = packageVersion();

		// Session-scoped state, restored from the active branch so /resume and /fork work.
		let evidence = new Map<string, Evidence>();
		let nextId = 1;
		let limitations: string[] = [];
		let turns = 0;
		let disabledIds = new Set<string>();
		let guidance = "";
		let lastHttp = 0;
		const cache = new PageCache(config.limits.feedCacheSeconds);
		let requestRender: (() => void) | undefined;
		// Run-scoped state.
		let current: Research | null = null;
		let repairs = 0;

		const activeRegistry = () => new SourceRegistry(catalog.list().filter((source) => !disabledIds.has(source.id)));

		function status(ctx: ExtensionContext): void {
			ctx.ui.setStatus("sourcesift", `${activeRegistry().list().length} sources · ${evidence.size} evidence`);
			requestRender?.();
		}

		function restore(ctx: ExtensionContext): void {
			evidence = new Map();
			nextId = 1;
			limitations = [];
			turns = 0;
			disabledIds = new Set();
			for (const entry of ctx.sessionManager.getBranch()) {
				if (entry.type !== "custom" || !entry.data) continue;
				if (entry.customType === STATE_ENTRY) {
					const state = entry.data as SessionState;
					evidence = new Map(Object.entries(state.evidence));
					nextId = state.nextId;
					limitations = state.limitations;
					turns = state.turns;
				} else if (entry.customType === SOURCES_ENTRY) {
					disabledIds = new Set((entry.data as SourcesState).disabled);
				}
			}
			status(ctx);
		}

		function installChrome(ctx: ExtensionContext): void {
			ctx.ui.setTitle("SourceSift");
			ctx.ui.setHeader((_tui, theme) => ({
				invalidate() {},
				render(width: number): string[] {
					const title = `${theme.fg("accent", theme.bold("SourceSift"))} ${theme.fg("dim", `v${version}`)}`;
					const lines = [
						"",
						truncateToWidth(
							`${title}  ${theme.fg("muted", "research from registered sources, answered with cited evidence")}`,
							width,
						),
						truncateToWidth(
							theme.fg(
								"dim",
								`${activeRegistry().list().length} sources · /sources · /evidence · /read S3 · /model · /thinking · /help · Esc interrupt · Ctrl+C exit`,
							),
							width,
						),
					];
					if (!ctx.model) {
						lines.push(
							truncateToWidth(
								theme.fg("warning", "No model yet: run /login openrouter (or set OPENROUTER_API_KEY), then /model."),
								width,
							),
						);
					}
					lines.push("");
					return lines;
				},
			}));
			ctx.ui.setFooter((tui, theme) => {
				requestRender = () => tui.requestRender();
				return {
					dispose() {
						requestRender = undefined;
					},
					invalidate() {},
					render(width: number): string[] {
						const left = theme.fg(
							"dim",
							`${activeRegistry().list().length} sources · ${evidence.size} evidence · ${lastHttp} http · ${turns} turn${turns === 1 ? "" : "s"}`,
						);
						const model = ctx.model ? `${ctx.model.id} • ${pi.getThinkingLevel()}` : "no model";
						const right = theme.fg("dim", model);
						const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
						return [truncateToWidth(left + pad + right, width)];
					},
				};
			});
		}

		pi.on("session_start", (_event, ctx) => {
			cache.clear();
			guidance = readGuidance(config.guidancePath);
			if (ctx.mode === "tui") installChrome(ctx);
			restore(ctx);
		});
		pi.on("session_tree", (_event, ctx) => restore(ctx));
		pi.on("session_shutdown", (_event, ctx) => ctx.ui.setStatus("sourcesift", undefined));

		// This tool has no shell story: the model has no bash, and neither does the `!` prefix.
		pi.on("user_bash", () => ({
			result: {
				output: "Shell commands are disabled in ssift. It only reads registered sources and URLs you supply.",
				exitCode: 1,
				cancelled: false,
				truncated: false,
			},
		}));

		pi.on("before_agent_start", (event) => {
			pi.setActiveTools(TOOL_NAMES);
			const prompt = event.messageType === "user" ? event.prompt : "";
			const registry = activeRegistry();
			current = new Research(config, registry, new Fetcher(config.limits, cache), prompt, {
				previous: evidence,
				nextId,
			});
			repairs = 0;
			return {
				systemPrompt: buildInstructions({
					config,
					catalog: registry.list(),
					now: current.now,
					retained: [...evidence.values()],
					previousLimitations: limitations,
					session: turns > 0,
					guidance,
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
				renderResult(result, options, theme) {
					return renderReply(result, options.expanded, theme);
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
				renderResult(result, options, theme) {
					return renderReply(result, options.expanded, theme);
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
			if (message.stopReason === "length") {
				notes.push("The model reached its output token limit; the answer may be incomplete.");
			}
			const finalNotes = [...new Set(notes)];

			evidence = research.allEvidence();
			nextId = research.nextId;
			limitations = finalNotes;
			turns += 1;
			lastHttp = research.httpRequests;
			current = null;
			const state: SessionState = { evidence: Object.fromEntries(evidence), nextId, limitations, turns };
			status(ctx);
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
			const details = message.details as { references?: Reference[]; limitations?: string[] } | undefined;
			const content = details?.references
				? renderReferences(details.references, details.limitations ?? [], { links: true })
				: typeof message.content === "string"
					? message.content
					: "";
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

		// Make citations stand out in rendered answers without touching the stored text.
		pi.registerMarkdownTransformer((markdown, context) =>
			context.messageType === "assistant" ? markdown.replace(/(?<![*`])\[S(\d+)\](?![*`])/g, "**[S$1]**") : markdown,
		);

		pi.registerCommand("read", {
			description: "Read a cited article in full, for example /read S3",
			getArgumentCompletions: (prefix) => {
				const items = [...evidence.values()]
					.filter((item) => item.id.toLowerCase().startsWith(prefix.toLowerCase().replace(/^\[/, "")))
					.map((item) => ({ value: item.id, label: `${item.id} ${item.title.slice(0, 60)}` }));
				return items.length ? items : null;
			},
			handler: async (args, ctx) => {
				const id = parseCitation(args);
				const item = id ? [...evidence.values()].find((candidate) => candidate.id === id) : undefined;
				if (!item) {
					ctx.ui.notify(
						args.trim() ? `No evidence with ID ${args.trim()}. Try /evidence.` : "Usage: /read S3",
						"warning",
					);
					return;
				}
				pi.sendUserMessage(
					`Read [${item.id}] in full (${item.url}) and report what the article adds beyond the feed summary, citing it.`,
					ctx.isIdle() ? undefined : { deliverAs: "followUp" },
				);
			},
		});

		pi.registerCommand("sources", {
			description: "Show the registered sources; in the terminal, enable or disable them for this conversation",
			handler: async (_args, ctx) => {
				const sources = catalog.list();
				if (ctx.mode !== "tui") {
					const lines = sources.map(
						(source) =>
							`${disabledIds.has(source.id) ? "off" : "on "} ${source.id}: ${source.name} — ${source.topics.join(", ")}`,
					);
					ctx.ui.notify(lines.join("\n"), "info");
					return;
				}
				await ctx.ui.custom<undefined>((tui, theme, _keybindings, done) => {
					const items: SettingItem[] = sources.map((source) => ({
						id: source.id,
						label: source.name,
						description: source.description,
						currentValue: disabledIds.has(source.id) ? "disabled" : "enabled",
						values: ["enabled", "disabled"],
					}));
					const list = new SettingsList(
						items,
						Math.min(items.length + 2, 16),
						getSettingsListTheme(),
						(id, value) => {
							if (value === "disabled") disabledIds.add(id);
							else disabledIds.delete(id);
							pi.appendEntry<SourcesState>(SOURCES_ENTRY, { disabled: [...disabledIds] });
							status(ctx);
						},
						() => done(undefined),
					);
					return {
						render(width: number) {
							return [theme.fg("accent", theme.bold("Sources for this conversation")), "", ...list.render(width)];
						},
						invalidate() {
							list.invalidate();
						},
						handleInput(data: string) {
							list.handleInput?.(data);
							tui.requestRender();
						},
					};
				});
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
