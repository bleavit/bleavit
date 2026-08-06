/**
 * The `FE-PROV-001..004` family — 10 §8.3, §8.4, §10.4. F9.
 *
 * §10.4 declares the family and requires *"fixed user copy + expert detail + documented
 * recovery per code; no free-text errors"*. Until 2026-08-06 only two of the four were bound
 * to a mechanism anywhere in the spec (`FE-PROV-002` in [14] TH-49, `FE-PROV-004` in §8.4),
 * and the other two were bound to nothing — which is not a spare-capacity choice but a gap:
 * an unbound code has no copy, so the mechanism that should emit it emits free text instead,
 * which §10.4 forbids. §8.4 now carries the whole table and this module is its one
 * implementation.
 *
 * ## Why the copy lives beside the code and not at the call site
 *
 * The same reason `handoff-envelope/refusals.ts` gives: the recovery is a property of the
 * **code**, not of the site that raised it, and it must read the same every time. A recovery
 * composed at the call site drifts between the two places a provider can be disabled, and the
 * user then gets two different accounts of the same event.
 *
 * ## Two of these four are about *not* claiming something
 *
 * `FE-PROV-002` and `FE-PROV-004` both report a detection, and both are easy to over-state.
 * The auto-disable copy must not imply that anything the provider supplied *was* trusted
 * before the mismatch — nothing it supplied was ever verified, because `Finalized<T>` is
 * unnameable in this package (10 §2.1). And the two-snapshot diff proves only that **at least
 * one** of the pair is wrong; it cannot say which, so the recovery leaves the range as a
 * labelled hole rather than picking a winner. Two producers cannot outvote the absence of a
 * proof, and a client that let them would be manufacturing exactly the confidence §8.4
 * declines to offer.
 */

export type ProviderRefusalCode =
  | 'FE-PROV-001' // health-probe failure: unreachable, or `Failing` after consecutive errors
  | 'FE-PROV-002' // sampling mismatch ⇒ auto-disable
  | 'FE-PROV-003' // snapshot rejected at import (pin / malformed / internally inconsistent)
  | 'FE-PROV-004'; // two independent snapshots of one range disagree

interface CodeCopy {
  /** Fixed in-bundle user copy. */
  readonly message: string;
  /** What the user can do. A property of the code, not of the call site. */
  readonly recovery: string;
}

const COPY: Readonly<Record<ProviderRefusalCode, CodeCopy>> = Object.freeze({
  'FE-PROV-001': {
    message: 'An optional data source is not responding.',
    recovery:
      'Nothing is lost and nothing needs doing. Bleavit falls back to the data it verified ' +
      'itself, with the gaps shown as gaps. Optional sources only ever made older history ' +
      'load faster; they were never used to decide anything.',
  },
  'FE-PROV-002': {
    message: 'An optional data source gave an answer that did not match the chain.',
    recovery:
      'The source has been switched off and the reason recorded. Nothing it supplied was ' +
      'ever treated as verified. You can turn it back on, but a source that answered wrongly ' +
      'once is worth replacing rather than retrying.',
  },
  'FE-PROV-003': {
    message: 'This snapshot was rejected and nothing was imported.',
    recovery:
      'Nothing local was deleted — the eviction preview runs before the import, so a rejected ' +
      'snapshot costs you nothing. Check that the file downloaded completely, and compare its ' +
      'content hash against the one the publisher lists.',
  },
  'FE-PROV-004': {
    message: 'Two snapshots of the same period disagree with each other.',
    // The recovery must not offer a resolution, because 10 §8.4 declines to have one: the
    // disputed range "is left as a labelled hole rather than resolved by majority — two
    // producers cannot outvote the absence of a proof". An earlier wording called a third
    // snapshot "the only thing that resolves it", which invites exactly the 2-of-3 reading the
    // table rejects and would have a user trust one side of an unprovable disagreement.
    recovery:
      'At least one of them is wrong and this check cannot tell which, so neither is used for ' +
      'the period they disagree about — it stays visible as a gap. A third snapshot from an ' +
      'unrelated publisher is another comparison, not a decision: agreement between sources is ' +
      'not proof, and nothing outside this device can settle a range this device cannot reach. ' +
      'What does settle it is the chain itself, for the blocks your own light client can read.',
  },
});

export const PROVIDER_REFUSAL_CODES = Object.freeze(
  Object.keys(COPY) as readonly ProviderRefusalCode[],
);

export interface ProviderRefusal {
  readonly code: ProviderRefusalCode;
  readonly message: string;
  readonly recovery: string;
  /** Expert detail — the one part that varies per occurrence (§10.4). */
  readonly detail: string;
}

export function providerRefusal(code: ProviderRefusalCode, detail: string): ProviderRefusal {
  const copy = COPY[code];
  return { code, message: copy.message, recovery: copy.recovery, detail };
}
