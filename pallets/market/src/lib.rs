#![cfg_attr(not(feature = "std"), no_std)]
#![deny(unsafe_code)]
#![allow(clippy::too_many_arguments)]

extern crate alloc;

use alloc::vec::Vec;
use futarchy_fixed::{
    lmsr_buy_cost, lmsr_price_long, lmsr_sell_proceeds, round_charge_up, round_payout_down,
    FixedError, FixedU64x64, LmsrSide, LN_2,
};
use futarchy_primitives::{
    Balance, Branch, EpochId, FixedU64, GateType, MarketId, PositionKind, ProposalId, ScalarSide,
    TradeSide,
};
use pallet_conditional_ledger::{baseline, position, LedgerState};
use parity_scale_codec::{Decode, Encode, MaxEncodedLen};
use scale_info::TypeInfo;

pub const FEE_BPS: u128 = 30;
pub const BPS_DENOM: u128 = 10_000;
pub const MIN_TRADE: Balance = 1_000_000;
pub const OBS_INTERVAL: u64 = 10;
pub const STALE_GAP_BLOCKS: u64 = 50;
pub const KAPPA_1E9: u64 = 5_000_000;
pub const PRICE_ONE_1E9: u64 = 1_000_000_000;

#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub enum BookKind {
    Decision {
        proposal: ProposalId,
        branch: Branch,
    },
    Gate {
        proposal: ProposalId,
        branch: Branch,
        gate: GateType,
    },
    Baseline {
        epoch: EpochId,
    },
}

#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub enum MarketPhase {
    Trading,
    Extended,
    Closed,
    Settled,
}

#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub struct MarketBook<AccountId> {
    pub id: MarketId,
    pub kind: BookKind,
    pub phase: MarketPhase,
    pub account: AccountId,
    pub fees_account: AccountId,
    pub b: Balance,
    pub q_long: Balance,
    pub q_short: Balance,
    pub fees_accrued: Balance,
    pub last_quote_1e9: FixedU64,
    pub last_observation_1e9: FixedU64,
    pub last_observed_block: u64,
    pub cumulative_price_blocks: u128,
    pub stale_events: u8,
}

#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub enum Event {
    MarketCreated(MarketId),
    BaselineMarketMapped(EpochId, MarketId),
    Seeded(MarketId, Balance),
    Traded {
        market: MarketId,
        side: TradeSide,
        amount: Balance,
        cost: Balance,
        p_after: FixedU64,
    },
    Observed {
        market: MarketId,
        o_t: FixedU64,
    },
    Closed(MarketId),
    Reaped(MarketId),
}

#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub enum Error {
    UnknownMarket,
    DuplicateMarket,
    DuplicateBaselineMarket,
    BadOrigin,
    NotTrading,
    AmountTooSmall,
    AmountTooLarge,
    SlippageExceeded,
    PriceBoundExceeded,
    ArithmeticOverflow,
    Ledger,
    TryStateViolation,
}

#[derive(Clone, Debug, Decode, Encode, Eq, PartialEq, TypeInfo)]
pub struct MarketState<AccountId> {
    pub markets: Vec<MarketBook<AccountId>>,
    pub baseline_market_of: Vec<(EpochId, MarketId)>,
    pub events: Vec<Event>,
}

impl<AccountId: Clone + Eq> MarketState<AccountId> {
    pub const fn new() -> Self {
        Self {
            markets: Vec::new(),
            baseline_market_of: Vec::new(),
            events: Vec::new(),
        }
    }

    pub fn create_market(
        &mut self,
        id: MarketId,
        kind: BookKind,
        account: AccountId,
        fees_account: AccountId,
        b: Balance,
    ) -> Result<(), Error> {
        ensure!(
            self.markets.iter().all(|m| m.id != id),
            Error::DuplicateMarket
        );
        if let BookKind::Baseline { epoch } = kind {
            ensure!(
                self.baseline_market_of.iter().all(|(e, _)| *e != epoch),
                Error::DuplicateBaselineMarket
            );
            self.baseline_market_of.push((epoch, id));
            self.events.push(Event::BaselineMarketMapped(epoch, id));
        }
        self.markets.push(MarketBook {
            id,
            kind,
            phase: MarketPhase::Trading,
            account,
            fees_account,
            b,
            q_long: 0,
            q_short: 0,
            fees_accrued: 0,
            last_quote_1e9: FixedU64(500_000_000),
            last_observation_1e9: FixedU64(500_000_000),
            last_observed_block: 0,
            cumulative_price_blocks: 0,
            stale_events: 0,
        });
        self.events.push(Event::MarketCreated(id));
        Ok(())
    }

    pub fn seed(
        &mut self,
        ledger: &mut LedgerState<AccountId>,
        id: MarketId,
        treasury: &AccountId,
    ) -> Result<Balance, Error> {
        let m = self.market_mut(id)?;
        let headroom = fixed_to_base_units_up(fx(m.b)?.checked_mul(LN_2).map_err(map_fixed)?)?;
        ledger.add_protocol_account(m.account.clone());
        ledger.add_protocol_account(m.fees_account.clone());
        match m.kind {
            BookKind::Decision { proposal, branch } => {
                ledger
                    .do_split(proposal, treasury, headroom)
                    .map_err(|_| Error::Ledger)?;
                ledger
                    .do_transfer(
                        position(proposal, branch, PositionKind::BranchUsdc),
                        treasury,
                        &m.account,
                        headroom,
                    )
                    .map_err(|_| Error::Ledger)?;
                ledger
                    .do_split_scalar(proposal, branch, &m.account, headroom)
                    .map_err(|_| Error::Ledger)?;
            }
            BookKind::Gate {
                proposal,
                branch,
                gate,
            } => {
                ledger
                    .do_split(proposal, treasury, headroom)
                    .map_err(|_| Error::Ledger)?;
                ledger
                    .do_transfer(
                        position(proposal, branch, PositionKind::BranchUsdc),
                        treasury,
                        &m.account,
                        headroom,
                    )
                    .map_err(|_| Error::Ledger)?;
                ledger
                    .do_split_gate(proposal, branch, gate, &m.account, headroom)
                    .map_err(|_| Error::Ledger)?;
            }
            BookKind::Baseline { epoch } => {
                ledger
                    .do_split_baseline(epoch, &m.account, headroom)
                    .map_err(|_| Error::Ledger)?;
            }
        }
        self.events.push(Event::Seeded(id, headroom));
        Ok(headroom)
    }

    pub fn buy(
        &mut self,
        ledger: &mut LedgerState<AccountId>,
        id: MarketId,
        who: &AccountId,
        side: ScalarSide,
        amount: Balance,
        max_cost: Balance,
        block: u64,
    ) -> Result<(), Error> {
        let m = self.market_mut(id)?;
        ensure_trading(m.phase)?;
        ensure_trade_bounds(m.b, amount)?;
        let lside = lside(side);
        let cost_fx = lmsr_buy_cost(fx(m.q_long)?, fx(m.q_short)?, fx(m.b)?, lside, fx(amount)?)
            .map_err(map_fixed)?;
        let cost = fixed_to_base_units_up(cost_fx)?;
        let fee = fee_up(cost)?;
        ensure!(
            cost.checked_add(fee).ok_or(Error::ArithmeticOverflow)? <= max_cost,
            Error::SlippageExceeded
        );
        match m.kind {
            BookKind::Decision { proposal, branch } => buy_branch(
                ledger,
                proposal,
                branch,
                side,
                who,
                &m.account,
                &m.fees_account,
                amount,
                cost,
                fee,
            )?,
            BookKind::Gate {
                proposal,
                branch,
                gate,
            } => buy_gate(
                ledger,
                proposal,
                branch,
                gate,
                side,
                who,
                &m.account,
                &m.fees_account,
                amount,
                cost,
                fee,
            )?,
            BookKind::Baseline { epoch } => buy_baseline(
                ledger,
                epoch,
                side,
                who,
                &m.account,
                amount,
                cost.checked_add(fee).ok_or(Error::ArithmeticOverflow)?,
                cost,
            )?,
        }
        match side {
            ScalarSide::Long => m.q_long = add(m.q_long, amount)?,
            ScalarSide::Short => m.q_short = add(m.q_short, amount)?,
        }
        m.fees_accrued = add(m.fees_accrued, fee)?;
        let observed = observe_if_due(m, block)?;
        let p = price_1e9(m)?;
        m.last_quote_1e9 = p;
        if let Some(event) = observed {
            self.events.push(event);
        }
        self.events.push(Event::Traded {
            market: id,
            side: if matches!(side, ScalarSide::Long) {
                TradeSide::BuyLong
            } else {
                TradeSide::BuyShort
            },
            amount,
            cost,
            p_after: p,
        });
        Ok(())
    }

    pub fn sell(
        &mut self,
        ledger: &mut LedgerState<AccountId>,
        id: MarketId,
        who: &AccountId,
        side: ScalarSide,
        amount: Balance,
        min_proceeds: Balance,
        block: u64,
    ) -> Result<(), Error> {
        let m = self.market_mut(id)?;
        ensure_trading(m.phase)?;
        ensure_trade_bounds(m.b, amount)?;
        let proceeds_fx = lmsr_sell_proceeds(
            fx(m.q_long)?,
            fx(m.q_short)?,
            fx(m.b)?,
            lside(side),
            fx(amount)?,
        )
        .map_err(map_fixed)?;
        let proceeds = fixed_to_base_units_down(proceeds_fx)?;
        let fee = fee_up(proceeds)?;
        let net = sub(proceeds, fee)?;
        ensure!(net >= min_proceeds, Error::SlippageExceeded);
        match m.kind {
            BookKind::Decision { proposal, branch } => sell_branch(
                ledger,
                proposal,
                branch,
                side,
                who,
                &m.account,
                &m.fees_account,
                amount,
                net,
                fee,
            )?,
            BookKind::Gate {
                proposal,
                branch,
                gate,
            } => sell_gate(
                ledger,
                proposal,
                branch,
                gate,
                side,
                who,
                &m.account,
                &m.fees_account,
                amount,
                net,
                fee,
            )?,
            BookKind::Baseline { epoch } => {
                sell_baseline(ledger, epoch, side, who, &m.account, amount, proceeds)?
            }
        }
        match side {
            ScalarSide::Long => m.q_long = sub(m.q_long, amount)?,
            ScalarSide::Short => m.q_short = sub(m.q_short, amount)?,
        }
        m.fees_accrued = add(m.fees_accrued, fee)?;
        let observed = observe_if_due(m, block)?;
        let p = price_1e9(m)?;
        m.last_quote_1e9 = p;
        if let Some(event) = observed {
            self.events.push(event);
        }
        self.events.push(Event::Traded {
            market: id,
            side: if matches!(side, ScalarSide::Long) {
                TradeSide::SellLong
            } else {
                TradeSide::SellShort
            },
            amount,
            cost: proceeds,
            p_after: p,
        });
        Ok(())
    }

    pub fn close(&mut self, id: MarketId) -> Result<(), Error> {
        let m = self.market_mut(id)?;
        m.phase = MarketPhase::Closed;
        self.events.push(Event::Closed(id));
        Ok(())
    }
    pub fn baseline_market(&self, epoch: EpochId) -> Option<MarketId> {
        self.baseline_market_of
            .iter()
            .find(|(e, _)| *e == epoch)
            .map(|(_, m)| *m)
    }
    pub fn try_state(&self) -> Result<(), Error> {
        for m in &self.markets {
            ensure!(m.b > 0, Error::TryStateViolation);
            ensure!(
                m.q_long <= 48 * m.b && m.q_short <= 48 * m.b
                    || m.q_long.abs_diff(m.q_short) <= 48 * m.b,
                Error::PriceBoundExceeded
            );
        }
        Ok(())
    }

    fn market_mut(&mut self, id: MarketId) -> Result<&mut MarketBook<AccountId>, Error> {
        self.markets
            .iter_mut()
            .find(|m| m.id == id)
            .ok_or(Error::UnknownMarket)
    }
}

impl<AccountId: Clone + Eq> Default for MarketState<AccountId> {
    fn default() -> Self {
        Self::new()
    }
}

fn buy_branch<A: Clone + Eq>(
    ledger: &mut LedgerState<A>,
    pid: ProposalId,
    branch: Branch,
    side: ScalarSide,
    who: &A,
    book: &A,
    fees: &A,
    amount: Balance,
    cost: Balance,
    fee: Balance,
) -> Result<(), Error> {
    let total = add(cost, fee)?;
    ledger
        .do_split(pid, who, total)
        .map_err(|_| Error::Ledger)?;
    let mirror = other(branch);
    ledger
        .do_transfer(
            position(pid, branch, PositionKind::BranchUsdc),
            who,
            book,
            cost,
        )
        .map_err(|_| Error::Ledger)?;
    ledger
        .do_transfer(
            position(pid, branch, PositionKind::BranchUsdc),
            who,
            fees,
            fee,
        )
        .map_err(|_| Error::Ledger)?;
    ledger
        .do_transfer(
            position(pid, mirror, PositionKind::BranchUsdc),
            who,
            fees,
            fee,
        )
        .map_err(|_| Error::Ledger)?;
    ledger
        .do_split_scalar(pid, branch, book, cost)
        .map_err(|_| Error::Ledger)?;
    ledger
        .do_transfer(position(pid, branch, scalar_kind(side)), book, who, amount)
        .map_err(|_| Error::Ledger)?;
    Ok(())
}
fn buy_gate<A: Clone + Eq>(
    ledger: &mut LedgerState<A>,
    pid: ProposalId,
    branch: Branch,
    gate: GateType,
    side: ScalarSide,
    who: &A,
    book: &A,
    fees: &A,
    amount: Balance,
    cost: Balance,
    fee: Balance,
) -> Result<(), Error> {
    let total = add(cost, fee)?;
    ledger
        .do_split(pid, who, total)
        .map_err(|_| Error::Ledger)?;
    let mirror = other(branch);
    ledger
        .do_transfer(
            position(pid, branch, PositionKind::BranchUsdc),
            who,
            book,
            cost,
        )
        .map_err(|_| Error::Ledger)?;
    ledger
        .do_transfer(
            position(pid, branch, PositionKind::BranchUsdc),
            who,
            fees,
            fee,
        )
        .map_err(|_| Error::Ledger)?;
    ledger
        .do_transfer(
            position(pid, mirror, PositionKind::BranchUsdc),
            who,
            fees,
            fee,
        )
        .map_err(|_| Error::Ledger)?;
    ledger
        .do_split_gate(pid, branch, gate, book, cost)
        .map_err(|_| Error::Ledger)?;
    ledger
        .do_transfer(
            position(pid, branch, gate_kind(gate, side)),
            book,
            who,
            amount,
        )
        .map_err(|_| Error::Ledger)?;
    Ok(())
}
fn buy_baseline<A: Clone + Eq>(
    ledger: &mut LedgerState<A>,
    epoch: EpochId,
    side: ScalarSide,
    who: &A,
    book: &A,
    amount: Balance,
    total: Balance,
    cost: Balance,
) -> Result<(), Error> {
    ledger
        .do_split_baseline(epoch, who, total)
        .map_err(|_| Error::Ledger)?;
    ledger
        .do_transfer(baseline(epoch, ScalarSide::Long), who, book, cost)
        .map_err(|_| Error::Ledger)?;
    ledger
        .do_transfer(baseline(epoch, ScalarSide::Short), who, book, cost)
        .map_err(|_| Error::Ledger)?;
    ledger
        .do_transfer(baseline(epoch, side), book, who, amount)
        .map_err(|_| Error::Ledger)?;
    Ok(())
}
fn sell_branch<A: Clone + Eq>(
    ledger: &mut LedgerState<A>,
    pid: ProposalId,
    branch: Branch,
    side: ScalarSide,
    who: &A,
    book: &A,
    fees: &A,
    amount: Balance,
    net: Balance,
    fee: Balance,
) -> Result<(), Error> {
    ledger
        .do_transfer(position(pid, branch, scalar_kind(side)), who, book, amount)
        .map_err(|_| Error::Ledger)?;
    ledger
        .do_merge_scalar(pid, branch, book, amount)
        .map_err(|_| Error::Ledger)?;
    ledger
        .do_transfer(
            position(pid, branch, PositionKind::BranchUsdc),
            book,
            fees,
            fee,
        )
        .map_err(|_| Error::Ledger)?;
    ledger
        .do_transfer(
            position(pid, branch, PositionKind::BranchUsdc),
            book,
            who,
            net,
        )
        .map_err(|_| Error::Ledger)?;
    Ok(())
}
fn sell_gate<A: Clone + Eq>(
    ledger: &mut LedgerState<A>,
    pid: ProposalId,
    branch: Branch,
    gate: GateType,
    side: ScalarSide,
    who: &A,
    book: &A,
    fees: &A,
    amount: Balance,
    net: Balance,
    fee: Balance,
) -> Result<(), Error> {
    ledger
        .do_transfer(
            position(pid, branch, gate_kind(gate, side)),
            who,
            book,
            amount,
        )
        .map_err(|_| Error::Ledger)?;
    ledger
        .do_merge_gate(pid, branch, gate, book, amount)
        .map_err(|_| Error::Ledger)?;
    ledger
        .do_transfer(
            position(pid, branch, PositionKind::BranchUsdc),
            book,
            fees,
            fee,
        )
        .map_err(|_| Error::Ledger)?;
    ledger
        .do_transfer(
            position(pid, branch, PositionKind::BranchUsdc),
            book,
            who,
            net,
        )
        .map_err(|_| Error::Ledger)?;
    Ok(())
}
fn sell_baseline<A: Clone + Eq>(
    ledger: &mut LedgerState<A>,
    epoch: EpochId,
    side: ScalarSide,
    who: &A,
    book: &A,
    amount: Balance,
    proceeds: Balance,
) -> Result<(), Error> {
    ledger
        .do_transfer(baseline(epoch, side), who, book, amount)
        .map_err(|_| Error::Ledger)?;
    ledger
        .do_merge_baseline(epoch, book, amount)
        .map_err(|_| Error::Ledger)?;
    ledger
        .do_split_baseline(epoch, who, proceeds)
        .map_err(|_| Error::Ledger)?;
    Ok(())
}

fn observe_if_due<A: Clone + Eq>(
    m: &mut MarketBook<A>,
    block: u64,
) -> Result<Option<Event>, Error> {
    if block < m.last_observed_block.saturating_add(OBS_INTERVAL) {
        return Ok(None);
    }
    let elapsed = block.saturating_sub(m.last_observed_block);
    if elapsed > STALE_GAP_BLOCKS {
        m.stale_events = m.stale_events.saturating_add(1);
    }
    let prev = m.last_quote_1e9.0;
    let old = m.last_observation_1e9.0;
    let low = old.saturating_mul(PRICE_ONE_1E9 - KAPPA_1E9) / PRICE_ONE_1E9;
    let high = old.saturating_mul(PRICE_ONE_1E9 + KAPPA_1E9) / PRICE_ONE_1E9;
    let capped = prev.clamp(low, high);
    m.cumulative_price_blocks = add(
        m.cumulative_price_blocks,
        (capped as u128)
            .checked_mul(elapsed as u128)
            .ok_or(Error::ArithmeticOverflow)?,
    )?;
    m.last_observation_1e9 = FixedU64(capped);
    m.last_observed_block = block;
    Ok(Some(Event::Observed {
        market: m.id,
        o_t: FixedU64(capped),
    }))
}
fn price_1e9<A>(m: &MarketBook<A>) -> Result<FixedU64, Error> {
    let p = lmsr_price_long(fx(m.q_long)?, fx(m.q_short)?, fx(m.b)?).map_err(map_fixed)?;
    Ok(FixedU64(
        (p.raw()
            .checked_mul(PRICE_ONE_1E9 as u128)
            .ok_or(Error::ArithmeticOverflow)?
            >> 64) as u64,
    ))
}
fn fixed_to_base_units_up(v: FixedU64x64) -> Result<Balance, Error> {
    let scaled = v
        .checked_mul(FixedU64x64::from_integer(1_000_000))
        .map_err(map_fixed)?;
    Ok(round_charge_up(scaled))
}
fn fixed_to_base_units_down(v: FixedU64x64) -> Result<Balance, Error> {
    let scaled = v
        .checked_mul(FixedU64x64::from_integer(1_000_000))
        .map_err(map_fixed)?;
    Ok(round_payout_down(scaled))
}
fn fx(v: Balance) -> Result<FixedU64x64, Error> {
    let units = v / 1_000_000;
    FixedU64x64::from_integer(u64::try_from(units).map_err(|_| Error::ArithmeticOverflow)?)
        .checked_add(FixedU64x64::from_raw(((v % 1_000_000) << 64) / 1_000_000))
        .map_err(map_fixed)
}
fn fee_up(cost: Balance) -> Result<Balance, Error> {
    let v = cost.checked_mul(FEE_BPS).ok_or(Error::ArithmeticOverflow)?;
    Ok(v / BPS_DENOM + u128::from(v % BPS_DENOM != 0))
}
fn ensure_trading(p: MarketPhase) -> Result<(), Error> {
    ensure!(
        matches!(p, MarketPhase::Trading | MarketPhase::Extended),
        Error::NotTrading
    );
    Ok(())
}
fn ensure_trade_bounds(b: Balance, a: Balance) -> Result<(), Error> {
    ensure!(a >= MIN_TRADE, Error::AmountTooSmall);
    ensure!(a <= b / 4, Error::AmountTooLarge);
    Ok(())
}
fn lside(s: ScalarSide) -> LmsrSide {
    if matches!(s, ScalarSide::Long) {
        LmsrSide::Long
    } else {
        LmsrSide::Short
    }
}
fn scalar_kind(s: ScalarSide) -> PositionKind {
    if matches!(s, ScalarSide::Long) {
        PositionKind::Long
    } else {
        PositionKind::Short
    }
}
fn gate_kind(g: GateType, s: ScalarSide) -> PositionKind {
    if matches!(s, ScalarSide::Long) {
        PositionKind::GateYes(g)
    } else {
        PositionKind::GateNo(g)
    }
}
fn other(b: Branch) -> Branch {
    if matches!(b, Branch::Accept) {
        Branch::Reject
    } else {
        Branch::Accept
    }
}
fn add<T: CheckedAdd>(a: T, b: T) -> Result<T, Error> {
    a.cadd(b)
}
fn sub(a: Balance, b: Balance) -> Result<Balance, Error> {
    a.checked_sub(b).ok_or(Error::ArithmeticOverflow)
}
trait CheckedAdd: Sized {
    fn cadd(self, rhs: Self) -> Result<Self, Error>;
}
impl CheckedAdd for u128 {
    fn cadd(self, rhs: Self) -> Result<Self, Error> {
        self.checked_add(rhs).ok_or(Error::ArithmeticOverflow)
    }
}
fn map_fixed(e: FixedError) -> Error {
    match e {
        FixedError::Domain => Error::PriceBoundExceeded,
        FixedError::Overflow | FixedError::DivisionByZero | FixedError::NonFinite => {
            Error::ArithmeticOverflow
        }
    }
}
macro_rules! ensure {
    ($cond:expr, $err:expr) => {
        if !$cond {
            return Err($err);
        }
    };
}
use ensure;

#[cfg(feature = "runtime-benchmarks")]
pub mod benchmarking {
    use super::*;

    pub fn benchmark_buy() -> Result<(), Error> {
        let mut ledger = LedgerState::<u64>::new();
        ledger.create_vault(1, 0).map_err(|_| Error::Ledger)?;
        let mut markets = MarketState::new();
        markets.create_market(
            1,
            BookKind::Decision {
                proposal: 1,
                branch: Branch::Accept,
            },
            900,
            901,
            10_000_000_000,
        )?;
        markets.seed(&mut ledger, 1, &100)?;
        markets.buy(
            &mut ledger,
            1,
            &200,
            ScalarSide::Long,
            MIN_TRADE,
            Balance::MAX,
            OBS_INTERVAL,
        )
    }

    pub fn benchmark_crank_observe() -> Result<(), Error> {
        let mut markets = MarketState::new();
        markets.create_market(1, BookKind::Baseline { epoch: 1 }, 900, 901, 10_000_000_000)?;
        observe_if_due(&mut markets.markets[0], OBS_INTERVAL).map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn a(n: u8) -> [u8; 32] {
        [n; 32]
    }
    const B: Balance = 10_000_000_000;
    #[test]
    fn buy_wrapper_collects_complete_pair_fee_and_records_twap() {
        let mut ledger = LedgerState::new();
        ledger.create_vault(1, 0).unwrap();
        let mut m = MarketState::new();
        m.create_market(
            7,
            BookKind::Decision {
                proposal: 1,
                branch: Branch::Accept,
            },
            a(9),
            a(8),
            B,
        )
        .unwrap();
        m.seed(&mut ledger, 7, &a(1)).unwrap();
        m.buy(
            &mut ledger,
            7,
            &a(2),
            ScalarSide::Long,
            1_000_000_000,
            600_000_000,
            10,
        )
        .unwrap();
        assert!(ledger.positions.iter().any(|p| p.owner == a(2)
            && p.id == position(1, Branch::Accept, PositionKind::Long)
            && p.balance == 1_000_000_000));
        assert_eq!(m.markets[0].q_long, 1_000_000_000);
        assert!(matches!(
            m.events.last().unwrap(),
            Event::Traded {
                side: TradeSide::BuyLong,
                ..
            }
        ));
        ledger.try_state().unwrap();
        m.try_state().unwrap();
    }
    #[test]
    fn slippage_phase_and_trade_bounds_are_enforced() {
        let mut ledger = LedgerState::new();
        ledger.create_vault(1, 0).unwrap();
        let mut m = MarketState::new();
        m.create_market(
            7,
            BookKind::Decision {
                proposal: 1,
                branch: Branch::Accept,
            },
            a(9),
            a(8),
            B,
        )
        .unwrap();
        m.seed(&mut ledger, 7, &a(1)).unwrap();
        assert_eq!(
            m.buy(
                &mut ledger,
                7,
                &a(2),
                ScalarSide::Long,
                1_000_000_000,
                1,
                10
            ),
            Err(Error::SlippageExceeded)
        );
        assert_eq!(
            m.buy(
                &mut ledger,
                7,
                &a(2),
                ScalarSide::Long,
                B / 4 + 1,
                Balance::MAX,
                10
            ),
            Err(Error::AmountTooLarge)
        );
        m.close(7).unwrap();
        assert_eq!(
            m.buy(
                &mut ledger,
                7,
                &a(2),
                ScalarSide::Long,
                1_000_000,
                Balance::MAX,
                20
            ),
            Err(Error::NotTrading)
        );
    }
    #[test]
    fn baseline_market_mapping_is_written() {
        let mut m: MarketState<[u8; 32]> = MarketState::new();
        m.create_market(3, BookKind::Baseline { epoch: 42 }, a(9), a(8), B)
            .unwrap();
        assert_eq!(m.baseline_market(42), Some(3));
        assert_eq!(
            m.create_market(4, BookKind::Baseline { epoch: 42 }, a(7), a(6), B),
            Err(Error::DuplicateBaselineMarket)
        );
    }
}
