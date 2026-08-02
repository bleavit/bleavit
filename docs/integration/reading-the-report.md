# Reading the report

This is the file to read before you rely on anything Bleavit publishes. Everything else in this
tier tells you how to *get* a report. This one tells you what it does and does not mean.

Non-normative; [16 §5](../architecture/16-hosted-question-service.md) is the owning section and
[02 §4a](../architecture/02-integration-contract.md) freezes the exact shapes.

---

## The one thing people get wrong

> **`manip_floor` is a floor, not a ceiling.**

It is a **lower bound** on what an attacker would have had to spend to move your prices by your
declared `ε`. Read it as *"faking this cost at least N"*, never as *"nobody faked this"* and never
as *"the price is right"*.

Two honest consequences:

- **A large `manip_floor` does not mean nobody tried.** It means trying was expensive. Someone with
  more money than the number may still have moved it and thought it worth the price.
- **A small `manip_floor` is a real warning.** It means the price is cheap to move, and you should
  treat it as weak evidence regardless of how confident it looks.

A lower bound is deliberately the *sellable* direction: overstating it would make Bleavit's own
security look better than it is, and that failure mode has already occurred once in this project's
history — a unit error made the published figure read **1.928× too high** before it was caught
(SQ-562). The number you receive is the corrected, cash-denominated one, and it rounds **down**.

---

## The fields

```
question_id, client_id, sub_id
twap_accept_1e9, twap_reject_1e9      the two conditional prices
observations, window_start, window_end
b_accept, b_reject                     the liquidity actually posted
manip_floor                            the lower bound above, in USDC, rounded DOWN
declared_stake                         your S, republished verbatim
epsilon_1e9                            your ε, republished verbatim
tolerance_1e9                          the settlement tolerance, frozen at registration
certified                              a relation, not a badge — see below
settlement_trust { attestors, quorum, bond_total }
provenance_hash
```

### The two prices

`twap_accept` and `twap_reject` are **time-weighted** over the window, not spot prices at the end.
That is the point: a spot price is a single moment somebody can choose, a TWAP is not.

They are on a `1e9` grid. Divide by 1e9 to get a probability.

### `certified` is a relation, not a badge

```
certified  ⟺  C_disp(ε) ≥ 3 × declared_stake
```

Read it as: *the client-funded market depth is at least three times what the client says is at
stake*. Three specific things follow, and all three matter:

1. **`declared_stake` is republished verbatim.** The absolute number is primary; the flag is
   derived. Always read `declared_stake`, not just `certified`.
2. **It counts only client-funded depth** (`C_disp`), never the measured `ManipFloor̂` total. If it
   counted organic trading, a client could acquire a certificate out of *other people's* liquidity.
3. **Under-declaring is self-defeating.** A client who under-declares `S` saves fee but forfeits
   both the certificate and the required depth — so a large `declared_stake` on a certified report
   is a claim the client paid for.

### `tolerance_1e9`

The deviation tolerance for your attestors, **frozen when the question was registered** and bound
into `provenance_hash`. It is in the report specifically so you can check it did not move: without
it here, a widened tolerance could excuse an attestor who should have been slashed, and you would
have no way to see that. A promise you cannot check is not a promise.

### `settlement_trust`

`{ attestors, quorum, bond_total }` — how many parties the client named, how many must agree, and
how much they collectively have at risk.

**This is the field to read on someone else's report.** A client controlling a majority of its own
named attestors can move its question's settlement. Bleavit does not prevent that; it bounds the
damage to that question's own escrow and makes the trust level legible. A report naming one cheap
attestor tells you so, in this field, before you rely on it.

### `provenance_hash`

```
blake2_256( b"bleavit/hosted-report/v1" || SCALE(every field above) )
```

Domain-separated on purpose, so a hash from this surface cannot collide with one from another.
Recompute it yourself — see [`integrate-service.md`](integrate-service.md) for verifying a report
by storage proof against a finalized header.

---

## How to actually use it

A workable rule, and the reasoning behind each clause:

```
adopt  ⟺  twap_accept − twap_reject  >  your_threshold
     AND  certified
     AND  manip_floor  >  (what adopting is worth to an adversary)
     AND  observations  ≥  (your own coverage floor)
```

- **Your threshold is yours.** Bleavit deliberately does not supply one — a threshold is a
  statement about your risk appetite, not about the market.
- **Compare `manip_floor` against the value of the decision to *someone else*.** If flipping your
  vote is worth more to an adversary than the floor, the floor is not protecting you.
- **Check `observations`.** A window with few observations is a thin TWAP whatever the prices say.

---

## What "VOID" means to you

If settlement fails — no quorum, the median lands outside range, the deadline passes, the service
is paused — the question **voids** and every position redeems at par. Nobody is made whole for
being right; nobody loses for being wrong.

**The report survives a VOID.** It was published at seal, before settlement risk existed, and that
sequencing is deliberate: the price discovery is what you bought, and a settlement failure does not
un-discover it. See [`settlement.md`](settlement.md).

---

## Things this report is not

- Not an endorsement of the question, the client, or the outcome. There is no endorsement field,
  and if someone shows you a Bleavit report as proof that Bleavit approves of something, they are
  misdescribing a true document.
- Not a claim that the market was liquid, informed, or attended.
- Not a settlement guarantee. See `settlement_trust`.
