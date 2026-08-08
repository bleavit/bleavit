"""Mutation tests for the F13 signer-registry gate.

Every binding this checker declares is bidirectional, and each direction is a
different failure: a key published in the JSON and absent from the document is a
key nobody can read about, while a person written into the document with no JSON
entry is a person no check can see.

A suite that only proved the checker passes on the committed files would prove
nothing about either, and it would prove least of all about the state the files
are actually in. Today every population is unseated, so a checker with all of its
comparisons deleted would still print the same line. Each case below therefore
breaks exactly one thing and requires the message that must appear — including at
zero entries, which is what makes this gate non-vacuous now rather than after a
ceremony.
"""

import importlib.util
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "check-signers.py"
REPO = Path(__file__).resolve().parents[3]
MODULE_SPEC = importlib.util.spec_from_file_location("check_signers", SCRIPT)
if MODULE_SPEC is None or MODULE_SPEC.loader is None:
    raise RuntimeError("signers checker module must be importable")
checker = importlib.util.module_from_spec(MODULE_SPEC)
sys.modules[MODULE_SPEC.name] = checker
MODULE_SPEC.loader.exec_module(checker)


REGISTRY_TS = """
export const POPULATIONS = Object.freeze([
  'release-signer',
  'arns-controller',
  'monitor-operator',
  'attestor',
] as const);

export const KEYED_POPULATIONS: readonly Population[] = Object.freeze(['release-signer', 'attestor'] as const);

const ENTRY_KEYS = Object.freeze(['id', 'population', 'operator', 'organization', 'generation', 'revocationIndex']);

export const DISJOINT_PAIRS: readonly DisjointPair[] = Object.freeze([
  Object.freeze({
    a: 'release-signer',
    b: 'arns-controller',
    reason: 'D-16',
  }),
  Object.freeze({
    a: 'monitor-operator',
    b: 'arns-controller',
    reason: '12 §5.2',
  }),
]);

export function checkControllerQuorum(
  entries: readonly RegistryEntry[],
  threshold = 3,
  seats = 5,
): string[] {
  return [];
}
"""

VERDICT_TS = """
export const SIGNATURE_FLOOR = 2;
export const ATTESTATION_FLOOR = 2;
"""

DOC = """# SIGNERS — a synthetic registry

## How this file is checked

Run the checker.

## Populations

| Role | Identifier | What it is | Seated | State |
|---|---|---|---|---|
| Release signer | release-signer | A minisign key | 1 | SEATED |
| ArNS controller | arns-controller | A controller share | 1 | SEATED |
| Monitor operator | monitor-operator | A monitor | 0 | UNSEATED |
| Attestor | attestor | A builder's key | 0 | UNSEATED |

## Disjointness

| Population | Must not overlap | Why |
|---|---|---|
| release-signer | arns-controller | D-16 |
| monitor-operator | arns-controller | 12 §5.2 |

## Counted floors

| Rule | Value | Where the number lives |
|---|---|---|
| Release signatures | 2 | SIGNATURE_FLOOR |
| Attestations | 2 | ATTESTATION_FLOOR |
| ArNS controller quorum | 3-of-5 | checkControllerQuorum |

## Registry

| Person | Organization | Role | Key identifier | Keyring generation | Revocation index |
|---|---|---|---|---|---|
| Ada | Pallas | Release signer | RWQ-1 | 3 | 0 |
| Linus | Thebe | ArNS controller | ar://ANT-1 |  |  |

## Key ceremony

Hold it.

## The declared residual

Declared identities only.
"""

JSON_REGISTRY = {
    "_phase_gate": "synthetic",
    "_entry_schema": {
        "id": "",
        "population": "",
        "operator": "",
        "organization": "",
        "generation": "",
        "revocationIndex": "",
    },
    "entries": [
        {
            "id": "RWQ-1",
            "population": "release-signer",
            "operator": "Ada",
            "organization": "Pallas",
            "generation": 3,
            "revocationIndex": 0,
        },
        {
            "id": "ar://ANT-1",
            "population": "arns-controller",
            "operator": "Linus",
            "organization": "Thebe",
        },
    ],
}


class SyntheticTree:
    """A scratch copy of the four files, so a refusal never edits a committed one."""

    def __init__(self, doc: str = DOC, registry: object = None, registry_ts: str = REGISTRY_TS, verdict_ts: str = VERDICT_TS):
        self.directory = tempfile.TemporaryDirectory()
        root = Path(self.directory.name)
        self.doc = root / "SIGNERS.md"
        self.json = root / "signers.json"
        self.registry_ts = root / "registry.ts"
        self.verdict_ts = root / "verdict.ts"
        self.doc.write_text(doc, encoding="utf-8")
        self.json.write_text(
            json.dumps(JSON_REGISTRY if registry is None else registry, indent=2),
            encoding="utf-8",
        )
        self.registry_ts.write_text(registry_ts, encoding="utf-8")
        self.verdict_ts.write_text(verdict_ts, encoding="utf-8")

    def check(self, strict: bool = False) -> list[str]:
        return checker.check(self.doc, self.json, self.registry_ts, self.verdict_ts, strict)

    def __enter__(self) -> "SyntheticTree":
        return self

    def __exit__(self, *_: object) -> None:
        self.directory.cleanup()


def without(*, role: str = "", column: int = -1, value: str = "") -> str:
    """Return DOC with one cell of one registry row replaced."""
    lines = DOC.splitlines()
    for index, line in enumerate(lines):
        if line.startswith("| Ada ") or (role and line.startswith(f"| {role} ")):
            cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
            cells[column] = value
            lines[index] = "| " + " | ".join(cells) + " |"
            break
    return "\n".join(lines) + "\n"


class CommittedFilesTest(unittest.TestCase):
    """The real SIGNERS.md, against the real registry and the real code."""

    def test_the_committed_registry_reports_unseated_and_never_clean(self) -> None:
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = checker.main([])
        self.assertEqual(code, 0, err.getvalue())
        self.assertIn("unseated:", out.getvalue())
        self.assertNotIn("agree over", out.getvalue())

    def test_strict_refuses_a_registry_that_declares_nobody(self) -> None:
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = checker.main(["--strict"])
        self.assertEqual(code, 1)
        self.assertIn("for want of members", err.getvalue())

    def test_the_committed_document_states_every_population_the_code_enforces(self) -> None:
        # The one check that is non-vacuous today with no entries at all.
        self.assertEqual(
            checker.check(
                REPO / "SIGNERS.md",
                REPO / "app/tools/release/sources/signers.json",
                REPO / "app/tools/verify-release/registry.ts",
                REPO / "app/tools/verify-release/verdict.ts",
                False,
            ),
            [],
        )


class VocabularyTest(unittest.TestCase):
    def test_a_population_the_code_declares_and_the_document_omits_fails(self) -> None:
        doc = "\n".join(
            line for line in DOC.splitlines() if not line.startswith("| Attestor ")
        )
        with SyntheticTree(doc=doc + "\n") as tree:
            self.assertTrue(any("attestor" in failure for failure in tree.check()))

    def test_a_population_the_document_invents_fails(self) -> None:
        doc = DOC.replace(
            "| Attestor | attestor | A builder's key | 0 | UNSEATED |",
            "| Attestor | attestor | A builder's key | 0 | UNSEATED |\n"
            "| Auditor | auditor | An invented role | 0 | UNSEATED |",
        )
        with SyntheticTree(doc=doc) as tree:
            self.assertTrue(any("auditor" in failure for failure in tree.check()))

    def test_a_documented_field_the_parser_does_not_accept_fails(self) -> None:
        registry = json.loads(json.dumps(JSON_REGISTRY))
        registry["_entry_schema"]["organisation"] = "a misspelling"
        with SyntheticTree(registry=registry) as tree:
            self.assertTrue(any("organisation" in failure for failure in tree.check()))

    def test_a_field_the_parser_accepts_and_nobody_documents_fails(self) -> None:
        registry = json.loads(json.dumps(JSON_REGISTRY))
        del registry["_entry_schema"]["revocationIndex"]
        with SyntheticTree(registry=registry) as tree:
            self.assertTrue(any("revocationIndex" in failure for failure in tree.check()))


class SeatingTest(unittest.TestCase):
    """The check that stays non-vacuous while every population is empty."""

    def test_a_seated_count_that_disagrees_with_the_registry_fails(self) -> None:
        doc = DOC.replace("| Release signer | release-signer | A minisign key | 1 | SEATED |",
                          "| Release signer | release-signer | A minisign key | 2 | SEATED |")
        with SyntheticTree(doc=doc) as tree:
            self.assertTrue(any("declares 2 seated" in failure for failure in tree.check()))

    def test_an_empty_population_marked_seated_fails(self) -> None:
        doc = DOC.replace("| Attestor | attestor | A builder's key | 0 | UNSEATED |",
                          "| Attestor | attestor | A builder's key | 0 | SEATED |")
        with SyntheticTree(doc=doc) as tree:
            self.assertTrue(any("for want" in failure for failure in tree.check()))

    def test_a_populated_population_marked_unseated_fails(self) -> None:
        doc = DOC.replace("| Release signer | release-signer | A minisign key | 1 | SEATED |",
                          "| Release signer | release-signer | A minisign key | 1 | UNSEATED |")
        with SyntheticTree(doc=doc) as tree:
            self.assertTrue(any("marked UNSEATED" in failure for failure in tree.check()))

    def test_a_blank_state_is_refused_rather_than_read_as_either(self) -> None:
        doc = DOC.replace("| A builder's key | 0 | UNSEATED |", "| A builder's key | 0 |  |")
        with SyntheticTree(doc=doc) as tree:
            with self.assertRaises(checker.CheckError):
                tree.check()

    def test_emptiness_with_no_declared_reason_fails(self) -> None:
        registry = {
            "_entry_schema": JSON_REGISTRY["_entry_schema"],
            "entries": [],
        }
        doc = (
            DOC.replace("| A minisign key | 1 | SEATED |", "| A minisign key | 0 | UNSEATED |")
            .replace("| A controller share | 1 | SEATED |", "| A controller share | 0 | UNSEATED |")
            .replace("| Ada | Pallas | Release signer | RWQ-1 | 3 | 0 |\n", "")
            .replace("| Linus | Thebe | ArNS controller | ar://ANT-1 |  |  |\n", "")
        )
        with SyntheticTree(doc=doc, registry=registry) as tree:
            self.assertTrue(any("_phase_gate" in failure for failure in tree.check()))


class BothDirectionsTest(unittest.TestCase):
    def test_a_row_with_no_registry_entry_fails(self) -> None:
        doc = DOC.replace(
            "| Linus | Thebe | ArNS controller | ar://ANT-1 |  |  |",
            "| Linus | Thebe | ArNS controller | ar://ANT-1 |  |  |\n| Hedy | Metis | Monitor operator | mon-1 |  |  |",
        )
        with SyntheticTree(doc=doc) as tree:
            self.assertTrue(any("no such entry" in failure for failure in tree.check()))

    def test_a_registry_entry_with_no_row_fails(self) -> None:
        registry = json.loads(json.dumps(JSON_REGISTRY))
        registry["entries"].append(
            {
                "id": "mon-1",
                "population": "monitor-operator",
                "operator": "Hedy",
                "organization": "Metis",
            }
        )
        with SyntheticTree(registry=registry) as tree:
            self.assertTrue(any("publishes no row" in failure for failure in tree.check()))

    def test_a_person_that_differs_between_the_two_fails(self) -> None:
        with SyntheticTree(doc=without(column=0, value="Grace")) as tree:
            self.assertTrue(any("Person reads 'Grace'" in failure for failure in tree.check()))

    def test_an_organization_that_differs_between_the_two_fails(self) -> None:
        with SyntheticTree(doc=without(column=1, value="Rhea")) as tree:
            self.assertTrue(any("Organization reads 'Rhea'" in failure for failure in tree.check()))

    def test_a_role_the_populations_table_does_not_declare_fails(self) -> None:
        with SyntheticTree(doc=without(column=2, value="Auditor")) as tree:
            self.assertTrue(any("is not one of the roles" in failure for failure in tree.check()))

    def test_a_blank_holder_is_refused_even_when_both_sides_agree_on_it(self) -> None:
        # The case the cross-file comparison cannot catch, and the reason the blank-cell guard
        # is not belt-and-braces: a key with no holder on *both* sides matches itself and
        # passes. 12 §2.2 point 1 requires every key mapped to a named person, and a mapping
        # to nobody is exactly what makes the disjointness check unable to see the key.
        registry = json.loads(json.dumps(JSON_REGISTRY))
        registry["entries"][0]["operator"] = ""
        with SyntheticTree(doc=without(column=0, value=""), registry=registry) as tree:
            with self.assertRaises(checker.CheckError):
                tree.check()


class KeyedFieldTest(unittest.TestCase):
    def test_a_minisign_key_with_no_revocation_index_fails(self) -> None:
        registry = json.loads(json.dumps(JSON_REGISTRY))
        del registry["entries"][0]["revocationIndex"]
        with SyntheticTree(doc=without(column=5, value=""), registry=registry) as tree:
            self.assertTrue(any("cannot be revoked" in failure for failure in tree.check()))

    def test_a_controller_address_carrying_a_generation_fails(self) -> None:
        registry = json.loads(json.dumps(JSON_REGISTRY))
        registry["entries"][1]["generation"] = 3
        doc = DOC.replace(
            "| Linus | Thebe | ArNS controller | ar://ANT-1 |  |  |",
            "| Linus | Thebe | ArNS controller | ar://ANT-1 | 3 |  |",
        )
        with SyntheticTree(doc=doc, registry=registry) as tree:
            self.assertTrue(any("minisign keys only" in failure for failure in tree.check()))


class FloorTest(unittest.TestCase):
    def test_a_floor_that_disagrees_with_the_counting_code_fails(self) -> None:
        with SyntheticTree(verdict_ts=VERDICT_TS.replace("SIGNATURE_FLOOR = 2", "SIGNATURE_FLOOR = 3")) as tree:
            self.assertTrue(any("Release signatures" in failure for failure in tree.check()))

    def test_a_quorum_that_disagrees_with_the_code_fails(self) -> None:
        with SyntheticTree(registry_ts=REGISTRY_TS.replace("seats = 5", "seats = 7")) as tree:
            self.assertTrue(any("3-of-7" in failure for failure in tree.check()))

    def test_a_floor_no_code_reads_fails(self) -> None:
        doc = DOC.replace(
            "| ArNS controller quorum | 3-of-5 | checkControllerQuorum |",
            "| ArNS controller quorum | 3-of-5 | checkControllerQuorum |\n| Soak hours | 72 | nowhere |",
        )
        with SyntheticTree(doc=doc) as tree:
            self.assertTrue(any("no counting code reads" in failure for failure in tree.check()))


class DisjointnessTest(unittest.TestCase):
    def test_a_pair_the_code_enforces_and_the_document_omits_fails(self) -> None:
        doc = DOC.replace("| monitor-operator | arns-controller | 12 §5.2 |\n", "")
        with SyntheticTree(doc=doc) as tree:
            self.assertTrue(any("disjoint pairs" in failure for failure in tree.check()))

    def test_a_pair_with_no_stated_reason_is_refused(self) -> None:
        doc = DOC.replace("| release-signer | arns-controller | D-16 |", "| release-signer | arns-controller |  |")
        with SyntheticTree(doc=doc) as tree:
            with self.assertRaises(checker.CheckError):
                tree.check()


class FailClosedTest(unittest.TestCase):
    """An extractor that matched nothing must raise, never compare two empty sets."""

    def test_a_registry_without_populations_is_an_error_not_an_agreement(self) -> None:
        with SyntheticTree(registry_ts=REGISTRY_TS.replace("export const POPULATIONS", "const OTHER")) as tree:
            with self.assertRaises(checker.CheckError):
                tree.check()

    def test_a_verdict_without_floors_is_an_error(self) -> None:
        with SyntheticTree(verdict_ts="export const NOTHING = 1;\n") as tree:
            with self.assertRaises(checker.CheckError):
                tree.check()

    def test_a_missing_section_is_an_error(self) -> None:
        doc = DOC.replace("## Key ceremony", "## Ceremony")
        with SyntheticTree(doc=doc) as tree:
            with self.assertRaises(checker.CheckError):
                tree.check()

    def test_a_registry_table_with_the_wrong_column_count_is_an_error(self) -> None:
        doc = DOC.replace(
            "| Ada | Pallas | Release signer | RWQ-1 | 3 | 0 |",
            "| Ada | Pallas | Release signer | RWQ-1 | 3 |",
        )
        with SyntheticTree(doc=doc) as tree:
            with self.assertRaises(checker.CheckError):
                tree.check()

    def test_a_registry_document_with_no_entry_schema_is_an_error(self) -> None:
        registry = {"_phase_gate": "synthetic", "entries": []}
        with SyntheticTree(registry=registry) as tree:
            with self.assertRaises(checker.CheckError):
                tree.check()


if __name__ == "__main__":
    unittest.main()
