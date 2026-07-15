#!/usr/bin/env python3
"""Check the normative LMSR documentation literals against the reference model."""
from __future__ import annotations

import re
import sys
from decimal import Decimal, localcontext
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "reference-model" / "src"))

from bleavit_reference_model import lmsr


def table_row(text: str, vector: str) -> str:
    match = re.search(
        rf"^\|\s*{re.escape(vector)}\s*\|.*$", text, re.MULTILINE
    )
    if match is None:
        raise SystemExit(
            f"could not find {vector} in the LMSR vector table"
        )
    return match.group(0)


def ellipsis_values(row: str) -> list[str]:
    return [
        value.replace(",", "")
        for value in re.findall(r"([−-]?\d[\d,]*\.\d+)…", row)
    ]


def decimal_value(value: str) -> Decimal:
    return Decimal(value.replace("−", "-"))


def half_display_ulp(value: str) -> Decimal:
    decimals = len(value.split(".", maxsplit=1)[1])
    return Decimal(5).scaleb(-decimals - 1)


def check_display(label: str, displayed: str, expected: Decimal) -> None:
    actual = decimal_value(displayed)
    tolerance = half_display_ulp(displayed)
    difference = abs(actual - expected)
    if difference > tolerance:
        raise SystemExit(
            f"{label} disagrees with the reference model: "
            f"displayed={displayed}, expected={expected}, "
            f"difference={difference}, tolerance={tolerance}"
        )


def require_values(row: str, vector: str, count: int) -> list[str]:
    values = ellipsis_values(row)
    if len(values) != count:
        raise SystemExit(
            f"expected {count} displayed value(s) in {vector}, "
            f"found {len(values)}"
        )
    return values


def main() -> None:
    market_doc = (
        ROOT / "docs" / "architecture" / "04-markets-and-pricing.md"
    ).read_text(encoding="utf-8")
    rows = {
        vector: table_row(market_doc, vector)
        for vector in ("V1", "V2", "V3", "V4", "V5", "V6")
    }

    v1_display = require_values(rows["V1"], "V1", 1)[0]
    v2_display = require_values(rows["V2"], "V2", 1)[0]
    v3_delta_display, v3_cost_display = require_values(
        rows["V3"], "V3", 2
    )
    v4_display = require_values(rows["V4"], "V4", 1)[0]
    v5_display = require_values(rows["V5"], "V5", 1)[0]

    fee_match = re.search(r"(\d+)\s+bps", rows["V5"])
    if fee_match is None:
        raise SystemExit("could not find the V5 fee basis")
    fee_bps = Decimal(fee_match.group(1))

    clamp_match = re.search(r">\s*(\d+)·b", rows["V6"])
    if clamp_match is None or "PriceBoundExceeded" not in rows["V6"]:
        raise SystemExit("could not find the V6 clamp and error")
    clamp = Decimal(clamp_match.group(1))

    with localcontext() as ctx:
        ctx.prec = lmsr.WORK_PREC
        b = Decimal("10000")
        v1 = lmsr.buy_delta_cost(b, 0, 0, "long", 1000)
        v2 = lmsr.marginal_price_long(b, 1000, 0)
        v3_delta = lmsr.displacement_for_price_move(
            b, "0.5", "0.6"
        )
        v3_cost = lmsr.displacement_cost(b, "0.5", "0.6")
        v4 = b * lmsr.LN2
        v5 = -Decimal(2) * lmsr.FEE_RATE * v1

        check_display("04 §5 V1", v1_display, v1)
        check_display("04 §5 V2", v2_display, v2)
        check_display("04 §5 V3 delta", v3_delta_display, v3_delta)
        check_display("04 §5 V3 cost", v3_cost_display, v3_cost)
        check_display("04 §5 V4", v4_display, v4)
        check_display("04 §5 V5", v5_display, v5)

        if fee_bps / Decimal(10_000) != lmsr.FEE_RATE:
            raise SystemExit(
                "04 §5 V5 fee basis disagrees with the reference model: "
                f"{fee_bps} bps"
            )
        if clamp != lmsr.DOMAIN_CLAMP:
            raise SystemExit(
                "04 §5 V6 clamp disagrees with the reference model: "
                f"{clamp}"
            )
        try:
            lmsr.buy_delta_cost(b, clamp * b, 0, "long", 1)
        except lmsr.PriceBoundExceeded:
            pass
        else:
            raise SystemExit(
                "04 §5 V6 did not raise PriceBoundExceeded"
            )

        # These duplicate normative literals are straightforward to parse, so
        # check them against the same values rather than limiting this gate to 04.
        invariants_doc = (
            ROOT
            / "docs"
            / "architecture"
            / "15-invariants-and-testing.md"
        ).read_text(encoding="utf-8")
        invariants_match = re.search(
            r"Current normative values: \*\*V1 = (\d+\.\d+) USDC\*\*, "
            r"\*\*V5 net = ([−-]\d+\.\d+)\*\*",
            invariants_doc,
        )
        if invariants_match is None:
            raise SystemExit(
                "could not find the 15 §4.4 V1/V5 literals"
            )
        check_display("15 §4.4 V1", invariants_match.group(1), v1)
        check_display("15 §4.4 V5", invariants_match.group(2), v5)

        parameters_doc = (
            ROOT / "docs" / "architecture" / "13-parameters.md"
        ).read_text(encoding="utf-8")
        parameters_v5 = require_values(
            table_row(parameters_doc, "V5"), "13 §3.3 V5", 1
        )[0]
        check_display("13 §3.3 V5", parameters_v5, v5)

    print("LMSR documentation tables match the reference model")


if __name__ == "__main__":
    main()
