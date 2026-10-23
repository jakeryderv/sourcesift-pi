# Configuration and context

The SDK and research runtime use one settings model for Python and the CLI.

## Location and precedence

The optional default file is `config.toml` in the platform's per-user `sourcesift`
configuration directory: `$XDG_CONFIG_HOME/sourcesift/` (normally
`~/.config/sourcesift/`) on Linux, `~/Library/Application Support/sourcesift/` on
macOS, and `%LOCALAPPDATA%\sourcesift\` on Windows. Use `SOURCESIFT_CONFIG` or an
explicit config path to select a different file. An explicitly selected file must
exist. Project directories and `.env` files are not searched automatically.

Settings resolve from defaults, then TOML, supported environment variables, and
explicit CLI/SDK overrides. An explicit config path overrides `SOURCESIFT_CONFIG`;
only that selected file is loaded. Unknown settings are rejected.

```toml
[agent]
model = "openai/gpt-6.1-sol"
reasoning_effort = "medium"

[context]
instructions_file = "context.md" # optional personal priorities and response preferences
files = ["project.md"]          # optional background documents

[limits]
max_input_bytes = 131072
max_context_files = 16
timeout_seconds = 60
max_output_tokens = 2048
```

No model is chosen implicitly. Interactive chat opens a setup panel when the model
or credential is missing; `/model` changes settings for that chat only. These
changes are not written to TOML or environment files. `SOURCESIFT_MODEL` overrides `[agent].model`.
`SOURCESIFT_REASONING_EFFORT` overrides `[agent].reasoning_effort`. Effort is optional;
omitting it uses the provider default. Accepted values are `none`, `minimal`, `low`,
`medium`, `high`, and `xhigh`; support depends on the selected model. The example
uses GPT-6.1 Sol at medium effort. Output token budgets can include reasoning tokens,
so increase the cap if the model exhausts it before producing an answer.
Set `OPENROUTER_API_KEY` in the process environment; credentials are not accepted
in TOML. SDK callers may pass a credential explicitly. Secrets are omitted from
settings representations and serialization. Neither credentials nor document text
are logged by SourceSift.

## Context inputs

Configured `files` are optional background information. `instructions_file` is an
explicitly selected personal guidance file: interests, priorities, and response
preferences, subordinate to the current task and grounding rules. It is not
automatically discovered from `AGENTS.md` or a project directory. The prompt determines the
current task. Context order is personal guidance, configured background files, SDK-supplied documents,
explicit file inputs, and piped stdin. Configured paths are relative to the TOML
file; explicit paths are relative to the working directory. `~` expands to the
user's home directory. Files must be regular UTF-8 text or Markdown files; PDF,
images, and other binary formats are not supported.

The input budget counts UTF-8 bytes in the prompt, document labels, and document
text together. Files and stdin are read with bounded sizes. Over-limit inputs are
rejected rather than truncated. The context count includes guidance, background files, SDK
documents, explicit files, and a supplied stdin stream. Empty stdin adds no document.
The configuration must be a regular file and has a 64 KiB limit.

The total timeout covers model calls and retrieval within one run. The output
cap applies to each model response. Input bytes are not model tokens: a model may
have a smaller context window. Context and retrieved evidence are sent to the
selected model through OpenRouter. Local configuration does not mean offline inference.

## Sources and freshness

```toml
[sources]
timezone = "America/Chicago" # default UTC; explicit IANA zone, not inferred locally
recent_days = 7
disabled = ["cnbc"]         # registered IDs; misspellings are errors

[[sources.custom]]
id = "example-publication"
name = "Example Publication"
website = "https://example.com/"
feeds = ["https://example.com/feed.xml"] # replace with real public URLs
description = "Research and developments in my field."
topics = ["research"]
geography = "United States"
capabilities = ["feed", "article"]
```

Custom definitions participate in normal semantic selection. Duplicate IDs, names,
or aliases are rejected. Omit `feeds` to discover declared RSS/Atom links on the
website. `disabled` applies before selection; it is not a prompt keyword filter.
See [research](research.md) for exact window and date rules.

## Research budgets

All are `[limits]` settings. Existing input limits above remain unchanged.

| Setting | Default | Meaning |
|---|---:|---|
| `timeout_seconds` | 60 | Total wall-clock timeout for model and retrieval |
| `max_output_tokens` | 2048 | Per-model-response output/reasoning budget |
| `max_model_requests` | 6 | All calls, including tool continuations and citation repair |
| `max_tool_calls` | 8 | Total agent tool calls |
| `max_sources` | 3 | Distinct registered sources attempted |
| `max_items` | 18 | Distinct evidence items retained |
| `max_items_per_source` | 6 | Accepted entries per source, most recent dated first |
| `max_articles` | 6 | Article attempts, including failures |
| `max_http_requests` | 24 | Requests including robots and redirects |
| `http_timeout_seconds` | 10 | One fetch, including DNS, robots, redirects, and body |
| `max_response_bytes` | 2097152 | Decoded response-body byte limit |
| `max_item_chars` | 10000 | Text per evidence item |
| `max_evidence_chars` | 60000 | Total retained evidence text |

HTTP and provider retries are disabled. Tools execute sequentially. HTTP allows
at most four redirects per fetch; parsing examines at most 200 feed entries and
discovery retains at most four declared feeds. One model retry can repair missing
or unknown citations, within the request limit. Tool/model budget exhaustion is a
model error; HTTP/source/evidence limits produce partial-coverage notes.

For longer research, a 180-second total timeout and 4096 output tokens can help;
these are the live evaluation settings. Raising limits increases possible latency
and provider cost. The SDK validates upper bounds on every numeric budget.

## Session limits and context reload

`ssift chat` and `app.session()` snapshot configured context and initial files at
creation. They keep that text stable until reset. `/new` clears completed
history and reloads those files; an unreadable file preserves the previous session.
Change model/source configuration by restarting chat or creating a new application.
One-off `ask` continues to load files for each request.

| Setting under `[limits]` | Default | Meaning |
|---|---:|---|
| `max_session_turns` | 20 | Maximum completed turns before starting fresh |
| `max_session_bytes` | 524288 | Serialized history/evidence budget, also checked with the next request payload |

All research budgets above apply per turn, including newly collected evidence.
History and retained evidence are separately bounded by `max_session_bytes`.
Bytes are a conservative application guard, not a tokenizer or a guarantee that
every provider context window fits. Over-limit turns fail without changing completed
history. Sessions are never silently truncated or summarized.
