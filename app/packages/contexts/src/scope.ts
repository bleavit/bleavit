/**
 * Export scope and consent — 11 §11.14.4, 10 §13.1.
 *
 * *"Export requires per-export consent with the scope shown, and the default scope
 * excludes account-specific data — positions, balances and addresses are opt-in per
 * export, never included because the last export included them."*
 *
 * ## Why "never inherited" is a separate rule from "opt-in"
 *
 * Opt-in alone is satisfied by a checkbox that remembers. The clause forbids exactly
 * that: consent is **per export**, so the scope of the previous capsule may not become
 * the default of the next one. A remembered scope is how a user who once shared holdings
 * for a single question ends up shipping them to a third party every time afterwards,
 * having agreed once. `defaultScope()` therefore takes no previous scope and there is no
 * setter — a caller cannot supply last time's answer even by accident.
 *
 * ## Pseudonymization is offered and labelled, not sold
 *
 * 11 §11.14.4 requires it be offered for the account-bearing scopes **and** labelled for
 * what it is: it replaces the address and *does nothing about the holdings themselves,
 * which remain a fingerprint*. The honest framing is in the spec and is reproduced in the
 * label this module returns, because the failure mode is a user believing an anonymised
 * capsule is anonymous.
 *
 * What leaks is **linkage rather than content**: holdings on a public chain are already
 * public, but a capsule pasted into a hosted service ties them to an identity in a third
 * party's logs, and it cannot be un-sent.
 */

/** The account-bearing scopes — each opt-in, each per export. */
export const ACCOUNT_SCOPES = Object.freeze(['positions', 'balances', 'address'] as const);
/** Scopes that describe the chain rather than the user. */
export const PUBLIC_SCOPES = Object.freeze(['proposal', 'market', 'decision', 'epoch'] as const);

export type AccountScope = (typeof ACCOUNT_SCOPES)[number];
export type PublicScope = (typeof PUBLIC_SCOPES)[number];
export type ScopeKey = AccountScope | PublicScope;

export interface ExportScope {
  readonly included: readonly ScopeKey[];
  /** Applies to the account-bearing scopes only; a no-op without them. */
  readonly pseudonymized: boolean;
}

/**
 * The default scope for **every** export — public data only.
 *
 * Takes no arguments on purpose. A `defaultScope(previous)` signature is all it would
 * take to make consent sticky, and the clause this implements exists to prevent exactly
 * that.
 */
export function defaultScope(): ExportScope {
  return { included: [...PUBLIC_SCOPES], pseudonymized: false };
}

export function isAccountScope(scope: ScopeKey): scope is AccountScope {
  return (ACCOUNT_SCOPES as readonly string[]).includes(scope);
}

export function includesAccountData(scope: ExportScope): boolean {
  return scope.included.some(isAccountScope);
}

/**
 * The label shown beside the pseudonymization option.
 *
 * Returns `undefined` when nothing account-bearing is in scope — offering
 * pseudonymization for a capsule containing no account data would imply the capsule
 * otherwise identifies the user, which is its own kind of dishonesty.
 */
export function pseudonymizationLabel(scope: ExportScope): string | undefined {
  if (!includesAccountData(scope)) return undefined;
  return (
    'Replaces your address in this file. It does not hide your holdings, which remain a ' +
    'fingerprint — the amounts are already public on chain, but pasting them into a ' +
    'hosted service ties them to an identity in that service’s logs, and it cannot be un-sent.'
  );
}

export class ScopeError extends Error {}

/** Whether a string names a scope this release knows. A real runtime check, unlike a brand. */
function isScopeKey(key: string): key is ScopeKey {
  return (
    (ACCOUNT_SCOPES as readonly string[]).includes(key) ||
    (PUBLIC_SCOPES as readonly string[]).includes(key)
  );
}

/**
 * Build a scope from an explicit, per-export consent decision.
 *
 * `consented` is what the user chose *this time*. Anything not named is excluded, so an
 * account scope arrives only by being asked for — the default is not a starting point to
 * be edited but the answer when nothing was chosen.
 *
 * The parameter is `readonly string[]`, not `readonly ScopeKey[]`, and the difference is the
 * whole point of the unknown-key refusal below. Declaring the input already valid made that
 * branch unreachable from typed code — a validator whose signature asserts what it exists to
 * check — while the callers that actually carry an unknown key are precisely the untyped
 * ones: a consent list rehydrated from storage, parsed out of a document, or assembled from
 * checkbox ids. This is the same distinction `local-index` draws about `origin: 'self'`: the
 * union is a compile-time control, and it is not the control that catches this.
 */
export function scopeFromConsent(consented: readonly string[], pseudonymize = false): ExportScope {
  const unique = [...new Set(consented)];
  const included: ScopeKey[] = [];
  for (const key of unique) {
    if (!isScopeKey(key)) throw new ScopeError(`unknown export scope "${key}"`);
    included.push(key);
  }
  const scope: ExportScope = { included, pseudonymized: pseudonymize };
  // Pseudonymization without account data is a claim about nothing. Refusing it keeps
  // the flag meaning one thing.
  if (pseudonymize && !includesAccountData(scope)) {
    throw new ScopeError('pseudonymization applies to account-bearing scopes, and none is in scope');
  }
  return scope;
}
