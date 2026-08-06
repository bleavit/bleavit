/**
 * The two ledger domains — 11 §11.2a, 10 §11, contract v23.
 *
 * What is bound here is doc 11's own S4 row, in **both** directions: the calls
 * this client offers per domain are parsed out of the inventory table's extrinsic
 * cell and compared against `callsFor()`. The point is not that the lists match
 * today — it is that the client derives its service subset from a *rule* (the
 * legs a hosted question does not have) while the document states it as a *list*,
 * so the two are independent statements of the same claim and a divergence has to
 * show up somewhere.
 *
 * Everything else in this suite is a refusal. A domain layer's failures are all
 * silent by construction: a mislabelled row renders under the wrong badge, a
 * misrouted write fails with `UnknownVault` after the user signed, and a merged
 * total is simply a number that looks right.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LEDGER_PALLET,
  LedgerDomainError,
  PRIMARY_LEDGER_CALLS,
  UnreachableLedgerCallError,
  callsFor,
  domainOf,
  ledgerCall,
  totalOf,
  type LedgerRow,
} from '@bleavit/features-tx';

const here = dirname(fileURLToPath(import.meta.url));
const DOC_11 = resolve(here, '../../../docs/architecture/11-frontend-workflows.md');
const MANIFEST = resolve(here, '../../../tools/release/surface-manifest.json');

/**
 * The S4 row's extrinsic cell, as two call lists.
 *
 * The cell writes each domain as a pallet prefix and slash-separated call names
 * (`` `ledger.split/merge/…` ``). Parsed rather than restated for the reason the
 * whole track keeps rediscovering: a list written beside the code agrees with the
 * code and with nothing else.
 */
function documentedCalls(): { primary: string[]; service: string[] } {
  const text = readFileSync(DOC_11, 'utf8');
  const row = text.split('\n').find((line) => line.startsWith('| S4 |'));
  assert.ok(row !== undefined, 'doc 11 §11.2 has no S4 row');
  const read = (prefix: string): string[] => {
    const match = new RegExp(`\`${prefix}\\.([a-z_/]+)\``).exec(row);
    assert.ok(match?.[1] !== undefined, `the S4 extrinsic cell names no ${prefix} call list`);
    return match[1].split('/');
  };
  return { primary: read('ledger'), service: read('ServiceLedger') };
}

/** The boundary constant, read where the client would read it rather than typed. */
function serviceIdBaseFromManifest(): bigint {
  const manifest: unknown = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const entries = (manifest as { entries: { constant?: string; layout?: { value?: string } }[] })
    .entries;
  const entry = entries.find((row) => row.constant === 'ServiceIdBase');
  assert.ok(entry?.layout?.value !== undefined, 'the manifest freezes no ServiceIdBase constant');
  // The manifest records the SCALE encoding of the `u64`, little-endian.
  const bytes = entry.layout.value.replace(/^0x/, '').match(/../g);
  assert.ok(bytes !== null, 'ServiceIdBase has no readable encoding');
  return BigInt(`0x${[...bytes].reverse().join('')}`);
}

const SERVICE_ID_BASE = serviceIdBaseFromManifest();

test('the frozen boundary really does partition the u64 id space', () => {
  // Anti-vacuity for every test below: they all take this value as their input,
  // and a zero or absent one would make the partition trivially "correct".
  assert.ok(SERVICE_ID_BASE > 0n, 'ServiceIdBase read as zero');
  assert.ok(SERVICE_ID_BASE < (1n << 64n) - 1n, 'ServiceIdBase leaves no service band');
  // 16 §7.1 partitions the space at a single bit; a boundary that is not a power
  // of two would make `domainOf`'s comparison and the runtime's bit test differ.
  assert.equal(SERVICE_ID_BASE & (SERVICE_ID_BASE - 1n), 0n, 'the boundary is not a single bit');
});

test('doc 11 §11.2 S4 and the client agree on both call sets', () => {
  const documented = documentedCalls();
  assert.deepEqual([...PRIMARY_LEDGER_CALLS], documented.primary);
  assert.deepEqual([...callsFor('primary')], documented.primary);
  assert.deepEqual([...callsFor('service')], documented.service);
  // The subset is genuinely smaller, and by exactly the legs 16 §7.6 removes.
  const removed = documented.primary.filter((call) => !documented.service.includes(call));
  assert.deepEqual(removed.sort(), [
    'merge_gate',
    'redeem_baseline',
    'redeem_baseline_pair',
    'redeem_gate',
    'split_gate',
  ]);
});

test('domain is a bit test on the id, in both bands and at the boundary', () => {
  assert.equal(domainOf(0n, SERVICE_ID_BASE), 'primary');
  assert.equal(domainOf(SERVICE_ID_BASE - 1n, SERVICE_ID_BASE), 'primary');
  // The base itself is the first service id (16 §7.1: "service allocators start
  // at it"), so an off-by-one here labels the first hosted question primary.
  assert.equal(domainOf(SERVICE_ID_BASE, SERVICE_ID_BASE), 'service');
  assert.equal(domainOf((1n << 64n) - 1n, SERVICE_ID_BASE), 'service');
});

test('an unusable boundary refuses rather than classifying everything', () => {
  // A zero base would call every row hosted — including a user's whole primary
  // portfolio — and nothing downstream could notice, because the labels would be
  // internally consistent.
  assert.throws(() => domainOf(1n, 0n), LedgerDomainError);
  assert.throws(() => domainOf(1n, -1n), LedgerDomainError);
  assert.throws(() => domainOf(1n, 1n << 64n), LedgerDomainError);
});

test('an id outside u64 refuses rather than landing in the service band', () => {
  // `id >= base` would happily call `2^64` a service id. It is not an id this
  // chain allocated, and treating it as one puts a fabricated row on screen.
  assert.throws(() => domainOf(1n << 64n, SERVICE_ID_BASE), LedgerDomainError);
  assert.throws(() => domainOf(-1n, SERVICE_ID_BASE), LedgerDomainError);
});

test('a write is addressed to the instance that owns the row', () => {
  assert.deepEqual(ledgerCall('primary', 'redeem_scalar'), {
    pallet: 'ConditionalLedger',
    call: 'redeem_scalar',
  });
  assert.deepEqual(ledgerCall('service', 'redeem_scalar'), {
    pallet: 'ServiceLedger',
    call: 'redeem_scalar',
  });
  assert.equal(LEDGER_PALLET.primary, 'ConditionalLedger');
  assert.equal(LEDGER_PALLET.service, 'ServiceLedger');
});

test('a gate or Baseline call in the service domain is refused, with its reason', () => {
  for (const call of ['split_gate', 'merge_gate', 'redeem_gate', 'redeem_baseline', 'redeem_baseline_pair']) {
    const thrown = (() => {
      try {
        ledgerCall('service', call);
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    assert.ok(thrown instanceof UnreachableLedgerCallError, `${call} was routed, not refused`);
    assert.equal(thrown.call, call);
    assert.equal(thrown.domain, 'service');
    // The message has to say *why* it is absent, or an operator reads it as a
    // client bug and looks for the call in the wrong place.
    assert.match(thrown.message, /16 §7\.6|gate or Baseline/);
  }
});

test('there is no default instance on the write path', () => {
  // §11.2a rule 5. A default would make a hosted redemption addressed to
  // `ledger.*` fail with `UnknownVault` after the user signed — correct, and
  // useless. Asserted by absence: `ledgerCall` takes the domain first and has no
  // one-argument form, so the source carries no call site that could omit it.
  const source = readFileSync(resolve(here, '../../src/features/tx/src/ledger-domain.ts'), 'utf8');
  const scannable = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    // `export type LedgerPallet = 'ConditionalLedger' | 'ServiceLedger'` is a
    // union, not a default, and the first version of this check flagged it.
    // Dropping type aliases is what leaves only value positions in the scan.
    .replace(/^export type [\s\S]*?;$/gm, '');
  // An *assignment* to a domain or pallet, never a comparison: `=== 'primary'`
  // is how `callsFor` branches, and a pattern that could not tell the two apart
  // fired on it. The lookarounds are what make this a defaults check.
  const assigns = (literal: string): RegExp =>
    new RegExp(String.raw`(?<![=!<>])=(?!=)\s*['"](${literal})['"]`);
  assert.doesNotMatch(scannable, assigns('ConditionalLedger|ServiceLedger'), 'a default instance');
  assert.doesNotMatch(scannable, assigns('primary|service'), 'a default domain');
  // Anti-vacuity: the pattern must still fire on the thing it forbids, or a
  // future refactor could make it match nothing and read as proof.
  assert.match(`const fallback = 'primary';`, assigns('primary|service'));
  assert.doesNotMatch(scannable, /1n\s*<<\s*63n/, 'the boundary as a literal (rule 7)');
});

test('a total is per domain, and a foreign row is refused at runtime too', () => {
  const primary: LedgerRow<'primary'>[] = [
    { domain: 'primary', amount: 10n },
    { domain: 'primary', amount: 32n },
  ];
  const service: LedgerRow<'service'>[] = [{ domain: 'service', amount: 5n }];
  assert.equal(totalOf('primary', primary), 42n);
  assert.equal(totalOf('service', service), 5n);
  assert.equal(totalOf('primary', []), 0n);

  // The compile-time control is proven by `tests/firewall`'s negative corpus; this
  // is the data path, where a row rehydrated from storage carries no type.
  const smuggled = [...primary, { domain: 'service', amount: 1_000_000n }] as LedgerRow<'primary'>[];
  assert.throws(() => totalOf('primary', smuggled), LedgerDomainError);
});

test('no export produces a figure spanning both domains', () => {
  // §11.2a rule 2 made structural: rule 2's merged total has nowhere to live.
  // A future helper that summed two `LedgerRow` arrays would show up here.
  const source = readFileSync(resolve(here, '../../src/features/tx/src/ledger-domain.ts'), 'utf8');
  const exported = [...source.matchAll(/^export function (\w+)/gm)].map((match) => match[1]);
  assert.deepEqual(exported.sort(), ['callsFor', 'domainOf', 'ledgerCall', 'totalOf']);
});
