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
 *
 * ## Every sentence a mechanism emits is built here, including the ones that vary
 *
 * §10.4 forbids free-text errors, and a sentence assembled at the call site is free text with
 * a template around it. Two call sites can disable a provider — {@link afterSampling} and
 * `runSamplingRound` — and until 2026-08-06 each built the same sentence independently, which
 * is the drift this module's own rule exists to prevent: a user who saw one wording in the
 * provider panel and another in the sampling report would reasonably read them as two events.
 * So the *reason* strings live here too, as functions of the facts that vary, and the call
 * sites hold none of the words.
 *
 * ## `FE-PROV-003` has one message and one recovery, and its remediation is per cause
 *
 * §8.4 fires `FE-PROV-003` when *"a snapshot is rejected at import"*, and the parenthetical
 * that follows names the internal-consistency family. Rejection has other causes — a document
 * describing a **different chain**, and a spot re-derivation that **disagreed with what this
 * device read** — and the same recovery cannot serve all of them: telling somebody to check
 * their download completed is wrong advice for a snapshot of another chain, and acting on it
 * costs them a second pointless download.
 *
 * §10.4's structure is what resolves this without inventing a code. The **user copy** and the
 * **recovery** are per code and stay fixed: nothing was imported, nothing was evicted. The
 * **expert detail** is explicitly the per-occurrence half, so the cause-specific remediation
 * is a fixed sentence selected by a typed discriminant and prepended there. Nothing is
 * composed at a call site, and no cause emits words this module does not hold.
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

/**
 * 10 §8.3's closing sentence, as copy.
 *
 * > All-providers-down ⇒ the default (provider-less) behavior with the standard
 * > incomplete-history explainer.
 *
 * It is one string in one place because it is the same explanation in three situations that
 * look different to a user and are identical to the client: no source was ever enabled
 * (§8.1's default), every enabled source is switched off, and a source is answering but the
 * range asked for predates it. In all three the app is the layer-1+2+3 system and the missing
 * history is missing, visibly.
 *
 * `FE-PROV-001`'s recovery is built from this rather than restating it. That code's whole
 * promise is *"the app falls back to the provider-less default with the incomplete-history
 * explainer"* — two copies of that sentence is two versions of the promise, and the drift is
 * invisible because no call site takes both.
 */
export const INCOMPLETE_HISTORY_EXPLAINER =
  'Bleavit is showing what it verified for itself, and periods it could not read are shown ' +
  'as gaps rather than filled in or smoothed over. Optional sources only ever made older ' +
  'history load faster: nothing you can act on depended on one, and no gap here affects ' +
  'anything you can sign.';

const COPY: Readonly<Record<ProviderRefusalCode, CodeCopy>> = Object.freeze({
  'FE-PROV-001': {
    message: 'An optional data source is not responding.',
    recovery: `Nothing is lost and nothing needs doing. ${INCOMPLETE_HISTORY_EXPLAINER}`,
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
    // Deliberately cause-neutral. An earlier version ended with "check that the file
    // downloaded completely, and compare its content hash" — true for a truncated file and
    // wrong for the other two causes, and a user who acts on it downloads a snapshot of the
    // wrong chain a second time. What every cause shares is the promise below, which is the
    // one §8.4 attaches to this code; what differs is the remediation, and that is a fixed
    // sentence per cause carried in the expert detail (see the module note).
    recovery:
      'Nothing local was deleted — the eviction preview runs before the import, so a rejected ' +
      'snapshot costs you nothing. The detail below names which check failed and what to do ' +
      'about that particular failure.',
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

// ------------------------------------------------------------------ the reasons, in one place

/**
 * What a §8.4 comparison against chain state was comparing.
 *
 * Two mechanisms disable a provider for the same reason and count different things: the live
 * sampler re-reads **rows** (§8.4's 1-in-16-page re-verification) and the snapshot importer
 * re-derives **blocks** (§8.4's deterministic spot re-derivation). Telling a user that
 * *"2 of 128 spot-checked rows"* disagreed when what disagreed was two blocks is a small lie
 * in the one sentence they are given to act on, so the noun is part of the copy rather than
 * a number formatted into a generic template.
 */
export type MismatchSubject = 'sampled-rows' | 'rederived-blocks';

const SUBJECT: Readonly<Record<MismatchSubject, string>> = Object.freeze({
  'sampled-rows': 'spot-checked rows did not match what this device read from the chain',
  'rederived-blocks':
    'blocks this device re-derived from the chain do not match what the source says happened ' +
    'in them',
});

/**
 * Why a provider was switched off after a §8.4 comparison against chain state.
 *
 * A **required field** of the disabled state (see `health.ts`), and built here rather than at
 * any of the sites that can raise it. Those sites once held their own copy of this sentence;
 * they agreed, until one of them was edited.
 */
export function samplingMismatchReason(
  mismatches: number,
  checked: number,
  subject: MismatchSubject = 'sampled-rows',
): string {
  return (
    `${mismatches} of ${checked} ${SUBJECT[subject]}. The source is switched off; nothing it ` +
    'supplied was ever treated as verified.'
  );
}

/** Why a provider was switched off after consecutive failed health probes (§8.3's ladder). */
export function probeFailureReason(consecutiveFailures: number, why: string): string {
  return (
    `This source failed to respond ${consecutiveFailures} times in a row (${why}). It is ` +
    `switched off; the app falls back to what it can read for itself. ${INCOMPLETE_HISTORY_EXPLAINER}`
  );
}

/**
 * Why a snapshot was refused at import.
 *
 * Three causes, one code. See the module note for why that is §10.4-conformant rather than a
 * fourth code invented here: the message and the recovery are per code and fixed, and the
 * cause only selects which fixed remediation sentence leads the expert detail.
 */
export type SnapshotRejectionCause =
  /** §8.4's own three: content-pin mismatch, malformed encoding, failed internal consistency. */
  | 'integrity'
  /** The document describes a different chain (10 §7 gives one local database per chain). */
  | 'wrong-chain'
  /** Spot re-derivation inside light-client-reachable depth disagreed with the chain. */
  | 'chain-disagreement'
  /** The spot re-derivation could not finish, so the mandatory §8.4 check did not run in full. */
  | 'incomplete-check';

const REMEDY: Readonly<Record<SnapshotRejectionCause, string>> = Object.freeze({
  integrity:
    'The file does not describe a consistent history, or it is not the file the publisher ' +
    'pinned. Check that the download completed, and compare its content hash against the one ' +
    'the publisher lists. If both are right, the publisher shipped a broken snapshot and this ' +
    'is worth telling them.',
  'wrong-chain':
    'This snapshot is about a different chain, so nothing in it describes the network you are ' +
    'connected to. Re-downloading will not help. Look for a snapshot published for this chain ' +
    "— the publisher's page should state which one each file covers.",
  'chain-disagreement':
    'This device re-derived part of the snapshot from the chain itself and got a different ' +
    'answer. That is not a damaged download: the file is internally consistent and disagrees ' +
    'with the chain, which is what a forged snapshot looks like. Do not import it, and do not ' +
    'trust other files from the same publisher without comparing them against a second, ' +
    'unrelated one.',
  'incomplete-check':
    'This device could not finish re-deriving the snapshot from the chain, so the check that ' +
    'would have caught a shallow forgery did not run in full. Nothing here says the file is ' +
    'bad, and nothing says it is good: an unfinished check cannot stand in for a finished one, ' +
    'so the import is refused rather than accepted on partial evidence. Nothing about the ' +
    'publisher is implied — try again when this device has caught up with the chain.',
});

/** `FE-PROV-003`, with the fixed remediation for its cause leading the expert detail. */
export function snapshotRefusal(cause: SnapshotRejectionCause, detail: string): ProviderRefusal {
  return providerRefusal('FE-PROV-003', `${REMEDY[cause]} ${detail}`);
}
