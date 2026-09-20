# mjs-tool-skeleton

A skeleton for single-file Node CLI tools that are usable **both** by a person
at a terminal **and** unattended by an agent — from one set of item objects, so
the two shapes can never drift apart. Copy the template (or run the
scaffolder), fill in four `TODO(tool):` blocks, and you have a tool that speaks
rich human output, a one-line-per-item `--brief`, machine-readable `--json`,
and a `--quiet` summary, with a dry-run mutation gate and honest exit codes.

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

`--brief` and `--json` are mutually exclusive.

The **`--brief` line** is a verdict glyph, a fixed-width verdict word, a
summary, and the item name — plus a parenthesised reason **whenever the verdict
is not `ok`**. Refusals, warnings, and skips are never collapsed or dropped:

```
✓ ok     file, 11 B                 report.txt
⚠ warn   file, 0 B                  notes.txt  (file is empty (0 bytes))
• skip   is a directory             assets  (apply targets files, not directories)
⊘ refuse no such path               gone.txt  (path does not exist)
summary: ok=1 warn=1 skip=1 refuse=1 fail=0
```

The **`--json` schema** is stable:

```json
{
  "tool": "tool",
  "version": "0.1.0",
  "command": "inspect",
  "items": [
    { "path": "report.txt", "name": "report.txt", "verdict": "ok",
      "summary": "file, 11 B", "reason": "", "changed": false,
      "data": { "kind": "file", "bytes": 11 } }
  ],
  "summary": { "ok": 1, "warn": 0, "skip": 0, "refuse": 0, "fail": 0 }
}
```

The top-level keys (`tool`, `version`, `command`, `items`, `summary`) and each
item’s keys (`path`, `name`, `verdict`, `summary`, `reason`, `changed`, `data`)
are fixed; tool-specific facts go under `data`.

**The mutation gate.** `apply` is a **dry run by default** — it prints exactly
what it would do and changes nothing. `--go` performs it. A read-only command
(`inspect`) ignores `--go` with a warning on stderr.

**Exit codes** (documented in the tool’s own `--help` header):

| code | meaning |
|---|---|
| `0` | all items ok (skips are not failures) |
| `1` | partial — at least one item warned, refused, or failed |
| `2` | usage error (unknown flag/command, missing argument, bad mode combo) |
| `3` | environment error (a required binary or config is missing/unreadable) |

**The TTY rule.** No interactive prompt is ever issued unless
`process.stdin.isTTY`. A step that would prompt **refuses** — with an explicit
line and exit `1` — instead of hanging when there is no TTY. That single rule
is what makes a tool safe to run unattended: it can never block forever waiting
for an answer no one is there to give. (Pass `--yes` to pre-confirm such a step
deliberately.)

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

Then open `my-widget.mjs`, search for `TODO(tool):`, and fill in the four
spots: the environment check, which targets need confirmation, the `inspect`
report, and the `apply` mutation.

## The test suite

`skeleton/tool.test.mjs` is a `node --test` suite against the template — no
dependencies, temp dirs cleaned up in `finally`. It locks the contract:

- `--brief` emits one line per item and keeps a refusal line, with its reason.
- `--json` parses and its `summary` counts match the items.
- `apply` without `--go` changes nothing; with `--go` it touches the mtime.
- exit codes 0 / 1 / 2.
- the non-TTY prompt refusal (stdin is not a TTY under `spawnSync`, which is
  exactly the unattended case).
- `--help` prints the header, not code.
- a **symlinked invocation still runs `main()`** — the entry-guard fix below.

```sh
npm test      # node --test — runs the skeleton suite and the scaffolder suite
```

## Adopting the shape in an existing tool

Two changes carry most of the value:

1. **Render every mode from one item list.** Stop scattering `console.log`.
   Build an array of item objects (each with `verdict`, `summary`, `reason`,
   and any `data`), put the verdict logic in a single `verdict(item)` function
   and its symbol in a single `glyph()` map, then write one `report({ items,
   mode })` that renders human, `--brief`, and `--json` from that array. Once
   the three modes read the same objects, they cannot disagree.

2. **Fix the entry-point guard.** The common
   `import.meta.url === pathToFileURL(process.argv[1]).href` guard **silently
   skips `main()` when the tool is run through a symlink** — and an
   `npm link`ed bin is a symlink, so the tool exits 0 with no output and no one
   knows why. Resolve the symlink first:

   ```js
   import { realpathSync } from 'node:fs';
   import { pathToFileURL } from 'node:url';

   const __entry = process.argv[1]
     ? (() => { try { return realpathSync(process.argv[1]); } catch { return process.argv[1]; } })()
     : null;
   if (__entry && import.meta.url === pathToFileURL(__entry).href) main();
   ```

From there, add the mutation gate (`--go`), the TTY refusal for any prompt, and
the exit-code convention as your tool needs them.

## For agents

[`AGENT-USAGE.md`](AGENT-USAGE.md) is the block to paste into a tool’s
`CLAUDE.md` (the scaffolder does this for you): reach for `--brief`/`--json`
first, treat any non-`ok` line as a finding, dry-run before `--go`, and trust
the exit code.

## Requirements

Node 20+ (for `node:util` `parseArgs` and `node --test`). Zero dependencies. No
Python.

## License

MIT © Danniel T. Gaidula
