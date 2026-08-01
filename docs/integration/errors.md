# Every refusal, and what to do about it

Bleavit refuses with a **distinct, documented code** on every path. That is deliberate: a client
who cannot tell *which* precondition it missed cannot integrate without a support channel, and this
service is meant to be integrated without one.

Non-normative; [16 §11](../architecture/16-hosted-question-service.md) owns the list.

## Registration

| Code | What happened | What to do |
|---|---|---|
| `NotRegistered` | Your `Location` is not in the client registry | Apply for admission; it is a values-track act with a bond |
| `ClientRemoved` | Your registration was removed | Live questions still run to term. You cannot open new ones |
| `ServicePaused` | Guardians paused the service | Wait. Live questions VOID at their deadlines |
| `ServiceRateUnset` | `svc.fee_bps` has no value yet | **Not your problem to fix** — the service is not armed. This is the gate |
| `CertificationUnavailable` | The manipulation bound has no on-chain producer yet | Register without requesting certification, or wait |
| `ClientIsProtocolAccount` | Your account collides with a protocol address | Use a different account. This one cannot be charged fees or hold positions normally |

## Question parameters

| Code | What happened | What to do |
|---|---|---|
| `StakeBelowFloor` | `declared_stake` under the minimum | Raise it — and note the fee rides on it |
| `SubsidyBelowMinimum` | Your `b` is below `b_min(S, ε)` | Post more, or raise ε. See [`costs.md`](costs.md) |
| `EpsilonOutOfRange` | ε outside `[svc.epsilon_min, ...]` | Pick ε from your decision, not your budget |
| `WindowTooLong` / `WindowTooShort` | Window outside bounds | Adjust. Longer windows cost more crank load |
| `WindowCollidesWithDecision` | Your window overlaps a live Bleavit decision window | Shift it. This protects both sides' liquidity |
| `SlotsExhausted` | `svc.max_live` reached | Wait for a slot. The bound is block-weight capacity, not demand |
| `TvlCapWouldBind` | Your escrow exceeds the live remaining Phase-3 cap | Phase 3 only. Reduce `S`, raise ε, or wait |
| `EscrowInsufficient` | You do not hold what you promised to post | Fund the account first |

## Attestors and settlement

| Code | What happened | What to do |
|---|---|---|
| `AttestorSetTooSmall` | Fewer than three distinct attestors | Name at least three |
| `AttestorBondInsufficient` | An attestor cannot cover its bond | They fund it, or you name someone else |
| `QuorumNotReached` | Fewer than `⌈n/2⌉` **distinct** attestors reported | The question VOIDs. Note *distinct* — one attestor twice is one attestor |
| `MedianOutOfRange` | The median fell outside the admissible range | The question VOIDs |
| `DeadlineNotReached` | You cranked `void` too early | Wait for the deadline; it is permissionless after that |

## Lifecycle

| Code | What happened | What to do |
|---|---|---|
| `NotSealed` | The window has not closed | Wait, or crank `seal` if it has |
| `AlreadySealed` / `AlreadyTerminal` | Already past that point | Read the report; the work is done |
| `UnknownQuestion` | No such `question_id` | Check the id. Note that ids from the service domain are drawn from a disjoint band, so a Bleavit proposal id will never resolve here |

---

**If you get an error not on this list**, that is a documentation defect and worth reporting — the
list is meant to be exhaustive, and every code here corresponds to exactly one refusal path.
