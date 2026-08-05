/**
 * Provider health, sampling and the honest guarantee — 10 §8.1–§8.4. F9.
 *
 * ## Nothing here can make a value verified, and that is structural elsewhere
 *
 * `Finalized<T>` is constructible only inside `packages/chain-client` (10 §2.1), so this
 * package *cannot* produce one whatever it does — 10 §2.2's never-promote rule is enforced
 * by a symbol this module cannot name, not by a check it performs. What is left to F9 is
 * the part that can still go wrong: **what the client says about a provider**.
 *
 * ## The empty default is a value, not an absence
 *
 * > the app ships an EMPTY provider list. Providers are strictly opt-in in every mode.
 *
 * `defaultProviders()` returns an empty list from a function that takes **no argument it
 * could inherit from**, the same device `defaultScope()` uses for export consent. A
 * configurable default is exactly how "opt-in" quietly becomes "on for most people".
 *
 * ## Auto-disable carries a reason, always
 *
 * §8.3's ladder is `Healthy → Slow → Failing → Disabled(auto, reason)`. The reason is a
 * **required field** of the disabled state, so a provider cannot be switched off silently —
 * a user who sees a source vanish with no explanation reasonably concludes the app is
 * broken, and re-enables it.
 *
 * ## The guarantee statement is fixed copy and deliberately unflattering
 *
 * §8.4 makes it normative UI copy: sampling catches malformed, internally inconsistent and
 * shallow forgeries, and liveness failures — and **does not** detect a self-consistent
 * forgery of history at depth. That sentence is the honest limit of the mechanism, and a
 * client that omitted the second half would be claiming a guarantee the design explicitly
 * declines to make.
 */

/** §8.3's ladder. `disabled` carries why — it is not a bare state. */
export type ProviderHealth =
  | { readonly kind: 'healthy' }
  | { readonly kind: 'slow'; readonly observedMs: number }
  | { readonly kind: 'failing'; readonly consecutiveFailures: number }
  | {
      readonly kind: 'disabled';
      /** `auto` when the client disabled it; `user` when the user did. */
      readonly by: 'auto' | 'user';
      /** Required. A source that vanishes unexplained reads as a broken app. */
      readonly reason: string;
    };

export interface Provider {
  readonly id: string;
  readonly kind: 'snapshot' | 'indexer';
  readonly health: ProviderHealth;
}

/**
 * The shipped provider list.
 *
 * Takes **no argument**, so there is nothing for a build, a release channel or a previous
 * session to inherit a default from. 10 §8.1: strictly opt-in in every mode.
 */
export function defaultProviders(): readonly Provider[] {
  return [];
}

/** §8.4's normative UI copy, in one place, including the half that is unflattering. */
export const SAMPLING_GUARANTEE =
  'Spot-checking catches malformed data, internally inconsistent data, shallow forgeries ' +
  'and a source that has stopped responding. It does not detect a self-consistent forgery ' +
  'of history at a depth this device cannot reach on its own. The only cross-check for deep ' +
  'history is comparing two independent sources, which this client supports and labels.';

/** What a sampling round found. */
export interface SampleResult {
  readonly rowsChecked: number;
  readonly mismatches: number;
  /** Rows whose referenced object no longer exists, so nothing could be compared. */
  readonly unverifiable: number;
}

/**
 * Whether a sampling round should auto-disable the provider.
 *
 * **Any** mismatch disables: §8.3 says "auto-disable on sampling mismatch", with no
 * threshold, and a threshold is what turns one caught lie into an acceptable error rate.
 *
 * `unverifiable` rows do **not** count toward or against it. A row whose object is gone
 * proves nothing either way, and treating it as a pass would let a provider evade sampling
 * by serving only unverifiable rows — which is the cheapest available evasion.
 */
export function shouldAutoDisable(result: SampleResult): boolean {
  return result.mismatches > 0;
}

/**
 * The sampling coverage actually achieved, as a fraction of rows that *could* be checked.
 *
 * Reported separately from the pass/fail so a round that verified almost nothing is
 * visible as such. A round of 100 rows where 98 were unverifiable is not a 100-row check,
 * and calling it one is the "passes by shrinking" shape this repository keeps refusing.
 */
export function effectiveCoverage(result: SampleResult): {
  readonly checked: number;
  readonly ofTotal: number;
  readonly meaningful: boolean;
} {
  const checked = result.rowsChecked - result.unverifiable;
  return {
    checked,
    ofTotal: result.rowsChecked,
    // Fewer than half the rows actually comparable makes the round weak evidence. Stated
    // rather than hidden, so a green sample cannot stand in for a check that did not happen.
    meaningful: result.rowsChecked > 0 && checked * 2 >= result.rowsChecked,
  };
}

/** Advance the ladder from a sampling round. */
export function afterSampling(provider: Provider, result: SampleResult): Provider {
  if (shouldAutoDisable(result)) {
    return {
      ...provider,
      health: {
        kind: 'disabled',
        by: 'auto',
        reason:
          `${result.mismatches} of ${result.rowsChecked} spot-checked rows did not match ` +
          'what this device read from the chain. The source is switched off; nothing it ' +
          'supplied was ever treated as verified.',
      },
    };
  }
  return provider;
}
