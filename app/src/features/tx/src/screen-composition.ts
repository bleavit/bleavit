/**
 * S2/S3/S4/S20's composition root — the keys, decoders and call arguments their readers take.
 *
 * `proposal-reads.ts`, `market-reads.ts`, `position-reads.ts` and `balance-reads.ts` all
 * *receive* these, because `packages/chain-client` is the only package permitted to import
 * `polkadot-api` (10 §10.1, app-code rule 13). This is the other end of that injection, and
 * it is `funding-composition.ts` (F18) applied to the four screens that had none: until it
 * existed, every one of those readers was a function nothing in `app/src` could call.
 *
 * ## One module, four roots, one chain
 *
 * `funding-composition.ts` is per **chain, twice**, because S12/S13 span two of them and the
 * whole risk there is a value from one appearing under the other's label. These four screens
 * read this chain only, so the shape that matters here is different: the risk is a decoder or
 * a key bound to the **wrong surface of the same chain**, which returns a plausible value
 * rather than an error. Every builder below is therefore constructed from a named entry in
 * the reader's own frozen `*_READS` object, so the surface a key hashes and the surface its
 * decoder reads are the same string.
 *
 * ## The arguments are built here too, and that is not a convenience
 *
 * Three of these reads take a SCALE argument — `decision_stats(pid)`, `quote(market, side,
 * amount)`, `account_positions(who)`/`service_positions(who)`. A wrong argument does **not**
 * fail: it asks the runtime a different question and receives a perfectly valid answer, which
 * is why `ProposalArgs` says so in its own doc comment. Hand-rolling a `u64` little-endian
 * encoder in this package would be a second codec nothing gates, so the encoders come from
 * the chain's own descriptors through `apiArgs`.
 *
 * ## Why the two position views' argument encoders are compared
 *
 * `PositionReadParams.whoArgsHex` is **one** field feeding **two** runtime APIs — 02 §7.4
 * pairs `account_positions()` with the primary prefix and `service_positions()` with the
 * service one, and `position-reads.ts` calls both with the same bytes. That is correct only
 * while the two methods take the same argument shape. Nothing else in the client would notice
 * if they diverged: the call would still succeed and answer about some other account, so a
 * user would be shown somebody's else's hosted book. {@link positionArgs} therefore encodes
 * through both and refuses a disagreement.
 *
 * @see docs/architecture/10-frontend-architecture.md §2.1, §5.1, §10.1
 * @see docs/architecture/02-integration-contract.md §2, §3, §4, §7.1, §7.3, §7.4
 * @see docs/architecture/11-frontend-workflows.md §11.2, §11.2a, §11.5
 */

import {
  accountKey,
  apiArgs,
  apiDecoder,
  concatDigestBytes,
  storageDecoder,
  storageHashers,
  storageKeyBuilder,
  type ChainApiCodecs,
  type ChainCodecs,
  type ChainMetadata,
  type StorageItem,
  type StorageKeyBuilder,
} from '@bleavit/chain-client';
import type { BookState } from '@bleavit/protocol';

import { BALANCE_READS, type BalanceDecoders, type BalanceKeys } from './balance-reads.js';
import { MARKET_READS, type MarketDecoders, type MarketKeys } from './market-reads.js';
import {
  POSITION_READS,
  type DecodedVaultState,
  type DomainPositionDecoders,
  type PositionDecoders,
  type PositionKeys,
  type PositionRecord,
  type PositionSubject,
  type PositionWitnessEntry,
} from './position-reads.js';
import {
  PROPOSAL_READS,
  type ProposalArgs,
  type ProposalDecoders,
  type ProposalRecord,
  type StatsRecord,
} from './proposal-reads.js';
import type { QuoteFigures } from './trade-ticket.js';

/** One hashed key position's codec, as PAPI's `args.inner` exposes it. */
interface KeyCodec {
  enc(value: unknown): Uint8Array;
  dec(raw: string): unknown;
}

/** A decode failure is data, not an exception — INV-FE-12. Structurally the readers' own. */
type Decoded<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

/**
 * This chain's two artifacts plus its runtime-API codecs.
 *
 * `metadata` carries the hashers and `codecs.query` the per-position key codecs — neither
 * answers alone, which is why `storageKeyBuilder` requires them to agree on the key arity
 * before it will build anything. `codecs.apis` is the third, and it is what makes a
 * runtime-API *result* readable at all: `FinalizedReader.call` hands back opaque hex.
 */
export interface ScreenChain {
  readonly codecs: ChainCodecs & ChainApiCodecs;
  readonly metadata: ChainMetadata;
}

/**
 * The runtime API every read below goes through — 02 §3's frozen 13-method surface.
 *
 * Named once. `FinalizedReader.crossCheckedCall` prefixes the method itself while `call`
 * does not, which is a difference `proposal-reads.ts` documents on its own port; the codec
 * lookup here needs the API and the method apart in either case.
 */
const FUTARCHY_API = 'FutarchyApi';

/** Split a `Pallet.Item` name so a key and its decoder cannot drift into different items. */
function split(qualified: string): readonly [string, string] {
  const [pallet, item] = qualified.split('.');
  if (pallet === undefined || item === undefined) {
    throw new Error(`"${qualified}" is not a Pallet.Item name`);
  }
  return [pallet, item];
}

function builder(chain: ScreenChain, qualified: string): StorageKeyBuilder {
  const [pallet, item] = split(qualified);
  return storageKeyBuilder(chain.codecs, chain.metadata, pallet, item);
}

/** Lift a `chain-client` decode result through a shape check, per `funding-composition.ts`. */
function through<T>(
  decode: (raw: string) => Decoded<unknown>,
  narrow: (value: unknown) => Decoded<T>,
): (raw: string) => Decoded<T> {
  return (raw) => {
    const decoded = decode(raw);
    return decoded.ok ? narrow(decoded.value) : { ok: false, reason: decoded.reason };
  };
}

function storage<T>(
  chain: ScreenChain,
  qualified: string,
  narrow: (value: unknown) => Decoded<T>,
): (raw: string) => Decoded<T> {
  const [pallet, item] = split(qualified);
  return through(storageDecoder(chain.codecs, pallet, item), narrow);
}

function api<T>(
  chain: ScreenChain,
  method: string,
  narrow: (value: unknown) => Decoded<T>,
): (raw: string) => Decoded<T> {
  return through(apiDecoder(chain.codecs, FUTARCHY_API, method), narrow);
}

/* ------------------------------------------------------------------ shared shape narrowing */

function asRecord(value: unknown, surface: string): Decoded<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, reason: `${surface} did not decode to a record` };
  }
  return { ok: true, value: value as Record<string, unknown> };
}

/**
 * A PAPI-decoded SCALE enum's variant name.
 *
 * PAPI renders every `enum` as `{ type, value }`, and the `type` string is the variant's own
 * name from metadata — so it tracks the runtime rather than a table written here. That is
 * what lets `proposal-reads.ts` keep an **allowlist** of states: a variant this release has
 * never heard of arrives as its real name and simply fails the lookup, which is INV-FE-12's
 * fail-closed direction rather than a decode error.
 */
function variantOf(value: unknown, surface: string): Decoded<string> {
  const record = asRecord(value, surface);
  if (!record.ok) return record;
  const type = record.value['type'];
  if (typeof type !== 'string') {
    return { ok: false, reason: `${surface} decoded to a record with no variant name` };
  }
  return { ok: true, value: type };
}

function bigintAt(record: Record<string, unknown>, field: string, surface: string): Decoded<bigint> {
  const value = record[field];
  if (typeof value !== 'bigint') {
    return { ok: false, reason: `${surface} has no bigint \`${field}\`` };
  }
  return { ok: true, value };
}

/* --------------------------------------------------------------------------------- S2 */

/**
 * `Epoch.Proposals`' stored `Proposal<AccountId>`, reduced to what S2's list renders.
 *
 * **There is no title to read and this is where that was established** (SQ-860). The struct
 * carries `id`, `proposer`, `class`, `state`, `epoch`, `submitted_at`, `payload_hash`,
 * `payload_len`, `ask`, `bond`, `resources`, `metric_spec`, `decide_at`, three flags, the
 * market set, the queue fields and `funder` — and no free text anywhere. The client's model
 * carried a `title` until this decoder had to produce one.
 */
function asProposal(value: unknown): Decoded<ProposalRecord> {
  const surface = PROPOSAL_READS.proposals;
  const record = asRecord(value, surface);
  if (!record.ok) return record;
  const id = record.value['id'];
  const payloadHash = record.value['payload_hash'];
  if (typeof id !== 'bigint' || typeof payloadHash !== 'string') {
    return {
      ok: false,
      reason:
        `${surface} decoded to a record without a bigint \`id\` and a \`payload_hash\`. ` +
        'This runtime encodes a proposal differently than this release expects.',
    };
  }
  const klass = variantOf(record.value['class'], `${surface}.class`);
  if (!klass.ok) return klass;
  const state = variantOf(record.value['state'], `${surface}.state`);
  if (!state.ok) return state;
  return {
    ok: true,
    value: { id: id.toString(), payloadHash, klass: klass.value, state: state.value },
  };
}

/**
 * `decision_stats(pid)`'s `Option<DecisionStatsView>` — 02 §4, field for field.
 *
 * `undefined` for the runtime's `None`, which is **not** a failure: 11 §11.2 says the view is
 * available only once the windows are sealed, so `None` on an open market is the expected
 * answer and the pre-decision arm is what renders.
 */
function asDecisionStats(value: unknown): Decoded<StatsRecord | undefined> {
  const surface = PROPOSAL_READS.decisionStats;
  if (value === undefined) return { ok: true, value: undefined };
  const record = asRecord(value, surface);
  if (!record.ok) return record;

  const pid = record.value['pid'];
  const coveragePct = record.value['coverage_pct'];
  const converged = record.value['converged'];
  if (
    typeof pid !== 'bigint' ||
    typeof coveragePct !== 'number' ||
    typeof converged !== 'boolean'
  ) {
    return {
      ok: false,
      reason:
        `${surface} decoded to a record without a bigint \`pid\`, a numeric \`coverage_pct\` ` +
        'and a boolean `converged`. This runtime publishes a different DecisionStatsView.',
    };
  }

  // Each field read by name and checked on its own, rather than gathered into a map and
  // asserted out of it. Ten `if (!x.ok) return x` lines is the boring form, and the boring
  // form is the one where a mistyped field name is a compile error rather than an
  // `undefined` that reaches the screen as a badged zero.
  const twapAccept1e9 = bigintAt(record.value, 'twap_accept_1e9', surface);
  if (!twapAccept1e9.ok) return twapAccept1e9;
  const twapReject1e9 = bigintAt(record.value, 'twap_reject_1e9', surface);
  if (!twapReject1e9.ok) return twapReject1e9;
  const twapBaseline1e9 = bigintAt(record.value, 'twap_baseline_1e9', surface);
  if (!twapBaseline1e9.ok) return twapBaseline1e9;
  const rEff1e9 = bigintAt(record.value, 'r_eff_1e9', surface);
  if (!rEff1e9.ok) return rEff1e9;
  const trailingAccept1e9 = bigintAt(record.value, 'trailing_accept_1e9', surface);
  if (!trailingAccept1e9.ok) return trailingAccept1e9;
  const trailingReject1e9 = bigintAt(record.value, 'trailing_reject_1e9', surface);
  if (!trailingReject1e9.ok) return trailingReject1e9;
  const tradedVolume = bigintAt(record.value, 'traded_volume', surface);
  if (!tradedVolume.ok) return tradedVolume;
  const vMinRequired = bigintAt(record.value, 'v_min_required', surface);
  if (!vMinRequired.ok) return vMinRequired;
  const attackCostHat = bigintAt(record.value, 'attack_cost_hat', surface);
  if (!attackCostHat.ok) return attackCostHat;
  const inCapPrize = bigintAt(record.value, 'in_cap_prize', surface);
  if (!inCapPrize.ok) return inCapPrize;

  // `Option<[FixedU64; 4]>`. Absent is a class with no gate markets; present must be exactly
  // four, because 02 §4 freezes the width and `GateTwaps` names all four positions. A shorter
  // array would otherwise reach the screen with one gate book rendered as `undefined`.
  const gates = record.value['gate_twaps_1e9'];
  let gateTwaps1e9: readonly [bigint, bigint, bigint, bigint] | undefined;
  if (gates !== undefined) {
    const four = Array.isArray(gates) ? gates : [];
    const [s0, s1, s2, s3] = four;
    if (
      four.length !== 4 ||
      typeof s0 !== 'bigint' ||
      typeof s1 !== 'bigint' ||
      typeof s2 !== 'bigint' ||
      typeof s3 !== 'bigint'
    ) {
      return {
        ok: false,
        reason: `${surface}.gate_twaps_1e9 is present but is not four fixed-point scalars`,
      };
    }
    gateTwaps1e9 = [s0, s1, s2, s3];
  }

  return {
    ok: true,
    value: {
      pid: pid.toString(),
      twapAccept1e9: twapAccept1e9.value,
      twapReject1e9: twapReject1e9.value,
      twapBaseline1e9: twapBaseline1e9.value,
      rEff1e9: rEff1e9.value,
      trailingAccept1e9: trailingAccept1e9.value,
      trailingReject1e9: trailingReject1e9.value,
      coveragePct,
      tradedVolume: tradedVolume.value,
      vMinRequired: vMinRequired.value,
      converged,
      gateTwaps1e9,
      attackCostHat: attackCostHat.value,
      inCapPrize: inCapPrize.value,
    },
  };
}

/** S2's decoders — the `Epoch.Proposals` prefix and `decision_stats(pid)`. */
export function proposalDecoders(chain: ScreenChain): ProposalDecoders {
  const proposal = storage(chain, PROPOSAL_READS.proposals, asProposal);
  return {
    proposals: (raws) => {
      const out: ProposalRecord[] = [];
      for (const raw of raws) {
        const decoded = proposal(raw);
        // One failure fails the list rather than shortening it. A dropped entry is a proposal
        // the chain has and this screen does not show, with nothing on screen saying so.
        if (!decoded.ok) return decoded;
        out.push(decoded.value);
      }
      return { ok: true, value: out };
    },
    decisionStats: api(chain, PROPOSAL_READS.decisionStats, asDecisionStats),
  };
}

/** S2's one call argument. `pid` as decimal, per the reader's own port. */
export function proposalArgs(chain: ScreenChain): ProposalArgs {
  const encode = apiArgs(chain.codecs, FUTARCHY_API, PROPOSAL_READS.decisionStats);
  return { decisionStats: (proposalId) => encode([BigInt(proposalId)]) };
}

/* --------------------------------------------------------------------------------- S3 */

/** S3's four keys — 02 §7.1's two market surfaces and 02 §7.3's flag bitset. */
export function marketKeys(chain: ScreenChain): MarketKeys {
  const markets = builder(chain, MARKET_READS.markets);
  const baselineMarketOf = builder(chain, MARKET_READS.baselineMarketOf);
  const phaseFlags = builder(chain, MARKET_READS.phaseFlags);
  return {
    market: (bookId) => markets.key([bookId]),
    baselineMarketOf: (epoch) => baselineMarketOf.key([epoch]),
    // The map prefix, for the FE-P2 cross-check of `quote()` — deliberately the builder's own
    // `prefix` rather than a second derivation, so the key and the prefix cannot disagree
    // about which item they are addressing.
    marketsPrefix: () => markets.prefix,
    phaseFlags: () => phaseFlags.key([]),
  };
}

/**
 * `Market.Markets[id]`'s `MarketBook`, reduced to what the ticket needs.
 *
 * `open` is the runtime's own predicate, not a phase name comparison left to a screen:
 * `pallet-market` guards trading with `matches!(book.phase, MarketPhase::Trading |
 * MarketPhase::Extended)`, so `Closed` and `Settled` are the two that do not trade. The
 * quantities go straight into `@bleavit/protocol`'s `BookState`, which is the same shape the
 * quote pipeline uses.
 */
function asMarketBook(
  value: unknown,
): Decoded<{ readonly open: boolean; readonly book: BookState } | undefined> {
  const surface = MARKET_READS.markets;
  const record = asRecord(value, surface);
  if (!record.ok) return record;
  const phase = variantOf(record.value['phase'], `${surface}.phase`);
  if (!phase.ok) return phase;
  const qLong = bigintAt(record.value, 'q_long', surface);
  if (!qLong.ok) return qLong;
  const qShort = bigintAt(record.value, 'q_short', surface);
  if (!qShort.ok) return qShort;
  const b = bigintAt(record.value, 'b', surface);
  if (!b.ok) return b;
  return {
    ok: true,
    value: {
      open: phase.value === 'Trading' || phase.value === 'Extended',
      book: { qLong: qLong.value, qShort: qShort.value, b: b.value },
    },
  };
}

/** `quote()`'s `QuoteView`, reduced to 02 §4's two monetary fields — kept apart, never summed. */
function asQuote(value: unknown): Decoded<QuoteFigures> {
  const surface = MARKET_READS.quote;
  const record = asRecord(value, surface);
  if (!record.ok) return record;
  const cost = bigintAt(record.value, 'cost', surface);
  if (!cost.ok) return cost;
  const fee = bigintAt(record.value, 'fee', surface);
  if (!fee.ok) return fee;
  return { ok: true, value: { cost: cost.value, fee: fee.value } };
}

function asMarketId(value: unknown): Decoded<bigint | undefined> {
  if (typeof value !== 'bigint') {
    return { ok: false, reason: `${MARKET_READS.baselineMarketOf} did not decode to a MarketId` };
  }
  return { ok: true, value };
}

function asBitset(value: unknown): Decoded<number> {
  // `Number.isInteger`, not `typeof === 'number'`: a u32 that decoded to a float is not a
  // bitset, and `1.5 & (1 << 5)` is 0 — which reads as *trading is enabled* (V-115's shape,
  // and here it is the unsafe direction rather than the safe one).
  if (!Number.isInteger(value)) {
    return { ok: false, reason: `${MARKET_READS.phaseFlags} did not decode to an integer` };
  }
  return { ok: true, value: value as number };
}

/** S3's four decoders, each bound to the surface it will actually see. */
export function marketDecoders(chain: ScreenChain): MarketDecoders {
  return {
    market: storage(chain, MARKET_READS.markets, asMarketBook),
    baselineMarketOf: storage(chain, MARKET_READS.baselineMarketOf, asMarketId),
    quote: api(chain, MARKET_READS.quote, asQuote),
    phaseFlags: storage(chain, MARKET_READS.phaseFlags, asBitset),
  };
}

/** 02 §2's frozen `TradeSide`. A closed union, so a call site cannot invent a fifth. */
export type TradeSideName = 'BuyLong' | 'BuyShort' | 'SellLong' | 'SellShort';

/**
 * `quote(market, side, amount)`'s arguments — 02 §3.
 *
 * All three are required and positional, and none has a default. `side` is the whole reason
 * this is not a two-argument helper: 04 §6.1 combines `cost` and `fee` differently per
 * direction, so a quote taken on the wrong side is a well-formed answer to the trade the user
 * is not making.
 */
export function quoteArgs(
  chain: ScreenChain,
): (market: bigint, side: TradeSideName, amount: bigint) => string {
  const encode = apiArgs(chain.codecs, FUTARCHY_API, MARKET_READS.quote);
  return (market, side, amount) => encode([market, { type: side, value: undefined }, amount]);
}

/* --------------------------------------------------------------------------------- S4 */

/**
 * S4's key surface — the per-domain `Positions` prefix.
 *
 * The **pallet** is the argument, never the domain: `position-reads.ts` derives the pallet
 * from the domain through `positionSourceFor` and hands it over, so a caller's own idea of
 * which domain it is reading cannot pick the key. That is the crossing 02 §7.4 forbids in as
 * many words — *"MUST NOT satisfy a service-domain read with a primary-domain key."*
 *
 * The item name is taken from the reader's own `POSITION_READS`, split off the qualified
 * name, and the two entries are asserted to agree on it: both instances publish `Positions`,
 * and a root that hardcoded the string would be a third place for it to drift.
 */
export function positionKeys(chain: ScreenChain): PositionKeys {
  const primary = split(POSITION_READS.primary.positions);
  const service = split(POSITION_READS.service.positions);
  const primaryVault = split(POSITION_READS.primary.vaults);
  const serviceVault = split(POSITION_READS.service.vaults);
  // Both pairs, because both are read per domain and both would otherwise be a third place
  // for the item name to drift. The vault pair carries the same hazard as the positions one:
  // a `Vaults` key built against the wrong instance returns no value, which reads as a vault
  // that does not exist — and this reader treats that as a disagreement that drops the row.
  for (const [one, other] of [
    [primary, service],
    [primaryVault, serviceVault],
  ] as const) {
    if (one[1] !== other[1]) {
      throw new Error(
        `the two ledger domains name different storage items ("${one[1]}" and ` +
          `"${other[1]}"). 02 §7.4 pairs each domain's view with that domain's own prefix of ` +
          'the same item, so this is a client defect rather than a chain state.',
      );
    }
  }
  const item = primary[1] as string;
  const vaultItem = primaryVault[1] as string;
  const allowed = new Set([primary[0], service[0]]);
  const baselineVaults = builder(chain, POSITION_READS.primary.baselineVaults);
  /** A pallet the two domains do not name is refused rather than hashed — see below. */
  const instance = (pallet: string): string => {
    // `storagePrefix` hashes any two strings into a well-formed 32-byte prefix, and
    // `descendantsValues` answers an unknown prefix with **nothing** — which is
    // indistinguishable from an account holding no positions, on the screen whose job is to
    // show them.
    if (!allowed.has(pallet)) {
      throw new Error(
        `"${pallet}" is not one of this client's two ledger instances (${[...allowed].join(
          ', ',
        )}). A prefix built for another pallet returns no entries, which renders as an empty book.`,
      );
    }
    return pallet;
  };
  return {
    positionsPrefix(pallet) {
      return storageKeyBuilder(chain.codecs, chain.metadata, instance(pallet), item).prefix;
    },
    vault(pallet, proposalId) {
      return storageKeyBuilder(chain.codecs, chain.metadata, instance(pallet), vaultItem).key([
        proposalId,
      ]);
    },
    // No pallet argument: 16 §7.6 gives a hosted question no Baseline leg, so this map has one
    // instance and the reader has no second one it could name.
    baselineVault: (epoch) => baselineVaults.key([epoch]),
  };
}

/** `PositionId` as one canonical string, used for **both** the view and the storage key. */
function renderPositionId(value: unknown): Decoded<{
  readonly rendered: string;
  readonly subject: PositionSubject;
  readonly instrument: string;
}> {
  const surface = 'PositionId';
  const record = asRecord(value, surface);
  if (!record.ok) return record;
  const variant = variantOf(value, surface);
  if (!variant.ok) return variant;
  const inner = asRecord(record.value['value'], `${surface}.${variant.value}`);
  if (!inner.ok) return inner;

  if (variant.value === 'Proposal') {
    const proposal = inner.value['proposal'];
    if (typeof proposal !== 'bigint') {
      return { ok: false, reason: `${surface}.Proposal has no bigint \`proposal\`` };
    }
    const branch = variantOf(inner.value['branch'], `${surface}.Proposal.branch`);
    if (!branch.ok) return branch;
    const kindRecord = asRecord(inner.value['kind'], `${surface}.Proposal.kind`);
    if (!kindRecord.ok) return kindRecord;
    const kind = variantOf(inner.value['kind'], `${surface}.Proposal.kind`);
    if (!kind.ok) return kind;
    // `GateYes`/`GateNo` carry a `GateType`; the other three carry nothing. The gate is part
    // of the instrument's identity — 11 §11.2's own example is `GateYes(Accept, Survival)` —
    // so dropping it would merge the Survival and Security books into one row.
    const gate = kindRecord.value['value'];
    let gateName = '';
    let kindLabel = kind.value;
    if (gate !== undefined) {
      const named = variantOf(gate, `${surface}.Proposal.kind.gate`);
      if (!named.ok) return named;
      gateName = `, ${named.value}`;
      kindLabel = `${kind.value}(${named.value})`;
    }
    return {
      ok: true,
      value: {
        rendered: `Proposal(${proposal}, ${branch.value}, ${kindLabel})`,
        subject: { kind: 'proposal', id: proposal },
        instrument: `${kind.value}(${branch.value}${gateName})`,
      },
    };
  }

  if (variant.value === 'Baseline') {
    const epoch = inner.value['epoch'];
    if (typeof epoch !== 'number') {
      return { ok: false, reason: `${surface}.Baseline has no numeric \`epoch\`` };
    }
    const side = variantOf(inner.value['side'], `${surface}.Baseline.side`);
    if (!side.ok) return side;
    return {
      ok: true,
      value: {
        rendered: `Baseline(${epoch}, ${side.value})`,
        // Keyed by an **epoch**, which is not in the partitioned id space at all — so it
        // never reaches the §11.2a rule-1 bit test. `position-reads.ts` states why: a large
        // epoch run through that test would classify as hosted, fabricating a domain.
        subject: { kind: 'baseline', epoch },
        instrument: `${side.value}(baseline)`,
      },
    };
  }

  return {
    ok: false,
    reason: `${surface} decoded to an unknown variant "${variant.value}"`,
  };
}

function asVaultState(value: unknown): Decoded<DecodedVaultState> {
  const surface = 'VaultState';
  const record = asRecord(value, surface);
  if (!record.ok) return record;
  const variant = variantOf(value, surface);
  if (!variant.ok) return variant;
  const inner: unknown = record.value['value'];

  switch (variant.value) {
    case 'Open':
      return { ok: true, value: { kind: 'open' } };
    case 'Voided':
      return { ok: true, value: { kind: 'voided' } };
    case 'Resolved': {
      const branch = variantOf(inner, `${surface}.Resolved`);
      return branch.ok ? { ok: true, value: { kind: 'resolved', branch: branch.value } } : branch;
    }
    case 'ScalarSettled': {
      const fields = asRecord(inner, `${surface}.ScalarSettled`);
      if (!fields.ok) return fields;
      const winner = variantOf(fields.value['winner'], `${surface}.ScalarSettled.winner`);
      if (!winner.ok) return winner;
      const score = bigintAt(fields.value, 's', `${surface}.ScalarSettled`);
      if (!score.ok) return score;
      return {
        ok: true,
        value: { kind: 'scalar-settled', winner: winner.value, score: score.value },
      };
    }
    case 'BaselineSettled': {
      const fields = asRecord(inner, `${surface}.BaselineSettled`);
      if (!fields.ok) return fields;
      const score = bigintAt(fields.value, 's', `${surface}.BaselineSettled`);
      return score.ok
        ? { ok: true, value: { kind: 'baseline-settled', score: score.value } }
        : score;
    }
    default:
      // A state this release has never heard of is refused rather than mapped onto the
      // nearest one. `open` is the closest arm and it is the one that offers actions.
      return { ok: false, reason: `${surface} decoded to an unknown variant "${variant.value}"` };
  }
}

/**
 * `<pallet>.Vaults(pid)`'s stored `VaultInfo`, reduced to the one field a `PositionView`
 * publishes — the FE-P2 witness for `vault_state`.
 *
 * `state` is read through the same {@link asVaultState} the view goes through, deliberately:
 * both surfaces encode `futarchy_primitives::VaultState`, and a second reader of one enum is
 * a second place for an unknown variant to be mapped onto the nearest known one. The rest of
 * `VaultInfo` — `escrowed`, the two `BranchSupply` rows, `gate_outcomes`, `spec` — is not
 * read, because none of it is projected into a `PositionView` and a cross-check over fields
 * the view never carried would fail on states that agree.
 */
function asVaultInfo(surface: string): (value: unknown) => Decoded<DecodedVaultState | undefined> {
  return (value) => {
    const record = asRecord(value, surface);
    if (!record.ok) return record;
    return asVaultState(record.value['state']);
  };
}

/**
 * `ConditionalLedger.BaselineVaults(epoch)`'s stored `BaselineVaultInfo`, projected exactly as
 * the runtime's own view projects it (02 §4, contract v6).
 *
 * `BaselineState` has **two** variants and `VaultState` has five, so this mapping is written
 * out rather than routed through {@link asVaultState}: `Open → Open`, `Settled(s) →
 * BaselineSettled { s }`, and a Baseline instrument has no winning proposal branch to publish.
 * A variant this release has never heard of is refused rather than mapped onto `Open`, which
 * is the arm that offers actions.
 */
function asBaselineVaultInfo(value: unknown): Decoded<DecodedVaultState | undefined> {
  const surface = POSITION_READS.primary.baselineVaults;
  const record = asRecord(value, surface);
  if (!record.ok) return record;
  const state: unknown = record.value['state'];
  const variant = variantOf(state, `${surface}.state`);
  if (!variant.ok) return variant;
  if (variant.value === 'Open') return { ok: true, value: { kind: 'open' } };
  if (variant.value === 'Settled') {
    const inner = asRecord(state, `${surface}.state`);
    if (!inner.ok) return inner;
    // `BaselineState::Settled(FixedU64)` is a newtype variant, so PAPI's `value` is the inner
    // scalar rather than a record — the same shape `VaultState::ScalarSettled`'s `s` decodes to.
    const score = inner.value['value'];
    if (typeof score !== 'bigint') {
      return { ok: false, reason: `${surface}.state.Settled does not carry a fixed-point score` };
    }
    return { ok: true, value: { kind: 'baseline-settled', score } };
  }
  return { ok: false, reason: `${surface}.state decoded to an unknown variant "${variant.value}"` };
}

function asPositionView(value: unknown): Decoded<PositionRecord> {
  const surface = 'PositionView';
  const record = asRecord(value, surface);
  if (!record.ok) return record;
  const id = renderPositionId(record.value['position']);
  if (!id.ok) return id;
  const balance = bigintAt(record.value, 'balance', surface);
  if (!balance.ok) return balance;
  const vault = asVaultState(record.value['vault_state']);
  if (!vault.ok) return vault;
  return {
    ok: true,
    value: {
      subject: id.value.subject,
      positionId: id.value.rendered,
      instrument: id.value.instrument,
      balance: balance.value,
      vault: vault.value,
    },
  };
}

/**
 * Take a `(PositionId, AccountId)` storage key apart — the FE-P2 witness side of 02 §7.4.
 *
 * The layout is `prefix ‖ digest₁ ‖ enc(PositionId) ‖ digest₂ ‖ enc(AccountId)`, and only the
 * second field has a fixed width. So the `PositionId` is decoded **from the front** and then
 * **re-encoded** to learn how many bytes it occupied, and the re-encoding is required to be a
 * prefix of what was there. Both halves matter: PAPI's decoders ignore trailing bytes, so a
 * decode alone proves nothing about where the value ended, and the round trip is what turns
 * "it parsed" into "it parsed *this many bytes*".
 *
 * `runtime/bleavit-runtime/fixtures/storage-keys.json` is the reason this is not a slice at a
 * constant offset: it publishes the two `PositionId` variants precisely because their SCALE
 * encodings are **different lengths** (11 bytes for `Proposal{…}`, 6 for `Baseline{…}`).
 *
 * The digest widths are measured from the hashers themselves (`concatDigestBytes`) rather
 * than tabulated, so a metadata blob using `Twox64Concat` here would be read at the right
 * offset instead of eight bytes late.
 */
function keySplitter(
  chain: ScreenChain,
  qualified: string,
): (key: string) => Decoded<{ readonly positionId: string; readonly account: string }> {
  const [pallet, item] = split(qualified);
  const hashers = storageHashers(chain.metadata, pallet, item);
  const [firstHasher, secondHasher] = hashers;
  if (hashers.length !== 2 || firstHasher === undefined || secondHasher === undefined) {
    throw new Error(
      `"${qualified}" is keyed by ${hashers.length} hashed position(s); 02 §7.4 declares it ` +
        '`(PositionId, AccountId) -> Balance`, two hashes. A key read at the wrong offsets ' +
        'yields a well-formed value for the wrong subject.',
    );
  }
  const entry = (chain.codecs.query as Record<string, Record<string, unknown>>)[pallet]?.[item];
  const inner: unknown = (entry as { args?: { inner?: unknown } } | undefined)?.args?.inner;
  if (!Array.isArray(inner) || inner.length !== 2) {
    throw new Error(`"${qualified}" does not expose two per-position key codecs`);
  }
  const [positionCodec, accountCodec] = inner as readonly (KeyCodec | undefined)[];
  if (positionCodec === undefined || accountCodec === undefined) {
    throw new Error(`"${qualified}" does not expose two per-position key codecs`);
  }
  /** `storagePrefix` is `twox128(pallet) ‖ twox128(item)` — two 16-byte digests. */
  const PREFIX_BYTES = 32;
  const idOffset = PREFIX_BYTES + concatDigestBytes(firstHasher);
  const accountDigest = concatDigestBytes(secondHasher);

  return (key) => {
    const bytes = key.startsWith('0x') ? key.slice(2) : key;
    const from = (offset: number) => `0x${bytes.slice(offset * 2)}`;
    if (bytes.length / 2 <= idOffset) {
      return { ok: false, reason: `${qualified}: the key is too short to hold a PositionId` };
    }

    let decodedId: unknown;
    let idBytes: Uint8Array;
    try {
      decodedId = positionCodec.dec(from(idOffset));
      idBytes = positionCodec.enc(decodedId);
    } catch (error) {
      return {
        ok: false,
        reason: `${qualified}: the PositionId in the key did not decode (${String(error)})`,
      };
    }
    let reEncoded = '';
    for (const byte of idBytes) reEncoded += byte.toString(16).padStart(2, '0');
    if (!bytes.slice(idOffset * 2).toLowerCase().startsWith(reEncoded.toLowerCase())) {
      return {
        ok: false,
        reason:
          `${qualified}: the PositionId decoded from the key does not re-encode to the bytes ` +
          'it was read from, so its length in the key cannot be established',
      };
    }

    const accountOffset = idOffset + idBytes.length + accountDigest;
    if (bytes.length / 2 <= accountOffset) {
      return { ok: false, reason: `${qualified}: the key holds no account after its PositionId` };
    }
    let account: unknown;
    try {
      account = accountCodec.dec(from(accountOffset));
    } catch (error) {
      return {
        ok: false,
        reason: `${qualified}: the account in the key did not decode (${String(error)})`,
      };
    }
    if (typeof account !== 'string') {
      return { ok: false, reason: `${qualified}: the account in the key is not an address` };
    }
    let asKey: string;
    try {
      // The 32-byte public key, never the SS58 string PAPI produced. `event-accounts.ts`
      // measured the difference: the string carries **this chain's** prefix, so a comparison
      // against an address from anywhere else matches nothing ever — and here that would
      // present as *the runtime view and its own storage disagree* on every row.
      asKey = accountKey(account);
    } catch (error) {
      return { ok: false, reason: `${qualified}: ${String(error)}` };
    }

    const rendered = renderPositionId(decodedId);
    if (!rendered.ok) return rendered;
    return { ok: true, value: { positionId: rendered.value.rendered, account: asKey } };
  };
}

/**
 * S4's decoders — the two runtime views and the two storage prefixes behind them.
 *
 * Per **domain**, and that is the whole shape of this function: 02 §7.4 requires the FE-P2
 * cross-check to run *"per domain against that domain's own prefix"*, so each decoder pair is
 * built from one domain's qualified names and nothing crosses.
 */
export function positionDecoders(chain: ScreenChain): PositionDecoders {
  return {
    primary: domainPositionDecoders(chain, POSITION_READS.primary),
    service: domainPositionDecoders(chain, POSITION_READS.service),
    baselineVault: storage(chain, POSITION_READS.primary.baselineVaults, asBaselineVaultInfo),
  };
}

function domainPositionDecoders(
  chain: ScreenChain,
  reads: { readonly api: string; readonly positions: string; readonly vaults: string },
): DomainPositionDecoders {
  const view = api(chain, reads.api, (value): Decoded<readonly PositionRecord[]> => {
    if (!Array.isArray(value)) {
      return { ok: false, reason: `${reads.api}() did not decode to a list of positions` };
    }
    const out: PositionRecord[] = [];
    for (const entry of value) {
      const decoded = asPositionView(entry);
      if (!decoded.ok) return decoded;
      out.push(decoded.value);
    }
    return { ok: true, value: out };
  });
  const splitKey = keySplitter(chain, reads.positions);
  const balance = storage(chain, reads.positions, (value): Decoded<bigint> =>
    typeof value === 'bigint'
      ? { ok: true, value }
      : { ok: false, reason: `${reads.positions} did not decode to a Balance` },
  );

  return {
    positions: view,
    // The domain's own vault map, bound to the same qualified name its `Positions` prefix and
    // its view came from — so a decoder cannot end up reading the other instance's bytes.
    vault: storage(chain, reads.vaults, asVaultInfo(reads.vaults)),
    positionEntries: (items: readonly StorageItem[]) => {
      const out: PositionWitnessEntry[] = [];
      for (const item of items) {
        // A key with no value contributes nothing a balance could be read from. It is not
        // dropped silently: `readBook`'s cross-check reports every view row with **no entry**
        // in the prefix, which is exactly what such a key produces.
        if (item.value === undefined) continue;
        const key = splitKey(item.key);
        if (!key.ok) return key;
        const amount = balance(item.value);
        if (!amount.ok) return amount;
        out.push({
          positionId: key.value.positionId,
          account: key.value.account,
          balance: amount.value,
        });
      }
      return { ok: true, value: out };
    },
  };
}

/** The two `PositionReadParams` fields that must describe one account, derived together. */
export interface PositionSubjectKeys {
  /** `who` SCALE-encoded as the `[u8; 32]` argument of both position views (02 §3). */
  readonly whoArgsHex: string;
  /** The same account as the 32-byte public key the witness decoder renders keys into. */
  readonly whoAccountKey: string;
}

/**
 * Both of S4's account-shaped inputs, from one SS58 address.
 *
 * **The two runtime APIs and the storage keys spell an account differently, and only one of
 * the two spellings fails loudly.** Measured on the pinned pair:
 *
 * - `futarchy_primitives::AccountId` is `[u8; 32]`, so PAPI types
 *   `account_positions(who)`'s argument as fixed-size binary and its codec takes **hex**;
 * - `ConditionalLedger.Positions`' second key is a real `AccountId32`, so **that** codec
 *   decodes to an **SS58 string** in this chain's prefix (7777, 02 §8).
 *
 * Handing the SS58 string to the API codec does not throw. It produced **25 bytes** —
 * a well-formed argument naming an account nobody holds — and `account_positions()` would
 * have answered it with an empty portfolio, which S4 renders as *this account holds nothing*.
 * That is the wrong-argument hazard in its worst form, because the screen it lands on is the
 * one whose entire job is to show holdings.
 *
 * So the conversion happens **here, once**, through the same `accountKey` that
 * `event-accounts.ts` uses (and which refuses a valid SS58 address whose public key is not 32
 * bytes). Returning both fields together is what makes them unable to name different
 * accounts: `PositionReadParams` has one slot for each, and a caller filling them separately
 * is a caller that can fill them inconsistently.
 *
 * The argument is encoded through **both** methods and refused on disagreement — see the
 * module note.
 */
export function positionSubject(chain: ScreenChain): (who: string) => PositionSubjectKeys {
  const primary = apiArgs(chain.codecs, FUTARCHY_API, POSITION_READS.primary.api);
  const service = apiArgs(chain.codecs, FUTARCHY_API, POSITION_READS.service.api);
  return (who) => {
    const key = accountKey(who);
    const one = primary([key]);
    const other = service([key]);
    if (one !== other) {
      throw new Error(
        `${POSITION_READS.primary.api}() and ${POSITION_READS.service.api}() encode the same ` +
          'account differently on this runtime, so one of the two position reads would ask ' +
          'about a different account and be answered. 11 §11.2a rule 4 evaluates each domain ' +
          "against its own storage; it does not make one domain's argument fit the other's.",
      );
    }
    return { whoArgsHex: one, whoAccountKey: key };
  };
}

/* -------------------------------------------------------------------------------- S20 */

export interface BalanceKeyInputs {
  readonly chain: ScreenChain;
  /**
   * The XCM `Location` of USDC as this chain's `ForeignAssets` codec accepts it — 02 §8.
   *
   * `unknown` and required with no default, for `funding-composition.ts`' two reasons: the
   * chain's own codec is the only authority on the shape, and 02 §7.7 pins the asset per
   * release, so a compiled-in default is a release constant that stops tracking the release.
   */
  readonly usdcLocation: unknown;
}

/** S20's two keys — 02 §7.4's `System.Account` and the `ForeignAssets` USDC entry. */
export function balanceKeys(inputs: BalanceKeyInputs): BalanceKeys {
  const account = builder(inputs.chain, BALANCE_READS.account);
  const freeUsdc = builder(inputs.chain, BALANCE_READS.freeUsdc);
  return {
    account: (who) => account.key([who]),
    // The Location first, the account second — the key order `ForeignAssets.Account`
    // declares. Reversing them encodes both values correctly and hashes them into a key for
    // nothing, which renders as a zero balance.
    freeUsdc: (who) => freeUsdc.key([inputs.usdcLocation, who]),
  };
}

/** `frame_system`'s `AccountInfo`, reduced to the two figures S20 renders. */
function asSystemAccount(
  value: unknown,
): Decoded<{ readonly free: bigint; readonly reserved: bigint } | undefined> {
  const surface = BALANCE_READS.account;
  const record = asRecord(value, surface);
  if (!record.ok) return record;
  const data = asRecord(record.value['data'], `${surface}.data`);
  if (!data.ok) return data;
  const free = bigintAt(data.value, 'free', `${surface}.data`);
  if (!free.ok) return free;
  const reserved = bigintAt(data.value, 'reserved', `${surface}.data`);
  if (!reserved.ok) return reserved;
  return { ok: true, value: { free: free.value, reserved: reserved.value } };
}

/** This chain's `ForeignAssets.Account` record — never `Assets.Account` (02 §7.4, 11 §11.2). */
function asAssetAccount(value: unknown): Decoded<{ readonly balance: bigint } | undefined> {
  const surface = BALANCE_READS.freeUsdc;
  const record = asRecord(value, surface);
  if (!record.ok) return record;
  const balance = bigintAt(record.value, 'balance', surface);
  return balance.ok ? { ok: true, value: { balance: balance.value } } : balance;
}

/** S20's two decoders. */
export function balanceDecoders(chain: ScreenChain): BalanceDecoders {
  return {
    account: storage(chain, BALANCE_READS.account, asSystemAccount),
    freeUsdc: storage(chain, BALANCE_READS.freeUsdc, asAssetAccount),
  };
}
