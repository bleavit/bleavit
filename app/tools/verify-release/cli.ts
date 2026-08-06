#!/usr/bin/env node
/**
 * `verify-release` — 12 §1.3, F13.
 *
 * §1.3's requirement is that **anyone** can reproduce the verdict with no project
 * infrastructure: clone, build in the pinned container, then compare a local tree against
 * what a gateway serves. This is the entry point for that; the deciding lives in
 * `verdict.ts` and `registry.ts` so it can be exercised against the outcomes a healthy
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

import { checkControllerQuorum, checkDisjointness, parseRegistry } from './registry.ts';
import type { FileHashes } from './verdict.ts';
import { diffScope } from './verdict.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY = resolve(HERE, '../release/sources/signers.json');

function signersAudit(strict: boolean): number {
  const document: unknown = JSON.parse(readFileSync(REGISTRY, 'utf8'));
  const declared = isRecord(document) ? document : {};
  const phaseGate = declared['_phase_gate'];
  // `parseRegistry` refuses an empty registry, and rightly: a disjointness check over no
  // entries compares nothing. Pre-ceremony that is the true state rather than a defect, so
  // it is reported as a phase gate — but only when the file **declares** one, so emptying a
  // populated registry is still an error, and `--strict` (what a release gate runs) still
  // fails either way.
  const declaredEntries = declared['entries'];
  if (Array.isArray(declaredEntries) && declaredEntries.length === 0 && phaseGate) {
    console.log(`unseated: ${String(phaseGate)}`);
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

function diffScopeCommand(incumbentPath: string, candidatePath: string): number {
  // A document with no `perFileHashes` is refused rather than read as `{}`. Typing this
  // exposed the hole: `{}` against `{}` yields zero out-of-scope files, so `diff-scope`
  // would have printed "the delta is confined to the scope 12 §1.5 admits" and exited 0
  // having compared nothing — a false pass on the gate that decides whether a release may
  // skip the standard lane's 72 h soak.
  const read = (path: string): FileHashes => {
    const document: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const hashes = isRecord(document) ? document['perFileHashes'] : undefined;
    if (!isRecord(hashes) || Object.keys(hashes).length === 0) {
      throw new Error(`${path} carries no perFileHashes; there is nothing to compare`);
    }
    const out: Record<string, string> = {};
    for (const [file, hash] of Object.entries(hashes)) {
      if (typeof hash !== 'string') throw new Error(`${path}: perFileHashes[${file}] is not a digest`);
      out[file] = hash;
    }
    return out;
  };
  const result = diffScope(read(incumbentPath), read(candidatePath));
  console.log(result.detail);
  for (const entry of result.outOfScope) console.error(`  ${entry.change}: ${entry.path}`);
  return result.admissible ? 0 : 1;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function main(argv: readonly string[]): number {
  const [command, ...rest] = argv;
  switch (command) {
    case 'signers':
      if (rest[0] !== 'audit') break;
      return signersAudit(rest.includes('--strict'));
    case 'diff-scope': {
      const [incumbent, candidate] = rest;
      if (incumbent === undefined || candidate === undefined) break;
      return diffScopeCommand(incumbent, candidate);
    }
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
