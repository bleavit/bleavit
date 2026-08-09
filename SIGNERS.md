# SIGNERS — the release signer registry

**Owning specification:** [12 §2.2](docs/architecture/12-release-and-operations.md) (signer
disjointness), [12 §2.1](docs/architecture/12-release-and-operations.md) (key architecture),
[12 §2.3](docs/architecture/12-release-and-operations.md) (revocation),
[12 §1.4](docs/architecture/12-release-and-operations.md) (the release checklist and its
floors), [12 §4.2](docs/architecture/12-release-and-operations.md) (ArNS control).
Milestone **F13**.

12 §2.2 point 1 requires this file by name. It lists every active minisign key id, every ANT
controller address and every attestor key. Each one maps to a stable operator identifier,
which is a named person or a named organizational role a named person holds.

The mapping is the mechanism, not decoration. 12 §2.2 evaluates disjointness over **natural
persons**. A checker that intersected key identifiers would pass forever, because a minisign
key id is never also an Arweave address. It would report success having compared nothing.
So an unmapped key is **refused rather than skipped**. An unmapped key is not a key outside
the check. It is a key the check cannot see.

This document is the human rendering. The machine-readable half is
[`app/tools/release/sources/signers.json`](app/tools/release/sources/signers.json), which
[`app/tools/verify-release/registry.ts`](app/tools/verify-release/registry.ts) reads. The two
are one artifact in two renderings. `python3 tools/deploy/check-signers.py` binds them in both
directions. An entry in the JSON with no row here is a key nobody published. A row here with
no entry in the JSON is a person no check can see.

Role assignments for the operational services live in
[`deploy/ops-handbook/README.md`](deploy/ops-handbook/README.md), which defers to this file for
these four populations. A second list of the same people is a second list to keep in step.

## How this file is checked

Run `python3 tools/deploy/check-signers.py`. It is bidirectional and it fails closed:

- Every population identifier below matches the populations `registry.ts` declares.
- Every entry field the JSON documents matches the fields `registry.ts` accepts.
- Every counted floor below matches the constant the counting code reads.
- Every disjointness pair below matches the pairs `registry.ts` enforces.
- Every registry row below matches one JSON entry, field for field, and back again.
- Every seated count below matches the JSON, and `UNSEATED` means exactly zero.

`--strict` additionally refuses an unseated population. A release gate runs `--strict`. CI runs
the plain form, because every population is legitimately unseated before the ceremony and a
gate that stays red by design is a gate nobody reads.

**An empty registry is reported as empty, never as clean.** Disjointness between an empty set
and anything holds by construction. Holding for want of members is a different claim from
holding by separation, and only the second is the control working. The checker prints
`unseated` in that state and never prints a separation verdict.

## Populations

12 §2.2 keeps two pairs apart and deliberately leaves one overlap open. Attestors may also be
release signers, because §2.2 separates the *shipping* authority from the *naming* authority
and an attestor holds neither.

The `Role` column of the registry below uses these role names, and the checker builds the map
from this table. The map is declared once.

| Role | Identifier | What it is | Seated | State |
|---|---|---|---|---|
| Release signer | release-signer | A minisign key that signs `release.json`'s hash (12 §2.1) | 0 | UNSEATED |
| ArNS controller | arns-controller | A controller share of the ANT that resolves `futarchy` (12 §4.2) | 0 | UNSEATED |
| Monitor operator | monitor-operator | An out-of-band attestation-monitor operator (12 §5.2) | 0 | UNSEATED |
| Attestor | attestor | An independent builder's minisign key (12 §1.4 gate 2) | 0 | UNSEATED |

## Disjointness

| Population | Must not overlap | Why |
|---|---|---|
| release-signer | arns-controller | D-16: about three insiders holding two ArNS shares and two release keys ship a fully self-verifying malicious release. Separation forces collusion across two organizationally separated groups. |
| monitor-operator | arns-controller | 12 §5.2: the out-of-band monitor is the compensating control for a hostile service worker and for a hostile repoint. A controller who also runs the monitor watching their own repoint is not an independent observer. |

## Counted floors

Each number below is read from the code that counts it. A number stated here and nowhere else
is a claim nothing enforces.

| Rule | Value | Where the number lives |
|---|---|---|
| Release signatures | 2 | `SIGNATURE_FLOOR` in `app/tools/verify-release/verdict.ts` |
| Attestations | 2 | `ATTESTATION_FLOOR` in `app/tools/verify-release/verdict.ts` |
| ArNS controller quorum | 3-of-5 | `checkControllerQuorum` in `app/tools/verify-release/registry.ts` |

Each floor is counted in the way that is easy to get wrong. 12 §1.4 counts release signatures
over **distinct active keys of the current keyring generation, after excluding every revoked
key**. Two signatures from one key is one key. 12 §1.4 gate 2 counts attestations over
**distinct organizations**, because two attestations from one organization is one
reproduction. 12 §4.2 prohibits single-key custody of the production ANT under any
circumstance, including temporarily during bootstrap.

## Registry

Every row names one identity. `Person` is the natural person 12 §2.2 point 1 requires.
`Organization` is what 12 §1.4 gate 2 counts by. `Keyring generation` and `Revocation index`
belong to minisign keys only, and an ANT controller address must leave both empty.
`Revocation index` is the bit this key occupies in
[02 §12](docs/architecture/02-integration-contract.md)'s `revoked_key_bits`. Without it a
verifier holding the on-chain bits cannot name a single revoked key.

| Person | Organization | Role | Key identifier | Keyring generation | Revocation index |
|---|---|---|---|---|---|

**This table is empty, and that is the true state rather than an omission.** No key ceremony
has been held. No ANT is registered. No monitor operator is seated. Every population above is
therefore unseated, and `verify-release signers audit --strict` refuses a release against it.
The names are the one part of this document nothing in the repository can produce. They arrive
from the ceremony below.

## Key ceremony

12 §2.1 fixes the properties every key of both populations must have. Keys are hardware-backed
and geographically distributed. The ceremony is documented. Rotation is annual with overlap.
Old keyrings stay in the app so historical releases remain verifiable, tagged by keyring
generation.

12 §2.2 point 3 governs every issuance, rotation and revocation:

1. Hold the ceremony with multi-party witnesses. The witness requirement is one of the two
   mitigations for the declared residual below.
2. Update this file and
   [`signers.json`](app/tools/release/sources/signers.json) in the same change.
3. Run `python3 tools/deploy/check-signers.py --strict` and
   `pnpm -C app run signers:audit --strict`. Both must pass before the registry is published.
4. Re-attest the disjointness predicate over the updated registry. 12 §2.2 point 3 requires at
   least two attestors, in a signed attestation transaction.
5. Mirror the updated registry on Arweave, as 12 §2.2 point 1 requires.
6. Review the predicate again each quarter.

Revocation adds one step from 12 §2.3. Set the key's index in `ReleaseChannel.revoked_key_bits`
and bump `keyring_generation`. Preserve the guard-owned offsets 112 to 119 and the
`URGENT_UPGRADE` bit exactly. Set the `SECURITY` flag when a live release carries a signature
from the revoked key. [`deploy/runbooks/RB-RELEASE.md`](deploy/runbooks/RB-RELEASE.md) owns the
operational procedure.

CI holds no key of either population, by design. 12 §1.4 states it directly. A compromised CI
can block a release and cannot ship one alone.

## The declared residual

12 §2.2 records it and nothing here narrows it. The mechanical check operates on **declared**
identities. One person declared under two identities defeats it. That is a limit on
organizational honesty rather than on the checker, and doc 14 carries it as a threat row beside
the founding-multisig insider row. The two mitigations are the ceremony's multi-party witness
requirement and the attestor sign-off above.

What this file makes true is narrower and worth stating plainly. The declaration exists, it is
complete, and it is checkable.
