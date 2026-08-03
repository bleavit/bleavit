// MUST FAIL: the whole point of 10 §2.1's brand.
// This is the exact defect an earlier draft of the spec shipped — a structural
// intersection over `status.kind` that any object literal satisfies. With the
// phantom `unique symbol` in the type, this literal is missing a field it cannot
// name, so it cannot typecheck outside `@bleavit/chain-client`.
import type { Finalized } from '@bleavit/chain-client';

export const forged: Finalized<number> = {
  value: 1,
  status: { kind: 'verified-finalized', blockHash: '0xdead', blockNumber: 1 },
};
