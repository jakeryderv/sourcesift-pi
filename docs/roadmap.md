# SourceSift — Development Roadmap

**Goal:** Incrementally build a Python-first research agent that understands requests
such as “check news” and “check tech,” selects relevant registered sources, and
returns grounded responses through interactive terminal chat, a reusable SDK, and
a composable one-off CLI.

**Status:** Phases 0–3 are implemented: package/release tooling, supplied-context
requests, grounded research, and ephemeral interactive sessions with a Textual TUI.
Examples in later phases remain planned behavior.

**Related documents:** [Use cases and product scope](use-cases.md),
[architecture and proposed contracts](design.md), and [setup and releases](https://github.com/jakeryderv/sourcesift#readme).
The Markdown files directly under `docs/` are the maintained project reference;
`docs/capstone/` contains archived course material.

## Guiding Principles

- **Python-first:** Core, SDK, plugins, and CLI start in Python.
- **Working software first:** Each phase produces an observable capability.
- **Prompt-driven:** Natural-language requests guide selection using registered
  links, metadata, and descriptions. Users do not need category-specific flags.
- **Stateless by default:** Configuration files and per-run memory are sufficient
  for initial research; an application database is optional future work.
- **Shared contracts:** Built-in capabilities establish the interfaces that
  third-party plugins later use.
- **Evidence early:** Evaluate source selection, grounding, and failure behavior
  alongside retrieval, before adding richer interfaces.
- **Incremental complexity:** Keep PydanticAI + OpenRouter fixed; introduce
  persistence and Rust only when the relevant phase justifies them.

## Phase 0 — Package and Release Foundation

Completed foundation:

- [x] Initialize the Python library and uv lockfile.
- [x] Publish the `0.0.1` scaffold on PyPI.
- [x] Add Apache 2.0 licensing and initial package metadata.
- [x] Configure lint, format, type, and distribution checks in CI for Python 3.11–3.14.
- [x] Configure GitHub Release publishing through the `pypi` trusted publisher.
- [x] Document development and release commands in the README.
- [x] Add release PRs, generated changelogs, and version/lockfile consistency checks.
- [x] Add Conventional Commit PR-title checks, workflow linting, and release-guard tests.
- [x] Require PRs and passing CI on main, use squash merges, and protect release tags.

The original `hello()` greeting remains available for compatibility. Packaging and
release success are separate from the application milestones below.

## Phase 1 — Core Agent, Context, and CLI

**Goal:** Run a single request with optional supplied context through Python and
`ssift`, establishing the common application interface.

### Implementation

- [x] Establish the minimal application, request/result, and configuration models.
- [x] Integrate PydanticAI with OpenRouter and configurable model selection.
- [x] Implement the proposed `SourceSift` SDK with async execution and a synchronous convenience method.
- [x] Implement Cyclopts CLI and the `ssift` entry point.
- [x] Support prompts, file context, and piped/redirected stdin.
- [x] Support optional Markdown user context referenced from TOML configuration.
- [x] Finalize configuration locations, precedence, relative-path rules, and supported environment variables.
- [x] Render Markdown/plain text to stdout and diagnostics/errors to stderr.
- [x] Define exit behavior and avoid requiring interactive input for `ask`.
- [x] Set initial request/input limits and report missing credentials or model failures clearly.
- [x] Add deterministic checks for configuration, input handling, output, and failure behavior.

### Example Usage

```bash
ssift ask "Summarize this document" --file report.md
cat report.md | ssift ask "Summarize this" > summary.md
ssift ask "Summarize this" < report.md
```

### Completion Criteria

- A script and the CLI can run equivalent requests using the same application code.
- Supplied context is loaded consistently; piped output contains the result rather than progress messages.
- Invalid inputs and provider failures produce useful diagnostics and documented exit behavior.
- Claims about current events are not presented as freshly verified in this phase,
  which has no source retrieval yet.

**Use cases:** Establishes input/context foundations for UC-05 and UC-08. Their
research behavior is completed with source retrieval, not by this phase alone.

Phase 1 validation includes deterministic SDK/CLI tests, an in-memory OpenRouter
transport, Unicode input properties, a 90% application branch-coverage gate, and
installed CLI checks. A separate opt-in live check exercises a synthetic document;
ordinary CI requires no credentials. See the [CLI](cli.md), [SDK](sdk.md), and
[configuration](configuration.md) guides for implemented contracts.

## Phase 2 — Registered Sources and Grounded Research

**Goal:** Deliver the first complete research flow: prompt → relevant sources →
retrieved evidence → useful response with references.

### Implementation

- [x] Define source records with IDs, names, links, descriptions, coverage metadata, and access capabilities.
- [x] Implement an in-memory source registry and minimal shared source/extractor/tool contracts.
- [x] Add a small verified collection covering US national news, technology, AI, business, marketing, and finance.
- [x] Implement HTTP retrieval, RSS/Atom parsing, feed discovery, and article extraction.
- [x] Reuse retrieval adapters across source records rather than requiring a plugin for every feed.
- [x] Select enabled registered sources semantically from the request and optional user context.
- [x] Recognize named publications and direct article URLs in prompts.
- [x] Expose bounded retrieval tools to the agent, including follow-up retrieval within one request.
- [x] Preserve provenance and available publication/update/retrieval timestamps.
- [x] Normalize content and deduplicate repeated items within a run.
- [x] Return references, coverage limitations, and meaningful partial-failure information.
- [x] Finalize freshness windows, time-zone handling, and limits on retrieval, retries, and model/tool use.
- [x] Add fixture-based checks and a small separately runnable live evaluation set.

### Example Usage

```bash
ssift ask "Check news"
ssift ask "Check tech and AI"
ssift ask "Check business, marketing, and finance this week"
ssift ask "Find developments relevant to this project" --file project.md
ssift ask "Summarize this article: https://example.com/article"
```

### Completion Criteria

- “Check news” selects relevant sources from the initial US national news collection.
- Topic requests select appropriate registered sources without exact category keywords or source flags.
- Personal/document context can guide source selection and the relevance of the answer.
- References identify retrieved evidence supporting the answer.
- Requests naming a particular source are respected or produce an explicit access/coverage limitation.
- Source failures, undated content, and insufficient evidence are handled without inventing current reporting.
- The entire flow works without a database, saved session, or TUI.

**Use cases:** UC-01, UC-02, UC-04, UC-05, UC-06, and UC-08 within initial coverage.
UC-03 remains a later geographic expansion; unsupported locations already need
honest coverage handling.

### Initial Evaluation Cases

Use a small fixed set of requests and captured source fixtures to check selection,
retrieval, references, and failure behavior. Include overlapping tech/AI metadata,
context-based relevance, a named-source request, unavailable sources, duplicate
articles, and missing or out-of-window dates.

Run live source/model evaluations separately, recording the model, request/context,
source set, time window, relevance judgments, citation support, latency, and usage.
Choose measurable quality targets from that baseline before expanding the catalog.

## Phase 3 — Interactive Research Sessions and Terminal UI

**Goal:** Make ongoing research conversations the main interactive experience,
while preserving `ssift ask` for quick requests and automation.

### Implementation

- [x] Add a frontend-independent Python session API with conversation and evidence history.
- [x] Keep stable citation IDs and provenance when following up or reading an article.
- [x] Add transactional turns: errors and cancellation preserve completed history.
- [x] Bound session history by turn count and serialized bytes; request a new session at the limit.
- [x] Stream provisional drafts and tool progress, then display only validated final answers.
- [x] Add `ssift chat` using Textual, Rich, and asyncio with one active turn per session.
- [x] Support multiline input, cancel/new-session shortcuts, citations, and loaded-context inspection.
- [x] Load explicit personal Markdown guidance alongside ordinary background documents.
- [x] Snapshot context at session start and reload it when starting fresh.
- [x] Keep storage optional: sessions remain in memory, without automatic persistence.

### Completion Criteria

A user can ask “check tech,” follow with “read the second article,” and discuss
that evidence with stable citations and disclosed retrieval dates. They can cancel
an active turn without losing completed history, inspect context, and start fresh.
The SDK exposes the same session behavior. One-off CLI output remains pipe-friendly.

See [interactive chat](chat.md) for commands, limits, and session semantics.

### Interactive workflow refinements

Prioritized before recommendation workflows:

- [x] Make bare `ssift` open chat in a terminal; keep `ask` for one-off/script use.
- [x] Add fuzzy slash-command completion with descriptions and keyboard navigation.
- [x] Add an ignore-aware `@` file picker with visible, removable per-turn attachments.
- [x] Preserve multiline editing, unsent drafts, and local prompt recall.
- [x] Add `/model` and initial model/key setup panels; keep changes in memory.
- [x] Complete model IDs/names from a cached public catalog, with manual-entry fallback.
- [x] Add discoverable help and context panels, and validate picker/cancellation behavior.

## Phase 4 — Discovery Workflows and Recommendations

**Goal:** Expand the initial research flow into reusable briefings and structured
article recommendations, guided by real interactive usage.

### Implementation

- [ ] Define structured relevance, categorization, and ranking results.
- [ ] Produce personalized recommendations with explanations based on explicit context.
- [ ] Support reusable workflows for repeated briefing/research tasks.
- [ ] Add workflow and ranking extension points where required by actual implementations.
- [ ] Evaluate recommendation quality and duplicate-story handling on labeled examples.

### Example Usage

```bash
ssift ask "Check tech and AI; recommend the five articles most relevant to my work"
ssift ask "Give me a weekly business and marketing briefing" > briefing.md
```

### Completion Criteria

A request can produce a useful ranked briefing across relevant registered sources,
explain why items matter, and retain evidence and limitations. Evaluation compares
recommendations against labeled relevance judgments. Saved history and automatic
preference learning remain unnecessary.

**Use cases:** Deepens UC-01, UC-02, UC-04, UC-05, and UC-08.

## Phase 5 — Third-Party Plugins and Public SDK

**Goal:** Extend the working built-in interfaces without modifying the core.

### Implementation

- [ ] Refine the source, extractor, and tool contracts proven by Phase 2.
- [ ] Support plugin discovery through Python package entry points.
- [ ] Define registration, enablement, duplicate-name, and load-failure behavior.
- [ ] Expose registration through the SDK and basic inspection through the CLI.
- [ ] Create an example external plugin and document installation into SourceSift's environment.
- [ ] Verify that custom source metadata participates in ordinary prompt-driven selection.
- [ ] Document trusted in-process plugin execution and the current compatibility boundary.

### Example Usage

```bash
ssift plugin list
ssift ask "Check tech"
```

```python
from sourcesift import SourceSift

app = SourceSift()
# Enabled plugins add source definitions and tools to this application.
result = app.run_sync("Check tech")
print(result.answer)
```

### Completion Criteria

A developer can install a custom source or tool plugin and use it through the same
SDK/CLI request flow. Built-ins and extensions share contracts, and a broken or
conflicting plugin produces actionable diagnostics.

**Use cases:** UC-07, extending the existing research use cases. Workflow, ranker,
and command extensions are added when concrete uses require them.

## Phase 6 — Optional Persistence and Archive Search

**Goal:** Add durable state when saved research and cross-run history justify it.

### Implementation

- [ ] Add SQLite storage and migrations for saved articles, evaluations, and research results.
- [ ] Define retention, deletion, and optional caching behavior.
- [ ] Deduplicate content across saved runs and add FTS5 archive search.
- [ ] Support recommendation history and explicit feedback.
- [ ] Consider saved profiles and conversations separately from existing context files.
- [ ] Preserve the ordinary stateless request path.

### Completion Criteria

Users can opt into saved research and search that archive without a server.
Database state remains optional for `ask`; archive search is clearly distinguished
from retrieval of current external information. New archive use cases should be
added to the product document before finalizing commands.

## Later Extensions — Driven by Demonstrated Need

These are independent follow-ups, not mandatory gates before shipping useful releases:

- **Geographic coverage:** Expand the curated collection to local and global news,
  validate source coverage, and deliver UC-03. This does not require persistence.
- **Rust optimization:** Profile first. Add PyO3/Maturin components only for measured
  benefits, preserve Python contracts, and validate platform-specific wheels.
- **Ecosystem maturity:** Stabilize SDK/plugin compatibility, expand examples and
  user guides, and add contributor guidance when needed.

Email integrations, general crawling/open-web search, browser automation, hosted
services, complex multi-agent orchestration, semantic/vector search, and automatic
long-term preference learning remain outside the initial plan.

## Release and Documentation Work Across Phases

The publishing foundation already exists. Release useful increments throughout the
roadmap rather than waiting for persistence, a TUI, or Rust.

For each implemented capability:

- Extend meaningful tests and CI checks alongside the feature.
- Update maintained docs and distinguish available behavior from proposals.
- Check installation and the CLI entry point once it exists.
- Update package metadata as the implementation evolves.
- Use the version/tag and publishing process documented in the README.

## Priorities

| Priority | Focus | Phase |
|---|---|---|
| Complete | Published scaffold and CI/release foundation | 0 |
| Complete | SDK, context, and composable CLI | 1 |
| Complete | Semantic source selection and grounded research | 2 |
| Complete | Interactive sessions and Textual chat | 3 |
| P1 | Reusable briefings and recommendations | 4 |
| Later | Third-party plugins and SDK extension contracts | 5 |
| Optional | Persistence and archive search | 6 |
| As justified | Wider geography, native optimization, ecosystem maturity | Later extensions |

**Core progression:**

`SDK + CLI → Registered Sources + Grounded Research → Interactive Sessions + TUI → Richer Briefings → Plugins`

Persistence, broader coverage, and native/frontend extensions build on that core
when their own use cases justify them.
