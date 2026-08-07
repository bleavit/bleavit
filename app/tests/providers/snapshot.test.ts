/**
 * The snapshot format, its pin, and the forged corpus — 10 §8.2/§8.4, 15 §4.8 (F9).
 *
 * 15 §4.8's malicious-provider row asks for a *"forged-snapshot corpus rejected **per class**"*,
 * which is why {@link SnapshotFinding} names its screens rather than returning a boolean: a
 * corpus that only proves "bad snapshots are rejected" cannot tell you which screen was
 * load-bearing when one of them regresses, and a screen that stops firing is invisible under a
 * fully green run.
 *
 * **The corpus deliberately contains a document that is admitted.** 10 §8.4 and 14 TH-50 both
 * state the limit plainly: these screens do not catch a self-consistent forgery of history at a
 * depth the light client cannot reach. A corpus made only of rejections would be evidence for a
 * guarantee this mechanism declines to make, and the honest form is to write the undetectable
 * forgery down and assert that it passes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  PROVIDER_REFUSAL_CODES,
  providerRefusal,
  snapshotRefusal,
  SNAPSHOT_FORMAT,
  admitSnapshot,
  deriveBalances,
  diffSnapshots,
  parseSnapshot,
  preimageOfSerialized,
  serializeSnapshot,
  snapshotPreimage,
} from '@bleavit/providers';
import type { SnapshotDocument, SnapshotFinding, SnapshotOp } from '@bleavit/providers';

const sha256 = (preimage: Uint8Array): string =>
  createHash('sha256').update(preimage).digest('hex');

const BINDING = { genesisHash: '0xfeed', specVersion: 2, contractVersion: 23 } as const;

/**
 * A small, valid history — and note it is a **settled** one.
 *
 * The `redeem` at block 13 burns PASS alone, so after it the branches no longer agree:
 * escrow 800, PASS supply 800, FAIL supply 1300. That is exactly the state a conservation
 * check written as I-1's cross-branch equality would report as a forgery, which is why this
 * document rather than an unsettled one is the fixture every other case is derived from.
 */
function validDocument(): SnapshotDocument {
  return {
    format: SNAPSHOT_FORMAT,
    binding: { ...BINDING },
    range: { fromBlock: 10, toBlock: 13 },
    coverage: [{ fromBlock: 10, toBlock: 13 }],
    vaults: [{ vault: 'v1', branches: ['FAIL', 'PASS'] }],
    ops: [
      { kind: 'split', block: 10, vault: 'v1', account: 'alice', amount: '1000' },
      { kind: 'split', block: 11, vault: 'v1', account: 'bob', amount: '500' },
      { kind: 'merge', block: 12, vault: 'v1', account: 'alice', amount: '200' },
      { kind: 'redeem', block: 13, vault: 'v1', account: 'bob', branch: 'PASS', amount: '500' },
    ],
    balances: [
      { vault: 'v1', account: 'alice', branch: 'FAIL', amount: '800' },
      { vault: 'v1', account: 'alice', branch: 'PASS', amount: '800' },
      { vault: 'v1', account: 'bob', branch: 'FAIL', amount: '500' },
    ],
  };
}

function pinnedFile(document: SnapshotDocument): { text: string; pin: string } {
  const text = serializeSnapshot(document);
  return { text, pin: sha256(snapshotPreimage(document)) };
}

/** Admit a document that was built here, with its own correct pin. */
function admit(document: SnapshotDocument) {
  const { text, pin } = pinnedFile(document);
  return admitSnapshot(text, { expectedPin: pin, binding: { ...BINDING } }, sha256);
}

function screens(findings: readonly SnapshotFinding[]): readonly string[] {
  return [...new Set(findings.map((finding) => finding.screen))].sort();
}

/** Assert a forged document is rejected, and rejected by exactly the screen claimed. */
function rejectedBy(document: SnapshotDocument, screen: SnapshotFinding['screen']): void {
  const verdict = admit(document);
  assert.equal(verdict.kind, 'rejected');
  if (verdict.kind !== 'rejected') return;
  assert.equal(verdict.refusal.code, 'FE-PROV-003');
  assert.ok(
    screens(verdict.findings).includes(screen),
    `expected the ${screen} screen to fire; fired: ${screens(verdict.findings).join(', ')}`,
  );
}

// ------------------------------------------------------------------ the positive control

test('the valid, already-settled document is admitted', () => {
  // The anti-vacuity control for every rejection below: without it, a screen that rejected
  // everything would look identical to a screen that works.
  const verdict = admit(validDocument());
  assert.equal(verdict.kind, 'admitted', JSON.stringify(admit(validDocument()), null, 2));
});

test('a settled vault is admitted — cross-branch equality is NOT the identity checked', () => {
  // I-1's `supply[b] == escrow` for every branch holds only until settlement, because `redeem`
  // burns the winning branch alone. The fixture is post-redemption: escrow 800, PASS 800,
  // FAIL 1300. A conservation check written the obvious way flags every settled vault in
  // existence, which is a screen that would have to be switched off within a day.
  const document = validDocument();
  const redeems = document.ops.filter((op) => op.kind === 'redeem');
  assert.equal(redeems.length, 1, 'the fixture must stay settled or this test proves nothing');
  assert.equal(admit(document).kind, 'admitted');
});

// ------------------------------------------------------------------ determinism (INV-FE-15)

test('serialization is deterministic and independent of key insertion order', () => {
  // 10 §8.2: "reproducible byte-identically by anyone". Two producers that built the same
  // history with fields assigned in a different order must emit one file.
  const forward = validDocument();
  const shuffled: SnapshotDocument = {
    balances: forward.balances,
    ops: forward.ops,
    vaults: forward.vaults,
    coverage: forward.coverage,
    range: { toBlock: 13, fromBlock: 10 },
    binding: { contractVersion: 23, specVersion: 2, genesisHash: '0xfeed' },
    format: SNAPSHOT_FORMAT,
  };
  assert.equal(serializeSnapshot(shuffled), serializeSnapshot(forward));
  assert.equal(sha256(snapshotPreimage(shuffled)), sha256(snapshotPreimage(forward)));
});

test('the pin is stable across a serialize → parse → serialize round trip', () => {
  const document = validDocument();
  const text = serializeSnapshot(document);
  const reparsed = parseSnapshot(JSON.parse(text));
  assert.equal(serializeSnapshot(reparsed), text);
  assert.equal(sha256(snapshotPreimage(reparsed)), sha256(snapshotPreimage(document)));
});

test('the snapshot tag is distinct, so a snapshot digest can never validate a capsule', () => {
  // `digestPreimage` is domain-separated for exactly this: two formats sharing a tag means a
  // document of one type satisfies the other's integrity check.
  assert.equal(SNAPSHOT_FORMAT, 'bleavit.snapshot.v1');
  const preimage = new TextDecoder().decode(snapshotPreimage(validDocument()));
  // The separator is built from its code point, never written as an escape. Writing it
  // inline puts a raw NUL in this file, which is invisible in every editor, makes git
  // classify the source as binary, and is dropped by anything that round-trips the text.
  // `cat -A` caught it here, which is the third time in this repository (app-code rule 14).
  const nul = String.fromCharCode(0);
  assert.ok(preimage.startsWith(`${SNAPSHOT_FORMAT}${nul}`));
  assert.ok(!preimage.startsWith(`${SNAPSHOT_FORMAT} `), 'a space is a legal tag character');
});

// ------------------------------------------------------------------ the pin and the bytes

test('a wrong pin is rejected, and the file is named as hashing to something else', () => {
  const { text } = pinnedFile(validDocument());
  const verdict = admitSnapshot(
    text,
    { expectedPin: '0'.repeat(64), binding: { ...BINDING } },
    sha256,
  );
  assert.equal(verdict.kind, 'rejected');
  if (verdict.kind !== 'rejected') return;
  assert.deepEqual(screens(verdict.findings), ['pin']);
  assert.equal(verdict.refusal.code, 'FE-PROV-003');
});

test('a non-canonical file fails the canonical screen AND its own pin', () => {
  // This is the case a consumer that parsed first would admit: the object is identical and only
  // the *bytes* differ. §8.2 asks for byte-identical reproduction, so the bytes are the claim.
  //
  // Both screens fire, and the second one is the repair of a real defect: the pin was taken over
  // the **re-serialization** of what was parsed, so this file — which the publisher never shipped
  // — hashed to the publisher's pin and passed. The message was false in the same move ("the file
  // hashes to …" named a hash the file does not have), which is exactly the string a user
  // compares against the publisher's page.
  const document = validDocument();
  const pin = sha256(snapshotPreimage(document));
  const prettyPrinted = JSON.stringify(document, null, 2);
  assert.notEqual(prettyPrinted, serializeSnapshot(document));
  const verdict = admitSnapshot(prettyPrinted, { expectedPin: pin, binding: { ...BINDING } }, sha256);
  assert.equal(verdict.kind, 'rejected');
  if (verdict.kind !== 'rejected') return;
  assert.deepEqual(screens(verdict.findings), ['canonical', 'pin']);
  const reported = /the file hashes to ([0-9a-f]+)/.exec(
    verdict.findings.find((finding) => finding.screen === 'pin')?.why ?? '',
  );
  assert.ok(reported !== null);
  assert.equal(
    reported[1],
    sha256(preimageOfSerialized(prettyPrinted)),
    'the reported hash is the hash of THIS file, not of a document reconstructed from it',
  );
});

test('a trailing newline is not the canonical file, and only the length check sees it', () => {
  // The case the streamed comparison would otherwise wave through: `JSON.parse` ignores trailing
  // whitespace, so this parses to the identical document and every emitted piece matches the text
  // it is compared against. What catches it is that the walk must end exactly at the end of the
  // file — a text the canonical form is a strict **prefix** of is not that canonical form, and a
  // trailing newline is what any editor adds.
  const document = validDocument();
  const withNewline = `${serializeSnapshot(document)}\n`;
  const verdict = admitSnapshot(
    withNewline,
    { expectedPin: sha256(snapshotPreimage(document)), binding: { ...BINDING } },
    sha256,
  );
  assert.equal(verdict.kind, 'rejected');
  if (verdict.kind !== 'rejected') return;
  assert.ok(screens(verdict.findings).includes('canonical'));
});

test('a producer annotation is rejected as non-canonical rather than silently tolerated', () => {
  const document = validDocument();
  const pin = sha256(snapshotPreimage(document));
  const annotated = JSON.stringify({ ...document, producedBy: 'somebody' });
  const verdict = admitSnapshot(annotated, { expectedPin: pin, binding: { ...BINDING } }, sha256);
  assert.equal(verdict.kind, 'rejected');
  if (verdict.kind !== 'rejected') return;
  assert.ok(screens(verdict.findings).includes('canonical'));
});

test('the hash function is required — there is no pin that defaults off', () => {
  // An optional hash function is a content pin that **defaults off**, and a pin that defaults
  // off is indistinguishable — in every log, every test run and every screen — from one that
  // was checked and passed. Same defect F20 made structural in `admitIntent`, where
  // `FE-HANDOFF-010` shipped defined and unreachable.
  //
  // Two halves, because each catches what the other cannot.
  //
  // *Type level*: `@ts-expect-error` is itself an assertion — if this call ever started
  // compiling, `tsc` reports the directive as unused and `check:types` goes red. It is here
  // rather than in the negative-compilation corpus because that corpus contains a fixture
  // proving `@bleavit/providers` is **unresolvable** from `tests/firewall` (10 §10.1's
  // CI-fatal edge), and declaring the dependency there to test an arity would have voided the
  // firewall fixture that depends on its absence. Measured, not assumed: adding it turned
  // `forbidden-package-edge.ts` from TS2307 to TS2305 and the corpus caught it immediately.
  //
  // *Runtime*: the arity check catches the change the type check cannot see — a signature that
  // grew an **optional** `sha256`, which every existing call site still satisfies.
  const uncallable: () => unknown = () =>
    // @ts-expect-error the content pin's hash function is required and is never defaulted
    admitSnapshot('{}', { expectedPin: 'x', binding: { ...BINDING } });
  assert.equal(typeof uncallable, 'function');
  assert.equal(admitSnapshot.length, 3);
});

// ------------------------------------------------------------------ class: malformed

test('malformed: a foreign format tag', () => {
  const verdict = admitSnapshot(
    JSON.stringify({ ...validDocument(), format: 'bleavit.snapshot.v2' }),
    { expectedPin: 'irrelevant', binding: { ...BINDING } },
    sha256,
  );
  assert.equal(verdict.kind, 'rejected');
  if (verdict.kind !== 'rejected') return;
  assert.deepEqual(screens(verdict.findings), ['malformed']);
});

test('malformed: an amount written as a JSON number', () => {
  // V-74's shape. `u128` base units run past 2^53, so a JSON number is rounded on load and the
  // document then fails its own conservation replay for reasons that look like a forgery.
  const document = validDocument();
  const text = serializeSnapshot(document).replace('"amount":"1000"', '"amount":1000');
  const verdict = admitSnapshot(text, { expectedPin: 'x', binding: { ...BINDING } }, sha256);
  assert.equal(verdict.kind, 'rejected');
  if (verdict.kind !== 'rejected') return;
  assert.deepEqual(screens(verdict.findings), ['malformed']);
  assert.match(verdict.findings[0]!.why, /canonical decimal string/);
});

test('malformed: a leading-zero amount, which two producers would render differently', () => {
  const text = serializeSnapshot(validDocument()).replace('"amount":"1000"', '"amount":"01000"');
  const verdict = admitSnapshot(text, { expectedPin: 'x', binding: { ...BINDING } }, sha256);
  assert.equal(verdict.kind, 'rejected');
});

test('malformed: a zero-amount movement, which survives every other screen and means nothing', () => {
  const document = validDocument();
  const forged: SnapshotDocument = {
    ...document,
    ops: [...document.ops, { kind: 'split', block: 13, vault: 'v1', account: 'mallory', amount: '0' }],
  };
  rejectedBy(forged, 'malformed');
});

test('malformed: an unknown op kind', () => {
  const text = serializeSnapshot(validDocument()).replace('"kind":"merge"', '"kind":"mint"');
  const verdict = admitSnapshot(text, { expectedPin: 'x', binding: { ...BINDING } }, sha256);
  assert.equal(verdict.kind, 'rejected');
  if (verdict.kind !== 'rejected') return;
  assert.deepEqual(screens(verdict.findings), ['malformed']);
});

test('malformed: a one-branch vault, whose conservation identity would be vacuous', () => {
  const document = validDocument();
  rejectedBy({ ...document, vaults: [{ vault: 'v1', branches: ['PASS'] }] }, 'malformed');
});

test('malformed: a block height that is not a u32', () => {
  const text = serializeSnapshot(validDocument()).replace('"toBlock":13', '"toBlock":13.5');
  const verdict = admitSnapshot(text, { expectedPin: 'x', binding: { ...BINDING } }, sha256);
  assert.equal(verdict.kind, 'rejected');
  if (verdict.kind !== 'rejected') return;
  assert.deepEqual(screens(verdict.findings), ['malformed']);
});

test('malformed: not JSON at all', () => {
  const verdict = admitSnapshot('<html>404</html>', { expectedPin: 'x', binding: { ...BINDING } }, sha256);
  assert.equal(verdict.kind, 'rejected');
  if (verdict.kind !== 'rejected') return;
  assert.deepEqual(screens(verdict.findings), ['malformed']);
});

// ------------------------------------------------------------------ class: wrong chain

test('binding: a snapshot of another chain is refused on genesis', () => {
  const { text, pin } = pinnedFile({
    ...validDocument(),
    binding: { genesisHash: '0xbeef', specVersion: 2, contractVersion: 23 },
  });
  const verdict = admitSnapshot(text, { expectedPin: pin, binding: { ...BINDING } }, sha256);
  assert.equal(verdict.kind, 'rejected');
  if (verdict.kind !== 'rejected') return;
  assert.deepEqual(screens(verdict.findings), ['binding']);
});

test('binding: the wrong-chain refusal names the wrong chain, not a damaged download', () => {
  // FE-PROV-003's recovery used to end with "check that the file downloaded completely, and
  // compare its content hash" — true for a truncated file and actively wrong here, where
  // acting on it costs a second download of somebody else's network's history. §10.4 keeps
  // message and recovery fixed per code, so the per-cause remediation leads the expert detail.
  const { text, pin } = pinnedFile({
    ...validDocument(),
    binding: { genesisHash: '0xbeef', specVersion: 2, contractVersion: 23 },
  });
  const verdict = admitSnapshot(text, { expectedPin: pin, binding: { ...BINDING } }, sha256);
  assert.equal(verdict.kind, 'rejected');
  if (verdict.kind !== 'rejected') return;
  assert.equal(verdict.refusal.code, 'FE-PROV-003');
  assert.match(verdict.refusal.detail, /different chain/);
  assert.match(verdict.refusal.detail, /Re-downloading will not help/);
  assert.doesNotMatch(verdict.refusal.recovery, /downloaded completely/);
});

test('binding: a differing spec_version alone is ADMITTED — §8 mandates no version binding', () => {
  // The correction (F9, 2026-08-06). `equalBinding`'s exact spec/contract equality is 10 §13.1's
  // rule for the three HANDOFF formats, which describe one block; §8 states no chain binding for
  // a snapshot at all, and §6.4 assigns snapshots "deep history beyond 30 days" — history that
  // necessarily predates the current runtime. Under exact equality the first runtime upgrade
  // refuses every snapshot ever published: the normal case, refused, with copy telling the user
  // to check a download that was never damaged.
  const { text, pin } = pinnedFile({ ...validDocument(), binding: { ...BINDING, specVersion: 3 } });
  const verdict = admitSnapshot(text, { expectedPin: pin, binding: { ...BINDING } }, sha256);
  assert.equal(verdict.kind, 'admitted');
  if (verdict.kind !== 'admitted') return;
  // And the version is still carried, so a caller renders the difference as an advisory line.
  assert.equal(verdict.document.binding.specVersion, 3);
});

test('binding: a differing contract version alone is ADMITTED too', () => {
  const { text, pin } = pinnedFile({
    ...validDocument(),
    binding: { ...BINDING, contractVersion: 99 },
  });
  const verdict = admitSnapshot(text, { expectedPin: pin, binding: { ...BINDING } }, sha256);
  assert.equal(verdict.kind, 'admitted');
});

// ------------------------------------------------------------------ class: coverage

test('coverage: overlapping ranges are not monotone coverage', () => {
  const document = validDocument();
  rejectedBy(
    {
      ...document,
      coverage: [
        { fromBlock: 10, toBlock: 12 },
        { fromBlock: 11, toBlock: 13 },
      ],
    },
    'coverage',
  );
});

test('coverage: a range outside the declared span', () => {
  const document = validDocument();
  rejectedBy({ ...document, coverage: [{ fromBlock: 10, toBlock: 99 }] }, 'coverage');
});

test('coverage: a movement at a block no declared range covers', () => {
  // The one a forger reaches for: declare coverage of a short window, ship history from
  // outside it, and the document never even claims to have observed the blocks it reports.
  const document = validDocument();
  rejectedBy(
    {
      ...document,
      range: { fromBlock: 10, toBlock: 99 },
      coverage: [{ fromBlock: 10, toBlock: 11 }],
    },
    'coverage',
  );
});

test('coverage: an inverted span', () => {
  const document = validDocument();
  rejectedBy({ ...document, range: { fromBlock: 13, toBlock: 10 } }, 'coverage');
});

// ------------------------------------------------------------------ class: conservation

test('conservation: merging more than an account holds', () => {
  const document = validDocument();
  rejectedBy(
    {
      ...document,
      ops: [
        { kind: 'split', block: 10, vault: 'v1', account: 'alice', amount: '1000' },
        { kind: 'merge', block: 11, vault: 'v1', account: 'alice', amount: '4000' },
      ],
      balances: [],
    },
    'conservation',
  );
});

test('conservation: a movement in an undeclared vault', () => {
  const document = validDocument();
  rejectedBy(
    {
      ...document,
      ops: [...document.ops, { kind: 'split', block: 13, vault: 'ghost', account: 'x', amount: '5' }],
    },
    'conservation',
  );
});

test('conservation: redeeming a branch the vault does not have', () => {
  const document = validDocument();
  rejectedBy(
    {
      ...document,
      ops: [
        { kind: 'split', block: 10, vault: 'v1', account: 'alice', amount: '1000' },
        { kind: 'redeem', block: 11, vault: 'v1', account: 'alice', branch: 'MAYBE', amount: '10' },
      ],
      balances: [
        { vault: 'v1', account: 'alice', branch: 'PASS', amount: '1000' },
        { vault: 'v1', account: 'alice', branch: 'FAIL', amount: '1000' },
      ],
    },
    'conservation',
  );
});

test('conservation is checked at EVERY step, not only at the end', () => {
  // The mutation this test exists for: fold everything, then check once. An account that goes
  // negative and back again ends in a perfectly consistent state, and the intermediate state
  // is the one that could never have existed on chain — alice never held 500 to merge at
  // block 11, and the later split does not retroactively make her solvent.
  const document = validDocument();
  const forged: SnapshotDocument = {
    ...document,
    ops: [
      { kind: 'split', block: 10, vault: 'v1', account: 'bob', amount: '500' },
      { kind: 'merge', block: 11, vault: 'v1', account: 'alice', amount: '500' },
      { kind: 'split', block: 12, vault: 'v1', account: 'alice', amount: '500' },
    ],
    balances: [
      { vault: 'v1', account: 'bob', branch: 'PASS', amount: '500' },
      { vault: 'v1', account: 'bob', branch: 'FAIL', amount: '500' },
    ],
  };
  // The end state is self-consistent: alice nets to zero, bob holds what he split.
  const replayEndsClean = forged.balances.every((row) => BigInt(row.amount) > 0n);
  assert.equal(replayEndsClean, true, 'the fixture must end clean or it proves nothing');
  rejectedBy(forged, 'conservation');
});

// ------------------------------------------------------------------ class: derived rows

test('derived rows: a fabricated balance no movement produces', () => {
  const document = validDocument();
  rejectedBy(
    {
      ...document,
      balances: [
        ...document.balances,
        { vault: 'v1', account: 'mallory', branch: 'PASS', amount: '9999' },
      ],
    },
    'derived-rows',
  );
});

test('derived rows: an omitted holding — the direction that renders an account as empty', () => {
  // The omission direction is the one that matters. A snapshot that drops a holder's rows says
  // that account holds nothing, which is a false statement about the chain rather than a
  // missing one, and no badge distinguishes the two.
  const document = validDocument();
  rejectedBy({ ...document, balances: document.balances.slice(0, 2) }, 'derived-rows');
});

test('derived rows: a stated amount that disagrees with the fold', () => {
  const document = validDocument();
  const [first, ...rest] = document.balances;
  rejectedBy({ ...document, balances: [{ ...first!, amount: '801' }, ...rest] }, 'derived-rows');
});

test('derived rows: one holding stated twice', () => {
  const document = validDocument();
  rejectedBy({ ...document, balances: [...document.balances, document.balances[0]!] }, 'derived-rows');
});

test('derived rows: a zero holding is an absent row, not a row saying zero', () => {
  // bob's PASS is fully redeemed at block 13. Requiring a `0` row would make every merged-out
  // position owe a row forever, and two honest producers would then disagree about a history
  // they both observed correctly.
  const document = validDocument();
  rejectedBy(
    {
      ...document,
      balances: [...document.balances, { vault: 'v1', account: 'bob', branch: 'PASS', amount: '0' }],
    },
    'derived-rows',
  );
});

// ------------------------------------------------------------------ every screen reports

test('a document that fails several classes reports all of them, not the first', () => {
  const document = validDocument();
  const verdict = admit({
    ...document,
    binding: { ...BINDING, genesisHash: '0xbeef' },
    coverage: [{ fromBlock: 10, toBlock: 11 }],
    balances: [],
  });
  assert.equal(verdict.kind, 'rejected');
  if (verdict.kind !== 'rejected') return;
  const fired = screens(verdict.findings);
  assert.ok(fired.includes('binding'));
  assert.ok(fired.includes('coverage'));
  assert.ok(fired.includes('derived-rows'));
});

// ------------------------------------------------------- canonical ARRAY order (10 §8.2)

test('canonical: an out-of-order vaults array is refused', () => {
  // Canonical JSON sorts object *keys* and leaves array order exactly as given, so without a
  // rule here two honest producers emit two files — and two pins — for one history. The
  // published property is byte-identical reproduction *by anyone*; the way anybody would find
  // out it was false is a user being told a correct snapshot is corrupt.
  const document = validDocument();
  rejectedBy(
    {
      ...document,
      vaults: [
        { vault: 'v2', branches: ['FAIL', 'PASS'] },
        { vault: 'v1', branches: ['FAIL', 'PASS'] },
      ],
    },
    'canonical',
  );
});

test('canonical: an out-of-order branches list is refused', () => {
  rejectedBy(
    { ...validDocument(), vaults: [{ vault: 'v1', branches: ['PASS', 'FAIL'] }] },
    'canonical',
  );
});

test('canonical: an out-of-order balances array is refused', () => {
  const document = validDocument();
  rejectedBy({ ...document, balances: [...document.balances].reverse() }, 'canonical');
});

test('canonical: a repeated vault is named as a repeat, not just as disorder', () => {
  const document = validDocument();
  const verdict = admit({
    ...document,
    vaults: [
      { vault: 'v1', branches: ['FAIL', 'PASS'] },
      { vault: 'v1', branches: ['FAIL', 'PASS'] },
    ],
  });
  assert.equal(verdict.kind, 'rejected');
  if (verdict.kind !== 'rejected') return;
  assert.ok(verdict.findings.some((f) => f.screen === 'canonical' && /appears twice/.test(f.why)));
});

test('canonical: adjacent coverage ranges must be written as one', () => {
  // `checkCoverage` permits 10..11 beside 12..13 *and* permits 10..13, so one covered set had
  // two legal spellings — the same divergence as an unsorted array, reached through a rule
  // that was about truthfulness rather than form.
  rejectedBy(
    {
      ...validDocument(),
      coverage: [
        { fromBlock: 10, toBlock: 11 },
        { fromBlock: 12, toBlock: 13 },
      ],
    },
    'canonical',
  );
});

test('canonical: an out-of-block-order movement list is refused (10 §8.2 rule 3)', () => {
  // The rule this file exempted until the R-6 re-review measured what the exemption cost.
  // §8.2 says consumers check all three canonical-form rules; two were checked and the
  // movement list was not, so ONE history had TWO admitted spellings and therefore two pins —
  // and `diffSnapshots` of that pair reports `disagree` with `FE-PROV-004`, which is precisely
  // the failure §8.2's paragraph exists to prevent.
  //
  // The check is the block half only, and it refuses rather than reorders: sorting `ops` would
  // let an invalid history be rearranged into a valid-looking one, because the conservation
  // replay is order-sensitive by design.
  //
  // The two swapped movements are independent splits for different accounts, so the
  // conservation replay still passes and `canonical` is the screen under test rather than a
  // second one firing first.
  const document = validDocument();
  const [first, second, ...rest] = document.ops as readonly [SnapshotOp, SnapshotOp, ...SnapshotOp[]];
  rejectedBy({ ...document, ops: [second, first, ...rest] }, 'canonical');
});

test('canonical: repeated blocks in the movement list are still fine — the rule is NON-DECREASING', () => {
  // The anti-vacuity control. Several movements in one block is ordinary, and a rule written
  // as strictly increasing would refuse every real snapshot while looking like this one.
  const document = validDocument();
  const [first] = document.ops as readonly [SnapshotOp, ...SnapshotOp[]];
  const sameBlock = { kind: 'split', block: 10, vault: 'v1', account: 'carol', amount: '0' } as const;
  const verdict = admit({ ...document, ops: [first, sameBlock, ...document.ops.slice(1)] });
  assert.ok(
    verdict.kind !== 'rejected' ||
      !verdict.findings.some((f) => f.screen === 'canonical' && /chain order/.test(f.why)),
    'two movements in one block must not be read as disorder',
  );
});

test('a genuine hole in coverage is still fine — only ADJACENT ranges must merge', () => {
  // The anti-vacuity control for the rule above: 10 §6.3 makes holes first-class, and a rule
  // that merged across one would erase exactly the information coverage exists to carry.
  const verdict = admit({
    ...validDocument(),
    range: { fromBlock: 10, toBlock: 13 },
    coverage: [
      { fromBlock: 10, toBlock: 10 },
      { fromBlock: 12, toBlock: 13 },
    ],
    ops: [
      { kind: 'split', block: 10, vault: 'v1', account: 'alice', amount: '1000' },
      { kind: 'merge', block: 12, vault: 'v1', account: 'alice', amount: '200' },
    ],
    balances: [
      { vault: 'v1', account: 'alice', branch: 'FAIL', amount: '800' },
      { vault: 'v1', account: 'alice', branch: 'PASS', amount: '800' },
    ],
  });
  assert.equal(verdict.kind, 'admitted');
});

test('deriveBalances is the fold the consumer replays, in the order the format requires', () => {
  // The producer folds through this function precisely so its differential against chain state
  // is a comparison with what the *client* will compute. A producer-local fold would compare
  // the chain against an algorithm no client runs.
  const document = validDocument();
  assert.deepEqual(deriveBalances(document.vaults, document.ops), document.balances);
});

test('deriveBalances omits a zero holding rather than stating it', () => {
  // A row saying zero and no row at all must not both be legal, or two honest producers
  // disagree on every position that was ever fully merged out.
  const rows = deriveBalances(
    [{ vault: 'v1', branches: ['FAIL', 'PASS'] }],
    [
      { kind: 'split', block: 1, vault: 'v1', account: 'alice', amount: '10' },
      { kind: 'merge', block: 2, vault: 'v1', account: 'alice', amount: '10' },
    ],
  );
  assert.deepEqual(rows, []);
});

// -------------------------------------- the movement alphabet (03 §5) and its boundary

test('a transfer moves a holding and touches neither escrow nor supply', () => {
  // Without `transfer` the format cannot encode ORDINARY history: after a `PositionTransferred`
  // the terminal holder differs with no escrow or supply change at all, so an exporter could
  // only drop the event — and then the balances fail their own replay — or misrepresent it as a
  // merge plus a split, which moves escrow that never moved.
  const verdict = admit({
    ...validDocument(),
    ops: [
      { kind: 'split', block: 10, vault: 'v1', account: 'alice', amount: '1000' },
      { kind: 'split', block: 11, vault: 'v1', account: 'bob', amount: '500' },
      { kind: 'merge', block: 12, vault: 'v1', account: 'alice', amount: '200' },
      {
        kind: 'transfer',
        block: 12,
        vault: 'v1',
        account: 'alice',
        to: 'bob',
        branch: 'PASS',
        amount: '300',
      },
      { kind: 'redeem', block: 13, vault: 'v1', account: 'bob', branch: 'PASS', amount: '500' },
    ],
    balances: [
      { vault: 'v1', account: 'alice', branch: 'FAIL', amount: '800' },
      { vault: 'v1', account: 'alice', branch: 'PASS', amount: '500' },
      { vault: 'v1', account: 'bob', branch: 'FAIL', amount: '500' },
      { vault: 'v1', account: 'bob', branch: 'PASS', amount: '300' },
    ],
  });
  assert.equal(verdict.kind, 'admitted', JSON.stringify(verdict, null, 2));
});

test('a transfer of more than the sender holds is a conservation failure', () => {
  rejectedBy(
    {
      ...validDocument(),
      ops: [
        { kind: 'split', block: 10, vault: 'v1', account: 'alice', amount: '1000' },
        {
          kind: 'transfer',
          block: 11,
          vault: 'v1',
          account: 'alice',
          to: 'bob',
          branch: 'PASS',
          amount: '5000',
        },
      ],
      balances: [],
    },
    'conservation',
  );
});

test('a transfer to the sending account is not a movement', () => {
  rejectedBy(
    {
      ...validDocument(),
      ops: [
        { kind: 'split', block: 10, vault: 'v1', account: 'alice', amount: '1000' },
        {
          kind: 'transfer',
          block: 11,
          vault: 'v1',
          account: 'alice',
          to: 'alice',
          branch: 'PASS',
          amount: '10',
        },
      ],
      balances: [],
    },
    'malformed',
  );
});

test('a movement kind outside v1 is refused and says which instruments are excluded', () => {
  // The scalar, gate and Baseline variants are not more `kind` strings: their escrow movement
  // is not the amount burned, so a replay would need each vault's settlement value, which this
  // document does not carry. Admitting one as an unknown kind would be worse than refusing.
  const document = validDocument();
  const raw = JSON.parse(serializeSnapshot(document)) as { ops: unknown[] };
  raw.ops = [{ kind: 'redeem_scalar', block: 10, vault: 'v1', account: 'a', amount: '1' }];
  const verdict = admitSnapshot(JSON.stringify(raw), { expectedPin: 'x', binding: { ...BINDING } }, sha256);
  assert.equal(verdict.kind, 'rejected');
  if (verdict.kind !== 'rejected') return;
  assert.ok(verdict.findings.some((f) => f.screen === 'malformed' && /settlement value/.test(f.why)));
});

test('an amount at or above 2^128 is refused — no chain balance can hold it', () => {
  // It parses, conserves and reconciles perfectly while describing a quantity that cannot
  // exist, because `BigInt` is unbounded. Same class as the JSON-number defect one bound up.
  const over = ((1n << 128n)).toString();
  rejectedBy(
    {
      ...validDocument(),
      ops: [{ kind: 'split', block: 10, vault: 'v1', account: 'alice', amount: over }],
      balances: [],
    },
    'malformed',
  );
  const atMax = ((1n << 128n) - 1n).toString();
  const verdict = admit({
    ...validDocument(),
    range: { fromBlock: 10, toBlock: 10 },
    coverage: [{ fromBlock: 10, toBlock: 10 }],
    ops: [{ kind: 'split', block: 10, vault: 'v1', account: 'alice', amount: atMax }],
    balances: [
      { vault: 'v1', account: 'alice', branch: 'FAIL', amount: atMax },
      { vault: 'v1', account: 'alice', branch: 'PASS', amount: atMax },
    ],
  });
  assert.equal(verdict.kind, 'admitted', 'the ceiling is inclusive');
});

test('preimageOfSerialized is the same pre-image, from bytes the caller already has', () => {
  // Two constructions of one pre-image is exactly the "two answers to which bytes" this module
  // exists to avoid, so the cheap one is bound to the canonical one rather than trusted.
  const document = validDocument();
  assert.deepEqual(
    preimageOfSerialized(serializeSnapshot(document)),
    snapshotPreimage(document),
  );
});

// ------------------------------------------------------------------ THE ADMITTED FORGERY

test('a self-consistent deep forgery is ADMITTED — 10 §8.4 and 14 TH-50 say so', () => {
  // This is the honest half of the guarantee, written down and asserted rather than left as
  // prose. Every movement below is fabricated: alice and bob never existed, this history never
  // happened. It passes every screen because it is *internally* consistent — coverage is
  // monotone, escrow and supply reconcile at every step, and the balances are exactly what the
  // movements produce.
  //
  // Nothing in this module can catch it, and the design says so instead of implying otherwise.
  // What limits the damage is elsewhere and structural: `Finalized<T>` is unnameable in this
  // package, so none of this can ever satisfy a precondition or render as verified (INV-FE-3),
  // and 14 TH-49 records provider chart manipulation as a declared accepted residual.
  const forgery: SnapshotDocument = {
    format: SNAPSHOT_FORMAT,
    binding: { ...BINDING },
    range: { fromBlock: 1, toBlock: 100 },
    coverage: [{ fromBlock: 1, toBlock: 100 }],
    vaults: [{ vault: 'never-existed', branches: ['FAIL', 'PASS'] }],
    ops: [
      { kind: 'split', block: 1, vault: 'never-existed', account: 'ghost', amount: '100000000000000000001' },
      { kind: 'merge', block: 50, vault: 'never-existed', account: 'ghost', amount: '30000000000000000000' },
    ],
    balances: [
      { vault: 'never-existed', account: 'ghost', branch: 'FAIL', amount: '70000000000000000001' },
      { vault: 'never-existed', account: 'ghost', branch: 'PASS', amount: '70000000000000000001' },
    ],
  };
  assert.equal(admit(forgery).kind, 'admitted');
  // And the amounts survived intact, which is the point of decimal strings: past 2^53 a JSON
  // number would have been rounded here — the trailing 1 is what disappears — and the forgery
  // would have been caught for the wrong reason, making this test claim a detection the
  // mechanism does not have.
  const held = BigInt(forgery.balances[0]!.amount);
  assert.equal(held, BigInt('70000000000000000001'));
  assert.notEqual(held, BigInt(Number(forgery.balances[0]!.amount)));
});

// ------------------------------------------------------------------ the two-snapshot diff

test('two producers that agree over their overlap agree', () => {
  const left = validDocument();
  const right: SnapshotDocument = { ...validDocument(), range: { fromBlock: 10, toBlock: 13 } };
  const verdict = diffSnapshots(left, right);
  assert.equal(verdict.kind, 'agree');
});

test('a disagreement flags the PAIR and names neither as the wrong one', () => {
  const left = validDocument();
  const document = validDocument();
  const [first, ...rest] = document.ops;
  assert.equal(first!.kind, 'split');
  const right: SnapshotDocument = { ...document, ops: [{ ...first!, amount: '999' }, ...rest] };
  const verdict = diffSnapshots(left, right);
  assert.equal(verdict.kind, 'disagree');
  if (verdict.kind !== 'disagree') return;
  assert.equal(verdict.refusal.code, 'FE-PROV-004');
  // The recovery must not tell the user to pick one. Two producers cannot outvote the absence
  // of a proof, and a client that resolved this would manufacture exactly the confidence
  // §8.4 declines to offer.
  assert.match(verdict.refusal.recovery, /neither is used/);
  assert.ok(verdict.disagreements.length > 0);
});

test('no shared coverage is its own verdict, not an agreement with an empty overlap', () => {
  // Two producers covering disjoint history have cross-checked nothing. Until 2026-08-06 this
  // returned `agree` with `overlap: []` — the fact was there and a caller writing the obvious
  // `if (kind === 'agree') showCrossChecked()` turned it into a cross-check that passed. §8.4
  // offers this diff as "the only available cross-check" for depth, so a vacuous one reported
  // as agreement manufactures exactly the confidence it declines to offer.
  const left = validDocument();
  const right: SnapshotDocument = {
    ...validDocument(),
    range: { fromBlock: 500, toBlock: 600 },
    coverage: [{ fromBlock: 500, toBlock: 600 }],
    ops: [],
    balances: [],
  };
  const verdict = diffSnapshots(left, right);
  assert.equal(verdict.kind, 'no-overlap');
  // And there is no `overlap` member to mistake for one: the empty array is gone, not renamed.
  assert.ok(!('overlap' in verdict));
});

test('the overlap is the intersection of COVERAGE, not of the declared spans', () => {
  // Both documents declare blocks 10..13 and observe disjoint halves of it. Taking the overlap
  // from `range` reports every movement in either half as a disagreement — FE-PROV-004 on an
  // honest pair — and with no movements at all reports agreement over four blocks neither
  // producer jointly saw. 10 §6.3 makes holes first-class; only mutually covered history can
  // be cross-checked.
  const early: SnapshotDocument = {
    ...validDocument(),
    coverage: [{ fromBlock: 10, toBlock: 11 }],
    ops: [{ kind: 'split', block: 10, vault: 'v1', account: 'alice', amount: '1000' }],
    balances: [
      { vault: 'v1', account: 'alice', branch: 'FAIL', amount: '1000' },
      { vault: 'v1', account: 'alice', branch: 'PASS', amount: '1000' },
    ],
  };
  const late: SnapshotDocument = {
    ...validDocument(),
    coverage: [{ fromBlock: 12, toBlock: 13 }],
    ops: [],
    balances: [],
  };
  assert.equal(admit(early).kind, 'admitted');
  assert.equal(admit(late).kind, 'admitted');
  const verdict = diffSnapshots(early, late);
  assert.equal(
    verdict.kind,
    'no-overlap',
    'no block is jointly observed, so nothing was compared — and nothing compared is not agreement',
  );
});

test('two identical movements in one block stay two — the diff is ordered, not keyed', () => {
  // A map keyed by the movement's identity collapses them, after which
  // `[split 100, split 200]` and `[split 50, split 200]` both project to `200` and the pair
  // reports agreement — defeating the only cross-check §8.4 offers for depth, in exactly the
  // case where a forger chooses the movements.
  const twice = (first: string): SnapshotDocument => ({
    ...validDocument(),
    range: { fromBlock: 10, toBlock: 10 },
    coverage: [{ fromBlock: 10, toBlock: 10 }],
    ops: [
      { kind: 'split', block: 10, vault: 'v1', account: 'alice', amount: first },
      { kind: 'split', block: 10, vault: 'v1', account: 'alice', amount: '200' },
    ],
    balances: [
      { vault: 'v1', account: 'alice', branch: 'FAIL', amount: String(BigInt(first) + 200n) },
      { vault: 'v1', account: 'alice', branch: 'PASS', amount: String(BigInt(first) + 200n) },
    ],
  });
  assert.equal(admit(twice('100')).kind, 'admitted');
  const verdict = diffSnapshots(twice('100'), twice('50'));
  assert.equal(verdict.kind, 'disagree');
  if (verdict.kind !== 'disagree') return;
  assert.equal(verdict.disagreements.length, 1);
  assert.equal(verdict.disagreements[0]?.at, 0, 'the FIRST movement is the one that differs');
});

test('a movement present in one snapshot and absent from the other is a disagreement', () => {
  const left = validDocument();
  const right: SnapshotDocument = { ...validDocument(), ops: validDocument().ops.slice(0, 3) };
  const verdict = diffSnapshots(left, right);
  assert.equal(verdict.kind, 'disagree');
  if (verdict.kind !== 'disagree') return;
  assert.equal(verdict.disagreements.length, 1);
  assert.equal(verdict.disagreements[0]!.right, undefined);
});

// ------------------------------------------------------------------ the refusal family

test('the FE-PROV family is exactly 001..004, each with copy and a recovery', () => {
  assert.deepEqual([...PROVIDER_REFUSAL_CODES], [
    'FE-PROV-001',
    'FE-PROV-002',
    'FE-PROV-003',
    'FE-PROV-004',
  ]);
});

test('FE-PROV-004 offers no resolution, because 10 §8.4 declines to have one', () => {
  // The disputed range is left as a labelled hole rather than resolved by majority — "two
  // producers cannot outvote the absence of a proof". Copy that calls a third snapshot the
  // thing that RESOLVES it invites exactly the 2-of-3 reading the table rejects, and would
  // have a user trust one side of an unprovable disagreement.
  const refusal = providerRefusal('FE-PROV-004', 'two producers disagree over blocks 1..100');
  assert.doesNotMatch(refusal.recovery, /resolves it/);
  assert.match(refusal.recovery, /not a decision|not proof/);
});

test('FE-PROV-003 promises that nothing was stored and nothing was deleted', () => {
  // §8.4's eviction preview runs *before* the import precisely so a rejected snapshot costs
  // the user nothing, and the copy is where that promise becomes visible.
  const verdict = admitSnapshot('{}', { expectedPin: 'x', binding: { ...BINDING } }, sha256);
  assert.equal(verdict.kind, 'rejected');
  if (verdict.kind !== 'rejected') return;
  assert.match(verdict.refusal.message, /nothing from it was stored/);
  assert.match(verdict.refusal.recovery, /Nothing local was deleted or replaced/);
  assert.match(verdict.refusal.recovery, /eviction preview runs before the import/);
});

test('FE-PROV-003\'s fixed copy names a "document" — 10 §8.5.2 routes a live page here too', () => {
  // The message and recovery are FIXED per code (§9.4), and since §8.5.2 a rejected `/range` page
  // carries this same code. Copy naming a *snapshot file*, a *download* or a *publisher* is
  // therefore false for half the failures that reach it — the defect that deleted the
  // `incomplete-check` cause on 2026-08-06, arriving from the other direction. Artifact-specific
  // advice belongs in the per-cause remedy, which is why `served-page` exists.
  const verdict = admitSnapshot('{}', { expectedPin: 'x', binding: { ...BINDING } }, sha256);
  assert.equal(verdict.kind, 'rejected');
  if (verdict.kind !== 'rejected') return;
  for (const fixed of [verdict.refusal.message, verdict.refusal.recovery]) {
    assert.doesNotMatch(fixed, /snapshot file|download|publisher/i);
  }
  assert.match(verdict.refusal.message, /document/i);

  // And the page cause carries advice a page's user can act on, with none of a file's in it.
  const page = snapshotRefusal('served-page', 'the page failed: coverage');
  assert.match(page.detail, /nothing to download again/);
  assert.match(page.detail, /no published hash/);
  assert.match(page.detail, /stay marked as not observed/);
});
