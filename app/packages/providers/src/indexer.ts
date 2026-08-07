/**
 * The live-indexer read interface, from the client's side — 10 §8.5.2. F24.
 *
 * > An indexer serves **§8.2's snapshot document restricted to a range** — the same canonical
 * > serialization, the same ordering rules, the same row identity. It is deliberately not a
 * > second format.
 *
 * So there is no parser here, no format, and no document type. `snapshot.ts` owns all three and
 * this module reads its routes; a second shape would additionally leave `FE-PROV-004` unable to
 * diff a snapshot against an indexer, which §8.4 calls the only cross-check available at depths
 * the light client cannot reach.
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
 * {@link admitSnapshot} is the only entry point that runs §8.2's canonical-form check and §8.4's
 * coverage, conservation and derived-row screens, and it takes a publisher's content pin. A live
 * page has none: a snapshot is a **file** somebody published and quoted a hash for, and a page is
 * bytes served now. There is no second claim to compare against, so the pin argument here is the
 * digest of the bytes just received and the pin screen is satisfied by construction.
 *
 * That is deliberately **not** the `assertCheckable` shape this repository keeps removing — an
 * optional hash function, a check that defaults off. `sha256` is a required argument of
 * {@link readRange} and every other screen runs at full strength; what is absent is an out-of-band
 * claim that does not exist for this provider kind, which is exactly why §8.4 gives indexers
 * *sampling* where it gives snapshots *screens*. The digest is not discarded: it is reported as
 * {@link IndexerPage.pin}, the content address of those bytes, which is what a caller needs to
 * diff a page against a snapshot under `FE-PROV-004`.
 *
 * ## A page is admitted as a whole history, and that bounds what can be served
 *
 * §8.4's conservation replay starts every holding, supply and escrow at **zero** and checks
 * non-negativity at every step, so a page is admissible only when it carries the movements that
 * created the positions it moves. A `split` mints from escrow and is self-contained at any span;
 * a `merge`, `transfer` or `redeem` of a position created earlier replays negative. Restricting a
 * real history to a mid-history range is exactly that case — so a conforming operator can serve
 * only spans reaching back to the origin of every position they touch, and §8.5.2's `from`/`to`
 * are then unusable for the ranged reads they exist for.
 *
 * §8.4 may already resolve it: it assigns the internal-consistency screens to **snapshots** and
 * gives live indexers *sampling* instead, which would leave a page owing canonical form and §8.2's
 * ordering rules and not the replay. §8.5.2 does not say which, and choosing is a specification
 * ruling rather than an implementation decision (R-1). The fail-closed reading is therefore in
 * force — every screen `admitSnapshot` runs, runs — and `tests/providers/indexer.test.ts` names
 * the case it costs so the limitation is a tested fact rather than a discovery.
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

import { providerUrl } from './endpoint.js';
import type { ProbeOutcome } from './sampling.js';
import { admitSnapshot, preimageOfSerialized } from './snapshot.js';
import type { Sha256, SnapshotBalance, SnapshotDocument, SnapshotRange } from './snapshot.js';
import type { ProviderPage } from './sampling.js';
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
 * §8.5.2's interface is HTTP, so a `javascript:`, `data:` or `file:` endpoint is not an indexer
 * this client failed to reach — it is a string that would become whatever the injected transport
 * does with it. Refused here, at the one place that knows what the URL is for, rather than left
 * to a transport that cannot know.
 */
function routeUrl(endpoint: string, route: string, query: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
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
  const genesisHash = record['genesisHash'];
  const specVersion = record['specVersion'];
  const contractVersion = record['contractVersion'];
  if (typeof genesisHash !== 'string' || genesisHash === '') {
    return { kind: 'failed', why: 'answered without a chain binding' };
  }
  if (!isU32(specVersion) || !isU32(contractVersion)) {
    return { kind: 'failed', why: 'answered a chain binding without u32 versions' };
  }
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
  return {
    kind: 'answered',
    binding: { genesisHash, specVersion, contractVersion },
    coverage,
  };
}

/** One `/range` response that passed every screen, with the content address of its bytes. */
export interface IndexerPage {
  readonly document: SnapshotDocument;
  /**
   * `sha256` over §8.2's pre-image of exactly the bytes served.
   *
   * The page's content address, **not** a verified pin — nobody published it and nobody quoted it.
   * It is what a caller diffs against a snapshot's pin under `FE-PROV-004`, and what a caller
   * records so a re-read of the same span can be recognised as the same bytes.
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
  /** §8.5.2's only error contract: a non-`200`, or a body that is not a canonical §8.2 document. */
  | { readonly kind: 'failed'; readonly why: string }
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
  for (;;) {
    if (pages.length >= ceiling) return done({ kind: 'page-ceiling', pages: pages.length });
    const url = rangeUrl(source.endpoint, requested, cursor);
    if (url === null) {
      return done({ kind: 'failed', why: `${source.endpoint} is not an http(s) endpoint` });
    }
    let response: IndexerResponse;
    try {
      response = await source.get(url);
    } catch (error) {
      return done({ kind: 'failed', why: failureText(error) });
    }
    if (response.status !== 200) {
      return done({ kind: 'failed', why: `answered ${response.status}` });
    }
    // The one admission path, over the bytes as served. `expectedPin` is the digest of those
    // bytes — see the module note on why that is a statement about this provider kind and not a
    // check switched off.
    const pin = sha256(preimageOfSerialized(response.body));
    const verdict = admitSnapshot(response.body, { expectedPin: pin, binding: source.binding }, sha256);
    if (verdict.kind === 'rejected') {
      // A page describing ANOTHER CHAIN is a correctness finding, not a liveness one, and it must
      // reach the ladder even though §8.5.2 keeps ordinary read failures off it. `admitSnapshot`
      // already runs the same `binding` screen the import path runs, so the evidence is here — it
      // was simply being flattened into a `why` string and discarded.
      const wrongChain = verdict.findings.some((finding) => finding.screen === 'binding');
      return done({
        kind: wrongChain ? 'disqualified' : 'failed',
        why: verdict.refusal.detail,
      });
    }
    const { document } = verdict;
    if (document.range.fromBlock < requested.fromBlock || document.range.toBlock > requested.toBlock) {
      return done({
        kind: 'failed',
        why:
          `answered a page covering ${document.range.fromBlock}..${document.range.toBlock}, which ` +
          `leaves the requested span ${requested.fromBlock}..${requested.toBlock}`,
      });
    }
    pages.push({ document, pin });
    carried.push(...document.coverage);

    const next = response.header(NEXT_CURSOR_HEADER);
    // An absent header and an empty one are the same claim: a cursor is an opaque token, and the
    // empty token addresses nothing there would be a page at.
    if (next === null || next === '') return done({ kind: 'exhausted' });
    if (followed.has(next)) return done({ kind: 'cursor-repeated', cursor: next });
    followed.add(next);
    cursor = next;
  }
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
 * `reference` is injected for the reason `chainRowCheck` takes a `ChainRead`: it is a storage key,
 * this package may not open a chain connection or build one (10 §4.1), and a module that could
 * construct a reference would be a module that could construct the answer. `claimed` needs no
 * rendering — §8.2's amounts are already the canonical decimal string a comparison is a string
 * equality over.
 */
export function samplingPages(
  pages: readonly IndexerPage[],
  reference: (row: SnapshotBalance) => string,
): readonly ProviderPage[] {
  return pages.map((page) => ({
    rows: page.document.balances.map((row) => ({
      reference: reference(row),
      claimed: row.amount,
    })),
  }));
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
