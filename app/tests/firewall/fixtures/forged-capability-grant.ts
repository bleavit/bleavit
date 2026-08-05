// expect-error: TS2741 — the object literal is missing the phantom brand only a grant function can add
// MUST FAIL: INV-FE-12 — an unproven capability is absent, so a claim cannot be written by hand.
//
// The defect this guards: `SignerDescriptor.capabilities` was a `Set` literal the registry
// trusted, so any adapter could name `decoded-payload` or `metadata-hash` and be believed —
// a transport that merely renders full hex could advertise itself as decode-capable while
// doing neither. Grants are now mintable only by the functions that require the machinery.
//
// **Written without an `as` cast, deliberately.** The first version of this fixture used
// `as CapabilityGrant` and COMPILED, which is the property 10 §2.1 already records for
// `Finalized<T>`: a brand stops object literals, and a narrowing assertion is something
// TypeScript permits regardless. So the assertion route is a separate control
// (`check:casts`), and what this fixture proves is the half the brand actually carries.
import { describeSigner, type CapabilityGrant } from '@bleavit/signing';

const forged: CapabilityGrant = { capability: 'decoded-payload', basis: 'proven: trust me' };

export const descriptor = describeSigner({
  id: 'liar',
  label: 'Liar',
  grants: [forged],
  testOnly: false,
});
