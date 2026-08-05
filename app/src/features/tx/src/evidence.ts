/**
 * Content-addressed evidence — 11 §11.8.1's evidence rules, used across the operator surface.
 *
 * > the console fetches from the operator-funded evidence hosting ([12], D-16) and any
 * > user-supplied gateway, **re-hashes the received bytes and compares to `evidence_hash`
 * > before rendering**; mismatch or unavailability renders as "evidence unretrievable —
 * > treated as absent by the protocol" ([07]), never as silent omission. Evidence bytes are
 * > rendered as text/structured data only, never HTML.
 *
 * Three separate controls live in that paragraph, and each fails in its own way.
 *
 * ## 1. The bytes are re-hashed, and the hash function is a required argument
 *
 * The whole point of a content address is that the channel serving it does not have to be
 * trusted — an evidence gateway is an arbitrary host, in the one place a dispute is being
 * decided. `admitEvidence` therefore takes `computeHash` as a **required** parameter, not an
 * optional one: an optional hash function is a digest check that defaults off, which is
 * exactly how `FE-HANDOFF-010` shipped defined and unreachable. There is no code path in
 * this module that produces admitted evidence without hashing.
 *
 * ## 2. Unavailable and mismatched are *stated*, never silently omitted
 *
 * "never as silent omission" — because absent evidence means something specific here: 07
 * treats it as **absent for adjudication**. A screen that rendered nothing would let a
 * reader conclude the filing had no evidence, when what happened is that this device could
 * not obtain it. Those are different facts and the second is actionable (try another
 * gateway); the union's arms keep them apart.
 *
 * ## 3. Rendered as text, never as markup
 *
 * Evidence is bytes an adversary chose, displayed inside a console operated by the system's
 * most privileged actors. `AdmittedEvidence` therefore carries a **string**, decoded as
 * UTF-8 with replacement characters, and nothing in this package hands it to a markup sink.
 * That last part is a property of the *whole app* rather than of one type, so it is checked
 * as one: `check:no-html-sinks` fails on `dangerouslySetInnerHTML`, `innerHTML` and
 * `outerHTML` anywhere in app source. A type cannot stop a screen calling those; a gate can.
 */

import type { Verified } from '@bleavit/shared-types';

/** Fixed copy — 07's own reading of what unobtainable evidence means for adjudication. */
export const EVIDENCE_UNRETRIEVABLE =
  'Evidence unretrievable — treated as absent by the protocol. This is what this device ' +
  'could obtain, not a statement about what was filed: the protocol adjudicates on evidence ' +
  'nobody can fetch as though there were none.';

export type EvidenceState =
  | {
      readonly kind: 'admitted';
      /** UTF-8 text. Never markup — see the module note and `check:no-html-sinks`. */
      readonly text: string;
      readonly hash: string;
      readonly byteLength: number;
    }
  | {
      /** Bytes arrived and hashed to something else. The gateway served the wrong document. */
      readonly kind: 'hash-mismatch';
      readonly expected: string;
      readonly computed: string;
    }
  /** Nothing arrived from any source tried. Distinct from a mismatch, and from "none filed". */
  | { readonly kind: 'unavailable'; readonly triedSources: number };

/**
 * Re-hash received bytes against the on-chain `evidence_hash` and admit them only on a match.
 *
 * `computeHash` is required. Callers supply the same BLAKE2b-256 the chain uses; there is no
 * default, because a default would let a caller omit it and get an unchecked admission.
 */
export function admitEvidence(
  bytes: Uint8Array,
  evidenceHash: Verified<string>,
  computeHash: (bytes: Uint8Array) => string,
): EvidenceState {
  const computed = computeHash(bytes);
  if (computed !== evidenceHash.value) {
    return { kind: 'hash-mismatch', expected: evidenceHash.value, computed };
  }
  // `fatal: false` on purpose: evidence is adversary-chosen bytes, and refusing to display a
  // document because one byte is not valid UTF-8 would hand a filer a way to make their own
  // evidence unreadable while still hashing correctly. Replacement characters are visible;
  // a blank panel is not.
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  return { kind: 'admitted', text, hash: computed, byteLength: bytes.byteLength };
}

/** Nothing could be fetched. Carries how many sources were tried, so "one gateway" is visible. */
export function evidenceUnavailable(triedSources: number): EvidenceState {
  return { kind: 'unavailable', triedSources };
}

/** What the console says for each state. The two failure arms are deliberately distinct. */
export function evidenceCopy(state: EvidenceState): string | undefined {
  switch (state.kind) {
    case 'admitted':
      return undefined;
    case 'unavailable':
      return `${EVIDENCE_UNRETRIEVABLE} Sources tried: ${state.triedSources}.`;
    case 'hash-mismatch':
      return (
        `${EVIDENCE_UNRETRIEVABLE} What arrived does not match the hash recorded on chain ` +
        `(recorded ${state.expected}, received ${state.computed}), so it is not this filing’s ` +
        'evidence — whatever else it may be. Trying a different gateway may retrieve the real ' +
        'document; this one served something else.'
      );
  }
}
