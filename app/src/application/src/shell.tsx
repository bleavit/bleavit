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
 * - *"it disappears only when a finalized `PhaseFlags` read shows Phase ≥ 4 (sudo removed)"*
 *   — so its presence is a function of that one read and nothing else. **`PhaseFlags` is a
 *   bitset, and sudo-present is bit 4** (02 §7.3): the first version of this file tested
 *   `phase >= 4`, which shares the digit and is the opposite check. A real recorded value
 *   of `17` (shadow mode + sudo present) would have *hidden* the banner on a chain running
 *   sudo. See `phase-flags.ts`. An **unread** value renders the banner: 10 §5.4 /
 *   INV-FE-12 make the unknown case fail-closed, and the closed direction here is *warn*,
 *   since a client that quietly drops the banner because a read failed presents bootstrap
 *   state as post-sudo state.
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
import { sudoActive } from './phase-flags.js';
import { CRITICAL_SURFACE } from '@bleavit/descriptors';
import { verdictAllowsSigning, verdictProvesSurface, type CompatVerdict } from './compat-session.js';

/**
 * What the shell knows about the chain's phase.
 *
 * **Every field may be absent, and absence is the only honest way to say "not established".**
 * Each was once required, which meant the two states this header can be in — before the first
 * read lands, and after a read whose decode failed — both had to be expressed as a *value*.
 * They were: `0` badged `verified-best` at block 0 by the boot sentinel, and `0` badged
 * `verified-finalized` by the reader's failure path. 10 §2.2 assigns the verified statuses
 * *"only to values read through smoldot with storage proofs checked, or computed client-side
 * purely from such values"*, and neither zero was. `undefined` is not a placeholder here; it
 * is the state, and `EpochHeader` renders it as one.
 *
 * `phaseFlags` has always been this way — `undefined` when `Constitution.PhaseFlags` could not
 * be read, distinct from a value that was read and has bit 4 clear, and the distinction
 * decides the banner. The other three now match it.
 */
export interface ShellChainState {
  readonly epoch: Verified<number> | undefined;
  readonly phaseLabel: Verified<string> | undefined;
  readonly finalizedHeight: Verified<number> | undefined;
  /**
   * `Constitution.PhaseFlags` — the raw **u32 bitset** of 02 §7.3, finalized-read.
   *
   * A bitset, not a phase number. Modelling it as a number is the defect this field was
   * renamed to kill: the banner keyed off `phase < 4` while sudo-present is *bit* 4, so a
   * real recorded value of `17` would have hidden the banner on a chain running sudo.
   * `undefined` means unread, which INV-FE-12 treats as *show the banner*.
   */
  readonly phaseFlags: Verified<number> | undefined;
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

export function sudoBannerFor(phaseFlags: Verified<number> | undefined): ReactNode | null {
  if (phaseFlags === undefined) {
    return (
      <Notice severity="danger" heading={SUDO_HEADING}>
        {SUDO_UNREAD}
      </Notice>
    );
  }
  if (!sudoActive(phaseFlags.value)) return null;
  return (
    <Notice severity="caution" heading={SUDO_HEADING}>
      {SUDO_BODY}
    </Notice>
  );
}

/**
 * The two `CRITICAL_SURFACE` entries this header reads — 02 §7.1, §7.3.
 *
 * Resolved from the generated list by pallet and member rather than by writing the ids out, so a
 * regeneration that renumbers them cannot leave this file naming a surface nothing probes: a
 * `verdictProvesSurface` call against an id no longer in `CRITICAL_SURFACE` answers `false`
 * forever, which would read on screen as *"this runtime does not carry the epoch"* on a perfectly
 * healthy chain. `undefined` is impossible today and is handled as *unproven*, which is the same
 * fail-closed direction INV-FE-12 takes everywhere else — and `tests/screens` binds these two
 * pairs to `SHELL_READS`, so the pair that is written here cannot drift from the key that is read.
 */
const HEADER_SURFACES = Object.freeze({
  epochOf: CRITICAL_SURFACE.find((e) => e.pallet === 'Epoch' && e.member === 'EpochOf')?.id,
  phaseFlags: CRITICAL_SURFACE.find((e) => e.pallet === 'Constitution' && e.member === 'PhaseFlags')?.id,
});

/**
 * Whether the header may show a field at all — INV-FE-12's read half.
 *
 * > reads continue only where compatibility probes pass
 *
 * `undefined` verdict is *not* the same question and answers `true`: before the first
 * classification the client has established nothing about the runtime, and refusing to render the
 * header during boot would replace *"not read yet"* with *"this runtime does not carry it"* — a
 * claim about the chain, made by a client that has not looked. The compat notice below states the
 * unestablished case in its own words instead.
 */
function surfaceReadable(compat: CompatVerdict | undefined, id: string | undefined): boolean {
  if (compat === undefined) return true;
  if (compat.kind !== 'classified') return true;
  return id !== undefined && verdictProvesSurface(compat, id);
}

/** Why a field is not shown, in the classifier's own words. */
function surfaceReason(compat: CompatVerdict | undefined, id: string | undefined): string {
  if (compat?.kind !== 'classified') return 'this release could not check it against the runtime.';
  if (compat.classification.mode === 'read-only-incompatible') {
    return (
      `this release ships no descriptors for runtime ${compat.classification.specVersion}, so ` +
      'nothing on this chain can be decoded (10 §5.3).'
    );
  }
  const named = compat.classification.disabled.find((entry) => entry.id === id);
  return named?.reason ?? 'this release could not prove it is present in the runtime on chain.';
}

/**
 * A field this runtime does not carry — INV-FE-12's *"named reason"*.
 *
 * Deliberately distinct from {@link NotEstablished}. That one says *"nobody has read this yet"*,
 * which is a statement about the client; this one says *"the runtime on chain does not carry it,
 * and here is the probe's reason"*, which is a statement about the chain. Collapsing them would
 * present a permanent condition as a pending one, and a user waiting for a number that is never
 * coming is the worst of the two wrong answers.
 */
function SurfaceUnavailable({ what, why }: { readonly what: string; readonly why: string }) {
  return (
    <span className="datum datum--unavailable" role="note" data-compat-unavailable={what}>
      Unavailable in this release — {why} Nothing is being substituted for it (INV-FE-12).
    </span>
  );
}

/** 10 §3.2's third column, as a sentence. `undefined` while nothing has been classified. */
const SIGNING_HEADING = 'Runtime compatibility';

/**
 * What the shell says about 10 §5.2's verdict — the surface F26 produced and never rendered.
 *
 * Four outcomes and four sentences, because §3.1 and §5.2 give each a different recovery and a
 * screen that collapsed them would send a user to the wrong one:
 *
 * - **`full`** — nothing is rendered. A notice on every screen for the healthy case is a notice
 *   people stop reading, and there is no disabled surface to name.
 * - **`restricted`** — the disabled surfaces **by name**, which is §3.1's word for the whole
 *   difference between this mode and *"claiming Ready and failing lazily"*.
 * - **`read-only-incompatible`** — signing disabled, load a newer release (§5.3).
 * - **`unestablished` / `not-attempted`** — the stated reason, **no surface named as disabled**,
 *   because none was examined. §3.1 is explicit that naming one here would put *"this surface is
 *   absent from this runtime"* on screen about surfaces nothing looked at.
 *
 * `data-compat-mode` carries the **mode**, not the arm: 10 §5.2's verdict *is* the mode, and a
 * marker saying only that some chain answered would be satisfied by every one of these four.
 */
export function CompatNotice({ compat }: { readonly compat: CompatVerdict | undefined }) {
  if (compat === undefined) return null;
  if (compat.kind !== 'classified') {
    return (
      <Notice severity="danger" heading={SIGNING_HEADING}>
        <span data-compat-mode="none" data-compat-code={compat.kind === 'unestablished' ? compat.code : 'none'}>
          {compat.reason}
        </span>
      </Notice>
    );
  }
  const mode = compat.classification.mode;
  if (mode === 'full' && verdictAllowsSigning(compat)) return null;
  return (
    <Notice severity={mode === 'read-only-incompatible' ? 'danger' : 'caution'} heading={SIGNING_HEADING}>
      <span data-compat-mode={mode} data-compat-signing={verdictAllowsSigning(compat) ? 'enabled' : 'disabled'}>
        {mode === 'read-only-incompatible'
          ? `This release ships no descriptors for runtime ${compat.classification.specVersion}. ` +
            'Reads are unavailable and nothing can be signed until a newer release is loaded (10 §5.3).'
          : `${compat.classification.disabled.length} surface(s) this release depends on are not ` +
            'available in the runtime on chain, so signing is unavailable (INV-FE-12).'}
      </span>
      {mode === 'restricted' ? (
        <ul className="compat__disabled">
          {compat.classification.disabled.map((entry) => (
            <li key={entry.id} data-compat-disabled={entry.id}>
              {entry.reason}
            </li>
          ))}
        </ul>
      ) : null}
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

/**
 * A field the client has not established.
 *
 * There is deliberately no number here and no badge. A badge is a claim about where a value
 * came from, and there is no value; the six statuses of 10 §2.1 all describe an observation
 * of some strength, and *"we have not read this"* is not a weak observation but the absence
 * of one. What the user gets instead is a sentence, which is the form INV-FE-12's fail-closed
 * rule takes on screen — the same shape `sudoBannerFor` already uses for an unread
 * `PhaseFlags`.
 */
function NotEstablished({ what }: { readonly what: string }) {
  return (
    <span className="datum datum--unread" role="note">
      Not read yet — this client cannot state {what} from finalized state. Nothing is being
      substituted for it.
    </span>
  );
}

export function EpochHeader({
  chain,
  compat,
}: {
  readonly chain: ShellChainState;
  /**
   * 10 §5.2's verdict for this session. Optional, and the default is *not* a permissive one:
   * `undefined` means no classification has been made, which `surfaceReadable` renders as
   * *"not read yet"* rather than as *"the runtime does not carry it"*. See that function.
   */
  readonly compat?: CompatVerdict | undefined;
}) {
  const epochReadable = surfaceReadable(compat, HEADER_SURFACES.epochOf);
  const flagsReadable = surfaceReadable(compat, HEADER_SURFACES.phaseFlags);
  return (
    <Panel title="Epoch and phase">
      <Field label="Epoch">
        {!epochReadable ? (
          <SurfaceUnavailable what="epoch" why={surfaceReason(compat, HEADER_SURFACES.epochOf)} />
        ) : chain.epoch === undefined ? (
          <NotEstablished what="the epoch" />
        ) : (
          <BlockRef datum={chain.epoch} />
        )}
      </Field>
      <Field label="Phase">
        {!epochReadable ? (
          <SurfaceUnavailable what="phase" why={surfaceReason(compat, HEADER_SURFACES.epochOf)} />
        ) : chain.phaseLabel === undefined ? (
          <NotEstablished what="the phase" />
        ) : (
          <Phrase datum={chain.phaseLabel} />
        )}
      </Field>
      <Field label="Finalized head">
        {chain.finalizedHeight === undefined ? (
          <NotEstablished what="the finalized head" />
        ) : (
          <BlockRef datum={chain.finalizedHeight} />
        )}
      </Field>
      {/* The banner's own read. Rendered as its own row so a runtime that dropped
          `Constitution.PhaseFlags` says so, rather than showing the unread-sudo warning
          forever with no explanation of why the read will never land. */}
      {flagsReadable ? null : (
        <Field label="Governance phase">
          <SurfaceUnavailable
            what="phase-flags"
            why={surfaceReason(compat, HEADER_SURFACES.phaseFlags)}
          />
        </Field>
      )}
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
  compat,
  handoffEnabled,
  activeScreen,
  children,
}: {
  readonly chain: ShellChainState;
  /**
   * 10 §3.2's session-scoped compat mode, as `connectAndClassify` and the §3.1 retry produce it.
   *
   * A prop of its own rather than a field of `ShellChainState`, because it is not one of S1's
   * reads: `assertOnePin` requires every leaf of that model to carry the reader's pin, and a
   * verdict carries a `:code` hash and no block at all. §3.2 already calls it *"a session-scoped
   * variable that the boot machine's terminal healthy states parameterize"*, which is exactly a
   * second input rather than a fourth leaf.
   */
  readonly compat?: CompatVerdict | undefined;
  readonly handoffEnabled: boolean;
  readonly activeScreen: string;
  readonly children: ReactNode;
}) {
  const banner = sudoBannerFor(chain.phaseFlags);
  const nav = navigationFor(handoffEnabled);
  return (
    <div className="shell">
      {banner === null ? null : (
        <AlwaysVisible fold={aboveTheFold('sudo-era-banner', banner)} />
      )}
      <CompatNotice compat={compat} />
      <header className="shell__header">
        <EpochHeader chain={chain} compat={compat} />
      </header>
      <NavigationBar nav={nav} active={activeScreen} />
      <main className="shell__main">{children}</main>
    </div>
  );
}
