------------------------------ MODULE Proposal ------------------------------
(***************************************************************************
 * Bleavit proposal-machine model.
 *
 * Normative sources: 05 §2.1 (T1--T24), §5.4--5.5; 06 §5.2--5.4
 * (including the conditionally modeled §5.3 force_rerun edge); 07 §10--11;
 * 09 §1.2(5); 15 §1 (I-9/I-14/I-15/I-18), §4.1.
 *
 * `history` contains proposal-machine transitions only.  Environment actions
 * (values ratification, attestation revocation, clocks, and oracle status)
 * do not change p.state.  Automatic T17/T21 couplings append two adjacent
 * rows in one TLC step, matching their same-dispatch/same-block semantics.
 ***************************************************************************
*)

EXTENDS Naturals, Sequences, FiniteSets, TLC

CONSTANTS MUTATE_I14, MUTATE_T16_ENQUEUE, MUTATE_FORCE_CANCEL_EXECUTE,
          MUTATE_ORPHAN_BASELINE, MUTATE_BASELINE_LIVE_STATE,
          ForceRerunModeled

ASSUME /\ MUTATE_I14 \in BOOLEAN
       /\ MUTATE_T16_ENQUEUE \in BOOLEAN
       /\ MUTATE_FORCE_CANCEL_EXECUTE \in BOOLEAN
       /\ MUTATE_ORPHAN_BASELINE \in BOOLEAN
       /\ MUTATE_BASELINE_LIVE_STATE \in BOOLEAN
       /\ ForceRerunModeled \in BOOLEAN

Rows == {"T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8",
         "T9", "T10", "T11", "T12", "T13", "T14", "T15", "T16",
         "T17", "T18", "T19", "T20", "T21", "T22", "T23", "T24",
         "FR"}

ProposalStates ==
    {"Absent", "Submitted", "Screening", "Qualified", "Trading",
     "Extended", "Queued", "Suspended", "Rerun", "Executed",
     "FailedExecuted", "Rejected", "Expired", "Measuring", "Settled",
     "Cancelled"}

\* Constitutional subjects take the values/referenda track without markets
\* (05 \S1.1, \S5.6), so that separate machine is outside this model.
AllClasses == {"Param", "Treasury", "Code", "Meta"}
SmallClasses == {"Param", "Code"}
RatificationClasses == {"Code", "Meta"}

GateRequirementOptions(proposalClass) ==
    IF proposalClass \in {"Code", "Meta"}
       THEN {TRUE}
       ELSE IF proposalClass = "Treasury" THEN BOOLEAN ELSE {FALSE}

VaultStates == {"None", "Open", "ResolvedAccept", "ResolvedReject", "Voided"}
ResolveMechanisms == {"None", "T17Accept", "T21Reject"}
ChallengeStates == {"None", "Open", "Closed", "Contested"}
CohortStates == {"None", "Measuring", "Settled", "Void"}
SettlementKinds == {"None", "Money", "Neutral", "Void"}

(***************************************************************************
 * The epoch's Baseline vault (03 §2.2/§5.2; 05 §7(5)--(6); 15 §4.1).
 *
 * Modelled only to the depth the 15 §4.1 liveness obligation needs: the vault
 * has no `Voided` variant (03 §6.4) because every discharge is a settlement,
 * so two states suffice.  `via` records WHICH of the three normative
 * transitions settled it, and exists so the reachability witnesses can prove
 * each discharge path has a concrete trace rather than only a spec sentence.
 *
 * Scope: this is a single-proposal model, so the modelled epoch owns exactly
 * one proposal and `p.cohort` doubles as the epoch's `CohortInfo`.  The vault
 * is `Open` in `Init` -- the strongest reading of "every epoch that opens a
 * Baseline vault", and one that costs no branching.  It over-approximates the
 * shipped runtime, which seeds the Baseline book and vault lazily inside
 * `open_markets` at T7, so an epoch whose only proposal ends before `Trading`
 * has no vault at all.  Sound, because 03 §5.2 and 05 §7(6) both make "no
 * Baseline vault for the epoch" an explicit no-op -- assuming one always
 * exists can only make the property harder to satisfy -- but it means a
 * counterexample trace may strand a vault after a T2/T4 termination the chain
 * would never have opened one for.  The 08 §4.3 zero-qualified-proposal epoch
 * is likewise NOT covered: `Absent` is not a terminal proposal state, so the
 * crank stays blocked while `p` is `Absent`.  Both directions are conservative
 * -- they can only hide a discharge, never a stranding.
 ***************************************************************************
*)
BaselineStates == {"Open", "Settled"}
BaselineVias == {"None", "Cohort", "Void", "Crank"}

Actions ==
    {"Submit", "Withdraw", "Tick", "Decide", "GuardianDelay",
     "GuardianForceRerun", "GuardianReview", "GuardExecute", "GuardReject",
     "AutomaticResolve", "SettleCohort"}

RejectReasons ==
    {"None", "NotDecisionGrade", "GateVetoSurvival", "GateVetoSecurity",
     "HurdleNotMet", "ConvergenceFailed", "SecondExtensionFailed",
     "ProcessHold", "ConstitutionViolation", "ResourceConflict",
     "RateLimited", "VetoUpheldByReview", "StaleQueue", "PayloadReverted",
     "NotRatified", "SecuritySizing", "AttestationMissing"}

T10Reasons == RejectReasons \ {"None", "VetoUpheldByReview", "StaleQueue",
                               "PayloadReverted", "NotRatified"}
T16Reasons == {"StaleQueue", "NotRatified", "AttestationMissing"}
ForbiddenBeforeExecution == {"T10", "T15", "T16", "T20", "T24"}
ExecutionRows == {"T14", "T23"}
DecisionRows == {"T8", "T9", "T10"}

GateResults ==
    {"NotEvaluated", "Invalid", "NoVeto", "SurvivalVeto", "SecurityVeto"}
GateVetoes == {"SurvivalVeto", "SecurityVeto"}
SmallWelfareResults ==
    {"Pass", "RaisedHurdleMiss", "Insufficient", "Disagree"}
FullWelfareResults ==
    SmallWelfareResults \cup {"HurdleFail", "NonConverged", "SecurityFail",
                              "AttestationFail", "RateLimited"}
WelfareResults == FullWelfareResults \cup {"NotEvaluated"}
SmallEarlyReasons == {"ProcessHold"}
FullEarlyReasons ==
    {"ProcessHold", "ConstitutionViolation", "ResourceConflict"}

MaxMandates == 2

\* Real dispatch/action names used by transition records.  Environment inputs
\* (clocks, oracle status) are not calls and therefore are not attempt labels.
AttemptOps ==
    (Actions \ {"AutomaticResolve"})
    \ IF ForceRerunModeled THEN {} ELSE {"GuardianForceRerun"}

Transition(row, action, fromState, toState, reason, mandate) ==
    [row |-> row, action |-> action, from |-> fromState, to |-> toState,
     reason |-> reason, mandate |-> mandate]

Decision(gate, welfare, welfareSaysAdopt, rerun, outcome, reason, row, mandate) ==
    [gate |-> gate, welfare |-> welfare,
     welfareSaysAdopt |-> welfareSaysAdopt, rerun |-> rerun,
     outcome |-> outcome,
     reason |-> reason, row |-> row, mandate |-> mandate]

Settlement(observedStatus, originStatus, outcome) ==
    [observedStatus |-> observedStatus, originStatus |-> originStatus,
     outcome |-> outcome]

TransitionType ==
    [row: Rows, action: Actions, from: ProposalStates, to: ProposalStates,
     reason: RejectReasons, mandate: 0..MaxMandates]

DecisionType ==
    [gate: GateResults, welfare: WelfareResults, welfareSaysAdopt: BOOLEAN,
     rerun: BOOLEAN, outcome: {"Adopt", "Extend", "Reject"},
     reason: RejectReasons,
     row: DecisionRows, mandate: 0..MaxMandates]

SettlementType ==
    [observedStatus: ChallengeStates,
     originStatus: {"Closed", "Contested"},
     outcome: {"Money", "Neutral", "Void"}]

VARIABLES p, history, decisionHistory, settlementHistory, attemptAudit, bl

vars == <<p, history, decisionHistory, settlementHistory, attemptAudit, bl>>

\* Everything the proposal machine owns.  The epoch-level Baseline actions
\* leave all of it untouched, which is what keeps every pre-existing invariant
\* and `TerminalStatesAbsorb` valid across the enlarged model.
proposalVars == <<p, history, decisionHistory, settlementHistory>>

PreExecutedNonTerminal ==
    {"Submitted", "Screening", "Qualified", "Trading", "Extended",
     "Queued", "Suspended", "Rerun", "FailedExecuted"}

Terminal ==
    \/ p.state = "Cancelled"
    \/ p.state = "Settled"
    \/ /\ p.state = "Rejected"
       /\ p.vault \in {"None", "Voided"}
    \/ /\ p.state = "Measuring"
       /\ p.cohort = "Void"

Init ==
    /\ p = [state |-> "Absent",
            proposalClass |-> "None",
            requiresGates |-> FALSE,
            extended |-> FALSE,
            delayedOnce |-> FALSE,
            rerun |-> FALSE,
            guardianRerunUsed |-> FALSE,
            retrospectiveReviewScheduled |-> FALSE,
            rollovers |-> 0,
            vault |-> "None",
            resolveCount |-> 0,
            resolveMechanism |-> "None",
            mandateCounter |-> 0,
            activeMandate |-> 0,
            executedMandate |-> 0,
            goodMandates |-> {},
            barredMandates |-> {},
            forceCancelledMandates |-> {},
            ratified |-> "Pending",
            attestationLive |-> FALSE,
            versionInvalidated |-> FALSE,
            graceExpired |-> FALSE,
            retryExpired |-> FALSE,
            retryExpiredMandates |-> {},
            challenge |-> "None",
            contestedEver |-> FALSE,
            neutralized |-> FALSE,
            cohort |-> "None",
            settlementKind |-> "None",
            t20Occurred |-> FALSE,
            t20HadVault |-> FALSE]
    /\ history = <<>>
    /\ decisionHistory = <<>>
    /\ settlementHistory = <<>>
    /\ attemptAudit = [op |-> "None", rejected |-> FALSE]
    /\ bl = [state |-> "Open",
             via |-> "None",
             epochPast |-> FALSE,
             doubleSettle |-> FALSE]

Submit(classes) ==
    /\ p.state = "Absent"
    /\ \E c \in classes:
        \E requiresGates \in GateRequirementOptions(c):
          /\ p' = [p EXCEPT !.state = "Submitted",
                            !.proposalClass = c,
                            !.requiresGates = requiresGates,
                            !.attestationLive = c \in RatificationClasses,
                            !.ratified = IF c \in RatificationClasses
                                           THEN "Pending" ELSE "Passed"]
          /\ history' = Append(history,
                                Transition("T1", "Submit", "Absent",
                                           "Submitted", "None", 0))
          /\ UNCHANGED <<decisionHistory, settlementHistory>>

Withdraw ==
    /\ p.state = "Submitted"
    /\ p' = [p EXCEPT !.state = "Cancelled"]
    /\ history' = Append(history,
                          Transition("T2", "Withdraw", "Submitted",
                                     "Cancelled", "None", 0))
    /\ UNCHANGED <<decisionHistory, settlementHistory>>

StartScreening ==
    /\ p.state = "Submitted"
    /\ p' = [p EXCEPT !.state = "Screening"]
    /\ history' = Append(history,
                          Transition("T3", "Tick", "Submitted",
                                     "Screening", "None", 0))
    /\ UNCHANGED <<decisionHistory, settlementHistory>>

CancelScreening ==
    /\ p.state = "Screening"
    /\ p' = [p EXCEPT !.state = "Cancelled"]
    /\ history' = Append(history,
                          Transition("T4", "Tick", "Screening", "Cancelled",
                                     "ConstitutionViolation", 0))
    /\ UNCHANGED <<decisionHistory, settlementHistory>>

Qualify ==
    /\ p.state = "Screening"
    /\ p' = [p EXCEPT !.state = "Qualified"]
    /\ history' = Append(history,
                          Transition("T5", "Tick", "Screening", "Qualified",
                                     "None", 0))
    /\ UNCHANGED <<decisionHistory, settlementHistory>>

Rollover ==
    /\ p.state = "Screening"
    /\ p.rollovers = 0
    /\ p' = [p EXCEPT !.state = "Submitted", !.rollovers = 1]
    /\ history' = Append(history,
                          Transition("T6", "Tick", "Screening", "Submitted",
                                     "None", 0))
    /\ UNCHANGED <<decisionHistory, settlementHistory>>

OpenMarkets ==
    /\ p.state = "Qualified"
    /\ p.vault = "None"
    /\ p' = [p EXCEPT !.state = "Trading", !.vault = "Open"]
    /\ history' = Append(history,
                          Transition("T7", "Tick", "Qualified", "Trading",
                                     "None", 0))
    /\ UNCHANGED <<decisionHistory, settlementHistory>>

AddBarred(active, barred) ==
    IF active = 0 THEN barred ELSE barred \cup {active}

RejectAndMeasure(parentRow, parentAction, intermediate, reason, decisions) ==
    /\ p.vault = "Open"
    /\ p.resolveCount = 0
    /\ p' = [p EXCEPT !.state = "Measuring",
                      !.vault = "ResolvedReject",
                      !.resolveCount = 1,
                      !.resolveMechanism = "T21Reject",
                      !.activeMandate = 0,
                      !.barredMandates = AddBarred(p.activeMandate, @),
                      !.challenge = "Open",
                      !.cohort = "Measuring"]
    /\ history' = history \o
          <<Transition(parentRow, parentAction, p.state, intermediate, reason,
                       p.activeMandate),
            Transition("T21", "AutomaticResolve", intermediate, "Measuring",
                       "None", p.activeMandate)>>
    /\ decisionHistory' = decisions
    /\ UNCHANGED settlementHistory

GateReason(gate) ==
    IF gate = "SurvivalVeto"
       THEN "GateVetoSurvival"
       ELSE "GateVetoSecurity"

WelfareSaysAdopt(welfare, rerun) ==
    \/ welfare = "Pass"
    \/ /\ welfare = "RaisedHurdleMiss"
       /\ ~rerun

EffectiveGate(gate, earlyReason) ==
    IF earlyReason = "None" THEN gate ELSE "NotEvaluated"

EffectiveWelfare(gate, welfare, earlyReason) ==
    IF earlyReason # "None" \/ gate = "Invalid"
       THEN "NotEvaluated"
       ELSE welfare

WelfareRejectReason(result) ==
    CASE result = "Insufficient"    -> "NotDecisionGrade"
      [] result = "Disagree"        -> "SecondExtensionFailed"
      [] result = "RaisedHurdleMiss" -> "HurdleNotMet"
      [] result = "HurdleFail"      -> "HurdleNotMet"
      [] result = "NonConverged"    -> "ConvergenceFailed"
      [] result = "SecurityFail"    -> "SecuritySizing"
      [] result = "AttestationFail" -> "AttestationMissing"
      [] result = "RateLimited"     -> "RateLimited"

(***************************************************************************
 * One shared abstraction of the normative 05 \S5.4 ordering.  Every decide
 * evaluation supplies all three environment observations at once.  Earlier
 * checks dominate later ones; in particular a gate veto dominates even a
 * welfare observation that independently says Adopt (I-14).
 *
 * The mutation constant is FALSE in every production and witness config.
 * MutationI14.cfg flips it to demonstrate that I-14 detects an override.
 ***************************************************************************
*)
DecideOutcome(gate, welfare, earlyReason, extended, rerun) ==
    IF earlyReason # "None"
       THEN [outcome |-> "Reject", reason |-> earlyReason, row |-> "T10"]
    ELSE IF gate = "Invalid"
       THEN [outcome |-> "Reject", reason |-> "NotDecisionGrade",
             row |-> "T10"]
    ELSE IF gate \in GateVetoes
       THEN IF MUTATE_I14 /\ WelfareSaysAdopt(welfare, rerun)
               THEN [outcome |-> "Adopt", reason |-> "None", row |-> "T9"]
               ELSE [outcome |-> "Reject", reason |-> GateReason(gate),
                     row |-> "T10"]
    ELSE IF WelfareSaysAdopt(welfare, rerun)
       THEN [outcome |-> "Adopt", reason |-> "None", row |-> "T9"]
    ELSE IF welfare \in {"Insufficient", "Disagree"} /\ ~extended
       THEN [outcome |-> "Extend", reason |-> "None", row |-> "T8"]
       ELSE [outcome |-> "Reject", reason |-> WelfareRejectReason(welfare),
             row |-> "T10"]

DecisionRecord(gate, welfare, result, mandate) ==
    Decision(gate, welfare, WelfareSaysAdopt(welfare, p.rerun), p.rerun,
             result.outcome, result.reason, result.row, mandate)

ExtendFromDecision(gate, welfare, result) ==
    /\ p.state = "Trading"
    /\ ~p.extended
    /\ p' = [p EXCEPT !.state = "Extended", !.extended = TRUE]
    /\ history' = Append(history,
                          Transition("T8", "Decide", "Trading", "Extended",
                                     "None", p.activeMandate))
    /\ decisionHistory' =
           Append(decisionHistory, DecisionRecord(gate, welfare, result,
                                                   p.activeMandate))
    /\ UNCHANGED settlementHistory

QueueFromDecision(gate, welfare, result) ==
    /\ p.state \in {"Trading", "Extended"}
    /\ p.mandateCounter < MaxMandates
    /\ LET newMandate == p.mandateCounter + 1 IN
        /\ p' = [p EXCEPT !.state = "Queued",
                          !.mandateCounter = newMandate,
                          !.activeMandate = newMandate,
                          !.goodMandates = @ \cup {newMandate},
                          !.graceExpired = FALSE]
        /\ history' = Append(history,
                              Transition("T9", "Decide", p.state, "Queued",
                                         "None", newMandate))
        /\ decisionHistory' =
               Append(decisionHistory, DecisionRecord(gate, welfare, result,
                                                       newMandate))
        /\ UNCHANGED settlementHistory

RejectFromDecision(gate, welfare, result) ==
    RejectAndMeasure(
        "T10", "Decide", "Rejected", result.reason,
        Append(decisionHistory, DecisionRecord(gate, welfare, result,
                                                p.activeMandate)))

ApplyDecision(gate, welfare, result) ==
    CASE result.outcome = "Adopt" -> QueueFromDecision(gate, welfare, result)
      [] result.outcome = "Extend" -> ExtendFromDecision(gate, welfare, result)
      [] result.outcome = "Reject" -> RejectFromDecision(gate, welfare, result)

GateChoices(gateInvalidEnabled) ==
    IF p.requiresGates
       THEN {"NoVeto"} \cup GateVetoes
            \cup IF gateInvalidEnabled THEN {"Invalid"} ELSE {}
       ELSE {"NoVeto"}

DecideEvaluation(welfareResults, earlyReasons, gateInvalidEnabled) ==
    /\ p.state \in {"Trading", "Extended"}
    /\ \E gate \in GateChoices(gateInvalidEnabled),
          welfare \in welfareResults,
          earlyReason \in earlyReasons \cup {"None"}:
         /\ welfare # "RaisedHurdleMiss" \/ p.rerun
         /\ welfare # "AttestationFail"
            \/ p.proposalClass \in RatificationClasses
         /\ LET result == DecideOutcome(gate, welfare, earlyReason,
                                         p.extended, p.rerun) IN
               ApplyDecision(EffectiveGate(gate, earlyReason),
                             EffectiveWelfare(gate, welfare, earlyReason),
                             result)

GuardianDelay ==
    /\ p.state = "Queued"
    /\ ~p.delayedOnce
    /\ ~p.guardianRerunUsed
    /\ ~p.graceExpired
    /\ p' = [p EXCEPT !.state = "Suspended",
                      !.delayedOnce = TRUE,
                      !.guardianRerunUsed = TRUE,
                      !.retrospectiveReviewScheduled = TRUE]
    /\ history' = Append(history,
                          Transition("T11", "GuardianDelay", "Queued",
                                     "Suspended", "None", p.activeMandate))
    /\ UNCHANGED <<decisionHistory, settlementHistory>>

ScheduleRerun ==
    /\ p.state = "Suspended"
    /\ p' = [p EXCEPT !.state = "Rerun"]
    /\ history' = Append(history,
                          Transition("T12", "Tick", "Suspended", "Rerun",
                                     "None", p.activeMandate))
    /\ UNCHANGED <<decisionHistory, settlementHistory>>

OpenRerun ==
    /\ p.state = "Rerun"
    /\ p' = [p EXCEPT !.state = "Extended",
                      !.rerun = TRUE,
                      !.extended = TRUE,
                      !.graceExpired = FALSE]
    /\ history' = Append(history,
                          Transition("T13", "Tick", "Rerun", "Extended",
                                     "None", p.activeMandate))
    /\ UNCHANGED <<decisionHistory, settlementHistory>>

(***************************************************************************
 * 06 §5.3 force_rerun.  SQ-161 records that these edges are absent from
 * 05 §2.1's exhaustive T-table, so every edge is gated by the model constant
 * and carries its own FR label rather than claiming a T-row.
 *
 * The proposal enters a final Extended rerun window immediately.  A queued
 * mandate is cancelled atomically: its id is removed from activeMandate and
 * retained in both the general barred set and force-specific provenance set.
 * The guardian-shared rerun budget and retrospective review are consumed at
 * dispatch.  TWAP/POL/window resets and position preservation are market
 * effects; the proposal/vault shadow remains untouched here.
 ***************************************************************************
*)
GuardianForceRerun ==
    /\ ForceRerunModeled
    /\ p.state \in {"Trading", "Extended", "Queued"}
    /\ ~p.guardianRerunUsed
    /\ ~p.rerun
    /\ LET cancelled == IF p.state = "Queued" THEN p.activeMandate ELSE 0 IN
        /\ p' = [p EXCEPT !.state = "Extended",
                          !.extended = TRUE,
                          !.rerun = TRUE,
                          !.guardianRerunUsed = TRUE,
                          !.retrospectiveReviewScheduled = TRUE,
                          !.activeMandate = 0,
                          !.barredMandates = AddBarred(cancelled, @),
                          !.forceCancelledMandates = AddBarred(cancelled, @),
                          !.graceExpired = FALSE]
        /\ history' =
               Append(history,
                      Transition("FR", "GuardianForceRerun", p.state,
                                 "Extended", "None", cancelled))
        /\ UNCHANGED <<decisionHistory, settlementHistory>>

ReviewUpholdsVeto ==
    /\ p.state = "Suspended"
    /\ RejectAndMeasure(
           "T24", "GuardianReview", "Rejected", "VetoUpheldByReview",
           decisionHistory)

DispatchRevalidation ==
    /\ ~p.versionInvalidated
    /\ (p.proposalClass \notin RatificationClasses
        \/ p.ratified = "Passed")
    /\ (p.proposalClass \notin RatificationClasses \/ p.attestationLive)

InitialDispatchPreconditions ==
    /\ ~p.graceExpired
    /\ DispatchRevalidation

RetryDispatchPreconditions ==
    /\ ~p.retryExpired
    /\ DispatchRevalidation

ExecuteAndResolve(parentRow, fromState) ==
    /\ p.state = fromState
    /\ p.vault = "Open"
    /\ p.resolveCount = 0
    /\ p.activeMandate > 0
    /\ p' = [p EXCEPT !.state = "Measuring",
                      !.vault = "ResolvedAccept",
                      !.resolveCount = 1,
                      !.resolveMechanism = "T17Accept",
                      !.executedMandate = p.activeMandate,
                      !.activeMandate = 0,
                      !.challenge = "Open",
                      !.cohort = "Measuring"]
    /\ history' = history \o
          <<Transition(parentRow, "GuardExecute", fromState, "Executed", "None",
                       p.activeMandate),
            Transition("T17", "AutomaticResolve", "Executed", "Measuring",
                       "None", p.activeMandate)>>
    /\ UNCHANGED <<decisionHistory, settlementHistory>>

Execute ==
    /\ InitialDispatchPreconditions
    /\ ExecuteAndResolve("T14", "Queued")

Expire ==
    /\ p.state = "Queued"
    /\ p.graceExpired
    \* T16 failures take precedence over the generic T15 timeout.
    /\ ~p.versionInvalidated
    /\ (p.proposalClass \notin RatificationClasses
        \/ p.ratified = "Passed")
    /\ (p.proposalClass \notin RatificationClasses \/ p.attestationLive)
    /\ RejectAndMeasure("T15", "Tick", "Expired", "None", decisionHistory)

MutatedT16Enqueue(reason) ==
    /\ p.state = "Queued"
    /\ p.mandateCounter < MaxMandates
    /\ LET oldMandate == p.activeMandate IN
       LET newMandate == p.mandateCounter + 1 IN
         LET pass == [outcome |-> "Adopt", reason |-> "None", row |-> "T9"] IN
          /\ p' = [p EXCEPT !.state = "Queued",
                            !.mandateCounter = newMandate,
                            !.activeMandate = newMandate,
                            !.goodMandates = @ \cup {newMandate},
                            !.barredMandates = AddBarred(oldMandate, @)]
          /\ history' = history \o
                <<Transition("T16", "GuardReject", "Queued", "Rejected",
                             reason, oldMandate),
                  Transition("T21", "AutomaticResolve", "Rejected",
                             "Measuring", "None", oldMandate),
                  Transition("T9", "Decide", "Measuring", "Queued", "None",
                             newMandate)>>
          /\ decisionHistory' =
                Append(decisionHistory,
                       DecisionRecord("NoVeto", "Pass", pass, newMandate))
          /\ UNCHANGED settlementHistory

GuardReject(reason) ==
    /\ p.state = "Queued"
    /\ reason \in T16Reasons
    /\ CASE reason = "StaleQueue" -> p.versionInvalidated
          [] reason = "NotRatified" ->
                /\ p.proposalClass \in RatificationClasses
                /\ \/ p.ratified = "Failed"
                   \/ /\ p.graceExpired
                      /\ p.ratified = "Pending"
          [] reason = "AttestationMissing" ->
                /\ p.proposalClass \in RatificationClasses
                /\ ~p.attestationLive
    /\ IF MUTATE_T16_ENQUEUE
          THEN MutatedT16Enqueue(reason)
          ELSE RejectAndMeasure("T16", "GuardReject", "Rejected", reason,
                                decisionHistory)

PayloadReverts ==
    /\ p.state = "Queued"
    /\ p.activeMandate > 0
    /\ InitialDispatchPreconditions
    /\ p' = [p EXCEPT !.state = "FailedExecuted", !.retryExpired = FALSE]
    /\ history' = Append(history,
                          Transition("T18", "GuardExecute", "Queued",
                                     "FailedExecuted", "PayloadReverted",
                                     p.activeMandate))
    /\ UNCHANGED <<decisionHistory, settlementHistory>>

RetrySucceeds ==
    /\ RetryDispatchPreconditions
    /\ ExecuteAndResolve("T23", "FailedExecuted")

RetryExhausted ==
    /\ p.state = "FailedExecuted"
    /\ p.retryExpired
    /\ p.vault = "Open"
    /\ p.resolveCount = 0
    /\ p' = [p EXCEPT !.state = "Measuring",
                      !.vault = "ResolvedAccept",
                      !.resolveCount = 1,
                      \* T22 uses the same authorized ACCEPT-resolution primitive
                      \* as T17; history still records the normative T22 edge.
                      !.resolveMechanism = "T17Accept",
                      !.activeMandate = 0,
                      !.challenge = "Open",
                      !.cohort = "Measuring"]
    /\ history' = Append(history,
                          Transition("T22", "Tick", "FailedExecuted",
                                     "Measuring", "PayloadReverted",
                                     p.activeMandate))
    /\ UNCHANGED <<decisionHistory, settlementHistory>>

(***************************************************************************
 * Deliberate I-15 mutation: after an FR queue cancellation, dispatch the
 * cancelled mandate directly from Extended.  Enabled only by the dedicated
 * expected-violation config; production and ordinary witness scopes disable
 * it.  The resulting T14 edge is intentionally invalid and I-15 must reject
 * its force-cancellation provenance before any table-shape check is needed.
 ***************************************************************************
*)
MutatedForceCancelledExecute ==
    /\ MUTATE_FORCE_CANCEL_EXECUTE
    /\ p.state = "Extended"
    /\ p.vault = "Open"
    /\ p.resolveCount = 0
    /\ \E cancelled \in p.forceCancelledMandates:
        /\ p' = [p EXCEPT !.state = "Measuring",
                          !.vault = "ResolvedAccept",
                          !.resolveCount = 1,
                          !.resolveMechanism = "T17Accept",
                          !.executedMandate = cancelled,
                          !.activeMandate = 0,
                          !.challenge = "Open",
                          !.cohort = "Measuring"]
        /\ history' = history \o
              <<Transition("T14", "GuardExecute", "Extended", "Executed",
                           "None", cancelled),
                Transition("T17", "AutomaticResolve", "Executed",
                           "Measuring", "None", cancelled)>>
        /\ UNCHANGED <<decisionHistory, settlementHistory>>

ForceReject ==
    /\ p.state \in PreExecutedNonTerminal
    /\ LET hadVault == p.vault = "Open" IN
        /\ p' = [p EXCEPT !.state = "Rejected",
                          !.vault = IF hadVault THEN "Voided" ELSE "None",
                          !.activeMandate = 0,
                          !.barredMandates = AddBarred(p.activeMandate, @),
                          !.cohort = "None",
                          !.challenge = "None",
                          !.t20Occurred = TRUE,
                          !.t20HadVault = hadVault]
        /\ history' = Append(history,
                              Transition("T20", "Tick", p.state, "Rejected",
                                         "ProcessHold", p.activeMandate))
        /\ UNCHANGED <<decisionHistory, settlementHistory>>

ValuesRatify ==
    /\ p.proposalClass \in RatificationClasses
    /\ p.state \in PreExecutedNonTerminal
    /\ p.ratified = "Pending"
    /\ p' = [p EXCEPT !.ratified = "Passed"]
    /\ UNCHANGED <<history, decisionHistory, settlementHistory>>

RatificationFails ==
    /\ p.proposalClass \in RatificationClasses
    /\ p.state \in {"Queued", "FailedExecuted"}
    /\ p.ratified = "Pending"
    /\ p' = [p EXCEPT !.ratified = "Failed"]
    /\ UNCHANGED <<history, decisionHistory, settlementHistory>>

RevokeAttestation ==
    /\ p.proposalClass \in RatificationClasses
    /\ p.state \in {"Queued", "FailedExecuted"}
    /\ p.attestationLive
    /\ p' = [p EXCEPT !.attestationLive = FALSE]
    /\ UNCHANGED <<history, decisionHistory, settlementHistory>>

InvalidateVersion ==
    /\ p.state \in {"Queued", "FailedExecuted"}
    /\ ~p.versionInvalidated
    /\ p' = [p EXCEPT !.versionInvalidated = TRUE]
    /\ UNCHANGED <<history, decisionHistory, settlementHistory>>

AdvanceGrace ==
    /\ p.state = "Queued"
    /\ ~p.graceExpired
    /\ p' = [p EXCEPT !.graceExpired = TRUE]
    /\ UNCHANGED <<history, decisionHistory, settlementHistory>>

AdvanceRetryDeadline ==
    /\ p.state = "FailedExecuted"
    /\ ~p.retryExpired
    /\ p' = [p EXCEPT !.retryExpired = TRUE,
                      !.retryExpiredMandates = @ \cup {p.activeMandate}]
    /\ UNCHANGED <<history, decisionHistory, settlementHistory>>

CloseChallenge ==
    /\ p.state = "Measuring"
    /\ p.cohort = "Measuring"
    /\ p.challenge = "Open"
    /\ p' = [p EXCEPT !.challenge = "Closed"]
    /\ UNCHANGED <<history, decisionHistory, settlementHistory>>

ContestValue ==
    /\ p.state = "Measuring"
    /\ p.cohort = "Measuring"
    /\ p.challenge = "Open"
    /\ p' = [p EXCEPT !.challenge = "Contested", !.contestedEver = TRUE]
    /\ UNCHANGED <<history, decisionHistory, settlementHistory>>

NeutralizeContest ==
    /\ p.state = "Measuring"
    /\ p.cohort = "Measuring"
    /\ p.challenge = "Contested"
    /\ p' = [p EXCEPT !.challenge = "Closed", !.neutralized = TRUE]
    /\ UNCHANGED <<history, decisionHistory, settlementHistory>>

(***************************************************************************
 * The Baseline leg every cohort-settling transaction carries (05 §7(5); 03
 * §5.2).  It is mandatory and unconditional on that path, and it is the same
 * `settle_baseline` endpoint the §7(6) crank routes through.
 *
 * Finding the vault already `Settled` is recorded rather than ignored:
 * settling a Baseline before its cohort could still form is the failure mode
 * 05 §7(6) condition 3 exists to exclude, and it strands the whole cohort
 * instead of one holder.  `MutationBaselineLiveState.cfg` reaches it.
 ***************************************************************************
*)
SettleBaselineLeg(via) ==
    IF bl.state = "Open"
       THEN [bl EXCEPT !.state = "Settled", !.via = via]
       ELSE [bl EXCEPT !.doubleSettle = TRUE]

VoidContest ==
    /\ p.state = "Measuring"
    /\ p.cohort = "Measuring"
    /\ p.challenge = "Contested"
    /\ p' = [p EXCEPT !.vault = "Voided",
                      !.cohort = "Void",
                      !.settlementKind = "Void"]
    /\ settlementHistory' =
           Append(settlementHistory,
                  Settlement("Contested", "Contested", "Void"))
    \* 05 §7(5): the one settlement a VOID still performs, at neutral s = 0.5.
    /\ bl' = SettleBaselineLeg("Void")
    /\ UNCHANGED <<history, decisionHistory>>

SettleCohort ==
    /\ p.state = "Measuring"
    /\ p.cohort = "Measuring"
    /\ p.challenge = "Closed"
    /\ LET kind == IF p.neutralized THEN "Neutral" ELSE "Money" IN
        /\ p' = [p EXCEPT !.state = "Settled",
                          !.cohort = "Settled",
                          !.settlementKind = kind]
        /\ history' = Append(history,
                              Transition("T19", "SettleCohort", "Measuring",
                                         "Settled", "None", 0))
        /\ settlementHistory' =
               Append(settlementHistory,
                      Settlement("Closed",
                                 IF p.contestedEver
                                    THEN "Contested"
                                    ELSE "Closed",
                                 kind))
        \* 05 §6: `settle_cohort` settles Baseline(e) on the same measured pass.
        /\ bl' = SettleBaselineLeg("Cohort")
        /\ UNCHANGED decisionHistory

(***************************************************************************
 * Epoch-level Baseline transitions (05 §7(6); 03 §5.2).  None of them is a
 * proposal-machine transition, so none appends to `history`: 05 §2.1's T-table
 * has no row for them and `TransitionTableExhaustive` requires every row to
 * match exactly one T-row.  For the same reason `finalize_epoch_baseline` is
 * deliberately NOT in `AttemptOps` -- that audit asserts a dispatch is
 * REJECTED once the proposal is terminal, and this call is specified to be
 * admissible exactly then.
 ***************************************************************************
*)

\* The modelled epoch becomes strictly past (§7(6) condition 1).  Monotone, and
\* unconditionally enabled while the vault is still `Open`, so the `epochPast`
\* slice is always one admissible step away from any reachable state -- which
\* is what lets the safety invariant below stand in for the AG EF statement.
\* Freezing it once the vault settles is a pure state-space reduction: no
\* property reads `epochPast` outside the `bl.state = "Open"` case.
AdvanceEpoch ==
    /\ bl.state = "Open"
    /\ ~bl.epochPast
    /\ bl' = [bl EXCEPT !.epochPast = TRUE]
    /\ UNCHANGED proposalVars

(***************************************************************************
 * §7(6) condition 3, rendered over this model's single proposal.
 *
 * The shipped predicate is `epoch_core::is_terminal_state` -- deliberately
 * neither the model's `Terminal` nor the negation of `is_live_state`.  The
 * mutation reproduces the rejected `is_live_state` reading, which reports
 * `Submitted`/`Screening` terminal even though a proposal stamped with this
 * epoch keeps that stamp across the boundary and can still form the cohort.
 ***************************************************************************
*)
TerminalForCrank ==
    \/ p.state \in {"Settled", "Cancelled", "Expired", "Rejected"}
    \/ /\ MUTATE_BASELINE_LIVE_STATE
       /\ p.state \in {"Submitted", "Screening"}

\* All three §7(6) preconditions, re-checked at dispatch.  Condition 2 is
\* `p.cohort = "None"`: cohort state is set only together with `Measuring` and
\* never returns to "None", so it covers the live `CohortInfo` and the archived
\* `CohortSummary` alike.  The mutation removes the call from the machine
\* entirely, which is what the pre-SQ-320 chain was.
CrankAdmissible ==
    /\ ~MUTATE_ORPHAN_BASELINE
    /\ bl.epochPast
    /\ p.cohort = "None"
    /\ TerminalForCrank

\* 05 §7(6) `pallet-epoch::finalize_epoch_baseline(e)`, permissionless.  The
\* "already `Settled` is a no-op returning Ok" clause is modelled by leaving the
\* action disabled there: a no-op changes no state.
FinalizeEpochBaseline ==
    /\ bl.state = "Open"
    /\ CrankAdmissible
    /\ bl' = [bl EXCEPT !.state = "Settled", !.via = "Crank"]
    /\ UNCHANGED proposalVars

EpochBaselineStep ==
    \/ AdvanceEpoch
    \/ FinalizeEpochBaseline

\* Every proposal-machine transition that does not touch the epoch's Baseline
\* vault.  `VoidContest` and `SettleCohort` are the two that do (05 §7(5)) and
\* are pulled out below so they can carry their own `bl'`.
PlainProgress(classes, welfareResults, earlyReasons, gateInvalidEnabled) ==
    \/ Submit(classes)
    \/ Withdraw
    \/ StartScreening
    \/ CancelScreening
    \/ Qualify
    \/ Rollover
    \/ OpenMarkets
    \/ DecideEvaluation(welfareResults, earlyReasons, gateInvalidEnabled)
    \/ GuardianDelay
    \/ ScheduleRerun
    \/ OpenRerun
    \/ GuardianForceRerun
    \/ ReviewUpholdsVeto
    \/ Execute
    \/ Expire
    \/ \E r \in T16Reasons: GuardReject(r)
    \/ PayloadReverts
    \/ RetrySucceeds
    \/ RetryExhausted
    \/ MutatedForceCancelledExecute
    \/ ForceReject
    \/ ValuesRatify
    \/ RatificationFails
    \/ RevokeAttestation
    \/ InvalidateVersion
    \/ AdvanceGrace
    \/ AdvanceRetryDeadline
    \/ CloseChallenge
    \/ ContestValue
    \/ NeutralizeContest

Progress(classes, welfareResults, earlyReasons, gateInvalidEnabled) ==
    \/ /\ PlainProgress(classes, welfareResults, earlyReasons,
                        gateInvalidEnabled)
       /\ UNCHANGED bl
    \/ VoidContest
    \/ SettleCohort

TerminalRejectedAttempt ==
    /\ Terminal
    /\ \E op \in AttemptOps:
         /\ attemptAudit' = [op |-> op, rejected |-> TRUE]
         /\ UNCHANGED <<p, history, decisionHistory, settlementHistory, bl>>

(***************************************************************************
 * The epoch-level Baseline step is available in BOTH regions -- including the
 * absorbing `Terminal` one, which is the whole point of 05 §7(6): the epoch
 * whose every proposal took T20 is exactly an epoch whose proposal machine has
 * stopped.  Gating it behind `~Terminal`, as the proposal transitions are,
 * would make the crank unreachable in the only region where it matters.
 ***************************************************************************
*)
SmallNext ==
    \/ /\ IF Terminal
             THEN TerminalRejectedAttempt
             ELSE /\ Progress(SmallClasses, SmallWelfareResults,
                               SmallEarlyReasons, FALSE)
                  /\ UNCHANGED attemptAudit
    \/ /\ EpochBaselineStep
       /\ UNCHANGED attemptAudit

FullNext ==
    \/ /\ IF Terminal
             THEN TerminalRejectedAttempt
             ELSE /\ Progress(AllClasses, FullWelfareResults,
                               FullEarlyReasons, TRUE)
                  /\ UNCHANGED attemptAudit
    \/ /\ EpochBaselineStep
       /\ UNCHANGED attemptAudit

SmallSpec == Init /\ [][SmallNext]_vars
FullSpec == Init /\ [][FullNext]_vars

(***************************************************************************
 * Types and transition-table exhaustiveness.
 ***************************************************************************
*)

TypeOK ==
    /\ p.state \in ProposalStates
    /\ p.proposalClass \in AllClasses \cup {"None"}
    /\ p.requiresGates \in BOOLEAN
    /\ p.extended \in BOOLEAN
    /\ p.delayedOnce \in BOOLEAN
    /\ p.rerun \in BOOLEAN
    /\ p.guardianRerunUsed \in BOOLEAN
    /\ p.retrospectiveReviewScheduled \in BOOLEAN
    /\ p.rollovers \in 0..1
    /\ p.vault \in VaultStates
    /\ p.resolveCount \in 0..1
    /\ p.resolveMechanism \in ResolveMechanisms
    /\ p.mandateCounter \in 0..MaxMandates
    /\ p.activeMandate \in 0..MaxMandates
    /\ p.executedMandate \in 0..MaxMandates
    /\ p.goodMandates \subseteq 1..MaxMandates
    /\ p.barredMandates \subseteq 1..MaxMandates
    /\ p.forceCancelledMandates \subseteq 1..MaxMandates
    /\ p.ratified \in {"Pending", "Passed", "Failed"}
    /\ p.attestationLive \in BOOLEAN
    /\ p.versionInvalidated \in BOOLEAN
    /\ p.graceExpired \in BOOLEAN
    /\ p.retryExpired \in BOOLEAN
    /\ p.retryExpiredMandates \subseteq 1..MaxMandates
    /\ p.challenge \in ChallengeStates
    /\ p.contestedEver \in BOOLEAN
    /\ p.neutralized \in BOOLEAN
    /\ p.cohort \in CohortStates
    /\ p.settlementKind \in SettlementKinds
    /\ p.t20Occurred \in BOOLEAN
    /\ p.t20HadVault \in BOOLEAN
    /\ attemptAudit.op \in AttemptOps \cup {"None"}
    /\ attemptAudit.rejected \in BOOLEAN
    /\ bl.state \in BaselineStates
    /\ bl.via \in BaselineVias
    /\ bl.epochPast \in BOOLEAN
    /\ bl.doubleSettle \in BOOLEAN
    /\ history \in Seq(TransitionType)
    /\ decisionHistory \in Seq(DecisionType)
    /\ settlementHistory \in Seq(SettlementType)

RowEdgeOK(row, tr) ==
    CASE row = "T1"  -> tr.from = "Absent" /\ tr.to = "Submitted"
      [] row = "T2"  -> tr.from = "Submitted" /\ tr.to = "Cancelled"
      [] row = "T3"  -> tr.from = "Submitted" /\ tr.to = "Screening"
      [] row = "T4"  -> tr.from = "Screening" /\ tr.to = "Cancelled"
      [] row = "T5"  -> tr.from = "Screening" /\ tr.to = "Qualified"
      [] row = "T6"  -> tr.from = "Screening" /\ tr.to = "Submitted"
      [] row = "T7"  -> tr.from = "Qualified" /\ tr.to = "Trading"
      [] row = "T8"  -> tr.from = "Trading" /\ tr.to = "Extended"
      [] row = "T9"  -> tr.from \in {"Trading", "Extended"} /\ tr.to = "Queued"
      [] row = "T10" -> tr.from \in {"Trading", "Extended"} /\ tr.to = "Rejected"
      [] row = "T11" -> tr.from = "Queued" /\ tr.to = "Suspended"
      [] row = "T12" -> tr.from = "Suspended" /\ tr.to = "Rerun"
      [] row = "T13" -> tr.from = "Rerun" /\ tr.to = "Extended"
      [] row = "T14" -> tr.from = "Queued" /\ tr.to = "Executed"
      [] row = "T15" -> tr.from = "Queued" /\ tr.to = "Expired"
      [] row = "T16" -> tr.from = "Queued" /\ tr.to = "Rejected"
      [] row = "T17" -> tr.from = "Executed" /\ tr.to = "Measuring"
      [] row = "T18" -> tr.from = "Queued" /\ tr.to = "FailedExecuted"
      [] row = "T19" -> tr.from = "Measuring" /\ tr.to = "Settled"
      [] row = "T20" -> tr.from \in PreExecutedNonTerminal /\ tr.to = "Rejected"
      [] row = "T21" -> tr.from \in {"Rejected", "Expired"} /\ tr.to = "Measuring"
      [] row = "T22" -> tr.from = "FailedExecuted" /\ tr.to = "Measuring"
      [] row = "T23" -> tr.from = "FailedExecuted" /\ tr.to = "Executed"
      [] row = "T24" -> tr.from = "Suspended" /\ tr.to = "Rejected"
      [] row = "FR"  -> tr.from \in {"Trading", "Extended", "Queued"}
                        /\ tr.to = "Extended"

RowActionOK(row, tr) ==
    CASE row = "T1"  -> tr.action = "Submit"
      [] row = "T2"  -> tr.action = "Withdraw"
      \* Modelling scope (SQ-98/SQ-286): 05 SS2.1's T20 row also names `decide()`
      \* as a producer - under a VOID condition, a stale epoch or an active
      \* PB-LEDGER-FREEZE, `decide` and `tick` share one predicate and one
      \* disposition. This model binds T20 to "Tick" alone ON PURPOSE. It carries
      \* no freeze variable, so the freeze-driven edge is unreachable here; and
      \* admitting "Decide" for T20 would make a Decide/Trading->Rejected/
      \* ProcessHold step match BOTH T10 (ProcessHold is in T10Reasons) and T20,
      \* breaking the `Cardinality(matches) = 1` clause of
      \* TransitionTableExhaustive. Disambiguating needs the vault outcome in the
      \* transition record - T20 voids, T10 resolves into measurement - which is
      \* a modelling change owed its own pass.
      [] row \in {"T3", "T4", "T5", "T6", "T7", "T12", "T13",
                   "T15", "T20", "T22"} -> tr.action = "Tick"
      [] row \in {"T8", "T9", "T10"} -> tr.action = "Decide"
      [] row = "T11" -> tr.action = "GuardianDelay"
      [] row \in {"T14", "T18", "T23"} -> tr.action = "GuardExecute"
      [] row = "T16" -> tr.action = "GuardReject"
      [] row \in {"T17", "T21"} -> tr.action = "AutomaticResolve"
      [] row = "T19" -> tr.action = "SettleCohort"
      [] row = "T24" -> tr.action = "GuardianReview"
      [] row = "FR" -> tr.action = "GuardianForceRerun"

RowReasonOK(row, tr) ==
    CASE row = "T4"  -> tr.reason = "ConstitutionViolation"
      [] row = "T10" -> tr.reason \in T10Reasons
      [] row = "T16" -> tr.reason \in T16Reasons
      [] row \in {"T18", "T22"} -> tr.reason = "PayloadReverted"
      [] row = "T20" -> tr.reason = "ProcessHold"
      [] row = "T24" -> tr.reason = "VetoUpheldByReview"
      [] OTHER -> tr.reason = "None"

ImplementsRow(row, tr) ==
    /\ RowEdgeOK(row, tr)
    /\ RowActionOK(row, tr)
    /\ RowReasonOK(row, tr)

CountRow(row) == Cardinality({i \in 1..Len(history): history[i].row = row})

TransitionTableExhaustive ==
    /\ IF Len(history) = 0
          THEN p.state = "Absent"
          ELSE /\ history[1].from = "Absent"
               /\ history[Len(history)].to = p.state
    /\ \A i \in 1..(Len(history) - 1):
           history[i].to = history[i + 1].from
    /\ \A i \in 1..Len(history):
           LET matches == {row \in Rows: ImplementsRow(row, history[i])} IN
             /\ Cardinality(matches) = 1
             /\ history[i].row \in matches
    /\ Len(decisionHistory) =
           Cardinality({i \in 1..Len(history): history[i].row \in DecisionRows})

(***************************************************************************
 * I-15 and I-9.  Mandate ids distinguish the pre-delay queue entry from the
 * fresh T9 entry after T13.
 ***************************************************************************
*)

DecisionProvesFullPass(mandate) ==
    \E i \in 1..Len(decisionHistory):
        /\ decisionHistory[i].row = "T9"
        /\ decisionHistory[i].mandate = mandate
        /\ decisionHistory[i].gate = "NoVeto"
        /\ decisionHistory[i].welfare = "Pass"
        /\ decisionHistory[i].outcome = "Adopt"

ExecutionHasSafeEnqueue(execIndex) ==
    \E queueIndex \in 1..(execIndex - 1):
        /\ history[queueIndex].row = "T9"
        /\ history[queueIndex].mandate = history[execIndex].mandate
        /\ history[queueIndex].from \in {"Trading", "Extended"}
        /\ DecisionProvesFullPass(history[execIndex].mandate)
        /\ \A badIndex \in (queueIndex + 1)..(execIndex - 1):
               history[badIndex].row \in ForbiddenBeforeExecution \cup {"FR"}
               => history[badIndex].mandate # history[execIndex].mandate

I15NoRejectedMandateExecutes ==
    /\ \A i \in 1..Len(history):
           history[i].row \in ExecutionRows => ExecutionHasSafeEnqueue(i)
    \* A terminal failure for this pid can never be followed by another enqueue.
    /\ \A i, j \in 1..Len(history):
           /\ i < j
           /\ history[i].row \in ForbiddenBeforeExecution
           => history[j].row # "T9"
    /\ (p.executedMandate = 0) =
           (Cardinality({i \in 1..Len(history):
                           history[i].row \in ExecutionRows}) = 0)
    /\ p.executedMandate = 0
       \/ /\ p.executedMandate \in p.goodMandates
          /\ p.executedMandate \notin p.barredMandates
          /\ p.executedMandate \notin p.forceCancelledMandates

I9OnlyDecideQueuesOnlyGuardExecutes ==
    /\ \A i \in 1..Len(history):
           history[i].to = "Queued"
           => /\ history[i].row = "T9"
              /\ history[i].action = "Decide"
    /\ \A i \in 1..Len(history):
           history[i].to = "Executed"
           => /\ history[i].row \in ExecutionRows
              /\ history[i].action = "GuardExecute"

(***************************************************************************
 * I-14: gate evaluation is structurally before the welfare result.  The
 * independent welfareSaysAdopt flag makes the no-override case non-vacuous.
 ***************************************************************************
*)

I14GateVetoBeforeWelfare ==
    /\ \A i \in 1..Len(decisionHistory):
           decisionHistory[i].gate \in GateVetoes
           => /\ decisionHistory[i].outcome = "Reject"
              /\ decisionHistory[i].reason =
                    GateReason(decisionHistory[i].gate)
              /\ decisionHistory[i].row = "T10"
    /\ \A i \in 1..Len(decisionHistory):
           decisionHistory[i].row = "T9"
           => decisionHistory[i].gate = "NoVeto"

RerunRaisedHurdleApplied ==
    \A i \in 1..Len(decisionHistory):
       /\ decisionHistory[i].rerun
       /\ decisionHistory[i].welfare = "RaisedHurdleMiss"
       /\ decisionHistory[i].gate = "NoVeto"
       => /\ decisionHistory[i].outcome = "Reject"
          /\ decisionHistory[i].reason = "HurdleNotMet"
          /\ decisionHistory[i].row = "T10"

NoRetryAfterDeadline ==
    \A i \in 1..Len(history):
       history[i].row = "T23"
       => history[i].mandate \notin p.retryExpiredMandates

TerminalAttemptsRejected ==
    attemptAudit.rejected
    => /\ Terminal
       /\ attemptAudit.op \in AttemptOps

(***************************************************************************
 * I-18, budgets, same-block automatic coupling, and vault sanity.
 ***************************************************************************
*)

I18ChallengeClosedSettlement ==
    /\ \A i \in 1..Len(settlementHistory):
           settlementHistory[i].outcome = "Money"
           => /\ settlementHistory[i].observedStatus = "Closed"
              /\ settlementHistory[i].originStatus = "Closed"
    /\ \A i \in 1..Len(settlementHistory):
           settlementHistory[i].originStatus = "Contested"
           => settlementHistory[i].outcome \in {"Neutral", "Void"}
    /\ CountRow("T19") =
           Cardinality({i \in 1..Len(settlementHistory):
                          settlementHistory[i].outcome \in {"Money", "Neutral"}})
    /\ p.contestedEver => p.settlementKind # "Money"

BudgetsAndRerunFinality ==
    /\ CountRow("T8") <= 1
    /\ CountRow("T11") <= 1
    /\ CountRow("FR") <= 1
    /\ CountRow("T11") + CountRow("FR") <= 1
    /\ p.delayedOnce = (CountRow("T11") = 1)
    /\ p.guardianRerunUsed =
          (CountRow("T11") + CountRow("FR") = 1)
    /\ p.retrospectiveReviewScheduled = p.guardianRerunUsed
    /\ (p.rerun => /\ p.extended
                    /\ p.guardianRerunUsed)
    /\ \A i, j \in 1..Len(history):
           /\ i < j
           /\ history[i].row = "T13"
           => history[j].row \notin {"T8", "T11", "FR"}
    /\ \A i, j \in 1..Len(history):
           /\ i < j
           /\ history[i].row = "FR"
           => history[j].row \notin {"T8", "T11", "FR"}

SameBlockT21ExactlyOnce ==
    /\ \A i \in 1..Len(history):
           history[i].row \in {"T10", "T15", "T16", "T24"}
           => /\ i < Len(history)
              /\ history[i + 1].row = "T21"
              /\ history[i + 1].from = history[i].to
    /\ \A i \in 1..Len(history):
           history[i].row = "T21"
           => /\ i > 1
              /\ history[i - 1].row \in {"T10", "T15", "T16", "T24"}

VaultCouplingSanity ==
    /\ (p.resolveCount = 0) = (p.resolveMechanism = "None")
    /\ p.vault = "ResolvedAccept" => p.resolveMechanism = "T17Accept"
    /\ p.vault = "ResolvedReject" => p.resolveMechanism = "T21Reject"
    /\ p.resolveMechanism = "T17Accept"
       => \E i \in 1..Len(history): history[i].row \in {"T17", "T22"}
    /\ p.resolveMechanism = "T21Reject"
       => \E i \in 1..Len(history): history[i].row = "T21"
    /\ p.state \in {"Measuring", "Settled"} => p.resolveCount = 1
    /\ p.t20Occurred =>
          /\ p.state = "Rejected"
          /\ p.cohort = "None"
          /\ p.challenge = "None"
          /\ CountRow("T20") = 1
          /\ history[Len(history)].row = "T20"
    /\ p.t20HadVault => p.vault = "Voided"

TerminalStatesAbsorb == [] (Terminal => []Terminal)

(***************************************************************************
 * Baseline settlement liveness (15 §4.1, NORMATIVE; SQ-320).
 *
 * The obligation is that "no reachable state leaves an epoch's Baseline vault
 * permanently unsettleable: for every epoch that opens a Baseline vault, some
 * admissible continuation reaches `BaselineState::Settled`".
 *
 * That is a POSSIBILITY statement -- AG EF Settled -- which is branching-time
 * and has no direct expression in TLC's linear-time property language.  It is
 * discharged here as an equivalent safety invariant over this model, resting
 * on two structural facts each TLC run establishes independently:
 *
 *   (i) `Terminal` is the only absorbing region of the proposal machine
 *       (`TerminalStatesAbsorb`), TLC's deadlock check proves every reachable
 *       state has a successor, and `Terminal` is reachable from everywhere:
 *       T20 `ForceReject` is enabled on the whole of `PreExecutedNonTerminal`
 *       and lands in `Rejected` in one step, and the `Measuring` region closes
 *       through CloseChallenge/Neutralize/Void into `SettleCohort`/`VoidContest`.
 *  (ii) `AdvanceEpoch` is unconditionally enabled whenever the vault is still
 *       `Open` and never reverts, so the `bl.epochPast` slice is one step away
 *       from every reachable state with an open vault.
 *
 * So the only way to strand the vault is to sit in `Terminal` with the epoch
 * past, the vault `Open`, and no discharge enabled -- which is precisely what
 * the invariant forbids.  Its four cases carry real content, one per member of
 * `Terminal`: `Cancelled` and T20-`Rejected` are discharged by the §7(6)
 * crank, p-`Settled` by the T19 leg having already settled it, and
 * `Measuring`/`Void` by the §7(5) void leg having already settled it.
 *
 * Anti-vacuity is proved in both directions by the runner (15 §4.1):
 * `MutationOrphanBaseline.cfg` deletes the §7(6) crank and MUST violate this
 * invariant on the T20 interleaving 15 §4.1 names explicitly, and
 * `WitnessBaselineOrphanCrank.cfg` MUST violate its negation, proving that
 * interleaving is genuinely reachable rather than absent by construction.
 ***************************************************************************
*)
BaselineNeverStranded ==
    (bl.state = "Open" /\ bl.epochPast /\ Terminal) => CrankAdmissible

(***************************************************************************
 * Fact (i) of that reduction, made mechanical instead of left as prose.
 *
 * Every reachable non-`Terminal` state belongs to one of the three families
 * whose closure into `Terminal` is an admissible continuation of one or a few
 * steps: `Absent` (Submit is enabled), `PreExecutedNonTerminal` (T20
 * `ForceReject` is enabled on ALL of it and lands in `Rejected` in one step),
 * or `Measuring` (which closes through CloseChallenge / NeutralizeContest /
 * VoidContest into `SettleCohort` or the cohort void).  The T17/T21
 * intermediates `Executed`, `Expired` and resolved-`Rejected` are atomic with
 * their parent row and never persist, so nothing reachable escapes the three.
 *
 * A later edit that introduces a persistent state outside them -- the way a
 * stranded Baseline vault itself was introduced -- breaks this invariant loudly
 * instead of silently weakening `BaselineNeverStranded` into a statement about
 * a region the machine no longer has to pass through.
 ***************************************************************************
*)
TerminalityAlwaysReachable ==
    ~Terminal => p.state \in {"Absent", "Measuring"} \cup PreExecutedNonTerminal

\* The converse guard.  A Baseline vault settles exactly once, by exactly one
\* of the three normative transitions, and never before its cohort could still
\* form -- 05 §7(6) condition 3.  Settling early does not strand one holder, it
\* strands the whole cohort, because the later `settle_cohort` leg then has an
\* already-`Settled` vault to settle.  `MutationBaselineLiveState.cfg` reaches
\* exactly that state through the rejected `is_live_state` reading.
BaselineSettledExactlyOnce ==
    /\ ~bl.doubleSettle
    /\ (bl.state = "Settled") = (bl.via # "None")
    /\ bl.via = "Cohort" => CountRow("T19") = 1
    /\ bl.via = "Crank" => p.cohort = "None"

(***************************************************************************
 * Reachability witnesses.  Each Witness*.cfg installs one of these negated
 * conditions as an invariant.  TLC must violate it (runner contract), proving
 * the named behavior has a concrete trace instead of only a table row.
 ***************************************************************************
*)
NoT2Witness == CountRow("T2") = 0

NoT6T24Witness ==
    ~(CountRow("T6") > 0 /\ CountRow("T24") > 0)

NoRerunRetrySuccessWitness ==
    ~(CountRow("T13") > 0 /\ CountRow("T18") > 0
      /\ CountRow("T23") > 0)

NoT20WithVaultWitness ==
    ~(CountRow("T20") > 0 /\ p.t20HadVault)

NoRetryExpiredLiveWitness ==
    ~(p.state = "FailedExecuted" /\ p.retryExpired)

NoT22Witness == CountRow("T22") = 0

NoEarlyFailedT16Witness ==
    ~(p.ratified = "Failed" /\ ~p.graceExpired
      /\ \E i \in 1..Len(history):
             history[i].row = "T16"
             /\ history[i].reason = "NotRatified")

NoGateVetoWelfareAdoptWitness ==
    ~\E i \in 1..Len(decisionHistory):
        /\ decisionHistory[i].gate \in GateVetoes
        /\ decisionHistory[i].welfareSaysAdopt

NoRerunRaisedHurdleWitness ==
    ~\E i \in 1..Len(decisionHistory):
        /\ decisionHistory[i].rerun
        /\ decisionHistory[i].welfare = "RaisedHurdleMiss"
        /\ decisionHistory[i].gate = "NoVeto"

NoTerminalRejectedAttemptWitness == ~attemptAudit.rejected

NoForceRerunWitness == CountRow("FR") = 0

NoForceQueuedCancellationWitness ==
    ~\E i \in 1..Len(history):
        /\ history[i].row = "FR"
        /\ history[i].from = "Queued"
        /\ history[i].mandate > 0
        /\ history[i].mandate \in p.forceCancelledMandates

\* One witness per normative Baseline discharge (03 §5.2; 05 §7(5)--(6)), so
\* that `BaselineNeverStranded` cannot pass by having no reachable discharge at
\* all.  The first is the interleaving 15 §4.1 names verbatim: the epoch's
\* proposal is force-rejected (T20) before it ever reaches `Measuring`, so no
\* cohort forms, T19 never fires, and only the §7(6) crank can settle the vault.
NoOrphanCrankSettlementWitness ==
    ~(/\ CountRow("T20") > 0
      /\ CountRow("T19") = 0
      /\ bl.state = "Settled"
      /\ bl.via = "Crank")

NoMeasuredBaselineSettlementWitness == bl.via # "Cohort"

NoVoidBaselineSettlementWitness == bl.via # "Void"

=============================================================================
