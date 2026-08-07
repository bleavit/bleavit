/**
 * The live-indexer wire, both ends — 10 §8.5.2, INV-FE-15 (F24).
 *
 * Four properties carry this suite, and none of them is the happy path.
 *
 * **Coverage comes from the documents, never from the cursor.** A server that stops offering pages
 * is making a claim, of exactly the kind §8.5.1 refuses to accept from `storageDone`. So the tests
 * that matter most hand the client a page set whose coverage lists do *not* cover what was asked
 * for, and require that the read says so — a reader that trusted the cursor would report an
 * `observed` span it never observed, which is the accidental forgery §8.2 exists to prevent and
 * which passes every screen in §8.4 because the movements it does carry are consistent.
 *
 * **A page is checked against itself, and against the chain — never against a history it does not
 * carry.** That is §8.5.2's own sentence, ruled 2026-08-07, and it is the reason `admitIndexerPage`
 * exists beside `admitSnapshot`: a page owes canonical form, §8.2's ordering rules, monotone
 * coverage, the chain binding and the pin, and it owes **neither** §8.4's conservation replay
 * **nor** its event↔derived-row agreement. The suite asserts that as a *contrast* — the same bytes
 * go through both entry points, and only the snapshot one refuses them. A suite that asserted the
 * new behaviour alone could show a screen was removed, never that it was relocated.
 *
 * **The error contract is that there is none, and the outcomes split on evidence rather than on
 * vocabulary.** No operator implements an error body and nothing here parses one. What the client
 * distinguishes is what it observed: a read that produced no document (`unreachable`, and no
 * refusal code, because `FE-PROV-003`'s fixed remedy is about a download that never happened), a
 * document that failed a screen a page owes (`rejected`, carrying `FE-PROV-003`), and a document
 * proving the source cannot serve this client at all (`disqualified` — the one arm that reaches
 * §8.3's ladder, §8.5.3).
 *
 * **The cursor is opaque.** The URLs the walk issues are recorded and asserted: the first carries no
 * cursor at all, and every later one carries exactly the token the previous response gave, encoded
 * for transport and otherwise untouched. A client that could construct a cursor is a client that
 * could walk past what a server actually offered.
 *
 * The reference implementation in `app/optional/indexer/` is exercised through the same client —
 * over an injected transport for the route logic, and over a real loopback socket for the round
 * trip — because a server checked against a hand-written expectation of what the client checks is a
 * server checked against a belief.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  NEXT_CURSOR_HEADER,
  SNAPSHOT_FORMAT,
  admitIndexerPage,
  admitSnapshot,
  coverageHoles,
  ladderEffect,
  deriveBalances,
  mergeCoverage,
  preimageOfSerialized,
  readChain,
  readRange,
  samplingPages,
  serializeSnapshot,
} from '@bleavit/providers';
import type {
  IndexerGet,
  IndexerSource,
  ProviderRow,
  SnapshotBalance,
  SnapshotDocument,
  SnapshotFinding,
  SnapshotOp,
  SnapshotRange,
  SnapshotVault,
} from '@bleavit/providers';

import { createIndexer, foldedSlice, stateSlice } from '../../optional/indexer/indexer.ts';
import { startIndexer } from '../../optional/indexer/serve.ts';

const sha256 = (preimage: Uint8Array): string =>
  createHash('sha256').update(preimage).digest('hex');

const BINDING = { genesisHash: '0xfeed', specVersion: 2, contractVersion: 23 } as const;
const ENDPOINT = 'https://indexer.example';

const VAULTS: readonly SnapshotVault[] = [{ vault: 'v1', branches: ['FAIL', 'PASS'] }];

/** A movement per block, so a page's coverage and its ops can be varied independently. */
function split(block: number, account: string, amount: string): SnapshotOp {
  return { kind: 'split', block, vault: 'v1', account, amount };
}

/** A page as an operator would serve it: the fold of its own ops, in canonical form. */
function document(
  range: SnapshotRange,
  coverage: readonly SnapshotRange[],
  ops: readonly SnapshotOp[],
): SnapshotDocument {
  return {
    format: SNAPSHOT_FORMAT,
    binding: { ...BINDING },
    range,
    coverage,
    vaults: VAULTS,
    ops,
    balances: deriveBalances(VAULTS, ops),
  };
}

function page(
  range: SnapshotRange,
  coverage: readonly SnapshotRange[],
  ops: readonly SnapshotOp[],
): string {
  return serializeSnapshot(document(range, coverage, ops));
}

/**
 * The admission a **live page** carries: the digest of the bytes just received.
 *
 * There is no publisher pin on this route — a snapshot is a file somebody published and quoted a
 * hash for, a page is bytes served now — so the pin screen is satisfied by construction and the
 * digest is reported rather than compared (10 §8.5.2). Written once here so that no test can make
 * the pin screen the accidental reason a fixture was refused.
 */
function admissionOf(body: string) {
  return { expectedPin: sha256(preimageOfSerialized(body)), binding: { ...BINDING } };
}

/**
 * Which screens a verdict names, as a set.
 *
 * A set rather than a boolean, and rather than `findings.some(…)`, because after 10 §8.5.2's ruling
 * the property under test is *which* screen fired and not merely *that* one did. `some` cannot
 * distinguish a body refused on the screen it was built to break from one refused for a second
 * reason the fixture acquired by accident — and once a screen is removed from a route, that is
 * exactly the distinction the suite has to be able to make. `SnapshotFinding` names its screen for
 * this reason (10 §8.4, and the corpus note in `snapshot.test.ts`).
 */
function screensNamed(
  verdict:
    | { readonly kind: 'admitted' }
    | { readonly kind: 'rejected'; readonly findings: readonly SnapshotFinding[] },
): ReadonlySet<SnapshotFinding['screen']> {
  if (verdict.kind === 'admitted') return new Set<SnapshotFinding['screen']>();
  return new Set(verdict.findings.map((finding) => finding.screen));
}

// ------------------------------------------------------------------ the transport, faked

interface Served {
  readonly status: number;
  readonly body: string;
  /** What the response puts in the cursor header. `null` is an absent header. */
  readonly cursor: string | null;
}

function ok(body: string, cursor: string | null = null): Served {
  return { status: 200, body, cursor };
}

interface Transport {
  readonly source: IndexerSource;
  readonly urls: readonly string[];
  /** True when the walk asked for more answers than the test supplied — a test defect, not a read. */
  exhausted: boolean;
}

/**
 * A transport that answers a fixed script.
 *
 * It records every URL, because the cursor discipline is a property of the **requests** and no
 * assertion about the result can see it. Running out of answers is recorded rather than thrown:
 * `readRange` catches a throwing transport by design, so an exception here would be reported as a
 * failed read and the test would pass for the wrong reason.
 */
function transport(answers: readonly Served[], endpoint = ENDPOINT): Transport {
  const urls: string[] = [];
  let at = 0;
  const state = { exhausted: false };
  const get: IndexerGet = (url) => {
    urls.push(url);
    const answer = answers[at];
    at += 1;
    if (answer === undefined) {
      state.exhausted = true;
      return Promise.resolve({ status: 599, body: '', header: () => null });
    }
    return Promise.resolve({
      status: answer.status,
      body: answer.body,
      header: (name: string) => (name === NEXT_CURSOR_HEADER ? answer.cursor : null),
    });
  };
  return {
    source: { endpoint, get, binding: { ...BINDING } },
    urls,
    get exhausted(): boolean {
      return state.exhausted;
    },
  };
}

/** A transport that never runs out: every page offers a fresh cursor. For the ceiling test. */
function endlessTransport(body: string): Transport {
  const urls: string[] = [];
  let at = 0;
  const get: IndexerGet = (url) => {
    urls.push(url);
    at += 1;
    return Promise.resolve({
      status: 200,
      body,
      header: (name: string) => (name === NEXT_CURSOR_HEADER ? `token-${at}` : null),
    });
  };
  return { source: { endpoint: ENDPOINT, get, binding: { ...BINDING } }, urls, exhausted: false };
}

// ------------------------------------------------------------------ coverage arithmetic

test('mergeCoverage gives one covered set exactly one spelling', () => {
  // §8.2: "ordered, non-overlapping and maximally merged". Adjacent joins, overlapping joins, and
  // the input order does not matter — two honest producers of one history emit one list.
  assert.deepEqual(
    mergeCoverage([
      { fromBlock: 11, toBlock: 20 },
      { fromBlock: 1, toBlock: 10 },
    ]),
    [{ fromBlock: 1, toBlock: 20 }],
  );
  assert.deepEqual(
    mergeCoverage([
      { fromBlock: 1, toBlock: 10 },
      { fromBlock: 5, toBlock: 12 },
    ]),
    [{ fromBlock: 1, toBlock: 12 }],
  );
  assert.deepEqual(
    mergeCoverage([
      { fromBlock: 1, toBlock: 10 },
      { fromBlock: 12, toBlock: 20 },
    ]),
    [
      { fromBlock: 1, toBlock: 10 },
      { fromBlock: 12, toBlock: 20 },
    ],
  );
});

test('an inverted coverage range throws rather than being dropped', () => {
  // Dropping it shrinks a coverage claim silently, and a shrunk claim reads as "never served" in
  // the one module whose job is to say what was.
  assert.throws(() => mergeCoverage([{ fromBlock: 20, toBlock: 10 }]), RangeError);
  assert.throws(() => coverageHoles({ fromBlock: 20, toBlock: 10 }, []), RangeError);
});

test('coverageHoles is exact at both edges', () => {
  const span = { fromBlock: 10, toBlock: 20 };
  assert.deepEqual(coverageHoles(span, [{ fromBlock: 10, toBlock: 20 }]), []);
  assert.deepEqual(coverageHoles(span, []), [{ fromBlock: 10, toBlock: 20 }]);
  assert.deepEqual(coverageHoles(span, [{ fromBlock: 12, toBlock: 18 }]), [
    { fromBlock: 10, toBlock: 11 },
    { fromBlock: 19, toBlock: 20 },
  ]);
  // Coverage reaching outside the span contributes only what is inside it.
  assert.deepEqual(coverageHoles(span, [{ fromBlock: 1, toBlock: 14 }]), [
    { fromBlock: 15, toBlock: 20 },
  ]);
});

// ------------------------------------------------------------------ GET /chain

test('GET /chain answers the binding and the served coverage', async () => {
  const body = JSON.stringify({ ...BINDING, coverage: [{ fromBlock: 10, toBlock: 20 }] });
  const wire = transport([ok(body)]);
  const answer = await readChain(wire.source);
  assert.equal(answer.kind, 'answered');
  if (answer.kind !== 'answered') return;
  assert.deepEqual(answer.binding, { ...BINDING });
  assert.deepEqual(answer.coverage, [{ fromBlock: 10, toBlock: 20 }]);
  assert.deepEqual(wire.urls, [`${ENDPOINT}/chain`]);
});

test('a trailing slash on the endpoint does not double the path separator', async () => {
  const body = JSON.stringify({ ...BINDING, coverage: [] });
  const wire = transport([ok(body), ok(page({ fromBlock: 1, toBlock: 1 }, [], []))], `${ENDPOINT}//`);
  await readChain(wire.source);
  await readRange(wire.source, { fromBlock: 1, toBlock: 1 }, sha256);
  assert.deepEqual(wire.urls, [`${ENDPOINT}/chain`, `${ENDPOINT}/range?from=1&to=1`]);
});

test('GET /chain: any status other than 200 is a failed read', async () => {
  for (const status of [204, 301, 404, 429, 500, 503]) {
    const wire = transport([{ status, body: '{}', cursor: null }]);
    const answer = await readChain(wire.source);
    assert.equal(answer.kind, 'failed', `status ${status} must not answer`);
  }
});

test('GET /chain: another chain DISQUALIFIES the source — it does not merely fail', async () => {
  // §8.5.3: a source describing another chain can never serve a usable row. It asserted `failed`
  // until 2026-08-07, and `failed` is the LIVENESS arm — counted, non-terminal, and `failing`
  // serves. So the strongest correctness evidence available was landing on the ladder rung that
  // still permits reads. `disqualified` is terminal and `ladderEffect` carries it there.
  const body = JSON.stringify({ ...BINDING, genesisHash: '0xbeef', coverage: [] });
  const answer = await readChain(transport([ok(body)]).source);
  assert.equal(answer.kind, 'disqualified');
  if (answer.kind !== 'disqualified') return;
  assert.match(answer.why, /0xbeef/);
  assert.match(answer.why, /0xfeed/);
  assert.deepEqual(ladderEffect(answer), { kind: 'disqualified', why: answer.why });
});

test('GET /chain: a body that is not a binding is a failed read', async () => {
  const bodies = [
    'not json at all',
    '[]',
    '"a string"',
    JSON.stringify({ specVersion: 2, contractVersion: 23, coverage: [] }),
    JSON.stringify({ ...BINDING, specVersion: '2', coverage: [] }),
    JSON.stringify({ ...BINDING }),
    JSON.stringify({ ...BINDING, coverage: [{ fromBlock: 10 }] }),
  ];
  for (const body of bodies) {
    const answer = await readChain(transport([ok(body)]).source);
    assert.equal(answer.kind, 'failed', `${body} must not answer`);
  }
});

test('GET /chain: a coverage list that is not maximally merged is a failed read', async () => {
  // Merging it here would accept two spellings of one covered set from the route whose entire job
  // is to state it once (§8.2, §8.5.2).
  for (const coverage of [
    [
      { fromBlock: 1, toBlock: 10 },
      { fromBlock: 11, toBlock: 20 },
    ],
    [
      { fromBlock: 11, toBlock: 20 },
      { fromBlock: 1, toBlock: 10 },
    ],
    [
      { fromBlock: 1, toBlock: 10 },
      { fromBlock: 5, toBlock: 20 },
    ],
    [{ fromBlock: 20, toBlock: 10 }],
  ]) {
    const answer = await readChain(transport([ok(JSON.stringify({ ...BINDING, coverage }))]).source);
    assert.equal(answer.kind, 'failed', `${JSON.stringify(coverage)} must not answer`);
  }
});

test('GET /chain: a transport that rejects is a failed read, never an exception', async () => {
  const source: IndexerSource = {
    endpoint: ENDPOINT,
    get: () => Promise.reject(new Error('ECONNREFUSED')),
    binding: { ...BINDING },
  };
  const answer = await readChain(source);
  assert.equal(answer.kind, 'failed');
  if (answer.kind !== 'failed') return;
  assert.match(answer.why, /ECONNREFUSED/);
});

test('an endpoint that is not http(s) is refused before the transport sees it', async () => {
  for (const endpoint of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/plain,x', 'nonsense']) {
    let asked = false;
    const source: IndexerSource = {
      endpoint,
      get: () => {
        asked = true;
        return Promise.resolve({ status: 200, body: '{}', header: () => null });
      },
      binding: { ...BINDING },
    };
    const answer = await readChain(source);
    assert.equal(answer.kind, 'failed', `${endpoint} must be refused`);
    assert.equal(asked, false, `${endpoint} must never reach the transport`);
  }
});

// ------------------------------------------------- GET /range: coverage comes from the documents

test('a single page covering the whole span leaves no hole', async () => {
  const span = { fromBlock: 10, toBlock: 12 };
  const wire = transport([ok(page(span, [span], [split(10, 'alice', '1000')]))]);
  const read = await readRange(wire.source, span, sha256);
  assert.equal(read.outcome.kind, 'exhausted');
  assert.deepEqual(read.coverage, [span]);
  assert.deepEqual(read.holes, []);
  assert.equal(read.pages.length, 1);
  assert.equal(wire.exhausted, false);
});

test('PAGES THAT DO NOT COVER THE SPAN ARE NOT REPORTED AS COVERING IT', async () => {
  // The property §8.5.2 states and the one a reader loses by accident: "absence of `nextCursor` is
  // the same kind of server claim as `storageDone`, so what the client believes it has is the union
  // of the coverage lists the pages actually carried". Here the server answers one page over
  // 10..12, offers no further cursor, and the request was for 10..20. A reader that took the
  // absent cursor as "that is everything" would report 10..20 as covered — history it never saw,
  // consistent in every movement it does carry, invisible to every screen in §8.4.
  const span = { fromBlock: 10, toBlock: 20 };
  const served = { fromBlock: 10, toBlock: 12 };
  const wire = transport([ok(page(served, [served], [split(10, 'alice', '1000')]))]);
  const read = await readRange(wire.source, span, sha256);

  assert.equal(read.outcome.kind, 'exhausted', 'the server did claim there was nothing more');
  assert.deepEqual(read.coverage, [served]);
  assert.deepEqual(read.holes, [{ fromBlock: 13, toBlock: 20 }]);
  assert.notDeepEqual(read.coverage, [span]);
});

test('a hole inside a page survives into the read', async () => {
  // A page may legitimately observe part of its own span. The gap is a rendered fact (10 §6.3),
  // and a reader that reported the page's `range` instead of its `coverage` would erase it.
  const span = { fromBlock: 10, toBlock: 20 };
  const observed = [
    { fromBlock: 10, toBlock: 12 },
    { fromBlock: 18, toBlock: 20 },
  ];
  const wire = transport([ok(page(span, observed, [split(10, 'alice', '1000')]))]);
  const read = await readRange(wire.source, span, sha256);
  assert.deepEqual(read.coverage, observed);
  assert.deepEqual(read.holes, [{ fromBlock: 13, toBlock: 17 }]);
});

test('a multi-page walk unions the coverage the pages carried', async () => {
  const span = { fromBlock: 10, toBlock: 20 };
  const first = { fromBlock: 10, toBlock: 14 };
  const second = { fromBlock: 15, toBlock: 20 };
  const wire = transport([
    ok(page(first, [first], [split(10, 'alice', '1000')]), 'c1'),
    ok(page(second, [second], [split(16, 'bob', '500')])),
  ]);
  const read = await readRange(wire.source, span, sha256);
  assert.equal(read.outcome.kind, 'exhausted');
  assert.equal(read.pages.length, 2);
  // Adjacent ranges from two pages merge into §8.2's one spelling.
  assert.deepEqual(read.coverage, [span]);
  assert.deepEqual(read.holes, []);
  assert.equal(wire.exhausted, false);
});

test('a walk that fails part-way keeps the pages that arrived', async () => {
  // Discarding coverage the client already received because a later page failed would lose blocks
  // that were never in doubt, and make a retry the only way to get them back. §8.3's ladder counts
  // the failure; the pages are still pages.
  const span = { fromBlock: 10, toBlock: 20 };
  const first = { fromBlock: 10, toBlock: 14 };
  const wire = transport([
    ok(page(first, [first], [split(10, 'alice', '1000')]), 'c1'),
    { status: 500, body: 'the index is down', cursor: null },
  ]);
  const read = await readRange(wire.source, span, sha256);
  assert.equal(read.outcome.kind, 'unreachable');
  if (read.outcome.kind !== 'unreachable') return;
  assert.match(read.outcome.why, /500/);
  assert.equal(read.pages.length, 1);
  assert.deepEqual(read.coverage, [first]);
  assert.deepEqual(read.holes, [{ fromBlock: 15, toBlock: 20 }]);
});

// ------------------------------------------------------- GET /range: the error contract, in full

test('any status other than 200 is UNREACHABLE, and carries no refusal code', async () => {
  // §8.5.2 has no error vocabulary, but the outcome still says what was observed. A non-`200`
  // produced no document, so `FE-PROV-003` must not be attached to it: that code's fixed remedy
  // tells the user to check that their download completed and to compare its hash against the
  // publisher's, and for a `503` there is no download, no publisher and no hash. Attaching it
  // would repeat the defect that deleted the `incomplete-check` cause on 2026-08-06 — a fixed
  // remedy sentence that is false for the case reaching it.
  //
  // The absence is asserted STRUCTURALLY, by comparing the whole outcome against a two-field
  // literal: `assert.equal(outcome.kind, 'unreachable')` would pass just as happily on an arm
  // that had grown a `refusal`, which is the regression this line exists to catch.
  const span = { fromBlock: 10, toBlock: 12 };
  for (const status of [201, 204, 302, 400, 404, 429, 500, 502, 503]) {
    const wire = transport([{ status, body: page(span, [span], []), cursor: null }]);
    const read = await readRange(wire.source, span, sha256);
    assert.deepEqual(
      read.outcome,
      { kind: 'unreachable', why: `answered ${status}` },
      `status ${status} must be an unreachable read with no refusal code`,
    );
    assert.equal(read.pages.length, 0);
    // The honest surface for a read that did not happen: §6.3's coverage machinery reports the
    // span as unobserved, which is what a user is shown instead of a refusal.
    assert.deepEqual(read.holes, [span]);
  }
});

test('a page about another chain DISQUALIFIES, and reaches the ladder (R-6 re-review gap)', async () => {
  // The control gap this closes was created by a fix. §8.5.2 correctly rules that a failed read
  // does not advance §8.3's probe ladder — a ladder that ratchets on data reads disables faster
  // for a user who reads more. But with the read path contributing NOTHING, a source that answers
  // `GET /chain` and fails every `GET /range` could never be disabled by anything: probes keep
  // succeeding, and sampling never runs because no rows arrive. A wrong-chain page is the same
  // evidence §8.5.3 makes terminal, and it was being discarded for arriving on the read path.
  //
  // So: liveness never reaches the ladder from a read, correctness always does.
  const span = { fromBlock: 10, toBlock: 12 };
  const other: SnapshotDocument = {
    ...document(span, [span], [split(10, 'alice', '1000')]),
    binding: { ...BINDING, genesisHash: '0xbeef' },
  };
  const wire = transport([ok(serializeSnapshot(other))]);
  const read = await readRange(wire.source, span, sha256);
  assert.equal(read.outcome.kind, 'disqualified');
  if (read.outcome.kind !== 'disqualified') return;
  assert.match(read.outcome.why, /0xbeef/);
  assert.deepEqual(read.holes, [span]);
  assert.deepEqual(ladderEffect(read.outcome), { kind: 'disqualified', why: read.outcome.why });
});

test('BOTH ordinary read failures stay OFF the ladder, and only a correctness finding reaches it', async () => {
  // §8.5.2's asymmetry, both halves in one place, because each half is a different control and
  // losing either is silent:
  //
  //   "a liveness failure never reaches the ladder from a read, and a correctness finding always
  //    does."
  //
  // Without the first half this drifts into "any failed read disables", which is the read-driven
  // ratchet §8.5.2 removed — a provider serving a heavy screen would disable faster than an idle
  // one, and a mechanism whose trigger rate depends on how much the user reads is not the liveness
  // signal §8.3 describes. Without the second, a source that answers `GET /chain` and fails every
  // `GET /range` can never be disabled by anything at all.
  //
  // There are now TWO non-ladder arms rather than one, and this test covers both: a read that
  // produced no document (`unreachable`) and one that produced a document a page screen refused
  // (`rejected`). A `rejected` page is a statement about a document, never evidence the endpoint
  // is dead, so it stays off the ladder exactly as the `503` does.
  const span = { fromBlock: 10, toBlock: 12 };

  const silent = await readRange(
    transport([{ status: 503, body: '', cursor: null }]).source,
    span,
    sha256,
  );
  assert.equal(silent.outcome.kind, 'unreachable');
  assert.equal(ladderEffect(silent.outcome), null, 'a 503 is liveness — it must not touch the ladder');

  // A document that arrived and failed the `coverage` screen: a movement at a block its own
  // coverage list does not claim. Refused, reported with `FE-PROV-003`, and still not a liveness
  // observation about the endpoint.
  const uncovered = page(
    span,
    [{ fromBlock: 10, toBlock: 10 }],
    [split(10, 'alice', '1000'), split(11, 'bob', '500')],
  );
  const refused = await readRange(transport([ok(uncovered)]).source, span, sha256);
  assert.equal(refused.outcome.kind, 'rejected');
  if (refused.outcome.kind !== 'rejected') return;
  assert.equal(refused.outcome.refusal.code, 'FE-PROV-003');
  assert.equal(
    ladderEffect(refused.outcome),
    null,
    'a refused page is a statement about a document, not evidence the source is dead',
  );

  // The one arm that does reach it — terminal and uncounted, §8.5.3's wrong-chain rule.
  const other = serializeSnapshot({
    ...document(span, [span], [split(10, 'alice', '1000')]),
    binding: { ...BINDING, genesisHash: '0xbeef' },
  });
  const wrongChain = await readRange(transport([ok(other)]).source, span, sha256);
  assert.equal(wrongChain.outcome.kind, 'disqualified');
  if (wrongChain.outcome.kind !== 'disqualified') return;
  assert.deepEqual(ladderEffect(wrongChain.outcome), {
    kind: 'disqualified',
    why: wrongChain.outcome.why,
  });
});

test('the screens a PAGE owes refuse it — per screen, named by the screen that fired', async () => {
  // 10 §8.5.2 fixes the page's screen set, and this enumerates it: canonical form, §8.2's ordering
  // rules, monotone coverage, the chain binding, and the pin (trivially — it is the digest of the
  // bytes just received). Asserted PER SCREEN rather than as "bad pages are refused", because a
  // screen that has stopped firing is invisible under a fully green run, and because the two
  // screens §8.5.2 removed have to be shown missing from a set rather than absent from a list of
  // rejections nobody enumerated.
  //
  // The `binding` case lands on a different arm on purpose: a page describing another chain is the
  // correctness finding §8.5.3 makes terminal, so `readRange` reports `disqualified` where the
  // other three report `rejected`. Same screen set, different consequence.
  const span = { fromBlock: 10, toBlock: 12 };
  const honest = document(span, [span], [split(10, 'alice', '1000')]);
  const canonical = serializeSnapshot(honest);

  const owed = [
    {
      label: 'malformed: an amount as a JSON number',
      // Base units run past 2⁵³ (V-74's shape), so a JSON number is silently rounded on load and
      // no later screen can recover the value the operator meant. Parsing fails, and
      // `screenDocument` returns on the first parse failure — so this reports `malformed` alone
      // whatever else the hand-built body does or does not satisfy.
      screen: 'malformed',
      arm: 'rejected',
      body: JSON.stringify({
        format: SNAPSHOT_FORMAT,
        binding: { ...BINDING },
        range: span,
        coverage: [span],
        vaults: VAULTS,
        ops: [{ kind: 'split', block: 10, vault: 'v1', account: 'alice', amount: 1000 }],
        balances: [],
      }),
    },
    {
      label: 'canonical: the same document, re-indented',
      // §8.5.2 keeps §8.2's canonical serialization for a page in as many words. The check is over
      // the bytes as served, so a transport that re-serialized on the way through is refused.
      screen: 'canonical',
      arm: 'rejected',
      body: JSON.stringify(JSON.parse(canonical), null, 2),
    },
    {
      label: 'coverage: a movement at a block no declared range covers',
      // The screen that STAYS, and §8.5.2 says why it is load-bearing here specifically: a client
      // establishes its coverage from the union of the lists the pages carried, so a page whose
      // movements sit outside its own coverage hands that client movements at blocks the coverage
      // does not claim — the accidental forgery §8.2 exists to prevent, arriving through the one
      // screen it would have been tempting to drop with the others.
      screen: 'coverage',
      arm: 'rejected',
      body: page(
        span,
        [{ fromBlock: 10, toBlock: 10 }],
        [split(10, 'alice', '1000'), split(11, 'bob', '500')],
      ),
    },
    {
      label: 'binding: a page describing another chain',
      screen: 'binding',
      arm: 'disqualified',
      body: serializeSnapshot({ ...honest, binding: { ...BINDING, genesisHash: '0xbeef' } }),
    },
  ] as const;

  for (const { label, screen, arm, body } of owed) {
    assert.deepEqual(
      screensNamed(admitIndexerPage(body, admissionOf(body), sha256)),
      new Set([screen]),
      `${label}: this screen, and only this screen, must refuse the page`,
    );
    const read = await readRange(transport([ok(body)]).source, span, sha256);
    assert.equal(read.outcome.kind, arm, label);
    assert.equal(read.pages.length, 0, label);
  }

  // ------------------------------------------------ and the two screens §8.5.2 takes away
  //
  // A body failing either is now ADMITTED at this route, and that is asserted positively. Removing
  // a screen is a claim about what is now accepted, so a suite that merely stopped asserting a
  // rejection would be silent about the thing that changed.

  // `derived-rows`: a balance row this page's own movements do not produce. On a page that is not
  // a forgery at all — §8.5.2 rules a page's `balances` are the accounts' holdings at its last
  // block READ FROM STATE, so rows for accounts whose movements predate the page are exactly what
  // an honest mid-history page carries.
  const stateBalances = serializeSnapshot({
    ...honest,
    balances: [...honest.balances, { vault: 'v1', account: 'mallory', branch: 'PASS', amount: '1' }],
  });

  // `conservation`: a holding driven NEGATIVE and back again — the strongest form of the replay,
  // since a final-state check waves it through and only the intermediate state is impossible.
  // Alice transfers 4,000 of a branch she holds 1,000 of, and carol returns it in the next block,
  // so the page's own final fold is non-negative and `derived-rows` stays silent. That isolation
  // is the point: it makes the set below exactly one screen.
  const negativeAndBack = page(span, [span], [
    split(10, 'alice', '1000'),
    {
      kind: 'transfer',
      block: 11,
      vault: 'v1',
      account: 'alice',
      to: 'carol',
      branch: 'PASS',
      amount: '4000',
    },
    {
      kind: 'transfer',
      block: 12,
      vault: 'v1',
      account: 'carol',
      to: 'alice',
      branch: 'PASS',
      amount: '4000',
    },
  ]);

  const dropped = [
    { label: 'a balance row no movement in the page produces', screen: 'derived-rows', body: stateBalances },
    { label: 'a holding driven negative and back inside the page', screen: 'conservation', body: negativeAndBack },
  ] as const;

  for (const { label, screen, body } of dropped) {
    // Admitted as a page, end to end.
    const read = await readRange(transport([ok(body)]).source, span, sha256);
    assert.equal(read.outcome.kind, 'exhausted', label);
    assert.equal(read.pages.length, 1, label);
    assert.deepEqual(screensNamed(admitIndexerPage(body, admissionOf(body), sha256)), new Set(), label);

    // The contrast, over the SAME BYTES: a snapshot is still refused, on exactly the screen
    // §8.5.2 dropped from a page. Without this the suite could only show that this route stopped
    // checking something — never that the check moved rather than vanished.
    assert.deepEqual(
      screensNamed(admitSnapshot(body, admissionOf(body), sha256)),
      new Set([screen]),
      `${label}: still refused as a SNAPSHOT, on ${screen}`,
    );
  }
});

test('a body that is not in canonical form is REJECTED, and carries FE-PROV-003', async () => {
  // §8.5.2 restricts §8.2's document to a range and keeps "the same canonical serialization". The
  // check is over the bytes as served, so re-indented output, a reordered key or a transport that
  // re-serialized on the way through are all refused.
  //
  // The reason is canonical serialization ALONE, and this comment cited `FE-PROV-004` until
  // 2026-08-07. §8.5.2 is explicit that it does not: that code is scoped by §8.4's table to "two
  // independent **snapshots** covering the same range", so it never diffs a page against a
  // snapshot and a second format would not have widened it. What canonical form buys is what §8.2
  // says it buys — a consumer that cannot reconstruct the same bytes cannot check the producer.
  //
  // A document arrived here, so this is the `rejected` arm rather than `unreachable`, and it
  // carries the code §8.5.2 names for a failed read.
  const span = { fromBlock: 10, toBlock: 12 };
  const canonical = page(span, [span], [split(10, 'alice', '1000')]);
  const reindented = JSON.stringify(JSON.parse(canonical), null, 2);
  assert.notEqual(reindented, canonical, 'the fixture must actually differ or this proves nothing');

  // Each body is DELIBERATELY non-canonical. `spaced` is built by concatenation rather than
  // by a single-occurrence `.replace`, which reads as an attempted sanitizer and is not one —
  // nothing here is trying to clean input, the point is to hand the admission path bytes it must
  // refuse.
  const spaced = `${canonical.slice(0, 1)} ${canonical.slice(1)}`;
  for (const body of [reindented, `${canonical} `, spaced]) {
    const label = JSON.stringify(body.slice(0, 40));
    const wire = transport([ok(body)]);
    const read = await readRange(wire.source, span, sha256);
    assert.equal(read.outcome.kind, 'rejected', label);
    if (read.outcome.kind !== 'rejected') return;
    assert.equal(read.outcome.refusal.code, 'FE-PROV-003', label);
    assert.equal(read.pages.length, 0, label);
    // The screen that fired, named — a body refused for some other reason would prove nothing
    // about canonical form.
    assert.deepEqual(
      screensNamed(admitIndexerPage(body, admissionOf(body), sha256)),
      new Set(['canonical']),
      label,
    );
  }
});

test('a page whose range leaves the requested span is REJECTED, and carries FE-PROV-003', async () => {
  // §8.5.2: a page is a document over "some prefix of the requested span". Refused rather than
  // trimmed — `admitIndexerPage` keeps the `coverage` screen, which binds coverage to the range and
  // every movement to the coverage, so trimming the coverage list alone would leave a caller
  // holding movements at blocks its own coverage does not claim.
  //
  // A document arrived and is wrong about itself, so this is `rejected` rather than `unreachable`.
  const span = { fromBlock: 10, toBlock: 20 };
  const wide = { fromBlock: 5, toBlock: 25 };
  const wire = transport([ok(page(wide, [wide], [split(6, 'alice', '1000')]))]);
  const read = await readRange(wire.source, span, sha256);
  assert.equal(read.outcome.kind, 'rejected');
  if (read.outcome.kind !== 'rejected') return;
  assert.match(read.outcome.why, /5\.\.25/);
  assert.equal(read.outcome.refusal.code, 'FE-PROV-003');
  assert.deepEqual(read.holes, [span]);
});

test('an inverted span is the caller\'s defect and throws — it never blames the operator', async () => {
  const wire = transport([]);
  await assert.rejects(
    () => readRange(wire.source, { fromBlock: 20, toBlock: 10 }, sha256),
    RangeError,
  );
  assert.deepEqual(wire.urls, [], 'nothing may be asked of the operator for a request we formed');
});

// ------------------------------------------------------------------ GET /range: the cursor

test('the client passes back the token it was given and never constructs one', async () => {
  // The token deliberately contains characters that must be encoded for transport, so "passed back
  // verbatim" is distinguishable from "reassembled".
  const span = { fromBlock: 10, toBlock: 20 };
  const first = { fromBlock: 10, toBlock: 14 };
  const second = { fromBlock: 15, toBlock: 20 };
  const token = 'opaque token&with=punctuation/and+plus';
  const wire = transport([
    ok(page(first, [first], [split(10, 'alice', '1000')]), token),
    ok(page(second, [second], [split(16, 'bob', '500')])),
  ]);
  const read = await readRange(wire.source, span, sha256);
  assert.equal(read.outcome.kind, 'exhausted');

  assert.equal(wire.urls.length, 2);
  const [firstUrl, secondUrl] = wire.urls;
  assert.ok(firstUrl !== undefined && secondUrl !== undefined);
  // The first request carries no cursor: there is nothing to pass back yet, and a client that sent
  // one would be sending a token it made up.
  assert.equal(firstUrl, `${ENDPOINT}/range?from=10&to=20`);
  assert.ok(!firstUrl.includes('cursor='));
  // The second carries exactly what the first response gave, encoded and otherwise untouched.
  const sent = new URL(secondUrl).searchParams.get('cursor');
  assert.equal(sent, token);
  assert.equal(secondUrl, `${ENDPOINT}/range?from=10&to=20&cursor=${encodeURIComponent(token)}`);
});

test('an empty cursor header ends the walk exactly as an absent one does', async () => {
  const span = { fromBlock: 10, toBlock: 12 };
  const wire = transport([ok(page(span, [span], [split(10, 'alice', '1000')]), '')]);
  const read = await readRange(wire.source, span, sha256);
  assert.equal(read.outcome.kind, 'exhausted');
  assert.equal(wire.urls.length, 1);
  assert.equal(wire.exhausted, false);
});

test('a repeated cursor stops the walk, and is not a failed read', async () => {
  // A server that hands back a token the walk already followed is looping. Stopping keeps the
  // coverage the pages carried — under-claiming, which cannot invent history — while a failed read
  // would advance §8.3's ladder against a source whose pages all passed every screen.
  const span = { fromBlock: 10, toBlock: 20 };
  const first = { fromBlock: 10, toBlock: 14 };
  const wire = transport([
    ok(page(first, [first], [split(10, 'alice', '1000')]), 'same'),
    ok(page(first, [first], [split(10, 'alice', '1000')]), 'same'),
  ]);
  const read = await readRange(wire.source, span, sha256);
  assert.equal(read.outcome.kind, 'cursor-repeated');
  if (read.outcome.kind !== 'cursor-repeated') return;
  assert.equal(read.outcome.cursor, 'same');
  assert.equal(read.pages.length, 2);
  assert.deepEqual(read.coverage, [first]);
  assert.deepEqual(read.holes, [{ fromBlock: 15, toBlock: 20 }]);
});

test('a server that pages forever is stopped by the span, not by a number somebody picked', async () => {
  // The bound is derived: pages are prefixes of one another's remainder, so a conforming server
  // cannot offer more pages than the span has blocks. Three blocks, at most three pages.
  const span = { fromBlock: 10, toBlock: 12 };
  const wire = endlessTransport(page(span, [span], [split(10, 'alice', '1000')]));
  const read = await readRange(wire.source, span, sha256);
  assert.equal(read.outcome.kind, 'page-ceiling');
  if (read.outcome.kind !== 'page-ceiling') return;
  assert.equal(read.outcome.pages, 3);
  assert.equal(wire.urls.length, 3);
  // Under-claiming, again: the walk stopped, and what it holds is what the pages carried.
  assert.deepEqual(read.coverage, [span]);
});

// ------------------------------------------------------------------ the page's content address

test('a page reports the content address of exactly the bytes served', async () => {
  const span = { fromBlock: 10, toBlock: 12 };
  const body = page(span, [span], [split(10, 'alice', '1000')]);
  const wire = transport([ok(body)]);
  const read = await readRange(wire.source, span, sha256);
  const [only] = read.pages;
  assert.ok(only !== undefined);
  assert.equal(only.pin, sha256(preimageOfSerialized(body)));
  // It is the same address the equivalent snapshot file would carry, which is the strongest form
  // of "not a second format": these bytes go through the SNAPSHOT entry point unchanged.
  //
  // That is a statement about this fixture, not about pages in general, and the comment claimed
  // `FE-PROV-004` until 2026-08-07. §8.5.2 removes that reading — the code is scoped by §8.4's
  // table to "two independent **snapshots** covering the same range", so a page has no pair to be
  // half of. What the pin buys is what §8.5.2 says it buys: a caller can recognise a re-read of
  // the same span as the same bytes without re-comparing them. This page is admitted as a
  // snapshot only because it is genesis-anchored; a mid-history page is not, by ruling.
  assert.equal(
    admitSnapshot(body, { expectedPin: only.pin, binding: { ...BINDING } }, sha256).kind,
    'admitted',
  );
});

/**
 * Stand in for the metadata-holding caller `samplingPages` now requires.
 *
 * A reference is a storage key and `claimed` is the value the chain would hold under it, so both
 * are the **encoded** form — `chainRowCheck` compares `claimed` against `ChainReadResult.hex` as
 * opaque hex and declines to decode, because decoding needs runtime metadata `packages/providers`
 * may not reach. This fixture models that with a little-endian u128 hex, which is what SCALE emits
 * for a balance; the exact encoding does not matter to the test, only that the projection produces
 * the representation the comparison is actually over.
 *
 * `samplingPages` built `claimed` itself until 2026-08-07, from §8.2's canonical **decimal**
 * string. That composed to a decimal compared against hex — every honest row a mismatch, and
 * §8.4's "any mismatch" rule auto-disabling the operator that served it.
 */
function projectRow(row: SnapshotBalance): ProviderRow {
  const bytes = BigInt(row.amount).toString(16).padStart(32, '0');
  const littleEndian = (bytes.match(/../g) ?? []).reverse().join('');
  return {
    reference: JSON.stringify([row.vault, row.account, row.branch]),
    claimed: `0x${littleEndian}`,
  };
}

test('samplingPages projects a page into §8.4\'s unit of stratification', () => {
  const span = { fromBlock: 10, toBlock: 12 };
  const built = document(span, [span], [split(10, 'alice', '1000')]);
  const projected = samplingPages([{ document: built, pin: 'x' }], projectRow);
  assert.equal(projected.length, 1);
  const [only] = projected;
  assert.ok(only !== undefined);
  assert.equal(only.rows.length, built.balances.length);
  assert.deepEqual(
    only.rows.map((row) => row.claimed),
    built.balances.map((row) => projectRow(row).claimed),
  );

  // The half this test had the wrong way round until 2026-08-07, which is what let the
  // representation defect ship: it compared `claimed` against §8.2's canonical DECIMAL amount and
  // passed, because `samplingPages` produced that decimal itself. `chainRowCheck` compares
  // `claimed` against `ChainReadResult.hex` and declines to decode — so a decimal is a mismatch on
  // every honest row, and §8.4's "any mismatch" rule auto-disables the operator that served it.
  // Asserting the negative is what pins it: the projection must not be handing the sampler the
  // document's own wire form back.
  assert.ok(
    only.rows.every((row) => !built.balances.some((balance) => balance.amount === row.claimed)),
    "claimed must be the encoded value a chain read returns, never §8.2's decimal string",
  );
});

// ------------------------------------------------------------------ the reference implementation

const OBSERVED: readonly SnapshotRange[] = [{ fromBlock: 10, toBlock: 24 }];

/**
 * Splits only, and the restriction is not tidiness — it is what makes `foldedSlice` usable here.
 *
 * A `split` mints a complete set out of escrow, so the fold of a page's own movements and the
 * accounts' holdings at that page's last block **coincide** for a splits-only history however it
 * is paged. 10 §8.5.2 rules that a page's `balances` are the second of those, not the first, so a
 * fixture built on `foldedSlice` is only honest where the two agree — which the README states as
 * that helper's remaining scope. Every movement other than `split` *consumes* a position, so a
 * page carrying one without the movement that created it folds negative, and a negative holding
 * is not an amount §8.2's format can express. See `stateSlice` and the mid-history tests below.
 */
const HISTORY: readonly SnapshotOp[] = [
  split(10, 'alice', '1000'),
  split(13, 'bob', '500'),
  split(17, 'carol', '250'),
  split(21, 'dave', '200'),
];

function referenceIndexer(blocksPerPage: number) {
  return createIndexer({
    binding: { ...BINDING },
    coverage: OBSERVED,
    blocksPerPage,
    read: (span) => foldedSlice(VAULTS, HISTORY, OBSERVED, span),
    sha256,
  });
}

/*
 * `stateSlice` is imported from `optional/indexer` rather than defined here.
 *
 * It began as a fixture in this file, which meant the reference implementation shipped only
 * `foldedSlice` — the shape 10 §8.5.2 rules an operator must NOT serve on real history — while its
 * README told operators to serve the other one. A helper the suites need and operators cannot
 * import is a reference implementation demonstrating the wrong thing, so it moved to the module
 * under test and these tests exercise the shipped code rather than a local twin of it.
 */

/** Drive the reference handler through the client's own transport shape — no socket, no timing. */
function overHandler(handle: ReturnType<typeof referenceIndexer>): Transport {
  const urls: string[] = [];
  const get: IndexerGet = (url) => {
    urls.push(url);
    const parsed = new URL(url);
    const served = handle(`${parsed.pathname}${parsed.search}`);
    return Promise.resolve({
      status: served.status,
      body: served.body,
      header: (name: string) => served.headers[name] ?? null,
    });
  };
  return { source: { endpoint: ENDPOINT, get, binding: { ...BINDING } }, urls, exhausted: false };
}

test('the reference server round-trips: every page it serves, the client admits', async () => {
  const span = { fromBlock: 10, toBlock: 24 };
  const wire = overHandler(referenceIndexer(5));
  const read = await readRange(wire.source, span, sha256);

  assert.equal(read.outcome.kind, 'exhausted', JSON.stringify(read.outcome));
  assert.equal(read.pages.length, 3, 'fifteen blocks at five per page');
  assert.deepEqual(read.coverage, [span]);
  assert.deepEqual(read.holes, []);
  // Every movement the operator holds arrived, exactly once and in chain order.
  const blocks = read.pages.flatMap((served) => served.document.ops.map((op) => op.block));
  assert.deepEqual(blocks, [10, 13, 17, 21]);
  assert.deepEqual([...blocks].sort((left, right) => left - right), blocks);
});

test('the reference server serves §8.2 bytes, not a shape that resembles them', async () => {
  // The strongest form of "not a second format": each page is re-admitted here from its own bytes,
  // with its own digest, through the same entry point a snapshot file goes through.
  //
  // `admitSnapshot` is deliberately the entry point, and it holds here because `HISTORY` is
  // splits-only — a genesis-anchored page's fold and its state balances coincide. It is NOT the
  // general claim: 10 §8.5.2 rules that a mid-history page owes neither the conservation replay
  // nor the derived-row agreement, and the mid-history test above asserts the same bytes being
  // admitted as a page and refused as a snapshot. What generalises is everything this loop is
  // actually checking — one serialization, one pre-image, one digest.
  const wire = overHandler(referenceIndexer(7));
  const read = await readRange(wire.source, { fromBlock: 10, toBlock: 24 }, sha256);
  assert.ok(read.pages.length > 1);
  for (const served of read.pages) {
    const bytes = serializeSnapshot(served.document);
    assert.equal(sha256(preimageOfSerialized(bytes)), served.pin);
    const verdict = admitSnapshot(bytes, { expectedPin: served.pin, binding: { ...BINDING } }, sha256);
    assert.equal(verdict.kind, 'admitted');
  }
});

test('the reference server answers a span it does not serve with honest emptiness', async () => {
  // Not an error: the operator has nothing for those blocks and says so. The client's holes then
  // report the whole span, which is exactly what a user must be shown (10 §6.3).
  const span = { fromBlock: 100, toBlock: 104 };
  const wire = overHandler(referenceIndexer(5));
  const read = await readRange(wire.source, span, sha256);
  assert.equal(read.outcome.kind, 'exhausted');
  assert.equal(read.pages.length, 1);
  assert.deepEqual(read.coverage, []);
  assert.deepEqual(read.holes, [span]);
});

test('A PAGE THAT STARTS MID-HISTORY IS SERVED AND ADMITTED — 10 §8.5.2, ruled 2026-08-07', async () => {
  // This test asserted the exact opposite until the ruling landed, and the inversion is the ruling
  // rather than a change of mind about the code.
  //
  // §8.4's conservation replay starts every holding, supply and escrow at **zero** and requires
  // non-negativity at every step, so under it a page was admissible only if it carried the
  // movements that created the positions it moves. The transfer below moves a position split at
  // block 10, so a page over 15..19 replayed negative and was refused. A `split` is the one
  // movement that mints from escrow — real history is not splits-only — so the consequence was
  // that a conforming operator could serve only spans reaching back to the origin of every
  // position they touch, and §8.5.2's `from` and `to` were unusable for every ranged read they
  // exist for.
  //
  // §8.5.2 rules it, and names which of §8.4's three internal-consistency screens drop, for two
  // reasons that are not the same fact: the **conservation replay** goes because non-negativity
  // from a zero start is meaningless for a page that opens mid-history, and the **event↔derived-row
  // agreement** goes because a page's `balances` are read from state at its last block rather than
  // folded from the page. **Monotone coverage stays.** "A page is checked against itself, and
  // against the chain — never against a history it does not carry."
  const history: readonly SnapshotOp[] = [
    split(10, 'alice', '1000'),
    { kind: 'transfer', block: 17, vault: 'v1', account: 'alice', to: 'carol', branch: 'PASS', amount: '250' },
  ];
  const handle = createIndexer({
    binding: { ...BINDING },
    coverage: OBSERVED,
    blocksPerPage: 5,
    // State balances, which is what §8.5.2 asks an operator for. `foldedSlice` is asserted to be
    // unusable here by the test that follows, so this is not an arbitrary choice of fixture.
    read: (span) => stateSlice(VAULTS, history, OBSERVED, span),
    sha256,
  });

  // The page that carries the split was always fine.
  assert.equal(handle('/range?from=10&to=14').status, 200);
  // The page that carries ONLY the transfer is served — `200`, where it answered `500`.
  const midHistory = handle('/range?from=15&to=19');
  assert.equal(midHistory.status, 200, midHistory.body);

  // And the client admits it, on its own bytes and its own digest, with no screen skipped.
  assert.deepEqual(
    screensNamed(admitIndexerPage(midHistory.body, admissionOf(midHistory.body), sha256)),
    new Set(),
  );

  // The contrast that makes the ruling visible rather than merely satisfied: the very same bytes
  // are still refused as a SNAPSHOT, on exactly the two screens §8.5.2 took away from a page —
  // `conservation` because alice transfers a branch this document never saw her receive, and
  // `derived-rows` because the state balances beside it are not the fold of that one movement.
  assert.deepEqual(
    screensNamed(admitSnapshot(midHistory.body, admissionOf(midHistory.body), sha256)),
    new Set(['conservation', 'derived-rows']),
  );

  // End to end: the walk over the full span completes, and the mid-history movement arrives.
  const wire = overHandler(handle);
  const read = await readRange(wire.source, { fromBlock: 10, toBlock: 24 }, sha256);
  assert.equal(read.outcome.kind, 'exhausted', JSON.stringify(read.outcome));
  assert.equal(read.pages.length, 3, 'fifteen blocks at five per page');
  assert.deepEqual(read.coverage, [{ fromBlock: 10, toBlock: 24 }]);
  assert.deepEqual(read.holes, [], 'no span is lost to a screen a page does not owe');
  const carried = read.pages.flatMap((served) => served.document.ops);
  assert.deepEqual(carried.map((op) => op.block), [10, 17]);
  assert.deepEqual(carried.map((op) => op.kind), ['split', 'transfer']);
});

test('foldedSlice cannot serve that page, and the server says so rather than shipping it', async () => {
  // The producer-side half of the same ruling, pinned because `foldedSlice` is the helper this
  // repository ships and an operator reaching for it on a real history gets `500`s.
  //
  // 10 §8.5.2 makes a page's `balances` the accounts' holdings at its last block, read from state.
  // Folding the page's own movements instead produces a NEGATIVE holding for any position created
  // before the page — and a negative amount is not something §8.2's grammar can express, so the
  // failure is `malformed` and arrives before any balance is compared with anything. The README
  // scopes the helper to fixtures and to the genesis-anchored case for exactly this reason.
  const orphan: SnapshotOp = {
    kind: 'transfer',
    block: 17,
    vault: 'v1',
    account: 'alice',
    to: 'carol',
    branch: 'PASS',
    amount: '250',
  };
  const history: readonly SnapshotOp[] = [split(10, 'alice', '1000'), orphan];
  const handle = createIndexer({
    binding: { ...BINDING },
    coverage: OBSERVED,
    blocksPerPage: 5,
    read: (span) => foldedSlice(VAULTS, history, OBSERVED, span),
    sha256,
  });

  const orphaned = handle('/range?from=15&to=19');
  assert.equal(orphaned.status, 500);
  assert.match(orphaned.body, /would be rejected by the client/);
  assert.match(orphaned.body, /-250/, 'the reason is the negative holding, not something incidental');

  // The screen, named. `malformed` and not `conservation` — the amount grammar refuses the folded
  // balance before any screen gets to reason about it, which is why "the fold disagrees with the
  // chain" understates what this helper costs on a real history.
  const folded = serializeSnapshot(
    document({ fromBlock: 15, toBlock: 19 }, [{ fromBlock: 15, toBlock: 19 }], [orphan]),
  );
  assert.match(folded, /"-250"/, 'the fixture must actually carry the negative fold');
  assert.deepEqual(
    screensNamed(admitIndexerPage(folded, admissionOf(folded), sha256)),
    new Set(['malformed']),
  );

  // What the client sees is a read that produced no document, so the span stays a hole. The
  // operator's own screen converts a page it would have had to reject into an unreachable read,
  // which is the right direction: nothing arrived to reject.
  const wire = overHandler(handle);
  const read = await readRange(wire.source, { fromBlock: 10, toBlock: 24 }, sha256);
  assert.equal(read.outcome.kind, 'unreachable');
  assert.equal(read.pages.length, 1, 'the first page arrived; the second could not be built');
  assert.deepEqual(read.coverage, [{ fromBlock: 10, toBlock: 14 }]);
  assert.deepEqual(read.holes, [{ fromBlock: 15, toBlock: 24 }]);
});

test('the reference server refuses to serve a page its own consumer would reject', async () => {
  // The obligation the README states, enforced: the last step before answering runs the CLIENT's
  // own `admitIndexerPage` over exactly the bytes about to go on the wire, so a page that would
  // fail at the user is answered `500` and never served.
  //
  // The fixture is a `coverage` violation — movements at blocks the page's own coverage list does
  // not claim — and it has to be a screen a page still OWES. Until 2026-08-07 this test used a
  // fabricated `balances` row, which the `derived-rows` screen caught; 10 §8.5.2 removes that
  // screen from this route, so the server genuinely no longer catches one. The test below states
  // what happens to it now, because a reduction in what a gate catches must be a visible tested
  // fact rather than an assertion quietly deleted.
  const span = { fromBlock: 10, toBlock: 24 };
  const handle = createIndexer({
    binding: { ...BINDING },
    coverage: OBSERVED,
    blocksPerPage: 100,
    read: (asked) => {
      const honest = foldedSlice(VAULTS, HISTORY, OBSERVED, asked);
      // Coverage cut back to its first block while every movement stays. This is the shape a
      // reader that fails part-way produces with the halves the other way round (§8.5.1), and it
      // is why the screen is load-bearing on a page at all: `readRange` builds a caller's coverage
      // from the union of the lists the pages carried, so serving this hands that caller movements
      // at blocks its own coverage does not claim.
      return {
        ...honest,
        coverage: honest.coverage.map((range) => ({ ...range, toBlock: range.fromBlock })),
      };
    },
    sha256,
  });
  const served = handle('/range?from=10&to=24');
  assert.equal(served.status, 500);
  assert.match(served.body, /would be rejected by the client/);

  // Not taken on trust. The `500` alone cannot say which check stopped it, so the document the
  // server declined to serve is rebuilt here and put through the client's own page path.
  const declined = serializeSnapshot(document(span, [{ fromBlock: 10, toBlock: 10 }], HISTORY));
  assert.deepEqual(
    screensNamed(admitIndexerPage(declined, admissionOf(declined), sha256)),
    new Set(['coverage']),
  );

  // And the client counts it as exactly one thing: a read that produced no document, so the whole
  // span stays a hole.
  const wire = overHandler(handle);
  const read = await readRange(wire.source, span, sha256);
  assert.equal(read.outcome.kind, 'unreachable');
  assert.equal(read.pages.length, 0);
  assert.deepEqual(read.holes, [span]);
});

test('a fabricated balance row IS served and IS admitted — nothing on this path checks balances', async () => {
  // The honest half of the ruling, pinned so the reduction in what the server catches is a tested
  // fact rather than a silent hole. This exact fixture was refused with a `500` until 2026-08-07,
  // caught by §8.4's event↔derived-row screen. 10 §8.5.2 removes that screen from a page, because
  // a page's `balances` are the accounts' holdings at its last block READ FROM STATE — and a fold
  // of the page's own movements, compared against a current holding, would disagree on every
  // honest mid-history page and auto-disable the operator that served it.
  //
  // What covers it instead is §8.4's 1-in-16-page sampling, which re-verifies rows against chain
  // state and auto-disables on a mismatch. `samplingPages` is the projection that binds this
  // route's unit of response to the sampler's unit of stratification, and it is exercised below;
  // the detection half — a served row turned into a verdict against a recorded chain read — is
  // `tests/providers/lying-indexer.test.ts` (15 §4.8's "lying indexer ⇒ sampler auto-disable").
  const span = { fromBlock: 10, toBlock: 24 };
  const fabricated = { vault: 'v1', account: 'mallory', branch: 'PASS', amount: '1' } as const;
  const handle = createIndexer({
    binding: { ...BINDING },
    coverage: OBSERVED,
    blocksPerPage: 100,
    read: (asked) => {
      const honest = foldedSlice(VAULTS, HISTORY, OBSERVED, asked);
      return { ...honest, balances: [...honest.balances, fabricated] };
    },
    sha256,
  });
  assert.equal(handle('/range?from=10&to=24').status, 200);

  const wire = overHandler(handle);
  const read = await readRange(wire.source, span, sha256);
  assert.equal(read.outcome.kind, 'exhausted');
  assert.equal(read.pages.length, 1);
  const [only] = read.pages;
  assert.ok(only !== undefined);
  assert.ok(
    only.document.balances.some((row) => row.account === fabricated.account),
    'the row reaches the client — this is what "no screen covers it here" means',
  );

  // The screen that used to catch it, still catching it — for a SNAPSHOT. That contrast is what
  // makes this a relocation rather than a loss of coverage.
  const bytes = serializeSnapshot(only.document);
  assert.deepEqual(
    screensNamed(admitSnapshot(bytes, { expectedPin: only.pin, binding: { ...BINDING } }, sha256)),
    new Set(['derived-rows']),
  );

  // The pointer at §8.4's sampling, made executable rather than left as prose: the fabricated row
  // is among the rows sampling puts to the chain, with the amount the operator claimed for it.
  const projected = samplingPages(read.pages, projectRow);
  const [projectedPage] = projected;
  assert.ok(projectedPage !== undefined);
  assert.ok(
    projectedPage.rows.some(
      (row) =>
        row.reference === JSON.stringify(['v1', fabricated.account, fabricated.branch]) &&
        row.claimed === projectRow(fabricated).claimed,
    ),
    'a row no screen checks must at least be a row the sampler can check',
  );
});

test('the reference server refuses a misconfiguration at startup, not per request', () => {
  const config = {
    binding: { ...BINDING },
    coverage: OBSERVED,
    blocksPerPage: 5,
    read: (span: SnapshotRange) => foldedSlice(VAULTS, HISTORY, OBSERVED, span),
    sha256,
  };
  // A page spanning no blocks advances no cursor: the walk it produces never terminates.
  assert.throws(() => createIndexer({ ...config, blocksPerPage: 0 }), RangeError);
  assert.throws(() => createIndexer({ ...config, blocksPerPage: -1 }), RangeError);
  assert.throws(
    () => createIndexer({ ...config, coverage: [{ fromBlock: 20, toBlock: 10 }] }),
    RangeError,
  );
});

test('the reference server implements the two routes and nothing else', () => {
  const handle = referenceIndexer(5);
  assert.equal(handle('/chain').status, 200);
  assert.equal(handle('/range?from=10&to=14').status, 200);
  assert.equal(handle('/').status, 404);
  assert.equal(handle('/blocks').status, 404);
  assert.equal(handle('/range').status, 400, 'from and to are required');
  assert.equal(handle('/range?from=20&to=10').status, 400, 'an inverted span');
  assert.equal(handle('/range?from=0x0a&to=14').status, 400, 'a hex block is not a u32 decimal');
  assert.equal(handle('/range?from=10&to=14&cursor=nonsense').status, 400);
  assert.equal(handle('/range?from=10&to=14&cursor=99').status, 400, 'a cursor outside the span');
});

test('the reference server\'s /chain is what the client\'s own compatibility check accepts', async () => {
  const handle = referenceIndexer(5);
  const wire = overHandler(handle);
  const answer = await readChain(wire.source);
  assert.equal(answer.kind, 'answered');
  if (answer.kind !== 'answered') return;
  assert.deepEqual(answer.binding, { ...BINDING });
  assert.deepEqual(answer.coverage, mergeCoverage(OBSERVED));
});

// ------------------------------------------------------------------ over a real socket

test('a round trip over a real socket produces bytes the client admits', async (t) => {
  // The handler suites above never open one, which is the point of the split — but "the reference
  // implementation works" is a claim about a server, and a server that has never met a socket has
  // never had its headers written by `http`, its status line formed, or its body encoded.
  const server = startIndexer(referenceIndexer(6), { port: 0, host: '127.0.0.1' });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  const endpoint = `http://127.0.0.1:${address.port}`;

  const source: IndexerSource = {
    endpoint,
    get: async (url) => {
      const response = await fetch(url);
      return {
        status: response.status,
        body: await response.text(),
        header: (name: string) => response.headers.get(name),
      };
    },
    binding: { ...BINDING },
  };

  const span = { fromBlock: 10, toBlock: 24 };
  const answer = await readChain(source);
  assert.equal(answer.kind, 'answered', JSON.stringify(answer));

  const read = await readRange(source, span, sha256);
  assert.equal(read.outcome.kind, 'exhausted', JSON.stringify(read.outcome));
  assert.equal(read.pages.length, 3, 'fifteen blocks at six per page');
  assert.deepEqual(read.coverage, [span]);
  assert.deepEqual(read.holes, []);

  // Read-only, over the wire rather than by inspection.
  const written = await fetch(`${endpoint}/range?from=10&to=24`, { method: 'POST' });
  assert.equal(written.status, 405);
  assert.equal(written.headers.get('allow'), 'GET, HEAD');
});
