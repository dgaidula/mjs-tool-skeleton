import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, existsSync, writeFileSync, readFileSync, rmSync, statSync, mkdirSync, chmodSync, readdirSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Whether output is bold is the test's choice, never the parent's: on a terminal
// `node --test` sets FORCE_COLOR=1 for the files it runs, and a child that
// inherited it would print bold into every human-mode run below.
delete process.env.FORCE_COLOR;
delete process.env.NO_COLOR;

// fileURLToPath, not .pathname, which keeps %20 for a space in the checkout path.
const NEW_TOOL = fileURLToPath(new URL('../bin/new-tool.mjs', import.meta.url));
const SKELETON = fileURLToPath(new URL('../skeleton/tool.mjs', import.meta.url));

// The scaffolder reads the user's npm and git config for the author. A test must
// never see a real one (~/.npmrc can hold credentials; a git identity would leak
// into the expected output), so every run gets a home of its own: empty unless
// the test writes a config into it. The files are written directly, not through
// npm or git, and every npm_config_* and GIT_* variable of the outer environment
// (`base`) is dropped (npm test sets some). The runs start in the home, and its
// package.json and GIT_CEILING_DIRECTORIES stop npm and git walking up out of it,
// so a temp dir inside a checkout or a project finds no repo identity or .npmrc.
function isolatedEnv(home, { npm = {}, git = {}, base = process.env } = {}) {
  mkdirSync(home, { recursive: true });
  writeFileSync(path.join(home, 'package.json'), '{}\n');
  writeFileSync(path.join(home, 'npmrc'), Object.entries(npm).map(([k, v]) => `${k}=${v}\n`).join(''));
  writeFileSync(path.join(home, 'gitconfig'), Object.keys(git).length
    ? `[user]\n${Object.entries(git).map(([k, v]) => `\t${k} = ${v}\n`).join('')}` : '');
  const env = Object.fromEntries(Object.entries(base).filter(([k]) => !/^(npm_config_|GIT_)/i.test(k)));
  return {
    ...env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, 'xdg'),
    NPM_CONFIG_USERCONFIG: path.join(home, 'npmrc'),
    NPM_CONFIG_GLOBALCONFIG: path.join(home, 'globalrc'),
    GIT_CONFIG_GLOBAL: path.join(home, 'gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CEILING_DIRECTORIES: path.dirname(home),
  };
}

// The home every plain run() shares: no author configured anywhere. It is a
// directory that is no git checkout, and the runs start in it.
const BASE_HOME = mkdtempSync(path.join(tmpdir(), 'new-tool-home-'));
const BASE_ENV = isolatedEnv(BASE_HOME);
after(() => rmSync(BASE_HOME, { recursive: true, force: true }));

function run(args, opts = {}) {
  return spawnSync('node', [NEW_TOOL, ...args], { encoding: 'utf8', timeout: 30000, cwd: BASE_HOME, env: BASE_ENV, ...opts });
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
    assert.match(claude, /runtime v3: the shared\s+machinery of\s+contract `mjs-tool\/3`/);
    assert.match(claude, /EXTRA_OVERRIDE_FLAGS/);
    assert.match(claude, /GO_ALIASES/);
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
    assert.equal(data.contract, 'mjs-tool/3');
    assert.equal(data.effect, 'applied'); // no dry run: see the scaffolder's header
    assert.equal(data.exit, 1);
    assert.equal(data.next.action, 'done');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The relative link targets in a Markdown file (no URL, no bare #anchor), anchors dropped.
function relativeLinks(md) {
  return [...md.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((m) => m[1].split('#')[0])
    .filter((t) => t && !/^[a-z]+:/i.test(t));
}

test('engines: the skeleton and a fresh scaffold both require Node 24 or newer', () => {
  const own = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(own.engines.node, '>=24');
  const dir = tmp();
  try {
    assert.equal(run(['my-widget', '--dir', dir, '--quiet']).status, 0);
    const pkg = JSON.parse(readFileSync(path.join(dir, 'my-widget', 'package.json'), 'utf8'));
    assert.equal(pkg.engines.node, '>=24');
    assert.deepEqual(pkg.engines, own.engines);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the shipped README links only files the package ships', () => {
  const own = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  for (const target of relativeLinks(readme)) assert.ok(own.files.includes(target), `README links ${target}, not in files`);
});

test('a scaffolded README links only files its package ships', () => {
  const dir = tmp();
  try {
    assert.equal(run(['my-widget', '--dir', dir, '--quiet']).status, 0);
    const root = path.join(dir, 'my-widget');
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    const links = relativeLinks(readFileSync(path.join(root, 'README.md'), 'utf8'));
    assert.ok(links.length > 0); // the README does link a file (its agent guide)
    for (const target of links) assert.ok(pkg.files.includes(target), `README links ${target}, not in files`);
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

// ---- the author (D583): the flag, else npm, else git, else a placeholder --------------------

// Scaffold `my-widget` with the given config and return what a user would see.
// It runs in the home unless `cwd(dir)` names another directory of the run's
// temp dir (made first), and with a TMPDIR of its own.
function scaffold({ npm, git, args = [], env, base, cwd } = {}) {
  const dir = tmp();
  const home = path.join(dir, 'home');
  const out = path.join(dir, 'out');
  const temp = path.join(dir, 'tmp');
  try {
    mkdirSync(temp);
    const where = cwd ? cwd(dir) : home;
    const r = run(['my-widget', '--dir', out, '--json', ...args], { cwd: where, env: env ?? { ...isolatedEnv(home, { npm, git, base }), TMPDIR: temp } });
    const root = path.join(out, 'my-widget');
    const made = existsSync(root);
    return {
      r,
      made,
      npmLogs: existsSync(path.join(home, '.npm', '_logs')),
      tempLeft: readdirSync(temp),
      pkg: made ? JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) : null,
      readme: made ? readFileSync(path.join(root, 'README.md'), 'utf8') : null,
      files: made ? Object.fromEntries(['my-widget.mjs', 'README.md', 'CLAUDE.md', 'package.json', 'LICENSE', path.join('test', 'my-widget.test.mjs')]
        .map((rel) => [rel, readFileSync(path.join(root, rel), 'utf8')])) : null,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const licenceLine = (readme) => readme.split('\n').find((l) => l.startsWith('MIT © '));
const NPM = { 'init-author-name': 'Npm Person', 'init-author-email': 'npm@example.com' };
const GIT = { name: 'Git Person', email: 'git@example.com' };

test('author: --author wins; its name is in package.json and the README licence line; no note', () => {
  const s = scaffold({ npm: NPM, git: GIT, args: ['--author', '  Ada Lovelace   <ada@example.org> '] });
  assert.equal(s.r.status, 0, s.r.stderr);
  assert.equal(s.pkg.author, 'Ada Lovelace <ada@example.org>');
  assert.equal(licenceLine(s.readme), 'MIT © Ada Lovelace');
  assert.equal(s.r.stderr, '');
});

test('author: npm config (init-author-name and -email) comes before git, with no note', () => {
  const s = scaffold({ npm: NPM, git: GIT });
  assert.equal(s.r.status, 0, s.r.stderr);
  assert.equal(s.pkg.author, 'Npm Person <npm@example.com>');
  assert.equal(licenceLine(s.readme), 'MIT © Npm Person');
  assert.equal(s.r.stderr, '');
});

test('author: git config is the fallback, and a note on stderr says the author came from git', () => {
  const s = scaffold({ git: GIT });
  assert.equal(s.r.status, 0, s.r.stderr);
  assert.equal(s.pkg.author, 'Git Person <git@example.com>');
  assert.equal(licenceLine(s.readme), 'MIT © Git Person');
  assert.match(s.r.stderr, /^note: author taken from git config \(Git Person <git@example\.com>\); /);
  assert.equal(s.r.stderr.trim().split('\n').length, 1); // one line, and stdout stays JSON only
  assert.equal(JSON.parse(s.r.stdout).summary.ok, 6);
});

test('author: with none configured, a greppable placeholder stands in, and the real owner appears nowhere but LICENSE', () => {
  const s = scaffold();
  assert.equal(s.r.status, 0, s.r.stderr);
  assert.equal(s.pkg.author, 'TODO: Your Name <you@example.com>');
  assert.equal(licenceLine(s.readme), 'MIT © TODO: Your Name');
  assert.equal(s.r.stderr, '');
  // the copied LICENSE is the skeleton's own, byte for byte (MIT requires its notice to travel)
  assert.equal(s.files.LICENSE, readFileSync(new URL('../LICENSE', import.meta.url), 'utf8'));
  assert.match(s.files.LICENSE, /Copyright \(c\) .*Danniel T\. Gaidula/);
  for (const [rel, text] of Object.entries(s.files)) {
    if (rel !== 'LICENSE') assert.doesNotMatch(text, /Danniel|Gaidula <|iceboxind/, `${rel} names the skeleton's owner`);
  }
});

test('author: the lookups write nothing outside the new directory (npm leaves no debug log and no compile cache)', () => {
  const s = scaffold(); // the placeholder case: both npm lookups run
  assert.equal(s.r.status, 0, s.r.stderr);
  assert.equal(s.npmLogs, false, 'npm wrote ~/.npm/_logs');
  assert.equal(s.tempLeft.includes('node-compile-cache'), false, 'npm left a node-compile-cache in TMPDIR');
});

// A project and a repo with an identity of their own, written directly: a
// package.json and an .npmrc naming a bait npm author, and a .git whose config
// names a bait git user (the .git alone with `npm: false`).
function writeBait(at, { npm = true } = {}) {
  for (const d of ['objects', 'refs']) mkdirSync(path.join(at, '.git', d), { recursive: true });
  writeFileSync(path.join(at, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  writeFileSync(path.join(at, '.git', 'config'), '[core]\n\trepositoryformatversion = 0\n[user]\n\tname = Bait Git\n\temail = bait-git@example.com\n');
  if (!npm) return;
  writeFileSync(path.join(at, 'package.json'), '{}\n');
  writeFileSync(path.join(at, '.npmrc'), 'init-author-name=Bait Npm\ninit-author-email=bait-npm@example.com\n');
}

test('author: only your own user-level settings count, never a project .npmrc or a repo identity around the current directory', () => {
  const inBait = (dir) => {
    writeBait(path.join(dir, 'bait'));
    mkdirSync(path.join(dir, 'bait', 'sub'));
    return path.join(dir, 'bait', 'sub');
  };
  const npm = scaffold({ npm: NPM, git: GIT, cwd: inBait });
  assert.equal(npm.r.status, 0, npm.r.stderr);
  assert.equal(npm.pkg.author, 'Npm Person <npm@example.com>');
  const git = scaffold({ git: GIT, cwd: inBait });
  assert.equal(git.r.status, 0, git.r.stderr);
  assert.equal(git.pkg.author, 'Git Person <git@example.com>');
  const none = scaffold({ cwd: inBait });
  assert.equal(none.pkg.author, 'TODO: Your Name <you@example.com>');
  // a home that is itself a git checkout (a dotfiles repo): git's global config only
  const dotfiles = scaffold({ git: GIT, cwd: (dir) => { writeBait(path.join(dir, 'home'), { npm: false }); return path.join(dir, 'home'); } });
  assert.equal(dotfiles.pkg.author, 'Git Person <git@example.com>');
});

// The test home's own guards (its package.json, GIT_CEILING_DIRECTORIES) keep
// a project or repo above it out of reach, wherever TMPDIR happens to be.
test('author: a project and a repo around the test home itself are never read', () => {
  const s = scaffold({ cwd: (dir) => { writeBait(dir); return path.join(dir, 'home'); } });
  assert.equal(s.r.status, 0, s.r.stderr);
  assert.equal(s.pkg.author, 'TODO: Your Name <you@example.com>');
});

test('author: isolatedEnv builds on its base: other variables are kept, npm_config_* and GIT_* dropped', () => {
  const dir = tmp();
  try {
    const env = isolatedEnv(path.join(dir, 'home'), { base: { KEEP: '1', npm_config_x: '1', GIT_DIR: '/nowhere' } });
    assert.equal(env.KEEP, '1');
    assert.equal('npm_config_x' in env, false);
    assert.equal('GIT_DIR' in env, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('author: the outer npm_config_* and GIT_* variables never reach the lookups, in any case', () => {
  const dir = tmp();
  try {
    const baitrc = path.join(dir, 'baitrc');
    writeFileSync(baitrc, 'init-author-name=Bait Userconfig\n');
    const s = scaffold({
      base: {
        ...process.env,
        npm_config_init_author_name: 'Bait Lower',
        NPM_CONFIG_INIT_AUTHOR_NAME: 'Bait Upper',
        npm_config_userconfig: baitrc,
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'user.name',
        GIT_CONFIG_VALUE_0: 'Bait Git',
      },
    });
    assert.equal(s.r.status, 0, s.r.stderr);
    assert.equal(s.pkg.author, 'TODO: Your Name <you@example.com>');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('author: a config value with an angle bracket is skipped for the next source, with a note naming it', () => {
  const s = scaffold({ git: { name: 'Ada <x>', email: 'ada@example.org' } });
  assert.equal(s.r.status, 0, s.r.stderr);
  assert.equal(s.pkg.author, 'TODO: Your Name <you@example.com>');
  assert.match(s.r.stderr, /^note: author in git config skipped: user\.name holds an angle bracket /);
  assert.equal(s.r.stderr.trim().split('\n').length, 1);
});

test('author: a bad npm name with a good git identity gives the git author and both notes', () => {
  const s = scaffold({ npm: { 'init-author-name': 'Npm <x>', 'init-author-email': 'npm@example.com' }, git: GIT });
  assert.equal(s.r.status, 0, s.r.stderr);
  assert.equal(s.pkg.author, 'Git Person <git@example.com>');
  const notes = s.r.stderr.trim().split('\n');
  assert.equal(notes.length, 2);
  assert.match(notes[0], /^note: author in npm config skipped: init-author-name holds an angle bracket /);
  assert.match(notes[1], /^note: author taken from git config \(Git Person <git@example\.com>\); /);
});

test('author: a bad email skips its source for the next one', () => {
  const s = scaffold({ npm: { 'init-author-name': 'Npm Person', 'init-author-email': 'npm<@example.com' }, git: GIT });
  assert.equal(s.r.status, 0, s.r.stderr);
  assert.equal(s.pkg.author, 'Git Person <git@example.com>');
  assert.match(s.r.stderr, /^note: author in npm config skipped: init-author-email holds an angle bracket /);
});

test('author: a config value with a line break or a control character is skipped, with a note saying which', () => {
  for (const [git, what] of [
    [{ name: 'Ada\\nLovelace', email: 'ada@example.org' }, 'a line break'], // git's \n escape: a real LF
    [{ name: 'Ada\u2028Lovelace', email: 'ada@example.org' }, 'a line break'],
    [{ name: 'Ada\u0085Lovelace', email: 'ada@example.org' }, 'a line break'],
    [{ name: 'Ada\\tLovelace', email: 'ada@example.org' }, 'a control character'], // git's \t escape: a real TAB
    [{ name: 'Ada\u001b[31mLovelace', email: 'ada@example.org' }, 'a control character'],
    [{ name: 'Ada Lovelace', email: 'ada\u202e@example.org' }, 'a control character'],
  ]) {
    const s = scaffold({ git });
    const key = git.name.startsWith('Ada Lovelace') ? 'user\\.email' : 'user\\.name';
    assert.equal(s.r.status, 0, s.r.stderr);
    assert.equal(s.pkg.author, 'TODO: Your Name <you@example.com>', JSON.stringify(git));
    assert.match(s.r.stderr, new RegExp(`^note: author in git config skipped: ${key} holds ${what} `), JSON.stringify(git));
    assert.equal(s.r.stderr.trim().split('\n').length, 1, JSON.stringify(git));
  }
  const npm = scaffold({ npm: { 'init-author-name': 'Ada\u202eLovelace' }, git: GIT });
  assert.equal(npm.pkg.author, 'Git Person <git@example.com>');
  assert.match(npm.r.stderr, /^note: author in npm config skipped: init-author-name holds a control character /);
});

// `npm config get` prints a C0 control as caret text (Ada^[Lovelace), which
// would pass the check; `npm config list --json` keeps the real character.
// The ESC and SOH cases guard that JSON read: through `config get` they would
// arrive as caret text and get the caret note, not this one. The ESC-sequence
// case (an SGR colour, ESC [31m) and the quoted U+2028 case only pin the JSON
// path's behaviour: npm's STRIP_C01 lets an ESC before a short SGR through, and
// prints U+2028 raw, so `config get` would show both raw and they would be
// caught either way.
test('author: an npm value with a C0 control or a quoted U+2028 is skipped, with a note saying which (R3-1)', () => {
  for (const [name, what] of [
    ['Ada\u001bLovelace', 'a control character'],
    ['Ada\u001b[31mLovelace', 'a control character'],
    ['Ada\u0001Lovelace', 'a control character'],
    ['"Ada\\u2028Lovelace"', 'a line break'], // npm's quoted (JSON) value: a real U+2028
  ]) {
    const s = scaffold({ npm: { 'init-author-name': name, 'init-author-email': 'npm@example.com' }, git: GIT });
    assert.equal(s.r.status, 0, s.r.stderr);
    assert.equal(s.pkg.author, 'Git Person <git@example.com>', JSON.stringify(name));
    const notes = s.r.stderr.trim().split('\n');
    assert.equal(notes.length, 2, JSON.stringify(name));
    assert.match(notes[0], new RegExp(`^note: author in npm config skipped: init-author-name holds ${what} `), JSON.stringify(name));
  }
});

// npm prints DEL and the C1 controls as caret text on every output path (DEL
// as ^?, C1 as ^@ to ^_), the JSON's included, so an npm value holding that
// text is skipped. git and --author see the real characters, so caret text
// there is plain text, as is a ^ before any other character in npm.
test('author: an npm value holding npm\'s caret text for DEL or C1 is skipped, with a note; a plain ^ in npm, and caret text from git or --author, pass (D666)', () => {
  for (const code of [0x7f, 0x9b, 0x85, 0x80]) {
    const label = `U+${code.toString(16).padStart(4, '0')}`;
    const s = scaffold({ npm: { 'init-author-name': `Ada${String.fromCharCode(code)}Lovelace`, 'init-author-email': 'npm@example.com' }, git: GIT });
    assert.equal(s.r.status, 0, s.r.stderr);
    assert.equal(s.pkg.author, 'Git Person <git@example.com>', label);
    const notes = s.r.stderr.trim().split('\n');
    assert.equal(notes.length, 2, label);
    assert.match(notes[0], /^note: author in npm config skipped: init-author-name holds npm's caret text for a control character \(.*; pass --author\)$/, label);
  }
  const email = scaffold({ npm: { 'init-author-name': 'Ada Lovelace', 'init-author-email': `npm${String.fromCharCode(0x7f)}@example.com` }, git: GIT });
  assert.equal(email.pkg.author, 'Git Person <git@example.com>', 'DEL in the npm email');
  assert.match(email.r.stderr, /^note: author in npm config skipped: init-author-email holds npm's caret text for a control character /);
  const plain = scaffold({ npm: { 'init-author-name': 'A^b', 'init-author-email': 'npm@example.com' }, git: GIT });
  assert.equal(plain.pkg.author, 'A^b <npm@example.com>');
  assert.equal(plain.r.stderr, '');
  const git = scaffold({ git: { name: 'Ada^[Lovelace', email: 'git@example.com' } });
  assert.equal(git.pkg.author, 'Ada^[Lovelace <git@example.com>');
  const flag = scaffold({ args: ['--author', 'Ada^?Lovelace <ada@example.org>'] });
  assert.equal(flag.r.status, 0, flag.r.stderr);
  assert.equal(flag.pkg.author, 'Ada^?Lovelace <ada@example.org>');
});

test('author: the bidi marks U+200E, U+200F and U+061C are refused in --author and skipped in config, with a note (R3-2)', () => {
  for (const mark of ['\u200e', '\u200f', '\u061c']) {
    const flag = scaffold({ npm: NPM, args: ['--author', `Ada${mark}Lovelace <ada@example.org>`] });
    assert.equal(flag.r.status, 2, JSON.stringify(mark));
    assert.equal(flag.r.stdout, '', JSON.stringify(mark));
    assert.match(flag.r.stderr, /^error: --author must not hold a control character/, JSON.stringify(mark));
    assert.equal(flag.made, false, JSON.stringify(mark));
    const git = scaffold({ git: { name: `Ada${mark}Lovelace`, email: 'ada@example.org' } });
    assert.equal(git.pkg.author, 'TODO: Your Name <you@example.com>', JSON.stringify(mark));
    assert.match(git.r.stderr, /^note: author in git config skipped: user\.name holds a control character /, JSON.stringify(mark));
    const npm = scaffold({ npm: { 'init-author-name': 'Ada Lovelace', 'init-author-email': `ada${mark}@example.org` }, git: GIT });
    assert.equal(npm.pkg.author, 'Git Person <git@example.com>', JSON.stringify(mark));
    assert.match(npm.r.stderr, /^note: author in npm config skipped: init-author-email holds a control character /, JSON.stringify(mark));
  }
});

test('author: a source with a name and no email gives a name-only author; one with no name is skipped', () => {
  const nameOnly = scaffold({ npm: { 'init-author-name': 'Solo Person' }, git: GIT });
  assert.equal(nameOnly.pkg.author, 'Solo Person');
  const emailOnly = scaffold({ npm: { 'init-author-email': 'orphan@example.com' }, git: GIT });
  assert.equal(emailOnly.pkg.author, 'Git Person <git@example.com>');
});

test('author: --author fails fast (exit 2, stdout empty, one message naming the flag, nothing written)', () => {
  for (const value of ['', '   ', 'Ada\nLovelace <ada@example.org>', 'Ada <ada@example.org>\r\n', 'Ada Lovelace', 'Ada <>', '<ada@example.org>', 'Ada <not an email>', 'Ada <ada@example.org> extra']) {
    const s = scaffold({ npm: NPM, args: ['--author', value] });
    assert.equal(s.r.status, 2, JSON.stringify(value));
    assert.equal(s.r.stdout, '', JSON.stringify(value));
    assert.match(s.r.stderr, /^error: --author /, JSON.stringify(value));
    assert.equal(s.r.stderr.trim().split('\n').length, 2, JSON.stringify(value)); // the message and the --help hint
    assert.equal(s.made, false, JSON.stringify(value));
  }
  const missing = scaffold({ args: ['--author'] });
  assert.equal(missing.r.status, 2);
  assert.equal(missing.r.stdout, '');
  assert.match(missing.r.stderr, /--author/);
});

test('author: --author refuses a Unicode line break, a control character and a bidi control (exit 2, nothing written)', () => {
  for (const [value, message] of [
    ['Ada\u2028Lovelace <ada@example.org>', /^error: --author must be one line, with no line break/],
    ['Ada\u2029Lovelace <ada@example.org>', /^error: --author must be one line, with no line break/],
    ['Ada\u0085Lovelace <ada@example.org>', /^error: --author must be one line, with no line break/],
    ['Ada\tLovelace <ada@example.org>', /^error: --author must not hold a control character/],
    ['Ada\u0001Lovelace <ada@example.org>', /^error: --author must not hold a control character/],
    ['Ada\u001b[31mLovelace <ada@example.org>', /^error: --author must not hold a control character/],
    ['Ada\u007fLovelace <ada@example.org>', /^error: --author must not hold a control character/],
    ['Ada\u009bLovelace <ada@example.org>', /^error: --author must not hold a control character/],
    ['Ada Lovelace <ada\u202e@example.org>', /^error: --author must not hold a control character/],
    ['Ada\u2066Lovelace <ada@example.org>', /^error: --author must not hold a control character/],
  ]) {
    const s = scaffold({ npm: NPM, args: ['--author', value] });
    assert.equal(s.r.status, 2, JSON.stringify(value));
    assert.equal(s.r.stdout, '', JSON.stringify(value));
    assert.match(s.r.stderr, message, JSON.stringify(value));
    assert.equal(s.made, false, JSON.stringify(value));
  }
});

test('author: --author refuses a second address, a bare word, an angle bracket in the name and a space in the email', () => {
  for (const value of ['Ada <x> Bob <bob@x.org>', 'Ada <ada>', 'Ada > Lovelace <ada@example.org>', 'Ada < Lovelace <ada@example.org>',
    'Ada <ada lovelace@example.org>', 'Ada <ada@example .org>']) {
    const s = scaffold({ npm: NPM, args: ['--author', value] });
    assert.equal(s.r.status, 2, JSON.stringify(value));
    assert.match(s.r.stderr, /^error: --author /, JSON.stringify(value));
    assert.equal(s.made, false, JSON.stringify(value));
  }
});

test('author: a bad --author is a usage error even when the target exists (checked before the refusal)', () => {
  const dir = tmp();
  try {
    mkdirSync(path.join(dir, 'my-widget'));
    const r = run(['my-widget', '--dir', dir, '--author', 'Ada']);
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /^error: --author /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('author: a refusal (target exists) does not look the author up', () => {
  const dir = tmp();
  try {
    mkdirSync(path.join(dir, 'my-widget'));
    const bin = path.join(dir, 'bin');
    mkdirSync(bin);
    const log = path.join(dir, 'log');
    for (const tool of ['npm', 'git']) {
      writeFileSync(path.join(bin, tool), `#!/bin/sh\necho "$0" >> '${log}'\nexit 1\n`);
      chmodSync(path.join(bin, tool), 0o755);
    }
    const r = spawnSync(process.execPath, [NEW_TOOL, 'my-widget', '--dir', dir, '--quiet'], {
      encoding: 'utf8', cwd: BASE_HOME, env: { ...BASE_ENV, PATH: `${bin}:${BASE_ENV.PATH}` },
    });
    assert.equal(r.status, 1);
    assert.equal(existsSync(log), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The 5 s lookup timeout is pinned by the clock: npm hangs for 60 s here. (Not
// a check for a shell: `sh -c` execs a lone command, so the stub cannot tell.)
test('author: a lookup that fails or times out (within the 5 s limit) counts as unset; git is asked for its global user.name and user.email, never to prompt', { timeout: 20000 }, () => {
  const dir = tmp();
  try {
    const bin = path.join(dir, 'bin');
    mkdirSync(bin);
    const log = path.join(dir, 'log');
    // npm hangs (the scaffolder gives up on it); git logs what it was given and fails
    writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\nexec sleep 60\n');
    writeFileSync(path.join(bin, 'git'), `#!/bin/sh\necho "prompt=$GIT_TERMINAL_PROMPT args=$*" >> '${log}'\nexit 1\n`);
    for (const tool of ['npm', 'git']) chmodSync(path.join(bin, tool), 0o755);
    const out = path.join(dir, 'out');
    const started = Date.now();
    const r = spawnSync(process.execPath, [NEW_TOOL, 'my-widget', '--dir', out, '--json'], {
      encoding: 'utf8', timeout: 30000, cwd: BASE_HOME, env: { ...BASE_ENV, PATH: `${bin}:${BASE_ENV.PATH}` },
    });
    assert.ok(Date.now() - started < 10000, `took ${Date.now() - started} ms; the lookup timeout is 5 s`);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(readFileSync(path.join(out, 'my-widget', 'package.json'), 'utf8')).author, 'TODO: Your Name <you@example.com>');
    const asked = readFileSync(log, 'utf8').trim().split('\n').sort();
    assert.deepEqual(asked, ['prompt=0 args=config --global user.email', 'prompt=0 args=config --global user.name']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('author: the scaffolder\'s requireValue is the template\'s, character for character', () => {
  const fn = (file) => {
    const src = readFileSync(file, 'utf8');
    const start = src.indexOf('function requireValue(');
    assert.ok(start >= 0, file);
    return src.slice(start, src.indexOf('\n}\n', start) + 2);
  };
  assert.equal(fn(NEW_TOOL), fn(SKELETON));
});

// ---- contract mjs-tool/3: one runtime, brief by the v3 rule, human frozen -------------------

const OPEN = '// ---- mjs-tool runtime v3 (do not edit; replace wholesale) ----';
const CLOSE = '// ---- end mjs-tool runtime v3 ----';

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

// Adopted tools pin this hash (the block, both marker lines included, no trailing newline).
const FENCE_SHA256 = 'cd2bde6f39ab4249c2d4e15329a58d616c509ade2563a37658e780f1a4a0adbd';

test('the runtime fence hashes to the pinned sha256 in both files', () => {
  for (const file of [NEW_TOOL, SKELETON]) {
    assert.equal(createHash('sha256').update(fenceOf(file)).digest('hex'), FENCE_SHA256,
      `${file}: the fence changed, so every adopted tool's pinned hash goes stale: ship it as a runtime revision (adopters re-sync by ADOPTING.md §10) and only then update FENCE_SHA256`);
  }
});

test('ADOPTING.md names the fence sha256 in both forms an adopted test pins: the block alone, and with its newline', () => {
  const doc = readFileSync(fileURLToPath(new URL('../ADOPTING.md', import.meta.url)), 'utf8');
  const withNewline = createHash('sha256').update(`${fenceOf(SKELETON)}\n`).digest('hex');
  for (const hash of [FENCE_SHA256, withNewline]) assert.ok(doc.includes(hash), `ADOPTING.md does not name ${hash}`);
});

test('human lines follow the 2026-11-06 layout; brief lines follow the v3 rule; summary lines are byte-identical in both (README sample)', () => {
  // Golden output first captured from 0.1.0 (git show 69851df:skeleton/tool.mjs,
  // run in a temp dir over these files). v2 added the final next: line. v3
  // changed only the brief item lines (no padding, no glyph). The human block
  // is 0.1.0's with one blank line between items (Dan, 2026-11-06); bold and
  // marks are off here, since this output is piped.
  const golden = {
    brief: [
      'ok would touch mtime  report.txt',
      'ok would touch mtime  notes.txt',
      'skip is a directory  assets  (apply targets files, not directories)',
      'refuse no such path  gone.txt  (path does not exist)',
      'summary: ok=2 warn=0 skip=1 refuse=1 fail=0  (dry run: pass --go to apply)',
    ],
    human: [
      '✓ report.txt', '    would touch mtime', '',
      '✓ notes.txt', '    would touch mtime', '',
      '• assets', '    is a directory', '    skip: apply targets files, not directories', '',
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

// The title line and the commands of a --cheat card name the tool.
function assertCardFor(name, card) {
  const lines = card.split('\n');
  assert.equal(lines[0], `# ${name}`);
  assert.equal(lines.at(-2).startsWith(`\`${name}`), true, 'the last example is a command of this tool');
  assert.ok(card.includes(`> More information: ${name} --help.\n`));
  assert.doesNotMatch(card, /<tool>/);
  const commands = lines.filter((l) => /^`.+`$/.test(l));
  assert.ok(commands.length >= 3 && commands.length <= 6, `3 to 6 examples, has ${commands.length}`);
  for (const c of commands) assert.ok(c.startsWith(`\`${name} `), `${c} starts with the tool name`);
}

test('a scaffolded tool prints a --cheat card under its own name, and tldr renders it', () => {
  const dir = tmp();
  try {
    assert.equal(run(['my-widget', '--dir', dir, '--quiet']).status, 0);
    const tool = path.join(dir, 'my-widget', 'my-widget.mjs');
    const r = spawnSync('node', [tool, '--cheat'], { encoding: 'utf8', timeout: 20000 });
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
    assertCardFor('my-widget', r.stdout);
    // tealdeer is optional: when it is installed, the card must render, placeholders and all
    const card = path.join(dir, 'my-widget.page.md');
    writeFileSync(card, r.stdout);
    const t = spawnSync('tldr', ['--render', card, '--color', 'never'], { encoding: 'utf8', timeout: 20000 });
    if (!t.error) {
      assert.equal(t.status, 0, t.stderr);
      assert.match(t.stdout, /my-widget inspect path\/to\/file1 path\/to\/file2 \.\.\./);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The skeleton's parseCheat(), read from its test file rather than copied, so
// the cards checked here meet the very rules an adopted tool's tests apply.
const parseCheat = (() => {
  const src = readFileSync(fileURLToPath(new URL('../skeleton/tool.test.mjs', import.meta.url)), 'utf8');
  const start = src.indexOf('function parseCheat(text) {');
  assert.ok(start >= 0, 'parseCheat() not found in the skeleton tests');
  return new Function(`${src.slice(start, src.indexOf('\n}\n', start) + 2)}return parseCheat;`)();
})();

test('new-tool has its own --cheat card, and refuses it beside an output mode', () => {
  const r = run(['--cheat']);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assertCardFor('new-tool', r.stdout);
  assert.equal(parseCheat(r.stdout).name, 'new-tool');
  for (const mode of ['--brief', '--json', '--quiet']) {
    const bad = run(['--cheat', mode]);
    assert.equal(bad.status, 2, mode);
    assert.equal(bad.stdout, '', mode);
    assert.match(bad.stderr, new RegExp(`--cheat and ${mode} cannot be combined`), mode);
  }
});

test('the example card in ADOPTING.md section 8 is a valid card', () => {
  const doc = readFileSync(fileURLToPath(new URL('../ADOPTING.md', import.meta.url)), 'utf8');
  const m = /^const CHEAT = `([\s\S]*?)`;$/m.exec(doc.replace(/\\`/g, '\u0000'));
  assert.ok(m, 'no CHEAT example in ADOPTING.md');
  const card = `${m[1].replace(/\u0000/g, '`')}\n`; // console.log adds the one newline
  assert.equal(parseCheat(card).name, 'lint');
});
