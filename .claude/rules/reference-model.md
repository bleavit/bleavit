---
paths: ["reference-model/**"]
---

# Reference model rules (independent executable spec)

The Python reference model exists to catch bugs in the Rust implementation by
**independent derivation** (15 §4.4). Its value dies if it mirrors the implementation.

1. **Independence is the point.** Never port, transcribe, or "align" Rust runtime code
   into the model — implement from `docs/architecture/` text alone. When model and
   pallet disagree, that is a finding to investigate against the spec, not a diff to
   silently make green on either side.
2. **Vectors are generated, never hand-maintained.** The normative LMSR vectors V1–V6
   and the MPFR differential corpus are regenerated in CI from this model on every
   change (04 §5); a hand-edited expected value is a defect (the shipped hand-computed
   V1 error is the standing justification).
3. **Determinism.** Fixed seeds, no wall-clock, no environment-dependent behavior;
   byte-identical JSON output for identical inputs (stable key order, explicit precision).
   The transcendental reference math runs at **≥ 256-bit precision** (the model uses
   100-digit `Decimal` ≈ 332-bit; MPFR-256 is an equivalent — the precision is normative,
   the library is not; 15 §4.4).
4. **Corpus schema is owned by `04 §5`.** The JSON vector schema (`reference-model/
   fixtures/vectors.json`, `bleavit.reference-model.vN`) is normatively owned by
   `04-markets-and-pricing.md` §5, not by `02 §11` (02's artifact table deliberately
   covers only the four runtime-surface artifacts — the corpus is consumed by test
   suites, never by the running frontend). Fields are **append-only within a major
   `N`** and need no contract bump; a breaking layout change bumps `N`. Every row must
   carry the inputs needed to replay it standalone. The backend differential suites and
   the frontend TypeScript port both certify against this one artifact.
5. **Scope.** The model covers LMSR cost/pricing, TWAP, the ledger operation semantics
   (incl. gate/Baseline/VOID and rounding), the welfare pipeline, and the decision rule
   with reason codes (05 §4.4 bit-identical requirement), plus the treasury arithmetic
   of 08 (its worked examples are normative for Phase 0).
