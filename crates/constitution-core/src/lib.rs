#![cfg_attr(not(feature = "std"), no_std)]
#![deny(unsafe_code)]

extern crate alloc;

use alloc::vec::Vec;
use futarchy_primitives::{Balance, BlockNumber, FixedU64, ParamKey, ProposalClass};
use parity_scale_codec::{Decode, DecodeWithMemTracking, Encode, MaxEncodedLen};
use scale_info::TypeInfo;

pub use futarchy_primitives::kernel;
/// 13 §5 items 1–4's derivation inputs, re-exported so the FRAME shell and the
/// runtime guard name the same type the screen consumes (SQ-501).
pub use futarchy_primitives::kernel::{InFlightOccupancy, OccupancyParams};
pub use futarchy_primitives::INTEGRATION_CONTRACT_VERSION as CONTRACT_VERSION;

/// `twox128("Constitution") ++ twox128("ReleaseChannel")`.
pub const RELEASE_CHANNEL_STORAGE_KEY: [u8; 32] = [
    0xfb, 0x8c, 0xcb, 0xf6, 0x77, 0xa3, 0xd2, 0xce, 0x27, 0xab, 0x85, 0x16, 0x5f, 0x32, 0xdf, 0x6a,
    0xfe, 0xc7, 0x19, 0x4a, 0x53, 0x68, 0xa5, 0x8e, 0x1f, 0x6b, 0xf5, 0x74, 0x57, 0x13, 0x4a, 0x6c,
];
pub const RELEASE_CHANNEL_LEN: usize = 168;
pub const RELEASE_CHANNEL_UPDATED_AT: core::ops::Range<usize> = 108..112;
pub const RELEASE_CHANNEL_SPEC_VERSION: core::ops::Range<usize> = 112..116;
pub const RELEASE_CHANNEL_PENDING_AUTHORIZED_AT: core::ops::Range<usize> = 116..120;
pub const RELEASE_CHANNEL_FLAGS: core::ops::Range<usize> = 164..168;
pub const RELEASE_CHANNEL_FLAG_URGENT_UPGRADE: u32 = 1 << 2;
pub const MAX_PARAMS: usize = 128;
pub const MAX_CAPABILITIES: usize = 64;
pub const MAX_METERS: usize = 16;
/// 13 rule 7 meta-bound: `amend_registry` may not set a cooldown above this.
pub const META_MAX_COOLDOWN_EPOCHS: u32 = 8;
/// Genesis defaults for the B10 POL budget reader, ordered PARAM/TREASURY/
/// CODE/META as frozen by 02 §9. These remain tunable at runtime; the named
/// constants are only the fail-closed terminal fallback when both live and
/// genesis registry records are absent or kind-mismatched.
pub const POL_B_DEFAULTS: [Balance; 4] = [
    10_000_000_000,
    25_000_000_000,
    60_000_000_000,
    100_000_000_000,
];
pub const POL_GATE_B_DEFAULT: Balance = 7_500_000_000;
pub const POL_BUDGET_EPOCH_DEFAULT_PPB: u32 = 7_500_000;

pub fn gate_v_min_pair(key: ParamKey) -> Option<ParamKey> {
    for (decision, gate) in [
        (
            b"dec.v_min.param".as_slice(),
            b"gate.v_min.param".as_slice(),
        ),
        (b"dec.v_min.trs".as_slice(), b"gate.v_min.trs".as_slice()),
        (b"dec.v_min.code".as_slice(), b"gate.v_min.code".as_slice()),
        (b"dec.v_min.meta".as_slice(), b"gate.v_min.meta".as_slice()),
    ] {
        let decision = key16(decision);
        let gate = key16(gate);
        if key == decision {
            return Some(gate);
        }
        if key == gate {
            return Some(decision);
        }
    }
    None
}

pub const fn gate_v_min_coupled(decision: Balance, gate: Balance) -> bool {
    gate >= decision / 20 && gate <= decision / 2
}

/// 13 rule 7's **second** live coupling: `ledger.redeem_fee ≤ mkt.fee`
/// (03 §5.3a; 08 §10.6). Returns the partner key of either side.
///
/// It takes the identical shape to the `gate.v_min` ↔ `dec.v_min` precedent —
/// the relation is the standing invariant, it is screened **jointly over the
/// pair** at the amendment boundary, and it is asserted in `try_state`. It
/// binds earlier than the consuming engine for the same reason: the consumer is
/// a payout deduction in audit-scope-A code with no admissible way to fail
/// closed on a bad rate without stranding a claimant (03 §5.3a(5) makes it read
/// a bad record as zero), so the only safe place to refuse is before the value
/// is stored.
///
/// **Both directions are in scope**, and that is not decoration. Unlike the
/// `gate.v_min` pair, these two rows are both **PARAM**, so a single PARAM
/// decision can move either side: the screen MUST refuse a *lowering* of
/// `mkt.fee` that would carry the pair out of band exactly as it refuses a
/// *raising* of `ledger.redeem_fee`. Screening only the second key would leave
/// the invariant breakable from the first — precisely the "left for a consumer
/// to reconcile" failure rule 7 exists to prevent (13 rule 7, E1).
pub fn redeem_fee_pair(key: ParamKey) -> Option<ParamKey> {
    let redeem = key16(b"ledger.rdm_fee");
    let market = key16(b"mkt.fee");
    if key == redeem {
        return Some(market);
    }
    if key == market {
        return Some(redeem);
    }
    None
}

/// The 13 rule 7 / 08 §10.6 relation itself, over the two raw `Perbill`
/// scalars. Exit-neutrality: above `mkt.fee`, holding to settlement is dearer
/// than round-tripping through the book conditional on the position surviving
/// to a charged redemption, so the schedule would pay traders to close before
/// d18 — draining exactly the contest capital `dec.v_min` requires and `L̂`
/// measures. The unsafe direction is upward, so equality is admissible and the
/// launch default deliberately sits *at* the bound.
pub const fn redeem_fee_coupled(redeem_fee: u128, market_fee: u128) -> bool {
    redeem_fee <= market_fee
}

/// Screen the 13 rule 7 live coupling over the **resulting pair**, given the
/// amended key's post-image value and a reader for the partner's live value.
///
/// Single-homed so the frame-free core and the FRAME shell cannot drift on the
/// predicate, the key set, or which side of the relation each key is.
pub fn screen_redeem_fee_coupling(
    key: ParamKey,
    updated: ParamValue,
    paired: impl FnOnce(ParamKey) -> Option<ParamValue>,
) -> Result<(), Error> {
    let Some(pair) = redeem_fee_pair(key) else {
        return Ok(());
    };
    // A missing partner row cannot be reconciled, and 13 §1 seeds both. Fail
    // closed rather than admitting an unscreened amendment (G-1).
    let partner = paired(pair).ok_or(Error::TryStateViolation)?;
    let (redeem_fee, market_fee) = if key == key16(b"ledger.rdm_fee") {
        (updated, partner)
    } else {
        (partner, updated)
    };
    match (redeem_fee, market_fee) {
        (ParamValue::Perbill(redeem_fee), ParamValue::Perbill(market_fee)) => {
            ensure!(
                redeem_fee_coupled(redeem_fee as u128, market_fee as u128),
                Error::RedemptionFeeAboveMarketFee
            );
            Ok(())
        }
        _ => Err(Error::WrongType),
    }
}

/// 13 rule 7's **third** live coupling: `rwd.rate ≤ 2 × mkt.fee / 0.99`
/// (08 §2.6). Returns the partner key of either side.
///
/// It takes the same shape as the two couplings above and differs from them in
/// what it protects. Those each keep a consuming engine away from a value it
/// cannot fail closed on. This one carries the **whole anti-farm invariant** of
/// the trading-accuracy reward program, so a lapse here does not degrade a
/// payout path — it opens the program to a wash trader.
///
/// The per-account earning cap does not deliver that invariant, which is why
/// the rate has to. The cap is proportional to each account's *own* bond, one
/// operator funds both legs of a wash pair, and an asymmetric pair therefore
/// directs the profit to whichever leg the operator chose to bond larger. At
/// equal bonds the pair nets exactly zero, which is what made the wrong claim
/// look true. A rate inside the wash break-even is the defense that holds
/// whatever the bonds are, because the pair then loses money on fees alone.
///
/// **Both directions are in scope**, and here that is the load-bearing half.
/// Both rows are **PARAM**, so an ordinary PARAM decision can move either side:
/// `mkt.fee` may be lowered toward its 5 bps floor by a vote that never
/// mentions the reward program, which takes the wash break-even to about 10 bps
/// and makes an unmoved 25 bps `rwd.rate` farmable on rate alone. Screening
/// only `rwd.rate` would leave exactly that door open (13 rule 7).
///
/// `mkt.fee` therefore sits in **two** couplings. This screen and
/// [`screen_redeem_fee_coupling`] are independent, neither absorbs the other,
/// and every amendment path must call both.
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

/// The 08 §2.6 wash break-even itself, over the two raw `Perbill` scalars.
///
/// **Cross-multiplied on purpose.** The relation is `rwd.rate ≤ 2 × mkt.fee /
/// 0.99`, and in integers the two ways to write that division do not round the
/// same way (13 rule 7). `99 × rate / 100 ≤ 2 × fee` floors the left-hand side
/// and **admits pairs the relation forbids** — at `mkt.fee` = 2,000,000 ppb it
/// admits a rate of 4,040,405 ppb, which the relation refuses. The
/// cross-multiplied form is exact, so no caller has to make that choice twice.
///
/// Equality is admissible: at exact break-even the wash pair nets zero rather
/// than positive. The unsafe direction is a rate above the bound, so a lowering
/// of `mkt.fee` breaks the pair exactly as a raising of `rwd.rate` does.
///
/// Both products are evaluated with `checked_mul` and an unrepresentable
/// product refuses (G-1). Over the whole `Perbill` domain — the only domain the
/// screen and `try_state` can present, since both operands come from a
/// `ParamValue::Perbill` and are therefore below 2³² — neither product can
/// overflow, so this is bit-identical to the plain expression there.
///
/// `u128` mirrors [`redeem_fee_coupled`]'s shape rather than the trading-reward
/// kernel's `u32` rate. That widening is deliberate and is the only place the
/// two disagree.
pub const fn rwd_rate_coupled(rate_ppb: u128, fee_ppb: u128) -> bool {
    match (rate_ppb.checked_mul(99), fee_ppb.checked_mul(200)) {
        (Some(scaled_rate), Some(scaled_fee)) => scaled_rate <= scaled_fee,
        _ => false,
    }
}

/// Screen the 13 rule 7 / 08 §2.6 live coupling over the **resulting pair**,
/// given the amended key's post-image value and a reader for the partner's live
/// value.
///
/// Single-homed so the frame-free core and the FRAME shell cannot drift on the
/// predicate, the key set, or which side of the relation each key is.
pub fn screen_rwd_rate_coupling(
    key: ParamKey,
    updated: ParamValue,
    paired: impl FnOnce(ParamKey) -> Option<ParamValue>,
) -> Result<(), Error> {
    let Some(pair) = rwd_rate_pair(key) else {
        return Ok(());
    };
    // A missing partner row cannot be reconciled, and 13 §1 seeds both. Fail
    // closed rather than admitting an unscreened amendment (G-1).
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
pub enum ParamValue {
    U8(u8),
    U32(u32),
    Balance(Balance),
    Fixed(FixedU64),
    Percent(u8),
    Perbill(u32),
}

impl ParamValue {
    pub const fn as_u128(self) -> u128 {
        match self {
            Self::U8(v) => v as u128,
            Self::U32(v) => v as u128,
            Self::Balance(v) => v,
            Self::Fixed(v) => v.0 as u128,
            Self::Percent(v) => v as u128,
            Self::Perbill(v) => v as u128,
        }
    }

    pub const fn same_kind(self, other: Self) -> bool {
        matches!(
            (self, other),
            (Self::U8(_), Self::U8(_))
                | (Self::U32(_), Self::U32(_))
                | (Self::Balance(_), Self::Balance(_))
                | (Self::Fixed(_), Self::Fixed(_))
                | (Self::Percent(_), Self::Percent(_))
                | (Self::Perbill(_), Self::Perbill(_))
        )
    }
}

#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub enum ParamClass {
    Param,
    Treasury,
    Meta,
    Const,
    Entrenched,
    MetaAndValues,
}

impl ParamClass {
    /// 13 rule 7: the `ParamView.class` projection (02 §4) — CONST/entrenched
    /// project onto `Constitutional`, META+values onto `Meta`.
    pub const fn as_proposal_class(self) -> ProposalClass {
        match self {
            Self::Param => ProposalClass::Param,
            Self::Treasury => ProposalClass::Treasury,
            Self::Meta | Self::MetaAndValues => ProposalClass::Meta,
            Self::Const | Self::Entrenched => ProposalClass::Constitutional,
        }
    }
}

/// Per-decision rate limit for a constitution key, mirroring the three
/// Max Δ/decision semantics of the 13 §1 table: absolute steps in the key's
/// own unit (e.g. `2`, `5`), steps relative to the current value (e.g. `10%`),
/// and multiplicative bounds (e.g. `×2`).
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
pub enum MaxDelta {
    /// Absolute bound in the parameter's own unit.
    Absolute(ParamValue),
    /// Bound relative to the current value, in percent of it.
    Percent(u8),
    /// Multiplicative bound: `next ∈ [value / factor, value × factor]`.
    Factor(u8),
}

#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub struct ParamRecord {
    pub key: ParamKey,
    pub value: ParamValue,
    pub min: ParamValue,
    pub max: ParamValue,
    pub max_delta: Option<MaxDelta>,
    pub cooldown_epochs: u32,
    pub last_changed_epoch: u32,
    /// Para-block at which `value` last changed. Genesis rows use zero; this
    /// is the source of `ParamView.last_change` (02 §4, 13 reading rule 2).
    pub last_change_block: BlockNumber,
    pub class: ParamClass,
    /// 13 rule 7: bounds carry a kernel floor/ceiling and are genesis-fixed —
    /// `amend_registry` cannot move them.
    pub kernel_bounded: bool,
}

impl ParamRecord {
    /// Conservative absolute step represented by this record's current
    /// max-delta rule in both directions. The v6 `ParamView.max_delta`
    /// projection is deliberately lossy for factor rules and therefore uses
    /// the smaller allowance; [`Self::admissible_next_interval`] exposes the
    /// exact inclusive interval beside it.
    pub fn max_delta_allowance(&self) -> Result<u128, Error> {
        match self.max_delta {
            None => Ok(0),
            Some(MaxDelta::Absolute(bound)) => {
                ensure!(bound.same_kind(self.value), Error::WrongType);
                Ok(bound.as_u128())
            }
            Some(MaxDelta::Percent(percent)) => {
                let value = self.value.as_u128();
                let scaled = match value.checked_mul(u128::from(percent)) {
                    Some(scaled) => scaled,
                    None => u128::MAX,
                };
                // Unlike Factor, checked_update applies this same absolute,
                // rounded-down allowance to increases and decreases, so the
                // Percent rule itself has no directional asymmetry to project.
                Ok(scaled / 100)
            }
            Some(MaxDelta::Factor(factor)) => {
                let factor = u128::from(factor);
                ensure!(factor >= 1, Error::MetaBoundViolation);
                let value = self.value.as_u128();
                let upper = match value.checked_mul(factor) {
                    Some(upper) => upper,
                    None => u128::MAX,
                };
                let upward = upper.checked_sub(value).map_or(0, |allowance| allowance);
                let lower_floor = value / factor;
                let lower = match lower_floor.checked_add(u128::from(value % factor != 0)) {
                    Some(lower) => lower,
                    None => value,
                };
                let downward = value.checked_sub(lower).map_or(0, |allowance| allowance);
                Ok(upward.min(downward))
            }
        }
    }

    /// Exact inclusive interval admitted by the current record bounds and
    /// max-delta rule. Arithmetic mirrors [`Self::checked_update`]: percent
    /// allowances floor, factor lower bounds use `ceil(value / factor)`, and
    /// upward arithmetic saturates.
    pub fn admissible_next_interval(&self) -> Result<(u128, u128), Error> {
        ensure!(
            self.value.same_kind(self.min) && self.value.same_kind(self.max),
            Error::WrongType
        );
        let value = self.value.as_u128();
        let record_min = self.min.as_u128();
        let record_max = self.max.as_u128();
        ensure!(record_min <= record_max, Error::MetaBoundViolation);

        let (delta_min, delta_max) = match self.max_delta {
            None => (record_min, record_max),
            Some(MaxDelta::Absolute(bound)) => {
                ensure!(bound.same_kind(self.value), Error::WrongType);
                let allowance = bound.as_u128();
                (
                    value.saturating_sub(allowance),
                    value.saturating_add(allowance),
                )
            }
            Some(MaxDelta::Percent(_)) => {
                let allowance = self.max_delta_allowance()?;
                (
                    value.saturating_sub(allowance),
                    value.saturating_add(allowance),
                )
            }
            Some(MaxDelta::Factor(factor)) => {
                let factor = u128::from(factor);
                ensure!(factor >= 1, Error::MetaBoundViolation);
                let quotient = value / factor;
                let lower = quotient.saturating_add(u128::from(value % factor != 0));
                (lower, value.saturating_mul(factor))
            }
        };

        let min_next = record_min.max(delta_min);
        let max_next = record_max.min(delta_max);
        ensure!(min_next <= max_next, Error::MetaBoundViolation);
        Ok((min_next, max_next))
    }

    pub fn checked_update(
        &self,
        next: ParamValue,
        epoch: u32,
        block: BlockNumber,
    ) -> Result<Self, Error> {
        ensure!(self.value.same_kind(next), Error::WrongType);
        ensure!(
            self.min.same_kind(next) && self.max.same_kind(next),
            Error::WrongType
        );
        ensure!(next.as_u128() >= self.min.as_u128(), Error::BelowMin);
        ensure!(next.as_u128() <= self.max.as_u128(), Error::AboveMax);
        ensure!(
            epoch >= self.last_changed_epoch.saturating_add(self.cooldown_epochs),
            Error::CooldownActive
        );
        match self.max_delta {
            None => {}
            Some(MaxDelta::Absolute(bound)) => {
                ensure!(bound.same_kind(next), Error::WrongType);
                let delta = self.value.as_u128().abs_diff(next.as_u128());
                ensure!(delta <= bound.as_u128(), Error::DeltaTooLarge);
            }
            Some(MaxDelta::Percent(_)) => {
                // Allowance is recomputed from the current value on every
                // decision; flooring keeps the limit conservative.
                let allowed = self.max_delta_allowance()?;
                let delta = self.value.as_u128().abs_diff(next.as_u128());
                ensure!(delta <= allowed, Error::DeltaTooLarge);
            }
            Some(MaxDelta::Factor(factor)) => {
                let factor = u128::from(factor);
                let value = self.value.as_u128();
                let next_raw = next.as_u128();
                ensure!(
                    next_raw <= value.saturating_mul(factor)
                        && next_raw.saturating_mul(factor) >= value,
                    Error::DeltaTooLarge
                );
            }
        }
        Ok(Self {
            value: next,
            last_changed_epoch: epoch,
            last_change_block: block,
            ..*self
        })
    }

    /// `constitution.amend_registry` core (06 §2.1/§3.2; 13 rule 2/7): amend a
    /// key's governance metadata — bounds, max-Δ, cooldown — never its value,
    /// class, or key, within the compile-time meta-bounds. Kernel-bounded rows
    /// keep their bounds genesis-fixed.
    pub fn checked_amend(
        &self,
        min: ParamValue,
        max: ParamValue,
        max_delta: Option<MaxDelta>,
        cooldown_epochs: u32,
    ) -> Result<Self, Error> {
        ensure!(
            self.value.same_kind(min) && self.value.same_kind(max),
            Error::WrongType
        );
        // 13 rule 2: for kernel-bounded keys the WHOLE governance-metadata
        // tuple (min/max/max-delta/cooldown/class) is genesis-fixed — an
        // amendment could otherwise gut a rate-limit defense (e.g. widen
        // `dec.window`'s Δ) while the kernel value-envelope still held.
        if self.kernel_bounded {
            return Err(Error::KernelBoundImmutable);
        }
        ensure!(min.as_u128() <= max.as_u128(), Error::MetaBoundViolation);
        ensure!(
            self.value.as_u128() >= min.as_u128() && self.value.as_u128() <= max.as_u128(),
            Error::MetaBoundViolation
        );
        match max_delta {
            None => {}
            Some(MaxDelta::Absolute(bound)) => {
                ensure!(self.value.same_kind(bound), Error::WrongType);
            }
            Some(MaxDelta::Percent(percent)) => {
                ensure!((1..=100).contains(&percent), Error::MetaBoundViolation);
            }
            Some(MaxDelta::Factor(factor)) => {
                ensure!(factor >= 1, Error::MetaBoundViolation);
            }
        }
        ensure!(
            cooldown_epochs <= META_MAX_COOLDOWN_EPOCHS,
            Error::MetaBoundViolation
        );
        Ok(Self {
            min,
            max,
            max_delta,
            cooldown_epochs,
            ..*self
        })
    }
}

#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub struct Meter {
    pub limit: u128,
    pub spent: u128,
    pub reset_epoch: u32,
}

impl Meter {
    pub const fn new(limit: u128, reset_epoch: u32) -> Self {
        Self {
            limit,
            spent: 0,
            reset_epoch,
        }
    }

    pub fn charge(&mut self, amount: u128, epoch: u32) -> Result<(), Error> {
        // Compute on a copy so a refused charge is a strict no-op (G-1):
        // the lazy window reset must not persist through a failure — the
        // FRAME shell's transactional storage would roll it back, and the
        // randomized shell-vs-core differential pins the two paths equal.
        let mut next = *self;
        if epoch > next.reset_epoch {
            next.spent = 0;
            next.reset_epoch = epoch;
        }
        let spent = next.spent.checked_add(amount).ok_or(Error::MeterOverflow)?;
        ensure!(spent <= next.limit, Error::MeterExhausted);
        next.spent = spent;
        *self = next;
        Ok(())
    }
}

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
pub enum Capability {
    SetParam(ParamKey),
    SetCapability,
    AmendRegistry,
    SetReleaseChannel,
    AuthorizeUpgrade,
    TreasurySpend,
    OracleConfig,
    MarketTemplate,
    /// Move protocol INSURANCE custody back into MAIN without granting the
    /// broader treasury outflow surface (08 §1.2/§1.4; SQ-384).
    ///
    /// Appended deliberately: Capability is SCALE-encoded in stored records
    /// and resource keys, so the pre-existing discriminants are immutable.
    InsuranceSweep,
}

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
pub struct CapabilityRecord {
    pub class: ProposalClass,
    pub capability: Capability,
    pub enabled: bool,
}

#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub struct PhaseFlags(u32);

impl PhaseFlags {
    pub const SHADOW_MODE: u32 = 1 << 0;
    pub const PARAM_ARMED: u32 = 1 << 1;
    pub const TREASURY_ARMED: u32 = 1 << 2;
    pub const CODE_META_ARMED: u32 = 1 << 3;
    pub const SUDO_PRESENT: u32 = 1 << 4;
    pub const LEDGER_FROZEN: u32 = 1 << 5;
    pub const DEAD_MAN_ENGAGED: u32 = 1 << 6;
    pub const RESERVE_HEALTH_FLAG: u32 = 1 << 7;
    pub const RESERVED_MASK: u32 = !0xff;
    /// Bits the bootstrap-sudo path may write ("arming phase flags", 09 §5.4):
    /// the four arming bits + the sudo-present marker. Machinery bits 5–7 are
    /// owned by sibling-pallet state (PB-LEDGER-FREEZE / dead-man / reserve
    /// probe — 02 §7.3) and are writable only through their dedicated
    /// runtime-internal setters.
    pub const SUDO_ARMABLE_MASK: u32 = Self::SHADOW_MODE
        | Self::PARAM_ARMED
        | Self::TREASURY_ARMED
        | Self::CODE_META_ARMED
        | Self::SUDO_PRESENT;

    pub const fn empty() -> Self {
        Self(0)
    }
    pub const fn from_bits(bits: u32) -> Result<Self, Error> {
        if bits & Self::RESERVED_MASK == 0 {
            Ok(Self(bits))
        } else {
            Err(Error::ReservedPhaseFlag)
        }
    }
    pub const fn bits(self) -> u32 {
        self.0
    }
    pub fn contains(self, flag: u32) -> bool {
        self.0 & flag == flag
    }
    pub fn set(&mut self, flag: u32, enabled: bool) -> Result<(), Error> {
        ensure!(flag & Self::RESERVED_MASK == 0, Error::ReservedPhaseFlag);
        if enabled {
            self.0 |= flag;
        } else {
            self.0 &= !flag;
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub struct ReleaseChannel {
    pub bytes: [u8; RELEASE_CHANNEL_LEN],
}

impl ReleaseChannel {
    /// 02 §12: flags word bits — 0 `SECURITY`, 1 `EXPEDITED`,
    /// 2 `URGENT_UPGRADE`; "bits 3–31 reserved zero".
    pub const FLAGS_MASK: u32 = 0x7;

    pub fn new(bytes: [u8; RELEASE_CHANNEL_LEN]) -> Result<Self, Error> {
        ensure!(bytes[0] == 1, Error::BadReleaseSchema);
        // 02 §12 frozen layout: reserved flag bits MUST be zero — a writer
        // publishing them would make metadata-less readers diverge without a
        // schema bump.
        let flags = le_u32_at(&bytes, 164);
        ensure!(flags & !Self::FLAGS_MASK == 0, Error::BadReleaseSchema);
        Ok(Self { bytes })
    }
    pub fn updated_at(&self) -> BlockNumber {
        le_u32_at(&self.bytes, RELEASE_CHANNEL_UPDATED_AT.start)
    }
    pub fn spec_version(&self) -> u32 {
        le_u32_at(&self.bytes, RELEASE_CHANNEL_SPEC_VERSION.start)
    }
    pub fn pending_authorized_at(&self) -> u32 {
        le_u32_at(&self.bytes, RELEASE_CHANNEL_PENDING_AUTHORIZED_AT.start)
    }
    pub fn flags(&self) -> u32 {
        le_u32_at(&self.bytes, RELEASE_CHANNEL_FLAGS.start)
    }

    /// Apply a 02 §12 writer-(b) update without allowing it to overwrite the
    /// execution guard's exclusive fields. The caller owns the release
    /// descriptor, minimum-version/key-revocation tail and flag bits 0–1;
    /// offsets 112–119 and flag bit 2 remain byte-for-byte guard-owned.
    /// `updated_at` is supplied by the dispatch path, never by the caller's
    /// bytes: 02 §12 makes offset 108 the block of the last write, and a
    /// caller-chosen value would let a lawful writer backdate or future-date
    /// the freshness a stranded reader depends on.
    pub fn merge_writer_b(
        &self,
        bytes: [u8; RELEASE_CHANNEL_LEN],
        updated_at: u32,
    ) -> Result<Self, Error> {
        let caller = Self::new(bytes)?;
        let mut merged = caller.bytes;
        merged[RELEASE_CHANNEL_UPDATED_AT].copy_from_slice(&updated_at.to_le_bytes());
        merged[RELEASE_CHANNEL_SPEC_VERSION.start..RELEASE_CHANNEL_PENDING_AUTHORIZED_AT.end]
            .copy_from_slice(
                &self.bytes
                    [RELEASE_CHANNEL_SPEC_VERSION.start..RELEASE_CHANNEL_PENDING_AUTHORIZED_AT.end],
            );
        let flags = (caller.flags() & !RELEASE_CHANNEL_FLAG_URGENT_UPGRADE)
            | (self.flags() & RELEASE_CHANNEL_FLAG_URGENT_UPGRADE);
        merged[RELEASE_CHANNEL_FLAGS].copy_from_slice(&flags.to_le_bytes());
        Self::new(merged)
    }
}

#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub enum ConstitutionOrigin {
    FutarchyParam,
    FutarchyTreasury,
    FutarchyCode,
    FutarchyMeta,
    ConstitutionTrack,
    EntrenchedTrack,
    ConstitutionalValues,
    GuardianHold,
    EmergencyPlaybook,
    Root,
    Signed,
}

impl ConstitutionOrigin {
    /// 06 §3.2 authority matrix, per key class. META+values keys are enacted
    /// by the **beliefs** layer (`FutarchyMeta`) — 06 §1 is explicit that
    /// `ConstitutionalValues` cannot invoke PARAM/META parameter keys; the
    /// values half of the dual consent is the execute-time ratification check
    /// (06 §2.2, guard step 4), not a direct dispatch path (see PLAN SQ-6).
    /// CONST/entrenched-class keys are values-layer business (06 §1, §2.4),
    /// with the direction-scoped welfare-knee exception enforced by
    /// [`authorize_param_update`].
    ///
    /// No Root arm: 09 §5.4's bootstrap-sudo power list is exhaustive
    /// ("incident response, arming phase flags, the Phase-3→4 upgrade") and
    /// does not include parameter administration; 06 §3.2 has no Root column
    /// (PLAN SQ-11 tracks whether Phase-0–3 calibration needs a writer —
    /// until answered, the conservative narrow reading holds, R-7).
    pub const fn can_set_param(self, class: ParamClass) -> bool {
        matches!(
            (self, class),
            (Self::FutarchyParam, ParamClass::Param)
                | (Self::FutarchyTreasury, ParamClass::Treasury)
                | (Self::FutarchyMeta, ParamClass::Meta)
                | (Self::FutarchyMeta, ParamClass::MetaAndValues)
                | (Self::ConstitutionTrack, ParamClass::Const)
                | (Self::EntrenchedTrack, ParamClass::Entrenched)
                | (Self::ConstitutionalValues, ParamClass::Const)
                | (Self::ConstitutionalValues, ParamClass::Entrenched)
        )
    }
    /// 06 §3.2 row 4: `constitution.set_capability` is a `FutarchyMeta` call;
    /// the ConstitutionalValues column reads "ratify where rule-altering",
    /// i.e. values participates via ratification only, never direct dispatch.
    /// No Root arm (09 §5.4 exhaustive sudo scope — see `can_set_param`).
    pub const fn can_set_capability(self) -> bool {
        matches!(self, Self::FutarchyMeta)
    }
    /// 06 §3.2 row 4 / 13 rule 7 (SQ-150 ruling 2026-07-21): registry
    /// amendments are **`FutarchyMeta`-only**. Non-kernel rows are amended by
    /// META within the compile-time meta-bounds; kernel-bounded rows are
    /// **immutable** — [`ParamRecord::checked_amend`] refuses them with
    /// `KernelBoundImmutable` even for the one origin that clears this gate, so
    /// no origin can move a kernel floor/ceiling. The former dual-authority
    /// reading (a `ConstitutionalValues`/`constitution`-track path, 06 §2.1 as
    /// superseded) is removed: it let a values referendum retune META metadata
    /// while the classifier simultaneously projected the same call as
    /// FutarchyMeta (the I-8 crossing S5 pinned), and minimising the authority
    /// cannot weaken a defence through an ambiguous values path (R-7).
    ///
    /// The `class` argument is retained for the authority-matrix signature and
    /// for future per-class scoping; the resolved policy does not branch on it.
    pub const fn can_amend_registry(self, _class: ParamClass) -> bool {
        matches!(self, Self::FutarchyMeta)
    }
    /// 02 §12: the release channel's writers are exhaustive — (a) the execution
    /// guard's runtime-internal path (not origin-mediated) and (b) the scoped
    /// constitution track (or its internal bare `ConstitutionalValues` form)
    /// via `constitution.set_release_channel`.
    /// "No other origin can write it" — including bootstrap Root/sudo.
    pub const fn can_set_release_channel(self) -> bool {
        matches!(self, Self::ConstitutionTrack | Self::ConstitutionalValues)
    }
    /// No document defines a phase-flag *call*; the only origin-mediated
    /// writer the spec names is bootstrap sudo — 09 §5.4 limits sudo to
    /// "arming phase flags on evidence" (Phases 0–3, D-13). Machinery bits
    /// (ledger frozen / dead-man / reserve — 02 §7.3 bits 5–7) are written by
    /// sibling pallets through the runtime-internal path, not an origin
    /// (see PLAN SQ-5).
    pub const fn can_set_phase_flag(self) -> bool {
        matches!(self, Self::Root)
    }
    /// Meter charging is machinery (guard/treasury paths), modelled here with
    /// the origins those paths carry; the FRAME shell exposes no extrinsic
    /// for it — sibling pallets use the runtime-internal API (see PLAN SQ-12).
    /// No Root arm (09 §5.4 exhaustive sudo scope — see `can_set_param`).
    pub const fn can_charge_meter(self) -> bool {
        matches!(self, Self::FutarchyTreasury | Self::EmergencyPlaybook)
    }
}

/// Direction-aware authorization for `constitution.set_param`.
///
/// Most rows are authorized solely by [`ParamClass`]. One 13 §1 family is
/// stricter:
///
/// - the welfare low knees tighten through the constitution track and may be
///   un-tightened only through the entrenched track (05 §4.1; 06 §2.1);
///
/// Equality retains the welfare rows' CONST-class route (the constitution
/// track). The record's normal bounds, delta and cooldown checks still run
/// afterward.
pub fn authorize_param_update(
    origin: ConstitutionOrigin,
    record: &ParamRecord,
    next: ParamValue,
) -> Result<(), Error> {
    let welfare_low_knee =
        record.key == key16(b"welfare.thS_lo") || record.key == key16(b"welfare.thC_lo");
    if welfare_low_knee {
        ensure!(
            matches!(
                origin,
                ConstitutionOrigin::ConstitutionTrack | ConstitutionOrigin::EntrenchedTrack
            ),
            Error::BadOrigin
        );
        ensure!(record.value.same_kind(next), Error::WrongType);
        let current = record.value.as_u128();
        let proposed = next.as_u128();
        ensure!(
            (proposed >= current && matches!(origin, ConstitutionOrigin::ConstitutionTrack))
                || (proposed < current && matches!(origin, ConstitutionOrigin::EntrenchedTrack)),
            Error::BadOrigin
        );
        return Ok(());
    }

    ensure!(origin.can_set_param(record.class), Error::BadOrigin);
    Ok(())
}

#[derive(Clone, Debug, Decode, Encode, Eq, PartialEq, TypeInfo)]
pub struct ConstitutionState {
    pub params: Vec<ParamRecord>,
    pub meters: Vec<Meter>,
    pub capabilities: Vec<CapabilityRecord>,
    pub phase_flags: PhaseFlags,
    pub release_channel: ReleaseChannel,
}

impl ConstitutionState {
    pub fn genesis() -> Self {
        Self {
            params: genesis_params(),
            meters: genesis_meters(),
            capabilities: genesis_capabilities(),
            phase_flags: PhaseFlags::empty(),
            release_channel: empty_release_channel(),
        }
    }

    fn checked_set_param(
        &self,
        key: ParamKey,
        next: ParamValue,
        epoch: u32,
        block: BlockNumber,
    ) -> Result<(usize, ParamRecord), Error> {
        let index = self
            .params
            .iter()
            .position(|r| r.key == key)
            .ok_or(Error::UnknownParam)?;
        let updated = self.params[index].checked_update(next, epoch, block)?;
        if let Some(pair) = gate_v_min_pair(key) {
            let paired = self
                .params
                .iter()
                .find(|record| record.key == pair)
                .ok_or(Error::TryStateViolation)?;
            let (decision, gate) = if key.as_slice().starts_with(b"dec.") {
                (updated.value, paired.value)
            } else {
                (paired.value, updated.value)
            };
            match (decision, gate) {
                (ParamValue::Balance(decision), ParamValue::Balance(gate)) => {
                    ensure!(
                        gate_v_min_coupled(decision, gate),
                        Error::MetaBoundViolation
                    );
                }
                _ => return Err(Error::WrongType),
            }
        }
        // 13 rule 7's second live coupling (E1): `ledger.redeem_fee ≤ mkt.fee`,
        // screened jointly over the pair in both directions.
        screen_redeem_fee_coupling(key, updated.value, |pair| {
            self.params
                .iter()
                .find(|record| record.key == pair)
                .map(|record| record.value)
        })?;
        // 13 rule 7's third live coupling (TR9): `99 × rwd.rate ≤ 200 ×
        // mkt.fee`, screened jointly over the pair in both directions. It is
        // independent of the screen above and neither absorbs the other —
        // `mkt.fee` is a partner in both pairs, so an amendment of it must pass
        // both or the reward program's anti-farm invariant is breakable from
        // the fee side.
        screen_rwd_rate_coupling(key, updated.value, |pair| {
            self.params
                .iter()
                .find(|record| record.key == pair)
                .map(|record| record.value)
        })?;
        Ok((index, updated))
    }

    pub fn set_param(
        &mut self,
        key: ParamKey,
        next: ParamValue,
        epoch: u32,
        block: BlockNumber,
    ) -> Result<(), Error> {
        let (index, updated) = self.checked_set_param(key, next, epoch, block)?;
        self.params[index] = updated;
        Ok(())
    }

    /// `in_flight` is what the registry cannot describe (SQ-501); the FRAME
    /// shell reads it from bounded epoch state and the model's callers state it
    /// explicitly. It is a required argument rather than an `Option` with an idle
    /// default on purpose: defaulting to idle is the assumption the second #189
    /// review falsified.
    pub fn dispatch_set_param(
        &mut self,
        origin: ConstitutionOrigin,
        key: ParamKey,
        next: ParamValue,
        epoch: u32,
        block: BlockNumber,
        in_flight: InFlightOccupancy,
    ) -> Result<(), Error> {
        let record = self
            .params
            .iter()
            .find(|r| r.key == key)
            .ok_or(Error::UnknownParam)?;
        authorize_param_update(origin, record, next)?;
        let current = record.value;
        // 09 §5.2: a containment cap must not be raisable by ordinary class
        // governance inside the phase it bounds. Deliberately **not**
        // `BadOrigin` — the origin is authorized, the value direction is not.
        ensure!(
            !phase_cap_raise_refused(
                key,
                current,
                next,
                self.phase_flags.contains(PhaseFlags::PARAM_ARMED)
            ),
            Error::PhaseCapRaiseRefused
        );
        let (index, updated) = self.checked_set_param(key, next, epoch, block)?;
        self.ensure_derivations_survive(key, current, next, in_flight)?;
        self.params[index] = updated;
        Ok(())
    }

    /// 13 §5 item 6 / 08 §4.1 — the screening obligation, enforced by **value**
    /// rather than by direction (SQ-303).
    ///
    /// Two families, and they need different answers because only one of them
    /// has a machine-checkable safety property.
    ///
    /// **Class-floor keys.** 08 §4.1's per-class NAV floors are compile-time
    /// constants derived from `pol.budget_epoch`, `pol.b_gate` and the four
    /// `pol.b.*` keys, and they do not track those keys. The danger is precise:
    /// lowering the budget or raising a `b` pushes the *true* floor above the
    /// frozen literal, and §4.2's arming gate then passes a class below its real
    /// minimum-viable NAV. So re-derive the true floor from the proposed values
    /// and refuse exactly when it would exceed the literal the runtime enforces.
    ///
    /// This is what makes 08 §4.1's paired-CODE route usable rather than
    /// theoretical. The direction test this replaces refused every raise and
    /// every cut unconditionally, so a CODE proposal that correctly updated the
    /// literals still could not carry its values change through — the six keys
    /// were frozen in fact. Under a value test the same change simply passes
    /// once the literals are right, with no pairing machinery, no artifact
    /// schema and no verifier. That matters because 08 §4.1 is explicit that
    /// "no governance artifact can move them": a verifier could never have
    /// delivered the safety property, only the CODE proposal can.
    ///
    /// **Occupancy keys.** Items 1–4's bounded occupancy and PoV arithmetic is
    /// compiled in the same way, and since SQ-501 it is screened the same way:
    /// the envelopes 13 §5 publishes are single-homed as kernel constants, so a
    /// proposed `epoch.slots`, `mkt.obs_interval`, `dec.window` or `epoch.length`
    /// is re-derived against them and refused exactly when one would breach.
    /// Before that they were refused unconditionally in **both** directions,
    /// which is the same defect SQ-303 removed from the class-floor family: no
    /// value of the four keys was admissible, so their 13 §1 registry rows were
    /// declaratory. As with the class floors, the direction that is currently
    /// unsafe reopens the moment a CODE change moves the compiled figure — and,
    /// unlike a direction test, a combination that keeps every envelope inside
    /// its constant (raise `mkt.obs_interval`, then raise `dec.window`) passes
    /// today.
    fn ensure_derivations_survive(
        &self,
        key: ParamKey,
        current: ParamValue,
        next: ParamValue,
        in_flight: InFlightOccupancy,
    ) -> Result<(), Error> {
        if current.as_u128() == next.as_u128() {
            return Ok(());
        }
        let occupancy = is_occupancy_input(key);
        let class_floor = is_class_floor_input(key);
        // Every other key short-circuits before any registry scan, so ordinary
        // parameter administration pays for none of the lookups below.
        if !occupancy && !class_floor {
            return Ok(());
        }
        if occupancy {
            // One shared entry point, so the core aggregate and the runtime
            // guard cannot disagree. A missing or non-`u32` row, an overflow or
            // an unscreenable transition all answer `false` — refuse rather than
            // screen against a parameter set that does not describe reality
            // (G-1).
            ensure!(
                occupancy_change_permitted(
                    key,
                    current,
                    next,
                    |wanted| {
                        self.params
                            .iter()
                            .find(|record| record.key == wanted)
                            .map(|record| record.value)
                    },
                    in_flight,
                ),
                Error::BudgetDerivationRequired
            );
            return Ok(());
        }
        let proposed = |name: &[u8]| -> Option<u128> {
            let wanted = key16(name);
            if wanted == key {
                return Some(next.as_u128());
            }
            self.params
                .iter()
                .find(|record| record.key == wanted)
                .map(|record| record.value.as_u128())
        };
        let budget_ppb = proposed(b"pol.budget_epoch").ok_or(Error::UnknownParam)?;
        let budget_ppb = u32::try_from(budget_ppb).map_err(|_| Error::BudgetDerivationRequired)?;
        let b_gate = proposed(b"pol.b_gate").ok_or(Error::UnknownParam)?;
        let mut b_class = [0u128; 4];
        for (slot, name) in b_class.iter_mut().zip(POL_B_CLASS_KEYS.iter()) {
            *slot = proposed(name).ok_or(Error::UnknownParam)?;
        }
        ensure!(
            class_floors_survive(budget_ppb, b_gate, b_class),
            Error::BudgetDerivationRequired
        );
        Ok(())
    }

    /// Test-only: screen with nothing in flight. Every assertion written before
    /// the in-flight composition landed screened the registry alone, and
    /// composing with [`InFlightOccupancy::IDLE`] is the identity on it
    /// (`max(registry, 0) == registry`), so these keep those cases readable
    /// without letting production code default to idle.
    #[cfg(test)]
    fn dispatch_set_param_idle(
        &mut self,
        origin: ConstitutionOrigin,
        key: ParamKey,
        next: ParamValue,
        epoch: u32,
        block: BlockNumber,
    ) -> Result<(), Error> {
        self.dispatch_set_param(origin, key, next, epoch, block, InFlightOccupancy::IDLE)
    }

    #[cfg(test)]
    fn ensure_derivations_survive_idle(
        &self,
        key: ParamKey,
        current: ParamValue,
        next: ParamValue,
    ) -> Result<(), Error> {
        self.ensure_derivations_survive(key, current, next, InFlightOccupancy::IDLE)
    }

    pub fn set_capability(&mut self, capability: CapabilityRecord) -> Result<(), Error> {
        if let Some(existing) = self
            .capabilities
            .iter_mut()
            .find(|c| c.class == capability.class && c.capability == capability.capability)
        {
            *existing = capability;
            return Ok(());
        }
        ensure!(
            self.capabilities.len() < MAX_CAPABILITIES,
            Error::TooManyCapabilities
        );
        self.capabilities.push(capability);
        Ok(())
    }

    pub fn dispatch_amend_registry(
        &mut self,
        origin: ConstitutionOrigin,
        key: ParamKey,
        min: ParamValue,
        max: ParamValue,
        max_delta: Option<MaxDelta>,
        cooldown_epochs: u32,
    ) -> Result<(), Error> {
        let record = self
            .params
            .iter_mut()
            .find(|r| r.key == key)
            .ok_or(Error::UnknownParam)?;
        ensure!(origin.can_amend_registry(record.class), Error::BadOrigin);
        *record = record.checked_amend(min, max, max_delta, cooldown_epochs)?;
        Ok(())
    }

    pub fn dispatch_set_capability(
        &mut self,
        origin: ConstitutionOrigin,
        capability: CapabilityRecord,
    ) -> Result<(), Error> {
        ensure!(origin.can_set_capability(), Error::BadOrigin);
        self.set_capability(capability)
    }

    pub fn capability_enabled(&self, class: ProposalClass, capability: Capability) -> bool {
        self.capabilities
            .iter()
            .any(|c| c.class == class && c.capability == capability && c.enabled)
    }

    pub fn dispatch_set_phase_flag(
        &mut self,
        origin: ConstitutionOrigin,
        flag: u32,
        enabled: bool,
    ) -> Result<(), Error> {
        ensure!(origin.can_set_phase_flag(), Error::BadOrigin);
        // 09 §5.4: the origin-mediated path may touch arming bits only; the
        // machinery bits (5–7) belong to sibling-pallet state and have
        // dedicated internal setters in the FRAME shell.
        ensure!(
            flag & !PhaseFlags::SUDO_ARMABLE_MASK == 0,
            Error::FlagNotArmable
        );
        self.phase_flags.set(flag, enabled)
    }

    /// `updated_at` is supplied by the caller's dispatch context (the current
    /// block), never read out of `bytes` — see [`ReleaseChannelRecord::merge_writer_b`].
    pub fn dispatch_set_release_channel(
        &mut self,
        origin: ConstitutionOrigin,
        bytes: [u8; RELEASE_CHANNEL_LEN],
        updated_at: u32,
    ) -> Result<(), Error> {
        ensure!(origin.can_set_release_channel(), Error::BadOrigin);
        self.release_channel = self.release_channel.merge_writer_b(bytes, updated_at)?;
        Ok(())
    }

    pub fn dispatch_charge_meter(
        &mut self,
        origin: ConstitutionOrigin,
        index: usize,
        amount: u128,
        epoch: u32,
    ) -> Result<(), Error> {
        ensure!(origin.can_charge_meter(), Error::BadOrigin);
        let meter = self.meters.get_mut(index).ok_or(Error::UnknownMeter)?;
        meter.charge(amount, epoch)
    }

    pub fn try_state(&self) -> Result<(), Error> {
        ensure!(self.params.len() <= MAX_PARAMS, Error::TooManyParams);
        ensure!(
            self.capabilities.len() <= MAX_CAPABILITIES,
            Error::TooManyCapabilities
        );
        ensure!(self.meters.len() <= MAX_METERS, Error::TooManyMeters);
        PhaseFlags::from_bits(self.phase_flags.bits())?;
        for record in &self.params {
            ensure!(
                record.value.same_kind(record.min) && record.value.same_kind(record.max),
                Error::WrongType
            );
            ensure!(
                record.min.as_u128() <= record.max.as_u128(),
                Error::TryStateViolation
            );
            ensure!(
                record.value.as_u128() >= record.min.as_u128(),
                Error::BelowMin
            );
            ensure!(
                record.value.as_u128() <= record.max.as_u128(),
                Error::AboveMax
            );
            match record.max_delta {
                None => {}
                Some(MaxDelta::Absolute(bound)) => {
                    ensure!(record.value.same_kind(bound), Error::WrongType);
                }
                Some(MaxDelta::Percent(percent)) => {
                    ensure!((1..=100).contains(&percent), Error::WrongType);
                }
                Some(MaxDelta::Factor(factor)) => {
                    ensure!(factor >= 1, Error::WrongType);
                }
            }
        }
        for decision_key in [
            b"dec.v_min.param".as_slice(),
            b"dec.v_min.trs".as_slice(),
            b"dec.v_min.code".as_slice(),
            b"dec.v_min.meta".as_slice(),
        ] {
            let decision = self
                .params
                .iter()
                .find(|record| record.key == key16(decision_key))
                .ok_or(Error::TryStateViolation)?;
            let gate_key = gate_v_min_pair(decision.key).ok_or(Error::TryStateViolation)?;
            let gate = self
                .params
                .iter()
                .find(|record| record.key == gate_key)
                .ok_or(Error::TryStateViolation)?;
            match (decision.value, gate.value) {
                (ParamValue::Balance(decision), ParamValue::Balance(gate)) => {
                    ensure!(gate_v_min_coupled(decision, gate), Error::TryStateViolation);
                }
                _ => return Err(Error::WrongType),
            }
        }
        // 13 rule 7 / 03 §5.3a(5): the `ledger.redeem_fee ≤ mkt.fee` coupling is
        // asserted here as well as screened at the amendment boundary. The
        // backstop is load-bearing in both directions — these are two PARAM
        // rows, so either side can move — and it is the only machine check that
        // a genesis seed, a migration or an unscreened writer cannot slip past.
        // The ledger deliberately does not re-derive it per redemption
        // (03 §5.3a(5)), so nothing downstream would notice.
        let redeem_key = key16(b"ledger.rdm_fee");
        let redeem_fee = self
            .params
            .iter()
            .find(|record| record.key == redeem_key)
            .ok_or(Error::TryStateViolation)?;
        let market_key = redeem_fee_pair(redeem_key).ok_or(Error::TryStateViolation)?;
        let market_fee = self
            .params
            .iter()
            .find(|record| record.key == market_key)
            .ok_or(Error::TryStateViolation)?;
        match (redeem_fee.value, market_fee.value) {
            (ParamValue::Perbill(redeem_fee), ParamValue::Perbill(market_fee)) => {
                ensure!(
                    redeem_fee_coupled(redeem_fee as u128, market_fee as u128),
                    Error::TryStateViolation
                );
            }
            _ => return Err(Error::WrongType),
        }
        // 13 rule 7 / 08 §2.6 (TR9): the `99 × rwd.rate ≤ 200 × mkt.fee`
        // coupling is asserted here as well as screened at the amendment
        // boundary. The backstop matters more for this pair than for the one
        // above: the reward engine reads the rate and never re-derives the
        // break-even, so a genesis seed, a migration or an unscreened writer
        // that carried the pair out of band would keep paying a farmable rate
        // with nothing downstream noticing.
        let rate_key = key16(b"rwd.rate");
        let rate_record = self
            .params
            .iter()
            .find(|record| record.key == rate_key)
            .ok_or(Error::TryStateViolation)?;
        let rate_fee_key = rwd_rate_pair(rate_key).ok_or(Error::TryStateViolation)?;
        let rate_fee_record = self
            .params
            .iter()
            .find(|record| record.key == rate_fee_key)
            .ok_or(Error::TryStateViolation)?;
        match (rate_record.value, rate_fee_record.value) {
            (ParamValue::Perbill(rate), ParamValue::Perbill(fee)) => {
                ensure!(
                    rwd_rate_coupled(rate as u128, fee as u128),
                    Error::TryStateViolation
                );
            }
            _ => return Err(Error::WrongType),
        }
        for meter in &self.meters {
            ensure!(meter.spent <= meter.limit, Error::MeterExhausted);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub enum Error {
    UnknownParam,
    UnknownMeter,
    WrongType,
    BelowMin,
    AboveMax,
    DeltaTooLarge,
    CooldownActive,
    MeterOverflow,
    MeterExhausted,
    ReservedPhaseFlag,
    FlagNotArmable,
    KernelBoundImmutable,
    MetaBoundViolation,
    BadReleaseSchema,
    TooManyParams,
    TooManyMeters,
    TooManyCapabilities,
    BadOrigin,
    TryStateViolation,
    /// A 13 §5 derivation would not survive the proposed value: either an
    /// 08 §4.1 per-class NAV floor would rise above the frozen literal the
    /// treasury enforces (SQ-303), or one of items 1–4's occupancy envelopes
    /// would grow past the frozen figure the runtime compiles against
    /// (SQ-501). Also the fail-closed answer when the derivation cannot be
    /// evaluated at all (G-1).
    BudgetDerivationRequired,
    /// 09 §5.2: the two Phase-3 exposure caps are raised only by phase gates
    /// and are not PARAM/META-adjustable during Phases ≤ 3 (SQ-197).
    PhaseCapRaiseRefused,
    /// 07 §6.3 (SQ-495): the amendment would lower the bond-coverage rate
    /// `(2^orc.rounds − 1) · orc.bond_bps` below the `Δs_max` of a component
    /// already admitted to a live MetricSpec, so that component would keep
    /// settling money under a ladder that no longer covers what a lie about it
    /// can move. Raising coverage is always permitted. Appended last — the
    /// preceding discriminants are SCALE-stable.
    CoverageBreaksAdmission,
    /// 13 rule 7 / 08 §10.6 (E1): the amendment would carry the pair
    /// `ledger.redeem_fee ≤ mkt.fee` out of band — either by raising the
    /// redemption fee above the live market fee, or by lowering the market fee
    /// beneath the live redemption fee. Both rows are PARAM, so both directions
    /// are refusable and both are refused.
    ///
    /// Deliberately **not** `TryStateViolation`, which is what the `gate.v_min`
    /// screen answers: nothing has violated try-state here. Try-state is a
    /// machine-checked assertion about *stored* state, and this refusal happens
    /// precisely so that state is never reached — reporting a violation of an
    /// invariant that still holds tells a governance client the chain is broken
    /// when the truth is that its amendment was screened. Also not `AboveMax`
    /// or `BadOrigin`: the record's own static `[0, 100]` bps bounds are
    /// satisfied and the origin is authorized; it is the *resulting pair* that
    /// is not. Appended last — the preceding discriminants are SCALE-stable.
    RedemptionFeeAboveMarketFee,
    /// 13 rule 7 / 08 §2.6 (TR9): the amendment would carry the pair
    /// `99 × rwd.rate ≤ 200 × mkt.fee` out of band — either by raising the
    /// reward rate above the live wash break-even, or by lowering the market
    /// fee until the live reward rate sits above it. Both rows are PARAM, so
    /// both directions are refusable and both are refused.
    ///
    /// This refusal is what keeps the reward program's anti-farm invariant
    /// alive, not a refinement of it: above the break-even a wash pair profits
    /// on rate alone, whatever the two legs bond.
    ///
    /// Deliberately **not** `TryStateViolation`, for the reason given on
    /// `RedemptionFeeAboveMarketFee` — nothing stored is violating an invariant,
    /// and the refusal is what keeps it that way. Also not `AboveMax`: the
    /// `rwd.rate` record's own `[0, 6_000_000]` ppb bounds are satisfied, and
    /// they cannot express this relation because it moves with the live
    /// `mkt.fee`. Appended last — the preceding discriminants are SCALE-stable.
    RewardRateAboveWashBreakeven,
}

/// 09 §5.2 (SQ-197): `phase3.tvl_cap` and `phase3.dep_cap` are "raised only by
/// phase gates … not PARAM/META-adjustable during Phases ≤ 3". Both rows are
/// `0..=u128::MAX` with no max-delta and no cooldown, so ordinary `set_param`
/// under the class origin could otherwise walk a containment cap straight to
/// the unbounded sentinel while the chain is still inside the phase the cap
/// exists to bound.
///
/// Only the **raise** is refused, and only before PARAM arming. Lowering is
/// tightening and stays legal at every phase (G-1). From Phase 4 onward the
/// row behaves as 13 §115's sentinel note describes — an ordinary amendment to
/// its own ceiling, needing no distinguished value and no separate mechanism —
/// which is how the Phase-5+ sentinels are installed. The Phase-3→4 migration
/// arms `PARAM_ARMED` before applying its cap plan for exactly this reason, so
/// its scheduled raise passes the same gate every later amendment does rather
/// than needing an exemption.
pub fn phase_cap_raise_refused(
    key: ParamKey,
    current: ParamValue,
    next: ParamValue,
    param_armed: bool,
) -> bool {
    if param_armed {
        return false;
    }
    let is_phase_cap = key == key16(b"phase3.tvl_cap") || key == key16(b"phase3.dep_cap");
    is_phase_cap && next.as_u128() > current.as_u128()
}

/// The two 13 §1 keys that jointly determine 07 §6.3's bond-coverage rate
/// `(2^orc.rounds − 1) · orc.bond_bps`.
///
/// Single-homed here, beside the other key-set predicates, so the screening
/// obligation and the parameter registry cannot drift apart. The *evaluation*
/// cannot live in this crate — it needs the live MetricSpec set to know what
/// coverage is required — so it is a `Config` seam on the FRAME shell, exactly
/// like the SQ-303 budget screen (SQ-495).
pub fn is_coverage_input(key: ParamKey) -> bool {
    key == key16(b"orc.bond_bps") || key == key16(b"orc.rounds")
}

/// The four 13 §1 keys whose values feed 08 §3's per-class POL commitment, in
/// PARAM / TREASURY / CODE / META order.
pub const POL_B_CLASS_KEYS: [&[u8]; 4] =
    [b"pol.b.param", b"pol.b.trs", b"pol.b.code", b"pol.b.meta"];

/// 13 §5 item 6 keys whose change moves the **bounded occupancy / PoV**
/// arithmetic of items 1–4, and which are therefore screened by value at
/// `set_param` (SQ-501).
///
/// `ledger.archive` is deliberately **not** here. Item 6 states its own reason:
/// it "can only move downward from its one-year K ceiling, so the compiled
/// 2,240-row storage envelope remains safe". Screening it was an over-rejection
/// against the spec's own words (SQ-303). It is still an *input* to item 1's
/// re-derivation — see [`OCCUPANCY_PARAM_KEYS`] — just not a trigger.
pub fn is_occupancy_input(key: ParamKey) -> bool {
    key == key16(b"epoch.slots")
        || key == key16(b"mkt.obs_interval")
        || key == key16(b"dec.window")
        || key == key16(b"epoch.length")
}

/// Every 13 §1 key 13 §5 items 1–4 re-derive from, paired with the
/// [`OccupancyParams`] field it fills.
///
/// Single-homed (SQ-501) for the same reason [`class_floors_survive`] is: the
/// core aggregate reads them out of its own `params` vector and the runtime
/// guard reads them out of `Params` storage, and a second copy of this key list
/// that drifted would screen a different parameter set than the one being
/// written.
///
/// `ledger.archive` appears here although it is not a screening *trigger*: item
/// 1's retained-map derivation takes it as an input, and reading it live is what
/// makes that derivation true rather than assumed.
pub const OCCUPANCY_PARAM_KEYS: [&[u8]; 5] = [
    b"epoch.length",
    b"epoch.slots",
    b"mkt.obs_interval",
    b"dec.window",
    b"ledger.archive",
];

/// The complete 13 §5 items 1–4 verdict for one proposed `set_param`.
///
/// The single entry point both screens use, so there is exactly one place where
/// the equal-write short-circuit, the registry read, the in-flight composition
/// and the value test compose. `lookup` reads the *live* registry —
/// `self.params` for the core aggregate, `Params` storage for the FRAME shell —
/// and `in_flight` carries what the registry cannot describe.
///
/// **Why `in_flight` is not optional.** The first #189 review showed two
/// individually-safe amendments composing into a breach; the second showed the
/// same shape one step further out, spending a *safe* `mkt.obs_interval` raise to
/// manufacture registry headroom and converting it into a `dec.window` raise that
/// books already trading apply immediately. Any live-consumed key has that shape
/// in whichever direction increases load, so the fix is to stop screening against
/// the registry alone rather than to enumerate transitions.
///
/// `false` is the fail-closed answer for every case that cannot be evaluated
/// (G-1); `true` for keys outside the occupancy family, which this screen does
/// not govern.
pub fn occupancy_change_permitted(
    key: ParamKey,
    current: ParamValue,
    next: ParamValue,
    lookup: impl Fn(ParamKey) -> Option<ParamValue>,
    in_flight: InFlightOccupancy,
) -> bool {
    // An equal write is not a change (13 §5 item 6).
    if current.as_u128() == next.as_u128() {
        return true;
    }
    if !is_occupancy_input(key) {
        return true;
    }
    match occupancy_params_for(key, next, lookup, in_flight) {
        Some(params) => occupancy_envelopes_survive(params),
        None => false,
    }
}

/// Build the 13 §5 items 1–4 derivation inputs from a parameter set, with
/// `next` substituted for `key` exactly as the class-floor screen substitutes
/// its proposed value.
///
/// `lookup` resolves a key against the *live* registry — `self.params` for the
/// core aggregate, `Params` storage for the FRAME shell — so the two callers
/// share this extraction rather than each writing their own.
///
/// `None` on a missing row or a value outside `u32`: both are states in which
/// the envelopes cannot be evaluated, and G-1 makes that a refusal rather than a
/// pass.
pub fn occupancy_params_for(
    key: ParamKey,
    next: ParamValue,
    lookup: impl Fn(ParamKey) -> Option<ParamValue>,
    in_flight: InFlightOccupancy,
) -> Option<OccupancyParams> {
    let mut raw = [0u32; 5];
    for (slot, name) in raw.iter_mut().zip(OCCUPANCY_PARAM_KEYS.iter()) {
        let wanted = key16(name);
        let value = if wanted == key { next } else { lookup(wanted)? };
        *slot = u32::try_from(value.as_u128()).ok()?;
    }
    Some(futarchy_primitives::kernel::effective_occupancy(
        OccupancyParams {
            epoch_length: raw[0],
            epoch_slots: raw[1],
            obs_interval: raw[2],
            dec_window: raw[3],
            archive_delay: raw[4],
        },
        in_flight,
    ))
}

/// Do 13 §5 items 1–4's occupancy envelopes still hold at these parameter
/// values?
///
/// `false` means at least one re-derived envelope — retained `Markets` rows and
/// their 512 KiB budget, vault occupancy and its 13 KiB budget, the `market.reap`
/// protocol-position cells, or either keeper observation load — has grown past
/// the frozen figure 13 §5 publishes and the runtime compiles against. That is
/// the occupancy family's exact analogue of [`class_floors_survive`]: items 1–4
/// used to be refused unconditionally in both directions because their envelopes
/// existed only as prose, which left the four 13 §1 rows declaratory (SQ-501).
///
/// Single-homed here because two callers need the identical answer:
/// [`ConstitutionState::set_param`] for the core aggregate, and the runtime's
/// `BudgetDerivationGuard` for the pallet's own storage path. A second copy of
/// this arithmetic that drifted would admit a change the other refuses.
///
/// Fail-closed on any inability to evaluate (G-1): an overflow, a zero epoch
/// length or a zero observation interval answers `false`, never "no envelope was
/// breached". Every derivation rounds **up**, so the error direction is always
/// against the proposal (R-7).
pub fn occupancy_envelopes_survive(params: OccupancyParams) -> bool {
    use futarchy_primitives::kernel;

    // Item 1 — retained `Markets` rows and their byte budget.
    let Some(retained) = kernel::derived_retained_markets(&params) else {
        return false;
    };
    if retained > futarchy_primitives::bounds::MAX_STORED_MARKETS {
        return false;
    }
    let Some(all_retained) =
        retained.checked_add(futarchy_primitives::bounds::MAX_STORED_EXTERNAL_MARKETS)
    else {
        return false;
    };
    let Some(retained_bytes) = all_retained.checked_mul(kernel::MARKET_BOOK_MAX_BYTES) else {
        return false;
    };
    if retained_bytes > kernel::RETAINED_MARKETS_BUDGET_BYTES {
        return false;
    }

    // Item 2 — vault occupancy and its byte budget.
    let Some(vaults) = kernel::derived_vault_occupancy(params.epoch_slots) else {
        return false;
    };
    if vaults > kernel::LIVE_VAULT_ENVELOPE {
        return false;
    }
    let Some(vault_bytes) = vaults.checked_mul(kernel::VAULT_MAX_BYTES) else {
        return false;
    };
    if vault_bytes > kernel::VAULT_OCCUPANCY_BUDGET_BYTES {
        return false;
    }

    // Item 3 — the per-reap protocol-position universe. No 13 §1 key moves it;
    // it is re-derived anyway so this is a complete items-1–4 recomputation and
    // not a partial one.
    let Some(cells) = kernel::derived_market_reap_protocol_cells() else {
        return false;
    };
    if cells > kernel::MARKET_REAP_PROTOCOL_POSITION_CELLS {
        return false;
    }

    // Item 4 — keeper crank load, both the metered decision-critical figure
    // `keeper.budget_epoch` is sized against (08 §6.2) and the full-window
    // figure the `ops.keepers` continuity line is sized against (08 §6.3).
    let Some(decision_critical) = kernel::derived_decision_critical_observations(&params) else {
        return false;
    };
    if decision_critical > kernel::KEEPER_DECISION_CRITICAL_OBSERVATIONS {
        return false;
    }
    let Some(full_window) = kernel::derived_full_window_observations(&params) else {
        return false;
    };
    if full_window > kernel::KEEPER_FULL_WINDOW_OBSERVATIONS {
        return false;
    }

    true
}

/// Do 08 §4.1's frozen per-class NAV floors still hold at these parameter values?
///
/// `false` means at least one class's *true* floor — the 08 §3/§4.1 derivation
/// at these values — has risen above the compile-time literal the treasury
/// enforces, so §4.2's arming gate would pass that class below its real
/// minimum-viable NAV.
///
/// Single-homed here (SQ-303) because two callers need the identical answer:
/// [`ConstitutionState::set_param`] for the core aggregate, and the runtime's
/// `BudgetDerivationGuard` for the pallet's own storage path. A second copy of
/// this arithmetic that drifted would admit a change the other refuses.
///
/// Fail-closed on any inability to evaluate (G-1): an overflow or a zero POL
/// budget answers `false`, never "no floor was breached".
pub fn class_floors_survive(budget_epoch_ppb: u32, b_gate: Balance, b_class: [Balance; 4]) -> bool {
    for (index, b) in b_class.iter().enumerate() {
        let Some(derived) =
            futarchy_primitives::kernel::derived_class_nav_floor(*b, b_gate, budget_epoch_ppb)
        else {
            return false;
        };
        let Some(frozen) = futarchy_primitives::kernel::CLASS_NAV_FLOOR_USDC.get(index) else {
            return false;
        };
        if derived > *frozen {
            return false;
        }
    }
    true
}

/// Whether `key` feeds 08 §4.1's frozen per-class NAV floors.
///
/// `pol.b_baseline` is deliberately **not** here. 13 §5 item 6 admits it as an
/// item-5 re-derivation trigger on the narrow ground that item 5 carries the
/// Baseline commitment — and says in the same breath that its inclusion "is
/// *not* a claim that it moves the four class floors", 08 §4.3 keeping the
/// Baseline book outside the §4.1 arithmetic and outside `pol.budget_epoch`
/// entirely. Screening it against those floors was an over-rejection (SQ-303).
pub fn is_class_floor_input(key: ParamKey) -> bool {
    key == key16(b"pol.budget_epoch")
        || key == key16(b"pol.b_gate")
        || POL_B_CLASS_KEYS.iter().any(|name| key == key16(name))
}

macro_rules! ensure {
    ($cond:expr, $err:expr) => {
        if !$cond {
            return Err($err);
        }
    };
}
use ensure;

fn le_u32_at(bytes: &[u8; RELEASE_CHANNEL_LEN], offset: usize) -> u32 {
    u32::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ])
}

/// Canonical `ParamKey` encoding (13 rule 6): UTF-8 name, zero-padded to 16
/// bytes. Names longer than 16 bytes have explicit short keys in the 13 §1
/// registry — silent truncation is forbidden.
pub fn key16(name: &[u8]) -> ParamKey {
    assert!(
        name.len() <= 16,
        "ParamKey names longer than 16 bytes need an explicit canonical key (13 rule 6)"
    );
    let mut out = [0u8; 16];
    out[..name.len()].copy_from_slice(name);
    out
}

pub fn empty_release_channel() -> ReleaseChannel {
    let mut bytes = [0u8; RELEASE_CHANNEL_LEN];
    bytes[0] = 1;
    ReleaseChannel { bytes }
}

/// Empty at genesis: I-17's envelope meters live with their owning pallets
/// (treasury issuance/outflow, guard upgrade-spacing — 15 §1); the
/// constitution keeps the generic bounded-meter primitive for kernel
/// envelopes wired later.
pub fn genesis_meters() -> Vec<Meter> {
    Vec::new()
}

pub fn genesis_capabilities() -> Vec<CapabilityRecord> {
    alloc::vec![
        CapabilityRecord {
            class: ProposalClass::Param,
            capability: Capability::SetParam(key16(b"mkt.obs_interval")),
            enabled: true
        },
        CapabilityRecord {
            class: ProposalClass::Meta,
            capability: Capability::SetCapability,
            enabled: true
        },
        CapabilityRecord {
            // 06 §3.2 row 3: `system.authorize_upgrade` is the CODE-class
            // capability; the release channel has no origin-mediated CODE
            // writer (02 §12).
            class: ProposalClass::Code,
            capability: Capability::AuthorizeUpgrade,
            enabled: true
        },
        CapabilityRecord {
            class: ProposalClass::Treasury,
            capability: Capability::TreasurySpend,
            enabled: true
        },
        CapabilityRecord {
            class: ProposalClass::Treasury,
            capability: Capability::InsuranceSweep,
            enabled: true
        },
    ]
}

/// The materialized 13 §1 registry: every row with a scalar concrete default
/// and no open `[VERIFY]` tag, keyed per 13 rule 6 (explicit short keys for
/// names longer than 16 bytes; `.param/.trs/.code/.meta` per-class suffixes).
/// Seeding criterion for `[VERIFY]`/sim-gated rows: a concrete numeric
/// default is a simulation hypothesis (13 rule 4) and is seeded; rows whose
/// default is a formula, unset, or TGE-dependent stay out — currently
/// `fee.vit_usdc` (TGE ref), `keeper.rebate` (fee-basis formula),
/// `collator.bond` and the remaining `sec.*`/`ops.*` rows (uncalibrated).
/// The three calibrated `ops.ct_*` Coretime controls are explicit exceptions.
/// `gate.v_min` and
/// `dis.merit_min` carry derived defaults and bind at their consuming
/// engines. Kernel-bounded flags follow the enumeration in 13 rule 7.
///
/// Epoch-timing genesis seeds (`epoch.length`, `dec.window`, `dec.trailing`) are
/// read through [`timing_defaults`] so the default-off `fast-timing` build
/// (SQ-128, G1 drill 09) can seed a compressed epoch clock derived from
/// `kernel::FAST_DAY_BLOCKS`. The `cfg(not(fast-timing))` arm below carries the
/// exact frozen 13 §1 values, so the release registry — and the fixture that
/// byte-asserts it (`tools/limit-coverage/genesis-keys.json`, the constitution
/// genesis test) — is unchanged. The compressed arm keeps the relationships
/// `EpochParams::validate` enforces (D3 `dec.window <= epoch·13/21`, D4
/// `trailing <= window`); every other duration Param stays at its frozen value so
/// the emergency/execution/oracle windows can never fire inside a minute-scale
/// drill.
#[cfg(not(feature = "fast-timing"))]
mod timing_defaults {
    pub const EPOCH_LENGTH: u32 = 302_400;
    // The kernel is the single home for this ceiling (13 rule 7 makes the row
    // kernel-bounded); this module only seeds the registry record from it.
    pub const EPOCH_LENGTH_MAX: u32 = super::kernel::PRODUCTION_MAX_EPOCH_LENGTH_BLOCKS;
    pub const DEC_WINDOW: u32 = 43_200;
    pub const DEC_WINDOW_MAX: u32 = 86_400;
    pub const DEC_TRAILING: u32 = 14_400;
    pub const DEC_TRAILING_MIN: u32 = 3_600;
    pub const DEC_TRAILING_MAX: u32 = 28_800;
}
#[cfg(feature = "fast-timing")]
mod timing_defaults {
    use super::kernel::FAST_DAY_BLOCKS as DAY;
    /// 21 · FAST_DAY (matches the 21-phase-unit epoch); clears the compressed
    /// `MIN_EPOCH_LENGTH_BLOCKS` (14 · FAST_DAY) and stays a multiple of 21.
    pub const EPOCH_LENGTH: u32 = 21 * DAY;
    pub const EPOCH_LENGTH_MAX: u32 = 42 * DAY;
    /// 3 · FAST_DAY (72 h); `<= EPOCH_LENGTH · 13/21` holds (3 <= 13).
    pub const DEC_WINDOW: u32 = 3 * DAY;
    pub const DEC_WINDOW_MAX: u32 = 6 * DAY;
    /// 1 · FAST_DAY (24 h) trailing window; `<= DEC_WINDOW` holds.
    pub const DEC_TRAILING: u32 = DAY;
    pub const DEC_TRAILING_MIN: u32 = DAY / 4;
    pub const DEC_TRAILING_MAX: u32 = 2 * DAY;
}

#[allow(clippy::too_many_lines)]
pub fn genesis_params() -> Vec<ParamRecord> {
    #[allow(clippy::too_many_arguments)]
    fn row(
        key: &[u8],
        value: ParamValue,
        min: ParamValue,
        max: ParamValue,
        max_delta: Option<MaxDelta>,
        cooldown_epochs: u32,
        class: ParamClass,
        kernel_bounded: bool,
    ) -> ParamRecord {
        ParamRecord {
            key: key16(key),
            value,
            min,
            max,
            max_delta,
            cooldown_epochs,
            last_changed_epoch: 0,
            last_change_block: 0,
            class,
            kernel_bounded,
        }
    }
    alloc::vec![
        row(
            b"epoch.length",
            ParamValue::U32(timing_defaults::EPOCH_LENGTH),
            ParamValue::U32(kernel::MIN_EPOCH_LENGTH_BLOCKS),
            ParamValue::U32(timing_defaults::EPOCH_LENGTH_MAX),
            Some(MaxDelta::Percent(10)),
            2,
            ParamClass::Meta,
            true
        ),
        row(
            b"epoch.slots",
            ParamValue::U8(5),
            ParamValue::U8(1),
            ParamValue::U8(12),
            Some(MaxDelta::Absolute(ParamValue::U8(2))),
            1,
            ParamClass::Meta,
            false
        ),
        row(
            b"epoch.horizon_k",
            ParamValue::U8(2),
            ParamValue::U8(1),
            // Kernel ceiling `MAX_NON_TERMINAL_COHORTS - 2` (13 §1, SQ-496):
            // 05 §3.3 spends the other two cohort slots on the awaiting-oracle
            // and settling epochs, so `k = 3` would need five live slots and
            // wedge `qualify` permanently. `true` below marks the row
            // kernel-bounded, so `amend_registry` cannot raise the ceiling back.
            ParamValue::U8(2),
            Some(MaxDelta::Absolute(ParamValue::U8(1))),
            4,
            ParamClass::MetaAndValues,
            true
        ),
        row(
            b"mkt.obs_interval",
            ParamValue::U32(10),
            ParamValue::U32(5),
            ParamValue::U32(50),
            Some(MaxDelta::Absolute(ParamValue::U32(5))),
            1,
            ParamClass::Param,
            false
        ),
        row(
            b"mkt.kappa",
            ParamValue::Fixed(FixedU64(5_000_000)),
            ParamValue::Fixed(FixedU64(1_000_000)),
            ParamValue::Fixed(FixedU64(20_000_000)),
            Some(MaxDelta::Absolute(ParamValue::Fixed(FixedU64(2_000_000)))),
            2,
            ParamClass::Meta,
            true
        ),
        row(
            b"mkt.fee",
            ParamValue::Perbill(3_000_000),
            ParamValue::Perbill(500_000),
            ParamValue::Perbill(10_000_000),
            Some(MaxDelta::Absolute(ParamValue::Perbill(1_000_000))),
            1,
            ParamClass::Param,
            false
        ),
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
        row(
            b"dec.window",
            ParamValue::U32(timing_defaults::DEC_WINDOW),
            ParamValue::U32(kernel::DECISION_WINDOW_FLOOR_BLOCKS),
            ParamValue::U32(timing_defaults::DEC_WINDOW_MAX),
            Some(MaxDelta::Percent(20)),
            2,
            ParamClass::Meta,
            true
        ),
        row(
            b"dec.trailing",
            ParamValue::U32(timing_defaults::DEC_TRAILING),
            ParamValue::U32(timing_defaults::DEC_TRAILING_MIN),
            ParamValue::U32(timing_defaults::DEC_TRAILING_MAX),
            None,
            2,
            ParamClass::Meta,
            false
        ),
        row(
            b"dec.delta_max",
            ParamValue::Fixed(FixedU64(50_000_000)),
            ParamValue::Fixed(FixedU64(20_000_000)),
            ParamValue::Fixed(FixedU64(100_000_000)),
            None,
            2,
            ParamClass::Meta,
            false
        ),
        row(
            b"dec.coverage",
            ParamValue::Percent(95),
            ParamValue::Percent(90),
            ParamValue::Percent(99),
            None,
            2,
            ParamClass::Meta,
            false
        ),
        row(
            b"gate.p_max",
            ParamValue::Fixed(FixedU64(50_000_000)),
            ParamValue::Fixed(FixedU64(0)),
            ParamValue::Fixed(FixedU64(kernel::GATE_P_MAX_CEILING_1E9)),
            Some(MaxDelta::Absolute(ParamValue::Fixed(FixedU64(10_000_000)))),
            4,
            ParamClass::MetaAndValues,
            true
        ),
        row(
            b"gate.eps",
            ParamValue::Fixed(FixedU64(20_000_000)),
            ParamValue::Fixed(kernel::GATE_EPS_FLOOR),
            ParamValue::Fixed(FixedU64(50_000_000)),
            None,
            2,
            ParamClass::Meta,
            true
        ),
        row(
            b"gate.nb_coverage",
            ParamValue::Percent(98),
            ParamValue::Percent(95),
            ParamValue::Percent(100),
            None,
            2,
            ParamClass::Meta,
            false
        ),
        row(
            b"gate.nb_conv",
            ParamValue::Fixed(FixedU64(10_000_000)),
            ParamValue::Fixed(FixedU64(5_000_000)),
            ParamValue::Fixed(FixedU64(20_000_000)),
            None,
            2,
            ParamClass::Meta,
            false
        ),
        row(
            b"exec.grace",
            ParamValue::U32(201_600),
            ParamValue::U32(kernel::EXECUTION_GRACE_FLOOR_BLOCKS),
            ParamValue::U32(432_000),
            None,
            2,
            ParamClass::Meta,
            true
        ),
        row(
            b"code.spacing",
            ParamValue::U32(432_000),
            ParamValue::U32(201_600),
            ParamValue::U32(u32::MAX),
            None,
            2,
            ParamClass::Meta,
            true
        ),
        row(
            b"dec.delta.param",
            ParamValue::Fixed(FixedU64(37_500_000)),
            ParamValue::Fixed(kernel::DECISION_DELTA_FLOOR),
            ParamValue::Fixed(FixedU64(100_000_000)),
            Some(MaxDelta::Absolute(ParamValue::Fixed(FixedU64(5_000_000)))),
            2,
            ParamClass::Meta,
            true
        ),
        row(
            b"dec.delta.trs",
            ParamValue::Fixed(FixedU64(37_500_000)),
            ParamValue::Fixed(kernel::DECISION_DELTA_FLOOR),
            ParamValue::Fixed(FixedU64(100_000_000)),
            Some(MaxDelta::Absolute(ParamValue::Fixed(FixedU64(5_000_000)))),
            2,
            ParamClass::Meta,
            true
        ),
        row(
            b"dec.delta.code",
            ParamValue::Fixed(FixedU64(60_000_000)),
            ParamValue::Fixed(kernel::DECISION_DELTA_FLOOR),
            ParamValue::Fixed(FixedU64(100_000_000)),
            Some(MaxDelta::Absolute(ParamValue::Fixed(FixedU64(5_000_000)))),
            2,
            ParamClass::Meta,
            true
        ),
        row(
            b"dec.delta.meta",
            ParamValue::Fixed(FixedU64(90_000_000)),
            ParamValue::Fixed(kernel::DECISION_DELTA_FLOOR),
            ParamValue::Fixed(FixedU64(100_000_000)),
            Some(MaxDelta::Absolute(ParamValue::Fixed(FixedU64(5_000_000)))),
            2,
            ParamClass::Meta,
            true
        ),
        row(
            b"dec.sigma.param",
            ParamValue::Fixed(FixedU64(3_000_000)),
            ParamValue::Fixed(kernel::DECISION_SIGMA_FLOOR),
            ParamValue::Fixed(FixedU64(50_000_000)),
            None,
            2,
            ParamClass::Meta,
            true
        ),
        row(
            b"dec.sigma.trs",
            ParamValue::Fixed(FixedU64(5_000_000)),
            ParamValue::Fixed(kernel::DECISION_SIGMA_FLOOR),
            ParamValue::Fixed(FixedU64(50_000_000)),
            None,
            2,
            ParamClass::Meta,
            true
        ),
        row(
            b"dec.sigma.code",
            ParamValue::Fixed(FixedU64(8_000_000)),
            ParamValue::Fixed(kernel::DECISION_SIGMA_FLOOR),
            ParamValue::Fixed(FixedU64(50_000_000)),
            None,
            2,
            ParamClass::Meta,
            true
        ),
        row(
            b"dec.sigma.meta",
            ParamValue::Fixed(FixedU64(10_000_000)),
            ParamValue::Fixed(kernel::DECISION_SIGMA_FLOOR),
            ParamValue::Fixed(FixedU64(50_000_000)),
            None,
            2,
            ParamClass::Meta,
            true
        ),
        row(
            b"dec.v_min.param",
            ParamValue::Balance(100_000_000_000),
            ParamValue::Balance(10_000_000_000),
            ParamValue::Balance(1_000_000_000_000),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Meta,
            false
        ),
        row(
            b"dec.v_min.trs",
            ParamValue::Balance(250_000_000_000),
            ParamValue::Balance(25_000_000_000),
            ParamValue::Balance(2_500_000_000_000),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Meta,
            false
        ),
        row(
            b"dec.v_min.code",
            ParamValue::Balance(600_000_000_000),
            ParamValue::Balance(60_000_000_000),
            ParamValue::Balance(6_000_000_000_000),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Meta,
            false
        ),
        row(
            b"dec.v_min.meta",
            ParamValue::Balance(1_200_000_000_000),
            ParamValue::Balance(120_000_000_000),
            ParamValue::Balance(12_000_000_000_000),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Meta,
            false
        ),
        row(
            b"gate.v_min.param",
            ParamValue::Balance(10_000_000_000),
            ParamValue::Balance(5_000_000_000),
            ParamValue::Balance(50_000_000_000),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Meta,
            false
        ),
        row(
            b"gate.v_min.trs",
            ParamValue::Balance(25_000_000_000),
            ParamValue::Balance(12_500_000_000),
            ParamValue::Balance(125_000_000_000),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Meta,
            false
        ),
        row(
            b"gate.v_min.code",
            ParamValue::Balance(60_000_000_000),
            ParamValue::Balance(30_000_000_000),
            ParamValue::Balance(300_000_000_000),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Meta,
            false
        ),
        row(
            b"gate.v_min.meta",
            ParamValue::Balance(120_000_000_000),
            ParamValue::Balance(60_000_000_000),
            ParamValue::Balance(600_000_000_000),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Meta,
            false
        ),
        row(
            b"prop.bond.param",
            ParamValue::Balance(1_000_000_000),
            ParamValue::Balance(100_000_000),
            ParamValue::Balance(10_000_000_000),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Meta,
            false
        ),
        row(
            b"prop.bond.trs",
            ParamValue::Balance(5_000_000_000),
            ParamValue::Balance(500_000_000),
            ParamValue::Balance(50_000_000_000),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Meta,
            false
        ),
        row(
            b"prop.bond.code",
            ParamValue::Balance(25_000_000_000),
            ParamValue::Balance(2_500_000_000),
            ParamValue::Balance(250_000_000_000),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Meta,
            false
        ),
        row(
            b"prop.bond.meta",
            ParamValue::Balance(50_000_000_000),
            ParamValue::Balance(5_000_000_000),
            ParamValue::Balance(500_000_000_000),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Meta,
            false
        ),
        row(
            b"exec.lock.param",
            ParamValue::U32(28_800),
            ParamValue::U32(kernel::EXECUTION_TIMELOCK_FLOOR_BLOCKS),
            ParamValue::U32(432_000),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Meta,
            true
        ),
        row(
            b"exec.lock.trs",
            ParamValue::U32(43_200),
            ParamValue::U32(kernel::EXECUTION_TIMELOCK_FLOOR_BLOCKS),
            ParamValue::U32(432_000),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Meta,
            true
        ),
        row(
            b"exec.lock.code",
            ParamValue::U32(100_800),
            ParamValue::U32(kernel::EXECUTION_TIMELOCK_FLOOR_BLOCKS),
            ParamValue::U32(432_000),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Meta,
            true
        ),
        row(
            b"exec.lock.meta",
            ParamValue::U32(201_600),
            ParamValue::U32(kernel::EXECUTION_TIMELOCK_FLOOR_BLOCKS),
            ParamValue::U32(432_000),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Meta,
            true
        ),
        row(
            b"intake.max_acct",
            ParamValue::U8(4),
            ParamValue::U8(2),
            ParamValue::U8(8),
            Some(MaxDelta::Absolute(ParamValue::U8(2))),
            2,
            ParamClass::Meta,
            false
        ),
        row(
            b"intake.slash_pct",
            ParamValue::Percent(10),
            ParamValue::Percent(5),
            ParamValue::Percent(25),
            Some(MaxDelta::Absolute(ParamValue::Percent(5))),
            2,
            ParamClass::Meta,
            true
        ),
        row(
            b"pol.b.param",
            ParamValue::Balance(POL_B_DEFAULTS[0]),
            ParamValue::Balance(0),
            ParamValue::Balance(u128::MAX),
            Some(MaxDelta::Percent(25)),
            1,
            ParamClass::Treasury,
            false
        ),
        row(
            b"pol.b.trs",
            ParamValue::Balance(POL_B_DEFAULTS[1]),
            ParamValue::Balance(0),
            ParamValue::Balance(u128::MAX),
            Some(MaxDelta::Percent(25)),
            1,
            ParamClass::Treasury,
            false
        ),
        row(
            b"pol.b.code",
            ParamValue::Balance(POL_B_DEFAULTS[2]),
            ParamValue::Balance(0),
            ParamValue::Balance(u128::MAX),
            Some(MaxDelta::Percent(25)),
            1,
            ParamClass::Treasury,
            false
        ),
        row(
            b"pol.b.meta",
            ParamValue::Balance(POL_B_DEFAULTS[3]),
            ParamValue::Balance(0),
            ParamValue::Balance(u128::MAX),
            Some(MaxDelta::Percent(25)),
            1,
            ParamClass::Treasury,
            false
        ),
        row(
            b"pol.b_gate",
            ParamValue::Balance(POL_GATE_B_DEFAULT),
            ParamValue::Balance(0),
            ParamValue::Balance(u128::MAX),
            Some(MaxDelta::Percent(25)),
            1,
            ParamClass::Treasury,
            false
        ),
        row(
            b"pol.budget_epoch",
            ParamValue::Perbill(POL_BUDGET_EPOCH_DEFAULT_PPB),
            ParamValue::Perbill(0),
            ParamValue::Perbill(15_000_000),
            None,
            2,
            ParamClass::Meta,
            true
        ),
        row(
            b"trs.cap_proposal",
            ParamValue::Percent(5),
            ParamValue::Percent(0),
            ParamValue::Percent(10),
            Some(MaxDelta::Absolute(ParamValue::Percent(1))),
            2,
            ParamClass::Meta,
            true
        ),
        row(
            b"trs.cap_30d",
            ParamValue::Percent(10),
            ParamValue::Percent(0),
            ParamValue::Percent(15),
            None,
            2,
            ParamClass::Meta,
            true
        ),
        row(
            b"trs.cap_180d",
            ParamValue::Percent(30),
            ParamValue::Percent(0),
            ParamValue::Percent(40),
            None,
            2,
            ParamClass::Meta,
            true
        ),
        row(
            b"trs.stream_thr",
            ParamValue::Perbill(10_000_000),
            ParamValue::Perbill(5_000_000),
            ParamValue::Perbill(50_000_000),
            None,
            2,
            ParamClass::Meta,
            false
        ),
        row(
            b"trs.reward.param",
            ParamValue::Balance(500_000_000),
            ParamValue::Balance(50_000_000),
            ParamValue::Balance(5_000_000_000),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Meta,
            false
        ),
        row(
            b"trs.reward.trs",
            ParamValue::Balance(25_000_000_000),
            ParamValue::Balance(2_500_000_000),
            ParamValue::Balance(250_000_000_000),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Meta,
            false
        ),
        row(
            b"trs.reward.code",
            ParamValue::Balance(25_000_000_000),
            ParamValue::Balance(2_500_000_000),
            ParamValue::Balance(250_000_000_000),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Meta,
            false
        ),
        row(
            b"trs.reward.meta",
            ParamValue::Balance(25_000_000_000),
            ParamValue::Balance(2_500_000_000),
            ParamValue::Balance(250_000_000_000),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Meta,
            false
        ),
        row(
            b"iss.inflation",
            ParamValue::Percent(2),
            ParamValue::Percent(0),
            ParamValue::Percent(2),
            None,
            0,
            ParamClass::Const,
            true
        ),
        row(
            b"welfare.thS_lo",
            ParamValue::Fixed(FixedU64(900_000_000)),
            ParamValue::Fixed(FixedU64(900_000_000)),
            ParamValue::Fixed(FixedU64(1_000_000_000)),
            Some(MaxDelta::Absolute(ParamValue::Fixed(FixedU64(10_000_000)))),
            4,
            ParamClass::Const,
            true
        ),
        row(
            b"welfare.thS_hi",
            ParamValue::Fixed(FixedU64(980_000_000)),
            ParamValue::Fixed(FixedU64(900_000_000)),
            ParamValue::Fixed(FixedU64(1_000_000_000)),
            Some(MaxDelta::Absolute(ParamValue::Fixed(FixedU64(10_000_000)))),
            4,
            ParamClass::Const,
            false
        ),
        row(
            b"welfare.thC_lo",
            ParamValue::Fixed(FixedU64(850_000_000)),
            ParamValue::Fixed(FixedU64(850_000_000)),
            ParamValue::Fixed(FixedU64(1_000_000_000)),
            Some(MaxDelta::Absolute(ParamValue::Fixed(FixedU64(10_000_000)))),
            4,
            ParamClass::Const,
            true
        ),
        row(
            b"welfare.thC_hi",
            ParamValue::Fixed(FixedU64(950_000_000)),
            ParamValue::Fixed(FixedU64(850_000_000)),
            ParamValue::Fixed(FixedU64(1_000_000_000)),
            Some(MaxDelta::Absolute(ParamValue::Fixed(FixedU64(10_000_000)))),
            4,
            ParamClass::Const,
            false
        ),
        row(
            b"welfare.wP",
            ParamValue::Fixed(FixedU64(600_000_000)),
            ParamValue::Fixed(FixedU64(300_000_000)),
            ParamValue::Fixed(FixedU64(700_000_000)),
            Some(MaxDelta::Absolute(ParamValue::Fixed(FixedU64(50_000_000)))),
            4,
            ParamClass::Const,
            false
        ),
        row(
            b"welfare.wA",
            ParamValue::Fixed(FixedU64(400_000_000)),
            ParamValue::Fixed(FixedU64(300_000_000)),
            ParamValue::Fixed(FixedU64(700_000_000)),
            Some(MaxDelta::Absolute(ParamValue::Fixed(FixedU64(50_000_000)))),
            4,
            ParamClass::Const,
            false
        ),
        row(
            b"orc.bond_floor",
            ParamValue::Balance(10_000_000_000),
            ParamValue::Balance(2_500_000_000),
            ParamValue::Balance(100_000_000_000),
            None,
            2,
            ParamClass::Meta,
            false
        ),
        row(
            b"orc.bond_bps",
            ParamValue::Perbill(25_000_000),
            ParamValue::Perbill(15_000_000),
            ParamValue::Perbill(100_000_000),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Meta,
            true
        ),
        row(
            b"orc.rounds",
            ParamValue::U8(3),
            ParamValue::U8(kernel::ORC_ROUNDS_MIN),
            ParamValue::U8(kernel::ORC_ROUNDS_MAX),
            None,
            2,
            ParamClass::Meta,
            false
        ),
        row(
            b"orc.window",
            ParamValue::U32(43_200),
            ParamValue::U32(43_200),
            ParamValue::U32(72_000),
            None,
            2,
            ParamClass::Meta,
            true
        ),
        row(
            b"orc.rep_stake",
            ParamValue::Balance(100_000_000_000),
            ParamValue::Balance(25_000_000_000),
            ParamValue::Balance(500_000_000_000),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Meta,
            false
        ),
        row(
            b"orc.n_min",
            ParamValue::U8(kernel::ORC_REPORTERS_MIN),
            ParamValue::U8(kernel::ORC_REPORTERS_MIN),
            ParamValue::U8(16),
            Some(MaxDelta::Absolute(ParamValue::U8(1))),
            2,
            ParamClass::Meta,
            true
        ),
        row(
            b"wt.quorum",
            ParamValue::U8(2),
            ParamValue::U8(2),
            ParamValue::U8(5),
            Some(MaxDelta::Absolute(ParamValue::U8(1))),
            2,
            ParamClass::Meta,
            true
        ),
        row(
            b"wt.stake",
            ParamValue::Balance(25_000_000_000),
            ParamValue::Balance(10_000_000_000),
            ParamValue::Balance(100_000_000_000),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Meta,
            false
        ),
        row(
            b"reg.bond_inc",
            ParamValue::Balance(5_000_000_000),
            ParamValue::Balance(2_500_000_000),
            ParamValue::Balance(50_000_000_000),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Meta,
            false
        ),
        row(
            b"reg.bond_mile",
            ParamValue::Balance(2_500_000_000),
            ParamValue::Balance(1_250_000_000),
            ParamValue::Balance(25_000_000_000),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Meta,
            false
        ),
        row(
            b"res.probe_int",
            ParamValue::U32(14_400),
            ParamValue::U32(1),
            ParamValue::U32(u32::MAX),
            None,
            1,
            ParamClass::Param,
            true
        ),
        row(
            b"res.probe_to",
            ParamValue::U32(600),
            ParamValue::U32(1),
            ParamValue::U32(u32::MAX),
            None,
            1,
            ParamClass::Param,
            true
        ),
        row(
            b"res.probe_amount",
            ParamValue::Balance(100_000),
            ParamValue::Balance(1),
            ParamValue::Balance(u128::MAX),
            None,
            1,
            ParamClass::Param,
            true
        ),
        row(
            b"res.fail_thr",
            ParamValue::U8(2),
            ParamValue::U8(1),
            ParamValue::U8(u8::MAX),
            None,
            2,
            ParamClass::Meta,
            true
        ),
        row(
            b"res.recover_thr",
            ParamValue::U8(3),
            ParamValue::U8(1),
            ParamValue::U8(u8::MAX),
            None,
            2,
            ParamClass::Meta,
            true
        ),
        row(
            b"grd.review_dl",
            ParamValue::U32(2),
            ParamValue::U32(1),
            ParamValue::U32(4),
            Some(MaxDelta::Absolute(ParamValue::U32(1))),
            2,
            ParamClass::Meta,
            false
        ),
        row(
            b"att.bond",
            ParamValue::Balance(25_000_000_000_000_000),
            ParamValue::Balance(12_500_000_000_000_000),
            ParamValue::Balance(250_000_000_000_000_000),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Entrenched,
            false
        ),
        row(
            b"att.window",
            ParamValue::U32(43_200),
            ParamValue::U32(43_200),
            ParamValue::U32(72_000),
            None,
            2,
            ParamClass::Meta,
            true
        ),
        row(
            b"keeper.budget",
            ParamValue::Balance(12_000_000_000),
            ParamValue::Balance(kernel::KEEPER_BUDGET_EPOCH_FLOOR_USDC),
            ParamValue::Balance(60_000_000_000),
            Some(MaxDelta::Factor(2)),
            1,
            ParamClass::Param,
            true
        ),
        row(
            // SQ-117 (ruled 2026-07-21): genesis-seeded from the 08 §6.2 crank-
            // fee basis so B9's rebate pipeline stops paying zero. Default 3×,
            // hard min 1×, hard max 10× the SAME basis (13 §1), so the whole row
            // scales with one number. The basis is the [VERIFY] placeholder of
            // 08 §6.2 (0.03 USDC); the seed is replaced — rounded DOWN against
            // the claimant (R-7) — once launch `fee.vit_usdc_rate` fixes it.
            b"keeper.rebate",
            ParamValue::Balance(kernel::KEEPER_REBATE_FEE_BASIS_USDC.saturating_mul(3)),
            ParamValue::Balance(kernel::KEEPER_REBATE_FEE_BASIS_USDC),
            ParamValue::Balance(kernel::KEEPER_REBATE_FEE_BASIS_USDC.saturating_mul(10)),
            None,
            1,
            ParamClass::Param,
            false
        ),
        row(
            // SQ-158 (owner A13): a distinct 13 §1 key so the values layer can
            // raise the ProcessHold merit floor independently of B_1 (07 §12,
            // default equality). Floor `orc.bond_floor`, ceiling `Balance::MAX`,
            // factor-2 step, 2-epoch cooldown, META. The consumer composes
            // `max(live key, frozen B_1)` so a lowering can never make
            // censorship cheaper than the game's own round-1 bond (R-7).
            b"dis.merit_min",
            ParamValue::Balance(10_000_000_000),
            ParamValue::Balance(10_000_000_000),
            ParamValue::Balance(u128::MAX),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Meta,
            false
        ),
        row(
            b"ops.ct_dot_rate",
            ParamValue::Balance(5_000_000),
            ParamValue::Balance(500_000),
            ParamValue::Balance(500_000_000),
            Some(MaxDelta::Factor(2)),
            1,
            ParamClass::Treasury,
            false
        ),
        row(
            b"ops.ct_fee_dot",
            ParamValue::Balance(5_000_000_000),
            ParamValue::Balance(100_000_000),
            ParamValue::Balance(100_000_000_000),
            Some(MaxDelta::Factor(2)),
            1,
            ParamClass::Treasury,
            false
        ),
        row(
            // SQ-114: bounded DOT held by one reserve probe for Asset Hub
            // execution + response delivery. The launch placeholder inherits
            // the already-conservative two-leg Coretime envelope and retains
            // its [VERIFY] status pending live Asset Hub fee calibration.
            b"ops.probe_fee",
            ParamValue::Balance(5_000_000_000),
            ParamValue::Balance(100_000_000),
            ParamValue::Balance(100_000_000_000),
            Some(MaxDelta::Factor(2)),
            1,
            ParamClass::Treasury,
            false
        ),
        row(
            // Dedicated reserve-probe DOT→USDC accounting rate. It starts at
            // the same conservative placeholder as Coretime but remains an
            // independently governed key so repricing one maintenance route
            // cannot silently resize the other (SQ-114).
            b"ops.probe_rate",
            ParamValue::Balance(5_000_000),
            ParamValue::Balance(500_000),
            ParamValue::Balance(500_000_000),
            Some(MaxDelta::Factor(2)),
            1,
            ParamClass::Treasury,
            false
        ),
        row(
            b"ops.ct_quote_ttl",
            ParamValue::U32(100_800),
            ParamValue::U32(7_200),
            ParamValue::U32(403_200),
            Some(MaxDelta::Factor(2)),
            1,
            ParamClass::Treasury,
            false
        ),
        row(
            b"collator.comp",
            // SQ-536 (milestone E5 pass 2): seeded at the registry MINIMUM,
            // 500 USDC/collator/epoch, re-anchored from the superseded 2,000.
            //
            // 2,000 was a D-15 initial value with no cost evidence behind it.
            // The anchor is Polkadot OpenGov referendum #1870 (passed and
            // executed), which funds 38 system-parachain collators at $250 per
            // collator per month, $307.24 fully loaded with the bounty's own
            // hosting/curator/coordinator lines. An epoch is 21.0 days, so that
            // is 211.97 USDC/epoch — making the superseded seed 9.44x the rate
            // real operators accepted for the same job, and this one 2.36x.
            //
            // The comparison is like-for-like on the axis that matters: a
            // Bleavit collator earns nothing from fees or tips (D-15 burns VIT
            // fees; `OnChargeTransaction`'s `()` drops the imbalance), exactly
            // as a Polkadot system parachain's collator does, so in both cases
            // the treasury line IS the whole compensation.
            //
            // The unsafe direction is UNDER-paying. What bounds it is the
            // 2.36x margin, recovery at x2 per PARAM amendment on a 1-epoch
            // cooldown, and the 13 §1 gate requiring re-verification against
            // operator quotes for THIS chain before production launch and
            // before each enlargement of the collator set.
            //
            // Two things that look like protection here and are NOT, both
            // wrongly cited by earlier revisions of this comment:
            //
            //   * the fail-soft payout. `collator_compensation` computes the
            //     pool from THIS value and a successful payout clears the
            //     accumulator, so fail-soft catches an underfunded *line* (the
            //     claim survives for a retry) while an underpriced *row* pays
            //     out in full and retains no unpaid difference.
            //   * invulnerability of the launch set. That fixes an account's
            //     *selection* status; it does not oblige anyone to keep
            //     authoring at a rate they will not accept. The launch
            //     operators are also the most likely to be standing up
            //     infrastructure for this chain, which is exactly the case the
            //     marginal-cost anchor does not cover.
            // Derivation and margin are machine-checked in the reference model
            // (`sustainability.collator_anchor_multiple`).
            ParamValue::Balance(500_000_000),
            ParamValue::Balance(500_000_000),
            ParamValue::Balance(10_000_000_000),
            Some(MaxDelta::Factor(2)),
            1,
            ParamClass::Param,
            false
        ),
        row(
            b"collator.n_min",
            ParamValue::U8(4),
            ParamValue::U8(3),
            ParamValue::U8(12),
            Some(MaxDelta::Absolute(ParamValue::U8(1))),
            2,
            ParamClass::Meta,
            false
        ),
        row(
            b"ledger.min_split",
            ParamValue::Balance(kernel::MIN_SPLIT_USDC),
            ParamValue::Balance(kernel::MIN_SPLIT_USDC),
            ParamValue::Balance(1_000_000),
            None,
            2,
            ParamClass::Meta,
            true
        ),
        row(
            // 13 §1 / 08 §10.6 (E1): the 03 §5.3a redemption fee. The default is
            // the largest exit-neutral rate, which is `mkt.fee` itself — above
            // it, holding to settlement costs more than round-tripping through
            // the book in every state of the world. The static max mirrors
            // `mkt.fee`'s, but the **binding** bound is the live
            // `ledger.redeem_fee <= mkt.fee` coupling screened jointly over the
            // pair at the amendment boundary (13 rule 7, the second key after
            // `gate.v_min`); the unsafe direction is upward.
            b"ledger.rdm_fee",
            ParamValue::Perbill(3_000_000),
            ParamValue::Perbill(0),
            ParamValue::Perbill(10_000_000),
            Some(MaxDelta::Absolute(ParamValue::Perbill(1_000_000))),
            1,
            ParamClass::Param,
            false
        ),
        row(
            b"ledger.archive",
            ParamValue::U32(kernel::MAX_ARCHIVE_DELAY_BLOCKS),
            ParamValue::U32(1_296_000),
            ParamValue::U32(kernel::MAX_ARCHIVE_DELAY_BLOCKS),
            None,
            2,
            ParamClass::Meta,
            true
        ),
        row(
            // SQ-36 (ruled 2026-07-21): frozen key — max == min == default.
            // The ledger charges/refunds/reconciles DepositsHeld at the LIVE
            // unit and 03 §10 gives no hook to rebase held deposits, so a raise
            // would over-refund old entries out of pooled collateral (L-2/L-6).
            // Per-entry vintages (the only tunable-preserving design) need an
            // unbounded migration and are refused (R-7); see 13 §2 freeze note.
            b"ledger.pos_dep",
            ParamValue::Balance(100_000),
            ParamValue::Balance(100_000),
            ParamValue::Balance(100_000),
            None,
            2,
            ParamClass::Meta,
            true
        ),
        row(
            b"pol.b_baseline",
            ParamValue::Balance(25_000_000_000),
            ParamValue::Balance(10_000_000_000),
            ParamValue::Balance(100_000_000_000),
            Some(MaxDelta::Percent(25)),
            1,
            ParamClass::Treasury,
            false,
        ),
        row(
            b"collator.n_tgt",
            ParamValue::U8(5),
            ParamValue::U8(4),
            ParamValue::U8(12),
            Some(MaxDelta::Absolute(ParamValue::U8(1))),
            2,
            ParamClass::Meta,
            false,
        ),
        // 13 §1 row `sec.prize.*` (SQ-173): the certified capability-envelope
        // proxies that 08 §5.2 makes `InCapPrize` for the three non-TREASURY
        // binding classes. Seeded from the Phase-0 published calibration; the
        // minimum is the same kernel floor (05 §5.6). The ×2 Δ is symmetric, so
        // a raised proxy may be lowered back toward that floor — what no
        // amendment can do is carry it *below* it, toward the zero that would
        // make an unsecured payload pass.
        row(
            b"sec.prize.param",
            ParamValue::Balance(kernel::SEC_PRIZE_PARAM_FLOOR),
            ParamValue::Balance(kernel::SEC_PRIZE_PARAM_FLOOR),
            ParamValue::Balance(u128::MAX),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Meta,
            true
        ),
        row(
            b"sec.prize.code",
            ParamValue::Balance(kernel::SEC_PRIZE_CODE_FLOOR),
            ParamValue::Balance(kernel::SEC_PRIZE_CODE_FLOOR),
            ParamValue::Balance(u128::MAX),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Meta,
            true
        ),
        row(
            b"sec.prize.meta",
            ParamValue::Balance(kernel::SEC_PRIZE_META_FLOOR),
            ParamValue::Balance(kernel::SEC_PRIZE_META_FLOOR),
            ParamValue::Balance(u128::MAX),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Meta,
            true
        ),
        // 13 §1 row `sec.flow_cap` (SQ-486, adopted 2026-07-25): the gate-bearing
        // ceiling on the measured non-POL contest-capital term inside step 9's
        // `L̂` and the `C_hold` diagnostic. Seeded from the Phase-0 calibration
        // the 15 §4.9 security criterion was actually met at; the kernel ×7 min
        // is the liveness floor (below it honest exactly-grade proposals are
        // rejected) and the ×32 max bounds the *unsafe* direction, since a
        // higher ceiling eases the sizing gate.
        row(
            b"sec.flow_cap",
            ParamValue::Fixed(FixedU64(16_000_000_000)),
            ParamValue::Fixed(FixedU64(kernel::SEC_FLOW_CAP_FLOOR_1E9)),
            ParamValue::Fixed(FixedU64(32_000_000_000)),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Meta,
            true
        ),
        row(
            b"phase3.tvl_cap",
            ParamValue::Balance(2_000_000_000_000),
            ParamValue::Balance(0),
            ParamValue::Balance(u128::MAX),
            None,
            0,
            ParamClass::MetaAndValues,
            false
        ),
        row(
            b"phase3.dep_cap",
            ParamValue::Balance(20_000_000_000),
            ParamValue::Balance(0),
            ParamValue::Balance(u128::MAX),
            None,
            0,
            ParamClass::MetaAndValues,
            false
        ),
        row(
            b"xcm.dot_per_sec",
            ParamValue::Balance(100_000_000_000),
            ParamValue::Balance(1_000_000_000),
            ParamValue::Balance(10_000_000_000_000),
            Some(MaxDelta::Factor(2)),
            1,
            ParamClass::Param,
            false
        ),
        row(
            b"xcm.dot_per_mb",
            ParamValue::Balance(10_000_000_000),
            ParamValue::Balance(100_000_000),
            ParamValue::Balance(1_000_000_000_000),
            Some(MaxDelta::Factor(2)),
            1,
            ParamClass::Param,
            false
        ),
        row(
            b"xcm.usdc_per_sec",
            ParamValue::Balance(50_000_000),
            ParamValue::Balance(500_000),
            ParamValue::Balance(5_000_000_000),
            Some(MaxDelta::Factor(2)),
            1,
            ParamClass::Param,
            false
        ),
        row(
            b"xcm.usdc_per_mb",
            ParamValue::Balance(5_000_000),
            ParamValue::Balance(50_000),
            ParamValue::Balance(500_000_000),
            Some(MaxDelta::Factor(2)),
            1,
            ParamClass::Param,
            false
        ),
        // Hosted service admission bounds (13 §1 / 16).
        //
        // `svc.fee_bps` — ADOPTED at 1,000 bps by the user, 2026-08-02, closing
        // the `[VERIFY]` tag. It is a market price for a service nobody has
        // sold, so R-2 permits no derivation: this is a values call, not an
        // implementation one. Seeding the row ARMS the hosted service —
        // `fee_rate()` starts returning `Some` and `register` stops refusing
        // `ServiceRateUnset`.
        //
        // Unit note, because the two scales differ by 100,000×: 13 §1 states
        // this row in **bps**, the stored kind is **Perbill** (parts per 1e9),
        // and the convention is pinned by `mkt.fee` = 30 bps = Perbill(3e6).
        // So 1,000 bps = 10 % = Perbill(100_000_000).
        //
        // The adopted value sits AT the row max, with one consequence worth
        // stating: `MaxDelta::Factor(2)` can then only be exercised downward,
        // and raising the rate later needs a META `amend_registry` to lift the
        // max first. Down is the reversible direction, so this is a safe place
        // to start from rather than a trap.
        row(
            b"svc.fee_bps",
            ParamValue::Perbill(100_000_000),
            ParamValue::Perbill(0),
            ParamValue::Perbill(100_000_000),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Param,
            false
        ),
        row(
            b"svc.max_live",
            ParamValue::U32(16),
            ParamValue::U32(1),
            ParamValue::U32(futarchy_primitives::bounds::MAX_CLIENTS),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Param,
            true
        ),
        row(
            b"svc.max_window",
            ParamValue::U32(302_400),
            ParamValue::U32(43_200),
            ParamValue::U32(302_400),
            Some(MaxDelta::Factor(2)),
            1,
            ParamClass::Param,
            false
        ),
        row(
            b"svc.epsilon_min",
            ParamValue::Perbill(10_000_000),
            ParamValue::Perbill(5_000_000),
            ParamValue::Perbill(250_000_000),
            Some(MaxDelta::Factor(2)),
            1,
            ParamClass::Param,
            false
        ),
        // `svc.client_bond` — ADOPTED at 100,000 VIT by the user, 2026-08-04,
        // closing the `[VERIFY]` tag. Like `svc.fee_bps` this is a values call
        // with no derivation available in this repository, so R-2's escalation
        // clause applies and the authority is recorded rather than a false
        // derivation reverse-engineered for it.
        //
        // **Seeding this row is the act that opens the service.** Until now
        // `client_registry.admit_client` returned `ClientBondUnset` before any
        // hold or registry write, so no client could exist at all; it is the
        // only one of the three `[VERIFY]` rows that gated admission.
        //
        // Scale: VIT has 12 decimals, so 100,000 VIT = 1e17, on the convention
        // `att.bond` = 25,000 VIT = 25e15 already pins. The value is 4x that
        // attestor bond, chosen against the milder anchors deliberately: it
        // treats a hosted client as a higher-risk counterparty than a seated
        // attestor. The stated cost is adoption — the first cohort will be
        // institutions rather than experiments, and 16 §8.4's cannibalization
        // falsifier and `svc.max_live`'s sizing both need real occupancy to
        // settle, so both stay open longer. That is the direction that cannot
        // create an unbacked claim, and Factor(2) with a 2-epoch cooldown
        // makes it ~6 weeks per halving if the barrier proves too high.
        //
        // Held, not spent: native VIT on the B19 custody discipline for the
        // life of the registration, returned on clean exit. It prices
        // registration abuse only and is never delivery-fee custody — that is
        // the separate USDC `delivery_float`. It is also not the anti-spam
        // gate: admission is a per-client `ConstitutionalValues` act and the
        // roster is hard-capped at `MaxClients` = 64.
        row(
            b"svc.client_bond",
            ParamValue::Balance(100_000_000_000_000_000),
            ParamValue::Balance(1_000_000_000_000_000),
            ParamValue::Balance(1_000_000_000_000_000_000),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Param,
            false
        ),
        // `svc.price_cap` — ADOPTED at 4x by the user, 2026-08-04, closing the
        // `[VERIFY]` tag. Unlike the two rows above, this one's absence was
        // never a refusal: the consumer defaulted to `M = 1`, which is the
        // status quo, so seeding it is a deliberate arming rather than an
        // unblocking (13 §1, note 3 on this row).
        //
        // Scale: `Fixed` is FixedU64 on the 1e9 grid, so 4x = 4e9.
        //
        // Two mechanical consequences of 4 against `svc.max_live` = 16, both
        // favourable and neither accidental. The per-admission step is
        // `(4 - 1) / 16` = 0.1875, i.e. 3e9 / 16 = 187,500,000 grid units
        // **exactly** — 16 divides 3e9, so taking every slot at once lands
        // precisely on the ceiling rather than short of it by the integer
        // remainder 13 §1 note 1 warns about. And 4 is far enough above 1 that
        // the step cannot truncate to zero, which is what a ceiling within
        // `svc.max_live` grid units of 1 would silently do.
        //
        // This single row arms BOTH halves of `M` (16 §8.6 contention pricing
        // and §8.7's starvation response), because they share one ceiling and
        // combine by `max`. There is no state in which one is live and the
        // other is not.
        row(
            b"svc.price_cap",
            ParamValue::Fixed(FixedU64(4_000_000_000)),
            ParamValue::Fixed(FixedU64(1_000_000_000)),
            ParamValue::Fixed(FixedU64(64_000_000_000)),
            Some(MaxDelta::Factor(2)),
            2,
            ParamClass::Param,
            false
        ),
    ]
}

#[cfg(feature = "runtime-benchmarks")]
pub mod benchmarking {
    use super::*;

    pub fn benchmark_set_param() -> Result<(), Error> {
        let mut state = ConstitutionState::genesis();
        state.dispatch_set_param(
            ConstitutionOrigin::FutarchyParam,
            key16(b"mkt.obs_interval"),
            ParamValue::U32(12),
            1,
            1,
            // A fresh genesis aggregate has no cohort in flight, which is what
            // this helper models (SQ-501). Raising the interval is admitted at
            // any in-flight state anyway, so the measured path is unchanged.
            InFlightOccupancy::IDLE,
        )
    }

    pub fn benchmark_set_release_channel() -> Result<(), Error> {
        let mut state = ConstitutionState::genesis();
        let mut bytes = [0u8; RELEASE_CHANNEL_LEN];
        bytes[0] = 1;
        state.dispatch_set_release_channel(ConstitutionOrigin::ConstitutionalValues, bytes, 7)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capability_scale_discriminants_are_append_only() {
        // Capability values are embedded in stored records and the 0x02
        // resource-key discriminator. Existing values must retain their
        // SCALE tags when a new authority is introduced.
        assert_eq!(Capability::OracleConfig.encode(), vec![6]);
        assert_eq!(Capability::MarketTemplate.encode(), vec![7]);
        assert_eq!(Capability::InsuranceSweep.encode(), vec![8]);
    }

    #[test]
    fn error_scale_discriminants_are_append_only() {
        // DispatchError bytes can be retained in execution records across a
        // runtime upgrade, so adding SQ-303's error must not renumber the
        // established variants.
        assert_eq!(Error::MetaBoundViolation.encode(), vec![12]);
        assert_eq!(Error::BadReleaseSchema.encode(), vec![13]);
        assert_eq!(Error::TryStateViolation.encode(), vec![18]);
        assert_eq!(Error::BudgetDerivationRequired.encode(), vec![19]);
        // E4 appends the 13 rule 7 coupling refusal last, after
        // `PhaseCapRaiseRefused` (20) and `CoverageBreaksAdmission` (21).
        assert_eq!(Error::RedemptionFeeAboveMarketFee.encode(), vec![22]);
        // TR9 appends rule 7's third coupling refusal after that one.
        assert_eq!(Error::RewardRateAboveWashBreakeven.encode(), vec![23]);
    }

    /// 13 rule 7 (E1/E4): `ledger.redeem_fee ≤ mkt.fee` is screened jointly
    /// over the pair at the amendment boundary — **in both directions**,
    /// because both rows are PARAM and a single PARAM decision can move either
    /// side — and asserted in try-state.
    #[test]
    fn redeem_fee_coupling_is_screened_over_the_pair_in_both_directions() {
        let redeem = key16(b"ledger.rdm_fee");
        let market = key16(b"mkt.fee");
        assert_eq!(redeem_fee_pair(redeem), Some(market));
        assert_eq!(redeem_fee_pair(market), Some(redeem));
        assert_eq!(redeem_fee_pair(key16(b"epoch.length")), None);

        let mut state = ConstitutionState::genesis();
        let value_of = |state: &ConstitutionState, key| {
            state
                .params
                .iter()
                .find(|record| record.key == key)
                .map(|record| record.value)
                .expect("13 §1 seeds the row")
        };
        let ParamValue::Perbill(seeded) = value_of(&state, redeem) else {
            panic!("13 §1: `ledger.rdm_fee` is a Perbill row")
        };
        // 08 §10.6: the launch default sits *at* the coupling ceiling, so the
        // smallest step in either direction breaks the pair.
        assert_eq!(value_of(&state, market), ParamValue::Perbill(seeded));
        assert!(state.try_state().is_ok());

        let before = state.clone();
        assert_eq!(
            state.set_param(redeem, ParamValue::Perbill(seeded + 1), 1, 1),
            Err(Error::RedemptionFeeAboveMarketFee)
        );
        assert_eq!(state, before, "a refused amendment is a strict no-op");
        assert_eq!(
            state.set_param(market, ParamValue::Perbill(seeded - 1), 1, 1),
            Err(Error::RedemptionFeeAboveMarketFee),
            "13 rule 7: screening only `ledger.redeem_fee` leaves the invariant \
             breakable from `mkt.fee`"
        );
        assert_eq!(state, before);

        // Equality is admissible (the relation is `≤`), and raising the ceiling
        // first makes the identical raise lawful.
        assert!(redeem_fee_coupled(seeded as u128, seeded as u128));
        assert!(state
            .set_param(market, ParamValue::Perbill(seeded + 1), 1, 1)
            .is_ok());
        assert!(state
            .set_param(redeem, ParamValue::Perbill(seeded + 1), 1, 1)
            .is_ok());
        assert!(state.try_state().is_ok());

        // try-state is the backstop an unscreened writer cannot slip past.
        for record in &mut state.params {
            if record.key == redeem {
                record.value = ParamValue::Perbill(seeded + 2);
            }
        }
        assert_eq!(state.try_state(), Err(Error::TryStateViolation));
    }

    // ---- 13 rule 7's third live coupling: `rwd.rate` ↔ `mkt.fee` (TR9) ----

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
        let err = screen_rwd_rate_coupling(key16(b"mkt.fee"), ParamValue::Perbill(500_000), |_| {
            Some(ParamValue::Perbill(2_500_000))
        })
        .unwrap_err();
        assert_eq!(err, Error::RewardRateAboveWashBreakeven);
    }

    /// The screen must bind from both sides, exactly like redeem_fee ≤ mkt.fee.
    ///
    /// **Corrected against the task brief (TR9, 2026-08-11).** The brief named
    /// `Perbill(6_000_000)` against `Perbill(3_000_000)` as the refused case and
    /// the relation admits it: `99 × 6_000_000 = 594_000_000` is below
    /// `200 × 3_000_000 = 600_000_000`. That is a property of the registry
    /// rather than a hole in the screen, and it is the reason the rate side is
    /// unreachable at launch — see
    /// [`the_rate_records_own_maximum_is_inside_the_seeded_breakeven`]. The
    /// smallest rate the relation refuses against the seeded fee is one part
    /// above `floor(200 × fee / 99)`.
    #[test]
    fn raising_the_reward_rate_past_the_live_fee_is_refused() {
        let fee = seeded_perbill(b"mkt.fee");
        // Restated by the equivalent integer spelling, so the boundary is
        // derived here rather than read back from the predicate under test.
        let breakeven = 200u32.saturating_mul(fee) / 99;
        assert!(rwd_rate_coupled(breakeven as u128, fee as u128));
        let err = screen_rwd_rate_coupling(
            key16(b"rwd.rate"),
            ParamValue::Perbill(breakeven + 1),
            |_| Some(ParamValue::Perbill(fee)),
        )
        .unwrap_err();
        assert_eq!(err, Error::RewardRateAboveWashBreakeven);
    }

    /// Why the rate side of the screen cannot fire at launch, stated so that a
    /// registry edit has to confront it. At the seeded `mkt.fee` the `rwd.rate`
    /// record's own hard maximum is already inside the wash break-even, so the
    /// record's bounds and the coupling agree while the fee is unmoved. The
    /// coupling is what keeps them agreeing **after** the fee moves, which the
    /// record alone cannot do because its bounds do not track `mkt.fee`.
    #[test]
    fn the_rate_records_own_maximum_is_inside_the_seeded_breakeven() {
        let fee = seeded_perbill(b"mkt.fee");
        let max = match genesis_params()
            .into_iter()
            .find(|record| record.key == key16(b"rwd.rate"))
            .map(|record| record.max)
        {
            Some(ParamValue::Perbill(parts)) => parts,
            other => panic!("13 §1: `rwd.rate` must carry a Perbill max, got {other:?}"),
        };
        assert!(
            rwd_rate_coupled(max as u128, fee as u128),
            "13 §1: the `rwd.rate` ceiling {max} ppb has escaped the wash \
             break-even at the seeded `mkt.fee` {fee} ppb",
        );
    }

    /// One seeded 13 §1 `Perbill` value, read rather than restated.
    fn seeded_perbill(name: &[u8]) -> u32 {
        match genesis_params()
            .into_iter()
            .find(|record| record.key == key16(name))
            .map(|record| record.value)
        {
            Some(ParamValue::Perbill(parts)) => parts,
            other => panic!("13 §1 must seed a Perbill row for this key, got {other:?}"),
        }
    }

    #[test]
    fn an_unrelated_key_is_not_screened() {
        assert!(rwd_rate_pair(key16(b"epoch.length")).is_none());
        assert!(
            screen_rwd_rate_coupling(key16(b"epoch.length"), ParamValue::U32(1), |_| None).is_ok()
        );
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

    /// 13 rule 7 states that the cross-multiplied form is exact and that
    /// `99 × rate / 100 ≤ 2 × fee` is the unsafe spelling. This is the witness
    /// that separates them, so a future rewrite into the floored-left-hand-side
    /// form cannot pass: at `mkt.fee` = 2,000,000 ppb that spelling admits
    /// 4,040,405 ppb, because `floor(99 × 4_040_405 / 100) = 4_000_000` is not
    /// greater than `2 × 2_000_000`.
    #[test]
    fn the_cross_multiplied_predicate_is_exact_at_its_boundary() {
        let fee: u128 = 2_000_000;
        // Restated by the *other* correct spelling (`rate ≤ 200 × fee / 99`,
        // which is equivalent over the integers) so the boundary is derived
        // here rather than copied from the predicate under test.
        let boundary = 200 * fee / 99;
        assert_eq!(boundary, 4_040_404);
        assert!(rwd_rate_coupled(boundary, fee));
        assert!(!rwd_rate_coupled(boundary + 1, fee));
        // The unsafe spelling would have admitted `boundary + 1`.
        assert!(99 * (boundary + 1) / 100 <= 2 * fee);
    }

    /// G-1: the predicate is `pub`, so it must answer rather than overflow on
    /// an argument no `ParamValue::Perbill` can hold. An unrepresentable
    /// product refuses, which is the status-quo direction.
    #[test]
    fn the_predicate_refuses_an_unrepresentable_product() {
        assert!(!rwd_rate_coupled(u128::MAX, u128::MAX));
        assert!(!rwd_rate_coupled(u128::MAX / 98, 0));
        // Over the whole Perbill domain it is the plain cross-multiplication.
        for rate in [0u128, 1, 2_500_000, 6_000_000, u128::from(u32::MAX)] {
            for fee in [0u128, 1, 500_000, 3_000_000, u128::from(u32::MAX)] {
                assert_eq!(rwd_rate_coupled(rate, fee), 99 * rate <= 200 * fee);
            }
        }
    }

    /// Controller resolution 6 (2026-08-11): genesis must satisfy the coupling,
    /// proved through the shipped screen rather than assumed. A future genesis
    /// edit that broke the pair would leave the chain refusing its own launch
    /// values, and `try_state` would fail on block one.
    #[test]
    fn genesis_satisfies_the_coupling_through_the_screen() {
        let params = genesis_params();
        let value_of = |key| {
            params
                .iter()
                .find(|record| record.key == key)
                .map(|record| record.value)
                .expect("13 §1 seeds the row")
        };
        let rate = key16(b"rwd.rate");
        let market = key16(b"mkt.fee");
        // Screened from both sides, because either seeded row could be the one
        // a future edit moves.
        assert_eq!(
            screen_rwd_rate_coupling(rate, value_of(rate), |pair| Some(value_of(pair))),
            Ok(())
        );
        assert_eq!(
            screen_rwd_rate_coupling(market, value_of(market), |pair| Some(value_of(pair))),
            Ok(())
        );
        assert!(ConstitutionState::genesis().try_state().is_ok());
    }

    /// 13 rule 7 (TR9): `99 × rwd.rate ≤ 200 × mkt.fee` is screened jointly over
    /// the pair at the amendment boundary — **in both directions**, because both
    /// rows are PARAM and a single PARAM decision can move either side — and
    /// asserted in try-state.
    #[test]
    fn rwd_rate_coupling_is_screened_over_the_pair_in_both_directions() {
        let rate = key16(b"rwd.rate");
        let market = key16(b"mkt.fee");
        assert_eq!(rwd_rate_pair(rate), Some(market));
        assert_eq!(rwd_rate_pair(market), Some(rate));
        assert_eq!(rwd_rate_pair(key16(b"epoch.length")), None);

        let mut state = ConstitutionState::genesis();
        let value_of = |state: &ConstitutionState, key| {
            state
                .params
                .iter()
                .find(|record| record.key == key)
                .map(|record| record.value)
                .expect("13 §1 seeds the row")
        };
        let perbill_of = |state: &ConstitutionState, key| match value_of(state, key) {
            ParamValue::Perbill(parts) => parts,
            other => panic!("13 §1: {key:?} must be a Perbill row, got {other:?}"),
        };
        // Every step below is one record's own max-Δ, read from the registry
        // rather than restated: 13 owns those values (runtime-code rule 4).
        let step_of = |state: &ConstitutionState, key| match state
            .params
            .iter()
            .find(|record| record.key == key)
            .and_then(|record| record.max_delta)
        {
            Some(MaxDelta::Absolute(ParamValue::Perbill(parts))) => parts,
            other => panic!("13 §1: {key:?} must carry an absolute Perbill max-Δ, got {other:?}"),
        };
        let redeem = key16(b"ledger.rdm_fee");
        let redeem_step = step_of(&state, redeem);
        let market_step = step_of(&state, market);
        // `mkt.fee` is also the partner of `ledger.rdm_fee`, which genesis seeds
        // at the same rate, so lowering it is refused by *that* screen until the
        // redemption fee moves out of the way. Clear it first, so the legs below
        // isolate this coupling and cannot pass for the wrong reason.
        for epoch in [1u32, 2] {
            let next = perbill_of(&state, redeem).saturating_sub(redeem_step);
            assert!(state
                .set_param(redeem, ParamValue::Perbill(next), epoch, epoch)
                .is_ok());
        }
        let lowered_fee = perbill_of(&state, market).saturating_sub(market_step);
        assert!(state
            .set_param(market, ParamValue::Perbill(lowered_fee), 3, 3)
            .is_ok());
        assert!(state.try_state().is_ok());

        // (1) The rate side. The largest admissible rate against the live fee is
        // `floor(200 × fee / 99)`, restated by the equivalent integer spelling so
        // the boundary is not copied from the predicate under test.
        let boundary = 200u32.saturating_mul(lowered_fee) / 99;
        let before = state.clone();
        assert_eq!(
            state.set_param(rate, ParamValue::Perbill(boundary + 1), 4, 4),
            Err(Error::RewardRateAboveWashBreakeven)
        );
        assert_eq!(before, state, "a refused amendment is a strict no-op");
        // Equality is admissible, and the record's own bounds admit both values,
        // so only the coupling can be refusing the one above.
        assert!(state
            .set_param(rate, ParamValue::Perbill(boundary), 4, 4)
            .is_ok());

        // (2) The fee side, which a one-sided screen would let through. The pair
        // now sits at the boundary, so the smallest cut breaks it.
        let before = state.clone();
        assert_eq!(
            state.set_param(market, ParamValue::Perbill(lowered_fee - 1), 5, 5),
            Err(Error::RewardRateAboveWashBreakeven),
            "13 rule 7: screening only `rwd.rate` leaves the invariant breakable \
             from `mkt.fee`"
        );
        assert_eq!(before, state);

        // (3) Lowering `mkt.fee` is otherwise lawful — the screen is over the
        // resulting pair, not a freeze on the market fee. Drop the rate first
        // and a far larger cut passes.
        assert!(state
            .set_param(rate, ParamValue::Perbill(lowered_fee), 5, 5)
            .is_ok());
        let cut_fee = lowered_fee.saturating_sub(market_step);
        assert!(state
            .set_param(market, ParamValue::Perbill(cut_fee), 6, 6)
            .is_ok());
        assert_eq!(value_of(&state, market), ParamValue::Perbill(cut_fee));
        assert!(state.try_state().is_ok());

        // (4) try-state is the backstop an unscreened writer cannot slip past.
        let breaking = 200u32.saturating_mul(cut_fee) / 99 + 1;
        for record in &mut state.params {
            if record.key == rate {
                record.value = ParamValue::Perbill(breaking);
            }
        }
        assert_eq!(state.try_state(), Err(Error::TryStateViolation));
    }

    #[test]
    fn param_record_fields_match_contract_02_section_7_3() {
        use scale_info::TypeDef;
        // 02 §7.3 freezes `Params: map ParamKey -> ParamRecord` as a surface the
        // frontend reads directly, and the release manifest freezes this value's
        // rendered SCALE layout. Adding `last_change_block` (contract v4, so
        // `ParamView.last_change` can be a real block number) silently changed
        // that layout and only the release gate would have caught it. Lock the
        // field names and SCALE order so the surface cannot drift unnoticed
        // again: a change here MUST be a deliberate contract revision that also
        // re-freezes `storage.constitution.params` in the surface manifest.
        const CONTRACT_FIELDS: [&str; 9] = [
            "key",
            "value",
            "min",
            "max",
            "max_delta",
            "cooldown_epochs",
            "last_changed_epoch",
            "last_change_block",
            "class",
        ];
        let type_info = ParamRecord::type_info();
        let names: Vec<&str> = match &type_info.type_def {
            TypeDef::Composite(c) => c.fields.iter().filter_map(|f| f.name).collect(),
            _ => panic!("ParamRecord must encode as a SCALE composite type"),
        };
        assert_eq!(&names[..CONTRACT_FIELDS.len()], &CONTRACT_FIELDS);
        // `kernel_bounded` (13 rule 7) trails the contract-visible prefix.
        assert_eq!(names.last(), Some(&"kernel_bounded"));
    }

    fn release_channel() -> ReleaseChannel {
        let mut bytes = [0u8; RELEASE_CHANNEL_LEN];
        bytes[0] = 1;
        bytes[108..112].copy_from_slice(&42u32.to_le_bytes());
        bytes[112..116].copy_from_slice(&7u32.to_le_bytes());
        bytes[116..120].copy_from_slice(&11u32.to_le_bytes());
        bytes[164..168].copy_from_slice(&5u32.to_le_bytes());
        ReleaseChannel::new(bytes).unwrap()
    }

    fn value_from_raw(kind: ParamValue, raw: u128) -> Option<ParamValue> {
        match kind {
            ParamValue::U8(_) => u8::try_from(raw).ok().map(ParamValue::U8),
            ParamValue::U32(_) => u32::try_from(raw).ok().map(ParamValue::U32),
            ParamValue::Balance(_) => Some(ParamValue::Balance(raw)),
            ParamValue::Fixed(_) => u64::try_from(raw)
                .ok()
                .map(|value| ParamValue::Fixed(FixedU64(value))),
            ParamValue::Percent(_) => u8::try_from(raw).ok().map(ParamValue::Percent),
            ParamValue::Perbill(_) => u32::try_from(raw).ok().map(ParamValue::Perbill),
        }
    }

    #[test]
    fn reexports_kernel_and_contract_version() {
        assert_eq!(
            CONTRACT_VERSION,
            futarchy_primitives::INTEGRATION_CONTRACT_VERSION
        );
        // Release-invariance pin; under `fast-timing` this kernel value is compressed
        // (SQ-128) and the canonical frozen-value guard lives in `futarchy-primitives`.
        #[cfg(not(feature = "fast-timing"))]
        assert_eq!(kernel::DESCRIPTOR_LEAD_TIME_BLOCKS, 43_200);
    }

    // epoch.length-specific 13 §1 admission boundaries (BelowMin/DeltaTooLarge/cooldown)
    // verified at production magnitudes; the fast-timing build compresses those bounds
    // (SQ-128), so this production-boundary case runs in the default build only.
    #[cfg(not(feature = "fast-timing"))]
    #[test]
    fn param_update_enforces_bounds_delta_and_cooldown() {
        let mut rec = genesis_params()[0];
        assert_eq!(
            rec.checked_update(ParamValue::U32(200_000), 3, 30),
            Err(Error::BelowMin)
        );
        assert_eq!(
            rec.checked_update(ParamValue::U32(400_000), 3, 30),
            Err(Error::DeltaTooLarge)
        );
        assert_eq!(
            rec.checked_update(ParamValue::U32(310_000), 1, 10),
            Err(Error::CooldownActive)
        );
        rec = rec.checked_update(ParamValue::U32(310_000), 2, 20).unwrap();
        assert_eq!(rec.value, ParamValue::U32(310_000));
        assert_eq!(rec.last_change_block, 20);
    }

    // epoch.length percent-delta recomputation at production magnitudes (13 §1); the
    // machinery is also covered timing-agnostically by `factor_delta_bounds_both_directions`,
    // so under the compressed fast-timing build this production case runs default-only.
    #[cfg(not(feature = "fast-timing"))]
    #[test]
    fn percent_delta_is_recomputed_from_the_current_value() {
        // 13 §1: epoch.length Max Δ/decision = 10%. A fixed absolute step
        // would let a lowered value be raised by more than 10% per decision.
        let mut rec = genesis_params()[0];
        assert_eq!(rec.max_delta, Some(MaxDelta::Percent(10)));
        rec = rec.checked_update(ParamValue::U32(275_000), 2, 20).unwrap();
        rec = rec.checked_update(ParamValue::U32(250_000), 4, 40).unwrap();
        rec = rec.checked_update(ParamValue::U32(226_000), 6, 60).unwrap();
        rec = rec.checked_update(ParamValue::U32(204_000), 8, 80).unwrap();
        rec = rec
            .checked_update(ParamValue::U32(201_600), 10, 100)
            .unwrap();
        // At 201,600 the 10% allowance is 20,160 — a 30,240 raise (15%) that
        // the old absolute bound accepted must now fail.
        assert_eq!(
            rec.checked_update(ParamValue::U32(231_840), 12, 120),
            Err(Error::DeltaTooLarge)
        );
        rec = rec
            .checked_update(ParamValue::U32(221_760), 12, 120)
            .unwrap();
        assert_eq!(rec.value, ParamValue::U32(221_760));
    }

    #[test]
    fn factor_delta_bounds_both_directions() {
        // 13 §1: keeper.budget_epoch Max Δ/decision = ×2.
        let mut rec = genesis_params()
            .into_iter()
            .find(|record| record.key == key16(b"keeper.budget"))
            .unwrap();
        assert_eq!(rec.max_delta, Some(MaxDelta::Factor(2)));
        assert_eq!(
            rec.checked_update(ParamValue::Balance(24_000_000_001), 1, 10),
            Err(Error::DeltaTooLarge)
        );
        rec = rec
            .checked_update(ParamValue::Balance(24_000_000_000), 1, 10)
            .unwrap();
        assert_eq!(
            rec.checked_update(ParamValue::Balance(11_999_999_999), 2, 20),
            Err(Error::DeltaTooLarge)
        );
        rec = rec
            .checked_update(ParamValue::Balance(12_000_000_000), 2, 20)
            .unwrap();
        assert_eq!(rec.value, ParamValue::Balance(12_000_000_000));
    }

    #[test]
    fn max_delta_allowance_matches_every_admission_rule() {
        let mut record = genesis_params()[0];
        // epoch.length carries a Percent(10) Δ cap, so the scalar allowance is 10% of
        // its current (default) value — timing-agnostic across the fast-timing build.
        assert_eq!(
            record.max_delta_allowance(),
            Ok((timing_defaults::EPOCH_LENGTH / 10) as u128)
        );

        record.max_delta = Some(MaxDelta::Absolute(ParamValue::U32(17)));
        assert_eq!(record.max_delta_allowance(), Ok(17));

        record.max_delta = None;
        assert_eq!(record.max_delta_allowance(), Ok(0));

        record.value = ParamValue::Balance(5);
        record.min = ParamValue::Balance(0);
        record.max = ParamValue::Balance(u128::MAX);
        record.max_delta = Some(MaxDelta::Factor(2));
        // checked_update admits [ceil(5 / 2), 5 * 2] = [3, 10], so the
        // 02 §4 scalar is conservatively the smaller directional allowance
        // under R-7; which side this lossy projection denotes remains an open
        // contract question.
        assert_eq!(record.max_delta_allowance(), Ok(2));

        record.value = ParamValue::Balance(u128::MAX - 1);
        // Saturation leaves one unit upward, which is the conservative side.
        assert_eq!(record.max_delta_allowance(), Ok(1));

        record.max_delta = Some(MaxDelta::Factor(0));
        assert_eq!(record.max_delta_allowance(), Err(Error::MetaBoundViolation));
    }

    #[test]
    fn admissible_next_interval_matches_admission_rounding_and_record_bounds() {
        let mut record = genesis_params()[0];
        let value = record.value.as_u128();
        let allowance = value / 10;
        assert_eq!(
            record.admissible_next_interval(),
            Ok((
                record.min.as_u128().max(value.saturating_sub(allowance)),
                record.max.as_u128().min(value.saturating_add(allowance)),
            ))
        );

        record.value = ParamValue::Balance(5);
        record.min = ParamValue::Balance(1);
        record.max = ParamValue::Balance(9);
        record.max_delta = Some(MaxDelta::Absolute(ParamValue::Balance(2)));
        assert_eq!(record.admissible_next_interval(), Ok((3, 7)));

        record.max_delta = None;
        assert_eq!(record.admissible_next_interval(), Ok((1, 9)));

        record.max_delta = Some(MaxDelta::Factor(2));
        assert_eq!(record.admissible_next_interval(), Ok((3, 9)));
        for next in 1..=10 {
            let admitted = record
                .checked_update(ParamValue::Balance(next), u32::MAX, 1)
                .is_ok();
            assert_eq!(admitted, (3..=9).contains(&next), "next={next}");
        }

        record.value = ParamValue::Balance(u128::MAX - 1);
        record.min = ParamValue::Balance(0);
        record.max = ParamValue::Balance(u128::MAX);
        assert_eq!(
            record.admissible_next_interval(),
            Ok(((u128::MAX - 1).div_ceil(2), u128::MAX))
        );

        record.max_delta = Some(MaxDelta::Factor(0));
        assert_eq!(
            record.admissible_next_interval(),
            Err(Error::MetaBoundViolation)
        );
    }

    #[test]
    fn factor_allowance_and_exact_interval_project_exec_lock_code() {
        // Contract v6 retains the conservative scalar and exposes the exact
        // inclusive interval for the asymmetric exec.lock.* factor rule.
        let record = genesis_params()
            .into_iter()
            .find(|record| record.key == key16(b"exec.lock.code"))
            .expect("the canonical exec.lock.code record exists");
        let value = record.value.as_u128();
        assert!(matches!(record.max_delta, Some(MaxDelta::Factor(_))));
        let factor = match record.max_delta {
            Some(MaxDelta::Factor(factor)) => u128::from(factor),
            _ => 1,
        };
        assert!(factor >= 1);
        let lower = value / factor + u128::from(value % factor != 0);
        let downward = value.saturating_sub(lower);
        let upward = value.saturating_mul(factor).saturating_sub(value);

        assert_eq!(record.max_delta_allowance(), Ok(downward.min(upward)));
        assert_eq!(record.max_delta_allowance(), Ok(downward));
        assert!(downward < upward);
        assert_eq!(value, 100_800);
        assert_eq!(record.max.as_u128(), 432_000);
        assert_eq!(record.admissible_next_interval(), Ok((50_400, 201_600)));
    }

    /// SQ-536. The seeded `collator.comp` value, pinned to its external anchor.
    ///
    /// Nothing else in this workspace pins the *value* of a genesis PARAM row —
    /// `genesis-keys.json` asserts the key SET, and every consumer reads the
    /// live registry — so before this test the seed could move in either
    /// direction without a single Rust failure. It moved once already on no
    /// evidence at all (the superseded 2,000 was a D-15 initial with no costing
    /// behind it), and `ops.collators` is the largest standing line in 08 §10.1,
    /// so an unnoticed drift here is a direct hit to the runway.
    ///
    /// The anchor is Polkadot OpenGov referendum #1870 (passed, executed): 38
    /// funded system-parachain collators at $250/collator/month, $307.24 fully
    /// loaded with the bounty's hosting, curator and coordinator lines. At 21.0
    /// days per epoch that is 211.97 USDC/epoch, so the seed carries a 2.36x
    /// margin over a rate real operators accepted for the same job — and the
    /// job really is the same, because a Bleavit collator earns nothing from
    /// fees or tips (D-15 burns VIT fees) exactly as a system-parachain
    /// collator does.
    ///
    /// This asserts the *shape* of that argument, not just the number: the seed
    /// sits ON the registry minimum, so every remaining amendment is in the
    /// safe (upward) direction. Re-deriving the margin is the reference model's
    /// job (`sustainability.collator_anchor_multiple`); what belongs here is
    /// that the shipped constitution agrees with it.
    #[test]
    fn genesis_collator_compensation_is_seeded_at_its_anchored_registry_floor() {
        let record = genesis_params()
            .into_iter()
            .find(|record| record.key == key16(b"collator.comp"))
            .expect("collator.comp is a seeded genesis key");

        // 500 USDC/collator/epoch at USDC's 6 decimals.
        assert_eq!(record.value.as_u128(), 500_000_000);
        // Seeded AT the floor: all headroom is in the safe direction.
        assert_eq!(record.value.as_u128(), record.min.as_u128());
        assert_eq!(record.max.as_u128(), 10_000_000_000);
        // The bound itself is untouched by the reseed — the seed moved to the
        // floor, the floor did not move to the seed.
        assert_eq!(record.max.as_u128() / record.min.as_u128(), 20);
        // Recovery is bounded and fast: x2 per amendment, so one step reaches
        // 1,000 and two reach the superseded 2,000.
        assert_eq!(record.max_delta, Some(MaxDelta::Factor(2)));
        assert_eq!(record.class, ParamClass::Param);
    }

    /// 13 §1: the trading-accuracy reward rate, adopted at 0.25 % by the owner
    /// on 2026-08-10. The seed and every bound on the record are pinned here
    /// because the whole anti-farm argument of 08 §2.6 is stated in terms of
    /// them: the ceiling keeps the rate inside the wash break-even, and the
    /// unsafe direction is upward.
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
        assert_eq!(record.cooldown_epochs, 1);
        assert_eq!(record.class, ParamClass::Param);
        assert!(!record.kernel_bounded);
    }

    /// 08 §2.6 / 13 §1: the seeded pair must satisfy the wash break-even the
    /// adopted rate is derived from. This is a genesis-consistency assertion,
    /// not the amendment-boundary screen.
    #[test]
    fn rwd_rate_stays_inside_the_wash_breakeven_at_the_mkt_fee_default() {
        // 08 §2.6: r_breakeven = 2f / 0.99, evaluated in parts per billion.
        let params = genesis_params();
        let fee = params
            .iter()
            .find(|r| r.key == key16(b"mkt.fee"))
            .expect("mkt.fee");
        let rate = params
            .iter()
            .find(|r| r.key == key16(b"rwd.rate"))
            .expect("rwd.rate");
        let (ParamValue::Perbill(f), ParamValue::Perbill(r)) = (fee.value, rate.value) else {
            panic!("both rows are Perbill");
        };
        // Cross-multiplied, so the amendment-boundary screen and this genesis
        // assertion cannot disagree at the boundary. Equality is admissible: at
        // exact break-even the wash nets zero rather than positive.
        assert!(
            99 * u128::from(r) <= 200 * u128::from(f),
            "rwd.rate {r} ppb has reached the wash break-even against mkt.fee {f} ppb",
        );
    }

    #[test]
    fn genesis_param_keys_are_canonical_and_distinct() {
        let params = genesis_params();
        // 13 §1 canonical spellings (Codex review, PR #14): the seeded keys
        // must match the names downstream binders derive with key16.
        for name in [
            b"intake.max_acct".as_slice(),
            b"keeper.budget".as_slice(),
            b"ops.ct_dot_rate".as_slice(),
            b"ops.ct_fee_dot".as_slice(),
            b"ops.probe_fee".as_slice(),
            b"ops.probe_rate".as_slice(),
            b"ops.ct_quote_ttl".as_slice(),
            b"xcm.dot_per_sec".as_slice(),
            b"xcm.dot_per_mb".as_slice(),
            b"xcm.usdc_per_sec".as_slice(),
            b"xcm.usdc_per_mb".as_slice(),
        ] {
            assert!(
                params.iter().any(|record| record.key == key16(name)),
                "missing canonical genesis Param key: {name:?}"
            );
        }
        for (name, value, min, max) in [
            (
                b"ops.ct_dot_rate".as_slice(),
                5_000_000,
                500_000,
                500_000_000,
            ),
            (
                b"ops.ct_fee_dot".as_slice(),
                5_000_000_000,
                100_000_000,
                100_000_000_000,
            ),
            (
                b"ops.probe_fee".as_slice(),
                5_000_000_000,
                100_000_000,
                100_000_000_000,
            ),
            (
                b"ops.probe_rate".as_slice(),
                5_000_000,
                500_000,
                500_000_000,
            ),
        ] {
            let Some(record) = params.iter().find(|record| record.key == key16(name)) else {
                assert!(
                    params.iter().any(|record| record.key == key16(name)),
                    "missing Coretime Balance Param: {name:?}"
                );
                continue;
            };
            assert_eq!(record.value, ParamValue::Balance(value));
            assert_eq!(record.min, ParamValue::Balance(min));
            assert_eq!(record.max, ParamValue::Balance(max));
            assert_eq!(record.max_delta, Some(MaxDelta::Factor(2)));
            assert_eq!(record.cooldown_epochs, 1);
            assert_eq!(record.class, ParamClass::Treasury);
            assert!(!record.kernel_bounded);
        }
        let Some(ttl) = params
            .iter()
            .find(|record| record.key == key16(b"ops.ct_quote_ttl"))
        else {
            assert!(
                params
                    .iter()
                    .any(|record| record.key == key16(b"ops.ct_quote_ttl")),
                "missing Coretime TTL Param"
            );
            return;
        };
        assert_eq!(ttl.value, ParamValue::U32(100_800));
        assert_eq!(ttl.min, ParamValue::U32(7_200));
        assert_eq!(ttl.max, ParamValue::U32(403_200));
        assert_eq!(ttl.max_delta, Some(MaxDelta::Factor(2)));
        assert_eq!(ttl.cooldown_epochs, 1);
        assert_eq!(ttl.class, ParamClass::Treasury);
        assert!(!ttl.kernel_bounded);
        for (name, value, min, max) in [
            (
                b"xcm.dot_per_sec".as_slice(),
                100_000_000_000,
                1_000_000_000,
                10_000_000_000_000,
            ),
            (
                b"xcm.dot_per_mb".as_slice(),
                10_000_000_000,
                100_000_000,
                1_000_000_000_000,
            ),
            (
                b"xcm.usdc_per_sec".as_slice(),
                50_000_000,
                500_000,
                5_000_000_000,
            ),
            (
                b"xcm.usdc_per_mb".as_slice(),
                5_000_000,
                50_000,
                500_000_000,
            ),
        ] {
            let mut matches = 0_u8;
            for record in params.iter().filter(|record| record.key == key16(name)) {
                matches = matches.saturating_add(1);
                assert_eq!(record.value, ParamValue::Balance(value));
                assert_eq!(record.min, ParamValue::Balance(min));
                assert_eq!(record.max, ParamValue::Balance(max));
                assert_eq!(record.max_delta, Some(MaxDelta::Factor(2)));
                assert_eq!(record.cooldown_epochs, 1);
                assert_eq!(record.class, ParamClass::Param);
                assert!(!record.kernel_bounded);
            }
            assert_eq!(matches, 1, "missing or duplicate governed XCM rate");
        }
        for (index, record) in params.iter().enumerate() {
            for other in params.iter().skip(index + 1) {
                assert_ne!(record.key, other.key, "duplicate ParamKey after key16");
            }
        }
    }

    #[test]
    fn dispatch_set_param_checks_origin_and_error_paths() {
        let mut state = ConstitutionState::genesis();
        assert_eq!(
            state.dispatch_set_param_idle(
                ConstitutionOrigin::Signed,
                key16(b"mkt.obs_interval"),
                ParamValue::U32(12),
                1,
                10
            ),
            Err(Error::BadOrigin)
        );
        // 09 §5.4: bootstrap sudo's exhaustive power list excludes parameter
        // administration — Root must be refused for every class.
        assert_eq!(
            state.dispatch_set_param_idle(
                ConstitutionOrigin::Root,
                key16(b"mkt.obs_interval"),
                ParamValue::U32(12),
                1,
                10
            ),
            Err(Error::BadOrigin)
        );
        assert_eq!(
            state.dispatch_set_param_idle(
                ConstitutionOrigin::FutarchyTreasury,
                key16(b"mkt.obs_interval"),
                ParamValue::U32(12),
                1,
                10
            ),
            Err(Error::BadOrigin)
        );
        assert_eq!(
            state.dispatch_set_param_idle(
                ConstitutionOrigin::FutarchyParam,
                key16(b"missing"),
                ParamValue::U32(12),
                1,
                10
            ),
            Err(Error::UnknownParam)
        );
        let before = state.clone();
        // SQ-501: the occupancy screen is a value test, so the refusal has to be
        // a value that actually breaches. *Lowering* the observation interval
        // raises the 13 §5 item 4 crank load past the frozen 133,920 (10 -> 9 is
        // 148,800), which is the direction `keeper.budget_epoch` cannot absorb.
        // Raising it is admitted — see
        // `sq_501_occupancy_screen_admits_exactly_the_values_the_envelopes_hold_for`.
        assert_eq!(
            state.dispatch_set_param_idle(
                ConstitutionOrigin::FutarchyParam,
                key16(b"mkt.obs_interval"),
                ParamValue::U32(9),
                1,
                10,
            ),
            Err(Error::BudgetDerivationRequired)
        );
        assert_eq!(state, before);
        state
            .dispatch_set_param_idle(
                ConstitutionOrigin::FutarchyParam,
                key16(b"mkt.fee"),
                ParamValue::Perbill(4_000_000),
                1,
                10,
            )
            .unwrap();
        assert_eq!(
            state
                .params
                .iter()
                .find(|r| r.key == key16(b"mkt.fee"))
                .unwrap()
                .value,
            ParamValue::Perbill(4_000_000)
        );
    }

    #[test]
    fn sq_303_screen_refuses_by_value_and_admits_the_paired_code_route() {
        let usdc = futarchy_primitives::currency::USDC;
        let mut state = ConstitutionState::genesis();

        // Occupancy inputs are judged by value too since SQ-501 (they were
        // refused outright when this test was written): a raise past the frozen
        // 13 §5 item 4 full-window figure is refused.
        assert_eq!(
            state.ensure_derivations_survive_idle(
                key16(b"epoch.length"),
                ParamValue::U32(302_400),
                ParamValue::U32(302_401)
            ),
            Err(Error::BudgetDerivationRequired)
        );

        // Class-floor inputs are judged by value. Raising `pol.b.code` pushes the
        // true CODE floor past the frozen literal — which has only 0.39 USDC of
        // slack — so it is refused...
        assert_eq!(
            state.ensure_derivations_survive_idle(
                key16(b"pol.b.code"),
                ParamValue::Balance(60_000 * usdc),
                ParamValue::Balance(60_001 * usdc)
            ),
            Err(Error::BudgetDerivationRequired)
        );
        // ... and so is any cut to the POL budget, which raises every floor.
        assert_eq!(
            state.ensure_derivations_survive_idle(
                key16(b"pol.budget_epoch"),
                ParamValue::Perbill(7_500_000),
                ParamValue::Perbill(7_499_999)
            ),
            Err(Error::BudgetDerivationRequired)
        );
        // The safe direction is ordinary business.
        assert_eq!(
            state.ensure_derivations_survive_idle(
                key16(b"pol.b.code"),
                ParamValue::Balance(60_000 * usdc),
                ParamValue::Balance(59_999 * usdc)
            ),
            Ok(())
        );
        // A raise on a *larger* budget passes, because the true floor falls back
        // under the literal. This is the paired-CODE route the direction test
        // made unusable: once the frozen literals are right for the new values,
        // the values change needs no artifact, no pairing record and no verifier
        // — it simply stops being unsafe.
        for record in state.params.iter_mut() {
            if record.key == key16(b"pol.budget_epoch") {
                record.value = ParamValue::Perbill(15_000_000);
            }
        }
        assert_eq!(
            state.ensure_derivations_survive_idle(
                key16(b"pol.b.code"),
                ParamValue::Balance(60_000 * usdc),
                ParamValue::Balance(60_001 * usdc)
            ),
            Ok(())
        );

        // Unrelated keys are untouched.
        assert_eq!(
            state.ensure_derivations_survive_idle(
                key16(b"mkt.fee"),
                ParamValue::Perbill(30_000_000),
                ParamValue::Perbill(31_000_000)
            ),
            Ok(())
        );
    }

    /// 13 §5 item 6 gives both of these keys an explicit reason not to be
    /// screened against the §4.1 floors, and the direction test screened them
    /// anyway (SQ-303).
    #[test]
    fn sq_303_screen_does_not_over_reject_ledger_archive_or_pol_b_baseline() {
        let usdc = futarchy_primitives::currency::USDC;
        let state = ConstitutionState::genesis();
        // "can only move downward from its one-year K ceiling, so the compiled
        // 2,240-row storage envelope remains safe".
        assert_eq!(
            state.ensure_derivations_survive_idle(
                key16(b"ledger.archive"),
                ParamValue::U32(5_256_000),
                ParamValue::U32(5_255_999)
            ),
            Ok(())
        );
        // "moves no frozen literal" — 08 §4.3 keeps the Baseline book outside
        // the §4.1 arithmetic and outside `pol.budget_epoch`.
        assert_eq!(
            state.ensure_derivations_survive_idle(
                key16(b"pol.b_baseline"),
                ParamValue::Balance(25_000 * usdc),
                ParamValue::Balance(26_000 * usdc)
            ),
            Ok(())
        );
    }

    // ------------------------------------------------------------ SQ-501 ---
    //
    // The occupancy family used to be refused unconditionally in both
    // directions, so no value of `epoch.slots`, `mkt.obs_interval`,
    // `dec.window` or `epoch.length` was admissible and their 13 §1 rows were
    // declaratory. These tests pin the value test that replaced it: admitted
    // exactly when every 13 §5 item 1–4 envelope still holds.

    /// The genesis registry sits **exactly on** three of the four envelopes
    /// (52 vaults, 133,920 decision-critical and 580,320 full-window
    /// observations), which is what makes each key's admission boundary its own
    /// default and lets both sides of it be tested.
    ///
    /// Production magnitudes, so default build only: `fast-timing` compresses
    /// the epoch clock these figures are derived at (SQ-128), exactly like the
    /// neighbouring `epoch.length` boundary cases above.
    #[cfg(not(feature = "fast-timing"))]
    #[test]
    fn sq_501_occupancy_screen_admits_exactly_the_values_the_envelopes_hold_for() {
        let state = ConstitutionState::genesis();
        let screen = |name: &[u8], current: ParamValue, next: ParamValue| {
            state.ensure_derivations_survive_idle(key16(name), current, next)
        };

        // `epoch.slots` — item 2's vault occupancy (32 + 4·slots ≤ 52) and item
        // 4's book count (slots·6 + 1) both bind at 5. Lowering is safe.
        assert_eq!(
            screen(b"epoch.slots", ParamValue::U8(5), ParamValue::U8(4)),
            Ok(())
        );
        assert_eq!(
            screen(b"epoch.slots", ParamValue::U8(5), ParamValue::U8(6)),
            Err(Error::BudgetDerivationRequired)
        );

        // `mkt.obs_interval` — item 4's crank load is inversely proportional to
        // it, so raising is safe and 10 -> 9 is the first breach.
        assert_eq!(
            screen(
                b"mkt.obs_interval",
                ParamValue::U32(10),
                ParamValue::U32(11)
            ),
            Ok(())
        );
        assert_eq!(
            screen(b"mkt.obs_interval", ParamValue::U32(10), ParamValue::U32(9)),
            Err(Error::BudgetDerivationRequired)
        );

        // `dec.window` — item 4's decision-critical figure is 31 ×
        // ceil(window / 10), so 43,200 is admissible to the block and 43,201
        // buys a whole extra observation per book.
        assert_eq!(
            screen(
                b"dec.window",
                ParamValue::U32(43_200),
                ParamValue::U32(43_190)
            ),
            Ok(())
        );
        assert_eq!(
            screen(
                b"dec.window",
                ParamValue::U32(43_200),
                ParamValue::U32(43_201)
            ),
            Err(Error::BudgetDerivationRequired)
        );

        // `epoch.length` — item 4's full-window figure is 31 ×
        // ceil(epoch·13/21 / 10); shortening the epoch shortens the Trade phase.
        assert_eq!(
            screen(
                b"epoch.length",
                ParamValue::U32(302_400),
                ParamValue::U32(302_379)
            ),
            Ok(())
        );
        assert_eq!(
            screen(
                b"epoch.length",
                ParamValue::U32(302_400),
                ParamValue::U32(302_401)
            ),
            Err(Error::BudgetDerivationRequired)
        );
    }

    /// `OCCUPANCY_PARAM_KEYS` fills [`OccupancyParams`] positionally, so a
    /// reordering of the list would silently feed `dec.window` into the epoch
    /// length. Pin the mapping against the genesis registry, whose five values
    /// are pairwise distinct, and pin that substituting the amended key moves
    /// **only** its own field.
    #[cfg(not(feature = "fast-timing"))]
    #[test]
    fn sq_501_extractor_maps_each_key_to_its_own_field() {
        let state = ConstitutionState::genesis();
        let live = |wanted: ParamKey| {
            state
                .params
                .iter()
                .find(|record| record.key == wanted)
                .map(|record| record.value)
        };
        let genesis = OccupancyParams {
            epoch_length: 302_400,
            epoch_slots: 5,
            obs_interval: 10,
            dec_window: 43_200,
            archive_delay: kernel::MAX_ARCHIVE_DELAY_BLOCKS,
        };
        // An unrelated key substitutes nothing, so this is the pure live read.
        assert_eq!(
            occupancy_params_for(
                key16(b"mkt.fee"),
                ParamValue::Perbill(1),
                live,
                InFlightOccupancy::IDLE
            ),
            Some(genesis)
        );
        for (name, next, expected) in [
            (
                b"epoch.length".as_slice(),
                ParamValue::U32(201_600),
                OccupancyParams {
                    epoch_length: 201_600,
                    ..genesis
                },
            ),
            (
                b"epoch.slots".as_slice(),
                ParamValue::U8(3),
                OccupancyParams {
                    epoch_slots: 3,
                    ..genesis
                },
            ),
            (
                b"mkt.obs_interval".as_slice(),
                ParamValue::U32(25),
                OccupancyParams {
                    obs_interval: 25,
                    ..genesis
                },
            ),
            (
                b"dec.window".as_slice(),
                ParamValue::U32(14_400),
                OccupancyParams {
                    dec_window: 14_400,
                    ..genesis
                },
            ),
            (
                b"ledger.archive".as_slice(),
                ParamValue::U32(1_296_000),
                OccupancyParams {
                    archive_delay: 1_296_000,
                    ..genesis
                },
            ),
        ] {
            assert_eq!(
                occupancy_params_for(key16(name), next, live, InFlightOccupancy::IDLE),
                Some(expected),
                "{name:?} did not substitute into its own field"
            );
        }
    }

    /// An equal write is not a change (13 §5 item 6), so it never reaches the
    /// derivation at all — including for keys whose live value would fail the
    /// screen if it were proposed today.
    #[test]
    fn sq_501_equal_writes_are_never_screened() {
        let state = ConstitutionState::genesis();
        for name in OCCUPANCY_PARAM_KEYS {
            let record = state
                .params
                .iter()
                .find(|record| record.key == key16(name))
                .expect("13 §1 occupancy row is seeded");
            assert_eq!(
                state.ensure_derivations_survive_idle(record.key, record.value, record.value),
                Ok(()),
                "equal write to {name:?} was screened"
            );
        }
    }

    /// 13 §5 item 6 names `ledger.archive` an item-1 *input* but explicitly not
    /// a screening trigger ("can only move downward from its one-year K
    /// ceiling"). Reading it live and screening it are different things, and
    /// SQ-501 must not turn the first into the second.
    #[test]
    fn sq_501_ledger_archive_is_an_input_not_a_trigger() {
        let state = ConstitutionState::genesis();
        assert!(!is_occupancy_input(key16(b"ledger.archive")));
        assert!(OCCUPANCY_PARAM_KEYS.contains(&b"ledger.archive".as_slice()));
        // Every lawful move is downward, and downward shrinks item 1's retained
        // batch count. Not screened at all, in either direction.
        for next in [1_296_000_u32, kernel::MAX_ARCHIVE_DELAY_BLOCKS - 1] {
            assert_eq!(
                state.ensure_derivations_survive_idle(
                    key16(b"ledger.archive"),
                    ParamValue::U32(kernel::MAX_ARCHIVE_DELAY_BLOCKS),
                    ParamValue::U32(next)
                ),
                Ok(())
            );
        }
    }

    /// A registry the screen cannot read is refused, never passed (G-1). The
    /// derivation has no partial answer: an absent row means the envelopes were
    /// never evaluated, which is not the same as "no envelope was breached".
    #[test]
    fn sq_501_screen_fails_closed_on_an_unreadable_registry() {
        let mut state = ConstitutionState::genesis();
        state
            .params
            .retain(|record| record.key != key16(b"dec.window"));
        assert_eq!(
            state.ensure_derivations_survive_idle(
                key16(b"epoch.slots"),
                ParamValue::U8(5),
                ParamValue::U8(4)
            ),
            Err(Error::BudgetDerivationRequired)
        );
        // Same answer from the shared extractor, which is what both callers use.
        assert_eq!(
            occupancy_params_for(
                key16(b"epoch.slots"),
                ParamValue::U8(4),
                |wanted| {
                    state
                        .params
                        .iter()
                        .find(|record| record.key == wanted)
                        .map(|record| record.value)
                },
                InFlightOccupancy::IDLE
            ),
            None
        );
    }

    /// The paired-CODE analogue for the occupancy family: a change that breaches
    /// today is admitted once another key has paid for it. A direction test
    /// could not express this at all, which is the SQ-501 defect.
    #[cfg(not(feature = "fast-timing"))]
    #[test]
    fn sq_501_screen_admits_a_breaching_raise_once_another_key_pays_for_it() {
        let mut state = ConstitutionState::genesis();
        // 43,200 -> 86,400 doubles the decision-critical load at the default
        // observation interval.
        assert_eq!(
            state.ensure_derivations_survive_idle(
                key16(b"dec.window"),
                ParamValue::U32(43_200),
                ParamValue::U32(86_400)
            ),
            Err(Error::BudgetDerivationRequired)
        );
        // Halving the observation rate first pays for exactly that doubling:
        // 31 × ceil(86,400/20) = 133,920, the frozen figure to the observation.
        for record in state.params.iter_mut() {
            if record.key == key16(b"mkt.obs_interval") {
                record.value = ParamValue::U32(20);
            }
        }
        assert_eq!(
            state.ensure_derivations_survive_idle(
                key16(b"dec.window"),
                ParamValue::U32(43_200),
                ParamValue::U32(86_400)
            ),
            Ok(())
        );
        // The same raise buys `epoch.length` its whole 13 §1 range: at a 20-block
        // interval the 604,800-block epoch's Trade phase costs 31 ×
        // ceil(374,400/20) = 580,320 full-window observations — again exactly the
        // frozen figure. `epoch.length` is therefore screened, not frozen upward.
        assert_eq!(
            state.ensure_derivations_survive_idle(
                key16(b"epoch.length"),
                ParamValue::U32(302_400),
                ParamValue::U32(kernel::PRODUCTION_MAX_EPOCH_LENGTH_BLOCKS)
            ),
            Ok(())
        );
    }

    /// Re-derive the effective occupancy set from `state`'s registry with `next`
    /// substituted, at a given in-flight state. A free function rather than a
    /// closure so it holds no borrow across the writes under test.
    #[cfg(not(feature = "fast-timing"))]
    fn derive_at(
        state: &ConstitutionState,
        key: &[u8],
        next: ParamValue,
        in_flight: InFlightOccupancy,
    ) -> OccupancyParams {
        occupancy_params_for(
            key16(key),
            next,
            |wanted| {
                state
                    .params
                    .iter()
                    .find(|record| record.key == wanted)
                    .map(|record| record.value)
            },
            in_flight,
        )
        .expect("the genesis registry is readable")
    }

    /// A five-slot cohort in flight: 31 books, and the epoch length it was
    /// created under. This is the state both #189 counterexamples exploit.
    #[cfg(not(feature = "fast-timing"))]
    const FIVE_SLOT_COHORT: InFlightOccupancy = InFlightOccupancy {
        max_cohort_proposals: 5,
        max_epoch_length: 302_400,
    };

    /// Both #189 counterexamples, with their exact numbers.
    ///
    /// Review 1: `epoch.slots` 5 → 4 then `mkt.obs_interval` 10 → 9 read
    /// `25 × 4,800 = 120,000` against the registry while the live five-slot
    /// cohort needs `31 × 4,800 = 148,800`.
    ///
    /// Review 2, one step further out: the same slot cut, then an
    /// `mkt.obs_interval` **raise** 10 → 11 — genuinely safe, and admitted — to
    /// manufacture registry headroom, then `dec.window` 43,200 → 51,840 (exactly
    /// its 20 % max-Δ) reading `25 × ceil(51,840/11) = 117,825` against the
    /// registry while the live cohort immediately incurs
    /// `31 × 4,713 = 146,103`. `dec.window` is live-consumed, so the raise binds
    /// books already trading at once.
    ///
    /// Both are refused by the same composition, and neither needs a rule about
    /// directions: with the book count taken from what is in flight, the value
    /// test is exact.
    #[cfg(not(feature = "fast-timing"))]
    #[test]
    fn sq_501_registry_headroom_cannot_be_spent_on_a_live_cohort() {
        let mut state = ConstitutionState::genesis();

        // --- review 1 ------------------------------------------------------
        // The slot cut is admitted even with the cohort live: its 31 books at the
        // unchanged interval are exactly the frozen 133,920.
        assert_eq!(
            state.ensure_derivations_survive(
                key16(b"epoch.slots"),
                ParamValue::U8(5),
                ParamValue::U8(4),
                FIVE_SLOT_COHORT,
            ),
            Ok(())
        );
        state
            .dispatch_set_param(
                ConstitutionOrigin::FutarchyMeta,
                key16(b"epoch.slots"),
                ParamValue::U8(4),
                2,
                20,
                FIVE_SLOT_COHORT,
            )
            .expect("lowering the slot count is safe against every envelope");

        // Registry-only reads 120,000 and looks safe; the live cohort needs
        // 148,800. The composition sees the latter.
        let interval_9_registry = derive_at(
            &state,
            b"mkt.obs_interval",
            ParamValue::U32(9),
            InFlightOccupancy::IDLE,
        );
        assert_eq!(
            kernel::derived_decision_critical_observations(&interval_9_registry),
            Some(120_000),
        );
        assert!(occupancy_envelopes_survive(interval_9_registry));
        let interval_9_live = derive_at(
            &state,
            b"mkt.obs_interval",
            ParamValue::U32(9),
            FIVE_SLOT_COHORT,
        );
        assert_eq!(
            kernel::derived_decision_critical_observations(&interval_9_live),
            Some(148_800),
        );
        assert!(!occupancy_envelopes_survive(interval_9_live));
        let before = state.clone();
        assert_eq!(
            state.dispatch_set_param(
                ConstitutionOrigin::FutarchyParam,
                key16(b"mkt.obs_interval"),
                ParamValue::U32(9),
                3,
                30,
                FIVE_SLOT_COHORT,
            ),
            Err(Error::BudgetDerivationRequired)
        );
        assert_eq!(state, before);

        // With nothing in flight the same lowering is admitted — the screen is a
        // value test against reality, not a direction rule.
        assert_eq!(
            state.ensure_derivations_survive_idle(
                key16(b"mkt.obs_interval"),
                ParamValue::U32(10),
                ParamValue::U32(9),
            ),
            Ok(())
        );

        // --- review 2 ------------------------------------------------------
        // Raising the interval is safe and admitted, even with the cohort live.
        state
            .dispatch_set_param(
                ConstitutionOrigin::FutarchyParam,
                key16(b"mkt.obs_interval"),
                ParamValue::U32(11),
                3,
                30,
                FIVE_SLOT_COHORT,
            )
            .expect("a longer interval can only reduce every in-flight load");

        // That headroom cannot then be spent on a `dec.window` raise: 51,840 is
        // exactly the 20 % max-Δ, reads 117,825 against the registry, and costs
        // the live cohort 146,103.
        let window_registry = derive_at(
            &state,
            b"dec.window",
            ParamValue::U32(51_840),
            InFlightOccupancy::IDLE,
        );
        assert_eq!(
            kernel::derived_decision_critical_observations(&window_registry),
            Some(117_825),
        );
        assert!(occupancy_envelopes_survive(window_registry));
        let window_live = derive_at(
            &state,
            b"dec.window",
            ParamValue::U32(51_840),
            FIVE_SLOT_COHORT,
        );
        assert_eq!(
            kernel::derived_decision_critical_observations(&window_live),
            Some(146_103),
        );
        assert!(!occupancy_envelopes_survive(window_live));
        let before = state.clone();
        assert_eq!(
            state.dispatch_set_param(
                ConstitutionOrigin::FutarchyMeta,
                key16(b"dec.window"),
                ParamValue::U32(51_840),
                5,
                50,
                FIVE_SLOT_COHORT,
            ),
            Err(Error::BudgetDerivationRequired)
        );
        assert_eq!(state, before);
    }

    /// The in-flight composition takes the adverse end of the two **pinned**
    /// inputs and leaves the three live ones at their proposed values, because
    /// for those the proposed value is already what is in force everywhere.
    #[test]
    fn sq_501_composition_moves_only_the_pinned_inputs() {
        let proposed = kernel::OccupancyParams {
            epoch_length: 201_600,
            epoch_slots: 4,
            obs_interval: 25,
            dec_window: 20_000,
            archive_delay: 1_296_000,
        };
        let in_flight = InFlightOccupancy {
            max_cohort_proposals: 5,
            max_epoch_length: 302_400,
        };
        let effective = kernel::effective_occupancy(proposed, in_flight);
        // Pinned: the live value wins when it is the adverse one.
        assert_eq!(effective.epoch_slots, 5);
        assert_eq!(effective.epoch_length, 302_400);
        // Live-consumed: untouched.
        assert_eq!(effective.obs_interval, proposed.obs_interval);
        assert_eq!(effective.dec_window, proposed.dec_window);
        assert_eq!(effective.archive_delay, proposed.archive_delay);
        // A proposal above the in-flight maximum still governs future cohorts.
        let raised = kernel::effective_occupancy(
            kernel::OccupancyParams {
                epoch_slots: 9,
                ..proposed
            },
            in_flight,
        );
        assert_eq!(raised.epoch_slots, 9);
        // Idle is the identity on the registry set.
        assert_eq!(
            kernel::effective_occupancy(proposed, InFlightOccupancy::IDLE),
            proposed
        );
    }

    /// The 13 §1 bounds / max-Δ / cooldown checks run **before** the screen, so
    /// an out-of-registry value still fails as an ordinary registry violation
    /// and the limit-coverage bindings for these rows stay reachable (15 §4.6).
    #[cfg(not(feature = "fast-timing"))]
    #[test]
    fn sq_501_registry_checks_still_precede_the_occupancy_screen() {
        let mut state = ConstitutionState::genesis();
        // Below `epoch.slots`' hard min — and also inside every envelope, so
        // only the ordering can produce `BelowMin`.
        assert_eq!(
            state.dispatch_set_param_idle(
                ConstitutionOrigin::FutarchyMeta,
                key16(b"epoch.slots"),
                ParamValue::U8(0),
                1,
                10,
            ),
            Err(Error::BelowMin)
        );
        // Above `mkt.obs_interval`'s hard max — safe for every envelope
        // (fewer observations), so again only the ordering yields `AboveMax`.
        assert_eq!(
            state.dispatch_set_param_idle(
                ConstitutionOrigin::FutarchyParam,
                key16(b"mkt.obs_interval"),
                ParamValue::U32(51),
                1,
                10,
            ),
            Err(Error::AboveMax)
        );
        // Max-Δ likewise: 10 -> 16 is envelope-safe but a 6-block step.
        assert_eq!(
            state.dispatch_set_param_idle(
                ConstitutionOrigin::FutarchyParam,
                key16(b"mkt.obs_interval"),
                ParamValue::U32(16),
                1,
                10,
            ),
            Err(Error::DeltaTooLarge)
        );
        // And an admissible, envelope-safe value goes through end to end.
        assert_eq!(
            state.dispatch_set_param_idle(
                ConstitutionOrigin::FutarchyParam,
                key16(b"mkt.obs_interval"),
                ParamValue::U32(15),
                1,
                10,
            ),
            Ok(())
        );
    }

    /// The derivation must reproduce 08 §4.1's published table, or the screen is
    /// comparing against something other than the floors the runtime enforces.
    #[test]
    fn sq_303_derivation_reproduces_the_published_floor_table() {
        let usdc = futarchy_primitives::currency::USDC;
        let gate = 7_500 * usdc;
        for (b, frozen) in [
            (10_000, 4_620_989u128),
            (25_000, 7_393_600),
            (60_000, 13_862_944),
            (100_000, 21_256_533),
        ] {
            let derived =
                futarchy_primitives::kernel::derived_class_nav_floor(b * usdc, gate, 7_500_000)
                    .expect("derivable at the default budget");
            // Every published literal is at or above the exact derivation — the
            // conservative direction, and what makes `derived <= frozen` the
            // right test rather than an equality.
            assert!(
                derived <= frozen * usdc,
                "derived {derived} exceeds published floor {frozen}"
            );
            // ... but by less than one whole USDC, so the table really is this
            // derivation and not an unrelated set of numbers.
            assert!(frozen * usdc - derived < 31 * usdc);
        }
    }

    #[test]
    fn welfare_low_knees_require_the_track_matching_the_direction() {
        for key_name in [b"welfare.thS_lo".as_slice(), b"welfare.thC_lo".as_slice()] {
            let key = key16(key_name);
            let initial = ConstitutionState::genesis();
            let record = initial.params.iter().find(|record| record.key == key);
            assert!(record.is_some(), "welfare low-knee key must be seeded");
            let Some(record) = record else {
                return;
            };
            let interval = record.admissible_next_interval();
            assert!(interval.is_ok(), "welfare low-knee interval must be valid");
            let Ok((_, upper)) = interval else {
                return;
            };
            let raised = value_from_raw(record.value, upper);
            assert!(
                raised.is_some(),
                "welfare low-knee upper value must preserve its kind"
            );
            let Some(raised) = raised else {
                return;
            };
            assert!(upper > record.value.as_u128());

            // Increase: constitution succeeds; entrenched and the legacy bare
            // values origin fail without writing.
            let mut wrong_increase = initial.clone();
            let before = wrong_increase.clone();
            assert_eq!(
                wrong_increase.dispatch_set_param_idle(
                    ConstitutionOrigin::EntrenchedTrack,
                    key,
                    raised,
                    record.cooldown_epochs,
                    1,
                ),
                Err(Error::BadOrigin)
            );
            assert_eq!(wrong_increase, before);
            let mut bare_values = initial.clone();
            let before = bare_values.clone();
            assert_eq!(
                bare_values.dispatch_set_param_idle(
                    ConstitutionOrigin::ConstitutionalValues,
                    key,
                    raised,
                    record.cooldown_epochs,
                    1,
                ),
                Err(Error::BadOrigin)
            );
            assert_eq!(bare_values, before);

            let mut raised_state = initial.clone();
            assert_eq!(
                raised_state.dispatch_set_param_idle(
                    ConstitutionOrigin::ConstitutionTrack,
                    key,
                    raised,
                    record.cooldown_epochs,
                    1,
                ),
                Ok(())
            );

            // Decrease from the tightened value: entrenched succeeds and the
            // constitution track cannot walk its own tightening back.
            let decrease_epoch = record.cooldown_epochs.saturating_mul(2);
            let mut wrong_decrease = raised_state.clone();
            let before = wrong_decrease.clone();
            assert_eq!(
                wrong_decrease.dispatch_set_param_idle(
                    ConstitutionOrigin::ConstitutionTrack,
                    key,
                    record.value,
                    decrease_epoch,
                    2,
                ),
                Err(Error::BadOrigin)
            );
            assert_eq!(wrong_decrease, before);
            assert_eq!(
                raised_state.dispatch_set_param_idle(
                    ConstitutionOrigin::EntrenchedTrack,
                    key,
                    record.value,
                    decrease_epoch,
                    2,
                ),
                Ok(())
            );

            // Equality retains the row's CONST-class constitution route; it
            // neither grants entrenched authority nor admits bare values.
            let mut equal = initial.clone();
            assert_eq!(
                equal.dispatch_set_param_idle(
                    ConstitutionOrigin::ConstitutionTrack,
                    key,
                    record.value,
                    record.cooldown_epochs,
                    3,
                ),
                Ok(())
            );
            for origin in [
                ConstitutionOrigin::EntrenchedTrack,
                ConstitutionOrigin::ConstitutionalValues,
            ] {
                let mut refused_equal = initial.clone();
                let before = refused_equal.clone();
                assert_eq!(
                    refused_equal.dispatch_set_param_idle(
                        origin,
                        key,
                        record.value,
                        record.cooldown_epochs,
                        3,
                    ),
                    Err(Error::BadOrigin)
                );
                assert_eq!(refused_equal, before);
            }

            // The launch floor remains absolute even for the entrenched path.
            let below_floor_raw = record.min.as_u128().checked_sub(1);
            assert!(
                below_floor_raw.is_some(),
                "welfare launch floor must be non-zero"
            );
            let Some(below_floor_raw) = below_floor_raw else {
                return;
            };
            let below_floor = value_from_raw(record.value, below_floor_raw);
            assert!(
                below_floor.is_some(),
                "welfare below-floor value must preserve its kind"
            );
            let Some(below_floor) = below_floor else {
                return;
            };
            let mut floor_state = initial.clone();
            let before = floor_state.clone();
            assert_eq!(
                floor_state.dispatch_set_param_idle(
                    ConstitutionOrigin::EntrenchedTrack,
                    key,
                    below_floor,
                    record.cooldown_epochs,
                    4,
                ),
                Err(Error::BelowMin)
            );
            assert_eq!(floor_state, before);
        }
    }

    #[test]
    fn meters_reset_by_epoch_and_never_overspend() {
        let mut meter = Meter::new(10, 0);
        meter.charge(7, 0).unwrap();
        assert_eq!(meter.charge(4, 0), Err(Error::MeterExhausted));
        meter.charge(4, 1).unwrap();
        assert_eq!(meter.spent, 4);
    }

    #[test]
    fn dispatch_charge_meter_checks_origin_and_bounds() {
        let mut state = ConstitutionState::genesis();
        // Genesis carries no meters (I-17 envelopes live with their owning
        // pallets); seed the primitive directly for the mechanics test.
        state.meters = alloc::vec![Meter::new(10, 0), Meter::new(0, 0)];
        assert_eq!(
            state.dispatch_charge_meter(ConstitutionOrigin::Signed, 0, 1, 0),
            Err(Error::BadOrigin)
        );
        assert_eq!(
            state.dispatch_charge_meter(ConstitutionOrigin::Root, 0, 1, 0),
            Err(Error::BadOrigin)
        );
        assert_eq!(
            state.dispatch_charge_meter(ConstitutionOrigin::FutarchyTreasury, 99, 1, 0),
            Err(Error::UnknownMeter)
        );
        assert_eq!(
            state.dispatch_charge_meter(ConstitutionOrigin::FutarchyTreasury, 1, 1, 0),
            Err(Error::MeterExhausted)
        );
        state
            .dispatch_charge_meter(ConstitutionOrigin::FutarchyTreasury, 0, 1, 0)
            .unwrap();
    }

    #[test]
    fn phase_flags_reject_reserved_bits_and_origin_misuse() {
        let mut state = ConstitutionState::genesis();
        // 09 §5.4: bootstrap sudo (Root) is the only origin-mediated flag
        // writer; guardian/playbook/META dispatch is refused (06 §5.2, I-23).
        for refused in [
            ConstitutionOrigin::Signed,
            ConstitutionOrigin::GuardianHold,
            ConstitutionOrigin::EmergencyPlaybook,
            ConstitutionOrigin::FutarchyMeta,
            ConstitutionOrigin::ConstitutionalValues,
        ] {
            assert_eq!(
                state.dispatch_set_phase_flag(refused, PhaseFlags::SUDO_PRESENT, true),
                Err(Error::BadOrigin)
            );
        }
        state
            .dispatch_set_phase_flag(ConstitutionOrigin::Root, PhaseFlags::SUDO_PRESENT, true)
            .unwrap();
        assert!(state.phase_flags.contains(PhaseFlags::SUDO_PRESENT));
        // Outside the armable mask: machinery bits and reserved bits alike.
        assert_eq!(
            state.dispatch_set_phase_flag(
                ConstitutionOrigin::Root,
                PhaseFlags::LEDGER_FROZEN,
                true
            ),
            Err(Error::FlagNotArmable)
        );
        assert_eq!(
            state.dispatch_set_phase_flag(ConstitutionOrigin::Root, 1 << 8, true),
            Err(Error::FlagNotArmable)
        );
        // The raw setter still rejects reserved bits (try-state guard).
        assert_eq!(
            state.phase_flags.set(1 << 8, true),
            Err(Error::ReservedPhaseFlag)
        );
    }

    #[test]
    fn meta_and_values_keys_are_enacted_by_futarchy_meta_only() {
        // 06 §1: values cannot invoke parameter keys; the values half of the
        // META+values dual consent is execute-time ratification (06 §2.2).
        let mut state = ConstitutionState::genesis();
        assert_eq!(
            state.dispatch_set_param_idle(
                ConstitutionOrigin::ConstitutionalValues,
                key16(b"epoch.horizon_k"),
                // 1, not 3: the kernel ceiling is now `MAX_NON_TERMINAL_COHORTS
                // - 2 = 2` (SQ-496), so 3 would be refused for a *bounds*
                // reason and stop testing the origin rule this case is about.
                ParamValue::U8(1),
                4,
                40
            ),
            Err(Error::BadOrigin)
        );
        state
            .dispatch_set_param_idle(
                ConstitutionOrigin::FutarchyMeta,
                key16(b"epoch.horizon_k"),
                ParamValue::U8(1),
                4,
                40,
            )
            .unwrap();
    }

    #[test]
    fn release_channel_is_fixed_width_offset_readable_and_origin_checked() {
        let channel = release_channel();
        assert_eq!(RELEASE_CHANNEL_STORAGE_KEY.len(), 32);
        assert_eq!(channel.updated_at(), 42);
        assert_eq!(channel.spec_version(), 7);
        assert_eq!(channel.pending_authorized_at(), 11);
        assert_eq!(channel.flags(), 5);
        let mut bad = [0u8; RELEASE_CHANNEL_LEN];
        bad[0] = 2;
        assert_eq!(ReleaseChannel::new(bad), Err(Error::BadReleaseSchema));
        // 02 §12: flags bits 3–31 are reserved zero — a schema-1 value
        // carrying them must be refused, not published.
        let mut reserved_flag = [0u8; RELEASE_CHANNEL_LEN];
        reserved_flag[0] = 1;
        reserved_flag[164..168].copy_from_slice(&(1u32 << 3).to_le_bytes());
        assert_eq!(
            ReleaseChannel::new(reserved_flag),
            Err(Error::BadReleaseSchema)
        );
        let mut all_defined_flags = [0u8; RELEASE_CHANNEL_LEN];
        all_defined_flags[0] = 1;
        all_defined_flags[164..168].copy_from_slice(&ReleaseChannel::FLAGS_MASK.to_le_bytes());
        assert!(ReleaseChannel::new(all_defined_flags).is_ok());
        let mut state = ConstitutionState::genesis();
        assert_eq!(
            state.dispatch_set_release_channel(ConstitutionOrigin::Signed, bad, 7),
            Err(Error::BadOrigin)
        );
        let mut good = [0u8; RELEASE_CHANNEL_LEN];
        good[0] = 1;
        // 02 §12 / 06 §2.1: the scoped constitution track and its internal
        // bare form are the only origin-mediated writers; CODE/META/Root paths
        // must all be refused.
        for refused in [
            ConstitutionOrigin::FutarchyCode,
            ConstitutionOrigin::FutarchyMeta,
            ConstitutionOrigin::Root,
        ] {
            assert_eq!(
                state.dispatch_set_release_channel(refused, good, 7),
                Err(Error::BadOrigin)
            );
        }
        assert_eq!(
            state.dispatch_set_release_channel(ConstitutionOrigin::ConstitutionTrack, good, 7),
            Ok(())
        );
        assert_eq!(
            state.dispatch_set_release_channel(ConstitutionOrigin::ConstitutionalValues, good, 7),
            Ok(())
        );

        state.release_channel = channel;
        let mut writer_b = good;
        writer_b[108..112].copy_from_slice(&43u32.to_le_bytes());
        writer_b[112..116].copy_from_slice(&99u32.to_le_bytes());
        writer_b[116..120].copy_from_slice(&0u32.to_le_bytes());
        writer_b[164..168].copy_from_slice(&2u32.to_le_bytes());
        // 02 §12: offset 108 is the block of the last write, stamped by the
        // dispatch path. The caller's 43 MUST be ignored — a lawful writer
        // must not be able to backdate or future-date the freshness a
        // stranded reader depends on.
        assert_eq!(
            state.dispatch_set_release_channel(
                ConstitutionOrigin::ConstitutionalValues,
                writer_b,
                5_000
            ),
            Ok(())
        );
        assert_eq!(state.release_channel.updated_at(), 5_000);
        assert_eq!(state.release_channel.spec_version(), 7);
        assert_eq!(state.release_channel.pending_authorized_at(), 11);
        assert_eq!(state.release_channel.flags(), 6);
    }

    #[test]
    fn capability_table_is_bounded_origin_checked_and_queryable() {
        let mut state = ConstitutionState::genesis();
        let cap = CapabilityRecord {
            class: ProposalClass::Meta,
            capability: Capability::SetCapability,
            enabled: true,
        };
        assert_eq!(
            state.dispatch_set_capability(ConstitutionOrigin::Signed, cap),
            Err(Error::BadOrigin)
        );
        // 06 §3.2 row 4: values participates via ratification, not dispatch;
        // Root is outside the 09 §5.4 sudo scope.
        assert_eq!(
            state.dispatch_set_capability(ConstitutionOrigin::ConstitutionalValues, cap),
            Err(Error::BadOrigin)
        );
        assert_eq!(
            state.dispatch_set_capability(ConstitutionOrigin::Root, cap),
            Err(Error::BadOrigin)
        );
        state
            .dispatch_set_capability(ConstitutionOrigin::FutarchyMeta, cap)
            .unwrap();
        assert!(state.capability_enabled(ProposalClass::Meta, Capability::SetCapability));
    }

    #[test]
    fn try_state_rejects_corrupt_storage_shapes() {
        let state = ConstitutionState::genesis();
        state.try_state().unwrap();
        let mut bad = state.clone();
        bad.phase_flags = PhaseFlags(1 << 8);
        assert_eq!(bad.try_state(), Err(Error::ReservedPhaseFlag));
        let mut bad_meter = state;
        bad_meter.meters.push(Meter::new(5, 0));
        bad_meter.meters[0].spent = bad_meter.meters[0].limit + 1;
        assert_eq!(bad_meter.try_state(), Err(Error::MeterExhausted));
    }
}
