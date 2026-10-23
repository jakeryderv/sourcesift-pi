# sourcesift-pi

SourceSift's research agent rebuilt on [pi](https://pi.dev). `ssift` is its own
command: it uses pi's SDK, terminal UI, provider handling, and sessions as libraries,
and adds the registered source catalog, bounded retrieval, evidence with stable
citation IDs, grounding rules, and a citation check on every answer.

Status: feeds, article follow-up, windows, dedup, citation repair, interactive chat,
one-shot print mode, and saved conversations work. Not yet ported from the Python
version: IP-pinned connections (DNS answers are checked but not pinned), tests, the
live evaluation script, and configured context files.

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
```

Flags such as `--model`, `--provider`, and `--thinking` override the saved choice for
one run, the same way they do in pi. `ssift --help` lists them.

Inside the chat: `/sources` lists the catalog, `/evidence` lists retained citations,
and pi's `/model`, `/login`, `/new`, `/resume`, `/fork`, and `/help` work as usual.

## Where things live

| What | Path |
|---|---|
| Credentials, model catalog, pi settings, themes | `$XDG_CONFIG_HOME/sourcesift/` (override with `SOURCESIFT_HOME`) |
| SourceSift configuration | `$XDG_CONFIG_HOME/sourcesift/config.json` (override with `--config` or `SOURCESIFT_CONFIG`) |
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
  "limits": { "maxSources": 3, "maxArticles": 6 }
}
```

## Develop

```sh
npm run typecheck          # tsc --noEmit
npm run smoke -- npr       # retrieval only, no model: one feed and one article
node scripts/debug-fetch.ts https://example.com/   # show the underlying fetch failure
```

Node runs the TypeScript source directly; there is no build step. The extension in
`src/extension.ts` also loads into a plain `pi` session with `pi -e <this directory>`.
