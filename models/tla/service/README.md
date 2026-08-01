# Hosted-question service TLA⁺ model

`Service.tla` exhaustively composes register/open/seal, attestor voting,
deadline-gated settlement, permissionless deadline VOID, deadline-gated
guardian-pause VOID, and registry removal in a finite clock scope. `FairSpec`
adds weak fairness for `Tick` and clock-VOID; `EventuallyTerminal` therefore
proves every question reaches `Settled` or `Voided` even though `Done` retains
ordinary TLA stuttering. Its main invariants enforce a real manipulation floor
before report publication, report retention, the once-at-Sealed fee rule, and
exactly one escrow-terminal transition.

The runner requires two violating witnesses: `WitnessPostSealVoid.cfg` proves a
sealed report can reach clock-driven VOID without being discarded, while
`MutationDoubleTerminal.cfg` deliberately reopens a terminal question and must
violate the exactly-once terminal invariant.

`Small.cfg` currently reaches 273 distinct states; the manifest floor is 150.
