import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, writeFileSync, mkdirSync, rmSync, statSync, utimesSync, symlinkSync, readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path, { basename } from 'node:path';

// The tool under test. `new-tool` rewrites this one line for the scaffolded
// layout (the test lives in test/, the tool one directory up).
const TOOL_URL = new URL('./tool.mjs', import.meta.url);
const TOOL_PATH = TOOL_URL.pathname;
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
    assert.equal(lines.length, 4); // two items + one summary line + one next: line
    assert.match(lines[0], / ok /);
    assert.doesNotMatch(lines[0], /\(/); // an ok item carries no parenthesised reason
    assert.match(lines[1], / refuse /); // the refusal is never dropped or merged
    assert.match(lines[1], /\(path does not exist\)/);
    assert.match(lines[2], /^summary: ok=1 warn=0 skip=0 refuse=1 fail=0/);
    assert.match(lines[3], /^next: done /);
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

    for (const mode of ['--brief', '--quiet']) {
      const both = run(['inspect', f, mode, '--json']);
      assert.equal(both.status, 2);
      assert.match(both.stderr, /cannot be combined/);
      assert.equal(both.stdout, ''); // nothing on stdout, not even a partial report
    }
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

// ---- contract mjs-tool/2: effect, exit, and the next-action layer ------------

// A copy of the tool with one line of its fenced runtime patched, for faults
// only a changed program can produce. The fence is byte-identical in every
// tool on the contract, so these anchors survive the TODO(tool) edits.
function patchedCopy(dir, anchor, replacement) {
  const src = readFileSync(TOOL_PATH, 'utf8');
  assert.equal(src.split(anchor).length, 2, `anchor not found exactly once: ${anchor}`);
  const copy = path.join(dir, `${NAME}.mjs`);
  writeFileSync(copy, src.split(anchor).join(replacement));
  return copy;
}

const OK_ITEM = { path: 'a.txt', name: 'a.txt', verdict: 'ok', summary: 'would touch mtime', reason: '', changed: false, data: null };

test('json: contract mjs-tool/2 keys, and the effect of each command', () => {
  const dir = tmp();
  try {
    const f = path.join(dir, 'a.txt');
    writeFileSync(f, 'x');
    for (const [args, effect] of [
      [['inspect', f], 'read-only'],
      [['inspect', f, '--go'], 'read-only'],
      [['apply', f], 'dry-run'],
      [['apply', f, '--go'], 'applied'],
    ]) {
      const r = run([...args, '--json']);
      const data = JSON.parse(r.stdout);
      assert.equal(data.contract, 'mjs-tool/2');
      assert.equal(data.effect, effect, args.join(' '));
      assert.equal(data.exit, r.status); // the echoed code is the real one
      for (const key of ['tool', 'version', 'command', 'items', 'summary', 'next']) assert.ok(key in data, key);
      assert.ok(!('state' in data)); // optional: only a status-type command sends one
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('next: is the last line of brief, human and quiet output', () => {
  const dir = tmp();
  try {
    const f = path.join(dir, 'a.txt');
    writeFileSync(f, 'x');
    for (const mode of [['--brief'], [], ['--quiet']]) {
      const lines = run(['apply', f, ...mode]).stdout.trimEnd().split('\n');
      assert.match(lines.at(-1), /^next: run /);
      assert.match(lines.at(-2), /^summary: /);
      if (mode[0] === '--quiet') assert.equal(lines.length, 2);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rule 3: a clean dry run advises run with --go; obeying it ends in done; inspect is done', () => {
  const dir = tmp();
  try {
    const f = path.join(dir, 'a.txt');
    writeFileSync(f, 'x');
    const dry = JSON.parse(run(['apply', f, '--json']).stdout);
    assert.deepEqual(dry.next, {
      action: 'run', who: 'agent', argv: [NAME, 'apply', f, '--json', '--go'], afterSeconds: null,
      why: 'dry run clean: 1 item would change',
    });
    const obeyed = run(dry.next.argv.slice(1)); // argv[0] is the command name
    assert.equal(obeyed.status, 0);
    assert.equal(JSON.parse(obeyed.stdout).next.action, 'done');
    assert.equal(JSON.parse(run(['inspect', f, '--json']).stdout).next.action, 'done');
    const sub = path.join(dir, 'adir');
    mkdirSync(sub);
    assert.equal(JSON.parse(run(['apply', sub, '--json']).stdout).next.action, 'done'); // nothing would change
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rule 3: a protected target, a dry run with findings, or an unconfirmed --go advises ask', () => {
  const dir = tmp();
  try {
    const p = path.join(dir, 'protected-cfg.txt');
    writeFileSync(p, 'x');
    const gone = path.join(dir, 'gone.txt');
    const cases = [
      [['apply', p, '--json'], 0, [NAME, 'apply', p, '--json', '--go'], // protected, dry run
        'a person must confirm at a terminal: protected-cfg.txt'],
      [['apply', gone, '--json'], 1, [NAME, 'apply', gone, '--json', '--go'],
        'dry run: review the 1 finding before --go'],
      [['apply', p, '--go', '--json'], 1, [NAME, 'apply', p, '--go', '--json'], // no TTY to confirm on
        'left unconfirmed without a TTY; a person must confirm at a terminal: protected-cfg.txt'],
    ];
    for (const [args, exit, argv, why] of cases) {
      const r = run(args);
      const { next } = JSON.parse(r.stdout);
      assert.equal(r.status, exit, args.join(' '));
      assert.equal(next.action, 'ask', args.join(' '));
      assert.equal(next.who, 'human');
      assert.deepEqual(next.argv, argv); // what the person would run, never with --yes
      assert.equal(next.why, why);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rule 2: the guard throws on --yes, --force, --allow-* or --i-am-* in next.argv, render path included', async () => {
  const tool = await import(TOOL_URL.href);
  const run1 = { command: 'apply', items: [OK_ITEM], effect: 'dry-run', state: null, argv: ['apply', 'a.txt'] };
  for (const flag of ['--yes', '--force', '--force=1', '--allow-x', '--i-am-sure', '-y', '-qy']) {
    // A policy that wraps the real one and tries to smuggle an override in.
    const evilPolicy = (r) => ({ ...tool.nextAction(r), argv: [NAME, 'apply', 'a.txt', '--go', flag] });
    assert.throws(() => tool.assertSafeNext(evilPolicy(run1), 0), /override flag/, flag);
    // report() runs the guard before it writes a byte.
    assert.throws(() => tool.report({ ...run1, next: evilPolicy(run1), mode: 'brief' }), /override flag/, flag);
  }
  // ask is a person's call, but its argv may not carry one either.
  assert.throws(() => tool.assertSafeNext(tool.nextStep('ask', 'x', { argv: [NAME, 'apply', '--yes'] }), 0), /override flag/);
});

test('rule 2 end to end: an injected override exits 3 with nothing on stdout; --yes is never echoed', () => {
  const dir = tmp();
  try {
    const f = path.join(dir, 'a.txt');
    writeFileSync(f, 'x');
    // Patch the runtime so every re-run argv a policy builds carries an override.
    const copy = patchedCopy(dir, 'return [TOOL_NAME, ...argv, ...extra];', "return [TOOL_NAME, ...argv, ...extra, '--yes'];");
    const r = spawnSync('node', [copy, 'apply', f, '--brief'], { encoding: 'utf8', timeout: 15000 });
    assert.equal(r.status, 3);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /unsafe next: argv carries the override flag --yes/);

    // The real tool, handed --yes on a dry run, advises ask with no command.
    const { next } = JSON.parse(run(['apply', f, '--yes', '--json']).stdout);
    assert.equal(next.action, 'ask');
    assert.equal(next.argv, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rule 4: next never contradicts the exit code (0 no stop; 2 and 3 only stop; 1 any)', async () => {
  const { assertSafeNext, nextStep, report } = await import(TOOL_URL.href);
  const all = [
    nextStep('done', 'x'),
    nextStep('run', 'x', { argv: [NAME, 'apply', 'a.txt', '--go'] }),
    nextStep('wait', 'x', { argv: [NAME, 'status'], afterSeconds: 60 }),
    nextStep('ask', 'x'),
    nextStep('stop', 'x'),
  ];
  for (const next of all) assert.doesNotThrow(() => assertSafeNext(next, 1));
  for (const next of all.slice(0, 4)) assert.doesNotThrow(() => assertSafeNext(next, 0)); // ask included
  assert.throws(() => assertSafeNext(all[4], 0), /contradicts exit 0/);
  for (const exit of [2, 3]) {
    assert.doesNotThrow(() => assertSafeNext(all[4], exit));
    for (const next of all.slice(0, 4)) assert.throws(() => assertSafeNext(next, exit), /contradicts exit/);
  }
  // report() derives the exit code from the items itself, so the check cannot be skipped.
  const stopOnOk = { command: 'apply', effect: 'applied', items: [OK_ITEM], next: all[4], mode: 'brief' };
  assert.throws(() => report(stopOnOk), /contradicts exit 0/);
});

test('guard: next has the fixed shape', async () => {
  const { assertSafeNext, nextStep } = await import(TOOL_URL.href);
  assert.doesNotThrow(() => assertSafeNext(null, 0)); // null: no advice, follow the runbook
  assert.throws(() => assertSafeNext(undefined, 0), /must return/);
  assert.throws(() => assertSafeNext(nextStep('skip', 'x'), 0), /unknown action/);
  assert.throws(() => assertSafeNext(nextStep('ask', 'x', { who: 'agent' }), 0), /always who: human/);
  assert.throws(() => assertSafeNext(nextStep('run', 'x'), 0), /needs an argv/);
  assert.throws(() => assertSafeNext(nextStep('run', 'x', { argv: `${NAME} apply --go` }), 0), /array of strings/);
  assert.throws(() => assertSafeNext(nextStep('wait', 'x', { argv: [NAME] }), 0), /afterSeconds/);
  assert.throws(() => assertSafeNext(nextStep('done', 'two\nlines'), 0), /one non-empty line/);
  assert.throws(() => assertSafeNext({ ...nextStep('done', 'x'), cwd: '/' }, 0), /fields are exactly/);
});

test('next: line quotes argv for reading and shows the wait', async () => {
  const { nextLine, nextStep } = await import(TOOL_URL.href);
  assert.equal(nextLine(nextStep('done', 'nothing to apply')), 'next: done  (nothing to apply)');
  assert.equal(
    nextLine(nextStep('run', 'clean', { argv: ['t', 'apply', 'my file.txt', "it's", '--go'] })),
    "next: run t apply 'my file.txt' 'it'\\''s' --go  (clean)",
  );
  assert.equal(
    nextLine(nextStep('wait', 'in flight', { argv: ['t', 'status'], afterSeconds: 900 })),
    'next: wait 900s t status  (in flight)',
  );
});

test('json: state appears only when a tool provides one', async () => {
  const { report, nextStep } = await import(TOOL_URL.href);
  const capture = (args) => {
    const write = process.stdout.write;
    let out = '';
    process.stdout.write = (chunk) => { out += chunk; return true; };
    try { report(args); } finally { process.stdout.write = write; }
    return JSON.parse(out);
  };
  const base = { command: 'status', effect: 'read-only', items: [OK_ITEM], next: nextStep('done', 'x'), mode: 'json' };
  assert.ok(!('state' in capture(base)));
  assert.deepEqual(capture({ ...base, state: { queue: { pending: 4 } } }).state, { queue: { pending: 4 } });
});

test('an uncaught throw exits 3 (could not run to completion), not 1 (partial)', () => {
  const dir = tmp();
  try {
    const f = path.join(dir, 'a.txt');
    writeFileSync(f, 'x');
    const copy = patchedCopy(dir, 'function summarize(items) {', "function summarize(items) { throw new Error('forced failure');");
    const r = spawnSync('node', [copy, 'inspect', f, '--brief'], { encoding: 'utf8', timeout: 15000 });
    assert.equal(r.status, 3);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /^error: forced failure/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
