/**
 * S22 — review an imported action (11 §11.14, 10 §13).
 *
 * ## The four required-UX rules of §11.14.4, and how each is made structural
 *
 * 1. *"The **chain-read identity of the action's target** renders alongside the id at
 *    `verified-finalized` status. Id substitution is the sharpest attack this surface
 *    admits, and rendering what the id actually resolves to is what defeats it."* — so
 *    `resolvedTarget` is a **required** prop typed `Verified<string>`, not an optional
 *    nicety. A screen that could not resolve the id has nothing to render here, and that
 *    is a refusal rather than a layout with a gap.
 * 2. *"Every imported value renders with `external-proposal` status wherever it is shown —
 *    including the asked side of the asked-vs-encoded pair."* — so every asked figure goes
 *    through `externalProposal()` and `AskedVsEncoded`, which badges both sides.
 * 3. *"The origin disclosure is **fixed in-bundle copy and non-dismissible**. No format
 *    carries a tool-supplied label."* — so the copy is a constant in this module, the
 *    component takes no label prop at all, and it is rendered through `AlwaysVisible`
 *    (`imported-action-origin` is one of 11 §11.2 constraint 3's five facts, so it also
 *    cannot be moved behind the disclosure).
 * 4. *"Expert mode exposes the full clamp derivation — asked ceiling, chain-derived value
 *    at B′, encoded value."* — `Clamped<T>` already carries all three plus which one bound,
 *    and expert mode renders `boundBy`.
 *
 * ## What this screen does not do
 *
 * *"An imported document **writes nothing at all** — no setting, no default, no preference,
 * and no record that it was ever seen."* This module holds no state, exports no persistence
 * function, and its only outputs are the callbacks its caller supplies. There is
 * deliberately no "recently imported" list: 10 §13.3 says a re-import is simply an import.
 */

import {
  AlwaysVisible,
  AskedVsEncoded,
  Amount,
  BlockRef,
  Button,
  Disclosure,
  Field,
  Identifier,
  Notice,
  Panel,
  Phrase,
  Refusal,
  aboveTheFold,
  type ReactNode,
} from '@bleavit/ui';
import { externalProposal, type Verified } from '@bleavit/shared-types';
import type { Clamped, Intent } from '@bleavit/intents';
import type { HandoffRefusal } from '@bleavit/handoff-envelope';

/**
 * §11.14.4's origin disclosure. Fixed, in-bundle, and unparameterised.
 *
 * There is no prop for a tool name because *"a label reading 'Bleavit Official Assistant'
 * inside the confirm flow would be a phishing primitive"*. The client can say a document
 * came from outside; it cannot say what wrote it, and pretending otherwise would be worse
 * than saying nothing.
 */
const ORIGIN_HEADING = 'This action was proposed by a tool outside Bleavit';
const ORIGIN_BODY =
  'Nothing in the imported file was trusted. Bleavit re-read the chain, recomputed every ' +
  'number, and built the transaction itself — the file chose an action and asked for limits, ' +
  'and limits can only be tightened, never loosened. Read what is below before signing: it is ' +
  'decoded from the bytes that will be signed, not from the file.';

export function OriginDisclosure() {
  return (
    <Notice severity="caution" heading={ORIGIN_HEADING}>
      {ORIGIN_BODY}
    </Notice>
  );
}

/**
 * A clamp bound by an in-bundle policy cap, which no status in the lattice describes.
 *
 * The six statuses of 10 §2.1 cover chain reads at four confidence levels, this device's
 * own index, and a value an external tool requested. A number that came from a **release
 * constant** is none of those: `verified-finalized` claims a chain read that did not
 * happen, and `external-proposal`'s own copy — *"a value an external tool asked for"* — is
 * simply false about it.
 *
 * Labelling it with either would be the specific failure INV-FE-9 exists to prevent, so
 * this refuses instead. Nothing is lost today: the client ships no policy cap, so
 * `boundBy === 'policy'` is unreachable in the current release. It is raised as SQ-592
 * rather than decided here, because adding a seventh status is a 10 §2.1 amendment and
 * therefore an integration-contract question, not a screen's call.
 */
export class UnlabellableClampError extends Error {
  constructor(name: string) {
    super(
      `SQ-592: "${name}" was bound by an in-bundle policy cap, and no VerificationStatus in ` +
        '10 §2.1 describes a value derived from a release constant. Refusing to render it ' +
        'rather than badging it as a chain read or as an external request, both of which ' +
        'would be false. The client ships no policy cap today, so reaching this means one ' +
        'was added before the status question was settled.',
    );
    this.name = 'UnlabellableClampError';
  }
}

/**
 * A clamp whose chain input arrives with the provenance of the reads it came from.
 *
 * `Clamped<bigint>` records three numbers and which one bound, and its `chain` field is a
 * bare `bigint` — the type has no room for where that number came from. This screen used to
 * supply the missing half from a separate `refreshedAt: FinalizedBlockRef` prop and write the
 * status out longhand, which meant the badge was assembled here from two props nothing
 * related: a caller could pass a clamp computed at one block and a pin naming another, and the
 * screen would badge the result `verified-finalized` at the second. Pairing them in one object
 * is what makes that unsayable — there is no longer a pin to pass on its own.
 */
export interface ReviewedClamp {
  readonly clamped: Clamped<bigint>;
  /**
   * The client's own recomputed value at B′, as read. When the client's number is the binding
   * one, this **is** the encoded number, and its badge is this datum's status passed through.
   */
  readonly chain: Verified<bigint>;
}

/** The clamped limits with each chain input's provenance attached — `ClampedLimits` plus that. */
export interface ReviewedLimits {
  readonly maxCost?: ReviewedClamp;
  readonly minProceeds?: ReviewedClamp;
  readonly deadlineBlock: Clamped<number>;
  readonly anyNarrowed: boolean;
}

/**
 * A `ReviewedClamp` whose two halves disagree about the client's own number.
 *
 * The pairing is what carries the provenance, so a datum that is not the clamp's `chain`
 * value is a badge belonging to some other read. Refusing beats rendering: the failure is
 * silent otherwise, and what it produces is a number under a block reference that never
 * described it.
 */
export class ClampProvenanceMismatchError extends Error {
  constructor(name: string, clampChain: bigint, datum: bigint) {
    super(
      `"${name}" was clamped against ${clampChain} but its provenance datum carries ${datum}. ` +
        'The datum is what supplies the badge, so these disagreeing means the badge belongs ' +
        'to a different read than the number it would be shown beside (10 §2.2).',
    );
    this.name = 'ClampProvenanceMismatchError';
  }
}

/**
 * The status of the *encoded* number, derived from which input bound it.
 *
 * The first draft of this screen badged the encoded side `external-proposal`
 * unconditionally, and that is wrong in the common case: when the client's own recomputed
 * value at B′ is the tighter one, the number on screen is the client's, and telling the
 * user an external tool asked for it inverts exactly the provenance the pair exists to
 * show. 10 §2.1 gives the correct answer for that case directly — `verified-finalized` is
 * for values *"computed client-side purely from such values"*.
 *
 * What it does **not** give this screen is permission to write that status out itself. The
 * chain-bound arm now returns the caller's own datum unchanged, so the badge is the one the
 * read carried rather than one assembled here from a value and a pin that arrived separately.
 */
function encodedStatus(reviewed: ReviewedClamp, name: string): Verified<bigint> {
  const { clamped } = reviewed;
  if (clamped.boundBy === 'policy') throw new UnlabellableClampError(name);
  if (clamped.boundBy === 'intent') return externalProposal(clamped.encoded);
  if (reviewed.chain.value !== clamped.chain) {
    throw new ClampProvenanceMismatchError(name, clamped.chain, reviewed.chain.value);
  }
  // `clampCeiling`/`clampFloor` start from the chain value and only overwrite it for `intent`
  // or `policy`, both handled above — so on this arm the encoded number IS the chain number,
  // and the datum that carries its provenance is the one to render.
  return reviewed.chain;
}

function ClampRow({
  reviewed,
  name,
  direction,
  decimals,
  symbol,
  expert,
}: {
  readonly reviewed: ReviewedClamp;
  readonly name: string;
  readonly direction: 'ceiling' | 'floor';
  readonly decimals: number;
  readonly symbol: string;
  readonly expert: boolean;
}) {
  const { clamped } = reviewed;
  const encoded = encodedStatus(reviewed, name);
  return (
    <div className="clamp-row">
      {clamped.asked === undefined ? (
        <Amount
          datum={encoded}
          decimals={decimals}
          symbol={symbol}
          name={`${name} (the client's own; the file asked for none)`}
        />
      ) : (
        <AskedVsEncoded
          asked={externalProposal(clamped.asked)}
          encoded={encoded}
          decimals={decimals}
          symbol={symbol}
          name={name}
          direction={direction}
        />
      )}
      {expert ? (
        <Disclosure summary="How this number was arrived at">
          <Field label="Asked by the file">
            <Phrase
              datum={externalProposal(
                clamped.asked === undefined ? 'nothing stated' : clamped.asked.toString(),
              )}
            />
          </Field>
          <Field label="The client's own value at the refreshed block">
            <Phrase datum={externalProposal(clamped.chain.toString())} />
          </Field>
          <Field label="Encoded">
            <Phrase datum={externalProposal(clamped.encoded.toString())} />
          </Field>
          <Field label="Bound by">
            <Phrase datum={externalProposal(clamped.boundBy)} />
          </Field>
        </Disclosure>
      ) : null}
    </div>
  );
}

export interface ImportReviewProps {
  readonly intent: Intent;
  /**
   * The clamped limits, each carrying its chain input's own provenance (`ReviewedLimits`).
   *
   * There is deliberately no separate `refreshedAt` prop. B′ used to arrive as a bare
   * `FinalizedBlockRef` and this screen combined it with `clamped.encoded` to mint a badge;
   * carrying the pin on the datum instead means the screen has nothing left to combine.
   */
  readonly limits: ReviewedLimits;
  /**
   * What the action's target id resolves to on chain — §11.14.4's substitution defence.
   * Required, and `Verified<T>`, so it carries its own `verified-finalized` badge.
   */
  readonly resolvedTarget: Verified<string>;
  readonly decimals: number;
  readonly symbol: string;
  readonly expert: boolean;
  readonly onBuild: () => void;
  readonly onDiscard: () => void;
}

export function ImportReview({
  intent,
  limits,
  resolvedTarget,
  decimals,
  symbol,
  expert,
  onBuild,
  onDiscard,
}: ImportReviewProps) {
  return (
    <Panel title="Review an imported action">
      <AlwaysVisible fold={aboveTheFold('imported-action-origin', <OriginDisclosure />)} />

      <Field label="Action">
        <Phrase datum={externalProposal(intent.action.kind)} />
      </Field>

      {/* The id as asked, and beside it what the chain says that id actually is. */}
      <Field label="Target">
        {/* The id is a u64; rendered as its canonical decimal, which is the form the
            document carries and the form a reader can compare against the chain. */}
        <Identifier
          datum={externalProposal(intent.action.id.toString())}
          name="as written in the file"
        />
        <Phrase datum={resolvedTarget} name="which on chain is" />
      </Field>

      {limits.maxCost === undefined ? null : (
        <ClampRow
          reviewed={limits.maxCost}
          name="Most you will pay"
          direction="ceiling"
          decimals={decimals}
          symbol={symbol}
          expert={expert}
        />
      )}
      {limits.minProceeds === undefined ? null : (
        <ClampRow
          reviewed={limits.minProceeds}
          name="Least you will receive"
          direction="floor"
          decimals={decimals}
          symbol={symbol}
          expert={expert}
        />
      )}

      <Field label="Valid until block">
        <BlockRef datum={externalProposal(limits.deadlineBlock.encoded)} />
      </Field>

      {limits.anyNarrowed ? (
        <Notice severity="info" heading="One or more limits were tightened">
          Where the file’s limit and the client’s own differ, the tighter one is encoded and both
          are shown above.
        </Notice>
      ) : null}

      <div className="review__actions">
        <Button label="Build the transaction" intent="primary" onClick={onBuild} />
        <Button label="Discard" onClick={onDiscard} />
      </div>
    </Panel>
  );
}

/**
 * The refusal screen.
 *
 * A document that fails admission *"never becomes a transaction at all, and the user sees a
 * `FE-HANDOFF-*` refusal with its fixed copy and stated fix rather than a blocked confirm
 * screen"* (§11.14.1). So this is a different screen, not a state of the one above — a
 * refused document has no target, no limits and nothing to review, and rendering it in the
 * review layout with empty fields would suggest otherwise.
 */
export function ImportRefused({
  refusal,
  onDismiss,
}: {
  readonly refusal: HandoffRefusal;
  readonly onDismiss: () => void;
}) {
  return (
    <Panel title="This file was not accepted">
      <Refusal
        code={refusal.code}
        message={refusal.message}
        recovery={refusal.recovery}
        detail={refusal.detail}
      />
      <Button label="Close" onClick={onDismiss} />
    </Panel>
  );
}

export type { ReactNode };
