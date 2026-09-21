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

Zero dependencies, Node 20+ ESM, no Python. The convention it encodes is real
and predates this repo (a private pipeline repo of Dan’s); this is the extracted
public shape, not a copy of that code.

## The load-bearing invariants — do not regress

1. **One item list, every mode.** Human, `--brief`, `--json`, and `--quiet` are
   all rendered by `report()` from the same `items` array. Never add a mode that
   computes its own facts, and never let a `console.log` narrate outside
   `report()` — that is exactly the human/agent drift this repo exists to
   prevent.
2. **`verdict()` and `glyph()` are the single source of truth.** All five
   verdicts (`ok`, `warn`, `skip`, `refuse`, `fail`) and their meaning live in
   `verdict(item)`; their symbols live in the `GLYPH` map. A command function
   sets facts on an item and calls `verdict(item)` — it never hardcodes a
   verdict string except for outcomes that aren’t fact-derived (e.g. the
   scaffolder’s “created”/“refuse”).
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
   prompt text and every `note:`/`error:` line go to stderr.
8. **Exit codes:** 0 all ok (skips are not failures) · 1 partial
   (warn/refuse/fail) · 2 usage · 3 environment. `exitCodeFor()` owns the
   mapping.

## The `<tool>` placeholder and substitution

The skeleton’s **runtime** name comes from its own filename
(`basename(realpath) - '.mjs'`), so a copied/renamed file reports the right
name with no edit. Only the **header comment** (which doubles as `--help`) uses
the literal placeholder `<tool>` for the command name. `new-tool` does exactly
two substitutions when it copies the template:

- in `<name>.mjs`: `<tool>` → the tool name (header only; there is no `<tool>`
  in the code below the header);
- in the test: the one locator line
  `new URL('./tool.mjs', import.meta.url)` → `new URL('../<name>.mjs',
  import.meta.url)`, because the scaffolded test lives in `test/` (one level
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
inspect) to prove the copy is runnable. `node --test` from the repo root
discovers both `skeleton/tool.test.mjs` and `test/new-tool.test.mjs`.

When you scaffold into a temp dir to check something by hand, delete the output
afterward — don’t leave a generated tool tree in the repo.

## Publishing

The owner publishes manually — never run `git push`, `git remote add`, or
create a GitHub repo from a session. Preflight before any commit: `npm test`
green, and a scaffold-into-tmpdir smoke test whose generated tool’s own tests
pass.
