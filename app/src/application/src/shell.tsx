/**
 * S1 — the global shell: epoch and phase header, the sudo-era banner, the navigation.
 *
 * ## The banner is the reason this file is careful
 *
 * 11 §11.10 makes four claims about it, and each has an obvious way to be violated by a
 * later layout change rather than by anybody deciding to:
 *
 * - *"the global app shell, above navigation, on **every** route"* — so it is rendered
 *   here, once, outside the outlet. A per-route banner is a banner some route forgets.
 * - *"non-dismissable and non-collapsible"* — so it goes through `AlwaysVisible`, which
 *   offers no dismiss affordance and **throws** if it is ever rendered inside a
 *   `Disclosure` (11 §11.2 constraint 3 names `sudo-era-banner` explicitly).
 * - *"It MUST NOT be gated behind settings, themes, or 'compact mode'"* — so `Shell` takes
 *   no prop that could hide it. The only input is the chain read.
 * - *"it disappears only when a finalized `PhaseFlags` read shows Phase ≥ 4"* — so its
 *   presence is a function of `Verified<PhaseState>` and nothing else. In particular an
 *   **unread** phase renders the banner: 10 §5.4 / INV-FE-12 make the unknown case
 *   fail-closed, and the closed direction here is *warn*, since a client that quietly
 *   drops the banner because a read failed presents bootstrap state as post-sudo state.
 *
 * ## Why the header takes `Verified<T>` rather than a store
 *
 * Everything on this screen is a chain read, and 10 §2.1's rule is that a data component
 * cannot render one without a status. Passing the models in means this file has no way to
 * obtain an unbadged value — there is no store here to read one from.
 */

import {
  AlwaysVisible,
  BlockRef,
  Field,
  Notice,
  Panel,
  Phrase,
  aboveTheFold,
  type ReactNode,
} from '@bleavit/ui';
import type { Verified } from '@bleavit/shared-types';
import { navigationFor, type Navigation, type Screen } from './screens.js';

/**
 * What the shell knows about the chain's phase.
 *
 * `phase` is `undefined` when `Constitution.PhaseFlags` could not be read — distinct from
 * a phase that was read and is ≥ 4, and the distinction decides whether the banner shows.
 */
export interface ShellChainState {
  readonly epoch: Verified<number>;
  readonly phaseLabel: Verified<string>;
  readonly finalizedHeight: Verified<number>;
  /** The 02 §9 governance phase, finalized-read. `undefined` means unread, not post-sudo. */
  readonly bootstrapPhase: Verified<number> | undefined;
}

/** 11 §11.10's normative copy, in-bundle, one place. */
const SUDO_HEADING = 'Bootstrap governance: sudo active';
const SUDO_BODY =
  'Bootstrap governance is active: a founding multisig holds sudo. On-chain state is ' +
  'finality-verified but not yet protected by full protocol governance.';
const SUDO_UNREAD =
  'The governance phase could not be read from finalized state, so this client cannot ' +
  'establish that sudo has been removed. It is showing this warning rather than assuming ' +
  'the safer-looking answer.';

/** Phase ≥ 4 is the post-sudo window (09 §3.1); below it the banner stands. */
const FIRST_POST_SUDO_PHASE = 4;

export function sudoBannerFor(bootstrapPhase: Verified<number> | undefined): ReactNode | null {
  if (bootstrapPhase === undefined) {
    return (
      <Notice severity="danger" heading={SUDO_HEADING}>
        {SUDO_UNREAD}
      </Notice>
    );
  }
  if (bootstrapPhase.value >= FIRST_POST_SUDO_PHASE) return null;
  return (
    <Notice severity="caution" heading={SUDO_HEADING}>
      {SUDO_BODY}
    </Notice>
  );
}

function NavigationBar({ nav, active }: { readonly nav: Navigation; readonly active: string }) {
  const link = (screen: Screen) => (
    <a
      key={screen.id}
      className={`nav__link${screen.id === active ? ' nav__link--active' : ''}`}
      href={screen.path}
      data-screen={screen.id}
      aria-current={screen.id === active ? 'page' : undefined}
    >
      {screen.title}
    </a>
  );
  return (
    <nav className="nav" aria-label="Primary">
      <div className="nav__primary">{nav.primary.map(link)}</div>
      {nav.advanced.length === 0 ? null : (
        <details className="nav__advanced">
          <summary>Advanced</summary>
          <div className="nav__advanced-body">{nav.advanced.map(link)}</div>
        </details>
      )}
      {nav.promotedForNoHandoff ? (
        <p className="nav__note">
          The external-tool handoff is disabled in this build, so the protocol screens are the
          front door. Nothing has been removed.
        </p>
      ) : null}
    </nav>
  );
}

export function EpochHeader({ chain }: { readonly chain: ShellChainState }) {
  return (
    <Panel title="Epoch and phase">
      <Field label="Epoch">
        <BlockRef datum={chain.epoch} />
      </Field>
      <Field label="Phase">
        <Phrase datum={chain.phaseLabel} />
      </Field>
      <Field label="Finalized head">
        <BlockRef datum={chain.finalizedHeight} />
      </Field>
    </Panel>
  );
}

/**
 * The shell.
 *
 * There is deliberately no `showBanner`, `compact`, or `theme` prop. 11 §11.10 forbids the
 * banner being gated behind any of those, and the way to make that true is to have nowhere
 * for such a gate to live.
 */
export function Shell({
  chain,
  handoffEnabled,
  activeScreen,
  children,
}: {
  readonly chain: ShellChainState;
  readonly handoffEnabled: boolean;
  readonly activeScreen: string;
  readonly children: ReactNode;
}) {
  const banner = sudoBannerFor(chain.bootstrapPhase);
  const nav = navigationFor(handoffEnabled);
  return (
    <div className="shell">
      {banner === null ? null : (
        <AlwaysVisible fold={aboveTheFold('sudo-era-banner', banner)} />
      )}
      <header className="shell__header">
        <EpochHeader chain={chain} />
      </header>
      <NavigationBar nav={nav} active={activeScreen} />
      <main className="shell__main">{children}</main>
    </div>
  );
}
