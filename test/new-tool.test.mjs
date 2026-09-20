import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const NEW_TOOL = new URL('../bin/new-tool.mjs', import.meta.url).pathname;

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
    // brief mode: one line per created file plus a summary line
    const lines = r.stdout.trim().split('\n');
    assert.equal(lines.length, 7);
    assert.match(lines.at(-1), /^summary: ok=6 warn=0 skip=0 refuse=0 fail=0/);
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
    // CLAUDE.md carries the agent-usage block
    assert.match(readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), /Driving `my-widget`/);
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
    const both = run(['ok-name', '--dir', dir, '--brief', '--json']);
    assert.equal(both.status, 2);
    assert.match(both.stderr, /cannot be combined/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
