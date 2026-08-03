/**
 * The guarded 64.64 fixed-point kernel — 04 §4, 15 §4.8.
 *
 * ## Why this is an integer port and not a `Decimal` one
 *
 * The obvious way to write LMSR math in TypeScript is in arbitrary-precision
 * decimals, and it would be *more* accurate than this. It would also be wrong
 * for the job. The client's task is to state what the runtime will charge
 * before the user signs (11 §11.3): `buy` refuses when `cost + fee > max_cost`
 * (04 §6.1 step 4), so a quote that is a base unit under the chain's own
 * figure hands the user a transaction that reverts. Three separate roundings
 * decide that last base unit — `fx` floors base units into 64.64, the 1e6
 * scaling truncates, and the charge ceils — and none of them is recoverable
 * from a more precise answer. Reproducing the runtime's integer path is the
 * only way to land on its integer result.
 *
 * `bigint` makes that exact: every intermediate the runtime computes in
 * `u128`/`u256` is computed here in exactly the same order, and the `u128`
 * ceilings are enforced rather than exceeded, so an input the chain rejects for
 * overflow is rejected here too instead of quietly quoting a number no
 * extrinsic could produce.
 *
 * ## What is normative and what is not
 *
 * 04 §4 fixes the *bounds*, not the method: `exp2` relative error ≤ 2⁻⁶³,
 * `log2`/`ln` ≤ 2 ulp absolute, composed cost ≤ 8 ulp. The bounds are what
 * `tests/protocol` certifies against the reference corpus (04 §5). The
 * guarded-Q96 method below — 32 guard bits, one final rounding — is the
 * reference configuration named in that same section, chosen here because
 * matching the runtime bit-for-bit is the point.
 *
 * @see docs/architecture/04-markets-and-pricing.md §4
 */

import { fixedFault } from './errors.js';

/** Fractional bits in the 64.64 representation (04 §4). */
export const FRAC_BITS = 64n;
/** `1.0` in raw 64.64. */
export const ONE_RAW = 1n << FRAC_BITS;

/** Guard bits carried beyond the 64 result bits (04 §4 reference configuration). */
const GUARD_BITS = 32n;
/** Internal fractional bits for the `exp2`/`log2` kernels. */
const INTERNAL_FRAC_BITS = FRAC_BITS + GUARD_BITS; // 96
/** `1.0` in the internal Q96 representation. */
const ONE_Q96 = 1n << INTERNAL_FRAC_BITS;
/** `round(ln 2 · 2^96)` — Q96 so `ln` stays ≤ 2 ulp on wide inputs. */
const LN2_Q96 = 54916777467707473351141471128n;

const U128_MAX = (1n << 128n) - 1n;
const U64_MAX = (1n << 64n) - 1n;

/**
 * `EXP2_FRAC_FACTORS_Q96[i] = round(2^{2^-(i+1)} · 2^96)`.
 *
 * The `exp2` fractional kernel multiplies in one factor per set bit of the
 * 64-bit fraction. The table needs no external oracle to check: `f[i]² ≈
 * f[i-1]` and `f[0]² ≈ 2` pin every entry to its neighbour, which is what
 * `tests/protocol` asserts — a transcription slip in any row breaks the chain
 * of squares at that row.
 */
const EXP2_FRAC_FACTORS_Q96: readonly bigint[] = [
  112045541949572279837463876455n, 94218694570555024373110687280n,
  86398923866664962375130072335n, 82735892943544661968409507608n,
  80963033366431698391403892407n, 80090900639232773493759855183n,
  79658363602065864296602447411n, 79442971854562650309779985388n,
  79335494482037593178543608469n, 79281810334857995344526032841n,
  79254981885274639038225885637n, 79241571065139888961741854322n,
  79234866506068713947867698354n, 79231514439261175779748764725n,
  79229838459036794155212045658n, 79229000482219122111440011082n,
  79228581497133874770443338218n, 79228372005422143143813826733n,
  79228267259773999700675265240n, 79228214887001858491551355114n,
  79228188700628770505088420373n, 79228175607445472165130168567n,
  79228169060854634408312904164n, 79228165787559418383175182041n,
  79228164150911861083921604088n, 79228163332588095112623330337n,
  79228162923426215296556284074n, 79228162718845276180918278822n,
  79228162616554806821198155068n, 79228162565409572190862812835n,
  79228162539836954888076321620n, 79228162527050646239778370987n,
  79228162520657491916403219414n, 79228162517460914754909099563n,
  79228162515862626174210403621n, 79228162515063481883873146647n,
  79228162514663909738707540908n, 79228162514464123666125493726n,
  79228162514364230629834659057n, 79228162514314284111689288953n,
  79228162514289310852616615709n, 79228162514276824223080282038n,
  79228162514270580908312115941n, 79228162514267459250928033077n,
  79228162514265898422235991691n, 79228162514265118007889971010n,
  79228162514264727800716960672n, 79228162514264532697130455504n,
  79228162514264435145337202920n, 79228162514264386369440576628n,
  79228162514264361981492263482n, 79228162514264349787518106909n,
  79228162514264343690531028622n, 79228162514264340642037489479n,
  79228162514264339117790719908n, 79228162514264338355667335122n,
  79228162514264337974605642729n, 79228162514264337784074796532n,
  79228162514264337688809373434n, 79228162514264337641176661885n,
  79228162514264337617360306111n, 79228162514264337605452128223n,
  79228162514264337599498039280n, 79228162514264337596520994808n,
];

declare const FIXED_64X64: unique symbol;

/**
 * A raw unsigned 64.64 value.
 *
 * Branded, because the one mistake this module cannot afford is a caller
 * handing a base-unit balance to a function expecting 64.64. Nothing about the
 * two types differs structurally — both are non-negative `bigint`s — and the
 * error is silent and off by a factor of 2⁶⁴/10⁶. The brand costs nothing at
 * runtime and makes that substitution a compile error.
 */
export type Fixed = bigint & { readonly [FIXED_64X64]: 'q64.64' };

/** The only site that mints the brand; range-checks as it does. */
function brand(raw: bigint): Fixed {
  if (raw < 0n || raw > U128_MAX) {
    throw fixedFault('Overflow', `64.64 value out of u128 range: ${raw}`);
  }
  return raw as Fixed;
}

/** Wrap a raw 64.64 integer. */
export function fromRaw(raw: bigint): Fixed {
  return brand(raw);
}

/** Unwrap to the raw 64.64 integer. */
export function toRaw(value: Fixed): bigint {
  return value;
}

/** `value` as a whole number in 64.64 (`FixedU64x64::from_integer`). */
export function fromInteger(value: bigint): Fixed {
  if (value < 0n || value > U64_MAX) {
    throw fixedFault('Overflow', `integer out of u64 range: ${value}`);
  }
  return brand(value << FRAC_BITS);
}

/** `0.0`. */
export const ZERO: Fixed = brand(0n);
/** `1.0`. */
export const ONE: Fixed = brand(ONE_RAW);
/** `ln 2` as 64.64, for consumers needing `b·ln 2` in currency units. */
export const LN_2: Fixed = brand(12786308645202655660n);

/** `a + b`; overflow past `u128` is a fault, never a wrap. */
export function add(a: Fixed, b: Fixed): Fixed {
  return brand(a + b);
}

/**
 * `a − b`.
 *
 * Underflow is `Domain`, not `Overflow` — see `marketCodeForFixedError`. The
 * runtime makes the same choice and it is load-bearing: it is how a quantity
 * walking off the representable band surfaces as `PriceBoundExceeded`.
 */
export function sub(a: Fixed, b: Fixed): Fixed {
  if (a < b) {
    throw fixedFault('Domain', `64.64 subtraction underflow: ${a} − ${b}`);
  }
  return brand(a - b);
}

/** `a · b`, truncating the 256-bit product back to 64.64. */
export function mul(a: Fixed, b: Fixed): Fixed {
  return brand((a * b) >> FRAC_BITS);
}

/** `a / b`, flooring. */
export function div(a: Fixed, b: Fixed): Fixed {
  if (b === 0n) {
    throw fixedFault('DivisionByZero', '64.64 division by zero');
  }
  return brand((a << FRAC_BITS) / b);
}

/** Index of the highest set bit, plus one. `value` must be positive. */
function bitLength(value: bigint): bigint {
  let remaining = value;
  let bits = 0n;
  for (const shift of [64n, 32n, 16n, 8n, 4n, 2n, 1n]) {
    if (remaining >> shift) {
      remaining >>= shift;
      bits += shift;
    }
  }
  return bits + 1n;
}

/** Multiply two Q96 values, rounding the 192-bit product back to Q96. */
function mulQ96Round(lhs: bigint, rhs: bigint): bigint {
  const product = lhs * rhs;
  const truncated = product >> INTERNAL_FRAC_BITS;
  const rounded = truncated + ((product >> (INTERNAL_FRAC_BITS - 1n)) & 1n);
  if (rounded > U128_MAX) {
    throw fixedFault('Overflow', 'Q96 product out of u128 range');
  }
  return rounded;
}

/** Round a Q96 value in `[2^96, 2^97)` to Q64. */
function roundQ96ToQ64(valueQ96: bigint): bigint {
  return (valueQ96 >> GUARD_BITS) + ((valueQ96 >> (GUARD_BITS - 1n)) & 1n);
}

/**
 * `2^(frac / 2^64)` in Q96 for `frac ∈ [0, 2^64)`; result in `[2^96, 2^97)`.
 *
 * Bit `63-i` of the fraction carries weight `2^-(i+1)`, so a set bit multiplies
 * in `2^{2^-(i+1)}`.
 */
function exp2FracQ96(frac: bigint): bigint {
  let acc = ONE_Q96;
  for (let i = 0n; i < 64n; i += 1n) {
    if ((frac >> (63n - i)) & 1n) {
      const factor = EXP2_FRAC_FACTORS_Q96[Number(i)];
      if (factor === undefined) {
        throw fixedFault('Overflow', 'exp2 factor table is short');
      }
      acc = mulQ96Round(acc, factor);
    }
  }
  return acc;
}

/** `2^value` for non-negative `value`. */
export function exp2(value: Fixed): Fixed {
  const whole = value >> FRAC_BITS;
  if (whole >= 64n) {
    throw fixedFault('Overflow', `exp2 argument too large: ${value}`);
  }
  const frac = value & (ONE_RAW - 1n);
  const kernelQ64 = roundQ96ToQ64(exp2FracQ96(frac));
  return brand(kernelQ64 * (1n << whole));
}

/**
 * `2^(−value)` for non-negative `value`, in `(0, 1]`.
 *
 * Uses `2^{-(w+f)} = 2^{-(w+1)} · 2^{1-f}` so the same `[1,2)` kernel serves the
 * negative path with no reciprocal division.
 */
export function exp2Negative(value: Fixed): Fixed {
  const whole = value >> FRAC_BITS;
  const frac = value & (ONE_RAW - 1n);
  const kernelQ96 = frac === 0n ? ONE_Q96 : exp2FracQ96(ONE_RAW - frac);
  const expShift = frac === 0n ? whole : whole + 1n;
  const totalShift = expShift + GUARD_BITS;
  if (totalShift >= 256n) {
    return ZERO;
  }
  const truncated = kernelQ96 >> totalShift;
  return brand(truncated + ((kernelQ96 >> (totalShift - 1n)) & 1n));
}

/** `log2 value` for `value ≥ 1`; below 1 the result is negative and unrepresentable. */
export function log2(value: Fixed): Fixed {
  if (value === 0n) {
    throw fixedFault('Domain', 'log2 of zero');
  }
  const integer = bitLength(value) - 1n - FRAC_BITS;
  if (integer < 0n) {
    throw fixedFault('Domain', `log2 of a value below 1: ${value}`);
  }

  // Normalize the mantissa into Q96 in [2^96, 2^97) without dropping bits.
  let norm =
    integer <= GUARD_BITS
      ? value << (GUARD_BITS - integer)
      : (value >> (integer - GUARD_BITS)) + ((value >> (integer - GUARD_BITS - 1n)) & 1n);

  let fraction = 0n;
  for (let i = 0n; i < 64n; i += 1n) {
    norm = mulQ96Round(norm, norm);
    if (norm >= ONE_Q96 << 1n) {
      norm = (norm + 1n) >> 1n;
      fraction |= 1n << (63n - i);
    }
  }
  // Round the 64-bit fraction to nearest by inspecting the 65th bit.
  norm = mulQ96Round(norm, norm);
  if (norm >= ONE_Q96 << 1n) {
    fraction += 1n;
  }

  return brand((integer << FRAC_BITS) + fraction);
}

/** `ln value`, via `log2 · ln 2` at Q96 so the constant costs no accuracy. */
export function ln(value: Fixed): Fixed {
  if (value === 0n) {
    throw fixedFault('Domain', 'ln of zero');
  }
  const product = log2(value) * LN2_Q96;
  const truncated = product >> INTERNAL_FRAC_BITS;
  return brand(truncated + ((product >> (INTERNAL_FRAC_BITS - 1n)) & 1n));
}

/** `ln(1 + x)`, the log-sum-exp tail of the LMSR cost function. */
export function lnOnePlus(x: Fixed): Fixed {
  return ln(add(ONE, x));
}

/**
 * Round a charge **up** to whole units (04 §4: charges round against the payer,
 * in escrow's favour).
 */
export function roundChargeUp(value: Fixed): bigint {
  const whole = value >> FRAC_BITS;
  return (value & (ONE_RAW - 1n)) === 0n ? whole : whole + 1n;
}

/** Round a payout **down** to whole units (04 §4). */
export function roundPayoutDown(value: Fixed): bigint {
  return value >> FRAC_BITS;
}
