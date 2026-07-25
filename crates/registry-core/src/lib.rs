#![cfg_attr(not(feature = "std"), no_std)]
#![deny(unsafe_code)]

extern crate alloc;

use alloc::vec::Vec;
use futarchy_primitives::{
    AccountId, Balance, BlockNumber, EpochId, FixedU64, MetricSpecVersion, H256,
};
use parity_scale_codec::{Decode, DecodeWithMemTracking, Encode, MaxEncodedLen};
use scale_info::TypeInfo;

pub type FilingId = u32;

pub const MAX_FILINGS_PER_EPOCH: u32 = futarchy_primitives::kernel::REG_MAX_FILINGS_EPOCH;
pub const MAX_LIVE_EPOCHS: usize = 4;
/// Closed-but-unreaped aggregates: ≤ 4 non-settled epochs × ≤ 2 concurrent
/// frozen MetricSpec versions (07 §7; the version factor is `epoch.horizon_k`,
/// whose kernel ceiling is 2 — see 05 §3.3 and SQ-496). One epoch closes once
/// per version because a cohort settles on its creation-time spec (I-16), and
/// folding two versions' filings into one number would combine claims governed
/// by different frozen targets and formulas (G-1).
pub const MAX_AGGREGATES: usize = 8;
pub const REG_CLOSE_BATCH: usize = 20;
/// The 72 h filing challenge window (07 §7 "frozen constant"), single-homed onto
/// the shared `orc.window` kernel floor (01 §5.2 / rule 4 — no 13-owned literal
/// survives in a core).
pub const REG_WINDOW_BLOCKS: BlockNumber = futarchy_primitives::kernel::ORC_WINDOW_BLOCKS;
pub const REG_EXT_WINDOW_BLOCKS: BlockNumber =
    futarchy_primitives::kernel::WATCHTOWER_EXTENSION_BLOCKS;
/// Genesis defaults for the two META-amendable filing bonds (`reg.bond_incident`
/// / `reg.bond_milestone`, 13 §1: 5,000 / 2,500 USDC). Present only as the
/// [`Registry::new`] defaults for standalone / differential-oracle use; the FRAME
/// pallet overrides [`Registry::bond_incident`] / [`Registry::bond_milestone`]
/// from `pallet-constitution::Params` on every load (rule 4), so runtime
/// behaviour is never driven by these literals.
pub const REG_BOND_INCIDENT: Balance = 5_000_000_000;
pub const REG_BOND_MILESTONE: Balance = 2_500_000_000;
pub const WT_QUORUM: u8 = futarchy_primitives::kernel::WT_QUORUM;
pub const MILESTONE_TARGET_POINTS: u32 = 100;
const ONE: u64 = 1_000_000_000;

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
pub enum RegistryKind {
    Incident,
    Milestone,
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
pub enum FilingClass {
    S1,
    S2,
    S3,
    Scope(u8),
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
pub enum FilingState {
    Filed {
        window_end: BlockNumber,
        extended: bool,
        acks: u8,
    },
    Challenged {
        round: u8,
        window_end: BlockNumber,
        challenger: AccountId,
        evidence_hash: H256,
    },
    Upheld,
    Rejected,
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
pub struct Filing {
    pub who: AccountId,
    pub class: FilingClass,
    pub points: u16,
    pub evidence_hash: H256,
    pub bond: Balance,
    pub state: FilingState,
    pub spec_version: MetricSpecVersion,
}

#[derive(Clone, Debug, Decode, Encode, Eq, PartialEq, TypeInfo)]
pub enum Event {
    IncidentFiled {
        epoch: EpochId,
        filing_id: FilingId,
        who: AccountId,
        class: FilingClass,
        evidence_hash: H256,
        bond: Balance,
    },
    MilestoneFiled {
        epoch: EpochId,
        filing_id: FilingId,
        who: AccountId,
        class: FilingClass,
        points: u16,
        evidence_hash: H256,
        bond: Balance,
    },
    IncidentChallenged {
        epoch: EpochId,
        filing_id: FilingId,
        challenger: AccountId,
        evidence_hash: H256,
        bond: Balance,
    },
    MilestoneChallenged {
        epoch: EpochId,
        filing_id: FilingId,
        challenger: AccountId,
        evidence_hash: H256,
        bond: Balance,
    },
    IncidentUpheld {
        epoch: EpochId,
        filing_id: FilingId,
    },
    IncidentRejected {
        epoch: EpochId,
        filing_id: FilingId,
    },
    MilestoneAccepted {
        epoch: EpochId,
        filing_id: FilingId,
    },
    MilestoneRejected {
        epoch: EpochId,
        filing_id: FilingId,
    },
    FilingBondSlashed {
        epoch: EpochId,
        filing_id: FilingId,
        loser: AccountId,
        amount: Balance,
        challenger_share: Balance,
        insurance_share: Balance,
    },
    RegistryEpochClosed {
        kind: RegistryKind,
        epoch: EpochId,
        /// The frozen MetricSpec version this close folded (contract v14,
        /// SQ-141). One epoch closes once per live version.
        spec_version: MetricSpecVersion,
        aggregate: FixedU64,
    },
    WindowAcknowledged {
        epoch: EpochId,
        filing_id: FilingId,
        watchtower: AccountId,
    },
    WindowExtended {
        epoch: EpochId,
        filing_id: FilingId,
        new_deadline: BlockNumber,
    },
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
pub enum Error {
    EpochFull,
    TooManyLiveEpochs,
    TooManyAggregates,
    WindowClosed,
    WindowOpen,
    AlreadyChallenged,
    AlreadyFinal,
    SpecVersionMismatch,
    BondBelowMinimum,
    FilingNotFound,
    DuplicateAck,
    BatchTooLarge,
    InvalidClass,
    Overflow,
    NotRegistered,
    /// The filing already has `WT_QUORUM` acknowledgments — further acks add
    /// nothing and are rejected so the per-filing ack set stays bounded (07 §4).
    AlreadyQuorum,
    /// The Milestone instance's frozen-MetricSpec completion `target` is zero or
    /// absent, so `min(1, points ÷ target)` has no defined value (07 §7
    /// *Milestone normalization*). Filing and close both refuse: normalizing to
    /// an aggregate of `0` would record a fail-*adverse* A-pillar component as
    /// if it were a real measurement, which the rule forbids. Appended last —
    /// the preceding discriminants are SCALE-stable.
    MilestoneTargetUnset,
    /// The filing's cohort exposure cannot be determined, so its value-scaled
    /// bond cannot be priced. Filing refuses before any state mutation (G-1).
    /// Appended last — the preceding discriminants are SCALE-stable.
    ExposureUnavailable,
    /// A terminal verdict named an evidence hash other than the one the challenge
    /// committed, so it was authored against a different filing than the one it
    /// would resolve (07 §7 *terminal resolution*). The bond stays custodied and
    /// the filing stays `Challenged` (G-1). Appended last — the preceding
    /// discriminants are SCALE-stable.
    EvidenceMismatch,
    /// A reap was attempted for a version while a **sibling** version of the
    /// same epoch still holds unclosed records (07 §7). Reaping first would
    /// erase the epoch's only remaining evidence that it was ever filed, which
    /// both strands the sibling's `close_epoch` and makes welfare read the epoch
    /// as unfiled. Appended last — the preceding discriminants are SCALE-stable.
    ReapNotDue,
}

#[derive(Clone, Debug, Decode, Encode, Eq, PartialEq, TypeInfo)]
pub struct FileInput {
    pub who: AccountId,
    pub now: BlockNumber,
    pub epoch: EpochId,
    pub class: FilingClass,
    pub points: u16,
    pub evidence_hash: H256,
    pub spec_version: MetricSpecVersion,
    /// The MetricSpec versions live cohorts froze for `epoch` (I-16). A filing
    /// MUST name one of them — **membership**, not equality against a single
    /// version. The pair key of 07 §7 exists precisely because an activation
    /// boundary can leave two versions live for one measurement epoch, and the
    /// old single-version gate resolved to "none" there, refusing every filing.
    /// Read from the epoch/welfare seam, **never** from the filer.
    pub frozen_specs: Vec<MetricSpecVersion>,
    /// The frozen `target` of the milestone component **at `spec_version`**
    /// (05 §4.3's `min(1, points ÷ target)`). Per-version by construction: two
    /// cohorts measuring the same epoch under different specs normalize against
    /// different divisors, which is half of why the lifecycle is versioned.
    /// Unused by the Incident instance.
    pub milestone_target: u32,
    pub filing_window_end: BlockNumber,
    /// Cohort escrow exposed to this filing's aggregate. `None` is a
    /// fail-closed refusal, never a zero-exposure fallback (07 §7).
    pub exposure: Option<Balance>,
}

#[derive(Clone, Debug, Decode, Encode, Eq, PartialEq, TypeInfo)]
pub struct Registry {
    pub kind: RegistryKind,
    pub filings: Vec<((EpochId, FilingId), Filing)>,
    pub filing_count: Vec<(EpochId, u32)>,
    pub aggregates: Vec<((EpochId, MetricSpecVersion), FixedU64)>,
    pub events: Vec<Event>,
    ack_records: Vec<(EpochId, FilingId, AccountId)>,
    /// Live `reg.bond_incident` — the FRAME pallet refreshes this from
    /// `pallet-constitution::Params` on every load (rule 4); defaults to
    /// [`REG_BOND_INCIDENT`] for standalone / differential use.
    pub bond_incident: Balance,
    /// Live `reg.bond_milestone` — see [`Registry::bond_incident`].
    pub bond_milestone: Balance,
    /// Live `orc.bond_bps` in basis points (250 = 2.5%). The FRAME pallet
    /// refreshes it from `pallet-constitution::Params` on every load; 250 is
    /// only the 13 §1 standalone / differential default.
    pub coverage_bps: u32,
}

impl Registry {
    pub fn new(kind: RegistryKind) -> Self {
        Self {
            kind,
            filings: Vec::new(),
            filing_count: Vec::new(),
            aggregates: Vec::new(),
            events: Vec::new(),
            ack_records: Vec::new(),
            bond_incident: REG_BOND_INCIDENT,
            bond_milestone: REG_BOND_MILESTONE,
            coverage_bps: 1_750,
        }
    }

    pub fn file(&mut self, input: FileInput) -> Result<FilingId, Error> {
        ensure!(input.now <= input.filing_window_end, Error::WindowClosed);
        // Membership, not equality (07 §7, SQ-141): an activation boundary can
        // leave two versions live for one measurement epoch, and the old
        // single-version gate resolved to "none" there and refused every
        // filing. This is a deliberate closed→open transition.
        ensure!(
            input.frozen_specs.contains(&input.spec_version),
            Error::SpecVersionMismatch
        );
        // A closed-out `(epoch, version)` aggregate is terminal (07 §7): late
        // filings must not land behind an already-derived welfare input. Scoped
        // to the pair — a sibling version's close says nothing about this one.
        ensure!(
            self.aggregates
                .iter()
                .all(|((e, v), _)| !(*e == input.epoch && *v == input.spec_version)),
            Error::AlreadyFinal
        );
        self.validate_class(input.class)?;
        // Price the claim before any state mutation. In particular, an
        // unavailable Milestone exposure wins over the independent
        // normalization-target gate: production must refuse it for the
        // SQ-296 fail-closed reason until SQ-175 wires a component binding.
        let bond = self.required_bond(input.exposure)?;
        // 07 §7 *Milestone normalization*: a milestone component with no
        // positive `target` is not admissible, so the Milestone instance refuses
        // the filing at the door rather than escrowing a bond into an epoch whose
        // close can never produce an aggregate. Without this the epoch's
        // `FilingCount` entry would survive forever (close refuses ⇒ no
        // `ClosedAt` ⇒ no reap), wedging the instance at `MAX_LIVE_EPOCHS`.
        if matches!(self.kind, RegistryKind::Milestone) {
            ensure!(input.milestone_target > 0, Error::MilestoneTargetUnset);
        }
        ensure!(bond > 0, Error::BondBelowMinimum);
        if self.filing_count.iter().all(|(e, _)| *e != input.epoch) {
            ensure!(
                self.filing_count.len() < MAX_LIVE_EPOCHS,
                Error::TooManyLiveEpochs
            );
            self.filing_count.push((input.epoch, 0));
        }
        let count = self
            .filing_count
            .iter_mut()
            .find(|(e, _)| *e == input.epoch)
            .ok_or(Error::Overflow)?;
        ensure!(count.1 < MAX_FILINGS_PER_EPOCH, Error::EpochFull);
        let filing_id = count.1;
        count.1 = count.1.checked_add(1).ok_or(Error::Overflow)?;
        let filing = Filing {
            who: input.who,
            class: input.class,
            points: input.points,
            evidence_hash: input.evidence_hash,
            bond,
            state: FilingState::Filed {
                window_end: input.now.saturating_add(REG_WINDOW_BLOCKS),
                extended: false,
                acks: 0,
            },
            spec_version: input.spec_version,
        };
        self.filings.push(((input.epoch, filing_id), filing));
        match self.kind {
            RegistryKind::Incident => self.events.push(Event::IncidentFiled {
                epoch: input.epoch,
                filing_id,
                who: input.who,
                class: input.class,
                evidence_hash: input.evidence_hash,
                bond,
            }),
            RegistryKind::Milestone => self.events.push(Event::MilestoneFiled {
                epoch: input.epoch,
                filing_id,
                who: input.who,
                class: input.class,
                points: input.points,
                evidence_hash: input.evidence_hash,
                bond,
            }),
        }
        Ok(filing_id)
    }

    /// Watchtower acknowledgment (07 §4 quorum rule, inherited by the registry
    /// per 07 §7). `is_registered_watchtower` is resolved by the runtime
    /// against the oracle pallet's bonded watchtower registry — only bonded,
    /// slashable seats may count toward `WT_QUORUM`.
    pub fn ack_observed(
        &mut self,
        who: AccountId,
        now: BlockNumber,
        is_registered_watchtower: bool,
        epoch: EpochId,
        filing_id: FilingId,
    ) -> Result<(), Error> {
        ensure!(is_registered_watchtower, Error::NotRegistered);
        ensure!(
            !self.ack_records.contains(&(epoch, filing_id, who)),
            Error::DuplicateAck
        );
        let filing = self.filing_mut(epoch, filing_id)?;
        match &mut filing.state {
            FilingState::Filed {
                window_end, acks, ..
            } => {
                // Quorum proves observability during the live challenge
                // window; late acknowledgments must not retro-uphold a filing
                // whose challenge surface already closed.
                ensure!(now <= *window_end, Error::WindowClosed);
                // Once quorum is reached, further acks add nothing and only grow
                // the dedup set — reject them so it stays bounded by `WT_QUORUM`
                // per filing (07 §4 needs "≥ quorum", never a running tally).
                ensure!(*acks < WT_QUORUM, Error::AlreadyQuorum);
                *acks = acks.saturating_add(1);
            }
            FilingState::Challenged { .. } => {
                // 07 §4: "a challenge supersedes the quorum requirement … a posted
                // challenge is itself proof that the report was observable." So an
                // acknowledgment is moot once challenged — reject it, rather than
                // recording an unbounded `AckRecord` the `Challenged` state can
                // never cap (which would breach the per-filing `WT_QUORUM` bound
                // `try_state` and `reap_epoch`'s bounded reap assume). PR #54
                // Codex-bot P2.
                return Err(Error::AlreadyChallenged);
            }
            _ => return Err(Error::AlreadyFinal),
        }
        self.ack_records.push((epoch, filing_id, who));
        self.events.push(Event::WindowAcknowledged {
            epoch,
            filing_id,
            watchtower: who,
        });
        Ok(())
    }

    pub fn challenge_filing(
        &mut self,
        who: AccountId,
        now: BlockNumber,
        epoch: EpochId,
        filing_id: FilingId,
        evidence_hash: H256,
    ) -> Result<(), Error> {
        let filing = self.filing_mut(epoch, filing_id)?;
        let window_end = match filing.state {
            FilingState::Filed { window_end, .. } => window_end,
            FilingState::Challenged { .. } => return Err(Error::AlreadyChallenged),
            _ => return Err(Error::AlreadyFinal),
        };
        ensure!(now <= window_end, Error::WindowClosed);
        let bond = filing.bond;
        filing.state = FilingState::Challenged {
            round: 2,
            window_end: now.saturating_add(REG_WINDOW_BLOCKS),
            challenger: who,
            evidence_hash,
        };
        match self.kind {
            RegistryKind::Incident => self.events.push(Event::IncidentChallenged {
                epoch,
                filing_id,
                challenger: who,
                evidence_hash,
                bond,
            }),
            RegistryKind::Milestone => self.events.push(Event::MilestoneChallenged {
                epoch,
                filing_id,
                challenger: who,
                evidence_hash,
                bond,
            }),
        }
        Ok(())
    }

    /// 07 §7 terminal resolution of the single counter-round. The verdict is
    /// discretionary — neither of §7's earlier-stated closure paths is available
    /// to a registry filing (see the terminal-resolution note there) — so the two
    /// constraints below are what keep it from being an unconstrained binary
    /// authority over custodied bonds (R-7).
    ///
    /// `evidence_hash` restates the challenger's committed content hash. It is a
    /// **commitment binding, not a proof**: the registry stores hashes only
    /// (`MaxEvidenceLen = 32`, 02 §9), so no preimage is available to recompute
    /// against. Its job is to bind the verdict to the filing it was authored
    /// about — `(epoch, filing_id)` are two integers, and a mis-parameterised
    /// terminal dispatch would otherwise silently slash the wrong party's bond.
    /// With the binding it fails closed instead (G-1).
    pub fn resolve_challenge(
        &mut self,
        now: BlockNumber,
        epoch: EpochId,
        filing_id: FilingId,
        uphold: bool,
        evidence_hash: H256,
    ) -> Result<(), Error> {
        let (who, challenger, bond) = {
            let f = self.filing_mut(epoch, filing_id)?;
            let (challenger, window_end, committed) = match f.state {
                FilingState::Challenged {
                    challenger,
                    window_end,
                    evidence_hash,
                    ..
                } => (challenger, window_end, evidence_hash),
                // A filing still inside its own challenge window has no
                // counter-round to resolve; a terminal one has already resolved.
                // These were previously conflated as `WindowOpen`.
                FilingState::Filed { .. } => return Err(Error::WindowOpen),
                _ => return Err(Error::AlreadyFinal),
            };
            // Both checks precede every mutation, so a refused verdict leaves the
            // filing exactly as it was.
            ensure!(committed == evidence_hash, Error::EvidenceMismatch);
            ensure!(now > window_end, Error::WindowOpen);
            f.state = if uphold {
                FilingState::Upheld
            } else {
                FilingState::Rejected
            };
            (f.who, challenger, f.bond)
        };
        let loser = if uphold { challenger } else { who };
        self.push_terminal_event(epoch, filing_id, uphold);
        self.push_slash(epoch, filing_id, loser, bond);
        Ok(())
    }

    pub fn crank_close(&mut self, now: BlockNumber, batch: usize) -> Result<(), Error> {
        ensure!(batch <= REG_CLOSE_BATCH, Error::BatchTooLarge);
        let mut processed = 0usize;
        let keys: Vec<(EpochId, FilingId)> = self.filings.iter().map(|(k, _)| *k).collect();
        for (epoch, filing_id) in keys {
            if processed >= batch {
                break;
            }
            let mut terminal: Option<bool> = None;
            let mut extend_to: Option<BlockNumber> = None;
            {
                let f = self.filing_mut(epoch, filing_id)?;
                match &mut f.state {
                    FilingState::Filed {
                        window_end,
                        extended,
                        acks,
                    } => {
                        // The window is INCLUSIVE of `window_end` for acks and
                        // challenges (see `challenge_filing`), so the crank closes
                        // only *strictly after* it — otherwise a valid at-deadline
                        // challenge could be front-run by a same-block crank.
                        if now <= *window_end {
                            continue;
                        }
                        if *acks >= WT_QUORUM {
                            terminal = Some(true);
                        } else if !*extended {
                            *extended = true;
                            // Extend from the ORIGINAL deadline, not the (possibly
                            // much later) crank block, so a keeper delay cannot
                            // stretch the single 48 h extension past the 07 §11
                            // latency budget.
                            let new_end = window_end.saturating_add(REG_EXT_WINDOW_BLOCKS);
                            *window_end = new_end;
                            if now > new_end {
                                // Keeper so late the whole extension already
                                // elapsed: resolve the quorum failure in this same
                                // crank (still one extension total).
                                terminal = Some(false);
                            } else {
                                extend_to = Some(new_end);
                            }
                        } else {
                            terminal = Some(false);
                        }
                    }
                    FilingState::Challenged { window_end, .. } => {
                        let _ = window_end;
                        // A challenged filing waits for `resolve_challenge`
                        // (recompute / OracleResolution verdict, 07 §5.4/§9); the
                        // crank never auto-resolves it.
                        continue;
                    }
                    _ => continue,
                }
            }
            if let Some(new_deadline) = extend_to {
                self.events.push(Event::WindowExtended {
                    epoch,
                    filing_id,
                    new_deadline,
                });
            }
            if let Some(uphold) = terminal {
                self.filing_mut(epoch, filing_id)?.state = if uphold {
                    FilingState::Upheld
                } else {
                    FilingState::Rejected
                };
                self.push_terminal_event(epoch, filing_id, uphold);
            }
            processed += 1;
        }
        Ok(())
    }

    /// Close-out (07 §7): derives the epoch's aggregate exactly once, only
    /// after the filing window has ended and every filing is terminal. The
    /// `FilingCount` entry is reaped here — it exists to allocate ids and
    /// enforce the per-epoch cap during the window, and holding it past
    /// close-out would wedge the ≤ 4-live-epoch bound permanently.
    pub fn close_epoch(
        &mut self,
        epoch: EpochId,
        spec_version: MetricSpecVersion,
        now: BlockNumber,
        filing_window_end: BlockNumber,
        milestone_target: u32,
    ) -> Result<FixedU64, Error> {
        ensure!(now > filing_window_end, Error::WindowOpen);
        ensure!(
            self.aggregates
                .iter()
                .all(|((e, v), _)| !(*e == epoch && *v == spec_version)),
            Error::AlreadyFinal
        );
        // Only **this version's** filings gate the close and enter the fold. A
        // sibling version measuring the same epoch runs an independent track
        // (07 §2(4)/§7): waiting on its filings would let one version's stuck
        // dispute hold the other's welfare input hostage, and folding them
        // together would combine claims governed by different frozen specs.
        ensure!(
            self.filings
                .iter()
                .filter(|((e, _), f)| *e == epoch && f.spec_version == spec_version)
                .all(|(_, f)| matches!(f.state, FilingState::Upheld | FilingState::Rejected)),
            Error::WindowOpen
        );
        let aggregate = match self.kind {
            RegistryKind::Incident => self.incident_aggregate(epoch, spec_version),
            // Refuses on an unset target (07 §7 *Milestone normalization*). The
            // `?` fires before any mutation below, so a refused close leaves the
            // aggregate, the filing count and the filings exactly as they were.
            RegistryKind::Milestone => {
                self.milestone_aggregate(epoch, spec_version, milestone_target)?
            }
        };
        ensure!(
            self.aggregates.len() < MAX_AGGREGATES,
            Error::TooManyAggregates
        );
        self.aggregates.push(((epoch, spec_version), aggregate));
        // Dropping the epoch-wide filing count on the **first** version's close
        // is safe, and the argument is worth stating because the shared counter
        // looks like a hazard: it allocates filing ids and enforces the 64-per-
        // epoch cap, so a reset that let ids restart would collide with retained
        // filings. It cannot happen. `file` requires `now <= filing_window_end`
        // and this call requires `now > filing_window_end`, so **no filing can
        // arrive for this epoch under any version once any version has closed**.
        // The two windows are disjoint by construction, not by convention.
        self.filing_count.retain(|(e, _)| *e != epoch);
        self.events.push(Event::RegistryEpochClosed {
            kind: self.kind,
            epoch,
            spec_version,
            aggregate,
        });
        Ok(aggregate)
    }

    /// Reap a closed epoch's records. 07 §7: closed epochs are reaped at
    /// cohort settlement + archive delay — the caller (welfare/epoch wiring)
    /// enforces that timing; the registry only requires that the epoch was
    /// closed out first.
    pub fn reap_epoch(
        &mut self,
        epoch: EpochId,
        spec_version: MetricSpecVersion,
    ) -> Result<(), Error> {
        ensure!(
            self.aggregates
                .iter()
                .any(|((e, v), _)| *e == epoch && *v == spec_version),
            Error::WindowOpen
        );
        // A version MUST NOT be reaped while a **sibling** version of the same
        // epoch still has records that have not closed. Without this the
        // versioned lifecycle has a hole that did not exist while an epoch
        // closed once, and it opens in both directions at the same time:
        //
        // `close_epoch` drops the epoch-wide `FilingCount` on the first close,
        // so after that the only evidence the epoch was ever filed is its
        // aggregates. Reaping the first version while a second still holds a
        // non-terminal filing — a `Challenged` one awaiting `resolve_challenge`,
        // say — erases that evidence: the second version becomes permanently
        // uncloseable (`NothingToClose`), and welfare's reader, seeing no
        // footprint at all, reads the epoch as "nothing was ever filed" and
        // hands back the favourable neutral 1.0 for a version whose incident
        // filings are still sitting in storage. Ordering the reap closes both.
        //
        // 07 §7's consumption model already requires closed records to outlive
        // every cohort that can consume them; this is that rule applied across
        // sibling versions rather than only across cohorts.
        ensure!(
            self.filings.iter().all(|((e, _), f)| {
                *e != epoch
                    || f.spec_version == spec_version
                    || self
                        .aggregates
                        .iter()
                        .any(|((ae, av), _)| *ae == epoch && *av == f.spec_version)
            }),
            Error::ReapNotDue
        );
        // Acks are keyed `(epoch, filing_id, who)` and carry no version, so they
        // are reaped by resolving each ack's filing first. Collecting the ids
        // before the retain keeps that resolution independent of removal order.
        let reaped: Vec<FilingId> = self
            .filings
            .iter()
            .filter(|((e, _), f)| *e == epoch && f.spec_version == spec_version)
            .map(|((_, id), _)| *id)
            .collect();
        self.filings
            .retain(|((e, _), f)| !(*e == epoch && f.spec_version == spec_version));
        self.ack_records
            .retain(|(e, id, _)| !(*e == epoch && reaped.contains(id)));
        self.aggregates
            .retain(|((e, v), _)| !(*e == epoch && *v == spec_version));
        Ok(())
    }

    pub fn try_state(&self) -> Result<(), Error> {
        ensure!(
            self.filing_count.len() <= MAX_LIVE_EPOCHS,
            Error::TooManyLiveEpochs
        );
        ensure!(
            self.aggregates.len() <= MAX_AGGREGATES,
            Error::TooManyAggregates
        );
        for (epoch, count) in &self.filing_count {
            ensure!(*count <= MAX_FILINGS_PER_EPOCH, Error::EpochFull);
            let actual = self.filings.iter().filter(|((e, _), _)| e == epoch).count() as u32;
            ensure!(actual <= *count, Error::Overflow);
        }
        for ((epoch, _), f) in &self.filings {
            // A filed bond is always positive; it is NOT re-checked against the
            // live `required_bond()`, because a mid-life META amendment of
            // `reg.bond_*` or `orc.bond_bps` (13 §1), or a change in cohort
            // exposure, may raise the requirement above a bond that was valid —
            // and is custodied at its stored amount — when it was filed.
            ensure!(f.bond > 0, Error::BondBelowMinimum);
            self.validate_class(f.class)?;
            // Every retained filing belongs to exactly one lifecycle stage:
            // a live epoch (counted) or a closed epoch awaiting reap
            // (aggregated) - never both, never neither.
            // Before SQ-141 a retained filing was in exactly one of two states —
            // counted-live or aggregated — and `live != closed` said so. The
            // versioned lifecycle adds a **third legitimate state**, because
            // `close_epoch` releases the epoch-wide filing count on the *first*
            // version's close: a sibling version's filings are then neither
            // counted (the count is gone) nor aggregated (that version has not
            // closed). Asserting the old exclusive-or reads that intermediate
            // state as an orphaned filing and fails try-state on a healthy
            // chain.
            //
            // What must still hold is the pair of properties the old assertion
            // was really carrying: a filing is never in two stages at once, and
            // never in none. The third state is recognisable — and bounded —
            // because the epoch must then carry at least one closed version, and
            // the sibling-ordering rule in `reap_epoch` keeps that aggregate
            // alive precisely until this filing's own version closes.
            let live = self.filing_count.iter().any(|(e, _)| e == epoch);
            let closed = self
                .aggregates
                .iter()
                .any(|((e, v), _)| e == epoch && *v == f.spec_version);
            let epoch_partly_closed = self.aggregates.iter().any(|((e, _), _)| e == epoch);
            ensure!(!(live && closed), Error::Overflow);
            ensure!(live || closed || epoch_partly_closed, Error::Overflow);
            if closed {
                ensure!(
                    matches!(f.state, FilingState::Upheld | FilingState::Rejected),
                    Error::WindowOpen
                );
            }
        }
        Ok(())
    }

    /// The stored aggregate for one `(epoch, frozen version)`. `None` means the
    /// version's `close_epoch` has not run, a filing is still non-terminal, or
    /// the caller named a version no cohort froze. **None of those is "no
    /// incidents"** — 07 §7 requires the welfare-side reader to refuse rather
    /// than substitute the favourable neutral value, and this signature exists
    /// so it can.
    pub fn aggregate(&self, epoch: EpochId, spec_version: MetricSpecVersion) -> Option<FixedU64> {
        self.aggregates
            .iter()
            .find(|((e, v), _)| *e == epoch && *v == spec_version)
            .map(|(_, value)| *value)
    }

    fn required_bond(&self, exposure: Option<Balance>) -> Result<Balance, Error> {
        let floor = match self.kind {
            RegistryKind::Incident => self.bond_incident,
            RegistryKind::Milestone => self.bond_milestone,
        };
        let scaled = exposure
            .ok_or(Error::ExposureUnavailable)?
            .checked_mul(self.coverage_bps as Balance)
            .ok_or(Error::Overflow)?
            .div_ceil(10_000);
        Ok(core::cmp::max(floor, scaled))
    }
    fn validate_class(&self, class: FilingClass) -> Result<(), Error> {
        match (self.kind, class) {
            (RegistryKind::Incident, FilingClass::S1 | FilingClass::S2 | FilingClass::S3) => Ok(()),
            (RegistryKind::Milestone, FilingClass::Scope(_)) => Ok(()),
            _ => Err(Error::InvalidClass),
        }
    }
    fn filing_mut(&mut self, epoch: EpochId, filing_id: FilingId) -> Result<&mut Filing, Error> {
        self.filings
            .iter_mut()
            .find(|((e, id), _)| *e == epoch && *id == filing_id)
            .map(|(_, f)| f)
            .ok_or(Error::FilingNotFound)
    }
    fn push_terminal_event(&mut self, epoch: EpochId, filing_id: FilingId, uphold: bool) {
        match (self.kind, uphold) {
            (RegistryKind::Incident, true) => {
                self.events.push(Event::IncidentUpheld { epoch, filing_id })
            }
            (RegistryKind::Incident, false) => self
                .events
                .push(Event::IncidentRejected { epoch, filing_id }),
            (RegistryKind::Milestone, true) => self
                .events
                .push(Event::MilestoneAccepted { epoch, filing_id }),
            (RegistryKind::Milestone, false) => self
                .events
                .push(Event::MilestoneRejected { epoch, filing_id }),
        }
    }
    fn push_slash(
        &mut self,
        epoch: EpochId,
        filing_id: FilingId,
        loser: AccountId,
        amount: Balance,
    ) {
        // 07 §5.5/§7: the loser forfeits the full bond — 40 % to the honest
        // counterparty, the remainder to INSURANCE. INSURANCE takes the exact
        // complement (not a second independent floor) so the split conserves the
        // forfeited bond to the unit and any rounding dust accrues to the
        // protocol, never back to the slashed party (R-7, rounding against the
        // claimant).
        let challenger_share = amount.saturating_mul(40) / 100;
        self.events.push(Event::FilingBondSlashed {
            epoch,
            filing_id,
            loser,
            amount,
            challenger_share,
            insurance_share: amount.saturating_sub(challenger_share),
        });
    }
    fn incident_aggregate(&self, epoch: EpochId, spec_version: MetricSpecVersion) -> FixedU64 {
        let sev: u64 = self
            .filings
            .iter()
            .filter(|((e, _), f)| {
                *e == epoch
                    && f.spec_version == spec_version
                    && matches!(f.state, FilingState::Upheld)
            })
            .map(|(_, f)| match f.class {
                FilingClass::S1 => ONE,
                FilingClass::S2 => 400_000_000,
                FilingClass::S3 => 100_000_000,
                FilingClass::Scope(_) => 0,
            })
            .sum();
        FixedU64(ONE.saturating_sub(sev))
    }
    fn milestone_aggregate(
        &self,
        epoch: EpochId,
        spec_version: MetricSpecVersion,
        milestone_target: u32,
    ) -> Result<FixedU64, Error> {
        let points: u64 = self
            .filings
            .iter()
            .filter(|((e, _), f)| {
                *e == epoch
                    && f.spec_version == spec_version
                    && matches!(f.state, FilingState::Upheld)
            })
            .fold(0u64, |acc, (_, f)| acc.saturating_add(f.points as u64));
        // aggregate = min(points / target, 1) on the 1e9 grid (05 §4.4 / 07 §7).
        // `target` is the frozen-MetricSpec completion target (seam field, I-16),
        // NOT a hardcoded divisor. A zero or absent target is **refused**, never
        // normalized: 07 §7 (*Milestone normalization*) rules that emitting `0`
        // for an unset target is a fail-*adverse* value masquerading as a
        // measurement, so the close refuses and the epoch keeps no aggregate at
        // all (G-1 status quo — welfare then sees no record rather than a
        // fabricated 0.0). The result is clamped to ONE so a cohort that
        // over-ships (or an over-large `points` claim) can never push the A
        // pillar past 1.0 — a welfare component MUST live in [0, 1].
        let target = milestone_target as u64;
        ensure!(target > 0, Error::MilestoneTargetUnset);
        let raw = points.saturating_mul(ONE) / target;
        Ok(FixedU64(raw.min(ONE)))
    }
}

impl Default for Registry {
    fn default() -> Self {
        Self::new(RegistryKind::Incident)
    }
}

#[macro_export]
macro_rules! ensure {
    ($cond:expr, $err:expr $(,)?) => {
        if !$cond {
            return Err($err);
        }
    };
}

#[cfg(feature = "runtime-benchmarks")]
pub mod benchmarking {
    pub fn benchmark_stub() {}
}

#[cfg(test)]
mod tests {
    use super::*;
    fn acct(n: u8) -> AccountId {
        [n; 32]
    }
    fn h(n: u8) -> H256 {
        [n; 32]
    }
    fn file_input(
        kind: RegistryKind,
        who: AccountId,
        epoch: EpochId,
        class: FilingClass,
    ) -> FileInput {
        FileInput {
            who,
            now: 1,
            epoch,
            class,
            points: if kind == RegistryKind::Milestone {
                25
            } else {
                0
            },
            evidence_hash: h(9),
            spec_version: 3,
            frozen_specs: alloc::vec![3],
            milestone_target: MILESTONE_TARGET_POINTS,
            filing_window_end: 10,
            exposure: Some(0),
        }
    }

    #[test]
    fn incident_filings_are_bounded_and_class_checked() {
        let mut r = Registry::new(RegistryKind::Incident);
        assert_eq!(
            r.file(file_input(
                RegistryKind::Incident,
                acct(1),
                7,
                FilingClass::Scope(1)
            )),
            Err(Error::InvalidClass)
        );
        for i in 0..MAX_FILINGS_PER_EPOCH {
            assert_eq!(
                r.file(file_input(
                    RegistryKind::Incident,
                    acct(i as u8),
                    7,
                    FilingClass::S3
                )),
                Ok(i)
            );
        }
        assert_eq!(
            r.file(file_input(
                RegistryKind::Incident,
                acct(99),
                7,
                FilingClass::S3
            )),
            Err(Error::EpochFull)
        );
        assert_eq!(r.try_state(), Ok(()));
    }

    #[test]
    fn filing_enforces_window_and_spec_version() {
        let mut r = Registry::new(RegistryKind::Milestone);
        let mut input = file_input(RegistryKind::Milestone, acct(1), 1, FilingClass::Scope(2));
        input.now = 11;
        assert_eq!(r.file(input.clone()), Err(Error::WindowClosed));
        input.now = 1;
        input.spec_version = 4;
        assert_eq!(r.file(input), Err(Error::SpecVersionMismatch));
    }

    #[test]
    fn unchallenged_filing_needs_quorum_or_rejects_after_extension() {
        let mut r = Registry::new(RegistryKind::Incident);
        let id = r
            .file(file_input(
                RegistryKind::Incident,
                acct(1),
                5,
                FilingClass::S2,
            ))
            .unwrap();
        r.ack_observed(acct(2), 5, true, 5, id).unwrap();
        r.crank_close(REG_WINDOW_BLOCKS + 2, REG_CLOSE_BATCH)
            .unwrap();
        assert!(matches!(
            r.filings[0].1.state,
            FilingState::Filed { extended: true, .. }
        ));
        r.crank_close(
            REG_WINDOW_BLOCKS + REG_EXT_WINDOW_BLOCKS + 3,
            REG_CLOSE_BATCH,
        )
        .unwrap();
        assert!(matches!(r.filings[0].1.state, FilingState::Rejected));
        assert!(r
            .events
            .iter()
            .any(|e| matches!(e, Event::IncidentRejected { .. })));
    }

    #[test]
    fn quorum_upholds_and_incident_aggregate_is_claimant_adverse() {
        let mut r = Registry::new(RegistryKind::Incident);
        let id = r
            .file(file_input(
                RegistryKind::Incident,
                acct(1),
                5,
                FilingClass::S2,
            ))
            .unwrap();
        r.ack_observed(acct(2), 5, true, 5, id).unwrap();
        r.ack_observed(acct(3), 6, true, 5, id).unwrap();
        r.crank_close(REG_WINDOW_BLOCKS + 2, REG_CLOSE_BATCH)
            .unwrap();
        assert!(matches!(r.filings[0].1.state, FilingState::Upheld));
        assert_eq!(
            r.close_epoch(5, 3, REG_WINDOW_BLOCKS + 3, 10, MILESTONE_TARGET_POINTS),
            Ok(FixedU64(600_000_000))
        );
    }

    #[test]
    fn challenge_has_one_counter_round_and_slashes_loser() {
        let mut r = Registry::new(RegistryKind::Milestone);
        let id = r
            .file(file_input(
                RegistryKind::Milestone,
                acct(1),
                9,
                FilingClass::Scope(1),
            ))
            .unwrap();
        r.challenge_filing(acct(4), 2, 9, id, h(7)).unwrap();
        assert_eq!(
            r.challenge_filing(acct(5), 3, 9, id, h(8)),
            Err(Error::AlreadyChallenged)
        );
        // The counter-round window opened at block 2, so the verdict is admissible
        // only strictly after it, and only against the committed evidence hash.
        let after_counter_round = 2 + REG_WINDOW_BLOCKS + 1;
        assert_eq!(
            r.resolve_challenge(2, 9, id, false, h(7)),
            Err(Error::WindowOpen)
        );
        assert_eq!(
            r.resolve_challenge(after_counter_round, 9, id, false, h(8)),
            Err(Error::EvidenceMismatch)
        );
        r.resolve_challenge(after_counter_round, 9, id, false, h(7))
            .unwrap();
        assert!(matches!(r.filings[0].1.state, FilingState::Rejected));
        assert!(r
            .events
            .iter()
            .any(|e| matches!(e, Event::MilestoneRejected { .. })));
        assert!(r.events.iter().any(|e| matches!(e, Event::FilingBondSlashed { amount: REG_BOND_MILESTONE, challenger_share, insurance_share, .. } if *challenger_share == REG_BOND_MILESTONE * 40 / 100 && *insurance_share == REG_BOND_MILESTONE * 60 / 100)));
    }

    #[test]
    fn acks_require_registered_watchtowers_and_a_live_window() {
        // Codex review, PR #20: two arbitrary accounts must not satisfy the
        // bonded watchtower quorum of 07 §4/§7.
        let mut r = Registry::new(RegistryKind::Incident);
        let id = r
            .file(file_input(
                RegistryKind::Incident,
                acct(1),
                5,
                FilingClass::S2,
            ))
            .unwrap();
        assert_eq!(
            r.ack_observed(acct(2), 5, false, 5, id),
            Err(Error::NotRegistered)
        );
        assert_eq!(
            r.ack_observed(acct(3), 5, false, 5, id),
            Err(Error::NotRegistered)
        );
        // Late acknowledgments past the live window are rejected too.
        assert_eq!(
            r.ack_observed(acct(4), REG_WINDOW_BLOCKS + 2, true, 5, id),
            Err(Error::WindowClosed)
        );
        // With no countable acks the filing extends, then rejects.
        r.crank_close(REG_WINDOW_BLOCKS + 2, REG_CLOSE_BATCH)
            .unwrap();
        assert!(matches!(
            r.filings[0].1.state,
            FilingState::Filed { extended: true, .. }
        ));
        r.crank_close(
            REG_WINDOW_BLOCKS + REG_EXT_WINDOW_BLOCKS + 3,
            REG_CLOSE_BATCH,
        )
        .unwrap();
        assert!(matches!(r.filings[0].1.state, FilingState::Rejected));
        r.try_state().unwrap();
    }

    #[test]
    fn close_epoch_waits_for_the_filing_window_and_is_terminal() {
        // Codex review, PR #20: an empty epoch must not close (recording the
        // "no filings => 1" aggregate) while its filing window is still open.
        let mut r = Registry::new(RegistryKind::Incident);
        assert_eq!(
            r.close_epoch(7, 3, 5, 10, MILESTONE_TARGET_POINTS),
            Err(Error::WindowOpen)
        );
        assert_eq!(
            r.close_epoch(7, 3, 11, 10, MILESTONE_TARGET_POINTS),
            Ok(FixedU64(ONE))
        );
        assert_eq!(
            r.close_epoch(7, 3, 12, 10, MILESTONE_TARGET_POINTS),
            Err(Error::AlreadyFinal)
        );
        // A late filing for the closed epoch is rejected even inside an
        // apparently open window.
        let mut input = file_input(RegistryKind::Incident, acct(1), 7, FilingClass::S3);
        input.now = 5;
        assert_eq!(r.file(input), Err(Error::AlreadyFinal));
        r.try_state().unwrap();
    }

    #[test]
    fn closed_epochs_free_the_live_epoch_cap_and_reap_frees_aggregates() {
        // Codex review, PR #20: after MAX_LIVE_EPOCHS distinct epochs have
        // ever filed, new epochs must still be admissible once the old ones
        // closed out.
        let mut r = Registry::new(RegistryKind::Incident);
        for epoch in 1..=(MAX_LIVE_EPOCHS as EpochId) {
            r.file(file_input(
                RegistryKind::Incident,
                acct(epoch as u8),
                epoch,
                FilingClass::S3,
            ))
            .unwrap();
        }
        assert_eq!(
            r.file(file_input(
                RegistryKind::Incident,
                acct(9),
                99,
                FilingClass::S3
            )),
            Err(Error::TooManyLiveEpochs)
        );
        // Resolve and close epoch 1; its filing_count slot must free up.
        r.challenge_filing(acct(8), 2, 1, 0, h(7)).unwrap();
        let after_counter_round = 2 + REG_WINDOW_BLOCKS + 1;
        r.resolve_challenge(after_counter_round, 1, 0, true, h(7))
            .unwrap();
        r.close_epoch(1, 3, after_counter_round + 1, 10, MILESTONE_TARGET_POINTS)
            .unwrap();
        let id = r
            .file(file_input(
                RegistryKind::Incident,
                acct(9),
                99,
                FilingClass::S3,
            ))
            .unwrap();
        assert_eq!(id, 0);
        r.try_state().unwrap();
        // Reaping (cohort settlement + archive delay, enforced by the caller)
        // releases the aggregate slot and the archived filings.
        assert_eq!(r.reap_epoch(2, 3), Err(Error::WindowOpen));
        r.reap_epoch(1, 3).unwrap();
        assert_eq!(r.aggregate(1, 3), None);
        assert!(r.filings.iter().all(|((e, _), _)| *e != 1));
        r.try_state().unwrap();
    }

    #[test]
    fn close_epoch_requires_terminal_filings_and_computes_milestones() {
        let mut r = Registry::new(RegistryKind::Milestone);
        let id = r
            .file(file_input(
                RegistryKind::Milestone,
                acct(1),
                3,
                FilingClass::Scope(1),
            ))
            .unwrap();
        assert_eq!(
            r.close_epoch(3, 3, 2, 10, MILESTONE_TARGET_POINTS),
            Err(Error::WindowOpen)
        );
        r.ack_observed(acct(2), 5, true, 3, id).unwrap();
        r.ack_observed(acct(3), 6, true, 3, id).unwrap();
        r.crank_close(REG_WINDOW_BLOCKS + 2, REG_CLOSE_BATCH)
            .unwrap();
        assert_eq!(
            r.close_epoch(3, 3, REG_WINDOW_BLOCKS + 3, 10, MILESTONE_TARGET_POINTS),
            Ok(FixedU64(250_000_000))
        );
        assert_eq!(r.aggregate(3, 3), Some(FixedU64(250_000_000)));
    }

    #[test]
    fn a_zero_milestone_target_refuses_the_close_instead_of_recording_zero() {
        // 07 §7 *Milestone normalization* (SQ-291): a zero/absent frozen-MetricSpec
        // `target` MUST NOT be normalized to an aggregate of 0 — that is a
        // fail-*adverse* A-pillar component masquerading as a real measurement.
        // The close refuses and the epoch keeps NO aggregate (G-1 status quo).
        let mut r = Registry::new(RegistryKind::Milestone);
        let id = r
            .file(file_input(
                RegistryKind::Milestone,
                acct(1),
                3,
                FilingClass::Scope(1),
            ))
            .unwrap();
        r.ack_observed(acct(2), 5, true, 3, id).unwrap();
        r.ack_observed(acct(3), 6, true, 3, id).unwrap();
        r.crank_close(REG_WINDOW_BLOCKS + 2, REG_CLOSE_BATCH)
            .unwrap();
        // The frozen spec is re-read on every load, so a target that goes unset
        // between filing and close is the exact regression this pins. Since
        // SQ-141 the target arrives per call, keyed to the version being closed.
        assert_eq!(
            r.close_epoch(3, 3, REG_WINDOW_BLOCKS + 3, 10, 0),
            Err(Error::MilestoneTargetUnset)
        );
        // Status quo: no aggregate, and the pre-close bookkeeping is untouched.
        assert_eq!(r.aggregate(3, 3), None);
        assert!(r.filing_count.iter().any(|(e, c)| *e == 3 && *c == 1));
        assert!(r.filings.iter().any(|((e, _), _)| *e == 3));
        r.try_state().unwrap();
        // Restoring a positive target closes normally — the refusal is not terminal.
        assert_eq!(
            r.close_epoch(3, 3, REG_WINDOW_BLOCKS + 3, 10, MILESTONE_TARGET_POINTS),
            Ok(FixedU64(250_000_000))
        );
    }

    #[test]
    fn a_zero_milestone_target_refuses_the_filing_at_the_door() {
        // 07 §7 *Milestone normalization*: "until the MetricSpec surface carries
        // the field no milestone component may be admitted". Admitting a filing
        // whose epoch can never close would escrow a bond into an epoch that
        // holds its `FilingCount` slot forever (close refuses ⇒ no reap), wedging
        // the instance at `MAX_LIVE_EPOCHS`.
        let mut r = Registry::new(RegistryKind::Milestone);
        assert_eq!(
            r.file(FileInput {
                milestone_target: 0,
                ..file_input(RegistryKind::Milestone, acct(1), 3, FilingClass::Scope(1))
            }),
            Err(Error::MilestoneTargetUnset)
        );
        assert!(r.filings.is_empty());
        assert!(r.filing_count.is_empty());
        assert!(r.events.is_empty());
        // The Incident instance never divides by a target and is unaffected.
        let mut incident = Registry::new(RegistryKind::Incident);
        assert!(incident
            .file(FileInput {
                milestone_target: 0,
                ..file_input(RegistryKind::Incident, acct(1), 3, FilingClass::S2)
            })
            .is_ok());
    }
}
