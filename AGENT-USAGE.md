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

- **Dry-run before you commit.** `<tool> apply <path>…` (no `--go`) previews every change; `--go` performs it. In `--json`, `effect` says which kind of run it was: `read-only`, `dry-run`, or `applied`. A protected target needs a TTY confirmation or `--yes`, which is a person’s call: `next` never suggests it, and you never add it.

- **Check the exit code, then read `next`:** `0` all ok · `1` partial (something warned, refused, or failed) · `2` usage error · `3` could not run to completion (an environment or internal error). **Exit `0` does not mean go** — a clean dry run exits `0` and can still say `ask`. On exit `2` or `3` there is nothing on stdout and no `next`: report stderr and halt.

- **Quote back** the final summary line plus every non-`ok` line verbatim. That is the whole result — do not paraphrase a refusal into “done”.

### The babysit loop: run, read `next`, obey or halt

Every run ends with one piece of advice: the `next:` line, or the `next` object in `--json`.

```
next: run /usr/local/bin/node /path/to/<tool> apply a.txt --brief --go  (dry run clean: 1 item would change)
next: ask  (dry run: review the 1 finding before --go)
```

- **`run`** — run exactly that command, then read its `next` in turn. In `--json`, take the `argv` array as given (`argv[0]` is node, `argv[1]` the tool’s own script) and run it from `next.cwd`; never rebuild or re-quote it. From text output, run the line’s command from the directory you ran the tool in; if a token is shown as `$'…'`, take the `argv` from `--json` instead.

- **`wait`** — run the command again after that many seconds. It is always a read-only poll.

- **`done`** — nothing is left for this tool to do. Report and finish. At exit `1` it means no further tool step, not success: report the findings.

- **`ask`** — a person’s decision. Report the summary and the findings, then halt. Never take the step yourself; in `--json`, `argv` is what the person would review, not a command for you. (A person running the tool by hand sees the same step as `next: your call: <command>`.)

- **`stop`** — something is broken beyond the tool’s remedy. Report and halt.

- **No `next:` line** (`"next": null` in `--json`) — this tool gives no advice; follow your runbook.

**Budgets.** At most 6 `run` steps per procedure, unless the runbook sets another number; past it, halt and report. `wait` has no cycle limit: the tool is the stuck detector (it turns a stuck state into `ask`), and the runbook procedure sets how long, in wall-clock time, you may wait.

**The runbook can only hold you back.** A runbook can halt you where `next` says `run`; nothing but a person carries you past `ask` or `stop`. Report any disagreement as a finding. `next` never carries an override flag — any `--yes*`, `--force*`, `--assume-yes`, `--allow`, `--allow-*`, or `--i-am-*` flag, `-y`, or one the tool declares — and it never contradicts the exit code.
