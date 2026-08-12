"""Independent RFC-78 digest computation shared by release tools."""

from __future__ import annotations

import subprocess
from pathlib import Path

from release_common import repo_root


def metadata_hash(metadata_path: Path, token_symbol: str, token_decimals: int) -> str:
    result = subprocess.run(
        [
            "node",
            str(repo_root() / "app/tools/release/rfc78-hash.ts"),
            str(metadata_path),
            token_symbol,
            str(token_decimals),
        ],
        cwd=repo_root(),
        check=True,
        capture_output=True,
        text=True,
    )
    digest = result.stdout.strip()
    if not (
        len(digest) == 66
        and digest.startswith("0x")
        and all(character in "0123456789abcdef" for character in digest[2:])
    ):
        raise RuntimeError("RFC-78 helper did not return one 32-byte lowercase hex digest")
    return digest
