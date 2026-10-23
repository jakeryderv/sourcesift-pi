# Interactive research chat

`ssift` (or `ssift chat`) opens a Textual terminal interface backed by the same Python research
runtime as `ssift ask`. It supports follow-ups about retrieved articles, retained
citations, streamed drafts, and cancellation. Sessions stay in memory.

## Start a conversation

Launch `ssift` to configure a model and API key in the terminal, or set them in
your environment/config first. Choose a tool-capable OpenRouter model:

```sh
export SOURCESIFT_MODEL=openai/gpt-6.1-sol
export SOURCESIFT_REASONING_EFFORT=medium
ssift
ssift chat --file project.md
ssift chat --config ~/.config/sourcesift/config.toml
```

Both stdin and stdout must be terminals. For pipes or quick requests, use
`ssift ask "Check tech"`. With redirected input/output, bare `ssift` displays help;
`ssift --help` always displays help.

In a development checkout, `uv run --env-file .env ssift` explicitly loads a local
`.env` file. Neither SourceSift nor a plain `uv run` automatically loads it.
Missing model/key settings open a setup panel; `/model` reopens it later. Changes
apply to the current chat and are kept in memory, including any key entered in the
masked field. Use TOML/environment settings for defaults across launches. Changing
models preserves completed conversation history and affects the next turn.

The model field offers fuzzy completions as you type, matching model IDs and display
names from OpenRouter's public catalog. Up/Down chooses a suggestion; Tab/Enter
fills the field without applying settings. Click Apply when the model, effort, and
key are ready. Esc dismisses suggestions first, then closes setup. Suggestions
include models advertising text input/output and tool support; availability for
your account and support for a particular reasoning effort are still provider-dependent.

The catalog loads in the background with a timeout and response-size limit, using
one public request without your API key, prompts, or context. Successful results
are cached for this chat. If loading fails or no model matches, you can still enter
an exact `provider/model` ID manually. Reopening `/model` retries a failed load.

Try “Check tech and AI,” then “Which matters most for my project?” or “Read the
second article.” Follow-ups use the completed conversation and its evidence.
References below each answer include URLs, dates, and feed-summary/article status.
URLs are displayed for selection/copying; model-generated links do not launch a
browser automatically.

## Controls

| Key | Action |
|---|---|
| Enter | Accept a highlighted suggestion; otherwise send/run the input |
| Tab | Accept a highlighted suggestion |
| Up / Down | Navigate a picker; recall prompts at the first/last input line |
| Shift+Enter | Insert a newline |
| Ctrl+J | Insert a newline (terminal-compatible fallback) |
| Alt+Enter | Insert a newline when reported by the terminal |
| Esc | Dismiss a picker/panel first; otherwise cancel the active turn |
| Ctrl+Q | Quit |

Shift+Enter requires a terminal that reports modified Enter keys. If your terminal
sends it as plain Enter, use Ctrl+J instead. Pasted multiline text stays in the
input until you press Enter.

Type `/` to open the command picker. Keep typing to fuzzy-filter commands (for
example `/ctx` matches `/context`). Up/Down chooses a result; Enter or Tab inserts
it into the prompt. **Accepting a suggestion does not execute it**: press Enter
again to run the command. Esc dismisses the picker without changing the draft.

Available commands:

| Command | Action |
|---|---|
| `/new` | Start a new session and reload context |
| `/context` | Inspect the loaded context; Esc closes the viewer |
| `/model` | Edit the model, reasoning effort, and API key for this chat |
| `/cancel` | Cancel the active turn |
| `/help` | Open the controls and commands panel |
| `/quit` | Quit |

Only one turn runs at once. You may compose the next prompt while research runs;
submit it after the current turn completes. Slash commands remain available during
research, but finish or cancel first before starting a new session or changing
models. Up/Down recalls up to 100 submitted prompts and restores your unsent draft
when you return to the end of history. Within multiline text, arrows still move
between lines. History is local to this running chat.

Streaming text is labeled as a draft. Citation repair can replace it. The final
answer and references appear only after validation. A failed or cancelled turn is
shown in the transcript but is not added to conversation memory; previous completed
turns remain available. Cancellation stops local work, but cannot undo requests
already sent or charges already incurred at the provider.

## Attach files while chatting

Type `@` at the start of a word to search files in the directory where you launched
SourceSift. For example, type `Read @road`, choose `docs/roadmap.md`, and press Tab.
The composer inserts `@"docs/roadmap.md"` and shows a removable attachment button.
Continue writing, then press Enter to send. Paths with spaces are quoted for you.
Click the attachment's × button, or delete its mention, to remove it. Only files
selected in the picker and still mentioned in the prompt are attached; ordinary
email addresses and unselected `@` text stay literal.

The picker lists filenames without reading their contents. It respects repository
and nested `.gitignore` rules, skips hidden files/directories (including `.env`),
symlinks, and common build/dependency directories. Git's global ignore file and
`.git/info/exclude` are not consulted. It searches only within the launch directory.
Discovery runs in the background, capped at 20,000 entries, 20 directory levels,
and a two-second traversal budget; a partial-list notice suggests launching in a
smaller directory. The index is cached until `/new` or restart.

Selected files are rechecked and read as bounded UTF-8 text when you send. Binary,
missing, oversized, or excessive attachments leave the draft intact with an error.
Relative paths label the supplied documents, so same-named files in different
folders remain distinguishable. Their text is sent to the configured model and
stays in successful conversation history; later edits on disk do not change that
snapshot. Select a file again on a later turn to send its current contents.
Configured personal guidance remains separate from these per-turn attachments.

## Personal context

Keep runtime settings in TOML and your interests and preferences in Markdown.
For example, `~/.config/sourcesift/config.toml` on Linux:

```toml
[agent]
model = "openai/gpt-6.1-sol"
reasoning_effort = "medium"

[context]
instructions_file = "context.md"
# files = ["project.md"]  # optional background material

[sources]
timezone = "America/Chicago"
```

Example `context.md` beside that config:

```markdown
# About my work
I build Python tools and run a small marketing consultancy.

# Research priorities
Focus on practical AI developments, developer tools, and marketing changes.
Explain why an item matters for my work.

# Response preferences
Start with a short briefing. Include dates and citations.
Separate reported facts from your interpretation.
```

This is explicitly selected personal guidance, similar in purpose to an agent
instructions file. Its filename is configurable. SourceSift does not automatically
read a repository's `AGENTS.md`, search parent directories, or learn preferences.
Background documents and fetched pages remain research material. Guidance cannot
override grounding, network restrictions, or the current task.

Context is loaded at session creation. Inspect its actual contents with `/context`;
after editing a file, `/new` reloads it and clears the conversation. An unreadable
file leaves the current session intact. Use `/model` for session-only model changes; restart chat to reload source/TOML
settings. Configured paths are relative to their TOML file; `--file` paths are
relative to the working directory. All selected context is sent to the configured
model through OpenRouter.

## History and evidence limits

Citation IDs stay stable within a session, including feed-summary to article
upgrades. Earlier results retain their original provenance. Reused evidence is
explicitly labeled as retained; it does not establish that news is still current.
Ask for a fresh check when needed.

Default limits are 20 completed turns and 512 KiB of serialized history/evidence.
The next request is checked against the byte budget too. At a limit, start a new
session; SourceSift does not silently drop or summarize history. These are byte
guards, not model-token counts. Per-turn model, HTTP, source, and timeout budgets
still apply. See [configuration](configuration.md) for settings.

Quitting discards the conversation. Saving/resuming sessions, automatic context
compaction, and an article archive remain future work. The public
[`Session` API](sdk.md#interactive-sessions) provides the same behavior without Textual.
