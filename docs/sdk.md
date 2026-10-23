# Python SDK

SourceSift analyzes supplied text and researches registered sources through OpenRouter.
Use a tool-capable model for research. Each request has independent retrieval state.

Set `OPENROUTER_API_KEY` securely in your environment and choose a model, for example
`SOURCESIFT_MODEL=openai/gpt-6.1-sol` and `SOURCESIFT_REASONING_EFFORT=medium`.
See [configuration](configuration.md) for TOML and context options.

```python
from sourcesift import SourceSift

app = SourceSift()
result = app.run_sync("Summarize the project", files=["project.md"])
print(result.answer)
print(result.limitations)
print(result.usage)
```

In an async application or notebook, use `await app.run(...)`. `run_sync()` rejects
calls inside an active event loop. Each call is independent; previous documents
and messages are not retained. The SDK reads stdin only when a binary stream is
explicitly passed via `stdin=`.

## In-memory context and settings

```python
from sourcesift import ContextDocument, Request, SourceSift, load_settings

settings = load_settings(overrides={"agent": {"model": "openai/gpt-6.1-sol"}})
app = SourceSift(settings)
request = Request(
    prompt="Summarize the project in one paragraph",
    context=(ContextDocument(name="project", text="The project studies rainfall."),),
    output_format="plain",
)
result = app.run_sync(request)
```

Passing a resolved `Settings` object bypasses environment and config loading.
Alternatively use `SourceSift(config_path="settings.toml", model="provider/model")`.
Do not combine resolved settings with config/model overrides.

`Result` contains `answer`, `limitations`, configured `model`, and `usage` (model
requests and reported input/output tokens). Research also supplies `references`,
`selected_sources`, `window`, and `http_requests`. Citation `[S1]` corresponds to a
`Reference` with ID `S1`. References contain actual URLs, publisher hostnames,
registered source IDs when available, feed-summary/article kind, publication/update
and retrieval timestamps, and extraction limitations. Only cited evidence appears
in `references`; selected sources may include sources that failed.

```python
result = app.run_sync("Check tech and AI for this project", files=["project.md"])
print(result.answer)
for reference in result.references:
    print(reference.id, reference.title, reference.url, reference.kind)
```

A supplied-text answer that uses no retrieval retains the no-retrieval limitation.
Citations identify retrieved evidence; the model still determines whether a claim
is supported. See [research](research.md) for safeguards and evaluation boundaries.

## Source definitions

```python
from sourcesift import Source, SourceSift

app = SourceSift()
app.register_source(
    Source(
        id="example-publication",
        name="Example Publication",
        website="https://example.com/",
        feeds=("https://example.com/feed.xml",),  # replace with a real public feed
        description="Research and developments in my field.",
        topics=("research",),
        geography="United States",
    )
)
print(app.registry.list())
```

Register before starting requests. Definitions are immutable; registration replaces
the application's registry for future runs. IDs, names, and aliases must be unique.
An omitted feed enables discovery of declared RSS/Atom links from `website`.
`capabilities=("feed",)` disables article follow-ups through that source.
Additions and disabled IDs can also be configured in TOML. Executable plugin
registration/discovery remains Phase 5.

Catch `ConfigurationError` or `InputError` to correct local input, and `ModelError`
for timeout, provider, or unusable-output failures. All derive from
`SourceSiftError`. Async cancellation propagates normally. SourceSift does not
retry failed provider requests or print provider response bodies in errors. One
citation-validation repair is allowed within the model-request budget. Individual
retrieval failures appear as limitations; an entirely unsuccessful research run
returns an explicit inability to verify current information.

## Interactive sessions

```python
from sourcesift import SourceSift

app = SourceSift()
session = app.session(files=["project.md"])
# Inside an async function:
first = await session.run("Check tech and AI")
second = await session.run("Read the second article in more detail")
print(second.answer, second.references)
session.reset()  # clears history and reloads configured/initial context files
```

Sessions are independent, in-memory objects. `session.turns` returns completed
prompt/result pairs and `session.context` shows the context snapshot. Settings and
source registration are snapshotted at creation; create a new session to change them.
Additional `files=` or `Request.context` on a turn become part of its history.

An optional synchronous `on_event` callback receives `SessionEvent` values:
`status` reports progress, `draft` appends provisional text, and `reset` clears the
previous draft (including citation-repair attempts). Keep callbacks short and
nonblocking; the returned `Result` is authoritative. Passing a callback enables
model streaming. Cancellation uses ordinary asyncio task cancellation and propagates
`CancelledError`. Errors/cancellation preserve prior turns, and concurrent calls
on the same session raise `InputError`. Reset while busy also raises `InputError`.

Limits on turns and serialized context require an explicit new session when full;
there is no automatic summarization, persistence, or resume. See [chat](chat.md).
