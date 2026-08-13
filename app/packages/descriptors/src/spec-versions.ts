/**
 * The `spec_version` → descriptor-set map — 10 §5.1.
 *
 * Descriptors are committed **per `spec_version`**, and a primary runtime is not eligible
 * until its exact paired terminal-recovery runtime has published descriptors too (10 §5.1,
 * B16): recovery can become current under `OnlyInherents`, so treating its descriptors as
 * operator-only strands the canonical frontend during exactly the incident they exist for.
 * Both are therefore live-capable entries here, not a primary plus a footnote.
 *
 * The numbers are not literals in the 10 §5.4 sense — they are the *identity* of the
 * artifacts committed under `app/fixtures/chain-feed/<spec_version>/`, and
 * `pnpm -C app run surface:check` asserts this table equals what the feed actually
 * contains. A hand-edited entry here that the feed does not back is a build failure, not a
 * runtime surprise.
 */

/** Which of a paired release a runtime is. Recovery is terminal (09 §5.2). */
export type RuntimeRole = 'primary' | 'recovery';

export interface SupportedRuntime {
  readonly specVersion: number;
  readonly specName: string;
  readonly role: RuntimeRole;
  readonly profile: string;
  /** The descriptor export name in `@bleavit/papi-descriptors`. */
  readonly descriptorKey: 'bleavit' | 'bleavit_recovery';
  readonly integrationContractVersion: number;
  readonly metadataSha256: string;
}

export const SUPPORTED_RUNTIMES: readonly SupportedRuntime[] = [
  {
    specVersion: 2,
    specName: 'bleavit',
    role: 'primary',
    profile: 'bootstrap',
    descriptorKey: 'bleavit',
    integrationContractVersion: 31,
    metadataSha256: '5828c99fc32743717a5d11a630c317ca21ac26bf085203e0c5d02d2fc78cd6c7',
  },
  {
    specVersion: 3,
    specName: 'bleavit',
    role: 'recovery',
    profile: 'bootstrap-recovery',
    descriptorKey: 'bleavit_recovery',
    integrationContractVersion: 31,
    metadataSha256: '0f36a82b23cf197a3eb21d67485a79ac44a875a634cab559764e24d226b7e4c2',
  },
];

export const SUPPORTED_SPEC_VERSIONS: readonly number[] = SUPPORTED_RUNTIMES.map((r) => r.specVersion);

export function runtimeFor(specVersion: number): SupportedRuntime | undefined {
  return SUPPORTED_RUNTIMES.find((r) => r.specVersion === specVersion);
}

/**
 * The paired runtime of a release — 10 §5.1's eligibility rule expressed as a lookup.
 *
 * Returns `undefined` only if the pairing is broken, which `surface:check` refuses to let
 * happen: half a pair reads as a complete descriptor set to any consumer that asks about
 * one version.
 */
export function pairedRuntime(specVersion: number): SupportedRuntime | undefined {
  const self = runtimeFor(specVersion);
  if (self === undefined) return undefined;
  return SUPPORTED_RUNTIMES.find((r) => r.specName === self.specName && r.role !== self.role);
}
