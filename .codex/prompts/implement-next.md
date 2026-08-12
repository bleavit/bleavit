Run spec-driven implementation increments for this repository, following AGENTS.md
(which you must treat as binding). One increment = one milestone, or one clearly-scoped
slice of a large one. When an increment closes, continue to the next item without waiting
to be asked (R-5); each increment gets its own full pass of the protocol below. Protocol:

1. ORIENT. Read PLAN.md, the selected `plan/milestones/<ID>.md`, relevant open
   `plan/questions/` items, and the newest `plan/log/` records. Target = the milestone named at the end of this prompt if any;
   otherwise the 🔨 in-progress milestone; otherwise the first ⬜ milestone whose
   Depends column is all ✅. Confirm the scope in one sentence before coding.

2. READ THE SPEC FIRST. docs/architecture/ is the authoritative specification and the
   source of truth for behavior — implementation follows it. It is editable, but treat
   changes as rare and deliberate under AGENTS.md rule R-1 (consistent across the doc
   set, version-bumped when 02 changes, logged in `plan/decisions/`); do not casually
   rewrite it to fit the code. Read every section in the milestone's Spec column, plus the
   relevant parts of 02-integration-contract.md (contract names/types), 13-parameters.md
   (the only source of numeric values), and 15-invariants-and-testing.md (verification
   duties). If the spec is ambiguous or contradictory: create a `plan/questions/SQ-*.md`
   item with a precise citation; proceed only if a conservative reading is safe, else mark
   the milestone ⛔ and stop.

3. IMPLEMENT. Finish or park the increment cleanly before starting the next one — never
   carry two half-done milestones. Non-negotiables: no floats / no wall-clock phase
   logic / checked or saturating arithmetic and typed errors everywhere (status-quo
   default, G-1); bounded collections with bounds from 13 §4; storage/event/call names
   byte-identical to 02; parameters never hardcoded (kernel constants from
   futarchy-primitives, tunables from pallet-constitution); rounding against the
   claimant; explicit origin checks; try-state per 15 §1. Frontend: INV-FE-1…15 bind
   (15 §2) — finalized verified reads, provenance typing, package firewall, no telemetry.

4. VERIFY. Write the tests the milestone's `verify:` field and doc 15 demand. Run the
   gates: cargo fmt --all -- --check · cargo clippy --workspace --all-targets -- -D warnings ·
   cargo test --workspace (scale to what exists; frontend: lint/typecheck/test/build).
   Then re-read the owning spec sections and self-review the diff against them,
   adversarially.

5. CLOSE. Update the milestone file in this same session (done only with green gates
   and no known spec deviations; otherwise active with exact resume notes), update
   Current focus when it changes, and append today's `plan/log/` day file. Refresh README.md /
   AGENTS.md if repo shape or commands changed. Report honestly: delivered work, gate
   output (verbatim on failure), open questions, suggested conventional-commit message
   with the milestone ID (e.g. `feat(ledger): split/merge families (A2)`). Do not
   commit or push unless the user asked.

Then go on to the next item. A session ends when the work or the user says so, not when a
milestone happens to close. Never end with the repository changed but the plan tree stale.
