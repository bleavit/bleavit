//! Architecture 16 §5 / 05 §5.6 manipulation-certificate arithmetic.

use core::cmp;

use futarchy_fixed::{round_payout_down, FixedError, FixedU64x64, FRAC_BITS, PRIMITIVE_MAX_ULP};
use futarchy_primitives::{kernel, Balance, FixedU64};
use parity_scale_codec::{Decode, DecodeWithMemTracking, Encode, MaxEncodedLen};
use scale_info::TypeInfo;

/// One decision book as 05 §5.6 prices the outcome the attacker must buy.
///
/// For the ACCEPT book this is the LONG TWAP. For the REJECT book it is the
/// SHORT TWAP, i.e. `1 - twap_reject_1e9` (05 §5.6, SQ-544).
#[derive(
    Clone,
    Copy,
    Debug,
    Decode,
    DecodeWithMemTracking,
    Encode,
    Eq,
    MaxEncodedLen,
    PartialEq,
    TypeInfo,
)]
pub struct ManipulationBook {
    pub b: Balance,
    pub bought_outcome_twap_1e9: FixedU64,
}

fn scaled_1e9_down(value: FixedU64) -> FixedU64x64 {
    FixedU64x64::from_raw((u128::from(value.0) << FRAC_BITS) / u128::from(kernel::SCORE_SCALE))
}

fn balance_as_fixed(value: Balance) -> Result<FixedU64x64, FixedError> {
    let value = u64::try_from(value).map_err(|_| FixedError::Overflow)?;
    Ok(FixedU64x64::from_integer(value))
}

/// A conservative lower endpoint for `ln(x)` under 04 §4's absolute error
/// contract. `futarchy-fixed::ln` is nearest within two ulp; subtracting that
/// full allowance makes a sold lower bound unable to round high.
fn ln_down(value: FixedU64x64) -> Result<FixedU64x64, FixedError> {
    let approximate = value.ln()?;
    Ok(FixedU64x64::from_raw(
        approximate
            .raw()
            .saturating_sub(u128::from(PRIMITIVE_MAX_ULP)),
    ))
}

fn ceil_div(numerator: u128, denominator: u128) -> Result<u128, FixedError> {
    if denominator == 0 {
        return Err(FixedError::DivisionByZero);
    }
    let quotient = numerator / denominator;
    quotient
        .checked_add(u128::from(numerator % denominator != 0))
        .ok_or(FixedError::Overflow)
}

/// Architecture 16 §5.1's cash manipulation floor, in USDC base units.
///
/// ```text
/// C_disp = Σ b·ln((1-p*)/(1-p*-ε))
/// C_hold = min(contest_capital, flow_cap·Σb)·ε
/// ```
///
/// Every conversion and product rounds down, including the documented `ln`
/// approximation allowance. `books` is an array because a hosted question has
/// exactly two books (16 §7.6); a missing third-party bound cannot widen it.
fn manipulation_components(
    books: &[ManipulationBook; 2],
    epsilon: FixedU64,
    contest_capital: Balance,
    flow_cap: FixedU64,
) -> Result<(FixedU64x64, FixedU64x64), FixedError> {
    if epsilon.0 == 0 || epsilon.0 >= kernel::SCORE_SCALE {
        return Err(FixedError::Domain);
    }
    let epsilon_fixed = scaled_1e9_down(epsilon);

    let mut displacement = FixedU64x64::ZERO;
    let mut total_b: Balance = 0;
    for book in books {
        if book.b == 0
            || book.bought_outcome_twap_1e9.0 == 0
            || book.bought_outcome_twap_1e9.0 >= kernel::SCORE_SCALE
            || book
                .bought_outcome_twap_1e9
                .0
                .checked_add(epsilon.0)
                .is_none_or(|moved| moved >= kernel::SCORE_SCALE)
        {
            return Err(FixedError::Domain);
        }

        let price = scaled_1e9_down(book.bought_outcome_twap_1e9);
        let complement = FixedU64x64::ONE.checked_sub(price)?;
        let moved_complement = complement.checked_sub(epsilon_fixed)?;
        let ratio = complement.checked_div(moved_complement)?;
        let cash_log = ln_down(ratio)?;
        displacement =
            displacement.checked_add(balance_as_fixed(book.b)?.checked_mul(cash_log)?)?;
        total_b = total_b.checked_add(book.b).ok_or(FixedError::Overflow)?;
    }

    let flow_limited = balance_as_fixed(total_b)?.checked_mul(scaled_1e9_down(flow_cap))?;
    let contest = balance_as_fixed(contest_capital)?;
    let held = cmp::min(contest, flow_limited).checked_mul(epsilon_fixed)?;
    Ok((displacement, held))
}

/// Client-funded displacement component used by the certification predicate.
/// Organic contest capital is deliberately excluded (16 §5.2).
pub fn displacement_floor(
    books: &[ManipulationBook; 2],
    epsilon: FixedU64,
) -> Result<Balance, FixedError> {
    manipulation_components(books, epsilon, 0, FixedU64(0))
        .map(|(displacement, _)| round_payout_down(displacement))
}

pub fn manip_floor(
    books: &[ManipulationBook; 2],
    epsilon: FixedU64,
    contest_capital: Balance,
    flow_cap: FixedU64,
) -> Result<Balance, FixedError> {
    let (displacement, held) = manipulation_components(books, epsilon, contest_capital, flow_cap)?;
    Ok(round_payout_down(displacement.checked_add(held)?))
}

/// Architecture 16 §5.2's minimum equal per-book liquidity, in USDC base
/// units, rounded upward on the same conservative fixed-point grid used by
/// [`manip_floor`].
///
/// `b_min = ceil(SECURITY_FACTOR·S / (2·ln(0.5/(0.5-ε))))`.
pub fn b_min(stake: Balance, epsilon: FixedU64) -> Result<Balance, FixedError> {
    if epsilon.0 == 0 || epsilon.0 >= kernel::SCORE_SCALE / 2 {
        return Err(FixedError::Domain);
    }

    let half = FixedU64x64::from_raw(1u128 << (FRAC_BITS - 1));
    let denominator = half.checked_sub(scaled_1e9_down(epsilon))?;
    let cash_log = ln_down(half.checked_div(denominator)?)?;
    let twice_log_raw = cash_log.raw().checked_mul(2).ok_or(FixedError::Overflow)?;
    let required = stake
        .checked_mul(kernel::SECURITY_FACTOR)
        .ok_or(FixedError::Overflow)?;
    if required == 0 {
        return Ok(0);
    }
    if required > u128::from(u64::MAX) {
        return Err(FixedError::Overflow);
    }

    // `required << 64` is safe after the explicit u64 bound above. Solving on
    // raw fixed units avoids a truncating fixed-point division before the
    // claimant-adverse integer ceiling.
    ceil_div(required << FRAC_BITS, twice_log_raw)
}

/// The report's `certified` relation, with overflow refusing rather than
/// wrapping the right-hand side to an easier threshold.
pub fn certified(manipulation_floor: Balance, stake: Balance) -> Result<bool, FixedError> {
    let required = stake
        .checked_mul(kernel::SECURITY_FACTOR)
        .ok_or(FixedError::Overflow)?;
    Ok(manipulation_floor >= required)
}

#[cfg(test)]
mod tests {
    use super::*;
    use futarchy_primitives::currency;

    const HALF: FixedU64 = FixedU64(kernel::SCORE_SCALE / 2);

    fn symmetric_books(b: Balance) -> [ManipulationBook; 2] {
        [
            ManipulationBook {
                b,
                bought_outcome_twap_1e9: HALF,
            },
            ManipulationBook {
                b,
                bought_outcome_twap_1e9: HALF,
            },
        ]
    }

    #[test]
    fn published_b_min_multiples_round_up_to_the_table() -> Result<(), FixedError> {
        for (epsilon, expected_base_units, expected_cents) in [
            (FixedU64(20_000_000), 36_744_898u128, 3_675u128),
            (FixedU64(50_000_000), 14_236_833u128, 1_424u128),
            (FixedU64(100_000_000), 6_722_131u128, 673u128),
        ] {
            let minimum = b_min(currency::USDC, epsilon)?;
            assert_eq!(minimum, expected_base_units);
            let displayed_cents = minimum.div_ceil(currency::USDC_CENT);
            assert_eq!(displayed_cents, expected_cents);

            let floor = manip_floor(&symmetric_books(minimum), epsilon, 0, FixedU64(0))?;
            assert!(certified(floor, currency::USDC)?);
            if minimum > 0 {
                let lower = manip_floor(&symmetric_books(minimum - 1), epsilon, 0, FixedU64(0))?;
                assert!(!certified(lower, currency::USDC)?);
            }
        }
        Ok(())
    }

    #[test]
    fn published_cash_floors_are_not_share_displacements() -> Result<(), FixedError> {
        let books = symmetric_books(10_000 * currency::USDC);
        assert_eq!(
            manip_floor(&books, FixedU64(20_000_000), 0, FixedU64(16_000_000_000))?,
            816_439_890
        );
        assert_eq!(
            manip_floor(&books, FixedU64(50_000_000), 0, FixedU64(16_000_000_000))?,
            2_107_210_313
        );
        assert_eq!(
            manip_floor(&books, FixedU64(100_000_000), 0, FixedU64(16_000_000_000))?,
            4_462_871_026
        );
        Ok(())
    }

    #[test]
    fn hold_leg_is_capped_before_multiplying_by_epsilon() -> Result<(), FixedError> {
        let books = symmetric_books(100 * currency::USDC);
        let epsilon = FixedU64(100_000_000);
        let displacement = manip_floor(&books, epsilon, 0, FixedU64(1_000_000_000))?;
        let capped = manip_floor(
            &books,
            epsilon,
            1_000 * currency::USDC,
            FixedU64(1_000_000_000),
        )?;
        assert_eq!(capped - displacement, 20 * currency::USDC);
        Ok(())
    }

    #[test]
    fn invalid_domains_and_overflow_refuse() {
        let zero_b = symmetric_books(0);
        assert_eq!(
            manip_floor(&zero_b, FixedU64(20_000_000), 0, FixedU64(0)),
            Err(FixedError::Domain)
        );
        assert_eq!(b_min(currency::USDC, FixedU64(0)), Err(FixedError::Domain));
        assert_eq!(
            b_min(currency::USDC, FixedU64(kernel::SCORE_SCALE / 2)),
            Err(FixedError::Domain)
        );
        assert_eq!(certified(0, u128::MAX), Err(FixedError::Overflow));
    }
}
