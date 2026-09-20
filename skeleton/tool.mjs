#!/usr/bin/env node
// <tool> - a single-file Node CLI that is usable both by a person at a terminal
// and unattended by an agent, from ONE set of item objects. Rename this file to
// your tool's name (or scaffold it with `new-tool`), then fill in the
// TODO(tool) blocks. Everything else is the reusable shape.
//
// Usage:
//   <tool> inspect <path>...            read-only: report each path
//   <tool> apply   <path>... [--go]     mutating: dry run, then --go to act
//   <tool> --help | --version
//
// Commands:
//   inspect   Read-only. Reports each path (file vs directory, size). Never
//             writes. `--go` is ignored here with a warning.
//   apply     Mutating. A DRY RUN by default (prints what it would do); pass
//             --go to actually do it. Placeholder work: touch the file's mtime.
//             A "protected" target (see needsConfirmation) needs an interactive
//             y/N confirmation under --go, or --yes to pre-confirm unattended.
//
// Output modes (all rendered from the same item objects, so they can never
// disagree):
//   (default)   human    Rich, multi-line block per item.
//   --brief              Exactly one line per item: <glyph> <verdict> <summary>
//                        <name>, plus a parenthesised reason whenever the
//                        verdict is not ok. Refusals, warnings and skips are
//                        never collapsed or dropped. Ends with a summary line.
//   --json              A stable object on stdout, nothing else:
//                        { tool, version, command, items: [...],
//                          summary: { ok, warn, skip, refuse, fail } }.
//   --quiet             The summary line only.
//   --brief and --json are mutually exclusive.
//
// Flags:
//   --go        apply: perform the mutation (default is a dry run).
//   --yes, -y   apply: pre-confirm any protected target (for unattended runs).
//   --brief     one line per item (see above).
//   --json      machine-readable output (see above).
//   --quiet     summary line only.
//   --help, -h  print this header.
//   --version   print "<tool> <version>" (version read from package.json).
//
// Conventions that make it safe unattended:
//   - Data goes to stdout; every diagnostic and prompt goes to stderr. In
//     --json mode stdout is JSON and nothing else.
//   - No interactive prompt is ever issued unless process.stdin.isTTY. A step
//     that would prompt refuses (with an explicit line, exit 1) instead of
//     hanging when there is no TTY.
//   - Unknown flags are a usage error (exit 2) with a --help hint.
//
// Exit codes:
//   0   all items ok (skips are not failures).
//   1   partial: at least one item warned, refused, or failed.
//   2   usage error (unknown flag/command, missing argument, bad mode combo).
//   3   environment error (a required binary or config is missing/unreadable).

import { statSync, utimesSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';

// The realpath of this script, so a symlinked (npm-linked) invocation still
// reports the right name/version and finds its own header for --help.
const SCRIPT_PATH = (() => {
  try { return realpathSync(fileURLToPath(import.meta.url)); }
  catch { return fileURLToPath(import.meta.url); }
})();
const TOOL_NAME = basename(SCRIPT_PATH).replace(/\.mjs$/, '');

// ---- verdict semantics (the single source of truth) -------------------------
//
// Every item ends up with one of these five verdicts. verdict() is the ONLY
// place the mapping from facts to a verdict lives, and glyph() the only place
// its symbol lives. Change what "ok"/"warn"/... mean here and every output mode
// changes with it.

const GLYPH = { ok: '✓', warn: '⚠', skip: '•', refuse: '⊘', fail: '✗' };
function glyph(v) { return GLYPH[v] || '?'; }

// Facts on an item -> its verdict. Pure: reads item fields, returns a string.
function verdict(item) {
  if (item.error) return 'fail';
  if (item.kind === 'missing') return 'refuse';
  if (item.command === 'inspect') {
    if (item.kind === 'other') return 'warn';
    if (item.kind === 'file' && item.empty) return 'warn';
    return 'ok';
  }
  // apply
  if (item.kind === 'directory' || item.kind === 'other') return 'skip';
  if (item.confirmDenied) return 'refuse';
  return 'ok';
}

// ---- environment check ------------------------------------------------------

// TODO(tool): verify runtime prerequisites (a required binary on PATH, a
// readable config file, an env var). Return { ok: false, message } to abort
// with exit 3 before any item is processed. The placeholder needs nothing.
function checkEnvironment() {
  return { ok: true };
}

// ---- the placeholder work ---------------------------------------------------

// TODO(tool): which targets are dangerous enough to require confirmation before
// a mutation (writing into a production/served tree, overwriting a non-backup,
// a destructive delete, ...). Placeholder rule: a basename containing "protected".
function needsConfirmation(path) {
  return basename(path).toLowerCase().includes('protected');
}

// Read-only per-path report. TODO(tool): replace the fact-gathering below with
// your tool's real read-only inspection; keep it side-effect free.
function inspectOne(path) {
  const item = { command: 'inspect', path, name: basename(path), reason: '', changed: false, data: null };
  let st;
  try {
    st = statSync(path);
  } catch (e) {
    if (e.code === 'ENOENT') {
      item.kind = 'missing';
      item.summary = 'no such path';
      item.reason = 'path does not exist';
    } else {
      item.error = e.message;
      item.summary = 'cannot stat';
      item.reason = e.message;
    }
    item.verdict = verdict(item);
    return item;
  }
  if (st.isDirectory()) {
    item.kind = 'directory';
    item.summary = 'directory';
    item.data = { kind: 'directory' };
    item.lines = ['kind: directory'];
  } else if (st.isFile()) {
    item.kind = 'file';
    item.empty = st.size === 0;
    item.summary = `file, ${st.size} B`;
    item.data = { kind: 'file', bytes: st.size };
    item.lines = ['kind: file', `size: ${st.size} B`];
    if (item.empty) item.reason = 'file is empty (0 bytes)';
  } else {
    item.kind = 'other';
    item.summary = 'not a regular file';
    item.reason = 'special file (symlink/device/socket)';
    item.data = { kind: 'other' };
  }
  item.verdict = verdict(item);
  return item;
}

// Mutating per-path work. Dry run unless `go`. TODO(tool): replace the mtime
// touch with your tool's real mutation; keep the dry-run path a faithful
// preview of what --go would do.
async function applyOne(path, { go, yes }) {
  const item = { command: 'apply', path, name: basename(path), reason: '', changed: false, data: null };
  let st;
  try {
    st = statSync(path);
  } catch (e) {
    if (e.code === 'ENOENT') {
      item.kind = 'missing';
      item.summary = 'no such path';
      item.reason = 'path does not exist';
    } else {
      item.error = e.message;
      item.summary = 'cannot stat';
      item.reason = e.message;
    }
    item.verdict = verdict(item);
    return item;
  }
  if (st.isDirectory()) {
    item.kind = 'directory';
    item.summary = 'is a directory';
    item.reason = 'apply targets files, not directories';
    item.verdict = verdict(item);
    return item;
  }
  if (!st.isFile()) {
    item.kind = 'other';
    item.summary = 'not a regular file';
    item.reason = 'apply targets regular files';
    item.verdict = verdict(item);
    return item;
  }

  item.kind = 'file';
  item.data = { kind: 'file', bytes: st.size };
  const protectedTarget = needsConfirmation(path);

  if (!go) {
    item.summary = protectedTarget ? 'would touch mtime (needs confirmation)' : 'would touch mtime';
    if (protectedTarget) item.reason = 'protected target: --go will require confirmation (TTY) or --yes';
    item.verdict = verdict(item);
    return item;
  }

  if (protectedTarget) {
    const decision = await confirmMutation(item, { yes });
    if (!decision.ok) {
      item.confirmDenied = true;
      item.summary = 'refused (unconfirmed)';
      item.reason = decision.reason;
      item.verdict = verdict(item);
      return item;
    }
  }

  try {
    const now = new Date();
    utimesSync(path, now, now);
    item.changed = true;
    item.summary = 'touched mtime';
  } catch (e) {
    item.error = e.message;
    item.summary = 'touch failed';
    item.reason = e.message;
  }
  item.verdict = verdict(item);
  return item;
}

// Confirm a mutation. Never hangs unattended: with no TTY (and no --yes) it
// refuses rather than blocking on a prompt that no one can answer.
async function confirmMutation(item, { yes }) {
  if (yes) return { ok: true };
  if (!process.stdin.isTTY) {
    return { ok: false, reason: 'needs confirmation but stdin is not a TTY; rerun in a terminal or pass --yes' };
  }
  const proceed = await promptYesNo(`Modify protected target ${item.name}?`);
  return proceed ? { ok: true } : { ok: false, reason: 'declined at the prompt' };
}

// A y/N prompt whose text goes to stderr (never stdout), so --json stdout stays
// pure and the prompt shows even when stdout is redirected.
// EOF (Ctrl-D) at the prompt is a decline, not an abort: without the 'close'
// handler the question promise never settles, the loop drains, and the tool
// exits 0 with no report after any mutations already made (found in review,
// 2026-09-20). Declining renders the report and exits 1 like any refusal.
async function promptYesNo(question) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; rl.close(); resolve(v); } };
    rl.once('close', () => done(false));
    rl.question(`${question} [y/N] `, (answer) => {
      const a = String(answer).trim().toLowerCase();
      done(a === 'y' || a === 'yes');
    });
  });
}

// ---- rendering (one item shape -> every mode) -------------------------------

const VERDICT_WIDTH = 6; // longest verdict word ("refuse")
const SUMMARY_WIDTH = 38; // brief-mode column alignment (fits the longest shipped summary)

function summarize(items) {
  const s = { ok: 0, warn: 0, skip: 0, refuse: 0, fail: 0 };
  for (const it of items) if (it.verdict in s) s[it.verdict] += 1;
  return s;
}

function summaryLine(s, { apply, go }) {
  const base = `summary: ok=${s.ok} warn=${s.warn} skip=${s.skip} refuse=${s.refuse} fail=${s.fail}`;
  return apply && !go ? `${base}  (dry run: pass --go to apply)` : base;
}

// One line per item. The parenthesised reason appears only for a non-ok verdict.
function briefLine(item) {
  const showReason = item.verdict !== 'ok' && item.reason;
  return `${glyph(item.verdict)} ${item.verdict.padEnd(VERDICT_WIDTH)} ${String(item.summary).padEnd(SUMMARY_WIDTH)} ${item.name}`
    + (showReason ? `  (${item.reason})` : '');
}

// The stable per-item JSON shape (top-level keys fixed; tool-specific facts go
// under `data`).
function jsonItem(item) {
  return {
    path: item.path,
    name: item.name,
    verdict: item.verdict,
    summary: item.summary,
    reason: item.reason || '',
    changed: !!item.changed,
    data: item.data || null,
  };
}

function report({ tool, version, command, items, mode, apply, go }) {
  const summary = summarize(items);

  if (mode === 'json') {
    process.stdout.write(`${JSON.stringify({ tool, version, command, items: items.map(jsonItem), summary }, null, 2)}\n`);
    return;
  }

  if (mode === 'quiet') {
    process.stdout.write(`${summaryLine(summary, { apply, go })}\n`);
    return;
  }

  if (mode === 'brief') {
    for (const it of items) process.stdout.write(`${briefLine(it)}\n`);
    process.stdout.write(`${summaryLine(summary, { apply, go })}\n`);
    return;
  }

  // human
  for (const it of items) {
    process.stdout.write(`${glyph(it.verdict)} ${it.name}\n`);
    process.stdout.write(`    ${it.summary}\n`);
    for (const line of it.lines || []) process.stdout.write(`    ${line}\n`);
    if (it.reason) process.stdout.write(`    ${it.verdict === 'ok' ? 'note' : it.verdict}: ${it.reason}\n`);
  }
  process.stdout.write(`\n${summaryLine(summary, { apply, go })}\n`);
}

function exitCodeFor(items) {
  const s = summarize(items);
  return s.warn || s.refuse || s.fail ? 1 : 0;
}

// ---- help / version ---------------------------------------------------------

// Read the leading comment block of THIS file as help text (contact-sheet-cli
// pattern): skip the shebang, take the contiguous `//` lines, strip the `// `.
function helpText() {
  const lines = readFileSync(SCRIPT_PATH, 'utf8').split('\n');
  const out = [];
  for (const l of lines.slice(1)) {
    if (!l.startsWith('//')) break;
    out.push(l.slice(3));
  }
  return out.join('\n');
}

function readVersion() {
  let dir = dirname(SCRIPT_PATH);
  for (let i = 0; i < 20; i += 1) {
    const p = join(dir, 'package.json');
    if (existsSync(p)) {
      try { return JSON.parse(readFileSync(p, 'utf8')).version || '0.0.0'; }
      catch { return '0.0.0'; }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '0.0.0';
}

// ---- CLI --------------------------------------------------------------------

async function main() {
  const hint = `run \`${TOOL_NAME} --help\` for usage`;

  let parsed;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean' },
        brief: { type: 'boolean' },
        json: { type: 'boolean' },
        quiet: { type: 'boolean' },
        go: { type: 'boolean' },
        yes: { type: 'boolean', short: 'y' },
      },
    });
  } catch (e) {
    console.error(`error: ${e.message}`);
    console.error(hint);
    process.exit(2);
  }
  const { values, positionals } = parsed;

  if (values.help) {
    console.log(helpText());
    process.exit(0);
  }
  if (values.version) {
    console.log(`${TOOL_NAME} ${readVersion()}`);
    process.exit(0);
  }

  if (values.brief && values.json) {
    console.error('error: --brief and --json cannot be combined');
    console.error(hint);
    process.exit(2);
  }
  const mode = values.json ? 'json' : values.brief ? 'brief' : values.quiet ? 'quiet' : 'human';

  const [command, ...paths] = positionals;
  if (!command) {
    console.error('error: no command (expected `inspect` or `apply`)');
    console.error(hint);
    process.exit(2);
  }
  if (command !== 'inspect' && command !== 'apply') {
    console.error(`error: unknown command \`${command}\` (expected \`inspect\` or \`apply\`)`);
    console.error(hint);
    process.exit(2);
  }
  if (paths.length === 0) {
    console.error(`error: \`${command}\` needs at least one <path>`);
    console.error(hint);
    process.exit(2);
  }

  const env = checkEnvironment();
  if (!env.ok) {
    console.error(`error: ${env.message}`);
    process.exit(3);
  }

  if (command === 'inspect' && values.go) {
    console.error('note: --go has no effect on `inspect` (read-only)');
  }

  let items;
  if (command === 'inspect') {
    items = paths.map(inspectOne);
  } else {
    items = [];
    for (const p of paths) items.push(await applyOne(p, { go: !!values.go, yes: !!values.yes }));
  }

  report({
    tool: TOOL_NAME,
    version: readVersion(),
    command,
    items,
    mode,
    apply: command === 'apply',
    go: !!values.go,
  });
  process.exit(exitCodeFor(items));
}

// Entry-point guard. Resolve symlinks first: an npm-linked bin is a symlink, so
// process.argv[1] is the link path while import.meta.url is the real path, and
// the naive `import.meta.url === pathToFileURL(process.argv[1]).href` guard
// silently skips main() (exit 0, no output). realpath both sides to compare.
const __entry = process.argv[1]
  ? (() => { try { return realpathSync(process.argv[1]); } catch { return process.argv[1]; } })()
  : null;
if (__entry && import.meta.url === pathToFileURL(__entry).href) {
  main().catch((e) => {
    console.error(`error: ${e.message}`);
    process.exit(1);
  });
}

export { verdict, glyph, briefLine, jsonItem, summarize, exitCodeFor, inspectOne, applyOne };
