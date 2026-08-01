# Bleavit for clients — what it is, in plain language

**You ask a question. A market prices both answers. You find out what it would cost to fake.**

That is the whole product. This tier of documentation is written for people integrating Bleavit,
not for people building it. It is **non-normative**: where it disagrees with
[`docs/architecture/`](../architecture/README.md), the architecture wins, and
[16](../architecture/16-hosted-question-service.md) is the owning document.

---

## The idea in one example

You run a parachain. You are about to ship a treasury spend, a parameter change, or a protocol
upgrade, and you would like to know whether it will actually help — *before* you do it, not after.

You ask Bleavit:

> "If we adopt proposal X, will our 30-day active-address count be higher than if we don't?"

Bleavit opens **two markets** — one priced on the world where you adopt, one on the world where you
don't — and lets anyone trade both. When the window closes you get back two prices with
provenance, plus a number saying what it would have cost someone to move them.

**You decide what to do with that.** Bleavit does not decide anything for you, does not run your
code, and never learns what you did.

---

## What you get, and what you do not

| You get | You do not get |
|---|---|
| Two conditional prices (time-weighted, not a spot snapshot) | A recommendation |
| A published **lower bound** on what faking them would cost | A guarantee that nobody tried |
| Provenance binding every field, verifiable by storage proof | An oracle for arbitrary facts |
| A stated settlement-trust level, so you can price the risk | Bleavit adjudicating your dispute |

The single most important line in this entire tier:

> **`manip_floor` is a floor, not a ceiling.** It is a *lower* bound on what an attacker would
> have had to spend. A big number means faking the price was expensive. It does **not** mean nobody
> tried, and it is not a promise the price is correct.

[`reading-the-report.md`](reading-the-report.md) is the file to read before you rely on anything.

---

## Three ways in

| You are | Read |
|---|---|
| A **parachain** with a runtime you control | [`integrate-parachain.md`](integrate-parachain.md) — add one pallet, implement a small `Config`, done. You never write XCM by hand |
| A **smart contract** on another chain | [`integrate-contract.md`](integrate-contract.md) — note the chain-granular identity model first; it will shape your design |
| An **off-chain service** | [`integrate-service.md`](integrate-service.md) — no XCM at all; a local account and RPC |

Then: [`quickstart.md`](quickstart.md) → [`costs.md`](costs.md) → [`settlement.md`](settlement.md).
[`errors.md`](errors.md) is a lookup table for when something is refused; every refusal has a
distinct code and a stated fix, deliberately, so you never have to guess.

---

## What this costs you, honestly

Two numbers, both of which surprise people:

1. **A service fee**, charged once per question when the report is published.
2. **A subsidy you post yourself** — and this is the big one. To have your question *certified*,
   you fund the market's liquidity, and at a 5 % resolution that is roughly **19.7 × your declared
   stake**, held in escrow and largely returned.

That second number is not a markup. It is what makes the certificate mean anything: certification
counts **only capital you funded**, never liquidity that happened to show up. If it counted
organic depth, a well-timed question could buy a certificate out of someone else's trading, which
is exactly the failure the design refuses. [`costs.md`](costs.md) works the arithmetic.

---

## What Bleavit will never do

Stated as refusals, because intentions are not enforcement:

- **Never runs your code.** The only bytes of yours that reach state are an opaque `sub_id` that
  Bleavit stores, echoes back, and never interprets.
- **Never lets your question affect Bleavit's own governance.** Different ledger instance, different
  origin type, different call domain.
- **Never adjudicates your facts.** Your settlement is your named attestors' job, and if they fail,
  your question voids and everyone redeems at par.
- **Never silently degrades.** Every failure path has a code, and the neutral outcome is always the
  default.

---

## Before you build

Two things worth knowing early, because they change designs:

- **Identity is chain-granular.** A contract on another chain authenticates to Bleavit as *that
  chain*, not as itself. If you need per-user attribution you carry it yourself in `sub_id`.
  See [`integrate-contract.md`](integrate-contract.md).
- **You choose your settlement trust.** You name the attestors who report your question's realized
  value. Naming one cheap attestor produces a report that says so, in a field your counterparties
  can read. See [`settlement.md`](settlement.md).
