"""12 §2.3, §3.1–§3.2 against 02 §12 — stranded-app reads and revocation.

Doc 12 claims that the frozen ``ReleaseChannel`` prefix lets every shipped app,
including a pinned or stranded one, learn update and security state without
current metadata.  Its three old-app rules are executable here as
``ChannelRecord × AppState → ReaderVerdict``.  A rejected prefix or a mask whose
keyring generation the app does not ship yields an explicit degraded verdict;
it never establishes either "no newer release" or "no security flag" and it
refuses signing in the unsafe, false-negative direction.

Executing the revocation procedure exposes SQ-551.  Section 2.3 says to bump
the generation and set the compromised key's index, while 02 §12 defines the
8-byte mask over indices *within the resulting generation*.  The bit therefore
addresses the replacement generation, not the compromised historical key.  A
historical revocation persists only if every later keyring re-lists that key and
sets its bit.  No document requires that, and doing it caps all simultaneously
remembered key identities at ``8 bytes × 8 bits = 64``.

Units are bytes, bits, key indices, and semantic versions.  All arithmetic is
exact integer arithmetic; there is no fractional rounding.  Rejection and an
unknown signing state round against the claimant: accepting a release while a
revocation cannot be interpreted is the unsafe direction (R-7).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, replace
from enum import Enum
from functools import total_ordering

# 02 §12: the frozen v1 prefix and the generation-local revocation field.
RELEASE_CHANNEL_PREFIX_BYTES = 168
REVOCATION_MASK_BYTES = 8
BITS_PER_BYTE = 8
REVOCATION_INDEX_CAPACITY = REVOCATION_MASK_BYTES * BITS_PER_BYTE

# 02 §12 offset 164: the only defined flag bits; 3–31 remain zero forever.
SECURITY = 1 << 0
EXPEDITED = 1 << 1
URGENT_UPGRADE = 1 << 2
KNOWN_FLAGS = SECURITY | EXPEDITED | URGENT_UPGRADE

U8_MAX = (1 << 8) - 1
U32_MAX = (1 << 32) - 1
U64_MAX = (1 << 64) - 1

_TXID = re.compile(r"^[A-Za-z0-9_-]{43}$")
_SEMVER = re.compile(
    r"^(0|[1-9][0-9]*)\."
    r"(0|[1-9][0-9]*)\."
    r"(0|[1-9][0-9]*)"
    r"(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)"
    r"(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)


class ChannelError(ValueError):
    """A record or app state that cannot be interpreted refuses."""


@total_ordering
@dataclass(frozen=True)
class SemVer:
    """SemVer precedence for the fixed-width version fields in 02 §12."""

    major: int
    minor: int
    patch: int
    prerelease: tuple[str, ...] = ()

    @classmethod
    def parse(cls, value: str) -> "SemVer":
        match = _SEMVER.fullmatch(value)
        if match is None:
            raise ChannelError(f"invalid semantic version {value!r}")
        prerelease = tuple(match.group(4).split(".")) if match.group(4) else ()
        return cls(int(match.group(1)), int(match.group(2)), int(match.group(3)), prerelease)

    def __lt__(self, other: object) -> bool:
        if not isinstance(other, SemVer):
            return NotImplemented
        own_core = (self.major, self.minor, self.patch)
        other_core = (other.major, other.minor, other.patch)
        if own_core != other_core:
            return own_core < other_core
        if not self.prerelease:
            return False
        if not other.prerelease:
            return True
        for own, theirs in zip(self.prerelease, other.prerelease):
            if own == theirs:
                continue
            own_numeric, their_numeric = own.isdigit(), theirs.isdigit()
            if own_numeric and their_numeric:
                return int(own) < int(theirs)
            if own_numeric != their_numeric:
                return own_numeric
            return own < theirs
        return len(self.prerelease) < len(other.prerelease)


@dataclass(frozen=True)
class Keyring:
    """One §2.1 keyring; tuple position is its 02 §12 revocation index."""

    generation: int
    key_ids: tuple[str, ...]

    def validation_error(self) -> str | None:
        if not 0 <= self.generation <= U32_MAX:
            return f"keyring generation {self.generation} does not fit u32"
        if len(self.key_ids) > REVOCATION_INDEX_CAPACITY:
            return (
                f"keyring has {len(self.key_ids)} keys but the mask carries only "
                f"{REVOCATION_INDEX_CAPACITY} indices"
            )
        if len(set(self.key_ids)) != len(self.key_ids):
            return "keyring key IDs are not unique"
        if any(not key_id for key_id in self.key_ids):
            return "keyring contains an empty key ID"
        return None

    def revoked_key_ids(self, mask: int) -> frozenset[str]:
        error = self.validation_error()
        if error is not None:
            raise ChannelError(error)
        if not 0 <= mask <= U64_MAX:
            raise ChannelError(f"revocation mask {mask} does not fit u64")
        return frozenset(
            key_id for index, key_id in enumerate(self.key_ids) if mask & (1 << index)
        )


@dataclass(frozen=True)
class ChannelRecord:
    """The fields needed from 02 §12's frozen prefix, before reader judgment."""

    version: str
    manifest_txid: str
    min_supported_version: str
    keyring_generation: int
    revoked_key_bits: int
    flags: int = 0
    schema: int = 1
    byte_length: int = RELEASE_CHANNEL_PREFIX_BYTES
    release_json_hash: bytes = bytes(32)
    updated_at: int = 0
    spec_version: int = 0
    pending_authorized_at: int = 0

    def validation_error(self) -> str | None:
        """Why the frozen prefix is uninterpretable under 02 §12 / 12 §3.1."""
        if self.byte_length < RELEASE_CHANNEL_PREFIX_BYTES:
            return (
                f"truncated ReleaseChannel: {self.byte_length} bytes, need "
                f"{RELEASE_CHANNEL_PREFIX_BYTES}"
            )
        # 02 §12 says schema 1 is current and a different schema leaves this
        # append-only prefix valid. Zero is not a later schema generation.
        if not 1 <= self.schema <= U8_MAX:
            return f"schema {self.schema} is not current or a future u8 schema"
        for name, value in (
            ("updated_at", self.updated_at),
            ("spec_version", self.spec_version),
            ("pending_authorized_at", self.pending_authorized_at),
            ("keyring_generation", self.keyring_generation),
            ("flags", self.flags),
        ):
            if not 0 <= value <= U32_MAX:
                return f"{name} {value} does not fit u32"
        if not 0 <= self.revoked_key_bits <= U64_MAX:
            return f"revoked_key_bits {self.revoked_key_bits} does not fit u64"
        if self.flags & ~KNOWN_FLAGS:
            return "reserved ReleaseChannel flag bits are non-zero"
        if len(self.release_json_hash) != 32:
            return "release_json_hash is not 32 bytes"
        if _TXID.fullmatch(self.manifest_txid) is None:
            return "manifest_txid is not a 43-byte base64url identifier"
        for name, value in (
            ("version", self.version),
            ("min_supported_version", self.min_supported_version),
        ):
            if len(value.encode("utf-8")) > 32:
                return f"{name} does not fit its 32-byte field"
            try:
                SemVer.parse(value)
            except ChannelError as error:
                return str(error)
        return None


@dataclass(frozen=True)
class AppState:
    """Immutable release identity plus the keyrings this app actually ships."""

    own_version: str
    own_manifest_txid: str
    own_generation: int
    own_key_indices: frozenset[int]
    shipped_keyrings: tuple[Keyring, ...]
    warning_acknowledged: bool = False

    def keyring(self, generation: int) -> Keyring | None:
        return next(
            (ring for ring in self.shipped_keyrings if ring.generation == generation),
            None,
        )

    def validation_error(self) -> str | None:
        try:
            SemVer.parse(self.own_version)
        except ChannelError as error:
            return str(error)
        if _TXID.fullmatch(self.own_manifest_txid) is None:
            return "own manifest TXID is not a 43-byte base64url identifier"
        generations = [ring.generation for ring in self.shipped_keyrings]
        if len(set(generations)) != len(generations):
            return "app ships duplicate keyring generations"
        for ring in self.shipped_keyrings:
            error = ring.validation_error()
            if error is not None:
                return error
        own_ring = self.keyring(self.own_generation)
        if own_ring is None:
            return f"app does not ship its own generation {self.own_generation} keyring"
        if any(index < 0 or index >= len(own_ring.key_ids) for index in self.own_key_indices):
            return "own signing-key index is outside the app's own keyring"
        return None

    def own_key_ids(self) -> frozenset[str]:
        error = self.validation_error()
        if error is not None:
            raise ChannelError(error)
        own_ring = self.keyring(self.own_generation)
        assert own_ring is not None
        return frozenset(own_ring.key_ids[index] for index in self.own_key_indices)


class Banner(str, Enum):
    NONE = "none"
    NEWER_RELEASE = "newer canonical release exists"
    BLOCKING = "minimum supported version"
    SECURITY = "security"
    DEGRADED = "degraded/unknown"


@dataclass(frozen=True)
class ReaderVerdict:
    """One rendering and signing decision under 12 §3.1–§3.2."""

    banner: Banner
    blocking: bool
    signing_enabled: bool
    requires_acknowledgment: bool
    degraded_reason: str | None
    newer_release_exists: bool | None
    security_flag_set: bool | None
    revoked_own_key_ids: frozenset[str] = frozenset()

    @property
    def interpreted(self) -> bool:
        return self.degraded_reason is None

    @property
    def healthy(self) -> bool:
        """A genuinely established clean state, never an absence of evidence."""
        return (
            self.interpreted
            and self.banner is Banner.NONE
            and self.signing_enabled
            and self.newer_release_exists is False
            and self.security_flag_set is False
        )


def _degraded(reason: str) -> ReaderVerdict:
    """12 §3.1's explicit unknown state, fail-closed for signing (R-7)."""
    return ReaderVerdict(
        banner=Banner.DEGRADED,
        blocking=True,
        signing_enabled=False,
        requires_acknowledgment=False,
        degraded_reason=reason,
        newer_release_exists=None,
        security_flag_set=None,
    )


def read_channel(record: ChannelRecord, app: AppState) -> ReaderVerdict:
    """Apply 12 §3.1's reader discipline and §3.2's three rules in order."""
    error = record.validation_error() or app.validation_error()
    if error is not None:
        return _degraded(error)
    current_ring = app.keyring(record.keyring_generation)
    if current_ring is None:
        return _degraded(
            f"app does not ship ReleaseChannel keyring generation "
            f"{record.keyring_generation}"
        )

    own_version = SemVer.parse(app.own_version)
    channel_version = SemVer.parse(record.version)
    minimum = SemVer.parse(record.min_supported_version)
    newer = channel_version > own_version and record.manifest_txid != app.own_manifest_txid
    below_minimum = own_version < minimum
    security = bool(record.flags & SECURITY)
    revoked = current_ring.revoked_key_ids(record.revoked_key_bits)
    revoked_own = app.own_key_ids() & revoked
    security_applies = security and (bool(revoked_own) or below_minimum)

    if security_applies:
        banner = Banner.SECURITY
    elif below_minimum:
        banner = Banner.BLOCKING
    elif newer:
        banner = Banner.NEWER_RELEASE
    else:
        banner = Banner.NONE

    needs_ack = below_minimum and not security_applies
    signing_enabled = not security_applies and (
        not below_minimum or app.warning_acknowledged
    )
    return ReaderVerdict(
        banner=banner,
        blocking=security_applies or below_minimum,
        signing_enabled=signing_enabled,
        requires_acknowledgment=needs_ack,
        degraded_reason=None,
        newer_release_exists=newer,
        security_flag_set=security,
        revoked_own_key_ids=revoked_own,
    )


def documented_revocation(record: ChannelRecord, compromised_index: int) -> ChannelRecord:
    """12 §2.3 step 1 literally: bump generation, then set the old index.

    This is deliberately not repaired here.  Under 02 §12 the returned bit is
    interpreted in the *new* generation, which is the SQ-551 contradiction.
    """
    if not 0 <= compromised_index < REVOCATION_INDEX_CAPACITY:
        raise ChannelError(
            f"compromised key index {compromised_index} outside "
            f"0..{REVOCATION_INDEX_CAPACITY - 1}"
        )
    if record.keyring_generation >= U32_MAX:
        raise ChannelError("keyring generation cannot be bumped beyond u32")
    return replace(
        record,
        keyring_generation=record.keyring_generation + 1,
        revoked_key_bits=record.revoked_key_bits | (1 << compromised_index),
        flags=record.flags | SECURITY,
    )


def key_refused(
    record: ChannelRecord, key_id: str, published_keyrings: tuple[Keyring, ...]
) -> bool | None:
    """Whether the one generation-local mask refuses ``key_id``.

    ``None`` means the addressed keyring is unavailable and no claim can be
    made.  ``False`` for an older key is the load-bearing result: a known
    current keyring proves the mask addresses other identities.
    """
    error = record.validation_error()
    if error is not None:
        return None
    ring = next(
        (item for item in published_keyrings if item.generation == record.keyring_generation),
        None,
    )
    if ring is None or ring.validation_error() is not None:
        return None
    return key_id in ring.revoked_key_ids(record.revoked_key_bits)


@dataclass(frozen=True)
class RevocationObservation:
    generation: int
    refused: bool | None


@dataclass(frozen=True)
class RevocationFinding:
    key: str
    ok: bool
    detail: str


def check_revocation_persistence(
    key_id: str,
    records: tuple[ChannelRecord, ...],
    published_keyrings: tuple[Keyring, ...],
) -> tuple[RevocationFinding, ...]:
    """Make 12 §1.3's historical-refusal MUST a queryable SQ-551 finding."""
    observations = tuple(
        RevocationObservation(
            record.keyring_generation,
            key_refused(record, key_id, published_keyrings),
        )
        for record in records
    )
    bad = tuple(item for item in observations if item.refused is not True)
    rendered = ", ".join(
        f"generation {item.generation}: {item.refused!r}" for item in observations
    )
    return (
        RevocationFinding(
            "revoked key remains refused across later generations",
            not bad,
            rendered,
        ),
    )

