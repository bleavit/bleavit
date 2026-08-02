# Settlement — your obligations, and what VOID means

Non-normative; [16 §6](../architecture/16-hosted-question-service.md) is the owning section.

Bleavit runs your market. **You settle it.** This file explains what that means, because it is the
part of the design with a genuine trust assumption in it, and pretending otherwise would be worse
than stating it.

---

## Why Bleavit does not settle for you

Your question is about *your* chain. Bleavit has no way to observe your active-address count, your
revenue, or your upgrade's effect — and the machinery it uses for its **own** facts is deliberately
not available to you:

- Its oracle's discipline parameters are **chain-wide**, so hosting your question there would mean
  raising Bleavit's own reporter bond and adding a round to every Bleavit dispute. You would be
  paying for your question with someone else's security budget.
- Its terminal adjudication is a token-holder referendum. Routing your disputed fact to Bleavit's
  electorate is not a service; it is a category error.

So settlement is a **client-named bonded attestor median**, and the trust is yours to configure.

---

## What you do

1. **Name your attestors at registration.** At least three, distinct.
2. **They post bonds.** The bond scales with what is escrowed, using Bleavit's own value-scaled
   filing-bond shape.
3. **They report the realized value** inside a 72-hour window.
4. **The median of a `⌈n/2⌉` quorum settles it.** Anyone deviating beyond `tolerance` is slashed.

Three details that are decided and worth knowing:

- **The median is over *every* in-window submission, never "the first ⌈n/2⌉".** A first-past-the-post
  rule would be order-dependent, and transaction ordering is controlled by neither you nor Bleavit —
  a collator could choose which of your attestors counted.
- **A repeat submission collapses to that attestor's latest.** Correcting your own value is not an
  attack, and rejecting it would have let any single attestor void your question by submitting
  twice.
- **Quorum counts distinct attestors, after that collapse.** Otherwise one attestor submitting twice
  would satisfy a quorum of two and could settle your question alone.

## Why a median rather than "you report, someone can challenge"

A lie detector needs an adjudicator, and this game has none by construction. Without one:

- *"Challenge ⇒ void, both bonds refunded"* makes lying strictly dominant.
- *"Challenge ⇒ reporter forfeits"* destroys an honest client with one griefing challenge.

A median over ≥ 3 independently bonded parties is the only shape that **prices one deviant and
survives one absence**.

---

## The residual risk, stated plainly

**A client controlling a majority of its own named attestors can move its question's settlement and
pay itself from the winning branch.**

Bleavit does not prevent this. What it does:

- **Bounds it** to that question's own escrow, minus forfeited bonds. Bleavit's ledger and every
  Bleavit market are untouched — different instance, different sovereign account.
- **Publishes it.** `settlement_trust { attestors, quorum, bond_total }` is a first-class report
  field. A question with one cheap attestor produces a report that says so.

If you are *reading* someone else's report, this is the field to read. If you are *producing* one
and want it relied upon, name attestors your counterparties would independently trust, and fund
their bonds accordingly. You are not buying Bleavit's credibility; you are publishing your own.

---

## VOID — the universal failure edge

Every failure takes the same path. There is no partial settlement, no best-effort value, no
"probably":

| Cause | Result |
|---|---|
| No quorum reached | VOID |
| Median outside range | VOID |
| Deadline passed | VOID |
| Service paused by guardians | VOID |
| Escrow insufficient | VOID |
| Attestor set collapsed | VOID |
| Client unreachable at settlement | VOID |

**VOID means every position redeems at par.** Nobody gains for being right, nobody loses for being
wrong. It is the neutral outcome, and it is the default whenever anything is unclear.

`void(qid)` is **permissionless and clock-driven** — anyone can crank it once the deadline passes,
so a client that walks away cannot strand its traders.

### Two things VOID is not

- **Not registry removal.** Having your client registration removed does *not* void your live
  questions; they run to their own terminal state. Voiding them on a governance vote would change
  trader payouts and could destroy an unsealed report you had already paid for, decided by people
  with no position in it.
- **Not un-delivery.** Your report was published at **seal**, before settlement risk existed. A
  VOID degrades traders to neutral value; it does not retract the price discovery you bought.
