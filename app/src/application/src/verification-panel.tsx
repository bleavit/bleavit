/**
 * The verification panel — F10's last item, unblocked by F7's shell.
 *
 * `packages/verify` decides everything; this file only renders. That split is the reason
 * the package could be finished before a screen existed, and it is worth keeping: the
 * comparison that decides whether a user is warned is identical on web, desktop and in a
 * test, while the markup is not.
 *
 * ## Why it lives in the shell rather than in `packages/ui`
 *
 * `ui` holds components that know about *provenance*, not about *releases*. A panel that
 * understands `ReleaseIdentity`, self-check divergence and a checkpoint bound is domain
 * furniture, and pushing it into `ui` would make the render layer depend on the release
 * layer for one screen's benefit. 10 §10.1 puts the shell at `app/src/{application, …}`
 * and that is where a screen belongs.
 *
 * ## The distinction the panel exists to make
 *
 * Every row is either a **pin** (compiled into the bundle, true offline, true even if the
 * chain is a forgery) or an **observation** (something a live chain reported). Rendering
 * them identically is what lets a pin masquerade as a verification, so `kind` drives a
 * visible difference and not merely a class name — the pinned rows are labelled *in the
 * bundle* in words, because a colour is not a fact.
 *
 * ## What it must survive
 *
 * 10 §3.2 lists this panel among the surfaces that still render under `FE-BOOT-002`, when
 * the worker never started and **no verified read exists at all**. So it takes no chain
 * handle, `buildPanel` is synchronous, and the checkpoint verdict is optional — a panel
 * that needed any of those would be absent exactly when a user is trying to work out what
 * went wrong.
 */

import { Notice, Panel, type ReactNode } from '@bleavit/ui';
import type { CheckpointAgeVerdict, VerificationPanel } from '@bleavit/verify';

/** In-bundle copy per row kind. Words, because a colour is not a fact. */
const KIND_COPY = Object.freeze({
  pinned: 'in this bundle',
  observed: 'reported by the chain',
});

function severityFor(verdict: CheckpointAgeVerdict): 'info' | 'caution' | 'danger' {
  switch (verdict.kind) {
    case 'fresh':
      return 'info';
    case 'warn':
      return 'caution';
    case 'expired':
    case 'indeterminate':
      return 'danger';
  }
}

/**
 * The checkpoint-age row.
 *
 * `fresh` renders **nothing**. A green "checkpoint is current" line would be a claim about
 * the future — the bound lapses on a clock the client does not control, and a reassurance
 * that goes stale silently is worse than no reassurance. The panel already shows the
 * release's own pins; freshness is the absence of a warning.
 */
export function CheckpointAgeNotice({
  verdict,
}: {
  readonly verdict: CheckpointAgeVerdict;
}): ReactNode {
  if (verdict.kind === 'fresh') return null;
  return (
    <Notice
      severity={severityFor(verdict)}
      heading={
        verdict.kind === 'expired'
          ? 'This release is too old to verify the chain'
          : verdict.kind === 'indeterminate'
            ? 'This release’s age cannot be established'
            : 'This release is getting old'
      }
    >
      {verdict.message}
    </Notice>
  );
}

export function VerificationPanelView({
  panel,
  checkpoint,
}: {
  readonly panel: VerificationPanel;
  /** Absent before the release document has been read — not an assertion of freshness. */
  readonly checkpoint?: CheckpointAgeVerdict | undefined;
}) {
  return (
    <Panel title="Verification">
      {checkpoint === undefined ? null : <CheckpointAgeNotice verdict={checkpoint} />}

      {panel.status === 'divergent' ? (
        <Notice severity="danger" heading="What was served does not match what was released">
          The differences are listed below. This client reports them and does not repair them:
          re-fetching would ask the same channel that just served the wrong bytes for better
          ones.
        </Notice>
      ) : null}

      {panel.chainIdentityVerified ? null : (
        <Notice severity="caution" heading="The chain’s identity has not been verified yet">
          Nothing below marked “{KIND_COPY.observed}” has been established. Rows marked “
          {KIND_COPY.pinned}” are true of this bundle whatever the chain says — they are what
          this release claims, not what has been confirmed.
        </Notice>
      )}

      <dl className="verification">
        {panel.rows.map((row) => (
          <div className="verification__row" data-kind={row.kind} key={`${row.kind}:${row.label}`}>
            <dt className="verification__label">
              {row.label}
              {/* The words, not just the attribute: a reader must be able to tell a pin from
                  an observation without inspecting the DOM or knowing the colour scheme. */}
              <span className="verification__kind"> — {KIND_COPY[row.kind]}</span>
            </dt>
            <dd className="verification__value">
              <code>{row.value}</code>
            </dd>
          </div>
        ))}
      </dl>

      {panel.warnings.length === 0 ? null : (
        <ul className="verification__warnings">
          {panel.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
