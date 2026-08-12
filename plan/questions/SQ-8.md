---
id: SQ-8
title: What is the canonical `ParamKey` encoding for dotted 13 §1 names longer than 16 bytes? `key16` silently truncates (e.g. `intake.max_per_account` → `intake.max_per_a`); no collisions today (test-pinned), but the FE must replicate the exact rule to call `params()`.
spec_ref: 02 §2 (`ParamKey`); 13 §1
raised: 2026-07-15 (A1 spec-reviewer)
status: resolved
resolved: 2026-07-15
batch: none
---

## Question

What is the canonical `ParamKey` encoding for dotted 13 §1 names longer than 16 bytes? `key16` silently truncates (e.g. `intake.max_per_account` → `intake.max_per_a`); no collisions today (test-pinned), but the FE must replicate the exact rule to call `params()`.

## Status

**resolved 2026-07-15** (batch): 13 rule 6 canonical encoding — UTF-8 ≤16 zero-padded, truncation forbidden (`key16` rejects), explicit `key:` identifiers annotated per row (e.g. `intake.max_acct`, `keeper.budget`)
