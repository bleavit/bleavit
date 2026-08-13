# Bleavit monitoring and alerting

This directory is the O5 reference deployment for the infrastructure-only
monitoring commitments in architecture 12 §5.2 and §6.3. It contains
Prometheus scrape/rule configuration, Alertmanager routing, and an example
configuration for the controller-disjoint out-of-band attestation monitor.

## Run the stack

Replace every `*.example.invalid` target and webhook while rendering the files
into the operator's secret/configuration system. Webhook credentials must not
be committed. Then start the three Python exporters (Python 3.12; live WebSocket
operation additionally needs the repository pin `websockets==15.0.1`):

```sh
python3 tools/monitoring/chain_alerts_exporter.py \
  --url wss://YOUR_FINALIZED_NODE \
  --asset-hub-url wss://YOUR_INDEPENDENT_ASSET_HUB_NODE \
  --dot-refill-margin-planck YOUR_POSITIVE_DOT_MARGIN \
  --asset-hub-stale-seconds YOUR_POSITIVE_STALE_WINDOW \
  --asset-hub-genesis-hash 0xYOUR_CANONICAL_ASSET_HUB_GENESIS_HASH \
  --bind 127.0.0.1:9617 --interval 30
python3 tools/monitoring/attestation_monitor.py \
  --config /etc/bleavit/attestation-monitor.toml
python3 tools/monitoring/relay_finality_monitor.py \
  --relay-url wss://YOUR_RELAY_RPC --bind 127.0.0.1:9620 --interval 30
```

The attestation monitor's configuration pins the Bleavit genesis hash and names
at least three operator-distinct RPC endpoints. Remote endpoints must use WSS;
plaintext WS is accepted only on loopback. Every configured endpoint must agree
exactly on genesis, finalized block and raw `ReleaseChannel` bytes on every poll.
This is an interim fail-closed transport quorum, **not** a storage-proof or
finality-proof verifier; colluding RPC operators can still return the same lie.

The relay finality monitor is deliberately a **separate process on a separate
relay endpoint** (SQ-283): a relay GRANDPA stall freezes every parachain-anchored
series, including the chain exporter's own finalized-head loop, so it must not
share that connection or failure domain. Run at least two against independent
relay RPCs. Its `--stagnation-window` default is `[VERIFY]` — Ops must calibrate
it from observed healthy relay behaviour before production.

Use `--once` for drills. The chain exporter prints one Prometheus scrape and
returns 0/2 (success/operational failure). The attestation monitor returns 0
for a verified release, 1 for an integrity mismatch, and 2 for configuration,
transport, or decode failure. Its loop checks on every observed finalized
`ReleaseChannel` change and at the configured interval; validation rejects an
interval above 3,600 seconds. Between full checks it polls the exact RPC quorum
at the required operator-selected cadence and resolves the configured
ArNS name through every gateway on each finalized head, so a repoint triggers a
full check and the 600-block channel-update lag advances continuously. Because no on-chain
observable marks the repoint block, 12 §6.3 ("Two observables this table left
implicit") anchors that lag at the first finalized head where the gateway
majority and `ReleaseChannel.manifest_txid` disagree — which also starts the
clock when the gateways reach no strict majority at all, since an
inconsistently resolvable name is not a healthy state. The metric and alert use
that observed height explicitly. This majority is only the deterministic lag
timestamp anchor: any individual resolver dissent increments
`bleavit_release_monitor_resolver_divergent_gateways` and fails the integrity
verdict.

Point Prometheus at [prometheus.yml](prometheus/prometheus.yml), mount
[bleavit-alerts.yml](prometheus/rules/bleavit-alerts.yml) under
`/etc/prometheus/rules`, and start Alertmanager with
[alertmanager.yml](alertmanager/alertmanager.yml). For example, with operator
images/binaries already installed:

```sh
prometheus --config.file=/etc/prometheus/prometheus.yml
alertmanager --config.file=/etc/alertmanager/alertmanager.yml
```

Before deployment and after any rule/spec edit, run:

```sh
python3 -m unittest discover -s tools/monitoring/tests
python3 tools/monitoring/check_alert_coverage.py
```

## Series and source inventory

`tools/monitoring/series-inventory.toml` is the checked source map for every
metric used by an alert expression. `check_alert_coverage.py` strictly extracts
both 12 §6.3 tables, checks each domain/runbook/page binding, checks every rule
metric against that inventory, and introspects both Python modules' `SERIES`
registries. It prints all seams on every run.

The chain exporter serves `bleavit_chain_*` series in these families:

- exporter health/finality: connection, finalized height, last successful
  scrape, and decode/transport error counter;
- `FutarchyApi` views: epoch phase/boundary/tick lag, proposal state counts,
  execution queue depth, open oracle round count/depth, welfare/reserve state,
  treasury NAV and rolling-meter use;
- live limits: `keeper.budget` from `FutarchyApi::params`,
  `DescriptorLeadTime` and queue/map bounds from portable metadata constants;
- metadata-driven storage: keeper-meter use, bounded map counts, and
  `PolkadotXcm.AssetTraps` occupancy;
- reserve-probe runway: the monitoring-only local line plus independently
  decoded, genesis/para-id-pinned Asset Hub USDC and usable-DOT balances,
  live requirements, readiness, and fail-closed collection health;
- finalized events: Guardian actions, upgrade authorization/application, and
  keeper-budget-low counters;
- frozen `ReleaseChannel`: version labels, manifest TXID, spec version,
  update/pending heights, keyring generation, revocation mask, raw/individual
  flags, pending-upgrade age, and SECURITY-flip counter.

The attestation monitor serves `bleavit_release_monitor_*` health/check/error,
integrity, byte-mismatch, resolver-divergence, signature/attestation,
generation, channel-match, spec-coverage, repoint-lag, ANT-change, and webhook
failure series. Existing keeper series are documented in `keeper/README.md`;
the O5 inactivity rule uses the keeper's connected gauge and applies only to
roles whose per-process `planned_total` has advanced and whose last-success
timestamp is non-zero. It fires one hour after the recorded success, with no
additional Prometheus `for` delay. The blind spot is a role that has never
succeeded since daemon start: disabled roles and post-restart-stuck roles both
have timestamp zero and are indistinguishable. Production rules MUST still be
instantiated per required role, as mandated by `keeper/README.md`, so activity
in one role cannot mask another; the target-absent/`up == 0` meta-alerts below
cover daemon-level failure.
Collator/node exporters are scraped as substrate exporters and remain
operator-version-specific; no rule assumes a non-frozen node metric name.

## Self-monitoring

Operators MUST use standard Prometheus meta-monitoring to alert when
`bleavit_chain_scrape_errors_total` increases and when either O5 daemon's target
is absent or has `up == 0` (`bleavit-chain-alerts` and
`bleavit-attestation-monitor`). Domain decode failures deliberately remove only
the affected chain-exporter families rather than publishing healthy-looking
zeros, so operators SHOULD also alert on absent required series. These are
operator-supplied exporter-health checks, not 12 §6.3 rows, and therefore are
not part of `check_alert_coverage.py`.

## 12 §6.3 row map

| Domain | Alert source | Status |
|---|---|---|
| Epoch progress | chain exporter (`epoch_status`) | live |
| Proposal state | chain exporter (`proposal_summaries`, `Epoch.IntakeProposals` occupancy/bound) | live |
| Markets | runtime-side book P&L + `b·ln2` (`TelemetryApi`) | live |
| TWAP | live unsealed-window coverage projection (`TelemetryApi`) | live; `decision_stats` is sealed-window only |
| Liquidity floors | runtime-side effective POL/floor (`TelemetryApi`) | live |
| Oracle | chain exporter (`open_oracle_rounds`) | live |
| Collateralization | runtime-side escrow/custody reconciliation per primary/service ledger instance (`TelemetryApi`) | live; page |
| Treasury | chain exporter (`nav`) | live |
| XCM | chain exporter trap count plus local/independent-Asset-Hub reserve-probe runway; node/runtime send/fail detail remains operational context | live alert threshold |
| Keepers | existing keeper daemon series | live |
| Guardian | chain exporter finalized events | live |
| Upgrades | canonical runtime migration-stall detector (`TelemetryApi`) | live; page |
| Storage | chain prefix counts + metadata bounds; remaining maps/PoV from runtime (`TelemetryApi`) | live |
| Numerics | runtime LMSR rejection/dust anomaly detector (`TelemetryApi` + finalized `ExtrinsicFailed` stream) | live |
| Bootnodes | browser-context dial/certificate probes | seam — O3 |
| Served-state window | per-operator retention probe | seam — O3 |
| Release integrity | attestation monitor | live; page + status + community |
| Descriptor lead time | chain exporter + attestation monitor | live |
| ReleaseChannel | chain exporter + attestation monitor | live |
| Keeper budget | chain exporter live Params + metadata-decoded keeper meter | live |
| Relay finality | relay finality monitor (independent relay RPC) | live; persistence window `[VERIFY]` |

## Ownership seams

O3 owns the browser-context dial, TLS-certificate, operator-diversity, and
served-state-retention probe exporter; its Prometheus job is deliberately
commented out until that artifact exists. O4 owns the actual `RB-*` runbook
content under `deploy/runbooks/`; O5 freezes the exact rule labels and routes
without fabricating those not-yet-authored runbooks. B10 is the existing
runtime-wiring closure milestone and is named on runtime-side telemetry gaps
where the frozen API and safe metadata-driven reads cannot produce the
canonical value.

The served-state alert uses the maximum retention reported by the joint fleet,
per 12 §6.3 ("Two observables this table left implicit"): all retention windows
end at now, so the longest operator window is the joint window. O3 owns the
per-operator probe exporter that feeds this series — it is a declared seam
today, so the rule is specified but cannot fire — and any stricter per-operator
shortfall sub-alerts.

## Attestation configuration and release schema

Copy [attestation-monitor.example.toml](attestation-monitor.example.toml) and
replace all placeholders. At least three independently operated gateways and at
least three independently operated RPC endpoints are required. Every gateway
and RPC carries a stable operator identifier; identifiers must be distinct in
their respective set, and normalized origins may not repeat. Those mechanical
checks catch aliases, not false declarations of organizational independence.
Each gateway also supplies explicit immutable-TXID and canonical-name root URL
templates. They must address the browser-visible root itself; the monitor binds
both responses to the path manifest's listed `index.path` bytes and does not
infer a root from the per-file `{path}` API.
Resource limits, RPC poll cadence, and the release-key signature minimum are
explicitly operator-supplied because the architecture does not fix them. The
three release-integrity webhook sets are mandatory. Their URLs are credentials:
the monitor never logs a URL or exception text on delivery failure, only the
logical channel and a redacted failure class/status. Public minisign keys use
[keyring.example.toml](keyring.example.toml) as a shape guide; every key carries
an `organization` stable identifier, and the file contains no usable key or
secret.

The deployment requirement is **at least two independent monitor operators,
disjoint from ArNS controllers** (12 §2.2/§5.2/§6.5). Software cannot prove
natural-person or organizational disjointness; the signer registry and
operations ceremony must enforce it.

The adapter consumes the app producer's canonical
`schema = "bleavit.app-release.v1"` document. The monitoring-critical fields use
the producer's camelCase names:

- `arweaveManifestTxId` is the pass-1 asset manifest **M**;
- `perFileHashes` is the non-empty path → lowercase SHA-256 map for every
  asset in M; it excludes `release.json` because the signed document cannot hash
  itself;
- `specVersionRange = {primary, recovery}` carries the adjacent runtime pair;
- `keyringGeneration` selects the release/attestor key generation; and
- `readiness.productionReady` must be `true` for an unattended production
  verdict.

There are no snake_case or provisional-schema aliases. A document using the old
monitor-only shape is rejected instead of being interpreted as a release.

Credential TXIDs deliberately do **not** appear in those signed bytes. After
uploading the final `release.json` and its detached credentials, produce the
independent deterministic index:

```sh
python3 tools/monitoring/credential_index.py \
  --release-json release.json \
  --final-manifest FINAL_MANIFEST_TXID \
  --release-signature RELEASE_SIGNATURE_TXID_1 \
  --release-signature RELEASE_SIGNATURE_TXID_2 \
  --attestation ATTESTATION_TXID_1 \
  --attestation ATTESTATION_TXID_2 \
  --output release-credentials.json
```

Upload `release-credentials.json`, then provision its Arweave TXID and the
producer's printed SHA-256 into `credential_index_txid` and
`credential_index_sha256` through an authenticated operator-controlled channel
that is independent of ArNS, the gateways, and the served bundle. Publish the
same two pins in the release notes as a redundant public record; that copy is
not the monitor's trust root. The example deliberately uses invalid placeholders
and configuration validation also rejects all-zero pins. The
index schema is `bleavit.release-credentials.v1`: it binds
`release_json_sha256` and the explicitly supplied final-manifest **M′**
`manifest_txid` to separate `release_signatures` and `attestations` TXID lists.
Its exact field set is strict; unknown/duplicate fields, duplicate transaction
IDs, cross-role reuse, or fewer than two entries per credential role are
rejected. M′ is what ArNS and `ReleaseChannel` identify, and it must differ from
the asset manifest M named by `release.json`. The monitor fetches the exact
configured index TXID through every gateway, requires byte equality and the
out-of-band SHA-256 pin, and refuses a release/index/channel binding mismatch.

Detached signatures and the index stay outside both release path manifests,
avoiding the circular file-hash/signature dependency. The monitor fetches M
from `arweaveManifestTxId` and M′ from every resolved TXID through every gateway,
requires M's paths to equal `perFileHashes` and M′'s paths to equal M plus
`release.json`, then compares the asset routes under both manifests and the
browser-visible final/name routes. It verifies both root routes against M′'s
manifest-selected index and treats even one resolver disagreement as an
integrity failure. It fetches detached signature transactions through every
gateway, supports
minisign `Ed` and `ED` (BLAKE2b-512 prehash), requires the configured
release-key minimum and attestations from at least two distinct organizations,
applies the on-chain revocation mask, and binds `keyringGeneration` and final M′
to `ReleaseChannel` while keeping asset M distinct.

## Privacy boundary

Per 12 §6.1 and the closing paragraph of §6.3, this stack monitors
**infrastructure only**. The decentralized frontend ships no telemetry of any
kind. Its only diagnostic channel remains a user-initiated copy-to-clipboard
report.
