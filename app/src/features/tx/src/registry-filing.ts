/**
 * Registry filings and the window event stream — 11 §11.8.6. F17.
 *
 * ## The ingest filter binds the pallet, because two pallets publish the same names
 *
 * > The registry-window history and countdown adjustments MUST source
 * > `WindowAcknowledged { epoch, filing_id, watchtower }` and
 * > `WindowExtended { epoch, filing_id, new_deadline }` from the **registry** event stream
 * > frozen in [02 §6], alongside the filing storage read. They are distinct from the oracle
 * > events of the same names, whose fields carry `component`/`round`; the ingest filter MUST
 * > bind the pallet as well as the variant name.
 *
 * This is a defect that hides perfectly. A filter matching `variant === 'WindowExtended'`
 * compiles, runs, and ingests events all day — some of them from `pallet-oracle`, about a
 * different sub-game entirely. The visible symptom is a registry challenge countdown that
 * moves when an *oracle* watchtower extends an *oracle* round: a filing's deadline appears to
 * shift for a reason that has nothing to do with it, and a challenger who trusted the
 * countdown misses their window.
 *
 * `admitRegistryWindowEvent` therefore checks **both directions**:
 *
 * - the pallet must be the registry's — a name match alone admits the wrong pallet;
 * - the payload must carry `filing_id` and must **not** carry `component`/`round` — because
 *   an event mislabelled with the right pallet and the wrong body is the same failure
 *   arriving by another route, and checking only the label trusts the labeller.
 *
 * One check alone is weaker than it looks, which is why there are two.
 *
 * ## A filing's preconditions are value-scaled, and the bond is not a constant
 *
 * §11.8.6's row: *"filing bond balance (value-scaled per [07])"*. So the bond arrives as a
 * read rather than as a number this module knows — app-code rule 7, and the reason is that a
 * value-scaled bond is exactly the kind of figure a client would otherwise bake in at
 * launch and silently under-report after the first amendment.
 */

import type { Verified } from '@bleavit/shared-types';

/** The pallet these events must come from. Compared, never assumed. */
export const REGISTRY_PALLET = 'Registry';

/** The two window variants 02 §6 freezes for `pallet-registry`. */
export type RegistryWindowVariant = 'WindowAcknowledged' | 'WindowExtended';

/** A raw decoded event, before it is admitted. Deliberately loose — this is untrusted input. */
export interface RawEvent {
  readonly pallet: string;
  readonly variant: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

export type RegistryWindowEvent =
  | {
      readonly variant: 'WindowAcknowledged';
      readonly epoch: number;
      readonly filingId: number;
      readonly watchtower: string;
    }
  | {
      readonly variant: 'WindowExtended';
      readonly epoch: number;
      readonly filingId: number;
      readonly newDeadline: number;
    };

export type Admission =
  | { readonly kind: 'admitted'; readonly event: RegistryWindowEvent }
  | { readonly kind: 'rejected'; readonly reason: string };

/** Fields that identify a `pallet-oracle` event of the same name — 02 §7.2. */
const ORACLE_ONLY_FIELDS = Object.freeze(['component', 'round']);

/**
 * Admit a window event only if it is the **registry's**.
 *
 * Rejection is a first-class result rather than a filter that drops silently: an event this
 * client refuses is information — it means the stream carried something unexpected, and a
 * countdown built on a stream nobody audited is how the wrong deadline gets rendered.
 */
export function admitRegistryWindowEvent(raw: RawEvent): Admission {
  if (raw.pallet !== REGISTRY_PALLET) {
    return {
      kind: 'rejected',
      reason:
        `This ${raw.variant} came from ${raw.pallet}, not ${REGISTRY_PALLET}. The oracle ` +
        'publishes events with these exact names about a different sub-game; ingesting one ' +
        'here would move a filing’s deadline for a reason that has nothing to do with it.',
    };
  }
  if (raw.variant !== 'WindowAcknowledged' && raw.variant !== 'WindowExtended') {
    return { kind: 'rejected', reason: `${raw.variant} is not a registry window event.` };
  }
  // The second direction. A right-pallet, wrong-body event is the same failure arriving by
  // another route, and checking only the label trusts the labeller.
  const strayOracleField = ORACLE_ONLY_FIELDS.find((field) => field in raw.fields);
  if (strayOracleField !== undefined) {
    return {
      kind: 'rejected',
      reason:
        `This ${raw.variant} is labelled ${REGISTRY_PALLET} but carries \`${strayOracleField}\`, ` +
        'which only the oracle’s event of this name has. The label and the body disagree, so ' +
        'it is not admitted.',
    };
  }
  const epoch = raw.fields['epoch'];
  const filingId = raw.fields['filing_id'];
  if (typeof epoch !== 'number' || typeof filingId !== 'number') {
    return {
      kind: 'rejected',
      reason: `This ${raw.variant} is missing \`epoch\` or \`filing_id\`.`,
    };
  }
  if (raw.variant === 'WindowAcknowledged') {
    const watchtower = raw.fields['watchtower'];
    if (typeof watchtower !== 'string') {
      return { kind: 'rejected', reason: 'WindowAcknowledged is missing `watchtower`.' };
    }
    return { kind: 'admitted', event: { variant: 'WindowAcknowledged', epoch, filingId, watchtower } };
  }
  const newDeadline = raw.fields['new_deadline'];
  if (typeof newDeadline !== 'number') {
    return { kind: 'rejected', reason: 'WindowExtended is missing `new_deadline`.' };
  }
  return { kind: 'admitted', event: { variant: 'WindowExtended', epoch, filingId, newDeadline } };
}

// --------------------------------------------------------------- filing preconditions

export type FilingKind = 'incident' | 'milestone';

export interface FilingInputs {
  readonly kind: FilingKind;
  readonly freeUsdc: Verified<bigint>;
  /** Value-scaled per 07 — a read, never a constant this module knows (app-code rule 7). */
  readonly filingBond: Verified<bigint>;
  /** Current occupancy and its bound, both read. */
  readonly filingsUsed: Verified<number>;
  readonly filingsBound: Verified<number>;
  /** The evidence hash the filer supplies. Absent is a refusal, not a default. */
  readonly evidenceHash: string | undefined;
}

export interface FilingBlock {
  readonly check: string;
  readonly detail: string;
}

export function filingBlocks(inputs: FilingInputs): readonly FilingBlock[] {
  const blocks: FilingBlock[] = [];
  if (inputs.freeUsdc.value < inputs.filingBond.value) {
    blocks.push({
      check: 'Filing bond',
      detail:
        'Your free USDC does not cover the filing bond. The bond is value-scaled, so it is ' +
        'read from chain state rather than fixed — a larger claim costs more to file.',
    });
  }
  if (inputs.filingsUsed.value >= inputs.filingsBound.value) {
    blocks.push({
      check: 'Registry bounds',
      detail:
        'The registry is at its bound for this epoch. A filing now would be refused on ' +
        'chain; the bound clears when the epoch closes.',
    });
  }
  if (inputs.evidenceHash === undefined || inputs.evidenceHash.length === 0) {
    blocks.push({
      check: 'Evidence',
      detail:
        'A filing needs an evidence hash. Evidence nobody can fetch is adjudicated as ' +
        'absent, so filing without one commits a claim you cannot later support.',
    });
  }
  return blocks;
}
