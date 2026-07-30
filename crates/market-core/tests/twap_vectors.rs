//! Shared JSON TWAP replay for the market core (15 §4.4; 04 §7).
//!
//! The `twap_scenarios` corpus family is generated only by
//! `tools/reference-model/generate-vectors.py` from the backward-weighted,
//! slew-capped accumulator of 04 §7 evaluated in 100-digit `Decimal`. The
//! Rust `observe_book` path must reproduce every value that is exactly
//! representable on the 1e9 price grid byte-exactly, and must stay inside the
//! exact real-arithmetic slew envelope (I-13: the upper clamp bound rounds
//! down) wherever the exact value falls off-grid.

use std::{fs, path::PathBuf};

use conditional_ledger_core::{baseline, LedgerOrigin, LedgerState};
use futarchy_primitives::{Balance, Branch, FixedU64, ScalarSide, TradeSide};
use market_core::{
    contest_capital, observe_book, quote, twap_between, withdraw_fees, BookKind, Error, MarketBook,
    MarketParams, MarketState, TwapCumulative, FEE_BPS,
};
use serde_json::Value;

fn fixture() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../reference-model/fixtures/vectors.json");
    serde_json::from_str(&fs::read_to_string(path).expect("read shared reference-model vectors"))
        .expect("parse shared reference-model vectors")
}

fn balance(ledger: &LedgerState<u8>, side: ScalarSide, who: u8) -> Balance {
    ledger
        .positions
        .iter()
        .find(|record| record.id == baseline(7, side) && record.owner == who)
        .map_or(0, |record| record.balance)
}

fn base_units(value: &Value, context: &str) -> Balance {
    Balance::from(
        value
            .as_u64()
            .unwrap_or_else(|| panic!("{context} must be an unsigned integer")),
    )
}

/// Parse a corpus decimal string onto the 1e9 grid, returning the floored
/// grid value and whether the string carried a sub-grid remainder.
fn parse_1e9(text: &str) -> (u64, bool) {
    let (int, frac) = text.split_once('.').unwrap_or((text, ""));
    let mut raw: u64 = int.parse::<u64>().expect("decimal integer part") * 1_000_000_000;
    let mut digits = frac.to_owned();
    let overflow = digits.split_off(digits.len().min(9));
    while digits.len() < 9 {
        digits.push('0');
    }
    raw += digits.parse::<u64>().expect("decimal fraction part");
    (raw, overflow.bytes().any(|byte| byte != b'0'))
}

fn exact_1e9(value: &Value, context: &str) -> u64 {
    let (raw, remainder) = parse_1e9(
        value
            .as_str()
            .unwrap_or_else(|| panic!("{context} must be a decimal string")),
    );
    assert!(!remainder, "{context} is not exactly representable at 1e9");
    raw
}

fn neutral_book(params: &MarketParams, initial_1e9: u64) -> MarketBook<u8> {
    // MarketBook::open records the canonical neutral 0.500 quote at block 0
    // (04 §2), which is exactly the scenarios' initial accumulator state.
    let mut book = MarketBook::open(
        1,
        BookKind::Decision {
            proposal: 1,
            branch: Branch::Accept,
        },
        1,
        2,
        0,
    );
    assert_eq!(
        book.last_observation_1e9,
        FixedU64(initial_1e9),
        "scenario initial quote"
    );
    assert_eq!(book.last_observed_block, 0);
    assert_eq!(book.cumulative_price_blocks, TwapCumulative::ZERO);
    assert!(params.obs_interval > 0);
    book.last_quote_1e9 = FixedU64(initial_1e9);
    book
}

/// 15 §4.4 / G0 corpus-family attestation: replay every `twap_scenarios` row
/// against the production `observe_book`/`twap_between` path. An unknown or
/// renamed scenario fails loudly; the executed count is pinned.
#[test]
fn twap_vectors_match_python_reference_model() {
    let fixture = fixture();
    let scenarios = fixture["twap_scenarios"]
        .as_array()
        .expect("twap_scenarios family present");
    assert_eq!(scenarios.len(), 2, "twap family cardinality drifted");
    // The reference accumulator's tunables are the 13 §1 defaults; the Rust
    // defaults are injected from the same registry (MarketParams docstring).
    let params = MarketParams::default();

    for row in scenarios {
        let name = row["name"].as_str().expect("scenario name");
        let inputs = &row["inputs"];
        match name {
            "backward_weighted_mean" => {
                let mut book = neutral_book(&params, exact_1e9(&inputs["initial"], "initial"));
                let observations = inputs["observations"]
                    .as_array()
                    .expect("observations array");
                let expected = row["recorded"].as_array().expect("recorded array");
                assert_eq!(observations.len(), expected.len(), "{name} shape");
                let mut checkpoints = vec![(0u64, TwapCumulative::ZERO)];
                for (observation, recorded) in observations.iter().zip(expected) {
                    let block = observation["block"].as_u64().expect("block");
                    book.last_quote_1e9 =
                        FixedU64(exact_1e9(&observation["previous_quote"], "previous_quote"));
                    let event = observe_book(&mut book, &params, block)
                        .expect("observation succeeds")
                        .expect("interval elapsed");
                    let market_core::Event::Observed { o_t, .. } = event else {
                        panic!("{name} emitted a non-observation event")
                    };
                    // Every recorded value in this scenario is exactly
                    // representable at 1e9 (single-interval slew products), so
                    // agreement must be byte-exact — no tolerance.
                    assert_eq!(
                        o_t,
                        FixedU64(exact_1e9(recorded, "recorded")),
                        "{name} recorded observation at block {block}"
                    );
                    checkpoints.push((block, book.cumulative_price_blocks));
                }
                assert_eq!(
                    book.stale_events,
                    u8::try_from(row["stale_events"].as_u64().expect("stale_events")).unwrap(),
                    "{name} stale accounting"
                );
                // Backward-weighted means over [0, 20] and [10, 20] (04 §7:
                // TWAP = (A(end) − A(start)) / (end − start)); both reference
                // values are grid-exact.
                let (end_block, end_cumulative) = checkpoints[2];
                let (mid_block, mid_cumulative) = checkpoints[1];
                let blocks =
                    |span: u64| u32::try_from(span).expect("corpus blocks fit BlockNumber");
                assert_eq!(
                    twap_between(TwapCumulative::ZERO, end_cumulative, blocks(end_block)),
                    Some(FixedU64(exact_1e9(&row["mean_0_20"], "mean_0_20"))),
                    "{name} full-window mean"
                );
                assert_eq!(
                    twap_between(
                        mid_cumulative,
                        end_cumulative,
                        blocks(end_block - mid_block)
                    ),
                    Some(FixedU64(exact_1e9(&row["mean_10_20"], "mean_10_20"))),
                    "{name} trailing-window mean"
                );
            }
            "stale_gap_accounting" => {
                let mut book = neutral_book(&params, 500_000_000);
                let block = inputs["block"].as_u64().expect("block");
                assert!(
                    block > params.stale_gap_blocks,
                    "{name} must actually cross the stale gap"
                );
                book.last_quote_1e9 =
                    FixedU64(exact_1e9(&inputs["previous_quote"], "previous_quote"));
                let event = observe_book(&mut book, &params, block)
                    .expect("observation succeeds")
                    .expect("interval elapsed");
                let market_core::Event::Observed { o_t, .. } = event else {
                    panic!("{name} emitted a non-observation event")
                };
                assert_eq!(
                    book.stale_events,
                    u8::try_from(row["stale_events"].as_u64().expect("stale_events")).unwrap(),
                    "{name} stale accounting"
                );
                // The k = 6 slew clamp (1+κ)^6 · 0.5 is NOT on the 1e9 grid.
                // The reference records the exact real value; the production
                // clamp rounds every step of the upper bound DOWN so the
                // computed clamp sits inside the exact envelope (I-13). The
                // recorded observation must therefore (a) never exceed the
                // exact value and (b) sit within the per-step flooring budget
                // of the exponentiation-by-squaring path: ⌈log2 k⌉ + 2 = 5
                // floored multiplies, each losing < 1 grid ulp.
                let recorded = row["recorded"].as_str().expect("recorded string");
                let (exact_floor, remainder) = parse_1e9(recorded);
                assert!(remainder, "{name} exact value unexpectedly grid-exact");
                assert!(
                    o_t.0 <= exact_floor,
                    "{name}: recorded {} exceeds the exact clamp floor {exact_floor} (I-13)",
                    o_t.0
                );
                assert!(
                    exact_floor - o_t.0 <= 5,
                    "{name}: recorded {} drifted more than the flooring budget below {exact_floor}",
                    o_t.0
                );
            }
            other => panic!("unknown twap scenario: {other}"),
        }
    }
}

/// 04 §6.1 / 15 §4.4 / SQ-519: replay the independently derived Baseline
/// wrapper vectors. This binds the custody distinction the LMSR-only vectors
/// cannot see: fee sets belong to the fee account, not the book.
#[test]
fn baseline_market_vectors_match_python_reference_model() {
    let fixture = fixture();
    let scenarios = fixture["baseline_market_scenarios"]
        .as_array()
        .expect("baseline_market_scenarios family present");
    assert_eq!(
        scenarios.len(),
        2,
        "Baseline market family cardinality drifted"
    );

    for row in scenarios {
        let name = row["name"].as_str().expect("scenario name");
        let inputs = &row["inputs"];
        let b = base_units(&inputs["b"], "b");
        let amount = base_units(&inputs["amount"], "amount");
        assert_eq!(
            base_units(&inputs["fee_bps"], "fee_bps"),
            FEE_BPS,
            "{name}: fee parameter"
        );

        match name {
            "baseline-buy-fee-complete-set-to-main" => {
                let mut ledger = LedgerState::new();
                ledger.create_baseline_vault(7).expect("create Baseline");
                let mut markets = MarketState::new();
                markets
                    .create_market(11, BookKind::Baseline { epoch: 7 }, 9, 8, b)
                    .expect("create market");
                let headroom = markets.seed(&mut ledger, 11, &1).expect("seed");
                assert_eq!(
                    headroom,
                    base_units(&inputs["seed_inventory"], "seed_inventory"),
                    "{name}: seed inventory"
                );
                let quoted = quote(&markets.markets[0], TradeSide::BuyLong, amount, FEE_BPS)
                    .expect("buy quote");
                assert_eq!(
                    quoted.cost,
                    base_units(&row["execution"]["cost"], "cost"),
                    "{name}: cost"
                );
                assert_eq!(
                    quoted.fee,
                    base_units(&row["execution"]["fee"], "fee"),
                    "{name}: fee"
                );

                markets
                    .buy(
                        &mut ledger,
                        11,
                        &2,
                        ScalarSide::Long,
                        amount,
                        Balance::MAX,
                        10,
                    )
                    .expect("funded Baseline buy");
                let expected = &row["after_buy"];
                for (side, key) in [
                    (ScalarSide::Long, "book_long"),
                    (ScalarSide::Short, "book_short"),
                ] {
                    assert_eq!(
                        balance(&ledger, side, 9),
                        base_units(&expected[key], key),
                        "{name}: {key}"
                    );
                }
                for (side, key) in [
                    (ScalarSide::Long, "fees_long"),
                    (ScalarSide::Short, "fees_short"),
                ] {
                    assert_eq!(
                        balance(&ledger, side, 8),
                        base_units(&expected[key], key),
                        "{name}: {key}"
                    );
                }
                for (side, key) in [
                    (ScalarSide::Long, "buyer_long"),
                    (ScalarSide::Short, "buyer_short"),
                ] {
                    assert_eq!(
                        balance(&ledger, side, 2),
                        base_units(&expected[key], key),
                        "{name}: {key}"
                    );
                }

                ledger
                    .settle_baseline(LedgerOrigin::SettleAuthority, 7, FixedU64(500_000_000))
                    .expect("settle Baseline");
                let swept = withdraw_fees(&markets.markets[0], &mut ledger, &3)
                    .expect("sweep Baseline buy fee");
                assert_eq!(
                    swept,
                    base_units(&row["swept_to_main"], "swept_to_main"),
                    "{name}: swept fee"
                );
                assert_eq!(balance(&ledger, ScalarSide::Long, 8), 0);
                assert_eq!(balance(&ledger, ScalarSide::Short, 8), 0);
            }
            "baseline-buy-fee-segregation-refuses-thin-book" => {
                let inventory = base_units(&inputs["book_inventory"], "book_inventory");
                let mut ledger = LedgerState::new();
                ledger.create_baseline_vault(7).expect("create Baseline");
                ledger
                    .split_baseline(LedgerOrigin::Signed, 7, &9, inventory)
                    .expect("fund thin book");
                let mut markets = MarketState::new();
                markets
                    .create_market(11, BookKind::Baseline { epoch: 7 }, 9, 8, b)
                    .expect("create market");
                let quoted = quote(&markets.markets[0], TradeSide::BuyLong, amount, FEE_BPS)
                    .expect("buy quote");
                assert_eq!(
                    inventory + quoted.cost,
                    base_units(&row["segregated_inventory"], "segregated_inventory")
                );
                assert_eq!(
                    inventory + quoted.cost + quoted.fee,
                    base_units(&row["pooled_inventory"], "pooled_inventory")
                );
                let markets_before = markets.clone();
                let ledger_before = ledger.clone();
                assert_eq!(
                    markets.buy(
                        &mut ledger,
                        11,
                        &2,
                        ScalarSide::Long,
                        amount,
                        Balance::MAX,
                        10,
                    ),
                    Err(Error::Ledger),
                    "{name}: thin book must refuse"
                );
                assert_eq!(markets, markets_before, "{name}: market rollback");
                assert_eq!(ledger, ledger_before, "{name}: ledger rollback");
            }
            other => panic!("unknown Baseline market scenario: {other}"),
        }
    }
}

/// 04 §7 / 15 §4.4 / G0 corpus-family attestation: replay every
/// `window_stale_scenarios` row against the production window-staleness rule.
///
/// The book-level counter checked above is the running `MarketBook` diagnostic;
/// this family covers the **per-window** count the 05 §5.2 decision grade
/// actually consumes — gaps clipped to the decision window, terminal gap
/// included. Unknown scenarios fail loudly; the executed count is pinned.
#[test]
fn window_stale_vectors_match_python_reference_model() {
    let fixture = fixture();
    let scenarios = fixture["window_stale_scenarios"]
        .as_array()
        .expect("window_stale_scenarios family present");
    assert_eq!(
        scenarios.len(),
        5,
        "window stale family cardinality drifted"
    );
    let known = [
        "terminal_gap_at_close",
        "dense_window_is_fresh",
        "pre_window_quiet_not_charged",
        "mid_and_terminal_gaps_force_reject",
        "unobserved_window_is_one_gap",
    ];

    for row in scenarios {
        let name = row["name"].as_str().expect("scenario name");
        assert!(
            known.contains(&name),
            "unknown window stale scenario: {name}"
        );
        let inputs = &row["inputs"];
        let block = |value: &Value, context: &str| -> u32 {
            u32::try_from(value.as_u64().unwrap_or_else(|| panic!("{context}")))
                .unwrap_or_else(|_| panic!("{context} fits BlockNumber"))
        };
        let start = block(&inputs["start"], "start");
        let end = block(&inputs["end"], "end");
        // The corpus echoes the gap constant it was generated under; it is the
        // same 13-registry value the production default carries, and a drift on
        // either side must fail here rather than silently regrade windows.
        assert_eq!(
            inputs["stale_gap_blocks"]
                .as_u64()
                .expect("stale_gap_blocks"),
            market_core::STALE_GAP_BLOCKS,
            "{name}: corpus stale gap disagrees with the production constant"
        );
        let observations = inputs["observations"]
            .as_array()
            .expect("observations array")
            .iter()
            .map(|value| block(value, "observation block"))
            .collect::<Vec<_>>();

        let expected = u8::try_from(row["stale_events"].as_u64().expect("stale_events"))
            .expect("stale_events fits u8");
        assert_eq!(
            market_core::window_stale_events(
                start,
                end,
                &observations,
                market_core::STALE_GAP_BLOCKS
            ),
            expected,
            "{name} window staleness"
        );

        // The pallet cannot hold the observation list, so it charges the same
        // rule incrementally with `is_stale_gap` over each clipped interval —
        // one measurement per in-window observation plus the terminal gap at
        // seal. Replaying that exact shape here pins the two forms together, so
        // the batch oracle above cannot drift away from the running path.
        let mut incremental: u8 = 0;
        let mut previous = start;
        for observed in observations
            .iter()
            .copied()
            .filter(|b| *b > start && *b <= end)
        {
            if market_core::is_stale_gap(
                previous.max(start),
                observed,
                market_core::STALE_GAP_BLOCKS,
            ) {
                incremental += 1;
            }
            previous = observed;
        }
        if market_core::is_stale_gap(previous, end, market_core::STALE_GAP_BLOCKS) {
            incremental += 1;
        }
        assert_eq!(
            incremental, expected,
            "{name}: incremental pallet-shaped replay disagrees with the corpus"
        );
    }
}

/// Parse a corpus USDC decimal string into base units, exactly (6 decimals).
fn exact_usdc(value: &Value, context: &str) -> u128 {
    let text = value
        .as_str()
        .unwrap_or_else(|| panic!("{context} must be a decimal string"));
    let (int, frac) = text.split_once('.').unwrap_or((text, ""));
    assert!(frac.len() <= 6, "{context} is not base-unit exact");
    let mut digits = frac.to_owned();
    while digits.len() < 6 {
        digits.push('0');
    }
    int.parse::<u128>()
        .unwrap_or_else(|_| panic!("{context} integer part"))
        * 1_000_000
        + digits
            .parse::<u128>()
            .unwrap_or_else(|_| panic!("{context} fraction"))
}

/// 04 §7a / 15 §4.4 / G0 corpus-family attestation: replay every
/// `contest_scenarios` row against the production `contest_capital` mark
/// (SQ-231: marked net open interest, POL excluded, floored on the base-unit
/// grid) plus the §7a backward-weighted accumulator identity
/// `ContestCapital(w) = (N(end) − N(start)) / blocks`. Unknown scenarios or
/// unknown expectation fields fail loudly; the executed count is pinned.
#[test]
fn contest_vectors_match_python_reference_model() {
    let fixture = fixture();
    let scenarios = fixture["contest_scenarios"]
        .as_array()
        .expect("contest_scenarios family present");
    assert_eq!(scenarios.len(), 3, "contest family cardinality drifted");
    let known = [
        "wash_round_trip_zero",
        "held_exposure_marks_capital_times_time",
        "pol_seeded_positions_excluded",
    ];

    for row in scenarios {
        let name = row["name"].as_str().expect("scenario name");
        assert!(known.contains(&name), "unknown contest scenario: {name}");
        let inputs = &row["inputs"];
        let q_pol_long = exact_usdc(&inputs["q_pol_long"], "q_pol_long");
        let q_pol_short = exact_usdc(&inputs["q_pol_short"], "q_pol_short");
        let observations = inputs["observations"].as_array().expect("observations");
        let expected_marks = row["recorded"].as_array().expect("recorded marks");
        assert_eq!(observations.len(), expected_marks.len(), "{name} shape");

        // N-accumulator checkpoints: (block, cumulative base-unit·blocks).
        let mut checkpoints: Vec<(u64, u128)> = vec![(0, 0)];
        for (observation, expected) in observations.iter().zip(expected_marks) {
            let block = observation["block"].as_u64().expect("block");
            // The production mark reads the maker's stored NET-of-POL trade
            // state: 04 §10 seeding never touches q_long/q_short, so the
            // fixture's gross q minus its recorded POL seed is exactly the
            // core's cost-function state (the §7a exclusion is structural —
            // see `contest_capital`'s docstring).
            let q_long = exact_usdc(&observation["q_long"], "q_long")
                .checked_sub(q_pol_long)
                .expect("fixture q_long covers the POL seed");
            let q_short = exact_usdc(&observation["q_short"], "q_short")
                .checked_sub(q_pol_short)
                .expect("fixture q_short covers the POL seed");
            // The stored quote lives on the 1e9 price grid; floor the
            // reference's exact price onto it. Every fixture row's mark is
            // identical under the 1e9-price/1e-6-value double floor and the
            // reference's single 1e-6 floor (asserted byte-exactly below).
            let price = observation["price_long"].as_str().expect("price string");
            let (int, frac) = price.split_once('.').unwrap_or((price, ""));
            assert_eq!(int, "0", "{name} price must be in [0, 1)");
            let mut digits = frac[..frac.len().min(9)].to_owned();
            while digits.len() < 9 {
                digits.push('0');
            }
            let quote = FixedU64(digits.parse::<u64>().expect("price fraction"));
            let mark = contest_capital(q_long, q_short, quote).expect("mark computes");
            assert_eq!(
                mark,
                exact_usdc(expected, "recorded mark"),
                "{name} mark at block {block}"
            );
            let (previous_block, previous_cumulative) = *checkpoints.last().unwrap();
            let elapsed = block.checked_sub(previous_block).expect("blocks increase");
            checkpoints.push((block, previous_cumulative + mark * u128::from(elapsed)));
        }

        // Every remaining row field is an accumulator expectation; unknown
        // field shapes fail loudly so a grown fixture cannot silently pass.
        let cumulative_at = |block: u64| -> u128 {
            checkpoints
                .iter()
                .find_map(|(candidate, cumulative)| (*candidate == block).then_some(*cumulative))
                .unwrap_or_else(|| panic!("{name} has no checkpoint at block {block}"))
        };
        for (key, value) in row.as_object().expect("scenario object") {
            match key.as_str() {
                "name" | "inputs" | "recorded" => {}
                _ if key.starts_with("contest_capital_") => {
                    let mut bounds = key["contest_capital_".len()..].splitn(2, '_');
                    let start: u64 = bounds.next().unwrap().parse().expect("window start");
                    let end: u64 = bounds
                        .next()
                        .unwrap_or_else(|| panic!("{name}: malformed window key {key}"))
                        .parse()
                        .expect("window end");
                    let average =
                        (cumulative_at(end) - cumulative_at(start)) / u128::from(end - start);
                    assert_eq!(average, exact_usdc(value, key), "{name} {key}");
                }
                _ if key.starts_with("cumulative_at_") => {
                    let block: u64 = key["cumulative_at_".len()..]
                        .parse()
                        .expect("cumulative block");
                    assert_eq!(cumulative_at(block), exact_usdc(value, key), "{name} {key}");
                }
                other => panic!("{name} has an unmapped expectation field {other}"),
            }
        }
    }
}
