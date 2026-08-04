/**
 * `Constitution.PhaseFlags` — the frozen u32 bitset of 02 §7.3.
 *
 * ## The defect this file exists to correct
 *
 * The shell's first version modelled this as a **governance phase number** and showed the
 * sudo banner while `phase < 4`. The chain publishes a **bitset**, and sudo-present is
 * **bit 4** — so the wrong reading and the right one share the digit 4, which is precisely
 * how it survived: the code looked like it referenced the right thing.
 *
 * It was found by decoding the recorded value with the real codec rather than by reading
 * the shell again: `storage.constitution.phase_flags` records `0x11000000`, which decodes
 * to `17` = `0b10001` — shadow mode plus sudo present. Under the old reading, `17 >= 4`
 * would have **hidden the banner on a chain with sudo active**, which is the one direction
 * 11 §11.10 cannot tolerate.
 *
 * ## Why the bit values are compiled in, and why that is not a hardcoded chain value
 *
 * 10 §5.4 forbids the frontend a chain literal, and these are not one. A bit *assignment*
 * is wire format frozen in 02 §7.3 — the same class as a call index or a type layout, not a
 * tunable a governance track can move. There is no metadata constant to read them from
 * because there is nothing to read: the number `1 << 4` is not a value the chain holds, it
 * is how the chain's answer is spelled.
 *
 * What keeps that honest is that the table below is **bound to 02 §7.3's own sentence** by
 * `app/tests/screens`, which parses the assignments out of the document and requires this
 * map to match it exactly. A bit reassigned or appended in the spec fails the suite rather
 * than silently disagreeing with the runtime.
 */

/**
 * Every assignment 02 §7.3 freezes, keyed by **the document's exact wording**.
 *
 * Including the parenthetical on bit 5, which reads oddly as a key and is deliberate: the
 * suite compares these strings against the sentence in 02 §7.3 verbatim, so there is no
 * normalisation step for a future rename to slip through. It caught the first version of
 * this table, which had shortened that name.
 *
 * Bits 8–31 are reserved and append-only, and are not named here — a client that named a
 * reserved bit would be claiming a meaning the contract has not assigned.
 */
export const PHASE_FLAG_BITS = Object.freeze({
  'shadow mode': 0,
  'PARAM armed': 1,
  'TREASURY armed': 2,
  'CODE/META armed': 3,
  'sudo present': 4,
  'ledger frozen (PB-LEDGER-FREEZE)': 5,
  'dead-man engaged': 6,
  'reserve-health flag': 7,
} as const);

export type PhaseFlagName = keyof typeof PHASE_FLAG_BITS;

/**
 * Test one flag.
 *
 * Takes the flag by **name**, so a call site cannot pass a bit index it worked out itself —
 * which is how `>= 4` came to stand in for bit 4 in the first place.
 */
export function hasPhaseFlag(flags: number, name: PhaseFlagName): boolean {
  // No `>>> 0` here, and its absence is deliberate. The first version normalised the sign
  // "in case a reserved bit becomes meaningful", and a mutation removing it survived — it
  // could not fail, because every named bit is 0–7, so `1 << bit` is positive and
  // `flags & positive` is non-negative whatever the sign of `flags`. A control that cannot
  // be exercised by any input this function accepts is dead code dressed as caution, and
  // the honest form is to say so. If a bit ≥ 31 is ever *named*, the sign question becomes
  // real and returns with a test that can fail.
  return (flags & (1 << PHASE_FLAG_BITS[name])) !== 0;
}

/** Every set flag this client knows a name for. Reserved bits are deliberately not named. */
export function namedPhaseFlags(flags: number): readonly PhaseFlagName[] {
  return (Object.keys(PHASE_FLAG_BITS) as PhaseFlagName[]).filter((name) =>
    hasPhaseFlag(flags, name),
  );
}

/**
 * Whether the bootstrap-governance banner must render (11 §11.10).
 *
 * `undefined` — the read failed or did not decode — returns **true**. INV-FE-12's
 * fail-closed direction: a client that cannot establish whether sudo is present must not
 * present the chain as though it is not.
 */
export function sudoActive(flags: number | undefined): boolean {
  if (flags === undefined) return true;
  return hasPhaseFlag(flags, 'sudo present');
}
