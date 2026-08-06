/**
 * `app/tools/snapshot` — the command line around {@link buildSnapshot}.
 *
 *   node tools/snapshot/cli.ts build  --from <export.json> --out <snapshot.json>
 *   node tools/snapshot/cli.ts verify --file <snapshot.json> --pin <sha256-hex>
 *
 * Two subcommands and no options that change what is produced. A producer flag — pretty
 * printing, a comment field, an "include timestamp" switch — would be a way to emit two
 * different files for one history, which is the one thing 10 §8.2 asks this tool not to do.
 *
 * `verify` runs the **client's** admission path over a file on disk, so a publisher can check
 * what a user will see before publishing rather than after. It is the same `admitSnapshot` the
 * app calls, given the same three arguments; there is no producer-side variant that is more
 * lenient, because a more lenient one would certify documents the client rejects.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

import { admitSnapshot, parseSnapshot, type Sha256 } from '@bleavit/providers';
import type { ChainBinding } from '@bleavit/handoff-envelope';

import { buildSnapshot, MalformedExport, parseArchiveExport } from './build.ts';

const sha256: Sha256 = (preimage) => createHash('sha256').update(preimage).digest('hex');

function option(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(`--${name}`);
  if (at === -1) return undefined;
  return argv[at + 1];
}

function required(argv: readonly string[], name: string): string {
  const value = option(argv, name);
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

function build(argv: readonly string[]): number {
  const from = required(argv, 'from');
  const out = required(argv, 'out');
  let read;
  try {
    read = parseArchiveExport(JSON.parse(readFileSync(from, 'utf8')));
  } catch (error) {
    if (error instanceof MalformedExport || error instanceof SyntaxError) {
      process.stderr.write(`${from} is not a usable archive export:\n  ${error.message}\n`);
      return 1;
    }
    throw error;
  }
  const result = buildSnapshot(read, sha256);
  if (result.kind === 'refused') {
    process.stderr.write(
      `refusing to publish a snapshot from ${from} — ${result.why.length} problem(s):\n` +
        result.why.map((why) => `  - ${why}\n`).join(''),
    );
    return 1;
  }
  writeFileSync(out, result.text);
  process.stdout.write(
    `${out}\n` +
      `  pin      ${result.pin}\n` +
      `  blocks   ${result.document.range.fromBlock}..${result.document.range.toBlock}\n` +
      `  covered  ${result.document.coverage.map((r) => `${r.fromBlock}..${r.toBlock}`).join(', ')}\n` +
      `  ops      ${result.document.ops.length}\n` +
      `  holdings ${result.document.balances.length}\n\n` +
      'Publish the pin over a channel the file does not travel on. A pin served beside the ' +
      'file it describes proves only that the file was not corrupted in transit.\n',
  );
  return 0;
}

function verify(argv: readonly string[]): number {
  const file = required(argv, 'file');
  const pin = required(argv, 'pin');
  const text = readFileSync(file, 'utf8');
  // The binding compared against is the file's **own**, which makes the binding screen
  // tautological here and is the honest thing rather than a gap: `verify` answers *"would a
  // client admit these bytes"*, and which chain the eventual reader is on is not in evidence
  // on a publisher's machine. The user's client compares its live binding, and that is where
  // the check has to bite. Stated because a publisher reading "admissible" could otherwise
  // conclude the chain identity was verified.
  //
  // A file that will not parse gets an unmatchable placeholder: `admitSnapshot` returns on the
  // malformed screen before it reaches the binding, so the report is about the malformation.
  let binding: ChainBinding = { genesisHash: '', specVersion: 0, contractVersion: 0 };
  try {
    binding = parseSnapshot(JSON.parse(text)).binding;
  } catch {
    /* reported by admitSnapshot below, with the finding class the client would show */
  }
  const verdict = admitSnapshot(text, { expectedPin: pin, binding }, sha256);
  if (verdict.kind === 'rejected') {
    process.stderr.write(
      `${file} would be REJECTED at import — ${verdict.findings.length} finding(s):\n` +
        verdict.findings.map((f) => `  - [${f.screen}] ${f.why}\n`).join('') +
        `\n${verdict.refusal.code}: ${verdict.refusal.message}\n`,
    );
    return 1;
  }
  process.stdout.write(
    `${file} is admissible: ${verdict.document.ops.length} movement(s) over blocks ` +
      `${verdict.document.range.fromBlock}..${verdict.document.range.toBlock}, pinned at ${pin}.\n` +
      'This checks the file. It does not check that the history is true — see 10 §8.4 and 14 ' +
      'TH-50: a self-consistent forgery at depth passes every screen here.\n',
  );
  return 0;
}

function main(argv: readonly string[]): number {
  const [command] = argv;
  if (command === 'build') return build(argv.slice(1));
  if (command === 'verify') return verify(argv.slice(1));
  process.stderr.write(
    'usage:\n' +
      '  node tools/snapshot/cli.ts build  --from <export.json> --out <snapshot.json>\n' +
      '  node tools/snapshot/cli.ts verify --file <snapshot.json> --pin <sha256-hex>\n',
  );
  return 2;
}

process.exitCode = main(process.argv.slice(2));
