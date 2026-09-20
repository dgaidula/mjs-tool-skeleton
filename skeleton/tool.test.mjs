import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, statSync, utimesSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { basename } from 'node:path';

// The tool under test. `new-tool` rewrites this one line for the scaffolded
// layout (the test lives in test/, the tool one directory up).
const TOOL_PATH = new URL('./tool.mjs', import.meta.url).pathname;
const NAME = basename(TOOL_PATH).replace(/\.mjs$/, '');

function run(args, opts = {}) {
  return spawnSync('node', [TOOL_PATH, ...args], { encoding: 'utf8', timeout: 15000, ...opts });
}
function tmp() {
  return mkdtempSync(path.join(tmpdir(), 'tool-test-'));
}

test('brief: one line per item, refusal kept, reason parenthesised for non-ok', () => {
  const dir = tmp();
  try {
    const f = path.join(dir, 'a.txt');
    writeFileSync(f, 'hello');
    const missing = path.join(dir, 'nope.txt');
    const r = run(['inspect', f, missing, '--brief']);
    const lines = r.stdout.trim().split('\n');
    assert.equal(lines.length, 3); // two items + one summary line
    assert.match(lines[0], / ok /);
    assert.doesNotMatch(lines[0], /\(/); // an ok item carries no parenthesised reason
    assert.match(lines[1], / refuse /); // the refusal is never dropped or merged
    assert.match(lines[1], /\(path does not exist\)/);
    assert.match(lines[2], /^summary: ok=1 warn=0 skip=0 refuse=1 fail=0/);
    assert.equal(r.status, 1); // a refusal is a partial result
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('json: valid JSON on stdout, summary counts match the items', () => {
  const dir = tmp();
  try {
    const f = path.join(dir, 'a.txt');
    writeFileSync(f, 'x');
    const empty = path.join(dir, 'empty.txt');
    writeFileSync(empty, '');
    const missing = path.join(dir, 'no.txt');
    const r = run(['inspect', f, empty, missing, '--json']);
    const data = JSON.parse(r.stdout); // throws if any non-JSON leaked onto stdout
    assert.equal(data.tool, NAME);
    assert.equal(data.command, 'inspect');
    assert.equal(data.items.length, 3);
    const counts = { ok: 0, warn: 0, skip: 0, refuse: 0, fail: 0 };
    for (const it of data.items) counts[it.verdict] += 1;
    assert.deepEqual(counts, data.summary);
    assert.equal(data.summary.ok, 1); // the non-empty file
    assert.equal(data.summary.warn, 1); // the empty file
    assert.equal(data.summary.refuse, 1); // the missing path
    assert.equal(r.status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('apply: dry run changes nothing; --go touches the mtime', () => {
  const dir = tmp();
  try {
    const f = path.join(dir, 'a.txt');
    writeFileSync(f, 'x');
    const old = new Date('2001-09-09T01:46:40Z');
    utimesSync(f, old, old);

    const dry = run(['apply', f]);
    assert.equal(dry.status, 0);
    assert.match(dry.stdout, /would touch mtime/);
    assert.equal(Math.round(statSync(f).mtimeMs), old.getTime()); // untouched

    const go = run(['apply', f, '--go']);
    assert.equal(go.status, 0);
    assert.ok(statSync(f).mtimeMs > old.getTime()); // touched
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('apply: a directory is skipped, not collapsed away', () => {
  const dir = tmp();
  try {
    const sub = path.join(dir, 'adir');
    mkdirSync(sub);
    const r = run(['apply', sub, '--brief']);
    assert.match(r.stdout, / skip /);
    assert.match(r.stdout, /^summary: ok=0 warn=0 skip=1/m);
    assert.equal(r.status, 0); // a skip is not a failure
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('exit codes: 0 ok, 1 partial, 2 usage', () => {
  const dir = tmp();
  try {
    const f = path.join(dir, 'a.txt');
    writeFileSync(f, 'x');
    assert.equal(run(['inspect', f, '--quiet']).status, 0);
    assert.equal(run(['inspect', path.join(dir, 'missing'), '--quiet']).status, 1);

    const badFlag = run(['inspect', f, '--nope']);
    assert.equal(badFlag.status, 2);
    assert.match(badFlag.stderr, /--help/);

    assert.equal(run([]).status, 2); // no command
    assert.equal(run(['frobnicate', f]).status, 2); // unknown command
    assert.equal(run(['inspect']).status, 2); // no path

    const both = run(['inspect', f, '--brief', '--json']);
    assert.equal(both.status, 2);
    assert.match(both.stderr, /cannot be combined/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('non-TTY: a step that would prompt refuses (exit 1) rather than hanging', () => {
  const dir = tmp();
  try {
    // A "protected" target needs interactive confirmation under --go. spawnSync
    // gives the child a non-TTY stdin, so the tool must refuse, not block.
    const f = path.join(dir, 'protected-secret.txt');
    writeFileSync(f, 'x');
    const r = run(['apply', f, '--go', '--brief'], { timeout: 10000 });
    assert.equal(r.status, 1);
    assert.match(r.stdout, / refuse /);
    assert.match(r.stdout, /not a TTY/);
    assert.equal(Math.round(statSync(f).size), 1); // nothing mutated

    // --yes pre-confirms it for an unattended run.
    const y = run(['apply', f, '--go', '--yes']);
    assert.equal(y.status, 0);
    assert.match(y.stdout, /touched mtime/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--help prints the header block, not code, and exits 0', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage:/);
  assert.match(r.stdout, /inspect/);
  assert.match(r.stdout, /apply/);
  assert.match(r.stdout, /Exit codes:/);
  assert.doesNotMatch(r.stdout, /^import /m); // the code below the header must not leak
});

test('--version prints "<name> <semver>"', () => {
  const r = run(['--version']);
  assert.equal(r.status, 0);
  assert.match(r.stdout.trim(), new RegExp(`^${NAME} \\d+\\.\\d+\\.\\d+`));
});

test('symlinked invocation still runs main() (realpath entry guard)', () => {
  const dir = tmp();
  try {
    const f = path.join(dir, 'a.txt');
    writeFileSync(f, 'x');
    const link = path.join(dir, 'linked-tool.mjs');
    symlinkSync(TOOL_PATH, link); // an npm-linked bin is exactly this: a symlink
    const r = spawnSync('node', [link, 'inspect', f, '--brief'], { encoding: 'utf8', timeout: 15000 });
    assert.equal(r.status, 0);
    assert.match(r.stdout, / ok /); // a naive guard would print nothing here
    assert.match(r.stdout, /summary:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
