/**
 * The provider surface — 10 §8's mechanisms as screens (F23).
 *
 * Every test here is written against a **rendering that would be wrong**, because a happy-path
 * render of any of these surfaces passes either way. Three disciplines, each because the obvious
 * alternative is a suite that agrees with itself:
 *
 * - **Normative copy is bound to the document at test time.** `SAMPLING_GUARANTEE` is §8.4's own
 *   normative UI copy; a suite that restated it would certify a copy of a copy. Here the clauses
 *   are extracted from `docs/architecture/10-frontend-architecture.md` and the *rendered markup*
 *   is required to contain the constant verbatim, so document → constant → pixel is closed.
 * - **A rendered claim is bound to the mechanism that earns it.** `wouldBadgeSampled` is the
 *   predicate `mintSnapshotRows` applies, and the binding is a comparison of the two expressions
 *   parsed out of the two files — not a restatement. A screen free to say *"compared against the
 *   chain"* where the mint declined to write it is the mint's own brand defeated at the layer a
 *   user reads.
 * - **Every `SpotCheckReport` here is produced by `spotCheckSnapshot`.** The type is branded and
 *   cannot be written, which is deliberate and is also what makes these fixtures worth
 *   something: each of the five readings is driven out of the real walk by a real checker, so a
 *   reading no walk can produce would fail to have a fixture rather than being asserted anyway.
 *
 * @see docs/architecture/10-frontend-architecture.md §6.3, §8.1–§8.4
 * @see docs/architecture/15-invariants-and-testing.md §2 (INV-FE-3, INV-FE-12, INV-FE-13,
 *      INV-FE-15), §4.8
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  AGREEMENT_IS_NOT_PROOF,
  AWAITING_CHAIN_READ,
  AcceptInterstitial,
  CoverageView,
  CoveredHistoryDisclosure,
  CrossCheckView,
  EDGE_IS_NOT_A_VERDICT,
  EvictionPreview,
  FleetSummary,
  ImportOutcomeView,
  ImportProgress,
  NO_SUGGESTIONS,
  ProviderObjectAction,
  ProviderSettings,
  REACH_COPY,
  ReachDisclosure,
  SuggestionList,
  distinctSources,
  healthLine,
  reachReading,
  wouldBadgeSampled,
  type ReachReading,
} from '@bleavit/features-analysis';
import {
  SAMPLING_GUARANTEE,
  acceptSuggestion,
  admitSnapshot,
  canServeReads,
  canSupplyPinnedImport,
  disclosureFor,
  fleetState,
  mintSnapshotRows,
  planImport,
  previewCopy,
  providerRefusal,
  serializeSnapshot,
  snapshotPreimage,
  snapshotRefusal,
  spotCheckSnapshot,
  type AdmittedSnapshot,
  type ImportOutcome,
  type MintedImport,
  type Provider,
  type ProviderSuggestion,
  type SnapshotDocument,
  type SnapshotSpotCheck,
  type SpotCheckReport,
} from '@bleavit/providers';
import { boundarySet, providerRange } from '@bleavit/local-index';
import { selfRange } from '@bleavit/local-index/testing';
import type { ChartDiscardRecord, CoverageRange, CoveredHistory } from '@bleavit/local-index';
import { badgeCopyFor } from '@bleavit/ui';
// `finalize` is test-only on purpose (10 §2.1): `Finalized<T>` is mintable only inside
// `chain-client`, which is exactly what makes `onAct`'s parameter unreachable from a provider
// value in production.
import { finalize } from '@bleavit/chain-client/testing';
import type { FinalizedBlockRef } from '@bleavit/chain-client';
import type { Verified } from '@bleavit/shared-types';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..', '..');
const REPO = resolve(APP, '..');
const DOC10 = join(REPO, 'docs/architecture/10-frontend-architecture.md');

/** The one block every chain-read fixture here is pinned at. */
const AT: FinalizedBlockRef = {
  chain: `0x${'ce'.repeat(32)}`,
  blockHash: `0x${'de'.repeat(32)}`,
  blockNumber: 1_000_000,
};

const html = (node: Parameters<typeof renderToStaticMarkup>[0]): string =>
  renderToStaticMarkup(node);

/**
 * Whether a labelled button really carries the boolean `disabled` attribute.
 *
 * `/disabled/` is not the test — React always emits `aria-disabled`, so a bare substring match
 * is true of every button it renders. The boolean attribute is `disabled=""`, which is what a
 * browser honours. Each test using this also asserts it is *false* somewhere, so a helper that
 * had stopped matching could not pass by never firing.
 */
const buttonDisabled = (markup: string, label: string): boolean => {
  const tag = new RegExp(`<button[^>]*>${label}</button>`).exec(markup);
  assert.ok(tag !== null, `no button labelled "${label}" in:\n${markup}`);
  return / disabled=""/.test(tag[0]);
};

// ------------------------------------------------------------------ documents and checkers

const BINDING = { genesisHash: '0xabc', specVersion: 2, contractVersion: 28 } as const;

const sha256 = (preimage: Uint8Array): string =>
  createHash('sha256').update(preimage).digest('hex');

/** A document that covers `coverage` and claims no movement anywhere in it. */
function document(coverage: readonly { fromBlock: number; toBlock: number }[]): SnapshotDocument {
  const fromBlock = coverage.length === 0 ? 0 : Math.min(...coverage.map((r) => r.fromBlock));
  const toBlock = coverage.length === 0 ? 0 : Math.max(...coverage.map((r) => r.toBlock));
  return {
    format: 'bleavit.snapshot.v1',
    binding: BINDING,
    range: { fromBlock, toBlock },
    coverage,
    vaults: [],
    ops: [],
    balances: [],
  };
}

const AGREES: SnapshotSpotCheck = async () => ({ kind: 'agrees' });
const BELOW: SnapshotSpotCheck = async () => ({ kind: 'out-of-reach', where: 'below-window' });
const ABOVE: SnapshotSpotCheck = async () => ({ kind: 'out-of-reach', where: 'above-window' });

/**
 * One report per reading, each produced by the **real** walk.
 *
 * Built once and asserted to cover the whole of `ReachReading` below, so a reading added to the
 * union without a fixture fails rather than being silently untested.
 */
async function reports(): Promise<Readonly<Record<ReachReading, SpotCheckReport>>> {
  return {
    // Every covered block compared: the only reading that may be read as fully re-derived.
    'fully-re-derived': await spotCheckSnapshot(document([{ fromBlock: 10, toBlock: 12 }]), AGREES),
    // Admitted with **no** coverage. `checkCoverage` permits it, the walk yields nothing, and
    // the arm stays `whole-document` having compared nothing — see the module note on
    // `spot-check-reach.tsx`.
    'nothing-to-re-derive': await spotCheckSnapshot(document([]), AGREES),
    'blind-spot-permanent': await spotCheckSnapshot(
      document([{ fromBlock: 10, toBlock: 12 }]),
      BELOW,
    ),
    'blind-spot-transient': await spotCheckSnapshot(
      document([{ fromBlock: 10, toBlock: 12 }]),
      ABOVE,
    ),
    // The ceiling reached with nothing wrong with the file, in the configuration that produces
    // `compared: 0`: a device far enough behind that every ask is spent on blocks above its own
    // head and the readable ones below are never reached. Driven through the explicit ceiling
    // argument rather than by building a 512-block document.
    unfinished: await spotCheckSnapshot(document([{ fromBlock: 1, toBlock: 100 }]), ABOVE, 2),
  };
}

/**
 * A document through the **real** admission screens, which is the only way to reach the mint.
 *
 * `AdmittedSnapshot` carries a brand `snapshot.ts` alone can name, so a plausible object literal
 * is untypeable here — the same property `tests/providers` asserts with a `@ts-expect-error`.
 */
function admit(document: SnapshotDocument): AdmittedSnapshot {
  const verdict = admitSnapshot(
    serializeSnapshot(document),
    { expectedPin: sha256(snapshotPreimage(document)), binding: { ...BINDING } },
    sha256,
  );
  assert.equal(verdict.kind, 'admitted', JSON.stringify(verdict, null, 2));
  if (verdict.kind !== 'admitted') throw new Error('unreachable: the verdict is not admitted');
  return verdict;
}

/**
 * The rows `mintSnapshotRows` writes for one situation, with the report that earned them.
 *
 * Both halves come back because the badge and the disclosure must be about the **same** pass:
 * building the report here and the status by hand elsewhere is exactly how a badge assertion
 * stops being about the mint. The report runs over `admitted.document` rather than the document
 * literal, because the mint compares the two by reference.
 */
async function mintedFor(
  coverage: readonly { fromBlock: number; toBlock: number }[],
  check: SnapshotSpotCheck,
  ceiling?: number,
): Promise<{ readonly report: SpotCheckReport; readonly minted: MintedImport }> {
  const admitted = admit(document(coverage));
  const report = await spotCheckSnapshot(admitted.document, check, ceiling);
  const minted = mintSnapshotRows(admitted, report, {
    providerId: 'pub-1',
    pin: sha256(snapshotPreimage(admitted.document)),
    importedAt: 0,
  });
  return { report, minted };
}

/**
 * The three situations §8.4 leaves indistinguishable at the badge, each minted for real.
 *
 * The provider id is the same across all three deliberately: it is the badge's *other* channel,
 * so varying it would make the set size 3 for a reason that has nothing to do with the mint.
 */
async function collapsingCases(): Promise<
  readonly { readonly report: SpotCheckReport; readonly minted: MintedImport }[]
> {
  const permanent = await mintedFor([{ fromBlock: 10, toBlock: 12 }], BELOW);
  const transient = await mintedFor([{ fromBlock: 10, toBlock: 12 }], ABOVE);
  const unfinished = await mintedFor([{ fromBlock: 1, toBlock: 100 }], ABOVE, 2);
  // Named for their arms, and the arms are asserted, so a case that stopped producing the
  // situation it is named for fails here rather than testing a different one silently.
  assert.equal(permanent.report.reach, 'window-floor');
  assert.equal(transient.report.reach, 'above-window-only');
  assert.equal(unfinished.report.reach, 'ceiling');
  return [permanent, transient, unfinished];
}

// ------------------------------------------------------------------ §8.4's `reach`, all four arms

test('every reach arm the walk can produce has a fixture, and each reads as itself', async () => {
  const built = await reports();
  // The reports really came out of the walk with the arm each fixture is named for. A fixture
  // that stopped producing its arm would otherwise assert about a different situation.
  assert.equal(built['fully-re-derived'].reach, 'whole-document');
  assert.equal(built['nothing-to-re-derive'].reach, 'whole-document');
  assert.equal(built['blind-spot-permanent'].reach, 'window-floor');
  assert.equal(built['blind-spot-transient'].reach, 'above-window-only');
  assert.equal(built.unfinished.reach, 'ceiling');

  for (const [reading, report] of Object.entries(built)) {
    assert.equal(reachReading(report), reading, `${reading}'s fixture reads as something else`);
  }
  // The copy table covers exactly the readings, with no spare entry and none missing.
  assert.deepEqual(Object.keys(REACH_COPY).sort(), Object.keys(built).sort());
});

test('the four arms are not collapsed — five readings, five distinct renderings', async () => {
  const built = await reports();
  const rendered = new Map<string, string>();
  for (const [reading, report] of Object.entries(built)) {
    rendered.set(reading, html(h(ReachDisclosure, { report })));
  }
  const headings = [...Object.values(REACH_COPY)].map((copy) => copy.heading);
  assert.equal(new Set(headings).size, headings.length, 'two readings share a heading');

  // The pair that matters most: `window-floor` is permanent and `above-window-only` is
  // transient, and telling somebody a history can never be checked when their device is merely
  // behind is the substitution the fourth arm was added to prevent.
  const permanent = rendered.get('blind-spot-permanent') ?? '';
  const transient = rendered.get('blind-spot-transient') ?? '';
  assert.match(permanent, /data-gap="permanent"/);
  assert.match(transient, /data-gap="transient"/);
  assert.ok(
    permanent.includes('does not bring it back'),
    'the permanent blind spot does not say it is permanent',
  );
  assert.ok(
    transient.includes('caught up'),
    'the transient blind spot does not say the device catches up',
  );
  assert.ok(
    !transient.includes('does not bring it back'),
    'a device that is merely behind was told its history can never be checked',
  );
});

test('`whole-document` with nothing compared does NOT render as fully re-derived', async () => {
  // The hole the arm cannot express: `spotCheckSnapshot` only rewrites `whole-document` when
  // `outOfReach > 0`, so an admitted document covering no blocks ends here with
  // `compared: 0, outOfReach: 0` while the arm's own description claims *at least one was
  // compared*. A screen keyed on the arm alone tells the user their file was fully re-derived.
  const built = await reports();
  const empty = built['nothing-to-re-derive'];
  assert.equal(empty.reach, 'whole-document');
  assert.equal(empty.compared, 0);
  assert.equal(empty.outOfReach, 0);

  const markup = html(h(ReachDisclosure, { report: empty }));
  assert.match(markup, /data-reading="nothing-to-re-derive"/);
  assert.notEqual(
    REACH_COPY['nothing-to-re-derive'].heading,
    REACH_COPY['fully-re-derived'].heading,
  );
  assert.ok(
    !markup.includes(REACH_COPY['fully-re-derived'].heading),
    'a document covering no blocks was announced as fully re-derived',
  );
});

test('the three situations the row badge cannot tell apart are told apart here', async () => {
  // **Measured, not argued.** `provider` status carries exactly two per-row channels — the id
  // and `sampled` — so a row from an honest deep-history snapshot, a row from a document ahead
  // of this device's head, and a row from a pass that spent its whole ceiling above that head
  // all badge byte-identically: `unverified — X`, no spot-check clause, because all three have
  // `compared: 0` and therefore `sampled: false`.
  //
  // `SpotCheckReach` exists so those three stop collapsing, and it collapses again at the badge.
  // The third is the one that matters: F9 **admits** that document rather than refusing it, and
  // the justification for admitting is that the limit is disclosed. This test is what stops that
  // justification being circular — the disclosure has a consumer, and the consumer separates all
  // three.
  //
  // **The badge half is driven by `mintSnapshotRows` as of 2026-08-07, and the previous form
  // could not fail.** It called `badgeCopyFor(providerStatus('pub-1', wouldBadgeSampled(report)))`
  // three times with byte-identical arguments over a pure switch, so `badges.size` was 1
  // unconditionally and the message *"the three no longer share one badge"* described a state
  // the assertion could not reach: a third per-row channel would break that call site at
  // **compile** time, not here. Now each status is the one the real mint stamped onto the real
  // rows, so the assertion fails exactly when the mint starts distinguishing the three — which
  // is the finding it claims to guard.
  const cases = await collapsingCases();

  // First: the collapse is real. Every one of the three compares nothing, so the mint writes one
  // status for all three. If this stops holding the badge has gained a channel and this test
  // should be re-pointed rather than deleted.
  const badges = new Set<string>();
  for (const { report, minted } of cases) {
    assert.equal(report.compared, 0, 'a fixture for the collapsing set compared something');
    assert.equal(wouldBadgeSampled(report), false);
    assert.equal(minted.status.kind, 'provider');
    const copy = badgeCopyFor(minted.status);
    badges.add(`${copy.mark}||${copy.title}`);
    // Every row carries that same status, so the badge is a fact about the import and not about
    // whichever row a screen happened to render first.
    for (const row of minted.balances) assert.deepEqual(row.status, minted.status);
  }
  assert.equal(badges.size, 1, 'the three no longer share one badge — re-point this test');

  // Anti-vacuity for the assertion above: the badge really does have a second reading, so a set
  // of size 1 is a measurement rather than a property of `badgeCopyFor`. This is the status the
  // mint writes when a pass **did** compare, taken from the mint's own output on the one arm
  // that produces it.
  const compared = await mintedFor([{ fromBlock: 10, toBlock: 12 }], AGREES);
  const comparedCopy = badgeCopyFor(compared.minted.status);
  assert.equal(compared.report.reach, 'whole-document');
  assert.equal(wouldBadgeSampled(compared.report), true);
  assert.ok(
    !badges.has(`${comparedCopy.mark}||${comparedCopy.title}`),
    'a compared import badges exactly like one that compared nothing — the badge says nothing',
  );

  // Second: the disclosure separates them, three ways, in the arm, the reading and the copy.
  const collapsing = cases.map(({ report }) => report);
  const renderings = collapsing.map((report) => html(h(ReachDisclosure, { report })));
  assert.equal(new Set(collapsing.map((report) => report.reach)).size, 3);
  assert.equal(new Set(collapsing.map((report) => reachReading(report))).size, 3);
  assert.equal(new Set(renderings).size, 3, 'two of the three collapsing situations render alike');
  for (const [at, markup] of renderings.entries()) {
    // A checked access rather than `as SpotCheckReport`. The assertion only stripped the
    // `| undefined` that `noUncheckedIndexedAccess` adds — but it is the same mechanism a real
    // forgery of the brand uses, and `check:casts` cannot tell the two apart. Neither can a
    // reader, which is the better reason.
    const report = collapsing[at];
    assert.ok(report !== undefined);
    const own = REACH_COPY[reachReading(report)];
    assert.ok(markup.includes(own.heading), markup);
    for (const other of Object.values(REACH_COPY)) {
      if (other.heading === own.heading) continue;
      assert.ok(!markup.includes(other.heading), `situation ${at} also claimed another reading`);
    }
  }
});

test('a reach disclosure never shows its claim without the counts that are its basis', async () => {
  const built = await reports();
  for (const [reading, report] of Object.entries(built)) {
    const markup = html(h(ReachDisclosure, { report }));
    assert.ok(
      markup.includes(`Blocks compared against the chain: ${report.compared}`),
      `${reading} rendered a conclusion without saying how many blocks were compared`,
    );
    assert.ok(
      markup.includes(`could not reach: ${report.outOfReach}`),
      `${reading} rendered a conclusion without saying how many were unreachable`,
    );
  }
});

test('the surface may not claim a `sampled` badge the mint refused to write', async () => {
  // Bound to `mint.ts` by comparing the two **expressions**, not by restating one of them.
  // A gate that quoted the predicate would go on passing after the mint's changed.
  const mint = readFileSync(join(APP, 'packages/providers/src/mint.ts'), 'utf8');
  const mintExpr = /^\s*sampled:\s*(.+?),\s*$/m.exec(mint);
  assert.ok(mintExpr !== null, 'mint.ts no longer decides `sampled` where this expects it');

  const screen = readFileSync(join(APP, 'src/features/analysis/src/spot-check-reach.tsx'), 'utf8');
  const screenExpr = /export function wouldBadgeSampled[\s\S]*?return\s+(.+?);/.exec(screen);
  assert.ok(screenExpr !== null, 'wouldBadgeSampled no longer returns an expression');

  const normalise = (expression: string): string =>
    expression.replaceAll('spotCheck.', '').replaceAll('report.', '').replace(/\s+/g, ' ').trim();
  assert.equal(
    normalise(screenExpr[1] as string),
    normalise(mintExpr[1] as string),
    'the screen and the mint disagree about when rows are compared against the chain',
  );

  // …and the rendered sentence follows the predicate rather than the arm.
  const built = await reports();
  for (const [reading, report] of Object.entries(built)) {
    const markup = html(h(ReachDisclosure, { report }));
    const claims = markup.includes(
      'The imported rows are marked as having been compared against the chain.',
    );
    assert.equal(claims, wouldBadgeSampled(report), `${reading} rendered the wrong badge claim`);
  }
  // Anti-vacuity: the loop must have exercised both answers.
  const answers = new Set(Object.values(built).map((report) => wouldBadgeSampled(report)));
  assert.deepEqual([...answers].sort(), [false, true]);
});

// ------------------------------------------------------- §8.4's normative copy, as written

test('the guarantee reaches the pixel verbatim, and the constant is doc 10 §8.4’s own sentence', () => {
  // Document → constant. The same clause extraction `tests/providers` performs, repeated here
  // because what this suite certifies is the *rendering*, and a rendering of a drifted constant
  // is a drifted disclosure however faithful the render.
  const doc = readFileSync(DOC10, 'utf8');
  const bullet = doc
    .split('\n')
    .find((line) => line.includes('Honest guarantee statement (normative UI copy)'));
  assert.ok(bullet !== undefined, '10 §8.4 no longer states the guarantee where this expects it');
  for (const clause of [
    'malformed, internally inconsistent, and shallow forgeries',
    'catch liveness failures',
    'do not detect a self-consistent forgery of history at depths the light client cannot reach',
    'diffing two independent snapshot producers',
    'supports and recommends',
  ]) {
    assert.ok(bullet.includes(clause), `10 §8.4 no longer says "${clause}"`);
  }

  // **Constant → document**, added 2026-08-07 and the direction the loop above structurally
  // cannot see. That loop proves the *document* still says what this suite expects and asserts
  // nothing at all about the shipped string, so a noun substituted inside the constant passed
  // it — which has now happened twice, `labels` for `recommends` and then `sources` for
  // `snapshot producers`. Each phrase below must appear in **both** §8.4's bullet and
  // `SAMPLING_GUARANTEE`, so a widening on either side fails here instead of at a user.
  //
  // `snapshot producers` is the load-bearing one: `Provider.kind` is `snapshot | indexer` and
  // the settings panel is headed *"Optional data sources"*, so *"two independent sources"* named
  // a cross-check `FE-PROV-004` does not implement — it fires on two snapshots covering one
  // range, and two indexers produce nothing to diff.
  for (const phrase of [
    'two independent snapshot producers',
    'self-consistent forgery',
    'supports and recommends',
  ]) {
    assert.ok(bullet.includes(phrase), `10 §8.4 no longer says "${phrase}"`);
    assert.ok(
      SAMPLING_GUARANTEE.includes(phrase),
      `the shipped copy substituted for §8.4’s "${phrase}": ${SAMPLING_GUARANTEE}`,
    );
  }

  // Constant → pixel, on both surfaces §8.4's *"disclosed in the provider UI"* reaches.
  const panel = html(h(ProviderSettings, { providers: [], onEnable: () => {}, onDisable: () => {} }));
  assert.ok(panel.includes(SAMPLING_GUARANTEE), 'the settings panel paraphrased the guarantee');

  const report = spotCheckSnapshot(document([{ fromBlock: 1, toBlock: 1 }]), AGREES);
  return report.then((built) => {
    assert.ok(
      html(h(ReachDisclosure, { report: built })).includes(SAMPLING_GUARANTEE),
      'the depth disclosure paraphrased the guarantee',
    );
  });
});

// ------------------------------------------------------------------ §8.3's ladder and the fleet

const provider = (id: string, health: Provider['health']): Provider => ({
  id,
  kind: 'indexer',
  health,
});

test('every ladder state renders, carries a reason, and reports what it permits', () => {
  const states: readonly Provider[] = [
    provider('a', { kind: 'unprobed' }),
    provider('b', { kind: 'healthy' }),
    provider('c', { kind: 'slow', observedMs: 4_000 }),
    provider('d', { kind: 'failing', consecutiveFailures: 2, everAnswered: true }),
    provider('e', { kind: 'disabled', by: 'auto', cause: 'mismatch', reason: 'it contradicted the chain' }),
  ];
  for (const source of states) {
    const line = healthLine(source);
    assert.ok(line.detail.length > 0, `${line.state} renders no explanation`);
    // Read off the package's own predicates rather than restated, so a narrowing of §8.3's
    // *"only Disabled stops reads"* cannot be introduced here and agree with itself.
    assert.equal(line.serves, canServeReads(source), `${line.state} disagrees about reads`);
    assert.equal(line.mayImport, canSupplyPinnedImport(source), `${line.state} disagrees on import`);
  }
  // The one state where the two predicates differ, which is why there are two of them.
  const unprobed = healthLine(provider('a', { kind: 'unprobed' }));
  assert.equal(unprobed.serves, false);
  assert.equal(unprobed.mayImport, true);
  // `failing` serves: §8.3's own clause, and the narrowing this repository already made once.
  assert.equal(healthLine(provider('d', { kind: 'failing', consecutiveFailures: 2, everAnswered: true })).serves, true);

  const markup = html(
    h(ProviderSettings, { providers: states, onEnable: () => {}, onDisable: () => {} }),
  );
  // A disabled source's required reason reaches the screen. Without it the user reads a source
  // that vanished for no stated cause, and turns it back on.
  assert.ok(markup.includes('it contradicted the chain'), markup);
});

test('no sources enabled is §8.1’s posture, not an incident', () => {
  const markup = html(h(FleetSummary, { fleet: fleetState([]) }));
  assert.match(markup, /data-fleet="none-enabled"/);
  assert.ok(!/FE-PROV-/.test(markup), 'the default configuration rendered an error code');
  assert.match(markup, /data-severity="info"/);
});

test('every source switched off is FE-PROV-001, with every reason', () => {
  const fleet = fleetState([
    provider('a', { kind: 'disabled', by: 'auto', cause: 'liveness', reason: 'reason one' }),
    provider('b', { kind: 'disabled', by: 'user', reason: 'reason two' }),
  ]);
  const markup = html(h(FleetSummary, { fleet }));
  assert.match(markup, /data-fleet="all-down"/);
  assert.ok(markup.includes('FE-PROV-001'), markup);
  assert.ok(markup.includes('reason one') && markup.includes('reason two'), markup);
});

test('a fleet answering nothing does not render as N sources serving', () => {
  // The reading the `failing` count exists to prevent. §8.3 lets a `failing` source serve, so
  // three timed-out sources report `serving: 3` — and a panel showing only that number says
  // *3 sources serving* over a fleet that is answering nothing.
  const failing = [1, 2, 3].map((n) =>
    provider(`p${n}`, { kind: 'failing', consecutiveFailures: 2, everAnswered: true }),
  );
  const fleet = fleetState(failing);
  assert.equal(fleet.kind, 'serving');
  const markup = html(h(FleetSummary, { fleet }));
  assert.match(markup, /data-serving="3"/);
  assert.match(markup, /data-failing="3"/);
  assert.ok(markup.includes('so 0 are answering'), markup);
  assert.match(markup, /data-severity="caution"/);
  assert.ok(
    markup.includes('Every source that may be read is failing'),
    'a fleet answering nothing rendered under the healthy heading',
  );

  // The control: one healthy source among them, and the heading is the ordinary one.
  const mixed = fleetState([...failing, provider('ok', { kind: 'healthy' })]);
  const okMarkup = html(h(FleetSummary, { fleet: mixed }));
  assert.ok(okMarkup.includes('so 1 are answering'), okMarkup);
  assert.match(okMarkup, /data-severity="info"/);
});

// ------------------------------------------------------------------ §8.1's suggestions

const SUGGESTION: ProviderSuggestion = {
  id: 'example-indexer',
  kind: 'indexer',
  name: 'Example Indexer',
  operator: 'Example Operator',
  endpoint: 'https://example.invalid/indexer',
  why: 'reviewed for this release',
};

test('an empty suggestion list says why, and offers nothing to accept', () => {
  const markup = html(h(SuggestionList, { onReview: () => {} }));
  assert.ok(markup.includes(NO_SUGGESTIONS), markup);
  assert.ok(!/<button/.test(markup), 'an accept control appeared with nothing to accept');
});

test('the disclosure is rendered BEFORE the accept control, and is derived from the suggestion', () => {
  const markup = html(
    h(AcceptInterstitial, { suggestion: SUGGESTION, onAccept: () => {}, onCancel: () => {} }),
  );
  const disclosure = disclosureFor(SUGGESTION, 'reads-only');
  assert.ok(markup.includes(disclosure), 'the interstitial paraphrased §8.1’s disclosure');
  assert.ok(
    markup.indexOf(disclosure) < markup.indexOf('Turn this source on'),
    'the disclosure was rendered after the control that accepts it',
  );

  // Derived, not supplied: a second suggestion produces a second sentence from the same props.
  const other = { ...SUGGESTION, id: 'other', name: 'Other', operator: 'Someone Else' };
  const otherMarkup = html(
    h(AcceptInterstitial, { suggestion: other, onAccept: () => {}, onCancel: () => {} }),
  );
  assert.ok(otherMarkup.includes(disclosureFor(other, 'reads-only')), otherMarkup);
  assert.ok(!otherMarkup.includes(disclosure), 'the disclosure did not follow the suggestion');
});

test('accepting hands back the provider AND the sentence the user was shown', () => {
  const markup = html(
    h(AcceptInterstitial, { suggestion: SUGGESTION, onAccept: () => {}, onCancel: () => {} }),
  );
  assert.ok(markup.includes('Turn this source on'), markup);
  // The pair the screen's control produces, exercised through the same construction it calls.
  // A screen that stored only the provider could not record what the user agreed to.
  const accepted = acceptSuggestion(SUGGESTION, 'reads-only');
  assert.equal(accepted.provider.id, SUGGESTION.id);
  assert.equal(accepted.disclosure, disclosureFor(SUGGESTION, 'reads-only'));
  // §8.3's *"probe on enable"*: an accepted source cannot be read from until something asks it.
  assert.equal(accepted.provider.health.kind, 'unprobed');
  assert.equal(canServeReads(accepted.provider), false);
});

// ------------------------------------------------------------------ §8.4's import surface

test('an impossible eviction offers no way through, and a possible one does', () => {
  const footprint = [{ table: 'events', rows: 10, bytes: 900, oldestBlock: 1 }];
  const infeasible = planImport({ bytes: 5_000, rows: 10 }, footprint, 1_000);
  assert.equal(infeasible.infeasible, true);
  const refused = html(
    h(EvictionPreview, {
      plan: infeasible,
      copy: previewCopy(infeasible),
      onConfirm: () => {},
      onCancel: () => {},
    }),
  );
  assert.ok(
    !/<button[^>]*>Delete that and import<\/button>/.test(refused),
    'a confirm control was offered for an eviction that cannot succeed',
  );

  // The control, so the assertion above cannot pass by the label having been renamed.
  const feasible = planImport({ bytes: 200, rows: 10 }, footprint, 1_000);
  assert.equal(feasible.infeasible, false);
  const asked = html(
    h(EvictionPreview, {
      plan: feasible,
      copy: previewCopy(feasible),
      onConfirm: () => {},
      onCancel: () => {},
    }),
  );
  assert.ok(/<button[^>]*>Delete that and import<\/button>/.test(asked), asked);
});

test('the streamed progress states the row figure as an upper bound', () => {
  const markup = html(
    h(ImportProgress, {
      quota: { bytes: 1_024, rows: 40 },
      bounds: { maxBytes: 10_000, maxRows: 4_000_000 },
    }),
  );
  assert.match(markup, /data-bytes="1024"/);
  assert.ok(markup.includes('upper bound'), markup);
});

test('a declined import carries no FE-PROV code, and a rejected one carries its own', () => {
  const plan = planImport({ bytes: 1, rows: 1 }, [], 1_000);
  const declined: ImportOutcome = {
    kind: 'declined',
    why: 'user',
    plan,
    message: 'nothing was imported and nothing was deleted',
  };
  const declinedMarkup = html(h(ImportOutcomeView, { outcome: declined }));
  assert.ok(
    !/FE-PROV-/.test(declinedMarkup),
    'the user keeping their own history was reported as a snapshot error',
  );

  const rejected: ImportOutcome = {
    kind: 'rejected',
    refusal: snapshotRefusal('chain-disagreement', 'block 12 disagrees'),
    findings: [{ screen: 'spot-check', why: 'block 12 disagrees' }],
    provider: provider('p', { kind: 'disabled', by: 'auto', cause: 'mismatch', reason: 'caught' }),
    disabled: providerRefusal('FE-PROV-002', 'block 12 disagrees'),
  };
  const rejectedMarkup = html(h(ImportOutcomeView, { outcome: rejected }));
  // Two facts about two subjects. A screen showing only the first leaves a publisher caught
  // contradicting the chain still on the settings panel with nothing saying why it stopped.
  assert.ok(rejectedMarkup.includes('FE-PROV-003'), rejectedMarkup);
  assert.ok(rejectedMarkup.includes('FE-PROV-002'), rejectedMarkup);
  assert.ok(rejectedMarkup.includes('block 12 disagrees'), rejectedMarkup);

  // …and a rejection this device caused rather than the publisher leaves the source alone.
  const fileOnly: ImportOutcome = { ...rejected, disabled: undefined };
  const fileMarkup = html(h(ImportOutcomeView, { outcome: fileOnly }));
  assert.ok(fileMarkup.includes('FE-PROV-003'), fileMarkup);
  assert.ok(!fileMarkup.includes('FE-PROV-002'), 'a source was reported off for a file fault');
});

test('a successful import discloses its depth limit BEFORE it shows the rows', async () => {
  const built = await reports();
  const report = built['blind-spot-permanent'];
  const status = { kind: 'provider', providerId: 'pub-1', sampled: false } as const;
  const row: Verified<{
    origin: 'snapshot';
    providerId: string;
    vault: string;
    account: string;
    branch: string;
    amount: string;
  }> = {
    value: {
      origin: 'snapshot',
      providerId: 'pub-1',
      vault: 'v1',
      account: 'acct',
      branch: 'YES',
      amount: '1000',
    },
    status,
  };
  const minted: MintedImport = {
    coverage: [],
    balances: [row],
    status,
    record: { id: '0xpin', providerId: 'pub-1', importedAt: 1, fromBlock: 10, toBlock: 12 },
  };
  const outcome: ImportOutcome = {
    kind: 'imported',
    minted,
    plan: planImport({ bytes: 1, rows: 1 }, [], 1_000),
    quota: { bytes: 1, rows: 1 },
    spotCheck: report,
  };
  const markup = html(h(ImportOutcomeView, { outcome }));
  assert.ok(
    markup.indexOf('data-reach=') < markup.indexOf('Holdings this file supplied'),
    'the rows were shown before the disclosure of what was not checked',
  );
  // INV-FE-15's origin to the pixel: the badge is the mint's, per row.
  assert.match(markup, /data-status="provider"/);
  assert.ok(markup.includes('pub-1'), markup);
});

// ------------------------------------------------------------------ §8.4's two-snapshot diff

test('two snapshots that share no block are not reported as agreeing', () => {
  // `no-overlap` is its own discriminant precisely because the obvious
  // `if (kind === 'agree') showCrossChecked()` turns two producers who never covered a common
  // block into a check that passed. The assertion is on the **agree arm's own heading** rather
  // than on the word "agree", which this arm's copy legitimately contains twice while denying it.
  const AGREE_HEADING = 'Two snapshots describe this history the same way';
  const markup = html(h(CrossCheckView, { verdict: { kind: 'no-overlap' } }));
  assert.ok(!markup.includes(AGREEMENT_IS_NOT_PROOF), 'the agreement copy reached a vacuous diff');
  assert.ok(!markup.includes(AGREE_HEADING), `a vacuous diff was headed as agreement: ${markup}`);
  assert.ok(markup.includes('This is not agreement'), markup);
  assert.ok(markup.includes('nothing was compared'), markup);

  // The control, so the two assertions above cannot pass because the heading was renamed.
  const agreed = html(
    h(CrossCheckView, { verdict: { kind: 'agree', overlap: [{ fromBlock: 1, toBlock: 2 }] } }),
  );
  assert.ok(agreed.includes(AGREE_HEADING), agreed);
});

test('agreement is rendered as a comparison, not as verification', () => {
  const markup = html(
    h(CrossCheckView, {
      verdict: { kind: 'agree', overlap: [{ fromBlock: 10, toBlock: 20 }] },
    }),
  );
  assert.ok(markup.includes(AGREEMENT_IS_NOT_PROOF), markup);
  assert.ok(markup.includes('#10–#20'), markup);
  assert.ok(!/verified/i.test(markup), `a diff claimed verification: ${markup}`);
});

test('a disagreement flags the pair and offers no control that picks a side', () => {
  const markup = html(
    h(CrossCheckView, {
      verdict: {
        kind: 'disagree',
        refusal: providerRefusal('FE-PROV-004', '1 movement differs'),
        overlap: [{ fromBlock: 10, toBlock: 20 }],
        disagreements: [{ at: 0, left: 'a', right: 'b' }],
      },
    }),
  );
  assert.ok(markup.includes('FE-PROV-004'), markup);
  assert.ok(!/<button/.test(markup), `a control to resolve the disagreement appeared: ${markup}`);
});

// ------------------------------------------------------------------ §6.3's coverage and holes

const EDGE = { kind: 'unverifiable', genesisHash: '0xabc', why: 'imported from a snapshot' } as const;

/**
 * §6.3's **other** arm, and the one no coverage fixture here had until 2026-08-07.
 *
 * Every fixture used `EDGE` — including on a `self` range, which is a combination §6.3 does not
 * describe: the `unverifiable` arm is for *"a range minted from a provider"*, and a range this
 * device's own ingest produced has all three facts by construction. The wrong fixture is what
 * kept `edgeNote`'s `checked` branch unrendered by any test while it claimed the range had been
 * compared against the chain.
 */
const SELF_EDGE = {
  kind: 'checked',
  genesisHash: '0xabc',
  hash: `0x${'11'.repeat(32)}`,
  specVersion: 2,
} as const;

function history(ranges: readonly CoverageRange[]): CoveredHistory<readonly string[]> {
  const holes =
    ranges.length === 0 ? [{ fromBlock: 1, toBlock: 100 }] : [{ fromBlock: 21, toBlock: 29 }];
  return {
    covered: { data: [], span: { fromBlock: 1, toBlock: 100 }, ranges, holes },
    downsampled: [],
    chartDiscard: undefined,
  };
}

test('a coverage summary names its distinct sources rather than counting gaps', () => {
  const ranges = [
    providerRange('snapshot', 'pub-1', 1, 20, 0, EDGE),
    providerRange('operator', 'op-1', 30, 40, 0, EDGE),
    providerRange('snapshot', 'pub-1', 50, 60, 0, EDGE),
    selfRange(70, 80, 0, SELF_EDGE),
  ];
  // The order is `boundarySet`'s sort over its own tokens — `operator:op-1`, `self`,
  // `snapshot:pub-1` — which is where the set is now decided (10 §6.3 has one boundary-set rule
  // and this module used to carry a second implementation of it). Only the **words** are this
  // module's, which is why `self` lands between the two provider names rather than last.
  assert.deepEqual(distinctSources(ranges), [
    'operator: op-1',
    'this device’s own light client',
    'snapshot: pub-1',
  ]);
  // Bound to the package's own answer rather than to a list written here, so the delegation is
  // the assertion: a re-implemented walk that agreed on this fixture would not survive it.
  assert.deepEqual(
    distinctSources(ranges).length,
    boundarySet(ranges).length,
    'the rendered set is not the boundary set',
  );

  const markup = html(h(CoverageView, { answer: history(ranges), caption: 'Price history' }));
  assert.match(markup, /data-sources="3"/);
  assert.ok(markup.includes('snapshot: pub-1') && markup.includes('operator: op-1'), markup);
  // Never merged across a provenance boundary: four ranges stay four rows.
  assert.match(markup, /data-ranges="4"/);
});

test('a `checked` edge says what it records, never that the range was compared', () => {
  // **The blocker this test was written for.** §6.3 defines the `checked` arm as *"all three
  // facts, all three checks **can** run"* — falsifiable, not compared — and the verdict of an
  // actual comparison lives in `CoverageVerification`, which `CoveredHistory` does not carry.
  // The column read *"…and both are checked against the chain"*, which is the `ok` verdict §6.3
  // forbids inferring, and since nothing pins a genesis every range in fact verdicts
  // `unchecked`: the same range read as *"Ranges this client could not check"* on F25's boot
  // surface and as *checked against the chain* here.
  const ranges = [selfRange(70, 80, 0, SELF_EDGE), providerRange('snapshot', 'pub-1', 1, 20, 0, EDGE)];
  const markup = html(h(CoverageView, { answer: history(ranges), caption: 'Price history' }));

  // What the arm permits, stated as a capability.
  assert.ok(markup.includes('can be compared against the chain'), markup);
  assert.ok(markup.includes('the block hash and the runtime version'), markup);
  // …and never as a result. This is the assertion the wrong fixture hid: with every range
  // carrying an `unverifiable` edge, no test rendered this branch at all.
  assert.ok(
    !/(is|are|was|were|been) (checked|compared) against the chain/.test(markup),
    `the edge column claimed a comparison no field in this answer records:\n${markup}`,
  );
  assert.ok(markup.includes(EDGE_IS_NOT_A_VERDICT), markup);
  assert.ok(markup.includes('What its edge records'), markup);

  // The other arm keeps the genesis binding — §6.3's one check that still runs on a provider
  // range — and names the reason the other two facts are absent.
  assert.ok(markup.includes('a genesis binding only'), markup);
  assert.ok(markup.includes('imported from a snapshot'), markup);
});

test('a hole is rendered as a gap with an explainer, never elided', () => {
  const markup = html(
    h(CoverageView, {
      answer: history([providerRange('snapshot', 'pub-1', 1, 20, 0, EDGE)]),
      caption: 'Price history',
    }),
  );
  assert.match(markup, /data-holes="1"/);
  // The gap and its explainer come from F25's one reader, so the span and the sentence are that
  // module's rather than a second spelling written here.
  assert.ok(markup.includes('data-disclosure="history-holes"'), markup);
  assert.ok(markup.includes('21..29'), markup);
  assert.ok(markup.includes('never drawn'), markup);
});

// ------------------------------------------------- the migration discard has one renderer

/** The discard record, with only its span varying — the field the two branches disagreed on. */
const discard = (span: ChartDiscardRecord['span']): ChartDiscardRecord => ({
  fromSchema: 1,
  toSchema: 3,
  tables: ['priceSamples'],
  rows: 12,
  span,
  at: 0,
  detail: 'the chart tables were rekeyed and emptied',
});

/** A covered answer whose only disclosure is the discard: no holes, nothing folded. */
const onlyDiscard = (span: ChartDiscardRecord['span']): CoveredHistory<readonly string[]> => ({
  covered: {
    data: [],
    span: { fromBlock: 1, toBlock: 100 },
    ranges: [providerRange('snapshot', 'pub-1', 1, 100, 0, EDGE)],
    holes: [],
  },
  downsampled: [],
  chartDiscard: discard(span),
});

test('the coverage view shows the discard through F25’s renderer, not a second one', () => {
  // This surface used to render the record itself, in its own words, and read the span as two
  // states — an absent block pair meant "a span this device can no longer name". `ChartDiscardSpan`
  // was split into three arms precisely because that reading is wrong in one direction whichever
  // way it falls: `none` is the ordinary state of a client that has charted nothing and
  // `unreadable` is the corruption event INV-FE-7 expects, so one encoding for both either
  // announces a corruption that did not happen or hides one that did.
  //
  // The stronger reason for one renderer is 10 §9.4: `FE-IDX-002` has no fixed copy yet (SQ-604,
  // SQ-783, SQ-820, SQ-821), and the sentence this file used to render was that missing copy
  // written anyway — a confident claim with no authority behind it, beside a slot whose whole
  // job is to say the wording does not exist.
  const answer = onlyDiscard({ kind: 'named', fromBlock: 1, toBlock: 900 });
  const markup = html(h(CoverageView, { answer, caption: 'Price history' }));

  // Byte-for-byte the same element the disclosure surface renders for the same record. A second
  // renderer agreeing today would not survive this; a second renderer at all is caught in
  // `index-disclosure.test.ts`, which asserts the record is named in exactly one module.
  const alone = html(h(CoveredHistoryDisclosure, { history: answer }));
  assert.ok(alone.includes('data-disclosure="chart-rows-discarded"'), alone);
  assert.ok(markup.includes(alone), `the coverage view renders its own discard:\n${markup}`);

  // The record's own fields reach the screen, and the copy slot says it is a slot.
  assert.ok(markup.includes('priceSamples'), markup);
  assert.ok(markup.includes('1..900'), markup);
  assert.ok(markup.includes('data-awaiting="FE-IDX-002"'), markup);
});

test('a client that charted nothing is not reported as one whose coverage is unreadable', () => {
  // The exact conflation the three-arm span exists to prevent, asserted at the pixel on the
  // surface that used to make it.
  const named = html(
    h(CoverageView, {
      answer: onlyDiscard({ kind: 'named', fromBlock: 1, toBlock: 900 }),
      caption: 'Price history',
    }),
  );
  const none = html(
    h(CoverageView, { answer: onlyDiscard({ kind: 'none' }), caption: 'Price history' }),
  );
  const unreadable = html(
    h(CoverageView, { answer: onlyDiscard({ kind: 'unreadable' }), caption: 'Price history' }),
  );

  assert.notEqual(none, unreadable);
  assert.notEqual(named, none);
  assert.ok(named.includes('1..900'), named);
  assert.ok(none.includes('no blocks were covered'), none);
  assert.ok(unreadable.includes('could not be read'), unreadable);
  // The direction that announces a corruption that did not happen.
  assert.ok(!none.includes('could not be read'), `an ordinary empty client was reported corrupt: ${none}`);
  assert.ok(!none.includes('cannot be named'), `an ordinary empty client was reported corrupt: ${none}`);
  // And the direction that hides one that did.
  assert.ok(
    !unreadable.includes('no blocks were covered'),
    `an unreadable coverage row was reported as an empty index: ${unreadable}`,
  );
});

// ------------------------------------------------------------------ INV-FE-3's actionable object

test('an action over a provider-supplied object is disabled until the chain answers', () => {
  const supplied: Verified<string> = {
    value: 'proposal-42',
    status: { kind: 'provider', providerId: 'pub-1', sampled: false },
  };
  const props = {
    supplied,
    render: (value: string) => value,
    agrees: (a: string, b: string) => a === b,
    label: 'Redeem',
    name: 'Proposal',
    onAct: () => {},
  };
  const waiting = html(h(ProviderObjectAction<string>, { ...props, chainRead: undefined }));
  assert.equal(buttonDisabled(waiting, 'Redeem'), true);
  assert.ok(waiting.includes(AWAITING_CHAIN_READ), waiting);
  assert.match(waiting, /data-confirmed="false"/);

  // The control, so the assertion above is not passing because nothing renders a button.
  const chainRead = finalize('proposal-42', AT);
  const enabled = html(h(ProviderObjectAction<string>, { ...props, chainRead }));
  assert.equal(buttonDisabled(enabled, 'Redeem'), false);
  assert.match(enabled, /data-confirmed="true"/);
  assert.match(enabled, /data-status="verified-finalized"/);
  assert.match(enabled, /data-status="provider"/);
});

test('the action receives the CHAIN value, and the provider value has no path to it', () => {
  const supplied: Verified<string> = {
    value: 'what the source said',
    status: { kind: 'provider', providerId: 'pub-1', sampled: false },
  };
  const chainRead = finalize('what the chain said', AT);

  // The structural half, which no render can demonstrate: `onAct` takes `Finalized<T>`, whose
  // brand lives in `chain-client` and which a provider value cannot inhabit. Asserted on the
  // declaration, because a screen that happened to pass the right value today is a screen one
  // edit away from passing the other one.
  const source = readFileSync(join(APP, 'src/features/analysis/src/provider-action.tsx'), 'utf8');
  const declaration = /readonly onAct: \(([^)]*)\) => void;/.exec(source);
  assert.ok(declaration !== null, 'the action callback is no longer declared where this expects');
  assert.match(declaration[1] as string, /Finalized<T>/);
  assert.ok(
    !/onAct\(supplied/.test(source),
    'the provider-supplied value is passed to the action',
  );

  const markup = html(
    h(ProviderObjectAction<string>, {
      supplied,
      chainRead,
      render: (value: string) => value,
      agrees: (a: string, b: string) => a === b,
      label: 'Act',
      name: 'Thing',
      onAct: () => {},
    }),
  );
  // Both are on screen, differently badged, and the disagreement is stated rather than hidden.
  assert.match(markup, /data-disagreed="true"/);
  assert.ok(markup.includes('what the source said') && markup.includes('what the chain said'));
});
