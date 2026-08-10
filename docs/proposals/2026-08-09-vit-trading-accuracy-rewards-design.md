# VIT trading accuracy rewards — design

Date: 2026-08-09
Status: **design approved, not implemented.** No milestone row exists yet.
Revision: **round 3.** Round 2 answered the PR #296 Codex review — four P1 findings and one
P2, accepted in full, one of which showed a round-1 claim to be wrong rather than merely
incomplete. Round 3 writes in the owner's three decisions of 2026-08-10 (§10) and corrects
the wash break-even those decisions made load-bearing (§5.1). What each round changed is
recorded where it changed, not in a separate changelog.
Owner decision record: this document. Normative text stays in `docs/architecture/`.

## 1. Scope

Bootstrap early trading on Bleavit by paying VIT for **realized forecast accuracy**, funded
from the existing Phase 3–4 incentive allocation.

This document is a plan. It is not normative. Section 7 lists the `docs/architecture/`
changes the implementation must make under rule R-1.

## 2. Funding source: the incentive pot, never new issuance

Doc [08](../architecture/08-treasury-and-economics.md) §2.1 already assigns the 10 %
Phase 3–4 allocation this exact job — *"Trading/keeper/reporter bootstrap incentives"*. That
is **100,000,000 VIT**, minted at genesis and held in the keyless pot
`PalletId(*b"bl/trsry").into_sub_account_truncating(b"incentiv")`
(`runtime/bleavit-runtime/src/genesis.rs:130`).

The allocation has no delivery mechanism. The community pot received
`create_community_schedule` at milestone B20. The incentive pot received nothing, and no call
in the repository spends from it.

**New issuance is the wrong instrument, for three reasons.**

1. The pot already holds the money. Minting adds supply to pay a bill a funded account pays.
2. `issue_vit` cannot pay a trader. `vit_issuance_allowed` admits only `Rewards` and the ten
   `Ops*` lines (`crates/futarchy-treasury-core/src/lib.rs:152`), and those are budget lines
   rather than accounts. A claim path is needed either way.
3. `iss.inflation_cap` is amendable **down only**. Spending it on a bootstrap program burns a
   one-way resource kept for cases with no funded alternative.

Budget is not the binding constraint. At the [13](../architecture/13-parameters.md) §1
placeholder of 0.05 USDC/VIT the pot is worth about **5,000,000 USDC**, against a
`phase3.tvl_cap` of **2,000,000 USDC**. Targeting is the hard part.

## 3. The problem this design exists to solve

A reward paid only to correct traders is farmable, and the arithmetic is not close.

Two accounts under one operator. A buys 1,000 YES, B buys 1,000 NO, both near 0.50. Neither
needs to know the outcome.

| Leg | Amount |
|---|---|
| Trade fees, `mkt.fee` 30 bps on 1,000 USDC notional | −3 USDC |
| Redemption fee, `ledger.redeem_fee` 30 bps on the 1,000 USDC payout | −3 USDC |
| Realized profit on the winning account | +500 USDC |
| Realized loss on the losing account | −500 USDC |
| **Net cost of manufacturing a 500 USDC "correct forecast"** | **≈ 6 USDC** |

A reward of `r` times profit pays `r × 500`, so break-even sits near **r ≈ 1.2 %** at this
mid price. **The worst case is tighter and it is the one that binds** — at an extreme price
the winner's profit approaches the whole notional instead of half of it, which halves the
break-even to about **0.606 %**. §5.1 derives that figure and sizes the adopted rate against
it. The LMSR spread raises both thresholds, so each is a floor rather than the line.

The cause is structural. The market payoff is symmetric, and that symmetry is what makes it a
proper scoring rule. A bonus on the winning side alone removes the loss half, and the farmer
supplies the loss half from an account they also own. `phase3.dep_cap` of 20,000 USDC per
account makes splitting across accounts ordinary Phase-3 behavior, so the infrastructure for
the attack already exists.

**Why accuracy is nonetheless the right target.** Settlement follows the oracle's reading of
the real outcome, not the market price. An attacker who moves a decision price therefore
holds a position that loses at settlement, forfeits bond, and collects nothing. Every other
reward shape considered pays the manipulator alongside everyone else. This one charges them
twice, and the extra open interest the program attracts is real capital an attacker must
overcome, so [08](../architecture/08-treasury-and-economics.md) §5.2's `L̂` rises honestly.

## 4. The mechanism

### 4.1 Where it lives

A new `pallet-trading-rewards` owns enrollment, bonds, scores and claims. `pallet-market`
calls it through a loosely-coupled trait on each fill. `pallet-futarchy-treasury` keeps
custody authority over the incentive pot, as it does for the community pot.

**Audit scope A is not opened.** The conditional ledger is not touched, and no hook is added
where [03](../architecture/03-conditional-ledger.md) §10 says there is none.

### 4.2 Funding a program epoch

Governance authorizes one epoch budget at a time through a bounded PARAM-origin treasury
call, mirroring `create_community_schedule`.

- The source is the genesis `incentiv` pot and its stored remaining allocation.
- The call transfers VIT to the rewards pallet's own sovereign account.
- Unspent budget sweeps back to the pot at epoch close, so the pallet never accumulates.
- A lifetime authorization count bounds the call, as the 4,096 community bound does.

The per-epoch budget is a call argument rather than a registry row, so it adds no parameter.

### 4.3 Enrollment and the bond

| Call | Origin | Effect |
|---|---|---|
| `enroll(bond)` | Signed | Holds `bond` USDC and opens a participant record |
| `top_up_bond(amount)` | Signed | Increases the hold. The earning cap moves only at the next epoch |
| `withdraw_bond()` | Signed | Releases the hold once every epoch the account participated in has settled |

"Program epoch" throughout this document means the protocol epoch of `epoch.length`, which
is 302,400 blocks at the genesis registry. The design adds no separate clock.

**The earning bond is snapshotted, and the snapshot is what a debit takes from.** Two
findings from the first review make this load-bearing rather than tidy.

- Folding deletes the last score entry, but reward and debit settle at epoch close. A
  participant who folded a losing epoch could satisfy a fold-based withdrawal gate and
  release the whole bond before the debit ran. `withdraw_bond` is therefore gated on **epoch
  settlement**, not on folding.
- `top_up_bond` raising the cap immediately would let a wash operator wait until the outcome
  is known, enlarge only the winning account's cap, and leave the loser at the minimum. A
  top-up therefore takes effect from the **next** epoch.

An epoch's cap is fixed by the bond held when the epoch opened, and that amount stays held
until the epoch settles. No caller-visible action inside an epoch can change either side.

The bond does two separate jobs, and separating them removes a parameter.

- **The earning cap does the anti-farm work.** Rewardable score is clamped to `± bond / r`,
  so a wash pair's forfeit always covers its reward.
- **The minimum bond only prevents state bloat.** `ledger.pos_dep` already does that job at
  0.1 USDC, so the design reuses the live row instead of adding one.

The bond is denominated in **USDC**, not VIT. SQ-560 records that the only externally
signable VIT at genesis is the founding and ops allocation, so a VIT bond would restrict the
program to insiders. Traders already hold USDC, because they need it to trade at all.

### 4.4 The score

Per enrolled account, per market, `pallet-market` accumulates two unsigned counters and the
net branch position. Unsigned counters keep signed arithmetic out of runtime code and make
claimant-adverse rounding straightforward.

1. On a buy, add `cost + fee` to `spent`, rounded up, and add the filled quantity to
   `book_acquired` for that branch.
2. On a sell, add proceeds to `received`, rounded down, **but only for the part of the sale
   covered by `book_acquired`**, and decrement `book_acquired` by that quantity. Proceeds
   beyond it are ignored.
3. At settlement, add `min(position, book_acquired) × settled_value` to `received`, rounded
   down. Here `settled_value` is the branch's terminal redemption value per unit, which the
   book already resolves to when it settles.
4. The market score is `received − spent`, and it may be negative.

**Why `book_acquired` exists, and why the first draft was wrong.** That draft recorded
acquisition cost only on a book buy and called off-book inventory an out-of-scope limit. It
is not a limit, it is a hole. The ledger has five `split*` calls and a signed `transfer`
(`pallets/conditional-ledger/src/lib.rs:728`, `:834`), so an enrolled account can receive a
complete branch set created outside the book, sell every leg, and post the whole proceeds to
`received` against a `spent` of zero. That manufactures a positive score with no forecast in
it and no dependence on the outcome.

Counting only book-acquired units closes it without leaving `pallet-market`. Units that
arrive by split or transfer carry no credit, so selling them scores nothing. The direction of
error is conservative: a genuine trader who funds a position off-book is under-credited
rather than over-credited, which is the R-7 direction.

**Folding is pull-based.** A permissionless `settle_market_score(who, market)` folds one
settled market into the account's epoch total and deletes the entry. No hook iterates a
collection. The keeper already cranks permissionless extrinsics
(`keeper/bleavit-keeper`).

### 4.5 Reward and debit

At epoch close, per participant, over their folded markets:

```
net     = epoch_received − epoch_spent               // USDC
cap     = snapshot_bond / (r × RATE_HEADROOM)        // USDC
scored  = clamp(net, −cap, +cap)                     // USDC

scored > 0  →  accrue  r × scored  USDC-denominated, paid in VIT at claim
scored < 0  →  debit   r × |scored|  USDC from the snapshot bond
```

**Both legs are computed in USDC, and only the payout converts.** The first draft accrued
`r × scored` "in VIT" while debiting the same number in USDC, so the neutrality argument
compared two different units. At the 0.05 USDC/VIT placeholder that made the reward worth a
twentieth of the matching debit, and — the part that matters — it made the anti-farm
invariant **depend on the VIT price**, which is exactly the reflexivity doc 08 §2.2 and D-18
keep out of every sizing formula.

The fix has two halves:

- The score, the cap and the debit are all USDC. Conversion to VIT happens once, at
  `claim_rewards`, using the live `fee.vit_usdc_rate` with rounding against the claimant.
- `RATE_HEADROOM` is the top of that key's `[0.1×, 10×]` envelope. Sizing the cap against the
  **most** favourable rate the envelope admits means the snapshot bond covers the reward even
  if VIT reprices to the ceiling before the claim lands. The cost is a conservative cap. The
  alternative is an invariant that a governed price can open.

- When accruals exceed the authorized budget, **both legs scale by the same factor**. A
  scaled reward against an unscaled debit would over-punish, and a pro-rata reward with no
  fixed rate would let one pair in a thin epoch take the whole budget against a fixed small
  forfeit. Scaling both keeps a wash pair neutral at every budget level.
- A debit never drives the bond below zero. It suspends the participant until they top up.
- Forfeited USDC goes to `INSURANCE`, doc 13's standing destination for USDC taken from an
  account.
- `claim_rewards()` transfers accrued VIT with no vesting. The epoch lag of up to 21 days is
  already a real holding period, and the bond already selects for committed participants.

### 4.6 Accepted costs

1. **Every trade pays one extra storage read**, including trades by accounts that never
   enroll. The market pallet must check enrollment before it can skip the accumulator. This
   enters the trade weight and must be benchmarked there.
2. **Off-book inventory earns nothing**, per the `book_acquired` rule of §4.4. A trader who
   funds a position by `split` and sells it through the book is under-credited. That is a
   real cost, and it is the safe direction.
3. **The earning cap is conservative by the width of the rate envelope**, per §4.5. Sizing
   against the top of `fee.vit_usdc_rate`'s `[0.1×, 10×]` band means a participant at the
   placeholder rate can earn on less score than their bond would otherwise support.

### 4.7 The client surface (owner decision, 2026-08-10)

**The program is visible in the canonical client at mainnet launch**, showing program status,
rate, bond, score and reward status. That decision changes the shape of this work, and the
change is worth stating before the detail: an earlier revision scoped the screen out
precisely so that 02 would not move. It moves now.

| The screen shows | Read from | New frozen surface? |
|---|---|---|
| Rate | `rwd.rate` through the existing `params()` runtime API | **No.** 02 §3 already freezes it |
| Program status — is a budget authorized, how much of it remains | New `pallet-trading-rewards` storage | Yes |
| Bond — held amount, this epoch's snapshot cap | New storage, per account | Yes |
| Score — folded epoch total, unfolded per-market entries | New storage, per account | Yes |
| Reward status — accrued, claimable, last epoch settled | New storage, per account | Yes |

Four consequences follow, and none of them is optional.

1. **`INTEGRATION_CONTRACT_VERSION` goes from 30 to 31**, per 02 §13. The additions are
   append-only, which is what §13 requires of them.
2. **The reads join 02 §7 as their own subsection**, alongside §7.1–§7.6. `params()` carries
   the rate, so only the four pallet-owned rows are new.
3. **They join the 10 §5.2 compatibility lattice automatically**, because that classifier
   probes the frozen set. This is the reason to freeze them rather than read them informally:
   an unfrozen read is one the lattice cannot fail on, so a runtime upgrade that moved it
   would leave the client reporting `full` while the panel silently broke.
4. **`check-client-surface-obligations.py` binds the other direction.** Once docs 10 and 11
   mandate these reads, the gate fails until 02 freezes them. Writing the workflow before the
   contract surface is what turns that gate red.

**The screen must render the closed states, not only the running one.** Mainnet launches at
Phase 3 with sudo present, while the pot is a Phase 3–4 program whose budget governance
authorizes separately. So at launch the honest states are *enrolled but no budget authorized*
and *budget authorized, epoch not yet settled*, and the panel has to say which it is rather
than render an empty reward figure that reads as zero earned.

## 5. Parameters and bounds

### 5.1 Exactly one new registry row

| Candidate | Verdict |
|---|---|
| `rwd.rate` — reward per unit of net profit, **0.25 %** | **New row required.** `mkt.fee` is the nearest existing key, but it charges notional rather than sharing realized profit. Binding them would make a fee amendment silently move the reward |
| Minimum bond | **No row.** Reuse `ledger.pos_dep` |
| Per-epoch budget | **No row.** A call argument on the authorization |

**`rwd.rate` is adopted at 0.25 % (owner decision, 2026-08-10).** An earlier revision shipped
it `[VERIFY]` and fail-closed for want of an anchor. The value now has one, and it is the
wash arithmetic of §3 rather than a calibration.

**Derivation.** A wash pair's reward must stay below the fees it pays to manufacture the
profit. Writing `f` for the per-leg fee rate and taking the worst case — an extreme price,
where the winning leg's profit approaches the whole notional `q` rather than half of it —
the pair collects `r × 0.99q` against fees of `2fq`, so the break-even is:

```
r_breakeven = 2f / 0.99
```

At the registry defaults (`mkt.fee` 30 bps, `ledger.redeem_fee` 30 bps) that is **0.606 %**.
The adopted 0.25 % sits **2.4× inside it**, so the farm loses money on fees alone before the
bond is consulted.

**§3's 1.2 % was the mid-price case and is corrected here.** At `p = 0.5` the winner's profit
is only half the notional, which halves the reward and doubles the apparent break-even. The
worst case is the one a rate must clear, and it is 0.606 %.

**Two independent defenses, and the second one has a boundary.** The bond is
rate-independent and holds at any `r`. The rate defense holds only while the fee is at or
above `r × 0.99 / 2` = **12.375 bps** per leg. `mkt.fee` is PARAM-amendable down to **5 bps**
(13 §1), where the break-even falls to about 0.10 % and 0.25 % becomes farmable on rate
alone. Nothing breaks — the bond still covers it — but a fee amendment silently retires a
defense this document relies on, which is the shape doc 13 rule 7 screens at the amendment
boundary for `ledger.redeem_fee ≤ mkt.fee`. Whether `rwd.rate ≤ 2 × mkt.fee / 0.99` should be
screened the same way is §10's open question.

The unsafe direction is upward, so the ceiling stays conservative and max-Δ stays at ×2.

**The row is seeded at genesis, so enrollment works from the start.** Payouts still need a
second key: governance must authorize an epoch budget (§4.2) before anything accrues to a
claim. That authorization is also the natural phase gate, since the pot is Phase 3–4 and
governance simply does not fund it earlier.

### 5.2 New bounds, both derived

| Bound | Value | Derivation |
|---|---|---|
| `MaxParticipants` | 4,096 | The sibling allocation pot's lifetime bound for community schedules |
| Score-entry absolute timeout | above the longest lawful settlement horizon | §6's escape — it must be unreachable by any settling market |
| `MaxScoredMarketsPerAccount` | 196 | `MaxLiveMarkets` — the count of books that can be open at once, which is what an unfolded score row tracks |

**`MaxPositionsPerAccount` was the wrong anchor and the first draft used it.** That bound
counts simultaneous nonzero ledger entries. A score row lives from the first fill until the
fold, so a trader who sells out of a market frees the ledger slot while the score row stays.
Sequentially trading more than 64 markets across the settlement lag would then hit a bound
derived from a quantity it does not measure. `MaxLiveMarkets` counts the right thing.

**Overflow behavior is specified rather than left to the bound.** A fill in a market beyond
the cap **records no score and never rejects the trade**. Refusing a lawful trade to protect
a rewards-program bound is the wrong direction under G-1, and silence about which of the two
happens is how a bound becomes a liveness bug.

## 6. Failure behavior (G-1, R-7)

- Rate unset — `enroll` fails closed with a typed error, before any hold.
- Budget exhausted — both legs scale, so nothing strands and the pot never overdraws.
- Debit above the bond — take the whole bond, suspend the participant, never go negative.
- Arithmetic edge — no-op, status quo.
- **A market that never settles must not lock a bond forever, and the first draft's escape
  was circular.** It anchored to `ledger.archive`, but doc 03 §5.4 admits the archive sweep
  only once the vault is **terminal** and `RedemptionArchiveDelay` has elapsed
  (`docs/architecture/03-conditional-ledger.md:370`). A market that never settles never
  becomes terminal, so the escape could never fire in exactly the case it existed for, and
  the participant's USDC stayed locked indefinitely.

  The escape is therefore an **absolute block-height timeout measured from the score entry's
  creation**, independent of the market's state. On expiry the entry drops at zero and stops
  blocking withdrawal. Two properties make dropping-at-zero safe rather than an exit from a
  live debit: the timeout is sized above the longest lawful settlement horizon, so no
  settling market can reach it, and settlement is oracle-driven, so no participant can push a
  market past it. The timeout is a 13 §4 bound derived from that horizon, not a new §1 row.

## 7. Spec changes the implementation must make

| Document | Change |
|---|---|
| 08 §2.1 | The incentive-pot row gains a delivery mechanism, as the community row has |
| 08 (new subsection) | Funding call, score definition, bond, rate, forfeit to `INSURANCE` |
| 05 §4a | New family key `0x0D`, singleton — the `0x0C` argument applies unchanged, since the call mutates one remaining-allocation pool |
| 06 §3, §5 | SafetyFilter authority rows, plus the PARAM-leaf exception note §5 already makes for the community call |
| 13 §1, §4 | `rwd.rate` at 0.25 %, seeded in `genesis_params()`, plus the three bounds |
| 14 | A threat row for the wash farm and its bond mitigation |
| 15 | The verification obligations of section 8 |
| `tools/limit-coverage/registry.toml` | Classify `rwd.rate`, with a marked test if it gates a dispatch |
| **02 §7 (new subsection), §13** | The four frozen client reads of §4.7, and `INTEGRATION_CONTRACT_VERSION` **30 → 31** |
| **10** | The panel in the client architecture, and its place in the §5.2 compatibility lattice |
| **11** | The workflow: enroll, top up, claim, and how each closed state renders |

**02 changes, and the order of the edits matters.** Freeze the §7 reads and bump §13 in the
same pass that adds the docs 10 and 11 text. `check-client-surface-obligations.py` fails on
any read those documents mandate that 02 has not frozen, so writing the workflow first turns
the gate red for as long as the two halves are apart.

Per R-1, a 02 edit needs the joint backend-and-frontend sign-off that 02 §13 mandates. The
owner speaks for both sides and has delegated the call, so this is recorded rather than
blocked — but the record belongs in PLAN.md's Decision log when the edit lands, not here.

## 8. Verification obligations

- Mock-runtime tests per call: error paths, origin misuse, wrapper-filter negatives.
- **The anti-farm property suite**, at the ≥ 10⁶ case level in `property-gates.sh`: for any
  set of accounts holding offsetting positions, total payout minus total forfeit is ≤ 0,
  **evaluated in USDC at every rate the `fee.vit_usdc_rate` envelope admits**. The whole
  design rests on this invariant, so it gets a proptest shard rather than unit tests.
- **A regression test per finding of the first review round**, because each was a way the
  invariant above could read as satisfied while failing:
  - selling a `split`-acquired or transferred-in set scores zero;
  - a fold followed by `withdraw_bond` cannot escape that epoch's debit;
  - a `top_up_bond` after settlement does not raise the current epoch's cap;
  - a score entry whose market never settles releases the bond on the absolute timeout.
- `try-state`: held bonds equal the pallet's USDC holdings, accruals never exceed the
  authorized budget, no bond below `ledger.pos_dep`, no score entry for a reaped market, and
  every unsettled epoch's snapshot cap is backed by a still-held bond.
- A reference-model module mirroring the score arithmetic, plus differential vectors.
- Benchmarks for every call **and for the per-fill trait call**, because that one enters every
  trade's weight.
- **A rate-derivation test that fails if the margin closes.** The 0.25 % adoption rests on
  `2 × mkt.fee / 0.99`, so a test asserts the live relation rather than the literal, and turns
  red if a `mkt.fee` amendment carries the pair past it. That is the cheapest available
  substitute for the amendment-boundary screen §10 asks about.
- **The `app/` gates**, which bind now that §4.7 puts a panel in the client. The catalogue is
  `.claude/rules/app-code.md` · *Quality gates for `app/`*, and it is not restated here
  because it grows with the track. Three obligations are specific to this work: the panel
  registers in `implementedScreens()`, the four reads are covered by `test:mock-runtime`, and
  the closed states of §4.7 each get a screen test — a panel that can only render its happy
  path is one nothing has exercised.

## 9. Out of scope for v1

- No vesting on rewards.
- No tournament pool where forfeits fund winners. Ruled out by the owner on 2026-08-10 rather
  than merely deferred, so the note below records a closed decision.
- No cross-epoch score carry.

## 10. Decisions taken

All three questions this document opened were decided by the owner on 2026-08-10.

| Question | Decision |
|---|---|
| `rwd.rate` | **0.25 %**, seeded at genesis. Derivation and its boundary: §5.1 |
| Forfeited bonds | **`INSURANCE`**, not the winners. Doc 13's standing destination for USDC taken from an account, and it keeps a payout independent of the field |
| Client surface | **Visible at mainnet launch**, showing status, rate, bond, score and reward status. Contract v30 → v31: §4.7 |
| The §11 coupling | **Screened at the amendment boundary** (option 1), so the relation is an invariant rather than a documented hope |

## 11. The rate coupling is screened (owner decision, 2026-08-10)

`rwd.rate ≤ 2 × mkt.fee / 0.99` becomes **doc 13 rule 7's third live coupling**, joining
`gate.v_min ↔ dec.v_min` and `ledger.redeem_fee ≤ mkt.fee`. It takes the identical shape: the
relation is the standing invariant, it is enforced **jointly over the pair at the amendment
boundary** — so an amendment of *either* key that would carry the pair outside it is refused
rather than left for a consumer to reconcile — and it is asserted in `try-state`.

**Why it binds at the boundary rather than at the consumer.** §5.1 shows the rate defense
lapsing below 12.375 bps per leg while `mkt.fee` stays PARAM-amendable to 5 bps. The consumer
of a bad pair is an accrual that has already happened, and there is no admissible way to fail
closed on it without stranding a claimant — the same argument `ledger.redeem_fee` makes. So
the only safe place to refuse is before the value is stored.

**Screened in exact integer arithmetic, with no division:**

```
99 × rwd.rate_ppb  ≤  200 × mkt.fee_ppb
```

At the adopted pair that is `247,500,000 ≤ 600,000,000`, which holds with room. At
`mkt.fee`'s 5 bps floor it is `247,500,000 ≤ 100,000,000`, which fails — and failing there is
the entire point.

**One structural consequence.** `mkt.fee` now sits in **two** couplings, so an amendment of it
passes two independent screens. Neither absorbs the other, and a screen that handled only one
partner would leave the invariant breakable from the fee side, which is the failure rule 7
exists to prevent.
