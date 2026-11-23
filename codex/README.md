# Fast Jev for Codex

This adapter uses the same compaction engine, pinned Jev model and OpenRouter
Decisions transport as the Claude Code plugin. Before manual or automatic
compaction, it selects useful tool exchanges. Codex runs its native compaction,
then receives a bounded excerpt of those exchanges through `SessionStart`.

## Setup

Use Codex with `PreCompact` and `SessionStart(source=compact)` hooks, plus Node.js
18 or newer on macOS or Linux.

1. From the checkout, run `npm ci --ignore-scripts && npm run build`.
2. Merge [hooks.example.json](hooks.example.json) into `$CODEX_HOME/hooks.json`
   (default `~/.codex/hooks.json`). Replace the example path with the absolute
   path to this checkout and preserve existing hooks. Use an absolute Node.js
   binary path if Codex cannot find `node`.
3. Launch Codex with `OPENROUTER_API_KEY` and `FAST_JEV_CODEX_ENABLED=1` in its
   environment. Review and trust the two commands through `/hooks`, then start
   a thread. Run `/compact` once the thread has accumulated tool calls and
   enough recent messages for the engine to have eligible calls to score.

The key comes from the launching environment. A desktop-launched Codex process
must inherit these variables from its launcher. Omit
`FAST_JEV_CODEX_ENABLED` to disable the integration.

## Data handling

Each request uses the fixed OpenRouter Decisions endpoint and sends the
upstream routing policy `zdr: true` and `data_collection: "deny"`. Redirects
are rejected. Use an OpenRouter workspace with ZDR enforced in its privacy
settings or through a guardrail as well.

Jev receives user and assistant text plus tool inputs from the active rollout
history. Structured tool results are represented by status and character counts. The native summary can include prior tool details. The
configured OpenRouter key is checked against the transcript before requests.
Other sensitive content can still be present in prompts and tool arguments.
Enable this integration only for sessions you are authorized to send to
OpenRouter.

Selected tool evidence is temporarily stored under
`$CODEX_HOME/fast-jev-openrouter-cache` with directory mode `0700` and file
mode `0600`. Each checkpoint is consumed once, expires after ten minutes and
is swept on the next enabled compaction. After manual compaction, Codex runs the
restore hook when you send your next message. Codex receives the restored evidence
as additional context for the current session. Retention of that context in
Codex follows the host's behavior.

A missing key, unsupported rollout, request error or exhausted request budget
leaves the native flow running. The rollout JSONL format is a Codex
implementation detail and can change. The default engine preserves the first
and six most recent messages. Restoration favors recent tool exchanges and
uses head and tail excerpts for oversized entries when space remains.
