/**
 * The live-indexer wire, both ends — 10 §8.5.2, INV-FE-15 (F24).
 *
 * Three properties carry this suite, and none of them is the happy path.
 *
 * **Coverage comes from the documents, never from the cursor.** A server that stops offering pages
 * is making a claim, of exactly the kind §8.5.1 refuses to accept from `storageDone`. So the tests
 * that matter most hand the client a page set whose coverage lists do *not* cover what was asked
 * for, and require that the read says so — a reader that trusted the cursor would report an
 * `observed` span it never observed, which is the accidental forgery §8.2 exists to prevent and
 * which passes every screen in §8.4 because the movements it does carry are consistent.
 *
 * **The error contract is that there is none.** A `500`, a page about another chain and a page that
 * fails `admitSnapshot` are one outcome with one shape. There is nothing here that parses an error
 * body, because an operator implements no error vocabulary and a client needs none.
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
  SnapshotDocument,
  SnapshotOp,
  SnapshotRange,
  SnapshotVault,
} from '@bleavit/providers';

import { createIndexer, foldedSlice } from '../../optional/indexer/indexer.ts';
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
  assert.equal(read.outcome.kind, 'failed');
  if (read.outcome.kind !== 'failed') return;
  assert.match(read.outcome.why, /500/);
  assert.equal(read.pages.length, 1);
  assert.deepEqual(read.coverage, [first]);
  assert.deepEqual(read.holes, [{ fromBlock: 15, toBlock: 20 }]);
});

// ------------------------------------------------------- GET /range: the error contract, in full

test('any status other than 200 is a failed read', async () => {
  const span = { fromBlock: 10, toBlock: 12 };
  for (const status of [201, 204, 302, 400, 404, 429, 500, 502, 503]) {
    const wire = transport([{ status, body: page(span, [span], []), cursor: null }]);
    const read = await readRange(wire.source, span, sha256);
    assert.equal(read.outcome.kind, 'failed', `status ${status} must be a failed read`);
    assert.equal(read.pages.length, 0);
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

test('an ordinary failed read stays OFF the ladder — §8.5.2, and the half that must not regress', async () => {
  // The other side of the asymmetry. Without this, the fix above could drift into "any failed
  // read disables", which is exactly the read-driven ratchet §8.5.2 removed.
  const span = { fromBlock: 10, toBlock: 12 };
  const wire = transport([{ status: 503, body: '', headers: {} }]);
  const read = await readRange(wire.source, span, sha256);
  assert.equal(read.outcome.kind, 'failed');
  assert.equal(ladderEffect(read.outcome), null, 'a 503 is liveness — it must not touch the ladder');
});

test('a body that fails admitSnapshot is a failed read — per screen', async () => {
  const span = { fromBlock: 10, toBlock: 12 };
  const honest = document(span, [span], [split(10, 'alice', '1000')]);

  // `derived-rows`: a balance no movement produces.
  const fabricated: SnapshotDocument = {
    ...honest,
    balances: [...honest.balances, { vault: 'v1', account: 'mallory', branch: 'PASS', amount: '1' }],
  };
  // `coverage`: a movement at a block no declared range covers.
  const uncovered: SnapshotDocument = {
    ...honest,
    coverage: [{ fromBlock: 10, toBlock: 10 }],
    ops: [split(10, 'alice', '1000'), split(11, 'bob', '500')],
  };
  // `conservation`: an account merging more than it holds.
  const negative: SnapshotDocument = {
    ...honest,
    ops: [
      split(10, 'alice', '1000'),
      { kind: 'merge', block: 11, vault: 'v1', account: 'alice', amount: '4000' },
    ],
  };

  for (const forged of [fabricated, uncovered, negative]) {
    const wire = transport([ok(serializeSnapshot(forged))]);
    const read = await readRange(wire.source, span, sha256);
    assert.equal(read.outcome.kind, 'failed', JSON.stringify(forged));
    assert.equal(read.pages.length, 0);
  }
});

test('a body that is not in canonical form is a failed read', async () => {
  // §8.5.2 restricts §8.2's document to a range and keeps "the same canonical serialization". The
  // check is over the bytes as served, so re-indented output, a reordered key or a transport that
  // re-serialized on the way through are all refused — which is what keeps a page byte-comparable
  // against the snapshot covering the same blocks (`FE-PROV-004`).
  const span = { fromBlock: 10, toBlock: 12 };
  const canonical = page(span, [span], [split(10, 'alice', '1000')]);
  const reindented = JSON.stringify(JSON.parse(canonical), null, 2);
  assert.notEqual(reindented, canonical, 'the fixture must actually differ or this proves nothing');

  for (const body of [reindented, `${canonical} `, canonical.replace('{', '{ ')]) {
    const wire = transport([ok(body)]);
    const read = await readRange(wire.source, span, sha256);
    assert.equal(read.outcome.kind, 'failed', JSON.stringify(body.slice(0, 40)));
  }
});

test('a page whose range leaves the requested span is a failed read', async () => {
  // §8.5.2: a page is a document over "some prefix of the requested span". Refused rather than
  // trimmed — `admitSnapshot` binds coverage to the range and every movement to the coverage, so
  // trimming the coverage list alone would leave a caller holding movements at blocks its own
  // coverage does not claim.
  const span = { fromBlock: 10, toBlock: 20 };
  const wide = { fromBlock: 5, toBlock: 25 };
  const wire = transport([ok(page(wide, [wide], [split(6, 'alice', '1000')]))]);
  const read = await readRange(wire.source, span, sha256);
  assert.equal(read.outcome.kind, 'failed');
  if (read.outcome.kind !== 'failed') return;
  assert.match(read.outcome.why, /5\.\.25/);
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
  // It is the same address the equivalent snapshot file would carry, which is what makes a page
  // and a snapshot diffable under `FE-PROV-004` (§8.5.2).
  assert.equal(
    admitSnapshot(body, { expectedPin: only.pin, binding: { ...BINDING } }, sha256).kind,
    'admitted',
  );
});

test('samplingPages projects a page into §8.4\'s unit of stratification', () => {
  const span = { fromBlock: 10, toBlock: 12 };
  const built = document(span, [span], [split(10, 'alice', '1000')]);
  const projected = samplingPages([{ document: built, pin: 'x' }], (row) =>
    JSON.stringify([row.vault, row.account, row.branch]),
  );
  assert.equal(projected.length, 1);
  const [only] = projected;
  assert.ok(only !== undefined);
  assert.equal(only.rows.length, built.balances.length);
  assert.deepEqual(
    only.rows.map((row) => row.claimed),
    built.balances.map((row) => row.amount),
  );
});

// ------------------------------------------------------------------ the reference implementation

const OBSERVED: readonly SnapshotRange[] = [{ fromBlock: 10, toBlock: 24 }];

/**
 * Splits only, and the restriction is not tidiness — it is the limitation this suite names below.
 *
 * A `split` mints a complete set out of escrow, so a page containing one is a self-contained
 * history whatever its span. Every other movement in `bleavit.snapshot.v1` *consumes* a position,
 * so a page carrying one without the movement that created it replays negative and is refused. See
 * the test that follows the round trips.
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

test('A PAGE THAT STARTS MID-HISTORY CANNOT BE SERVED — the open question §8.5.2 leaves', async () => {
  // The limitation this suite exists to make visible rather than to work around, and it decides
  // whether §8.5.2's `from`/`to` are usable at all.
  //
  // §8.5.2 says an indexer serves "§8.2's snapshot document restricted to a range", and §8.4's
  // conservation replay starts every holding, supply and escrow at **zero** and requires
  // non-negativity at every step. So a page is admissible only if it carries the movements that
  // created the positions it moves. Restricting a history to blocks 15..19 does not do that: the
  // transfer below moves a position split at block 10, the fold of the page's own movements is
  // negative, and the client refuses it — under `malformed` here, because a negative holding is
  // not an amount this format can even express.
  //
  // A `split` is the one movement that mints from escrow, so a splits-only page is self-contained
  // whatever its span, which is why the fixtures above are splits. Real history is not.
  //
  // The consequence is that a conforming operator can serve only pages whose spans reach back to
  // the origin of every position they touch — that is, `from` at the beginning of history — and
  // §8.5.2's paging is then unusable for exactly the ranged reads it exists for. §8.4 arguably
  // already answers this: it assigns the internal-consistency screens to **snapshots** and gives
  // live indexers *sampling*, so a page may owe canonical form and §8.2's ordering rules without
  // owing the conservation replay. That reading is not this module's to take (R-1), so the
  // fail-closed one is in force and this test states the cost.
  const history: readonly SnapshotOp[] = [
    split(10, 'alice', '1000'),
    { kind: 'transfer', block: 17, vault: 'v1', account: 'alice', to: 'carol', branch: 'PASS', amount: '250' },
  ];
  const handle = createIndexer({
    binding: { ...BINDING },
    coverage: OBSERVED,
    blocksPerPage: 5,
    read: (span) => foldedSlice(VAULTS, history, OBSERVED, span),
    sha256,
  });

  // The page that carries the split is fine.
  assert.equal(handle('/range?from=10&to=14').status, 200);
  // The page that carries only the transfer is not, and the server refuses to serve it.
  const orphaned = handle('/range?from=15&to=19');
  assert.equal(orphaned.status, 500);
  assert.match(orphaned.body, /would be rejected by the client/);

  // And end to end, the walk over the full span stops at that page as a failed read.
  const wire = overHandler(handle);
  const read = await readRange(wire.source, { fromBlock: 10, toBlock: 24 }, sha256);
  assert.equal(read.outcome.kind, 'failed');
  assert.equal(read.pages.length, 1, 'the first page arrived; the second could not be built');
  assert.deepEqual(read.coverage, [{ fromBlock: 10, toBlock: 14 }]);
  assert.deepEqual(read.holes, [{ fromBlock: 15, toBlock: 24 }]);
});

test('the reference server refuses to serve a page its own consumer would reject', async () => {
  // The obligation the README states, enforced. This slice claims real chain balances beside a
  // partial op set — the shape an incomplete index actually produces — and the client's own
  // `admitSnapshot` catches it before the bytes reach a socket.
  const handle = createIndexer({
    binding: { ...BINDING },
    coverage: OBSERVED,
    blocksPerPage: 100,
    read: (span) => {
      const honest = foldedSlice(VAULTS, HISTORY, OBSERVED, span);
      return {
        ...honest,
        balances: [
          ...honest.balances,
          { vault: 'v1', account: 'mallory', branch: 'PASS', amount: '1' },
        ],
      };
    },
    sha256,
  });
  const served = handle('/range?from=10&to=24');
  assert.equal(served.status, 500);
  assert.match(served.body, /would be rejected by the client/);

  // And the client counts it as exactly one thing: a failed read.
  const wire = overHandler(handle);
  const read = await readRange(wire.source, { fromBlock: 10, toBlock: 24 }, sha256);
  assert.equal(read.outcome.kind, 'failed');
  assert.equal(read.pages.length, 0);
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
