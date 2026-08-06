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
 * Screens this build does not yet *reach*, each with the milestone that will change that.
 *
 * Read off PLAN.md's Track F rows. Kept here rather than in `screens.ts` because the
 * inventory is a statement about the *specification* and this is a statement about *this
 * build* — conflating them would make a screen's existence depend on whether it happened
 * to be implemented, which is the direction 11 §11.2 constraint 1 forbids.
 *
 * ## Two reasons, and they are a closed union rather than prose
 *
 * *Not built* and *built but unwired* need different work, and a reader who cannot tell
 * them apart will do the wrong one. `unaccountedScreens()` found three screens in neither
 * map — which renders as *"coming soon"* with no owner — and the fix was to name the reason.
 *
 * Prose could not hold it. Within a day of that fix, nine entries still read *"F16 — the
 * governance surface"* and *"F17 — the reporter console"* for screens that had since been
 * **built**, because nothing made the claim answerable. So each entry now carries the
 * **component it is waiting on**, and the suite checks that name against the feature
 * packages' real exports **in both directions**:
 *
 * - a `built-unwired` entry whose component does not exist is a false promise;
 * - a `not-built` entry whose component *does* exist is this exact staleness, and it now
 *   **fails the build the moment the component lands**.
 *
 * That second direction is the whole point. It is the same mechanical expiry the monitoring
 * seams and the limit-coverage registry use: a declaration that cannot outlive the condition
 * it describes.
 */
export type PendingScreen =
  | {
      readonly state: 'not-built';
      readonly milestone: string;
      /** The component this screen will export. Asserted **absent** until it is built. */
      readonly component: string;
    }
  | {
      readonly state: 'built-unwired';
      readonly milestone: string;
      /** An existing export. Asserted **present**, so the claim cannot be a false promise. */
      readonly component: string;
      readonly waitingOn: string;
    };

const TX = '@bleavit/features-tx';
const HANDOFF = '@bleavit/features-handoff';

export const PENDING_SCREENS: Readonly<Record<string, PendingScreen>> = Object.freeze({
  S2: { state: 'built-unwired', milestone: 'F7', component: `${TX}#ProposalDetail`, waitingOn: 'a live transport for its reader' },
  S3: { state: 'not-built', milestone: 'F7b', component: `${TX}#MarketTrade` },
  S4: { state: 'not-built', milestone: 'F7b', component: `${TX}#Positions` },
  S5: { state: 'built-unwired', milestone: 'F7b', component: `${TX}#SubmitProposal`, waitingOn: 'a live transport for its reader, and a chain surface for the per-funder intake rate limit' },
  S6: { state: 'built-unwired', milestone: 'F7b', component: `${TX}#ExecutionQueue`, waitingOn: 'a live transport for its reader and a signer session' },
  S7: { state: 'built-unwired', milestone: 'F7b', component: `${TX}#WelfareDashboard`, waitingOn: 'a live transport for its reader' },
  S8: { state: 'built-unwired', milestone: 'F7b', component: `${TX}#RecentSettlements`, waitingOn: 'a live transport for its reader' },
  S9: { state: 'built-unwired', milestone: 'F16', component: `${TX}#ReferendaList`, waitingOn: 'a live transport for its reader' },
  S10: { state: 'built-unwired', milestone: 'F16', component: `${TX}#VoteForm`, waitingOn: 'a live transport and a signer session' },
  S11: { state: 'built-unwired', milestone: 'F16', component: `${TX}#OracleResolutionBallot`, waitingOn: 'a live transport and a signer session' },
  // The Asset Hub connection they were waiting on exists (F18, `assetHubConnector`). What
  // is left is the same thing S2 and S9–S11 wait on — a reader over a live transport — with
  // the wrinkle that deposit needs **two**, one per chain, and withdraw needs only the local
  // one. That asymmetry is 02 §7.7's and is why the two are listed apart rather than together.
  S12: { state: 'built-unwired', milestone: 'F18', component: `${TX}#DepositForm`, waitingOn: 'readers over live transports on both this chain and Asset Hub' },
  S13: { state: 'built-unwired', milestone: 'F18', component: `${TX}#WithdrawForm`, waitingOn: 'a live transport for its reader' },
  S14: { state: 'built-unwired', milestone: 'F17', component: `${TX}#RegisterReporter`, waitingOn: 'a live transport and a signer session' },
  S15: { state: 'built-unwired', milestone: 'F17', component: `${TX}#PendingActions`, waitingOn: 'a live transport and a signer session' },
  S16: { state: 'built-unwired', milestone: 'F17', component: `${TX}#TreasuryStreams`, waitingOn: 'a live transport and a signer session' },
  // FE-P10 gates the **submit control**, not the screen. §11.8.4's own fallback says steps
  // 1–3 — read the authorization, fetch the artifact, hash-verify it — ship regardless,
  // with the verified blob handed to an operator CLI when in-browser submission fails, and
  // *"verification stays in-browser even when submission cannot"*. Naming FE-P10 as what
  // the screen waits on said the opposite, and would keep a working verification surface
  // unwired for a prototype outcome it does not depend on.
  S17: { state: 'built-unwired', milestone: 'F17', component: `${TX}#UpgradeCrank`, waitingOn: 'a live transport and a signer session' },
  S18: { state: 'built-unwired', milestone: 'F17', component: `${TX}#SnapshotCrank`, waitingOn: 'a live transport and a signer session' },
  S19: { state: 'built-unwired', milestone: 'F17', component: `${TX}#RegistryFiling`, waitingOn: 'a live transport and a signer session' },
  S20: { state: 'not-built', milestone: 'F7b', component: `${TX}#Balances` },
  S21: { state: 'built-unwired', milestone: 'F7', component: `${HANDOFF}#ShareContext`, waitingOn: 'the capsule export flow being wired to it' },
  S22: { state: 'built-unwired', milestone: 'F7', component: `${HANDOFF}#ImportReview`, waitingOn: 'the import and clamp flow being wired to it' },
});

/** One line a user can read, assembled from the structured entry. */
export function pendingCopy(pending: PendingScreen): string {
  return pending.state === 'built-unwired'
    ? `${pending.milestone} — this screen is built; it is waiting on ${pending.waitingOn}.`
    : `${pending.milestone} — this screen has not been built yet.`;
}

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
  const pending = PENDING_SCREENS[screen.id];
  return (
    <Panel title={screen.title}>
      <Notice severity="info" heading="This screen is not in this build">
        {pending === undefined
          ? 'It is part of the canonical client and has not been built yet.'
          : `It is part of the canonical client. ${pendingCopy(pending)}`}{' '}
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
