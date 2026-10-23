/**
 * Fixed-case evaluation: runs ssift one-shot per case, checks source selection and
 * evidence presence automatically, and records answers and references for review.
 *
 * Usage: node scripts/eval.ts [--case id] [--model id] [--provider name] [--thinking level] [--out dir]
 * Requires a provider credential (for example OPENROUTER_API_KEY). Makes live model and feed requests.
 */

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

interface Case {
	id: string;
	prompt: string;
	expected_any?: string[];
	expected_only?: string[];
	expect_no_evidence?: boolean;
	expect_direct_url?: boolean;
}

interface Record_ {
	case: Case;
	started_at: string;
	elapsed_seconds: number;
	exit_code: number | null;
	model: string | null;
	selected_sources: string[];
	only_sources: string[];
	direct_urls: string[];
	tool_calls: { name: string; args: unknown }[];
	window: unknown;
	answer: string;
	references: unknown[];
	limitations: string[];
	usage: { input_tokens: number; cached_input_tokens: number; output_tokens: number; cost: number; requests: number };
	http_requests: number | null;
	stop_reason: string | null;
	error_message: string | null;
	checks: Record<string, boolean | null>;
	stderr: string;
}

const { values } = parseArgs({
	options: {
		case: { type: "string" },
		model: { type: "string" },
		provider: { type: "string" },
		thinking: { type: "string" },
		out: { type: "string", default: "evaluation-results" },
	},
});

const root = new URL("..", import.meta.url).pathname;
const cases = (JSON.parse(readFileSync(join(root, "evaluations", "cases.json"), "utf8")) as Case[]).filter(
	(item) => !values.case || item.id === values.case,
);
if (!cases.length) throw new Error(`No case named ${values.case}`);
mkdirSync(values.out, { recursive: true });

function runCase(item: Case): Promise<Record_> {
	const args = ["bin/ssift.js", "--mode", "json", "--no-session"];
	if (values.model) args.push("--model", values.model);
	if (values.provider) args.push("--provider", values.provider);
	if (values.thinking) args.push("--thinking", values.thinking);
	args.push(item.prompt);
	const started = Date.now();
	return new Promise((resolve) => {
		const child = spawn(process.execPath, args, { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.stderr.on("data", (chunk) => (stderr += chunk));
		child.on("close", (code) => {
			const record = summarize(item, stdout, stderr, code, (Date.now() - started) / 1000);
			writeFileSync(join(values.out, `${item.id}.events.jsonl`), stdout);
			resolve(record);
		});
	});
}

function summarize(item: Case, stdout: string, stderr: string, code: number | null, elapsed: number): Record_ {
	const events = stdout
		.split("\n")
		.filter(Boolean)
		.flatMap((line) => {
			try {
				return [JSON.parse(line)];
			} catch {
				return [];
			}
		});
	const record: Record_ = {
		case: item,
		started_at: new Date(Date.now() - elapsed * 1000).toISOString(),
		elapsed_seconds: Math.round(elapsed * 100) / 100,
		exit_code: code,
		model: null,
		selected_sources: [],
		only_sources: [],
		direct_urls: [],
		tool_calls: [],
		window: null,
		answer: "",
		references: [],
		limitations: [],
		usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, cost: 0, requests: 0 },
		http_requests: null,
		stop_reason: null,
		error_message: null,
		checks: {},
		stderr: stderr.trim(),
	};
	for (const event of events) {
		if (event.type === "tool_execution_start") {
			record.tool_calls.push({ name: event.toolName, args: event.args });
			if (event.toolName === "research") {
				record.only_sources.push(...(event.args.only_sources ?? []));
				record.direct_urls.push(...(event.args.direct_urls ?? []));
			}
		}
		if (event.type === "tool_execution_end" && event.result?.details) {
			const details = event.result.details;
			record.window = details.window ?? record.window;
			for (const evidence of details.evidence ?? []) {
				if (evidence.source_id && !record.selected_sources.includes(evidence.source_id))
					record.selected_sources.push(evidence.source_id);
			}
		}
		if (event.type === "message_end" && event.message?.role === "assistant") {
			const message = event.message;
			record.model = `${message.provider}/${message.model}`;
			record.usage.requests += 1;
			record.usage.input_tokens += message.usage?.input ?? 0;
			record.usage.cached_input_tokens += message.usage?.cacheRead ?? 0;
			record.usage.output_tokens += message.usage?.output ?? 0;
			record.usage.cost += message.usage?.cost?.total ?? 0;
			record.stop_reason = message.stopReason ?? null;
			record.error_message = message.errorMessage ?? null;
			if (message.stopReason !== "toolUse") {
				record.answer = message.content
					.filter((part: { type: string }) => part.type === "text")
					.map((part: { text: string }) => part.text)
					.join("");
			}
		}
		if (event.type === "entry_appended") {
			const entry = event.entry ?? event;
			if (entry.customType === "sourcesift-result" && entry.details) {
				record.references = entry.details.references ?? [];
				record.limitations = entry.details.limitations ?? [];
				record.http_requests = entry.details.http_requests ?? null;
			}
		}
	}
	const selected = new Set(record.selected_sources);
	record.checks.completed = code === 0 && record.answer.length > 0;
	// A provider failure (capacity, auth, outage) is reported on its own; the quality checks are
	// left undecided rather than counted as application failures.
	const providerError = record.stop_reason === "error";
	record.checks.provider = !providerError;
	if (providerError) return record;
	record.checks.selection = item.expected_any ? item.expected_any.some((id) => selected.has(id)) : null;
	record.checks.only = item.expected_only
		? record.selected_sources.every((id) => item.expected_only?.includes(id))
		: null;
	record.checks.evidence_presence = item.expect_no_evidence
		? record.references.length === 0
		: record.references.length > 0;
	record.checks.direct_url = item.expect_direct_url ? record.direct_urls.length > 0 : null;
	record.checks.citations_valid = !record.limitations.some((note) =>
		note.startsWith("The answer cites IDs with no retrieved evidence"),
	);
	return record;
}

const records: Record_[] = [];
for (const item of cases) {
	process.stderr.write(`running ${item.id}… `);
	const record = await runCase(item);
	records.push(record);
	writeFileSync(join(values.out, `${item.id}.json`), `${JSON.stringify(record, null, 2)}\n`);
	const failed = Object.entries(record.checks)
		.filter(([, value]) => value === false)
		.map(([key]) => key);
	process.stderr.write(
		`${failed.length ? `FAIL ${failed.join(", ")}` : "ok"} (${record.elapsed_seconds}s, ${record.usage.requests} model calls, $${record.usage.cost.toFixed(4)})\n`,
	);
}

const summary = {
	ran_at: new Date().toISOString(),
	model: records[0]?.model ?? null,
	cases: records.map((record) => ({
		id: record.case.id,
		checks: record.checks,
		selected_sources: record.selected_sources,
		references: record.references.length,
		elapsed_seconds: record.elapsed_seconds,
		model_requests: record.usage.requests,
		http_requests: record.http_requests,
		cost: Math.round(record.usage.cost * 10000) / 10000,
	})),
};
writeFileSync(join(values.out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
const failures = summary.cases.filter((item) => Object.values(item.checks).includes(false));
process.stderr.write(
	`\n${summary.cases.length - failures.length}/${summary.cases.length} cases passed automatic checks; records in ${values.out}/\n`,
);
process.exitCode = failures.length ? 1 : 0;
