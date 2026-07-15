#!/usr/bin/env python3
"""Generate high-precision fixed-crate regression corpora.

LMSR values are computed by the shared reference-model implementation. The
primitive-transcendental rows remain local because they exercise the fixed
crate's individual exp2/log2/ln kernels.
"""
from __future__ import annotations

import argparse
import sys
from decimal import Decimal, localcontext
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "reference-model" / "src"))

from bleavit_reference_model import lmsr

LMSR_OUT = ROOT / "crates" / "futarchy-fixed" / "fixtures" / "lmsr_corpus.csv"
TRANSCENDENTAL_OUT = (
    ROOT
    / "crates"
    / "futarchy-fixed"
    / "fixtures"
    / "transcendental_corpus.csv"
)

B = Decimal(10_000)


def fmt(x: Decimal) -> str:
    with localcontext() as ctx:
        ctx.prec = lmsr.WORK_PREC
        return format(+x, ".24f")


def raw_64x64(x: Decimal) -> int:
    return lmsr.raw_64x64_nearest(x)


def q64(x: Decimal) -> Decimal:
    """Snap an input to its exact 64.64 representation.

    Corpus rows are evaluated at exactly representable 64.64 inputs (the
    on-chain input domain) so the committed expectations measure kernel error
    only, never input-representation error.
    """
    with localcontext() as ctx:
        ctx.prec = lmsr.WORK_PREC
        return Decimal(raw_64x64(x)) / Decimal(1 << 64)


def generate_contents() -> tuple[str, int, str, int]:
    with localcontext() as ctx:
        ctx.prec = lmsr.WORK_PREC

        rows: list[tuple[str, Decimal]] = []
        rows.append(("cost_0_0", lmsr.cost(B, Decimal(0), Decimal(0))))
        rows.append(
            (
                "v1_buy_1000_long_cost",
                lmsr.cost(B, Decimal(1000), Decimal(0))
                - lmsr.cost(B, Decimal(0), Decimal(0)),
            )
        )
        rows.append(
            (
                "v2_price_after_v1",
                lmsr.marginal_price_long(B, Decimal(1000), Decimal(0)),
            )
        )
        rows.append(
            (
                "v3_displace_0_5_to_0_6",
                lmsr.displacement_for_price_move(
                    B, q64(Decimal("0.5")), q64(Decimal("0.6"))
                ),
            )
        )
        v3_delta = q64(rows[-1][1])
        rows.append(
            (
                "v3_cost_0_5_to_0_6",
                lmsr.cost(B, v3_delta, Decimal(0))
                - lmsr.cost(B, Decimal(0), Decimal(0)),
            )
        )
        rows.append(("v4_worst_case_loss", B * lmsr.LN2))
        rows.append(
            (
                "domain_edge_cost_480000_0",
                lmsr.cost(B, Decimal(480000), Decimal(0)),
            )
        )
        for ql, qs in [
            (2500, 0),
            (0, 2500),
            (12345, 6789),
            (6789, 12345),
            (240000, 0),
            (0, 240000),
        ]:
            qld, qsd = Decimal(ql), Decimal(qs)
            rows.append((f"cost_{ql}_{qs}", lmsr.cost(B, qld, qsd)))
            rows.append(
                (
                    f"price_{ql}_{qs}",
                    lmsr.marginal_price_long(B, qld, qsd),
                )
            )

        lmsr_content = (
            "# name,value,raw_64x64_nearest\n"
            + "".join(
                f"{name},{fmt(value)},{raw_64x64(value)}\n"
                for name, value in rows
            )
        )

        primitive_rows: list[tuple[str, str, Decimal, Decimal]] = []
        for label, value in [
            ("0", "0"),
            ("0_125", "0.125"),
            ("0_5", "0.5"),
            ("1", "1"),
            ("1_5", "1.5"),
            ("8", "8"),
            ("48", "48"),
        ]:
            x = Decimal(value)
            primitive_rows.append(
                (f"exp2_{label}", "exp2", x, lmsr.ref_exp2(x))
            )
        for label, value in [
            ("1", "1"),
            ("1_5", "1.5"),
            ("2", "2"),
            ("8", "8"),
            ("48", "48"),
        ]:
            x = Decimal(value)
            primitive_rows.append(
                (f"log2_{label}", "log2", x, lmsr.ref_log2(x))
            )
        for label, value in [
            ("1", "1"),
            ("1_5", "1.5"),
            ("2", "2"),
            ("8", "8"),
            ("48", "48"),
        ]:
            x = Decimal(value)
            primitive_rows.append((f"ln_{label}", "ln", x, lmsr.ref_ln(x)))

        transcendental_content = (
            "# name,function,input,value,raw_64x64_nearest\n"
            + "".join(
                f"{name},{function},{input_value},{fmt(value)},"
                f"{raw_64x64(value)}\n"
                for name, function, input_value, value in primitive_rows
            )
        )

    return (
        lmsr_content,
        len(rows),
        transcendental_content,
        len(primitive_rows),
    )


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument(
    "--check",
    action="store_true",
    help="fail if the committed corpus differs from generated output",
)
args = parser.parse_args()

lmsr_content, lmsr_row_count, transcendental_content, primitive_row_count = (
    generate_contents()
)
outputs = [
    (LMSR_OUT, lmsr_content, lmsr_row_count),
    (TRANSCENDENTAL_OUT, transcendental_content, primitive_row_count),
]

if args.check:
    for output, content, row_count in outputs:
        current = (
            output.read_text(encoding="utf-8") if output.exists() else ""
        )
        if current != content:
            raise SystemExit(
                f"{output.relative_to(ROOT)} is stale; "
                f"regenerate with {Path(__file__).name}"
            )
        print(f"{output.relative_to(ROOT)} is up to date ({row_count} rows)")
else:
    for output, content, row_count in outputs:
        output.write_text(content, encoding="utf-8")
        print(f"wrote {output.relative_to(ROOT)} ({row_count} rows)")
