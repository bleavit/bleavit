#!/usr/bin/env node
/**
 * `verify-release` — 12 §1.3, F13.
 *
 * §1.3's requirement is that **anyone** can reproduce the verdict with no project
 * infrastructure: clone, build in the pinned container, then compare a local tree against
 * what a gateway serves. This is the entry point for that; the deciding lives in
 * `verdict.mjs` and `registry.mjs` so it can be exercised against the outcomes a healthy
 * release never produces.
 *
 * Two subcommands run fully offline and are wired into CI today:
 *
 *   verify-release signers audit        — 12 §2.2's disjointness check over the registry
 *   verify-release diff-scope A B       — 12 §1.5's expedited-lane admissibility
 *
 * `compare` needs a gateway and a keyring, and neither exists yet: the key ceremony is F13's
 * own remaining half and multi-gateway fetch behaviour is prototype gate **FE-P7**. Rather
 * than ship a `compare` that fetches nothing and prints a verdict, it reports what it is
 * waiting for. A verification tool that returns "OK" having verified nothing is the exact
 * failure this repository keeps designing against.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkControllerQuorum, checkDisjointness, parseRegistry } from './registry.mjs';
import { diffScope } from './verdict.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY = resolve(HERE, '../release/sources/signers.json');

function signersAudit(strict) {
  const document = JSON.parse(readFileSync(REGISTRY, 'utf8'));
  // `parseRegistry` refuses an empty registry, and rightly: a disjointness check over no
  // entries compares nothing. Pre-ceremony that is the true state rather than a defect, so
  // it is reported as a phase gate — but only when the file **declares** one, so emptying a
  // populated registry is still an error, and `--strict` (what a release gate runs) still
  // fails either way.
  if (Array.isArray(document.entries) && document.entries.length === 0 && document._phase_gate) {
    console.log(`unseated: ${document._phase_gate}`);
    if (strict) {
      console.error('\n--strict: a release may not ship against a registry that declares nobody');
      return 1;
    }
    return 0;
  }
  const entries = parseRegistry(document);
  const { violations, empty } = checkDisjointness(entries);
  const quorum = checkControllerQuorum(entries);

  for (const violation of violations) {
    console.error(`DISJOINTNESS VIOLATION: ${violation.detail}\n  ${violation.reason}`);
  }
  for (const gap of empty) {
    console.log(`unseated: ${gap.pair.a} ∩ ${gap.pair.b} — ${gap.detail}`);
  }
  for (const line of quorum) console.log(`launch blocker: ${line}`);

  if (violations.length > 0) return 1;
  if (strict && (empty.length > 0 || quorum.length > 0)) {
    console.error('\n--strict: a release may not rest on a separation that holds for want of members');
    return 1;
  }
  console.log(
    `signers audit: ${entries.length} declared identit(y|ies), ${violations.length} violation(s), ` +
      `${empty.length} unseated pair(s)`,
  );
  return 0;
}

function diffScopeCommand(incumbentPath, candidatePath) {
  const read = (path) => JSON.parse(readFileSync(path, 'utf8')).perFileHashes;
  const result = diffScope(read(incumbentPath), read(candidatePath));
  console.log(result.detail);
  for (const entry of result.outOfScope) console.error(`  ${entry.change}: ${entry.path}`);
  return result.admissible ? 0 : 1;
}

function main(argv) {
  const [command, ...rest] = argv;
  switch (command) {
    case 'signers':
      if (rest[0] !== 'audit') break;
      return signersAudit(rest.includes('--strict'));
    case 'diff-scope':
      if (rest.length < 2) break;
      return diffScopeCommand(rest[0], rest[1]);
    case 'compare':
      console.error(
        'compare is not available yet, and it will not pretend to be. It needs a published\n' +
          'keyring (12 §2.1 — no ceremony has been held) and multi-gateway fetch behaviour\n' +
          '(prototype gate FE-P7). A verification tool that returns OK having verified nothing\n' +
          'is worse than one that says what it is waiting for.',
      );
      return 2;
    default:
      break;
  }
  console.error('usage: verify-release signers audit [--strict] | diff-scope <incumbent.json> <candidate.json>');
  return 64;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
