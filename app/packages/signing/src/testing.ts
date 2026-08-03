/**
 * `MockSigner` — INV-FE-5, 10 §10.1.
 *
 * **This module must never appear in a release chunk.** Three independent controls say
 * so, and they are independent on purpose, because each is blind to a different mistake:
 *
 *  1. The `exports` map puts it behind `@bleavit/signing/testing`, so importing it is a
 *     deliberate act rather than a slip of auto-import.
 *  2. A dependency-cruiser rule forbids any module outside `tests/` from reaching it —
 *     which catches the deliberate act.
 *  3. `SignerRegistry.register` refuses a `testOnly` descriptor at runtime — the only
 *     control that still works if someone copies this file into their own module, which
 *     neither of the other two can see.
 *
 * It signs deterministically from the payload, so a test can assert *which bytes* were
 * signed. That matters more than it sounds: 11 §11.3's anti-substitution rule is that the
 * confirm summary is decoded from `prep.scaleHex` — the exact bytes to be signed — and a
 * mock that returned a constant signature could not tell a test whether the right bytes
 * ever reached the signer.
 */

import type { HexString } from '@bleavit/shared-types';
import type { SignedPayload, SignerAdapter, SignerDescriptor, SigningRequest } from './adapters.js';

export const MOCK_SIGNER_DESCRIPTOR: SignerDescriptor = Object.freeze({
  id: 'mock',
  label: 'Mock signer (tests only)',
  capabilities: new Set(['decoded-payload', 'hashed-payload', 'metadata-hash'] as const),
  testOnly: true,
});

/** A deterministic, obviously-fake signature derived from the payload. */
function fakeSignature(scaleHex: string, account: string): HexString {
  let hash = 0x811c9dc5;
  for (const ch of `${scaleHex}|${account}`) {
    hash = Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  }
  return `0x${'mock'.split('').map((c) => c.charCodeAt(0).toString(16)).join('')}${hash
    .toString(16)
    .padStart(8, '0')}` as HexString;
}

export class MockSigner implements SignerAdapter {
  readonly descriptor = MOCK_SIGNER_DESCRIPTOR;
  /** Every request this signer was given, so a test can assert on the exact bytes. */
  readonly seen: SigningRequest[] = [];

  async sign(request: SigningRequest): Promise<SignedPayload> {
    this.seen.push(request);
    return {
      signatureHex: fakeSignature(request.prep.scaleHex, request.account),
      signedBy: request.account,
      signerId: this.descriptor.id,
    };
  }
}
