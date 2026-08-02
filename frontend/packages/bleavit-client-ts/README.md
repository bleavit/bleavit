# `@bleavit/client-ts`

The off-chain integration path for Bleavit hosted questions. It is a thin facade over a generated
PAPI/smoldot adapter:

```ts
import { BleavitClient } from "@bleavit/client-ts";

const client = new BleavitClient(papiBridge);
await client.register({
  declaredStake: 100_000n * USDC,
  epsilon1e9: 50_000_000n,
  tolerance1e9: 20_000_000n,
  window: 30 * DAYS,
  attestors: [alice, bob, carol],
  rule: { minAcceptImprovement1e9: 10_000_000n },
}, signer);
const report = await client.readReport(questionId);
```

The adapter is the only descriptor-specific seam. It must return a finalized block pin and a
proof-verified `QuestionService::Reports` read, and it delegates typed PAPI transaction builders.
The package itself verifies the v22 provenance preimage and refuses unpinned reads; it never trusts
metadata-selected call indexes or hand-encoded bytes.

See [`types.ts`](src/types.ts) for the small adapter contract and the integration docs for a PAPI
descriptor example.
