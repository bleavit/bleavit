------------------------- MODULE LedgerComposition -------------------------
EXTENDS Naturals, FiniteSets, TLC

(***************************************************************************)
(* Two conditional-ledger instances sharing one runtime (03 §1a; I-37).   *)
(* Each action names exactly one domain.  A fault may change only that      *)
(* domain's custody/latch fingerprint.  Reserved destinations are the union *)
(* of both local protocol sets, while deposit exemption remains local.      *)
(***************************************************************************)

CONSTANTS MaxLiability, PrimaryId, ServiceId, MUTATE_CROSS_INSTANCE

Domains == {"Primary", "Service"}
AccountClasses == {
  "Client", "PrimaryProtocol", "ServiceProtocol", "InflowExempt"
}
ProtocolClasses == {"PrimaryProtocol", "ServiceProtocol"}

Other(d) == IF d = "Primary" THEN "Service" ELSE "Primary"
LocalProtocol(d, a) ==
  IF d = "Primary" THEN a = "PrimaryProtocol" ELSE a = "ServiceProtocol"
ReservedProtocolDestination(a) == a \in ProtocolClasses
InflowCapExempt(a) == a = "InflowExempt"

VARIABLES liability, custody, drifted, positions, deposits,
          lastDomain, lastDestination, lastRejected, isolationOK

vars == <<liability, custody, drifted, positions, deposits,
          lastDomain, lastDestination, lastRejected, isolationOK>>

Fingerprint(d) ==
  <<liability[d], custody[d], drifted[d], positions[d], deposits[d]>>

Init ==
  /\ liability = [d \in Domains |-> 0]
  /\ custody = [d \in Domains |-> 0]
  /\ drifted = [d \in Domains |-> FALSE]
  /\ positions = [d \in Domains |-> 0]
  /\ deposits = [d \in Domains |-> 0]
  /\ lastDomain = "None"
  /\ lastDestination = "None"
  /\ lastRejected = FALSE
  /\ isolationOK = TRUE

Audit(d, destination, rejected, otherBefore) ==
  /\ lastDomain' = d
  /\ lastDestination' = destination
  /\ lastRejected' = rejected
  /\ isolationOK' = isolationOK /\ Fingerprint(Other(d))' = otherBefore

Split(d) ==
  /\ liability[d] < MaxLiability
  /\ liability' = [liability EXCEPT ![d] = @ + 1]
  /\ custody' = [custody EXCEPT ![d] = @ + 1]
  /\ positions' = [positions EXCEPT ![d] = @ + 2]
  /\ deposits' = [deposits EXCEPT ![d] = @ + 2]
  /\ UNCHANGED drifted
  /\ Audit(d, "Client", FALSE, Fingerprint(Other(d)))

CustodyFault(d) ==
  /\ custody[d] > 0
  /\ custody' = [custody EXCEPT ![d] = @ - 1]
  /\ UNCHANGED <<liability, drifted, positions, deposits>>
  /\ Audit(d, "None", FALSE, Fingerprint(Other(d)))

CrossInstanceMutation(d) ==
  /\ MUTATE_CROSS_INSTANCE
  /\ liability[d] > 0
  /\ drifted' = [drifted EXCEPT ![Other(d)] = TRUE]
  /\ UNCHANGED <<liability, custody, positions, deposits>>
  /\ lastDomain' = d
  /\ lastDestination' = "None"
  /\ lastRejected' = FALSE
  /\ isolationOK' = FALSE

Reconcile(d) ==
  /\ drifted' = [drifted EXCEPT ![d] = liability[d] > custody[d]]
  /\ UNCHANGED <<liability, custody, positions, deposits>>
  /\ Audit(d, "None", FALSE, Fingerprint(Other(d)))

Repair(d) ==
  /\ drifted[d]
  /\ custody' = [custody EXCEPT ![d] = liability[d]]
  /\ drifted' = [drifted EXCEPT ![d] = FALSE]
  /\ UNCHANGED <<liability, positions, deposits>>
  /\ Audit(d, "None", FALSE, Fingerprint(Other(d)))

TransferAttempt(d, destination) ==
  IF ReservedProtocolDestination(destination)
  THEN
    /\ UNCHANGED <<liability, custody, drifted, positions, deposits>>
    /\ Audit(d, destination, TRUE, Fingerprint(Other(d)))
  ELSE
    /\ positions[d] < 2 * MaxLiability
    /\ positions' = [positions EXCEPT ![d] = @ + 1]
    /\ deposits' = [deposits EXCEPT
          ![d] = @ + IF LocalProtocol(d, destination) THEN 0 ELSE 1]
    /\ UNCHANGED <<liability, custody, drifted>>
    /\ Audit(d, destination, FALSE, Fingerprint(Other(d)))

Done == UNCHANGED vars

Next ==
  \/ \E d \in Domains : Split(d)
  \/ \E d \in Domains : CustodyFault(d)
  \/ \E d \in Domains : CrossInstanceMutation(d)
  \/ \E d \in Domains : Reconcile(d)
  \/ \E d \in Domains : Repair(d)
  \/ \E d \in Domains, a \in AccountClasses : TransferAttempt(d, a)
  \/ Done

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ liability \in [Domains -> 0..MaxLiability]
  /\ custody \in [Domains -> 0..MaxLiability]
  /\ drifted \in [Domains -> BOOLEAN]
  /\ positions \in [Domains -> 0..(4 * MaxLiability)]
  /\ deposits \in [Domains -> 0..(4 * MaxLiability)]
  /\ lastDomain \in Domains \union {"None"}
  /\ lastDestination \in AccountClasses \union {"None"}
  /\ lastRejected \in BOOLEAN
  /\ isolationOK \in BOOLEAN

PredicateWiring ==
  /\ \A a \in ProtocolClasses : ReservedProtocolDestination(a)
  /\ ~ReservedProtocolDestination("Client")
  /\ ~LocalProtocol("Primary", "ServiceProtocol")
  /\ ~LocalProtocol("Service", "PrimaryProtocol")
  /\ ~LocalProtocol("Primary", "Client")
  /\ ~LocalProtocol("Service", "Client")
  /\ InflowCapExempt("InflowExempt")
  /\ ~ReservedProtocolDestination("InflowExempt")

BandSeparation == PrimaryId < ServiceId
NoCrossInstanceMutation == isolationOK = TRUE
CrossProtocolTransfersRejected ==
  lastDestination \in ProtocolClasses => lastRejected

=============================================================================
