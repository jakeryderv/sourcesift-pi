# sourcesift-pi

SourceSift's research agent rebuilt on [pi](https://pi.dev). `ssift` is its own
command: it uses pi's SDK, terminal UI, provider handling, and sessions as libraries,
and adds the registered source catalog, bounded retrieval, evidence with stable
citation IDs, grounding rules, and a citation check on every answer.

Status: feeds, article follow-up, date windows, dedup, citation repair, interactive
chat, one-shot text and JSON output, saved conversations, pinned public-address
fetching, a per-conversation feed cache, and a personal guidance file all work.

## Install and run

Requires Node 24 or newer.

```sh
npm install
npm link      # puts `ssift` on your PATH (or run `node bin/ssift.js`)
ssift
```

First time only, inside the chat: `/login openrouter` (or set `OPENROUTER_API_KEY`),
then `/model` to pick a model and `/thinking` to pick an effort level. Those choices
are saved, so from then on the command is just `ssift`.

```sh
ssift                                   # interactive conversation
ssift "Check tech and AI this week"     # interactive, sends the first message
ssift -p "Check news"                   # one shot: answer plus references, then exit
cat report.md | ssift -p "Summarize this"
ssift -c                                # continue the most recent conversation here
ssift --json -p "Check news" | jq .references   # one JSON object: answer, references, notes, usage
```

Flags such as `--model`, `--provider`, and `--thinking` override the saved choice for
one run, the same way they do in pi. `ssift --help` lists them.

Inside the chat:

- `/sources` opens a list where you enable or disable sources for this conversation.
- `/evidence` lists the citations retained so far.
- `/read S3` fetches a cited article in full and asks for what it adds.
- Research results collapse to one line; press Ctrl+O to expand them into `[S1] title —
  publisher · date` with the coverage notes.
- `/quiet` hides tool output for the conversation entirely (`/quiet off` shows it again);
  set `"quiet": true` in `config.json` to start that way.
- Pi.s `/model`, `/thinking`, `/login`, `/new`, `/resume`, `/fork`, and `/help` work as usual.
- There is no shell: the model has no bash tool, and the `!` prefix is disabled.

## Where things live

| What | Path |
|---|---|
| Credentials, model catalog, pi settings, themes | `$XDG_CONFIG_HOME/sourcesift/` (override with `SOURCESIFT_HOME`) |
| SourceSift configuration | `$XDG_CONFIG_HOME/sourcesift/config.json` (override with `--config` or `SOURCESIFT_CONFIG`) |
| Personal guidance | `$XDG_CONFIG_HOME/sourcesift/guidance.md` (optional; see below) |
| Saved conversations | `$XDG_DATA_HOME/sourcesift/sessions/` |

These are separate from a personal pi installation in `~/.pi`, so research sessions
and credentials never mix with coding sessions.

## Configure

Optional `config.json`:

```json
{
  "timezone": "America/Chicago",
  "recent_days": 7,
  "disabled": ["cnbc"],
  "custom": [
    {
      "id": "example-publication",
      "name": "Example Publication",
      "website": "https://example.com/",
      "feeds": ["https://example.com/feed.xml"],
      "description": "Research and developments in my field.",
      "topics": ["research"]
    }
  ],
  "limits": { "maxSources": 3, "maxArticles": 6, "feedCacheSeconds": 600 },
  "guidance": "~/notes/research-guidance.md",
  "quiet": false
}
```

## Personal guidance

Put a short Markdown file at `~/.config/sourcesift/guidance.md` describing your
interests, priorities, and how you like briefings presented. It is added to every
request as explicitly selected guidance, so "check tech" leans toward what matters to
you. It never authorizes URLs or tools, and the grounding rules still apply.

## Retrieval behavior

Only public HTTP(S) hosts on standard ports are fetched. Each connection resolves the
hostname once, rejects private, loopback, link-local, and reserved answers, and connects
to that exact address, so a DNS answer cannot redirect retrieval inside your network.
Robots rules are honored, redirects are re-checked, bodies are byte-bounded, and no
cookies or proxies are used. Feeds fetched in a conversation are reused for ten minutes
(`limits.feedCacheSeconds`); the recorded retrieval time is the fetch time, not the reuse
time. Sources selected for one request are fetched concurrently and ingested in selection
order, so citation IDs are stable.

## Develop

```sh
npm test                   # unit tests for URLs, parsing, config, sources, research, rendering
npm run typecheck          # tsc --noEmit
npm run lint               # biome
npm run smoke -- npr       # retrieval only, no model: one feed and one article
node scripts/debug-fetch.ts https://example.com/   # show the underlying fetch failure
```

## Evaluate

`evaluations/cases.json` holds six fixed prompts: general news, tech and AI, business and
finance, a named-only request, an unknown publication, and a direct URL. The harness runs
each through `ssift --mode json`, checks source selection, evidence presence, named-only
enforcement, and citation validity automatically, and writes the answer, references, and
raw events for review:

```sh
npm run eval -- --provider openrouter --model openai/gpt-6.1-sol --thinking low
npm run eval -- --case named-only
```

Records land in the ignored `evaluation-results/` directory. `evaluations/baseline.json`
is the committed summary of the last accepted run: which sources were selected, how many
references were cited, timing, model calls, and cost, without answer text. The automatic
checks are smoke checks; whether each cited claim is actually supported still needs a
human read of the records. This costs real model usage and contacts public feeds.

Node runs the TypeScript source directly; there is no build step. The extension in
`src/extension.ts` also loads into a plain `pi` session with `pi -e <this directory>`.
