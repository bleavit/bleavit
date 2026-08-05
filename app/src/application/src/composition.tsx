/**
 * The composition root — where the three compilation units meet, and nowhere else.
 *
 * 10 §10.2 keeps `tx`, `analysis` and `handoff` unable to see each other, so something has
 * to assemble them. That something is here: a map from screen id to a renderer, built at
 * the top level, handed to `Outlet`. `routes.tsx` takes the map as a **parameter** rather
 * than importing screens itself, which is what lets one outlet render either unit's screens
 * while the units stay mutually invisible.
 *
 * ## Why this file is a list of adapters and not much else
 *
 * Every screen here needs data this build does not yet fetch — the read layer exists for S1
 * and S2 (`chain-reads.ts`, `proposal-reads.ts`) and not for the rest. So the honest thing,
 * and what this file does, is **register only the screens that can render truthfully right
 * now** and let `Outlet` show the rest as `PendingScreen` with the milestone that owns them.
 *
 * The alternative — registering every screen against placeholder data — would produce an
 * app that looks finished and shows invented numbers, which is the failure INV-FE-9 and
 * every provenance rule in this client exist to prevent. A screen with no data is not a
 * screen that should be rendered with fake data; it is a screen whose milestone is not done.
 *
 * `app/tests/screens` asserts both directions: every id registered here is a real screen,
 * and every id **not** registered is declared in `PENDING_SCREENS` with its owner. So a
 * screen cannot fall between the two and silently disappear.
 */

import type { ReactNode } from '@bleavit/ui';
import { PENDING_SCREENS } from './routes.js';
import { INVENTORY_IDS } from './screens.js';

/**
 * The screens this build renders with real data.
 *
 * Empty of everything whose read layer is still a later milestone. Growing this map is what
 * closing F7b, F16, F17 and F18 looks like from here.
 */
export function implementedScreens(): Readonly<Record<string, () => ReactNode>> {
  // Deliberately empty at present: S1 renders as the shell's own header rather than through
  // the outlet, and S2's list needs a reader wired to a live transport (F7's named
  // remainder). Every other screen is in `PENDING_SCREENS` with the milestone that owns it.
  //
  // This is a statement about *this build*, not about the inventory — which is why it is a
  // function in the composition root and not a field on the screen table.
  return {};
}

/**
 * Every inventory screen is either implemented or declared pending — never neither.
 *
 * Exported so the suite can assert it rather than re-deriving the rule. The failure it
 * prevents is a screen that is absent from both maps: `Outlet` would render it as pending
 * with no owner named, which reads as *"coming soon"* forever and is exactly how a dropped
 * screen hides.
 */
export function unaccountedScreens(): readonly string[] {
  const implemented = new Set(Object.keys(implementedScreens()));
  return INVENTORY_IDS.filter(
    (id) => !implemented.has(id) && !(id in PENDING_SCREENS) && id !== 'S1',
  );
}
