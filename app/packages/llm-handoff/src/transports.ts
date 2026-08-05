/**
 * Handoff transports — files, clipboard, share sheet, vendor URL (10 §13.4; D-21).
 *
 * The transport is the user agent and the operating system. This module contains **no
 * network primitive**, and that is not a style choice: 10 §13 states that *"the client
 * makes no network request on any handoff path"*, and FE-P11 established that CSP fetch
 * directives are enforced at exactly one hook — step 2.4 of Main Fetch — so a capability
 * that never enters Fetch cannot be governed by `connect-src` at all. Share, Clipboard and
 * File System Access are all such capabilities. `check:handoff-network` is therefore the
 * *only* mechanical control over egress here, which is why every platform capability
 * arrives **injected** rather than reached for.
 *
 * ## The rule this module exists for: never truncated
 *
 * 10 §13.4: *"because URL length is bounded, a capsule that does not fit **falls back to
 * clipboard or file automatically and is never truncated**."*
 *
 * A truncated capsule is the worst possible artifact this subsystem could produce. It is
 * still valid JSON up to the cut, still carries a `schema` string, and still looks like a
 * document — so a tool reads it, answers about the half it received, and the user acts on
 * an analysis of data that was silently amputated. Nothing downstream can detect it: the
 * digest is over the whole document, so a truncated capsule simply fails the digest check
 * *if anyone re-imports it*, and nobody re-imports a capsule they pasted into an assistant.
 *
 * So truncation is made **unreachable rather than avoided**. `chooseTransport` returns a
 * discriminated union, and the URL variant is the only one carrying a URL — there is no
 * exported function that takes a capsule and returns a URL string, which is the shape a
 * caller would have to have in order to cut one down. The fallback is chosen *before* a URL
 * is built, from the capsule's own length.
 *
 * ## Capabilities are a fail-closed lattice (INV-FE-12)
 *
 * An unproven capability is **absent**, and absence disables the dependent surface with a
 * named reason. `navigator.share({ files })` availability across the browser/OS matrix is
 * FE-P11's unresolved half, so `share` is never assumed and 10 §12's conservative posture
 * — clipboard and file primary, Share a fallback — is what the ordering below encodes.
 */

import { TOOL_VENDORS, type ToolVendor } from './vendors.js';

/** The four 10 §13.4 transports. Ordered by 10 §12's conservative posture, not by preference. */
export const TRANSPORTS = Object.freeze(['file', 'clipboard', 'share', 'vendor-url'] as const);

export type Transport = (typeof TRANSPORTS)[number];

/**
 * What the platform has been **proven** to support.
 *
 * Every field is required. An optional capability flag defaults to *absent* in the readable
 * direction and to *present* in the direction that matters — a caller who forgets one gets
 * a type error instead of a surface that offers a transport nobody established.
 */
export interface TransportCapabilities {
  /** `<a download>` / File System Access. */
  readonly file: boolean;
  /** The async Clipboard API. */
  readonly clipboard: boolean;
  /** `navigator.share({ files })`. FE-P11 — never assumed. */
  readonly share: boolean;
}

export type TransportChoice =
  | { readonly kind: 'file' }
  | { readonly kind: 'clipboard' }
  | { readonly kind: 'share' }
  | { readonly kind: 'vendor-url'; readonly url: string; readonly vendor: ToolVendor }
  | { readonly kind: 'unavailable'; readonly reason: string };

export class TransportError extends Error {}

/**
 * Build the vendor URL, or return the reason it cannot be built.
 *
 * Separate from `chooseTransport` so the length decision has exactly one home, and internal
 * so no caller can obtain a URL without going through the fallback logic.
 */
function vendorUrl(vendor: ToolVendor, capsule: string): { url: string } | { reason: string } {
  if (vendor.maxUrlChars === undefined) {
    return {
      reason:
        `${vendor.label} publishes no URL length limit, so this release cannot prove a capsule ` +
        'would arrive whole. Sent by file or clipboard instead.',
    };
  }
  // Built once, measured whole. Measuring the capsule alone would ignore the origin, the
  // path and the percent-encoding expansion — and percent-encoding is not a rounding error:
  // a capsule of JSON punctuation can triple in length.
  const url = `${vendor.origin}?q=${encodeURIComponent(capsule)}`;
  if (url.length > vendor.maxUrlChars) {
    return {
      reason:
        `This capsule is ${url.length} characters once encoded and ${vendor.label} accepts ` +
        `${vendor.maxUrlChars}. Sent by file or clipboard instead — it is never shortened to fit.`,
    };
  }
  return { url };
}

/**
 * Choose a transport for a capsule.
 *
 * The order is 10 §12's conservative posture and is deliberate: a **requested** vendor URL
 * is tried first because it is what the user asked for, but it falls back rather than
 * failing; then file, then clipboard, then share. Share is last because FE-P11 has not
 * established it, not because it is worse — an unproven capability is absent (INV-FE-12),
 * and a caller that reports `share: true` has proven it for that platform.
 *
 * `capsule` is the already-serialized document. This function never serializes, never
 * re-encodes and never shortens: its whole job is to decide *how* the bytes leave, and the
 * bytes it is handed are the bytes that leave.
 *
 * `vendors` defaults to the shipped list and is injectable **only so the fallback logic can
 * be exercised**: the shipped list is empty by design, so without injection every vendor
 * path here would be dead code tested by nothing. Injecting it does not widen anything a
 * release can do — `TOOL_VENDORS` is what the application passes, and it is a frozen
 * constant in the signed bundle (10 §13.4).
 */
export function chooseTransport(
  capsule: string,
  capabilities: TransportCapabilities,
  requestedVendorId?: string,
  vendors: readonly ToolVendor[] = TOOL_VENDORS,
): TransportChoice {
  if (capsule.length === 0) {
    // An empty capsule is a caller defect, not a transport question. Sending it would put
    // a zero-byte file in front of a user as though an export had succeeded.
    throw new TransportError('refusing to choose a transport for an empty capsule');
  }

  const fallbacks: TransportChoice[] = [];
  if (capabilities.file) fallbacks.push({ kind: 'file' });
  if (capabilities.clipboard) fallbacks.push({ kind: 'clipboard' });
  if (capabilities.share) fallbacks.push({ kind: 'share' });

  if (requestedVendorId !== undefined) {
    const vendor = vendors.find((candidate) => candidate.id === requestedVendorId);
    if (vendor === undefined) {
      return {
        kind: 'unavailable',
        reason:
          'That tool is not one this release names. The vendor list ships in the signed ' +
          'release and is never fetched, so an unknown one cannot be added at runtime (10 §13.4).',
      };
    }
    const built = vendorUrl(vendor, capsule);
    if ('url' in built) return { kind: 'vendor-url', url: built.url, vendor };
    const fallback = fallbacks[0];
    if (fallback === undefined) {
      return { kind: 'unavailable', reason: `${built.reason} No other transport is available.` };
    }
    return fallback;
  }

  const chosen = fallbacks[0];
  if (chosen === undefined) {
    return {
      kind: 'unavailable',
      reason:
        'No transport is available on this platform: files, the clipboard and the share ' +
        'sheet were each unproven, and an unproven capability is treated as absent (INV-FE-12).',
    };
  }
  return chosen;
}

/**
 * The file name for a capsule export.
 *
 * Derived from the schema and the block height, never from anything a document supplied.
 * A capsule is outbound so there is no attacker string in play today — but a file name is
 * rendered by the OS, and building the habit here costs nothing.
 */
export function capsuleFileName(schema: string, blockNumber: number): string {
  if (!/^bleavit\.[a-z]+\.v[0-9]+$/.test(schema)) {
    throw new TransportError(`refusing to build a file name from an unrecognized schema "${schema}"`);
  }
  if (!Number.isSafeInteger(blockNumber) || blockNumber < 0) {
    throw new TransportError('a capsule file name needs a real block height');
  }
  return `${schema.replaceAll('.', '-')}-${blockNumber}.json`;
}
