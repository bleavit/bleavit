#!/usr/bin/env node
/**
 * D-21 / INV-FE-6: the handoff packages contain no network primitive at all.
 *
 * 10 §13 makes the transport the user agent and the operating system — files, the
 * clipboard, the share sheet — and states plainly that **"the client makes no network
 * request on any handoff path"**. `app-code` rule 6 names the primitives: `fetch`,
 * `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon` and dynamic URL `import()`.
 *
 * ## Why a source scan, when dependency-cruiser already has a rule
 *
 * The `no-network-primitive-in-handoff` rule matches **imports** — `axios`, `undici`, `ws`.
 * Every primitive in the list above is a *global*. None of them is imported, so none of
 * them is reachable by a rule written against the module graph, and the documented control
 * covered exactly the case nobody would use. A handoff package could have called `fetch()`
 * directly and every gate in the repository would have stayed green.
 *
 * The two gates are complements, not redundancy: the module rule catches a library, this
 * catches the platform.
 *
 * ## The witness
 *
 * A scanner that finds nothing reports success, and a scanner that *can* find nothing
 * reports success forever. `--witness` points the same patterns at a fixture that uses
 * every primitive and fails unless each one is flagged, so a pattern that stops matching
 * — a rename, a regex edit, a changed file filter — is a failure rather than a quieter
 * green run.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The D-21 trust domain: every package on a handoff path, plus the feature unit. */
const SCANNED = [
  'packages/contexts/src',
  'packages/handoff-envelope/src',
  'packages/intents/src',
  'packages/receipts/src',
  'packages/llm-handoff/src',
  'src/features/handoff',
];

const WITNESS = 'tools/fixtures/handoff-network-witness.ts';

/**
 * Each primitive, matched in its **usage** form.
 *
 * Deliberately run over the raw source rather than over comment- and string-stripped code.
 * A stripper is one more thing that can be subtly wrong, and its failure mode is a *missed*
 * match — the silent direction. The cost is that prose naming a primitive fails the gate,
 * which in packages that must not contain one is a reasonable thing to have to reword.
 */
const PRIMITIVES = [
  { name: 'fetch', pattern: /\bfetch\s*\(/ },
  { name: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/ },
  { name: 'WebSocket', pattern: /\bWebSocket\b/ },
  { name: 'EventSource', pattern: /\bEventSource\b/ },
  { name: 'sendBeacon', pattern: /\bsendBeacon\s*\(/ },
  { name: 'importScripts', pattern: /\bimportScripts\s*\(/ },
  { name: 'navigator.serviceWorker', pattern: /\bserviceWorker\b/ },
  // The dynamic form only. A static `import x from '…'` is a build-time edge the module
  // graph already governs; `import(…)` at runtime can take a URL.
  { name: 'dynamic import()', pattern: /(^|[^.\w])import\s*\(/ },
];

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // a package with no sources yet is not a violation
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function findings(files) {
  const found = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    source.split('\n').forEach((line, index) => {
      for (const { name, pattern } of PRIMITIVES) {
        if (pattern.test(line)) {
          found.push({ file: relative(APP_ROOT, file), line: index + 1, name, text: line.trim() });
        }
      }
    });
  }
  return found;
}

const witnessMode = process.argv.includes('--witness');

if (witnessMode) {
  const hits = findings([join(APP_ROOT, WITNESS)]);
  const seen = new Set(hits.map((h) => h.name));
  const missed = PRIMITIVES.filter((p) => !seen.has(p.name)).map((p) => p.name);
  if (missed.length > 0) {
    console.error('WITNESS DID NOT FIRE for: ' + missed.join(', '));
    console.error('The scanner can no longer detect these, so a clean run over the handoff');
    console.error('packages would prove nothing about them.');
    process.exit(1);
  }
  console.log(`witness fired for all ${PRIMITIVES.length} primitives: the patterns are live`);
  process.exit(0);
}

const files = SCANNED.flatMap((dir) => walk(join(APP_ROOT, dir)));
if (files.length === 0) {
  console.error(`no handoff sources found under ${SCANNED.join(', ')} — the scan covered nothing`);
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

console.log(`no network primitive in ${files.length} handoff source files`);
