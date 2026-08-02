#!/usr/bin/env python3
"""Validate Bleavit chain-spec identity and browser-WSS release gates."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any


PROFILES = ("dev", "local", "paseo", "polkadot")
EXPECTED_RELAY = {
    "dev": "paseo-local",
    "local": "paseo-local",
    "paseo": "paseo",
    "polkadot": "polkadot",
}
WSS_MULTIADDR = re.compile(
    r"^/(?:dns|dns4|dns6)/"
    r"(?P<host>(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+"
    r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)"
    r"/tcp/(?P<port>[0-9]{1,5})/wss/p2p/"
    r"(?P<peer>[1-9A-HJ-NP-Za-km-z]{32,})$"
)
VIT = 10**12
TOTAL_SUPPLY = 1_000_000_000 * VIT
FOUNDING_TEAM_TOTAL = 200_000_000 * VIT
OPS_FUND_TOTAL = 150_000_000 * VIT
TEAM_VESTING_SCHEDULE = (5_256_000, 15_768_000, 0)
PROTOCOL_POTS = {
    "treasury MAIN": (
        "fvGJck7fS1t2fpsb9pvvJ2EYTyx6sgq1NkVTTZqzwipoLqtzp",
        300_000_000 * VIT,
    ),
    "community": (
        "fvGJck7fS1t2fpsb9pwPHKH5M7STmm5wAPAdpwcrr6uEeGXz5",
        250_000_000 * VIT,
    ),
    "incentives": (
        "fvGJck7fS1t2fpsb9pwQuhjP1DQpWe6PyTT4rDGaDE3Lo1J9Z",
        100_000_000 * VIT,
    ),
}
# Each seat carries the genesis encoding the runtime actually decodes: the quote
# authority is an `Option<AccountId>` (SS58 string), the renewal account an
# `Option<[u8; 32]>` (32-byte array). A seat that is present but malformed would
# otherwise clear this release gate and only fail at genesis build.
CORETIME_OPS_SEATS = (
    ("coretimeQuoteAuthority", "operations quote authority", "ss58"),
    ("coretimeRenewalAccount", "Coretime-side renewal account", "bytes32"),
)
# 03 §7 R-4. Single-sourced in the runtime as
# futarchy_primitives::currency::USDC_CENT.
USDC_MIN_BALANCE = 10_000
# staging-xcm 24's derived serde shape for identity.rs::usdc_location():
# Location::new(1, [Parachain(1000), PalletInstance(50), GeneralIndex(1337)]).
USDC_LOCATION = {
    "parents": 1,
    "interior": {
        "X3": [
            {"Parachain": 1000},
            {"PalletInstance": 50},
            {"GeneralIndex": 1337},
        ]
    },
}
# AccountIdConversion for PalletId: b"modl" + the 8-byte PalletId + optional
# 8-byte sub-seed, then zero-padding to AccountId32. Each entry remains
# re-derivable beside the hardcoded ss58-7777 presentation string.
USDC_ENDOWED_ACCOUNTS = {
    # PalletId b"bl/ledgr", no sub-seed.
    "ledger_sovereign": "fvGJck7fS1t2ejm7TyRMiteKHuDAN2G8Fb4bUq4N7pC8vwE3u",
    # PalletId b"bl/svclg", no sub-seed.
    "service_ledger_sovereign": "fvGJck7fS1t2fh9vRid3Yxs6DU4cPizZZFW1Ek1SJ2K9qGhbR",
    # PalletId b"bl/ledgr", sub-seed b"INSURANC".
    "ledger_insurance": "fvGJck7fS1t2ejm7TyRhcrwJWAdTsdZmqdcDWshHCJSChV9T5",
    # PalletId b"bl/ledgr", sub-seed b"BOOK____".
    "ledger_book": "fvGJck7fS1t2ejm7TyRfijG5qkHRwtNmqApPRwj8LQ5WNnGPr",
    # PalletId b"bl/ledgr", sub-seed b"POL_____".
    "ledger_pol": "fvGJck7fS1t2ejm7TyRjX7bM8xnwS4uv4wdQH8yP4R5nmPEgM",
    # PalletId b"bl/ledgr", sub-seed b"POL_BASE".
    "ledger_pol_baseline": "fvGJck7fS1t2ejm7TyRjX7bM7kkEJajB9AgQLpGFXKK6kMrtc",
    # PalletId b"bl/ledgr", sub-seed b"FEES____".
    "ledger_fees": "fvGJck7fS1t2ejm7TyRgo5ZdbDuPx4SuWAYZcGNkExrk7XAN9",
    # PalletId b"bl/ledgr", sub-seed b"TREASRY_".
    "ledger_treasury": "fvGJck7fS1t2ejm7TyRkcGJM9ZWMGqjUwaeas8gJnGJ7e7E7y",
    # PalletId b"bl/trsry", no sub-seed.
    "treasury_main": "fvGJck7fS1t2fpsb9pvvJ2EYTyx6sgq1NkVTTZqzwipoLqtzp",
    # PalletId b"bl/trsry", sub-seed b"KEEPER__".
    "treasury_keeper": "fvGJck7fS1t2fpsb9pwGivHa8vtqjyagJ7ewS1GG86JyNUMK4",
    # PalletId b"bl/trsry", sub-seed b"ORACLE__".
    "treasury_oracle": "fvGJck7fS1t2fpsb9pwHpghdH5GxgxAp1Ry3utTBSxzNF4xkN",
    # PalletId b"bl/trsry", sub-seed b"REWARDS_".
    "treasury_rewards": "fvGJck7fS1t2fpsb9pwJd7it7GJzrhrAYqbvh4vLzVgHyUFo9",
    # PalletId b"bl/trsry", sub-seed b"COLLATOR".
    "treasury_collators": "fvGJck7fS1t2fpsb9pwEZbqSAbfbk4vUMedfFaLX8i2iF96mR",
}
# 09 §4/§6.1: DOT is held locally under the parent Location and funds coretime
# renewal. `identity.rs::dot_location()` is `Location::parent()`, and
# `Junctions::Here` is a unit variant of a plain-derive enum, so its serde shape
# is the bare string "Here".
DOT_LOCATION = {"parents": 1, "interior": "Here"}
DOT_MIN_BALANCE = 1
# Every asset the runtime declares in `foreignAssets.assets` at genesis, with
# the doc section that owns it. Both carry the same catastrophic authority if
# their owner is wrong, so both are gated identically — in `assets` *and*, since
# the 2026-07-27 review, in `accounts`, where the exhaustiveness rule previously
# reached USDC only.
DECLARED_ASSETS = {
    "USDC": (USDC_LOCATION, USDC_MIN_BALANCE, "03 §7 R-4"),
    "DOT": (DOT_LOCATION, DOT_MIN_BALANCE, "09 §4/§6.1"),
}

# Top-level chain-spec keys this project legitimately ships. An **allowlist**,
# because `sc-chain-spec`'s `ClientSpec` deliberately does not set
# `deny_unknown_fields` and flattens straight into the same JSON object as
# `genesis` — so any field the node's serde knows about rides a spec that names
# only the keys below without this check ever looking at it.
ALLOWED_TOP_LEVEL_KEYS = frozenset(
    {
        "name",
        "id",
        "chainType",
        "bootNodes",
        "telemetryEndpoints",
        "protocolId",
        "forkId",
        "properties",
        "relay_chain",
        "para_id",
        "codeSubstitutes",
        "genesis",
        "consensusEngine",
        "lightSyncState",
        "extensions",
        "badBlocks",
        "forkBlocks",
    }
)
# Keys whose *presence with content* redirects or invalidates execution. Each
# is a `ClientSpec` field the node consumes and no Bleavit release uses.
#
# `codeSubstitutes` is the sharp one: `sc-service` loads it into
# `ClientConfig.wasm_runtime_substitutes` and `code_provider.rs` then selects
# the substitute *over the on-chain code*, logging only at `debug!`. Because it
# is not genesis state, the release assembler's `:code` <-> `runtime.wasm`
# binding cannot see it and the genesis hash is unchanged — so a poisoned node
# joins the same chain, peers normally, and serves attacker-chosen answers to
# every runtime-API call (02 §3 `FutarchyApi` results are not
# state-proof-verifiable) while leaving every other release control green.
FORBIDDEN_NONEMPTY_TOP_LEVEL_KEYS = {
    "codeSubstitutes": (
        "02 §11",
        "redirects runtime execution away from the on-chain :code without "
        "changing genesis state, so neither the genesis hash nor the release "
        "manifest's :code<->runtime.wasm binding can detect it",
    ),
    "forkBlocks": ("02 §11", "pins the node to a hand-chosen fork"),
    "badBlocks": ("02 §11", "makes the node reject canonical blocks"),
}
# Genesis-patch sections the runtime's `RuntimeGenesisConfig` declares and a
# Bleavit spec may carry (`runtime/bleavit-runtime/src/genesis.rs`). Also an
# allowlist: an unknown section is either a typo that silently defaults a real
# one, or a pallet config nothing here reviews.
#
# **This list must cover every `construct_runtime!` pallet that declares a
# `#[pallet::genesis_config]`, not merely the sections the dev/local presets
# happen to emit.** It was originally derived from the latter and so omitted
# `welfare`, `oracle`, `guardian` and `attestor` — all real, settable sections.
# Only the drill genesis sets one (`guardian`, seeding seven seat bonds per
# 06 §5.1), so the gap was invisible to every per-commit gate and surfaced only
# when the B7 drill pipeline was next actually run — long after the allowlist
# landed. `tools/deploy/tests/test_validate_chain_spec_sections.py` now
# cross-checks this set against `construct_runtime!` so it cannot silently go
# stale again; a new genesis-bearing pallet fails that test until it is listed.
ALLOWED_GENESIS_SECTIONS = frozenset(
    {
        # stock FRAME / Cumulus
        "balances",
        "vesting",
        "foreignAssets",
        "parachainInfo",
        "collatorSelection",
        "session",
        "polkadotXcm",
        "sudo",
        # Bleavit pallets carrying a genesis config
        "constitution",
        "epoch",
        "futarchyTreasury",
        "executionGuard",
        "welfare",
        "oracle",
        "guardian",
        "attestor",
    }
)
# 02 §7.3 phase-flag bits (`constitution_core::PhaseFlagsValue`).
PHASE_FLAG_SHADOW_MODE = 1 << 0
PHASE_FLAG_SUDO_PRESENT = 1 << 4
# `genesis.rs::BOOTSTRAP_PHASE_FLAGS` — the exact value a bootstrap-profile
# launch spec must declare. `SUDO_PRESENT` is load-bearing beyond bookkeeping:
# the frontend binds its persistent "bootstrap governance (sudo active)" banner
# to it (09 §5.2), so a spec that ships a sudo key with the bit clear
# misrepresents sudo-era state as trust-equivalent to post-sudo state.
BOOTSTRAP_PHASE_FLAGS = PHASE_FLAG_SHADOW_MODE | PHASE_FLAG_SUDO_PRESENT
BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
BASE58_VALUES = {character: index for index, character in enumerate(BASE58_ALPHABET)}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate a Bleavit chain spec against 02 §8 and §10."
    )
    parser.add_argument("spec", type=Path, help="chain-spec JSON to validate")
    parser.add_argument("--profile", choices=PROFILES, required=True)
    return parser.parse_args()


def load_json(path: Path, label: str, failures: list[str]) -> Any:
    try:
        with path.open(encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, json.JSONDecodeError) as error:
        failures.append(f"{label}: cannot read valid JSON from {path}: {error}")
        return None


def require_equal(
    failures: list[str], label: str, actual: Any, expected: Any, citation: str
) -> None:
    if actual != expected:
        failures.append(
            f"{citation}: {label} must be {expected!r}, found {actual!r}"
        )


def wss_port(endpoint: str) -> int | None:
    """Return the TCP port for the required browser-WSS manifest schema."""
    match = WSS_MULTIADDR.fullmatch(endpoint)
    if match is None:
        return None
    host = match.group("host")
    port = int(match.group("port"))
    if len(host) > 253 or not 1 <= port <= 65535:
        return None
    return port


def wss_peer_id(endpoint: str) -> str | None:
    """Return the peer ID for the required browser-WSS manifest schema."""
    match = WSS_MULTIADDR.fullmatch(endpoint)
    if match is None or wss_port(endpoint) is None:
        return None
    return match.group("peer")


def base58_decode(value: str) -> bytes | None:
    number = 0
    for character in value:
        digit = BASE58_VALUES.get(character)
        if digit is None:
            return None
        number = number * 58 + digit
    encoded = b"" if number == 0 else number.to_bytes((number.bit_length() + 7) // 8, "big")
    return b"\0" * (len(value) - len(value.lstrip("1"))) + encoded


def ss58_account_id(address: str) -> bytes | None:
    """Decode a checksummed 32-byte SS58 account, independent of display prefix."""
    decoded = base58_decode(address)
    if decoded is None or not decoded:
        return None
    prefix_length = 1 if decoded[0] <= 63 else 2 if decoded[0] <= 127 else 0
    if prefix_length == 0 or len(decoded) != prefix_length + 32 + 2:
        return None
    payload = decoded[:-2]
    checksum = hashlib.blake2b(b"SS58PRE" + payload, digest_size=64).digest()[:2]
    if decoded[-2:] != checksum:
        return None
    return decoded[prefix_length:-2]


def pallet_sub_account(pallet_id: bytes, sub: bytes | None = None) -> bytes:
    """Derive AccountId32 exactly as AccountIdConversion for PalletId does."""
    encoded = b"modl" + pallet_id + (sub or b"")
    return encoded.ljust(32, b"\0")[:32]


def contains_todo(value: Any) -> bool:
    if isinstance(value, str):
        return "TODO" in value
    if isinstance(value, list):
        return any(contains_todo(item) for item in value)
    if isinstance(value, dict):
        return any(contains_todo(key) or contains_todo(item) for key, item in value.items())
    return False


def validate_declared_asset(
    asset_rows: list[Any],
    label: str,
    location: dict[str, Any],
    minimum_balance: int,
    citation: str,
    failures: list[str],
) -> None:
    """Require the full canonical `foreignAssets.assets` row for one asset.

    `pallet-assets` genesis rows are `(id, owner, is_sufficient, min_balance)`,
    and its `build` installs `owner` as owner AND issuer AND admin AND freezer
    — mint, burn and freeze authority over every unit of the asset on chain.
    Matching only the Location and `min_balance` would therefore let a release
    pass a spec that hands an external key control of protocol collateral, or
    that clears `is_sufficient` (03 §7 R-4's opening clause for USDC, and what
    keeps the endowed protocol accounts alive without provider references).
    All four fields are checked, and the owner must be the ledger sovereign
    that `runtime/bleavit-runtime/src/genesis.rs` derives.
    """
    expected_owner = ss58_account_id(USDC_ENDOWED_ACCOUNTS["ledger_sovereign"])
    if expected_owner is None:
        failures.append(
            f"{citation}: validator has an invalid derived ledger sovereign address"
        )
        return

    matches = [
        row
        for row in asset_rows
        if isinstance(row, list) and len(row) == 4 and row[0] == location
    ]
    if not matches:
        failures.append(
            f"{citation}: foreignAssets.assets must declare the canonical "
            f"{label} Location"
        )
        return
    if len(matches) > 1:
        failures.append(
            f"{citation}: foreignAssets.assets declares the canonical {label} "
            "Location more than once"
        )
        return

    _, owner, is_sufficient, declared_minimum = matches[0]
    if not isinstance(owner, str) or ss58_account_id(owner) != expected_owner:
        failures.append(
            f"{citation}: the {label} asset owner must be the derived ledger "
            f"sovereign {USDC_ENDOWED_ACCOUNTS['ledger_sovereign']!r} (genesis "
            "installs the owner as issuer, admin and freezer), found "
            f"{owner!r}"
        )
    if is_sufficient is not True:
        failures.append(
            f"{citation}: the {label} asset must be declared sufficient "
            f"(is_sufficient = true), found {is_sufficient!r}"
        )
    if declared_minimum != minimum_balance or isinstance(declared_minimum, bool):
        failures.append(
            f"{citation}: the {label} asset must declare min_balance "
            f"{minimum_balance}, found {declared_minimum!r}"
        )


def validate_usdc_genesis(patch: dict[str, Any], failures: list[str]) -> None:
    """Enforce the exact, minimal 03 §7 R-4 USDC genesis issuance."""
    required_by_account: dict[bytes, tuple[str, str]] = {}
    for label, address in USDC_ENDOWED_ACCOUNTS.items():
        account = ss58_account_id(address)
        if account is None:
            failures.append(
                f"03 §7 R-4: validator has an invalid derived {label} USDC address"
            )
            continue
        required_by_account[account] = (label, address)

    foreign_assets = patch.get("foreignAssets")
    if not isinstance(foreign_assets, dict):
        failures.append("03 §7 R-4: genesis patch must include a foreignAssets section")
        return

    asset_rows = foreign_assets.get("assets")
    if not isinstance(asset_rows, list):
        failures.append("03 §7 R-4: foreignAssets.assets must be an array")
        return
    for label, (location, minimum, citation) in DECLARED_ASSETS.items():
        validate_declared_asset(
            asset_rows, label, location, minimum, citation, failures
        )

    account_rows = foreign_assets.get("accounts")
    if not isinstance(account_rows, list):
        failures.append("03 §7 R-4: foreignAssets.accounts must be an array")
        return

    seen_usdc_accounts: set[bytes] = set()
    for index, row in enumerate(account_rows):
        if (
            not isinstance(row, list)
            or len(row) != 3
            or not isinstance(row[0], dict)
            or not isinstance(row[1], str)
            or not isinstance(row[2], int)
            or isinstance(row[2], bool)
            or row[2] < 0
        ):
            failures.append(
                "03 §7 R-4: foreignAssets.accounts"
                f"[{index}] must be [Location object, SS58 account, non-negative integer balance]"
            )
            continue

        account = ss58_account_id(row[1])
        if account is None:
            failures.append(
                f"03 §7 R-4: foreignAssets.accounts[{index}] has an invalid "
                "32-byte SS58 account"
            )
            continue

        required = required_by_account.get(account)
        is_usdc = row[0] == USDC_LOCATION
        if required is not None and not is_usdc:
            failures.append(
                f"03 §7 R-4: required account {required[0]} {row[1]!r} is endowed "
                "with the wrong asset Location instead of canonical USDC"
            )
            continue
        if not is_usdc:
            # The exhaustiveness rule below is per **declared asset**, not per
            # spec. Previously every non-USDC row `continue`d before it, so an
            # arbitrary genesis DOT endowment passed the gate while
            # `pallet-assets`'s genesis builder really minted it — even though
            # this file's own header claims USDC and DOT "are gated
            # identically", which was true for `assets` and false for
            # `accounts`. That balance is inert only because the pinned
            # `pallet-xcm` rejects reserve transfers of the network-native
            # asset, and that guard documents itself as "a temporary patch in
            # preparation for the Asset Hub Migration … will be removed after
            # the migration" — an SDK-pin-dependent mitigation, not a control
            # this repository owns.
            declared = next(
                (
                    label
                    for label, (location, _minimum, _citation) in DECLARED_ASSETS.items()
                    if row[0] == location
                ),
                None,
            )
            if declared is None:
                failures.append(
                    f"03 §7 R-4: foreignAssets.accounts[{index}] endows an asset "
                    f"Location the runtime does not declare: {row[0]!r}"
                )
            else:
                _, _, citation = DECLARED_ASSETS[declared]
                failures.append(
                    f"{citation}: unbacked {declared} genesis endowment to "
                    f"{row[1]!r} is forbidden — no genesis account may be "
                    f"credited {declared} that has no reserve behind it"
                )
            continue

        if account in seen_usdc_accounts:
            failures.append(
                "03 §7 R-4: foreignAssets.accounts contains duplicate row for "
                f"the same (USDC, account) pair {row[1]!r}"
            )
            continue
        seen_usdc_accounts.add(account)

        # Any extra unit would be unbacked USDC issuance with no Asset Hub reserve.
        if required is None:
            failures.append(
                "03 §7 R-4: unbacked USDC genesis endowment to non-required "
                f"account {row[1]!r} is forbidden"
            )
            continue
        if row[2] != USDC_MIN_BALANCE:
            failures.append(
                f"03 §7 R-4: {required[0]} {required[1]} must receive exactly "
                f"{USDC_MIN_BALANCE} USDC base units; found {row[2]}"
            )

    for account, (label, address) in required_by_account.items():
        if account not in seen_usdc_accounts:
            failures.append(
                f"03 §7 R-4: required USDC genesis endowment is absent for "
                f"{label} {address}"
            )

    balance_rows = (
        patch.get("balances", {}).get("balances")
        if isinstance(patch.get("balances"), dict)
        else None
    )
    if isinstance(balance_rows, list):
        native_protocol_pots = {
            account
            for address, _amount in PROTOCOL_POTS.values()
            if (account := ss58_account_id(address)) is not None
        }
        for index, row in enumerate(balance_rows):
            if not isinstance(row, list) or len(row) != 2 or not isinstance(row[0], str):
                continue
            account = ss58_account_id(row[0])
            # USDC endowments belong only in ForeignAssets. treasury_main is the
            # deliberate overlap: its existing native VIT reserve remains here.
            if account in required_by_account and account not in native_protocol_pots:
                failures.append(
                    "03 §7 R-4: USDC-endowed protocol account "
                    f"{row[0]!r} must not appear in native balances.balances "
                    f"(row {index})"
                )


def validate_client_spec_surface(spec: dict[str, Any], failures: list[str]) -> None:
    """Reject `ClientSpec` fields this project does not ship (02 §11).

    Everything else in this file asserts values for keys it names, which is
    exactly the shape a `codeSubstitutes` entry rides through: it changes no
    value any check reads, and it is not genesis state, so the release
    assembler's :code binding and the unchanged genesis hash both stay green
    while the node executes attacker-supplied Wasm.
    """
    for key, (citation, why) in FORBIDDEN_NONEMPTY_TOP_LEVEL_KEYS.items():
        value = spec.get(key)
        if value is None:
            continue
        # `{}`/`[]` are what `#[serde(default)]` produces; only content is a
        # finding, so a spec that spells the key out empty still passes.
        if isinstance(value, (dict, list)) and not value:
            continue
        failures.append(f"{citation}: chain spec must not carry a non-empty {key!r} — it {why}")

    unknown = sorted(set(spec) - ALLOWED_TOP_LEVEL_KEYS)
    if unknown:
        failures.append(
            "02 §11: chain spec carries unknown top-level key(s) "
            f"{unknown} — `sc-chain-spec` does not `deny_unknown_fields`, so "
            "every field it understands must be reviewed here explicitly"
        )


def validate_root_key(patch: dict[str, Any], profile: str, failures: list[str]) -> None:
    """Validate the genesis Root key and the phase flags that must match it.

    Production launches at Phase 3 with sudo present (09 §3.2), and doc 14
    TH-29 states the residual plainly: "sudo can still upgrade the runtime and
    thereby do anything." Nothing else validates it — `runtime_profiles.py`
    asserts only that the *pallet* is in metadata, never the key's value — so
    this file, whose declared threat model is "a release spec that hands an
    external key control of protocol collateral", had a hole in the
    highest-privilege field inside its own scope.

    The key itself is a launch-ceremony output, like the Coretime ops seats
    above, so it cannot be pinned to a constant here. It takes the identical
    treatment: required, well-formed, and carried as an explicit unfilled
    "TODO" seat in the allocation template so `contains_todo` confronts the
    operator with it rather than letting a spec default past it.
    """
    sudo = patch.get("sudo")
    if not isinstance(sudo, dict):
        failures.append(
            "09 §3.2: production genesis patch must carry a sudo section — "
            "mainnet launches at Phase 3 with sudo present, and an absent "
            "section is indistinguishable from one still awaiting the "
            "launch ceremony"
        )
        return
    key = sudo.get("key")
    if key is None:
        failures.append(
            "09 §3.2: genesis patch sudo.key must seat the founding multisig "
            "(14 TH-29: sudo can upgrade the runtime and thereby do anything)"
        )
    elif not isinstance(key, str) or ss58_account_id(key) is None:
        failures.append(
            f"09 §3.2: genesis patch sudo.key {key!r} is not a valid 32-byte "
            "SS58 account"
        )

    constitution = patch.get("constitution")
    phase_flags = constitution.get("phaseFlags") if isinstance(constitution, dict) else None
    if phase_flags is None:
        failures.append(
            "02 §7.3: genesis patch constitution.phaseFlags must be set "
            f"explicitly to the bootstrap value {BOOTSTRAP_PHASE_FLAGS} "
            "(SHADOW_MODE|SUDO_PRESENT)"
        )
    elif phase_flags != BOOTSTRAP_PHASE_FLAGS:
        failures.append(
            "02 §7.3: genesis patch constitution.phaseFlags must be "
            f"{BOOTSTRAP_PHASE_FLAGS} (SHADOW_MODE|SUDO_PRESENT) for a "
            f"bootstrap launch spec; found {phase_flags!r}"
        )


def validate_genesis(
    spec: dict[str, Any], profile: str, failures: list[str]
) -> None:
    genesis = spec.get("genesis")
    runtime_genesis = genesis.get("runtimeGenesis") if isinstance(genesis, dict) else None
    patch_present = isinstance(runtime_genesis, dict) and "patch" in runtime_genesis
    if not patch_present:
        if profile in ("paseo", "polkadot"):
            failures.append(
                "08 §2.1: paseo/polkadot specs must include genesis.runtimeGenesis.patch"
            )
        return

    patch = runtime_genesis.get("patch")
    if not isinstance(patch, dict):
        failures.append("08 §2.1: genesis.runtimeGenesis.patch must be a JSON object")
        return
    if contains_todo(patch):
        failures.append('08 §2.1: genesis runtime patch must not contain a "TODO" string')

    unknown_sections = sorted(set(patch) - ALLOWED_GENESIS_SECTIONS)
    if unknown_sections:
        failures.append(
            "08 §2.1: genesis patch carries unknown section(s) "
            f"{unknown_sections} — an unrecognised section is either a "
            "misspelling that silently defaults a real one, or pallet genesis "
            "nothing here reviews"
        )

    validate_usdc_genesis(patch, failures)

    if profile in ("paseo", "polkadot"):
        validate_root_key(patch, profile, failures)

    # The runtime reads its para id from genesis (`staging_parachain_info`), not
    # from the chain-spec extension — a release spec whose top-level `para_id`
    # is correct but whose patch still carries the 4242 fixture (or nothing)
    # would boot a runtime configured for a different parachain (02 §8).
    top_level_para_id = spec.get("para_id")
    parachain_info = patch.get("parachainInfo")
    patch_para_id = (
        parachain_info.get("parachainId") if isinstance(parachain_info, dict) else None
    )
    if patch_para_id is None:
        failures.append(
            "02 §8: genesis patch must set parachainInfo.parachainId (the runtime "
            "reads its para id from genesis, not the chain-spec extension)"
        )
    elif patch_para_id != top_level_para_id:
        failures.append(
            "02 §8: genesis patch parachainInfo.parachainId "
            f"({patch_para_id!r}) must equal the chain spec's para_id "
            f"({top_level_para_id!r})"
        )

    # Both Coretime ops accounts are OUTPUTS of the Phase-2/3 ops ceremony, so
    # neither can be a chain-spec constant fixed in advance. The runtime treats
    # each as unset-fails-closed (no stored quote authority => no quote can be
    # noted; no stored renewal account => no renewal dispatches), which makes
    # omission safe but silent: a genesis that simply forgot them is
    # indistinguishable from one still awaiting the ceremony. The production
    # template (deploy/genesis/allocations.template.json) therefore carries both
    # as explicit unfilled "TODO" seats, and this check is what confronts the
    # operator with them instead of letting a release spec default past them —
    # seating them is a Phase-3 entry gate (12 §6.5). Development and test
    # presets seat stand-ins and are exempt (09 §4).
    if profile in ("paseo", "polkadot"):
        treasury_config = patch.get("futarchyTreasury")
        if not isinstance(treasury_config, dict):
            failures.append(
                "09 §4: production genesis patch must carry a futarchyTreasury "
                "section seating the Phase-2/3 ops-ceremony accounts "
                "(coretimeQuoteAuthority, coretimeRenewalAccount)"
            )
            treasury_config = {}
        for key, label, encoding in CORETIME_OPS_SEATS:
            seat = treasury_config.get(key)
            if seat is None:
                failures.append(
                    f"09 §4: genesis patch futarchyTreasury.{key} must seat the "
                    f"{label}; unset fails closed, and seating it is a Phase-3 "
                    "entry gate (12 §6.5)"
                )
            elif contains_todo(seat):
                failures.append(
                    f"09 §4: genesis patch futarchyTreasury.{key} must seat the "
                    f"real {label}; found an unfilled \"TODO\" seat"
                )
            elif encoding == "ss58":
                if not isinstance(seat, str) or ss58_account_id(seat) is None:
                    failures.append(
                        f"09 §4: genesis patch futarchyTreasury.{key} must seat the "
                        f"{label} as a valid 32-byte SS58 account"
                    )
            elif not (
                isinstance(seat, list)
                and len(seat) == 32
                and all(
                    isinstance(byte, int)
                    and not isinstance(byte, bool)
                    and 0 <= byte <= 255
                    for byte in seat
                )
            ):
                failures.append(
                    f"09 §4: genesis patch futarchyTreasury.{key} must seat the "
                    f"{label} as a 32-byte array"
                )

    balances_config = patch.get("balances")
    balance_rows = balances_config.get("balances") if isinstance(balances_config, dict) else None
    if not isinstance(balance_rows, list):
        failures.append("08 §2.1: genesis patch balances.balances must be an array")
        return

    balances_by_account: dict[bytes, int] = {}
    address_by_account: dict[bytes, str] = {}
    total = 0
    for index, row in enumerate(balance_rows):
        if (
            not isinstance(row, list)
            or len(row) != 2
            or not isinstance(row[0], str)
            or not isinstance(row[1], int)
            or isinstance(row[1], bool)
            or row[1] < 0
        ):
            failures.append(
                f"08 §2.1: balances.balances[{index}] must be [SS58 account, non-negative integer plancks]"
            )
            continue
        account = ss58_account_id(row[0])
        if account is None:
            failures.append(
                f"08 §2.1: balances.balances[{index}] has an invalid 32-byte SS58 account"
            )
            continue
        total += row[1]
        if account in balances_by_account:
            failures.append(
                f"08 §2.1: balances.balances contains duplicate account entry {row[0]!r}"
            )
            continue
        balances_by_account[account] = row[1]
        address_by_account[account] = row[0]

    if total != TOTAL_SUPPLY:
        failures.append(
            "08 §2.1: balances.balances must sum to exactly "
            f"1,000,000,000 VIT ({TOTAL_SUPPLY} plancks); found {total}"
        )

    pot_accounts: set[bytes] = set()
    for label, (address, expected_amount) in PROTOCOL_POTS.items():
        account = ss58_account_id(address)
        if account is None:
            failures.append(f"08 §2.1: validator has an invalid derived {label} address")
            continue
        pot_accounts.add(account)
        # The security invariant is the 32-byte account identity plus the exact
        # amount. The display prefix of the patch string is presentation only —
        # the runtime's genesis serializer emits the default (42) prefix, while
        # the chain's canonical display prefix is enforced separately via
        # properties.ss58Format == 7777 — so any valid checksummed encoding of
        # the derived account is accepted here.
        actual_amount = balances_by_account.get(account)
        actual_address = address_by_account.get(account)
        if actual_amount != expected_amount:
            failures.append(
                f"08 §2.1: derived {label} protocol pot {address} (ss58-7777) must "
                f"hold exactly {expected_amount} plancks; found address "
                f"{actual_address!r} with {actual_amount!r} plancks"
            )

    vesting_config = patch.get("vesting")
    vesting_rows = vesting_config.get("vesting") if isinstance(vesting_config, dict) else None
    if not isinstance(vesting_rows, list):
        failures.append("08 §2.1: genesis patch vesting.vesting must be an array")
        vesting_rows = []

    founding_accounts: set[bytes] = set()
    for index, row in enumerate(vesting_rows):
        if not isinstance(row, list) or len(row) != 4 or not isinstance(row[0], str):
            failures.append(
                f"08 §2.1: vesting.vesting[{index}] must be (who, begin, length, liquid)"
            )
            continue
        account = ss58_account_id(row[0])
        if account is None:
            failures.append(
                f"08 §2.1: vesting.vesting[{index}] has an invalid 32-byte SS58 account"
            )
            continue
        founding_accounts.add(account)
        schedule = tuple(row[1:])
        if schedule != TEAM_VESTING_SCHEDULE:
            failures.append(
                f"08 §2.1: founding-team vesting row for {row[0]!r} must be "
                f"(who, {TEAM_VESTING_SCHEDULE[0]}, {TEAM_VESTING_SCHEDULE[1]}, 0); "
                f"found {tuple(row)!r}"
            )

    founding_total = sum(
        amount for account, amount in balances_by_account.items() if account in founding_accounts
    )
    if founding_total != FOUNDING_TEAM_TOTAL:
        failures.append(
            "08 §2.1: founding-team accounts with required vesting rows must total "
            f"exactly 200,000,000 VIT; found {founding_total} plancks"
        )

    ops_total = sum(
        amount
        for account, amount in balances_by_account.items()
        if account not in pot_accounts and account not in founding_accounts
    )
    if ops_total != OPS_FUND_TOTAL:
        failures.append(
            "08 §2.1: ecosystem/ops-fund accounts must total exactly "
            f"150,000,000 VIT; found {ops_total} plancks"
        )


def validate_bootnodes(
    spec: dict[str, Any], profile: str, failures: list[str]
) -> None:
    repo = Path(__file__).resolve().parents[2]
    manifest_path = repo / "deploy" / "chain-specs" / f"bootnodes.{profile}.json"
    manifest = load_json(manifest_path, "bootnode manifest", failures)
    if not isinstance(manifest, dict):
        return

    require_equal(
        failures,
        "bootnode manifest network",
        manifest.get("network"),
        profile,
        "02 §10",
    )
    operators = manifest.get("operators")
    if not isinstance(operators, list):
        failures.append("02 §10: bootnode manifest operators must be a JSON array")
        return

    endpoint_operators: dict[str, set[str]] = {}
    operator_names: set[str] = set()
    for index, operator in enumerate(operators):
        if not isinstance(operator, dict):
            failures.append(f"02 §10: operators[{index}] must be an object")
            continue
        name = operator.get("name")
        multiaddrs = operator.get("multiaddrs")
        if not isinstance(name, str) or not name.strip():
            failures.append(f"02 §10: operators[{index}].name must be non-empty")
            continue
        normalized_name = name.strip().casefold()
        if name != name.strip():
            failures.append(
                f"02 §10: operator name {name!r} must not have surrounding whitespace"
            )
        if normalized_name in operator_names:
            failures.append(f"02 §10: operator name {name!r} is duplicated")
        operator_names.add(normalized_name)
        if not isinstance(multiaddrs, list):
            failures.append(f"02 §10: operator {name!r} multiaddrs must be an array")
            continue
        for endpoint in multiaddrs:
            if not isinstance(endpoint, str):
                failures.append(f"02 §10: operator {name!r} has a non-string multiaddr")
                continue
            if wss_port(endpoint) is None:
                failures.append(
                    "02 §10: operator "
                    f"{name!r} endpoint {endpoint!r} must match "
                    "/(dns|dns4|dns6)/<host>/tcp/<port>/wss/p2p/<peer-id>"
                )
                continue
            endpoint_operators.setdefault(endpoint, set()).add(normalized_name)

    for endpoint, owners in endpoint_operators.items():
        if len(owners) > 1:
            failures.append(
                f"02 §10: endpoint {endpoint!r} is attributed to multiple operators"
            )

    bootnodes = spec.get("bootNodes")
    if not isinstance(bootnodes, list):
        failures.append("02 §10: production/Paseo spec bootNodes must be an array")
        return
    if any(not isinstance(item, str) for item in bootnodes):
        failures.append("02 §10: every production/Paseo bootNodes entry must be a string")

    unique_spec_endpoints = {item for item in bootnodes if isinstance(item, str)}
    wss_endpoints = {
        endpoint
        for endpoint in unique_spec_endpoints
        if wss_port(endpoint) is not None and endpoint in endpoint_operators
    }
    if len(wss_endpoints) < 8:
        failures.append(
            "02 §10: spec must list at least 8 unique /wss multiaddrs sourced "
            f"from the {profile} operator manifest; found {len(wss_endpoints)}"
        )

    distinct_peers = {
        peer
        for endpoint in wss_endpoints
        if (peer := wss_peer_id(endpoint)) is not None
    }
    if len(distinct_peers) < 8:
        failures.append(
            "02 §10: WSS bootnodes must provide at least 8 distinct p2p peer IDs; "
            f"found {len(distinct_peers)}"
        )

    represented_operators = {
        operator
        for endpoint in wss_endpoints
        for operator in endpoint_operators[endpoint]
    }
    if len(represented_operators) < 4:
        failures.append(
            "02 §10: WSS bootnodes must span at least 4 independent operators; "
            f"found {len(represented_operators)}"
        )

    port_443_peers = {
        peer
        for endpoint in wss_endpoints
        if wss_port(endpoint) == 443
        if (peer := wss_peer_id(endpoint)) is not None
    }
    if len(port_443_peers) < 2:
        failures.append(
            "02 §10: at least 2 WSS bootnodes on TCP port 443 must have distinct "
            f"p2p peer IDs; found {len(port_443_peers)} distinct peers"
        )


def main() -> int:
    args = parse_args()
    failures: list[str] = []
    spec = load_json(args.spec, "chain spec", failures)
    if not isinstance(spec, dict):
        for failure in failures:
            print(f"ERROR: {failure}", file=sys.stderr)
        return 1

    properties = spec.get("properties")
    if not isinstance(properties, dict):
        failures.append("02 §8: properties must be a JSON object")
        properties = {}
    require_equal(failures, "properties.ss58Format", properties.get("ss58Format"), 7777, "02 §8")
    require_equal(failures, "properties.tokenDecimals", properties.get("tokenDecimals"), 12, "02 §8")
    require_equal(failures, "properties.tokenSymbol", properties.get("tokenSymbol"), "VIT", "02 §8")

    require_equal(
        failures,
        "relay_chain",
        spec.get("relay_chain"),
        EXPECTED_RELAY[args.profile],
        "02 §8",
    )
    para_id = spec.get("para_id")
    if args.profile in ("dev", "local"):
        require_equal(failures, "para_id", para_id, 4242, "02 §8")
    elif not isinstance(para_id, int) or isinstance(para_id, bool) or para_id <= 0:
        failures.append("02 §8: production/Paseo para_id must be assigned")

    validate_client_spec_surface(spec, failures)
    validate_genesis(spec, args.profile, failures)

    if args.profile in ("paseo", "polkadot"):
        validate_bootnodes(spec, args.profile, failures)

    if failures:
        for failure in failures:
            print(f"ERROR: {failure}", file=sys.stderr)
        return 1
    print(f"OK: {args.spec} satisfies the Bleavit {args.profile} profile")
    return 0


if __name__ == "__main__":
    sys.exit(main())
