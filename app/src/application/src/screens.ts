/**
 * The 11 §11.2 screen inventory as data, and the handoff-first navigation default.
 *
 * ## Why this is a table and not a router configuration
 *
 * 11 §11.2 constraint 1 is the one thing about the default navigation that is not a
 * presentation choice:
 *
 * > **Every screen in the inventory remains present, reachable without an external tool,
 * > and complete.** … **Demoting a surface is permitted; removing one is not**, and the
 * > no-infrastructure certification run continues to execute with the handoff surfaces
 * > disabled.
 *
 * A router with the screens spread across twenty files cannot answer *"is every screen
 * present?"* — you can only answer it by reading all twenty and hoping. Here it is one
 * array, `app/tests/screens` parses the inventory table out of doc 11, and a screen
 * dropped from the client fails that test rather than quietly ceasing to exist.
 *
 * ## Placement is derived, never assigned
 *
 * Each row's `placement` is a function of its `area`, which is the doc's own column:
 * `global` is chrome, `handoff` is primary, everything else is Advanced. A per-screen
 * placement field would be twenty independent chances to promote something the default
 * says is behind Advanced, or — much worse — to demote a screen so far it stops being
 * reachable. The rule is one line and the test checks the rule, not twenty answers.
 *
 * ## `reachableWithoutHandoff`
 *
 * INV-FE-4's certification run executes with the handoff surfaces disabled (15 §4.8), so
 * the navigation has to *survive* that rather than merely tolerate it. `navigationFor`
 * takes the switch and the suite drives both positions: with the handoff off, every
 * non-handoff screen must still be reachable, and the two primary slots do not silently
 * become empty — Advanced is promoted to the front instead, because a client whose entire
 * front door was optional is a client with no front door.
 */

/** The areas doc 11's inventory column uses. */
export type ScreenArea = 'global' | 'core' | 'FE-14' | 'FE-15' | 'funding' | 'handoff';

/**
 * Where a surface sits under the handoff-first default (11 §11.2).
 *
 * `chrome` is not a lesser placement — it is the header that renders on every screen, and
 * S1 is the only inventory row whose area is `global`.
 */
export type Placement = 'chrome' | 'primary' | 'advanced';

export interface Screen {
  /** `S1`…`S22`, or `confirm` for the surface §11.3–§11.4 owns without an S-number. */
  readonly id: string;
  readonly title: string;
  readonly area: ScreenArea;
  /** Route path. Hash routing per 10 §12 (FE-P7's finding does not change it). */
  readonly path: string;
}

/** The rule. One line, so there is one place to get it wrong and a test that reads it. */
export function placementOf(area: ScreenArea): Placement {
  if (area === 'global') return 'chrome';
  if (area === 'handoff') return 'primary';
  return 'advanced';
}

/**
 * Every row of 11 §11.2's inventory, plus the confirm surface.
 *
 * The titles are this client's own copy, deliberately shorter than the doc's descriptions;
 * what the test binds is the **id and area set**, because those are the doc's data and the
 * wording is not.
 */
export const SCREENS: readonly Screen[] = Object.freeze([
  { id: 'S1', title: 'Epoch and phase', area: 'global', path: '#/' },
  { id: 'S2', title: 'Proposals', area: 'core', path: '#/proposals' },
  { id: 'S3', title: 'Market trading', area: 'core', path: '#/markets' },
  { id: 'S4', title: 'Positions and redemption', area: 'core', path: '#/positions' },
  { id: 'S5', title: 'Submit a proposal', area: 'core', path: '#/submit' },
  { id: 'S6', title: 'Execution queue', area: 'core', path: '#/execution' },
  { id: 'S7', title: 'Welfare and constitution', area: 'core', path: '#/welfare' },
  { id: 'S8', title: 'Recent settlements', area: 'core', path: '#/settlements' },
  { id: 'S9', title: 'Referenda', area: 'FE-14', path: '#/referenda' },
  { id: 'S10', title: 'Vote and delegate', area: 'FE-14', path: '#/vote' },
  { id: 'S11', title: 'Oracle resolution ballot', area: 'FE-14', path: '#/ballot' },
  { id: 'S12', title: 'Deposit USDC', area: 'funding', path: '#/deposit' },
  { id: 'S13', title: 'Withdraw USDC', area: 'funding', path: '#/withdraw' },
  { id: 'S14', title: 'Reporter console', area: 'FE-15', path: '#/reporter' },
  { id: 'S15', title: 'Guardian console', area: 'FE-15', path: '#/guardian' },
  { id: 'S16', title: 'Treasury streams', area: 'FE-15', path: '#/treasury' },
  { id: 'S17', title: 'Upgrade crank', area: 'FE-15', path: '#/upgrade' },
  { id: 'S18', title: 'Welfare snapshot crank', area: 'FE-15', path: '#/snapshot' },
  { id: 'S19', title: 'Incident and milestone registry', area: 'FE-15', path: '#/registry' },
  { id: 'S20', title: 'Balances', area: 'core', path: '#/balances' },
  { id: 'S21', title: 'Share verified context', area: 'handoff', path: '#/share' },
  { id: 'S22', title: 'Review an imported action', area: 'handoff', path: '#/review' },
  // Not an inventory row: §11.3–§11.4 own the confirm-and-sign surface, and the navigation
  // default names it as one of the two primary slots by section rather than by id. It is
  // carried here so "the front door" is one list, and the doc-binding test excludes it by
  // id rather than by position.
  { id: 'confirm', title: 'Review and sign', area: 'handoff', path: '#/confirm' },
]);

/** Ids in the inventory table proper — everything doc 11 §11.2 lists with an `S` number. */
export const INVENTORY_IDS: readonly string[] = Object.freeze(
  SCREENS.filter((screen) => screen.id.startsWith('S')).map((screen) => screen.id),
);

export interface Navigation {
  /** Always rendered, on every screen. */
  readonly chrome: readonly Screen[];
  /** The front door. */
  readonly primary: readonly Screen[];
  /** Present, complete, one step away (11 §11.2 constraint 1). */
  readonly advanced: readonly Screen[];
  /**
   * True when the handoff surfaces are off and the client has therefore promoted the
   * analytical surfaces to the front. Rendered as a statement, not a silent reshuffle:
   * a user who disabled the handoff should be told that is why the app looks different.
   */
  readonly promotedForNoHandoff: boolean;
}

/**
 * Build the navigation for a release.
 *
 * `handoffEnabled: false` is the 15 §4.8 no-infrastructure certification posture. Under it
 * the handoff screens vanish from the navigation — they are the one part of the client
 * that legitimately can — and everything else stays exactly where it was, one step behind
 * Advanced, except that Advanced is now the front door rather than a second tier.
 */
export function navigationFor(handoffEnabled: boolean): Navigation {
  const chrome: Screen[] = [];
  const primary: Screen[] = [];
  const advanced: Screen[] = [];

  for (const screen of SCREENS) {
    const placement = placementOf(screen.area);
    if (placement === 'chrome') {
      chrome.push(screen);
    } else if (placement === 'primary') {
      if (handoffEnabled) primary.push(screen);
    } else {
      advanced.push(screen);
    }
  }

  if (handoffEnabled) return { chrome, primary, advanced, promotedForNoHandoff: false };
  // Nothing is removed — the same screens, promoted. Constraint 1 is about presence and
  // reachability, and both hold in either arrangement.
  return { chrome, primary: advanced, advanced: [], promotedForNoHandoff: true };
}

/** Every screen a user can navigate to, in either posture. Used by the reachability test. */
export function reachableScreens(handoffEnabled: boolean): readonly Screen[] {
  const nav = navigationFor(handoffEnabled);
  return [...nav.chrome, ...nav.primary, ...nav.advanced];
}
