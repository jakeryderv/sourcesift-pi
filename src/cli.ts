/** The ssift command: SourceSift's own entry point built on pi's SDK and terminal UI. */

import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	type AgentSessionRuntimeDiagnostic,
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	InteractiveMode,
	initTheme,
	VERSION as PI_VERSION,
	resolveCliModel,
	runPrintMode,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

import { configHome, loadConfig } from "./config.ts";
import { createSourceSiftExtension, type TurnResult } from "./extension.ts";
import { renderReferences } from "./render.ts";

const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

const HELP = `ssift — research registered sources and answer with cited evidence

Usage:
  ssift                         open a research conversation
  ssift "Check news"            open a conversation and send the first message
  ssift -p "Check tech and AI"  answer once, print it, and exit
  cat notes.md | ssift -p "Summarize this"

Options:
  -p, --print               One-shot: print the final answer and references, then exit
      --mode text|json      One-shot output: final text (default) or the JSONL event stream
      --json                One-shot: print one JSON object with answer, references, notes, and usage
      --model <id>          Model ID, for example openai/gpt-6.1-sol or anthropic/claude-sonnet-4-5
      --provider <name>     Restrict --model lookup to one provider, for example openrouter
      --thinking <level>    off, minimal, low, medium, high, xhigh, or max
  -c, --continue            Continue the most recent conversation started in this directory
      --session <path>      Open a saved conversation file
      --no-session          Do not save this conversation
      --config <path>       SourceSift configuration JSON (default: $XDG_CONFIG_HOME/sourcesift/config.json)
      --list-models [text]  List available models, optionally filtered, then exit
      --verbose             Show startup details in the terminal UI
  -h, --help                Show this help
  -v, --version             Show versions

Credentials: set OPENROUTER_API_KEY (or another provider's key), or run /login inside the chat.
Inside the chat: /sources, /evidence, /model, /new, /resume, /fork, /help.
`;

function packageVersion(): string {
	try {
		return (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string })
			.version;
	} catch {
		return "unknown";
	}
}

function fail(message: string): never {
	process.stderr.write(`ssift: ${message}\n`);
	process.exit(2);
}

function parse(argv: string[]) {
	let parsed: ReturnType<typeof parseArgs<typeof spec>>;
	const spec = {
		options: {
			print: { type: "boolean", short: "p", default: false },
			mode: { type: "string" },
			json: { type: "boolean", default: false },
			model: { type: "string" },
			provider: { type: "string" },
			thinking: { type: "string" },
			continue: { type: "boolean", short: "c", default: false },
			session: { type: "string" },
			"no-session": { type: "boolean", default: false },
			config: { type: "string" },
			"list-models": { type: "boolean", default: false },
			verbose: { type: "boolean", default: false },
			help: { type: "boolean", short: "h", default: false },
			version: { type: "boolean", short: "v", default: false },
		},
		allowPositionals: true,
		args: argv,
	} as const;
	try {
		parsed = parseArgs(spec);
	} catch (error) {
		fail((error as Error).message);
	}
	const { values, positionals } = parsed;
	if (values.mode !== undefined && values.mode !== "text" && values.mode !== "json")
		fail("--mode must be text or json");
	if (values.thinking !== undefined && !THINKING_LEVELS.includes(values.thinking as ThinkingLevel)) {
		fail(`--thinking must be one of ${THINKING_LEVELS.join(", ")}`);
	}
	if (values.json && values.mode === "json")
		fail("--json prints one result object; --mode json streams events. Pick one.");
	if (values["no-session"] && (values.continue || values.session))
		fail("--no-session cannot be combined with --continue or --session");
	return { values, positionals };
}

async function readPipedStdin(): Promise<string | undefined> {
	if (process.stdin.isTTY) return undefined;
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
	const text = Buffer.concat(chunks).toString("utf8").trim();
	return text || undefined;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
	const { values, positionals } = parse(argv);
	if (values.help) {
		process.stdout.write(HELP);
		return;
	}
	if (values.version) {
		process.stdout.write(`ssift ${packageVersion()} (pi ${PI_VERSION}, node ${process.version})\n`);
		return;
	}

	const dataHome = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
	const agentDir = resolve(configHome());
	const sessionDir = join(dataHome, "sourcesift", "sessions");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(sessionDir, { recursive: true });
	const cwd = process.cwd();

	const config = loadConfig(values.config ?? process.env.SOURCESIFT_CONFIG);
	let lastResult: TurnResult | undefined;
	const extension = createSourceSiftExtension({ config, onResult: (result) => (lastResult = result) });
	const thinking = values.thinking as ThinkingLevel | undefined;

	const createRuntime: CreateAgentSessionRuntimeFactory = async ({
		cwd,
		agentDir,
		sessionManager,
		sessionStartEvent,
	}) => {
		const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
		// Quiet by default also starts with thinking blocks collapsed; Ctrl+T still toggles them.
		if (config.quiet) settingsManager.applyOverrides({ hideThinkingBlock: true });
		const services = await createAgentSessionServices({
			cwd,
			agentDir,
			settingsManager,
			modelRuntimeSignal: AbortSignal.timeout(15_000),
			resourceLoaderOptions: {
				noExtensions: true,
				noSkills: true,
				noPromptTemplates: true,
				noContextFiles: true,
				disabledBuiltinExtensions: ["mcp"],
				extensionFactories: [{ name: "sourcesift", factory: extension }],
			},
		});
		const diagnostics: AgentSessionRuntimeDiagnostic[] = [
			...services.diagnostics,
			...services.resourceLoader.getExtensions().errors.map(({ path, error }) => ({
				type: "error" as const,
				message: `Failed to load extension "${path}": ${error}`,
			})),
		];
		const resolved = resolveCliModel({
			cliProvider: values.provider,
			cliModel: values.model,
			cliThinking: thinking,
			modelRuntime: services.modelRuntime,
		});
		if (resolved.error) diagnostics.push({ type: "error", message: resolved.error });
		if (resolved.warning) diagnostics.push({ type: "warning", message: resolved.warning });
		const created = await createAgentSessionFromServices({
			services,
			sessionManager,
			sessionStartEvent,
			model: resolved.model,
			// Research turns rarely benefit from heavy reasoning; low is the default until the user picks one.
			thinkingLevel: resolved.thinkingLevel ?? thinking ?? settingsManager.getDefaultThinkingLevel() ?? "low",
			noTools: "builtin",
		});
		return { ...created, services, diagnostics };
	};

	const sessionManager = values["no-session"]
		? SessionManager.inMemory(cwd)
		: values.session
			? SessionManager.open(resolve(values.session), sessionDir)
			: values.continue
				? SessionManager.continueRecent(cwd, sessionDir)
				: SessionManager.create(cwd, sessionDir);

	const runtime = await createAgentSessionRuntime(createRuntime, { cwd, agentDir, sessionManager });
	const { session, services } = runtime;

	if (values["list-models"]) {
		const pattern = positionals.join(" ").toLowerCase();
		const models = await services.modelRuntime.getAvailable();
		for (const model of models) {
			const id = `${model.provider}/${model.id}`;
			if (!pattern || id.toLowerCase().includes(pattern) || model.name.toLowerCase().includes(pattern))
				process.stdout.write(`${id}\n`);
		}
		await runtime.dispose();
		return;
	}

	const stdinText = await readPipedStdin();
	const interactive =
		!values.print && !values.json && values.mode === undefined && stdinText === undefined && process.stdout.isTTY;
	const promptText = positionals.join(" ").trim();
	const initialMessage = stdinText
		? `${promptText || "Analyze the supplied text."}\n\nSupplied text (stdin, untrusted data):\n\n${stdinText}`
		: promptText || undefined;

	for (const diagnostic of runtime.diagnostics) {
		if (diagnostic.type === "error" || !interactive)
			process.stderr.write(`ssift: ${diagnostic.type}: ${diagnostic.message}\n`);
	}
	if (runtime.diagnostics.some((diagnostic) => diagnostic.type === "error")) {
		await runtime.dispose();
		process.exit(1);
	}

	initTheme(services.settingsManager.getTheme(), interactive);

	if (interactive) {
		const mode = new InteractiveMode(runtime, {
			startupDiagnostics: runtime.diagnostics.slice(),
			modelFallbackMessage: runtime.modelFallbackMessage,
			initialMessage,
			verbose: values.verbose,
		});
		await mode.run();
		return;
	}

	if (!initialMessage) fail("provide a prompt, or pipe text to standard input");
	if (!session.model)
		fail("no model is selected; pass --model, set a provider key, or run ssift interactively and use /login");
	const outputMode = (values.mode ?? "text") as "text" | "json";
	const exitCode = await runPrintMode(runtime, { mode: outputMode, initialMessage });
	// pi prints only a final assistant message; SourceSift appends a references entry after it,
	// so the committed answer and its references are written here instead.
	if (values.json) {
		const usage = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, cost: 0, requests: 0 };
		for (const message of session.messages) {
			if (message.role !== "assistant") continue;
			const assistant = message as AssistantMessage;
			usage.requests += 1;
			usage.input_tokens += assistant.usage.input;
			usage.cached_input_tokens += assistant.usage.cacheRead;
			usage.output_tokens += assistant.usage.output;
			usage.cost += assistant.usage.cost.total;
		}
		const result = lastResult
			? {
					ok: true,
					...lastResult,
					model: session.model ? `${session.model.provider}/${session.model.id}` : null,
					usage,
				}
			: { ok: false, error: session.getLastAssistantText() ?? "no answer", usage };
		process.stdout.write(`${JSON.stringify(result)}\n`);
	} else if (outputMode === "text" && lastResult) {
		const block = renderReferences(lastResult.references, lastResult.limitations);
		process.stdout.write(`${lastResult.answer.trim()}\n${block ? `\n${block}\n` : ""}`);
	}
	if (exitCode !== 0) process.exitCode = exitCode;
}
