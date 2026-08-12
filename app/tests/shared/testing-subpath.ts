/**
 * One assertion, applied to every package that quarantines something behind `/testing`.
 *
 * ## The hole this closes, measured rather than reasoned
 *
 * 10 §2.1 names a `package.json` `exports` map restricted to `"."` and `"./testing"` as one of
 * three enforcement layers, and five packages use it to keep a capability out of production
 * reach: `chain-client`'s `finalize` (mints `Finalized<T>`), `local-index`'s `selfRange` (mints
 * `origin: 'self'`), `signing`'s `MockSigner` (a signer that must never ship), and `providers`'
 * rate-taking sampling entry points (a way to switch the sampler off), plus
 * `transaction-builder`'s explicit-value `GatePassed` evaluator and edge enumerator.
 *
 * Each is guarded by a dependency-cruiser rule against importing the **subpath**. None of those
 * rules can see a **re-export**: one line in the package barrel — `export { finalize } from
 * './provenance.js'` — puts the capability in every consumer's reach with no subpath import
 * anywhere, no cast, and no forbidden edge. Measured on 2026-08-06 against `providers`: that
 * mutation survived `build`, `depcruise`, `depcruise:witness`, `test:firewall`, `check:casts`
 * and the whole suite set. The barrels defended themselves with a **comment**.
 *
 * ## Why it is one helper and not five tests
 *
 * Five hand-written tests are five chances to enumerate the names by hand, which is the second
 * half of the same defect: `providers`' first barrel test listed two names, so a third loosened
 * export would have slipped past it. This takes the whole `/testing` **namespace object** and
 * requires every key in it to be absent from the barrel, so a name added to the quarantine is
 * covered the moment it exists.
 *
 * ## The anti-vacuity legs are not decoration
 *
 * A disjointness assertion is satisfied perfectly by two empty objects — a `/testing` module that
 * exported nothing, or a barrel that failed to load, would pass silently. So both sides must be
 * non-empty, and the caller names production entry points the barrel MUST still export.
 *
 * Types are invisible here, and that is correct rather than a gap: a re-exported `type` has no
 * runtime representation and grants no capability. What must not leak is a **value**, and a value
 * is exactly what a namespace key is.
 */

export interface TestingSubpathClaim {
  /** For the failure message — the package whose quarantine this is. */
  readonly packageName: string;
  /** `import * as barrel from '@bleavit/x'`. */
  readonly barrel: Record<string, unknown>;
  /** `import * as testing from '@bleavit/x/testing'`. */
  readonly testing: Record<string, unknown>;
  /**
   * Names the barrel must still export.
   *
   * The anti-vacuity control for the barrel side: without it, a barrel that exported nothing at
   * all — a broken build, a renamed file — would satisfy every disjointness assertion below.
   */
  readonly barrelMustExport: readonly string[];
}

/**
 * Assert the `/testing` surface is disjoint from the package barrel.
 *
 * @param assertions the suite's own `node:assert/strict`, passed in rather than imported, so this
 * module stays a plain function and every failure is reported at the calling suite's location.
 */
export function assertTestingSubpathIsQuarantined(
  claim: TestingSubpathClaim,
  assertions: {
    equal: (actual: unknown, expected: unknown, message?: string) => void;
    ok: (value: unknown, message?: string) => void;
  },
): void {
  const quarantined = Object.keys(claim.testing);
  assertions.ok(
    quarantined.length > 0,
    `${claim.packageName}/testing exports nothing, so this assertion proves nothing`,
  );
  assertions.ok(
    claim.barrelMustExport.length > 0,
    `${claim.packageName}: name at least one production export, or a broken barrel passes`,
  );

  for (const name of quarantined) {
    assertions.equal(
      name in claim.barrel,
      false,
      `${claim.packageName} re-exports "${name}" from its barrel, so the /testing quarantine is ` +
        'decoration: every consumer holds it with no subpath import for any rule to catch',
    );
  }
  for (const name of claim.barrelMustExport) {
    assertions.equal(
      name in claim.barrel,
      true,
      `${claim.packageName} no longer exports "${name}" — the barrel under test is not the ` +
        'barrel this asserts about',
    );
  }
}
