// expect-error: TS2741 — 11 §11.3 anti-substitution: the summary comes from the bytes, and the brand is what says so
// MUST FAIL: `DecodedCall` carries a module-private brand and `decodeForConfirm` is its
// only producer. An object literal assembled out of whatever the user typed into the form
// is exactly what the anti-substitution rule forbids the confirm screen from displaying,
// and without the brand it would be indistinguishable from a real decode.
//
// The declared code names the *brand* specifically (TS2741, "Property '[DECODED_FROM_BYTES]'
// is missing"), not a generic shape mismatch. That matters: a literal that happened to
// match every visible field would still fail, and this expectation says which property is
// doing the work.
import type { DecodedCall } from '@bleavit/features-tx';

const formState = { pallet: 'Market', call: 'buy', args: [], fromHex: '0x00' } as const;
export const summary: DecodedCall = formState;
