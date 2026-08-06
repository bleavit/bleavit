#!/usr/bin/env node
/**
 * D-21 / INV-FE-6: the handoff packages contain no network primitive at all.
 *
 * 10 §13 makes the transport the user agent and the operating system — files, the
 * clipboard, the share sheet — and states plainly that **"the client makes no network
 * request on any handoff path"**. `app-code` rule 6 names the primitives: `fetch`,
 * `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon` and dynamic URL `import()`.
 *
 * ## Why a source scan, when dependency-cruiser already has rules
 *
 * Those rules match the **module graph**, and every primitive above is a *global*. None is
 * imported, so none was reachable by a graph rule, and the documented control covered
 * exactly the case nobody would use: a handoff package could have called `fetch()`
 * directly and every gate in the repository would have stayed green.
 *
 * The gates are complements. `handoff-imports-nothing-external` says nothing may come in
 * through an import; this says nothing may be reached through the platform.
 *
 * ## What it catches, and what it does not
 *
 * Matched over the **whole file**, not line by line, so `fetch\n(url)` and `fetch?.(url)`
 * cannot slip through a line-anchored pattern. The network globals are matched as bare
 * identifiers rather than as calls, because `const f = globalThis.fetch` is an alias and
 * the call site can be anywhere — in a package with no network path at all, naming the
 * identifier is itself the violation. Computed lookups (`globalThis['fet' + 'ch']`) are
 * caught by banning computed indexing of the globals, and `eval`/`Function` by banning
 * both outright.
 *
 * What a source scan cannot see, stated rather than implied: a primitive reached through a
 * *dependency's* internals. That is the other gate's job, and it is why "handoff packages
 * import nothing external at all" is the rule rather than a denylist of network libraries.
 *
 * ## The witness
 *
 * A scanner that finds nothing reports success, and a scanner that *can* find nothing
 * reports success forever. `--witness` checks two separate things, because the first
 * version only checked one and the gap is the interesting half:
 *
 *  1. every pattern still fires, against a fixture that uses each primitive; and
 *  2. every declared source directory exists and contains files.
 *
 * Without (2) a typo'd path — or a new handoff package nobody added to the list — leaves
 * the scan green while covering less than it says. The directory list is shared with
 * dependency-cruiser (`tools/handoff-packages.ts`) so the two gates cannot disagree
 * about what a handoff path is.
 */

import ts from 'typescript';

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The same single list dependency-cruiser and the emitted-import scanner read, so three
// gates cannot disagree about what counts as a handoff path.
import { HANDOFF_SOURCE_DIRS } from './handoff-packages.ts';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const WITNESS = 'tools/fixtures/handoff-network-witness.ts';

/**
 * Each primitive, in every form a handoff package could reach it.
 *
 * The network globals are bare identifiers on purpose: requiring a `(` matched
 * `fetch(url)` and missed `const f = globalThis.fetch`, which is the same capability one
 * assignment away. Nothing on a handoff path has a reason to *name* any of these.
 */
const PRIMITIVES = [
  { name: 'fetch', pattern: /\bfetch\b/ },
  { name: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/ },
  { name: 'WebSocket', pattern: /\bWebSocket\b/ },
  { name: 'EventSource', pattern: /\bEventSource\b/ },
  { name: 'sendBeacon', pattern: /\bsendBeacon\b/ },
  { name: 'importScripts', pattern: /\bimportScripts\b/ },
  { name: 'serviceWorker', pattern: /\bserviceWorker\b/ },
  // A worker is handed a URL and fetches it. Both spellings.
  { name: 'Worker', pattern: /\b(?:Shared)?Worker\s*\(/ },
  // Resource elements are requests wearing markup: an <img>, <link> or <script> with a
  // remote src is a GET the CSP would have to allow.
  { name: 'new Image()', pattern: /\bnew\s+Image\s*\(/ },
  {
    name: 'createElement of a fetching element',
    pattern: /\bcreateElement\s*\(\s*['"`](?:img|link|script|iframe|audio|video|source|track|object|embed)\b/i,
  },
  // The dynamic form only. A static `import x from '…'` is a build-time edge the module
  // graph already governs; `import(…)` at runtime can take a URL.
  { name: 'dynamic import()', pattern: /(^|[^.\w])import\s*\(/ },
  // Computed access to a global object is how a banned identifier is spelled without
  // writing it: `globalThis['fet' + 'ch']` names no primitive any pattern above can see.
  // `globalThis` is banned outright — nothing on a handoff path has a reason to reach the
  // global object at all — while `window`, `self` and `navigator` are banned only under a
  // computed index, because `navigator.clipboard` is a transport 10 §13.4 explicitly
  // allows and the other two read naturally in prose ("the pinned window").
  { name: 'globalThis', pattern: /\bglobalThis\b/ },
  { name: 'computed global lookup', pattern: /\b(?:window|self|navigator)\s*\[/ },
  // String-synthesised code defeats every pattern above, so the constructors are banned
  // rather than the strings they would build.
  { name: 'eval', pattern: /\beval\s*\(/ },
  { name: 'Function constructor', pattern: /\bnew\s+Function\s*\(/ },
];

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Blank every comment, preserving offsets so reported line numbers stay true.
 *
 * The patterns above run over raw text, so a module *documenting why it makes no network
 * request* trips its own gate on the word `fetch` — which is not a near-miss to reword
 * around. It is the tokenizer hole this repository already paid for once in
 * `check-chain-literals`, where every defect adversarial review found was a scanner
 * confusing code with text, and the fix was the same one: use the TypeScript scanner that
 * is already a pinned dependency, rather than a regex that approximates one.
 *
 * **Comments only — string bodies stay in scope, deliberately.** A comment is provably
 * inert; a string is not, because `window['fet' + 'ch']` spells a banned identifier without
 * writing it. That path is separately banned (`globalThis` outright, `window`/`self`/
 * `navigator` under a computed index), and leaving strings scanned keeps a second net under
 * it. The narrowing is therefore exactly as wide as *cannot possibly execute*, which is the
 * only safe amount to narrow a control like this one.
 */
function withoutComments(source: string): string {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, /* skipTrivia */ false, ts.LanguageVariant.Standard, source);
  const out = source.split('');
  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) {
      const start = scanner.getTokenStart();
      const end = scanner.getTokenEnd();
      for (let i = start; i < end; i += 1) {
        // Newlines survive, so a match's line number is still the line it is on.
        if (out[i] !== '\n') out[i] = ' ';
      }
    }
    token = scanner.scan();
  }
  return out.join('');
}

/** Whole-file matching, with the line recovered from the match offset for the report. */
/** One network primitive found in a handoff package, with the line for the report. */
interface NetworkFinding {
  readonly file: string;
  readonly line: number;
  readonly name: string;
  readonly text: string;
}

function findings(files: readonly string[]): NetworkFinding[] {
  const found: NetworkFinding[] = [];
  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    const source = withoutComments(raw);
    for (const { name, pattern } of PRIMITIVES) {
      const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
      let match: RegExpExecArray | null;
      while ((match = global.exec(source)) !== null) {
        const line = source.slice(0, match.index).split('\n').length;
        const text = raw.split('\n')[line - 1] ?? '';
        found.push({ file: relative(APP_ROOT, file), line, name, text: text.trim() });
        if (match.index === global.lastIndex) global.lastIndex += 1;
      }
    }
  }
  return found;
}

/** Per-directory file counts. A zero anywhere means the scan covers less than it claims. */
function coverage(): { dir: string; files: string[] }[] {
  return HANDOFF_SOURCE_DIRS.map((dir) => ({ dir, files: walk(join(APP_ROOT, dir)) }));
}

const witnessMode = process.argv.includes('--witness');

if (witnessMode) {
  let failed = false;

  const hits = findings([join(APP_ROOT, WITNESS)]);
  const seen = new Set(hits.map((h) => h.name));
  const missed = PRIMITIVES.filter((p) => !seen.has(p.name)).map((p) => p.name);
  if (missed.length > 0) {
    console.error('WITNESS DID NOT FIRE for: ' + missed.join(', '));
    console.error('The scanner can no longer detect these, so a clean run over the handoff');
    console.error('packages would prove nothing about them.');
    failed = true;
  }

  // The narrowing's two controls. `withoutComments` stopped the scan matching inside
  // comments; these prove it narrowed by exactly that and no more. The string case is the
  // load-bearing one: extending the blanking to string bodies would look like the same
  // tidy-up, would void the gate, and every other assertion here would stay green — because
  // they all name their primitives in code.
  const witnessSource = readFileSync(join(APP_ROOT, WITNESS), 'utf8');
  const commentOnly = witnessSource.slice(witnessSource.indexOf('// A comment naming fetch'));
  const commentLines = commentOnly.split('\n').slice(0, 2).join('\n');
  const commentStart = witnessSource.slice(0, witnessSource.indexOf('// A comment naming fetch')).split('\n').length;
  const commentEnd = commentStart + commentLines.split('\n').length - 1;
  const inComments = hits.filter((h) => h.line >= commentStart && h.line <= commentEnd);
  if (inComments.length > 0) {
    console.error(
      'WITNESS: the scanner reported a primitive that appears only in a comment: ' +
        inComments.map((h) => `${h.name} (line ${h.line})`).join(', '),
    );
    console.error('A comment cannot execute; matching one trains authors to reword rather than think.');
    failed = true;
  }

  const stringLine = witnessSource.split('\n').findIndex((l) => l.startsWith('export const NOT_INERT')) + 1;
  if (!hits.some((h) => h.line === stringLine && h.name === 'fetch')) {
    console.error('WITNESS: a primitive named inside a STRING was not reported.');
    console.error("The comment narrowing has widened to string bodies. `window['fet' + 'ch']`");
    console.error('spells a banned identifier without writing it, and this is the net under it.');
    failed = true;
  }

  // The half the first version of this witness lacked: proving the scan reaches the
  // packages at all. A pattern that fires on a fixture nobody else is compared against is
  // a scanner with perfect aim and nothing in front of it.
  for (const { dir, files } of coverage()) {
    if (files.length === 0) {
      console.error(`DECLARED HANDOFF PATH COVERS NOTHING: ${dir}`);
      console.error('Either the directory moved, or the path in tools/handoff-packages.ts');
      console.error('is wrong. Both leave the scan reporting success over less than it says.');
      failed = true;
    }
  }

  if (failed) process.exit(1);
  console.log(
    `witness fired for all ${PRIMITIVES.length} primitives; ` +
      `${HANDOFF_SOURCE_DIRS.length} declared handoff paths all carry sources`,
  );
  process.exit(0);
}

const scanned = coverage();
const files = scanned.flatMap((entry) => entry.files);
if (files.length === 0) {
  console.error(`no handoff sources found under ${HANDOFF_SOURCE_DIRS.join(', ')}`);
  process.exit(1);
}

const hits = findings(files);
if (hits.length > 0) {
  console.error('D-21 / INV-FE-6: network primitives in a handoff package\n');
  for (const hit of hits) {
    console.error(`  ${hit.file}:${hit.line}  ${hit.name}\n      ${hit.text}`);
  }
  console.error(
    '\n10 §13: "the client makes no network request on any handoff path". The transport is\n' +
      'files, the clipboard and the share sheet — never a request.',
  );
  process.exit(1);
}

console.log(
  `no network primitive in ${files.length} handoff source files across ` +
    `${scanned.length} declared paths`,
);
