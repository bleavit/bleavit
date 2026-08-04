/**
 * The provenance badge — INV-FE-9's visible half (10 §2.1).
 *
 * Six statuses, six fixed in-bundle strings, and **no way to suppress one**. There is no
 * `hideBadge` prop and no status whose badge is empty, because 10 §2.3 states the mitigation
 * for provider-fed data as *"mandatory, non-suppressible provenance labelling"* — a badge
 * with an off switch is the labelling the mitigation says does not exist.
 *
 * The copy is derived from the status by this module and never accepted from a caller. That
 * is the difference between a badge and a decoration: a caller-supplied label lets a screen
 * render a `provider` figure under the word "verified", which is the exact confusion the
 * status lattice exists to prevent, and no test of "the badge renders" would catch it.
 */

import type { VerificationStatus } from '@bleavit/shared-types';

/** What a reader is told, per status. Fixed in-bundle copy (10 §2.3). */
interface BadgeCopy {
  /** The short marker rendered beside the value. */
  readonly mark: string;
  /** The long form, exposed as the accessible name and the tooltip. */
  readonly title: string;
}

function copyFor(status: VerificationStatus): BadgeCopy {
  switch (status.kind) {
    case 'verified-finalized':
      return {
        mark: `finalized #${status.blockNumber}`,
        title: `Read from finalized chain state at block #${status.blockNumber} and verified by this device's light client.`,
      };
    case 'verified-best':
      return {
        mark: `unfinalized #${status.blockNumber}`,
        title: `Read at best block #${status.blockNumber}, which is not yet finalized and can still be reverted. Display only — it satisfies nothing.`,
      };
    case 'derived-local':
      return {
        mark: `local index (${status.coverage.holes.length} gap${status.coverage.holes.length === 1 ? '' : 's'})`,
        title:
          'Computed from this device’s own index of past blocks. Coverage may have gaps, and gaps are not interpolated over.',
      };
    case 'provider':
      return {
        mark: `unverified — ${status.providerId}`,
        title: `Served by the optional provider “${status.providerId}”${status.sampled ? ' and spot-checked against the chain' : ''}. It is not verified and never becomes verified.`,
      };
    case 'stale-cache':
      return {
        mark: `cached, as of #${status.asOfBlock}`,
        title: `Restored from this device’s storage as it stood at block #${status.asOfBlock}. The chain has moved since.`,
      };
    case 'external-proposal':
      return {
        mark: 'requested by an external tool',
        title:
          'A value an external tool asked for. It is not a reading of the chain, it is true at no block, and nothing is decided by it — the client re-reads the chain and narrows it.',
      };
  }
}

/**
 * True where the status is anything other than a verified finalized read.
 *
 * Exposed so the chrome can hatch or tint a whole region; it is not a way to decide
 * *whether* to render a badge.
 */
export function isUnverifiedStatus(status: VerificationStatus): boolean {
  return status.kind !== 'verified-finalized';
}

export function ProvenanceBadge({ status }: { readonly status: VerificationStatus }) {
  const { mark, title } = copyFor(status);
  return (
    <span
      className={`badge badge--${status.kind}`}
      data-status={status.kind}
      title={title}
      aria-label={title}
    >
      {mark}
    </span>
  );
}

/** Exposed for the suite that pins the copy; not part of the render path. */
export const badgeCopyFor = copyFor;
