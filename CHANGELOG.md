# Changelog

## Unreleased

## 0.2.0 — 2026-09-23

Contract `mjs-tool/2`: a next-action layer, an explicit effect, and one shared
runtime block. Additive for `--json` consumers; the text modes gain one line.

- **`--json` gains top-level `contract`** (`"mjs-tool/2"`), **`effect`**
  (`"read-only"`, `"dry-run"`, or `"applied"`, from `effectFor()`), **`exit`**
  (the code the run returns), **`next`** (an object or `null`), and an
  optional **`state`** snapshot for status-type commands. The 0.1.0 keys keep
  their meaning.

- **The next-action layer.** `nextAction()` is the single, pure source of
  `next` (`action` of `done`, `run`, `wait`, `ask`, or `stop`; `who`; `argv`
  as an array; `afterSeconds`; `why`), starting from the runtime’s
  `defaultNextAction()`: a clean dry run advises `run` with `--go`, a dry run
  with findings or a protected target advises `ask`, an applied run or an
  `inspect` advises `done`, a failure advises `stop`. Every text mode ends
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
