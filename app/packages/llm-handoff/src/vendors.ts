/**
 * The named-tool-vendor list — in-bundle, auditable, never fetched (10 §13.4; INV-FE-13).
 *
 * 10 §13.4 permits outbound links to named tool vendors and attaches three obligations,
 * all of which are structural here rather than procedural:
 *
 *  1. **The list is in the signed release and auditable — never fetched, never remotely
 *     configured.** So it is a frozen constant in this module, and this package contains
 *     no network primitive at all (`check:handoff-network` gates that, and it is the *only*
 *     mechanical control here: FE-P11 established that a top-level navigation is not a
 *     Fetch, so `connect-src` structurally cannot see one).
 *  2. **A one-time disclosure interstitial names the vendor and states what its logs
 *     learn.** The copy is built from this list and from nothing else — see `disclosure`.
 *  3. **A capsule that does not fit the URL falls back automatically and is never
 *     truncated.** That lives in `transports.ts`; what this module contributes is the only
 *     honest source for the bound (see below).
 *
 * ## The list ships empty, and empty is a posture rather than an absence
 *
 * Naming a vendor is a D-21 decision with a disclosure obligation attached, and no vendor
 * is seated. An empty list is therefore the correct launch state, not a stub — and it has
 * a consequence worth stating plainly, because it is the same conclusion FE-P11 reached
 * from the other direction: with no vendor, **file and clipboard are the entire outbound
 * surface**, which is exactly the conservative posture 10 §12 asks for while
 * `navigator.share({ files })` availability is unproven.
 *
 * ## Why `maxUrlChars` is per-vendor and has no default
 *
 * A URL length limit is not one number. It is the minimum of what the user agent will
 * navigate to, what the OS will hand across, and what the *vendor's own* front end accepts
 * — and only the last is knowable from here, by reading that vendor's published limit. So
 * it is declared per vendor, in this auditable list, and a vendor that does not declare one
 * simply **has no URL transport**: R-2 forbids resolving it by assumption, and guessing
 * high is how a capsule gets silently cut in half by something downstream.
 */

export interface ToolVendor {
  /** Stable id used by callers. Never rendered — the label below is what a user sees. */
  readonly id: string;
  /** In-bundle display name. No format carries a tool label (10 §13.4), so this is the only source. */
  readonly label: string;
  /** Origin the link navigates to. A top-level navigation, never a fetch. */
  readonly origin: string;
  /**
   * The vendor's published maximum URL length in characters.
   *
   * Absent means *not established*, which disables this vendor's URL transport rather than
   * selecting a default. There is no safe default here for the same reason §13.2 gives for
   * limits: guessing produces a document that looks whole and is not.
   */
  readonly maxUrlChars?: number;
}

/**
 * The vendors this release names. **Empty by design** — see the module note.
 *
 * A test asserts the emptiness, so the day a vendor is seated the suite says so and the
 * disclosure obligations get reviewed rather than inherited.
 */
export const TOOL_VENDORS: readonly ToolVendor[] = [];

export function vendorById(id: string): ToolVendor | undefined {
  return TOOL_VENDORS.find((vendor) => vendor.id === id);
}

/**
 * The one-time disclosure interstitial copy (10 §13.4).
 *
 * **Built from the in-bundle list and from nothing the document supplies.** 10 §13.4 is
 * explicit that no format carries a tool label, *"because a label reading 'Bleavit Official
 * Assistant' inside the confirm flow would be a phishing primitive"*. This function
 * therefore takes an **id**, not a name: a caller holding an attacker-supplied string can
 * at most fail to find a vendor, never render one.
 *
 * Returns `undefined` for an unknown id rather than falling back to the id itself, which
 * would put attacker-chosen text on screen through the back door.
 */
export function disclosure(vendorId: string): string | undefined {
  const vendor = vendorById(vendorId);
  if (vendor === undefined) return undefined;
  return (
    `This opens ${vendor.label} at ${vendor.origin} in a new tab and passes the file you ` +
    'just reviewed. That service receives its full contents and may retain them in its ' +
    'logs. Bleavit sends nothing itself and learns nothing about what you do there — and ' +
    'once sent, it cannot be un-sent.'
  );
}
