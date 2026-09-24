#!/usr/bin/env node
// new-tool - scaffold a new single-file CLI from the mjs-tool-skeleton template.
//
// Copies skeleton/tool.mjs into <dir>/<name>/ as <name>.mjs, plus a matching
// test, package.json, README.md, CLAUDE.md (carrying the agent-usage block),
// and LICENSE - substituting the tool name throughout. Refuses to overwrite an
// existing directory. Dogfoods the skeleton's own convention: it reports in the
// same --brief / --json / --quiet / human modes, with the same exit codes, from
// the same fenced runtime block (contract mjs-tool/2).
//
// It has no dry run and no --go. All it writes is a directory that did not
// exist, and it refuses when the directory does, so every run acts (--json
// reports effect "applied"). That is its one deliberate exception to the
// contract's dry-run gate.
//
// Usage:
//   new-tool <name> [--dir <path>]
//   new-tool <name> --brief
//   new-tool --help | --version
//
// <name> must be a lowercase package name: a letter, then letters, digits, or
// hyphens (e.g. my-widget). --dir is where the <name>/ folder is created
// (default: the current directory).
//
// Output modes: (default) human, --brief (one line per created file), --json,
// --quiet (summary line only). Every text mode ends with one `next:` line.
// --json cannot be combined with --brief or --quiet.
//
// Exit codes:
//   0   scaffolded ok.
//   1   refused (the target directory already exists) or a write failed.
//   2   usage error (missing/invalid name, unknown flag, bad mode combo).
//   3   could not run to completion (the skeleton templates could not be
//       read, or an internal error).

import {
  mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync,
} from 'node:fs';
import {
  dirname, join, resolve, relative,
} from 'node:path';
import { parseArgs } from 'node:util';

const NAME_RE = /^[a-z][a-z0-9-]*$/;

// ---- generated-file templates ----------------------------------------------

function pkgJson(name) {
  return `${JSON.stringify({
    name,
    version: '0.1.0',
    description: `TODO: one-line description of ${name}.`,
    type: 'module',
    bin: { [name]: `${name}.mjs` },
    files: [`${name}.mjs`, 'README.md', 'LICENSE'],
    engines: { node: '>=20' },
    scripts: { test: 'node --test' },
    keywords: [],
    author: 'Danniel T. Gaidula <dan@iceboxind.com>',
    license: 'MIT',
  }, null, 2)}\n`;
}

function readmeMd(name) {
  return `# ${name}

TODO: one-line description of what ${name} does.

## Install

\`\`\`sh
npx ${name} inspect <path>...
# or
npm install -g ${name}
\`\`\`

Requires Node 20+. Zero dependencies — the whole tool is one \`.mjs\` file.

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

MIT © Danniel T. Gaidula
`;
}

function claudeMd(name, agentBlock) {
  return `# ${name} — agent guide

Zero-dependency Node 20+ single-file CLI built from
[mjs-tool-skeleton](https://github.com/dgaidula/mjs-tool-skeleton). One file:
\`${name}.mjs\`. \`README.md\` is the human-facing pitch; this file is the
agent-facing contract.

${agentBlock}

## Filling in the tool

Search \`${name}.mjs\` for \`TODO(tool):\` — those are the eight spots where
this tool’s real work goes: the environment check, which targets need
confirmation, the read-only \`inspect\` report, the \`apply\` mutation, which
commands mutate, which of them may go on to \`--go\` unattended, the tool’s
own override flags, and the next-action policy.
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

**Auto-run.** A clean dry run advises \`ask\` (a person’s call) unless its
command is in \`AUTO_RUN_COMMANDS\`, which is empty until you fill it. Only
then does \`next\` say \`run\` with \`--go\`. List a command there only when
its owner has pre-approved applying it unattended; the tool may read that
list from its own config.

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

// The scaffolder needs nothing beyond the runtime's generic policy.
function nextAction(run) {
  return defaultNextAction(run);
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
        dir: { type: 'string' },
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

  const mode = outputMode(values);

  const name = positionals[0];
  if (!name) usageError('no <name> (the tool to create)');
  if (positionals.length > 1) usageError(`unexpected extra argument \`${positionals[1]}\` (expected one <name>)`);
  if (!NAME_RE.test(name)) {
    usageError(`invalid name \`${name}\` (use a lowercase letter, then letters/digits/hyphens, e.g. my-widget)`);
  }

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

  // Build the substituted file set.
  const toolSrc = toolTpl.split('<tool>').join(name);
  const testSrc = testTpl.split("new URL('./tool.mjs', import.meta.url)").join(`new URL('../${name}.mjs', import.meta.url)`);
  const files = [
    { rel: `${name}.mjs`, content: toolSrc, exec: true },
    { rel: join('test', `${name}.test.mjs`), content: testSrc },
    { rel: 'package.json', content: pkgJson(name) },
    { rel: 'README.md', content: readmeMd(name) },
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

// ---- mjs-tool runtime v2 (do not edit; replace wholesale) ----
// The shared machinery of contract mjs-tool/2, byte-identical in every tool
// built from mjs-tool-skeleton. It carries its own imports (namespaced, so they
// never collide with the tool's); its other top-level names are unprefixed, so
// a tool keeps no copies of them. The tool supplies, outside this block:
// MUTATING_COMMANDS, AUTO_RUN_COMMANDS, EXTRA_OVERRIDE_FLAGS, main(), and a
// nextAction() policy whose result it hands to report(); the block checks
// their shapes as it loads. To move a tool to a later contract, swap this
// whole block.

import * as runtimeFs from 'node:fs';
import * as runtimePath from 'node:path';
import * as runtimeUrl from 'node:url';

const CONTRACT = 'mjs-tool/2';

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
function assertSafeNext(next, exit) {
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
  // run and wait re-enter this tool and its own gates; a handoff to another
  // tool is done, with the next step in the runbook.
  const head = selfArgv();
  if ((action === 'run' || action === 'wait') && (argv[0] !== head[0] || argv[1] !== head[1])) {
    unsafe(`${action} re-invokes this tool: argv starts with ${printable(head.join(' '))}`);
  }
  const flag = (argv || []).find(isOverrideFlag);
  if (flag !== undefined) unsafe(`argv carries the override flag ${printable(flag)}; a step that needs one is ask`);
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

// Text for a text-mode line: control characters shown as escapes, so an item
// is always one line and nothing in it can pose as another line. TAB passes.
function printable(text) {
  return String(text).replace(new RegExp(CONTROL_CHARS, 'g'), escapeControl);
}

// POSIX single-quoting, only where a token needs it; a token holding a control
// character is ANSI-C quoted ($'...') instead, so the line stays one line.
function shellQuote(token) {
  if (CONTROL_CHARS.test(token)) {
    return `$'${token.replace(/[\\']/g, (c) => `\\${c}`).replace(new RegExp(CONTROL_CHARS, 'g'), escapeControl)}'`;
  }
  return /^[A-Za-z0-9_\/.,:@%+-][A-Za-z0-9_\/.,:=@%+-]*$/.test(token) ? token : `'${token.split("'").join("'\\''")}'`;
}

// The text form of `next`, the last line of every text mode, and always exactly
// one line. A command is printed only where its reader may take it: run and
// wait always; ask only for a person, in the default human mode, which says
// "your call" (--brief and --quiet print a bare ask, so an agent is never
// handed a command at a halt); done and stop never. argv is quoted for
// reading; --json carries the exact array.
function nextLine(next, mode) {
  const command = next.argv ? ` ${next.argv.map(shellQuote).join(' ')}` : '';
  const why = `  (${printable(next.why)})`;
  if (next.action === 'run') return `next: run${command}${why}`;
  if (next.action === 'wait') return `next: wait ${next.afterSeconds}s${command}${why}`;
  if (next.action === 'ask' && mode === 'human') return `next: your call${command && `:${command}`}${why}`;
  return `next: ${next.action}${why}`;
}

// -- rendering (one item shape -> every mode)

const VERDICT_WIDTH = 6; // longest verdict word ("refuse")
const SUMMARY_WIDTH = 38; // brief-mode column alignment (fits the longest shipped summary)

function summaryLine(s, effect) {
  const base = `summary: ok=${s.ok} warn=${s.warn} skip=${s.skip} refuse=${s.refuse} fail=${s.fail}`;
  return effect === 'dry-run' ? `${base}  (dry run: pass --go to apply)` : base;
}

// One line per item. The parenthesised reason appears only for a non-ok verdict.
function briefLine(item) {
  const showReason = item.verdict !== 'ok' && item.reason;
  return `${glyph(item.verdict)} ${item.verdict.padEnd(VERDICT_WIDTH)} ${printable(item.summary).padEnd(SUMMARY_WIDTH)} ${printable(item.name)}`
    + (showReason ? `  (${printable(item.reason)})` : '');
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
function report({ command, effect, items, next, state = null, mode }) {
  const summary = summarize(items);
  const exit = exitCodeFor(items);
  assertSafeNext(next, exit);

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
  if (mode === 'brief') {
    for (const it of items) lines.push(briefLine(it));
  } else if (mode === 'human') {
    for (const it of items) {
      lines.push(`${glyph(it.verdict)} ${printable(it.name)}`, `    ${printable(it.summary)}`);
      for (const line of it.lines || []) lines.push(`    ${printable(line)}`);
      if (it.reason) lines.push(`    ${it.verdict === 'ok' ? 'note' : it.verdict}: ${printable(it.reason)}`);
    }
    lines.push('');
  }
  lines.push(summaryLine(summary, effect));
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
function helpText() {
  const lines = runtimeFs.readFileSync(SCRIPT_PATH, 'utf8').split('\n');
  const out = [];
  for (const l of lines.slice(1)) {
    if (!l.startsWith('//')) break;
    out.push(l.slice(3));
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
// ---- end mjs-tool runtime v2 ----
