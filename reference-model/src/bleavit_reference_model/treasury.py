from decimal import Decimal, ROUND_FLOOR

def nav(assets, liabilities=0): return sum(Decimal(x) for x in assets) - Decimal(liabilities)
def in_cap_prize(nav_value, pct=Decimal("0.05")): return (Decimal(nav_value) * Decimal(pct)).quantize(Decimal("1"), rounding=ROUND_FLOOR)
def attack_cost_hat(liquidity, multiplier=Decimal("1.5")): return Decimal(liquidity) * Decimal(multiplier)
def security_sizing_ok(prize, attack_cost): return Decimal(prize) <= Decimal(attack_cost) / Decimal(3)
