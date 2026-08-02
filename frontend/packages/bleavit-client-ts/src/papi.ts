import type { PapiBridge } from "./types.js";

/**
 * A generated PAPI descriptor adapter has exactly the same shape as the
 * bridge consumed by the facade. Keeping this named constructor makes the
 * trust boundary explicit without importing a generated runtime descriptor
 * into this dependency-light package.
 */
export function createPapiBridge<Signer, TxResult>(
  generated: PapiBridge<Signer, TxResult>,
): PapiBridge<Signer, TxResult> {
  return generated;
}
