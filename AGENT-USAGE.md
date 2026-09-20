# Agent usage

Paste the block below into a tool’s `CLAUDE.md` so an agent session drives the
tool correctly. It is written against the skeleton’s contract, so it applies
verbatim to any tool built from `mjs-tool-skeleton` (`<tool>` is the command
name). `new-tool` already drops it into every scaffolded tool’s `CLAUDE.md`.

---

## Driving `<tool>` from an agent session

- **Reach for `--brief` first** — or `--json` when you need to parse the result — never the default human output. Brief is exactly one line per item; JSON is a stable `{ tool, version, command, items, summary }` object. The human output is for a person at a terminal and only wastes your context.
- **Any line whose verdict is not `ok` is a finding**, not noise. The verdicts are `ok`, `warn`, `skip`, `refuse`, `fail`; a non-`ok` line is never collapsed or dropped, and carries a parenthesised reason. A run is clean only when the summary reads `warn=0 refuse=0 fail=0` — `skip` is not a failure, but report what was skipped and why.
- **Dry-run before you commit.** `<tool> apply <path>…` (no `--go`) previews every change; `--go` performs it. A protected target needs a TTY confirmation or `--yes`; unattended, pass `--yes` deliberately — never to paper over a refusal.
- **Trust the exit code:** `0` all ok · `1` partial (something warned, refused, or failed) · `2` usage error · `3` environment error. Check it; do not infer success from the absence of an error string.
- **Quote back** the final summary line plus every non-`ok` line verbatim. That is the whole result — do not paraphrase a refusal into “done”.
