# Integrating over XCM alone

**This page is the protocol. Everything else in this tier is a convenience wrapped around it.**

The drop-in pallet, the ABI crate and the TypeScript package all end up sending the bytes described
here. If you are not a Substrate parachain, cannot take a Rust dependency, or simply want to know
exactly what crosses the wire, this is the complete surface — nothing is held back for the
convenience layers.

Non-normative, as with everything in this tier: where this disagrees with
[16](../architecture/16-hosted-question-service.md) or [09 §6.5](../architecture/09-execution-upgrades-and-rollout.md),
the architecture wins.

---

## The shape of the whole thing

You send **one XCM program**, in **one fixed shape**, carrying **one encoded call**. That is the
entire integration surface. There is no handshake, no session, no channel-level state to maintain
beyond the HRMP channel itself.

Bleavit refuses `Transact` from everywhere and at every depth *except* inside this exact program.
That is deliberate and it is the reason the surface is safe to expose at all — so the strictness
below is not friction to be worked around, it is the product.

---

## 1. The positional template

Six positions. The first five are mandatory and **order is fixed**; the sixth is an optional
trailing `SetTopic`. Anything else — a missing position, an extra instruction, a reordering, a
substitution — is refused before anything executes.

| # | Instruction | Constraint |
|---|---|---|
| 0 | `WithdrawAsset(assets)` | exactly one asset; `id` **must** be the USDC location below; `fun` must be `Fungible(_)` |
| 1 | `PayFees { asset }` | `asset.id` must be the same USDC location |
| 2 | `Transact { origin_kind, call }` | `origin_kind` **must** be `OriginKind::Xcm` |
| 3 | `RefundSurplus` | no parameters |
| 4 | `DepositAsset { assets, beneficiary }` | `assets` must be `Wild(AllCounted(1))`; **`beneficiary` must equal your own origin location** |
| 5 | `SetTopic([u8; 32])` | optional, and only ever last |

Four properties fall out of that shape, and they are worth understanding because they explain every
refusal you might hit:

- **Value cannot be redirected.** Position 4 pins the beneficiary to the sender. There is no way to
  express "send the remainder somewhere else" in an admissible program.
- **Ingress mints nothing.** Position 0 is `WithdrawAsset`, never `ReserveAssetDeposited`, so your
  message moves existing balance and does not touch Bleavit's TVL cap.
- **Bleavit never `Transact`s abroad as itself.** A `Transact` nested inside `DepositReserveAsset`,
  `InitiateReserveWithdraw` or `InitiateTeleport` would execute on a *remote* chain carrying
  Bleavit's sovereign origin. Those shapes are not expressible here — closed by structure, not by a
  blocklist.
- **Future instructions fail closed.** A positional match rejects anything it was not written
  against, rather than reinterpreting it.

### The USDC location

```
{ parents: 1, interior: X3(Parachain(1000), PalletInstance(50), GeneralIndex(1337)) }
```

Asset Hub's `pallet-assets` asset 1337, as Bleavit sees it. Positions 0 and 1 must both name exactly
this; another asset — including DOT — is refused at the barrier.

---

## 2. The calls you can carry

Bleavit's `QuestionService` sits at **pallet index 66**, frozen. Call indices are frozen too:

| Call | Index | Reachable over XCM? | Arguments |
|---|---|---|---|
| `register` | 0 | **yes** | `RegisterInput` (§3) |
| `bond_attestor` | 1 | no — local signed | `u64` question id |
| `open` | 2 | **yes** | `u64` question id |
| `seal` | 3 | **yes** | `u64` question id |
| `submit_attestation` | 4 | no — local signed | `(u64, FixedU64)` |
| `settle` | 5 | no — local signed | `u64` question id |

**Only `register`, `open` and `seal` are `ExternalClient` calls.** The other three require a signed
origin: your named attestors bond and report from ordinary accounts on Bleavit, and `settle` is a
permissionless crank anyone can run. Putting one of them in position 2 produces a well-formed
program that is refused at the call filter — see §6.

### Encoding a call without metadata

```
call_bytes = [66, call_index] ++ SCALE(arguments)
```

That is the whole rule, and it is why you never need Bleavit's runtime metadata to build a message.
`seal(7)` is `[66, 3]` followed by the SCALE encoding of `7u64`:

```
0x42 03 0700000000000000
```

The indices are frozen surface, asserted by a test that fails if any of them moves.

---

## 3. `RegisterInput`, field by field

SCALE-encoded in exactly this order:

| Field | Type | Notes |
|---|---|---|
| `sub_id` | `Option<[u8; 32]>` | opaque. Bleavit stores it, echoes it in the report, binds it into the provenance hash, and **never interprets it**. This is where per-user or per-contract identity goes — see [`integrate-contract.md`](integrate-contract.md) |
| `declared_stake` | `u128` | what the decision is worth to you. Drives the fee **and** the certification threshold, which is what makes under-declaring self-defeating |
| `epsilon_1e9` | `u64` | your resolution, ×10⁹. `0.05` is `50_000_000` |
| `tolerance_1e9` | `u64` | settlement deviation tolerance, ×10⁹. Frozen at registration and part of the provenance preimage, so it cannot be widened later to excuse a slashable submission |
| `window_start` | `u32` | Bleavit block number |
| `window_end` | `u32` | Bleavit block number |
| `b` | `u128` | the LMSR liquidity you fund. [`costs.md`](costs.md) derives the `b_min` you need for a certificate |
| `rule` | `ClientRule` | one field: `min_accept_improvement_1e9: u64`. Committed **before** trading opens, so nothing can be chosen after seeing prices |
| `attestors` | `BoundedVec<[u8; 32], 16>` | the accounts that will report your realized value. At least 3. See [`settlement.md`](settlement.md) — this is the field your counterparties will read |

`FixedU64` is a transparent `u64`; it encodes as eight little-endian bytes with no wrapper.
`BoundedVec` encodes exactly like a `Vec`: compact length, then elements.

---

## 4. Getting the report back

Two independent routes, and **the pull is the authoritative one**.

### Pull — always available

The report is committed to Bleavit storage and exposed on the `FutarchyApi` runtime API as
`hosted_report(question_id) -> Option<ReportView>`, available from `Sealed` through archive. Read it
at a finalized header and verify the storage proof. This works whether or not you have a return
channel, whether or not a push succeeded, and it is what [`integrate-service.md`](integrate-service.md)
uses for clients that cannot receive XCM at all.

### Push — best-effort

If you registered a `Location` that can receive XCM, Bleavit also *attempts* delivery, paid from a
USDC delivery float you top up. It arrives as a `Transact` carrying:

```
[66, 0] ++ SCALE(ReportView)
```

Pallet index 66, call index 0 — meaning your receiving runtime is expected to expose
`receive_report(report)` at that slot.

**Do not build a design that depends on the push arriving.** A push failure is explicitly permitted:
it cannot fail the question, cannot un-publish the report, and by construction cannot feed back into
Bleavit's own welfare accounting (that is invariant I-36 — an external party must not be able to
move a Bleavit decision input by closing a channel). Treat push as a latency optimisation over the
pull.

### `ReportView` fields

`question_id`, `client_id`, `sub_id`, `twap_accept_1e9`, `twap_reject_1e9`, `observations`,
`window_start`, `window_end`, `b_accept`, `b_reject`, `manip_floor`, `declared_stake`,
`epsilon_1e9`, `tolerance_1e9`, `certified`, `settlement_trust`, `provenance_hash`.

[`reading-the-report.md`](reading-the-report.md) explains what they mean and, more importantly, what
they do not promise. The one line to carry from there: **`manip_floor` is a floor, not a ceiling.**

---

## 5. Identity — read this before designing anything

You authenticate as a **chain**, not as an account or a contract. Bleavit converts your `Location`
to an internal `ClientId` and that is the whole of your identity: `DescendOrigin` and `AliasOrigin`
are deliberately not admitted, so there is no way to present a sub-identity at the origin level.

If you need per-user, per-contract or per-department attribution, you carry it yourself in `sub_id`
and you are responsible for its meaning. Bleavit will store it and echo it back untouched.
[`integrate-contract.md`](integrate-contract.md) works through what this means for a contract
platform where many parties share one chain identity.

---

## 6. Why your message was refused

Refusals happen at four distinct stages, and knowing which one you hit tells you what to fix:

| Stage | What it checks | Symptom |
|---|---|---|
| **Barrier** | the six-position shape, the USDC asset, `OriginKind::Xcm`, `beneficiary == origin` | the program is not executed at all |
| **Origin converter** | your `Location` is a registered, non-removed client | `Transact` cannot obtain an origin |
| **Call filter** | the decoded call is one of the three `ExternalClient` calls | a well-formed program whose call is refused |
| **Dispatch** | the service preconditions in [`errors.md`](errors.md) | a named, deterministic error |

Every one of these is deterministic. If the same message is refused twice, it will be refused every
time — there is no retry that helps, and no rate limiting hiding behind a generic failure.

The most common first-integration mistakes, in order:

1. `beneficiary` not equal to your own origin location (position 4).
2. `OriginKind::SovereignAccount` instead of `OriginKind::Xcm`.
3. An asset other than the exact USDC location in position 0 or 1.
4. Wrapping the call in `Utility::batch` — wrappers project to a wrapper tree, never to an
   `ExternalClient` leaf, so they are refused by construction.
5. Registering before `svc.fee_bps` is set, which fails closed with `ServiceRateUnset`.

---

## 7. Checklist

- [ ] HRMP channel open in **both** directions if you want the push leg; **one** direction (yours to
      Bleavit) is enough for pull-only.
- [ ] You hold USDC on Bleavit, reachable at the exact location above.
- [ ] Your program is exactly the six positions, in order, with `beneficiary` set to your own origin.
- [ ] Your call is `register`, `open` or `seal` — encoded as `[66, index] ++ SCALE(args)`.
- [ ] You are registered as a client (a governed, bonded admission — it is not permissionless).
- [ ] You read the report by **pull**, and treat any push as a bonus.
- [ ] You picked your attestors deliberately, knowing the report publishes how many there are.

---

## If you would rather not do any of this

You do not have to. [`integrate-parachain.md`](integrate-parachain.md) hands you a pallet that
builds this program for you and cannot build it wrong; the ABI crate gives you the same builder
without the pallet; [`integrate-service.md`](integrate-service.md) skips XCM entirely. They all
produce the bytes on this page — which is exactly why this page exists: so that choosing a
convenience layer is a convenience, not a dependency.
