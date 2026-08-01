"""Shared exact values whose sole authority is the architecture text.

This module is deliberately data-only.  It does not read runtime source,
generated weights, deployment validators, or any other implementation artifact.
Only quantities with one normative meaning across model modules belong here;
module-local measurements and differently scoped values remain with their
derivations.
"""

from decimal import Decimal
from fractions import Fraction
from types import MappingProxyType
from typing import Final, Mapping


# 08 §4.1 — frozen per-class NAV-floor literals.  The four rows use different
# conservative rounding conventions, so they are carried exactly, not re-derived.
NAV_FLOOR_PARAM: Final = Decimal(4_620_989)
NAV_FLOOR_TREASURY: Final = Decimal(7_393_600)
NAV_FLOOR_CODE: Final = Decimal(13_862_944)
NAV_FLOOR_META: Final = Decimal(21_256_533)
NAV_FLOORS_USDC: Mapping[str, Decimal] = MappingProxyType(
    {
        "param": NAV_FLOOR_PARAM,
        "treasury": NAV_FLOOR_TREASURY,
        "code": NAV_FLOOR_CODE,
        "meta": NAV_FLOOR_META,
    }
)

# 13 §1 `epoch.length` — blocks, with the row's kernel bounds and max-Δ.
EPOCH_LENGTH_DEFAULT: Final = 302_400
EPOCH_LENGTH_MIN: Final = 201_600
EPOCH_LENGTH_MAX: Final = 604_800
EPOCH_LENGTH_MAX_DELTA_PERCENT: Final = 10
EPOCH_LENGTH_MAX_DELTA: Final = Fraction(EPOCH_LENGTH_MAX_DELTA_PERCENT, 100)

# 08 §9 / 13 §1 `fee.vit_usdc_rate` — USDC/VIT.  The reference remains
# [VERIFY at TGE]; these are the documented placeholder and its kernel envelope.
FEE_VIT_USDC_RATE_REF: Final = Decimal("0.05")
FEE_VIT_USDC_RATE_MIN: Final = FEE_VIT_USDC_RATE_REF * Decimal("0.1")
FEE_VIT_USDC_RATE_MAX: Final = FEE_VIT_USDC_RATE_REF * Decimal(10)
