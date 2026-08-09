/**
 * Witness fixture for `check-style-coverage.ts` — deliberately broken, never mounted.
 *
 * Each element below exists to make exactly one of the gate's rules fire. If the gate stops
 * reporting any of them, the witness leg fails and the gate is treated as broken rather than
 * as passing, which is the whole point: a coverage check that cannot fail reports the same
 * thing on a styled tree and an unstyled one.
 */
export function Witness({ kind }: { readonly kind: string }) {
  return (
    <div>
      {/* (1) a class with no rule in the fixture stylesheet */}
      <span className="witness-unstyled-class">no rule exists for this</span>
      {/* (2) an interpolated family the fixture's DYNAMIC_FAMILIES does not declare */}
      <span className={`witness-undeclared witness-undeclared--${kind}`}>undeclared family</span>
      {/* (3) a declared family whose `--gone` variant has no rule */}
      <span className={`witness-declared witness-declared--${kind}`}>declared family</span>
    </div>
  );
}
