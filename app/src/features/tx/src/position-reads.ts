/**
 * S4's reads — both ledger domains, each against its own instance (11 §11.2's S4 row, §11.2a).
 *
 * Doc 02 §7.4 is blunt about the shape of this problem: `Positions` is keyed
 * `(PositionId, AccountId)`, so *"a per-account storage prefix scan is therefore NOT
 * available, and the frontend MUST use `account_positions()`"*. The same sentence holds for
 * the `ServiceLedger` instance, *"whose method is `service_positions()`"* — the key order is a
 * property of the pallet, not of the instance.
 *
 * That leaves the client reading a runtime API for its portfolio, which is exactly the case
 * 10 §4.2's FE-P2 conservative default exists for: the API result is admitted only alongside
 * the storage prefix it must agree with, **in the same domain**. 02 §7.4 again: a client
 * *"performs that cross-check per domain against that domain's own prefix, and MUST NOT
 * satisfy a service-domain read with a primary-domain key."* So the pallet is never a caller
 * argument here — it is derived from the domain by `positionSourceFor`, and the key builder
 * receives it rather than choosing it.
 *
 * ## Three refusals, each of which would otherwise be invisible
 *
 * 1. **A row whose domain could not be established is not rendered** (§11.2a rule 1). The
 *    boundary is `ConditionalLedger::ServiceIdBase`, and an unread one refuses rather than
 *    defaulting: a client that assumed `2^63` would label every hosted position as a
 *    governance one the moment the constant went missing.
 * 2. **A row whose derived domain disagrees with the view that returned it is dropped and
 *    reported.** `account_positions()` answering with a service-band id is not a row to
 *    render under the primary label — the label is what asserts which backing pool stands
 *    behind the balance, and I-4 holds per instance. This is the one check the obvious
 *    implementation omits, because the call site "knows" which domain it asked for; rule 1
 *    says the datum decides, and this is what that means when the two disagree.
 * 3. **A `PositionId::Baseline` in the service domain is corrupt state, not a Baseline
 *    position.** 16 §7.6 gives a hosted question two books and no Baseline leg, which is why
 *    doc 11's S4 row lists *no* `BaselineVaults` read for the service domain — that map is
 *    structurally empty there. {@link POSITION_READS} says so by having **no**
 *    `baselineVaults` field on its service entry.
 *
 * ## The boundary constant is checked against the reader's chain
 *
 * `serviceIdBase` arrives already stamped, from the constants API rather than from this
 * reader, so it is the one value that could enter from somewhere else. Its **chain** is
 * checked, not its block: 11 §11.4 rule 2 has constants re-read only when `spec_version`
 * moves, so a different block is lawful and a different chain never is. This is
 * `funding-reads.ts`'s `WrongChainInputError` applied to the one foreign input this reader
 * has.
 *
 * ## Every row descends from the view that returned it (V-184)
 *
 * This module used to define a local `finalized` helper wrapping **any** value in a
 * hand-written `verified-finalized` status object, and it handed that helper down into
 * {@link projectVault} as an argument. The brand is a non-exported `unique symbol` in
 * `packages/chain-client`, so what came out was a plain `Verified<T>`: structurally
 * indistinguishable from a read, invisible to `check:casts` (which matches an assertion) and
 * to the render gate's rule B (which matches a borrowed `.status` access). It is the V-182
 * defect, found in `market-reads.ts` and repaired there.
 *
 * Here every one of its seven call sites was a value the cross-checked call really did
 * return, so nothing on this screen was a false badge — what was missing was the *reason*
 * the badge was true. `derive` supplies it: the pin is the one `crossCheckedCall` came back
 * with, and a row can be finalized only because that call was made. A later edit that reads
 * one field from somewhere else can no longer inherit this pin by sitting next to the others.
 *
 * ## The vault surfaces are read, not merely declared (V-322)
 *
 * 11 §11.2's S4 row names four reads per book and this module performed two of them.
 * `ConditionalLedger.Vaults(pid)`, `ConditionalLedger.BaselineVaults(epoch)` and
 * `ServiceLedger.Vaults(question)` sat in {@link POSITION_READS} under a comment calling them
 * *"the frozen 02 surfaces this screen reads"*, and nothing built a key, a decoder or a read
 * for any of the three — so every vault state on this screen reached the VOID layout and the
 * redemption-call selection through `PositionView.vault_state` alone, with no cross-check
 * against the storage it is projected from.
 *
 * That is the one field with a payout behind it. §11.5's charged/exempt split, §11.6's whole
 * VOID decomposition and P-4/P-5's *"vault ∈ {…}"* rows are all decided by it, and 02 §3
 * retains the FE-P2 cross-check of every runtime-API result on the transaction path *"as
 * defence against a client misreading an aggregate API's semantics — which proof verification
 * says nothing about."* A balance that disagreed with storage was already dropped; a vault
 * state that disagreed was rendered.
 *
 * The read is **per vault, not per row**: the runtime stamps every instrument of one vault
 * with that vault's own `state`, so one storage read answers for all of them.
 *
 * Its two failure directions follow the ones this module already draws for the `Positions`
 * prefix, for the same reasons. A **disagreement or a missing entry drops the row** and
 * reports it — the runtime only emits a `PositionView` for a vault it iterated, so an absent
 * entry beside a returned row is a real disagreement. An **undecodable** vault reports itself
 * and leaves the rows rendering: INV-FE-12 shows undecodable data with a warning rather than
 * hiding an account's whole portfolio, and a skipped cross-check that says so is not a passed
 * one.
 *
 * @see docs/architecture/10-frontend-architecture.md §2.1, §2.2, §4.2
 * @see docs/architecture/02-integration-contract.md §7.4, §3, §9
 * @see docs/architecture/11-frontend-workflows.md §11.2, §11.2a, §11.5, §11.6
 */

import {
  derive,
  positionSourceFor,
  type Finalized,
  type FinalizedBlockRef,
  type LedgerDomain as ChainLedgerDomain,
  type StorageItem,
} from '@bleavit/chain-client';
import { combine, type Verified } from '@bleavit/shared-types';

import { domainOf, totalOf, type LedgerDomain, type LedgerRow } from './ledger-domain.js';
import type {
  DomainBook,
  PositionAnomaly,
  PositionRow,
  PositionsView,
  UndecodableRead,
  VaultProjection,
  VoidConsolidationRow,
  VoidRecoveryView,
  VoidResidualRow,
} from './positions.js';
import { decomposeVoidRecovery, type VoidHoldings } from './void-recovery.js';

/** A decode failure is data, not an exception — INV-FE-12. */
export type Decoded<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

/**
 * The frozen 02 surfaces this screen reads, per domain.
 *
 * Every name here is a read {@link readPositions} performs. It was not: the three vault
 * entries were declared under this sentence and nothing built a key, a decoder or a read for
 * any of them, so the sentence was the whole of the claim (V-322). `app/tests/screens` now
 * asserts the **calls** the reader made rather than the fields this object has — a check that
 * a name is present in a frozen record is a check that passes while measuring nothing.
 *
 * The service entry deliberately carries **no** `baselineVaults`: doc 11's S4 row states
 * *"no `BaselineVaults` read, that map is structurally empty in the service domain"*, and a
 * field present-but-unused is a field a later edit fills in.
 */
export const POSITION_READS = Object.freeze({
  primary: Object.freeze({
    api: 'account_positions',
    positions: 'ConditionalLedger.Positions',
    vaults: 'ConditionalLedger.Vaults',
    baselineVaults: 'ConditionalLedger.BaselineVaults',
  }),
  service: Object.freeze({
    api: 'service_positions',
    positions: 'ServiceLedger.Positions',
    vaults: 'ServiceLedger.Vaults',
  }),
  /** The §11.2a rule-1 boundary, from the constants API (02 §9). */
  serviceIdBase: 'ConditionalLedger.ServiceIdBase',
} as const);

/**
 * What a `PositionId` is keyed by, and therefore what the domain test runs on.
 *
 * A proposal position carries a `u64` from the partitioned id space; a Baseline position
 * carries an **epoch**, which is not in that space at all. Modelling them as one `id: bigint`
 * would put an epoch number through the bit test, where a large epoch would classify as
 * hosted — a fabricated domain for a row the user really holds.
 */
export type PositionSubject =
  | { readonly kind: 'proposal'; readonly id: bigint }
  | { readonly kind: 'baseline'; readonly epoch: number };

/** A vault state as decoded, before provenance is attached. */
export type DecodedVaultState =
  | { readonly kind: 'open' }
  | { readonly kind: 'resolved'; readonly branch: string }
  | { readonly kind: 'scalar-settled'; readonly winner: string; readonly score: bigint }
  | { readonly kind: 'voided' }
  | { readonly kind: 'baseline-settled'; readonly score: bigint };

/** One `PositionView` from `account_positions()` / `service_positions()` (02 §3). */
export interface PositionRecord {
  readonly subject: PositionSubject;
  /** The whole `PositionId` as the client renders it. */
  readonly positionId: string;
  /** Which instrument — `BranchUsdc(Accept)`, `Long(Reject)`, `GateYes(Accept, Survival)`. */
  readonly instrument: string;
  readonly balance: bigint;
  readonly vault: DecodedVaultState;
}

/** One `(PositionId, AccountId) → Balance` entry of the storage prefix (02 §7.4). */
export interface PositionWitnessEntry {
  readonly positionId: string;
  readonly account: string;
  readonly balance: bigint;
}

/** One domain's decoders: its own view, its own storage prefix, and its own vault map. */
export interface DomainPositionDecoders {
  /** The API result — a `BoundedVec<PositionView, 64>` (02 §3). */
  readonly positions: (raw: string) => Decoded<readonly PositionRecord[]>;
  /** The `Positions` prefix, key **and** value, for the FE-P2 cross-check. */
  readonly positionEntries: (
    items: readonly StorageItem[],
  ) => Decoded<readonly PositionWitnessEntry[]>;
  /**
   * `<pallet>.Vaults(pid)`'s stored state — the surface `PositionView.vault_state` is
   * projected from, for the FE-P2 cross-check of the field that decides which redemption
   * call is offered.
   *
   * `undefined` means the map holds **no entry**, which is not a decode failure and is not
   * an ordinary empty read either: a view row exists only for a vault the runtime iterated,
   * so an absent entry beside a returned row is a disagreement.
   */
  readonly vault: (raw: string) => Decoded<DecodedVaultState | undefined>;
}

/**
 * A decoder pair **per domain**, never one pair serving both.
 *
 * This was one flat pair until the composition root was written, and the shape was the defect
 * `funding-composition.ts` records in its own note: a decoder is bound at construction time to
 * one instance's codecs and one instance's key layout, so a single pair reading both
 * `ConditionalLedger.Positions` and `ServiceLedger.Positions` works **by coincidence** —
 * measured, the two instances declare the same types, so either decodes the other's bytes.
 *
 * Nothing gates that coincidence, and 02 §7.4 is explicit that the cross-check runs *"per
 * domain against that domain's own prefix"*. A field added to one instance's `PositionView`
 * ahead of `balance` would put a wrong balance on screen under a `verified-finalized` badge,
 * in the domain the user is least able to check.
 */
export interface PositionDecoders {
  readonly primary: DomainPositionDecoders;
  readonly service: DomainPositionDecoders;
  /**
   * `ConditionalLedger.BaselineVaults(epoch)`'s stored state, projected as the runtime's own
   * view projects it (02 §4, contract v6): a Baseline instrument has no winning proposal
   * branch to publish, so `Open` stays `Open` and `Settled(s)` becomes `BaselineSettled { s }`.
   *
   * Not on {@link DomainPositionDecoders}, and that is the same claim {@link POSITION_READS}
   * makes by giving its service entry no `baselineVaults` field: 16 §7.6 gives a hosted
   * question two books and no Baseline leg, so this map has exactly one home and a per-domain
   * field would be a field a later edit fills in.
   */
  readonly baselineVault: (raw: string) => Decoded<DecodedVaultState | undefined>;
}

/**
 * Storage-key construction, injected.
 *
 * Takes the **pallet** rather than the domain, because this module derives the pallet from
 * `positionSourceFor` and hands it over. A `positionsPrefix(domain)` signature would let a
 * caller's own idea of the domain decide the key, which is the crossing 02 §7.4 forbids.
 */
export interface PositionKeys {
  /** The 32-byte prefix of `<pallet>.Positions`. */
  positionsPrefix(pallet: string): string;
  /** `<pallet>.Vaults(pid)` — the proposal vault, in the domain that owns the row. */
  vault(pallet: string, proposalId: bigint): string;
  /**
   * `ConditionalLedger.BaselineVaults(epoch)`.
   *
   * No pallet argument, for {@link PositionDecoders.baselineVault}'s reason: the map exists
   * in one instance only, so a caller has no second one it could name.
   */
  baselineVault(epoch: number): string;
}

/** One pin, storage reads at it, and the FE-P2 cross-checked call. Structural. */
export interface PositionsReader {
  readonly at: FinalizedBlockRef;
  storage(
    key: string,
    type?: 'value' | 'descendantsValues',
  ): Promise<Finalized<readonly StorageItem[]>>;
  crossCheckedCall(source: {
    readonly api: string;
    readonly storagePrefix: string;
    readonly argsHex?: string;
  }): Promise<Finalized<{ readonly result: string; readonly witness: readonly StorageItem[] }>>;
}

export class WrongChainBoundaryError extends Error {
  constructor(expected: string, actual: string | undefined) {
    super(
      `ConditionalLedger::ServiceIdBase was read on chain ${String(actual)} while this reader ` +
        `is pinned to ${expected}. A boundary from another chain would partition this ` +
        'portfolio by a rule that does not apply to it (11 §11.2a rule 1).',
    );
    this.name = 'WrongChainBoundaryError';
  }
}

export interface PositionReadParams {
  /** The account, SS58 as the user sees it — rendered, never used to build a key. */
  readonly who: string;
  /** `who` SCALE-encoded as the `[u8;32]` argument of the two position views (02 §3). */
  readonly whoArgsHex: string;
  /** The account's 32-byte public key as the witness decoder renders an `AccountId32`. */
  readonly whoAccountKey: string;
  /** `ConditionalLedger::ServiceIdBase`. `undefined` blocks every row (§11.2a rule 1). */
  readonly serviceIdBase: Verified<bigint> | undefined;
}

function chainOf(datum: Verified<unknown>): string | undefined {
  return 'chain' in datum.status ? datum.status.chain : undefined;
}

/**
 * One vault state as a single comparable string.
 *
 * A rendered form rather than a field-by-field comparison, because the anomaly has to *say*
 * what the two surfaces reported and two spellings of that would let the comparison and the
 * message disagree. `undefined` is *no entry*, which is a state of the map and not an absence
 * of information.
 */
function describeVault(state: DecodedVaultState | undefined): string {
  if (state === undefined) return 'no vault entry';
  switch (state.kind) {
    case 'resolved':
      return `Resolved(${state.branch})`;
    case 'scalar-settled':
      return `ScalarSettled(winner ${state.winner}, s ${state.score})`;
    case 'baseline-settled':
      return `BaselineSettled(s ${state.score})`;
    case 'voided':
      return 'Voided';
    default:
      return 'Open';
  }
}

/** Which vault surface a row's subject is projected from — one key, one label, one decoder. */
function vaultSourceFor(
  subject: PositionSubject,
  pallet: string,
  keys: PositionKeys,
  decoders: PositionDecoders,
  domained: DomainPositionDecoders,
): { readonly key: string; readonly label: string; readonly decode: (raw: string) => Decoded<DecodedVaultState | undefined> } {
  if (subject.kind === 'baseline') {
    // Reachable in the primary domain only: a Baseline subject is primary by structure, so a
    // service book has already dropped this row as a cross-domain anomaly before here.
    return {
      key: keys.baselineVault(subject.epoch),
      label: `${POSITION_READS.primary.baselineVaults}(${subject.epoch})`,
      decode: decoders.baselineVault,
    };
  }
  return {
    key: keys.vault(pallet, subject.id),
    label: `${pallet}.Vaults(${subject.id})`,
    decode: domained.vault,
  };
}

/**
 * Read one domain's book. Never exported: the pairing of view, prefix and domain is the
 * thing 02 §7.4 protects, and a caller able to read one domain alone could pair them wrong.
 */
async function readBook<D extends LedgerDomain>(
  domain: D,
  reader: PositionsReader,
  keys: PositionKeys,
  decoders: PositionDecoders,
  params: PositionReadParams,
  serviceIdBase: bigint,
  undecodable: UndecodableRead[],
  anomalies: PositionAnomaly[],
): Promise<DomainBook<D>> {
  // The pallet comes from the domain, and the API name with it. Returned together by
  // `positionSourceFor` precisely so neither can be selected without the other (10 §11).
  const source = positionSourceFor(domain as ChainLedgerDomain);
  const label = domain === 'service' ? POSITION_READS.service : POSITION_READS.primary;
  // The decoder pair follows the domain, exactly as the pallet and the API name do. Selected
  // here rather than passed in already-chosen, so a call site cannot pair one domain's view
  // with the other's decoder (02 §7.4).
  const domained = decoders[domain];

  const raw = await reader.crossCheckedCall({
    api: source.api,
    storagePrefix: keys.positionsPrefix(source.storagePallet),
    argsHex: params.whoArgsHex,
  });

  const decoded = domained.positions(raw.value.result);
  if (!decoded.ok) {
    undecodable.push({ label: label.api, rawHex: raw.value.result, reason: decoded.reason });
    return { domain, rows: [], total: combine(0n, []) };
  }

  // FE-P2's conservative default: the view is admitted only alongside the prefix it must
  // agree with. Both legs were read at this reader's one pin, so a disagreement is a real
  // disagreement rather than a race.
  const witness = domained.positionEntries(raw.value.witness);
  const mine: ReadonlyMap<string, bigint> = witness.ok
    ? new Map(
        witness.value
          .filter((entry) => entry.account === params.whoAccountKey)
          .map((entry) => [entry.positionId, entry.balance] as const),
      )
    : new Map();
  if (!witness.ok) {
    undecodable.push({
      label: label.positions,
      rawHex: raw.value.witness.map((item) => item.value ?? '0x').join(''),
      reason: witness.reason,
    });
  }

  // One reading per **vault**, not per row: `positions_for` stamps every instrument of one
  // vault with that vault's own `state`, so one storage read answers for up to eleven rows —
  // and pushing the `undecodable` entry where the read is made rather than where it is used
  // is what keeps a shared failure from being reported eleven times.
  const vaultStates = new Map<string, Decoded<DecodedVaultState | undefined>>();
  const vaultStateFor = async (
    subject: PositionSubject,
  ): Promise<Decoded<DecodedVaultState | undefined>> => {
    const memo = subject.kind === 'baseline' ? `baseline:${subject.epoch}` : `proposal:${subject.id}`;
    const cached = vaultStates.get(memo);
    if (cached !== undefined) return cached;
    const vaultSource = vaultSourceFor(subject, source.storagePallet, keys, decoders, domained);
    const read = await reader.storage(vaultSource.key);
    const rawHex = read.value[0]?.value;
    const state: Decoded<DecodedVaultState | undefined> =
      rawHex === undefined ? { ok: true, value: undefined } : vaultSource.decode(rawHex);
    if (!state.ok) {
      undecodable.push({ label: vaultSource.label, rawHex: rawHex ?? '0x', reason: state.reason });
    }
    vaultStates.set(memo, state);
    return state;
  };

  const rows: PositionRow<D>[] = [];
  for (const record of decoded.value) {
    // §11.2a rule 1 — the datum decides, by a bit test on an id the client already holds.
    // A Baseline position is keyed by epoch, not by a partitioned id, and 16 §7.6 gives a
    // hosted question no Baseline leg at all, so it is primary by structure.
    const rowDomain: LedgerDomain =
      record.subject.kind === 'baseline'
        ? 'primary'
        : domainOf(record.subject.id, serviceIdBase);

    if (rowDomain !== domain) {
      anomalies.push({
        detail:
          `${label.api}() returned ${record.positionId}, whose id places it in the ` +
          `${rowDomain} ledger rather than the ${domain} one. The row is not rendered: the ` +
          'domain label is what says which reserves stand behind a balance, and I-4 solvency ' +
          'holds per instance (11 §11.2a rules 1 and 2).',
      });
      continue;
    }

    if (witness.ok) {
      const fromStorage = mine.get(record.positionId);
      if (fromStorage !== record.balance) {
        anomalies.push({
          detail:
            `${label.api}() reports ${record.balance} for ${record.positionId} and ` +
            `${label.positions} reports ${fromStorage === undefined ? 'no entry' : String(fromStorage)} ` +
            'at the same finalized block. The runtime view and its own storage disagree, so ' +
            'the row is not rendered (10 §4.2, FE-P2).',
        });
        continue;
      }
    }

    // The S4 row's third read, and the one with a payout behind it. `vault_state` decides
    // §11.5's charged/exempt split, §11.6's whole VOID layout and P-4/P-5's admissible-state
    // rows, so admitting it on the view's word alone admits the field that selects the call.
    // Both legs are read at this reader's one pin, so a disagreement is a disagreement rather
    // than a race.
    const vaultState = await vaultStateFor(record.subject);
    if (vaultState.ok) {
      const fromStorage = describeVault(vaultState.value);
      const fromView = describeVault(record.vault);
      if (fromStorage !== fromView) {
        const surface = vaultSourceFor(record.subject, source.storagePallet, keys, decoders, domained);
        anomalies.push({
          detail:
            `${label.api}() reports ${record.positionId} against a vault in ${fromView} and ` +
            `${surface.label} reports ${fromStorage} at the same finalized block. The runtime ` +
            'view and its own storage disagree about the state that decides which redemption ' +
            'call this row may sign, so the row is not rendered (10 §4.2, FE-P2; 11 §11.5).',
        });
        continue;
      }
    }

    // Every leaf descends from `raw` through `derive`, which carries that call's own pin
    // (10 §2.2's *"computed client-side purely from such values"*). `record` **is** part of
    // `raw.value.result` as this domain's decoder read it, so the projection ignoring its
    // argument costs nothing: there is no other value it could be describing.
    rows.push({
      domain,
      positionId: derive(raw, () => record.positionId),
      instrument: derive(raw, () => record.instrument),
      balance: derive(raw, () => record.balance),
      vault: projectVault(raw, record.vault),
    } as PositionRow<D>);
  }

  // §11.2a rule 2's per-domain total, through `totalOf` — whose `NoInfer` rows make a
  // cross-domain sum a type error, and whose runtime check covers the untyped data path.
  const ledgerRows: LedgerRow<D>[] = rows.map((row) => ({ domain, amount: row.balance.value }));
  const total = totalOf(domain, ledgerRows);
  return {
    domain,
    rows,
    // The **call's own** status leads the list, and it is what makes an empty book state a
    // zero. `combine(x, [])` is `incomparable` — correct where nothing was read, and wrong
    // here: this domain's view was read, at this pin, and it answered with no rows. Rendering
    // that as *not available* beside "this account holds nothing here" tells a user the
    // client could not say, when it could and did. An account with no hosted positions is the
    // ordinary case, not a degraded one.
    total: combine(total, [raw.status, ...rows.map((row) => row.balance.status)]),
  };
}

/**
 * The vault state as a projection of the read that carried it.
 *
 * Takes the read rather than a stamping function, which is the whole of the V-184 repair:
 * the caller used to hand in a `finalized(value)` helper, so a settlement branch and a
 * winner were badged `verified-finalized` by a closure that had never seen a read. Now the
 * pin can only be the one `read` arrived with, and the two branch-free arms have nothing to
 * badge because they carry no value at all.
 */
function projectVault(read: Finalized<unknown>, vault: DecodedVaultState): VaultProjection {
  switch (vault.kind) {
    case 'resolved':
      return { kind: 'resolved', branch: derive(read, () => vault.branch) };
    case 'scalar-settled':
      return {
        kind: 'scalar-settled',
        winner: derive(read, () => vault.winner),
        score: derive(read, () => vault.score),
      };
    case 'baseline-settled':
      return { kind: 'baseline-settled', score: derive(read, () => vault.score) };
    case 'voided':
      return { kind: 'voided' };
    default:
      return { kind: 'open' };
  }
}

/**
 * Read S4's two books at the reader's pinned block.
 *
 * Both domains are always read. A client that skipped the service domain when it "expected"
 * nothing there would take a user's money into a hosted book and then not show it, which is
 * the defect §11.2a exists to repair.
 */
export async function readPositions(
  reader: PositionsReader,
  keys: PositionKeys,
  decoders: PositionDecoders,
  params: PositionReadParams,
): Promise<PositionsView> {
  const undecodable: UndecodableRead[] = [];
  const anomalies: PositionAnomaly[] = [];

  if (params.serviceIdBase === undefined) {
    // Fail closed on the whole screen rather than per row: without the boundary the client
    // cannot say which reserves back *any* balance, and rule 1 forbids rendering a row whose
    // domain it could not establish.
    return {
      primary: { domain: 'primary', rows: [], total: combine(0n, []) },
      service: { domain: 'service', rows: [], total: combine(0n, []) },
      undecodable: [
        {
          label: POSITION_READS.serviceIdBase,
          rawHex: '0x',
          reason:
            'the boundary between the two ledger domains could not be read from metadata, so ' +
            'no position can be labelled with the reserves that back it (11 §11.2a rule 1)',
        },
      ],
      anomalies: [],
    };
  }
  const boundaryChain = chainOf(params.serviceIdBase);
  if (boundaryChain !== reader.at.chain) {
    throw new WrongChainBoundaryError(reader.at.chain, boundaryChain);
  }
  const serviceIdBase = params.serviceIdBase.value;

  const primary = await readBook(
    'primary',
    reader,
    keys,
    decoders,
    params,
    serviceIdBase,
    undecodable,
    anomalies,
  );
  const service = await readBook(
    'service',
    reader,
    keys,
    decoders,
    params,
    serviceIdBase,
    undecodable,
    anomalies,
  );

  return { primary, service, undecodable, anomalies };
}

/**
 * §11.6's decomposition with the holdings' own provenance carried onto every figure.
 *
 * One `Verified<VoidHoldings>` rather than a figure-per-read, because the whole decomposition
 * is a function of one account's holdings in one vault at one block: splitting it into
 * independently-badged inputs would invite a screen to render a total whose parts came from
 * two blocks, which `decomposeVoidRecovery` has no way to detect.
 *
 * `combine` rather than a re-stamped literal, so the sanctioned path is the one taken even in
 * the single-status case (10 §2.1's rule B).
 */
export function voidRecoveryView(holdings: Verified<VoidHoldings>): VoidRecoveryView {
  const recovery = decomposeVoidRecovery(holdings.value);
  const stamp = (value: bigint) => combine(value, [holdings.status]);
  const consolidations: VoidConsolidationRow[] = recovery.consolidations.map((step) => ({
    call: step.call,
    branch: step.branch,
    gate: step.gate,
    amount: stamp(step.amount),
  }));
  const residuals: VoidResidualRow[] = recovery.residuals.map((row) => ({
    branch: row.branch,
    kind: row.kind,
    gate: row.gate,
    amount: stamp(row.amount),
    payout: stamp(row.payout),
  }));
  return {
    total: stamp(recovery.total),
    parPair: stamp(recovery.parPair),
    consolidations,
    residuals,
    mayOfferParMerge: recovery.mayOfferParMerge,
    parCopyPermitted: recovery.parCopyPermitted,
  };
}
