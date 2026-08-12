Audit this repository's implementation against the specification in
docs/architecture/ (AGENTS.md is binding). REPORT-ONLY: do not fix anything, and
never modify docs/architecture/.

1. SCOPE. Use the scope named at the end of this prompt (component, path, milestone
   ID, or "all"); default = everything changed since the last record in `plan/audits/`
   log, else everything implemented. Owning docs: constitution→06+13 · conditional
   ledger→03 · market/fixed-point→04 · epoch/welfare/decision→05 · origins/guardian/
   attestor→06 · oracle/registry→07 · treasury→08 · execution-guard→09 · runtime
   assembly→01 §5–6 · frontend→10/11 · release tooling→12 · reference model→04 §5.

2. REVIEW each in-scope component against: its owning doc; 02 (storage/event/call/type
   names must match byte-for-byte — 02's spelling is canonical); 13 (no hardcoded
   copies of parameter values, in code or tests); 15 (required try-state checks,
   PT-suites, negative tests actually exist). Check semantics adversarially: rounding
   direction (against the claimant), bounds and MaxEncodedLen, origin checks and
   filter closure, status-quo default on failure paths, no unwrap/expect/panic in
   runtime code, no XCM imports in decision/settlement pallets (I-24). Frontend:
   INV-FE-1…15 texts in 15 §2.

3. REPORT. Verdict line (`COMPLIANT` or `N deviations: b blocker / m major / n minor`),
   then a table `| Severity | Deviation | Spec | Code | Suggested fix |` with precise
   citations (e.g. `03 §6.3`) and `path:line`. blocker = invariant/contract/guarantee
   violation; major = observable deviation from normative text; minor = drift or
   missing test obligation. List SPEC-QUESTIONs (spec ambiguous/contradictory/silent)
   separately — these become `plan/questions/SQ-*.md` items, never silent assumptions.

4. RECORD. Append a record to today's `plan/audits/<YYYY>/<MM>/<YYYY-MM-DD>.md`, and
   create any new `plan/questions/SQ-*.md` items. Append today's `plan/log/` record;
   then end with the report.
