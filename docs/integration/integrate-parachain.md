# Integrating a parachain

You control a runtime, so this is the easiest path: **add one pallet and implement a small
`Config`.** You never write XCM.

Non-normative; [16 §2–§3](../architecture/16-hosted-question-service.md) and
[09 §6.5](../architecture/09-execution-upgrades-and-rollout.md) are the owning sections.

---

## What you actually do

1. **Get admitted.** Client admission is a values-track act on Bleavit with a held bond. You supply
   the `Location` you will send from — matched by **exact equality**, never by prefix.
2. **Open HRMP both ways.** Outbound so you can ask; inbound so Bleavit can push. If you skip the
   inbound channel, pushes fail and pull still works — see below, it is a supported state.
3. **Add `pallet-bleavit-client`** and implement its `Config` ([`quickstart.md`](quickstart.md)).
4. **Fund two balances:** USDC for question escrow, and a small USDC **delivery float** for push
   fees.

That is the whole integration.

---

## Why you don't write the XCM yourself

Bleavit admits exactly **one** program shape, matched position by position:

| idx | instruction |
|---:|---|
| 0 | `WithdrawAsset` — one asset, USDC, fungible |
| 1 | `PayFees` — USDC |
| 2 | `Transact` — `OriginKind::Xcm`, and the call must be a client-domain call |
| 3 | `RefundSurplus` |
| 4 | `DepositAsset` — beneficiary pinned to **you** |
| 5 | `SetTopic` — optional, last only |

Anything else is refused. Not "discouraged" — refused, by shape.

This is strict because the alternative is unsafe: a `Transact` nested inside one of XCM's nine
inner-program instructions executes somewhere else, or under a different origin, and no
per-instruction check distinguishes that from a plain local call. Matching the whole program's
shape closes all nine without enumerating any of them.

**The strictness is why the builder exists.** A hand-authored program is easy to get wrong and
always refused with a deterministic code, so the pallet builds it for you and you never see this
table again.

---

## What your origin can and cannot do

Your `Transact` executes as `ExternalClient(ClientId)` — a distinct origin type in a distinct
pallet. It is **not** a signed account on Bleavit.

Concretely: you cannot submit a Bleavit proposal, trade in Bleavit's own markets, split its ledger,
or reach any governance call. Those are different call domains, and no composition of wrappers
reaches them from here. This is a type-level property of the origin converter, not a filter someone
maintains.

The mirror also holds: **no Bleavit governance origin can reach your client calls.** The two
surfaces are disjoint by construction.

---

## Push, pull, and which to trust

- **Push** is a best-effort report delivery to your chain. Its fees are prepaid from your USDC
  delivery float.
- **Pull** is a storage read you verify by proof against a finalized header.

**Pull is authoritative.** Push is a convenience, and the design deliberately makes its failure
harmless — a client that never opens its return channel simply never receives pushes. That is a
supported state, not a broken one, and it is worth testing: the Zombienet topology ships a
return-channel-absent variant for exactly this.

There is a reason this is stated so firmly. A push that failed *and* mattered would let any client
degrade Bleavit's own health metrics by doing nothing — so the egress path is deliberately outside
Bleavit's health accounting, and the price of that is that push cannot be relied upon. Use pull for
anything that moves money.

---

## Sizing your first question

| Decision | How to pick |
|---|---|
| `declared_stake` | What the decision is genuinely worth to you. It is republished verbatim and the fee rides on it, so over-declaring costs money and under-declaring forfeits the certificate |
| `epsilon` | The **smallest price move that would change your mind**. Not a budget number — see [`costs.md`](costs.md) for why it is non-linear |
| `window` | Long enough for a meaningful TWAP; it must not collide with a live Bleavit decision window |
| `attestors` | At least three, and — this is the part people under-think — parties your *counterparties* would trust. See [`settlement.md`](settlement.md) |
