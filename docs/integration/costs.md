# What it costs

Two numbers, and the second one is much larger than people expect. Non-normative;
[16 §5.2 and §8](../architecture/16-hosted-question-service.md) own the arithmetic.

---

## 1. The service fee — small

```
fee = max( svc.fee_floor ,  svc.fee_bps × declared_stake )  ×  M
```

Charged **once per question** — not per market, even though every question runs two — and **earned
when the report is published**, not when it settles. That sequencing is deliberate: you are buying
price discovery, and a settlement failure does not un-discover it.

`svc.fee_bps` ships **unset**, and while it is unset `register` refuses with `ServiceRateUnset`.

**`M` is a scarcity multiplier, and today it is 1.** When more clients want a slot than the cap
admits, the fee is multiplied by `M`, which rises the moment a slot is taken and falls back toward 1
over time. The point is that a slot freed by a finishing question does not become instantly cheap —
its price walks down. If you need that slot *now* you pay more than someone who can wait, which is
what stops the whole thing being a race won by whoever has the fastest bot.

You are not exposed to this yet: `svc.price_cap`, the bound on `M`, ships **unset**, and unset means
`M = 1` — the plain formula above, first come first served. Unlike `svc.fee_bps`, an unset
`svc.price_cap` does **not** close the service; it just means there is no surcharge. Read the live
value from chain metadata rather than assuming either state, and size your budget from the fee you
actually get quoted.

That is not a bug; it is the arming gate. The service is inert until the values layer sets a rate.

## 2. The subsidy you post — large, and mostly returned

To have a question **certified**, you fund the market's liquidity yourself:

```
b_min(S, ε)  =  ceil( 3·S / ( 2 · ln( 0.5 / (0.5 − ε) ) ) )     per book
escrow       =  2 · b_min · ln 2                                 two books, cash
```

| your ε | `b_min` per book | cash escrow |
|---:|---:|---:|
| 0.02 | 36.75 × S | **50.95 × S** |
| 0.05 | 14.24 × S | **19.74 × S** |
| 0.10 | 6.73 × S | **9.32 × S** |

At `S` = 100,000 and ε = 0.05 that is **1,973,644 USDC** of escrow.

**Why the two columns differ.** `b` is the LMSR liquidity parameter; the *cash* a book needs is
`b · ln 2`. Confusing the two overstates your cost by 44 %, and an earlier revision of the
specification did exactly that. If you are budgeting, use the right-hand column.

**Most of it comes back.** The escrow funds market inventory; what you actually spend is the
market-maker's realised loss plus fees. The unspent subsidy returns to the exact account that
funded it — no other account can receive it, by construction.

---

## Why the subsidy is so large

Because certification counts **only what you funded**.

Bleavit could have let organic trading depth satisfy the certificate. It refuses to, and the reason
is worth understanding before you argue with the number: if organic depth counted, a client could
buy a certificate out of *other people's* liquidity — and worse, external questions would compete
with Bleavit's own decision markets for the capital that makes those decisions trustworthy.
Requiring you to post your own depth makes your question a net **importer** of liquidity instead of
a competitor for it.

The honest consequence, stated in the specification rather than hidden: **a certified external
question is subsidised far more heavily per unit of stake than Bleavit subsidises its own
decisions.** Bleavit's own security also rests on capital floors and a 72-hour dispute window that
you are not buying. You are getting a *stronger* relation than Bleavit gives itself, and you pay
for it.

---

## Choosing ε

`ε` is the price move you want certified against. It is the main lever you control, and it is
non-linear:

- **Smaller ε → much more expensive.** Certifying against a 2 % move costs 2.6× what 5 % costs.
- **Larger ε → weaker claim.** Certifying against a 10 % move says little if your decision turns on
  a 3 % difference.

Pick ε from the decision, not the budget: **the smallest move that would change your mind.** If a
3-point difference flips your vote, certifying at ε = 0.10 tells you almost nothing.

---

## The two other fees

- **Trading fees** (`mkt.fee`) and **redemption fees** (`ledger.redeem_fee`) on your books accrue
  to Bleavit as service revenue. This is stated explicitly rather than left to inference, because
  silence would have amounted to collecting them by accident.
- **Delivery** of the pushed report is paid from a small **USDC delivery float** you top up —
  deliberately *not* from your bond, which is held in VIT. Delivery is paid in DOT or USDC and
  never in VIT, so funding it from the bond would have required a conversion at a price nobody
  publishes. If your float runs dry, **pushes stop and nothing else does**: the pull surface is the
  authoritative delivery anyway.

---

## Two limits to plan around

- **`svc.max_live`** caps concurrent questions chain-wide. It is bounded by block-weight capacity,
  not by demand, and it can be **reduced** by governance if external occupancy is seen to correlate
  with Bleavit's own proposals failing their depth floor. Do not build a business on a fixed slot.
- **Phase 3's `tvl_cap`** is 2,000,000 USDC and is **shared with every other inflow**. A single
  certified `S` = 100 k question at ε = 0.05 consumes essentially all of it. During Phase 3,
  registration meters your escrow against the *live remaining* cap, so a second such question will
  not fit.
