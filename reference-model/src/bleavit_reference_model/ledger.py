from dataclasses import dataclass, field
from decimal import Decimal, ROUND_FLOOR
from enum import Enum

class VaultState(Enum): OPEN="Open"; RESOLVED="Resolved"; SCALAR_SETTLED="ScalarSettled"; VOIDED="Voided"
class Branch(Enum): ACCEPT="Accept"; REJECT="Reject"

@dataclass
class BranchSupply:
    usdc: Decimal = Decimal(0); scalar_sets: Decimal = Decimal(0)

@dataclass
class Vault:
    escrowed: Decimal = Decimal(0); state: VaultState = VaultState.OPEN; winner: Branch | None = None; s: Decimal | None = None
    branches: dict = field(default_factory=lambda: {Branch.ACCEPT: BranchSupply(), Branch.REJECT: BranchSupply()})
    def split(self, amount: Decimal):
        self._need(VaultState.OPEN); self.escrowed += amount
        self.branches[Branch.ACCEPT].usdc += amount; self.branches[Branch.REJECT].usdc += amount
    def merge(self, amount: Decimal):
        if self.state not in (VaultState.OPEN, VaultState.RESOLVED, VaultState.VOIDED): raise ValueError("wrong state")
        self.escrowed -= amount; self.branches[Branch.ACCEPT].usdc -= amount; self.branches[Branch.REJECT].usdc -= amount
    def split_scalar(self, branch: Branch, amount: Decimal):
        self._need(VaultState.OPEN); bs = self.branches[branch]; bs.usdc -= amount; bs.scalar_sets += amount
    def resolve(self, winner: Branch): self._need(VaultState.OPEN); self.state=VaultState.RESOLVED; self.winner=winner
    def settle_scalar(self, s: Decimal): self._need(VaultState.RESOLVED); self.state=VaultState.SCALAR_SETTLED; self.s=s
    def void(self):
        if self.state not in (VaultState.OPEN, VaultState.RESOLVED): raise ValueError("wrong state")
        self.state=VaultState.VOIDED
    def redeem_void_branch_usdc(self, amount: Decimal) -> Decimal: return (amount / 2).quantize(Decimal("0.000001"), rounding=ROUND_FLOOR)
    def redeem_void_scalar_leg(self, amount: Decimal) -> Decimal: return (amount / 4).quantize(Decimal("0.000001"), rounding=ROUND_FLOOR)
    def _need(self, s):
        if self.state != s: raise ValueError("wrong state")
