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
 * The last step before answering a `/range` request runs `admitIndexerPage` — the client's real
 * admission path, not a checklist of what it was believed to check — over exactly the bytes that
 * are about to go on the wire, with the digest of those bytes. A rejected page is answered `500`
 * and never served. The operator sees the reason in the response body and in their log; the client
 * sees a non-`200` and never a document it would have had to reject.
 *
 * It must be the **page** entry point and not `admitSnapshot`, which is what it called until
 * 2026-08-07. A server that screens its output more strictly than its consumer screens the input is
 * not being careful — it answers `500` to conforming requests, and that is exactly what happened:
 * every span not reaching back to genesis was refused. See below.
 *
 * The client sees a failed read, and §8.5.2 keeps a failed read **off** §8.3's probe ladder — a
 * ladder that ratcheted on data reads would disable faster for a user who reads more. (This note
 * claimed the opposite until 2026-08-07.) What does reach the ladder from this route is a
 * *correctness* finding, and there is exactly one: a page whose binding names another chain.
 *
 * ## What the screens no longer cover, and who covers it instead
 *
 * A page owes canonical form, §8.2's ordering rules and monotone coverage. It does **not** owe
 * §8.4's conservation replay or its event↔derived-row agreement (10 §8.5.2), so nothing here checks
 * an operator's `balances`. That is the design: §8.4 gives snapshots screens and live indexers
 * **sampling**, because a page cannot be checked against a history it does not carry. The client
 * re-verifies 1 page in 16 against the chain, and a mismatch auto-disables the source.
 *
 * The consequence for an operator is in `README.md` and is the reverse of what it said before:
 * `balances` are the accounts' **holdings at the page's last block, read from state**, not a fold
 * of the page's own movements. Sampling compares them with the chain, so a fold would disagree on
 * every honest page that does not begin at genesis.
 *
 * ## The limitation that used to be here is gone
 *
 * §8.4's conservation replay starts every holding, supply and escrow at **zero** and requires
 * non-negativity at each step, so under it a page was admissible only if it carried the movements
 * that created the positions it moves. A `split` mints from escrow and is self-contained at any
 * span; a `merge`, `transfer` or `redeem` of a position created in an earlier block replays
 * negative. Restricting a real history to blocks 15..19 is exactly that case — so this server could
 * serve only spans reaching back to the origin of every position they touch, and §8.5.2's `from`
 * and `to` were unusable for the ranged reads they exist for. §8.5.2 now rules the screen split and
 * names which screens drop, and the suites carry the mid-history page that used to be refused.
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
  admitIndexerPage,
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
  // proves is every screen a page owes — canonical form, §8.2's ordering rules, monotone coverage.
  //
  // It must be the **same entry point the client calls**, and it was `admitSnapshot` until
  // 2026-08-07. That made this server answer `500` to any page starting mid-history, because
  // 10 §8.5.2 drops the conservation replay and the derived-row agreement for a page precisely
  // where each would compare a document against a state predating it. A server that screens its
  // output more strictly than its consumer screens the input is not being careful — it is
  // refusing conforming requests, which is what this line did.
  const verdict = admitIndexerPage(
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
 * A slice whose `balances` are the fold of **that page's own movements**.
 *
 * **Not the shape 10 §8.5.2 asks an operator to serve**, and this note said the opposite until
 * 2026-08-07. A page's `balances` are the accounts' holdings at the page's last block, read from
 * state: that is the row set §8.4's 1-in-16-page sampling audits *against the chain*, and a
 * mid-history fold held up against a current holding disagrees on every honest page — which turns
 * the one live control a client has over an indexer into a generator of false mismatches, and a
 * sampling mismatch auto-disables the source.
 *
 * What survives is narrower than "genesis-anchored", and being exact matters because the loose
 * version is reassuring and wrong. This function folds **only the movements inside the span it was
 * asked for**, so its balances are that page's subtotal. They equal the holdings at the page's last
 * block in one case: when the page **is** the whole history — one page, starting at the first block
 * the operator holds. Page two of a splits-only history already disagrees, because it carries only
 * the splits inside its own span and none of the earlier ones. So the honest scope is **fixtures,
 * and a single-page read over a whole short history** — which is what the suites use it for.
 *
 * For anything else the failure is sharper than a disagreement and arrives sooner. A `merge`,
 * `transfer` or `redeem` of a position created in an earlier block folds **negative**, and a
 * negative holding is not an amount §8.2's grammar can express — so a page built this way is
 * refused as `malformed` by the check below, before any balance is compared with anything, and the
 * operator sees a `500` on every span that does not reach back to genesis. An operator serving real
 * spans reads state and supplies {@link IndexerSlice} directly.
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

/**
 * A slice whose `balances` are the holdings **at the page's last block** — the shape §8.5.2 asks for.
 *
 * The counterpart of {@link foldedSlice}, and the one an operator serving real spans should reach
 * for. It exists because shipping only the folded helper left the reference implementation unable
 * to produce a conforming page for any history that is not splits-only, while `README.md` told
 * operators to serve exactly that — a reference implementation that demonstrates the shape it
 * documents as wrong.
 *
 * The `balances` come from folding **every movement up to `span.toBlock`**, not just the movements
 * inside the span, which is what makes them state rather than a subtotal: at block 19 they include
 * the positions split at block 10 that the page's own `ops` do not carry. That is the row set
 * §8.4's 1-in-16-page sampling re-verifies against the chain, and it is why the fold is not usable
 * here — see {@link foldedSlice}.
 *
 * This suits an operator who holds the **whole movement log**, which is the common case for an
 * index built by replaying a chain. An operator who instead queries a state store at a height
 * supplies {@link IndexerSlice} directly: the balances are the only member this helper computes
 * differently, and there is nothing else it can do for them.
 *
 * `coverage`, `vaults` and `ops` are {@link foldedSlice}'s — they are the same question, and two
 * copies of the span-intersection would be two chances to disagree about what was observed.
 */
export function stateSlice(
  vaults: readonly SnapshotVault[],
  history: readonly SnapshotOp[],
  observed: readonly SnapshotRange[],
  span: SnapshotRange,
): IndexerSlice {
  const inSpan = foldedSlice(vaults, history, observed, span);
  const upToLastBlock = history.filter((op) => op.block <= span.toBlock);
  return { ...inSpan, balances: deriveBalances(inSpan.vaults, upToLastBlock) };
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
