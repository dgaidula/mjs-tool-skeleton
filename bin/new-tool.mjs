#!/usr/bin/env node
// new-tool - scaffold a new single-file CLI from the mjs-tool-skeleton template.
//
// Copies skeleton/tool.mjs into <dir>/<name>/ as <name>.mjs, plus a matching
// test, package.json, README.md, CLAUDE.md (carrying the agent-usage block),
// and LICENSE - substituting the tool name throughout. Refuses to overwrite an
// existing directory. Dogfoods the skeleton's own convention: it reports in the
// same --brief / --json / --quiet / human modes, with the same exit codes.
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
// --quiet (summary line only). --brief and --json are mutually exclusive.
//
// Exit codes:
//   0   scaffolded ok.
//   1   refused (the target directory already exists) or a write failed.
//   2   usage error (missing/invalid name, unknown flag, bad mode combo).
//   3   environment error (the skeleton templates could not be read).

import {
  mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, chmodSync,
} from 'node:fs';
import {
  basename, dirname, join, resolve, relative,
} from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_PATH = (() => {
  try { return realpathSync(fileURLToPath(import.meta.url)); }
  catch { return fileURLToPath(import.meta.url); }
})();
const TOOL_NAME = basename(SCRIPT_PATH).replace(/\.mjs$/, '');
const REPO_ROOT = dirname(dirname(SCRIPT_PATH)); // bin/ -> repo root

const GLYPH = { ok: '✓', warn: '⚠', skip: '•', refuse: '⊘', fail: '✗' };
function glyph(v) { return GLYPH[v] || '?'; }

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
\`{ tool, version, command, items, summary }\` object), and \`--quiet\` (the
summary line only). \`--brief\` and \`--json\` are mutually exclusive.

## Exit codes

| code | meaning |
|---|---|
| \`0\` | all items ok (skips are not failures) |
| \`1\` | partial — at least one item warned, refused, or failed |
| \`2\` | usage error |
| \`3\` | environment error |

## For agents

See [CLAUDE.md](CLAUDE.md) for how an agent session should drive this tool —
reach for \`--brief\`/\`--json\`, treat any non-\`ok\` line as a finding, and
dry-run before \`--go\`.

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

Search \`${name}.mjs\` for \`TODO(tool):\` — those are the four spots where this
tool’s real work goes: the environment check, which targets need confirmation,
the read-only \`inspect\` report, and the \`apply\` mutation. Keep the
\`report()\` / \`verdict()\` / \`glyph()\` shape intact: rendering every mode
from one set of item objects is what guarantees the human, \`--brief\`, and
\`--json\` outputs can never disagree.
`;
}

// Take the "## Driving ..." block out of AGENT-USAGE.md (everything from the
// first "## " heading onward) and substitute the tool name for <tool>.
function agentBlockFor(name, agentUsageSrc) {
  const idx = agentUsageSrc.indexOf('## ');
  const block = idx >= 0 ? agentUsageSrc.slice(idx) : agentUsageSrc;
  return block.split('<tool>').join(name).trimEnd();
}

// ---- reporting (dogfoods the skeleton's modes) ------------------------------

function summarize(items) {
  const s = { ok: 0, warn: 0, skip: 0, refuse: 0, fail: 0 };
  for (const it of items) if (it.verdict in s) s[it.verdict] += 1;
  return s;
}

function summaryLine(s) {
  return `summary: ok=${s.ok} warn=${s.warn} skip=${s.skip} refuse=${s.refuse} fail=${s.fail}`;
}

function briefLine(item) {
  const showReason = item.verdict !== 'ok' && item.reason;
  return `${glyph(item.verdict)} ${item.verdict.padEnd(6)} ${String(item.summary).padEnd(20)} ${item.name}`
    + (showReason ? `  (${item.reason})` : '');
}

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

function report({ items, mode }) {
  const summary = summarize(items);
  if (mode === 'json') {
    process.stdout.write(`${JSON.stringify({
      tool: TOOL_NAME, version: readVersion(), command: 'new-tool', items: items.map(jsonItem), summary,
    }, null, 2)}\n`);
    return;
  }
  if (mode === 'quiet') {
    process.stdout.write(`${summaryLine(summary)}\n`);
    return;
  }
  if (mode === 'brief') {
    for (const it of items) process.stdout.write(`${briefLine(it)}\n`);
    process.stdout.write(`${summaryLine(summary)}\n`);
    return;
  }
  for (const it of items) {
    process.stdout.write(`${glyph(it.verdict)} ${it.name}\n`);
    process.stdout.write(`    ${it.summary}\n`);
    if (it.reason) process.stdout.write(`    ${it.verdict === 'ok' ? 'note' : it.verdict}: ${it.reason}\n`);
  }
  process.stdout.write(`\n${summaryLine(summary)}\n`);
}

function exitCodeFor(items) {
  const s = summarize(items);
  return s.warn || s.refuse || s.fail ? 1 : 0;
}

// ---- help / version ---------------------------------------------------------

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
        dir: { type: 'string' },
        brief: { type: 'boolean' },
        json: { type: 'boolean' },
        quiet: { type: 'boolean' },
      },
    });
  } catch (e) {
    console.error(`error: ${e.message}`);
    console.error(hint);
    process.exit(2);
  }
  const { values, positionals } = parsed;

  if (values.help) { console.log(helpText()); process.exit(0); }
  if (values.version) { console.log(`${TOOL_NAME} ${readVersion()}`); process.exit(0); }

  if (values.brief && values.json) {
    console.error('error: --brief and --json cannot be combined');
    console.error(hint);
    process.exit(2);
  }
  const mode = values.json ? 'json' : values.brief ? 'brief' : values.quiet ? 'quiet' : 'human';

  const name = positionals[0];
  if (!name) {
    console.error('error: no <name> (the tool to create)');
    console.error(hint);
    process.exit(2);
  }
  if (positionals.length > 1) {
    console.error(`error: unexpected extra argument \`${positionals[1]}\` (expected one <name>)`);
    console.error(hint);
    process.exit(2);
  }
  if (!NAME_RE.test(name)) {
    console.error(`error: invalid name \`${name}\` (use a lowercase letter, then letters/digits/hyphens, e.g. my-widget)`);
    console.error(hint);
    process.exit(2);
  }

  // Load the templates that ship with this package.
  const toolTplPath = join(REPO_ROOT, 'skeleton', 'tool.mjs');
  const testTplPath = join(REPO_ROOT, 'skeleton', 'tool.test.mjs');
  const licensePath = join(REPO_ROOT, 'LICENSE');
  const agentUsagePath = join(REPO_ROOT, 'AGENT-USAGE.md');
  let toolTpl; let testTpl; let licenseTpl; let agentUsage;
  try {
    toolTpl = readFileSync(toolTplPath, 'utf8');
    testTpl = readFileSync(testTplPath, 'utf8');
    licenseTpl = readFileSync(licensePath, 'utf8');
    agentUsage = readFileSync(agentUsagePath, 'utf8');
  } catch (e) {
    console.error(`error: cannot read the skeleton templates (${e.message})`);
    process.exit(3);
  }

  const baseDir = values.dir ? resolve(values.dir) : process.cwd();
  const dest = join(baseDir, name);
  const rel = (p) => relative(process.cwd(), p) || '.';

  // Refuse rather than overwrite an existing directory.
  if (existsSync(dest)) {
    const items = [{
      path: dest,
      name: rel(dest),
      verdict: 'refuse',
      summary: 'exists',
      reason: 'target directory already exists; refusing to overwrite',
      changed: false,
      data: null,
    }];
    report({ items, mode });
    process.exit(exitCodeFor(items));
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
    items.push({
      path: dest, name: rel(dest), verdict: 'fail', summary: 'mkdir failed', reason: e.message, changed: false, data: null,
    });
    report({ items, mode });
    process.exit(exitCodeFor(items));
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

  report({ items, mode });
  process.exit(exitCodeFor(items));
}

const __entry = process.argv[1]
  ? (() => { try { return realpathSync(process.argv[1]); } catch { return process.argv[1]; } })()
  : null;
if (__entry && import.meta.url === pathToFileURL(__entry).href) {
  main().catch((e) => {
    console.error(`error: ${e.message}`);
    process.exit(1);
  });
}

export { agentBlockFor, briefLine, summarize, exitCodeFor };
