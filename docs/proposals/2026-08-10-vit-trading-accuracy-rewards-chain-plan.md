# VIT Trading Accuracy Rewards — Chain Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the on-chain half of the trading accuracy rewards program — spec text, the frame-free score kernel, `pallet-trading-rewards`, the `pallet-market` accumulator, the treasury funding call, the rate coupling screen and runtime wiring — as a working, tested, headless program.

**Architecture:** A new `pallet-trading-rewards` owns enrollment, USDC bonds, per-market scores and VIT claims. `pallet-market` reports fills to it through a loosely-coupled trait at the single point both `buy` and `sell` already funnel through. `pallet-futarchy-treasury` keeps custody of the genesis incentive pot and authorizes one epoch budget at a time. The conditional ledger is never touched, so audit scope A stays closed.

**Tech Stack:** Rust, FRAME (polkadot-sdk stable2606, `=`-exact pins), `no_std` frame-free core crate, proptest, `frame-benchmarking`, Python checkers under `tools/ci/`.

**Source of truth:** `docs/proposals/2026-08-09-vit-trading-accuracy-rewards-design.md` (round 3). Read it before Task 1. Where this plan and that document disagree, the design document wins and the discrepancy is a bug in this plan.

## Global Constraints

- **AGENTS.md and `.claude/rules/runtime-code.md` bind every task.** Read both first.
- **G-1 status quo:** every error, ambiguity or overflow resolves to a no-op. No `unwrap`, `expect`, `panic!`, `unsafe`, or unchecked arithmetic in runtime code.
- **R-7:** rounding is always against the claimant. Rewards round **down**, debits round **up**.
- **No floating point anywhere.** Fixed-point goes through `futarchy-fixed`.
- **Bounded everything:** every collection is a `BoundedVec`/`BoundedBTreeMap` with its bound taken from doc 13 §4, and every type derives `MaxEncodedLen`.
- **Parameters are never hardcoded.** Kernel `K` constants live in `futarchy-primitives`; every tunable is read from `pallet-constitution::Params`.
- **`crates/trading-rewards-core/` is `no_std` and FRAME-free.** It must never gain a `frame-*` dependency.
- **try-state is mandatory** for the new pallet.
- **Every call, hook and trait entry point is benchmarked.** The per-fill trait call enters every trade's weight.
- **Adopted values, verbatim:** `rwd.rate` = **0.25 %** = `Perbill(2_500_000)`. `RATE_HEADROOM` = **10**. `MaxParticipants` = **4,096**. `MaxScoredMarketsPerAccount` = **196**. Forfeited USDC goes to **`INSURANCE`**.
- **Out of scope for this plan:** doc 02, `INTEGRATION_CONTRACT_VERSION`, docs 10 and 11, and everything under `app/`. Those are Plan 2. Do not touch them.
- **Commit discipline (R-9):** conventional commits carrying the task id, for example `feat(rewards): score kernel with book-acquired basis (TR2)`. Never commit with red gates.

## File Structure

| Path | Created or modified | Responsibility |
|---|---|---|
| `docs/architecture/13-parameters.md` | modify | The `rwd.rate` §1 row and three §4 bounds |
| `docs/architecture/08-treasury-and-economics.md` | modify | §2.1 delivery mechanism, new §2.6 program section |
| `docs/architecture/05-welfare-and-decision-engine.md` | modify | Family key `0x0D` |
| `docs/architecture/06-governance-and-guardians.md` | modify | SafetyFilter authority rows |
| `docs/architecture/14-threat-model.md` | modify | The wash-farm threat row |
| `docs/architecture/15-invariants-and-testing.md` | modify | Verification obligations |
| `tools/limit-coverage/registry.toml` | modify | Classify `rwd.rate` |
| `crates/constitution-core/src/lib.rs` | modify | Seed `rwd.rate` in `genesis_params()` |
| `crates/futarchy-primitives/src/lib.rs` | modify | `RATE_HEADROOM`, `metric`-style ids if needed |
| `crates/trading-rewards-core/` | **create** | The frame-free score kernel and epoch outcome arithmetic |
| `pallets/trading-rewards/` | **create** | FRAME shell: storage, calls, events, errors, try-state, benchmarks |
| `pallets/market/src/lib.rs` | modify | Call the observer trait from `deposit_trade_event` |
| `pallets/futarchy-treasury/src/lib.rs` | modify | `fund_trading_rewards` and the sweep-back |
| `runtime/bleavit-runtime/src/lib.rs` | modify | `construct_runtime!` slot 68 |
| `runtime/bleavit-runtime/src/configs.rs` | modify | `Config` impl, SafetyFilter row |
| `reference-model/src/bleavit_reference_model/trading_rewards.py` | **create** | Independent model of the score arithmetic |

---

## Task TR1: Spec layer, registry row and genesis seed

**Files:**
- Modify: `docs/architecture/13-parameters.md` (§1 table, §4 table)
- Modify: `docs/architecture/08-treasury-and-economics.md` (§2.1, new §2.6)
- Modify: `docs/architecture/05-welfare-and-decision-engine.md` (§4a family table)
- Modify: `docs/architecture/06-governance-and-guardians.md` (§3, §5)
- Modify: `docs/architecture/14-threat-model.md`, `docs/architecture/15-invariants-and-testing.md`
- Modify: `tools/limit-coverage/registry.toml`
- Modify: `crates/constitution-core/src/lib.rs:1684` (`genesis_params`)
- Test: `crates/constitution-core/src/lib.rs` (genesis test module)

**Interfaces:**
- Consumes: nothing.
- Produces: the `ParamKey` `rwd.rate`, seeded at `Perbill(2_500_000)` with min `Perbill(0)`, max `Perbill(6_000_000)`, max-Δ `MaxDelta::Absolute(Perbill(2_500_000))` (×2), cooldown `1`, class `ParamClass::Param`, `kernel_bounded = false`. Every later task reads this key.

**Why max is `Perbill(6_000_000)`:** §5.1 of the design derives the worst-case wash break-even as `2f / 0.99`, which is 0.606 % at the `mkt.fee` default of 30 bps. 0.6 % is the largest clean value strictly inside it. Do not raise it without redoing that derivation.

- [ ] **Step 1: Read the owning spec sections before writing anything**

Read, in this order: the design document §2, §3, §5.1; `docs/architecture/08-treasury-and-economics.md` §2.1–§2.3; `docs/architecture/13-parameters.md` reading rules 1–7. R-2 requires this before code.

- [ ] **Step 2: Write the failing genesis test**

Add to `crates/constitution-core/src/lib.rs`, in the existing test module:

```rust
#[test]
fn rwd_rate_is_seeded_at_the_adopted_quarter_percent() {
    let key = key16(b"rwd.rate");
    let record = genesis_params()
        .into_iter()
        .find(|r| r.key == key)
        .expect("13 §1: rwd.rate must be seeded at genesis");
    assert_eq!(record.value, ParamValue::Perbill(2_500_000));
    assert_eq!(record.min, ParamValue::Perbill(0));
    assert_eq!(record.max, ParamValue::Perbill(6_000_000));
    assert_eq!(record.cooldown, 1);
    assert_eq!(record.class, ParamClass::Param);
    assert!(!record.kernel_bounded);
}

#[test]
fn rwd_rate_stays_inside_the_wash_breakeven_at_the_mkt_fee_default() {
    // Design §5.1: r_breakeven = 2f / 0.99, evaluated in parts per billion.
    let params = genesis_params();
    let fee = params.iter().find(|r| r.key == key16(b"mkt.fee")).expect("mkt.fee");
    let rate = params.iter().find(|r| r.key == key16(b"rwd.rate")).expect("rwd.rate");
    let (ParamValue::Perbill(f), ParamValue::Perbill(r)) = (fee.value, rate.value) else {
        panic!("both rows are Perbill");
    };
    // Cross-multiplied, exactly as TR9's `rwd_rate_coupled` predicate does it,
    // so the two cannot disagree at the boundary. Equality is admissible: at
    // exact break-even the wash nets zero rather than positive.
    assert!(
        99 * u128::from(r) <= 200 * u128::from(f),
        "rwd.rate {r} ppb has reached the wash break-even against mkt.fee {f} ppb",
    );
}
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `cargo test -p constitution-core rwd_rate -- --nocapture`
Expected: FAIL — `13 §1: rwd.rate must be seeded at genesis`.

- [ ] **Step 4: Seed the row**

In `genesis_params()`, next to the `mkt.fee` row at `crates/constitution-core/src/lib.rs:1765`, add:

```rust
row(
    b"rwd.rate",
    ParamValue::Perbill(2_500_000),
    ParamValue::Perbill(0),
    ParamValue::Perbill(6_000_000),
    Some(MaxDelta::Absolute(ParamValue::Perbill(2_500_000))),
    1,
    ParamClass::Param,
    false
),
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `cargo test -p constitution-core rwd_rate`
Expected: PASS, both tests.

- [ ] **Step 6: Add the limit-coverage entry**

Append to `tools/limit-coverage/registry.toml`:

```toml
[[entry]]
key = "rwd.rate"
class = "param-bounds"
genesis = true
reason = "13 §1 / rule 7; 15 §4.6: covered by the generated per-key set_param/amend_registry suite. The rate gates no dispatch — it scales an accrual, and the dispatch-bearing limit is the earning cap, which is derived per account rather than registry-held."
```

- [ ] **Step 7: Write the spec text**

Make every edit in the File Structure table above. The design document's §7 table says what each one is. Three are easy to get wrong:

1. **13 §4** takes three rows: `MaxParticipants` 4,096, `MaxScoredMarketsPerAccount` 196, and the score-entry absolute timeout. Each cites its derivation, per §5.2 of the design.
2. **05 §4a** takes family key `0x0D` as a **singleton**, with the `0x0C` argument restated in its own words: the call mutates one remaining-allocation pool, so a beneficiary-derived key would let two proposals pass T5 concurrently.
3. **08 §2.1** gains one sentence pointing at the new §2.6, mirroring how the community row points at `create_community_schedule`.

- [ ] **Step 8: Run the doc and coverage gates**

```bash
python3 tools/ci/check-doc-links.py
python3 tools/ci/check-plan-tables.py
python3 -m unittest discover -s tools/limit-coverage/tests
python3 tools/limit-coverage/check-limit-coverage.py
```
Expected: all four green, and the coverage checker reports one more key than before with `unwired 0`.

- [ ] **Step 9: Commit**

```bash
git add docs/architecture tools/limit-coverage crates/constitution-core
git commit -m "feat(spec,constitution): rwd.rate at 0.25% with its bounds and seed (TR1)"
```

---

## Task TR2: The frame-free score kernel

**Files:**
- Create: `crates/trading-rewards-core/Cargo.toml`
- Create: `crates/trading-rewards-core/src/lib.rs`
- Test: `crates/trading-rewards-core/src/lib.rs` (inline `#[cfg(test)] mod tests`)

**Interfaces:**
- Consumes: `futarchy_primitives::Balance`.
- **First adds** `pub const RATE_HEADROOM: u128 = 10;` to `crates/futarchy-primitives/src/lib.rs`'s `kernel` module (line 1232), documented as the top of the `fee.vit_usdc_rate` envelope (13 §1). It is a kernel `K` constant, and the Global Constraints put those in `futarchy-primitives`, never in a consumer crate.
- Produces, all used by TR3 and TR4:
  - `pub struct MarketScore { pub spent: Balance, pub received: Balance, pub book_acquired: [Balance; 2] }`
  - `pub struct EpochScore { pub spent: Balance, pub received: Balance }`
  - `pub enum Outcome { Reward(Balance), Debit(Balance), Neutral }`
  - `pub enum CoreError { Overflow }`
  - `pub fn on_buy(s: &mut MarketScore, side: usize, qty: Balance, cost: Balance, fee: Balance) -> Result<(), CoreError>`
  - `pub fn on_sell(s: &mut MarketScore, side: usize, qty: Balance, proceeds: Balance) -> Result<(), CoreError>`
  - `pub fn on_settle(s: &mut MarketScore, position: [Balance; 2], settled_value: [Balance; 2]) -> Result<(), CoreError>`
  - `pub fn fold(epoch: &mut EpochScore, market: &MarketScore) -> Result<(), CoreError>`
  - `pub fn earning_cap(snapshot_bond: Balance, rate_ppb: u32) -> Balance`
  - `pub fn epoch_outcome(e: &EpochScore, snapshot_bond: Balance, rate_ppb: u32) -> Outcome`

Every function is total and returns `CoreError::Overflow` rather than panicking. `side` is `0` for LONG and `1` for SHORT.

- [ ] **Step 1: Write the failing tests**

Create `crates/trading-rewards-core/src/lib.rs` with the test module first:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 2_500_000; // 0.25 %

    #[test]
    fn a_book_buy_records_cost_and_basis() {
        let mut s = MarketScore::default();
        on_buy(&mut s, 0, 1_000, 500, 3).expect("no overflow");
        assert_eq!(s.spent, 503, "cost and fee both count against the trader");
        assert_eq!(s.book_acquired[0], 1_000);
        assert_eq!(s.received, 0);
    }

    #[test]
    fn selling_off_book_inventory_scores_nothing() {
        // The account acquired nothing through the book, so a sale of a
        // split-created or transferred-in set credits zero. Design §4.4.
        let mut s = MarketScore::default();
        on_sell(&mut s, 0, 1_000, 990).expect("no overflow");
        assert_eq!(s.received, 0);
        assert_eq!(s.book_acquired[0], 0);
    }

    #[test]
    fn a_sale_is_credited_only_up_to_the_book_acquired_quantity() {
        let mut s = MarketScore::default();
        on_buy(&mut s, 0, 600, 300, 1).expect("no overflow");
        // Sell 1,000 units when only 600 came from the book.
        on_sell(&mut s, 0, 1_000, 1_000).expect("no overflow");
        assert_eq!(s.received, 600, "600/1000 of the proceeds are creditable");
        assert_eq!(s.book_acquired[0], 0);
    }

    #[test]
    fn settlement_credits_only_the_book_acquired_remainder() {
        let mut s = MarketScore::default();
        on_buy(&mut s, 0, 1_000, 500, 3).expect("no overflow");
        on_settle(&mut s, [1_000, 0], [1, 0]).expect("no overflow");
        assert_eq!(s.received, 1_000);
    }

    #[test]
    fn the_earning_cap_is_the_bond_over_rate_times_headroom() {
        // 1_000 USDC bond at 0.25 % with headroom 10 caps scorable net at 40_000.
        assert_eq!(earning_cap(1_000, RATE), 40_000);
    }

    #[test]
    fn a_zero_rate_yields_a_zero_cap_rather_than_dividing_by_zero() {
        assert_eq!(earning_cap(1_000, 0), 0);
    }

    #[test]
    fn reward_rounds_down_and_debit_rounds_up() {
        // net = +401 at 0.25 % is 1.0025, which must floor to 1.
        let e = EpochScore { spent: 0, received: 401 };
        assert_eq!(epoch_outcome(&e, u128::MAX, RATE), Outcome::Reward(1));
        // net = -401 at 0.25 % must ceil to 2 against the claimant.
        let e = EpochScore { spent: 401, received: 0 };
        assert_eq!(epoch_outcome(&e, u128::MAX, RATE), Outcome::Debit(2));
    }

    #[test]
    fn the_cap_clamps_both_directions() {
        let bond = 1_000; // cap 40_000
        let e = EpochScore { spent: 0, received: 100_000 };
        assert_eq!(epoch_outcome(&e, bond, RATE), Outcome::Reward(100));
        let e = EpochScore { spent: 100_000, received: 0 };
        assert_eq!(epoch_outcome(&e, bond, RATE), Outcome::Debit(100));
    }

    #[test]
    fn a_wash_pair_never_nets_positive() {
        // The invariant the whole design rests on: for offsetting accounts
        // with equal snapshot bonds, the debit is at least the reward.
        let bond = 10_000;
        for net in [1u128, 7, 401, 40_000, 1_000_000] {
            let winner = EpochScore { spent: 0, received: net };
            let loser = EpochScore { spent: net, received: 0 };
            let reward = match epoch_outcome(&winner, bond, RATE) {
                Outcome::Reward(v) => v,
                other => panic!("expected a reward, got {other:?}"),
            };
            let debit = match epoch_outcome(&loser, bond, RATE) {
                Outcome::Debit(v) => v,
                other => panic!("expected a debit, got {other:?}"),
            };
            assert!(debit >= reward, "net {net}: debit {debit} < reward {reward}");
        }
    }
}
```

- [ ] **Step 2: Run the tests and confirm they fail to compile**

Run: `cargo test -p trading-rewards-core`
Expected: FAIL — the crate does not exist yet.

- [ ] **Step 3: Create the crate manifest**

`crates/trading-rewards-core/Cargo.toml`, mirroring `crates/futarchy-treasury-core/Cargo.toml`. It depends only on `futarchy-primitives`, `parity-scale-codec`, `scale-info` and `sp-core` where the sibling cores do, and it declares `default = []` with a `std` feature. **It must not depend on any `frame-*` crate.** Add the crate to the root `Cargo.toml` workspace members.

- [ ] **Step 4: Write the implementation**

```rust
#![cfg_attr(not(feature = "std"), no_std)]
//! Frame-free score kernel for the trading accuracy rewards program.
//! Design: `docs/proposals/2026-08-09-vit-trading-accuracy-rewards-design.md` §4.4–§4.5.

use futarchy_primitives::{kernel::RATE_HEADROOM, Balance};

const PERBILL: u128 = 1_000_000_000;

#[derive(Debug, PartialEq, Eq)]
pub enum CoreError {
    Overflow,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MarketScore {
    pub spent: Balance,
    pub received: Balance,
    pub book_acquired: [Balance; 2],
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct EpochScore {
    pub spent: Balance,
    pub received: Balance,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    Reward(Balance),
    Debit(Balance),
    Neutral,
}

pub fn on_buy(
    s: &mut MarketScore,
    side: usize,
    qty: Balance,
    cost: Balance,
    fee: Balance,
) -> Result<(), CoreError> {
    let slot = s.book_acquired.get_mut(side).ok_or(CoreError::Overflow)?;
    let outlay = cost.checked_add(fee).ok_or(CoreError::Overflow)?;
    s.spent = s.spent.checked_add(outlay).ok_or(CoreError::Overflow)?;
    *slot = slot.checked_add(qty).ok_or(CoreError::Overflow)?;
    Ok(())
}

pub fn on_sell(
    s: &mut MarketScore,
    side: usize,
    qty: Balance,
    proceeds: Balance,
) -> Result<(), CoreError> {
    let slot = s.book_acquired.get_mut(side).ok_or(CoreError::Overflow)?;
    // Only the book-acquired part of the sale is creditable (design §4.4).
    let creditable = core::cmp::min(qty, *slot);
    if creditable == 0 || qty == 0 {
        return Ok(());
    }
    // Pro-rate the proceeds, flooring against the claimant.
    let credited = proceeds
        .checked_mul(creditable)
        .ok_or(CoreError::Overflow)?
        / qty;
    s.received = s.received.checked_add(credited).ok_or(CoreError::Overflow)?;
    *slot = slot.saturating_sub(creditable);
    Ok(())
}

pub fn on_settle(
    s: &mut MarketScore,
    position: [Balance; 2],
    settled_value: [Balance; 2],
) -> Result<(), CoreError> {
    for side in 0..2 {
        let eligible = core::cmp::min(position[side], s.book_acquired[side]);
        let credit = eligible
            .checked_mul(settled_value[side])
            .ok_or(CoreError::Overflow)?;
        s.received = s.received.checked_add(credit).ok_or(CoreError::Overflow)?;
        s.book_acquired[side] = s.book_acquired[side].saturating_sub(eligible);
    }
    Ok(())
}

pub fn fold(epoch: &mut EpochScore, market: &MarketScore) -> Result<(), CoreError> {
    epoch.spent = epoch.spent.checked_add(market.spent).ok_or(CoreError::Overflow)?;
    epoch.received = epoch
        .received
        .checked_add(market.received)
        .ok_or(CoreError::Overflow)?;
    Ok(())
}

/// `snapshot_bond / (rate × RATE_HEADROOM)`, floored — a smaller cap is the
/// conservative direction. A zero rate yields a zero cap rather than dividing
/// by zero (G-1).
pub fn earning_cap(snapshot_bond: Balance, rate_ppb: u32) -> Balance {
    let divisor = u128::from(rate_ppb).saturating_mul(RATE_HEADROOM);
    if divisor == 0 {
        return 0;
    }
    snapshot_bond.saturating_mul(PERBILL) / divisor
}

pub fn epoch_outcome(e: &EpochScore, snapshot_bond: Balance, rate_ppb: u32) -> Outcome {
    let cap = earning_cap(snapshot_bond, rate_ppb);
    let rate = u128::from(rate_ppb);
    if e.received > e.spent {
        let net = core::cmp::min(e.received - e.spent, cap);
        // Reward floors, against the claimant.
        let reward = net.saturating_mul(rate) / PERBILL;
        if reward == 0 { Outcome::Neutral } else { Outcome::Reward(reward) }
    } else if e.spent > e.received {
        let net = core::cmp::min(e.spent - e.received, cap);
        // Debit ceils, against the claimant.
        let debit = net.saturating_mul(rate).div_ceil(PERBILL);
        if debit == 0 { Outcome::Neutral } else { Outcome::Debit(debit) }
    } else {
        Outcome::Neutral
    }
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `cargo test -p trading-rewards-core`
Expected: PASS, all nine tests.

- [ ] **Step 6: Confirm the crate is `no_std` clean and FRAME-free**

```bash
cargo build -p trading-rewards-core --no-default-features
grep -r "frame" crates/trading-rewards-core/Cargo.toml && echo "FRAME LEAK" || echo "clean"
```
Expected: the build succeeds and the grep prints `clean`.

- [ ] **Step 7: Commit**

```bash
git add Cargo.toml crates/trading-rewards-core
git commit -m "feat(rewards): frame-free score kernel with book-acquired basis (TR2)"
```

---

## Task TR3: The pallet shell — storage, enrollment and bonds

**Files:**
- Create: `pallets/trading-rewards/Cargo.toml`, `src/lib.rs`, `src/mock.rs`, `src/tests.rs`, `src/weights.rs`, `src/benchmarking.rs`
- Test: `pallets/trading-rewards/src/tests.rs`

**Interfaces:**
- Consumes: everything TR2 produces, plus `pallet_constitution::Params` for `rwd.rate`.
- Produces, used by TR4 through TR7:
  - Storage `Participants: map AccountId → ParticipantRecord`, where `ParticipantRecord { bond, snapshot_bond, snapshot_epoch, epoch: EpochScore, accrued, suspended }`
  - Storage `Scores: double_map (AccountId, MarketId) → MarketScore`
  - Storage `ScoreCount: map AccountId → u32`
  - Calls `enroll(bond)`, `top_up_bond(amount)`, `withdraw_bond()`, `claim_rewards()`
  - `pub fn is_enrolled(who: &AccountId) -> bool` — the single read TR4's hot path makes

- [ ] **Step 1: Scaffold with the repo's own tool**

Run the `new-pallet` skill for `pallet-trading-rewards`. It produces the Cargo wiring, the `lib.rs` skeleton with `Config`/storage/events/errors, the mock runtime, per-extrinsic test stubs, benchmark stubs and the mandatory try-state hook. Do not hand-roll these — the skill encodes conventions this plan does not restate.

- [ ] **Step 2: Write the failing enrollment tests**

In `pallets/trading-rewards/src/tests.rs`:

```rust
#[test]
fn enroll_holds_the_bond_and_opens_a_record() {
    new_test_ext().execute_with(|| {
        assert_ok!(TradingRewards::enroll(RuntimeOrigin::signed(ALICE), 1_000));
        let record = Participants::<Test>::get(ALICE).expect("record opened");
        assert_eq!(record.bond, 1_000);
        assert_eq!(held_usdc(&ALICE), 1_000);
    });
}

#[test]
fn enroll_refuses_a_bond_below_the_position_deposit() {
    new_test_ext().execute_with(|| {
        // ledger.pos_dep is 0.1 USDC = 100_000 base units.
        assert_noop!(
            TradingRewards::enroll(RuntimeOrigin::signed(ALICE), 1),
            Error::<Test>::BondBelowMinimum
        );
        assert!(Participants::<Test>::get(ALICE).is_none());
    });
}

#[test]
fn a_top_up_does_not_move_the_current_epochs_cap() {
    // Design §4.3: a top-up after the outcome is known must not enlarge the
    // winning account's earning cap for the epoch already in flight.
    new_test_ext().execute_with(|| {
        assert_ok!(TradingRewards::enroll(RuntimeOrigin::signed(ALICE), 1_000));
        let before = Participants::<Test>::get(ALICE).expect("record").snapshot_bond;
        assert_ok!(TradingRewards::top_up_bond(RuntimeOrigin::signed(ALICE), 9_000));
        let after = Participants::<Test>::get(ALICE).expect("record");
        assert_eq!(after.bond, 10_000, "the hold grows immediately");
        assert_eq!(after.snapshot_bond, before, "the cap does not");
    });
}

#[test]
fn withdraw_refuses_while_an_epoch_is_unsettled() {
    new_test_ext().execute_with(|| {
        assert_ok!(TradingRewards::enroll(RuntimeOrigin::signed(ALICE), 1_000));
        record_test_score(ALICE, MARKET_A, 0, 500);
        assert_noop!(
            TradingRewards::withdraw_bond(RuntimeOrigin::signed(ALICE)),
            Error::<Test>::EpochUnsettled
        );
        assert_eq!(held_usdc(&ALICE), 1_000, "nothing is released");
    });
}
```

- [ ] **Step 3: Run and confirm failure**

Run: `cargo test -p pallet-trading-rewards`
Expected: FAIL — the calls do not exist.

- [ ] **Step 4: Implement the four calls**

Model the origin checks, `ensure!` ordering and event shape on `pallet-futarchy-treasury`'s `create_community_schedule` at `pallets/futarchy-treasury/src/lib.rs:1368`. Requirements that are easy to miss:

1. `enroll` reads `rwd.rate` from `pallet-constitution::Params` and refuses with `RateUnset` **before any hold** if the row is absent. This is the `svc.client_bond` fail-closed pattern.
2. `enroll` refuses a bond below the live `ledger.pos_dep`.
3. `enroll` refuses once `ScoreCount` participant total reaches `MaxParticipants`.
4. `top_up_bond` increases `bond` and leaves `snapshot_bond` alone.
5. `withdraw_bond` refuses unless the participant's last participated epoch has settled, and refuses while any `Scores` entry exists.
6. `claim_rewards` converts `accrued` USDC to VIT at the live `fee.vit_usdc_rate`, **flooring against the claimant**, and transfers from the pallet sovereign.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `cargo test -p pallet-trading-rewards`
Expected: PASS.

- [ ] **Step 6: Write the try-state hook**

It asserts, per the design §8: held bonds equal the pallet's USDC holdings, accruals never exceed the authorized budget, no bond below `ledger.pos_dep`, and every unsettled epoch's `snapshot_bond` is backed by a still-held bond.

- [ ] **Step 7: Run the full pallet suite and Clippy**

```bash
tools/ci/rust-workspace-gates.sh --changed pallet-trading-rewards trading-rewards-core
```
Expected: green.

- [ ] **Step 8: Commit**

```bash
git add pallets/trading-rewards Cargo.toml
git commit -m "feat(rewards): enrollment, bonds and the snapshot cap (TR3)"
```

---

## Task TR4: The market accumulator

**Files:**
- Modify: `crates/market-core/src/lib.rs` (define the observer trait)
- Modify: `pallets/market/src/lib.rs:4172` (`deposit_trade_event`)
- Modify: `pallets/trading-rewards/src/lib.rs` (implement the trait)
- Test: `pallets/market/src/tests.rs`, `pallets/trading-rewards/src/tests.rs`

**Interfaces:**
- Consumes: `MarketScore`, `on_buy`, `on_sell` from TR2; `is_enrolled` from TR3.
- Produces, **in `crates/market-core/`**: `pub trait TradeObserver<AccountId> { fn observe_fill(who: &AccountId, market: MarketId, side: usize, qty: Balance, cost: Balance, fee: Balance, is_buy: bool); }` — `pallet-market` gains an associated type `type TradeObserver: TradeObserver<Self::AccountId>` set to `()` in the mock, and the runtime binds it to `TradingRewards` in TR7.

**The trait lives in `market-core`, not in `trading-rewards-core`.** The consumer owns the interface and the provider implements it, which is the `OnUnbalanced` pattern. Putting it in the rewards crate would make `pallet-market` depend on the rewards program — a backwards dependency that would couple the book to an optional incentive. `pallet-trading-rewards` already needs `market-core` for `MarketId`, so the dependency runs one way only.

**The single call site is `deposit_trade_event`.** Both `buy` (line 1891) and `sell` (line 1932) funnel their events through it, so one hook covers both and there is no second path to forget.

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn a_fill_by_an_enrolled_account_records_a_score() {
    new_test_ext().execute_with(|| {
        enroll(ALICE, 1_000);
        assert_ok!(Market::buy(RuntimeOrigin::signed(ALICE), MARKET_A, ScalarSide::Long, 1_000, u128::MAX));
        let score = Scores::<Test>::get(ALICE, MARKET_A).expect("score recorded");
        assert!(score.spent > 0);
        assert_eq!(score.book_acquired[0], 1_000);
    });
}

#[test]
fn a_fill_by_a_non_enrolled_account_records_nothing() {
    new_test_ext().execute_with(|| {
        assert_ok!(Market::buy(RuntimeOrigin::signed(BOB), MARKET_A, ScalarSide::Long, 1_000, u128::MAX));
        assert!(Scores::<Test>::get(BOB, MARKET_A).is_none());
    });
}

#[test]
fn a_fill_past_the_score_bound_never_rejects_the_trade() {
    // Design §5.2: overflow records no score and never refuses a lawful trade.
    new_test_ext().execute_with(|| {
        enroll(ALICE, 1_000);
        fill_score_slots(ALICE, MaxScoredMarketsPerAccount::get());
        assert_ok!(Market::buy(RuntimeOrigin::signed(ALICE), MARKET_OVERFLOW, ScalarSide::Long, 1, u128::MAX));
        assert!(Scores::<Test>::get(ALICE, MARKET_OVERFLOW).is_none());
    });
}
```

- [ ] **Step 2: Run and confirm failure**

Run: `cargo test -p pallet-market -p pallet-trading-rewards observer`
Expected: FAIL.

- [ ] **Step 3: Add the trait and the blanket no-op**

In `crates/trading-rewards-core/src/lib.rs`, define `TradeObserver` and implement it for `()` as a no-op, so the market mock and any runtime that does not want the program pay nothing but the call.

- [ ] **Step 4: Call it from `deposit_trade_event`**

In the `market_core::Event::Traded` arm at `pallets/market/src/lib.rs:4174`, after `Self::deposit_event(...)`, call `T::TradeObserver::observe_fill(...)`. Derive `is_buy` and `side` from the `TradeSide` variant. **Do not change the event** — it is frozen in 02 §5.

- [ ] **Step 5: Implement the trait on the pallet**

The implementation returns early when `is_enrolled` is false, returns early when `ScoreCount` is at `MaxScoredMarketsPerAccount` and the market has no existing entry, and otherwise calls `on_buy`/`on_sell`. A `CoreError::Overflow` is swallowed as a no-op rather than propagated — refusing a trade for a rewards-accounting overflow is the wrong G-1 direction.

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `cargo test -p pallet-market -p pallet-trading-rewards`
Expected: PASS.

- [ ] **Step 7: Re-benchmark the trade path**

The hot path gained one storage read for every trade, enrolled or not.

```bash
export CARGO_TARGET_DIR=/tmp/tr-target
python3 tools/ci/regenerate-weights.py --write --changed
python3 tools/ci/check-weight-storage-bounds.py
```
Expected: `pallet_market::buy` and `::sell` show one more read, and the storage-bound check passes.

- [ ] **Step 8: Commit**

```bash
git add crates/trading-rewards-core pallets/market pallets/trading-rewards runtime
git commit -m "feat(market,rewards): observe fills for enrolled accounts (TR4)"
```

---

## Task TR5: Folding, epoch settlement and the timeout escape

**Files:**
- Modify: `pallets/trading-rewards/src/lib.rs`
- Test: `pallets/trading-rewards/src/tests.rs`

**Interfaces:**
- Consumes: `on_settle`, `fold`, `epoch_outcome` from TR2.
- Produces: `settle_market_score(who, market)` and `settle_epoch(who)`, both permissionless, both crankable by `keeper/bleavit-keeper`.

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn folding_moves_a_settled_market_into_the_epoch_and_frees_the_entry() {
    new_test_ext().execute_with(|| {
        enroll(ALICE, 1_000);
        buy_and_settle(ALICE, MARKET_A, /* spent */ 500, /* payout */ 1_000);
        assert_ok!(TradingRewards::settle_market_score(RuntimeOrigin::signed(BOB), ALICE, MARKET_A));
        assert!(Scores::<Test>::get(ALICE, MARKET_A).is_none(), "entry freed");
        let record = Participants::<Test>::get(ALICE).expect("record");
        assert_eq!(record.epoch.received, 1_000);
        assert_eq!(record.epoch.spent, 500);
    });
}

#[test]
fn folding_refuses_before_the_book_settles() {
    new_test_ext().execute_with(|| {
        enroll(ALICE, 1_000);
        buy_only(ALICE, MARKET_A, 500);
        assert_noop!(
            TradingRewards::settle_market_score(RuntimeOrigin::signed(BOB), ALICE, MARKET_A),
            Error::<Test>::MarketNotSettled
        );
    });
}

#[test]
fn a_losing_epoch_debits_the_snapshot_bond_and_cannot_be_escaped_by_folding() {
    // Design §4.3, review finding 2.
    new_test_ext().execute_with(|| {
        enroll(ALICE, 1_000);
        buy_and_settle(ALICE, MARKET_A, /* spent */ 1_000, /* payout */ 0);
        assert_ok!(TradingRewards::settle_market_score(RuntimeOrigin::signed(BOB), ALICE, MARKET_A));
        assert_noop!(
            TradingRewards::withdraw_bond(RuntimeOrigin::signed(ALICE)),
            Error::<Test>::EpochUnsettled
        );
        run_to_epoch_close();
        assert_ok!(TradingRewards::settle_epoch(RuntimeOrigin::signed(BOB), ALICE));
        let record = Participants::<Test>::get(ALICE).expect("record");
        assert_eq!(record.bond, 1_000 - 3, "0.25 % of 1_000, ceiled against the claimant");
        assert_eq!(insurance_balance(), 3, "forfeit goes to INSURANCE");
    });
}

#[test]
fn a_market_that_never_settles_releases_the_bond_on_the_absolute_timeout() {
    // Design §6, review finding 4: the ledger.archive escape was circular.
    new_test_ext().execute_with(|| {
        enroll(ALICE, 1_000);
        buy_only(ALICE, MARKET_A, 500);
        run_to_block(score_entry_timeout() + 1);
        assert_ok!(TradingRewards::settle_market_score(RuntimeOrigin::signed(BOB), ALICE, MARKET_A));
        assert!(Scores::<Test>::get(ALICE, MARKET_A).is_none());
        let record = Participants::<Test>::get(ALICE).expect("record");
        assert_eq!(record.epoch, Default::default(), "the entry drops at zero");
    });
}

#[test]
fn an_over_subscribed_epoch_scales_reward_and_debit_by_the_same_factor() {
    // Design §4.5: scaling only the reward would break the neutrality proof.
    new_test_ext().execute_with(|| {
        authorize_budget(/* far below demand */ 10);
        let (reward, debit) = settle_offsetting_pair(/* net */ 100_000);
        assert!(debit >= reward, "the pair stays non-positive under scaling");
    });
}
```

- [ ] **Step 2: Run and confirm failure**

Run: `cargo test -p pallet-trading-rewards settle`
Expected: FAIL.

- [ ] **Step 3: Implement `settle_market_score`**

Permissionless. It succeeds on one of two conditions: the book has settled, in which case it calls `on_settle` then `fold`; or the absolute timeout has elapsed, in which case it drops the entry at zero without folding. It deletes the `Scores` entry and decrements `ScoreCount` in both cases.

- [ ] **Step 4: Implement `settle_epoch`**

Permissionless, and refuses while any `Scores` entry for the account remains. It computes `epoch_outcome`, applies the budget scale factor to **both** legs, then either accrues a reward or debits the snapshot bond and transfers the forfeit to `INSURANCE`. It resets the epoch accumulator and re-snapshots the bond for the next epoch.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `cargo test -p pallet-trading-rewards`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add pallets/trading-rewards
git commit -m "feat(rewards): folding, epoch settlement and the timeout escape (TR5)"
```

---

## Task TR6: The treasury funding call

**Files:**
- Modify: `pallets/futarchy-treasury/src/lib.rs` (new call after index 12)
- Modify: `crates/futarchy-treasury-core/src/lib.rs` (remaining-allocation tracking)
- Test: `pallets/futarchy-treasury/src/tests.rs`

**Interfaces:**
- Consumes: nothing from TR2–TR5.
- Produces: `fund_trading_rewards(amount)` at the next free `call_index`, drawing from the `incentiv` pot; storage `IncentiveRemaining` and `TradingRewardBudgetCount`.

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn funding_moves_vit_from_the_incentive_pot_to_the_rewards_sovereign() {
    new_test_ext().execute_with(|| {
        assert_ok!(Treasury::fund_trading_rewards(param_origin(), 1_000 * VIT));
        assert_eq!(Balances::free_balance(rewards_sovereign()), 1_000 * VIT);
        assert_eq!(IncentiveRemaining::<Test>::get(), INCENTIVE_PROGRAMS - 1_000 * VIT);
    });
}

#[test]
fn funding_refuses_a_signed_origin() {
    new_test_ext().execute_with(|| {
        assert_noop!(
            Treasury::fund_trading_rewards(RuntimeOrigin::signed(ALICE), 1),
            DispatchError::BadOrigin
        );
    });
}

#[test]
fn funding_refuses_more_than_the_remaining_allocation() {
    new_test_ext().execute_with(|| {
        assert_noop!(
            Treasury::fund_trading_rewards(param_origin(), INCENTIVE_PROGRAMS + 1),
            Error::<Test>::IncentiveAllocationExhausted
        );
        assert_eq!(IncentiveRemaining::<Test>::get(), INCENTIVE_PROGRAMS);
    });
}
```

- [ ] **Step 2: Run and confirm failure**

Run: `cargo test -p pallet-futarchy-treasury fund_trading_rewards`
Expected: FAIL.

- [ ] **Step 3: Implement the call**

Copy the structure of `create_community_schedule` at line 1368 exactly: origin check first, then every `ensure!` before any state change, then the transfer, then the decrement, then the event. Add a lifetime authorization count bounded like `MaxCommunitySchedules`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cargo test -p pallet-futarchy-treasury`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pallets/futarchy-treasury crates/futarchy-treasury-core
git commit -m "feat(treasury): bounded PARAM-origin trading-reward funding (TR6)"
```

---

## Task TR7: Runtime wiring

**Files:**
- Modify: `runtime/bleavit-runtime/src/lib.rs:345` (`construct_runtime!`)
- Modify: `runtime/bleavit-runtime/src/configs.rs`
- Test: `runtime/bleavit-runtime/src/tests.rs`

**Interfaces:**
- Consumes: everything from TR3, TR4 and TR6.
- Produces: `TradingRewards: pallet_trading_rewards = 68` — the next free index after `ServiceLedger` at 67.

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn the_trading_rewards_pallet_occupies_slot_68() {
    assert_eq!(
        <Runtime as frame_system::Config>::PalletInfo::index::<TradingRewards>(),
        Some(68)
    );
}

#[test]
fn the_safety_filter_admits_enrollment_and_refuses_it_inside_a_wrapper() {
    // 06 §3: every new call gets an authority-matrix row and a negative test
    // through the closed wrapper set.
    new_test_ext().execute_with(|| {
        let call = RuntimeCall::TradingRewards(pallet_trading_rewards::Call::enroll { bond: 1_000 });
        assert!(SafetyFilter::contains(&call));
        assert!(!SafetyFilter::contains(&wrap_in_batch(call)));
    });
}

#[test]
fn the_market_observer_is_bound_to_the_rewards_pallet() {
    assert_eq!(
        core::any::type_name::<<Runtime as pallet_market::Config>::TradeObserver>(),
        core::any::type_name::<TradingRewards>(),
    );
}
```

- [ ] **Step 2: Run and confirm failure**

Run: `cargo test -p bleavit-runtime trading_rewards`
Expected: FAIL.

- [ ] **Step 3: Wire the pallet**

Add slot 68, the `Config` impl, the SafetyFilter authority row, and bind `pallet_market::Config::TradeObserver` to `TradingRewards`. Add the pallet to the benchmark list.

- [ ] **Step 4: Run the tests and the runtime gates**

```bash
cargo test -p bleavit-runtime
tools/ci/rust-workspace-gates.sh --changed bleavit-runtime pallet-trading-rewards pallet-market pallet-futarchy-treasury
```
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add runtime
git commit -m "feat(runtime): wire pallet-trading-rewards at slot 68 (TR7)"
```

---

## Task TR8: Verification — property suite, reference model and the rate guard

**Files:**
- Create: `reference-model/src/bleavit_reference_model/trading_rewards.py`
- Create: `reference-model/tests/test_trading_rewards.py`
- Modify: `tools/ci/property-gates.sh` (new `rewards` shard)
- Create: `pallets/trading-rewards/src/property_tests.rs`

**Interfaces:**
- Consumes: the whole chain implementation.
- Produces: no code other tasks depend on. This task is the R-8 obligation.

- [ ] **Step 1: Write the anti-farm property suite**

```rust
proptest! {
    #![proptest_config(ProptestConfig::with_cases(
        std::env::var("PROPTEST_CASES").ok().and_then(|v| v.parse().ok()).unwrap_or(256)
    ))]

    /// The invariant the whole design rests on. For any set of accounts whose
    /// positions offset, total payout minus total forfeit is never positive —
    /// evaluated at every rate the fee.vit_usdc_rate envelope admits.
    #[test]
    fn offsetting_accounts_never_net_positive(
        net in 1u128..1_000_000_000u128,
        bond in 100_000u128..1_000_000_000u128,
        rate_ppb in 1u32..6_000_000u32,
    ) {
        let winner = EpochScore { spent: 0, received: net };
        let loser  = EpochScore { spent: net, received: 0 };
        let reward = match epoch_outcome(&winner, bond, rate_ppb) {
            Outcome::Reward(v) => v, _ => 0,
        };
        let debit = match epoch_outcome(&loser, bond, rate_ppb) {
            Outcome::Debit(v) => v, _ => 0,
        };
        prop_assert!(debit >= reward);
    }

    /// Selling inventory that never came through the book scores nothing,
    /// whatever the proceeds. Review finding 3.
    #[test]
    fn off_book_inventory_never_scores(
        qty in 1u128..1_000_000u128,
        proceeds in 0u128..1_000_000_000u128,
    ) {
        let mut s = MarketScore::default();
        on_sell(&mut s, 0, qty, proceeds).expect("total");
        prop_assert_eq!(s.received, 0);
    }
}
```

- [ ] **Step 2: Run it at the reduced count, then at the gate count**

```bash
cargo test -p pallet-trading-rewards property
PROPTEST_CASES=1000000 tools/ci/property-gates.sh rewards
```
Expected: both green. The second is slow — that is expected, and it is the CI shard.

- [ ] **Step 3: Write the reference-model module**

`trading_rewards.py` re-derives the score arithmetic independently, in exact integer arithmetic. **Do not import the Rust constants or read the generated weights** — a model that takes the implementation as its oracle is not an independent model. It reads its values from the owning spec sections, and `spec_values.py` carries anything shared.

Read `.claude/rules/reference-model.md` before writing it.

- [ ] **Step 4: Write the rate-derivation guard**

```python
def test_rwd_rate_stays_inside_the_wash_breakeven():
    """Design §5.1. Asserts the live relation, not the literal, so that a
    mkt.fee amendment closing the margin turns this red."""
    fee_ppb = genesis_param_ppb("mkt.fee")
    rate_ppb = genesis_param_ppb("rwd.rate")
    breakeven = Fraction(2 * fee_ppb, 1) / Fraction(99, 100)
    assert rate_ppb < breakeven, (
        f"rwd.rate {rate_ppb} ppb has reached the {float(breakeven):.0f} ppb "
        "wash break-even; the rate defense has lapsed and only the bond remains"
    )
```

- [ ] **Step 5: Run the reference-model suite and vector freshness**

```bash
PYTHONPATH=reference-model/src python3 -m unittest discover -s reference-model/tests
python3 tools/reference-model/generate-vectors.py --check
```
Expected: green.

- [ ] **Step 6: Run the exhaustive gate once, for the whole coherent state**

```bash
export CARGO_TARGET_DIR=/tmp/tr-target
export LIBCLANG_PATH=/tmp/tr-libclang   # see AGENTS.md · Quality gates
export WASM_BUILD_WORKSPACE_HINT=$PWD
tools/ci/rust-workspace-gates.sh
```
Expected: green. Per R-12 this runs **once** for the finished state, not per task.

- [ ] **Step 7: Commit and open the pull request**

```bash
git add reference-model tools/ci pallets/trading-rewards
git commit -m "test(rewards): anti-farm property suite and the independent model (TR8)"
```

Then update PLAN.md — a milestone row for this work, a Session log row, and a Decision log entry for the `rwd.rate` adoption with its derivation. Open the PR as a draft, let the exhaustive gate run once, then mark it ready.

---

## Task TR9: The rate coupling screen (design §11, owner decision 2026-08-10)

**Files:**
- Modify: `crates/constitution-core/src/lib.rs:91-145` (add the sibling screen next to `screen_redeem_fee_coupling`)
- Modify: `pallets/constitution/src/lib.rs` (call it from the amendment path and from `try-state`)
- Modify: `docs/architecture/13-parameters.md` (rule 7 gains its third coupling)
- Test: `crates/constitution-core/src/lib.rs`, `pallets/constitution/src/tests.rs`

**Interfaces:**
- Consumes: the `rwd.rate` key from TR1. Nothing else — this task can run in parallel with TR2 onward.
- Produces:
  - `pub fn rwd_rate_pair(key: ParamKey) -> Option<ParamKey>`
  - `pub const fn rwd_rate_coupled(rate_ppb: u128, fee_ppb: u128) -> bool`
  - `pub fn screen_rwd_rate_coupling(key: ParamKey, updated: ParamValue, paired: impl FnOnce(ParamKey) -> Option<ParamValue>) -> Result<(), Error>`
  - `Error::RewardRateAboveWashBreakeven`

**Mirror `screen_redeem_fee_coupling` exactly** — it is the single-homed pattern that keeps the frame-free core and the FRAME shell from drifting on the predicate, the key set, or which side each key is on. Read `crates/constitution-core/src/lib.rs:88-145` before writing anything.

**The one structural trap.** `mkt.fee` now sits in **two** couplings. `screen_redeem_fee_coupling` and `screen_rwd_rate_coupling` are independent and the amendment path must call **both**. Neither absorbs the other, and screening only one partner leaves the invariant breakable from the fee side.

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn the_adopted_pair_passes_the_screen() {
    // 99 × 2_500_000 = 247_500_000  ≤  200 × 3_000_000 = 600_000_000
    assert!(rwd_rate_coupled(2_500_000, 3_000_000));
}

#[test]
fn lowering_the_market_fee_to_its_floor_is_refused() {
    // The amendment the screen exists to block: at 5 bps the wash
    // break-even falls to ≈ 0.10 % and 0.25 % becomes farmable on rate alone.
    assert!(!rwd_rate_coupled(2_500_000, 500_000));
    let err = screen_rwd_rate_coupling(
        key16(b"mkt.fee"),
        ParamValue::Perbill(500_000),
        |_| Some(ParamValue::Perbill(2_500_000)),
    )
    .unwrap_err();
    assert_eq!(err, Error::RewardRateAboveWashBreakeven);
}

#[test]
fn raising_the_reward_rate_past_the_live_fee_is_refused() {
    // The screen must bind from both sides, exactly like redeem_fee ≤ mkt.fee.
    let err = screen_rwd_rate_coupling(
        key16(b"rwd.rate"),
        ParamValue::Perbill(6_000_000),
        |_| Some(ParamValue::Perbill(3_000_000)),
    )
    .unwrap_err();
    assert_eq!(err, Error::RewardRateAboveWashBreakeven);
}

#[test]
fn an_unrelated_key_is_not_screened() {
    assert!(rwd_rate_pair(key16(b"epoch.length")).is_none());
    assert!(screen_rwd_rate_coupling(
        key16(b"epoch.length"),
        ParamValue::U32(1),
        |_| None
    )
    .is_ok());
}

#[test]
fn a_missing_partner_row_fails_closed() {
    let err = screen_rwd_rate_coupling(key16(b"rwd.rate"), ParamValue::Perbill(1), |_| None)
        .unwrap_err();
    assert_eq!(err, Error::TryStateViolation);
}

#[test]
fn a_market_fee_amendment_passes_through_both_screens() {
    // mkt.fee is coupled to ledger.rdm_fee AND to rwd.rate. Neither screen
    // absorbs the other.
    assert!(redeem_fee_pair(key16(b"mkt.fee")).is_some());
    assert!(rwd_rate_pair(key16(b"mkt.fee")).is_some());
    assert_ne!(
        redeem_fee_pair(key16(b"mkt.fee")),
        rwd_rate_pair(key16(b"mkt.fee")),
    );
}
```

- [ ] **Step 2: Run and confirm failure**

Run: `cargo test -p constitution-core rwd_rate_coupl`
Expected: FAIL — the functions do not exist.

- [ ] **Step 3: Implement the screen**

```rust
/// 13 rule 7's **third** live coupling: `rwd.rate ≤ 2 × mkt.fee / 0.99`.
/// Screened over the resulting pair from either side, because a lowering of
/// `mkt.fee` breaks it exactly as a raising of `rwd.rate` does.
pub fn rwd_rate_pair(key: ParamKey) -> Option<ParamKey> {
    let rate = key16(b"rwd.rate");
    let market = key16(b"mkt.fee");
    if key == rate {
        return Some(market);
    }
    if key == market {
        return Some(rate);
    }
    None
}

/// The worst-case wash break-even of the design's §5.1, cross-multiplied so the
/// predicate is exact integer arithmetic with no division and no rounding.
pub const fn rwd_rate_coupled(rate_ppb: u128, fee_ppb: u128) -> bool {
    99 * rate_ppb <= 200 * fee_ppb
}

pub fn screen_rwd_rate_coupling(
    key: ParamKey,
    updated: ParamValue,
    paired: impl FnOnce(ParamKey) -> Option<ParamValue>,
) -> Result<(), Error> {
    let Some(pair) = rwd_rate_pair(key) else {
        return Ok(());
    };
    let partner = paired(pair).ok_or(Error::TryStateViolation)?;
    let (rate, fee) = if key == key16(b"rwd.rate") {
        (updated, partner)
    } else {
        (partner, updated)
    };
    match (rate, fee) {
        (ParamValue::Perbill(rate), ParamValue::Perbill(fee)) => {
            ensure!(
                rwd_rate_coupled(rate as u128, fee as u128),
                Error::RewardRateAboveWashBreakeven
            );
            Ok(())
        }
        _ => Err(Error::WrongType),
    }
}
```

Add `RewardRateAboveWashBreakeven` to the core `Error` enum and map it in the pallet's `From` impl, next to `RedemptionFeeAboveMarketFee`.

- [ ] **Step 4: Run the core tests and confirm they pass**

Run: `cargo test -p constitution-core rwd_rate`
Expected: PASS, all six tests.

- [ ] **Step 5: Call it from the amendment path and try-state**

Find every site that calls `screen_redeem_fee_coupling` in `pallets/constitution/src/lib.rs` and add a `screen_rwd_rate_coupling` call beside it. **Both must run** — see the structural trap above. Add the matching `try-state` assertion next to the existing redeem-fee one.

- [ ] **Step 6: Write the pallet-level test**

```rust
#[test]
fn set_param_refuses_a_market_fee_that_breaks_the_reward_coupling() {
    new_test_ext().execute_with(|| {
        assert_noop!(
            Constitution::set_param(
                param_origin(),
                key16(b"mkt.fee"),
                ParamValue::Perbill(500_000)
            ),
            Error::<Test>::RewardRateAboveWashBreakeven
        );
        // G-1: the refusal leaves the registry byte-identical.
        assert_eq!(
            Params::<Test>::get(key16(b"mkt.fee")).expect("row").value,
            ParamValue::Perbill(3_000_000)
        );
    });
}
```

- [ ] **Step 7: Run the tests and the changed-scope gate**

```bash
cargo test -p pallet-constitution
tools/ci/rust-workspace-gates.sh --changed constitution-core pallet-constitution
```
Expected: green.

- [ ] **Step 8: Amend doc 13 rule 7**

Rule 7 currently names two live couplings. Add the third in the same register, stating the relation, that it binds jointly at the amendment boundary from either side, that it is asserted in `try-state`, and that `mkt.fee` therefore passes two screens. Cite the design's §5.1 derivation for the constant.

- [ ] **Step 9: Run the doc and coverage gates, then commit**

```bash
python3 tools/ci/check-doc-links.py
python3 tools/limit-coverage/check-limit-coverage.py
git add crates/constitution-core pallets/constitution docs/architecture/13-parameters.md
git commit -m "feat(constitution): screen rwd.rate against mkt.fee at the amendment boundary (TR9)"
```

---

## Self-Review

**Spec coverage.** Every row of the design's §7 table maps to TR1 except the three that Plan 2 owns (02, 10, 11). §4.2 is TR6, §4.3 is TR3, §4.4 is TR2 and TR4, §4.5 is TR2 and TR5, §4.6 is TR4 step 7, §5.1 and §5.2 are TR1, §6 is TR5, §8 is TR8, §11 is TR9. §4.7 is Plan 2 entirely.

**Dependency order.** TR1 gates everything. TR2 gates TR3, TR4 and TR5. TR6 and TR9 depend only on TR1 and can run alongside TR2. TR7 needs TR3, TR4 and TR6. TR8 needs everything.

**Type consistency.** `MarketScore`, `EpochScore`, `Outcome` and `CoreError` are defined once in TR2 and used under those exact names in TR3, TR4, TR5 and TR8. `side` is `usize`, `0` = LONG and `1` = SHORT, everywhere. `rate_ppb` is `u32` in TR2's signatures and `u128` in TR9's predicate, because TR9 mirrors `redeem_fee_coupled`'s existing `u128` shape — that widening is deliberate and is the only place the two differ.

**Type consistency.** `MarketScore`, `EpochScore`, `Outcome` and `CoreError` are defined once in TR2 and used under those exact names in TR3, TR4, TR5 and TR8. `side` is `usize`, `0` = LONG and `1` = SHORT, everywhere. `rate_ppb` is `u32` in every signature. `earning_cap` and `epoch_outcome` take `(snapshot_bond, rate_ppb)` in that order throughout.
