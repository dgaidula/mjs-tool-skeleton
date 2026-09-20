# EFFORT.md — mjs-tool-skeleton

One row per work-pass. Agent metrics (duration/tokens/tool-calls) are exact
when taken from completion records; *(see orchestrator row)* means this agent’s
own duration/token counts are not visible to it — the orchestrator session
holds those. Git author is the machine identity, not who did the work.

| date | agent/model | role | scope | duration | tokens | tool-calls | outcome |
|---|---|---|---|---|---|---|---|
| 2026-09-20 | Claude Opus 4.8 (1M ctx) [xhigh] (builder) | builder | Built mjs-tool-skeleton 0.1.0 from scratch: `skeleton/tool.mjs` (inspect/apply placeholder commands, human/`--brief`/`--json`/`--quiet` from one `report()`, `verdict()`/`glyph()` single source, `--go` dry-run gate, exit codes 0/1/2/3, `--help` from header, symlink-safe entry guard, non-TTY prompt refusal), `skeleton/tool.test.mjs` (9 tests), `bin/new-tool.mjs` scaffolder (dogfoods the modes, refuses overwrite, name substitution) + `test/new-tool.test.mjs` (5 tests), `AGENT-USAGE.md`, `README.md`, `CHANGELOG.md`, `CLAUDE.md`, `LICENSE`, `package.json`. All 14 tests green; scaffolded a tool into a temp dir and ran its generated suite (9 green) before deleting it. | see orchestrator row | see orchestrator row | see orchestrator row | success |
