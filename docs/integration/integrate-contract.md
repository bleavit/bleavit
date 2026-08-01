# Integrating a smart contract

Read the identity model first. It will shape your design, and finding out late is expensive.

Non-normative; [16 §2](../architecture/16-hosted-question-service.md) owns this.

---

## Bleavit does not know your contract exists

**Identity is chain-granular.** A contract on Moonbeam authenticates to Bleavit as *Moonbeam* — not
as your contract, and not as your user.

This is deliberate, not a limitation to route around. `DescendOrigin` and `AliasOrigin` are
unadmitted, so sub-identity cannot be asserted to Bleavit at all. Bleavit refuses to make claims
about who inside your chain asked a question, because it has no way to verify them and a claim it
cannot verify is worse than no claim.

## So carry your own identity

`sub_id` is a 32-byte opaque field. Bleavit **stores it, echoes it in the report, binds it into the
provenance hash, and never interprets it.**

```solidity
bytes32 subId = keccak256(abi.encode(address(this), msg.sender, requestId));
```

That is the whole pattern. You establish what `sub_id` means to *your* users; Bleavit carries it
faithfully and takes no position on it.

**Corollary that matters:** your chain's *runtime* is the client, so anyone on your chain who can
reach the XCM-sending path can ask questions under your registration and spend against your escrow
and delivery float. **Access control is your job**, on your side. Bleavit sees one client.

---

## Shape of the integration

Your chain needs a runtime-level path that sends the ingress program — a contract cannot emit XCM
directly. Two workable shapes:

1. **A dispatch precompile** your contract calls, which builds and sends the program.
2. **A pallet on your chain** that contracts call, which owns the registration and meters callers.

Either way the sequence is:

```
contract → (your access control) → your runtime → XCM → Bleavit
                                                          ↓
contract ← your handler ← your runtime ← push, or ← pull by proof
```

Prefer (2) if you have the choice: it gives you one place to meter, rate-limit and account for
callers, which you will want, because from Bleavit's side every question is billed to you.

---

## Reading the report from a contract

Push arrives at your runtime, not at your contract. Your runtime forwards it.

**Verify before you act on it.** The report carries
`provenance_hash = blake2_256(b"bleavit/hosted-report/v1" || SCALE(fields))`, and the pull surface
lets you check a storage proof against a finalized header. If your contract is going to move money
on a report, verify the proof — do not trust a forwarded push.

See [`reading-the-report.md`](reading-the-report.md), and in particular the section on
`manip_floor` being a floor rather than a ceiling. A contract that treats it as a correctness
guarantee is mis-integrated.

---

## Settlement is still yours

Your named attestors report the realized value. If your question is about a fact on *your* chain,
the natural attestor set is parties who can observe it independently — which is usually **not**
just you. See [`settlement.md`](settlement.md); the report publishes how trustworthy your choice
was, and your counterparties can read it.
