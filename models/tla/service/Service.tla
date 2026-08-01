------------------------------ MODULE Service ------------------------------
EXTENDS Naturals, TLC

(***************************************************************************)
(* Hosted-question lifecycle (16 §4, §6.3/§6.4, §8, §10).  VOID is a       *)
(* permissionless deadline-gated clock/pause action.  A sealed report and   *)
(* fee survive every terminal route.                                        *)
(***************************************************************************)

CONSTANTS MaxTime, Deadline, Quorum, MaxVotes, MUTATE_DOUBLE_TERMINAL

Phases == {"Registered", "Open", "Sealed", "Settled", "Voided"}
TerminalPhases == {"Settled", "Voided"}

VARIABLES phase, now, manipFloorReady, reportPublished, everSealed,
          feeEarned, votes, paused, registryLive, terminalCount,
          postSealVoidReached, lastAction

vars == <<phase, now, manipFloorReady, reportPublished, everSealed,
          feeEarned, votes, paused, registryLive, terminalCount,
          postSealVoidReached, lastAction>>

Init ==
  /\ phase = "Registered"
  /\ now = 0
  /\ manipFloorReady = FALSE
  /\ reportPublished = FALSE
  /\ everSealed = FALSE
  /\ feeEarned = FALSE
  /\ votes = 0
  /\ paused = FALSE
  /\ registryLive = TRUE
  /\ terminalCount = 0
  /\ postSealVoidReached = FALSE
  /\ lastAction = "Init"

Open ==
  /\ phase = "Registered"
  /\ phase' = "Open"
  /\ lastAction' = "Open"
  /\ UNCHANGED <<now, manipFloorReady, reportPublished, everSealed,
                  feeEarned, votes, paused, registryLive, terminalCount,
                  postSealVoidReached>>

PublishManipFloor ==
  /\ phase = "Open"
  /\ ~manipFloorReady
  /\ manipFloorReady' = TRUE
  /\ lastAction' = "PublishManipFloor"
  /\ UNCHANGED <<phase, now, reportPublished, everSealed, feeEarned,
                  votes, paused, registryLive, terminalCount,
                  postSealVoidReached>>

Seal ==
  /\ phase = "Open"
  /\ manipFloorReady
  /\ phase' = "Sealed"
  /\ reportPublished' = TRUE
  /\ everSealed' = TRUE
  /\ feeEarned' = TRUE
  /\ lastAction' = "Seal"
  /\ UNCHANGED <<now, manipFloorReady, votes, paused, registryLive,
                  terminalCount, postSealVoidReached>>

Vote ==
  /\ phase = "Sealed"
  /\ votes < MaxVotes
  /\ votes' = votes + 1
  /\ lastAction' = "Vote"
  /\ UNCHANGED <<phase, now, manipFloorReady, reportPublished, everSealed,
                  feeEarned, paused, registryLive, terminalCount,
                  postSealVoidReached>>

Settle ==
  /\ phase = "Sealed"
  /\ now >= Deadline
  /\ votes >= Quorum
  /\ phase' = "Settled"
  /\ terminalCount' = terminalCount + 1
  /\ lastAction' = "Settle"
  /\ UNCHANGED <<now, manipFloorReady, reportPublished, everSealed,
                  feeEarned, votes, paused, registryLive,
                  postSealVoidReached>>

Tick ==
  /\ now < MaxTime
  /\ now' = now + 1
  /\ lastAction' = "Tick"
  /\ UNCHANGED <<phase, manipFloorReady, reportPublished, everSealed,
                  feeEarned, votes, paused, registryLive, terminalCount,
                  postSealVoidReached>>

GuardianPause ==
  /\ phase \notin TerminalPhases
  /\ ~paused
  /\ paused' = TRUE
  /\ lastAction' = "GuardianPause"
  /\ UNCHANGED <<phase, now, manipFloorReady, reportPublished, everSealed,
                  feeEarned, votes, registryLive, terminalCount,
                  postSealVoidReached>>

RegistryRemoval ==
  /\ phase \notin TerminalPhases
  /\ registryLive
  /\ registryLive' = FALSE
  /\ lastAction' = "RegistryRemoval"
  /\ UNCHANGED <<phase, now, manipFloorReady, reportPublished, everSealed,
                  feeEarned, votes, paused, terminalCount,
                  postSealVoidReached>>

Void(reason) ==
  /\ phase \notin TerminalPhases
  /\ now >= Deadline
  /\ IF reason = "Clock" THEN TRUE ELSE paused
  /\ phase' = "Voided"
  /\ terminalCount' = terminalCount + 1
  /\ postSealVoidReached' = (postSealVoidReached \/ phase = "Sealed")
  /\ lastAction' = IF reason = "Clock" THEN "VoidClock" ELSE "VoidPause"
  /\ UNCHANGED <<now, manipFloorReady, reportPublished, everSealed,
                  feeEarned, votes, paused, registryLive>>

MutatedReopen ==
  /\ MUTATE_DOUBLE_TERMINAL
  /\ phase \in TerminalPhases
  /\ phase' = "Sealed"
  /\ manipFloorReady' = TRUE
  /\ reportPublished' = TRUE
  /\ everSealed' = TRUE
  /\ feeEarned' = TRUE
  /\ votes' = MaxVotes
  /\ lastAction' = "MutatedReopen"
  /\ UNCHANGED <<now, paused, registryLive, terminalCount,
                  postSealVoidReached>>

Done == UNCHANGED vars

Next ==
  \/ Open
  \/ PublishManipFloor
  \/ Seal
  \/ Vote
  \/ Settle
  \/ Tick
  \/ GuardianPause
  \/ RegistryRemoval
  \/ Void("Clock")
  \/ Void("Pause")
  \/ MutatedReopen
  \/ Done

Spec == Init /\ [][Next]_vars
FairSpec ==
  /\ Spec
  /\ WF_vars(Tick)
  /\ WF_vars(Void("Clock"))

TypeOK ==
  /\ phase \in Phases
  /\ now \in 0..MaxTime
  /\ manipFloorReady \in BOOLEAN
  /\ reportPublished \in BOOLEAN
  /\ everSealed \in BOOLEAN
  /\ feeEarned \in BOOLEAN
  /\ votes \in 0..MaxVotes
  /\ paused \in BOOLEAN
  /\ registryLive \in BOOLEAN
  /\ terminalCount \in 0..2
  /\ postSealVoidReached \in BOOLEAN

NoPlaceholderReport == reportPublished => manipFloorReady
ReportRetained == everSealed => reportPublished
FeeEarnedExactlyAtSeal == feeEarned = everSealed
TerminalExactlyOnce ==
  /\ terminalCount <= 1
  /\ (phase \in TerminalPhases => terminalCount = 1)
RegistryRemovalDoesNotVoid ==
  lastAction = "RegistryRemoval" => phase \notin TerminalPhases

PostSealVoidUnreachable == ~postSealVoidReached
EventuallyTerminal == <> (phase \in TerminalPhases)

=============================================================================
