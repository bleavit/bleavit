/**
 * The label 10 §5.2's foreign classifier matches a release pin on — F18.
 *
 * Its own module, and small, because both drill drivers need it and only one of them may pay
 * for `@polkadot-api/descriptors`: the boot leg starts a light client and classifies a runtime,
 * and loading the funding driver's descriptor graph to reach one string would put a multi-second
 * import in front of a leg that has nothing to do with funding.
 */

import { FOREIGN_CHAIN_PINS } from '@bleavit/descriptors';

export class ForeignLabelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForeignLabelError';
  }
}

/**
 * The pinned Asset Hub's label — **not** the connected spec's id.
 *
 * This is a correction rather than a preference. `classifyForeign` finds its pin with
 * `pins.find((p) => p.label === observation.chainLabel)`, and a label naming no pin returns
 * `unreachable`: *"this release pins no `<label>` runtime, so nothing here can be verified
 * against it"*. `boot.ts` passed `document.assetHub.pinned.id`, which on a development topology
 * is `asset-hub-paseo-local` and matches no pin — so a chain that had attached, synced and
 * answered its genesis probe was reported as **unreachable**, and the `wrong-chain` verdict
 * that is the true one for a chain the release does not pin never appeared. The two are acted
 * on differently: `unreachable` is retryable and `wrong-chain` is terminal, so the wrong one
 * invites a retry that cannot succeed.
 *
 * Taken from the pin list because that is where the label lives. 02 §7.7 pins **the** Asset Hub
 * of the relay a release targets — one per release — so the refusal below is where a release
 * pinning several would have to say which one the funding flow means, rather than silently
 * classifying against whichever came first.
 */
export function assetHubLabel(
  pins: readonly { readonly label: string }[] = FOREIGN_CHAIN_PINS,
): string {
  const only = pins.length === 1 ? pins[0] : undefined;
  if (only === undefined) {
    throw new ForeignLabelError(
      `this release pins ${pins.length} foreign chains; 02 §7.7 pins the Asset Hub of the relay ` +
        'a release targets, so the funding flow cannot tell which one it is meant to read',
    );
  }
  return only.label;
}
