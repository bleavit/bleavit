/**
 * Value formatting for the render layer — integer-only, locale-independent, total.
 *
 * ## Why not `Intl` / `toLocaleString`
 *
 * The same balance would render differently on two devices, and a user comparing what
 * their client shows against what somebody else's shows — or against a block explorer —
 * would be reading a difference that is not there. A verifiable client whose numbers
 * depend on a browser's locale database has given up something for nothing. Grouping is
 * therefore a plain comma, always.
 *
 * ## Why every decimal place is rendered
 *
 * These are money base units. `1.000000` is noisier than `1`, and it is also the only
 * form in which two amounts line up digit for digit — which is what makes a residual dust
 * balance visible instead of rounding to a confident-looking zero. 04 §6.1 decides trades
 * on the last base unit, so the display does not get to decide that unit is uninteresting.
 *
 * ## Why `decimals` is an argument with no default
 *
 * App-code rule 7: a chain tunable with a default is a stale launch value waiting to be
 * baked in. `ui` is a render layer and reads no chain state, so the caller — which does —
 * supplies the width. A caller that forgets gets a type error.
 */

/** The widest decimal width this formatter accepts. Guards against a nonsense argument. */
const MAX_DECIMALS = 38;

function groupThousands(digits: string): string {
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    // Insert before every third digit counted from the right, except at the very start.
    const fromRight = digits.length - i;
    if (i > 0 && fromRight % 3 === 0) out += ',';
    out += digits[i];
  }
  return out;
}

/**
 * Render a signed base-unit integer at a fixed decimal width.
 *
 * Total over every `bigint`: there is no overflow to guard, no rounding, and no path that
 * returns `NaN` — which is the entire reason the client's money path is `bigint` and not
 * `number` (a `2**53` balance is not a hypothetical on a 6-decimal asset).
 */
export function formatBaseUnits(value: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
    throw new RangeError(`decimals must be an integer in [0, ${MAX_DECIMALS}], got ${decimals}`);
  }
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = groupThousands((magnitude / scale).toString());
  const sign = negative ? '-' : '';
  if (decimals === 0) return `${sign}${whole}`;
  const fraction = (magnitude % scale).toString().padStart(decimals, '0');
  return `${sign}${whole}.${fraction}`;
}

/** A plain integer count — grouped, never abbreviated ("1.2k" loses the count). */
export function formatCount(value: number | bigint): string {
  const asBigInt = typeof value === 'bigint' ? value : BigInt(value);
  const negative = asBigInt < 0n;
  const digits = groupThousands((negative ? -asBigInt : asBigInt).toString());
  return negative ? `-${digits}` : digits;
}

/**
 * A hash, account or id shown short — head and tail, never a bare prefix.
 *
 * A prefix-only truncation is forgeable: an attacker grinds an address sharing the first
 * eight characters and the user reads two identical-looking strings. Head *and* tail costs
 * the attacker both ends, and the full value stays available as the accessible name.
 */
export function abbreviateIdentifier(value: string, keep = 6): string {
  if (keep < 4) throw new RangeError(`keep must be at least 4, got ${keep}`);
  // 2 * keep + the ellipsis: below that the abbreviation is longer than the original.
  if (value.length <= keep * 2 + 1) return value;
  return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}

/** Parts-per-million as a percentage, exactly — 2,500 ppm renders `0.2500 %`. */
export function formatPpm(ppm: number | bigint): string {
  const asBigInt = typeof ppm === 'bigint' ? ppm : BigInt(ppm);
  // ppm → percent is a division by 10,000, i.e. four decimal places. Done on integers so
  // the last digit is the one the chain has, not the one a float chose.
  return `${formatBaseUnits(asBigInt, 4)} %`;
}
