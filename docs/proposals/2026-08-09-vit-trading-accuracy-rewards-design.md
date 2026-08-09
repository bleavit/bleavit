# VIT trading accuracy rewards — design

Date: 2026-08-09
Status: **design approved, not implemented.** No milestone row exists yet.
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

A reward of `r` times profit pays `r × 500`, so break-even sits near **r ≈ 1.2 %**. The LMSR
spread raises that threshold, so treat 1.2 % as a floor rather than the line.

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
| `top_up_bond(amount)` | Signed | Increases the hold and the earning cap |
| `withdraw_bond()` | Signed | Releases the hold once the account has no unfolded market scores |

"Program epoch" throughout this document means the protocol epoch of `epoch.length`, which
is 302,400 blocks at the genesis registry. The design adds no separate clock.

`withdraw_bond` is gated on state rather than on elapsed time. It refuses while any
`(account, market)` score entry is unfolded, because those entries are what a debit is
computed from. No new cooldown parameter is introduced.

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

1. On a buy, add `cost + fee` to `spent`, rounded up.
2. On a sell, add proceeds to `received`, rounded down.
3. At settlement, add `position × settled_value` to `received`, rounded down. Here
   `settled_value` is the branch's terminal redemption value per unit, which the book already
   resolves to when it settles.
4. The market score is `received − spent`, and it may be negative.

**Folding is pull-based.** A permissionless `settle_market_score(who, market)` folds one
settled market into the account's epoch total and deletes the entry. No hook iterates a
collection. The keeper already cranks permissionless extrinsics
(`keeper/bleavit-keeper`).

### 4.5 Reward and debit

At epoch close, per participant, over their folded markets:

```
net     = epoch_received − epoch_spent
scored  = clamp(net, −bond/r, +bond/r)

scored > 0  →  accrue  r × scored  in VIT
scored < 0  →  debit   r × |scored|  from the bond
```

- When accruals exceed the authorized budget, **both legs scale by the same factor**. A
  scaled reward against an unscaled debit would over-punish, and a pro-rata reward with no
  fixed rate would let one pair in a thin epoch take the whole budget against a fixed small
  forfeit. Scaling both keeps a wash pair neutral at every budget level.
- A debit never drives the bond below zero. It suspends the participant until they top up.
- Forfeited USDC goes to `INSURANCE`, doc 13's standing destination for USDC taken from an
  account.
- `claim_rewards()` transfers accrued VIT with no vesting. The epoch lag of up to 21 days is
  already a real holding period, and the bond already selects for committed participants.

### 4.6 Two accepted costs

1. **Every trade pays one extra storage read**, including trades by accounts that never
   enroll. The market pallet must check enrollment before it can skip the accumulator. This
   enters the trade weight and must be benchmarked there.
2. **Positions acquired by `split` are out of scope.** Splitting is at par, so realizing a
   gain still goes through the book and still scores. The score measures trading skill rather
   than total portfolio return, and that limit is documented rather than hidden.

## 5. Parameters and bounds

### 5.1 Exactly one new registry row

| Candidate | Verdict |
|---|---|
| `rwd.rate` — reward per unit of net profit | **New row required.** `mkt.fee` is the nearest existing key, but it charges notional rather than sharing realized profit. Binding them would make a fee amendment silently move the reward |
| Minimum bond | **No row.** Reuse `ledger.pos_dep` |
| Per-epoch budget | **No row.** A call argument on the authorization |

`rwd.rate` has **no anchor**, and this design does not invent one. Under rule R-2 it ships
`[VERIFY]`, sim-gated, with the consumer **fail-closed**: `enroll` refuses before any hold
while the row is unset. The precedent is exact — `svc.client_bond` shipped this way, and
seeding the row was the act that opened the service.

The unsafe direction is upward, so the ceiling stays conservative and max-Δ stays at ×2.

**Consequence, stated plainly.** This milestone ships a program that cannot open. Opening it
is a separate values act, taken when the calibration exists.

### 5.2 New bounds, both derived

| Bound | Value | Derivation |
|---|---|---|
| `MaxParticipants` | 4,096 | The sibling allocation pot's lifetime bound for community schedules |
| `MaxScoredMarketsPerAccount` | 64 | `MaxPositionsPerAccount` — no account can score more markets than it can hold positions in |

## 6. Failure behavior (G-1, R-7)

- Rate unset — `enroll` fails closed with a typed error, before any hold.
- Budget exhausted — both legs scale, so nothing strands and the pot never overdraws.
- Debit above the bond — take the whole bond, suspend the participant, never go negative.
- Arithmetic edge — no-op, status quo.
- **A market that never settles must not lock a bond forever.** After `ledger.archive` the
  score entry drops at zero and releases the bond. That escape is anchored to an existing row
  rather than a new timeout.

## 7. Spec changes the implementation must make

| Document | Change |
|---|---|
| 08 §2.1 | The incentive-pot row gains a delivery mechanism, as the community row has |
| 08 (new subsection) | Funding call, score definition, bond, rate, forfeit to `INSURANCE` |
| 05 §4a | New family key `0x0D`, singleton — the `0x0C` argument applies unchanged, since the call mutates one remaining-allocation pool |
| 06 §3, §5 | SafetyFilter authority rows, plus the PARAM-leaf exception note §5 already makes for the community call |
| 13 §1, §4 | `rwd.rate` plus the two bounds |
| 14 | A threat row for the wash farm and its bond mitigation |
| 15 | The verification obligations of section 8 |
| `tools/limit-coverage/registry.toml` | Classify `rwd.rate`, with a marked test if it gates a dispatch |

**02 does not change, provided v1 ships with no client surface.** When the frontend shows a
trader their score, bond or accrual, those become client reads, 02 must freeze them, and
`INTEGRATION_CONTRACT_VERSION` bumps. `check-client-surface-obligations.py` enforces that
direction already. The screen is scoped out of v1 deliberately.

## 8. Verification obligations

- Mock-runtime tests per call: error paths, origin misuse, wrapper-filter negatives.
- **The anti-farm property suite**, at the ≥ 10⁶ case level in `property-gates.sh`: for any
  set of accounts holding offsetting positions, total payout minus total forfeit is ≤ 0. The
  whole design rests on this invariant, so it gets a proptest shard rather than unit tests.
- `try-state`: held bonds equal the pallet's USDC holdings, accruals never exceed the
  authorized budget, no bond below `ledger.pos_dep`, no score entry for a reaped market.
- A reference-model module mirroring the score arithmetic, plus differential vectors.
- Benchmarks for every call **and for the per-fill trait call**, because that one enters every
  trade's weight.

## 9. Out of scope for v1

- No vesting on rewards.
- No tournament pool where forfeits fund winners. It is economically appealing and worth
  revisiting, but it makes each payout depend on the whole field.
- No cross-epoch score carry.
- No client screen, and therefore no contract bump.

## 10. Open questions for the owner

1. **`rwd.rate` has no anchor.** It needs either Phase-0/3 calibration evidence or an explicit
   values ruling. The program stays closed until then, by design.
2. **Whether the client surfaces the program in a later milestone**, which is the decision
   that bumps `INTEGRATION_CONTRACT_VERSION`.
3. **Whether forfeits should fund winners** instead of `INSURANCE`, which would reduce the VIT
   drain and make the program closer to self-funding.
