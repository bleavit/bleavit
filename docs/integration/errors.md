# Error handling

Every refusal is deterministic. The client-side pallet and TypeScript facade use a small local
vocabulary; Bleavit uses the architecture-16 service vocabulary. No integration needs a support
channel to identify a missed precondition.

## Client pallet: `CLIENT-001`…`CLIENT-019`

| Code | Refusal |
|---|---|
| CLIENT-001 | `BadSpendingOrigin` — `ask`, `open`, or `seal` requires the configured spending/governance origin; widening it grants authority to debit shared sovereign USDC and consume XCM fees |
| CLIENT-002 | `BadBleavitOrigin` — inbound push was not the exact Bleavit sovereign |
| CLIENT-003 | `QuestionStakeEmpty` |
| CLIENT-004 | `QuestionBudgetUnavailable` — fixed-point subsidy arithmetic refused the terms |
| CLIENT-005 | `RegistrationBudgetOverflow` |
| CLIENT-006 | `WindowOverflow` |
| CLIENT-007 | `IngressWithdrawalEmpty` |
| CLIENT-008 | `IngressFeeEmpty` |
| CLIENT-009 | `IngressFeeExceedsWithdrawal` |
| CLIENT-010 | `XcmSendFailed` |
| CLIENT-011 | `WrongClient` |
| CLIENT-012 | `InvalidReportProvenance` |
| CLIENT-013 | `ReportAlreadyReceived` |
| CLIENT-014 | `ReportCapacityReached` |
| CLIENT-015 | `ReportHandlerRejected` — local writes roll back |
| CLIENT-016 | `TryStateViolation` |
| CLIENT-017 | `BadReportPruneOrigin` — pruning requires the configured governance origin |
| CLIENT-018 | `ReportPruned` — the report is at or below the durable replay floor |
| CLIENT-019 | `ReportPruneNotAdvanced` — the requested cutoff did not advance the replay floor |

## Hosted service refusals

These names are the exact `QuestionService`/registry errors from architecture 16 §11:

`NotRegistered`, `ClientRemoved`, `ClientBondUnset`, `DuplicateLocation`, `ClientsFull`,
`ClientIdExhausted`, `BondInsufficient`, `BondAccounting`, `QuestionCounterOverflow`,
`DeliveryFloatAmountZero`, `DeliveryFloatInsufficient`, `DeliveryFloatWouldDrain`,
`DeliveryFloatBelowMinimum`, `DeliveryFundingWouldDust`, `DeliveryFloatOverflow`,
`DeliveryFloatAccounting`, `NoLiveQuestions`, `ServicePaused`, `ServiceRateUnset`,
`CertificationUnavailable`, `StakeBelowFloor`, `SubsidyBelowMinimum`, `EpsilonOutOfRange`,
`WindowTooLong`, `WindowTooShort`, `WindowCollidesWithDecision`, `SlotsExhausted`,
`TvlCapWouldBind`, `AttestorSetTooSmall`, `AttestorBondInsufficient`, `ClientIsProtocolAccount`,
`EscrowInsufficient`, `NotSealed`, `AlreadySealed`, `AlreadyTerminal`, `QuorumNotReached`,
`MedianOutOfRange`, `DeadlineNotReached`, `UnknownQuestion`, `DeadlinePassed`, `CreationFrozen`,
`DuplicateAttestor`, `UnknownAttestor`, `AlreadyBonded`, `InvalidSubId`, `ArithmeticOverflow`,
`ArchiveNotReady`, `TryStateViolation`.

The optional report-push leg also classifies internal, non-dispatch refusals as `Validate`,
`Fee(RouterQuoteUnsupported)`, `Fee(PricingUnavailable)`, `Fee(PrepaymentRefused)`, or `Deliver`.
Those do not invalidate the authoritative stored report.

## TypeScript facade

`@bleavit/client-ts` exposes:

| Code | Meaning |
|---|---|
| FE-PROV-001 | the read was not pinned and proof-verified at the requested finalized header |
| FE-PROV-002 | the report is absent or its v22 provenance hash is invalid |
| FE-TX-001 | prepared registration state was stale before signing |
| FE-TX-002 | a generated PAPI submission was rejected |
