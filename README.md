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
next: ask tool apply report.txt notes.txt assets gone.txt --brief --go  (dry run: review the 1 finding before --go)
```

The item and summary lines are frozen: byte for byte what 0.1.0 printed,
padding included, because the aligned columns are there for a person to scan.

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
    "argv": ["tool", "apply", "report.txt", "protected-cfg.txt", "--json", "--go"],
    "afterSeconds": null,
    "why": "a person must confirm at a terminal: protected-cfg.txt"
  }
}
```

| key | meaning |
|---|---|
| `tool`, `version` | the tool’s name and its own version (from `package.json`) |
| `contract` | `"mjs-tool/2"`: which rules the tool follows, distinct from its version |
| `command` | the command that ran |
| `effect` | `"read-only"`, `"dry-run"`, or `"applied"`: what the run was allowed to do (the items’ `changed` says what actually changed) |
| `exit` | the exit code this run returns, echoed for a caller that kept only stdout |
| `state` | optional: a tool-specific snapshot for a status-type command (queue counts, locks, phase); free-form under a fixed name, as `data` is for items |
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

```
next: <action> [argv…]  (<why>)
```

| field | meaning |
|---|---|
| `action` | `done` (nothing left to do), `run` (run `argv` now), `wait` (run `argv` again after `afterSeconds`), `ask` (a person’s decision: report and halt; `argv` is what the person would run), or `stop` (broken beyond the tool’s remedy: report and halt) |
| `who` | `agent` or `human`: who may take the action (`ask` is always `human`) |
| `argv` | the exact command as an array of strings, or `null`; in the text line it is shell-quoted for reading |
| `afterSeconds` | a positive integer for `wait`, otherwise `null` |
| `why` | one line of prose, the only prose in the object |

Four rules hold for every tool on the contract:

1. **One pure `nextAction()` is the single source of `next`**, as `verdict()`
   is of verdicts. It reads the finished items; it never re-probes the world.

2. **`next.argv` never carries a confirmation or override flag** — `--yes`,
   `--force`, any `--allow-*` or `--i-am-*`, or `-y`. If going further needs
   one, the action is `ask`. A hint can never talk an agent past a gate.

3. **`next` composes with the dry-run gate.** The runtime’s
   `defaultNextAction()` advises `run` with the same command plus `--go` after
   a clean dry run; `ask` after a dry run with findings, or one whose command
   carried an override flag (with no `argv`, since `next` will not repeat
   it); `done` after a dry run where nothing would change, a `--go` run, or a
   read-only `inspect`; and `stop` when an item failed. The skeleton’s
   `nextAction()` adds its confirmation path on top: a protected target in a
   dry run, or one left unconfirmed under `--go` for want of a TTY, advises
   `ask`.

4. **`next` never contradicts the exit code**, which stays authoritative. Exit
   `0` allows `done`, `run`, `wait`, or `ask`; exit `1` allows any action;
   exits `2` and `3` allow only `stop`.

`assertSafeNext()` enforces rules 2 and 4 (and the fixed shape) on every
`next` before a byte is rendered. A violation throws, so the run exits `3` and
the tool’s own tests meet the violation first.

**The mutation gate.** `apply` is a **dry run by default** — it prints exactly
what it would do and changes nothing. `--go` performs it. A read-only command
(`inspect`) ignores `--go` with a warning on stderr.

**Exit codes** (documented in the tool’s own `--help` header):

| code | meaning |
|---|---|
| `0` | all items ok (skips are not failures) |
| `1` | partial — at least one item warned, refused, or failed |
| `2` | usage error (unknown flag/command, missing argument, bad mode combo) |
| `3` | could not run to completion — an environment error (a required binary or config is missing/unreadable) or an internal error (an uncaught exception, including a `next` that breaks rule 2 or 4) |

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
a scanner can read a tool’s contract from its fence.

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

Then open `my-widget.mjs`, search for `TODO(tool):`, and fill in the six
spots: the environment check, which targets need confirmation, the `inspect`
report, the `apply` mutation, which commands mutate (`MUTATING_COMMANDS`), and
the next-action policy (`nextAction()`). Leave the runtime fence alone.

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
  transition; obeying a `run` ends in `done`.

- rule 2: an injected policy that puts `--yes`, `--force`, `--allow-*`,
  `--i-am-*`, or `-y` in `next.argv` throws, in the guard and on the render
  path, and a patched runtime that does it end to end exits 3 with nothing on
  stdout. Rule 4 and the fixed shape of `next` likewise.

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
bottom of the tool, unedited, and write the three things it asks for —
`MUTATING_COMMANDS`, a `nextAction()` policy (start from
`defaultNextAction()`, or return `null` for no advice), and a `main()` that
builds the items and ends with
`process.exit(report({ command, effect, items, next, mode }))`. The fence
brings the renderer, the `next` guard, the exit codes, `--help`, `--version`,
and the entry guard with it. It carries its own namespaced imports, so it
never collides with the tool’s.

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

   ```js
   // Flags:
   //   --go, --apply   perform the mutation (--apply is this tool's older name).
   //   --dry-run       the default, stated explicitly; cannot be combined with --go.
   //   --brief, --summary   one line per item (--summary is the older name).

   options: {
     go: { type: 'boolean' },
     apply: { type: 'boolean' },     // alias of --go
     'dry-run': { type: 'boolean' }, // the default, made explicit
     brief: { type: 'boolean' },
     summary: { type: 'boolean' },   // alias of --brief
     // ...
   },

   const go = !!(values.go || values.apply);
   if (go && values['dry-run']) usageError('--dry-run and --go cannot be combined');
   const mode = outputMode({ ...values, brief: values.brief || values.summary });
   ```

   Aliases are input only. Whatever `next.argv` says must run as written, so
   a policy that re-runs the caller’s own argv drops `--dry-run` before it
   appends `--go`.

4. **Exit-code dialects are an open item.** Some existing tools exit 2 on a
   refusal, where the contract keeps 2 for usage errors and a refusal is 1;
   one redefines 1 and 3 for its own polling states. 0.2.0 does not resolve
   these: the pilot adoption settles them tool by tool.

## For agents

[`AGENT-USAGE.md`](AGENT-USAGE.md) is the block to paste into a tool’s
`CLAUDE.md` (the scaffolder does this for you): reach for `--brief`/`--json`
first, treat any non-`ok` line as a finding, dry-run before `--go`, trust the
exit code, and loop on `next` — obey `run` and `wait`, halt on anything else,
and when a runbook and `next` disagree, follow the runbook and report the
disagreement.

## Requirements

Node 20+ (for `node:util` `parseArgs` and `node --test`). Zero dependencies. No
Python.

## License

MIT © Danniel T. Gaidula
