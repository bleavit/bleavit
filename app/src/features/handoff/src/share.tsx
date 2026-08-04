/**
 * S21 — share verified context (11 §11.14.4, 10 §13.1).
 *
 * ## The consent rule, and why the screen cannot cheat it
 *
 * > Export requires **per-export consent** with the scope shown, and the **default scope
 * > excludes account-specific data** — positions, balances and addresses are opt-in per
 * > export, never included because the last export included them.
 *
 * The type layer already carries most of this: `defaultScope()` takes no argument it could
 * inherit from, and `buildCapsule` refuses data outside the consented scope *and* a
 * consented scope with no data supplied. What is left to this screen is the part a screen
 * can get wrong — remembering the last selection.
 *
 * So the component is **controlled and takes no initial value**: the caller renders it with
 * a scope, and the caller is a route that starts from `defaultScope()` each time. There is
 * no `defaultChecked`, no persistence call, and nothing in this module reads or writes
 * storage. A "remember my choices" affordance is not a feature request to be weighed here;
 * §11.14.4 says opt-in *per export*, and a checkbox that remembers is exactly what that
 * sentence forbids.
 *
 * ## Pseudonymization is offered, and labelled for what it does not do
 *
 * > **Pseudonymization MUST be offered** for the account-bearing scopes, and MUST be
 * > labelled for what it is: it replaces the address in the capsule and does nothing about
 * > the holdings themselves, which remain a fingerprint.
 *
 * `pseudonymizationLabel()` already produces that sentence in `contexts`, so the screen
 * renders it rather than writing a second, kinder version of it.
 */

import {
  Button,
  Field,
  Notice,
  Panel,
  Phrase,
  type ReactNode,
} from '@bleavit/ui';
import { externalProposal } from '@bleavit/shared-types';
import {
  ACCOUNT_SCOPES,
  PUBLIC_SCOPES,
  includesAccountData,
  isAccountScope,
  pseudonymizationLabel,
  type ExportScope,
  type ScopeKey,
} from '@bleavit/contexts';

/** In-bundle copy for each scope, so a scope's meaning is not inferred from its key. */
const SCOPE_COPY: Readonly<Record<ScopeKey, string>> = Object.freeze({
  proposal: 'The proposal: its state, its class, its windows.',
  market: 'The books: prices, liquidity and the fee that applies.',
  decision: 'The decision statistics, if the windows are sealed.',
  epoch: 'The epoch and its phase.',
  positions: 'What you hold, per ledger domain. Account data.',
  balances: 'Your USDC and VIT balances. Account data.',
  address: 'Your account address. Account data.',
});

function ScopeCheckbox({
  scope,
  checked,
  onToggle,
}: {
  readonly scope: ScopeKey;
  readonly checked: boolean;
  readonly onToggle: (scope: ScopeKey, next: boolean) => void;
}) {
  return (
    <label className={`scope${isAccountScope(scope) ? ' scope--account' : ''}`} data-scope={scope}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onToggle(scope, event.currentTarget.checked)}
      />
      <span className="scope__name">{scope}</span>
      <span className="scope__copy">{SCOPE_COPY[scope]}</span>
    </label>
  );
}

export interface ShareContextProps {
  /**
   * The scope being consented to, for **this** export.
   *
   * Controlled with no default: the route supplies `defaultScope()` on every entry, so a
   * previous export's selection has nowhere to survive.
   */
  readonly scope: ExportScope;
  readonly onScopeChange: (scope: ExportScope) => void;
  readonly onExport: () => void;
  /** The block the reads were taken at — displayed, since the capsule carries it. */
  readonly anchorBlock: number;
}

export function ShareContext({
  scope,
  onScopeChange,
  onExport,
  anchorBlock,
}: ShareContextProps) {
  const consented = new Set<ScopeKey>(scope.included);
  const toggle = (key: ScopeKey, next: boolean) => {
    const included = new Set(consented);
    if (next) included.add(key);
    else included.delete(key);
    const remaining = [...included];
    onScopeChange({
      included: remaining,
      // Pseudonymization is meaningless with no account data in the export, and leaving it
      // set would show a privacy control that is doing nothing.
      pseudonymized: scope.pseudonymized && remaining.some(isAccountScope),
    });
  };

  const label = pseudonymizationLabel(scope);

  return (
    <Panel title="Share verified context">
      <Notice severity="info" heading="This file is a snapshot, not a permission">
        It contains what this client read from finalized chain state, and nothing else. It carries
        no key, grants nothing, and cannot be used to act on your behalf. Once you send it
        somewhere, it cannot be un-sent.
      </Notice>

      <Field label="Public data">
        {PUBLIC_SCOPES.map((key) => (
          <ScopeCheckbox key={key} scope={key} checked={consented.has(key)} onToggle={toggle} />
        ))}
      </Field>

      <Field label="Your account — off by default, chosen again for every export">
        {ACCOUNT_SCOPES.map((key) => (
          <ScopeCheckbox key={key} scope={key} checked={consented.has(key)} onToggle={toggle} />
        ))}
      </Field>

      {includesAccountData(scope) ? (
        <Field label="Pseudonymize">
          <label className="scope scope--pseudonymize">
            <input
              type="checkbox"
              checked={scope.pseudonymized}
              onChange={(event) =>
                onScopeChange({
                  included: [...scope.included],
                  pseudonymized: event.currentTarget.checked,
                })
              }
            />
            <span className="scope__copy">
              {label ?? 'Replace your address in the file.'}
            </span>
          </label>
        </Field>
      ) : null}

      <Field label="Read at block">
        <Phrase datum={externalProposal(`#${anchorBlock}`)} />
      </Field>

      <Button
        label={
          consented.size === 0 ? 'Choose at least one thing to share' : 'Create the file'
        }
        intent="primary"
        onClick={onExport}
        disabled={consented.size === 0}
        {...(consented.size === 0
          ? { disabledReason: 'An export with nothing in it would tell the tool nothing.' }
          : {})}
      />
    </Panel>
  );
}

export type { ReactNode };
