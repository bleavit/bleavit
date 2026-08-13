# Bleavit repository security review — 2026-08-12

## Executive verdict

Review target: commit `08f77ce12a737ef0f2ba8174d829b527ae33f05b`.

No Critical vulnerability was confirmed. The review confirmed **5 High, 8 Medium and 2 Low**
findings. Ten are newly recorded by this review; five were already present in the plan tree or an
archived audit and remain relevant.

Bleavit is **not ready for production deployment**. That conclusion is not based only on the new
findings: the repository already fails closed on unseated production signers, absent production
chain/gateway inputs, unfinished release-monitor credentials, the moved ArNS control platform and
the unavailable metadata-hash signing profile. Those gates are working as intended. The findings
below identify defects that must be fixed before those gates are lifted.

The strongest controls observed were the frame-free solvency cores, origin/domain separation,
bounded runtime state, extensive try-state/property/differential coverage, content-addressed release
assembly, source-derived chain surface checks, and multi-ecosystem dependency auditing. No project-
owned `unsafe` block, committed credential, frontend dynamic-HTML sink, `pull_request_target`
workflow, or broad PR write token was found.

## Scope and method

The review covered:

- protocol specifications and threat/invariant model (`docs/architecture/00`–`16`);
- all runtime crates, FRAME pallets, runtime APIs, both runtimes and XCM components;
- the canonical app, signing/transaction packages, service worker, release verifier and explainer;
- hosted-question client/server pallets and integration documentation;
- node, keeper, release/deploy/environment tooling, monitoring and GitHub workflows;
- all committed Rust/npm/pnpm lockfiles and the repository's waiver policy;
- the reference model, simulation, formal/property/test harnesses and plan-tree assurance gaps.

The work combined manual data-flow and authorization review, specification-to-code tracing,
repository-wide pattern searches, prior-audit regression review, focused unit/control gates and the
online supply-chain gate. This was not a live-chain penetration test, browser/device lab, long fuzz
campaign, model-checking rerun or a duplicate exhaustive Rust gate.

## Findings

### SR-01 — High — one client can exhaust hosted-service capacity for the archive horizon (new; SQ-1057)

`Questions` is a counted retained map, and registration refuses once its total count reaches the
same hard `MAX_CLIENTS = 64` used for the client roster. Terminalization decrements only the live
counter; the question row remains until both books and the service vault are reaped. Vault reaping
cannot begin until `ledger.archive_delay`, currently one year and bounded below by 90 days.

A single governance-admitted hostile client can register the provisional 16 live questions, let
them reach the permissionless deadline-VOID path, and repeat four times. Pre-report VOID refunds the
service fee and returns the market escrow; the admission bond has no slashing path and is released
on removal. The result is 64 terminal retained rows, zero live questions, and `SlotsExhausted` for
every client for at least 90 days. Honest throughput reaches the same global outage after 64
questions per archive horizon.

Evidence: `pallets/question-service/src/lib.rs:260-263,651-689,897-907,1405-1479`;
`pallets/conditional-ledger/src/lib.rs:2368-2417`;
`crates/futarchy-primitives/src/lib.rs:1130-1140`; architecture 13 §1 and 16 §8.6.

Remediation: give retained history a separately derived throughput-times-retention bound, or remove
admission rows at terminal while keeping claimant state independently bounded. Add a four-wave
Registered→Voided regression proving that a fifth wave remains admissible.

### SR-02 — High, latent release blocker — callers can fabricate the only signing gate proof (new; SQ-1058)

The root transaction-builder package exports `gate(prep, at, live, compat, results)`. Its supposedly
trusted finalized pin, live runtime identity, compatibility classification and precondition results
are all caller-constructible plain objects. If their fields agree, `gate` casts the result to the
private `GatePassed` brand. The test fixture demonstrates the construction using literals without a
finalized read.

Any future feature or integration can therefore assert `mode: 'full'`, copy `prep.builtFor`, and
supply literal passing results to reach `AwaitingSignature` without smoldot, proof-backed storage,
runtime-version or compatibility reads. This violates INV-FE-2's structural no-bypass requirement.
The currently shipped composition registers no transaction screen or signer call site, so the
defect is a release blocker rather than a presently exposed remote path.

Evidence: `app/packages/transaction-builder/src/machine.ts:258-377`;
`app/packages/transaction-builder/src/preconditions.ts:66-80`;
`app/packages/descriptors/src/compat.ts:62-69`;
`app/packages/chain-client/src/provenance.ts:42-54`;
`app/tests/transaction-builder/raw.test.ts:78-97`;
`app/src/application/src/composition.tsx:37-44`.

Remediation: make a single `refreshAndGate` operation own the finalized pin, reads, decoding,
compatibility probe and evaluation; keep the pure predicate private. Brand the completed read batch
and compatibility verdict to the chain, pin and preparation, with compile-fail tests for literals.

### SR-03 — High, latent release blocker — a proof for transaction A signs bytes/account B (new; SQ-1059)

`GatePassed` now binds a preparation, but `SigningRequest` separately accepts `prep`, `window` and
`account`. Both production adapters sign `request.prep.scaleHex` and identify `request.account`
without checking either against `request.window.prep`. The test suite explicitly reuses one genuine
window while changing bytes and then the account and expects success.

An authentic proof for a benign transaction can therefore authorize arbitrary independent bytes,
and its account/nonce/balance preconditions can be replayed for another signer. The current empty
screen composition again makes this latent, but wiring a submit surface in this state would create a
direct pre-sign substitution path.

Evidence: `app/packages/transaction-builder/src/machine.ts:119-159`;
`app/packages/signing/src/adapters.ts:185-197`;
`app/packages/signing/src/injected.ts:219-236`;
`app/packages/signing/src/raw.ts:129-147`;
`app/tests/transaction-builder/machine.test.ts:498-510`.

Remediation: remove the duplicate preparation from `SigningRequest` and always sign
`window.prep.scaleHex`. Bind the signing account/nonce subject into the preparation and derive it
from the proof. Every real adapter must reject byte, preparation and account mismatch fixtures.

### SR-04 — High — permissionless XCM exits can pump a decision-grade health metric (new; SQ-1066)

The canonical Asset Hub reserve-transfer call is public. `pallet-xcm` routes every such send through
the welfare-observing `HealthTrackingRouter`, whose successful local delivery increments
`XcmTraffic.accepted`. The decision input is `X = accepted / (accepted + failed + probe_timeouts)`;
there is no per-account/window cap and local acceptance is recorded before remote execution is
known.

After genuine failures lower `X`, a user with an adoption-side or higher-settlement position can
send repeated sufficiently funded Asset Hub exits and drive the ratio toward one. The remote leg
need not execute successfully. The attacker pays transfer/execution costs, but can compare those
costs with a larger market payoff. `X` enters `C_onchain`, daily gate decisions and settlement
welfare, making this a direct violation of I-24 rather than a monitoring-only distortion.

Evidence: `runtime/bleavit-xcm/src/filter.rs:43-55`;
`runtime/bleavit-runtime/src/classifier.rs:533-546`;
`runtime/bleavit-runtime/src/configs.rs:1505-1513,1668-1684,3227-3246,6545-6561`;
`runtime/bleavit-runtime/src/tests.rs:2488-2508`;
`runtime/bleavit-xcm/src/tests.rs:1887-1901`; architecture 05 §4.2–§4.3 and 15 I-24.

Remediation: route public/user traffic and inbound-executor-generated sends through a non-welfare
router. Count only provenance-bound protocol health operations, or remove accepted sends as an
improving numerator. Add an end-to-end regression proving repeated signed exits cannot improve `X`.

### SR-05 — Medium — the inbound XCM barrier admits six instructions the specification disables (new; SQ-1060)

Architecture 09 §6.1 disables all nine XCM v5 inner-program instructions. The legacy inbound
barrier nevertheless recursively admits `SetAppendix`, `SetErrorHandler`, `TransferReserveAsset`,
`DepositReserveAsset`, `InitiateReserveWithdraw` and `InitiateTeleport`; executor tests prove that
the first and fourth reach execution. The production runtime installs this barrier.

A paid message from Asset Hub, the relay or Coretime can make Bleavit execute an inner program or
forward assets. A compromised accepted chain can certainly author it; ordinary Asset Hub user
reachability through its current call filter was not established in this repository. Nested
`Transact` remains blocked, so this is not reported as arbitrary dispatch. Forwarding uses the
welfare-observing router and can add accepted-send observations to XCM health, contrary to the
default-deny boundary and I-24's directional rule.

Evidence: architecture 09 §6.1 lines 284-291 and 315-330;
`runtime/bleavit-xcm/src/barrier.rs:111-140,417-466`;
`runtime/bleavit-xcm/src/tests.rs:702-740,2166-2208`;
`runtime/bleavit-runtime/src/configs.rs:1488-1513,1548-1555`.

Remediation: reject all nine inner-program instructions in the legacy branch and add negative
barrier/executor tests for each, including unchanged XCM-health counters.

### SR-06 — High — the out-of-band release monitor cannot obtain valid credentials (tracked; SQ-1035)

The monitor reads signature and attestation transaction IDs from `release.json` while verifying the
signatures over that same document's hash. A credential transaction exists only after the bytes are
final, so writing its ID back changes the signed bytes. Architecture 12 §1.4 correctly moved those
IDs to release notes, but the unattended monitor has no independent credential-index input.

No conforming release can drive the required hostile-service-worker compensating control. This is a
production blocker, not an exploitable path while the release pipeline refuses production.

Evidence: architecture 12 §1.4 lines 62-75;
`tools/monitoring/attestation_monitor.py:397-404,678-705`; `plan/questions/SQ-1035.md`.

Remediation: publish a signed or content-addressed credential index independently of
`release.json`, configure the monitor with its address, and exercise producer→Arweave→monitor.

### SR-07 — Medium — two attestation keys are treated as two organizations (tracked; SQ-1032)

Architecture 12 requires two independent organizational rebuilds. The monitor keyring records no
organization identity and its threshold counts distinct key IDs. One organization with two keys
satisfies the control. SQ-1032 already ruled the implementation defective.

Evidence: architecture 12 §1.4/§5.2;
`tools/monitoring/attestation_monitor.py:265-317,332-410`;
`deploy/monitoring/keyring.example.toml`; `plan/questions/SQ-1032.md`.

Remediation: add a required stable organization identifier, reject unknown fields/identities, and
deduplicate valid attestations by organization.

### SR-08 — Medium — failed release webhooks disclose their credentials to logs (new; SQ-1061)

Webhook URLs are operator secrets, but the failure handler logs each complete URL. Tokens commonly
live in the URL path or query; any HTTP or transport failure copies them to journald or centralized
logs. A log reader could reuse them to send false incident/status messages.

Evidence: `deploy/monitoring/README.md:10-12`;
`tools/monitoring/attestation_monitor.py:709-725`.

Remediation: log the logical channel and a redacted origin only; remove userinfo, path, query and
fragment, and ensure exception text cannot echo request credentials. Add a sentinel-secret test.

### SR-09 — Medium — one unproved RPC controls the release monitor's security view (new; SQ-1062)

The threat model permits adversarial RPC endpoints. The monitor accepts `ws://`, pins no Bleavit
genesis, obtains finalized heads and `ReleaseChannel` through ordinary JSON-RPC, requests no storage
proof, and consults only one configured URL until that URL throws. A well-formed lie never fails
over. It can replay or fabricate the manifest hash, generation, revocation mask, spec version and
`SECURITY` flag. Cryptographic bundle checks still prevent arbitrary unsigned replacement, limiting
the impact.

Evidence: architecture 14 threat model;
`tools/monitoring/attestation_monitor.py:466-501,816-894`;
`tools/monitoring/common.py:373`.

Remediation: pin genesis, reject non-loopback plaintext WebSockets, and verify storage proofs against
consensus-verified finalized headers. Until a light client is used, require exact quorum agreement
across independently operated RPCs and fail closed on divergence.

### SR-10 — Medium — reproducible builds share one mutable failure domain (new; SQ-1063)

Architecture 12 requires a Node toolchain pinned by container digest and two independent CI
environments. Both app builds use `ubuntu-latest` and mutable `actions/setup-node@v7`; the second
job's main distinction is its checkout path. There is no workflow container digest, and runtime
release tooling separately records its build image as unpinned. A compromised or drifting common
runner/action can inject the same bytes into both builds while equality remains green.

Evidence: architecture 12 §1.1;
`.github/workflows/ci.yml:339,987-1017`;
`tools/release/build-runtime.sh:136-137`; `tools/release/README.md:162`.

Remediation: execute the canonical recipe in a digest-pinned image and move the second build to a
genuinely distinct image/provider/toolchain root. Bind both identities into release evidence.

### SR-11 — Medium — the reusable client receiver permanently stops after 128 reports (new; SQ-1064)

The drop-in client stores immutable reports in a bounded counted map and rejects once `MaxReports`
is reached. It has no remove, rotation or pruning call. The reference runtime and quickstart set the
bound to 128, so ordinary report 129 permanently disables best-effort push and `OnReport`
automation. Authoritative proof-backed pull remains available, limiting severity.

Evidence: `pallets/bleavit-client/src/lib.rs:213-226,292-339`;
`runtime/bleavit-client-runtime/src/configs.rs:55-65,341-356`;
`docs/integration/quickstart.md:36-84`.

Remediation: use a bounded ring or authorized post-retention pruning while keeping replay protection
separate from retained rows. Test capacity, pruning, replacement and replay.

### SR-12 — Medium — metadata-hash signing is declared but unusable (tracked; B21/SQ-594)

The runtime includes `CheckMetadataHash`, but its Wasm builder does not embed the metadata digest.
Mode-1 transactions therefore fail closed. Hardware/air-gapped signing cannot use the intended
metadata-bound anti-substitution channel and is left with mode 0/blind-payload exposure.

Evidence: `runtime/bleavit-runtime/src/lib.rs:256-267`;
`runtime/bleavit-runtime/build.rs:1-5`; `tools/release/build-runtime.sh:136-137`;
`plan/milestones/B21.md`.

Remediation: implement the B21 build profile and regenerate/bind every Wasm, metadata, descriptor
and release fixture it changes.

### SR-13 — Medium — one execution-guard fail-static latch is outside its source bitmap (tracked; SQ-504)

The immediate completion-path erasure described by the original SQ-504 was repaired by clearing
bitmap sources before `migration_completed`. The guard's corrupt/missing recovery-request path still
writes `MigrationHalt` directly, sets no source bit and emits no first-activation diagnostic. A later
source synchronization can overwrite the direct latch from the bitmap alone. This needs an
authorized upgrade plus corrupt/missing pin state and a subsequent source transition; it is not a
publicly triggerable runtime exploit, but its failure direction resumes execution when status quo
should remain locked.

Evidence: `pallets/execution-guard/src/lib.rs:909-940,1670-1676`;
`runtime/bleavit-runtime/src/configs.rs:1153-1177,1256-1262,1356-1377`;
`plan/questions/SQ-504.md`.

Remediation: give guard-originated latches a dedicated bitmap source through a configuration seam,
with activation diagnostics and explicit repair-time clearing.

### SR-14 — Low — gateway independence is declarative and one divergence is healthy (new; SQ-1065)

Monitor configuration enforces three distinct display names, not distinct normalized origins or
operators. Its integrity verdict fails only when two gateway resolutions diverge, while architecture
12 §5.2 says to alert on any mismatch and the alert table says 2-of-3. Three aliases can therefore
collapse to one provider, and one compromised gateway produces a healthy verdict.

Evidence: architecture 12 §5.2/§6.3;
`tools/monitoring/attestation_monitor.py:389-391,477-495`;
`tools/monitoring/tests/test_attestation.py:96-107`.

Remediation: bind stable operator identities, reject duplicate normalized origins, reconcile the
spec threshold, and surface every single-gateway mismatch at least as an integrity warning.

### SR-15 — Low — mutable GitHub Action references include the release writer (known hardening)

Workflows use mutable version tags and `dtolnay/rust-toolchain@master`. The release publication job
uses mutable `actions/download-artifact@v8` with `contents: write`. Upstream action compromise or
retagging can execute with CI/release authority. Independent signing and repoint controls reduce the
final-release impact. The 2026-07-27 backend review already accepted this as Low hardening.

Evidence: `.github/workflows/ci.yml:56`; `.github/workflows/release.yml:31,298-318`;
`docs/reviews/backend-security-and-code-review-2026-07-27.md:637-669`.

Remediation: pin every action to a full commit SHA with a version comment and automate reviewed SHA
updates.

## Existing readiness and assurance gaps

The following were verified but are not double-counted as new vulnerabilities:

- production signer populations, chain specifications, gateway lists and keyrings are intentionally
  empty; strict production checks refuse them (`F11`, `F13`, `SQ-940`, `SQ-994`, `SQ-1036`);
- three O3 bootnode telemetry seams remain declared and alert coverage reports them;
- feature-enabled benchmark assurance remains incomplete (`SQ-1053`, `SQ-1054`), and the cheap
  chain-feed gate samples less surface than the release rebuild (`SQ-1055`);
- the online supply-chain gate is green, but accepted waivers remain for `yamux` CVE-2026-32314,
  build-only `@opentelemetry/core`, and classified Rust unsoundness; waiver-to-bundle automation and
  future-ecosystem enumeration remain `SQ-1007`/`SQ-1008`;
- the ArNS control design must be re-derived for the current Solana implementation (`SQ-940`).

## Validation evidence

Passed on the reviewed checkout:

- online `tools/ci/supply-chain-gates.sh` over all six committed lockfiles;
- 400 CI-tool tests (3 skipped), 102 release-tool tests, 172 deploy-tool tests (2 skipped),
  111 monitoring tests, 74 phase-gate tests and 12 reference-model-tool tests;
- 768 independent reference-model tests and 110 simulation tests (1 skipped);
- the rewards property shard at 1,000,000 proptest cases (20 tests);
- 22 runtime-benchmark trading-rewards tests;
- limit coverage (212/212), generated weights, storage bounds, alert coverage, runbooks,
  integration ABI, dispatch mirror, execution-error, client-surface, chain-feed, frontend-budget and
  release-blocker control checks.

The first runtime-benchmark command hit the documented eCryptfs filename limit. Re-running with the
repository-prescribed scratch target, libclang path and workspace hint passed; this was an
environment failure, not a source failure.

## Limitations

No live Polkadot/Asset Hub/Arweave environment, production key ceremony, hardware-wallet/browser
matrix or external device lab was available. The review did not repeat the nine-hour exhaustive
workspace gate because the current repository records a recent green exhaustive run and R-12
prohibits redundant broad Cargo gates; it also did not rerun TLC, every property shard, fuzzing or
the full 10^7-point release sweep. Static review and green tests do not prove the absence of further
defects.
