# mjs-tool-skeleton — maintainer notes

Agent-facing notes for future Claude sessions working on this repo. `README.md`
is the user-facing pitch; `AGENT-USAGE.md` is the block that ships into
generated tools; this file is for whoever next touches the skeleton or the
scaffolder.

## What this is

A template for Dan’s single-file Node CLI tools, so every new tool is usable by
a person and by an agent from **one set of item objects**. Two moving parts:

- `skeleton/tool.mjs` — the template a tool is copied from. Runnable as-is with
  a placeholder command set (`inspect`/`apply`).

- `bin/new-tool.mjs` — the scaffolder that stamps out a new tool from the
  template, substituting the name.

Both end in the same **runtime fence**: the block between
`// ---- mjs-tool runtime v2 (do not edit; replace wholesale) ----` and
`// ---- end mjs-tool runtime v2 ----`, which holds everything shared (the
renderer, the `next` guard and default policy, the exit paths, `--help`,
`--version`, the entry guard). The tool-specific code sits above it.

Zero dependencies, Node 20+ ESM, no Python. The convention it encodes is real
and predates this repo (a private pipeline repo of Dan’s); this is the extracted
public shape, not a copy of that code. The current contract is `mjs-tool/2`.

## The load-bearing invariants — do not regress

1. **One item list, every mode.** Human, `--brief`, `--json`, and `--quiet` are
   all rendered by `report()` from the same `items` array. Never add a mode that
   computes its own facts, and never let a `console.log` narrate outside
   `report()` — that is exactly the human/agent drift this repo exists to
   prevent.

2. **`verdict()` and `glyph()` are the single source of truth.** All five
   verdicts (`ok`, `warn`, `skip`, `refuse`, `fail`) and their meaning live in
   the tool’s `verdict(item)`; their symbols live in the fence’s `GLYPH` map. A
   command function sets facts on an item and calls `verdict(item)` — it never
   hardcodes a verdict string except for outcomes that aren’t fact-derived
   (e.g. the scaffolder’s “created”/“refuse”).

3. **A non-`ok` line is never collapsed or dropped.** `--brief` prints one line
   per item and shows the parenthesised reason for every non-`ok` verdict.
   Refusals, warnings, and skips must survive every mode.

4. **The mutation gate stays a real dry run.** `apply` without `--go` must
   change nothing and preview faithfully; `--go` performs it.

5. **The TTY rule is the safety property.** No prompt unless
   `process.stdin.isTTY`; a step that would prompt refuses (exit 1) rather than
   hang. This is what makes a tool safe unattended — do not add a prompt that
   can block a non-TTY run.

6. **The entry guard resolves symlinks.** `realpathSync(process.argv[1])` on
   both sides of the `import.meta.url` comparison. The naive guard skips
   `main()` under an `npm link` symlink (silent exit 0, no output). The symlink
   test locks this — keep it.

7. **stdout is data, stderr is diagnostics.** `--json` stdout is JSON only. The
   prompt text and every `note:`/`error:` line go to stderr. Usage and
   could-not-run errors leave stdout empty.

8. **Exit codes:** 0 all ok (skips are not failures) · 1 partial
   (warn/refuse/fail) · 2 usage · 3 could not run to completion (an environment
   error, or an internal error: an exception escaping `main()`, including a
   `next` the guard rejects). `exitCodeFor()` owns 0/1, `usageError()` 2, and
   `environmentError()` plus the entry guard’s catch 3 — all in the fence. The
   entry guard also installs `uncaughtException` and `unhandledRejection`
   handlers, so a throw from a timer, a floating promise, or a stream with no
   `'error'` handler exits 3 too. An uncaught throw before the report must
   never exit 1: that would read as a partial result. One after the report is
   printed, but the run exits with the report’s code (`reportedExit`): nothing
   may contradict the `exit` a caller already read. The one gap: an error
   while the module loads (a syntax error, a top-level use of a fence name
   above the fence) happens before the fence runs, and Node exits 1.
   `report()` ends the run: its write callback exits with the reported code
   once stdout has flushed, and a `main()` that returns without a report
   exits the same way (`exitAfterFlush()`), so no open handle can hold the
   process. Never `process.exit()` right after output, which drops unflushed
   stdout (a pipe takes 64 KiB at a time on macOS). Nor does the runtime wait
   for the event loop to drain (that is the open-handle hang), so a tool
   awaits, or synchronously flushes, every file write before `main()` calls
   `report()` or returns: an un-awaited write, such as an append-mode
   logger’s closing line, is cut off (a pilot tool’s batch log lost its last
   line in 5 of 5 runs). The docs say so; the fence does not change for it.

9. **`nextAction()` is the single source of `next`**, as `verdict()` is of
   verdicts: pure, fed the command, the finished items, `effect`, and argv,
   never re-probing the world. The tool’s policy sits outside the fence and
   starts from the fence’s `defaultNextAction()`; `main()` hands its result
   to `report()`, which renders it as the `next` object in `--json` and as
   the last line of every text mode. A clean dry run advises `ask` unless the
   tool lists the command in `AUTO_RUN_COMMANDS` (empty by default), and only
   then `run` with `--go`: auto-run is the tool’s opt-in, never the default.
   A `null` next (a tool that has not adopted the layer) renders no line.

10. **The `next` safety rules are enforced, not documented.** `report()` calls
    `assertSafeNext(next, exit, { effect, argv })` before it writes a byte,
    and a violation throws (exit 3). Rule 2: `next.argv` never carries `--yes*`, `--force*`,
    `--assume-yes`, `--allow`, `--allow=*`, `--allow-*`, `--i-am-*` (long forms
    case-insensitive, with or without `=value`), `-y` or `-Y` alone or grouped,
    or a flag in the tool’s `EXTRA_OVERRIDE_FLAGS`; a step that needs one is
    `ask`. Rule 4: `next` never contradicts the exit code — 0 allows
    done/run/wait/ask, 1 any, 2 and 3 only stop. The guard also fixes the shape
    (exactly `action, who, argv, afterSeconds, why, cwd`; `who` is
    `NEXT_WHO[action]`, never chosen — `nextStep()` takes no `who` or `cwd`;
    `run`/`wait` need an argv, and every argv (an `ask`’s included) starts
    with `selfArgv()`, this node and this script, so advice always re-enters
    the tool’s own gates; a `run` that carries `--go` is exactly
    `rerunArgv(argv, '--go')` of the dry run it follows, checked against the
    `effect` and `argv` that `report()` is handed (the argv the tool gave
    `nextAction()`, or else the process’s own), so advice goes straight to
    `--go` only on what was just previewed and a step into another command
    carries no `--go`; no `argv` carries a `--go` alias the tool declares
    in `GO_ALIASES` (advice spells `--go`, which those checks read);
    `done`/`stop` carry none; `wait` never carries `--go` or a
    `MUTATING_COMMANDS` name;
    `why` is one line with no control characters; `cwd` is `START_CWD`, read
    as the module loads). `rerunArgv()` builds `[process.execPath, script as
    invoked, …argv]` and puts extra flags before any `--`. `nextStep()`
    escapes and clips `why` itself, because the guard runs after the work is
    done. Text modes escape control characters (`printable()`, and `$'…'`
    quoting in the `next:` line, which writes one past ASCII as its UTF-8
    bytes, `\xHH`, since bash 3.2 does not decode `\u`): C0 but TAB, DEL,
    C1, U+2028/2029, and the bidi controls, so a filename can neither break
    a line, reorder it, nor trip the guard. The `next:` line prints a command only for `run`/`wait`,
    led by `cd <cwd> &&` (quoted like the argv) so it runs as pasted from any
    directory, and for `ask` only in human mode, as `your call: …`, with no
    `cd` (its reader is in the directory already). Never move the call
    out of `report()`, never loosen the lists, and never give an override
    flag a short alias other than `-y` unless the tool declares it in
    `EXTRA_OVERRIDE_FLAGS` — the guard knows no other.

11. **`effect` comes only from `effectFor(command, go)`**, which reads the
    tool’s `MUTATING_COMMANDS`; `contract` comes only from the fence’s
    `CONTRACT`. `effect` is what the run was allowed to do, not what changed:
    a `--go` run whose items all refused is still `applied`. The fence checks
    the tool’s hooks as it loads (`HOOK_ERROR`): `MUTATING_COMMANDS` and
    `AUTO_RUN_COMMANDS` Sets, `EXTRA_OVERRIDE_FLAGS` and `GO_ALIASES` arrays
    of strings, `nextAction` and `main` functions; a bad one exits 3 by name
    (and throws on import).

12. **The fence is byte-identical everywhere.** `skeleton/tool.mjs` and
    `bin/new-tool.mjs` carry the same block, and the fence test fails until
    they match: edit it in the skeleton, then copy the whole block into the
    scaffolder byte for byte. It stays the last thing in the file (the entry
    guard is its last statement, so every top-level binding is initialised
    before `main()` runs), carries its own namespaced imports, holds no
    tool-specific code and no `<tool>` placeholder. A contract change bumps
    the marker version and `CONTRACT` together (`v3`, `mjs-tool/3`).

13. **Text output is frozen to 0.1.0.** The brief item and summary lines, and
    the human blocks, are byte-identical to what 0.1.0 printed, padding and
    the `(dry run: pass --go to apply)` suffix included; the only v2 addition
    is the final `next:` line, whose form differs by mode (invariant 10). The
    golden test locks it — change it only on Dan’s say-so.

## The `<tool>` placeholder and substitution

The skeleton’s **runtime** name comes from its own filename
(`basename(realpath) - '.mjs'`), so a copied/renamed file reports the right
name with no edit. Only the **header comment** (which doubles as `--help`) uses
the literal placeholder `<tool>` for the command name. `new-tool` does exactly
two substitutions when it copies the template:

- in `<name>.mjs`: `<tool>` → the tool name (header only; there is no `<tool>`
  in the code below the header);
- in the test: the one locator expression
  `new URL('./tool.mjs', import.meta.url)` (the `TOOL_URL` line) →
  `new URL('../<name>.mjs', import.meta.url)`, because the scaffolded test lives in `test/` (one level
  down) while the skeleton test sits beside its tool.

If you change either of those exact strings in the skeleton, update the
matching substitution in `bin/new-tool.mjs` — the `name is substituted
throughout` scaffolder test guards the `<tool>` half.

## `--help` from the header

`helpText()` reads this file’s own leading `//` block (skip the shebang, take
contiguous `//` lines, strip `// `). **Every line of the header block must
start with `//`** — a truly blank line terminates the block early. Write spacer
lines as `//`, not empty. Keep the header the real spec of the tool: it is what
a person and an agent both read.

## Version resolution

`readVersion()` walks up from the script directory to the nearest
`package.json`. For a scaffolded tool that is its own `<name>/package.json`; for
the skeleton in this repo it is the repo `package.json`. Don’t hardcode a
version.

## Test strategy

Both suites are black-box via `spawnSync` (which gives the child a non-TTY
stdin — that is what the prompt-refusal test relies on), plus a few exported
pure helpers. Temp dirs come from `mkdtempSync` and are removed in `finally`.
The scaffolder test actually runs the generated tool (`--version`, a `--json`
inspect) to prove the copy is runnable, and runs its whole shipped suite
(`node --test` in the scaffolded dir, with `NODE_TEST_CONTEXT` removed from
the env so it runs as a top-level suite). `node --test` from the repo root
discovers both `skeleton/tool.test.mjs` and `test/new-tool.test.mjs`.

The contract tests import the tool in-process (the entry guard keeps `main()`
from running) to drive `assertSafeNext()` and `report()` with injected
policies. Faults only a changed program can produce (an uncaught throw, an
override flag smuggled into a re-run argv, an open handle, a late error)
come from a temp copy of the tool with one line of the fence patched: the
fence is identical in every tool, so those anchors survive a tool author’s
TODO(tool) edits. The copy is a plain file with no executable bit, which is
also how the suite proves `next.argv` runs without one. Auto-run is tested
the same way (the `AUTO_RUN` anchor turns the default `ask` into `run`),
and the load-time hook check from `withRuntime()`, a file of bare hook
declarations followed by the tool’s own fence. The 0.1.0 golden lines
live inline in `test/new-tool.test.mjs`.

The y/N prompt is tested with injected streams; the real TTY path is a manual
check (a pty test proved timing-sensitive under `script`). From a temp dir
holding a `protected.txt`, `sh -c "sleep 1; printf 'y\n'; sleep 1" | script -q
/dev/null node skeleton/tool.mjs apply protected.txt --go --brief` must touch the
file and exit 0; `n` in place of `y`, or `printf '\004'` (Ctrl-D), refuses and
exits 1.

When you scaffold into a temp dir to check something by hand, delete the output
afterward — don’t leave a generated tool tree in the repo.

## Publishing

The owner publishes manually — never run `git push`, `git remote add`, or
create a GitHub repo from a session. Preflight before any commit: `npm test`
green, and a scaffold-into-tmpdir smoke test whose generated tool’s own tests
pass.
