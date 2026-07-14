#![cfg_attr(not(feature = "std"), no_std)]
#![deny(unsafe_code)]

extern crate alloc;

use alloc::vec::Vec;
use futarchy_primitives::{AccountId, Balance, BlockNumber, EpochId, ProposalClass, H256};
use pallet_origins::Origin;
use parity_scale_codec::{Decode, Encode, MaxEncodedLen};
use scale_info::TypeInfo;

pub const USDC: Balance = 1_000_000;
pub const VIT: Balance = 1_000_000_000_000;
pub const MAX_BUDGET_LINES: usize = 32;
pub const MAX_STREAMS: usize = 128;
pub const MAX_PENDING_OUTFLOWS: usize = 64;
pub const MAX_POL_COMMITMENTS: usize = 196;
pub const TRS_CAP_PROPOSAL_BPS: u32 = 500;
pub const TRS_CAP_30D_BPS: u32 = 1_000;
pub const TRS_CAP_180D_BPS: u32 = 3_000;
pub const TRS_STREAM_THRESHOLD_BPS: u32 = 100;
pub const ISS_INFLATION_CAP_BPS: u32 = 200;
pub const DAYS_30_BLOCKS: BlockNumber = 432_000;
pub const DAYS_180_BLOCKS: BlockNumber = 2_592_000;
pub const DAYS_365_BLOCKS: BlockNumber = 5_256_000;
pub const KEEPER_BUDGET_EPOCH: Balance = 12_000 * USDC;
pub const COLLATOR_COMP_EPOCH: Balance = 2_000 * USDC;

#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub enum TreasuryAccount {
    Main,
    Pol,
    PolBaseline,
    Insurance,
    Keeper,
    Oracle,
    Rewards,
    Ops,
}

#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub enum BudgetLine {
    Pol,
    PolBaseline,
    Keeper,
    Oracle,
    Rewards,
    OpsBootnodes,
    OpsRpcArchive,
    OpsCollators,
    OpsKeepers,
    OpsOracleEvidence,
    OpsWatchtowers,
    OpsMonitoring,
    OpsArweave,
    OpsCoretime,
}

impl BudgetLine {
    pub const fn account(self) -> TreasuryAccount {
        match self {
            Self::Pol => TreasuryAccount::Pol,
            Self::PolBaseline => TreasuryAccount::PolBaseline,
            Self::Keeper => TreasuryAccount::Keeper,
            Self::Oracle => TreasuryAccount::Oracle,
            Self::Rewards => TreasuryAccount::Rewards,
            Self::OpsBootnodes
            | Self::OpsRpcArchive
            | Self::OpsCollators
            | Self::OpsKeepers
            | Self::OpsOracleEvidence
            | Self::OpsWatchtowers
            | Self::OpsMonitoring
            | Self::OpsArweave
            | Self::OpsCoretime => TreasuryAccount::Ops,
        }
    }
    pub const fn vit_issuance_allowed(self) -> bool {
        matches!(
            self,
            Self::Rewards
                | Self::OpsBootnodes
                | Self::OpsRpcArchive
                | Self::OpsCollators
                | Self::OpsKeepers
                | Self::OpsOracleEvidence
                | Self::OpsWatchtowers
                | Self::OpsMonitoring
                | Self::OpsArweave
                | Self::OpsCoretime
        )
    }
}

#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub enum AssetKind {
    Usdc,
    Vit,
    Foreign(H256),
}

#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub struct NavView {
    pub nav: Balance,
    pub spendable_nav: Balance,
    pub reserve_impaired: bool,
    pub meter_utilization_bps: u32,
}

#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub struct StreamInput {
    pub line: BudgetLine,
    pub recipient: AccountId,
    pub total: Balance,
    pub start: BlockNumber,
    pub duration: BlockNumber,
}

#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub struct Stream {
    pub id: u64,
    pub recipient: AccountId,
    pub line: BudgetLine,
    pub total: Balance,
    pub claimed: Balance,
    pub start: BlockNumber,
    pub duration: BlockNumber,
    pub cancelled: bool,
}

#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub struct RollingMeter {
    pub window: BlockNumber,
    pub limit_bps: u32,
    pub spent: Balance,
    pub window_start: BlockNumber,
}

impl RollingMeter {
    pub const fn new(window: BlockNumber, limit_bps: u32) -> Self {
        Self {
            window,
            limit_bps,
            spent: 0,
            window_start: 0,
        }
    }
    pub fn charge(&mut self, now: BlockNumber, nav: Balance, amount: Balance) -> Result<(), Error> {
        if now >= self.window_start.saturating_add(self.window) {
            self.spent = 0;
            self.window_start = now;
        }
        let limit = bps(nav, self.limit_bps)?;
        let next = self.spent.checked_add(amount).ok_or(Error::Overflow)?;
        ensure!(next <= limit, Error::MeterExhausted);
        self.spent = next;
        Ok(())
    }
    pub fn utilization_bps(&self, nav: Balance) -> u32 {
        let limit = bps(nav, self.limit_bps).unwrap_or(0);
        if limit == 0 {
            0
        } else {
            self.spent
                .saturating_mul(10_000)
                .saturating_div(limit)
                .min(10_000) as u32
        }
    }
}

#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub struct IssuanceMeter {
    pub supply_at_window_start: Balance,
    pub minted: Balance,
    pub window_start: BlockNumber,
}

#[derive(Clone, Debug, Decode, Encode, Eq, PartialEq, TypeInfo)]
pub enum Event {
    Spent {
        line: BudgetLine,
        dest: AccountId,
        amount: Balance,
    },
    StreamOpened {
        id: u64,
        recipient: AccountId,
        total: Balance,
    },
    StreamClaimed {
        id: u64,
        recipient: AccountId,
        amount: Balance,
    },
    StreamCancelled {
        id: u64,
        reverted: Balance,
    },
    BudgetLineFunded {
        line: BudgetLine,
        amount: Balance,
    },
    VitIssued {
        amount: Balance,
        line: BudgetLine,
        meter_after: Balance,
    },
    NavHaircutFlagged {
        epoch: EpochId,
        flag: bool,
    },
    ForeignRecovered {
        asset: AssetKind,
        dest: AccountId,
        amount: Balance,
    },
    CoretimeRenewalCalled {
        line: BudgetLine,
        amount: Balance,
    },
    NavFloorUnmet {
        class: ProposalClass,
        nav: Balance,
        floor: Balance,
    },
    KeeperBudgetLow {
        remaining: Balance,
    },
    KeeperBudgetExhausted,
}

#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub enum Error {
    BadOrigin,
    UnknownBudgetLine,
    InsufficientFunds,
    ReserveImpaired,
    ProposalCapExceeded,
    StreamRequired,
    MeterExhausted,
    StreamNotFound,
    StreamNotClaimable,
    NotRecipient,
    AlreadyCancelled,
    BadDuration,
    TooManyStreams,
    TooManyBudgetLines,
    TooManyObligations,
    IssuanceLineNotAllowed,
    IssuanceCapExceeded,
    UnknownForeignAsset,
    NavFloorUnmet,
    Overflow,
}

#[derive(Clone, Debug, Decode, Encode, Eq, PartialEq, TypeInfo)]
pub struct Treasury {
    pub main_usdc: Balance,
    pub vit_supply: Balance,
    pub reserve_impaired: bool,
    pub lines: Vec<(BudgetLine, Balance)>,
    pub streams: Vec<Stream>,
    pub pending_outflows: Vec<Balance>,
    pub pol_commitments: Vec<Balance>,
    pub meter_30d: RollingMeter,
    pub meter_180d: RollingMeter,
    pub issuance: IssuanceMeter,
    pub events: Vec<Event>,
    pub next_stream_id: u64,
}

impl Default for Treasury {
    fn default() -> Self {
        Self {
            main_usdc: 0,
            vit_supply: 1_000_000_000 * VIT,
            reserve_impaired: false,
            lines: Vec::new(),
            streams: Vec::new(),
            pending_outflows: Vec::new(),
            pol_commitments: Vec::new(),
            meter_30d: RollingMeter::new(DAYS_30_BLOCKS, TRS_CAP_30D_BPS),
            meter_180d: RollingMeter::new(DAYS_180_BLOCKS, TRS_CAP_180D_BPS),
            issuance: IssuanceMeter {
                supply_at_window_start: 1_000_000_000 * VIT,
                minted: 0,
                window_start: 0,
            },
            events: Vec::new(),
            next_stream_id: 0,
        }
    }
}

impl Treasury {
    pub fn fund_budget_line(
        &mut self,
        origin: Origin,
        line: BudgetLine,
        amount: Balance,
    ) -> Result<(), Error> {
        ensure!(origin == Origin::FutarchyTreasury, Error::BadOrigin);
        self.debit_main(amount)?;
        self.credit_line(line, amount)?;
        self.events.push(Event::BudgetLineFunded { line, amount });
        Ok(())
    }
    pub fn spend(
        &mut self,
        origin: Origin,
        now: BlockNumber,
        line: BudgetLine,
        dest: AccountId,
        amount: Balance,
    ) -> Result<(), Error> {
        ensure!(origin == Origin::FutarchyTreasury, Error::BadOrigin);
        self.ensure_spendable()?;
        self.enforce_outflow(now, amount)?;
        self.debit_line(line, amount)?;
        self.events.push(Event::Spent { line, dest, amount });
        Ok(())
    }
    pub fn open_stream(
        &mut self,
        origin: Origin,
        now: BlockNumber,
        input: StreamInput,
    ) -> Result<u64, Error> {
        ensure!(origin == Origin::FutarchyTreasury, Error::BadOrigin);
        self.ensure_spendable()?;
        ensure!(input.duration > 0, Error::BadDuration);
        ensure!(self.streams.len() < MAX_STREAMS, Error::TooManyStreams);
        let nav = self.nav().nav;
        ensure!(
            input.total > bps(nav, TRS_STREAM_THRESHOLD_BPS)?,
            Error::StreamRequired
        );
        self.enforce_outflow(now, input.total)?;
        self.debit_line(input.line, input.total)?;
        let id = self.next_stream_id;
        self.next_stream_id = self.next_stream_id.checked_add(1).ok_or(Error::Overflow)?;
        self.streams.push(Stream {
            id,
            recipient: input.recipient,
            line: input.line,
            total: input.total,
            claimed: 0,
            start: input.start,
            duration: input.duration,
            cancelled: false,
        });
        self.events.push(Event::StreamOpened {
            id,
            recipient: input.recipient,
            total: input.total,
        });
        Ok(id)
    }
    pub fn claim_stream(
        &mut self,
        who: AccountId,
        now: BlockNumber,
        id: u64,
    ) -> Result<Balance, Error> {
        let idx = self
            .streams
            .iter()
            .position(|s| s.id == id)
            .ok_or(Error::StreamNotFound)?;
        let s = self.streams[idx];
        ensure!(s.recipient == who, Error::NotRecipient);
        ensure!(!s.cancelled, Error::AlreadyCancelled);
        let vested = vested_amount(s.total, s.start, s.duration, now);
        let claimable = vested.checked_sub(s.claimed).ok_or(Error::Overflow)?;
        ensure!(claimable > 0, Error::StreamNotClaimable);
        self.streams[idx].claimed = vested;
        self.events.push(Event::StreamClaimed {
            id,
            recipient: who,
            amount: claimable,
        });
        Ok(claimable)
    }
    pub fn cancel_stream(&mut self, origin: Origin, id: u64) -> Result<Balance, Error> {
        ensure!(origin == Origin::FutarchyTreasury, Error::BadOrigin);
        let idx = self
            .streams
            .iter()
            .position(|s| s.id == id)
            .ok_or(Error::StreamNotFound)?;
        ensure!(!self.streams[idx].cancelled, Error::AlreadyCancelled);
        let remainder = self.streams[idx]
            .total
            .checked_sub(self.streams[idx].claimed)
            .ok_or(Error::Overflow)?;
        self.streams[idx].cancelled = true;
        self.main_usdc = self
            .main_usdc
            .checked_add(remainder)
            .ok_or(Error::Overflow)?;
        self.events.push(Event::StreamCancelled {
            id,
            reverted: remainder,
        });
        Ok(remainder)
    }
    pub fn issue_vit(
        &mut self,
        origin: Origin,
        now: BlockNumber,
        amount: Balance,
        line: BudgetLine,
    ) -> Result<(), Error> {
        ensure!(origin == Origin::FutarchyTreasury, Error::BadOrigin);
        ensure!(line.vit_issuance_allowed(), Error::IssuanceLineNotAllowed);
        if now >= self.issuance.window_start.saturating_add(DAYS_365_BLOCKS) {
            self.issuance.window_start = now;
            self.issuance.minted = 0;
            self.issuance.supply_at_window_start = self.vit_supply;
        }
        let cap = bps(self.issuance.supply_at_window_start, ISS_INFLATION_CAP_BPS)?;
        let next = self
            .issuance
            .minted
            .checked_add(amount)
            .ok_or(Error::Overflow)?;
        ensure!(next <= cap, Error::IssuanceCapExceeded);
        self.issuance.minted = next;
        self.vit_supply = self.vit_supply.checked_add(amount).ok_or(Error::Overflow)?;
        self.events.push(Event::VitIssued {
            amount,
            line,
            meter_after: next,
        });
        Ok(())
    }
    pub fn recover_foreign(
        &mut self,
        origin: Origin,
        asset: AssetKind,
        dest: AccountId,
        amount: Balance,
    ) -> Result<(), Error> {
        ensure!(origin == Origin::FutarchyTreasury, Error::BadOrigin);
        ensure!(
            !matches!(asset, AssetKind::Usdc | AssetKind::Vit),
            Error::UnknownForeignAsset
        );
        self.events.push(Event::ForeignRecovered {
            asset,
            dest,
            amount,
        });
        Ok(())
    }
    pub fn call_coretime_renewal(&mut self, origin: Origin, amount: Balance) -> Result<(), Error> {
        ensure!(origin == Origin::FutarchyTreasury, Error::BadOrigin);
        self.debit_line(BudgetLine::OpsCoretime, amount)?;
        self.events.push(Event::CoretimeRenewalCalled {
            line: BudgetLine::OpsCoretime,
            amount,
        });
        Ok(())
    }
    pub fn set_reserve_impaired(&mut self, epoch: EpochId, flag: bool) {
        if self.reserve_impaired != flag {
            self.reserve_impaired = flag;
            self.events.push(Event::NavHaircutFlagged { epoch, flag });
        }
    }
    pub fn nav(&self) -> NavView {
        let obligations = self
            .open_stream_remainders()
            .saturating_add(sum(&self.pending_outflows))
            .saturating_add(sum(&self.pol_commitments));
        let nav = self
            .main_usdc
            .saturating_add(sum_lines(&self.lines))
            .saturating_sub(obligations);
        let spendable_nav = if self.reserve_impaired { 0 } else { nav };
        NavView {
            nav,
            spendable_nav,
            reserve_impaired: self.reserve_impaired,
            meter_utilization_bps: self
                .meter_30d
                .utilization_bps(nav)
                .max(self.meter_180d.utilization_bps(nav)),
        }
    }
    pub fn floor(class: ProposalClass) -> Balance {
        match class {
            ProposalClass::Param => 1_848_400 * USDC,
            ProposalClass::Treasury => 7_393_600 * USDC,
            ProposalClass::Code => 13_862_944 * USDC,
            ProposalClass::Meta => 21_256_533 * USDC,
            ProposalClass::Constitutional => 21_256_533 * USDC,
        }
    }
    pub fn ensure_nav_floor(&mut self, class: ProposalClass) -> Result<(), Error> {
        let nav = self.nav().spendable_nav;
        let floor = Self::floor(class);
        if nav < floor {
            self.events.push(Event::NavFloorUnmet { class, nav, floor });
            return Err(Error::NavFloorUnmet);
        }
        Ok(())
    }
    pub fn try_state(&self) -> Result<(), Error> {
        ensure!(
            self.lines.len() <= MAX_BUDGET_LINES,
            Error::TooManyBudgetLines
        );
        ensure!(self.streams.len() <= MAX_STREAMS, Error::TooManyStreams);
        ensure!(
            self.pending_outflows.len() <= MAX_PENDING_OUTFLOWS,
            Error::TooManyObligations
        );
        ensure!(
            self.pol_commitments.len() <= MAX_POL_COMMITMENTS,
            Error::TooManyObligations
        );
        for s in &self.streams {
            ensure!(s.claimed <= s.total, Error::Overflow);
            ensure!(s.duration > 0, Error::BadDuration);
        }
        Ok(())
    }
    fn ensure_spendable(&self) -> Result<(), Error> {
        ensure!(!self.reserve_impaired, Error::ReserveImpaired);
        Ok(())
    }
    fn enforce_outflow(&mut self, now: BlockNumber, amount: Balance) -> Result<(), Error> {
        let nav = self.nav().spendable_nav;
        ensure!(
            amount <= bps(nav, TRS_CAP_PROPOSAL_BPS)?,
            Error::ProposalCapExceeded
        );
        self.meter_30d.charge(now, nav, amount)?;
        self.meter_180d.charge(now, nav, amount)
    }
    fn debit_main(&mut self, amount: Balance) -> Result<(), Error> {
        ensure!(self.main_usdc >= amount, Error::InsufficientFunds);
        self.main_usdc -= amount;
        Ok(())
    }
    fn credit_line(&mut self, line: BudgetLine, amount: Balance) -> Result<(), Error> {
        if let Some((_, bal)) = self.lines.iter_mut().find(|(l, _)| *l == line) {
            *bal = bal.checked_add(amount).ok_or(Error::Overflow)?;
        } else {
            ensure!(
                self.lines.len() < MAX_BUDGET_LINES,
                Error::TooManyBudgetLines
            );
            self.lines.push((line, amount));
        }
        Ok(())
    }
    fn debit_line(&mut self, line: BudgetLine, amount: Balance) -> Result<(), Error> {
        let (_, bal) = self
            .lines
            .iter_mut()
            .find(|(l, _)| *l == line)
            .ok_or(Error::UnknownBudgetLine)?;
        ensure!(*bal >= amount, Error::InsufficientFunds);
        *bal -= amount;
        Ok(())
    }
    fn open_stream_remainders(&self) -> Balance {
        self.streams
            .iter()
            .filter(|s| !s.cancelled)
            .fold(0, |acc, s| {
                acc.saturating_add(s.total.saturating_sub(s.claimed))
            })
    }
}

pub fn bps(amount: Balance, bps: u32) -> Result<Balance, Error> {
    amount
        .checked_mul(bps as Balance)
        .ok_or(Error::Overflow)?
        .checked_div(10_000)
        .ok_or(Error::Overflow)
}
pub fn vested_amount(
    total: Balance,
    start: BlockNumber,
    duration: BlockNumber,
    now: BlockNumber,
) -> Balance {
    if now <= start {
        0
    } else {
        let elapsed = now.saturating_sub(start).min(duration);
        total
            .saturating_mul(elapsed as Balance)
            .saturating_div(duration as Balance)
    }
}
fn sum(v: &[Balance]) -> Balance {
    v.iter().copied().fold(0, Balance::saturating_add)
}
fn sum_lines(v: &[(BudgetLine, Balance)]) -> Balance {
    v.iter().map(|(_, b)| *b).fold(0, Balance::saturating_add)
}

#[cfg(feature = "runtime-benchmarks")]
pub mod benchmarking {
    pub fn benchmark_stub() -> bool {
        true
    }
}

macro_rules! ensure {
    ($cond:expr, $err:expr $(,)?) => {
        if !$cond {
            return Err($err);
        }
    };
}
use ensure;

#[cfg(test)]
mod tests {
    use super::*;
    const TREASURY: Origin = Origin::FutarchyTreasury;
    fn acct(n: u8) -> AccountId {
        [n; 32]
    }
    fn funded() -> Treasury {
        let mut t = Treasury {
            main_usdc: 25_000_000 * USDC,
            ..Default::default()
        };
        t.fund_budget_line(TREASURY, BudgetLine::OpsCollators, 1_500_000 * USDC)
            .unwrap();
        t.fund_budget_line(TREASURY, BudgetLine::Rewards, 1_000_000 * USDC)
            .unwrap();
        t.fund_budget_line(TREASURY, BudgetLine::OpsCoretime, 500_000 * USDC)
            .unwrap();
        t
    }
    #[test]
    fn spend_requires_treasury_origin_and_caps() {
        let mut t = funded();
        assert_eq!(
            t.spend(
                Origin::FutarchyParam,
                0,
                BudgetLine::OpsCollators,
                acct(1),
                1
            )
            .unwrap_err(),
            Error::BadOrigin
        );
        assert_eq!(
            t.spend(
                TREASURY,
                0,
                BudgetLine::OpsCollators,
                acct(1),
                2_000_000 * USDC
            )
            .unwrap_err(),
            Error::ProposalCapExceeded
        );
        t.spend(
            TREASURY,
            0,
            BudgetLine::OpsCollators,
            acct(1),
            100_000 * USDC,
        )
        .unwrap();
    }
    #[test]
    fn reserve_haircut_sets_spendable_zero_and_blocks_new_commitments() {
        let mut t = funded();
        t.set_reserve_impaired(7, true);
        let nav = t.nav();
        assert!(nav.reserve_impaired);
        assert_eq!(nav.spendable_nav, 0);
        assert_eq!(
            t.spend(TREASURY, 0, BudgetLine::OpsCollators, acct(1), 1)
                .unwrap_err(),
            Error::ReserveImpaired
        );
        assert_eq!(
            t.ensure_nav_floor(ProposalClass::Param).unwrap_err(),
            Error::NavFloorUnmet
        );
    }
    #[test]
    fn streams_are_mandatory_above_threshold_claimable_and_cancellable() {
        let mut t = funded();
        assert_eq!(
            t.open_stream(
                TREASURY,
                0,
                StreamInput {
                    line: BudgetLine::OpsCollators,
                    recipient: acct(2),
                    total: 10_000 * USDC,
                    start: 0,
                    duration: 100
                }
            )
            .unwrap_err(),
            Error::StreamRequired
        );
        let id = t
            .open_stream(
                TREASURY,
                0,
                StreamInput {
                    line: BudgetLine::OpsCollators,
                    recipient: acct(2),
                    total: 300_000 * USDC,
                    start: 10,
                    duration: 100,
                },
            )
            .unwrap();
        assert_eq!(
            t.claim_stream(acct(9), 60, id).unwrap_err(),
            Error::NotRecipient
        );
        assert_eq!(t.claim_stream(acct(2), 60, id).unwrap(), 150_000 * USDC);
        assert_eq!(t.cancel_stream(TREASURY, id).unwrap(), 150_000 * USDC);
    }
    #[test]
    fn issuance_meter_allows_only_rewards_or_ops_and_caps_two_percent() {
        let mut t = funded();
        assert_eq!(
            t.issue_vit(TREASURY, 0, 1, BudgetLine::Pol).unwrap_err(),
            Error::IssuanceLineNotAllowed
        );
        let cap = 20_000_000 * VIT;
        t.issue_vit(TREASURY, 0, cap, BudgetLine::Rewards).unwrap();
        assert_eq!(
            t.issue_vit(TREASURY, 0, 1, BudgetLine::Rewards)
                .unwrap_err(),
            Error::IssuanceCapExceeded
        );
        t.issue_vit(TREASURY, DAYS_365_BLOCKS, 1, BudgetLine::OpsArweave)
            .unwrap();
    }
    #[test]
    fn coretime_renewal_is_dedicated_call_even_under_reserve_flag() {
        let mut t = funded();
        t.set_reserve_impaired(1, true);
        t.call_coretime_renewal(TREASURY, 100_000 * USDC).unwrap();
        assert!(matches!(
            t.events.last(),
            Some(Event::CoretimeRenewalCalled { .. })
        ));
    }
    #[test]
    fn try_state_checks_bounds() {
        let mut t = funded();
        t.streams.push(Stream {
            id: 0,
            recipient: acct(1),
            line: BudgetLine::Rewards,
            total: 1,
            claimed: 2,
            start: 0,
            duration: 1,
            cancelled: false,
        });
        assert_eq!(t.try_state().unwrap_err(), Error::Overflow);
    }
}
