/**
 * Witness for rule C — the laundering path, and the `.ts` half of the file filter.
 *
 * This file is a **model** file with no JSX in it at all, and that is the whole point of its
 * existence. The defect rule C exists for shipped in exactly this shape: a helper in a `.ts`
 * module took a `Verified<T>`, interpolated its payload into a sentence, and a screen rendered
 * the returned `string` as a JSX child. Rules A and B are both structurally blind to it — at
 * the render site there is no `Verified<T>` left to type-test, and the unwrap itself is outside
 * JSX, which `displayPosition` ignores on purpose. Worse, every earlier version of this gate
 * scanned `.tsx` only, so this file's ancestor was never opened.
 *
 * A fixture made only of `.tsx` would prove rule C while leaving the widened filter unproven,
 * which is why the witness now reads two files rather than one.
 *
 * The negative controls below are the reason the rule is narrow enough to keep: unwrapping a
 * `Verified<T>` in model code is not a defect — it is most of what model code does — and a
 * rule that said otherwise would be switched off within a week.
 */

import type { Verified } from '@bleavit/shared-types';

declare const roundNumber: Verified<number>;
declare const proposalId: Verified<string>;

/**
 * The shipped defect, reduced. `escalationConsequence(round)` was this function.
 */
// expect: C laundered
export function LaunderedSentence(): string {
  return `what is shown is the amount the chain holds for round ${roundNumber.value}.`;
}

/** The same leak via concatenation rather than a template — the rule is about the unwrap. */
// expect: C laundered
export function LaunderedConcatenation(): string {
  return 'Referendum ' + proposalId.value + ' is ready to execute.';
}

// ---------------------------------------------------------------------------
// Negative controls. Each is correct model code; a finding on any of them is a
// false positive and fails the witness.
// ---------------------------------------------------------------------------

/**
 * Unwrapping to compute a **number** is ordinary model work and reaches no screen as text.
 * Measured: 125 such unwraps exist across the app's five rendering projects.
 */
export function ControlDerivesANumber(): number {
  return roundNumber.value + 1;
}

/**
 * Unwrapping to decide a **boolean** — a precondition check, the single most common shape in
 * `features/tx`, and never a display.
 */
export function ControlDecidesAPrecondition(): boolean {
  return roundNumber.value > 0;
}

/**
 * Returning the `Verified<T>` itself is the sanctioned path: the badge travels with the value
 * and a `ui` component renders both. A rule that fired here would forbid the correct answer.
 */
export function ControlKeepsTheWrapper(): Verified<number> {
  return roundNumber;
}

/**
 * A string that is **not** built from a chain read. Fixed copy is exactly the repair rule C
 * asks for, so the gate must be silent on it — otherwise the fix reproduces the finding.
 */
export function ControlFixedCopy(): string {
  return 'The ladder is fixed when the game opens and this client does not predict it.';
}
