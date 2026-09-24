# Agent usage

Paste the block below into a tool’s `CLAUDE.md` so an agent session drives the
tool correctly. It is written against the skeleton’s contract (`mjs-tool/2`),
so it applies verbatim to any tool built from `mjs-tool-skeleton` (`<tool>` is
the command name). `new-tool` already drops it into every scaffolded tool’s
`CLAUDE.md`.

---

## Driving `<tool>` from an agent session

- **Reach for `--brief` first** — or `--json` when you need to parse the result — never the default human output. Brief is exactly one line per item, then a summary line and a `next:` line; JSON is a stable `{ tool, version, contract, command, effect, exit, items, summary, next }` object. The human output is for a person at a terminal and only wastes your context.

- **Any line whose verdict is not `ok` is a finding**, not noise. The verdicts are `ok`, `warn`, `skip`, `refuse`, `fail`; a non-`ok` line is never collapsed or dropped, and carries a parenthesised reason. A run is clean only when the summary reads `warn=0 refuse=0 fail=0` — `skip` is not a failure, but report what was skipped and why.

- **Dry-run before you commit.** `<tool> apply <path>…` (no `--go`) previews every change; `--go` performs it. In `--json`, `effect` says which kind of run it was: `read-only`, `dry-run`, or `applied`. A protected target needs a TTY confirmation or `--yes`; unattended, pass `--yes` only when your instructions say to — never to paper over a refusal. `next` never suggests it.

- **Trust the exit code:** `0` all ok · `1` partial (something warned, refused, or failed) · `2` usage error · `3` could not run to completion (an environment or internal error). Check it; do not infer success from the absence of an error string.

- **Quote back** the final summary line plus every non-`ok` line verbatim. That is the whole result — do not paraphrase a refusal into “done”.

### The babysit loop: run, read `next`, obey or halt

Every run ends with one piece of advice: the `next:` line, or the `next` object in `--json`.

```
next: run <tool> apply a.txt --go  (dry run clean: 1 item would change)
```

- **`run`** — run exactly that command, then read its `next` in turn. In `--json`, take the `argv` array as given; never rebuild or re-quote it.

- **`wait`** — run the command again after `afterSeconds`.

- **`done`** — nothing is left to do. Report and finish.

- **`ask`** — a person’s decision. Report the summary, the findings, and the suggested command, then halt. Never take the step yourself.

- **`stop`** — something is broken beyond the tool’s remedy. Report and halt.

- **No `next:` line** (`"next": null` in `--json`) — no advice; follow your runbook.

Obey `run` and `wait` only when `who` is `agent`; anything else is a halt. `next` never carries `--yes`, `--force`, or any `--allow-*` or `--i-am-*` flag, and it never contradicts the exit code. **When a runbook and `next` disagree, the runbook wins** — follow the runbook, and report the disagreement as a finding.
