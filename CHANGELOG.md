# Changelog

## 0.4.1 — 2026-10-30

- **A scaffold carries its own author, not the skeleton’s (D583).** Every tool `new-tool` wrote had `author: Danniel T. Gaidula <dan@iceboxind.com>` in its `package.json` and `MIT © Danniel T. Gaidula` in its README, so a stranger who scaffolded and published a tool would have listed the skeleton’s owner and email. The author now comes from `--author "<Name> <email>"` (both parts required, one line; a bad value is exit 2 naming the flag, before anything is written), else npm’s `init-author-name` and `init-author-email`, else git’s `user.name` and `user.email` (with a `note:` on stderr, since a git identity is often not the name an author publishes under), else the placeholder `TODO: Your Name <you@example.com>` and `MIT © TODO: Your Name`. A source counts when it gives a name. Lookups use `execFile` (no shell), a 5-second timeout and `GIT_TERMINAL_PROMPT=0`, and a failure or timeout means unset; they run only once the target directory is known to be free. The copied `LICENSE` is unchanged, since the MIT licence requires its notice to travel with the code. The scaffolder’s `--help`, `--cheat` card and the README say all this and how to set the npm keys. The scaffolder suite gains nine tests (the four sources, name-only and email-only sources, the `--author` refusals, a refused target that looks nothing up, a failing and a hanging lookup, and a check that the two `requireValue` copies match) and every scaffolder run now uses a temporary home with no real npm or git config in reach. All of it sits outside the fence.
- **`requireValue()`, a fail-fast flag-value helper in the template’s tool body (D615).** `requireValue(flag, value, { multiline = false })` returns the trimmed value, or exits 2 through the fence’s `usageError()`, with stdout empty and one message naming the flag, for a missing value, one blank after trim, or (unless `multiline`) one holding a line break. The template’s `apply` takes a placeholder `--note <text>` through it, so a new tool inherits the pattern; two tests in `skeleton/tool.test.mjs` (which ships into every scaffold) lock it. It sits above the fence, so the runtime fence and every adopter’s pinned fence hash are unchanged (sha256 `caf3bd4c…` before and after, both in `skeleton/tool.mjs` and in `bin/new-tool.mjs`).
- **Release-gate fixes to the author lookups and their tests.** npm’s lookups pass `--logs-max=0`, so a scaffold leaves no debug log in `~/.npm/_logs` and the header’s “all it writes is a directory that did not exist” holds again. A config source whose name or email holds a line break or an angle bracket is still skipped for the next source, now with one `note:` on stderr naming the key. `--help` names a bad `--author` among the usage errors. The test home stops npm and git walking up out of it (a `package.json` in it, and `GIT_CEILING_DIRECTORIES`), so the suite stays green with `TMPDIR` inside a checkout or a project, and `isolatedEnv()` takes its base environment. New tests: no npm debug log; bait `npm_config_*`, `NPM_CONFIG_*` and `GIT_CONFIG_*` variables never reach the lookups; the skipped-source note; four more `--author` refusals (a second address, no `@`, an angle bracket in the name, a space in the email); a bad `--author` beside an existing target is exit 2; and the fence’s pinned sha256 in both files. The hanging-lookup test now times itself (under 10 s) and no longer claims to check for a shell, and the skeleton’s `--note` test checks that `apply` without `--note` has no `note` key and that `inspect --note` warns. The README and a scaffold’s `CLAUDE.md` count eleven `TODO(tool)` spots, the README names `--note` as a placeholder and gains a Known limits list, and ADOPTING.md §2 says how an adopted tool may copy `requireValue()`. The runtime fence is unchanged.
- **Only your own user-level settings choose the author (D634).** The npm and git lookups ran in whatever directory `new-tool` ran in, so a project `.npmrc` there (silently) or a repo-local git identity decided a public package’s author. They now run with `cwd` set to your home folder, so npm’s project layer cannot apply, and git is asked with `git config --global`. They also pass `NODE_DISABLE_COMPILE_CACHE=1`, so npm 11 leaves no `node-compile-cache` under `$TMPDIR`; an empty `~/.npm` may still appear in a home where npm never ran (Known limits). New tests: a bait project and repo around the working directory (run from inside it) and a home that is itself a git checkout give the user-level author; a bait project and repo around the test home itself are never read; the no-writes test checks `$TMPDIR`; the hanging-lookup test expects `--global`.
- **The one-line rule knows every line break, and an author holds no control character (D635).** `requireValue()` (both copies, still identical) also treats U+2028, U+2029 and U+0085 as line breaks unless `multiline`. `--author` refuses a control character (C0, TAB included, DEL, C1) or a bidi control, the characters the runtime’s `printable()` escapes, and a config-sourced name or email holding one is skipped with a `note:` saying “a line break” or “a control character”. New tests cover each class for the flag and for git and npm config. The F2 and F9 Known-limits entries are gone.
- **Test fixes from the re-check.** `isolatedEnv()` has a positive control (a `base` variable survives, `npm_config_*` and `GIT_*` do not), and the skipped-source rules are pinned: a bad npm name with a good git identity gives the git author and both notes, a bad email moves on to the next source, and a git `user.name` with an escaped `\n` is noted as a line break. The runtime fence is unchanged (sha256 `caf3bd4c…`).

- **Node 24 or newer.** `engines` in the skeleton’s own `package.json` and in every package `new-tool` writes moves from `>=20` to `>=24`, and the README, CLAUDE.md and the generated README say so. Node 20 reached end of life on 2026-04-30 and Node 26 became LTS on 2026-10-28 (nodejs.org dist index and the nodejs/Release schedule, read 2026-10-28). Nothing in the runtime fence changes, so no adopted tool’s fence hash goes stale. Adopted tools move their own `engines` when next touched (D502).
- **A scaffold ships its `CLAUDE.md`.** The generated README links it, so `new-tool` now lists it in the generated `files`. The README links `ADOPTING.md` on GitHub (the package does not carry it), says that `--brief` wins over `--quiet`, names its platform, and drops stale 0.2.0 wording. New tests hold a warn-only run at exit 1, `--brief` over `--quiet`, `engines` in the skeleton and a scaffold, and that both READMEs link only files their package ships. The runtime fence is unchanged.

## 0.4.0 — 2026-10-25

Contract `mjs-tool/3`. The runtime fence changes (so every adopted tool’s
pinned fence hash goes stale until it re-syncs; `ADOPTING.md` §10 is the
procedure), the marker is `runtime v3`, and `--json` reports
`"contract": "mjs-tool/3"`. Nothing else in `--json`, no exit code, and no
human, `--quiet`, summary or `next:` line changes.

- **`--brief` is for an agent’s context: never longer than the human output.**
  An audit of 30 paired runs across 24 adopted tools found `--brief` longer than
  the human output on 10, all from the one shared renderer: it padded the
  verdict to 6 characters and the summary to 38, and added a glyph. The item
  line is now `<verdict> <summary>  <name>`, with no padding and no glyph, and
  a non-`ok` reason still follows in parentheses, cut at 160 characters and
  ending `… (+N chars; --json for all)`, N being the characters cut (the
  reason’s own code points, counted before control characters are escaped, so
  a surrogate pair is never split and the cut never falls inside an escape;
  `--json` and human keep the whole reason). The cut applies only where it
  shortens the reason, so for printable ASCII 161 to 191 characters print whole; fewer
  for multi-byte text, since the comparison is in bytes. The fence drops
  `VERDICT_WIDTH` and `SUMMARY_WIDTH` and adds `REASON_CUT` and `briefReason`.
  Tests: a rule test runs ten samples in both modes and generated items (every
  verdict, four summaries, three names, sixteen reasons including an empty
  one, one to three items, and mixed lists of reasonless `refuse` items) and
  asserts `bytes(brief) <= bytes(human)`; the cut is pinned at 159, 160, 161,
  191, 192 and 400+ characters, with CJK text, an emoji, an ESC and a bidi
  control at the cut; the 0.1.0 golden test keeps the human and summary lines
  and takes the new brief lines. Skeleton suite 50 → 55, scaffolder suite 11. Docs: README (the `--brief` line
  and its sample, the contract strings), AGENT-USAGE (the cut form is the
  quote), ADOPTING §10 (re-syncing a tool), CLAUDE.md invariants 12 and 13.

- **ADOPTING.md: lessons from five more adoptions, and open item 2 done.**
  Five adoptions run as a queue on 2026-10-16 (a key-expiry checker, a
  settings-schema snapshotter, an archiver that deletes files with the test
  runner it drives, a deploy-key manager, and a transcript-size reporter) add
  rules, each marked with its phase: an adoption never adds an approval or
  stops automation (every unattended caller passes `--go`, and a test reads the
  documents for one that does not); `--brief` is always brief and wins over
  human; the old `--json` object moves to `state`; an old confirmation prompt
  goes; a secret-bearing input is never echoed; steps as items, the way back
  after a partial failure, and a re-list standing in for `lstat` on a remote
  API; and the plan-digest cache treated as untrusted input. Open item 2, a
  conformance check that hashes the fence body, now exists in a conformance
  scanner, and §6 and the item define the hash (the runtime block from the
  opening fence line through the closing line, markers included) and its four
  states: unedited, edited, unknown, not-checked. Docs only; the fence and
  `CONTRACT` are unchanged.

- **ADOPTING.md §9: adopting with Commander.** A Commander-based tool keeps
  its parser and adopts `mjs-tool/2`: the rules, a `main()` head checked
  against the skeleton’s own contract suite (50/50, commander 15), when to
  start with Commander rather than `parseArgs`, and the behaviour changes an
  existing Commander tool’s owner should hear about first. Docs only; the fence
  and `CONTRACT` are unchanged.

## 0.3.0 — 2026-10-18

Additive: the contract string stays `mjs-tool/2` and the runtime fence is
byte-identical, so every adopted tool’s pinned fence hash still matches.

- **`--cheat`: a tool prints its own tldr page.** A short card of common
  invocations (a title, a `>` description block ending
  `More information: <tool> --help.`, and 3 to 6 example pairs in tldr’s
  `{{placeholder}}` syntax), rendered by `tldr --render` and gathered by a
  collector, so a card comes from the tool and cannot drift from its flags.
  It is a *should*, not part of the `mjs-tool/2` conformance bar: a tool
  without it is still conformant. `--cheat` is not an output mode: it prints
  the card, exits 0 and prints nothing else; beside `--brief`, `--json` or
  `--quiet` it is a usage error (exit 2, nothing on stdout). The card lives
  in a `CHEAT` constant above the fence; the template and `new-tool` itself
  both ship one (a scaffolded tool gets its own name in it), and the
  skeleton’s tests gain `parseCheat()`, a validator an adopted tool can copy.
  Docs: README (the contract and the test list), AGENT-USAGE, and a new
  ADOPTING.md §8 with the mechanical steps for an existing tool. Tests: 46 →
  50 in the skeleton suite, 8 → 11 in the scaffolder suite.

- **`ADOPTING.md`: the adoption procedure.** Callers, verdict meanings, `next`
  overrides, mutating-tool safety, tests and a done checklist, written from
  the 2026-10-03 adoptions (a linter, a renamer, and an AppleScript runner
  that tested the draft, a fleet-wide generator, an unattended watcher, and a
  personal-finance CLI),
  a new dedup tool, and
  their gates. README adoption step 4 gains the hash-pin path. Docs
  only; the contract and the fence are unchanged.
- **`ADOPTING.md` §5: the plan-digest recipe** (open item 3, now done), from
  its first gated adoption: what the digest covers, where it shows, how
  `--go --plan` refuses, where the record is cached, the runbook step, and
  the tests. No fence change.

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
