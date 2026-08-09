#!/usr/bin/env python3
"""Bind SIGNERS.md to the registry the verification code actually reads (F13).

12 §2.2 point 1 requires a signer registry by name: ``SIGNERS.md`` in-repo, mirrored
on Arweave, listing every active minisign key id, every ANT controller address and
every attestor key, each mapped to a stable operator identifier. Point 2 then makes
CI check mechanically that no operator appears in both populations.

The mapping is what makes point 2 mean anything. Disjointness is evaluated over
**natural persons**, and a checker intersecting key identifiers would pass
unconditionally and forever, because a minisign key id is never also an Arweave
address. So the human document is an input to the check rather than a rendering of
it, and this gate exists because two renderings of one artifact drift.

**Bidirectional, like every other binding in this repository.** A checker that only
walked the document would pass a document that quietly dropped a key. A checker that
only walked the JSON would pass a document that invented a person. Those are
different failures: the first is a key nobody published, the second is a person no
check can see.

**Empty is reported as empty, never as clean.** Disjointness between an empty set and
anything holds by construction, and holding for want of members is a different claim
from holding by separation. The word this gate prints in that state is ``unseated``,
never a separation verdict, and ``--strict`` refuses it outright.

**What it checks when the registry is empty**, which is today and which is the state a
vacuous gate would be indistinguishable in:

1. the population identifiers the document declares equal the populations
   ``registry.ts`` declares;
2. the entry fields ``signers.json`` documents equal the fields ``registry.ts``
   accepts, so a field can neither be documented and unread nor read and undocumented;
3. the floors the document states equal the constants the counting code reads;
4. the disjointness pairs the document states equal the pairs ``registry.ts``
   enforces;
5. the seated count the document declares per population equals the JSON's, and
   ``UNSEATED`` means exactly zero;
6. both files declare the phase gate that says why they are empty, because emptiness
   with no declared reason is a registry somebody emptied.

Every extraction fails closed. A pattern that matches nothing raises, rather than
comparing two empty sets and reporting agreement.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DOC = Path("SIGNERS.md")
DEFAULT_JSON = Path("app/tools/release/sources/signers.json")
DEFAULT_REGISTRY_TS = Path("app/tools/verify-release/registry.ts")
DEFAULT_VERDICT_TS = Path("app/tools/verify-release/verdict.ts")

UNSEATED = "UNSEATED"
SEATED = "SEATED"

POPULATION_HEADER = ("Role", "Identifier", "What it is", "Seated", "State")
DISJOINT_HEADER = ("Population", "Must not overlap", "Why")
FLOOR_HEADER = ("Rule", "Value", "Where the number lives")
REGISTRY_HEADER = (
    "Person",
    "Organization",
    "Role",
    "Key identifier",
    "Keyring generation",
    "Revocation index",
)

REQUIRED_SECTIONS = (
    "How this file is checked",
    "Populations",
    "Disjointness",
    "Counted floors",
    "Registry",
    "Key ceremony",
    "The declared residual",
)

SIGNATURE_FLOOR_ROW = "Release signatures"
ATTESTATION_FLOOR_ROW = "Attestations"
QUORUM_ROW = "ArNS controller quorum"

INLINE_LINK_RE = re.compile(r"(?<!!)\[([^\]]+)\]\([^)]*\)")
SEPARATOR_RE = re.compile(r"^:?-{3,}:?$")
QUORUM_VALUE_RE = re.compile(r"^(\d+)-of-(\d+)$")


class CheckError(Exception):
    """A failure that names its own remedy. Never a bare assertion."""


@dataclass(frozen=True)
class DeclaredPopulation:
    role: str
    identifier: str
    seated: int
    state: str
    line: int


@dataclass(frozen=True)
class DeclaredEntry:
    person: str
    organization: str
    role: str
    identifier: str
    generation: str
    revocation_index: str
    line: int


@dataclass(frozen=True)
class CodeFacts:
    """What the verification code declares, read from the code and never restated."""

    populations: tuple[str, ...]
    keyed_populations: tuple[str, ...]
    entry_keys: tuple[str, ...]
    disjoint_pairs: tuple[tuple[str, str], ...]
    signature_floor: int
    attestation_floor: int
    quorum_threshold: int
    quorum_seats: int


# Reading the document ---------------------------------------------------------
def strip_markdown(cell: str) -> str:
    """Reduce a table cell to its plain text without rewriting the text itself."""
    previous = ""
    value = cell
    while previous != value:
        previous = value
        value = INLINE_LINK_RE.sub(r"\1", value)
    value = re.sub(r"\*\*([^*]+)\*\*", r"\1", value)
    value = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"\1", value)
    return value.replace("`", "").strip()


def table_cells(line: str) -> list[str] | None:
    """Split a Markdown table row into stripped cells, or return None."""
    if not line.lstrip().startswith("|"):
        return None
    return [strip_markdown(cell) for cell in line.strip().strip("|").split("|")]


def sections(lines: list[str]) -> dict[str, tuple[int, int]]:
    """Map every ``## `` heading to the half-open line range of its body."""
    starts: list[tuple[str, int]] = []
    for index, line in enumerate(lines):
        if line.startswith("## "):
            starts.append((line[3:].strip(), index))
    found: dict[str, tuple[int, int]] = {}
    for position, (name, index) in enumerate(starts):
        end = starts[position + 1][1] if position + 1 < len(starts) else len(lines)
        if name in found:
            raise CheckError(f"SIGNERS.md declares the section {name!r} twice")
        found[name] = (index + 1, end)
    return found


def read_table(
    lines: list[str], bounds: tuple[int, int], header: tuple[str, ...], what: str
) -> list[tuple[list[str], int]]:
    """Return the data rows of the one table in ``bounds`` carrying ``header``.

    Anchored on the exact header, so a table that gained or lost a column is a
    failure rather than a silently different reading. Zero data rows is a legal
    result and is the caller's to interpret: this gate's whole point is that an
    empty registry is a state, not an absence.
    """
    start, end = bounds
    positions = [
        index
        for index in range(start, end)
        if table_cells(lines[index]) == list(header)
    ]
    if len(positions) != 1:
        raise CheckError(
            f"found {len(positions)} tables headed {' | '.join(header)} in {what}; "
            "expected exactly one"
        )
    head = positions[0]
    separator = table_cells(lines[head + 1]) if head + 1 < end else None
    if separator is None or not all(SEPARATOR_RE.match(cell) for cell in separator):
        raise CheckError(f"the {what} table has no separator row under its header")
    rows: list[tuple[list[str], int]] = []
    for index in range(head + 2, end):
        cells = table_cells(lines[index])
        if cells is None:
            break
        if len(cells) != len(header):
            raise CheckError(
                f"{what} line {index + 1}: {len(cells)} cells against a "
                f"{len(header)}-column header"
            )
        rows.append((cells, index + 1))
    return rows


def parse_populations(lines: list[str], bounds: tuple[int, int]) -> list[DeclaredPopulation]:
    declared: list[DeclaredPopulation] = []
    for cells, line in read_table(lines, bounds, POPULATION_HEADER, "Populations"):
        role, identifier, _what, seated, state = cells
        if not role or not identifier:
            raise CheckError(f"SIGNERS.md line {line}: a population row names no role or identifier")
        if not seated.isdigit():
            raise CheckError(f"SIGNERS.md line {line}: seated count {seated!r} is not a count")
        if state not in {SEATED, UNSEATED}:
            raise CheckError(
                f"SIGNERS.md line {line}: state {state!r} must be {SEATED} or {UNSEATED}. "
                "A blank state reads as neither, and 12 §2.2 needs the empty case declared."
            )
        declared.append(DeclaredPopulation(role, identifier, int(seated), state, line))
    if not declared:
        raise CheckError("SIGNERS.md declares no populations at all")
    return declared


def parse_registry_rows(lines: list[str], bounds: tuple[int, int]) -> list[DeclaredEntry]:
    rows: list[DeclaredEntry] = []
    for cells, line in read_table(lines, bounds, REGISTRY_HEADER, "Registry"):
        person, organization, role, identifier, generation, revocation = cells
        for name, value in (("Person", person), ("Organization", organization), ("Role", role), ("Key identifier", identifier)):
            if not value:
                raise CheckError(
                    f"SIGNERS.md line {line}: the {name} cell is empty. 12 §2.2 point 1 maps "
                    "every key to a named holder, and a blank cell is a key the check cannot see."
                )
        rows.append(DeclaredEntry(person, organization, role, identifier, generation, revocation, line))
    return rows


def parse_floors(lines: list[str], bounds: tuple[int, int]) -> dict[str, str]:
    floors: dict[str, str] = {}
    for cells, line in read_table(lines, bounds, FLOOR_HEADER, "Counted floors"):
        rule, value, _where = cells
        if rule in floors:
            raise CheckError(f"SIGNERS.md line {line}: the floor {rule!r} is stated twice")
        floors[rule] = value
    return floors


def parse_disjoint(lines: list[str], bounds: tuple[int, int]) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for cells, line in read_table(lines, bounds, DISJOINT_HEADER, "Disjointness"):
        first, second, why = cells
        if not why:
            raise CheckError(
                f"SIGNERS.md line {line}: the pair states no reason. A reviewer meeting this "
                "check needs why the overlap matters, not that two roles overlap."
            )
        pairs.append((first, second))
    return pairs


# Reading the code -------------------------------------------------------------
def quoted_list(text: str, pattern: str, what: str) -> tuple[str, ...]:
    """Extract the single-quoted strings of one declaration, failing on no match."""
    match = re.search(pattern, text, re.DOTALL)
    if match is None:
        raise CheckError(
            f"cannot find {what} in the verification code. This gate compares the document "
            "against that declaration, so a missing one makes the comparison vacuous."
        )
    values = re.findall(r"'([^']+)'", match.group(1))
    if not values:
        raise CheckError(f"{what} declares no values")
    return tuple(values)


def read_code_facts(registry_ts: Path, verdict_ts: Path) -> CodeFacts:
    registry = registry_ts.read_text(encoding="utf-8")
    verdict = verdict_ts.read_text(encoding="utf-8")

    populations = quoted_list(
        registry,
        r"export const POPULATIONS = Object\.freeze\((.*?)as const\);",
        "POPULATIONS",
    )
    keyed = quoted_list(
        registry,
        r"export const KEYED_POPULATIONS[^=]*= Object\.freeze\((.*?)as const\);",
        "KEYED_POPULATIONS",
    )
    entry_keys = quoted_list(
        registry,
        r"const ENTRY_KEYS = Object\.freeze\((.*?)\);",
        "ENTRY_KEYS",
    )

    block = re.search(
        r"export const DISJOINT_PAIRS[^=]*=\s*Object\.freeze\(\[(.*?)\n\]\);",
        registry,
        re.DOTALL,
    )
    if block is None:
        raise CheckError("cannot find DISJOINT_PAIRS in registry.ts")
    pairs = tuple(
        (first, second)
        for first, second in re.findall(
            r"a:\s*'([^']+)',\s*\n\s*b:\s*'([^']+)',", block.group(1)
        )
    )
    if not pairs:
        raise CheckError("DISJOINT_PAIRS declares no pairs")

    signature = read_int(verdict, r"export const SIGNATURE_FLOOR = (\d+);", "SIGNATURE_FLOOR")
    attestation = read_int(verdict, r"export const ATTESTATION_FLOOR = (\d+);", "ATTESTATION_FLOOR")

    quorum = re.search(
        r"export function checkControllerQuorum\((.*?)\)\s*:", registry, re.DOTALL
    )
    if quorum is None:
        raise CheckError("cannot find checkControllerQuorum in registry.ts")
    threshold = read_int(quorum.group(1), r"threshold\s*=\s*(\d+)", "the quorum threshold")
    seats = read_int(quorum.group(1), r"seats\s*=\s*(\d+)", "the quorum seat count")

    return CodeFacts(
        populations=populations,
        keyed_populations=keyed,
        entry_keys=entry_keys,
        disjoint_pairs=pairs,
        signature_floor=signature,
        attestation_floor=attestation,
        quorum_threshold=threshold,
        quorum_seats=seats,
    )


def read_int(text: str, pattern: str, what: str) -> int:
    match = re.search(pattern, text)
    if match is None:
        raise CheckError(f"cannot read {what} from the verification code")
    return int(match.group(1))


# Reading the machine-readable registry ----------------------------------------
@dataclass(frozen=True)
class JsonRegistry:
    entries: tuple[dict[str, object], ...]
    entry_schema: tuple[str, ...]
    phase_gate: str | None


def read_json_registry(path: Path) -> JsonRegistry:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise CheckError(f"cannot read {path}: {error}") from error
    if not isinstance(document, dict):
        raise CheckError(f"{path} is not a JSON object")
    entries = document.get("entries")
    if not isinstance(entries, list) or not all(isinstance(row, dict) for row in entries):
        raise CheckError(f"{path} has no `entries` list")
    schema = document.get("_entry_schema")
    if not isinstance(schema, dict) or not schema:
        raise CheckError(
            f"{path} documents no `_entry_schema`. The schema is what binds the document's "
            "columns to the fields the parser accepts."
        )
    gate = document.get("_phase_gate")
    return JsonRegistry(
        entries=tuple(entries),
        entry_schema=tuple(schema),
        phase_gate=gate if isinstance(gate, str) and gate.strip() else None,
    )


# The comparison ---------------------------------------------------------------
def cell_for(value: object) -> str:
    """Render a JSON field the way the document must state it."""
    if value is None:
        return ""
    return str(value)


def check(
    doc_path: Path,
    json_path: Path,
    registry_ts: Path,
    verdict_ts: Path,
    strict: bool,
) -> list[str]:
    """Return the failures. An empty list means the bindings hold."""
    failures: list[str] = []
    lines = doc_path.read_text(encoding="utf-8").splitlines()
    found = sections(lines)
    missing = [name for name in REQUIRED_SECTIONS if name not in found]
    if missing:
        raise CheckError(
            f"SIGNERS.md has no section(s) {', '.join(missing)}. The shape is fixed because "
            "this gate reads it, and because a ceremony nobody wrote down is not a ceremony."
        )

    code = read_code_facts(registry_ts, verdict_ts)
    registry = read_json_registry(json_path)
    populations = parse_populations(lines, found["Populations"])
    rows = parse_registry_rows(lines, found["Registry"])
    floors = parse_floors(lines, found["Counted floors"])
    pairs = parse_disjoint(lines, found["Disjointness"])

    # 1. The vocabulary. Both directions: a population the code enforces and the
    #    document omits is a population nobody can read about, and one the document
    #    invents is a role no check applies to.
    declared_ids = [population.identifier for population in populations]
    if sorted(declared_ids) != sorted(code.populations):
        failures.append(
            f"SIGNERS.md declares populations {sorted(declared_ids)} and registry.ts "
            f"declares {sorted(code.populations)}"
        )
    if len(set(declared_ids)) != len(declared_ids):
        failures.append("SIGNERS.md lists a population identifier twice")
    roles = {population.role: population.identifier for population in populations}
    if len(roles) != len(populations):
        failures.append("SIGNERS.md gives two populations the same role name")

    # 2. The entry schema, so a field cannot be documented and unread, or read and
    #    undocumented. A misspelled field name is otherwise a silently absent one.
    if sorted(registry.entry_schema) != sorted(code.entry_keys):
        failures.append(
            f"signers.json documents fields {sorted(registry.entry_schema)} and registry.ts "
            f"accepts {sorted(code.entry_keys)}"
        )

    # 3. The floors, read from the code that counts them.
    failures.extend(check_floors(floors, code))

    # 4. The disjointness pairs.
    if list(pairs) != list(code.disjoint_pairs):
        failures.append(
            f"SIGNERS.md states disjoint pairs {pairs} and registry.ts enforces "
            f"{code.disjoint_pairs}"
        )

    # 5 and 6. The registry itself, both directions.
    failures.extend(check_rows(rows, registry, roles, code))
    failures.extend(check_seating(populations, registry, roles))

    unseated = [population for population in populations if population.state == UNSEATED]
    if unseated and registry.phase_gate is None:
        failures.append(
            "every population is unseated and signers.json declares no `_phase_gate`. "
            "Emptiness with no stated reason is a registry somebody emptied, and this gate "
            "cannot tell the two apart."
        )
    return failures


def check_floors(floors: dict[str, str], code: CodeFacts) -> list[str]:
    failures: list[str] = []
    expected = {
        SIGNATURE_FLOOR_ROW: str(code.signature_floor),
        ATTESTATION_FLOOR_ROW: str(code.attestation_floor),
        QUORUM_ROW: f"{code.quorum_threshold}-of-{code.quorum_seats}",
    }
    for rule, value in expected.items():
        stated = floors.get(rule)
        if stated is None:
            failures.append(f"SIGNERS.md states no floor for {rule!r}")
        elif stated != value:
            failures.append(
                f"SIGNERS.md states {rule!r} as {stated!r} and the counting code reads {value!r}"
            )
    for rule in floors:
        if rule not in expected:
            failures.append(
                f"SIGNERS.md states a floor {rule!r} that no counting code reads. A number "
                "stated here and nowhere else is a claim nothing enforces."
            )
    if QUORUM_ROW in floors and QUORUM_VALUE_RE.match(floors[QUORUM_ROW]) is None:
        failures.append(f"the {QUORUM_ROW} value must read <threshold>-of-<seats>")
    return failures


def check_rows(
    rows: list[DeclaredEntry],
    registry: JsonRegistry,
    roles: dict[str, str],
    code: CodeFacts,
) -> list[str]:
    """Bind every document row to one JSON entry, and every entry back to a row."""
    failures: list[str] = []
    by_key: dict[tuple[str, str], dict[str, object]] = {}
    for entry in registry.entries:
        population = entry.get("population")
        identifier = entry.get("id")
        if not isinstance(population, str) or not isinstance(identifier, str):
            failures.append(f"signers.json carries an entry with no id or population: {entry}")
            continue
        key = (population, identifier)
        if key in by_key:
            failures.append(f"signers.json lists {identifier} twice in {population}")
        by_key[key] = entry

    matched: set[tuple[str, str]] = set()
    for row in rows:
        population = roles.get(row.role)
        if population is None:
            failures.append(
                f"SIGNERS.md line {row.line}: role {row.role!r} is not one of the roles the "
                "Populations table declares"
            )
            continue
        key = (population, row.identifier)
        entry = by_key.get(key)
        if entry is None:
            failures.append(
                f"SIGNERS.md line {row.line}: {row.identifier} is published here as a "
                f"{row.role} and signers.json carries no such entry, so no check sees it"
            )
            continue
        matched.add(key)
        failures.extend(compare_row(row, entry, population, code))

    for key, entry in by_key.items():
        if key in matched:
            continue
        failures.append(
            f"signers.json carries {key[1]} in {key[0]} and SIGNERS.md publishes no row for "
            "it. 12 §2.2 point 1 requires the registry to be published, not only stored."
        )
    return failures


def compare_row(
    row: DeclaredEntry,
    entry: dict[str, object],
    population: str,
    code: CodeFacts,
) -> list[str]:
    failures: list[str] = []
    for column, field, stated in (
        ("Person", "operator", row.person),
        ("Organization", "organization", row.organization),
        ("Keyring generation", "generation", row.generation),
        ("Revocation index", "revocationIndex", row.revocation_index),
    ):
        actual = cell_for(entry.get(field))
        if stated != actual:
            failures.append(
                f"SIGNERS.md line {row.line}: {column} reads {stated!r} and signers.json "
                f"reads {actual!r} for {row.identifier}"
            )
    keyed = population in code.keyed_populations
    for column, stated in (("Keyring generation", row.generation), ("Revocation index", row.revocation_index)):
        if keyed and not stated:
            failures.append(
                f"SIGNERS.md line {row.line}: {row.identifier} is a minisign key and states no "
                f"{column}. 12 §2.3 revokes a key by its index, so a key without one cannot be revoked."
            )
        if not keyed and stated:
            failures.append(
                f"SIGNERS.md line {row.line}: {row.identifier} is not a minisign key and states a "
                f"{column}. 12 §2.1 gives a keyring generation to minisign keys only."
            )
    return failures


def check_seating(
    populations: list[DeclaredPopulation],
    registry: JsonRegistry,
    roles: dict[str, str],
) -> list[str]:
    """The count and the word must both match the JSON.

    This is the check that stays non-vacuous at zero entries, and it is the one an
    empty registry needs most: the document must *say* which populations are unseated,
    and saying it is what makes the emptiness a declaration rather than an omission.
    """
    failures: list[str] = []
    counted: dict[str, int] = {identifier: 0 for identifier in roles.values()}
    for entry in registry.entries:
        population = entry.get("population")
        if isinstance(population, str) and population in counted:
            counted[population] += 1
    for population in populations:
        actual = counted.get(population.identifier, 0)
        if population.seated != actual:
            failures.append(
                f"SIGNERS.md line {population.line}: {population.identifier} declares "
                f"{population.seated} seated and signers.json carries {actual}"
            )
        expected_state = UNSEATED if actual == 0 else SEATED
        if population.state != expected_state:
            failures.append(
                f"SIGNERS.md line {population.line}: {population.identifier} is marked "
                f"{population.state} and carries {actual} entr(y|ies). Disjointness for want "
                "of members is a different claim from disjointness by separation."
            )
    return failures


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--doc", type=Path, default=ROOT / DEFAULT_DOC)
    parser.add_argument("--registry", type=Path, default=ROOT / DEFAULT_JSON)
    parser.add_argument("--registry-ts", type=Path, default=ROOT / DEFAULT_REGISTRY_TS)
    parser.add_argument("--verdict-ts", type=Path, default=ROOT / DEFAULT_VERDICT_TS)
    parser.add_argument(
        "--strict",
        action="store_true",
        help="refuse an unseated population; what a release gate runs",
    )
    args = parser.parse_args(argv)

    try:
        failures = check(args.doc, args.registry, args.registry_ts, args.verdict_ts, args.strict)
    except CheckError as error:
        print(f"SIGNERS: {error}", file=sys.stderr)
        return 1

    for failure in failures:
        print(f"SIGNERS: {failure}", file=sys.stderr)
    if failures:
        return 1

    lines = args.doc.read_text(encoding="utf-8").splitlines()
    populations = parse_populations(lines, sections(lines)["Populations"])
    unseated = [population.identifier for population in populations if population.state == UNSEATED]
    seated = sum(population.seated for population in populations)
    if unseated:
        # Never a separation verdict. Reporting this state as clean is the exact
        # failure 12 §2.2's own wording guards against.
        print(f"unseated: {', '.join(unseated)} — {len(unseated)} population(s) declare nobody")
        if strict_refusal(args.strict):
            print(
                "--strict: a release may not rest on a separation that holds for want of members",
                file=sys.stderr,
            )
            return 1
        return 0
    print(f"SIGNERS.md and signers.json agree over {seated} declared identit(y|ies)")
    return 0


def strict_refusal(strict: bool) -> bool:
    return strict


if __name__ == "__main__":
    raise SystemExit(main())
