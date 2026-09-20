# Changelog

## Unreleased

## 0.1.0 - 2026-09-20

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
