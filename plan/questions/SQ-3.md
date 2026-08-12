---
id: SQ-3
title: `AttestationMissing` has two mandated producing sites across the doc set, which 05's exclusivity clause forbids. 05 §1.3 declares "every variant has exactly one producing site … MUST NOT emit from any other site" and maps `AttestationMissing` to `decide()` step 10 → T10; 05 §2.1 T16 enumerates the `Queued → Rejected` reason set as `{ StaleQueue, NotRatified }` only. But 09 §1.2(5) and 15 I-19 require the execution guard's **dispatch-time** re-check to produce `Rejected(AttestationMissing)` (post-queue attestation revocation), which is a `Queued → Rejected(AttestationMissing)` transition. The A11 (#40) fix implements the 09/I-19 behavior (guard propagates `AttestationMissing` through `epoch.expire_or_stale_queue` → T16-shaped reject → T21), so it is compliant with the execution guard's owning doc but violates 05's producer-map exclusivity and T16's closed reason set. **Recommended resolution:** extend 05 §2.1 T16's reason set to include `AttestationMissing` and relax 05 §1.3's "exactly one producing site" clause for this variant (option a) — dropping the dispatch-time producer (option b) would remove a security check (I-19). Needs a spec decision, not a code change; the code already tracks 09.
spec_ref: 05 §1.3, §2.1 T16 vs 09 §1.2(5); 15 I-19
raised: 2026-07-14
status: resolved
resolved: 2026-07-14
batch: none
---

## Question

`AttestationMissing` has two mandated producing sites across the doc set, which 05's exclusivity clause forbids. 05 §1.3 declares "every variant has exactly one producing site … MUST NOT emit from any other site" and maps `AttestationMissing` to `decide()` step 10 → T10; 05 §2.1 T16 enumerates the `Queued → Rejected` reason set as `{ StaleQueue, NotRatified }` only. But 09 §1.2(5) and 15 I-19 require the execution guard's **dispatch-time** re-check to produce `Rejected(AttestationMissing)` (post-queue attestation revocation), which is a `Queued → Rejected(AttestationMissing)` transition. The A11 (#40) fix implements the 09/I-19 behavior (guard propagates `AttestationMissing` through `epoch.expire_or_stale_queue` → T16-shaped reject → T21), so it is compliant with the execution guard's owning doc but violates 05's producer-map exclusivity and T16's closed reason set. **Recommended resolution:** extend 05 §2.1 T16's reason set to include `AttestationMissing` and relax 05 §1.3's "exactly one producing site" clause for this variant (option a) — dropping the dispatch-time producer (option b) would remove a security check (I-19). Needs a spec decision, not a code change; the code already tracks 09.

## Status

**resolved 2026-07-14** (option a, user-approved; 05 §1.3/§2.1 + 15 I-19 edited — see Decision log)
