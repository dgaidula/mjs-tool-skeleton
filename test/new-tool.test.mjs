import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, existsSync, writeFileSync, readFileSync, rmSync, statSync, mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not .pathname, which keeps %20 for a space in the checkout path.
const NEW_TOOL = fileURLToPath(new URL('../bin/new-tool.mjs', import.meta.url));
const SKELETON = fileURLToPath(new URL('../skeleton/tool.mjs', import.meta.url));

function run(args, opts = {}) {
  return spawnSync('node', [NEW_TOOL, ...args], { encoding: 'utf8', timeout: 20000, ...opts });
}
function tmp() {
  return mkdtempSync(path.join(tmpdir(), 'new-tool-'));
}

test('scaffolds the full file set and exits 0', () => {
  const dir = tmp();
  try {
    const r = run(['my-widget', '--dir', dir, '--brief']);
    assert.equal(r.status, 0);
    const root = path.join(dir, 'my-widget');
    for (const rel of [
      'my-widget.mjs',
      path.join('test', 'my-widget.test.mjs'),
      'package.json',
      'README.md',
      'CLAUDE.md',
      'LICENSE',
    ]) {
      assert.ok(existsSync(path.join(root, rel)), `missing ${rel}`);
    }
    // the tool file is executable
    assert.ok(statSync(path.join(root, 'my-widget.mjs')).mode & 0o100);
    // brief mode: one line per created file, a summary line, a next: line
    const lines = r.stdout.trim().split('\n');
    assert.equal(lines.length, 8);
    assert.match(lines.at(-2), /^summary: ok=6 warn=0 skip=0 refuse=0 fail=0/);
    assert.match(lines.at(-1), /^next: done /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('name is substituted throughout; no <tool> placeholder survives', () => {
  const dir = tmp();
  try {
    run(['my-widget', '--dir', dir, '--quiet']);
    const root = path.join(dir, 'my-widget');
    for (const rel of ['my-widget.mjs', 'README.md', 'CLAUDE.md', path.join('test', 'my-widget.test.mjs')]) {
      const src = readFileSync(path.join(root, rel), 'utf8');
      assert.doesNotMatch(src, /<tool>/, `<tool> left in ${rel}`);
    }
    // the test locator was rewritten for the scaffolded layout
    const testSrc = readFileSync(path.join(root, 'test', 'my-widget.test.mjs'), 'utf8');
    assert.match(testSrc, /new URL\('\.\.\/my-widget\.mjs', import\.meta\.url\)/);
    // CLAUDE.md carries the agent-usage block, and names the contract of the fence it got
    const claude = readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
    assert.match(claude, /Driving `my-widget`/);
    assert.match(claude, /runtime v2: the shared\s+machinery of\s+contract `mjs-tool\/2`/);
    assert.match(claude, /EXTRA_OVERRIDE_FLAGS/);
    assert.match(claude, /await, or synchronously flush, every\s+file write/); // the runtime exits once stdout flushes
    assert.doesNotMatch(claude, /mjs-tool runtime v/); // a fence scanner finds no fence here
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the generated tool runs and reports under its own name', () => {
  const dir = tmp();
  try {
    run(['my-widget', '--dir', dir, '--quiet']);
    const tool = path.join(dir, 'my-widget', 'my-widget.mjs');
    const sample = path.join(dir, 'sample.txt');
    writeFileSync(sample, 'data');

    const v = spawnSync('node', [tool, '--version'], { encoding: 'utf8' });
    assert.match(v.stdout.trim(), /^my-widget \d+\.\d+\.\d+/);

    const j = spawnSync('node', [tool, 'inspect', sample, '--json'], { encoding: 'utf8' });
    const data = JSON.parse(j.stdout);
    assert.equal(data.tool, 'my-widget');
    assert.equal(data.items[0].verdict, 'ok');
    assert.equal(data.summary.ok, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refuses to overwrite an existing directory (exit 1)', () => {
  const dir = tmp();
  try {
    assert.equal(run(['my-widget', '--dir', dir]).status, 0);
    const again = run(['my-widget', '--dir', dir, '--json']);
    assert.equal(again.status, 1);
    const data = JSON.parse(again.stdout);
    assert.equal(data.summary.refuse, 1);
    assert.equal(data.items[0].verdict, 'refuse');
    assert.match(data.items[0].reason, /already exists/);
    assert.equal(data.contract, 'mjs-tool/2');
    assert.equal(data.effect, 'applied'); // no dry run: see the scaffolder's header
    assert.equal(data.exit, 1);
    assert.equal(data.next.action, 'done');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('usage errors exit 2', () => {
  const dir = tmp();
  try {
    assert.equal(run([]).status, 2); // no name
    const bad = run(['Bad_Name', '--dir', dir]);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /invalid name/);
    const unknown = run(['ok-name', '--dir', dir, '--nope']);
    assert.equal(unknown.status, 2);
    assert.match(unknown.stderr, /--help/);
    for (const mode of ['--brief', '--quiet']) {
      const both = run(['ok-name', '--dir', dir, mode, '--json']);
      assert.equal(both.status, 2);
      assert.match(both.stderr, /cannot be combined/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- contract mjs-tool/2: one runtime, frozen text output -------------------

const OPEN = '// ---- mjs-tool runtime v2 (do not edit; replace wholesale) ----';
const CLOSE = '// ---- end mjs-tool runtime v2 ----';

// The fenced runtime block of a file, markers included; exactly one per file.
function fenceOf(file) {
  const src = readFileSync(file, 'utf8');
  assert.equal(src.split(OPEN).length, 2, `${file}: one opening marker`);
  assert.equal(src.split(CLOSE).length, 2, `${file}: one closing marker`);
  return src.slice(src.indexOf(OPEN), src.indexOf(CLOSE) + CLOSE.length);
}

test('the runtime fence is byte-identical in the skeleton and the scaffolder', () => {
  assert.equal(fenceOf(NEW_TOOL), fenceOf(SKELETON));
  // Only the two marker lines carry the marker text, so a scanner finds one fence per file.
  for (const file of [NEW_TOOL, SKELETON]) {
    assert.equal(readFileSync(file, 'utf8').split('mjs-tool runtime v').length, 3, file);
  }
});

test('brief and human item and summary lines are byte-identical to 0.1.0 (README sample)', () => {
  // Golden output captured from 0.1.0 (git show 69851df:skeleton/tool.mjs, run
  // in a temp dir over these files). v2 may only add the final next: line.
  const golden = {
    brief: [
      '✓ ok     would touch mtime                      report.txt',
      '✓ ok     would touch mtime                      notes.txt',
      '• skip   is a directory                         assets  (apply targets files, not directories)',
      '⊘ refuse no such path                           gone.txt  (path does not exist)',
      'summary: ok=2 warn=0 skip=1 refuse=1 fail=0  (dry run: pass --go to apply)',
    ],
    human: [
      '✓ report.txt', '    would touch mtime',
      '✓ notes.txt', '    would touch mtime',
      '• assets', '    is a directory', '    skip: apply targets files, not directories',
      '⊘ gone.txt', '    no such path', '    refuse: path does not exist',
      '',
      'summary: ok=2 warn=0 skip=1 refuse=1 fail=0  (dry run: pass --go to apply)',
    ],
  };
  const dir = tmp();
  try {
    writeFileSync(path.join(dir, 'report.txt'), 'hello world');
    writeFileSync(path.join(dir, 'notes.txt'), '');
    mkdirSync(path.join(dir, 'assets'));
    for (const [mode, flags] of [['brief', ['--brief']], ['human', []]]) {
      const r = spawnSync('node', [SKELETON, 'apply', 'report.txt', 'notes.txt', 'assets', 'gone.txt', ...flags], {
        cwd: dir, encoding: 'utf8', timeout: 15000,
      });
      const lines = r.stdout.split('\n');
      assert.equal(lines.pop(), ''); // output ends with a newline
      assert.match(lines.pop(), /^next: /); // the one v2 addition, last
      assert.deepEqual(lines, golden[mode], mode);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a scaffolded tool passes its own shipped tests (from a path with a space) and carries the same fence', () => {
  const dir = tmp();
  try {
    const spaced = path.join(dir, 'space dir');
    assert.equal(run(['my-widget', '--dir', spaced, '--quiet']).status, 0);
    const root = path.join(spaced, 'my-widget');
    assert.equal(fenceOf(path.join(root, 'my-widget.mjs')), fenceOf(SKELETON));
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT; // run it as its own top-level suite, not as our child
    const t = spawnSync('node', ['--test'], { cwd: root, env, encoding: 'utf8', timeout: 120000 });
    assert.equal(t.status, 0, t.stdout + t.stderr);
    assert.match(t.stdout, /# fail 0|ℹ fail 0/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
