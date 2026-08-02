# Integrating an off-chain service

Use [`@bleavit/client-ts`](../../frontend/packages/bleavit-client-ts/README.md). It supplies the
registration/open/seal facade, finalized-pin refresh, storage-proof boundary, and v22 provenance
check. You provide a generated PAPI bridge and a local signer; you do not write XCM, SCALE bytes, or
fee arithmetic.

Non-normative; [16 §2/§5/§9](../architecture/16-hosted-question-service.md) owns this surface.

## The flow

```ts
import { BleavitClient } from "@bleavit/client-ts";

const bleavit = new BleavitClient(papiBridge);
await bleavit.register({
  subId: requestId,
  declaredStake: 100_000n * USDC,
  epsilon1e9: 50_000_000n,
  tolerance1e9: 20_000_000n,
  window: 30 * DAYS,
  attestors: [alice, bob, carol],
  rule: { minAcceptImprovement1e9: 10_000_000n },
}, localSigner);

const report = await bleavit.readReport(questionId);
// report.status.kind === "verified-finalized"
// report.value is proof-backed and its provenance hash is v22-verified.
```

The bridge's generated PAPI adapter reads `QuestionService::Reports` at one finalized `chainHead`
with a verified trie proof and delegates typed `tx.QuestionService.register/open/seal` builders. The
facade refreshes the finalized pin immediately before signing a registration, so a stale fee/window
read cannot silently become the transaction the user approves.

## Authentication and settlement

The registry binds exactly one local signer to the service client id. The account is the only signed
origin that can register, open, or seal for that client. Named attestors still report the realized
value and the permissionless settle/void crank remains part of the service lifecycle.

For a report you did not request, the same proof and provenance checks apply. Read
[`reading-the-report.md`](reading-the-report.md) before using `certified`, `manip_floor`, or
`settlement_trust` as decision inputs.

## Refusal handling

`BleavitClientError` exposes `FE-PROV-001` for an unpinned/unverified read, `FE-PROV-002` for a
missing or provenance-invalid report, and `FE-TX-001`/`FE-TX-002` for stale preparation or a
rejected submission. Remote dispatch refusals remain the deterministic architecture-16 names and
are returned by the generated PAPI transaction result; see [`errors.md`](errors.md).
