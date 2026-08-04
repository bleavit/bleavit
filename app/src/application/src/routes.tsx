/**
 * The hash-route outlet — which screen renders, and which do not exist yet.
 *
 * ## Why "not built yet" is a declared state rather than a 404
 *
 * 11 §11.2 constraint 1 requires every screen in the inventory to be present, reachable and
 * complete **in the release**. Track F is not there yet: S3/S4 land with the trading and
 * position work, S9–S11 with FE-14, S14–S19 with FE-15, S12/S13 with the funding flow. A
 * navigation that links to them today would link to nothing.
 *
 * The choice is between hiding those links and rendering an honest placeholder. Hiding
 * them is worse in a specific way: it makes the gap invisible, and the release that finally
 * ships would have no mechanical record of which screens were never built. So the outlet
 * renders a placeholder that **names the owning milestone**, and `PENDING_SCREENS` is a
 * declared set that `app/tests/screens` counts — a screen quietly dropped from the client
 * fails that count rather than being mistaken for one that is merely pending.
 *
 * The set shrinks to empty as Track F closes. When it is empty this file's placeholder
 * branch is dead, and that is the intended end state rather than a wart to remove.
 */

import { Notice, Panel, type ReactNode } from '@bleavit/ui';
import { SCREENS, type Screen } from './screens.js';

/**
 * Screens whose implementation is a later milestone, each with the milestone that owns it.
 *
 * Read off PLAN.md's Track F rows. Kept here rather than in `screens.ts` because the
 * inventory is a statement about the *specification* and this is a statement about *this
 * build* — conflating them would make a screen's existence depend on whether it happened
 * to be implemented, which is the direction 11 §11.2 constraint 1 forbids.
 */
export const PENDING_SCREENS: Readonly<Record<string, string>> = Object.freeze({
  S3: 'F7b — market trading, once the decision dashboard lands',
  S4: 'F7b — positions and redemption, both ledger domains',
  S5: 'F7b — proposal submission',
  S6: 'F7b — the execution queue',
  S7: 'F7b — the welfare and constitution dashboard',
  S8: 'F7b — recent settlements',
  S9: 'F16 — the governance surface',
  S10: 'F16 — vote, delegate, unlock',
  S11: 'F16 — the OracleResolution ballot',
  S12: 'F18 — the Asset Hub deposit leg',
  S13: 'F18 — the withdraw leg',
  S14: 'F17 — the reporter console',
  S15: 'F17 — the guardian console',
  S16: 'F17 — treasury stream claims',
  S17: 'F17 — the upgrade crank',
  S18: 'F17 — the welfare snapshot crank',
  S19: 'F17 — the incident and milestone registry',
  S20: 'F7b — balances and funding status',
});

/** Resolve a hash to a screen, falling back to the front door rather than to nothing. */
export function screenFor(hash: string, handoffEnabled: boolean): Screen {
  const match = SCREENS.find((screen) => screen.path === hash);
  if (match !== undefined) return match;
  const fallback = SCREENS.find((screen) => screen.id === (handoffEnabled ? 'S21' : 'S2'));
  // `SCREENS` is a frozen non-empty literal containing both ids, so this cannot be
  // undefined — but throwing beats a non-null assertion, which would be a claim the
  // reader has to verify by scrolling to another file.
  if (fallback === undefined) throw new Error('the screen inventory has no front door');
  return fallback;
}

/**
 * What renders for a screen this build does not implement.
 *
 * It says which milestone owns it, because the alternative — "coming soon" — tells a user
 * nothing and tells a developer nothing either.
 */
export function PendingScreen({ screen }: { readonly screen: Screen }) {
  const owner = PENDING_SCREENS[screen.id];
  return (
    <Panel title={screen.title}>
      <Notice severity="info" heading="This screen is not in this build">
        {owner === undefined
          ? 'It is part of the canonical client and has not been built yet.'
          : `It is part of the canonical client and lands with ${owner}.`}{' '}
        Nothing here is a chain reading, and no action on this screen is available.
      </Notice>
    </Panel>
  );
}

/**
 * Render the screen for a hash.
 *
 * `implemented` is supplied by the caller rather than imported, because the screens live in
 * three separate compilation units (10 §10.2) and this file may not reach across them — a
 * map built at the composition root is how the units stay unable to see each other.
 */
export function Outlet({
  hash,
  handoffEnabled,
  implemented,
}: {
  readonly hash: string;
  readonly handoffEnabled: boolean;
  readonly implemented: Readonly<Record<string, () => ReactNode>>;
}): ReactNode {
  const screen = screenFor(hash, handoffEnabled);
  const render = implemented[screen.id];
  return render === undefined ? <PendingScreen screen={screen} /> : render();
}
