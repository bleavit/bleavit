/**
 * The provider settings panel — 10 §8.1's opt-in posture, §8.3's ladder, §8.4's disclosure. F23.
 *
 * F9 built the ladder, the fleet aggregate and the guarantee copy; none of them had a reader.
 * This is the surface 10 §8.4 names when it says the depth limit *"is disclosed in the provider
 * UI"*, and the surface §8.3's closing sentence describes when it says all-providers-down falls
 * back to *"the default (provider-less) behavior with the standard incomplete-history
 * explainer"*.
 *
 * ## Three fleet states, and only one of them is an incident
 *
 * `fleetState` already distinguishes them and a screen is where they get flattened:
 *
 * - **`none-enabled`** is §8.1's shipped posture — *"this is the tested default configuration,
 *   not an edge case"* — so it renders at `info` with the explainer and **no `FE-PROV-*` code**.
 *   An incident banner on first run teaches a user that the app is broken by default.
 * - **`serving`** carries four numbers and the screen must render `failing` **beside**
 *   `serving`, never subtracted from it. §8.3 lets a `failing` source serve, so a fleet of three
 *   timed-out sources reports `serving: 3` — and a panel that rendered only that number would
 *   say *3 sources serving* over a fleet answering nothing. That is the exact reading the
 *   `failing` count was added to prevent, and this is the surface it was added for.
 * - **`all-down`** is the one that carries `FE-PROV-001`, every disabled source's required
 *   reason, and the same explainer. A reason is a required field of the disabled state; the
 *   panel renders all of them, because *"an optional source is not responding"* with no reason
 *   is what makes a user re-enable the source that was caught lying.
 *
 * ## `unprobed` is rendered as what it is, including the part that is this release's fault
 *
 * §8.3 requires a probe *"on enable + every 10 min"* and **nothing in this release drives one**
 * (F24 owns the driver, parked on SQ-612/SQ-613). So an accepted source stays `unprobed`, cannot
 * serve reads, and would sit on this panel forever with no explanation unless the panel says so.
 * It says so. A state the client cannot leave, presented as a state it is passing through, is
 * the silent-degradation shape INV-FE-15 forbids one level up.
 *
 * ## Nothing here is a chain read
 *
 * Every value on this panel is this device's own observation of a third party's endpoint, or
 * copy the release wrote. None of it is chain state, so none of it carries a
 * `VerificationStatus` — the six statuses describe observations *of the chain*, and giving a
 * latency figure one would make "verified" answer two questions. The same reasoning `ui`'s
 * `Undecodable` states for a decode failure.
 *
 * @see docs/architecture/10-frontend-architecture.md §8.1, §8.3, §8.4
 * @see docs/architecture/15-invariants-and-testing.md §2 — INV-FE-3, INV-FE-13, INV-FE-15
 */

import {
  Button,
  DataTable,
  Disclosure,
  Notice,
  Panel,
  Refusal,
  type ReactNode,
} from '@bleavit/ui';
import {
  LADDER,
  SAMPLING_GUARANTEE,
  canServeReads,
  canSupplyPinnedImport,
  fleetState,
  type FleetState,
  type Provider,
  type ProviderHealth,
} from '@bleavit/providers';

/**
 * One ladder state as a line a user can read, plus what it permits.
 *
 * `serves` and `mayImport` are read off the package's own predicates rather than restated: they
 * differ on exactly one state (`unprobed`), and a panel that re-derived the rule would be a
 * second implementation of §8.3's *"only `Disabled` stops reads"* — which is how the two answers
 * drift while both look right.
 */
export interface HealthLine {
  readonly state: ProviderHealth['kind'];
  readonly label: string;
  /** Why the client is in this state. Never empty — `disabled` carries the required reason. */
  readonly detail: string;
  readonly serves: boolean;
  readonly mayImport: boolean;
}

/**
 * §8.3's *"health probe on enable + every 10 min"*, and the fact that this release drives none.
 *
 * Stated on the panel rather than in a comment, because it is the difference between a state a
 * user is passing through and a state they are stuck in. F24 owns the driver.
 */
export const NO_PROBE_DRIVER =
  'This release does not yet contact optional sources to check whether they are answering. A ' +
  'source you turn on therefore stays "not checked yet" and is not read from, and importing a ' +
  'snapshot file you already hold works regardless — that path asks no endpoint anything.';

/** 10 §8.1's first sentence, as the panel says it. */
export const EMPTY_BY_DEFAULT =
  'Bleavit ships with no optional sources switched on, in every mode. With none enabled the ' +
  'app is exactly what it can verify for itself plus what it has indexed locally, and every ' +
  'workflow works. Turning one on is always your explicit choice and always reversible.';

/** The ladder line for one provider. Exhaustive: a sixth state fails to compile. */
export function healthLine(provider: Provider): HealthLine {
  const shared = { serves: canServeReads(provider), mayImport: canSupplyPinnedImport(provider) };
  const health = provider.health;
  switch (health.kind) {
    case 'unprobed':
      return {
        ...shared,
        state: 'unprobed',
        label: 'Not checked yet',
        detail:
          'Nothing has been asked of this source since you turned it on, so nothing is read ' +
          `from it. ${NO_PROBE_DRIVER}`,
      };
    case 'healthy':
      return {
        ...shared,
        state: 'healthy',
        label: 'Answering',
        detail: `Its last check answered within ${LADDER.slowAboveMs} ms.`,
      };
    case 'slow':
      return {
        ...shared,
        state: 'slow',
        label: 'Answering slowly',
        detail:
          `Its last check took ${health.observedMs} ms, over the ${LADDER.slowAboveMs} ms this ` +
          'release calls slow. A slow source is still an honest one and is left switched on: ' +
          'switching it off would turn a network condition into missing history.',
      };
    case 'failing':
      return {
        ...shared,
        state: 'failing',
        label: 'Not answering',
        detail:
          `Its last ${health.consecutiveFailures} checks in a row did not answer. It is still ` +
          `switched on — ${LADDER.disableAfter} consecutive failures switch a source off, and ` +
          'one timeout in a working series must not. Nothing it has supplied was ever treated ' +
          'as verified.',
      };
    case 'disabled':
      return {
        ...shared,
        state: 'disabled',
        label: health.by === 'user' ? 'Switched off by you' : 'Switched off automatically',
        // The required field, rendered. A source that vanishes unexplained reads as a broken
        // app and gets turned back on — which is the one outcome the auto-disable exists to
        // prevent when the cause was a source caught contradicting the chain.
        detail: health.reason,
      };
    default: {
      const unhandled: never = health;
      return unhandled;
    }
  }
}

/**
 * The fleet, as §8.3's closing sentence describes it.
 *
 * Rendered from `fleetState`'s own value rather than from the provider list, so the three
 * situations stay the three the package distinguishes.
 */
export function FleetSummary({ fleet }: { readonly fleet: FleetState }): ReactNode {
  if (fleet.kind === 'none-enabled') {
    // Not a degradation, and deliberately at `info` with no code: this is the shipped posture.
    return (
      <div className="fleet" data-fleet="none-enabled">
        <Notice severity="info" heading="No optional sources are switched on">
          {EMPTY_BY_DEFAULT} {fleet.explainer}
        </Notice>
      </div>
    );
  }
  if (fleet.kind === 'all-down') {
    return (
      <div className="fleet" data-fleet="all-down">
        <Refusal
          code={fleet.code}
          message="Every optional source you switched on has been switched off."
          recovery={fleet.explainer}
          detail={`${fleet.enabled} source(s) enabled, all of them off.`}
        />
        <DataTable
          caption="Why each source was switched off"
          headers={['Reason']}
          rows={fleet.reasons.map((reason, at) => ({
            key: `reason-${at}`,
            cells: [reason],
          }))}
        />
      </div>
    );
  }
  // `serving` — and the two numbers that must not be one number.
  const answering = fleet.serving - fleet.failing;
  return (
    <div
      className="fleet"
      data-fleet="serving"
      data-serving={fleet.serving}
      data-failing={fleet.failing}
      data-unprobed={fleet.unprobed}
    >
      <Notice
        severity={answering > 0 ? 'info' : 'caution'}
        heading={
          answering > 0
            ? 'Optional sources are switched on'
            : 'Every source that may be read is failing its checks'
        }
      >
        {fleet.enabled} switched on. {fleet.serving} may be read from, and {fleet.failing} of
        those did not answer their last check, so {answering} are answering. {fleet.unprobed}{' '}
        have not been checked at all and are not read from.{' '}
        {answering > 0
          ? ''
          : 'Older history is coming from what this device indexed itself, and gaps are shown ' +
            'as gaps.'}
      </Notice>
    </div>
  );
}

/** What the panel is handed. A list of providers and the two user actions §8.1 requires. */
export interface ProviderPanelProps {
  readonly providers: readonly Provider[];
  /** §8.4: re-enabling is an explicit user action, so the panel offers it and never performs it. */
  readonly onEnable: (provider: Provider) => void;
  readonly onDisable: (provider: Provider) => void;
}

/**
 * The panel.
 *
 * `SAMPLING_GUARANTEE` is rendered **as written** — it is normative UI copy (§8.4) and this
 * surface is where §8.4 says it is disclosed. It is imported rather than restated, and the
 * suite binds the constant clause-by-clause to the document, so a paraphrase here would have to
 * be a paraphrase there.
 */
export function ProviderSettings({
  providers,
  onEnable,
  onDisable,
}: ProviderPanelProps): ReactNode {
  const fleet = fleetState(providers);
  return (
    <Panel title="Optional data sources" tone="advanced">
      <FleetSummary fleet={fleet} />

      {providers.length === 0 ? null : (
        <DataTable
          caption="Sources you have switched on"
          headers={['Source', 'Kind', 'State', 'What that means', 'Read from', 'Action']}
          rows={providers.map((provider) => {
            const line = healthLine(provider);
            return {
              key: provider.id,
              cells: [
                provider.id,
                provider.kind,
                line.label,
                line.detail,
                line.serves ? 'yes' : 'no',
                // Re-enabling is the user's explicit act (§8.4), so the control is offered and
                // the panel never performs it. Both directions are always available: a source
                // the user switched off is theirs to switch back on, and so is one this device
                // switched off after catching it contradicting the chain.
                <Button
                  key={`${provider.id}-action`}
                  label={line.state === 'disabled' ? 'Switch back on' : 'Switch off'}
                  onClick={() =>
                    line.state === 'disabled' ? onEnable(provider) : onDisable(provider)
                  }
                />,
              ],
            };
          })}
        />
      )}

      <Notice severity="info" heading="Checking optional sources is not wired up yet">
        {NO_PROBE_DRIVER}
      </Notice>

      {/* §8.4's normative copy, verbatim, on the surface §8.4 names. Behind one step because
          it is an explanation rather than a fact that changes the meaning of a signature —
          11 §11.2 constraint 3's list does not reach it, and nothing here is signable. */}
      <Disclosure summary="What checking an optional source can and cannot catch" open>
        <p className="provider-panel__guarantee">{SAMPLING_GUARANTEE}</p>
      </Disclosure>
    </Panel>
  );
}
