# 16 — Hosted Question Service (external clients)

**Status:** normative. **Owns:** the external-client trust boundary — admission, the question
lifecycle, the sold report, external settlement, domain segregation, and revenue instrument D.
**Depends on:** [02](./02-integration-contract.md) (contract surface), [03](./03-conditional-ledger.md)
(custody and solvency), [04](./04-markets-and-pricing.md) (LMSR, TWAP), [09](./09-execution-upgrades-and-rollout.md)
§6 (XCM posture), [13](./13-parameters.md) (values), [14](./14-threat-model.md) (TH-66…TH-73),
[15](./15-invariants-and-testing.md) (I-34…I-38, PT-9/PT-10).

---

## 1. What this is, and the one sentence that bounds it

Bleavit runs conditional prediction markets on **questions asked by other chains, contracts and
services**, and sells them the resulting prices. It does not decide anything for them, does not run
their code, and does not let their outcomes touch its own governance.

> **The boundary rule (normative).** No external question, market, report, settlement, failure or
> absence may move any Bleavit decision input, welfare input, settlement input or treasury control.
> The service is a **priced tenant** of the chain's market machinery, never a participant in its
> governance. Every mechanism in this document exists to make that statement structurally true
> rather than merely intended.

This is the third trust domain in the system. [01](./01-system-overview.md) §4.3 previously recorded
two; the closure clause there is amended by this document rather than contradicted.

**What the client buys.** A conditional price pair with provenance, plus a published lower bound on
what it would cost to fake it. Nothing else. The client's own rule, on the client's own chain,
decides what to do with it — Bleavit never learns the rule's consequence and never executes it.
This is the decision that keeps [05](./05-welfare-and-decision-engine.md)'s `W` Bleavit-scoped and
I-24 intact, and it is the reason a hostile client can lose its own money and nothing else.

**What Bleavit never does, restated as refusals rather than intentions:**

| Never | Enforced by |
|---|---|
| Dispatches **arbitrary** client code | The ingress template admits exactly one `Transact`, whose decoded call must classify to `CallDomain::ExternalClient` (§3). The client *does* supply a call — an earlier revision said "no client bytes are ever dispatched", which is false. The true guarantee is narrower and is the one that matters: the only reachable calls are this service's own dispatchables; the one client-selected `ClientRule` is the fixed data-only comparison of §4 and is evaluated only to choose this question's settlement coordinate, never dispatched and never evaluated for an external consequence |
| Reads an external price, outcome or report into `W`, `s`, or any settlement input | I-34/I-37 + the metric-provenance refusal (§8.3) |
| Lets an external failure halt, freeze or degrade the primary domain | The second ledger instance (§7) and VOID-as-universal-edge (§6.4) |
| Sends XCM whose success or failure feeds `X` | The dedicated egress router, I-36 (§9) |
| Funds an external market from `POL`, `POL_BASELINE` or any treasury line | `FundingDomain` (§7.3) |

---

## 2. Admission — the client registry

External capability is **granted, bonded and revocable**, never permissionless. `pallet-client-registry`
holds the roster.

| Field | Meaning |
|---|---|
| `location: Option<Location>` | The remote client's XCM origin, matched by **exact equality** — never by prefix, never after `DescendOrigin`/`AliasOrigin`; `None` for a local client |
| `local_signer: Option<AccountId>` | The local client's exact signed identity; `None` for a remote XCM client. Exactly one identity field is populated |
| `client_id: ClientId` (`u32`) | The dense handle everything else keys on. `Location`'s ~306-byte `MaxEncodedLen` must never enter `OriginCaller`, which `pallet-scheduler`'s bounded `Agenda` would not survive |
| `bond: Balance` | Native **VIT**, held for the life of the registration on the B19 (`pallet-attestor`) custody discipline. The first loss on abuse |
| `delivery_float: Balance` | **USDC**, client-topped-up, and the *only* source of egress delivery fees (§9). Separate from the bond deliberately — see below |
| `admitted_at`, `questions_live`, `questions_total` | Meter state |
| `ClientPolicies[client_id]: SubIdPolicy` | Registry-owned internal presence policy (`Optional` or `Required`) for the opaque `sub_id`; it is not a field of contract-v22 `ClientRecord` and never grants meaning to those bytes |

The roster is bounded by [13](./13-parameters.md) §4's `MaxClients = 64`: the hard maximum of
`svc.max_live`, so even the extreme allocation in which every live question belongs to a distinct
client fits. An idle 65th registration adds no hosting capacity and is refused with `ClientsFull`
before its bond is touched. The forward `Clients: ClientId → ClientRecord` map and exact reverse
`ClientIdOf: Location → ClientId` map are counted together by `ClientCount` and cross-checked by
try-state.

**Admission is a values-track act** (`ConstitutionalValues`, per [06](./06-governance-and-guardians.md)
§2.1), and **removal is one too** — but removal is *not* a kill switch on live questions. Removing a
client refuses *new* registrations immediately and lets live questions run to their own terminal
state, because the alternative strands trader capital in books nobody can settle. A client whose
removal must be immediate is handled by the guardian pause of §10, which VOIDs rather than strands.
Mechanically, removal first returns the complete USDC `delivery_float` to the runtime-derived client
funder and then writes a tombstone: exact-identity authentication and the native hold remain until
`questions_live` reaches zero; only then are both indexes deleted and the exact remaining hold
released. The refund and tombstone share one storage layer, so a failed exact refund leaves the
client wholly live. A tombstoned client gets `ClientRemoved` on a new question registration and its
remaining reports use authoritative pull only.

**Identity is chain-granular, deliberately.** A contract on another chain authenticates as *that
chain*, not as itself. `DescendOrigin` and `AliasOrigin` stay out of the ingress template (§3), so
sub-identity cannot be asserted to Bleavit at all. A client that needs per-contract attribution
supplies an opaque `sub_id: [u8; 32]` which Bleavit **stores, echoes in the report, binds into the
provenance hash, and never interprets**. Bleavit makes no claim about who inside a client chain
asked a question — the client chain does, to its own users, using a field Bleavit merely carries.
`Required` refuses an absent value. `Optional` accepts either form and canonicalizes absence to
`[0u8; 32]`; because contract-v22 `ReportView` (unchanged from v21) deliberately carries no presence bit, an absent
optional value and an explicitly supplied all-zero value are indistinguishable on chain.

**Why two balances rather than one (normative; SQ-565 resolution, 2026-08-01).** An earlier
revision made the bond the source of prepaid egress delivery fees, and the bond is native VIT while
XCM delivery is paid in an asset the router accepts — DOT or USDC under
[09](./09-execution-upgrades-and-rollout.md) §6.1's trader, **never VIT**. That named a conversion
that does not exist, at a price nothing publishes. The precedent was genuinely mixed rather than
obviously one way (`att.bond` is native VIT; `orc.reporter_stake` is 100,000 USDC), so this is a
values judgement and it is taken here rather than deferred: **the bond stays VIT and a separate
USDC `delivery_float` pays for delivery.** Two balances are more to reason about than one, and that
cost is accepted for a specific reason — it is the only resolution that introduces **no price**.
Charging VIT at a governed rate would put a VIT/USDC rate on a fee path, and
[08](./08-treasury-and-economics.md) §9's placeholder rate is explicitly not fit for that; making
the whole bond USDC would discard the B19 hold discipline for a security deposit that is
governance-adjacent by nature. A float that runs dry stops **pushes only** — the pull surface is
unaffected, because §9 already makes pull the authoritative delivery and push best-effort, so an
empty float degrades exactly the leg that was already allowed to fail.

The float has its own client-authorized custody path. `top_up_delivery_float(amount)` and
`withdraw_delivery_float(amount)` are accepted only through that record's exact `ExternalClient`
origin; neither call accepts a funder, beneficiary, asset or destination argument. The runtime
derives the sole USDC funder from the registered location's sovereign account or the exact local
signer and moves the exact amount to or from a deterministic per-client escrow. The stored
`delivery_float` is the client's claim; physical custody MUST be at least that liability. A third
party may donate USDC to a publicly addressable escrow, but that surplus grants no client claim and
MUST NOT make try-state externally haltable. Every nonzero claim MUST also be at least the asset's
live on-chain minimum balance, so no successful debit can reap physical custody while leaving a
stored liability. A voluntary withdrawal may reach zero; any other withdrawal remainder below the
minimum is refused. Egress prepayment is stricter: it refuses a debit whose remainder would reach
zero or fall below the minimum, preserving the N4 custody rule the float supersedes. Zero,
insufficient, below-minimum, overflow and custody-accounting refusals are distinct (§11). Top-up
also refuses a source-account remainder between zero and the asset minimum: `Expendable` is used
only for an exact zero, so an ostensibly exact transfer can never burn uncredited source dust. Every
failed transfer rolls both storage and assets back.

**Custody identity is frozen.** `ClientDeliveryPalletId = PalletId(*b"bl/cdelv")`, and client
`c`'s escrow is exactly
`ClientDeliveryPalletId::get().into_sub_account_truncating(c: ClientId)`. These accounts are created
on demand by top-up and are not members of [08](./08-treasury-and-economics.md) §2.1's exact
genesis-endowed set; each nonzero claim itself keeps its account at or above the live USDC minimum.
The runtime's `ForeignAssets` instance has no hold provider (`Holder = ()`), so the deterministic
keyless escrow is the USDC custody analogue of N4's native hold: prepayment moves the exact debit
from that escrow to the runtime-fixed beneficiary in the same rollback layer. The VIT hold remains
byte-for-byte untouched; no user gains a transferable custody key.

**Off-chain services** cannot send XCM. They use the identical calls from a **local signed
account** — but that account must be bound in the registry, and an earlier revision's
`location = Location::here()` does not do it: `here()` is identical for *every* local signer, so it
would either authenticate nobody or authenticate anybody. The registry record therefore carries an
optional `local_signer: Option<AccountId>`, and a `ClientRecord` is admitted with **exactly one** of
`location` (XCM transport) or `local_signer` (local transport) — never both, never neither. The
signed-origin path converts `Signed(who)` to `ExternalClient(id)` **only** on an exact
`local_signer == who` match, which is the same exact-equality discipline the `Location` path uses
and the same single-success-constructor shape I-34 requires. §12's negative-origin matrix is scoped
accordingly: a `Signed` origin that matches no `local_signer` is rejected, which is what that matrix
is asserting. The product is identical across both transports; only the authentication field
differs.

---

## 3. Ingress — a positional template, not an instruction allowlist

[09](./09-execution-upgrades-and-rollout.md) §6.5 is the normative home of the template; this section
states why it has that shape.

Admitting "top-level `Transact` from an allowlist" is **not narrow enough**, and the reason is not
obvious. XCM v5 has **nine** instructions carrying an inner program, and a `Transact` inside one of
them does something other than what a reader of the outer program expects:

| Instruction | Where the inner program runs |
|---|---|
| `TransferReserveAsset { xcm }` · `DepositReserveAsset { xcm }` · `InitiateReserveWithdraw { xcm }` · `InitiateTeleport { xcm }` · `InitiateTransfer { remote_xcm }` · `ExportMessage { xcm }` | on a **remote** chain, carrying **Bleavit's** sovereign origin |
| `SetErrorHandler(Xcm<Call>)` · `SetAppendix(Xcm<Call>)` | **locally**, on error or on completion — and these carry `Call`, so they can carry a `Transact` |
| `ExecuteWithOrigin { descendant_origin, xcm }` | **locally**, under a *descended* origin — the sub-identity vector §2 refuses, reachable without `DescendOrigin` appearing anywhere |

An allowlist keyed on instruction identity has to enumerate all nine and stay complete as the SDK
evolves. **The positional template does not enumerate them at all**: none of the nine is at an
admitted position, so all nine fail the match by construction, and an SDK that adds a tenth fails
the positional match rather than slipping through (property 4 below). That is the whole argument for
matching shape rather than membership — an earlier draft of this section named only three of the
nine, which is exactly the kind of incompleteness a deny-list invites and a positional match makes
irrelevant.

So `Transact` is admitted only inside **one exact, positionally-matched, whole program**:

| idx | instruction | pinned constraint |
|---:|---|---|
| 0 | `WithdrawAsset(assets)` | exactly one asset, `id == usdc_location()`, `Fungible` |
| 1 | `PayFees { asset }` | `asset.id == usdc_location()` |
| 2 | `Transact { origin_kind, call }` | `origin_kind == OriginKind::Xcm` |
| 3 | `RefundSurplus` | — |
| 4 | `DepositAsset { assets, beneficiary }` | `Wild(AllCounted(1))`, **`beneficiary == *origin`** |
| 5 | `SetTopic(_)` | optional; last only |

Four properties follow **by shape**, not by a predicate anyone must maintain:

1. **Value redirection is not expressible.** Position 4 pins the beneficiary to the sending origin, so
   there is no program in the admitted set that pays anyone else.
2. **Ingress mints nothing.** Position 0 is `WithdrawAsset`, never `ReserveAssetDeposited`, so the
   client spends a balance it already holds here. [13](./13-parameters.md)'s `phase3.tvl_cap` is a
   cap on issuance and is therefore untouched *by ingress* — see §8.5 for the cap that does bind.
3. **"Bleavit `Transact`s abroad as Bleavit" is closed by construction**, because no nesting
   instruction appears at any admitted position.
4. **Unknown and future instructions fail the positional match**, because they are not at an admitted position. An earlier revision claimed a new SDK variant would fail *compilation*; that is not guaranteed and MUST NOT be relied on. What is guaranteed is the runtime refusal, and what backs it is the `=`-exact pin (`staging-xcm = 24.0.0`) plus a test that asserts the admitted set has exactly six positions — so a version bump that changes the instruction set fails a **test**, which is the check that actually exists. The pin therefore belongs in I-35's statement, not merely in `Cargo.toml`.

**The existing closed instruction allowlist does not change by one token.** Only the barrier sees the
whole instruction slice, so only it can match the positional template. The SDK gives the other two
checks narrower inputs: `ConvertOrigin::convert_origin` receives `(Location, OriginKind)`, while
`SafeCallFilter` receives one decoded `RuntimeCall`. The required composition is therefore:

| Component | Input it actually gets | What it checks |
|---|---|---|
| Barrier | the whole `Xcm<Call>` slice | the six-position template, exhaustively |
| `OriginConverter` | `(Location, OriginKind)` | exact equality against a registered client `Location`, and `OriginKind::Xcm` |
| `SafeCallFilter` | `RuntimeCall` | `domain(call) == CallDomain::ExternalClient` |

Admission requires all three. The §12 obligation tests their **intersection**: a program that fails
any one does not dispatch. An earlier revision demanded one shared matcher, but neither the origin
converter nor the call filter receives a whole program, so that demand was unimplementable.

**The strictness is what makes integration easy, not hard.** A hand-authored program of this shape is
easy to get wrong and is *always* refused with a deterministic code; clients never hand-author it.
The ingress builder ships with the client kit, so correct-by-construction is the default path and
strictness is invisible.

### 3.1 The origin a client gets

The client's `Location` converts to `pallet_client_registry::Origin::ExternalClient(ClientId)` —
**not** a sovereign *signed* origin. A signed origin would leave `SafeCallFilter` as the only thing
standing between a client and every `CallDomain::Public` call (`epoch.submit`, `market.buy`,
`ledger.split`). That is one predicate away from catastrophe; the distinct constructor and its
closure are implementation-and-test obligations.

- The converter has **exactly one success constructor**. No `Location` can become `RawOrigin::Signed`,
  `RawOrigin::Root`, or any `pallet_origins::Origin` variant. This is **not** a type-level guarantee:
  the executor requires `ConvertOrigin<RuntimeOrigin>`, and `RuntimeOrigin` admits every constructor
  in the runtime. I-34 is discharged by one `Ok(...)` expression in the converter plus the complete
  negative-origin matrix, which mechanically checks the review promise.
- It lives in `pallet-client-registry`, **not** `pallet-origins`, because `EnsureFutarchyOrigin`
  succeeds for *any* `pallet_origins::Origin` variant — a foreign `OriginCaller` variant makes
  `try_origin` fail structurally instead. `track_origins.rs` is the existing precedent.
- `CallDomain::ExternalClient` (the twelfth variant) is reachable by **no** governance origin, and
  `SafeCallFilter` is *derived from* the classifier so the admissible set cannot drift from the domain.

**[01](./01-system-overview.md) §6's eight-origin closure clause stays literally true** — different
pallet, different `OriginCaller` variant — and carries an appended scoping paragraph saying so.
That clause matters here more than its brevity suggests: it states that none of the eight is
obtainable from *"a signed extrinsic, XCM origin conversion, or wrapper call"*, and this design
introduces exactly an XCM origin conversion. It produces a **ninth** origin in a different pallet,
so the sentence is unweakened rather than merely still-passing.

**One genuine widening, stated rather than hidden.** `allowed_for(None) == true` for the new domain
makes the pallet's own `EnsureOrigin` load-bearing in a way the eight governance origins' is not.
The alternative — `dispatch_bypass_filter` — is worse under R-7, because it removes the filter from
the path entirely rather than making it decisive.

**`ExternalClient` is *not* governance-privileged, and wrapper protection does not come from
pretending it is.** [06](./06-governance-and-guardians.md) §3.3 denies "every bare
**governance-privileged** leaf" and G-5 defines a privileged effect as one flowing "through an
enumerated custom origin produced by an enumerated pallet" — this domain requires no origin at all,
so classifying it as privileged conflates two different properties. (An early draft did exactly
that, and the `nested_wrapper_filter` differential oracle falsified it immediately: it asserts that
whatever `validate(None, _)` admits carries no unscoped privileged leaf, which a
privileged-yet-`None`-admitted domain contradicts by construction.) Wrappers are ordinary here, and
that costs nothing, because **the XCM threat is closed one layer up**: `SafeCallFilter ≡ {c :
domain(c) == ExternalClient}` (I-35), and a `Utility.batch(…)` or `Proxy(…)` does not itself
classify as `ExternalClient`, so no wrapper is admissible through the §6.5 template whatever the
privilege predicate says. Denying wrappers would have bought nothing and cost off-chain services
their batching.

---

## 4. The question lifecycle

```
                      register ─────► Registered ──► Open ──► Sealed ──► Settled
                                           │           │        │            
                                           └───────────┴────────┴──────► Voided
```

`Settled` and `Voided` are the **only** terminal states, and `void(qid)` is permissionless and
clock-driven. Every edge that is not an explicit success is a VOID edge (§6.4).

| Phase | What happens |
|---|---|
| `Registered` | The client has posted escrow, named its attestor set, committed its `ClientRule`, and declared `(S, ε)`. Markets are created but not open |
| `Open` | Both books trade; the segment TWAP accumulates per [04](./04-markets-and-pricing.md) §7 |
| `Sealed` | The window closed. TWAPs are frozen, the **report is published**, the realized branch is derived, and the service fee is **earned** (§8.1) |
| `Settled` | The attestor median landed inside tolerance; positions redeem against the realized value |
| `Voided` | Any failure edge. Positions redeem at par via the existing D-1 path |

**The product is delivered at `Sealed`, before settlement risk exists.** This is the load-bearing
sequencing decision of the whole design: a VOID degrades traders to D-1 neutral value, but it does
not *un-deliver* the report — the price discovery already happened and was already published. That
is why the fee is earned at `Sealed` and not at `Settled`, and it is why a client cannot get a free
report by sabotaging its own settlement.

**The seal edge has a distinct frozen deadline (N7 ruling, 2026-08-01).** The client may seal in the
half-open interval `[window_end, window_end + orc.window)`. A pre-seal `void(qid)` remains refused
through that interval and becomes permissionless only at `window_end + orc.window`. Reusing the
D-18-frozen `orc.window` adds no parameter and makes the success edge real: if `seal` and VOID first
became eligible in the same block, an arbitrary signed caller or transaction ordering could destroy
an unsealed report before its client had any eligible block in which to publish it. Registration
snapshots `orc.window` into the internal question terms and stores the checked deadline; later
parameter amendments move neither this seal boundary nor the settlement deadline derived from the
same snapshot. `seal` after it refuses `DeadlinePassed`; the deadline VOID is the status-quo outcome.

**Which branch settles needs no trust at all.** The client pre-commits its `ClientRule` at
registration; `seal` derives the realized branch **deterministically from the sealed TWAPs**, in the
same transaction that publishes the report. Nothing can be declared after seeing prices. This is not
"running foreign code": it is a two-field comparison committed before trading opened, O(1) and
non-dispatching — and it fixes only the *settlement coordinate*, never the client's decision.

The comparison is byte-defined rather than caller-programmable:

```rust
pub struct ClientRule { pub min_accept_improvement_1e9: FixedU64 }

realized = if twap_accept_1e9 >= twap_reject_1e9 + min_accept_improvement_1e9 {
    Accept
} else {
    Reject
}
```

The field is bounded to `[0, 1e9]` at registration. The addition is checked; overflow selects
`Reject`, which is algebraically the same result because no in-range Accept TWAP can clear that
threshold. A zero floor makes equality Accept. The rule is retained in pallet-internal bounded
storage alongside the §4a-frozen `Questions` row; it does not widen that frontend record.

---

## 5. What is sold — the report

```rust
Report {
    question_id, client_id, sub_id,
    twap_accept_1e9, twap_reject_1e9,     // sealed segment TWAPs (04 §7)
    observations, window_start, window_end,
    b_accept, b_reject,                   // the liquidity actually posted
    manip_floor,                          // 05 §5.6, cash form, rounded DOWN
    declared_stake,                        // S, republished verbatim
    epsilon_1e9,                           // ε, republished verbatim
    tolerance_1e9,                         // §6.3 deviation tolerance, frozen at
                                           //   registration and provenance-bound
    certified: bool,                       // C_disp(ε) ≥ SECURITY_FACTOR·S — client-funded depth
                                           //   ONLY, never the measured-inclusive ManipFloor̂ (§5.2)
    settlement_trust: SettlementTrust { attestors, quorum, bond_total },
    provenance_hash,                       // binds every field above + sub_id
}
```

`observations` is the **minimum** of the two sealed books' in-segment observation counts. It is a
coverage claim about the pair, so publishing the sum or the stronger book would overstate the
weakest price input the report depends on.

### 5.1 The manipulation bound

The bound is **not invented here**. It is [05](./05-welfare-and-decision-engine.md) §5.6's
`ManipFloor̂ = C_disp + C_hold`, published with the client's declared `ε` in place of `δc`:

```
C_disp(ε) = Σ_{book} b_book · ln( (1 − p̄*_book) / (1 − p̄*_book − ε) )
C_hold(ε) = min(V_win, sec.flow_cap · (b_acc + b_rej)) · ε
```

Three properties make it the right thing to sell, and one makes it dangerous to sell carelessly:

- It is a **lower** bound on attacker cost (§5.6; [08](./08-treasury-and-economics.md) §5.5's
  `AttackCost̂` is the upper one). A lower bound is the honest direction for a sold claim.
- It **rounds DOWN**. R-7's "round against the claimant" here means against the party *relying* on
  the number, which is the client. A floor that rounds up is a floor that lies.
- It is denominated in **USDC**, which is worth stating explicitly because this document's own
  ancestor got it wrong: until SQ-562 the §5.6 expression was 04 §3's *displacement* (a share count)
  added to a cash amount, reading **1.928× high**. Every figure in this document uses the corrected
  cash form. A service that resold the superseded number would have been selling a security claim
  roughly twice as strong as the truth.
- **It is not currently computed on-chain, and what that blocks is narrower than an earlier revision
  said.** SQ-563 records that §5.6's "mandatory diagnostic" has no Rust implementation and that no
  `DecisionDiagnostics` surface exists. The earlier text blocked the whole `certified` flag on that
  producer — but since §5.2 now defines certification over **`C_disp` alone**, the certificate no
  longer derives from `ManipFloor̂` and that rationale no longer applies: `C_disp` is computed by
  this service from the client's own posted `b`, so `certified` is self-contained. What SQ-563 still
  blocks is the **`manip_floor` report field**, which is the §5.6 quantity itself. `seal` MUST
  therefore either publish a real `manip_floor` or refuse with `CertificationUnavailable` — it MUST
  NOT publish a placeholder, because the field is sold.

**Deliberately NOT shipped: an `ε_max` "feasibility ceiling".** An earlier draft of this design
published `ε_max = (1/n)·Σ[min(1, p̄(1+κ)^i) − p̄]` as a *proof* that a question is unmanipulable at
`ε` within its window. It is not an upper bound: the κ-slew segment accumulator of
[04](./04-markets-and-pricing.md) §7 credits observations backward across gaps, so displacement paths
exist that beat the expression while still passing coverage. Publishing it as a ceiling would have
been the one thing worse than publishing nothing — a **false** security claim, in the unsafe
direction, on a surface a client is entitled to rely on. It may return only as an advisory statistic
with the word "bound" absent, and only once something re-derives it.

### 5.2 Sizing liquidity from the declared stake

Certification is a relation, not a badge:

```
Certified(ε, S)  iff  C_disp(ε) ≥ SECURITY_FACTOR · S               (SECURITY_FACTOR = 3, kernel K)
```

**The predicate is over `C_disp` alone, never over `ManipFloor̂`.** `ManipFloor̂ = C_disp + C_hold`,
and `C_hold` is a **measured** contest-capital term — so certifying against the total would let an
underfunded client acquire the published certificate out of *organic trader activity*, which is
precisely the liquidity-cannibalization design §8.4 refuses. The published `ManipFloor̂` and the
certification predicate are therefore **different quantities with different jobs**: the first is the
diagnostic the client is sold, the second is the admission gate, and only the second is restricted
to client-funded depth. An earlier revision defined `Certified` over the total and contradicted
§8.4; corrected 2026-08-01.

At registration `V_win = 0`, `p̄ = 0.5` and both books carry the same `b`, so `C_hold = 0` and the
requirement solves for the client's minimum subsidy:

```
b_min(S, ε) = ceil( 3·S / ( 2 · ln( 0.5 / (0.5 − ε) ) ) )
```

| ε | `b_min` | superseded (displacement form — do not use) |
|---:|---:|---:|
| 0.02 | **36.75·S** | ~~18.74·S~~ |
| 0.05 | **14.24·S** | ~~7.48·S~~ |
| 0.10 | **6.73·S** | ~~3.70·S~~ |

Rounding is **up**, always, and the two-decimal figures above are rounded up from 36.7449 / 14.2368 /
6.7221 for exactly that reason: a `b` rounded down is a certificate that does not hold.

**An uncomfortable cross-check that belongs in the specification rather than in a footnote.**
Bleavit's own PARAM decision pair reads `ManipFloor̂ ≈ 1,559` (at `b` = 10,000/book, δ = 0.0375,
p̄ = 0.5, `V_win` = 0) against `3 · sec.prize.param = 150,000` — nearly two orders of magnitude short,
which is precisely the condition §5.6's escape clause anticipates. The honest consequence is stated,
not smoothed: **a certified external question must be subsidized far more heavily per unit of stake
than Bleavit subsidizes its own decisions**, because Bleavit's own security additionally rests on
`dec.v_min` capital floors and a 72 h dispute window that a client does not buy. A client paying for
`Certified` is buying a *stronger* guarantee than Bleavit gives itself, and is charged accordingly.

**Under-declaration is self-defeating by design.** Bleavit certifies a relation and republishes `S`
verbatim; the absolute USDC figure is primary and the badge derived; and because instrument D's rate
rides on `declared_stake` (§8), under-declaring saves fee but forfeits both the certificate and the
required `b`. **Deliberately rejected:** letting a client meet certification with *measured* depth
instead of its own posted `b`. That is the cannibalizing design — see §8.4.

---

## 6. Settlement — the client's bonded report, in its own pallet

### 6.1 Why this does not run in `pallet-oracle`

Two reasons, both about **shared** resources. (An earlier draft gave three more; they did not survive
verification and are recorded as withdrawn in §6.2, because a design defended by a wrong argument is
one correction away from being reopened for the wrong reason.)

1. **The oracle's discipline parameters are chain-wide, with no per-question override.**
   `orc.rounds`, `orc.bond_bps` and `orc.reporter_stake` are single META keys governing *every* game
   on the chain. An external question's honest `Δs_max` is 10,000 bps — a lying reporter moves `s`
   from 0 to 1, and there is no client-declared `at_risk` to substitute, because the client **is**
   the adversary the parameter binds. [07](./07-oracle-and-disputes.md) §6.3's coverage rule
   `(2^R_max − 1) · orc.bond_bps ≥ Δs_max` *is* satisfiable at that value — at `R_max` = 4 it needs
   667 bps against a hard max of 1,000 — but only by **raising Bleavit's own reporter bond from 250
   to 667 bps and adding a round to every Bleavit dispute**. Hosting external questions inside the
   oracle is therefore possible only by degrading the economics of Bleavit's own oracle. That is a
   real cost paid by the wrong party.
2. **Reporter-registry contamination.** `orc.reporter_stake` is staked against *Bleavit's* welfare
   components, and [07](./07-oracle-and-disputes.md) §3's offense ladder is a property of the account
   across the whole chain. A reporter ejected — permanently — over a false **external** report is
   thereby made unavailable for Bleavit's own welfare measurement. The chain would be spending its
   scarcest security resource on a tenant's dispute.

### 6.2 Withdrawn arguments (recorded, not deleted)

Three further reasons appeared in the design draft and are **false**. They are kept here because the
correct scope of a boundary is easier to defend when the failed arguments for it are visible:

- *"§6.3's coverage rule is structurally unsatisfiable at `Δs_max` = 10,000."* **False.**
  `ORC_ROUNDS_MAX = 4`, so the requirement is 667 ≤ 1,000 bps. Satisfiable — expensively, and for
  Bleavit rather than for the client, which is reason 1 above.
- *"`MAX_ROUNDS = 128` makes external games a DoS on Bleavit's own settlement."* **False.** 128 bounds
  *concurrent* games; filling it yields `RoundLimit` on new reports, not a settlement wedge.
- *"`Δs_max` is the report's range."* **False.** `Δs_max` is settlement *impact*, which is what makes
  reason 1's arithmetic work at all.

### 6.3 The game that does run, in `pallet-question-service`

The same shapes as [07](./07-oracle-and-disputes.md), with **zero new values-layer keys**:

- The realized value comes from a **client-named bonded attestor set**, `n ≥ 3`, settling on the
  **median** of a `⌈n/2⌉` quorum.
- Bond shape is 07 §7's value-scaled filing bond verbatim:
  `max(reg.bond_milestone, ceil((2^orc.rounds − 1) · orc.bond_bps · escrowed / 10_000))`.
- The window is `orc.window` (72 h, D-18-frozen).
- Deviation beyond tolerance is slashed on 07 §5.5's 40/60 split.

**Four details the first draft left open, ruled here rather than deferred (2026-08-01, raised by
the N5 implementation pass).** Each was reachable by an implementer making a reasonable choice, and
each reasonable choice was different from the others' — which is exactly the state that produces a
Rust/Python divergence nobody notices.

1. **The median of an even quorum settles on the arithmetic mean of the two central values,
   **floored** to [05](./05-welfare-and-decision-engine.md) §4.4's `1e9` grid.** Two reasons, and
   the first is dispositive: every settled value MUST lie on that grid, so an unfloored mean is not
   a representable settlement value at all. The second is direction — flooring is R-7's rounding
   against the party who gains from a higher settlement.
2. **The median is taken over *every* in-window submission from a named attestor, never over "the
   first `⌈n/2⌉`.**" A first-`q` rule is order-dependent, and transaction ordering is not a property
   the client or Bleavit controls — a collator could select which attestors count. `⌈n/2⌉` is the
   **threshold to settle at all**, not a selection rule. Duplicate submissions from one attestor
   collapse to that attestor's latest.
3. **The deviation tolerance is a per-question field frozen at registration**, bounded by a kernel
   constant — **not** a `Params` key. It is part of what the client buys, and a values majority that
   could widen it after trading opened could retroactively excuse an attestor the client had
   priced. Same argument that keeps `SECURITY_FACTOR` kernel (§8, TH-73). **It is therefore in §5's
   `Report` and bound into `provenance_hash`**: settlement takes tolerance as an *argument*, so a
   report that omitted it would let a widened value pass unnoticed by any client verifying the
   pushed or pulled report. Freezing a promise the buyer cannot check is not freezing it.
4. **`provenance_hash` is `blake2_256` over a domain-separated SCALE preimage**, separator
   `b"bleavit/hosted-report/v1"`, covering every field of §5's `Report` including `sub_id`. It is
   read cross-chain, so it is [02](./02-integration-contract.md) contract surface, introduced at
   v21 and byte-identical at current v22; a client verifying a report by storage proof recomputes
   exactly this.

**Bond custody and report authentication (normative N7 ruling).** Registration stores the named
set and freezes the per-attestor bond computed from the formula above. The set is bounded to **16**,
reusing the existing 16-seat attestor-roster envelope rather than introducing an uncalibrated
values key. Each named local `AccountId` must call `bond_attestor(question_id)` and transfer that
exact amount of USDC into question-service custody; `open` refuses `AttestorBondInsufficient` until
all named accounts have done so. Thus trading never opens against a merely promised set, and the
pallet never debits an attestor on a client's unauthenticated instruction. After `Sealed`, a named
attestor submits signed values until the half-open deadline `[sealed_at, sealed_at + orc.window)`;
only its latest in-window value is retained. Settlement is permissionless at or after the deadline.

On a valid median, every reporter outside the frozen tolerance forfeits its full per-question bond.
Forty percent of each forfeiture is divided equally, rounding down, among named reporters whose
latest value is within tolerance; the division remainder and the other sixty percent go to
INSURANCE. If there is no within-tolerance recipient, all proceeds go to INSURANCE. Every other
bond is returned to its owner. A VOID with no valid median returns all bonds: §5.5 prices an
identified wrong side, and absence alone identifies none.

The registration-frozen tolerance is bounded to **0.25** on the `1e9` grid, the existing maximum
service-resolution envelope. The unsafe direction is upward (it excuses larger deviations); the
bound is kernel-fixed and therefore cannot be widened after a market opens.

**Why a median rather than a self-report with a challenge window.** A lie detector needs an
adjudicator, and this game has none by construction — sending a client's disputed foreign fact to
Bleavit's VIT electorate is exactly the contamination §6.1 refuses. Without an adjudicator,
"challenge ⇒ VOID, both bonds refunded" makes lying strictly dominant, while "challenge ⇒ reporter
forfeits" destroys an honest client with one griefing challenge. A median over ≥ 3 independently
bonded parties is the only construction that **prices one deviant and survives one absence**.

### 6.4 VOID is the universal failure edge

Not a settlement mode — the failure edge for *every* path: no quorum, median out of range, deadline
missed, service paused, escrow insufficient, attestor set collapsed.

**`ClientUnreachable` is reserved and has no on-chain producer (N7 ruling, 2026-08-01).** The frozen
`VoidReason` variant introduced at contract v21 remains byte-identical and append-only at v22, but egress reachability cannot produce it:
§9/I-36 requires push outcome to be best-effort and never read back into protocol or welfare state, registry
removal deliberately does not VOID, and settlement needs no live client call. Emitting the variant
from any of those facts would contradict those stronger rules. It MUST remain unproduced unless a
future contract-versioned amendment defines an on-chain reachability predicate independent of send
outcome.

**Registry removal is deliberately NOT on that list**, and an earlier revision listed it as "client
deregistered", contradicting §2 one section over. The two rules must agree, and §2's is the one that
survives: removal refuses *new* registrations and lets live questions reach their own terminal
state, because VOIDing them would change trader payouts and could destroy an **unsealed** report the
client has already paid for — on a values-track vote the traders had no part in. The immediate lever
is the guardian pause of §10, which VOIDs by design and is bounded; a values-track removal is not an
emergency and MUST NOT act like one. All take the existing D-1 path already proven by I-26/I-27, PT-6 and the TLA⁺ witness
configs. Redemption is at par.

### 6.5 The residual trust, stated and priced

**A client controlling a majority of its own named attestors can move `s` and pay itself from the
winning branch.** This is a trust model, not a mechanism, and it is not repairable inside this design
— the alternative is Bleavit adjudicating foreign facts, which §6.1 refuses for stronger reasons.

What bounds it: the blast radius is **that question's own escrow**, minus forfeited bonds, with
Bleavit's ledger instance and every Bleavit market untouched.

What is owed instead of a fix: **legibility**. The report carries `SettlementTrust { attestors,
quorum, bond_total }` as a first-class field, so a client that names one cheap attestor gets a report
that *says so*, and a counterparty pricing that report can see what it is trusting. Bleavit's
obligation here is to make the risk visible and priced, not to eliminate it — and a venue whose
settlement the asker can capture is a product judgement that this document states plainly rather than
buries.

---

## 7. Segregation — a second ledger instance

### 7.1 Why an instance and not a vault family

A domain-tagged third vault family inside instance `()` is **wrong**, and the reason is I-4/L-2
itself: [03](./03-conditional-ledger.md)'s solvency invariant is
`TotalEscrowed + held_deposits ≤ balance(sovereign)` — stated against *the* sovereign account,
**singular**. Under shared custody an external-domain deficit is masked by Bleavit's surplus until
the *combined* liability exceeds combined custody, i.e. **until Bleavit's own traders are already
unbacked**. Worse, the I-4 latch and `PB-LEDGER-FREEZE` eligibility key on that same global
comparison, so an external failure would halt **Bleavit's own ledger**.

Instead: `pallet-conditional-ledger` becomes `Config<I: 'static = ()>`, with
`ServiceLedger = pallet_conditional_ledger::<Instance1>` holding its own `PalletId`-derived sovereign.
`pallet-registry` is the existing precedent in this runtime (`IncidentRegistry` = 56,
`MilestoneRegistry::<Instance1>` = 57).

What instancing buys, none of which requires a new invariant:

- **Per-domain solvency is the existing invariant, evaluated twice.** `try_state` runs per instance,
  so L-1…L-7 hold per domain with no new assertions written.
- **`crates/conditional-ledger-core/` needs no semantic change.** `LedgerState<AccountId>` is already
  an owned aggregate with no globals or statics; two instances hydrate two aggregates. (The FRAME
  *shell* does need the full `Config`/`Pallet<T>` → `Config<I>`/`Pallet<T, I>` conversion — that is
  the actual work of N2, and it is why N2 lands alone.)
- **`models/tla/ledger` stays valid verbatim** for each instance — it models one vault in one ledger,
  and two disjoint instances are two independent copies of an already-proven model. It is *not*
  sufficient on its own: it has no domain dimension and its `Transfer` is unrestricted between
  modelled holders, so a **two-instance composition model** is owed alongside it, proving separate
  custody and the union destination firewall of §7.2.
- Instance `()`'s storage prefix is unchanged and the chain is pre-genesis, so **no migration**.

**Defense in depth: a disjoint id band.** `kernel::SERVICE_ID_BASE = 1 << 63`; `pallet-epoch`'s
allocator asserts `id < SERVICE_ID_BASE` and the service allocator starts at it, so every mis-route
errors `UnknownVault` by construction at zero runtime cost. The service allocator is one monotone,
non-reusing namespace across question and book ids; pair creation and try-state reject a question,
Accept id or Reject id that duplicates any role in a retained pair. The property is only as strong
as those boundary checks, so both domains carry a try-state assertion.

Routing is **one** small, exhaustive, fuzzable `LedgerRoute::for_book(kind)` in the market shell — a
single auditable dispatch point for the entire firewall.

### 7.2 `ProtocolAccounts` is three predicates, not one

[03](./03-conditional-ledger.md) §3 currently makes one enumerated set serve three jobs. With two
instances that is not merely untidy — it is wrong in **both** directions at once:

| Predicate | Membership | Job |
|---|---|---|
| `ReservedProtocolDestinations` | **union** across every instance and domain | §5.4's signed-transfer destination refusal |
| `ProtocolAccounts<I>` (the local predicate) | **per instance** | fee, storage-deposit and position-cap exemption; internal custody |
| `InflowCapExemptAccounts` | separate, globally governed | Phase-3 inflow metering |

Get it **per-instance for destinations** and a service position can be transferred into a primary
book address that no service origin can redeem from — escrow stays solvent, the position is stranded
until archive. Get it **union for exemptions** and foreign-domain accounts inherit zero deposit, no
64-position cap and redemption-fee exemption.

The runtime already demonstrates that the split is real: treasury `MAIN` is in the ledger's
`ProtocolAccounts` and **deliberately excluded** from `InflowCapProtocolAccounts`.

**`Question.client` MUST be asserted outside all three sets** at registration, or a client account
becomes fee-exempt, deposit-exempt and an invalid transfer destination simultaneously.

Here `Question.client` means the authenticated funding account, not the compact `ClientId`: the
exact `local_signer` for local transport, or the local sovereign account derived from the record's
exact XCM `Location`. The caller never supplies this account. `register` derives it from `Clients`
and passes that immutable account through pair creation and seeding; an arbitrary `funder` argument
is not part of the question-service call surface.

### 7.3 Funding is a typed domain, and refunding a client needs its own capability

**`PolLine::of(kind)` must not survive as a total function over a widened `BookKind`.** `market.seed`
calls `debit_pol_custody(PolLine::of(book.kind), headroom)` and `insert_pol_commitment`
**unconditionally**; a new `External` arm inherits both. The correct shape is a typed funding domain:

```rust
enum FundingDomain { Protocol(PolLine), ExternalClient(ClientId) }
```

with **only** `Protocol(_)` touching `LivePolCommitments` or any treasury line.

External funding is pair-atomic and consumes `2·b·ln 2` cash, not merely two independently marked
single-book calls. Two top-level splits are made from the immutable funder; all four minted branch
legs leave that signable account in the same storage transaction. Each matching book scalar-splits
one `b·ln 2` branch headroom and retains the other as raw same-branch inventory until terminal Sweep.
Leaving the two mirror legs with the client would let it immediately `merge(question, b·ln 2)`,
reclaim half the certified subsidy while both books still reported Seeded; leaving them outside the
book return path would instead donate them to archive dust. Either result is a certification defect.

The naive-arm failure is worth stating precisely, because the obvious description of it is wrong.
`debit_pol_custody` **moves no tokens** — it decrements an internal treasury line — so a misclassified
external book does *not* book client capital as Bleavit NAV on the way in. The full-cycle NAV error
is `r − h` (the external maker's P/L): understated when the book loses, **overstated when it wins**,
and overstatement is the unsafe direction because every NAV-derived control (`trs.cap_proposal`·NAV,
`pol.budget_epoch`·NAV, the [08](./08-treasury-and-economics.md) §4.1 arming floors) is then computed
on capital the treasury does not hold. It is the I-33 defect's *neighbour*, not its recurrence.

**A harder blocker sits behind it.** `withdraw_book`'s return path requires
`is_protocol(holder) && is_protocol(recipient)` — and §7.2 requires `Question.client` **not** to be a
protocol account. So the client's unspent subsidy cannot be refunded at all: the whole sweep rolls
back. The resolution is a **narrow exact-funder return capability** — the book stores its immutable
funder at creation and may return inventory to *that account and no other* — never a
protocol-classification exemption, which would re-open every hole §7.2 just closed.

### 7.4 Fee ownership is explicit, because silence would appropriate it

`market.sweep_revenue`'s fee leg runs "for every book" and routes to Bleavit `MAIN`; the ledger's
redemption-fee sweep does the same. Adding `BookKind::External` without saying anything would
therefore make Bleavit collect the trading and redemption fees of client-domain books **by
accident**.

That is in fact the intended commercial arrangement — instruments A and B are how hosting pays (§8) —
but it MUST be **specified**, not inherited. Normatively: trading fees (`mkt.fee`) and redemption fees
(`ledger.redeem_fee`) on external books accrue to Bleavit `MAIN` as service revenue; the client's
**subsidy** does not, and returns to the client under §7.3. A client integration document that failed
to state this would be misrepresenting the price.

### 7.5 The dust sweep must be domain-keyed

`pallet-market`'s reap-eligibility guard knows only proposal and Baseline market indexes. A vacuous
`true` for an external question would let the service ledger's archive sweep transfer residue to
`InsuranceAccount` **before** the client subsidy return of §7.3 — Bleavit quietly absorbing client
capital through a path designed for worthless dust. The guard is keyed on instance and domain.

### 7.6 Two books per question, never six

Gate books settle on Bleavit's own `S_daily`/`C_daily` breach facts ([04](./04-markets-and-pricing.md)
§9) — facts *about Bleavit*, meaningless for a client, and the first place an external outcome would
touch Bleavit machinery. No Baseline book either: the Baseline forecasts Bleavit's own `s_e`, and the
client's own rule supplies its floor. This halves occupancy and removes `settle_gate` from the
external domain entirely.

---

## 8. Revenue

### 8.1 Instrument D, and the three that already work

Three of four revenue paths need **no new code**: external books generate instrument **A**
(`mkt.fee`, routed to `MAIN`) and **B** (`ledger.redeem_fee`) because those apply to any book (§7.4),
and client messages generate **C** (the weight-trader fee). Only **D** is new:

```
fee(q) = max( svc.fee_floor ,  svc.fee_bps × declared_stake )      // charged once per QUESTION,
                                                                    // earned at `Sealed`
```

**Once per question, not once per market**, and the distinction is not pedantic: a question carries
**two** books (§7.6), so a literal per-market reading doubles both legs against the very arithmetic
that sizes them — §8.2 values the rate leg as one `svc.fee_bps · S`, and the floor is derived from a
per-**question** crank load and a per-**question** slot cost. An earlier revision said "per market
created" and would have charged 2× what §8.2 justifies.

A two-part tariff, which is what makes it simultaneously a per-market charge and incentive-compatible
with honest `declared_stake`.

| Leg | Derivation |
|---|---|
| **Floor** | Marginal cost is the keeper crank load: `2 · ceil(svc.max_window / mkt.obs_interval) · keeper.rebate` = `2 · 30,240 · 0.000255` = **15.42 USDC/question** at a full-epoch window. Fully-allocated recovery is `C ÷ (svc.max_live × epochs/yr)`; at `C` = 109,281 ([08](./08-treasury-and-economics.md) §10.1), 17.39 epochs/yr and 16 slots that is **≈ 393 USDC/question**. The floor is anchored to fully-allocated cost, not to marginal cost — a slot is scarce, and pricing scarce capacity at marginal cost prices it at zero. Ships as a kernel constant |
| **Rate** | **Not derivable from anything in this repository** — it is a market price for a service nobody has sold, so R-2's escalation clause applies and the value is the user's. **Adopted at 1,000 bps on 2026-08-02** (the row max; see [13](./13-parameters.md) §1). Before adoption the key was absent from the registry entirely, `fee_rate()` returned `None`, and `register` refused `ServiceRateUnset` — so the absence, not a `PhaseFlags` bit, was the arming gate, and the 02 §7.3-frozen bitset never widened. **Seeding the row is what arms the service.** At the ceiling the ×2 max-Δ is exercisable downward only |

### 8.2 What instrument D is actually worth — corrected

An earlier draft claimed a certified question carries `H_q ≈ 3S/ε` (60·S at ε = 0.05), making D
"≈ 2 % of what hosting the question earns". **That derivation does not hold.** It requires
`AttackCost = ε·H`, a relation this repository never states, and it silently assumes organic trading
depth that certification explicitly refuses to count (§5.2).

What *is* derivable is the client's **own posted escrow**, which certification forces. The cash is
**not** `b` — [04](./04-markets-and-pricing.md) §2 mints "per-book headroom `b·ln 2`" and §3 sizes
`b = SubsidyBudget / ln 2`, so the posted subsidy per book is `b·ln 2`:

```
client subsidy at ε = 0.05  =  2 · b_min · ln 2  =  2 × 14.2368 × 0.693147 · S  =  19.736·S
```

*(An earlier revision wrote `2·b_min = 28.5·S`, conflating the LMSR liquidity parameter with the
cash that funds it — the same class of error as SQ-562 one layer up. Corrected 2026-08-01; every
figure below is the corrected one.)*

At `ledger.redeem_fee` = 30 bps and β = 0.50, instrument **B** on that escrow is `≈ 0.0296·S`,
against instrument **D** at the adopted 1,000 bps of `0.100·S`. **Instrument D is therefore ≈ 77 % of
the evidenced per-question revenue.** (At the 100 bps this section illustrated before the rate was
adopted, D would be `0.010·S` and ≈ 25 %; both figures are far above the ≈ 2 % the superseded draft
claimed.) Note that at 1,000 bps the `svc.fee_floor` leg binds only below `S` = 3,930 USDC, so for
any consequential question the rate leg is the whole price. The correction *raised* D's share, so charging per
question is more load-bearing than either draft made it look.

> **The honest division, and it must be stated this way round.** The *evidenced* revenue is D plus B,
> both computable from capital the client is contractually required to post. Instrument A — trading
> fees on external order flow — is the larger term **if** external traders show up, and this
> repository has no evidence that they will. [15](./15-invariants-and-testing.md) §4.9's simulation
> **cannot** test the demand hypothesis, because its flow is keyed to `dec.v_min`. So "the external
> order flow is the revenue" is a hypothesis about a market, and MUST NOT be presented as a forecast.

### 8.3 Four caveats that bind

1. Every occupancy figure is conditioned on external demand this repository has no evidence for.
2. [08](./08-treasury-and-economics.md) §10's rule binds verbatim: *"Bleavit is not self-funding at
   launch, and cannot be … Any statement that the protocol funds itself from block one is false and
   MUST NOT be made."* Hosting does not change this.
3. `phase3.tvl_cap` = 2,000,000 is a **shared** meter, and the corrected escrow **reverses** what
   an earlier revision concluded here. A certified `S` = 100 k question at ε = 0.05 needs
   **1,973,644** — it fits, with 1.3 % of the cap to spare, where the superseded 2.85 M figure said
   it could not. That is a thinner result than it sounds: the cap is **shared with every other
   inflow**, so one such question consumes essentially all of it and a second is unreachable.
   `register` MUST therefore meter the client's escrow against the **live** remaining cap rather
   than against the constant, and MUST refuse while the cap is not the unbounded sentinel unless
   that live check passes.
4. The combined crank load is **2.667×** the existing full-window figure at saturation, not the 1.67×
   an earlier draft claimed. §8.5's quota is sized against the corrected number.

### 8.4 Liquidity cannibalization

Bleavit's governance quality is literally a function of trader capital in its own books
(`dec.v_min` per book, else `NotDecisionGrade`). Diverting capital from a PARAM decision pair costs an
attacker only round-trip fees — **governance denial at a price that does not exist in the system
today.** Mitigations, primary first:

- **Structural:** certification counts **only client-funded** `C_disp`, never measured depth. A
  certified question must post its own `b_min`, so external questions are net capital **importers**
  rather than competitors. The cheaper alternative — letting organic depth satisfy certification —
  *is* the cannibalizing design, and is refused.
- **Scheduling:** `register` refuses a window intersecting any live proposal's decision window.
  Honestly: this reduces but does not close the harm.
- **Arming:** `Σ b_ext ≤ Σ pol.b(live)` at switch-on, so the external side is never the dominant
  market on the chain.
- **Measurement with a stated falsifier:** per-epoch Bleavit vs external contest capital and the
  `NotDecisionGrade` rejection count on the monitoring-only `TelemetryApi`. **Implemented** as that
  API's `service_partition` row (v5): live hosted-question count, the live `svc.max_live` it is
  measured against, external posted subsidy in the units `LivePolCommitments` stores, the
  `NotDecisionGrade` count **over the retained cohort window** — a moving window is what "rise with
  external occupancy" is a claim about, and a cumulative counter would need new storage on
  `decide()`'s hot path to say less — and §8.5's external-quota utilization. The two must be read
  **together**: this section's own point is that a rejection caused by the service is
  indistinguishable from one caused by disinterest, so the capital is the trigger and the rejection
  count is corroboration. If rejections rise with
  external occupancy, the values layer **MUST** reduce `svc.max_live`. **That obligation is no longer
  the only response, and is no longer the first one** — it asks for a vote at exactly the moment
  revenue argues the other way, on evidence that will always be arguable, in a system whose every
  other protection (the I-4 latch, PB-LEDGER-FREEZE, the dead-man switch) is automatic. §8.7 makes
  the first response automatic and graduated. The vote remains available and remains the only thing
  that can move the **quantity**; §8.7 moves the price.
- **Recalibration:** the Phase-0 calibration assumed no competing venue, so S4 re-run with a
  competing-venue term is a **Phase-4 arming condition** — if external markets divert flow, the
  calibrated δ is under-sized. **The term is now executable** ([15](15-invariants-and-testing.md)
  §4.9; milestone N12): the artifact carries a `competing_venue` block whose arming rung is
  **anchored** to the arming condition immediately above rather than derived from it. That condition
  bounds external **depth** at parity; turning it into a bound on **flow** takes a behavioural model,
  and proportional-to-depth allocation puts the anchor at **one half**. The model's error direction
  is **unsafe** — an equally deep venue with better fees or returns can take far more than half the
  flow — so the ladder **MUST** probe above the arming rung and the artifact publishes that stress
  verdict beside the arming one. The term thins organic
  formation on decision, gate and Baseline books while leaving attacker budgets untouched. Arming
  reads **both** its halves: the *security* half gates (per-class decidable-harm false-pass < 1 % at
  the arming rung, else δ rises before the service arms), and the *liveness* half — decision-grade
  formation loss, which is TH-72's actual named harm — is measured against the falsifier stated in
  the bullet above, with no invented threshold. **A clean security half alone is not a clean
  result**: diversion denies decisions before it corrupts them, so a false-pass-only reading gets
  *better* the more governance the diversion destroys.

**Accepted residual:** informed-attention diversion is invisible to `dec.v_min`, which measures
capital rather than information, and nothing in this repository can measure it.

### 8.5 The one channel that cannot be firewalled — and is quota'd instead

External load reaches Bleavit's welfare through **`H`**, the weight-headroom sub-metric of
[05](./05-welfare-and-decision-engine.md) §4.3: its producer samples `block_weight().total()` at
finalization, so **every** successful external dispatch contributes to the physical/diagnostic
sample. No import lint closes a resource-consumption channel. After the partition, that total sample
is not itself the welfare input: `H` uses the separately accumulated `PrimaryUsed`, while the total
remains available to prove that external work was physically charged.

Two qualifications matter for sizing, and an earlier draft had both wrong: `H` **clamps to 1** at physical
mean utilization ≤ 40 %, so external work moves nothing until physical utilization crosses that target; and
`0.15` is a **geometric-product exponent**, not a 15 % linear share of `W`.

**Naive exclusion is unsafe and is refused.** Subtracting service-pallet weight from the numerator
would let external calls fill blocks while `H` reports full health — a worse failure than the one it
fixes. The defensible shape is a **resource partition**:

- hard per-block external quotas in **both** ref-time and proof-size;
- reserved primary/system capacity that external work may not borrow;
- a separately accumulated `PrimaryUsed` including system overhead;
- `H` computed in the physical `max_block` coordinates from the primary-only accumulator, with the
  same two-dimensional max reduction as the total sample and full top-level post-dispatch accounting
  (nested ledger work, failures, refunds, base-extrinsic weight).

The initial runtime binding derives the two reservations from the existing block envelope; it does
not add a values-layer quota key. `ExternalCapacity` is the pre-existing
`RuntimeBlockWeights::Operational.reserved` `Weight` (the complement of the existing 75% normal
dispatch ratio) in **both** dimensions, and `PrimaryCapacity` is `max_block − ExternalCapacity` in
both dimensions. The normal-class `max_total` is exposed to the physical block only so the ordinary
`CheckWeight` extension cannot reject an external call before this partition runs; the partition's
side admission is authoritative, so that exposure does not permit borrowing. `PrimaryUsed` is then
converted back to the physical coordinate by the same shared `block_utilization(used, max_block)`
helper used for the total diagnostic. No separately rounded scale or target is materialized, so with
zero external usage the H value is bit-identical to the pre-partition formula on the entire 1e9 grid.

**The external set is a *resource* domain, and deliberately not the authority domain.** The safety
classifier ([06](./06-governance-and-guardians.md) §3) answers *who may call*; this partition answers
*whose budget pays*. A hosted question generates far more work than the client's own authenticated
calls, and almost all of it arrives as ordinary signed dispatches: a trade in a hosted book, a
hosted-ledger split or redeem, and every permissionless crank of the settlement game. Charging those
to the primary side would leave hosted **volume** — by far the largest term — moving `H`, which is
precisely what this section exists to prevent. A call is therefore external when any of:

1. its authority domain is `ExternalClient` — the client's own calls; or
2. it belongs to a pallet that exists only for the hosted domain — the hosted ledger instance
   (§3) and the question service; or
3. it names a market whose immutable `BookKind` is `External`.

subject to one overriding exception: **emergency and governance authority is never external**,
whichever pallet it lives in. A saturated client quota must never be able to block Bleavit's own
pause, freeze or recovery act — the direction R-7 forbids, and the same reasoning that exempts the
three residual dispatch paths below. Rule 3 costs one storage read of an immutable field, and the
runtime's match over market calls MUST be exhaustive, so that a market call added later fails to
compile rather than silently defaulting to the primary quota.

**A wrapper carrying hosted work MUST be refused, not classified.** The partition reserves against
exactly one side per top-level dispatch, so a [06](./06-governance-and-guardians.md) §3.3 wrapper
whose leaves include hosted work cannot be accounted honestly on either side, and **both** wrong
answers are unsafe: charging it to the primary side launders hosted volume straight back into
`PrimaryUsed` and therefore into `H` — reopening this section's whole subject, and at the primary
budget rather than the client quota — while charging it to the external side hides any primary
leaves from `H` and overstates the chain's health. So the shape is refused. This is a
resource-accounting refusal and not an authority one: the same calls submitted as separate
extrinsics are always admissible, and a wrapper carrying no hosted leaf is entirely unaffected. The
walk covers the closed wrapper set at every nesting depth under the projection's own budget, and a
depth overrun refuses rather than admits.

Operational and Mandatory calls are exempt from this extension's *refusal* path: FRAME's own class
budgets govern whether they dispatch, and their weight is still attributed to `PrimaryUsed` by the
residual fold. External calls remain partitioned even if their dispatch metadata names one of those
classes.

Raising `Normal.max_total` to the full physical block remains necessary after that exemption: a
Normal external call must reach this extension's side quota instead of being rejected by FRAME's
old 75 % structural ceiling. **`Normal.max_total = 100%` is not a FRAME-level 75/25 guarantee.** The
75/25 split is enforced by the extension for extension-traversing external dispatches and by
authority-gating for the residual paths below. Signed external calls are structurally routed through
the runtime's `TxExtension`, and external XCM calls through `ResourcePartitionCallDispatcher`.

Three Normal dispatch paths intentionally bypass both the extension and the XCM dispatcher:

1. the SDK scheduler's direct dispatch, reachable only through the runtime's
   `InternalSchedulerOnly` origin and therefore only from governance/internal referenda;
2. the `ExecutionGuard` queued-payload path, whose permissionless `execute` trigger can be called by
   anyone but whose payload was already governance-authorized and is re-derived by the guard; and
3. the guardian emergency-playbook path, whose five-of-seven council approval constructs the bounded
   payload before the runtime dispatches it.

None is reachable by an external client, and no unprivileged account chooses its payload. Adding a
refusal cap to these paths could block emergency recovery while the cap binds, which is the unsafe
direction under R-7. Their registered weight still reaches `PrimaryUsed` through the residual fold.
The runtime's N7 tripwire inventories every local raw dispatch site and freezes the scheduler's
authority binding; the SDK's internal scheduler dispatch is not source-visible, so that binding is
the mechanizable limit of the tripwire.

For a signed extrinsic, the partition extension captures the pre-`CheckWeight` total, refuses an
over-quota side before dispatch, reserves the full top-level charge, and settles the reservation
after `CheckWeight`/storage-reclaim post-dispatch accounting. A successful call releases only the
reported actual refund; a failed call retains the complete reservation. XCM `Transact` uses the
same reservation and refund adapter because it has no signed-extension pipeline. Work not attached
to a top-level dispatch is residual system overhead and is attributed to `PrimaryUsed` at
finalization. Thus the external side cannot fill the primary reservation, while primary/system
overhead cannot disappear from `H`. Because FRAME Mandatory/system registration is unchecked, the
partition ledger's `PrimaryUsed` counter is a saturating physical-coordinate **upper-bound estimate**:
primary-at-cap plus Mandatory work may exceed the physical max in FRAME's own accounting, but the
partition counter clamps rather than implying a combined-envelope guarantee. The total diagnostic
sample remains the actual clamped physical utilization.

The extension's **own** bookkeeping is declared at its enumerated worst case over **both** entry
points — the signed-extension pipeline and the XCM adapter, whose access sets differ — not at the
storage touched by any single hook of either, and it is charged to the same side as the call it
partitions. Under-declaring it would be unsafe twice over: it understates what `CheckWeight` books
into the block, and — because the same figure sizes the reservation the XCM adapter makes — it would
hand the external side quota it never paid for. The classification's dynamic book-kind lookups are
declared **per call** rather than as a flat worst case, because a wrapper performs one per market
leaf and a flat figure would tax every transaction for the rare batch.

**The partition bounds dispatch, not transport, and that limit is stated rather than implied.**
Everything above concerns work reached through a top-level dispatch. XCM *transport* work — message
queue servicing, decode, barrier evaluation, origin conversion, and the processing of a message
whose call is then refused by the safe-call filter — runs as `Mandatory` `on_initialize` work
attached to no dispatch, so the residual fold attributes it to `PrimaryUsed`. **A client's XCM
traffic therefore still reaches `H`**, and in the refused-call case it does so with no external
reservation at all.

This is a real residual and it MUST NOT be described as closed. Three things bound it, none of which
make it disappear: the exposure is capped by the message queue's configured `ServiceWeight`; `H`
clamps to 1 below the 40 % utilization target, so transport must first push total utilization past
that target to move anything; and the traffic is **priced**, since inbound execution buys weight
credit through the [09](./09-execution-upgrades-and-rollout.md) §6 trader at `xcm.usdc_per_sec` — it is not free
the way an unpriced channel would be.

Consequently [15](./15-invariants-and-testing.md)'s PT-10 byte-identical property is scoped to
**dispatch-attributable** service work. Closing the transport half requires attributing queue
servicing to the originating domain, which the message queue does not currently expose per message;
that is tracked as a spec question and is not claimed here.

`svc.max_live` MUST be sized so worst-case external load stays inside its quota. **There is no
measurement in this repository to size that against**, so the initial value ships conservative and
`[VERIFY]`-tagged, and PT-10 (§12) is what proves the partition holds.

**The P pillar needs the same exclusion, and it needs it now.** [05](./05-welfare-and-decision-engine.md)
§4.3's fees-paid, qualified-users and settled-value components are global-looking, and their producers
are **unimplemented** — so the exclusion must be specified before they are written, not retrofitted
after external activity has already inflated `P`.

**Metric provenance, structurally.** §4.1's exclusion — "no input may be a price from the protocol's
own markets" — already covers a Bleavit-hosted external book (it *is* one of the protocol's own
markets; only its economic ownership is external). The defect is that **nothing enforces it**:
`MetricSpec` carries a source *class* and an opaque `formula_ref` with **no provenance**, and while
unknown on-chain metric ids fail closed, **attested values are consumed generically by id**. So
`register_spec` MUST reject any component bound to a hosted book, across every instance and client,
and metric ids MUST carry runtime-owned provenance rather than a self-declared class. The production
id registry reserves `MetricId >= 0x8000` for hosted-book provenance; every such id is rejected for
all three declared source classes, while an unknown id below that boundary is unassigned and also
fails closed. The registry is keyed by id, not by client or ledger instance, so changing the client
or hosted ledger cannot evade the exclusion.

### 8.6 Admission under contention — a descending price, not a queue

`svc.max_live` bounds how many questions run at once. It does **not** say who gets
a slot when more clients want one than the cap admits, and until N14 the answer was
whichever transaction landed first. That allocates by latency, not by value: sixteen
low-value questions can lock out an important one, and a slot freed by a terminating
question is a race that a bot wins by construction.

**The rule.** The instrument-D fee of §8.1 is multiplied by a scarcity factor `M ≥ 1`:

```
fee(q) = max( svc.fee_floor , svc.fee_bps × declared_stake ) × M
```

`M` moves **up immediately when a question is admitted, and down only gradually
toward 1** — including after a question terminates and frees its slot. `M` is clamped
to `svc.price_cap` **on every read**, not only when it is written, because that row is
amendable: an amendment lowering the ceiling must bind a price that was already stored
above it. And the gradual descent runs on the window **in force when the price was
set**, carried in storage beside it — reading the live `svc.max_window` would let one
amendment lowering that row expire every outstanding price at once, and a governance
action is not a decay. The asymmetry is the whole mechanism, and each half is
load-bearing:

- **Down-moves are gradual, so immediacy costs money.** A freed slot's price
  descends from the pre-release level toward the post-release one rather than
  dropping to it. A client that must have the slot *now* pays the top of that
  descent; a patient client waits. This is the per-slot descending-price auction,
  and it prices sniping rather than forbidding it — a client that values the slot
  above the premium still wins it, which is the mechanism working.
- **Up-moves are immediate, so velocity is visible.** A burst of registrations
  compounds faster than decay removes it, so `M` reflects *how fast* capacity is
  being taken and not merely how much is taken. Occupancy alone is a state
  function with no memory: sixteen slots filled over three weeks and sixteen
  filled in one block would otherwise price identically.

**There is deliberately no starting price.** Each descent begins from the running
`M`, which *is* the accumulated record of prior demand. This differs from a periodic
sale with a controller-set opening price, and the difference is forced rather than
stylistic: hosted questions carry client-chosen windows and free asynchronously, so
there is no batch of identical units and no shared clock to open a sale on.

**Quantity is never market-discovered.** `svc.max_live` remains a governance-set hard
cap the mechanism can never sell past. Price clears; quantity does not. A
quantity-discovering controller — the shape Polkadot's bulk coretime sale uses, which
is correct where selling more capacity does not degrade the capacity already sold —
would make scarcity directly profitable here, and TH-73 names exactly that pressure.
[15](15-invariants-and-testing.md) §4.9's competing-venue leg measured why the two
cases differ: additional hosted depth degrades Bleavit's own decision formation.

**Where the premium goes: `MAIN`, with the rest of instrument D.** The whole scaled
fee is credited at `Sealed` and never before — the fee is refunded on VOID (§6.4), so
routing any part of it earlier would move money the client may still be owed.

An earlier revision of this section routed the amount **above** the floor directly to
POL, reasoning that the premium exists only when hosted questions contend for
capacity, which is when Bleavit's own books most need depth. **Implementation
refuted the routing, not the reasoning.** `pallet-market` does not hold Bleavit's
protocol subsidy custody account — `seed` receives it as a caller-supplied argument —
so a direct credit would require naming that account inside
`pallet-question-service`, opening a **second** money path into POL custody where
today there is exactly one: the §2 Sweep returning what POL itself spent. §7.2–§7.5
exist to keep precisely that class of cross-domain path from opening, and a
deliberate one is not safer than an accidental one merely because it was intended.
The premium is also **zero until `svc.price_cap` is adopted**, so the seam would be
dead code guarding a firewall it had already breached.

The intent survives the change of route. `MAIN` is where 08 §1.1's allocation to POL
is funded from, so congestion revenue still reaches depth — through a governed
allocation rather than an automatic side-channel, which is the more defensible of the
two given that the premium is collected at `Sealed` and the congestion it priced may
be an epoch old by then. And the premium stays **measurable with no new storage and
no new event**: `premium = fee − max(svc.fee_floor, svc.fee_bps × declared_stake)`,
and both the charged fee and the declared stake are already stored per question.

**`M` is inert until its ceiling is adopted.** The bound on `M` is a values-layer
number that nothing in this repository yet anchors — the natural anchor would be the
measured cost of governance denial, and [14](14-threat-model.md) TH-72's attack-cost
cell carries no figure (SQ-574). Until `svc.price_cap` is set, `M ≡ 1` and this
section describes today's behaviour exactly: the posted two-part tariff, first come
first served. That is the `svc.fee_bps` and `svc.client_bond` precedent — a row ships
unset with its consumer defaulting to the status quo rather than to a guess.

**Inert means the *charge* is unchanged, not the declared weight.** `register`'s
benchmark deliberately arms the ceiling, so the weight it declares always includes the
§8.7 probe's scan over the live decision pairs even while `M ≡ 1` and the scan does not
run. That is the intended direction: a weight declared for the armed case over-charges
the inert one, whereas benchmarking the unset row would under-declare the armed one on
the day the values layer adopted it, with no code change to notice (SQ-576). A claim
that this section is byte-for-byte invisible until adoption would be false, and the
visible residue is a fee-market cost, never a difference in what a client is charged.

Note the
consumer default here is `M = 1` and **not** a refusal: an unset ceiling must not
close admission, because the mechanism it gates is an allocation refinement and not a
safety gate, and refusing would be a strictly worse status quo than the one this
section replaces.

### 8.7 Starvation raises the same price, automatically

§8.4's fourth mitigation ends in *"the values layer **MUST** reduce `svc.max_live`"*.
As the only response that is a governance promise, not a mechanism: it requires a vote
precisely when revenue argues against one, on evidence that will always be arguable.
This section makes the first response automatic, and it deliberately reuses §8.6's
machinery rather than adding any.

**Trigger on the input, not the output.** A `NotDecisionGrade` rejection caused by the
hosted service is indistinguishable from one caused by nobody finding the proposal
interesting, so the rejection count can never settle the argument no matter how long it
is collected. Contest capital in Bleavit's own decision books *is* the quantity `dec.v_min`
gates on, so it is measured directly.

**The measure.** For each live Bleavit **decision** book, the time-averaged contest
capital accrued so far in its current window — the 04 §7a integral divided by the blocks
actually integrated, **not** by the full window width, since dividing a partial integral by
the full width would report every young window as starved. That average is compared with
the same per-proposal decision-grade contest floor the grading path uses, and the **minimum
ratio across books** is taken, because decision-grade is per book and one starved book
rejects the proposal. Starvation is `1 −` that ratio, clamped to `[0, 1]`.

**The response is graduated and applies to everyone:**

```
M = min( svc.price_cap ,  max( M_contention , 1 + starvation × (svc.price_cap − 1) ) )
```

Each half of that shape is load-bearing, and both were chosen against a specific attack:

- **Graduated, because a cliff is a race.** A binary latch creates the behaviour it
  exists to prevent: operators watching contest capital approach the threshold register
  *before* it trips, which is a burst of admissions at exactly the worst moment. A
  continuous response has no threshold to race.
- **The price rises for everyone, and the door never closes.** A latch that stops new
  registrations while live questions keep running pays a slot-holder to cause it: their
  slot becomes exclusive precisely when Bleavit is damaged, and §8.4 states that damaging
  Bleavit's books costs an attacker only round-trip fees. A price response admits every
  client that is willing to pay, so no entrant is excluded outright and the incumbent's
  own *next* question costs the raised price like anyone else's.

  **It reduces the incumbent's advantage; it does not eliminate it, and the earlier
  claim that it did was wrong.** The fee is charged once, at registration, so a client
  already holding a slot has already paid — any mechanism that raises the price of
  *future* registrations advantages those already in, and that is inherent to a one-shot
  fee rather than to this particular response. Concretely: an incumbent can hold a live
  question, keep its net position in a Bleavit decision book near zero so the §7a contest
  integral stays flat, drive the starvation reading toward 1 for round-trip fees, and
  price marginal entrants out while paying nothing more itself. What the price response
  *does* guarantee against the quantity latch it replaced is strictly weaker and strictly
  true: an entrant who values the slot above the raised price still gets it, where a
  latch would refuse it at any price. The attack also requires the attacker to actually
  suppress Bleavit's contest capital — the mechanism is responding correctly to a real
  condition, and `svc.max_live` still bounds how much of the service the incumbent can
  hold.
- **`max`, not a product.** One ceiling governs both terms, so `M ≤ svc.price_cap` holds
  by construction rather than by argument, and no second registry row is needed. A product
  would reach `svc.price_cap²` and would need its own bound to say what that means.
- **Starvation is read live and never stored.** §8.6's contention term is stored and
  decays; this one is a reading of present state. Folding it into the stored term would
  bake a transient starvation into a slowly-decaying price — hysteresis that nothing here
  asks for, and that would outlast the condition that justified it.

**What this is, stated honestly.** It is a Pigouvian charge, not a repair: it does not add
depth to a starved Bleavit book, and the revenue goes to `MAIN` like the rest of
instrument D (§8.6). What it does is make hosted capacity most expensive exactly when it
is most costly to Bleavit, and do so without a vote. The harm remains **bounded by
`svc.max_live`**, which this section does not touch — price clears, quantity does not,
and that separation is the same one §8.6 draws.

**Three limits, none smoothed over.**

1. **The quiet gap.** When no Bleavit decision book is live there is nothing to measure
   and starvation reads **0**, because at that moment the hosted service is provably not
   competing with a decision — but a client can therefore register into a quiet gap and
   contend with the windows that open afterwards. §8.4's scheduling refusal covers
   overlap with proposals live *at registration* and cannot see proposals submitted later.
2. **Un-accrued is not starved, and the probe cannot tell the difference.** Contest
   capital accrues only when a book is observed, so a book with no accrual at all is
   **skipped** rather than read as empty. This is deliberate: reading it as starved would
   fire the response at the first block of every window, before anyone has traded. The
   cost is that the probe under-reports — the *unsafe* direction — for a book nobody is
   cranking. That state is not left unprotected: a book without observations already
   fails decision-grade on coverage, so the proposal rejects through a different rule.
   Inferring starvation from a stalled crank would price a **keeper-liveness** failure as
   a capital failure, which is the wrong instrument, and drawing the line between the two
   needs a staleness threshold that nothing here derives.
3. **Inert until the ceiling is adopted.** The response magnitude is bounded by
   `svc.price_cap`, which is `[VERIFY]`-unset (§8.6), so this section is inert on exactly
   the same condition — one adopted row arms both halves of `M`, which is why no second
   row is introduced.

---

## 9. Egress

Both legs ship: the report is committed to storage and events **and** pushed to the client over XCM.

**A real problem was found and is designed around rather than accepted.** The runtime's router is
`HealthTrackingRouter<TopicRouter, XcmTrafficRecorder>`; a failed send calls `note_send_failure()`,
and §4.3 puts `X = accepted ÷ (accepted + local_failures + probe_timeouts)` into `C_onchain`. A client
that never opens — or later closes — its return HRMP channel would make every push fail `NoChannel`
and drive `X` down: **an external party moving a Bleavit decision input at zero cost**, which is
exactly what I-24 forbids.

Push therefore ships with four structural preconditions, together forming **I-36**:

1. a dedicated `ClientEgressRouter = TopicRouter` that **does not wrap** `HealthTrackingRouter`;
2. delivery fees **prepaid from the client's USDC `delivery_float`** (§2), never from the VIT bond and never a treasury outflow; an exhausted float stops pushes and nothing else;
3. the send outcome is **best-effort and never read back into report, lifecycle, settlement,
   treasury-outflow, XCM-health or welfare state**; the isolated diagnostic counter in item 4 is the
   sole permitted observation of that outcome;
4. push failures surfaced on a **non-welfare** counter plus a [12](./12-release-and-operations.md)
   §6.3 alert row.

**The pull surface ships too**, and is not merely a fallback: it is what makes the report verifiable
by storage proof against a finalized header, which is the only delivery a client should actually
trust. Verified: XCM v5's `Response` carries no arbitrary data, so `QueryResponse` is structurally not
a data channel — an outbound `Transact` is the only push shape, authored the way the existing reserve
probe already does it, with **no new user-reachable send authority**.

**The push is one fixed v5 program and one fixed receiver ABI (contract v22).** A remote client
receives

```text
UnpaidExecution { Unlimited, check_origin: None }
Transact { origin_kind: Xcm, fallback_max_weight: None,
           call: [66, 0] ++ SCALE(ReportView) }
SetTopic(ReportView.provenance_hash)
```

where `66` is the drop-in client receiver's `QuestionServiceReceiver` pallet slot and call `0` is
`receive_report(report)`. The runtime constructs every byte from the already-stored report and the
registry location; no extrinsic caller can choose a destination, selector or payload. A local client
has no XCM destination, so it records neither an attempt nor a false failure and consumes the pull
surface directly.

The exact prepaid amount is the existing [09](./09-execution-upgrades-and-rollout.md) §6.1 USDC
two-dimensional rate applied, rounding both dimensions up against the client, to the fixed
three-instruction envelope `3 × UnitWeightCost`. This reuses `xcm.usdc_per_sec` and
`xcm.usdc_per_mb`; no new tariff or conversion rate exists. The debit transfers USDC from the
client's deterministic escrow to treasury `MAIN` and credits that same amount as a MAIN inflow. It
shares one storage layer with router validation and delivery, so any local failure restores float,
asset custody and treasury accounting. The stable2606 sibling router presently returns an empty
delivery quote; a future non-empty quote fails closed until its asset incidence is specified rather
than silently stacking or converting it.

---

## 10. Failure, pause and the guardian surface

The service has one guardian control: **pause**. A paused service refuses `register` and `seal`, and
every live question takes the VOID edge at its deadline. Pause is the
[06](./06-governance-and-guardians.md) **PB-HALT-INTAKE** effect: its bounded batch sets both the
primary intake pause and the service pause to the same expiry, and its revert clears both. It is
deliberately *not* a freeze: freezing external questions would strand client and
trader capital in books with no terminal path, which is the failure mode the whole VOID design exists
to avoid.

`PB-LEDGER-FREEZE` on the **primary** instance MUST NOT freeze the service instance, and a service
instance fault MUST NOT make the primary instance freeze-eligible. That is the entire point of §7.1,
and it is I-37. This does not waive payout safety inside the service domain: the service ledger's
own I-4 freeze gates its `buy`, `sell`, `crank_observe` and `sweep_revenue` funds-moving paths, while
settlement and the deadline-driven VOID edge remain live. It is independent of pause and is selected
only through `LedgerRoute::for_book`; an absent runtime binding fails closed. Conversely, those same
market paths on Protocol books consult only the primary freeze. `PB-DEPEG` creation freeze remains
global across both domains because it guards new shared-USDC market creation, not ledger solvency.

---

## 11. Errors

Every refusal is a distinct, documented code — an integration surface, not a diagnostic. A client
that cannot tell *which* precondition it missed cannot integrate without a support channel, and this
service is meant to be integrated without one.

`NotRegistered` · `ClientRemoved` · `ClientBondUnset` · `DuplicateLocation` · `ClientsFull` ·
`ClientIdExhausted` · `BondInsufficient` · `BondAccounting` · `QuestionCounterOverflow` ·
`DeliveryFloatAmountZero` · `DeliveryFloatInsufficient` · `DeliveryFloatWouldDrain` ·
`DeliveryFloatBelowMinimum` · `DeliveryFundingWouldDust` · `DeliveryFloatOverflow` ·
`DeliveryFloatAccounting` ·
`NoLiveQuestions` · `ServicePaused` · `ServiceRateUnset` · `CertificationUnavailable` ·
`StakeBelowFloor` · `SubsidyBelowMinimum` · `EpsilonOutOfRange` · `WindowTooLong` · `WindowTooShort` ·
`WindowCollidesWithDecision` · `SlotsExhausted` · `TvlCapWouldBind` · `AttestorSetTooSmall` ·
`AttestorBondInsufficient` · `ClientIsProtocolAccount` · `EscrowInsufficient` · `NotSealed` ·
`AlreadySealed` · `AlreadyTerminal` · `QuorumNotReached` · `MedianOutOfRange` · `DeadlineNotReached` ·
`UnknownQuestion` · `DeadlinePassed` · `CreationFrozen` · `DuplicateAttestor` · `UnknownAttestor` ·
`AlreadyBonded` · `InvalidSubId` · `ArithmeticOverflow` · `ArchiveNotReady` · `TryStateViolation`

The optional push's non-dispatch outcomes remain distinct internally as `Validate`,
`Fee(RouterQuoteUnsupported)`, `Fee(PricingUnavailable)`, `Fee(PrepaymentRefused)` and `Deliver`.
They collapse only at the deliberately non-welfare alert counter: no push outcome is a client-call
refusal and none can undo the already-published report.

---

## 12. Verification obligations

Carried here because they are properties of *this boundary*; [15](./15-invariants-and-testing.md)
owns the regime.

- **The highest-value single test in the batch:** a differential against a **frozen copy** of today's
  three deny components, asserting that for any program *without* a `Transact`, the barrier's decision
  is byte-identical. That is what proves the change is a pure extension rather than a rewrite.
- **PT-9 — domain segregation.** No operation on one ledger instance changes any storage, balance or
  invariant reading of the other.
- **PT-10 — external-outcome containment.** Replay a Bleavit-only scenario; replay it again with
  arbitrary admissible service traffic interleaved **before and after every primary schedulable
  point**. The service leg covers the real `register`/`open`/`observe`/`seal` lifecycle, nested
  ledger work, the signed `TransactionExtension`, the XCM dispatcher, varied proof sizes and both
  successful and failed/refunded reservations. Assert every welfare snapshot and every `decide()`
  input is **byte-identical**. This is the test that makes §1's boundary rule falsifiable, and
  §8.5's `H` partition is the reason it can pass at all. **Implemented as
  `pt10_external_outcome_containment`.** The interleaving is *generated* over the service alphabet
  at every schedulable point of every block, rather than replayed from fixed patterns — while it
  was fixed patterns over a single call shape the test was deliberately named
  `..._containment_sample`, because [15](./15-invariants-and-testing.md) §4.3 states that a test
  claiming the unscoped property MUST NOT be named PT-10. Two knobs follow from it being a runtime
  **replay** property rather than a proptest over a frame-free core: it does not read
  `PROPTEST_CASES` (each case is two full multi-block replays, so a ≥10⁶ count is not reachable),
  and it carries its own `BLEAVIT_PT10_CASES`, small in `cargo test --workspace` and deep in the
  `containment` shard of the property-suites gate — the same reduced/deep split PT-1…PT-8 use. A
  companion assertion requires the swept seeds to reach every letter of the alphabet, so narrowing
  the generator cannot silently narrow the property.
- **Negative origins:** every registry and service call × {Signed, Root, None, all eight governance
  origins, `ExternalClient`}; and under `Transact`, all of `system.set_storage`, `system.set_code`,
  `pallet_xcm.send`, `Balances.transfer`, `sudo.sudo`, `Utility.batch`, `Proxy.proxy` rejected.
- **Fuzz:** `xcm_client_ingress` against an independent spec-written template oracle (the
  `nested_wrapper_filter` two-implementation pattern); `service_settlement_paths` for the
  two-terminal-state property; `lmsr_trade_paths` extended to external books.
- **Formal:** `models/tla/ledger` unchanged — the strongest single argument for instancing — plus a
  new **two-instance composition** model (§7.1) and `models/tla/service` proving every path from
  `Registered` reaches exactly one of `Settled`/`Voided`, with a witness config that MUST violate.
- **Zombienet (N10 closure, explicit dependency split):** the drop-in receiver and runnable client
  harness do not exist until N10, so N10 owns the client-para topology with HRMP both ways **and** a
  return-channel-absent variant to witness N9's I-36; an ingress drill sending the exact template
  plus eight malformed variants, none of which may dispatch; and a report-pull drill asserting `X`
  is unchanged throughout. N9 closes only after the local proof below is green; N10 may not close
  without these live-network variants. Assigning a receiver-dependent topology to N9 was a
  dependency error, not evidence that the drill had run.
- **I-36 local proof:** one review entry point MUST bind the exact `ClientEgressRouter = TopicRouter`
  type, prove USDC float debit with byte-identical VIT bond custody, force every push to fail across
  every measurable day of a full epoch, retain the authoritative report, advance only the isolated
  per-client counter and assert every welfare counter plus `X` unchanged.
- The full ledger differential corpus replayed against **instance 1**, to prove instance-independence.

---

## 12a. The canonical client serves these books (SQ-571, contract v23)

This document specifies the service; it does not specify a frontend, and the two client-facing
documents own that. Recorded here because the boundary was previously drawn in the wrong place and a
reader of §6.2/§7.1 alone would still infer the old one.

The **canonical Bleavit client serves external books as ordinary trading and position surfaces**
([11](11-frontend-workflows.md) §11.2a): `BookKind::External` books trade on S3, and holdings in them
appear on S4 through the thirteenth `FutarchyApi` method `service_positions()` or the `ServiceLedger`
storage prefix, both admitted to the canonical ingest surface at contract v23
([02](02-integration-contract.md) §3, §7.1).

Nothing in this document changes as a result, and that is the point: every mechanism it specifies
**already admitted the Bleavit public**. `market.buy` is a `CallDomain::Public` call (§3.1), a trade
in a hosted book is an ordinary signed dispatch (§8.1), `LedgerRoute::for_book` routes it into
`Instance1` with no caller-visible difference (§7.1), and §8's revenue arithmetic is *sized on organic
order flow* — §8.2's instrument-D term is the larger one only if external traders show up, and §5.2
expects an underfunded client to reach its certificate out of that same organic activity. What was
missing was not permission but **visibility**: contract 02 excluded the service instance from
canonical ingest, so the client could route a user's money into a hosted book and then be unable to
show the position it created.

Two properties this document *does* own remain binding on that client, and
[11](11-frontend-workflows.md) §11.2a restates them as rules rather than leaving them inferred:
per-instance solvency means the client **MUST NOT** present one merged portfolio total across the two
domains (§7.1's whole argument for instancing), and §8.5's quota discipline means external activity is
rendered as an **operational diagnostic and never as governance participation or protocol health** —
`H` is primary/system usage, never a subtractive service exclusion.

## 13. Non-goals

- **Bleavit does not decide for clients.** No client rule, threshold or payload is evaluated for its
  consequence, and none is executed.
- **Bleavit does not adjudicate foreign facts.** `OracleResolution` never sees an external question
  (§6.1).
- **Bleavit does not guarantee external settlement honesty.** It bounds the blast radius and publishes
  the trust level (§6.5).
- **Bleavit does not host arbitrary computation.** The only client bytes that ever reach state are
  `sub_id`, which is stored and echoed and never interpreted.
- **This document creates no new governance origin, track or veto.** `ExternalClient` is reachable by
  no governance origin, and no governance origin is reachable by a client.
