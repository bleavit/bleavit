/**
 * The live-indexer read interface, from the client's side — 10 §8.5.2. F24.
 *
 * > An indexer serves **§8.2's snapshot document restricted to a range** — the same canonical
 * > serialization, the same ordering rules, the same row identity. It is deliberately not a
 * > second format.
 *
 * So there is no parser here, no format, and no document type. `snapshot.ts` owns all three and
 * this module reads its routes.
 *
 * **`FE-PROV-004` is not part of that argument**, and this module said it was until 2026-08-07.
 * §8.5.2 is explicit: that code is scoped by §8.4's table to *"two independent **snapshots**
 * covering the same range"*, and §2.3 says the same — so it does not diff a snapshot against an
 * indexer, and a second format would not have widened it. The one-format ruling stands on
 * canonical serialization alone, which is enough: a consumer that cannot reconstruct the same
 * bytes cannot check the producer.
 *
 * ## Three properties §8.5.2 fixes, each of which removes an invention
 *
 * **The error contract is that there is none.** Any status other than `200`, and any body that is
 * not a canonical §8.2 document, is a failed read. This module therefore defines no error
 * vocabulary and parses none: a failure carries a `why` sentence for the §8.3 ladder and nothing
 * a caller can switch on. An operator implements no error codes and a client needs none to
 * interpret one, which is both the most minimal reading of INV-FE-15 and the fail-closed one.
 *
 * **The cursor is opaque.** {@link readRange} passes back exactly the token it was handed and
 * never constructs, parses, decodes or increments one. The token's meaning is the operator's
 * business — the reference implementation in `app/optional/indexer/` happens to encode a block
 * number, and nothing here may depend on that.
 *
 * **Coverage comes from the documents, never from the cursor.** Absence of a next cursor is a
 * server's claim, of exactly the kind §8.5.1 refuses to accept from `storageDone`: the interface
 * says a cursor follows when more pages follow, and says nothing about a server that stops early,
 * caps a response, or discards a page. So what a caller is told it holds is
 * {@link RangeRead.coverage} — the union of the coverage lists the pages **actually carried**,
 * merged into §8.2's one-spelling form — and {@link RangeRead.holes}, which is what is left of the
 * requested span after that union. A reader that trusted the cursor would report an `observed`
 * span it never observed, which is the accidental forgery §8.2 exists to prevent and which passes
 * every screen in §8.4 because the movements it does carry are consistent.
 *
 * ## The pin screen does not apply here, and saying so is better than pretending it does
 *
 * {@link admitIndexerPage} runs §8.2's canonical-form check and the screens §8.5.2 says a page
 * owes, and it takes a content pin. A live page has none: a snapshot is a **file** somebody
 * published and quoted a hash for, and a page is bytes served now. There is no second claim to
 * compare against, so the pin argument here is the digest of the bytes just received and the pin
 * screen is satisfied by construction.
 *
 * That is deliberately **not** the `assertCheckable` shape this repository keeps removing — an
 * optional hash function, a check that defaults off. `sha256` is a required argument of
 * {@link readRange} and every screen a page owes runs at full strength; what is absent is an
 * out-of-band claim that does not exist for this provider kind, which is exactly why §8.4 gives
 * indexers *sampling* where it gives snapshots *screens*. The digest is not discarded: it is
 * reported as {@link IndexerPage.pin}, the content address of those bytes, so a re-read of the
 * same span can be recognised as the same bytes without re-comparing them.
 *
 * ## A page is checked against itself, never against a history it does not carry
 *
 * This module ran **every** `admitSnapshot` screen until 2026-08-07, and that was wrong in a way
 * that made the route useless rather than merely strict. §8.4's conservation replay starts every
 * holding, supply and escrow at zero and requires non-negativity at each step, so a document is
 * admissible only when it carries the movements that created the positions it moves. A `split`
 * mints from escrow and is self-contained at any span; a `merge`, `transfer` or `redeem` of a
 * position created earlier replays negative. A page over blocks 15..19 of a real history is
 * exactly that case — so under the old behaviour a conforming operator could serve only spans
 * reaching back to the origin of every position they touch, and §8.5.2's `from` and `to` were
 * unusable for every ranged read they exist for.
 *
 * §8.5.2 rules it, and names which of §8.4's three internal-consistency screens drop — the
 * **conservation replay** and the **event↔derived-row agreement**, for two *different* reasons
 * that are easy to collapse into one. The replay goes because non-negativity from a zero start is
 * meaningless for a page that opens mid-history. The derived-row check goes because §8.5.2 rules
 * that a page's `balances` are **read from state at its last block** rather than folded from its
 * own movements — which they must be, since §8.5.2 assigns this route to §8.4's sampling and
 * sampling re-verifies rows against the chain.
 *
 * **Monotone coverage stays** — it is internal to the document, a mid-history page satisfies it,
 * and it is what makes this module's coverage arithmetic sound, since {@link readRange} builds a
 * caller's coverage from the union of the lists the pages carried. See {@link admitIndexerPage},
 * which owns both derivations.
 *
 * ## Where the cursor travels, and the one thing §8.5.2 does not fix
 *
 * §8.5.2 says a `/range` response is *"a §8.2 document covering some prefix of the requested span,
 * plus `nextCursor` when more pages follow"* and does not say where the cursor sits. It cannot sit
 * in the body: §8.5.2's own error contract makes *"any body that is not a canonical §8.2
 * document"* a failed read, and a body carrying a sibling key is not the canonical serialization
 * of any document — under that reading every non-final page would be a failed read, which is a
 * contradiction rather than a rule. An envelope (`{"document": …, "nextCursor": …}`) removes the
 * contradiction and costs the check: the canonical-form screen is a claim about **bytes**, so a
 * consumer would have to re-serialize what it parsed, and a re-serialization is canonical by
 * construction. It also stops a page being byte-comparable against the equivalent snapshot, which
 * is the cross-check §8.5.2 gives as its reason for one format.
 *
 * So the cursor travels in a response header, {@link NEXT_CURSOR_HEADER}, and the body is exactly
 * the canonical §8.2 document. The header name is this repository's, not the specification's — it
 * is the one name F24 had to choose, it is stated here rather than buried, and it lives in one
 * constant that both the client and `app/optional/indexer/` import, so the two cannot drift.
 * PLAN.md · *Spec questions* owns the ruling.
 */

import { parseBinding, providerUrl } from './endpoint.js';
import { IMPORT_MAX_ROWS, IMPORT_MAX_UNCOMPRESSED_BYTES } from './import-quota.js';
import { snapshotRefusal, type ProviderRefusal } from './refusals.js';
import type { ProbeOutcome } from './sampling.js';
import { admitIndexerPage, preimageOfSerialized } from './snapshot.js';
import type {
  Sha256,
  SnapshotBalance,
  SnapshotDocument,
  SnapshotFinding,
  SnapshotRange,
} from './snapshot.js';
import type { ProviderPage, ProviderRow } from './sampling.js';
import type { ChainBinding } from '@bleavit/handoff-envelope';

/**
 * The response header a `/range` page carries its continuation token in.
 *
 * One constant, imported by both sides, for the reason `snapshot.ts` gives about the serializer: a
 * server and a client that each spell the name where they use it agree on the day they are written
 * and diverge at the first edit — and the symptom would be a walk that silently stops after one
 * page and reports the coverage of one page as the whole answer.
 */
export const NEXT_CURSOR_HEADER = 'bleavit-next-cursor';

/**
 * One HTTP response, as this module needs to see it.
 *
 * The body arrives as **text**, never parsed. A transport that parsed JSON would have already
 * decided what a malformed body means, and §8.5.2 makes that this module's decision; worse, the
 * canonical-form screen is a claim about bytes, so a transport that handed over an object would
 * have destroyed the only artifact the screen can run on.
 *
 * `header` is a function rather than a map because header names are case-insensitive on the wire
 * and a caller adapting `fetch` should hand over `Headers.get`, which already knows that.
 *
 * It is deliberately a **superset** of `probe.ts`'s `ProbeResponse` (`status` + `body`), so one
 * adapter over `fetch` satisfies both this and §8.5.3's probe. The probe needs no header and says
 * so; this route needs one. Merging the two into a single package-wide transport type is a
 * tidy-up worth doing once both halves of F24 have landed.
 */
export interface IndexerResponse {
  readonly status: number;
  readonly body: string;
  readonly header: (name: string) => string | null;
}

/**
 * The transport, injected.
 *
 * Never `globalThis.fetch`. This package may not decide *how* the client reaches the network — the
 * same discipline that keeps the chain SDK in `chain-client` (10 §4.1) and that makes
 * `chainRowCheck` take a `ChainRead`. It also makes every route below testable against a server
 * that is a function, which is how the reference implementation is exercised without a socket.
 */
export type IndexerGet = (url: string) => Promise<IndexerResponse>;

/** What a caller must hold to read from one operator's endpoint. */
export interface IndexerSource {
  /** The operator's base URL. §8.5.2's two routes hang off it. */
  readonly endpoint: string;
  readonly get: IndexerGet;
  /**
   * The chain this client is on. **Only `genesisHash` is compared**, exactly as
   * {@link admitSnapshot} compares it and for the reason recorded there (SQ-610): a document
   * describing another chain has nothing to contribute, and a `specVersion` difference is not a
   * reason to refuse history that necessarily predates the current runtime.
   */
  readonly binding: ChainBinding;
}

// ------------------------------------------------------------------ coverage arithmetic

/**
 * §8.2's coverage form, as a function: ordered, non-overlapping and **maximally merged**.
 *
 * Not a second copy of `local-index`'s `holesIn`/`addRange`, and the difference is the reason both
 * exist. Those merge **provenance-carrying** ranges and refuse to join two of different origin,
 * because a joined range must claim one origin and either choice mislabels half its blocks
 * (10 §6.3). These are the format's own ranges: a `SnapshotRange` carries no origin, every range
 * in one read came from one operator, and §8.2 requires the merge rather than forbidding it —
 * *"the coverage list is ordered, non-overlapping and maximally merged, so one covered set has
 * exactly one spelling"*.
 *
 * An **inverted** range throws rather than being dropped. Dropping it would silently shrink a
 * coverage claim, and a shrunk coverage claim reads as *this range was never served* in the one
 * module whose job is to say what was.
 */
export function mergeCoverage(ranges: readonly SnapshotRange[]): readonly SnapshotRange[] {
  const sorted = [...ranges].sort(
    (left, right) => left.fromBlock - right.fromBlock || left.toBlock - right.toBlock,
  );
  const merged: SnapshotRange[] = [];
  for (const range of sorted) {
    if (range.fromBlock > range.toBlock) {
      throw new RangeError(
        `coverage range ${range.fromBlock}..${range.toBlock} is inverted. A range is a statement ` +
          'about which blocks were observed, and there is no honest reading of one that ends ' +
          'before it starts',
      );
    }
    const last = merged[merged.length - 1];
    if (last !== undefined && range.fromBlock <= last.toBlock + 1) {
      if (range.toBlock > last.toBlock) {
        merged[merged.length - 1] = { fromBlock: last.fromBlock, toBlock: range.toBlock };
      }
      continue;
    }
    merged.push({ fromBlock: range.fromBlock, toBlock: range.toBlock });
  }
  return merged;
}

/**
 * Whether a list is already in §8.2's form — the check `/chain`'s answer owes.
 *
 * Expressed as *"merging changes nothing"* rather than as a second set of rules, so the two
 * cannot disagree about what maximally merged means.
 */
function inCanonicalCoverageForm(ranges: readonly SnapshotRange[]): boolean {
  let merged: readonly SnapshotRange[];
  try {
    merged = mergeCoverage(ranges);
  } catch {
    return false;
  }
  if (merged.length !== ranges.length) return false;
  return merged.every((range, i) => {
    const given = ranges[i];
    return (
      given !== undefined && given.fromBlock === range.fromBlock && given.toBlock === range.toBlock
    );
  });
}

/**
 * What is left of `span` after `coverage` — 10 §6.3's holes, over this format's ranges.
 *
 * The load-bearing direction is that this is computed and never supplied. A read that reported the
 * requested span as its coverage would be reporting the question as the answer, which is
 * §8.5.1's *"completeness is established, never inferred"* in the shape §8.5.2 gives it.
 */
export function coverageHoles(
  span: SnapshotRange,
  coverage: readonly SnapshotRange[],
): readonly SnapshotRange[] {
  if (span.fromBlock > span.toBlock) {
    throw new RangeError(`the span ${span.fromBlock}..${span.toBlock} is inverted`);
  }
  const holes: SnapshotRange[] = [];
  let at = span.fromBlock;
  for (const range of mergeCoverage(coverage)) {
    if (range.toBlock < span.fromBlock || range.fromBlock > span.toBlock) continue;
    const from = Math.max(range.fromBlock, span.fromBlock);
    const to = Math.min(range.toBlock, span.toBlock);
    if (from > at) holes.push({ fromBlock: at, toBlock: from - 1 });
    at = Math.max(at, to + 1);
  }
  if (at <= span.toBlock) holes.push({ fromBlock: at, toBlock: span.toBlock });
  return holes;
}

// ------------------------------------------------------------------ the routes

/**
 * Build a route URL, refusing a scheme that is not HTTP(S).
 *
 * The refusal itself lives in {@link providerUrl} and is **not** repeated here. This function
 * parsed the endpoint and checked the protocol itself before calling it until 2026-08-07, which
 * put two copies of one rule about untrusted input in the same call chain — the duplication
 * `endpoint.ts` was extracted to end, and the same shape that let a reachable ReDoS be written
 * into the trailing-slash trim twice on the day it was introduced.
 */
function routeUrl(endpoint: string, route: string, query: string): string | null {
  const base = providerUrl(endpoint, route);
  return base === null ? null : `${base}${query}`;
}

/**
 * The §8.3 ladder effect of a read-path outcome, or `null` for none.
 *
 * Exists so that no caller has to decide this for itself. §8.5.2 rules that a failed read does
 * **not** advance the probe ladder, and §8.5.3 rules that a wrong-chain answer disables at once;
 * a call site holding a `RangeOutcome` and a `Provider` could satisfy either rule and violate the
 * other, and would have to know both to get it right. Feed the result to `afterProbe` when it is
 * not `null`.
 *
 * The asymmetry is the point: **liveness never reaches the ladder from the read path, correctness
 * always does.** Without the second half a source that answers `GET /chain` and fails every
 * `GET /range` could not be disabled by anything at all — the gap an R-6 re-review found on
 * 2026-08-07, created by the fix that removed read failures from the ladder.
 */
export function ladderEffect(outcome: RangeOutcome | ChainAnswer): ProbeOutcome | null {
  return outcome.kind === 'disqualified' ? { kind: 'disqualified', why: outcome.why } : null;
}

/** What `GET /chain` answered, or why it did not answer. */
export type ChainAnswer =
  | {
      readonly kind: 'answered';
      readonly binding: ChainBinding;
      /** The coverage the operator says it currently serves, in §8.2's form. */
      readonly coverage: readonly SnapshotRange[];
    }
  /** A liveness failure: the endpoint did not answer usefully. Counted, never terminal. */
  | { readonly kind: 'failed'; readonly why: string }
  /**
   * A **correctness** finding: it answered, and the answer proves it cannot serve this client.
   * Terminal — {@link ladderEffect} routes it to `disqualified`, which disables at once.
   */
  | { readonly kind: 'disqualified'; readonly why: string };

/**
 * `GET /chain` — the served-coverage and binding read (§8.5.2).
 *
 * The **second** consumer of this route, not a duplicate of the first. §8.5.3's probe asks the same
 * question and keeps one bit of the answer (did it respond, how fast), because that is all the
 * §8.3 ladder consumes. A caller about to read a range needs the parts the probe discards: the
 * served coverage, so a request for blocks the operator does not hold is not sent at all, and the
 * two version fields, which a caller renders as an advisory line.
 *
 * Never throws. A transport that rejects is a failed read — the ordinary case is a timeout or a
 * refused connection — and letting it propagate would turn an expected provider condition into an
 * exception at a call site that has a ladder to feed instead.
 *
 * The body is read as §8.2's `binding` object with the served `coverage` beside it, which is
 * §8.5.3's own phrasing (*"the body parses as §8.2's `binding` object"*) with §8.5.2's second
 * column added. `coverage` must already be in §8.2's ordered, non-overlapping, maximally merged
 * form: §8.5.2 requires that of this route in as many words, and a client that quietly merged a
 * malformed list would accept two spellings of one covered set from a route whose whole job is to
 * state it once.
 */
export async function readChain(source: IndexerSource): Promise<ChainAnswer> {
  const url = routeUrl(source.endpoint, 'chain', '');
  if (url === null) {
    return { kind: 'failed', why: `${source.endpoint} is not an http(s) endpoint` };
  }
  let response: IndexerResponse;
  try {
    response = await source.get(url);
  } catch (error) {
    return { kind: 'failed', why: failureText(error) };
  }
  if (response.status !== 200) return { kind: 'failed', why: `answered ${response.status}` };

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    return { kind: 'failed', why: 'answered something that is not JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { kind: 'failed', why: 'answered something that is not an object' };
  }
  const record = parsed as Record<string, unknown>;
  // One parser, shared with §8.5.3's probe — see `bindingGenesisOf`. Two spellings of "parses as
  // §8.2's binding object" let a body answer the probe and fail this route, which leaves a source
  // permanently `Healthy` and permanently unusable.
  const binding = parseBinding(record);
  if (binding === null) {
    return { kind: 'failed', why: "answered something that is not §8.2's binding object" };
  }
  const { genesisHash } = binding;
  if (genesisHash !== source.binding.genesisHash) {
    return {
      kind: 'disqualified',
      why: `describes genesis ${genesisHash}; this client is on ${source.binding.genesisHash}`,
    };
  }
  const coverage = parseRanges(record['coverage']);
  if (coverage === null) return { kind: 'failed', why: 'answered without a coverage list' };
  if (!inCanonicalCoverageForm(coverage)) {
    return {
      kind: 'failed',
      why:
        'answered a coverage list that is not ordered, non-overlapping and maximally merged ' +
        '(10 §8.2); one covered set has exactly one spelling',
    };
  }
  return { kind: 'answered', binding, coverage };
}

/** One `/range` response that passed every screen, with the content address of its bytes. */
export interface IndexerPage {
  readonly document: SnapshotDocument;
  /**
   * `sha256` over §8.2's pre-image of exactly the bytes served.
   *
   * The page's content address, **not** a verified pin — nobody published it and nobody quoted it.
   * A caller records it so a re-read of the same span can be recognised as the same bytes without
   * re-comparing them.
   *
   * It is **not** a `FE-PROV-004` input, and this comment said it was. That code is scoped by
   * §8.4's table to two independent *snapshots*, so a page has no pair to be half of.
   */
  readonly pin: string;
}

/** Why the page walk stopped. Every arm is a fact about the walk, never about the coverage. */
export type RangeOutcome =
  /** The server offered no further cursor. A **claim**, which is why coverage is not read off it. */
  | { readonly kind: 'exhausted' }
  /** The server handed back a cursor the walk had already followed. */
  | { readonly kind: 'cursor-repeated'; readonly cursor: string }
  /** The walk reached one page per block of the requested span. See {@link readRange}. */
  | { readonly kind: 'page-ceiling'; readonly pages: number }
  /**
   * The walk reached §8.4's byte or row ceiling and stopped.
   *
   * Not a failed read and not a finding about the operator: the pages that arrived were admitted,
   * their coverage is real, and what is left of the span stays in {@link RangeRead.holes}. A
   * caller that wants the rest issues a narrower span. Like the two stops above it, this
   * under-claims, which is the direction that cannot invent history.
   */
  | { readonly kind: 'quota-reached'; readonly bytes: number; readonly rows: number }
  /**
   * **No page arrived**: the transport rejected, the status was not `200`, or the endpoint is one
   * this client will not use. A liveness failure, and it carries no refusal code on purpose.
   *
   * §8.5.2 says a failed read is reported with `FE-PROV-003`, and its own justification is that
   * *"a page is a §8.2 document and fails on exactly those grounds"* — which is true of a document
   * that arrived and false of one that never did. `FE-PROV-003`'s fixed remedy tells the user to
   * check that their download completed and to compare its hash against the publisher's. For a
   * `503` there is no download, no publisher and no hash, so attaching it here would repeat
   * exactly the defect that deleted the `incomplete-check` cause on 2026-08-06: a fixed remedy
   * sentence that is false for the case that reaches it.
   *
   * What a user sees instead is already correct and already built — the span stays in
   * {@link RangeRead.holes}, which is §6.3's coverage machinery saying *this range was not
   * observed*. That is the honest surface for a read that did not happen.
   */
  | { readonly kind: 'unreachable'; readonly why: string }
  /**
   * **A page arrived and failed a screen a page owes** — §8.5.2's `FE-PROV-003`, carried.
   *
   * This is the arm the code names, and the grounds match: a malformed body, a body that is not in
   * canonical form, or one whose coverage does not contain its own movements. Every one of those
   * is a statement about a document the operator served, which is what `FE-PROV-003` is for.
   */
  | { readonly kind: 'rejected'; readonly why: string; readonly refusal: ProviderRefusal }
  /**
   * A page that proves the source cannot serve this client — today, a binding for another chain.
   *
   * Split out from `failed` on 2026-08-07 after an R-6 re-review found the control gap it closes.
   * §8.5.2 rules that a failed read does **not** advance §8.3's probe ladder, which is right: a
   * ladder that ratchets on data reads disables faster for a user who reads more. But with the
   * read path contributing *nothing*, a source that answers `GET /chain` and fails every
   * `GET /range` could never be disabled by anything — probes keep succeeding, sampling never
   * runs because no rows arrive, and the wrong-chain evidence §8.5.3 makes terminal was being
   * discarded because it arrived on the read path. Liveness stays off the ladder; correctness
   * does not.
   */
  | { readonly kind: 'disqualified'; readonly why: string };

/**
 * What a range read holds afterwards.
 *
 * `pages` survives a failure on purpose. A walk that read three good pages and then met a `500`
 * really did receive those three, every screen ran over them, and their coverage is as real as it
 * would have been had the fourth page arrived — discarding it would lose history the client
 * already has because of a later failure, and would make a retry the only way to recover blocks
 * that were never in doubt. The ladder still counts the failure; that is what `outcome` is for.
 */
export interface RangeRead {
  readonly requested: SnapshotRange;
  readonly pages: readonly IndexerPage[];
  /** The union of the coverage lists the pages carried, in §8.2's form. Never the request. */
  readonly coverage: readonly SnapshotRange[];
  /** What is left of `requested` after `coverage`. Empty means the pages really did cover it. */
  readonly holes: readonly SnapshotRange[];
  readonly outcome: RangeOutcome;
}

/**
 * `GET /range` — walk one span, page by page (§8.5.2).
 *
 * ## The walk terminates on a number nobody picked
 *
 * A hostile or broken server can hand back a cursor forever, so the walk needs a bound, and a
 * bound chosen by taste is a limit that is either too small for an honest operator or no limit at
 * all. The bound here is **derived**: §8.5.2 makes each page *"a §8.2 document covering some prefix
 * of the requested span"*, and pages are prefixes of one another's remainder, so a conforming
 * server cannot offer more pages than the span has blocks — a page beyond that covers no block
 * that is left. `to - from + 1` is therefore exact rather than generous, and a walk that reaches it
 * has met a server that is not conforming.
 *
 * A **repeated cursor** stops the walk before that, because it is the cheap shape of the same
 * failure and catches it in two round trips instead of a span's worth.
 *
 * Neither stop is a failed read. Both are servers behaving badly, and both leave the client holding
 * exactly the coverage the pages carried — under-claiming, which is the direction that cannot
 * invent history. §8.3's ladder counts *failures*, and a page that arrived and passed every screen
 * is not one.
 *
 * ## A page outside the requested span is refused, not trimmed
 *
 * §8.5.2 makes a page a document over *"some prefix of the requested span"*, so a page whose
 * declared `range` leaves that span is not a conforming answer to this question. It is refused
 * rather than intersected, because {@link admitSnapshot} guarantees coverage ⊆ range and every
 * movement ⊆ coverage — so bounding `range` bounds the whole document, while trimming only the
 * coverage list would leave a caller holding movements at blocks its own coverage does not claim.
 *
 * `sha256` is a **required argument**. See the module note: the pin screen does not apply to a live
 * page, and the way to say so is to keep the hash mandatory and report the digest, not to make it
 * optional and quietly skip it.
 */
export async function readRange(
  source: IndexerSource,
  span: SnapshotRange,
  sha256: Sha256,
): Promise<RangeRead> {
  if (!isU32(span.fromBlock) || !isU32(span.toBlock) || span.fromBlock > span.toBlock) {
    // A caller's defect, not a provider's. Reporting it as a failed read would advance §8.3's
    // ladder against an operator for a request this client should never have formed.
    throw new RangeError(
      `readRange needs a u32 span with fromBlock <= toBlock; got ${span.fromBlock}..${span.toBlock}`,
    );
  }
  const requested: SnapshotRange = { fromBlock: span.fromBlock, toBlock: span.toBlock };
  const pages: IndexerPage[] = [];
  const carried: SnapshotRange[] = [];
  const followed = new Set<string>();
  const ceiling = requested.toBlock - requested.fromBlock + 1;

  const done = (outcome: RangeOutcome): RangeRead => {
    const coverage = mergeCoverage(carried);
    return { requested, pages, coverage, holes: coverageHoles(requested, coverage), outcome };
  };

  let cursor: string | null = null;
  let bytes = 0;
  let rows = 0;
  for (;;) {
    if (pages.length >= ceiling) return done({ kind: 'page-ceiling', pages: pages.length });
    if (bytes >= IMPORT_MAX_UNCOMPRESSED_BYTES || rows >= IMPORT_MAX_ROWS) {
      return done({ kind: 'quota-reached', bytes, rows });
    }
    const url = rangeUrl(source.endpoint, requested, cursor);
    if (url === null) {
      return done({ kind: 'unreachable', why: `${source.endpoint} is not an http(s) endpoint` });
    }
    let response: IndexerResponse;
    try {
      response = await source.get(url);
    } catch (error) {
      return done({ kind: 'unreachable', why: failureText(error) });
    }
    if (response.status !== 200) {
      return done({ kind: 'unreachable', why: `answered ${response.status}` });
    }
    // The one admission path, over the bytes as served. `expectedPin` is the digest of those
    // bytes — see the module note on why that is a statement about this provider kind and not a
    // check switched off. `admitIndexerPage`, never `admitSnapshot`: §8.5.2 drops the two screens
    // that compare a document against a state predating it, and running them here made every
    // mid-history range inadmissible.
    const pin = sha256(preimageOfSerialized(response.body));
    const verdict = admitIndexerPage(
      response.body,
      { expectedPin: pin, binding: source.binding },
      sha256,
    );
    if (verdict.kind === 'rejected') {
      // A page describing ANOTHER CHAIN is a correctness finding, not a liveness one, and it must
      // reach the ladder even though §8.5.2 keeps ordinary read failures off it. The page screens
      // include the same `binding` screen the import path runs, so the evidence is here — it was
      // simply being flattened into a `why` string and discarded.
      // NOT `verdict.refusal.detail` for the wrong-chain arm. That string is built with the
      // `wrong-chain` cause, whose fixed remedy is written for a downloaded FILE — "Re-downloading
      // will not help. Look for a snapshot published for this chain — the publisher's page should
      // state which one each file covers." This is a live indexer with no publisher and no page.
      // The `why` here becomes `Provider.health.reason` and is rendered verbatim, so the wrong
      // artifact's advice reaches the user. An R-6 review found it surviving in the sibling branch
      // of the same `if` as the fix that introduced `served-page` a few lines below.
      const binding = verdict.findings.find((finding) => finding.screen === 'binding');
      if (binding !== undefined) {
        return done({
          kind: 'disqualified',
          why:
            `${binding.why}. This is a live index rather than a file, so there is nothing to ` +
            "re-download: the operator is serving another network's history.",
        });
      }
      // `verdict.refusal` is built for a FILE — `admitIndexerPage` shares its refusal builder with
      // the import path, so its remedy tells the user to check a download and compare a publisher's
      // hash. A live page has neither. Re-code it with the `served-page` cause; §9.4 fixes the copy
      // per code, and this is the one place that knows which artifact these bytes were.
      return done({
        kind: 'rejected',
        why: verdict.refusal.detail,
        refusal: snapshotRefusal('served-page', screensOf(verdict.findings)),
      });
    }
    const { document } = verdict;
    if (document.range.fromBlock < requested.fromBlock || document.range.toBlock > requested.toBlock) {
      const why =
        `answered a page covering ${document.range.fromBlock}..${document.range.toBlock}, which ` +
        `leaves the requested span ${requested.fromBlock}..${requested.toBlock}`;
      // A document that arrived and is wrong about itself, so it is `rejected` rather than
      // `unreachable`: §8.5.2 makes a page a document over "some prefix of the requested span",
      // and one that leaves the span is not a conforming answer to the question that was asked.
      return done({ kind: 'rejected', why, refusal: snapshotRefusal('served-page', why) });
    }
    pages.push({ document, pin });
    carried.push(...document.coverage);
    // Metered against §8.4's own ceiling, because this walk retains what it reads. The page
    // ceiling above bounds the number of ROUND TRIPS and says nothing about size: a conforming
    // server may answer every one of them with a 400 MB page. The sibling ingest path has been
    // metered since F9 (`QuotaMeter`), and an R-6 review on 2026-08-07 found this one with no
    // bound of any kind against an untrusted operator. Counted AFTER admission so a page that was
    // refused does not consume the budget, and checked at the top of the next iteration so the
    // walk stops before requesting more rather than after accepting it.
    bytes += response.body.length;
    rows += document.ops.length + document.balances.length;

    const next = response.header(NEXT_CURSOR_HEADER);
    // An absent header and an empty one are the same claim: a cursor is an opaque token, and the
    // empty token addresses nothing there would be a page at.
    if (next === null || next === '') return done({ kind: 'exhausted' });
    if (followed.has(next)) return done({ kind: 'cursor-repeated', cursor: next });
    followed.add(next);
    cursor = next;
  }
}

/** The screens that fired, for the expert detail beside a `served-page` remedy. */
function screensOf(findings: readonly SnapshotFinding[]): string {
  const named = [...new Set(findings.map((finding) => finding.screen))].join(', ');
  return `the page failed: ${named}`;
}

/**
 * The request URL, with the cursor passed back **verbatim**.
 *
 * `encodeURIComponent` is transport encoding, not interpretation: it is undone byte for byte by
 * any conforming server, and it is what keeps a token containing `&` or `#` from becoming two
 * parameters. Nothing here reads, splits, decodes or increments the token, which is §8.5.2's
 * *"a client never constructs one"* written as the absence of any code that could.
 */
function rangeUrl(endpoint: string, span: SnapshotRange, cursor: string | null): string | null {
  const query =
    `?from=${span.fromBlock}&to=${span.toBlock}` +
    (cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`);
  return routeUrl(endpoint, 'range', query);
}

// ------------------------------------------------------------------ §8.4's sampler, bound

/**
 * Project served pages into the sampler's pages — §8.5.2's second column, made executable.
 *
 * > Layer-3 ingest, and §8.4's 1-in-16-page sampling, whose *page* is one response of this route.
 *
 * That sentence binds `selectSample`'s unit of stratification to this route's unit of response,
 * and until something performs the projection it is a comment. The projection is over **balance**
 * rows, because §8.4 re-verifies *"where the referenced object still exists"* and a balance is the
 * one row in this format that names a currently-existing object; a movement names an event in a
 * block, which a light client cannot re-read at depth.
 *
 * **This is why §8.5.2 rules that a page's `balances` are read from state, not folded.** The
 * comparison at the other end of this projection is against a chain read, so a folded balance
 * would be a mid-history subtotal held up against a current holding — disagreeing on every honest
 * page, and auto-disabling the operator that served it (§8.3's *"auto-disable on sampling
 * mismatch"* is uncounted and immediate). Until 2026-08-07 that was exactly what the reference
 * implementation produced. It was never reachable, but only because a *second* defect masked it:
 * `readRange` ran the full snapshot screen set, so every page that did not reach back to genesis
 * was refused before it could be sampled, and on a genesis-anchored page the fold and the state
 * coincide. Two defects, each hiding the other, and fixing one alone would have shipped the other.
 *
 * ## Both halves of a row are injected, and the second one was not until 2026-08-07
 *
 * `project` turns one §8.2 balance into the `reference`/`claimed` pair the sampler compares. It is
 * injected for the reason `chainRowCheck` takes a `ChainRead`: a reference is a **storage key**,
 * this package may not open a chain connection or build one (10 §4.1), and a module that could
 * construct a reference would be a module that could construct the answer.
 *
 * It used to build `claimed` itself, on the reasoning that *"§8.2's amounts are already the
 * canonical decimal string a comparison is a string equality over"*. That sentence is true about
 * §8.2 and wrong about the comparison, and an R-6 review found it: `chainRowCheck` compares
 * `claimed` against `ChainReadResult.hex` as **opaque hex**, and it declines to decode on purpose,
 * because decoding needs the runtime metadata this package may not reach. So a decimal `"1000"`
 * was being compared against a SCALE-encoded storage value — **every honest row mismatches**, and
 * §8.4's *"any mismatch"* rule auto-disables the operator that served it. Each function was right
 * on its own; the defect existed only where they met.
 *
 * The fix is the seam that was already half-there: `reference` and `claimed` must come from **one**
 * function, because they must come from one metadata view. Two independent injections could be
 * derived from two, and a key from one runtime version beside a value from another is a mismatch
 * nobody served.
 */
export function samplingPages(
  pages: readonly IndexerPage[],
  project: (row: SnapshotBalance) => ProviderRow,
): readonly ProviderPage[] {
  return pages.map((page) => ({ rows: page.document.balances.map(project) }));
}

// ------------------------------------------------------------------ small shared readers

function isU32(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff;
}

/** `null` when the value is not a list of u32 ranges. Shape only; the form check is separate. */
function parseRanges(raw: unknown): readonly SnapshotRange[] | null {
  if (!Array.isArray(raw)) return null;
  const ranges: SnapshotRange[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
    const record = entry as Record<string, unknown>;
    const fromBlock = record['fromBlock'];
    const toBlock = record['toBlock'];
    if (!isU32(fromBlock) || !isU32(toBlock)) return null;
    ranges.push({ fromBlock, toBlock });
  }
  return ranges;
}

function failureText(error: unknown): string {
  const why = error instanceof Error ? error.message : String(error);
  return why === '' ? 'the request failed' : why;
}
