# Adopting the contract: the procedure

The README’s [“Adopting the contract in an existing tool”](README.md#adopting-the-contract-in-an-existing-tool)
covers the code: paste the runtime fence, write the six things it asks for,
keep the old flags. This file covers everything around the code: the callers
that move with the tool, the verdict and `next` decisions that the fence
cannot make for you, the safety a mutating tool owes its user, and how to
prove the adoption is done.

It was written from two adoptions on 2026-10-03, a read-only linter and a
renamer of master video files, and from a new tool built on the skeleton the
same day (a dedup tool that culls redundant copies). Each went through an
adversarial gate and a fix round. Two more adoptions the same day, a runner
for legacy AppleScripts and a generator whose output reaches every machine,
followed the draft, went through their own gates, and reported where it fell
short; a fifth, an unattended watcher that launches agent sessions, and a
sixth, a personal-finance CLI with a live server beside it, did too.
Every rule below is either something one of them got wrong first or a
question one of them had to settle.

## 1. Before you edit: find every caller

A tool’s output is an interface, and adopting the contract changes it: new
exit codes, new line shapes, unknown flags newly refused. So list who depends
on it before you touch it.

- Search for the tool’s name **and** each of its flags, everywhere a caller
  could live: other repositories, scripts and wrappers, scheduled jobs, CI,
  dotfiles, and the instruction files agents read (skills, runbooks, agent
  definitions, `CLAUDE.md`).

- Sort each hit into one of three kinds: it **invokes** the tool, it
  **parses** the tool’s output or exit code, or it only **mentions** it. The
  first two move with the tool, in the same change. A mention needs nothing.

- A caller that parses the old text or the old exit codes and cannot move
  cleanly is a stop: settle it with the tool’s owner before the adoption
  lands, not after.

- **A command that gains the dry-run gate for the first time is the riskiest
  change an adoption makes.** Every old command line still parses, but now
  only previews: it exits 0 having done nothing, and keeping old flags as
  aliases does not help. Find every caller that ran the command end to end
  and decide, per caller, whether it adds `--go` or stops at `ask`.

- **The inverse case: an old flag that names a command *and* means “now”**
  (`--write`, which wrote immediately). Its callers expect it to act, so it
  maps to `<command> --go` and stays the one spelling that skips the preview.
  Put it in `GO_ALIASES`, normalise it out of the `argv` that `next` reads, and
  document that it is the no-preview path.

- **A scheduled caller under `set -e`.** A read-only command that always
  exited 0 now exits 1 on findings, and a wrapper that runs it under `set -e`
  (or `&&`) stops there. Give the wrapper per-command handling: treat 1 as a
  result, log 2 and 3, and exit with the worst code it saw. A wrapper that
  takes names from the tool’s output reads `--json`, not `--brief`: the last
  field of a brief line cannot tell a name with a space from a long label, and
  an old `cut -f1` over human output turns every word into a name. Test which
  names the wrapper acted on, not just its exit code.

- **Callers that display a line of output,** not just its exit code (a status
  line clipped to a fixed width, a refusal message quoting the last line). The
  last line is now the `next:` line, and in human mode an `ask` prints the
  command before the reason, so a clipped display shows a path. Point such
  callers at `--brief`, where the line is `next: ask  (<reason>)`.

- If the tool is deployed as a copy (a skill bundle, a dotfile manager), find
  out how the copy is installed and update it the same way, so the source
  and the copy never diverge.

## 2. The code: what the README’s steps leave out

- **`--help` reads the header from line 2.** It prints the `//` lines from
  line 2 down to the first line that isn’t one: a shebang on line 1, then the
  comment block with no blank line between. A `/** … */` header, or a blank
  line after the shebang, gives an empty `--help`.

- **Rename in its own commit.** A `.js` → `.mjs` rename plus a heavy rewrite
  in one commit reads to git as a delete and an add, and blame stops there.
  Commit the pure rename first.

- **Move module-scope CLI code into `main()`.** Argument parsing, config
  loading and any `process.exit` at the top level all move. Finish every
  write and rename before `report()`.

- **A tool with no verb** reports its own name as `command`, and
  `MUTATING_COMMANDS` holds that name. The `wait` guard’s mutating-command
  check matches command words in `argv`, so for a verbless tool it will in
  practice never fire; only its `--go` check protects.

- **Port every `die()` by what it meant.** A refusal becomes a `refuse` item
  (exit 1); a bad argument value is a usage error (exit 2); broken input is a
  `fail` item; a missing program or an environment fault is exit 3. A refusal
  whose stated reason has gone stale keeps its behaviour with a corrected
  reason.

- **Switching to `parseArgs` is a behaviour change.** A hand-rolled,
  permissive parser accepted unknown flags; `parseArgs` makes them exit 2. In
  a tool with several commands, give each command its own flag list, so a
  flag from another command is a usage error rather than silently ignored.
  `multiple: true` keeps each flag’s own values in order but loses how
  different repeated flags interleave (`--rule a --patch b --rule c`); use
  `tokens: true` when that order matters. A tool whose modes were flags
  (`--check`, `--write`) gets commands, and two mode flags at once become a
  usage error where the last one used to win. A value that starts with `-` needs
  the `--flag=-x` form, and
  no arguments at all is a usage error.

- **A command whose output is the product** (decompiled source, a child
  program’s output) moves it into item `data` or into a named output file:
  stdout belongs to the report. `tool decompile > file` stops working, so say
  so in the changelog.

- **A wrapper does not pass a child’s exit code through.** A child that
  failed or timed out (exit 124, say) is a `fail` item with the code in its
  `data`; the tool’s own exit stays 0, 1, 2 or 3.

- **`next`’s `why` is capped at 200 characters.** Build it from the item’s
  name, its summary and a short remedy, not from a reason that carries a long
  temporary path.

- **A flag whose job the contract now does** (an exit-code switch such as a
  `--ci` that made findings fail) stays accepted as a documented no-op.
  Callers that relied on its exit codes read `summary.<verdict>` from
  `--json` instead. List every exit-code change in the changelog.

- **The tool’s name is the real file’s basename** (a symlink’s name doesn’t
  count), and it also appears in the usage-error hint (“run `lint --help`”).
  **The version comes from the first `package.json` found walking up from
  the real file,** so a copy deployed without one reports an unrelated
  ancestor’s version, or `0.0.0` if there is none. There is no hook for
  either yet (open item 1); document it rather than editing the fence. If the
  tool overrides `--version` (to print a commit, say), document that it then
  differs from `--json`’s `version`.

- **Shape-check local inputs per command, before use.** Valid JSON of the
  wrong shape (`null`, an object where an array belongs) otherwise escapes as
  an unnamed `TypeError` at exit 3. Check the top-level shape of each file the
  command loads and report it as a `fail` item that names the file.

- **Keep sensitive data out of every mode.** An item’s `name` and `path`
  print in every mode, and `data` prints in `--json`. When a file name is
  itself personal (an account number), name the item by a label and leave
  `path: null`; scrub raw input rows in `data` down to the fields the reader
  needs. Whole rows leaked account numbers into one adoption’s `--json`.

- **Progress goes to stderr, in human mode only.** `--brief`, `--quiet` and
  `--json` stay silent: an agent pays for every line.

- **`--json` is built as one string.** `report()` serialises the whole object
  at once, which fails past a few hundred megabytes (around a million and a
  half items with long paths). A tool that can produce item lists or `state`
  that large caps them and writes the full lists to a sidecar file.

- **The fence’s crash handlers own every path in the file.** Its entry guard
  installs `uncaughtException` and `unhandledRejection` handlers that print one
  `error:` line and exit 3. Adopting the fence for one report command therefore
  changes how a long-running loop, or any other command in the same file,
  crashes: Node’s stack trace no longer reaches any log. A tool that keeps
  paths outside the contract (a daemon, a live view) removes both listeners on
  those paths once it knows which path it is on, and rethrows anything that
  escapes outside the promise chain (`setImmediate(() => { throw e; })`), so
  Node prints the stack and exits as it always did.

- **Partial adoption in a multi-command tool is allowed but must be said.**
  When only some commands go through `report()`, the README and `--help` say
  which, and a conformance scan’s “conformant” covers only those. A command
  tested in-process cannot reach `report()`, which owns stdout and exits the
  process; that is a reason to leave it out, not to fake it.

- **Exit 3 has nothing on stdout, and exit 1 always has a report.** A dialect
  that printed a `fail` item and exited 3 must choose: an environment fault is
  exit 3 with the reason on stderr; something the report can describe is an
  item at exit 1. An old exit 1 with an empty stdout (a startup failure) moves
  to 3, or an exit-code reader will take it for a finding.

- **When the bare invocation is not a report** (a watcher whose default is to
  loop), choose the human form of the report explicitly (`--once --dry-run`,
  say), and document that its exit codes now follow the contract.

- **Facts `next` needs from outside the items** (who holds a lock, how many
  attempts remain) go into item `data` before `nextAction()` runs, so the
  advice is computed from the same objects every mode prints. Verify such a
  fact rather than trusting it: a live pid in a lock file is not proof that
  the owner is your process.

## 3. Verdicts: one meaning each

Choose each item’s verdict by what the tool **did or will do** with it, not
by how worried a reader should be.

| verdict | meaning | examples from the pilots |
|---|---|---|
| `ok` | done, or would be done, as asked | a clean settings file; a confident rename |
| `warn` | a finding the tool does not act on as it acts on `ok`, because it is uncertain or advisory | a below-threshold match; a permission that is probably redundant |
| `skip` | not applicable, or informational: never a reason to fail the run | an already-named file; a prior review’s verdict |
| `refuse` | the tool declines this item: a precondition or safety gate is not met | the target name is taken; two items would rename to one name; a named input does not exist |
| `fail` | the tool tried and broke, or the input is broken; in a read-only checker, also a definite violation (see §4) | a rename threw; an unreadable or wrong-shape settings file; a superseded permission entry |

- **In a tool that acts per item, `--go` never does to a `warn` item what it
  does to an `ok` one.** At most it holds the item aside, as the README’s rule
  3 allows. Say so in the summary itself (`not renamed: needs review (score
  0.600)`), so a `⚠ warn` line beside `✓ ok renamed` cannot be read as
  “renamed, with a caveat”. Where several items feed one action (patch rules
  before a single compile-and-run), a `warn` on an input qualifies that one
  action: decide whether it blocks `--go`, and say which in the docs.

- **An `ok` item that `--go` will act on, but with a caution** (a script
  that is not the tool’s own patched copy) carries the caution in its
  summary: `--brief` prints no reason for an `ok` line.

- **Map labels to verdicts explicitly, and throw on an unknown one.** A
  fallthrough to `ok` reports a new, unregistered check as clean. A
  `verdict()` built from facts, like the skeleton’s, meets this when every
  combination of facts has an explicit branch.

- **An advisory that was never a failure stays a `skip`.** A linter that
  surfaced a prior review’s verdict “for information” made every run exit 1
  once that line became a `warn`, and an agent could never reach clean.

- **Items that span files** carry `path: null`.

- **One finding can carry a different verdict per command.** A lint finding
  is `fail` under `check` (the run exists to find it) and `skip` under `write`
  (the write does not fix it, and must not fail because of it). Map verdicts
  per command, not per tool.

- **A mutating command’s no-op items are `skip`, not `ok`.** An `ok` item in a
  dry run reads as “would act”, so the default advice offers a `--go` that
  would do nothing.

- **A no-op item must not write.** If the underlying writer always rewrites
  (and rotates a backup), `skip unchanged` is a lie on disk: change the step to
  run only for an `ok` item, so nothing to do means nothing written.

- **One fault can be an item in the preview and exit 3 under `--go`.** A
  missing token or an unreachable service is something a dry run can describe
  (a `refuse` item: the plan cannot run), while under `--go` it stops the run
  (exit 3, nothing on stdout). Both are right; document both.

- **A rename’s item is named `<from> -> <to>`.** A target filename with
  spaces cannot sit readably in the summary column.

## 4. `next`: say what is actually wrong

`defaultNextAction()` is a starting point, and both adoptions had to override
it:

- **It treats every `fail` as `stop`** (“broken beyond the tool’s remedy”).
  A checker whose definite findings are `fail` wants `ask` (propose the fix,
  wait for approval) and keeps `stop` for an input it cannot read.

- **After `--go`, it says `done` when `warn` or `refuse` findings remain.**
  If those findings need a person (items left for a hand check), the answer
  is `ask`.

- **The `why` names the real problem and its remedy.** “Propose edits for the
  2 findings” on a run whose only settings finding was “no settings file at
  that path” sent an agent to edit nothing; the right line names the missing
  file and says to re-run with the right path.

- **`next` may step into another command of the same tool,** as long as it
  carries no `--go`: `check` with drift advises `write` (its dry run), and an
  applied `write --go` advises `run check` to confirm. The `why` must say what
  that next run will find: if lint findings remain, it says so, rather than
  promising a clean check.

- **A positional spelled like an override flag or a `--go` alias** (a file
  named `--force-export.scpt`, passed after `--`) makes the guard refuse the
  advice, and the run exits 3. When the run’s argv holds such a token,
  `nextAction()` returns `ask` with no `argv`.

- **A runbook outranks `next`.** Where a runbook says “stop” or “a person’s
  call”, `next` says `ask` or `stop` there, never `run`. Moving a stop
  condition out of a runbook and into the tool is the owner’s decision.

- **A flag that moves a gate is an override.** Not only `--overwrite`-style
  flags: a threshold such as `--min-score` belongs in `EXTRA_OVERRIDE_FLAGS`,
  so advice never repeats it, and the docs say an agent never adds it on its
  own. Your `nextAction()` must then return `ask` with no `argv` when the
  run’s own argv carries that flag, or the guard refuses the advice and the
  run exits 3.

## 5. A mutating tool’s safety

The fence guarantees only that advice reading `run … --go` repeats the dry
run’s exact argv with `--go` added. It cannot guarantee the world held still,
and it checks nothing a person or a runbook types. These came out of the
gates:

- **Re-check each target with `lstat` just before acting** (a broken symlink
  counts as existing). That narrows the window but does not close it. Where
  “never replace” must hold, use an operation that fails on an existing
  target: `link` then `unlink` for a rename, `open(…, 'wx')` or
  `copyFile(…, COPYFILE_EXCL)` for a write.

- **Compare names the way the filesystem does.** Case-insensitive and
  normalization-insensitive volumes treat `Mad About You` and `Mad about You`,
  or an NFC and an NFD `Café`, as one file. A collision check on exact strings
  let two masters rename to “different” names and one silently replaced the
  other, while the report said both were renamed.

- **Compare paths by identity, not by string.** Use `realpath`, or `dev` plus
  `ino`. Alias paths (`/tmp` and `/private/tmp`) and hard links make one file
  look like two: counted twice, or excluded under one spelling and read under
  the other.

- **Rewrite a file in place through a temp file and a rename.** `writeFileSync`
  truncates first, so a write cut short (a full disk, a file-size limit, a
  crash) leaves a partial file, which a later check may even pass. Write a temp
  file in the target’s real directory (resolve symlinks first, so a link keeps
  pointing where it did), copy the mode, then `rename` it over the target.
  Re-read the target just before, and refuse if it changed since the plan.

- **Check that the record can be written before the first side effect.** A
  command that pushes notifications and then records what it pushed will, if
  the record write fails, push everything again on the next run. Check the
  record is writable before the first push, make the record write a tracked
  step, and on its failure keep the items for the effects that did happen.

- **Validate every output location in the plan.** Walk `lstat` up to the
  nearest existing ancestor of `--out` (or `--out-dir`) and refuse a file in
  the way, a dangling symlink, or a directory that is not writable, before
  anything is loaded or written. Otherwise a clean preview is followed by a
  `--go` that writes its inputs and then fails on the output. Two adoptions
  hit this separately.

- **Re-verify what you rely on, not just what you touch.** A cull that keeps
  one copy must re-check that copy at the moment it moves the others; one
  that checked only the copies being moved could move the last one.

- **Treat repositories and packages as wholes.** A tool that moves or deletes
  leaves alone anything with a `.git` above it, and anything inside an app or
  document package, however redundant the single file looks.

- **Never overwrite an output file the tool did not write.** Check for the
  tool’s own header line before replacing an existing output, even under
  `--go`. Where the output is pure content with no header to check, create it
  exclusively (`'wx'`, or a copy that fails on an existing target), and treat
  an existing file with identical content as already done.

- **When the side effect is running something,** the dry run shows exactly
  what would run (the command, its arguments, the patched text) and executes
  none of it. If the preview needs a harmless helper call (asking the system
  for a disk’s name, say), name it in the docs and prove in a test that it is
  the only call.

- **Plan drift is real.** A tool that re-plans under `--go` acts on whatever
  the inputs hold then, not on what was previewed. Until the contract carries
  a plan digest (open item 3), document it, and have the runbook check that
  what `--go` did matches what the dry run’s `ok` lines promised.

- **A partial `--go` is legitimate** (act on the `ok` items, leave the
  findings) as long as the item lines make plain what it leaves. On a failure
  part-way, stop, and mark the untried items `skip` “not attempted”.

## 6. Tests

- **Pin the fence by hash in the tool’s own tests** (sha256 of the block
  against `skeleton/tool.mjs`), then write tool-specific tests instead of
  porting the runtime suite, which would re-test identical bytes: dry run
  against `--go`; `--go` acts only on what was previewed; every exit code;
  `--help`, `--version` and a symlinked entry; `--brief` and `--json`
  snapshots.

- **Porting a suite that asserted on the old text** (especially stderr): keep
  the old invocations, so they double as alias coverage, and move the
  assertions to the item shape. List every test whose assertions changed, so
  a reviewer can see none was weakened.

- **Each verdict needs a fixture where it is the only finding.** A test that
  expects exit 1 from a fixture with several kinds of drift stays green when
  one verdict is mapped to `ok` by mistake.

- **A dry run that predicts writes is checked against the real writes.** Plan
  in memory, but keep `--go` on its own write path, so the dry run is an
  independent prediction; give each file item `data.sha256` of its planned
  bytes, and test that the applied bytes match. Two traps: round-trip planned
  content through JSON the same way the writer does (`NaN`, `undefined`), and
  sort directory listings, or plan and apply differ by listing order alone.

- **Prove the important assertions are load-bearing.** Break the guard in a
  scratch copy and watch a test go red: the collision check, the re-check
  before acting, the rule that `--go` leaves `warn` items alone.

- **Cover the cases the gates found:** case-only and Unicode-form name pairs,
  a target that appears mid-run, a broken symlink at the target, alias paths
  to one file, a file past the first read chunk.

- **A tool that calls other programs is tested against stubs.** Put a stub
  directory first on `PATH` and leave the real binaries’ directories off it,
  so a missing stub fails loudly instead of reaching the real program. Write
  the stubs with shell builtins only, have them log their arguments, and
  assert on the log (an empty log proves a dry run executed nothing). A stub
  that must outlive a timeout `exec`s its sleep, so the timeout kills the stub
  itself.

- **Every test that runs the tool gets the stubs, not just the ones about the
  external program.** A tool that can start a paid or side-effecting program
  (an agent session, a deploy) puts the recording stub on `PATH` in every test
  that spawns it, and asserts the stub was never called where it should not
  be. Otherwise a regression in a report test starts the real thing: one gate
  counted fifty would-be paid sessions, caught only by its own stub.

- **Tests never reach the owner’s real data or programs.** A tool whose
  default data directory is the owner’s real files runs every test against a
  fixture directory set explicitly. Compose the test `PATH` as the stub
  directory, Node’s own directory and `/bin` (not the inherited `PATH`, which
  reaches real `notify`, `pbcopy` and the like), and add an `after()` hook
  that fails the suite if a guard stub was called.

- **A test that kills a child attaches its `close` listener before `kill()`,
  and has a timeout.** Otherwise a child that already exited hangs the whole
  suite instead of failing it.

## 7. Done means

- The fence is byte-identical to `skeleton/tool.mjs`, and a test proves it
  by hash.

- `--json` reports `"contract": "mjs-tool/2"`.

- The tool has been run **exactly as each caller runs it**, and the output
  read as that caller would read it. A caller that names no command (“use the
  tool for this”) gets one written into its instructions, and that is the
  command you run.

- Every caller from step 1 is updated or recorded as needing nothing. The
  exit-code and flag changes are in the changelog (start one if the tool has
  none).

- If an agent is meant to drive a mutating tool, its runbook has a procedure
  with stop conditions, and names the flags only a person may pass.

## Open items for the skeleton

1. **A declared name and version.** A hook so a tool shipped as `lint.mjs`,
   or deployed without its `package.json`, can say what it is.

2. **A conformance check that hashes the fence body,** so “unedited” is
   checked, not asserted, by a command any adopter can run.

3. **A plan digest.** The dry run’s `--json` carries a digest of its plan, and
   `--go` refuses when the re-computed plan differs.

4. **Grouping in the human renderer.** A tool that used to print findings
   under a file heading now repeats the file on every block. A second case: a
   checker whose findings carried a severity of their own (ACT / WARN / INFO
   headings) loses the headings, and two severities can share one verdict.
   One shape that needs no contract change: an optional `group` on each item
   that only the human renderer reads, as it already reads `lines`, printing a
   heading wherever the group changes. `--brief`, `--json` and the contract
   string stay as they are. Severity stays out of the verdict (§3) and lives in
   the tool’s `data` and summary. Until then, sort the items by group and put
   the group at the start of each summary (`ACT call ITM …`).

5. **`effect` for a read-only command that writes a new output file.** The
   adoptions reported `effect: "read-only"` with the item’s `changed: true`;
   the contract does not yet say whether that pairing is right.

6. **Batch the fence revisions.** Items 1, 3 and 4 each change the fence
   itself. The fence is byte-identical in every adopted tool, and seven test
   suites pinned its sha256 on 2026-10-03, so any edit turns each of them red
   and means a mechanical swap in every adopted repo. Make the three one
   revision, not three. Item 3 has the safety argument, so it sets the timing;
   items 1 and 4 ride along. A revision that leaves the `--brief` lines, the
   `--json` keys and the exit codes as they are is a new runtime revision, not a
   new contract: `contract` stays `mjs-tool/2`. Item 2 lives in the scanner,
   not the fence, and can land on its own.
