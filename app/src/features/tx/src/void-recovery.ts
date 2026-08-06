/**
 * VOID recovery — 11 §11.6, D-1, E16.
 *
 * When a vault is `Voided` the redeem screen stops being a settlement screen and
 * becomes a *decomposition* screen: what a user holds determines which of three
 * paths their value comes back through, and the paths pay very different rates.
 * This module is that decomposition, and the reason it is a pure function with
 * its own suite is that §11.6 is almost entirely a list of ways to overstate a
 * recovery.
 *
 * ## The three paths, and why the order is not a preference
 *
 * 1. **Consolidate** (§11.6 step 1a). A same-branch LONG+SHORT set — or a
 *    same-branch YES+NO gate set — pays **no USDC**. `merge_scalar` / `merge_gate`
 *    climb it to one branch-USDC *of that branch*. This is value-neutral on its
 *    own and the UI must say so; presenting it under a 100 %-recovery heading is
 *    exactly the overstatement §11.6 forbids.
 * 2. **Pair across branches** (§11.6 step 1). `merge` of an **Accept + Reject**
 *    branch-USDC pair pays **par**, 1:1, and is the only 100 % path there is.
 * 3. **Redeem the residue** (§11.6 step 2). Unpaired branch-USDC pays
 *    `floor(a/2)`; an unpaired LONG, SHORT, or gate leg pays `floor(a/4)`.
 *
 * The order is forced rather than chosen, and each step is weakly better than
 * leaving the holding where it was — which is why a screen that offered them in
 * any other order would be quoting a smaller number than the user can actually
 * get. Consolidating `min(long, short)` trades `2·floor(a/4)` for `floor(a/2)`,
 * never less. Pairing consolidated branch-USDC trades `2·floor(a/2)` for `a`,
 * strictly more for every `a ≥ 1`. So *consolidate, then pair, then redeem* is
 * the maximum, and the headline figure §11.6 step 3 demands — *"the total
 * recovery those actual holdings reach"* — is that maximum.
 *
 * ## What SQ-171 forbids, and how it is expressed here
 *
 * The par promise may be made **only** for holdings complete across both
 * branches. `parCopyPermitted` is therefore not *"a pair exists"* — it is *"the
 * decomposition left no residue"*, because a portfolio that is half pairs and
 * half unpaired legs recovers well under par and a headline quoting the pairs
 * alone is the misstatement the rule names. The two facts are separate fields
 * (`mayOfferParMerge` is the *action*, `parCopyPermitted` is the *copy*) because
 * collapsing them is how the wrong one gets used: the action is offered exactly
 * when a pair exists, and the copy is permitted strictly less often.
 *
 * **No fee appears anywhere here, and that is normative rather than an omission.**
 * `redeem_void` and every `merge*` primitive are exempt from the 03 §5.3a
 * redemption fee — VOID is protocol failure, and charging for it would invert
 * G-1 — so the `floor(a/2)` and `floor(a/4)` rates are what the account receives,
 * gross and net alike (11 §11.6 step 2). A fee line on this screen would be
 * wrong, not merely redundant.
 *
 * @see docs/architecture/11-frontend-workflows.md §11.6
 * @see docs/architecture/03-conditional-ledger.md §5.3, §6.4
 */

/** The two branches of a proposal vault. */
export type Branch = 'Accept' | 'Reject';

/** The two gate structures a proposal carries (03 §5.3, 05). */
export type GateType = 'Survival' | 'Security';

export const BRANCHES: readonly Branch[] = Object.freeze(['Accept', 'Reject']);
export const GATE_TYPES: readonly GateType[] = Object.freeze(['Survival', 'Security']);

/** What an account holds in a voided vault, by branch. */
export interface VoidHoldings {
  readonly branchUsdc: Readonly<Record<Branch, bigint>>;
  readonly long: Readonly<Record<Branch, bigint>>;
  readonly short: Readonly<Record<Branch, bigint>>;
  readonly gateYes: Readonly<Record<Branch, Readonly<Record<GateType, bigint>>>>;
  readonly gateNo: Readonly<Record<Branch, Readonly<Record<GateType, bigint>>>>;
}

/** A value-neutral consolidation step (§11.6 step 1a) — mints, pays no USDC. */
export interface Consolidation {
  readonly call: 'merge_scalar' | 'merge_gate';
  readonly branch: Branch;
  /** Present on `merge_gate` only; a scalar set has no gate. */
  readonly gate?: GateType;
  readonly amount: bigint;
}

/** An instrument left unpaired after steps 1a and 1, and what it redeems for. */
export interface VoidResidual {
  readonly branch: Branch;
  readonly kind: 'BranchUsdc' | 'Long' | 'Short' | 'GateYes' | 'GateNo';
  readonly gate?: GateType;
  readonly amount: bigint;
  /** `floor(a/2)` for branch-USDC, `floor(a/4)` for a leg (§11.6 step 2). */
  readonly payout: bigint;
}

/** The whole decomposition §11.6 step 3 asks a screen to render. */
export interface VoidRecovery {
  /** Step 1a — offered as consolidation, never as recovery. */
  readonly consolidations: readonly Consolidation[];
  /** Step 1 — the cross-branch `merge` amount, which pays `parPair` at par. */
  readonly parPair: bigint;
  /** Step 2 — every unpaired instrument, with its exact floored payout. */
  readonly residuals: readonly VoidResidual[];
  /** The headline: what these holdings actually recover, in USDC base units. */
  readonly total: bigint;
  /** Whether to offer the "Merge pairs → 100 % recovery" action at all. */
  readonly mayOfferParMerge: boolean;
  /** Whether "par" / "full principal" copy is permitted (SQ-171). */
  readonly parCopyPermitted: boolean;
}

export class VoidHoldingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoidHoldingsError';
  }
}

function requireBalance(value: bigint, what: string): bigint {
  if (value < 0n) {
    throw new VoidHoldingsError(`${what} is negative (${value.toString()}); a balance cannot be`);
  }
  return value;
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/** `floor(a/2)` — the unpaired branch-USDC rate (D-1: a voided binary claim). */
export function unpairedBranchUsdcPayout(amount: bigint): bigint {
  return requireBalance(amount, 'a branch-USDC amount') / 2n;
}

/** `floor(a/4)` — the unpaired scalar-leg and gate-leg rate (D-1; 03 §5.3). */
export function unpairedLegPayout(amount: bigint): bigint {
  return requireBalance(amount, 'a leg amount') / 4n;
}

/**
 * Decompose a voided position into the recovery §11.6 step 3 describes.
 *
 * Nothing here is a preference: the steps run in the only order that reaches the
 * maximum (see this file's header), and the returned `total` is that maximum.
 * A screen renders `total` as the headline and the three lists beneath it; it may
 * not compute its own headline from any subset, which is what SQ-171 forbids.
 */
export function decomposeVoidRecovery(holdings: VoidHoldings): VoidRecovery {
  const consolidations: Consolidation[] = [];
  // Step 1a — same-branch sets climb to branch-USDC of their own branch. Value
  // neutral: it mints one instrument from two and pays nothing.
  const consolidated: Record<Branch, bigint> = { Accept: 0n, Reject: 0n };
  const leftoverLong: Record<Branch, bigint> = { Accept: 0n, Reject: 0n };
  const leftoverShort: Record<Branch, bigint> = { Accept: 0n, Reject: 0n };
  const leftoverYes: Record<Branch, Record<GateType, bigint>> = {
    Accept: { Survival: 0n, Security: 0n },
    Reject: { Survival: 0n, Security: 0n },
  };
  const leftoverNo: Record<Branch, Record<GateType, bigint>> = {
    Accept: { Survival: 0n, Security: 0n },
    Reject: { Survival: 0n, Security: 0n },
  };

  for (const branch of BRANCHES) {
    const long = requireBalance(holdings.long[branch], `LONG(${branch})`);
    const short = requireBalance(holdings.short[branch], `SHORT(${branch})`);
    const scalarSets = min(long, short);
    if (scalarSets > 0n) {
      consolidations.push({ call: 'merge_scalar', branch, amount: scalarSets });
    }
    consolidated[branch] += scalarSets;
    leftoverLong[branch] = long - scalarSets;
    leftoverShort[branch] = short - scalarSets;

    for (const gate of GATE_TYPES) {
      const yes = requireBalance(holdings.gateYes[branch][gate], `GateYes(${branch}, ${gate})`);
      const no = requireBalance(holdings.gateNo[branch][gate], `GateNo(${branch}, ${gate})`);
      const gateSets = min(yes, no);
      if (gateSets > 0n) {
        consolidations.push({ call: 'merge_gate', branch, gate, amount: gateSets });
      }
      consolidated[branch] += gateSets;
      leftoverYes[branch][gate] = yes - gateSets;
      leftoverNo[branch][gate] = no - gateSets;
    }
  }

  // Step 1 — the maximal cross-branch pair, which is the only par path.
  const usdcAccept =
    requireBalance(holdings.branchUsdc.Accept, 'branch-USDC(Accept)') + consolidated.Accept;
  const usdcReject =
    requireBalance(holdings.branchUsdc.Reject, 'branch-USDC(Reject)') + consolidated.Reject;
  const parPair = min(usdcAccept, usdcReject);

  // Step 2 — everything the first two steps could not place, at the D-1 rates.
  const residuals: VoidResidual[] = [];
  const push = (
    branch: Branch,
    kind: VoidResidual['kind'],
    amount: bigint,
    payout: bigint,
    gate?: GateType,
  ): void => {
    if (amount > 0n) {
      residuals.push(gate === undefined ? { branch, kind, amount, payout } : { branch, kind, gate, amount, payout });
    }
  };

  const residualUsdc: Record<Branch, bigint> = {
    Accept: usdcAccept - parPair,
    Reject: usdcReject - parPair,
  };
  for (const branch of BRANCHES) {
    push(branch, 'BranchUsdc', residualUsdc[branch], unpairedBranchUsdcPayout(residualUsdc[branch]));
    push(branch, 'Long', leftoverLong[branch], unpairedLegPayout(leftoverLong[branch]));
    push(branch, 'Short', leftoverShort[branch], unpairedLegPayout(leftoverShort[branch]));
    for (const gate of GATE_TYPES) {
      push(branch, 'GateYes', leftoverYes[branch][gate], unpairedLegPayout(leftoverYes[branch][gate]), gate);
      push(branch, 'GateNo', leftoverNo[branch][gate], unpairedLegPayout(leftoverNo[branch][gate]), gate);
    }
  }

  const total = residuals.reduce((sum, row) => sum + row.payout, parPair);

  return {
    consolidations,
    parPair,
    residuals,
    total,
    mayOfferParMerge: parPair > 0n,
    // SQ-171: the promise is about the *holdings*, not about the existence of a
    // pair inside them. Any residue at all means this portfolio recovers under
    // par, and quoting the pairs alone is the overstatement the rule names.
    parCopyPermitted: parPair > 0n && residuals.length === 0,
  };
}
