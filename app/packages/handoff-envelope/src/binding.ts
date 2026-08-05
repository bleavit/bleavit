/**
 * The chain binding every handoff format carries — 10 §13.1.
 *
 * *"Every format carries a chain binding — genesis hash, `spec_version`, and
 * `INTEGRATION_CONTRACT_VERSION` — and every inbound document is gated on it by exact
 * equality."*
 *
 * It lives here for the same reason `canonicalJson` and `digestPreimage` do: §13.1 states
 * it **once, for all three formats**, so a second declaration is a second answer to the
 * question of what a binding *is*. The subtlety is that this type's two copies would never
 * meet — `intents` is inbound and `contexts`/`receipts` are outbound, and no call site
 * takes both — so a drift between them is invisible to the compiler. An outbound capsule
 * that grew a fourth binding field the inbound gate did not know to compare would export
 * a stronger claim than any importer checks, silently.
 *
 * `equalBinding` is here and not in `intents` because the comparison is the *convention*;
 * what stays inbound is the **refusal** it feeds (`FE-HANDOFF-005`), which is a property of
 * the parser rather than of the envelope.
 */

/** Genesis hash, `spec_version`, `INTEGRATION_CONTRACT_VERSION` — 10 §13.1. */
export interface ChainBinding {
  readonly genesisHash: string;
  readonly specVersion: number;
  readonly contractVersion: number;
}

/**
 * Exact equality over all three fields, as 10 §13.1 requires.
 *
 * Field-by-field rather than a canonical-JSON string compare: the string form would also
 * report *unequal* for two bindings that differ only in a field this type does not
 * declare, which sounds stricter and is worse — it turns an unknown extra field into a
 * chain mismatch, and `FE-HANDOFF-005` tells the user they are on the wrong chain when
 * they are not.
 */
export function equalBinding(a: ChainBinding, b: ChainBinding): boolean {
  return (
    a.genesisHash === b.genesisHash &&
    a.specVersion === b.specVersion &&
    a.contractVersion === b.contractVersion
  );
}
