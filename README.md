# mjs-tool-skeleton

A skeleton for single-file Node CLI tools that are usable **both** by a person
at a terminal **and** unattended by an agent — from one set of item objects, so
the two shapes can never drift apart. Copy the template (or run the
scaffolder), fill in the `TODO(tool):` blocks, and you have a tool that speaks
rich human output, a one-line-per-item `--brief`, machine-readable `--json`,
and a `--quiet` summary, with a dry-run mutation gate, honest exit codes, and
one line of advice on what to do next.

## The problem

A CLI written for a person and a CLI written for an agent pull in opposite
directions, and most tools pick one and lose the other:

- **Written for a person**, a tool narrates. It prints paragraphs, buries a
  refusal in prose (“skipping foo because …”), and colours things. An agent
  driving it burns context on the narration and, worse, can read a buried
  refusal as success and march on.
- **Written for an agent**, a tool emits JSON and nothing else. Now a person
  at a terminal has to pipe every run through a formatter to see what happened.

The fix is not to write two tools, or to bolt a `--json` flag onto a pile of
`console.log`s that already committed to prose. It is to compute a list of
**item objects** once — each with a verdict, a summary, and a reason — and
**render every mode from that same list**. Human, brief, and JSON are three
views of one truth, so a refusal that shows up for a person shows up for an
agent, identically, every time.

## The contract

Every tool built from this skeleton honours the same contract. That
consistency is the point: learn it once, drive any of them.

**Two placeholder commands** (rename them to your tool’s real verbs):

```sh
tool inspect <path>...            # read-only: report each item
tool apply   <path>... [--go]     # mutating: dry run, then --go to act
```

**Four output modes, one item list:**

| mode | shape |
|---|---|
| (default) | human — a rich, multi-line block per item |
| `--brief` | exactly one line per item, then a summary line |
| `--json` | a stable object on stdout, nothing else |
| `--quiet` | the summary line only |

Every text mode then ends with one `next:` line (below). `--json` cannot be
combined with `--brief` or `--quiet`.

The **`--brief` line** is a verdict glyph, a fixed-width verdict word, a
summary, and the item name — plus a parenthesised reason **whenever the verdict
is not `ok`**. Refusals, warnings, and skips are never collapsed or dropped:

`apply report.txt notes.txt assets gone.txt --brief` (a dry run):

```
✓ ok     would touch mtime                      report.txt
✓ ok     would touch mtime                      notes.txt
• skip   is a directory                         assets  (apply targets files, not directories)
⊘ refuse no such path                           gone.txt  (path does not exist)
summary: ok=2 warn=0 skip=1 refuse=1 fail=0  (dry run: pass --go to apply)
next: ask  (dry run: review the 1 finding before --go)
```

The item and summary lines are frozen: byte for byte what 0.1.0 printed,
padding included, because the aligned columns are there for a person to scan.
The one exception is a control character in a name, summary, or reason (a
newline, a carriage return, an escape sequence, a bidi override): text modes
show it as an escape (`\n`, `\x1b`, `\u202e`), so every item stays one line,
reads in its true order, and nothing in it can pose as a `next:` line. A TAB
passes through. `--json` carries the exact value. Item text is data and
styling belongs to the renderer, so a tool puts no ANSI colour in its item
strings: it would print as `\x1b[…`, and it costs an agent tokens.

The **`--json` schema** is stable. `apply report.txt protected-cfg.txt --json`
(a dry run with a protected target):

```json
{
  "tool": "tool",
  "version": "0.2.0",
  "contract": "mjs-tool/2",
  "command": "apply",
  "effect": "dry-run",
  "exit": 0,
  "items": [
    { "path": "report.txt", "name": "report.txt", "verdict": "ok",
      "summary": "would touch mtime", "reason": "", "changed": false,
      "data": { "kind": "file", "bytes": 11 } },
    { "path": "protected-cfg.txt", "name": "protected-cfg.txt", "verdict": "ok",
      "summary": "would touch mtime (needs confirmation)",
      "reason": "protected target: --go will require confirmation (TTY) or --yes",
      "changed": false, "data": { "kind": "file", "bytes": 1 } }
  ],
  "summary": { "ok": 2, "warn": 0, "skip": 0, "refuse": 0, "fail": 0 },
  "next": {
    "action": "ask", "who": "human",
    "argv": ["/usr/local/bin/node", "/home/me/bin/tool", "apply", "report.txt",
             "protected-cfg.txt", "--json", "--go"],
    "afterSeconds": null,
    "why": "a person must confirm at a terminal: protected-cfg.txt",
    "cwd": "/home/me/work"
  }
}
```

| key | meaning |
|---|---|
| `tool`, `version` | the tool’s name and its own version (from `package.json`) |
| `contract` | `"mjs-tool/2"`: which rules the tool follows, distinct from its version |
| `command` | the command that ran: one word, or a space-joined phrase for a subcommand (`staging prune`), the same string `MUTATING_COMMANDS` and `AUTO_RUN_COMMANDS` are keyed by |
| `effect` | `"read-only"`, `"dry-run"`, or `"applied"`: what the run was allowed to do (the items’ `changed` says what actually changed) |
| `exit` | the exit code this run returns, echoed for a caller that kept only stdout |
| `state` | optional: a tool-specific snapshot for a status-type command (queue counts, locks, phase), as an object; free-form under a fixed name, as `data` is for items, with an ISO-8601 `asOf` recommended. `--json` only: the text modes never print it |
| `items`, `summary` | the item list and the verdict counts |
| `next` | the advice on the next step (below), or `null` for none |

These keys, and each item’s keys (`path`, `name`, `verdict`, `summary`,
`reason`, `changed`, `data`), are fixed; tool-specific facts go under `data`
or `state`. The 0.1.0 keys kept their meaning, so a 0.1.0 consumer still
parses a 0.2.0 tool.

**The next-action layer.** Every run ends with one piece of advice, so an
agent babysitting a pipeline can loop *run, read `next`, obey or halt* instead
of cross-referencing output against runbook prose. It is a convention on the
existing modes, not a mode of its own: the `next` object in `--json`, and one
last line in every text mode.

A command is printed only where its reader may take it. `--brief` and
`--quiet` are read by agents, so an `ask` there is bare: an agent is never
handed a command at a halt. The default human mode is read by a person, so
it shows an `ask` as that person’s call, with the command they would run.
A `run` or `wait` line is self-sufficient: it leads with `cd <cwd> &&`, so
an agent can paste it into a fresh shell and it runs from the right
directory.

| action | `--brief`, `--quiet` | human (default) |
|---|---|---|
| `run` | `next: run cd <cwd> && <command>  (<why>)` | the same |
| `wait` | `next: wait <n>s cd <cwd> && <command>  (<why>)` | the same |
| `done` | `next: done  (<why>)` | the same |
| `ask` | `next: ask  (<why>)` | `next: your call: <command>  (<why>)`, or `next: your call  (<why>)` with no command |
| `stop` | `next: stop  (<why>)` | the same |

| field | meaning |
|---|---|
| `action` | `done` (nothing left for this tool to do; at exit `1` that means no further tool step, not success), `run` (run `argv` now), `wait` (run `argv` again after `afterSeconds`), `ask` (a person’s decision: report and halt; `argv` is what the person would run, or `null`), or `stop` (broken beyond the tool’s remedy: report and halt) |
| `who` | derived from the action, never chosen: `agent` for `run`, `wait` and `done`; `human` for `ask` and `stop` |
| `argv` | the exact command as an array of strings, or `null` (always `null` for `done` and `stop`). For `run` and `wait`, and for an `ask` that carries one, it re-invokes this tool: `argv[0]` is the node running it (`process.execPath`) and `argv[1]` the tool’s own script as it was invoked, made absolute (not resolved through symlinks, so an npm-linked bin stays its bin path), so it runs without the executable bit and without a `PATH` lookup. A handoff to another tool is `done`, with the next step in the runbook. In the text line it is shell-quoted for reading, and a token holding a control character is ANSI-C quoted (`$'…'`), so the line is always one line. Its escapes are all `\xHH` (a character past ASCII — a C1 control, a line separator, a bidi control — as its UTF-8 bytes), which any bash (macOS’s `/bin/sh` and `/bin/bash` 3.2 included) and zsh decode; `--json` carries the exact token |
| `afterSeconds` | a positive integer for `wait`, otherwise `null` |
| `why` | one line of prose, the only prose in the object: `nextStep()` escapes any control character in it and clips it to 200 characters, and each name in it to 80 |
| `cwd` | the process’s working directory at start, read once as the tool loads: run `argv` from here, since its paths may be relative. A `run` or `wait` text line carries it as a leading `cd <cwd> &&`, quoted by the same rules as `argv`, so the line runs as pasted from any directory |

`next` is `null` only in a tool that has not adopted the next-action layer
(it still reports `--json`, `effect`, and honest exit codes, but gives no
advice). A tool that has adopted it never returns `null`.

Four rules hold for every tool on the contract:

1. **One pure `nextAction()` is the single source of `next`**, as `verdict()`
   is of verdicts. It reads the finished items; it never re-probes the world.

2. **`next.argv` never carries a confirmation or override flag** — any
   `--yes*` or `--force*` (`--force-with-lease`, `--yes-really`),
   `--assume-yes`, `--allow`, `--allow=*`, `--allow-*`, `--i-am-*` (long
   forms in any case, with or without `=value`), `-y` or `-Y` alone or
   grouped, and any flag the tool declares in `EXTRA_OVERRIDE_FLAGS`. The
   built-in classes match by prefix; `--allow` and the declared flags match
   exactly (in any case, with or without `=value`), so a declared entry can
   also be a bare verb. If going further needs one, the action is `ask`. A
   hint can never talk an agent past a gate.

3. **`next` composes with the dry-run gate.** The runtime’s
   `defaultNextAction()` advises `ask` after a clean dry run, with the same
   command plus `--go` as its `argv` — or `run` with that command, when the
   tool lists the command in `AUTO_RUN_COMMANDS` (empty by default: auto-run
   is an opt-in, command by command); `ask` after a dry run with findings, or
   one whose command carried an override flag (with no `argv`, since `next`
   will not repeat it); `done` after a dry run where nothing would change, a
   `--go` run, or a read-only `inspect`; and `stop` when an item failed, in
   any kind of run.
   `--go` goes before a `--` terminator, never after it. The skeleton’s
   `nextAction()` adds its confirmation path on top: a protected target in a
   clean dry run, auto-run or not, or one left unconfirmed under `--go` for
   want of a TTY, advises `ask` (with no `argv` when the command carried an
   override flag).

   Advice goes straight to `--go` only on what was just previewed: a `run`
   that carries `--go` follows a dry run and repeats its command exactly (the
   same command, positionals and flags) with `--go` added, as
   `rerunArgv(argv, '--go')` builds it. A `run` into another command of the
   tool is a read-only or dry-run step and carries no `--go`, as the
   confirming dry run after an applied `--go` does. A tool’s own policy may
   advise `run … --go` over findings (at exit `1`) when its `--go` form
   structurally quarantines them, holding them aside rather than acting on
   them (it moves warn-level items to a hold folder, say). The item lines
   still show every finding; the judgment is that policy’s own, and the
   default policy says `ask` on findings.

4. **`next` never contradicts the exit code**, which stays authoritative. Exit
   `0` allows `done`, `run`, `wait`, or `ask`; exit `1` allows any action;
   exits `2` and `3` allow only `stop`.

`assertSafeNext()` enforces rules 2 and 4 on every `next` before a byte is
rendered, and the fixed shape with it: exactly the six fields; `who` as the
action implies; an `argv` for `run` and `wait`, and any `ask` `argv`,
starting with this node and this tool’s script, and none for `done` and
`stop`; a `run` with `--go` only as the `--go` of the dry run it follows
(rule 3: `report()` hands the guard the run’s `effect` and `argv`); no
`--go` alias the tool declares in `GO_ALIASES`, in any action’s `argv`
(advice spells `--go`, which the checks read); a
`wait` with no `--go` and no mutating command in its `argv` (it re-polls,
so it never mutates);
`why` one line; `cwd` the start directory. A violation throws, so the run
exits `3` and the tool’s own tests meet the violation first. Build `next`
with `nextStep()`, which derives `who` and `cwd` and cleans `why`, rather
than by hand.

**The mutation gate.** `apply` is a **dry run by default** — it prints exactly
what it would do and changes nothing. `--go` performs it. A read-only command
(`inspect`) ignores `--go` with a warning on stderr.

**Exit codes** (documented in the tool’s own `--help` header):

| code | meaning |
|---|---|
| `0` | all items ok (skips are not failures) |
| `1` | partial — at least one item warned, refused, or failed |
| `2` | usage error (unknown flag/command, missing argument, bad mode combo) |
| `3` | could not run to completion — an environment error (a required binary or config is missing/unreadable) or an internal error (an uncaught exception or unhandled rejection, from `main()`, a timer, or a stream, including a `next` that breaks rule 2 or 4, and a contract hook the tool did not declare). An error thrown after the report is written is still printed, but the run keeps the report’s code, which nothing may contradict. An error while the module loads — a syntax error, or a top-level use of a fence name above the fence — happens before the fence can catch it, and Node exits `1` |

**The TTY rule.** No interactive prompt is ever issued unless
`process.stdin.isTTY`. A step that would prompt **refuses** — with an explicit
line and exit `1` — instead of hanging when there is no TTY. That single rule
is what makes a tool safe to run unattended: it can never block forever waiting
for an answer no one is there to give. (Pass `--yes` to pre-confirm such a step
deliberately; `next` never suggests it.)

**The runtime fence.** Everything above that is not tool-specific — the
renderer, the `next` guard, the exit codes, `--help`, `--version`, the entry
guard — lives in one block at the bottom of the tool, between
`// ---- mjs-tool runtime v2 (do not edit; replace wholesale) ----` and
`// ---- end mjs-tool runtime v2 ----`. The block is byte-identical in every
tool on the contract and carries its own imports, so the next contract change
is a mechanical swap of that block rather than a hand edit of every tool, and
a scanner can read a tool’s contract from its fence. As it loads, the block
checks the hooks the tool declares above it (`MUTATING_COMMANDS` and
`AUTO_RUN_COMMANDS` as Sets, `EXTRA_OVERRIDE_FLAGS` and `GO_ALIASES` as
arrays of strings, `nextAction` and `main` as functions) and names any that
is missing or misshapen, with exit `3`. `report()` ends the run: the process exits with
the report’s code once stdout has flushed, so a large report is never cut off
mid-pipe and an open handle cannot hold the run open. So call `report()` once,
at the end of a run: a long-running loop or daemon must not call it per cycle,
because the first call ends the process. Give such a tool a read-only `status`
command that reports the loop’s state instead.

**stdout vs stderr.** Data goes to stdout; every diagnostic, note, and prompt
goes to stderr. In `--json` mode stdout is the JSON object and nothing else, so
a caller can pipe it straight into a parser.

## The scaffolder

`new-tool` stamps out a new tool from the template, substituting the name
throughout, and refuses to overwrite an existing directory. It dogfoods the
convention — it reports in the same `--brief` / `--json` / `--quiet` modes with
the same exit codes.

```sh
# from a checkout of this repo
node bin/new-tool.mjs my-widget --dir ~/sw/github-public

# or, once published, without installing
npx mjs-tool-skeleton my-widget
```

It creates `<dir>/my-widget/` containing:

```
my-widget.mjs                 the tool (skeleton, name substituted, +x)
test/my-widget.test.mjs       the test suite (locator rewritten for the layout)
package.json                  name, bin, type module, engines, MIT, author
README.md                     a stub to fill in
CLAUDE.md                     the agent-facing usage block, ready to keep
LICENSE                       MIT © Danniel T. Gaidula
```

Then open `my-widget.mjs`, search for `TODO(tool):`, and fill in the nine
spots: the environment check, which targets need confirmation, the `inspect`
report, the `apply` mutation, which commands mutate (`MUTATING_COMMANDS`),
which of them may go on to `--go` unattended (`AUTO_RUN_COMMANDS`), the
tool’s own override flags (`EXTRA_OVERRIDE_FLAGS`), its aliases of `--go`
(`GO_ALIASES`), and the next-action policy (`nextAction()`). Leave the
runtime fence alone.

## The test suite

`skeleton/tool.test.mjs` is a `node --test` suite against the template — no
dependencies, temp dirs cleaned up in `finally` — and it ships into every
scaffolded tool. It locks the contract:

- `--brief` emits one line per item and keeps a refusal line, with its reason.

- `--json` parses, its `summary` counts match the items, and it carries
  `contract`, `effect` (per command), `exit` (equal to the real exit code), and
  `next`.

- `apply` without `--go` changes nothing; with `--go` it touches the mtime.

- exit codes 0 / 1 / 2 / 3, including `--quiet --json` as a usage error and an
  uncaught throw as 3, not 1.

- the non-TTY prompt refusal (stdin is not a TTY under `spawnSync`, which is
  exactly the unattended case).

- `next:` is the last line of brief, human, and quiet output; each rule-3
  transition (a clean dry run advises `ask`, or `run` for an
  `AUTO_RUN_COMMANDS` command); obeying a `run` ends in `done`; an `ask` or
  `stop` line carries no command in `--brief` or `--quiet`, and the human
  mode reads an `ask` as “your call”.

- rule 2: an injected policy that puts `--yes`, `--force`, `--allow-*`,
  `--i-am-*`, or `-y` in `next.argv` throws, in the guard and on the render
  path, and a patched runtime that does it end to end exits 3 with nothing on
  stdout. Rule 4 and the fixed shape of `next` likewise: `who` and `cwd`
  derived, `run`, `wait` and `ask` re-invoking the tool itself, `wait`
  never carrying `--go` or a mutating command.

- the 0.2.0 gate regressions: a 3,000-item report through a slow pipe
  arrives whole; a control character in a filename (each class, bidi
  controls included) never breaks a line, forges a `next:` line, or trips
  the guard; the y/N prompt confirms on `y` (injected streams); a throw from
  a timer, a floating promise, or a stream exits 3; a `run` advice obeyed
  verbatim from `next.cwd` applies, from a copy with no executable bit;
  `--go` lands before `--`; any failed item advises `stop`; every
  override-flag class and a declared `EXTRA_OVERRIDE_FLAGS` entry is blocked.

- the contract’s final round: an open handle cannot hold the run open; an
  error after the report keeps the reported exit and the report whole; a
  working directory removed before or during the run cannot lose the report;
  a missing or misshapen hook fails by name as the module loads; `why` is
  escaped and clipped.

- the pre-freeze changes: a text-mode `run` line pasted into a fresh
  `/bin/sh` from another directory applies, in every text mode; an `ask`
  `argv` that names another program is refused; a `run` goes to `--go`
  only on the command just previewed (another command’s `--go`, changed
  positionals or flags, or a `--go` after a run that was no dry run
  throws; a dry-run step into another command runs), in the guard, through
  `report()`, and end to end; a `GO_ALIASES` alias in any `next.argv` is
  refused; a pasted `run` line whose directory holds a control character
  past ASCII runs in bash 3.2 and zsh.

- `--help` prints the header, not code.

- a **symlinked invocation still runs `main()`** — the entry guard in the fence.

`test/new-tool.test.mjs` covers the scaffolder, and three repo-level checks:
the runtime fence is byte-identical in `skeleton/tool.mjs` and
`bin/new-tool.mjs`; the brief and human item and summary lines are
byte-identical to 0.1.0 for the sample above; and a freshly scaffolded tool
passes its own shipped suite with the same fence.

```sh
npm test      # node --test — runs the skeleton suite and the scaffolder suite
```

## Adopting the contract in an existing tool

The shortest path: paste the runtime fence from `skeleton/tool.mjs` at the
bottom of the tool, unedited, and write the six things it asks for, which it
checks as it loads — `MUTATING_COMMANDS`, `AUTO_RUN_COMMANDS` (usually an
empty Set; below), `EXTRA_OVERRIDE_FLAGS` (the tool’s own override flags,
often `[]`; below), `GO_ALIASES` (its aliases of `--go`, often `[]`;
below), a `nextAction()` policy (start from `defaultNextAction()`), and a
`main()` that builds the items and ends with
`report({ command, effect, items, next, mode, argv })`, where `argv` is the
argv it handed `nextAction()` (left out, it is the process’s own). The
runtime then exits with the report’s code once stdout has flushed. Drop any
`process.exit(report(…))`, which cuts a large report off mid-pipe; a
`process.exitCode = report(…)` left from an earlier adoption still works. The
fence brings the renderer, the `next` guard, the exit codes, `--help`,
`--version`, and the entry guard with it.

**Finish every write before the report.** The runtime exits once stdout has
flushed; it never waits for the event loop to drain, since that would let an
open handle hold the run. So await (or synchronously flush) every file write
before `main()` calls `report()` or returns. An un-awaited async write,
such as an append-mode logger’s closing line, is cut off.

**Commands.** `command` is the verb as the tool’s user types it: one word, or
a space-joined phrase for a subcommand (`staging prune`). `MUTATING_COMMANDS`
and `AUTO_RUN_COMMANDS` are keyed by exactly that string.

**Auto-run.** A clean dry run advises `ask` unless the tool lists its command
in `AUTO_RUN_COMMANDS`; only then does `next` say `run … --go`. List a
command there only when its owner has pre-approved applying it unattended.
The set may come from the tool’s own config (a list of pre-approved
procedures), built above the fence from the tool’s own code, since the
fence’s names are not initialised until the fence runs. Keep that config out
of reach of the agent it governs: a pre-approval list an unattended agent can
edit is no gate at all.

**No advice at all.** A tool that takes the fence but not yet the next-action
layer returns `null` from `nextAction()`: it still reports `--json`,
`effect`, and honest exit codes, and prints no `next:` line. A tool that has
adopted the layer never returns `null`.

**Names the fence owns.** Its imports are namespaced (`runtimeFs`,
`runtimePath`, `runtimeUrl`), but its other top-level names are not:
`CONTRACT`, `SCRIPT_PATH`, `TOOL_NAME`, `START_CWD`, `GLYPH`, `glyph`,
`summarize`, `exitCodeFor`, `effectFor`, `NEXT_WHO`, `NEXT_ACTIONS`,
`NEXT_KEYS`, `ACTIONS_FOR_EXIT`, `OVERRIDE_FLAGS`, `OVERRIDE_PREFIXES`,
`isOverrideFlag`, `isGoAlias`, `nextStep`, `selfArgv`, `rerunArgv`, `count`,
`clipText`, `listNames`, `defaultNextAction`, `assertSafeNext`, `CONTROL_CHARS`,
`escapeControl`, `escapeShell`, `printable`, `shellQuote`, `nextLine`,
`VERDICT_WIDTH`, `SUMMARY_WIDTH`, `summaryLine`, `briefLine`, `jsonItem`,
`reportedExit`, `report`, `outputMode`, `usageError`, `environmentError`,
`helpText`, `readVersion`, `exitAfterFlush`, `HOOK_ERROR`, `__entry`, and `__isMain`. A 0.1.0 tool already declares several of them
(`SCRIPT_PATH`, `TOOL_NAME`, `glyph`, `report`, …): delete the tool’s own
copies before pasting, or the module fails to load with a redeclaration
error. And never use a fence name at the top level above the fence: the
fence’s `const`s are not initialised until it runs, so that is a
temporal-dead-zone error at load time (exit 1, before the fence can catch
anything). Inside functions they are fine.

**Override flags.** The guard blocks the contract’s override flags (rule 2)
and every flag in the tool’s `EXTRA_OVERRIDE_FLAGS` — list there any other
flag that confirms or overrides a gate (`--overwrite`, `--unsafe`). Give an
override flag no short alias other than `-y`: the guard knows no other short
form unless it is declared, and it leaves `-f` alone because tools use
`-f <file>`. An older tool whose `-f` means force lists `'-f'` there.

What the fence cannot do for you:

1. **Render every mode from one item list.** Stop scattering `console.log`.
   Build an array of item objects (each with `verdict`, `summary`, `reason`,
   and any `data`), put the verdict logic in a single `verdict(item)`
   function, and hand the array to `report()`. Once every mode reads the same
   objects, they cannot disagree.

2. **Retire the tool’s own entry guard.** The fence’s guard is the last
   statement in the file, and it resolves symlinks: the common
   `import.meta.url === pathToFileURL(process.argv[1]).href` guard **silently
   skips `main()` when the tool is run through a symlink**, and an
   `npm link`ed bin is a symlink, so the tool exits 0 with no output and no one
   knows why.

3. **Keep the tool’s older flags as documented aliases.** A tool that already
   speaks its own dialect — `--apply` for `--go`, `--dry-run` for the default,
   `--summary` for whichever of `--brief` or `--quiet` it matches — keeps
   those flags working, so its runbooks and its users’ habits stay valid. The
   aliases belong to the tool; the skeleton itself gains none. Declare each
   one twice: in the header’s Flags block, beside the flag it stands for, and
   in `parseArgs`, folded into the contract flag before anything reads it.
   And declare every alias of `--go`, long and short, in `GO_ALIASES`
   (`['--apply']` below): advice always spells `--go`, and the guard refuses
   a declared alias anywhere in `next.argv`, since its checks on a `run`’s
   `--go` cannot see one.

   ```js
   // Flags:
   //   --go, --apply   perform the mutation (--apply is this tool's older name).
   //   --dry-run       the default, stated explicitly; cannot be combined with --go.
   //   --brief, --summary   one line per item (--summary is the older name).

   options: {
     go: { type: 'boolean' },
     apply: { type: 'boolean' },     // alias of --go, so GO_ALIASES = ['--apply']
     'dry-run': { type: 'boolean' }, // the default, made explicit
     brief: { type: 'boolean' },
     summary: { type: 'boolean' },   // alias of --brief
     // ...
   },

   const go = !!(values.go || values.apply);
   if (go && values['dry-run']) usageError('--dry-run and --go cannot be combined');
   const mode = outputMode({ ...values, brief: values.brief || values.summary });
   ```

   Aliases are input only. Whatever `next.argv` says must run as written, and
   the default policy re-runs the caller’s own argv with `--go` added, which
   the `--dry-run`/`--go` check above would refuse. So normalise the argv that
   `main()` hands to `nextAction()`, and hand `report()` the same one: drop
   the explicit-default flags and spell every `--go` alias as `--go`. The
   `wait` check looks for `--go` and for mutating command words, so an alias
   left in place (or a mutating default with no verb) would be invisible to
   it; and the guard checks a `run`’s `--go` against the argv `report()`
   is handed, so a tool that normalises for `nextAction()` alone exits `3`
   on its first auto-run:

   ```js
   // drop --dry-run (and short forms like -n); spell every --go alias as --go
   const argv = process.argv.slice(2)
     .filter((a) => a !== '--dry-run' && a !== '-n')
     .map((a) => (a === '--apply' ? '--go' : a));
   const next = nextAction({ command, items, effect, state: null, argv });
   report({ command, effect, items, next, mode, argv });
   ```

   A short form grouped with another flag (`-qn`) is not filtered; the re-run
   then fails as a usage error (exit `2`), which halts an agent, so it fails
   safe. Drop only a no-op alias, one that restates the default: never a
   flag that scopes the run (a `--only <glob>`, a `--limit`), or the `--go`
   the advice re-runs would reach further than the dry run it previewed.

4. **Port the runtime’s tests.** Most of `skeleton/tool.test.mjs` tests the
   fence, not the placeholder commands, and ports to the tool: point `TOOL_URL`
   at it, export the names the tests import (as the skeleton’s `export` list
   does), and swap `inspect` and `apply` for one of its read-only and one of
   its mutating commands. That covers the guard (rules 2 and 4, the shape,
   `run`, `wait` and `ask` re-invoking the tool, `wait` never mutating,
   a `run`’s `--go` only on what was previewed), the `next:` rendering and
   quoting (the pasted `run` line included), control characters, `state`,
   exit codes, the uncaught and late errors, the open handle, the slow pipe,
   the removed working directory, the hook check, `--help`, `--version`,
   and the symlinked invocation. The rest pin the placeholder behaviour (the dry run
   and `--go`, the protected target and its y/N prompt, the exact `why`
   texts): write those afresh for the tool’s own commands.

5. **Exit-code dialects are an open item.** Some existing tools exit 2 on a
   refusal, where the contract keeps 2 for usage errors and a refusal is 1;
   one redefines 1 and 3 for its own polling states. 0.2.0 does not resolve
   these: the pilot adoption settles them tool by tool.

## For agents

[`AGENT-USAGE.md`](AGENT-USAGE.md) is the block to paste into a tool’s
`CLAUDE.md` (the scaffolder does this for you): reach for `--brief`/`--json`
first, treat any non-`ok` line as a finding, dry-run before `--go`, check the
exit code (exit `0` does not mean go), and loop on `next` — obey `run` and
`wait` within a budget, halt on anything else. A runbook may halt the agent
where `next` says `run`; only a person carries it past `ask` or `stop`.

## Requirements

Node 20+ (for `node:util` `parseArgs` and `node --test`). Zero dependencies. No
Python.

## License

MIT © Danniel T. Gaidula
