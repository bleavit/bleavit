# Integrating an off-chain service

You cannot send XCM. You do not need to — the calls are the same ones a parachain makes, from a
local signed account.

Non-normative; [16 §2](../architecture/16-hosted-question-service.md) owns this.

---

## How you authenticate

A parachain client is identified by its XCM `Location`. You are identified by an **account**: your
registry record carries a `local_signer`, and the signed-origin path converts `Signed(who)` to
`ExternalClient(id)` **only** on an exact match.

A registration carries **exactly one** of the two — `location` or `local_signer`, never both and
never neither. Same exact-equality discipline either way, same single success path.

*(An earlier draft of the spec proposed identifying local services by `Location::here()`. That is
identical for every local signer, so it would have authenticated either nobody or anybody. The
signer binding replaced it.)*

---

## The flow

```python
# 1. Ask
tx = api.tx.QuestionService.register(
    text_hash=blake2_256(b"..."),
    sub_id=my_request_id,
    declared_stake=100_000 * USDC,
    epsilon=50_000_000,               # 5% on the 1e9 grid
    window=30 * DAYS,
    attestors=[alice, bob, carol],
    rule="AcceptExceedsReject",
)
await tx.sign_and_send(my_keypair)     # the account bound as `local_signer`

# 2. Read, verifying against a finalized header
report = await api.rpc.state.call("FutarchyApi_hosted_report", question_id, at=finalized_hash)
```

**Read at a finalized hash.** Reading at the chain head gives you a value that can still be
reverted; for anything that moves money, `at=finalized_hash` is the difference between a report and
a rumour.

## Verify it yourself

```python
preimage = b"bleavit/hosted-report/v1" + scale_encode(report_fields)
assert blake2_256(preimage) == report.provenance_hash
```

If you are consuming a report you did not request — someone else's, quoted to you — this check plus
a storage proof against a finalized header is the whole of what makes it trustworthy. Everything
else is someone's word.

## Then read it properly

[`reading-the-report.md`](reading-the-report.md), especially:

- **`manip_floor` is a floor, not a ceiling.** Faking the price cost *at least* that. It does not
  mean nobody did.
- **`certified` is a relation**, not a badge — read `declared_stake` alongside it.
- **`settlement_trust`** tells you how much the settlement is worth trusting, which for someone
  else's report is usually the field that matters most.

---

## What you do not get

- **No push.** Push is XCM, so it is a parachain-only convenience. Poll the pull surface; it is the
  authoritative delivery anyway, so you are not missing anything a parachain has.
- **No telemetry.** The frontend and this service ship none. What you can read is what the chain
  exposes.

## What you still owe

Settlement. Your named attestors report the realized value within 72 hours, and the median of a
`⌈n/2⌉` quorum settles it. If they fail, the question VOIDs and everyone redeems at par — your
report is unaffected, because it was published at seal. See [`settlement.md`](settlement.md).
