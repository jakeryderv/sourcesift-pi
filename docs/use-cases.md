# SourceSift — Use Cases & Product Philosophy

**Status:** Maintained product reference. Phases 1–3 implement supplied
context, bounded research from registered sources, and interactive terminal chat. These use cases also describe
later product goals; plugin discovery, ranking workflows, and local/global expansion
remain later work. See the [research guide](research.md)
for current coverage and limitations.

**Related documents:** [Design and proposed interfaces](design.md),
[implementation roadmap](roadmap.md), and [current package setup](https://github.com/jakeryderv/sourcesift#readme).
The Markdown documents directly under `docs/` describe the current project;
`docs/capstone/` contains archived course material.

## 1. Purpose

SourceSift is a source-centric, plugin-driven information agent that discovers, retrieves, and evaluates information from configurable sources.

Its purpose is to help users stay informed, investigate topics, and discover relevant information without manually searching through numerous websites, feeds, or publications.

SourceSift combines:

- A curated collection of useful information sources.
- Prompt-driven source selection using registered links, metadata, and descriptions.
- Agent-powered research, analysis, and synthesis.
- User-defined context, interests, and preferences.
- An extensible Python SDK and plugin ecosystem.
- An interactive research conversation with a simple terminal interface.
- A composable command-line interface for quick one-off tasks.

**Core philosophy:** Bring relevant information to the user from appropriate sources, rather than requiring the user to find and search each source individually.

## 2. Product Principles

### Sources First

Sources are first-class components of the system.

Each registered source carries links, descriptive metadata, and a brief description
of what it provides. SourceSift uses those descriptions to select appropriate
sources for the user's request.

The ordinary interaction should be simple:

```bash
ssift ask "Check news"
ssift ask "Check tech"
ssift ask "Check AI, business, marketing, and finance this week"
```

Selection is semantic: users describe what they want in natural language. They do
not need to select feeds, know exact category names, or use a source-filter flag.
“Tech” and “technology developments,” for example, should express similar intent.
This does not require a semantic-search index or vector database.

### Plugin-Driven

Built-in functionality and third-party extensions use the same plugin interfaces.

Users can extend or customize:

- Sources and content providers.
- Extraction and retrieval methods.
- Agent tools and capabilities.
- Research and processing workflows.
- Relevance and ranking behavior.
- CLI functionality.

The plugin system extends SourceSift's capabilities without requiring replacement of its PydanticAI/OpenRouter foundation.

### Context-Driven Relevance

Relevance is defined primarily through explicit user-provided context rather than automatically learned preferences.

Users can describe their interests, occupation, industries, locations, priorities, and other relevant information.

This context guides source selection, evaluation, and response generation.

### Stateless by Default

SourceSift should provide useful results without requiring persistent storage or an application database.

Each request can retrieve current information, evaluate it, and return a response.

Configuration and context files are compatible with this approach, as is state
held in memory during a request or conversation. Caching, search indexes, historical tracking, and
persistent sessions are optional future enhancements.

### Composable and Programmable

SourceSift should work through both its Python SDK and CLI.

CLI commands should support stdin/stdout, file inputs, Markdown output, and Unix piping/redirection.

## 3. Source Model

### Source Metadata

Each registered source can provide descriptive metadata for discovery, filtering, and agent selection.

| Metadata | Purpose | Examples |
|---|---|---|
| Name / ID | Identify the source | `example-news` |
| Links | Locate its content | Website URL, RSS/Atom feed URL |
| Description | Explain the source's purpose | General news coverage |
| Type | Describe its integration | RSS, website, API |
| Categories | Describe subject coverage | News, technology, AI, finance |
| Industries | Identify specialized coverage | Marketing, healthcare, energy |
| Geography | Describe geographic coverage | US national initially; local/global collections later |
| Location | Identify geographic relevance | United States; finer locations as coverage expands |
| Language | Describe supported languages | English |
| Capabilities | Describe available operations | Latest articles, search, retrieval |
| Requirements | Describe access needs | Public, API key, authentication |

Metadata is descriptive and extensible, rather than a rigid classification system.

Sources may belong to multiple categories, industries, or geographic regions.
These labels guide interpretation; they are not an exact-match command language.
Many source definitions can share the same retrieval integration, such as RSS,
without each publication requiring a separate plugin.

### Source vs. Article Metadata

Source metadata describes the source's general coverage and capabilities.

Article metadata describes an individual piece of content, such as its title, publication date, author, topic, and geographic relevance.

A source's categories should not automatically determine the categories of every article it publishes.

### Source Selection

SourceSift should use the user's prompt, configured context, and available source metadata to identify appropriate sources.

Selection may involve:

1. Understanding the information being requested.
2. Identifying relevant topics, industries, and geography.
3. Selecting appropriate available sources.
4. Retrieving and evaluating relevant content.
5. Producing a grounded response with source references.

Users can also name a publication or include an article URL directly in the
prompt. Requests to use only a named source should guide source selection, with a
clear limitation if that source cannot be identified or accessed. Ordinary usage
does not require a separate `--source` flag or a domain-level restriction system.

Selected feeds or pages may link to articles used as evidence. Responses should
identify the publications actually used, including linked material from another
publisher. Selection starts with enabled registered sources or user-supplied
links; general open-web search is outside the initial scope.

## 4. Built-In Sources

SourceSift should ship with a curated collection of source definitions and integrations.

Built-in sources are configurable, optional, and implemented through the same interfaces available to third-party plugins.

### Initial Coverage

The first curated collection covers:

- **General news:** US national news and current events.
- **Technology.**
- **Artificial intelligence.**
- **Business.**
- **Marketing.**
- **Finance.**

These topics can overlap. A prompt such as “check tech and AI” should draw on
appropriate sources across both rather than forcing the user to choose a single
category. The US national focus describes the initial general-news collection;
it does not imply that every topical publication must be US-based.

Specific publications and working access links will be selected during
implementation. Start with a manageable collection and verify its usefulness and
availability before broadening it.

### Later Coverage

Local and global news collections are later additions. Other industries and
user-defined categories can be added through configuration or plugins as useful
sources become available. SourceSift should disclose coverage gaps rather than
implying that the initial collection covers every topic or location.

### Source Quality

Prefer authoritative, reputable, and regularly maintained sources.

Distinguish primary reporting and official publications from commentary, aggregation, and secondary reporting.

Source metadata should support provenance and transparency without implying that any source is universally reliable.

Built-in source availability depends on working public feeds, APIs, or accessible website content.

## 5. User Context & Configuration

### User Context

Users explicitly provide information that helps SourceSift determine relevance.

Examples include:

- Professional background and industry.
- Topics and interests.
- Geographic location and preferred coverage.
- Organizations, companies, or technologies of interest.
- Research goals and priorities.
- Preferred response style or level of detail.

Context should be optional and controlled by the user.

### Configuration Philosophy

User context is optional. Built-in source definitions should make requests such
as “check news” useful once model access is configured. Users can provide personal
context in Markdown, reference it from application configuration, or supply it
through the Python SDK. They do not need to write Python configuration for normal
CLI use.

Application settings and enabled sources are configurable, but topic selection
normally comes from the prompt. Configuration formats, precedence, file paths, and
proposed SDK contracts are maintained in [design.md](design.md).

Example `context.md`:

```markdown
# User Context

## Background

I work in technology and artificial intelligence.

## Interests

- AI research and applications
- Robotics
- Technology industry developments
- Business and economics

## Geographic Focus

- United States national news

## Priorities

Focus on significant developments, practical implications,
and information relevant to my interests.
```

This is an illustrative user-context file, not a required template.

### Expected Behavior

- Built-in defaults provide useful source coverage after model access is configured.
- Users can enable, disable, or add sources and plugins.
- The current prompt determines the task; configured context helps establish relevance.
- Markdown context is read as text, and users control which files they supply.
- Local configuration does not imply offline inference: relevant context and
  retrieved material are sent to the configured model through OpenRouter.

## 6. Primary Use Cases

### UC-01 — General News Discovery

**User story:** As a user, I want to ask about recent news so I can understand important developments without manually visiting multiple publications.

Example:

```bash
ssift ask "Check news"
```

Expected behavior:

- Select relevant sources from the initial US national news collection.
- Retrieve recent reporting and make the time window clear.
- Identify significant developments.
- Summarize findings with source references.
- Distinguish reporting from interpretation.

### UC-02 — Topic-Based Research

**User story:** As a user, I want to investigate a topic using relevant sources rather than manually searching for articles.

Example:

```bash
ssift ask "Check tech and AI for recent developments"
```

Expected behavior:

- Identify relevant subjects and categories.
- Select appropriate registered sources using their descriptions and coverage metadata.
- Retrieve recent information.
- Explain significant findings and developments.
- Provide links to supporting sources.

### UC-03 — Geographic News

**Availability:** Later expansion for local/global news. Initial general-news
coverage is US national; this example is not an initial-release promise.

**User story:** As a user, I want to discover news relevant to a particular location or geographic scope.

Example:

```bash
ssift ask "What's happening in Oklahoma this week?"
```

Expected behavior:

- Recognize geographic intent.
- Prefer sources covering the requested location.
- Retrieve geographically relevant reporting.
- Summarize local or regional developments.

Geographic context may come from the prompt or explicit configuration. Before
suitable local sources are available, explain the coverage gap instead of claiming
a complete local briefing. This expansion does not require a persistent database.

### UC-04 — Personalized Relevance

**User story:** As a user, I want SourceSift to incorporate my interests and professional context when identifying important information.

Example:

```bash
ssift ask "What recent developments should I know about?"
```

Expected behavior:

- Load configured user context.
- Identify relevant categories and sources.
- Evaluate information against the user's interests.
- Prioritize meaningful developments.
- Explain why selected information is relevant.

Relevance is derived from explicit context rather than requiring a persistent preference-learning system.

### UC-05 — Document-Guided Research

**User story:** As a user, I want SourceSift to use a document as context for finding related information.

Example:

```bash
ssift ask "Find recent developments related to this project" \
    --file project.md \
    > research.md
```

Expected behavior:

- Read the supplied document.
- Identify relevant subjects, organizations, and terminology.
- Select appropriate information sources.
- Retrieve related information.
- Produce a grounded response.
- Write the response to stdout.

### UC-06 — Named Sources and Direct Links

**User story:** As a user, I want to name a publication or share a link in my
request when I have particular material in mind.

Examples:

```bash
ssift ask "Check business using only Example News"
ssift ask "Summarize this article: https://example.com/article"
```

“Example News” stands for a registered publication's name; the URL is illustrative.

Expected behavior:

- Interpret the named source or URL from the prompt.
- Respect an explicit request to use only that source when selecting sources.
- Explain an unknown or unavailable source rather than silently substituting another.
- Retrieve relevant accessible content and provide references to the material used.
- Identify the actual publisher of linked evidence.

The source model remains semantic in normal usage; users do not need an additional
source-selection flag or category syntax.

### UC-07 — Extending SourceSift

**Availability:** The third-party plugin milestone extends the working built-in
contracts; it is not a prerequisite for the first useful research request.

**User story:** As a developer, I want to introduce custom sources and capabilities without modifying the application's core.

Example:

```python
from sourcesift import SourceSift

app = SourceSift()

# Register a definition with links, metadata, and a description.
# custom_source_definition and custom_tool are supplied by the extension.
app.register_source(custom_source_definition)
app.register_tool(custom_tool)

result = app.run_sync("Check tech")
print(result.answer)
```

Expected behavior:

- Accept implementations matching public SDK contracts.
- Register source metadata and capabilities.
- Make custom sources available for selection.
- Expose compatible tools to the agent.
- Preserve the fixed agent runtime and provider foundation.

The example API is illustrative.

### UC-08 — CLI Automation

**User story:** As a user, I want SourceSift to work within shell scripts and command-line workflows.

Example:

```bash
cat topic.md | ssift ask "Find recent related news" > news.md
```

Expected behavior:

- Accept standard input.
- Return useful Markdown or plain-text output.
- Write primary results to stdout.
- Write diagnostics and progress information to stderr.
- Use documented exit codes and disclose partial coverage in the result.
- Avoid requiring an interactive session.
- Apply the same research and evidence expectations as direct terminal use.

### UC-09 — Interactive Research Follow-ups

Start `ssift chat`, with optional personal Markdown guidance, then ask:

1. “Check tech and AI.”
2. “Which of those matters for my project?”
3. “Read the second article.”
4. “Compare those reports and give me a brief.”

The conversation retains evidence, article identities, citations, and limitations.
Retained evidence has retrieval timestamps and is not presented as freshly checked.
The user can cancel a turn, inspect loaded context, or start a new session. A new
session reloads configured context; exiting discards the conversation. See the
[chat guide](chat.md). Saved conversations and resume remain future work.

## 7. Agent Responsibilities

The agent should focus on operations requiring contextual judgment.

Examples:

- Understanding user research intent.
- Selecting sources based on metadata and context.
- Deciding whether additional retrieval is necessary.
- Evaluating relevance.
- Synthesizing information from multiple sources.
- Identifying uncertainty and conflicting information.

Deterministic tasks should remain ordinary Python operations, including HTTP requests, parsing, normalization, configuration loading, and output formatting.

The initial foundation remains:

- **PydanticAI:** Agent runtime, tools, structured outputs.
- **OpenRouter:** Model inference and selection.
- **SourceSift:** Source registry, plugins, workflows, context, and SDK.

## 8. Persistence Philosophy

Persistent storage is not a prerequisite for SourceSift's primary use cases.

The initial design should support:

- Ephemeral prompts and responses.
- Source retrieval on demand.
- User-defined configuration and context files.
- In-memory source registries and session state.
- Direct terminal output and file redirection.

Potential future enhancements include:

- HTTP response and article caching.
- Source metadata caching.
- Historical article indexing.
- Persistent conversational sessions.
- Scheduled monitoring and change detection.
- Searchable local archives.

These features should be added when specific use cases justify them.

## 9. Initial Product Boundaries

### Included

- A curated collection for US national news, technology, AI, business, marketing, and finance.
- RSS/Atom and bounded website/article retrieval.
- Semantic selection using source links, metadata, descriptions, and the user's request.
- Python SDK and shared built-in plugin contracts, followed by third-party plugin support.
- PydanticAI + OpenRouter.
- Cyclopts CLI and Textual/Rich/asyncio chat.
- User-defined context through configuration and Markdown.
- Stateless research and source-grounded responses.
- stdin/stdout and file-based workflows.

### Deferred

- Curated local and global news collections.
- Email/newsletter account integrations.
- Persistent article database and historical indexing.
- Automatic user preference learning.
- General-purpose crawling, open-web search, and browser automation.
- Cloud services and background scheduling.
- Advanced plugin permissions and sandboxing.
- Native Rust optimization.
- Web application and HTTP server.

## 10. Success Criteria

The first useful research milestone should let a user:

1. Configure model access, then ask “check news” or “check tech” without selecting feeds.
2. Receive information from relevant registered sources within the initial coverage.
3. Guide relevance through personal context, a document, or a more specific prompt.
4. Name a source or supply a link naturally when particular material is desired.
5. Receive a readable answer with references tied to retrieved evidence.
6. Understand the response's time window, missing evidence, and coverage limitations.
7. Pipe context and results through ordinary terminal workflows without a database.

### Evidence and Failure Expectations

- References identify retrieved material that supports factual research claims.
- Publication and retrieval dates are distinguished; unknown dates remain unknown.
- “Today” and “this week” use a known time zone and a clear date window.
- Reporting, synthesis, conflicting accounts, and uncertainty are distinguishable.
- Unavailable sources can produce a useful partial result with disclosed gaps.
- Insufficient evidence or unsupported geographic coverage is stated explicitly.
- Research runs have bounded retrieval and model use, with useful failure diagnostics.

The roadmap ties these behaviors to fixture-based checks and a small live
evaluation set. Recommendation quality is evaluated against labeled examples as
structured briefings arrive. Plugin extensibility is verified in its own milestone;
local/global coverage, chat, and saved archives have later completion criteria.

The primary measure of success is whether SourceSift consistently discovers and
presents relevant, well-supported information with minimal user effort.
