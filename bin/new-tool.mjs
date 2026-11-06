#!/usr/bin/env node
// new-tool - scaffold a new single-file CLI from the mjs-tool-skeleton template.
//
// Copies skeleton/tool.mjs into <dir>/<name>/ as <name>.mjs, plus a matching
// test, package.json, README.md, CLAUDE.md (carrying the agent-usage block),
// and LICENSE - substituting the tool name throughout. Refuses to overwrite an
// existing directory. Dogfoods the skeleton's own convention: it reports in the
// same --brief / --json / --quiet / human modes, with the same exit codes, from
// the same fenced runtime block (contract mjs-tool/3).
//
// It has no dry run and no --go. All it writes is a directory that did not
// exist (apart from the empty ~/.npm that npm may create when asked for the
// author; see the README’s Known limits), and it refuses when the directory does, so every run acts (--json
// reports effect "applied"). That is its one deliberate exception to the
// contract's dry-run gate.
//
// Usage:
//   new-tool <name> [--dir <path>] [--author "<Name> <email>"]
//   new-tool <name> --brief
//   new-tool --help | --version | --cheat
//
// <name> must be a lowercase package name: a letter, then letters, digits, or
// hyphens (e.g. my-widget). --dir is where the <name>/ folder is created
// (default: the current directory).
//
// The author written into the new tool's package.json and README licence line
// is yours, never the skeleton's. It comes from, in order:
//   1. --author "<Name> <email>" (both required, on one line, with no control
//      character);
//   2. npm's init-author-name and init-author-email (set them once with
//      `npm config set init-author-name "<Name>"` and the same for -email);
//   3. git's user.name and user.email, with a `note:` on stderr saying so;
//   4. the placeholder "TODO: Your Name <you@example.com>", to fill in.
// Sources 2 and 3 are your own user-level settings: npm is asked from your
// home folder and git reads only its global config, so a project's .npmrc or
// a repo's identity where you run new-tool never counts. A source counts when
// it gives a name; a config source whose name or email holds a line break, a
// control character, a bidi control or mark (U+200E, U+200F, U+061C) or an
// angle bracket is skipped, with a `note:` on stderr saying which. npm prints
// DEL and C1 controls as caret text, so npm's values are checked through it:
// one holding ^? or ^@ to ^_ is skipped the same way. The copied LICENSE file
// keeps the skeleton's own copyright notice: the MIT licence requires it to
// travel with the code.
//
// --cheat prints a short card of common invocations in tldr page format (the
// CHEAT constant below) and exits 0, printing nothing else. It cannot be
// combined with --brief, --json or --quiet.
//
// Output modes: (default) human, --brief (one line per created file), --json,
// --quiet (summary line only). Every text mode ends with one `next:` line.
// --json cannot be combined with --brief or --quiet.
//
// Exit codes:
//   0   scaffolded ok.
//   1   refused (the target directory already exists) or a write failed.
//   2   usage error (missing/invalid name, a bad --author, unknown flag, bad
//       mode combo).
//   3   could not run to completion (the skeleton templates could not be
//       read, or an internal error).

import {
  mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync,
} from 'node:fs';
import {
  dirname, join, resolve, relative,
} from 'node:path';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { parseArgs, promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const NAME_RE = /^[a-z][a-z0-9-]*$/;

// The cheat card (printed by --cheat): a tldr page, in the shape the skeleton's
// CHEAT comment spells out (skeleton/tool.mjs). A backtick is escaped.
const CHEAT = `# new-tool

> Scaffold a single-file Node CLI from the mjs-tool-skeleton template.
> More information: new-tool --help.

- Create a new tool in a folder of its own, in the current directory:

\`new-tool {{tool-name}}\`

- Create a new tool in another directory:

\`new-tool {{tool-name}} --dir {{path/to/directory}}\`

- Create a new tool with an explicit author for its package.json and README:

\`new-tool {{tool-name}} --author "{{Your Name <you@example.com>}}"\`

- Create a new tool and print one line per file created:

\`new-tool {{tool-name}} --brief\`

- Create a new tool and print the result as JSON:

\`new-tool {{tool-name}} --json\``;

// ---- generated-file templates ----------------------------------------------

// The author line and licence name for a scaffold with no author found: obviously
// unfinished, and greppable.
const PLACEHOLDER_NAME = 'TODO: Your Name';
const PLACEHOLDER_AUTHOR = { name: PLACEHOLDER_NAME, email: 'you@example.com', line: `${PLACEHOLDER_NAME} <you@example.com>`, source: 'placeholder' };

function pkgJson(name, author) {
  return `${JSON.stringify({
    name,
    version: '0.1.0',
    description: `TODO: one-line description of ${name}.`,
    type: 'module',
    bin: { [name]: `${name}.mjs` },
    files: [`${name}.mjs`, 'README.md', 'CLAUDE.md', 'LICENSE'],
    engines: { node: '>=24' },
    scripts: { test: 'node --test' },
    keywords: [],
    author: author.line,
    license: 'MIT',
  }, null, 2)}\n`;
}

function readmeMd(name, author) {
  return `# ${name}

TODO: one-line description of what ${name} does.

## Install

\`\`\`sh
npx ${name} inspect <path>...
# or
npm install -g ${name}
\`\`\`

Requires Node 24+. Zero dependencies — the whole tool is one \`.mjs\` file.

## Usage

\`\`\`sh
${name} inspect <path>...            # read-only report
${name} apply   <path>... [--go]     # dry run, then --go to act
\`\`\`

Every command renders from one set of item objects in four modes: the default
human output, \`--brief\` (one line per item), \`--json\` (a stable
\`{ tool, version, contract, command, effect, exit, items, summary, next }\`
object), and \`--quiet\` (the summary line only). Every text mode ends with one
\`next:\` line, the tool’s advice on the next step. \`--json\` cannot be
combined with \`--brief\` or \`--quiet\`.

\`${name} --cheat\` prints a short card of common invocations in
[tldr](https://github.com/tldr-pages/tldr) page format, for \`tldr --render\`
and for anything that gathers cards. Keep its examples true to the flags.

## Exit codes

| code | meaning |
|---|---|
| \`0\` | all items ok (skips are not failures) |
| \`1\` | partial — at least one item warned, refused, or failed |
| \`2\` | usage error |
| \`3\` | could not run to completion — an environment or internal error |

## For agents

See [CLAUDE.md](CLAUDE.md) for how an agent session should drive this tool —
reach for \`--brief\`/\`--json\`, treat any non-\`ok\` line as a finding,
dry-run before \`--go\`, and obey or halt on the \`next:\` line.

## Development

\`\`\`sh
npm test      # node --test
\`\`\`

Search \`${name}.mjs\` for \`TODO(tool):\` — those mark where this tool’s real
work goes.

## License

MIT © ${author.name}
`;
}

function claudeMd(name, agentBlock) {
  return `# ${name} — agent guide

Zero-dependency Node 24+ single-file CLI built from
[mjs-tool-skeleton](https://github.com/dgaidula/mjs-tool-skeleton). One file:
\`${name}.mjs\`. \`README.md\` is the human-facing pitch; this file is the
agent-facing contract.

${agentBlock}

## Filling in the tool

Search \`${name}.mjs\` for \`TODO(tool):\` — those are the eleven spots where
this tool’s real work goes: the cheat card (\`--cheat\`), the environment
check, which targets need confirmation, the read-only \`inspect\` report, the
\`apply\` mutation, which commands mutate, which of them may go on to \`--go\`
unattended, the tool’s own override flags, its aliases of \`--go\`, the
next-action policy, and the flags that take a value (\`requireValue()\`; the
template’s \`--note\` is a placeholder to replace or remove).
Keep the \`report()\` / \`verdict()\` / \`nextAction()\` shape intact: rendering
every mode from one set of item objects is what guarantees the human,
\`--brief\`, and \`--json\` outputs can never disagree.

**Override flags.** \`next.argv\` never carries a flag that confirms or
overrides a gate; the runtime blocks \`--yes*\`, \`--force*\`, \`--assume-yes\`,
\`--allow\`, \`--allow=*\`, \`--allow-*\`, \`--i-am-*\`, and \`-y\` or \`-Y\` alone
or grouped. Any other override this tool accepts goes in
\`EXTRA_OVERRIDE_FLAGS\`, which the guard reads. Give an override flag no short
alias other than \`-y\`; an older one (a \`-f\` that means force) must be listed
there too.

**Aliases of \`--go\`.** A flag this tool accepts in place of \`--go\` (an older
\`--apply\`, a short \`-g\`) goes in \`GO_ALIASES\`. Advice always spells
\`--go\`: the guard refuses a declared alias anywhere in \`next.argv\`, since its
\`--go\` checks cannot see one. Hand \`nextAction()\` and \`report()\` the same
argv with each alias spelled \`--go\`.

**Auto-run.** A clean dry run advises \`ask\` (a person’s call) unless its
command is in \`AUTO_RUN_COMMANDS\`, which is empty until you fill it. Only
then does \`next\` say \`run\` with \`--go\`. List a command there only when
its owner has pre-approved applying it unattended; the tool may read that
list from its own config.

**Finish every write before the report.** The runtime exits once stdout has
flushed after \`report()\` (or once \`main()\` returns without one); it never
waits for the event loop to drain. So await, or synchronously flush, every
file write before that point: an un-awaited async write, such as an
append-mode logger’s closing line, is cut off.

The fenced block at the bottom of \`${name}.mjs\`, between its two “do not
edit” marker comments, is runtime v${CONTRACT.split('/')[1]}: the shared machinery of
contract \`${CONTRACT}\`. Never edit it; to move to a later contract, replace
the whole block with the new one.
`;
}

// Take the "## Driving ..." block out of AGENT-USAGE.md (everything from the
// first "## " heading onward) and substitute the tool name for <tool>.
function agentBlockFor(name, agentUsageSrc) {
  const idx = agentUsageSrc.indexOf('## ');
  const block = idx >= 0 ? agentUsageSrc.slice(idx) : agentUsageSrc;
  return block.split('<tool>').join(name).trimEnd();
}

// ---- contract hooks (the fenced runtime below relies on these) --------------

// The scaffolder's one command. It mutates but has no gate (see the header),
// so main() asks effectFor() as if --go were always given.
const MUTATING_COMMANDS = new Set(['new-tool']);

// It never has a dry run, so there is nothing to auto-run.
const AUTO_RUN_COMMANDS = new Set();

// The scaffolder has no override flags of its own.
const EXTRA_OVERRIDE_FLAGS = [];

// Nor any alias of --go.
const GO_ALIASES = [];

// The scaffolder needs nothing beyond the runtime's generic policy.
function nextAction(run) {
  return defaultNextAction(run);
}

// ---- the author --------------------------------------------------------------

// A flag's value, checked before any work (the same helper the template's tool
// body carries; a test holds the two copies identical). Missing, blank after
// trim, or (unless multiline) holding a line break (CR, LF, U+2028, U+2029 or
// U+0085): a usage error naming the flag, exit 2, stdout empty. Returns the
// trimmed value. Call it at run time, never at module top level: the names it
// uses live in the runtime block below.
function requireValue(flag, value, { multiline = false } = {}) {
  if (typeof value !== 'string') usageError(`${flag} needs a value`);
  if (!value.trim()) usageError(`${flag} must not be blank`);
  if (!multiline && /[\r\n\u2028\u2029\u0085]/.test(value)) usageError(`${flag} must be one line, with no line break`);
  return value.trim();
}

// An author is one line of plain text: no line break (the same set as
// requireValue's), and no other character the runtime's printable() escapes
// (C0 controls, TAB included here, DEL, C1, the bidi controls), nor the three
// bidi marks printable() leaves alone (U+200E, U+200F, U+061C).
const AUTHOR_LINE_BREAK = /[\r\n\u2028\u2029\u0085]/;
const AUTHOR_CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c]/;

// A name and an optional email as one author, or null when there is no usable
// name. Every source is held to the one-line, no-control-character rule, and a
// name with an angle bracket would not parse back out of "Name <email>".
function authorOf(name, email, source) {
  const n = String(name ?? '').trim();
  const e = String(email ?? '').trim();
  const plain = (t) => !AUTHOR_CONTROL.test(t) && !/[<>]/.test(t);
  if (!n || !plain(n) || !plain(e)) return null;
  return { name: n, email: e, line: e ? `${n} <${e}>` : n, source };
}

// --author "<Name> <email>": both parts are required, so a half-filled author
// never reaches a package.json. Anything else is a usage error naming the flag.
function authorFromFlag(value) {
  const text = requireValue('--author', value);
  if (AUTHOR_CONTROL.test(text)) usageError('--author must not hold a control character (a tab, an escape, a bidi control)');
  const m = /^([^<>]+?)\s*<([^<>\s]+@[^<>\s]+)>$/.exec(text);
  if (!m) usageError('--author needs a name and an email, as "<Name> <email>" (for example "Ada Lovelace <ada@example.com>")');
  return authorOf(m[1], m[2], 'flag');
}

// One config value, or '' when the tool is missing, the key is unset, the call
// fails, or it takes more than a few seconds. execFile, so no shell; git never
// stops to ask a question. It runs in the user's home folder, so a project's
// .npmrc or a repo's git config around the current directory never counts,
// and node keeps no compile cache for npm under $TMPDIR.
async function lookup(cmd, args) {
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      cwd: homedir(), timeout: 5000, encoding: 'utf8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', NODE_DISABLE_COMPILE_CACHE: '1' },
    });
    return stdout.trim();
  } catch {
    return '';
  }
}

// npm's values for the keys, '' for each when unset or the call fails, from one
// `npm config list --json`: `npm config get` prints a C0 control as caret text
// (^[ for ESC), which the check below cannot see, while the JSON keeps it as a
// \u escape. npm prints DEL and the C1 controls (U+0085 among them) as caret
// text on every output path, the JSON's included, so NPM_CARET treats ^? and
// ^@ to ^_ in an npm value as the control they stand for (README, Known limits).
const NPM_CARET = /\^[?@-_]/;
async function npmConfig(keys) {
  try {
    const config = JSON.parse(await lookup('npm', ['config', 'list', '--json', '--logs-max=0']));
    return keys.map((key) => (typeof config[key] === 'string' ? config[key].trim() : ''));
  } catch {
    return keys.map(() => '');
  }
}

// The flag's author if given, else npm's init-author-*, else git's user.*, else
// the placeholder: only the user's own settings, since npm runs from the home
// folder and git reads its global config alone. npm runs with --logs-max=0, so
// it writes no debug log under ~/.npm/_logs; it may still create an empty
// ~/.npm in a home where it never ran (README, Known limits). A source whose
// name or email breaks the one-line, no-control-character, no-angle-bracket
// rule, or (npm only) holds npm's caret text, is skipped with a note.
async function resolveAuthor(fromFlag) {
  if (fromFlag) return fromFlag;
  const sources = [
    ['npm', npmConfig, 'init-author-name', 'init-author-email'],
    ['git', (keys) => Promise.all(keys.map((key) => lookup('git', ['config', '--global', key]))), 'user.name', 'user.email'],
  ];
  for (const [source, read, nameKey, emailKey] of sources) {
    const [name, email] = await read([nameKey, emailKey]);
    const caret = (v) => source === 'npm' && NPM_CARET.test(v);
    const bad = name && [[nameKey, name], [emailKey, email]].find(([, v]) => AUTHOR_CONTROL.test(v) || /[<>]/.test(v) || caret(v));
    if (bad) {
      const what = AUTHOR_LINE_BREAK.test(bad[1]) ? 'a line break' : AUTHOR_CONTROL.test(bad[1]) ? 'a control character' : /[<>]/.test(bad[1]) ? 'an angle bracket' : null;
      const why = what ? 'an author is one line, with no control character and no < or > in the name or email' : 'npm prints DEL and C1 controls as ^? and ^@ to ^_; pass --author';
      console.error(`note: author in ${source} config skipped: ${bad[0]} holds ${what ?? "npm's caret text for a control character"} (${why})`);
      continue;
    }
    const found = authorOf(name, email, source);
    if (found) return found;
  }
  return PLACEHOLDER_AUTHOR;
}

// ---- CLI --------------------------------------------------------------------

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean' },
        cheat: { type: 'boolean' },
        dir: { type: 'string' },
        author: { type: 'string' },
        brief: { type: 'boolean' },
        json: { type: 'boolean' },
        quiet: { type: 'boolean' },
      },
    });
  } catch (e) {
    usageError(e.message);
  }
  const { values, positionals } = parsed;

  if (values.help) { console.log(helpText()); return; }
  if (values.version) { console.log(`${TOOL_NAME} ${readVersion()}`); return; }
  if (values.cheat) {
    for (const mode of ['brief', 'json', 'quiet']) {
      if (values[mode]) usageError(`--cheat and --${mode} cannot be combined`);
    }
    console.log(CHEAT);
    return;
  }

  const mode = outputMode(values);

  const name = positionals[0];
  if (!name) usageError('no <name> (the tool to create)');
  if (positionals.length > 1) usageError(`unexpected extra argument \`${positionals[1]}\` (expected one <name>)`);
  if (!NAME_RE.test(name)) {
    usageError(`invalid name \`${name}\` (use a lowercase letter, then letters/digits/hyphens, e.g. my-widget)`);
  }

  // Check the author flag before any work; the lookups wait until the target is known to be free.
  const fromFlag = values.author === undefined ? null : authorFromFlag(values.author);

  // Load the templates that ship with this package.
  const repoRoot = dirname(dirname(SCRIPT_PATH)); // bin/ -> repo root
  const toolTplPath = join(repoRoot, 'skeleton', 'tool.mjs');
  const testTplPath = join(repoRoot, 'skeleton', 'tool.test.mjs');
  const licensePath = join(repoRoot, 'LICENSE');
  const agentUsagePath = join(repoRoot, 'AGENT-USAGE.md');
  let toolTpl; let testTpl; let licenseTpl; let agentUsage;
  try {
    toolTpl = readFileSync(toolTplPath, 'utf8');
    testTpl = readFileSync(testTplPath, 'utf8');
    licenseTpl = readFileSync(licensePath, 'utf8');
    agentUsage = readFileSync(agentUsagePath, 'utf8');
  } catch (e) {
    environmentError(`cannot read the skeleton templates (${e.message})`);
  }

  const baseDir = values.dir ? resolve(values.dir) : process.cwd();
  const dest = join(baseDir, name);
  const rel = (p) => relative(process.cwd(), p) || '.';

  // Render the items and advise; every call site returns right after. The
  // runtime then exits with the reported code once stdout has flushed.
  const command = 'new-tool';
  const effect = effectFor(command, true);
  const finish = (items) => {
    const next = nextAction({ command, items, effect, state: null, argv: process.argv.slice(2) });
    report({ command, effect, items, next, mode });
  };

  // Refuse rather than overwrite an existing directory.
  if (existsSync(dest)) {
    return finish([{
      path: dest,
      name: rel(dest),
      verdict: 'refuse',
      summary: 'exists',
      reason: 'target directory already exists; refusing to overwrite',
      changed: false,
      data: null,
    }]);
  }

  const author = await resolveAuthor(fromFlag);
  if (author.source === 'git') {
    console.error(`note: author taken from git config (${printable(author.line)}); to use another, pass --author or set npm's init-author-name and init-author-email`);
  }

  // Build the substituted file set.
  const toolSrc = toolTpl.split('<tool>').join(name);
  const testSrc = testTpl.split("new URL('./tool.mjs', import.meta.url)").join(`new URL('../${name}.mjs', import.meta.url)`);
  const files = [
    { rel: `${name}.mjs`, content: toolSrc, exec: true },
    { rel: join('test', `${name}.test.mjs`), content: testSrc },
    { rel: 'package.json', content: pkgJson(name, author) },
    { rel: 'README.md', content: readmeMd(name, author) },
    { rel: 'CLAUDE.md', content: claudeMd(name, agentBlockFor(name, agentUsage)) },
    { rel: 'LICENSE', content: licenseTpl },
  ];

  const items = [];
  try {
    mkdirSync(dest, { recursive: true });
    mkdirSync(join(dest, 'test'), { recursive: true });
  } catch (e) {
    return finish([{
      path: dest, name: rel(dest), verdict: 'fail', summary: 'mkdir failed', reason: e.message, changed: false, data: null,
    }]);
  }

  for (const f of files) {
    const full = join(dest, f.rel);
    const item = {
      path: full, name: join(name, f.rel), verdict: 'ok', summary: 'created', reason: '', changed: true,
    };
    try {
      writeFileSync(full, f.content);
      if (f.exec) chmodSync(full, 0o755);
      item.data = { bytes: Buffer.byteLength(f.content) };
    } catch (e) {
      item.verdict = 'fail';
      item.summary = 'write failed';
      item.reason = e.message;
      item.changed = false;
    }
    items.push(item);
  }

  return finish(items);
}

export { agentBlockFor, briefLine, summarize, exitCodeFor };

// ---- mjs-tool runtime v3 (do not edit; replace wholesale) ----
// The shared machinery of contract mjs-tool/3, byte-identical in every tool
// built from mjs-tool-skeleton. It carries its own imports (namespaced, so they
// never collide with the tool's); its other top-level names are unprefixed, so
// a tool keeps no copies of them. The tool supplies, outside this block:
// MUTATING_COMMANDS, AUTO_RUN_COMMANDS, EXTRA_OVERRIDE_FLAGS, GO_ALIASES,
// main(), and a nextAction() policy whose result it hands to report(); the
// block checks their shapes as it loads. To move a tool to a later contract,
// swap this whole block.

import * as runtimeFs from 'node:fs';
import * as runtimePath from 'node:path';
import * as runtimeUrl from 'node:url';

const CONTRACT = 'mjs-tool/3';

// The realpath of this script, so a symlinked (npm-linked) invocation still
// reports the right name/version and finds its own header for --help.
const SCRIPT_PATH = (() => {
  const self = runtimeUrl.fileURLToPath(import.meta.url);
  try { return runtimeFs.realpathSync(self); } catch { return self; }
})();
const TOOL_NAME = runtimePath.basename(SCRIPT_PATH).replace(/\.mjs$/, '');

// The directory the run started in (next.cwd), read once as the module loads,
// so a run that removes its own working directory still reports. If it was
// gone before the start, the shell's $PWD stands in (or / without one).
const START_CWD = (() => {
  try { return process.cwd(); } catch {
    const pwd = process.env.PWD;
    return pwd && runtimePath.isAbsolute(pwd) ? pwd : '/';
  }
})();

// -- verdicts: symbols, counts, exit code

const GLYPH = { ok: '✓', warn: '⚠', skip: '•', refuse: '⊘', fail: '✗' };
function glyph(v) { return GLYPH[v] || '?'; }

function summarize(items) {
  const s = { ok: 0, warn: 0, skip: 0, refuse: 0, fail: 0 };
  for (const it of items) if (it.verdict in s) s[it.verdict] += 1;
  return s;
}

// 0 all ok (skips are not failures), 1 partial. The other two codes exit
// through usageError() (2), environmentError() and the entry guard (3).
function exitCodeFor(items) {
  const s = summarize(items);
  return s.warn || s.refuse || s.fail ? 1 : 0;
}

// -- effect: what this run was allowed to do to the world. An applied run may
// still change nothing (every item refused); the items' `changed` says what did.

function effectFor(command, go) {
  if (!MUTATING_COMMANDS.has(command)) return 'read-only';
  return go ? 'applied' : 'dry-run';
}

// -- next: the advice on the next step

// Who takes each action, derived and never chosen: run, wait and done are the
// agent's; ask and stop hand the run to a person.
const NEXT_WHO = { done: 'agent', run: 'agent', wait: 'agent', ask: 'human', stop: 'human' };
const NEXT_ACTIONS = Object.keys(NEXT_WHO);
const NEXT_KEYS = ['action', 'who', 'argv', 'afterSeconds', 'why', 'cwd'];
// Rule 4: the advice never contradicts the exit code, which stays authoritative.
// Exit 0 allows ask: a clean run can still end at a person's decision.
const ACTIONS_FOR_EXIT = { 0: ['done', 'run', 'wait', 'ask'], 1: NEXT_ACTIONS, 2: ['stop'], 3: ['stop'] };
// Rule 2: a flag that confirms or overrides a gate never appears in next.argv.
// Long flags match case-insensitively: the built-in classes by prefix (so
// --yes-really and --forced), --allow and the tool's EXTRA_OVERRIDE_FLAGS
// exactly, with or without =value. An EXTRA_OVERRIDE_FLAGS entry may also be a
// bare word, which blocks that verb. --no-yes and --iamdan are not listed:
// parseArgs rejects them as unknown options, so no run could carry them.
const OVERRIDE_FLAGS = ['--allow'];
const OVERRIDE_PREFIXES = ['--yes', '--force', '--assume-yes', '--allow-', '--i-am-'];

function isOverrideFlag(token) {
  const t = String(token);
  const lower = t.toLowerCase();
  const isFlag = (f) => lower === f || lower.startsWith(`${f}=`);
  if (OVERRIDE_FLAGS.some(isFlag) || OVERRIDE_PREFIXES.some((p) => lower.startsWith(p))) return true;
  if (/^-[A-Za-z]*[yY][A-Za-z]*$/.test(t)) return true; // -y or -Y (the short --yes), alone or grouped
  return EXTRA_OVERRIDE_FLAGS.some((f) => (/^-[A-Za-z]$/.test(f)
    ? new RegExp(`^-[A-Za-z]*${f[1]}[A-Za-z]*$`).test(t) // a declared short flag, alone or grouped
    : isFlag(String(f).toLowerCase())));
}

// A --go alias the tool declares in GO_ALIASES, matched as a declared override
// flag is: a long one in any case, with or without =value; a short one alone or
// grouped. Aliases are input only: advice spells --go, which the checks read.
function isGoAlias(token) {
  const t = String(token);
  const low = t.toLowerCase();
  return GO_ALIASES.some((f) => (/^-[A-Za-z]$/.test(f)
    ? new RegExp(`^-[A-Za-z]*${f[1]}[A-Za-z]*$`).test(t)
    : low === f.toLowerCase() || low.startsWith(`${f.toLowerCase()}=`)));
}

// A next object with the fixed field set. `who` follows from the action and
// `cwd` is START_CWD, so neither is an option. `why` is escaped (a filename in
// it cannot break the line) and clipped, here rather than refused by the
// guard, which runs after the work is done.
function nextStep(action, why, options = {}) {
  const { argv = null, afterSeconds = null, ...rest } = options;
  if (Object.keys(rest).length) {
    throw new Error(`nextStep() takes argv and afterSeconds only, not ${Object.keys(rest).join(', ')}: who and cwd are derived`);
  }
  const line = typeof why === 'string' ? clipText(printable(why), 200) : why;
  return { action, who: NEXT_WHO[action] ?? null, argv, afterSeconds, why: line, cwd: START_CWD };
}

// The head of every re-run argv: this node, then this script as invoked, made
// absolute but not realpath'd (an npm-linked bin stays its bin path). Running
// the script through node needs no executable bit and no PATH lookup.
function selfArgv() {
  return [process.execPath, __entry === SCRIPT_PATH ? runtimePath.resolve(process.argv[1]) : SCRIPT_PATH];
}

// This tool's own command line again, as an argv array, with flags inserted
// before any `--` (after it they would be positionals).
function rerunArgv(argv, ...extra) {
  const end = argv.indexOf('--');
  return end < 0 ? [...selfArgv(), ...argv, ...extra] : [...selfArgv(), ...argv.slice(0, end), ...extra, ...argv.slice(end)];
}

function count(n, noun) {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

// At most `max` characters of text, then … if any were cut.
function clipText(text, max) {
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : text;
}

// Names for `why` (which nextStep() escapes): each clipped to 80 characters,
// at most `max` of them within about 120, then a count of the rest, so the
// count survives the clip on the whole.
function listNames(items, max = 3) {
  const names = [];
  let length = 0;
  for (const it of items) {
    const name = clipText(String(it.name), 80);
    if (names.length === max || (names.length && length + name.length > 120)) break;
    names.push(name);
    length += name.length + 2;
  }
  const rest = items.length - names.length;
  return rest ? `${names.join(', ')} and ${rest} more` : names.join(', ');
}

// The generic policy (rule 3). A tool's nextAction() starts here and adds what
// only it knows. Pure: reads the command, the items, the effect and the argv.
function defaultNextAction({ command, items, effect, argv }) {
  const s = summarize(items);
  const findings = s.warn + s.refuse + s.fail;
  if (s.fail) {
    return nextStep('stop', `failed: ${listNames(items.filter((it) => it.verdict === 'fail'))}`);
  }
  if (effect === 'read-only') {
    return nextStep('done', findings ? `read-only: report the ${count(findings, 'finding')}` : 'read-only: nothing to apply');
  }
  if (effect === 'dry-run') {
    if (argv.some(isOverrideFlag)) {
      return nextStep('ask', 'the command carried an override flag, which next never repeats; a person decides');
    }
    if (s.warn || s.refuse) {
      return nextStep('ask', `dry run: review the ${count(s.warn + s.refuse, 'finding')} before --go`, { argv: rerunArgv(argv, '--go') });
    }
    if (!s.ok) return nextStep('done', 'dry run: nothing would change');
    // A clean dry run goes on to --go unattended only for a command the tool
    // has pre-approved in AUTO_RUN_COMMANDS; for any other it is a person's call.
    const action = AUTO_RUN_COMMANDS.has(command) ? 'run' : 'ask';
    return nextStep(action, `dry run clean: ${count(s.ok, 'item')} would change`, { argv: rerunArgv(argv, '--go') });
  }
  const changed = items.filter((it) => it.changed).length;
  return nextStep('done', findings
    ? `applied: ${changed} changed; report the ${count(findings, 'finding')}`
    : `applied: ${changed} changed`);
}

// Rules 2 and 4 (and the fixed shape), enforced on every `next` before it is
// rendered. A violation throws, and the run exits 3: a tool cannot ship advice
// that walks an agent past a gate, and its tests meet the violation first.
// `current` is the run the advice follows: its effect, and the argv it handed
// nextAction(). report() passes it, so a run goes to --go only on what that
// run just previewed; without it, no run may carry --go.
function assertSafeNext(next, exit, current = {}) {
  const unsafe = (why) => { throw new Error(`unsafe next: ${why}`); };
  if (next === null) return;
  if (!next || typeof next !== 'object' || Array.isArray(next)) unsafe('nextAction() must return a next object or null');
  const keys = Object.keys(next);
  if (keys.length !== NEXT_KEYS.length || !NEXT_KEYS.every((k) => keys.includes(k))) {
    unsafe(`the fields are exactly ${NEXT_KEYS.join(', ')}`);
  }
  const { action, who, argv, afterSeconds, why, cwd } = next;
  if (!NEXT_ACTIONS.includes(action)) unsafe(`unknown action ${printable(JSON.stringify(action))}`);
  if (who !== NEXT_WHO[action]) unsafe(`who is ${NEXT_WHO[action]} for ${action}, never chosen`);
  if (argv !== null && !(Array.isArray(argv) && argv.length && argv.every((a) => typeof a === 'string'))) {
    unsafe('argv is a non-empty array of strings, or null');
  }
  if ((action === 'run' || action === 'wait') && argv === null) unsafe(`${action} needs an argv`);
  if ((action === 'done' || action === 'stop') && argv !== null) unsafe(`${action} carries no argv`);
  // run, wait and any ask argv re-enter this tool and its own gates; a handoff
  // to another tool is done, with the next step in the runbook.
  const head = selfArgv();
  if (argv !== null && (argv[0] !== head[0] || argv[1] !== head[1])) {
    unsafe(`${action} re-invokes this tool: argv starts with ${printable(head.join(' '))}`);
  }
  const flag = (argv || []).find(isOverrideFlag);
  if (flag !== undefined) unsafe(`argv carries the override flag ${printable(flag)}; a step that needs one is ask`);
  const alias = (argv || []).find(isGoAlias);
  if (alias !== undefined) unsafe(`argv carries ${printable(alias)}, a --go alias in GO_ALIASES; advice spells --go`);
  if (action === 'run' && argv.slice(2).some((a) => a === '--go' || a.startsWith('--go='))) {
    // Advice goes straight to --go only on what this run just previewed: the
    // dry run's own argv with --go added, as rerunArgv(argv, '--go') builds it.
    // A step into another command, or after a run that was no dry run, is a
    // read-only or dry-run step, with no --go.
    if (current.effect !== 'dry-run') {
      unsafe(`run carries --go only straight after a dry run of the same command; this run was ${printable(current.effect ?? 'not given')}`);
    }
    const expected = Array.isArray(current.argv) ? rerunArgv(current.argv, '--go') : [];
    if (argv.length !== expected.length || argv.some((a, i) => a !== expected[i])) {
      unsafe("run carries --go only on the command just previewed: that dry run's argv with --go added, as rerunArgv(argv, '--go') builds it; a step into another command carries no --go");
    }
  }
  if (action === 'wait') {
    // wait re-polls, so it never mutates: no --go, and no mutating command,
    // matched as the same words in a row (command names may be phrases).
    const rest = argv.slice(2);
    if (rest.some((a) => a === '--go' || a.startsWith('--go='))) unsafe('wait never carries --go');
    const has = (words) => rest.some((_, i) => words.every((w, j) => rest[i + j] === w));
    const mutating = [...MUTATING_COMMANDS].find((c) => has(String(c).split(' ')));
    if (mutating !== undefined) unsafe(`wait never runs the mutating command ${printable(mutating)}`);
  }
  if (action === 'wait' ? !(Number.isInteger(afterSeconds) && afterSeconds > 0) : afterSeconds !== null) {
    unsafe('afterSeconds is a positive integer for wait, and null otherwise');
  }
  if (typeof why !== 'string' || !why.trim() || CONTROL_CHARS.test(why)) {
    unsafe('why is one non-empty line, with no control characters');
  }
  if (cwd !== START_CWD) unsafe('cwd is the working directory the run started in');
  if (!(ACTIONS_FOR_EXIT[exit] || []).includes(action)) unsafe(`action ${action} contradicts exit ${exit}`);
}

// Characters that could break, rewrite, reorder or hide part of a line of text
// output: C0 controls but TAB, DEL, C1 controls, the Unicode line and paragraph
// separators, and the bidi embedding, override and isolate controls. Item text
// is data, and styling is the renderer's: a tool puts no ANSI colour in it.
const CONTROL_CHARS = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

function escapeControl(c) {
  const code = c.charCodeAt(0);
  return { '\n': '\\n', '\r': '\\r' }[c]
    ?? (code < 0x80 ? `\\x${code.toString(16).padStart(2, '0')}` : `\\u${code.toString(16).padStart(4, '0')}`);
}

// A control character inside $'...': one past ASCII as its UTF-8 bytes (\xHH
// each), not \uXXXX, which bash 3.2 (macOS's /bin/sh and /bin/bash) does not
// decode; bash 4+ and zsh read \xHH too.
function escapeShell(c) {
  return c.charCodeAt(0) < 0x80 ? escapeControl(c)
    : [...Buffer.from(c, 'utf8')].map((b) => `\\x${b.toString(16)}`).join('');
}

// Text for a text-mode line: control characters shown as escapes, so an item
// is always one line and nothing in it can pose as another line. TAB passes.
function printable(text) {
  return String(text).replace(new RegExp(CONTROL_CHARS, 'g'), escapeControl);
}

// -- bold: the default human mode and --help only

// Bold is SGR 1 on, 22 off, written only where it will be read as bold: to a
// terminal, with no NO_COLOR, so a pipe or a file never gets an escape byte.
// NO_COLOR (https://no-color.org): present and not empty, no colour.
// FORCE_COLOR (https://force-color.org): present and not empty, colour even
// when piped, and it outranks NO_COLOR, as Node reads it (nodejs.org/api/cli.html,
// "Environment variables"). Node also takes '0' as off and any value but
// 1, 2, 3, true or empty as off; this takes '0' and 'false' as off and every
// other non-empty value as on, as force-color.org does, and an empty one as unset.
function boldEnabled(env = process.env, isTTY = process.stdout.isTTY) {
  const force = env.FORCE_COLOR;
  if (force) return force !== '0' && force !== 'false';
  return !env.NO_COLOR && !!isTTY;
}

function boldWith(on) {
  return (text) => (on ? `\x1b[1m${text}\x1b[22m` : text);
}

// A label: one to three lowercase words (letters, digits after the first, dots
// and hyphens) and a colon that ends the line or is followed by a space. It
// opens the text, or follows three or more spaces (`file mode: 600   directory
// mode: 700`), so a URL (`https://`), a time (`12:30`), a Windows path (`C:\`) or
// a sentence with a colon in it is never bolded. Run it on text already
// escaped by printable(): the escaped text holds no ESC, so nothing in an item
// can open or close the bold.
const LABEL_WORD = '[a-z][a-z0-9.-]*';
const LABEL = new RegExp(`(?:^|(?<= {3}))(${LABEL_WORD}(?: ${LABEL_WORD}){0,2}):(?= |$)`, 'g');

function boldLabels(text, bold) {
  return text.replace(LABEL, (_, label) => bold(`${label}:`));
}

// An item's optional `mark`: a short decoration (one emoji) the tool sets and
// only the human renderer prints, first on the summary line. At most MARK_MAX
// characters (code points); dropped whole when it is not a string, is blank,
// or holds a control character (TAB included), so it never reaches a line.
const MARK_MAX = 8;
function markOf(item) {
  const mark = typeof item.mark === 'string' ? item.mark.trim() : '';
  if (!mark || CONTROL_CHARS.test(mark) || mark.includes('\t')) return '';
  return printable(Array.from(mark).slice(0, MARK_MAX).join(''));
}

// POSIX single-quoting, only where a token needs it; a token holding a control
// character is ANSI-C quoted ($'...') instead, so the line stays one line.
function shellQuote(token) {
  if (CONTROL_CHARS.test(token)) {
    return `$'${token.replace(/[\\']/g, (c) => `\\${c}`).replace(new RegExp(CONTROL_CHARS, 'g'), escapeShell)}'`;
  }
  return /^[A-Za-z0-9_\/.,:@%+-][A-Za-z0-9_\/.,:=@%+-]*$/.test(token) ? token : `'${token.split("'").join("'\\''")}'`;
}

// The text form of `next`, the last line of every text mode, and always exactly
// one line. A command is printed only where its reader may take it: run and
// wait always, led by `cd <cwd> &&` so the line runs as pasted from any
// directory; ask only for a person, in the default human mode, which says
// "your call" (--brief and --quiet print a bare ask, so an agent is never
// handed a command at a halt); done and stop never. argv is quoted for
// reading; --json carries the exact array, with cwd beside it.
function nextLine(next, mode) {
  const command = next.argv ? ` ${next.argv.map(shellQuote).join(' ')}` : '';
  const why = `  (${printable(next.why)})`;
  const here = `cd ${shellQuote(next.cwd)} &&`;
  if (next.action === 'run') return `next: run ${here}${command}${why}`;
  if (next.action === 'wait') return `next: wait ${next.afterSeconds}s ${here}${command}${why}`;
  if (next.action === 'ask' && mode === 'human') return `next: your call${command && `:${command}`}${why}`;
  return `next: ${next.action}${why}`;
}

// -- rendering (one item shape -> every mode)

const REASON_CUT = 160; // --brief cuts a reason after this many of its own characters (before escaping)

function summaryLine(s, effect) {
  const base = `summary: ok=${s.ok} warn=${s.warn} skip=${s.skip} refuse=${s.refuse} fail=${s.fail}`;
  return effect === 'dry-run' ? `${base}  (dry run: pass --go to apply)` : base;
}

// A reason for --brief: the whole of it, or its first REASON_CUT characters
// and a count of the rest, which --json carries in full. Characters are the
// reason's own code points, counted before escaping: a surrogate pair is never
// split, the cut never falls inside an escape (a control character is cut
// whole, then shown as its escape), and N is the code points --json holds past
// the cut. The cut applies only where it shortens the reason (a reason a few
// characters over the limit is shorter whole than with the note), so --brief
// is never longer than the human output.
function briefReason(reason) {
  const shown = printable(reason);
  const chars = Array.from(String(reason));
  if (chars.length <= REASON_CUT) return shown;
  const cut = `${printable(chars.slice(0, REASON_CUT).join(''))}… (+${chars.length - REASON_CUT} chars; --json for all)`;
  return Buffer.byteLength(cut) < Buffer.byteLength(shown) ? cut : shown;
}

// One line per item: the verdict word, the summary, then the name, with no
// padding and no glyph. The parenthesised reason appears only for a non-ok
// verdict.
function briefLine(item) {
  const showReason = item.verdict !== 'ok' && item.reason;
  return `${item.verdict} ${printable(item.summary)}  ${printable(item.name)}`
    + (showReason ? `  (${briefReason(item.reason)})` : '');
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

// The exit code of the report once written: a late error keeps it.
let reportedExit = null;

// The only writer of stdout, and the end of the run. Renders one run in the
// chosen mode from the one item list; when the tool runs as a command, the
// process then exits with exactly the code the report carries, once stdout has
// flushed (a bare process.exit() cuts a large report off mid-pipe; a pipe
// takes 64 KiB at a time on macOS), so an open handle cannot hold the run
// open. Returns the exit code. `next` passes assertSafeNext() before a byte is
// written; `state` (a status snapshot) is optional and appears in --json only.
// `argv` is the argv the tool handed nextAction(), normalised as it normalised
// it; left out, it is this process's own.
function report({ command, effect, items, next, state = null, mode, argv = process.argv.slice(2) }) {
  const summary = summarize(items);
  const exit = exitCodeFor(items);
  assertSafeNext(next, exit, { effect, argv });

  const emit = (text) => {
    reportedExit = exit;
    process.stdout.write(text, () => { if (__isMain) process.exit(exit); });
    return exit;
  };

  if (mode === 'json') {
    const out = { tool: TOOL_NAME, version: readVersion(), contract: CONTRACT, command, effect, exit };
    if (state !== null) out.state = state;
    Object.assign(out, { items: items.map(jsonItem), summary, next });
    return emit(`${JSON.stringify(out, null, 2)}\n`);
  }

  const lines = [];
  const bold = boldWith(mode === 'human' && boldEnabled());
  if (mode === 'brief') {
    for (const it of items) lines.push(briefLine(it));
  } else if (mode === 'human') {
    items.forEach((it, i) => {
      if (i) lines.push('');
      const mark = markOf(it);
      lines.push(`${glyph(it.verdict)} ${bold(printable(it.name))}`,
        `    ${mark ? `${mark} ` : ''}${boldLabels(printable(it.summary), bold)}`);
      for (const line of it.lines || []) lines.push(`    ${boldLabels(printable(line), bold)}`);
      if (it.reason) lines.push(`    ${boldLabels(`${it.verdict === 'ok' ? 'note' : it.verdict}: ${printable(it.reason)}`, bold)}`);
    });
    lines.push('');
  }
  lines.push(mode === 'human' ? boldLabels(summaryLine(summary, effect), bold) : summaryLine(summary, effect));
  if (next) lines.push(nextLine(next, mode));
  return emit(`${lines.join('\n')}\n`);
}

// -- modes, errors, help, version

// The output mode from the parsed flags. --json combines with neither --brief
// nor --quiet (a usage error); --brief wins over --quiet.
function outputMode(values) {
  for (const other of ['brief', 'quiet']) {
    if (values.json && values[other]) usageError(`--${other} and --json cannot be combined`);
  }
  return values.json ? 'json' : values.brief ? 'brief' : values.quiet ? 'quiet' : 'human';
}

// Diagnostics go to stderr; stdout stays empty on both. These two may exit at
// once: they run before report(), so there is no stdout left to flush.
function usageError(message) {
  console.error(`error: ${message}`);
  console.error(`run \`${TOOL_NAME} --help\` for usage`);
  process.exit(2);
}

function environmentError(message) {
  console.error(`error: ${message}`);
  process.exit(3);
}

// Read the leading comment block of THIS file as help text (contact-sheet-cli
// pattern): skip the shebang, take the contiguous `//` lines, strip the `// `.
// The text is then set out for reading. A heading is a line that is a
// capitalised phrase ending in a colon (`Usage:`, `Output modes (all rendered
// from one list):`) and is bold. In the `Commands:` section an entry is two
// spaces, the command name, two or more spaces and its text; the name is bold,
// and a blank line follows each entry's block (the lines up to the next entry or
// the end of the section, which is the next heading or a line back at the left
// margin). The blank lines are always added, the bold only where boldEnabled()
// allows it. A header shaped otherwise prints as written.
const HELP_HEADING = /^[A-Z][A-Za-z ]*(?: \([^()]*\))?:$/;
const HELP_COMMAND = /^ {2}([a-z][a-z0-9._:-]*(?: [a-z][a-z0-9._:-]*){0,2})( {2,}\S.*)$/;

function helpText() {
  const lines = runtimeFs.readFileSync(SCRIPT_PATH, 'utf8').split('\n');
  const raw = [];
  for (const l of lines.slice(1)) {
    if (!l.startsWith('//')) break;
    raw.push(l.slice(3));
  }
  const bold = boldWith(boldEnabled());
  const out = [];
  let inCommands = false;
  let afterHeading = false;
  for (const l of raw) {
    const heading = HELP_HEADING.test(l);
    if (inCommands && (heading || (l !== '' && !l.startsWith(' '))) && out.at(-1) !== '') out.push('');
    if (heading) {
      inCommands = l === 'Commands:';
      afterHeading = true;
      out.push(bold(l));
      continue;
    }
    if (l !== '' && !l.startsWith(' ')) inCommands = false;
    const entry = inCommands ? HELP_COMMAND.exec(l) : null;
    if (entry) {
      if (!afterHeading && out.at(-1) !== '') out.push('');
      out.push(`  ${bold(entry[1])}${entry[2]}`);
    } else {
      out.push(l);
    }
    afterHeading = false;
  }
  return out.join('\n');
}

function readVersion() {
  let dir = runtimePath.dirname(SCRIPT_PATH);
  for (let i = 0; i < 20; i += 1) {
    const p = runtimePath.join(dir, 'package.json');
    if (runtimeFs.existsSync(p)) {
      try { return JSON.parse(runtimeFs.readFileSync(p, 'utf8')).version || '0.0.0'; }
      catch { return '0.0.0'; }
    }
    const parent = runtimePath.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '0.0.0';
}

// Exit with `code` once stdout has flushed: process.exit() alone drops what a
// pipe has not yet taken, and waiting for the event loop to empty lets any
// open handle hold the run open.
function exitAfterFlush(code) {
  process.stdout.write('', () => process.exit(code));
}

// The hooks a tool declares above this block, checked as the module loads, so
// a missing or misshapen one fails by name (exit 3) instead of mid-run.
const HOOK_ERROR = (() => {
  const hooks = [
    ['MUTATING_COMMANDS', 'a Set of command names', () => MUTATING_COMMANDS instanceof Set],
    ['AUTO_RUN_COMMANDS', 'a Set of command names (empty for none)', () => AUTO_RUN_COMMANDS instanceof Set],
    ['EXTRA_OVERRIDE_FLAGS', 'an array of strings (empty for none)',
      () => Array.isArray(EXTRA_OVERRIDE_FLAGS) && EXTRA_OVERRIDE_FLAGS.every((f) => typeof f === 'string')],
    ['GO_ALIASES', 'an array of strings (empty for none)',
      () => Array.isArray(GO_ALIASES) && GO_ALIASES.every((f) => typeof f === 'string')],
    ['nextAction', 'a function', () => typeof nextAction === 'function'],
    ['main', 'a function', () => typeof main === 'function'],
  ];
  const wrong = hooks.filter(([, , ok]) => { try { return !ok(); } catch { return true; } });
  return wrong.length
    ? `contract ${CONTRACT}: declare ${wrong.map(([name, shape]) => `${name} as ${shape}`).join('; ')}, above the runtime block`
    : null;
})();

// Entry-point guard, the last statement of the file. Resolve symlinks first: an
// npm-linked bin is a symlink, so process.argv[1] is the link path while
// import.meta.url is the real path, and the naive guard silently skips main()
// (exit 0, no output). realpath both sides to compare. An exception escaping
// main(), or thrown from a timer, a floating promise or a stream with no
// 'error' handler before the report is written, exits 3: the run could not
// complete, which is not a partial result (1). One thrown after the report is
// still printed, but the run exits with the code the report gave, which nothing
// may contradict. A main() that returns without a report exits once stdout has
// flushed. An error while the module loads (a syntax error, a top-level use of
// a fence name above the fence) happens before this runs, and Node exits 1.
const __entry = process.argv[1]
  ? (() => { try { return runtimeFs.realpathSync(process.argv[1]); } catch { return process.argv[1]; } })()
  : null;
const __isMain = !!__entry && import.meta.url === runtimeUrl.pathToFileURL(__entry).href;
if (__isMain) {
  const fatal = (e) => {
    console.error(`error: ${e?.message ?? e}`);
    if (reportedExit === null) process.exit(3);
    exitAfterFlush(reportedExit);
  };
  process.on('uncaughtException', fatal);
  process.on('unhandledRejection', fatal);
  if (HOOK_ERROR) fatal(new Error(HOOK_ERROR));
  else Promise.resolve().then(main).then(() => { if (reportedExit === null) exitAfterFlush(process.exitCode ?? 0); }, fatal);
} else if (HOOK_ERROR) {
  throw new Error(HOOK_ERROR);
}
// ---- end mjs-tool runtime v3 ----
