/**
 * `app/optional/indexer` — the reference live indexer (10 §8.2, §8.5.2). F24.
 *
 * > **live indexers** (minimal read-only HTTP interface; reference implementation in
 * > `optional/indexer/`) — 10 §8.2
 *
 * §8.2 names this path in as many words, which is why the directory is here rather than under
 * `tools/`: `tools/snapshot` is the producer of §8.2's *other* artifact and this is the producer of
 * the first. Both are release artifacts in the sense 15 §4.7 means — an operator has to be able to
 * run one, and a client author has to be able to read one to know what a conforming answer is.
 *
 * ## It writes no format, and that is the whole design
 *
 * The document, its canonical serialization, its content pre-image and its screens all come from
 * `@bleavit/providers` — the module the **client** imports. A server with its own serializer agrees
 * on the day it is written and diverges at the first field, and the symptom is every page from that
 * operator failing at the user, which reads as a broken indexer rather than as two spellings of one
 * history. So this file contains no JSON assembly, no hashing rule and no balance arithmetic; what
 * it contains is routing, paging and the refusals.
 *
 * ## It cannot serve a page its own consumer would reject
 *
 * The last step before answering a `/range` request runs `admitSnapshot` — the client's real
 * admission path, not a checklist of what it was believed to check — over exactly the bytes that
 * are about to go on the wire, with the digest of those bytes. A rejected page is answered `500`
 * and never served. The operator sees the reason in the response body and in their log; the client
 * sees a non-`200`, which §8.5.2 makes a failed read counted by §8.3's ladder, and never sees a
 * document it would have had to reject.
 *
 * That check is what turns the operator obligations in `README.md` from documentation into
 * behaviour. The sharpest of them is not obvious: a page's `balances` are the fold of **that page's
 * own movements**, because §8.4's event↔derived-row screen compares them against a replay of the
 * document it is in. They are not the accounts' holdings at the page's last block unless the page
 * happens to carry those accounts' whole history.
 *
 * ## The limitation that decides which spans can be served, and it is unresolved
 *
 * §8.4's conservation replay starts every holding, supply and escrow at **zero**, so a page is
 * admissible only if it carries the movements that created the positions it moves. A `split` mints
 * from escrow and is therefore self-contained at any span; a `merge`, `transfer` or `redeem` of a
 * position created in an earlier block replays negative and the page is refused. Restricting a real
 * history to blocks 15..19 is exactly that case, which means a conforming operator can only serve
 * spans reaching back to the origin of every position they touch — and §8.5.2's `from`/`to` are
 * then unusable for the ranged reads they exist for.
 *
 * §8.4 may already answer it: it assigns the internal-consistency screens to **snapshots** and
 * gives live indexers *sampling*, which would leave a page owing canonical form and §8.2's ordering
 * rules without owing the replay. §8.5.2 does not say. That is a specification ruling rather than an
 * implementation choice (R-1), so the client's fail-closed reading is in force, this server refuses
 * rather than serving a page the client would reject, and `tests/providers/indexer.test.ts` names
 * the case so the cost is a tested fact instead of a surprise.
 *
 * ## What is deliberately absent
 *
 * The **ingest side**. This server is pure over an injected {@link SliceReader}: where an operator's
 * movements come from — an archive node, a Substrate indexer, a database somebody already runs — is
 * not fixed by 10 §8.5.2, which specifies the *read* interface and nothing behind it. Writing an
 * ingest path here by assumption is what R-2 forbids, and it would also make the reference
 * implementation something only its author can operate.
 */

import {
  NEXT_CURSOR_HEADER,
  SNAPSHOT_FORMAT,
  admitSnapshot,
  deriveBalances,
  mergeCoverage,
  preimageOfSerialized,
  serializeSnapshot,
} from '@bleavit/providers';
import type {
  Sha256,
  SnapshotBalance,
  SnapshotDocument,
  SnapshotOp,
  SnapshotRange,
  SnapshotVault,
} from '@bleavit/providers';
import { byCodePoint, canonicalJson } from '@bleavit/handoff-envelope';
import type { ChainBinding } from '@bleavit/handoff-envelope';

/**
 * What the operator observed inside one span.
 *
 * The four members are exactly §8.2's per-range payload, and every one of them is the operator's
 * to supply — see `README.md`. `coverage` is what was **observed**, never the span that was asked
 * for: a reader that answers the request when it saw only part of it publishes history it never
 * looked at, which is §8.5.1's *"completeness is established, never inferred"* on this side of the
 * wire, and which passes every screen because the movements it does carry are consistent.
 */
export interface IndexerSlice {
  readonly coverage: readonly SnapshotRange[];
  readonly vaults: readonly SnapshotVault[];
  /** In **chain order** — block, then extrinsic, then event. Never sorted here: see the README. */
  readonly ops: readonly SnapshotOp[];
  readonly balances: readonly SnapshotBalance[];
}

/** The operator's index, as one function. Synchronous; wrap an async source in {@link startIndexer}. */
export type SliceReader = (span: SnapshotRange) => IndexerSlice;

export interface IndexerConfig {
  /** The chain this operator serves. Answered verbatim on `/chain` and carried in every page. */
  readonly binding: ChainBinding;
  /** The blocks this operator currently serves. Normalised into §8.2's form at construction. */
  readonly coverage: readonly SnapshotRange[];
  /**
   * How many blocks one page spans.
   *
   * **No default here.** It is an operator choice with no anchor in the specification — 10 §8.5.2
   * fixes the paging *protocol* and says nothing about page size, and there is no chain surface,
   * kernel constant or 13 §1 key to derive one from. A library default would be a number this
   * repository picked on an operator's behalf and then never revisited. `serve.ts`'s command line
   * names one, where it is visibly a starting point rather than a rule.
   */
  readonly blocksPerPage: number;
  readonly read: SliceReader;
  readonly sha256: Sha256;
}

/** One HTTP answer, before it meets a socket. `serve.ts` writes it; the suites read it. */
export interface ServedResponse {
  readonly status: number;
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
}

/** A request handler over the request target (path + query), e.g. `/range?from=10&to=20`. */
export type IndexerHandler = (target: string) => ServedResponse;

const JSON_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'content-type': 'application/json',
  // A page is a statement about blocks that have already happened, so it is safe to cache — but
  // the *served coverage* moves as the operator ingests, so `/chain` must not be. Rather than two
  // policies, neither route is cached: a stale `/chain` answer is a client asking for blocks the
  // operator has and being told it does not, and this is a reference implementation whose job is
  // to be obviously correct rather than fast.
  'cache-control': 'no-store',
});

/**
 * Build the handler.
 *
 * The configuration is checked **once, here**, so an operator's mistake is a startup failure rather
 * than a page that answers `500` forever. A running server that refuses every request is the
 * failure mode hardest to tell from a network problem.
 */
export function createIndexer(config: IndexerConfig): IndexerHandler {
  if (!Number.isInteger(config.blocksPerPage) || config.blocksPerPage < 1) {
    throw new RangeError(
      `blocksPerPage must be a positive integer; got ${config.blocksPerPage}. A page spanning no ` +
        'blocks advances no cursor, so the walk it produces never terminates and never covers ' +
        'anything',
    );
  }
  // Normalised rather than checked: this is the operator's own statement of what they serve, and
  // §8.2's ordered/non-overlapping/maximally-merged form is a spelling rule. `mergeCoverage`
  // still throws on an inverted range, which is not a spelling mistake.
  const served = mergeCoverage(config.coverage);
  const chainBody = canonicalJson({ ...config.binding, coverage: served });

  return (target: string): ServedResponse => {
    let url: URL;
    try {
      // A base is required to parse a bare request target and is never used: `pathname` and
      // `searchParams` are the whole of what is read.
      url = new URL(target, 'http://indexer.invalid');
    } catch {
      return refuse(400, `unparseable request target ${JSON.stringify(target)}`);
    }
    if (url.pathname === '/chain') return { status: 200, body: chainBody, headers: JSON_HEADERS };
    if (url.pathname === '/range') return range(config, url);
    return refuse(404, `no route ${url.pathname}; this interface is /chain and /range (10 §8.5.2)`);
  };
}

function range(config: IndexerConfig, url: URL): ServedResponse {
  const from = u32Param(url, 'from');
  const to = u32Param(url, 'to');
  if (from === null || to === null) {
    return refuse(400, '/range needs from=<block> and to=<block>, both u32 decimals');
  }
  if (from > to) return refuse(400, `the span ${from}..${to} is inverted`);

  const cursor = url.searchParams.get('cursor');
  let pageFrom = from;
  if (cursor !== null) {
    const at = u32(cursor);
    // A cursor this server would never have issued. Refused rather than clamped: the token is
    // opaque to the client, so one that does not decode came from somewhere else — a stale walk
    // against a re-ranged request, or a client constructing tokens, which §8.5.2 forbids. Serving
    // a clamped page would answer a question nobody asked and hide both.
    if (at === null || at <= from || at > to) {
      return refuse(400, `cursor ${JSON.stringify(cursor)} does not address a page of ${from}..${to}`);
    }
    pageFrom = at;
  }
  const pageTo = Math.min(to, pageFrom + config.blocksPerPage - 1);
  const span: SnapshotRange = { fromBlock: pageFrom, toBlock: pageTo };

  let slice: IndexerSlice;
  try {
    slice = config.read(span);
  } catch (error) {
    return refuse(500, `the index could not answer ${pageFrom}..${pageTo}: ${text(error)}`);
  }

  let document: SnapshotDocument;
  let body: string;
  try {
    document = {
      format: SNAPSHOT_FORMAT,
      binding: config.binding,
      range: span,
      coverage: mergeCoverage(slice.coverage),
      // The three set-valued arrays are ordered here because their order carries no meaning and
      // §8.2 requires exactly one spelling of each. `ops` is **not** touched: its order is the
      // chain's, which is semantic — the replay checks non-negativity at every step, so sorting
      // would let an invalid history be reordered into a valid-looking one.
      vaults: orderVaults(slice.vaults),
      ops: slice.ops,
      balances: orderBalances(slice.balances),
    };
    body = serializeSnapshot(document);
  } catch (error) {
    return refuse(500, `the slice for ${pageFrom}..${pageTo} is not serializable: ${text(error)}`);
  }

  // The client's own admission, over the bytes about to be written, with the digest of those
  // bytes. See the module note: a live page has no publisher pin to compare against, so what this
  // proves is every other screen — canonical form, coverage, conservation, derived rows.
  const verdict = admitSnapshot(
    body,
    { expectedPin: config.sha256(preimageOfSerialized(body)), binding: config.binding },
    config.sha256,
  );
  if (verdict.kind === 'rejected') {
    return refuse(
      500,
      `this page would be rejected by the client that requested it: ${verdict.refusal.detail}`,
    );
  }

  if (pageTo >= to) return { status: 200, body, headers: JSON_HEADERS };
  return {
    status: 200,
    body,
    // The continuation token. Its content is this server's business and nothing else's — 10 §8.5.2
    // makes it opaque, and a client that decoded a block number out of it would be depending on an
    // encoding the next operator has no reason to share.
    headers: { ...JSON_HEADERS, [NEXT_CURSOR_HEADER]: String(pageTo + 1) },
  };
}

/**
 * A slice built by folding the operator's own movements.
 *
 * Offered so an operator holding a movement log can serve pages today, and labelled with what it
 * costs: `balances` derived this way agree with `ops` **by construction**, so §8.4's
 * event↔derived-row screen can never fail on a page this produces. That screen is live only against
 * an operator whose balances come from somewhere else — which is exactly the discipline
 * `tools/snapshot` follows, where the balance sheet is an independent read of chain state and the
 * fold is the claim being checked (10 §8.4).
 *
 * The failure it therefore cannot catch is the one that actually happens to an index: an
 * **incomplete op set** — a variant not decoded, a range answered short — which is perfectly
 * self-consistent. An operator with an independent balance read should supply {@link IndexerSlice}
 * directly and keep the screen.
 */
export function foldedSlice(
  vaults: readonly SnapshotVault[],
  history: readonly SnapshotOp[],
  observed: readonly SnapshotRange[],
  span: SnapshotRange,
): IndexerSlice {
  const coverage = mergeCoverage(observed)
    .map((range_) => ({
      fromBlock: Math.max(range_.fromBlock, span.fromBlock),
      toBlock: Math.min(range_.toBlock, span.toBlock),
    }))
    .filter((range_) => range_.fromBlock <= range_.toBlock);
  const ops = history.filter((op) =>
    coverage.some((range_) => op.block >= range_.fromBlock && op.block <= range_.toBlock),
  );
  const ordered = orderVaults(vaults);
  return { coverage, vaults: ordered, ops, balances: deriveBalances(ordered, ops) };
}

// ------------------------------------------------------------------ ordering and parsing

function orderVaults(vaults: readonly SnapshotVault[]): readonly SnapshotVault[] {
  return [...vaults]
    .map((vault) => ({ vault: vault.vault, branches: [...vault.branches].sort(byCodePoint) }))
    .sort((left, right) => byCodePoint(left.vault, right.vault));
}

function orderBalances(balances: readonly SnapshotBalance[]): readonly SnapshotBalance[] {
  // The same key `deriveBalances` sorts on, built the same way. A `JSON.stringify` tuple rather
  // than a joined string, because any separator can occur inside an account label and two
  // holdings colliding on one key silently become one row.
  return [...balances].sort((left, right) =>
    byCodePoint(
      canonicalJson([left.vault, left.account, left.branch]),
      canonicalJson([right.vault, right.account, right.branch]),
    ),
  );
}

function u32Param(url: URL, name: string): number | null {
  const raw = url.searchParams.get(name);
  return raw === null ? null : u32(raw);
}

/** A canonical u32 decimal, and nothing else. `Number('0x10')` and `Number(' 7 ')` both parse. */
function u32(raw: string): number | null {
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value <= 0xffff_ffff ? value : null;
}

function text(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A refusal.
 *
 * The body is prose for the operator's log and for whoever is holding a terminal. §8.5.2 fixes no
 * error vocabulary and a client parses none — it reads the status and stops — so writing a code
 * here would publish a second interface nobody is obliged to implement or read.
 */
function refuse(status: number, why: string): ServedResponse {
  return { status, body: `${why}\n`, headers: Object.freeze({ 'content-type': 'text/plain' }) };
}
