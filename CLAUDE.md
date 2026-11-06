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
`// ---- mjs-tool runtime v3 (do not edit; replace wholesale) ----` and
`// ---- end mjs-tool runtime v3 ----`, which holds everything shared (the
renderer, the `next` guard and default policy, the exit paths, `--help`,
`--version`, the entry guard). The tool-specific code sits above it.

Zero dependencies, Node 24+ ESM, no Python. The convention it encodes is real
and predates this repo (a private pipeline repo of Dan’s); this is the extracted
public shape, not a copy of that code. The current contract is `mjs-tool/3`.

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
    the marker version and `CONTRACT` together (v3 and `mjs-tool/3` did this in 0.4.0, for the `--brief` lines; a revision that leaves the brief lines, the `--json` keys and the exit codes alone keeps the version). A revision has no number of its own: it is the skeleton release that carries it and the block’s sha256, which the fence test pins. 0.5.0 is the first, for the human layout and `--help` (invariant 15): the marker stays `runtime v3`, `CONTRACT` stays `mjs-tool/3`, the skeleton moves to a new minor version, and the sha256 moves from `caf3bd4c…` to `30e4ef6c…` (`af807ab4…` taken with the newline after the closing marker; `ADOPTING.md` names both in full). Every new top-level name in the fence is one no adopted tool declares: the block is pasted above code it has never seen, and a clash is a `SyntaxError` as the module loads (exit 1, invariant 8). The human layout’s names carry the `runtime`/`RUNTIME_` prefix, as the namespaced imports do, because 0.5.0’s first `LABEL` clashed with an adopted tool’s own; before a release, scan every adopted tool for a top-level declaration of each fence name and `node --check` a copy with the new block swapped in.

13. **Text output is frozen, except the `--brief` item line, which has one rule, and the human layout, which changed once.**
    The summary line is byte-identical to what 0.1.0 printed, the
    `(dry run: pass --go to apply)` suffix included, and so is the text of each
    human item block (the glyph and name, the summary, the `lines`, the reason).
    What came after: the final `next:` line (v2), whose form differs by mode
    (invariant 10), and the layout of invariant 15 (0.5.0, Dan’s decision of
    2026-11-06, his words in CHANGELOG): a blank line between items, bold, and
    the optional mark. The golden test locks all of it — change it only on Dan’s
    say-so. The
    brief item line is `<verdict> <summary>  <name>`, with no padding and no
    glyph (v3, 0.4.0; Dan’s decision of 2026-10-24: `--brief` is to cut output
    noise and token use), and a non-`ok` reason follows in parentheses, cut at
    160 characters and ending `… (+N chars; --json for all)`. **`--brief` is
    never longer than the human output of the same run**, and a test runs the
    samples in both modes to hold it. Two edges of that: the cut applies only
    where it shortens the reason (the note is about 30 bytes, so for printable ASCII 161
    to 191 characters print whole, fewer for multi-byte text, since the
    comparison is in bytes; a literal cut there would make the line longer than
    the human reason line), and a `refuse` item with an empty reason is exactly
    as long as its human block (the verdict word is six letters), so the human
    blank lines are the whole margin (one after the last item, one between
    items): the brief output is one byte shorter for one such item, and one byte
    shorter again for each more. The size test carries an empty reason for that
    zero-margin case. The cut counts the reason’s own code points, before
    escaping, so it never falls inside an escape, and N counts the same way.

14. **`--cheat` is a *should* and lives above the fence.** The `CHEAT`
    constant, the `cheat` option and the short branch in `main()` are
    the tool’s own code (so the fence, the `CONTRACT` string and every
    adopted tool’s pinned fence hash are untouched; a contract addition of
    this size lands as a skeleton minor version, not a runtime revision). The
    branch sits right after `--version`, prints `CHEAT` with
    `console.log`, and returns: `--cheat` is not an output mode, so it does
    not go through `report()`, and a mode flag beside it is a usage error
    (exit 2). The card is a tldr page; its exact shape is spelled out by the
    comment above `CHEAT`, enforced by `parseCheat()` in the skeleton’s
    tests, and relied on by the `cheat-pages` collector. A change to that
    shape is a change to every adopted tool’s card. The adoption steps are
    ADOPTING.md §8.

15. **Bold, marks and help spacing are human layout, and only that** (0.5.0; Dan,
    2026-11-06: “in help have the command names in bold and then after the
    text for that section an extra line break. list: bold first line …; then
    put all the labels like ‘key:’ etc in bold; some system of emojis after the
    ‘ok:’ depending on how much time is left; then a return before the next
    key”, then “can the emoji go first … the emojis will line up vertically in
    a long list”). The default human mode and `--help` carry it; `--brief`,
    `--quiet` and `--json` never do, byte for byte (a test holds them equal
    under FORCE_COLOR, and the 0.5.0 pass proved them identical to 0ef6970).
    - **Bold** is SGR 1 on, 22 off, and only where `runtimeBoldEnabled()` says
      so: a TTY without a non-empty `NO_COLOR` and whose `TERM` is not `dumb`,
      or a `FORCE_COLOR` that is non-empty and not `0` or `false` (it outranks
      `NO_COLOR` and `TERM=dumb`, as in Node, whose `getColorDepth()` gives 2
      colours for `TERM=dumb` and 16 once `FORCE_COLOR=1` is set). Piped output
      has no escape byte. Sources are in the comment above it.
    - **Escape first, then bold.** Every item string goes through `printable()`
      and only then into `bold()` or `runtimeBoldLabels()`, so the text holds no ESC
      and cannot open, close or fake a bold span. The injection test holds that
      for every shape it can think of; never bold raw text.
    - **A label** is one to three lowercase words (digits after the first
      letter, dots, hyphens) ending in a colon that is followed by a space or
      the end of the line, at the start of the summary, a `lines` entry or the
      reason line, or after three or more spaces (`file mode: 600   directory
      mode: 700`). A URL, a time, a Windows path, a capital, a comma or a fourth
      word before the colon makes it not one; a sentence that opens with one to
      three lowercase words and a colon is one (`the file was: gone` bolds
      `the file was:`), and the tests say so. The name after the glyph and the
      `summary:` label are bold too.
      `next:` is not.
    - **Layout:** a blank line between items and exactly one before `summary:`,
      colour or not; nothing before the first item.
    - **`item.mark`** is a short string (a coloured dot, say) the tool sets,
      printed first on the summary line as `    <mark> <summary>`. A mark that
      is not a string, holds a control character (TAB included) or a bidi mark
      (U+200E, U+200F, U+061C) anywhere, its ends included (checked before the
      trim), or is blank once trimmed, is dropped whole; at most eight
      characters are kept, counted as grapheme clusters (`Intl.Segmenter`), so
      a joined emoji is never cut inside. It is never
      in `--brief`, `--quiet` or `--json` (`jsonItem()` does not copy it), so the
      facts it stands for belong in `data`, and the marks of one tool should
      share a column width.
    - **`--help`** (Dan, 2026-11-06, after the first pass: “all the lines like this ‘Creating a new key is the person’s job:’ should be bold then a return so they read like headers for that section … --quiet and --json spacing needs a fix so --json is its own section. I also think all the keys in the left column should be bold, since I use the light retina tx-02 I can miss things and the bold helps so each cmd or key is scannable.”):
      a heading is a line at the left margin that starts with a capital, ends
      in a colon and holds no other colon (`Usage:`, `Output modes (all rendered
      from the same item objects):`, or a prose lead-in a tool writes on its own
      line, `Creating a new key is the person’s job:`). It is bold, and one
      blank line follows it. It opens a section, which ends at the next heading
      or a line back at the margin. An entry, under a heading or directly under
      margin prose, is two spaces, a first token, two or more spaces and its
      text, and the token alone is bold in every section (a command name, up to
      three lowercase words, in `Commands:`; elsewhere a flag or a comma list
      of flags with any `<value>` or `[value]`, which may stand alone with its
      text below, or one word: a mode, an exit code, a name). A blank line
      follows each entry’s block. A line of two spaces that is not an entry
      (prose at the entry indent, a flag with one space after it) is a block of
      its own with a blank line before it (the 0.5.0 re-check’s R1-1). In
      `Usage:` the lowercase words after the tool name (the first token of the
      first usage line) are bold on each line that begins with that name; the
      name and the arguments are not, a line with no subcommand
      (`tool --help | --version`) bolds nothing, and no blank lines come
      between usage lines. The help opens with one blank line, and the tool’s
      name where the first line opens (`name - …`, an en or em dash, or
      `name: …`) is bold. Two blank lines come before every heading that
      follows content and one after it; entries keep one between them (Dan,
      2026-11-06, after reading an adopted tool’s help: “a line break is need at the start bc envoking help and the intro text run together … then make the tool name in that first paragraph bold … when it lists usage the tool name can be regular and the command is bold. since you would’ve already seen the command in bold above. the import[ant] part is seeing the cmd. … now that we are using line breaks to separate everything we need two line breaks after each section so you know its a section.”). A header
      shaped otherwise prints
      as written. The skeleton’s own header keeps each heading on one line for
      this reason. A prose lead-in that ends in a colon is now a heading on
      purpose: an adopter who wants a section’s lead-in read as one puts it on
      its own line ending in `:`, and one that should stay plain does not end
      in a colon.
    - **Tests:** `node --test` sets `FORCE_COLOR=1` for its files on a terminal,
      so both test files delete `FORCE_COLOR` and `NO_COLOR` before they spawn
      anything. Keep that in any new test file that runs a tool in human mode.

## Flag values: `requireValue()`

`skeleton/tool.mjs` carries `requireValue(flag, value, { multiline = false })`
in the tool body, above the fence (so it is not part of any adopter’s fence
hash), and `bin/new-tool.mjs` carries a character-for-character copy, which a
test holds identical. A missing, blank (after trim) or, unless `multiline`,
line-broken value (CR, LF, U+2028, U+2029 or U+0085) calls the fence’s
`usageError()`; otherwise the trimmed value
returns. It is called from `main()`, never at module top level (invariant 8: a
top-level use of a fence name exits 1 before the fence runs). The template’s
`apply --note <text>` is its worked use, and the scaffolder’s `--author` runs
through it.

## The author on a scaffold

`new-tool` writes the *user’s* author into a scaffold’s `package.json` and
README licence line, never this repo’s owner: `--author "<Name> <email>"`, else
npm’s `init-author-name`/`init-author-email`, else git’s `user.name`/`user.email`
(with a `note:` on stderr), else the placeholder `TODO: Your Name`. The two
config sources are “your own user-level settings” (the README’s and
`--help`’s words), never a project’s or a repo’s: the lookups run
with `cwd` set to `os.homedir()`, so npm’s project layer cannot apply, and git
is asked with `git config --global`, so a repo-local identity never counts.
npm’s other layers still do: its machine-wide `globalconfig`
(`$PREFIX/etc/npmrc`), its builtin `$npmPath/npmrc` (the `npmrc` file in npm’s
own install folder) and any `npm_config_*` variable in the environment.
npm is read with one `npm config list --json`, not `npm config get`, which
prints a C0 control as caret text (`^[`); npm prints DEL and C1 as caret text
on every output path (it passes config to child processes raw), so an npm
value holding `^?` or `^@`–`^_` (`NPM_CARET`) is skipped with its own `note:`,
and a real name with that literal pair is refused (README, Known limits); git
and `--author` see real characters and get no caret check. `--author` refuses a control character
inside the value (C0, TAB included, DEL, C1), a bidi control or a bidi mark
(U+200E, U+200F, U+061C); a leading or trailing TAB, VT or FF is trimmed like
a space. A config value holding one is skipped with a `note:`. The lookups
use `execFile` (no shell), a 5 s timeout, `GIT_TERMINAL_PROMPT=0` and
`NODE_DISABLE_COMPILE_CACHE=1` (npm 11 would otherwise leave a
`node-compile-cache` under `$TMPDIR`); a failure or timeout is “unset”. They
run only after the target is known to be free. The
copied `LICENSE` keeps the skeleton’s own notice (MIT requires it). Tests give
every scaffolder run a temporary `HOME`, `NPM_CONFIG_USERCONFIG`,
`GIT_CONFIG_GLOBAL` and `GIT_CONFIG_NOSYSTEM=1` and drop the outer
`npm_config_*`/`GIT_*` variables (from a `base` env the tests can pass in); the
temp home holds a `package.json` and `GIT_CEILING_DIRECTORIES` stops at its
parent, so neither npm nor git walks up into an outer project or repo. A real
`~/.npmrc` can hold credentials and is never read. Keep that isolation in any new scaffolder test.

## The `<tool>` placeholder and substitution

The skeleton’s **runtime** name comes from its own filename
(`basename(realpath) - '.mjs'`), so a copied/renamed file reports the right
name with no edit. Only the **header comment** (which doubles as `--help`) and the
`CHEAT` card use the literal placeholder `<tool>` for the command name. `new-tool` does exactly
two substitutions when it copies the template (the author is separate: it is
written into the generated `package.json` and README, which are templates in
`bin/new-tool.mjs`, not copies):

- in `<name>.mjs`: `<tool>` → the tool name, everywhere in the file: the
  header and the `CHEAT` card (there is no other `<tool>` in the code, and
  none in the fence);
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
(summary), the human layout of 0.5.0 and the v3 brief lines live inline in `test/new-tool.test.mjs`.

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
