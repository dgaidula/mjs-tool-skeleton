# Changelog

## Unreleased

- **`ADOPTING.md`: the adoption procedure.** Callers, verdict meanings, `next`
  overrides, mutating-tool safety, tests and a done checklist, written from
  the 2026-10-03 adoptions (a linter, a renamer, and an AppleScript runner
  that tested the draft, a fleet-wide generator, and an unattended watcher),
  a new dedup tool, and
  their gates. README adoption step 4 gains the hash-pin path. Docs
  only; the contract and the fence are unchanged.

## 0.2.0 — 2026-09-24

Contract `mjs-tool/2`: a next-action layer, an explicit effect, and one shared
runtime block. Additive for `--json` consumers; the text modes gain one line.
Built on 2026-09-23, gated the same night, and frozen on 2026-09-24 after the
pilot adoption and the rounds below.

Four changes after the final round (Dan’s approvals after the pilot rerun,
2026-09-24):

- **A text-mode `run` or `wait` line runs as pasted.** It reads
  `next: run cd <cwd> && <command>  (why)` (and
  `next: wait <n>s cd <cwd> && …`), the directory quoted by the same rules
  as the command, so an agent can paste it into a fresh shell from any
  directory; a test agent had run an advised command from the wrong one.
  `--json` is unchanged (`argv` plus `cwd`), and the human-mode “your call”
  line keeps its bare command. Item and summary lines are unchanged.

- **An `ask` `argv` re-invokes the tool too**, as `run` and `wait` do, or
  is `null`: the guard checks the same two head tokens.

- **Advice goes straight to `--go` only on what was just previewed.** A `run`
  that carries `--go` must follow a dry run and be exactly that dry run’s
  argv with `--go` added (`rerunArgv(argv, '--go')`); a `run` into another
  command of the tool is a read-only or dry-run step, with no `--go`.
  `report()` takes the run’s `argv` (the one handed to `nextAction()`; left
  out, the process’s own) and passes it with `effect` to `assertSafeNext()`,
  as its new third argument.

- Docs: a tool awaits (or synchronously flushes) every file write before
  `main()` calls `report()` or returns, since the runtime exits once stdout
  has flushed (a pilot tool’s un-awaited batch log lost its closing line in 5
  of 5 runs); a tool’s own policy may advise `run … --go` over findings, at
  exit `1`, when its `--go` form holds them aside rather than acting on them.
  Tests: 48 → 52.

Two fixes from the gate on those changes:

- **A `--go` alias never rides in `next.argv`.** A new hook above the fence,
  `GO_ALIASES` (an array of strings, `[]` by default, checked as the module
  loads), declares a tool’s aliases of `--go` (`--apply`, `-g`); the guard
  refuses a declared one in any action’s `argv` (long forms in any case, with
  or without `=value`; a short one alone or grouped), so advice spells `--go`
  and the check on a `run`’s `--go` sees it. A policy that advised
  `apply a.txt --commit` after an `inspect`, or widened a dry run’s paths
  under the alias, had mutated what was never previewed. Docs: drop only a
  no-op alias when normalising argv, never a scoping flag.

- **`$'…'` writes a character past ASCII as its UTF-8 bytes** (`\xHH`), not
  `\uXXXX`, which macOS’s `/bin/sh` and `/bin/bash` 3.2 do not decode: a
  pasted `cd <cwd> && …` line for a directory holding a NEL, a line separator
  or a bidi control now runs there too. Tests: 52 → 54.

The final round before the freeze (Dan’s decisions on the pilot, 2026-09-24):

- **A clean dry run advises `ask`**, a person’s call, with the `--go` command
  as its `argv`. It advises `run` only for a command the tool lists in
  `AUTO_RUN_COMMANDS`, a new hook above the fence, empty by default: auto-run
  is an opt-in, command by command, and a tool may fill it from its own config.

- **`who` is derived from `action`**: `agent` for `run`, `wait` and `done`,
  `human` for `ask` and `stop`. `nextStep()` takes no `who` (or `cwd`) and
  throws if handed one; the guard rejects any mismatch.

- **`argv` starts with `[process.execPath, <script as invoked>]`**, so it runs
  without the executable bit. `run` and `wait` must re-invoke this tool (the
  guard checks both head tokens); a handoff to another tool is `done`, with
  the next step in the runbook. `wait` never carries `--go` or a mutating
  command, and `done` and `stop` carry no `argv`.

- **The `next:` line prints a command only where its reader may take it.**
  `--brief` and `--quiet` print a bare `next: ask  (why)` and
  `next: stop  (why)`; the default human mode shows an ask as
  `next: your call: <command>  (why)`. `--json` keeps `argv`. Item and
  summary lines are unchanged: still byte-identical to 0.1.0.

- **`report()` ends the run.** It writes, then exits with the reported code
  once stdout has flushed, so an open handle in a tool cannot hold the process
  and a large report still arrives whole; a `main()` that returns without a
  report exits the same way. An error thrown after the report is printed, but
  keeps the report’s exit code.

- **`cwd` is read once as the module loads** (`START_CWD`), so a run that
  removes its own working directory still reports; one started in a removed
  directory reports `$PWD`.

- **`nextStep()` escapes and clips `why`** (each name to 80 characters, the
  whole to 200, the “and N more” count kept) instead of the guard refusing it
  after the work is done.

- **The hooks are checked as the module loads**: `MUTATING_COMMANDS` and
  `AUTO_RUN_COMMANDS` Sets, `EXTRA_OVERRIDE_FLAGS` an array of strings,
  `nextAction` and `main` functions. A bad one exits 3 by name.

- **Control characters**: the bidi embedding, override and isolate controls
  (U+202A–202E, U+2066–2069) are escaped too; TAB now passes through. The guard
  echoes an offending token escaped.

- Docs: AGENT-USAGE gains the loop budgets (at most 6 `run` steps; `wait`
  bounded by the runbook’s wall-clock time), “exit 0 does not mean go”, the
  exit-2-or-3 halt, and the one-directional runbook rule. The README documents
  compound command names, `done` at exit 1, `null` next, the `state` shape,
  prefix-versus-exact override matching, `$'…'` quoting and old bash, the
  `-n` alias, and which tests an adopting tool ports. Tests: 40 → 48.

Gate fixes before the first push (Opus 5.5 gate pass, 2026-09-23):

- **Large output no longer truncates.** `main()` sets `process.exitCode` from
  `report()` and returns instead of calling `process.exit()`, which dropped
  everything past the first 64 KiB through a pipe on macOS (a 300-item
  `--json` did not parse; a 3,000-item `--brief` ended mid-item, exit 0).
- **Control characters.** A newline in a filename made the runtime’s own
  policy fail its own guard after mutating (exit 3, no report), and could
  forge the last line. Text modes now show control characters as escapes
  (`\n`, `\x1b`), the `next:` line ANSI-C quotes such a token (`$'…'`),
  names reach `why` escaped, and the guard still rejects a raw one in `why`.
  Output without control characters is byte-for-byte unchanged.
- **The y/N prompt confirms again** (pre-existing since 0.1.0): the answer
  callback passed to `readline/promises` was ignored, so `y` never
  confirmed.
- **Uncaught errors outside `main()`** (a timer, a floating rejection, a
  stream with no `'error'` handler) exit 3, not 1. An error while the module
  loads still exits 1; the docs now say so.
- **`next.argv[0]` is the script as invoked, made absolute**, and `next` gains a
  sixth field, `cwd` (the absolute directory the run happened in); the final
  round, above, settled both. `--go` goes before a `--` terminator. A failed
  item advises `stop` in a read-only run too.
- **Override flags.** The guard blocks any `--yes*` or `--force*`,
  `--assume-yes`, `--allow`, `--allow=*`, `--allow-*`, `--i-am-*` (any
  case), `-y` or `-Y` alone or grouped, and the tool’s own
  `EXTRA_OVERRIDE_FLAGS` (a new hook above the fence). An unconfirmed `--go`
  that carried an override advises `ask` with no `argv`.
- Both suites locate their files with `fileURLToPath`, not `URL.pathname`,
  so they pass from a path with a space (pre-existing). The README lists the
  names the fence owns; the scaffolded `CLAUDE.md` derives its runtime
  version from the fence. Tests: 28 → 40, a regression for each fix and for
  each of the gate’s surviving mutants.

- **`--json` gains top-level `contract`** (`"mjs-tool/2"`), **`effect`**
  (`"read-only"`, `"dry-run"`, or `"applied"`, from `effectFor()`), **`exit`**
  (the code the run returns), **`next`** (an object or `null`), and an
  optional **`state`** snapshot for status-type commands. The 0.1.0 keys keep
  their meaning.

- **The next-action layer.** `nextAction()` is the single, pure source of
  `next` (`action` of `done`, `run`, `wait`, `ask`, or `stop`; `who`; `argv`
  as an array; `afterSeconds`; `why`), starting from the runtime’s
  `defaultNextAction()`: a clean dry run advises `ask` (`run` with `--go`
  since the final round only for an auto-run command), a dry run with findings
  or a protected target advises `ask`, an applied run or an `inspect` advises
  `done`, a failure advises `stop`. Every text mode ends
  with one `next:` line. It is a convention on the existing modes: there is no
  `--babysit` or `--next` flag.

- **`assertSafeNext()`** runs inside `report()` before anything is written:
  `next.argv` never carries `--yes`, `--force`, `--allow-*`, `--i-am-*`, or
  `-y` (rule 2), and `next` never contradicts the exit code (rule 4; exit 0
  allows `ask`). A violation throws, and the run exits 3.

- **The runtime fence.** The shared machinery lives in one block,
  `// ---- mjs-tool runtime v2 (do not edit; replace wholesale) ----` to
  `// ---- end mjs-tool runtime v2 ----`, byte-identical in the skeleton and
  in `bin/new-tool.mjs`, which no longer re-implements the renderer (its brief
  summary column had drifted to 20 against the skeleton’s 38; it is 38 now).

- **Exit codes.** An exception escaping `main()` exits 3 — “could not run to
  completion: an environment or internal error” — instead of 1, which reads as
  a partial result. `--quiet --json` is a usage error (exit 2), like
  `--brief --json`.

- **Frozen:** the `--brief` item and summary lines, and the human blocks, are
  byte-identical to 0.1.0, padding and the `(dry run: pass --go to apply)`
  suffix included; a golden test locks them.

- `inspectOne` and `applyOne` share one `statTarget()` preamble. The scaffolder
  header says why it has no `--go` (it only creates a directory that did not
  exist, and refuses otherwise). The README sample block is regenerated from
  a real run: the 0.1.0 sample showed a `warn` line `apply` never produces.
  README gains “Adopting the contract in an existing tool” (the alias policy
  for older flag dialects); `AGENT-USAGE.md` gains the babysit loop, and the
  rule that a runbook wins over `next`.

- Tests: 14 → 28.

## 0.1.0 — 2026-09-20

Review fixes before the first push (Fable 5.1 verify pass, same day): EOF at the
confirmation prompt now declines (report rendered, exit 1) instead of exiting 0
with no report after a partial batch; brief-mode summary column widened to fit
the longest shipped summary; README sample block regenerated from a real dry
run; generated tests no longer carry the skeleton's name in temp dirs.


Initial release.

- **`skeleton/tool.mjs`** — the template: a single-file Node 20+ ESM CLI with
  two placeholder commands (`inspect` read-only, `apply` mutating), four output
  modes (human, `--brief`, `--json`, `--quiet`) all rendered from one set of
  item objects by a single `report()`, a `verdict()`/`glyph()` pair as the one
  place verdict semantics live, a dry-run mutation gate (`--go`), exit codes
  0/1/2/3 documented in the header, `--help` printed from that header, and a
  symlink-safe entry-point guard (`realpathSync(process.argv[1])`). No
  interactive prompt unless stdin is a TTY; a step that would prompt refuses
  (exit 1) rather than hang unattended. Data on stdout, diagnostics on stderr;
  `--json` stdout is JSON only. Zero dependencies.
- **`skeleton/tool.test.mjs`** — `node --test` suite locking the contract:
  brief’s one-line-per-item and kept refusal, json’s parseable stable schema
  and matching counts, the dry-run/`--go` mtime gate, exit codes, the non-TTY
  prompt refusal, `--help`, and a symlinked invocation still running `main()`.
- **`bin/new-tool.mjs`** — an `npx`-able scaffolder that copies the template
  into `<dir>/<name>/` (tool, test, `package.json`, `README.md`, `CLAUDE.md`
  with the agent-usage block, `LICENSE`), substituting the name throughout and
  refusing to overwrite an existing directory. Dogfoods the convention
  (`--brief`/`--json`/`--quiet`, same exit codes).
- **`AGENT-USAGE.md`** — the verbatim-ready block a tool’s `CLAUDE.md` carries
  so an agent drives the tool correctly.
- **`README.md`**, **`CLAUDE.md`**, **`EFFORT.md`**, **`LICENSE`**,
  **`package.json`**.
