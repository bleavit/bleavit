from decimal import Decimal
import pytest
from bleavit_reference_model.lmsr import *
from bleavit_reference_model.twap import TwapAccumulator
from bleavit_reference_model.ledger import Vault, Branch, VaultState
from bleavit_reference_model.decision import decide, Outcome, RejectReason
from bleavit_reference_model.treasury import security_sizing_ok

def test_normative_lmsr_vectors():
    v = vectors_v1_v6()
    assert v["V1"]["value"].startswith("512.494795136")
    assert v["V2"]["value"].startswith("0.524979187478")
    assert v["V3"]["delta"].startswith("4054.65108108")
    assert v["V4"]["value"].startswith("6931.47180559")
    assert v["V5"]["net_fees_only"].startswith("-3.074968")
    with pytest.raises(PriceBoundExceeded): buy_delta_cost(10000, 480000, 0, "long", 1)

def test_twap_slew_clamps_previous_quote():
    t = TwapAccumulator(Decimal("0.500")); assert t.observe(10, Decimal("0.900")) == Decimal("0.502500")
    assert t.mean(0, 20) == Decimal("0.501250")

def test_ledger_void_neutral_flooring():
    v=Vault(); v.split(Decimal("10.000000")); v.void(); assert v.state == VaultState.VOIDED
    assert v.redeem_void_branch_usdc(Decimal("10.000001")) == Decimal("5.000000")
    assert v.redeem_void_scalar_leg(Decimal("10.000003")) == Decimal("2.500000")

def test_decision_and_treasury_reason_codes():
    assert decide(Decimal("0.04"), Decimal("0.05")).reason == RejectReason.HURDLE_NOT_MET
    assert decide(Decimal("0.06"), Decimal("0.05")).outcome == Outcome.ADOPT
    assert not security_sizing_ok(Decimal("10"), Decimal("20"))
