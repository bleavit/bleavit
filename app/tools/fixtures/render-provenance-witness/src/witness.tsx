/**
 * Witness for `check-render-provenance` — every rule fires here, and the controls do not.
 *
 * This file is **never built** by `tsc -b` and never shipped; it exists so that a gate proven
 * only by a green run is not the whole proof. Each expectation below is declared with its own
 * line, because "each rule fired at least once" is satisfied by the two easiest cases and
 * would leave the harder positions unproven.
 *
 * The negative controls matter as much as the positives: a rule that also fires on `key`, on
 * an event handler, or on a plain string would be switched off within a week.
 */

import { Button, Count, Panel } from '@bleavit/ui';
import type { Verified } from '@bleavit/shared-types';

declare const id: Verified<string>;
declare const limit: Verified<number>;
declare const used: Verified<number>;
/** Not a `Verified<T>` — the SQ-592 shape, and rule A must stay silent on it. */
declare const releaseRow: { readonly label: string; readonly value: string };

export function RuleAChild() {
  // expect: A child
  return <span>{id.value}</span>;
}

export function RuleAAttribute() {
  // expect: A attribute
  return <Panel title={`Referendum ${id.value}`}>{null}</Panel>;
}

export function RuleAButtonLabel() {
  // expect: A attribute
  return <Button label={`Unlock ${id.value}`} onClick={() => undefined} />;
}

export function RuleBBorrowedStatus() {
  // expect: B borrowed
  return <Count datum={{ value: limit.value - used.value, status: limit.status }} />;
}

// ---------------------------------------------------------------------------
// Negative controls. Each of these is correct code; a finding on any of them is
// a false positive and fails the witness.
// ---------------------------------------------------------------------------

export function ControlKeyIsNotDisplayed() {
  return (
    <ul>
      <li key={id.value}>
        <Count datum={limit} />
      </li>
    </ul>
  );
}

export function ControlHandlerArgumentIsNotDisplayed() {
  return <Button label="Open" onClick={() => console.log(id.value)} />;
}

export function ControlDomInputValue() {
  return <input onChange={(event) => console.log(event.currentTarget.value)} />;
}

export function ControlPlainStringHasNoProvenance() {
  // `releaseRow.value` is a string on a release-derived row, not a `Verified<T>`.
  return <code>{releaseRow.value}</code>;
}

export function ControlWholeDatumIsTheCorrectPath() {
  return (
    <Panel title="Referendum" subject={<Count datum={limit} />}>
      <Count datum={used} />
    </Panel>
  );
}

export function ControlSelfDescribedStatusIsNotBorrowed() {
  // Written out rather than taken from another read — `externalProposal()`'s shape. It claims
  // nothing it did not construct, so rule B must not fire.
  return <Count datum={{ value: 42, status: { kind: 'external-proposal' } }} />;
}
