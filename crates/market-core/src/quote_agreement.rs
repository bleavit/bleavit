//! The chain↔client quote-agreement fixture — 02 §4, 04 §6.1, 15 §4.8.
//!
//! ## What this exists to catch, and why the reference corpus cannot catch it
//!
//! `reference-model/fixtures/vectors.json` certifies that an implementation's
//! *mathematics* is right, to the 04 §4 error bounds. It says nothing about the
//! layer above: which roundings are applied in which order, which failure fires
//! first, and whether a per-trade bound is a refusal or a datum. Those are
//! decisions of [`quote`], and a client can reproduce every vector in the
//! corpus while disagreeing with the runtime about all of them.
//!
//! That is not hypothetical. Building `app/packages/protocol` (F5), the TS port
//! passed all 1,286 corpus rows and both differed from this function: it
//! *refused* an order above `MaxTrade` where [`quote`] prices it and publishes
//! `max_trade` as data (02 §4 / 11 §11.5 P-1 keep the two apart deliberately —
//! a client must be able to say "your order exceeds the cap, and here is what
//! the cap would cost"), and it reported an oversized sell as
//! `PriceBoundExceeded` where the runtime underflows a `Balance` first and
//! returns `ArithmeticOverflow`. Both are user-visible; neither is a
//! mathematical error.
//!
//! So this module emits what the runtime actually answers, for a case set that
//! deliberately includes states off the whole-USDC grid, and pins it to a
//! committed file. The Rust suite checks the file still describes this runtime;
//! `app/tests/protocol/chain-agreement.test.js` checks the client still agrees
//! with the file. Neither job needs the other's toolchain, and either one going
//! red names the side that moved.
//!
//! Regenerate with `BLEAVIT_WRITE_QUOTE_FIXTURE=1 cargo test -p market-core
//! quote_agreement`. Every number is written as a **string**: the raw 64.64
//! values run past 2⁵³ and JavaScript would silently round them (PLAN.md V-74).
//!
//! One observation the generated rows make plain, recorded here because it is
//! easy to misread the fixture otherwise: `within_domain` never comes back
//! `false`. [`quote`] computes the cost first, and `lmsr_buy_cost` evaluates the
//! *post-trade* state, so a buy that would leave the `48·b` domain fails with
//! `PriceBoundExceeded` before the flag is reached; a sell only moves the state
//! inward. The field is a conservative always-true on the `Ok` path rather than
//! a live predicate. That is not a contract violation — 02 §4 freezes the field,
//! not a requirement that it vary — but a client must not treat it as the
//! domain check. The refusal is the domain check.

use crate::{fx, lmsr_cost, lmsr_price_long, quote, BookKind, Error, MarketBook};
use futarchy_primitives::{Balance, TradeSide};

/// Where the fixture lives, relative to this crate.
const FIXTURE: &str = "fixtures/chain-quote-agreement.json";

/// Schema id. Rows are append-only within a major, as 04 §5 has it for the
/// reference corpus — a client pinned to v1 must keep reading a grown file.
const SCHEMA: &str = "bleavit.chain-quote-agreement.v1";

const FEE_BPS: u128 = 30;

/// `(name, q_long, q_short, b, amount)` — base units throughout.
///
/// Chosen for the roundings rather than for round numbers: rows 3, 4 and 7 sit
/// off the whole-USDC grid so the `fx` floor and the ×10⁶ truncation both bite,
/// row 8 sits exactly on the `48·b` domain edge, and row 7's book is smaller
/// than the trade so the base-unit underflow path is reached.
const CASES: [(&str, Balance, Balance, Balance, Balance); 8] = [
    ("symmetric_start", 0, 0, 10_000_000_000, 1_000_000_000),
    (
        "after_v1_buy",
        1_000_000_000,
        0,
        10_000_000_000,
        500_000_000,
    ),
    (
        "sub_unit_both_sides",
        1_234_567,
        7_654_321,
        10_000_000_000,
        3_333_333,
    ),
    ("sub_unit_small_book", 999_999, 1, 4_000_000_000, 1_000_001),
    (
        "max_trade_on_a_large_book",
        0,
        0,
        25_000_000_000,
        6_250_000_000,
    ),
    (
        "deep_book_both_sides",
        123_456_789_012,
        98_765_432_109,
        250_000_000_000,
        12_345_678_901,
    ),
    ("book_smaller_than_the_trade", 7, 3, 1_000_000, 1_000_000),
    (
        "exactly_on_the_domain_edge",
        48_000_000_000,
        0,
        1_000_000_000,
        1_000_000,
    ),
];

fn render_quote(book: &MarketBook<u64>, side: TradeSide) -> String {
    match quote(book, side, book_amount(book), FEE_BPS) {
        Ok(view) => format!(
            "{{\"cost\":\"{}\",\"fee\":\"{}\",\"p_after_1e9\":\"{}\",\"max_trade\":\"{}\",\"within_domain\":{}}}",
            view.cost, view.fee, view.p_after_1e9.0, view.max_trade, view.within_domain
        ),
        Err(error) => format!("{{\"error\":\"{}\"}}", error_name(error)),
    }
}

/// The amount is carried on the book's `fees_accrued` field purely so the two
/// render calls need no extra parameter; nothing in `quote` reads it.
fn book_amount(book: &MarketBook<u64>) -> Balance {
    book.fees_accrued
}

fn error_name(error: Error) -> &'static str {
    match error {
        Error::UnknownMarket => "UnknownMarket",
        Error::DuplicateMarket => "DuplicateMarket",
        Error::DuplicateBaselineMarket => "DuplicateBaselineMarket",
        Error::BadOrigin => "BadOrigin",
        Error::NotTrading => "NotTrading",
        Error::AmountTooSmall => "AmountTooSmall",
        Error::AmountTooLarge => "AmountTooLarge",
        Error::SlippageExceeded => "SlippageExceeded",
        Error::PriceBoundExceeded => "PriceBoundExceeded",
        Error::ArithmeticOverflow => "ArithmeticOverflow",
        Error::Ledger => "Ledger",
        Error::TryStateViolation => "TryStateViolation",
        Error::NotTerminal => "NotTerminal",
    }
}

fn render_raw(value: Result<futarchy_fixed::FixedU64x64, futarchy_fixed::FixedError>) -> String {
    match value {
        Ok(v) => format!("\"{}\"", v.raw()),
        Err(_) => "null".to_string(),
    }
}

/// Build the fixture text from this runtime.
pub(crate) fn render() -> String {
    let mut rows = alloc::vec::Vec::new();
    for (name, q_long, q_short, b, amount) in CASES {
        let mut book = MarketBook::open(1u64, BookKind::Baseline { epoch: 1 }, 1u64, 2u64, b);
        book.q_long = q_long;
        book.q_short = q_short;
        book.fees_accrued = amount;

        let cost_raw = render_raw(
            fx(q_long)
                .and_then(|l| Ok((l, fx(q_short)?, fx(b)?)))
                .and_then(|(l, s, b)| lmsr_cost(l, s, b).map_err(crate::map_fixed))
                .map_err(|_| futarchy_fixed::FixedError::Domain),
        );
        let price_raw = render_raw(
            fx(q_long)
                .and_then(|l| Ok((l, fx(q_short)?, fx(b)?)))
                .and_then(|(l, s, b)| lmsr_price_long(l, s, b).map_err(crate::map_fixed))
                .map_err(|_| futarchy_fixed::FixedError::Domain),
        );

        rows.push(format!(
            "  {{\n   \"name\": \"{name}\",\n   \"q_long\": \"{q_long}\",\n   \"q_short\": \"{q_short}\",\n   \"b\": \"{b}\",\n   \"amount\": \"{amount}\",\n   \"buy_long\": {},\n   \"buy_short\": {},\n   \"sell_long\": {},\n   \"sell_short\": {},\n   \"cost_raw_64x64\": {cost_raw},\n   \"price_long_raw_64x64\": {price_raw}\n  }}",
            render_quote(&book, TradeSide::BuyLong),
            render_quote(&book, TradeSide::BuyShort),
            render_quote(&book, TradeSide::SellLong),
            render_quote(&book, TradeSide::SellShort),
        ));
    }

    let (numerator, denominator) = futarchy_primitives::kernel::MAX_TRADE_RATIO;
    format!(
        "{{\n \"schema\": \"{SCHEMA}\",\n \"fee_bps\": \"{FEE_BPS}\",\n \"trade_bounds\": {{\n  \"min_trade\": \"{}\",\n  \"max_trade_numerator\": \"{numerator}\",\n  \"max_trade_denominator\": \"{denominator}\"\n }},\n \"cases\": [\n{}\n ]\n}}\n",
        crate::MIN_TRADE,
        rows.join(",\n"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(FIXTURE)
    }

    #[test]
    fn quote_agreement_fixture_describes_this_runtime() {
        let rendered = render();
        let path = fixture_path();

        if std::env::var("BLEAVIT_WRITE_QUOTE_FIXTURE").is_ok() {
            std::fs::create_dir_all(path.parent().expect("fixture has a parent"))
                .expect("create fixture dir");
            std::fs::write(&path, &rendered).expect("write fixture");
            return;
        }

        let committed = std::fs::read_to_string(&path).unwrap_or_else(|error| {
            panic!(
                "{} is unreadable ({error}). Regenerate with \
                 BLEAVIT_WRITE_QUOTE_FIXTURE=1 cargo test -p market-core quote_agreement",
                path.display()
            )
        });

        assert_eq!(
            committed, rendered,
            "the committed quote-agreement fixture no longer describes this runtime. \
             If the change is intended, regenerate it AND re-run \
             `pnpm -C app run test:protocol` — the client binds to the same file, and \
             a runtime quote change that the client does not follow is a wrong number \
             shown to a user before they sign (02 §4; 11 §11.3)."
        );
    }

    #[test]
    fn the_fixture_exercises_both_refusal_kinds_and_the_priced_path() {
        // Anti-vacuity. A fixture where every case errored, or none did, would
        // pin nothing about the paths that matter — and the two defects this
        // module exists to catch were one refusal each, of *different* kinds.
        // Requiring both kinds is therefore the assertion, not merely requiring
        // "some error": a client that collapsed them into one code would still
        // satisfy a weaker check.
        let rendered = render();
        assert!(
            rendered.contains("\"error\":\"PriceBoundExceeded\""),
            "no case leaves the LMSR price domain"
        );
        assert!(
            rendered.contains("\"error\":\"ArithmeticOverflow\""),
            "no case underflows a Balance before reaching the kernel"
        );
        assert!(
            rendered.matches("\"cost\"").count() >= 8,
            "the case set no longer reaches the priced paths"
        );
    }
}
