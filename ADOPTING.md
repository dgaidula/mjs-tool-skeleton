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
Five more, in the migration queue that followed (2026-10-16: a key-expiry
checker, a settings-schema snapshotter, an archiver that deletes files and the
test runner it drives, a deploy-key manager, and a transcript-size reporter),
added the rules that cite a phase, such as “(S10)”.
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
  aliases does not help. Find every caller that ran the command end to end.
  An unattended one (an npm script, a routine, another tool, an agent
  runbook) adds `--go` and keeps running, with no new prompt and no new `ask`,
  and a test proves each one: an adoption never adds an approval or stops
  automation (S10). A printed hint or a README example for a person carries
  the `--go` it now needs, or the reader lands on a preview (S11). If a change
  would block an automated caller, raise it with the tool’s owner before
  building it. Keep what the caller relied on, too: a test script that
  used to launch a stopped app and now exits 3 has stopped automation as
  surely as a missing `--go` (S10).

- **Pin it with a test that reads the documents.** Search `package.json`
  scripts, the README and every runbook for invocations of the command, and
  fail on any without `--go`. A runbook line without it only previews, and
  nothing else notices (S10).

- **The inverse case: an old flag that names a command *and* means “now”**
  (`--write`, which wrote immediately). Its callers expect it to act, so it
  maps to `<command> --go` and stays the one spelling that skips the preview.
  Put it in `GO_ALIASES`, normalise it out of the `argv` that `next` reads, and
  document that it is the no-preview path.

- **An old confirmation prompt** (`proceed? [y/N]`) goes, with or without a
  TTY: `--go` is the confirmation and the dry run is the plan. Its pre-confirm
  flag (`--yes`) is a `GO_ALIASES` entry, the case above, since it always meant
  “act without asking”. First measure the old tool with stdin at end of file
  and with stdin an open pipe: the one adopted printed the prompt and exited 0
  having done nothing, or hung. A test that keeps stdin open and writes
  nothing proves a destructive `--go` finishes. A confirmation at a terminal
  on deletes is an addition, and the owner’s call (S11).

- **A scheduled caller under `set -e`.** A read-only command that always
  exited 0 now exits 1 on findings, and a wrapper that runs it under `set -e`
  (or `&&`) stops there. Give the wrapper per-command handling: treat 1 as a
  result, log 2 and 3, and exit with the worst code it saw. A wrapper that
  takes names from the tool’s output reads `--json`, not `--brief`: the last
  field of a brief line cannot tell a name with a space from a long label, and
  an old `cut -f1` over human output turns every word into a name. Test which
  names the wrapper acted on, not just its exit code.

- **A caller that branched on distinct exit codes** (2 for expired, 3 for
  missing) cannot keep them: the contract uses 1 for every finding, 2 for
  usage and 3 for a crash. Put the kind in the item’s `data` (`data.state`) and
  move the caller to `--json`, so it branches on the kind, not the code. It
  reads stdout only: with `2>&1`, a warning the tool prints on stderr ahead of
  the JSON breaks the parse, so send stderr to a temporary file and use its
  first line only for a no-result log line (S8).

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

- **Check the file mode.** A caller that runs the file directly gets exit
  126 from a 100644 file, and a routine says nothing: one adopted checker’s
  near-expiry warning had probably never fired for that reason. Run the tool
  the way each caller does, and `git update-index --chmod=+x` if it needs it
  (S8).

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

- **Arguments that reach another program’s argv are validated.** A box name
  that starts with `-` becomes an option (`-oProxyCommand=…` handed to `ssh`):
  refuse a name that starts with `-` or is all dots, as a usage error, or put
  a `--` before it (S11). Numbers are whole or range-checked, and an empty
  value for a path flag is a usage error, never a quiet fallback to the
  default location (S12).

- **A command whose output is the product** (decompiled source, a child
  program’s output) moves it into item `data` or into a named output file:
  stdout belongs to the report. `tool decompile > file` stops working, so say
  so in the changelog.

- **The old `--json` object moves to `state`.** The contract fixes `--json`’s
  top-level keys, so the old report cannot sit beside them. Put it in `state`
  exactly as it was, so a reader moves with `jq .state`, and prove it: run the
  old and the new tool on the same unmoving input and compare the old output
  with `.state` by deep equality, for each set of flags (S10, S12). Say so in
  the changelog.

- **A wrapper does not pass a child’s exit code through.** A child that
  failed or timed out (exit 124, say) is a `fail` item with the code in its
  `data`; the tool’s own exit stays 0, 1, 2 or 3. A wrapper over `ssh` also
  tells exit 255, the connection itself failing (an unreachable box: `fail`),
  from the remote command’s own exit, so an unreachable box is not reported as
  “no key on the box” (S11).

- **A tool that runs another tool of the contract** starts it with
  `process.execPath`, not `node` from `PATH`, and with `--quiet`; reads its exit
  code by the contract (3 means it could not run, and the parent says so in its
  own words); and points its `TMPDIR` at a directory of the parent’s own,
  removed afterwards (S10).

- **`next`’s `why` is capped at 200 characters.** Build it from the item’s
  name, its summary and a short remedy, not from a reason that carries a long
  temporary path. Clip the name and the summary to fit, never the remedy: with
  real nine-digit ids the command in a `why` was cut off mid-flag, and the test
  now uses real-size ids (S11).

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
  command loads and report it as a `fail` item that names the file. A reply
  from an API or a program that exits 0 but is not the shape expected (not a
  list of keys) is the same `fail` item (S11).

- **Keep sensitive data out of every mode.** An item’s `name` and `path`
  print in every mode, and `data` prints in `--json`. When a file name is
  itself personal (an account number), name the item by a label and leave
  `path: null`; scrub raw input rows in `data` down to the fields the reader
  needs. Whole rows leaked account numbers into one adoption’s `--json`.
  An input that may hold a secret (a key file, a token line) is never echoed,
  in any mode, log or notification: report the parsed value, and on a parse
  failure say what is wrong and how long the input was (`not a date (23
  characters)`), not the text. Parse strictly: V8’s `Date` ignores a
  parenthesised tail, so a key after a valid date still reached the output.
  Match an explicit format, and end a captured value at every line break,
  U+2028 and U+2029 included. Test by planting the secret in every position
  the grammar allows and searching every mode, and every caller’s log, for a
  fragment of it (S8).

- **Progress goes to stderr, in human mode only.** `--brief`, `--quiet` and
  `--json` stay silent: an agent pays for every line.

- **`--brief` is always brief, and wins over human.** When the two pull apart,
  shape the items for `--brief`: one item per table or group, its rows in
  `data`, and the old human layout carried in the item’s `lines`, which only the
  human renderer prints. The human mode adapts. A reporter whose table rows
  each became an item had a `--brief` of 134 lines; one item per table made it
  17, with a human mode four lines longer than the old output (S12). An
  archiver gave every clean series one `series-group` item, and its own item
  only to a series refused, failed or kept, so on a clean folder `--brief`
  stays three lines at 50 series and at 500 (S10). Check `--brief`’s size against the old output, at
  a size that matters.

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

- **A tool whose run is the point** (a test runner that drives an app) still
  declares its side effect: a bare run previews, and `--go` runs. When its
  callers are unattended and the owner has said so, list the command in
  `AUTO_RUN_COMMANDS`, so the preview’s `next` is `run … --go` and not a new
  `ask`; an override flag in the preview still asks. Every caller passes `--go`
  itself all the same (S10).

## 5. A mutating tool’s safety

The fence guarantees only that advice reading `run … --go` repeats the dry
run’s exact argv with `--go` added. It cannot guarantee the world held still,
and it checks nothing a person or a runbook types. These came out of the
gates:

- **Re-check each target with `lstat` just before acting** (a broken symlink
  counts as existing). That narrows the window but does not close it. Where
  “never replace” must hold, use an operation that fails on an existing
  target: `link` then `unlink` for a rename, `open(…, 'wx')` or
  `copyFile(…, COPYFILE_EXCL)` for a write. A remote API has no `lstat`: the
  equivalent is to list again just before each destructive or creating call
  and check identity (the id, the key’s body, its access), refusing on any
  change. A listing taken right after a delete can lag, so never count the id
  just deleted (S11).

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
  that checked only the copies being moved could move the last one. The
  copy kept must itself be a regular file (`lstat`, not `stat`), not the same
  inode as any file the run deletes, and look like what it claims (a
  document’s magic header): a symlinked keeper pointing at a doomed file let a
  `--go` delete a series’ last copy (S10).

- **Treat repositories and packages as wholes.** A tool that moves or deletes
  leaves alone anything with a `.git` above it, and anything inside an app or
  document package, however redundant the single file looks. Skip every
  dot-directory too, and refuse a folder named inside one: a sync tool’s
  archive and trash folders hold recovery copies, and a walk that entered them
  deleted those (S10).

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
  the inputs hold then, not on what was previewed. Where that can damage data,
  carry a plan digest; elsewhere, document the drift and have the runbook
  check that what `--go` did matches what the dry run’s `ok` lines promised.
  Where the tool re-checks the one thing that could do harm right before
  acting and refuses on any change (a key’s id, body and access), a digest adds
  little: say in the README that `--go` re-plans from the world as it is now,
  and have the `--go` items name what they act on (id, fingerprint, title), so
  a person can compare them with the preview (S11).

- **A plan digest, where drift can damage data.** The fence needs no change:
  its guard constrains only `run … --go` advice, and an `ask` argv may carry
  any flag the tool defines. The recipe, from the first gated adoption (a
  bulk renamer, 2026-10-13):
  - *The record:* every planned action, sorted (`{from, to}` pairs for a
    rename); each input’s identity (`path`, `size`, `dev`, `ino`, never a
    timestamp); and the resolved options (effective defaults filled in, paths
    through `realpathSync.native`). Serialize it as canonical JSON (keys
    sorted at every level) and keep the first 16 hex characters of its sha256.
  - *The dry run* reports it in `--json` as `state.plan`, and its `ask` advice
    ends `--go --plan <hex>`. An `ask` prints no command in `--brief` or
    `--quiet`, so those stay byte-identical and the digest costs agents
    nothing.
  - *Under `--go --plan <hex>`* the tool recomputes the plan. On a mismatch it
    acts on nothing: one `refuse` item naming what changed, exit 1, `next: ask`
    for a fresh dry run. A `--go` without `--plan` works as it always has, so
    hand use is unchanged. A replay of a plan that already landed says
    “already applied”. `--plan` without `--go`, or a value that is not 16
    lowercase hex, is a usage error (S9, S10).
  - *To name what changed,* the dry run caches its record by digest in the
    user cache directory (an absolute `$XDG_CACHE_HOME`, else the platform’s,
    such as `~/Library/Caches/<tool>`), never beside the data it acts on. A
    change in `dev` alone is named as a likely remount, not as new files.
    Treat that cache as untrusted input: directory 0700, records 0600 written
    by temp file and rename, records older than a week pruned on write; on
    load, open with `O_NONBLOCK`, accept a regular file only, and check its
    shape and that it hashes to its own name. A FIFO or a forged record is a
    refusal that cannot itemise the change (exit 1), never a hang or exit 3
    (S9, S10).
  - *In a runbook,* run one `--json` dry run, read `next.argv` with `jq`, and
    paste the advised command as literal text. Never run it through `eval`:
    a command guard cannot see the `--go` inside. A runbook that applies
    unattended does so only through the advised command, only when the dry
    run’s items match what it just reviewed (compared with `jq` and `cmp`),
    and with no advised command it applies nothing (S9).
  - *Tests:* a dry run, then an input change, makes the advised `--go` refuse
    with the change named; an unchanged plan applies exactly as before; and
    `--brief` output is byte-identical to what it was without the digest.
  - *Guards do not wait for the digest.* A last-copy or repository guard runs
    under every `--go`, plain ones too: a guard that holds only when someone
    remembered `--plan` is no guard (S10).

- **An ordered sequence of side effects is a list of steps,** one item each
  (generate a key, register it, set the remote), with the exact argv in
  `data.command`. Preview and run read the same step objects, so they cannot
  disagree, and `--brief` shows the whole plan. On a failure part-way the rest
  are `skip` “not attempted” (S11).

- **After a step that already changed the world, a later failure names the way
  back:** what is now true, and the exact command that restores it (`old key N
  is deleted; the box has no access until: …`), written as the dry run, not as
  a `--go`. When a call fails ambiguously (a timeout; the effect may have
  landed), look once more and report what is there (“still listed, so probably
  not deleted”) instead of guessing (S11).

- **A partial `--go` is legitimate** (act on the `ok` items, leave the
  findings) as long as the item lines make plain what it leaves. On a failure
  part-way, stop, and mark the untried items `skip` “not attempted”.

## 6. Tests

- **Pin the fence by hash in the tool’s own tests,** then write tool-specific
  tests instead of porting the runtime suite, which would re-test identical
  bytes: dry run against `--go`; `--go` acts only on what was previewed; every
  exit code; `--help`, `--version` and a symlinked entry; `--brief` and `--json`
  snapshots. The block is the text from the first character of the opening
  fence line through the last character of the closing fence line, markers
  included, hashed with sha256 and compared with the same block in
  `skeleton/tool.mjs` for the same runtime version. The newline after the
  closing line is not part of it, and a hash taken with it is a different
  value, so say which one a pinned value covers (S8). A conformance scanner
  runs the same check for any adopter (open item 2).

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

- **A tool that checks what another program will read parses it as that
  program does,** and a test runs both on the same files: lines that end at LF
  only, a no-break space, an inline comment, a locale. A checker said `ok`
  while the shell reader took a different line, or an empty key (S8).

- **A tool that calls other programs is tested against stubs.** Put a stub
  directory first on `PATH` and leave the real binaries’ directories off it,
  so a missing stub fails loudly instead of reaching the real program. Write
  the stubs with shell builtins only, have them log their arguments, and
  assert on the log (an empty log proves a dry run executed nothing). A stub
  that must outlive a timeout `exec`s its sleep, so the timeout kills the stub
  itself. A stub can also change the world while a batch “runs” (a knob that
  deletes a kept file, swaps one for another, creates a `.git`), which tests
  the last-copy and similar guards without a hook in the tool (S10). In every
  dry run, assert that each logged call matches one of the named read-only
  patterns, as a table test over the scenarios, so a new call that mutates
  cannot slip in (S11).

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
  that fails the suite if a guard stub was called. Point `HOME`, `TMPDIR` and
  `XDG_CACHE_HOME` at empty directories too, so a test that forgot the fixture
  flag fails (exit 3 on a missing root) instead of reading the real tree (S10,
  S12).

- **A suite leaves nothing behind.** Make every temp directory through one
  helper, and register the `after()` that removes them before the first one is
  made (a guard hook that fails the suite otherwise skips the cleanup). Prove it
  by running with `TMPDIR` pointing at an empty directory and checking it is
  empty afterwards. Adopted suites and tools left directories behind in the
  temp directory (34 in one, 284 in another), and one would have whenever its
  guard failed (S8, S9, S10, S12).

- **A test that kills a child attaches its `close` listener before `kill()`,
  and has a timeout.** Otherwise a child that already exited hangs the whole
  suite instead of failing it.

## 7. Done means

- The fence is byte-identical to `skeleton/tool.mjs`, and a test proves it
  by hash.

- `--json` reports `"contract": "mjs-tool/3"`.

- The tool has been run **exactly as each caller runs it**, and the output
  read as that caller would read it. A caller that names no command (“use the
  tool for this”) gets one written into its instructions, and that is the
  command you run.

- Every caller from step 1 is updated or recorded as needing nothing. The
  exit-code and flag changes are in the changelog (start one if the tool has
  none).

- If an agent is meant to drive a mutating tool, its runbook has a procedure
  with stop conditions, and names the flags only a person may pass.

- A tool should also answer `--cheat` (§8). It is a *should*: a tool without
  it is still conformant, and a conformance scan reports the absence without
  failing the tool.

## 8. The cheat card: adding `--cheat` to a tool

`--cheat` arrived in skeleton 0.3.0. It is a *should*, additive: a tool
without it is still conformant, and nothing here touches the runtime fence,
the `contract` string or any pinned fence hash, so an adopted tool’s fence
tests stay green. The change lives entirely above the fence, in five places.
Do them in order; each is mechanical.

1. **Find the command name.** The card’s title and every command in it use
   the name a person types: the key in `package.json`’s `bin`, or the name
   of the wrapper or alias, not necessarily the file’s basename. The card is
   written with that name literally. (The template’s `<tool>` is only the
   scaffolder’s placeholder.)

2. **Register the flag.** Add `cheat: { type: 'boolean' }` to the options
   `parseArgs` is given, beside `help` and `version` (a Commander tool:
   `.option('--cheat')` on the root, §9). A tool that gives each
   command its own flag list parses `--cheat` before it dispatches, in the
   same place it handles `--help`, since the flag belongs to no command. If
   the tool already has a `--cheat` that means something else, stop and
   report it: that is a rename decision for the owner.

3. **Handle it beside `--help` and `--version`**, after them, before the
   command is looked up:

   ```js
   if (values.cheat) {
     for (const mode of ['brief', 'json', 'quiet']) {
       if (values[mode]) usageError(`--cheat and --${mode} cannot be combined`);
     }
     console.log(CHEAT);
     return;
   }
   ```

   `console.log` and a plain `return` are the same exit path `--help` takes:
   the runtime exits `0` once stdout has flushed. The combination with an
   output mode is a usage error (exit `2`, nothing on stdout) because
   `--cheat` is not an output mode, and silently preferring one flag over
   another is how a caller gets the wrong shape. The tool’s older aliases of
   `--brief` or `--quiet` (`--summary`) belong in that list.

4. **Write the `CHEAT` constant** above `main()`, beside the header. It is a
   template literal with its backticks escaped and no trailing newline (the
   `console.log` adds the one), and every card line starts in column 0, since
   a tldr page is not indented:

```js
const CHEAT = `# lint

> Check Markdown files against the house style.
> More information: lint --help.

- Check files and report every finding:

\`lint check {{path/to/file1 path/to/file2 ...}}\`

- Check a whole folder, one line per finding:

\`lint check {{path/to/directory}} --brief\`

- Simulate fixing the findings that can be fixed:

\`lint fix {{path/to/file}}\``;
```

The shape, which a test enforces:

- line 1 is `# <name>`, line 2 is blank;

- then the `>` block: one or two lines saying what the tool does to what (a
  noun phrase or an imperative, no “This tool …”), and last exactly
  `> More information: <name> --help.`;

- then 3 to 6 examples, each a blank line, `- Description:`, a blank line,
  and the command in single backticks. The description is one sentence,
  sentence case, imperative (“Report”, “Simulate”), ending in a colon; the
  command starts with the name;

- user-supplied values are `{{placeholders}}` in the tldr style
  (`{{path/to/file}}`, `{{pattern}}`; several as `{{path/to/file1 path/to/file2
  ...}}`), never a bare `<path>`;

- plain ASCII in the commands and placeholders; typographic punctuation is
  fine in the prose lines.

5. **Add it to the header**, so `--help` and the card agree: `--cheat` on the
   `Usage:` line beside `--help | --version`, and a Flags line

   ```
   //   --cheat     print a short card of common invocations in tldr page format
   //               (the CHEAT constant below) and exit 0, printing nothing else.
   //               It cannot be combined with --brief, --json or --quiet.
   ```

**Choosing the examples** is the part that takes judgment, and the only part
a sweep should not guess at:

- Write the invocations the owner actually types, most common first. Read the
  tool’s README, its callers (§1 found them) and its tests for them. Three
  honest examples beat six padded ones.

- A read-only command first, then a mutating one as a *dry run*, then the same
  command with `--go` as its own example (“Simulate …” for the dry run is
  the tldr word). A card never shows `--yes`, `--force` or any override flag.

- Spend no slot on `--help` or `--version`; the `More information` line
  already points at help. Spend one on `--brief` or `--json` only when the
  tool is usually driven by scripts, not for form’s sake.

- Use long options (`--output`, not `-o`) so the card reads without a
  decoder, and keep the flags in the order the tool’s `--help` lists them.

- An example that would be destructive if pasted unchanged uses placeholders
  for its targets, so it cannot run by accident.

**Prove it.**

- Add the card tests: copy `parseCheat()` and the two `--cheat` tests from
  `skeleton/tool.test.mjs` into the tool’s tests, and add one assertion that
  the title is the command name. They check the shape above, exit `0`, empty
  stderr, and the usage error beside each output mode.

- Render it as the reader will: `tool --cheat > /tmp/card.md && tldr --render
  /tmp/card.md` (tealdeer; `tldr --render` takes a file). Placeholders show
  highlighted and the title line is not printed, which is tldr’s way.

- Run `tool --cheat --json`: exit `2`, nothing on stdout.

- Add the changelog line (`--cheat added`) and one line to the README’s
  usage section.

Done means: the five edits, the tests green, the render checked, and the
examples read against the real flags. A sweep over many tools reports each
tool’s examples to its owner for the judgment above, since they are the one
part no test can check.

## 9. Adopting with Commander

The contract is the output, the exit codes and the `next` advice, all of it in
the fence, and none of it cares which parser filled `values`. A tool built on
[Commander](https://github.com/tj/commander.js) adopts `mjs-tool/3` without
switching parsers. It gains one dependency, so it is no longer zero-dependency.

**When to start with Commander instead of `parseArgs`.** `parseArgs` is the
default: no dependency, and enough for a few commands and a dozen flags. There
is no fixed number of arguments; switch when the code you would write on top of
`parseArgs` becomes the bigger part, which in practice is any one of these:

- several commands, each with its own flags (`parseArgs` takes one flat list,
  so you end up checking by hand which flag belongs to which command);
- options with a fixed set of values (`--format jpeg|png|webp`), which
  Commander checks and lists in help;
- roughly fifteen or more options with defaults, where hand-checking values
  costs more than wiring Commander.

**The rules.** Do them all; the skeleton’s own contract suite passes (50/50) on
a `main()` built this way (checked 2026-10-19 with commander 15).

1. **Parse inside `main()`, with `parseAsync`, never at module level.** The
   fence’s entry guard calls `main()`, and its exit and flush handling only
   cover what runs there.
2. **Commander never prints or exits on its own.** `.exitOverride()`, and
   `.configureOutput()` with `writeOut` and `writeErr` silenced and
   `outputError` captured. A `CommanderError` goes to the fence’s
   `usageError()` (exit 2, stderr only, stdout empty). A Commander default
   that calls `process.exit()` after printing would truncate a pipe and skip
   the fence.
3. **Actions only record what to run.** The work, `nextAction()` and
   `report()` happen in `main()` after `parseAsync` resolves, exactly as in the
   `parseArgs` skeleton.
4. **The contract flags are plain root options:** `--brief`, `--json`,
   `--quiet`, `--go`, `-y, --yes`, `--cheat`, `--version`, and `-h, --help`
   with `.helpOption(false)`, so `--help` prints the header (`helpText()`) and
   `--version` prints `<tool> <version>`, both from the skeleton’s own
   branches. Pass `program.opts()` to `outputMode()`. A tool that prefers
   Commander’s generated help keeps `.helpOption()`, routes `writeOut` to
   stdout, and makes sure the generated text lists every contract flag.
5. **Never `.allowUnknownOption()`.** The fence’s override guard relies on
   an unknown flag (`--yes-really`, `--force`) being a usage error.
6. **The fence and `CONTRACT` are unchanged.** Commander lives above the fence.

The `main()` head that passed, in place of the `parseArgs` call (the rest of
the skeleton’s `main()` follows unchanged):

```js
import { Command, CommanderError } from 'commander';

async function main() {
  let picked = null;
  let usage = null;
  const program = new Command(TOOL_NAME)
    .helpOption(false) // --help prints the header, the tool's one spec
    .option('-h, --help')
    .option('--version')
    .option('--cheat')
    .option('--brief')
    .option('--json')
    .option('--quiet')
    .option('--go')
    .option('-y, --yes')
    .argument('[command]')
    .argument('[paths...]')
    .exitOverride()
    .configureOutput({ writeOut: () => {}, writeErr: () => {}, outputError: (msg) => { usage = msg; } })
    .action((command, paths) => { picked = { command, paths }; });
  try {
    await program.parseAsync(process.argv.slice(2), { from: 'user' });
  } catch (e) {
    if (!(e instanceof CommanderError)) throw e;
    usageError(String(usage ?? e.message).replace(/^error: /, '').trim());
  }
  const values = program.opts();
  const positionals = picked ? [picked.command, ...picked.paths].filter((p) => p !== undefined) : [];
  // ... then --help, --version, --cheat, outputMode(values) and the work, as in the skeleton
```

With real subcommands (`program.command('apply')`), keep the same shape: each
subcommand’s action records its name and arguments, root options stay
recognised after the subcommand (Commander’s default; don’t turn on
`.enablePositionalOptions()`), and a root with no action needs the
`--help`/`--version`/`--cheat` branches reached before Commander reports a
missing command.

**Tests.** The skeleton’s suite runs a patched copy of the tool from
`os.tmpdir()`, where `import 'commander'` does not resolve. Run it with
`TMPDIR` pointing inside the repo (beside `node_modules`), or give the copies a
`node_modules` link. Everything else carries over, `--cheat` tests included.

**An existing Commander tool** has habits of its own that the contract
changes, and each is a behaviour change for its callers, so list them for its
owner before you start: usage errors exiting 1 (Commander’s default), help
printed after an error, and above all a real run by default with `--dry-run`
to preview, where the contract dry-runs by default and needs `--go`.

## 10. Re-syncing a tool to a later runtime revision

An adopted tool carries a copy of the runtime fence, and a later skeleton
changes the block, so the tool’s copy goes stale. The re-sync is mechanical
and touches the fence, the fence test and every test that pins what the old
fence printed. It is not an adoption: the tool’s own code stays as it is.

The v3 revision (skeleton 0.4.0, `mjs-tool/3`) is the first. It changes the
`--brief` item line only: `<verdict> <summary>  <name>`, with no padding and
no glyph, and a reason cut at 160 characters, so that `--brief` is never longer
than the human output. The summary line, the `next:`
line, the human block and every `--json` key are unchanged; only the
`contract` value in `--json` and the fence’s version marker move, to `mjs-tool/3`
and `runtime v3`.

1. **Replace the fence wholesale.** Copy the block from `skeleton/tool.mjs`,
   from the opening line through the closing line, markers included, over the
   tool’s own. Nothing else in the tool’s code changes unless the fence
   removed a name the tool used: v3 drops `VERDICT_WIDTH` and `SUMMARY_WIDTH`
   and adds `REASON_CUT` and `briefReason`. A tool that read the first two (or
   declared its own `REASON_CUT`) fails to load, loudly, until it stops.

2. **Move the fence test.** Its start and end marker constants say `v3`, the
   pinned sha256 is the new block’s, and the comment names the skeleton
   release (0.4.0). The test that compares with the live skeleton checkout
   passes only once the checkout is on the same revision, so re-sync after the
   skeleton’s release is on that checkout.

3. **Update the tests that pin brief lines.** Search the tool’s tests for
   brief item lines written out in full, for the glyphs (`✓ ⚠ • ⊘ ✗`), for
   padded columns (a regex such as `/ ok /`, which now needs `/^ok /`), and for
   `"contract": "mjs-tool/2"`. A test that rebuilds the expectation from
   `--json` needs only the new shape.

4. **Update the callers that parse brief output** (§1 again). A script that
   cut a brief line by column, or tested for a glyph, reads `--json` instead; a
   script that grepped for the verdict word as a whole word (`grep -w refuse`)
   keeps working.

5. **Add the size test** if the tool has samples of its own: run each in both
   modes and assert the brief output is no longer than the human output. The
   skeleton’s suite has the shape.

6. **Done** when the tool’s suite is green, its `--brief` run on a real input
   reads as `<verdict> <summary>  <name>`, and a scan of the fleet shows the
   tool on `mjs-tool/3` with its fence unedited.

## Open items for the skeleton

1. **A declared name and version.** A hook so a tool shipped as `lint.mjs`,
   or deployed without its `package.json`, can say what it is.

2. **A conformance check that hashes the fence body.** Done, with no fence
   change: a conformance scanner hashes the runtime block, from the first
   character of the opening fence line through the last character of the
   closing fence line (markers included, the newline after it not), with
   sha256, and compares it with the same block in `skeleton/tool.mjs` for the
   same runtime version. A tool’s fence is *unedited* (same hash), *edited*
   (the same version and a different hash; the scanner names the first
   differing fence line, and this is the one state that changes a verdict),
   *unknown* (the skeleton has no block for that version, or the tool’s fence
   has no closing line or opens twice), or *not-checked* (no readable skeleton
   to compare with). The fence stays out of the conformance score. The check
   cannot see an edit outside the fence or to the fence line itself, and a tool
   kept on an older point release of the same runtime version reads as edited.
   §6 gives the same definition for a tool’s own test. The number stays so
   earlier references still resolve.

3. **A plan digest.** Done, with no fence change: the recipe is in §5 (“A
   plan digest, where drift can damage data”). The number stays so earlier
   references still resolve.

4. **Grouping in the human renderer.** A tool that used to print findings
   under a file heading now repeats the file on every block. A second case: a
   checker whose findings carried a severity of their own (ACT / WARN / INFO
   headings) loses the headings, and two severities can share one verdict.
   One shape that needs no contract change: an optional `group` on each item
   that only the human renderer reads, as it already reads `lines`, printing a
   heading wherever the group changes. `--brief`, `--json` and the contract
   string stay as they are. Severity stays out of the verdict (§3) and lives in
   the tool’s `data` and summary. Until then, sort the items by group and put
   the group at the start of each summary (`ACT call ITM …`). Where the groups
   are tables, one item per table whose `lines` hold the old rows and whose
   `data` holds them as fields does the job today (§2, “`--brief` is always
   brief”).

5. **`effect` for a read-only command that writes a new output file.** The
   adoptions reported `effect: "read-only"` with the item’s `changed: true`;
   the contract does not yet say whether that pairing is right.

6. **Batch the fence revisions.** Items 1 and 4 each change the fence itself
   (items 2 and 3 did not; see §5). The fence is byte-identical in every
   adopted tool, and seven test suites pinned its sha256 on 2026-10-03, so any
   edit turns each of them red and means a mechanical swap in every adopted
   repo. Items 1 and 4 are cosmetic and cost agents nothing, so they wait for
   whatever next forces a fence revision, and ride along with it. A revision that leaves the `--brief` lines, the
   `--json` keys and the exit codes as they are is a new runtime revision, not a
   new contract: `contract` stays as it was. The converse is the rule that made
   0.4.0 `mjs-tool/3`: a revision that changes the `--brief` lines is a new
   contract (§10). Item 2 lived in the scanner, not the fence, and landed on
   its own.
