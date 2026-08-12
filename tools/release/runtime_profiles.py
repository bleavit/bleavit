#!/usr/bin/env python3
"""Canonical, fail-closed runtime release-profile definitions."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


PROFILE_SCHEMA = "bleavit.runtime-profiles.v2"
BUILD_SCHEMA = "bleavit.runtime-build.v3"
BASE_FEATURES = frozenset({"bootstrap", "phase-four"})
COMMON_FEATURES = frozenset({"std", "substrate-wasm-builder", "metadata-hash"})
RECOVERY_TEST = "recovery_profile_has_zero_multi_block_migrations"
RUNTIME_REPRODUCIBILITY_SCOPE = (
    "same source + canonical recipe + exact OCI image digest => same runtime bytes; "
    "independent runtime byte comparison is not yet automated"
)
RFC78_METADATA_HASH = {
    "enabled": True,
    "token_symbol": "VIT",
    "token_decimals": 12,
    "source": "RUNTIME_METADATA_HASH embedded by substrate-wasm-builder",
}
RFC78_STATUS = "enabled and independently recomputed from metadata.scale"
OCI_REFERENCE = re.compile(r"^docker\.io/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$")
OCI_IMAGE_ID = re.compile(r"^sha256:[0-9a-f]{64}$")
TOOLCHAIN_CHANNEL = re.compile(r'^channel = "([^"]+)"$', re.MULTILINE)
RUNTIME_STATIC_ENVIRONMENT = {
    "CARGO_HOME": "/cargo-home",
    "CARGO_INCREMENTAL": "0",
    "CARGO_TARGET_DIR": "/target",
    "CARGO_TERM_COLOR": "never",
    "HOME": "/build-home",
    "LANG": "C.UTF-8",
    "LC_ALL": "C.UTF-8",
    "RUSTUP_HOME": "/rustup-home",
    "TZ": "UTC",
    "WASM_BUILD_WORKSPACE_HINT": "/src",
}


class ProfileError(ValueError):
    """A runtime profile is unknown, ambiguous, or internally inconsistent."""


def profile_manifest_path() -> Path:
    return Path(__file__).resolve().with_name("runtime-profiles.json")


def load_profiles(path: Path | None = None) -> dict[str, Any]:
    manifest_path = path or profile_manifest_path()
    document = json.loads(manifest_path.read_text(encoding="utf-8"))
    validate_profiles(document)
    return document


def validate_profiles(document: dict[str, Any]) -> None:
    if document.get("schema") != PROFILE_SCHEMA:
        raise ProfileError(f"runtime profile schema must be {PROFILE_SCHEMA}")
    if set(document) != {"schema", "release_default", "build_environment", "profiles"}:
        raise ProfileError("runtime profile manifest has an unexpected top-level field set")
    environment = document.get("build_environment")
    if not isinstance(environment, dict) or set(environment) != {
        "kind",
        "image",
        "image_id",
        "platform",
        "upstream_tag",
    }:
        raise ProfileError("build_environment must declare the exact OCI identity field set")
    if environment["kind"] != "oci":
        raise ProfileError("build_environment.kind must be oci")
    if not isinstance(environment["image"], str) or not OCI_REFERENCE.fullmatch(
        environment["image"]
    ):
        raise ProfileError("build_environment.image must be a docker.io sha256 reference")
    if not isinstance(environment["image_id"], str) or not OCI_IMAGE_ID.fullmatch(
        environment["image_id"]
    ):
        raise ProfileError("build_environment.image_id must be a sha256 image config id")
    if environment["platform"] != "linux/amd64":
        raise ProfileError("build_environment.platform must be linux/amd64")
    if not isinstance(environment["upstream_tag"], str) or not environment[
        "upstream_tag"
    ]:
        raise ProfileError("build_environment.upstream_tag must be a non-empty audit label")
    profiles = document.get("profiles")
    expected_names = {
        "bootstrap",
        "phase-four",
        "bootstrap-recovery",
        "phase-four-recovery",
    }
    if not isinstance(profiles, dict) or set(profiles) != expected_names:
        raise ProfileError(
            "runtime profiles must contain exactly " + ", ".join(sorted(expected_names))
        )
    release_default = document.get("release_default")
    if release_default not in profiles:
        raise ProfileError("release_default must name a declared runtime profile")

    for name, row in profiles.items():
        if not isinstance(row, dict):
            raise ProfileError(f"profile {name} must be an object")
        expected_fields = {
            "base",
            "cargo_features",
            "multi_block_migrations",
            "recovery",
            "sudo_in_metadata",
            "primary_profile" if row.get("recovery") is True else "recovery_profile",
        }
        if set(row) != expected_fields:
            raise ProfileError(f"profile {name} has an unexpected field set")
        features = row["cargo_features"]
        if (
            not isinstance(features, list)
            or not features
            or any(not isinstance(feature, str) or not feature for feature in features)
            or len(features) != len(set(features))
        ):
            raise ProfileError(f"profile {name}.cargo_features must be unique strings")
        feature_set = set(features)
        selected_bases = feature_set & BASE_FEATURES
        if len(selected_bases) != 1:
            raise ProfileError(
                f"profile {name} must select exactly one base feature "
                "(bootstrap xor phase-four)"
            )
        base = row["base"]
        if base not in BASE_FEATURES or selected_bases != {base}:
            raise ProfileError(f"profile {name}.base does not match its Cargo features")
        recovery = row["recovery"]
        if type(recovery) is not bool or ("recovery" in feature_set) != recovery:
            raise ProfileError(f"profile {name}.recovery does not match its Cargo features")
        expected_features = COMMON_FEATURES | {base} | ({"recovery"} if recovery else set())
        if feature_set != expected_features:
            raise ProfileError(
                f"profile {name} Cargo features must be exactly "
                + ", ".join(sorted(expected_features))
            )
        expected_name = f"{base}-recovery" if recovery else base
        if name != expected_name:
            raise ProfileError(f"profile {name} must be named {expected_name}")
        if type(row["sudo_in_metadata"]) is not bool:
            raise ProfileError(f"profile {name}.sudo_in_metadata must be boolean")
        if row["sudo_in_metadata"] != (base == "bootstrap"):
            raise ProfileError(
                f"profile {name}.sudo_in_metadata must follow its base profile"
            )
        expected_mbm = "disabled" if recovery else "normal"
        if row["multi_block_migrations"] != expected_mbm:
            raise ProfileError(
                f"profile {name}.multi_block_migrations must be {expected_mbm}"
            )
        partner_field = "primary_profile" if recovery else "recovery_profile"
        expected_partner = base if recovery else f"{base}-recovery"
        if row[partner_field] != expected_partner:
            raise ProfileError(
                f"profile {name}.{partner_field} must be {expected_partner}"
            )

    for name, row in profiles.items():
        if row["recovery"]:
            primary = profiles[row["primary_profile"]]
            if primary["recovery_profile"] != name:
                raise ProfileError(f"profile pair for {name} is not bidirectional")


def select_profile(
    name: str | None, path: Path | None = None
) -> tuple[str, dict[str, Any]]:
    document = load_profiles(path)
    selected = name or document["release_default"]
    try:
        row = document["profiles"][selected]
    except KeyError as error:
        raise ProfileError(f"unknown runtime profile {selected!r}") from error
    return selected, row


def runtime_build_environment(path: Path | None = None) -> dict[str, str]:
    document = load_profiles(path)
    # Validation above establishes this exact string map; return a copy so a
    # caller cannot mutate the loaded document through a shared reference.
    return dict(document["build_environment"])


def runtime_toolchain(path: Path | None = None) -> str:
    toolchain_path = path or Path(__file__).resolve().parents[2] / "rust-toolchain.toml"
    matches = TOOLCHAIN_CHANNEL.findall(toolchain_path.read_text(encoding="utf-8"))
    if len(matches) != 1 or not matches[0]:
        raise ProfileError(f"{toolchain_path} does not declare one toolchain channel")
    return matches[0]


def runtime_normalized_environment(source_date_epoch: int) -> dict[str, str]:
    return {
        **RUNTIME_STATIC_ENVIRONMENT,
        "SOURCE_DATE_EPOCH": str(source_date_epoch),
    }


def cargo_recipe(profile: dict[str, Any]) -> list[str]:
    return [
        "cargo",
        "build",
        "-p",
        "bleavit-runtime",
        "--release",
        "--no-default-features",
        "--features",
        ",".join(profile["cargo_features"]),
        "--locked",
    ]


def recovery_test_recipe(profile: dict[str, Any]) -> list[str] | None:
    if not profile["recovery"]:
        return None
    features = [
        feature
        for feature in profile["cargo_features"]
        if feature not in {"substrate-wasm-builder", "metadata-hash"}
    ]
    return [
        "cargo",
        "test",
        "-p",
        "bleavit-runtime",
        "--no-default-features",
        "--features",
        ",".join(features),
        "--locked",
        RECOVERY_TEST,
    ]


def validate_build_profile(info: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if info.get("schema") != BUILD_SCHEMA:
        return [f"build-info.schema must be {BUILD_SCHEMA}"]
    name = info.get("runtime_profile")
    try:
        selected, profile = select_profile(name if isinstance(name, str) else None)
    except (OSError, json.JSONDecodeError, ProfileError) as error:
        return [f"build-info.runtime_profile is invalid: {error}"]
    if name != selected:
        errors.append("build-info.runtime_profile must be a non-empty profile name")
    if info.get("base_profile") != profile["base"]:
        errors.append("build-info.base_profile does not match the selected profile")
    if info.get("recovery") is not profile["recovery"]:
        errors.append("build-info.recovery does not match the selected profile")
    if info.get("cargo_features") != profile["cargo_features"]:
        errors.append("build-info.cargo_features do not match the selected profile")
    if info.get("cargo_default_features") is not False:
        errors.append("build-info.cargo_default_features must be false")
    if info.get("multi_block_migrations") != profile["multi_block_migrations"]:
        errors.append(
            "build-info.multi_block_migrations does not match the selected profile"
        )
    expected_recipe = " ".join(cargo_recipe(profile))
    if info.get("recipe") != expected_recipe:
        errors.append("build-info.recipe is not the canonical explicit Cargo recipe")
    verification = info.get("profile_verification")
    if profile["recovery"]:
        expected_test = " ".join(recovery_test_recipe(profile) or [])
        if verification != {
            "command": expected_test,
            "result": "passed",
            "test": RECOVERY_TEST,
        }:
            errors.append(
                "recovery build-info.profile_verification must record the passing "
                "zero-MBM runtime test under the same profile features"
            )
    elif verification is not None:
        errors.append("non-recovery build-info.profile_verification must be null")
    if info.get("rfc78_metadata_hash") != RFC78_METADATA_HASH:
        errors.append(
            "build-info.rfc78_metadata_hash must record the canonical enabled "
            "VIT/12 substrate-wasm-builder recipe"
        )
    if info.get("build_environment") != runtime_build_environment():
        errors.append(
            "build-info.build_environment must match the canonical digest-pinned "
            "linux/amd64 OCI environment"
        )
    if info.get("host_triple") != "x86_64-unknown-linux-gnu":
        errors.append(
            "build-info.host_triple must match the canonical linux/amd64 OCI environment"
        )
    if info.get("reproducibility_scope") != RUNTIME_REPRODUCIBILITY_SCOPE:
        errors.append(
            "build-info.reproducibility_scope must state the exact OCI-bound claim"
        )
    try:
        toolchain = runtime_toolchain()
    except (OSError, ProfileError) as error:
        errors.append(f"cannot load canonical runtime toolchain: {error}")
    else:
        if info.get("toolchain") != toolchain:
            errors.append("build-info.toolchain does not match rust-toolchain.toml")
        for key, executable in (("cargo_version", "cargo"), ("rustc_version", "rustc")):
            value = info.get(key)
            if not isinstance(value, str) or not value.startswith(
                f"{executable} {toolchain} "
            ):
                errors.append(
                    f"build-info.{key} does not report the canonical {toolchain} toolchain"
                )
    epoch = info.get("source_date_epoch")
    if not isinstance(epoch, int) or isinstance(epoch, bool) or epoch < 0:
        errors.append("build-info.source_date_epoch must be a non-negative integer")
    elif info.get("normalized_environment") != runtime_normalized_environment(epoch):
        errors.append(
            "build-info.normalized_environment must match the canonical OCI paths and "
            "SOURCE_DATE_EPOCH"
        )
    return errors


def validate_metadata_profile(
    build_info: dict[str, Any], runtime_info: dict[str, Any]
) -> list[str]:
    errors: list[str] = []
    name = build_info.get("runtime_profile")
    try:
        _, profile = select_profile(name if isinstance(name, str) else None)
    except (OSError, json.JSONDecodeError, ProfileError) as error:
        return [f"cannot validate metadata profile: {error}"]
    pallets = runtime_info.get("metadata_pallets")
    if (
        not isinstance(pallets, list)
        or any(not isinstance(pallet, str) or not pallet for pallet in pallets)
        or pallets != sorted(set(pallets))
    ):
        return ["runtime-info.metadata_pallets must be a sorted unique string array"]
    has_sudo = "Sudo" in pallets
    if has_sudo != profile["sudo_in_metadata"]:
        expected = "contain" if profile["sudo_in_metadata"] else "omit"
        errors.append(
            f"runtime metadata must {expected} Sudo for profile {name}; "
            f"metadata {'contains' if has_sudo else 'omits'} it"
        )
    if runtime_info.get("runtime_profile") != name:
        errors.append("runtime-info.runtime_profile does not match build-info")
    digest = runtime_info.get("rfc78_merkleized_metadata_hash")
    if not (
        isinstance(digest, str)
        and len(digest) == 66
        and digest.startswith("0x")
        and all(character in "0123456789abcdef" for character in digest[2:])
    ):
        errors.append(
            "runtime-info.rfc78_merkleized_metadata_hash must be a 0x-prefixed "
            "32-byte lowercase hex digest"
        )
    if runtime_info.get("embedded_rfc78_metadata_hash") != digest:
        errors.append(
            "runtime-info embedded RFC-78 digest must equal the independently "
            "recomputed metadata.scale digest"
        )
    if runtime_info.get("rfc78_status") != RFC78_STATUS:
        errors.append(
            "runtime-info.rfc78_status must record independent metadata.scale "
            "recomputation"
        )
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=profile_manifest_path())
    parser.add_argument("--profile")
    parser.add_argument(
        "--field",
        choices=(
            "name",
            "base",
            "features",
            "recovery",
            "multi_block_migrations",
            "sudo_in_metadata",
            "recipe",
            "recovery_test_recipe",
            "recovery_profile",
            "primary_profile",
            "build_image",
            "build_image_id",
            "build_platform",
            "build_upstream_tag",
            "toolchain",
        ),
    )
    args = parser.parse_args()
    try:
        name, profile = select_profile(args.profile, args.manifest)
    except (OSError, json.JSONDecodeError, ProfileError) as error:
        parser.error(str(error))
    if args.field is None:
        return 0
    values: dict[str, str] = {
        "name": name,
        "base": profile["base"],
        "features": ",".join(profile["cargo_features"]),
        "recovery": str(profile["recovery"]).lower(),
        "multi_block_migrations": profile["multi_block_migrations"],
        "sudo_in_metadata": str(profile["sudo_in_metadata"]).lower(),
        "recipe": " ".join(cargo_recipe(profile)),
        "recovery_test_recipe": " ".join(recovery_test_recipe(profile) or []),
        "recovery_profile": (
            name if profile["recovery"] else profile["recovery_profile"]
        ),
        "primary_profile": (
            profile["primary_profile"] if profile["recovery"] else name
        ),
        "build_image": runtime_build_environment(args.manifest)["image"],
        "build_image_id": runtime_build_environment(args.manifest)["image_id"],
        "build_platform": runtime_build_environment(args.manifest)["platform"],
        "build_upstream_tag": runtime_build_environment(args.manifest)["upstream_tag"],
        "toolchain": runtime_toolchain(),
    }
    print(values[args.field])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
