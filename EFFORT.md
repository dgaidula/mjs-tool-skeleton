# EFFORT.md — mjs-tool-skeleton

One row per work-pass. Agent metrics (duration/tokens/tool-calls) are exact
when taken from completion records; *(see orchestrator row)* means this agent’s
own duration/token counts are not visible to it — the orchestrator session
holds those. Git author is the machine identity, not who did the work.

| date | agent/model | role | scope | duration | tokens | tool-calls | outcome |
|---|---|---|---|---|---|---|---|
| 2026-09-20 | Claude Opus 4.8 (1M ctx) [xhigh] (builder) | builder | Built mjs-tool-skeleton 0.1.0 from scratch: `skeleton/tool.mjs` (inspect/apply placeholder commands, human/`--brief`/`--json`/`--quiet` from one `report()`, `verdict()`/`glyph()` single source, `--go` dry-run gate, exit codes 0/1/2/3, `--help` from header, symlink-safe entry guard, non-TTY prompt refusal), `skeleton/tool.test.mjs` (9 tests), `bin/new-tool.mjs` scaffolder (dogfoods the modes, refuses overwrite, name substitution) + `test/new-tool.test.mjs` (5 tests), `AGENT-USAGE.md`, `README.md`, `CHANGELOG.md`, `CLAUDE.md`, `LICENSE`, `package.json`. All 14 tests green; scaffolded a tool into a temp dir and ran its generated suite (9 green) before deleting it. | see orchestrator row | see orchestrator row | see orchestrator row | success |
| 2026-09-20 | Claude Fable 5.1 (`claude-fable-5-1`, 1M ctx) [xhigh] (verifier subagent, exact: 615s, 127,070 tok, 27 tool uses) | verifier | Refutation pass over 0.1.0: 14/14 tests on Node 26 and 18; modes agree; gate, exit codes, symlink guard, scaffolder, typography, README accuracy probed with commands. One real defect (EOF at the y/N prompt → exit 0, no report after partial mutation) + 8 lower findings; verdict FIX FIRST | 615s (exact) | 127,070 (exact) | 27 (exact) | success — defect found before first push |
| 2026-09-20 | Claude Fable 5.1 (`claude-fable-5-1`, 1M ctx) [high] | orchestrator | Spec'd the skeleton from the convention in a private pipeline repo, briefed the Opus 4.8 builder, spawned the verifier, applied the fixes (prompt close-handler, column width, README sample, changelog dash, generated temp name), reprobed Ctrl-D on a real pty (declines, exit 1), reran suite + a scaffolded sample (14/14, 9/9). Wall-clock is an estimate | ~30 min (estimate) | not measured | ~10 | success |
