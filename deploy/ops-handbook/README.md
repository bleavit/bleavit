# Ops handbook — bootnode, ArNS and launch operations

**Owning specification:** [12 §6](../../docs/architecture/12-release-and-operations.md)
(operational layer), [12 §4](../../docs/architecture/12-release-and-operations.md) (ArNS and
distribution control), [12 §1](../../docs/architecture/12-release-and-operations.md) (the
release train). Milestone **F15**.

This is the *standing-operations* half of the operational layer. Its counterpart is
[`deploy/runbooks/`](../runbooks/README.md), which holds the incident runbooks bound to
doc 12 §6.3's alert tables — one is what you read when a page fires, this is what you read
to know who is accountable and what they have committed to. The count is deliberately not
restated here: it was 13 until D-20 added RB-SERVICE, and this sentence still said 13.

Two mechanical bindings keep it honest, and both are bidirectional:

- `python3 tools/deploy/check-ops-handbook.py` — every 12 §6.1 service is assigned here with
  its owning role and funding line, every 12 §6.3 alert domain has a named first responder,
  and every 12 §6.4 incident class has an accountable role and a written response. Nothing is
  assigned that those sections do not name. A dropped row is a commitment nobody owns. An
  invented one is a commitment nobody made.
- `python3 tools/deploy/check-runbooks.py` — the §6.3 alert binding, from O4.

The first-responder roster and the incident table below are **derived, not read**: the
checker resolves each alert domain to its runbook through 12 §6.3, takes that runbook's
owner role, and confirms 12 §6.1 names the role. An assignment written here that the
documents do not produce is a failure, exactly like an assignment they produce and this
file omits.

`--strict` additionally refuses a declared vacancy. That is what a launch gate runs; CI runs
the plain form, because pre-launch every row is legitimately vacant and a gate that was red
by design would be a gate nobody looks at.

## Role assignments

**A vacancy is declared, never omitted.** An omitted row reads as *there is no such
commitment*; `VACANT` reads as *this commitment has nobody accountable*, which is what
[12 §6.5](../../docs/architecture/12-release-and-operations.md)'s phase gates need to see.
12 §6 requires an accountable **person** per role — an organization is not a holder, because
an organization cannot be paged.

| Service | Owner role | Funding line | Holder |
|---|---|---|---|
| WSS bootnodes | Bootnode program coordinator | ops.bootnodes | VACANT |
| Served-state window | Infrastructure coordinator | ops.rpc_archive | VACANT |
| Collators | Collator program coordinator | ops.collators | VACANT |
| RPC / archive nodes | Infrastructure coordinator | ops.rpc_archive | VACANT |
| Monitoring & alerting | Monitoring coordinator | ops.monitoring | VACANT |
| Keeper operations | Keeper coordinator | ops.keepers | VACANT |
| Hosted question service | Service operator | ops.keepers | VACANT |
| Oracle evidence hosting | Oracle operations coordinator | ops.oracle_evidence | VACANT |
| Watchtowers | Oracle operations coordinator | ops.watchtowers | VACANT |
| Reserve-health probe | Oracle operations coordinator | ops.reserve_probe | VACANT |
| Arweave / ArNS | Release operations lead | ops.arweave | VACANT |
| Release operations | Release operations lead | ops.arweave / ops.monitoring | VACANT |

Roles may be held by the same person **except** where [12 §2.2](../../docs/architecture/12-release-and-operations.md)
forbids it: ArNS controllers and release signers must be disjoint over natural persons, and
attestation-monitor operators must not be ArNS controllers. Those three populations are
declared in [`app/tools/release/sources/signers.json`](../../app/tools/release/sources/signers.json)
and checked by `pnpm -C app run signers:audit`, not here — a second list of the same people
is a second list to keep in step.

## Bootnode program (12 §6.2)

The commitment is **browser-reachability**, not reachability: ≥ 8 WSS multiaddrs across ≥ 4
distinct **organizations**, ≥ 2 on port 443. The :443 floor exists because corporate and
mobile networks block non-443 WSS, and a bootnode only native peers can dial has not met the
commitment — which is why the §6.3 stack probes dialability *from a browser context* with a
headless dial test per endpoint, in addition to each operator's own Prometheus.

Operational shape:

1. The committed set ships **inside the bundled chain spec**, hash-pinned. The client
   verifies those bytes against the release pin before handing them to smoldot
   (app-code rule 13), so a substituted spec is caught before it can point the light client
   at another genesis.
2. Set updates ride releases plus on-chain discovery. Adding an endpoint therefore also adds
   a `connect-src` entry, which the [15 §4.8](../../docs/architecture/15-invariants-and-testing.md)
   no-growth diff forces to be a reviewable change to
   [`app/tools/release/sources/incumbent-connect-src.json`](../../app/tools/release/sources/incumbent-connect-src.json).
   That is deliberate friction: it is the same file an external-tool vendor host would have
   to be written into, and D-21 forbids that outright.
3. Manifests: [`deploy/chain-specs/bootnodes.paseo.json`](../chain-specs/bootnodes.paseo.json)
   and [`bootnodes.polkadot.json`](../chain-specs/bootnodes.polkadot.json). Both are empty and
   carry a `_phase_gate`; `tools/deploy/validate-chain-spec.py` fails until the floors are met.
4. The **30-day served-state window** is a joint commitment of this fleet, and it is an honest
   ops line rather than a protocol guarantee. The client labels data accordingly, and
   backfill past it is refused rather than truncated
   ([10 §6.4](../../docs/architecture/10-frontend-architecture.md); `planBackfill`).

## Monitoring and alerting (12 §6.3)

The stack is [`deploy/monitoring/`](../monitoring/README.md) and the response to any one page
is [`deploy/runbooks/`](../runbooks/README.md). Neither answers what this section answers.
[12 §6.3](../../docs/architecture/12-release-and-operations.md) states the ownership rule and
never applies it: an alert's owner is the owner of its 12 §6.1 row, and a protocol domain,
having no dedicated program row, falls to the Monitoring coordinator as first responder. The
roster is that rule applied to every alert domain.

| First responder | Alert domains (12 §6.3) |
|---|---|
| Bootnode program coordinator | Bootnodes, Served-state window |
| Keeper coordinator | Epoch progress, Keeper budget, Keepers, Relay finality, TWAP |
| Monitoring coordinator | Collateralization, Guardian, Liquidity floors, Markets, Numerics, Proposal state, Storage, Treasury, XCM |
| Oracle operations coordinator | Oracle |
| Release operations lead | Descriptor lead time, Release integrity, ReleaseChannel, Upgrades |
| Service operator | Client report push, External block-weight quota, Hosted service occupancy |

One domain answers to a role that does not own the 12 §6.1 row of the same name. 12 §6.3
calls that pair the live instance of its cross-row rule and requires the runbook to name the
other row's owner in its escalation path. The checker reads that runbook and confirms it.

| Alert domain | First responder | Escalation partner (12 §6.1 row owner) |
|---|---|---|
| Served-state window | Bootnode program coordinator | Infrastructure coordinator |

Four standing obligations sit on the Monitoring coordinator and are **not** alert rows, so no
runbook and no alerting rule carries them:

1. **Exporter health.** [12 §3.1](../../docs/architecture/12-release-and-operations.md) makes
   an absent series the signal rather than a healthy zero, so the absence itself must be
   caught — and that section places the catching on the §6.1 monitoring row rather than on a
   §6.3 row. The checks are written out in
   [`deploy/monitoring/README.md`](../monitoring/README.md) under *Self-monitoring*.
2. **Three exporter settings are supplied, never invented.** The operations refill margin in
   DOT plancks, the maximum age of an unchanged finalized Asset Hub head, and the pinned
   canonical Asset Hub genesis hash are operator settings, not protocol parameters. The
   Oracle operations coordinator owns the reserve line they measure (12 §6.1, Reserve-health
   probe), and the exporter refuses to start without all three.
3. **The relay-finality persistence window is open.** 1,800 s is the placeholder 12 §6.3
   marks `[VERIFY]`. Re-derive it from observed healthy relay behaviour on the target relay
   before production, amend that row with the measured value, and keep the figure equal in
   the exporter and in the alerting rule.
4. **An early-warning margin is re-derived whenever the requirement it guards moves.** A
   margin set deliberately inside a protocol requirement, such as the TWAP row's 96 % sitting
   above `dec.coverage`, is a monitoring choice this handbook's stack owns rather than a
   restatement of [13](../../docs/architecture/13-parameters.md).

Two domains cannot fire yet. Bootnodes and Served-state window are written against series no
exporter emits until O3 ships the browser-dial and retention probes, so the Bootnode program
coordinator reads those probes out of band until then. A quiet panel is not evidence of
health.

Three readings are settled elsewhere and are not repeated here. Hosted service occupancy is
the only row whose response is a values amendment rather than an operational action, and
[`RB-SERVICE`](../runbooks/RB-SERVICE.md) owns that escalation. The keeper-inactivity blind
spots are covered by the keeper's own liveness series and by the Relay-finality row, which
12 §6.3 introduces for that purpose. Every alert threshold that restates a governance-amendable
figure is evaluated against the live value, which the alerting rules already do.

## Incident response (12 §6.4)

12 §6.4 names four incident classes, and [`RB-RELEASE`](../runbooks/RB-RELEASE.md) already
carries the procedure for all four. This section does not repeat them. It records who is
accountable, and it exists because a class can be added to 12 §6.4 with no alert row, no
runbook section and no owner, and nothing else in the repository would notice.

| Incident class (12 §6.4) | Accountable role | Standing response |
|---|---|---|
| Hostile release | Release operations lead | [RB-RELEASE](../runbooks/RB-RELEASE.md) § Hostile release |
| Wrong-chain-spec | Release operations lead | [RB-RELEASE](../runbooks/RB-RELEASE.md) § Wrong-chain-spec |
| ArNS-key loss | Release operations lead | [RB-RELEASE](../runbooks/RB-RELEASE.md) § ArNS-key loss |
| Distribution mismatch | Release operations lead | [RB-RELEASE](../runbooks/RB-RELEASE.md) § Distribution mismatch |

12 §6.1 puts incident playbooks on the Release operations lead, and every class above answers
to that role. Only two of the four arrive as a page: the Release integrity row pages
immediately, which is how a distribution mismatch and a hostile release reach a person. A
wrong chain spec is refused by the bundle's pinned genesis and by
`tools/deploy/validate-chain-spec.py` rather than detected by monitoring, and ArNS-key loss is
discovered by the controller quorum itself. Two of the four therefore have no alerting path at
all, and naming their owner here is the only thing that routes them.

The privileged actions in those paths stay separated. Accountability for an incident sits with
one role, and executing the response does not. A repoint needs the ANT controller quorum, a
re-signature needs the release signers, and 12 §2.2 keeps those two populations disjoint over
natural persons. CI holds no minisign key and no controller share, so a compromised CI can
block a release and can never ship one.

## ArNS and distribution (12 §4)

- **Tenure is permabuy.** There is no renewal event to miss and no expiry failure mode; the
  lease-lapse takeover — a full distribution compromise requiring *no key compromise at all*
  — is closed by tenure rather than by vigilance.
- **Control is 3-of-5, and single-key custody is prohibited under any circumstance, including
  temporarily during bootstrap.** If neither native n-of-m nor a FROST-ed25519 ceremony
  materialises, **launch blocks on this line**. `signers:audit` reports it as a launch blocker
  from the registry, before any ceremony has happened.
- Staging, dev and per-release undernames ride the same permanently held name. Every release
  additionally creates an immutable `vX-Y-Z_futarchy` undername, so rollback is a repoint and
  nothing is ever deleted.
- **The recovery root is the chain, not the name.** 12 §6.4's declared worst case — a
  permanently lost quorum — is answered by establishing a new name and announcing it through
  `ReleaseChannel`, which reaches pinned and stranded users precisely because it is verified
  state rather than a mutable pointer.

## Launch operations (12 §1, §6.5)

The release checklist is normative in
[12 §1.4](../../docs/architecture/12-release-and-operations.md); what belongs here is who
does what and what refuses.

| Step | Mechanically enforced by |
|---|---|
| Build the tree | `pnpm -C app run release:build` — deterministic, and it names every readiness blocker |
| Certify it is a release | `node app/tools/release/build.mjs --check --production` — non-zero while any blocker stands |
| Expedited-lane admissibility | `verify-release diff-scope <incumbent> <candidate>` — both directions, so a deletion counts |
| Signer disjointness | `pnpm -C app run signers:audit --strict` |
| Repoint | 3-of-5 ANT `setRecord`; **CI holds no minisign keys and no controller shares**, so a CI compromise can block a release and never ship one |
| `ReleaseChannel` update | within 600 blocks of the repoint, preserving the guard-owned offsets 112–119 and the `URGENT_UPGRADE` bit exactly |

The phase-entry blockers of 12 §6.5 are the acceptance criteria for this handbook being
complete: Phase 2 needs the bootnode program live at full numbers and the release train
exercised end to end including one expedited dry run and one rollback drill; Phase 3 needs
permabuy, the ANT quorum ceremony, attested signer disjointness and ≥ 2 disjoint monitor
operators; Phase 4 needs the keeper funding line, the watchtower quorum and oracle evidence
hosting live.

## Current state, stated plainly

Nothing above is seated. There is no ceremony, no ANT, no bootnode operator, no gateway set
and no monitor. Every mechanical check that can be run pre-launch reports that as *unseated*
rather than as passing — `checkDisjointness` distinguishes "disjoint for want of members"
from a real separation, `release:build` names thirteen readiness blockers, and
`validate-chain-spec.py` fails the bootnode manifests. The handbook exists now so that the
list of what must be true is fixed before anyone is under pressure to declare it true.

Two obligations above are open rather than vacant, which is a different state and is recorded
as one. The relay-finality persistence window is still the `[VERIFY]` placeholder, and the
bootnode and served-state alert series have no exporter behind them until O3 ships one.
Neither waits on a person being named.
