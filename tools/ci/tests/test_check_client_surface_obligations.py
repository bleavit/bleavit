"""The inverse surface gate: does every client obligation name a *frozen* surface?

Four spec questions in one session had one shape — a client obligation written in
docs 10/11 that does not create the doc-02 frozen surface it needs, with nothing in
the gate set noticing the absence (SQ-552, SQ-577, SQ-580, SQ-581). Every existing
checker verifies that what IS declared agrees with the runtime; none asked whether
what is REQUIRED was ever declared.

The gate now answers that. These tests exist because it is **green** on the current
tree — all 27 references frozen, 0 waived — and a green gate proves nothing about
whether it can go red. SQ-582's lesson is the one being applied: the first tests
written there covered the *parser* and not the *comparison*, so deleting the check
broke nothing and the suite stayed green. Every test below that matters drives
`check()` and asserts on a verdict, not on an intermediate parse.
"""

import importlib.util
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def load():
    spec = importlib.util.spec_from_file_location(
        "cso", ROOT / "tools/ci/check-client-surface-obligations.py"
    )
    module = importlib.util.module_from_spec(spec)
    argv = sys.argv
    sys.argv = ["check-client-surface-obligations.py"]
    try:
        spec.loader.exec_module(module)
    except SystemExit:
        pass
    finally:
        sys.argv = argv
    return module


# The anti-vacuity positive controls the checker itself asserts. Repeated here so a test
# failure names which side broke: the checker's own control, or this suite's model.
#
# Both syntactic forms are represented, and that is the point rather than tidiness: with
# only dotted controls, narrowing the extractor's `(?:\.|::)` alternation to `\.` dropped
# every `::` reference — including `Market::Fee` and `ConditionalLedger::RedemptionFee`,
# the two rate constants 11 §11.5 makes compulsory — while every control still matched
# and the count floor still cleared. The gate reported success while checking less.
CONTROLS = (
    ("Epoch", "Proposals"),
    ("Market", "Markets"),
    ("Constitution", "Params"),
    ("System", "Account"),
    ("Market", "Fee"),
    ("ConditionalLedger", "RedemptionFee"),
    ("ConditionalLedger", "ServiceIdBase"),
)
# The floors are asserted as LITERALS below, never read back from the module. Reading them
# from the module is what let `MIN_REFERENCES = 0` survive: the test compared the checker
# against itself and agreed.
EXPECTED_MIN_REFERENCES = 20
EXPECTED_MIN_FROZEN_MATCHES = 10


class TestLiveTree(unittest.TestCase):
    """Against the real repository, not a fixture."""

    def setUp(self):
        self.m = load()

    def test_the_gate_is_green_on_the_current_tree(self):
        # If this fails, a client obligation lost its frozen surface — which is the
        # defect the gate exists for, not a broken test.
        self.assertEqual(self.m.check(), [])

    def test_it_extracts_real_references_from_the_client_documents(self):
        refs = self.m.client_references()
        self.assertGreaterEqual(len(refs), EXPECTED_MIN_REFERENCES)
        for control in CONTROLS:
            self.assertIn(control, refs, f"{control} missing — the extractor regressed")

    def test_the_anti_vacuity_floors_and_controls_cannot_be_quietly_weakened(self):
        # The floors and the control set ARE the gate's ability to notice it has stopped
        # working, so they are pinned as literals here. Without this, setting
        # `MIN_REFERENCES = 0` or shrinking `POSITIVE_CONTROLS` to one entry passes the
        # whole suite — the tests would be comparing the checker against itself.
        self.assertGreaterEqual(self.m.MIN_REFERENCES, EXPECTED_MIN_REFERENCES)
        self.assertGreaterEqual(self.m.MIN_FROZEN_MATCHES, EXPECTED_MIN_FROZEN_MATCHES)
        self.assertEqual(set(self.m.POSITIVE_CONTROLS), set(CONTROLS))

    def test_both_reference_syntaxes_are_extracted(self):
        # `Pallet.Item` and `Pallet::Item` both appear in docs 10/11 and the gate must see
        # both. Asserted on the live documents, so an extractor that handles only one form
        # fails here even if the count floor still clears.
        refs = self.m.client_references()
        self.assertIn(("Epoch", "Proposals"), refs, "dotted form not extracted")
        self.assertIn(("Market", "Fee"), refs, "`::` form not extracted")

    def test_calls_are_out_of_scope_and_the_gate_says_so(self):
        # Dispatchables are snake_case and deliberately outside this gate (SQ-577; the
        # 09 §1.2 ↔ 11 §11.5 obligations are gated by check-dispatch-mirror.py). Pinned
        # so the exclusion stays a stated boundary rather than becoming an unnoticed hole.
        refs = self.m.client_references()
        self.assertNotIn(("Multisig", "as_multi"), refs)
        source = (ROOT / "tools/ci/check-client-surface-obligations.py").read_text()
        self.assertIn("dispatchable calls are outside this gate", source)

    def test_every_extracted_reference_carries_its_citation_site(self):
        for key, sites in self.m.client_references().items():
            self.assertTrue(sites, f"{key} extracted with no citation site")
            self.assertRegex(sites[0], r"^1[01]-[a-z-]+\.md:\d+$")

    def test_the_twelve_surfaces_sq580_froze_are_frozen(self):
        # The SQ-580 batch. Named individually rather than counted, because a count
        # survives freezing the wrong twelve.
        frozen = self.m.frozen_surface()
        for pallet, item in (
            ("Epoch", "ResourceLocks"),
            ("Multisig", "Multisigs"),
            ("Referenda", "ReferendumCount"),
            ("Referenda", "ReferendumInfoFor"),
            ("Referenda", "TrackQueue"),
            ("Referenda", "DecidingCount"),
            ("Preimage", "StatusFor"),
            ("Preimage", "PreimageFor"),
            ("ConvictionVoting", "VotingFor"),
            ("ConvictionVoting", "ClassLocksFor"),
            ("Scheduler", "Agenda"),
            ("System", "Events"),
        ):
            self.assertIn((pallet, item), frozen, f"{pallet}.{item} is no longer frozen")

    def test_it_ignores_type_references_that_are_not_surfaces(self):
        # `RejectReason::NotRatified` is a type path, not a storage read. The
        # `construct_runtime!` prefix restriction is what keeps this gate quiet enough
        # to stay switched on; an earlier prose sweep reported every capitalised dotted
        # pair and had to be thrown away.
        refs = self.m.client_references()
        self.assertNotIn(("RejectReason", "NotRatified"), refs)
        self.assertNotIn(("VaultState", "BaselineSettled"), refs)


class TestTheComparisonItself(unittest.TestCase):
    """Drive `check()` with injected inputs, so the *verdict* is what is asserted.

    These are the mutation-resistant ones. Deleting the `missing` computation, or the
    waiver-expiry branch, or the stale-waiver sweep, fails a test here — which is not
    true of any test that only inspects a parse result.
    """

    def setUp(self):
        self.m = load()
        self._real = (self.m.client_references, self.m.frozen_surface, self.m.load_waivers, self.m.open_question_ids)

    def tearDown(self):
        (self.m.client_references, self.m.frozen_surface, self.m.load_waivers, self.m.open_question_ids) = self._real

    def _inject(self, references, frozen, waivers=None, open_ids=(580,)):
        # Controls are seeded into both sides so anti-vacuity passes and the test is
        # about the surface under examination, not about the floors.
        refs = {c: [f"11-frontend-workflows.md:{i}"] for i, c in enumerate(CONTROLS, 1)}
        refs.update({k: [f"11-frontend-workflows.md:{i}"] for i, k in enumerate(references, 100)})
        padding = {(f"Pad{i}", "Item"): ["11-frontend-workflows.md:9"] for i in range(self.m.MIN_REFERENCES)}
        refs.update(padding)
        froz = set(CONTROLS) | set(frozen) | set(padding)
        self.m.client_references = lambda: refs
        self.m.frozen_surface = lambda: froz
        self.m.load_waivers = lambda: (waivers or {})
        self.m.open_question_ids = lambda: set(open_ids)

    def test_an_unfrozen_client_read_is_an_error(self):
        self._inject(references=[("Multisig", "Multisigs")], frozen=[])
        errors = self.m.check()
        self.assertTrue(any("Multisig.Multisigs" in e for e in errors), errors)

    def test_a_frozen_client_read_is_not_an_error(self):
        self._inject(references=[("Multisig", "Multisigs")], frozen=[("Multisig", "Multisigs")])
        self.assertEqual(self.m.check(), [])

    def test_the_error_names_the_consequence_not_just_the_absence(self):
        # The reason this matters is not "a row is missing" — it is that the 10 §5.2
        # lattice cannot fail on a surface it was never told about, so the classifier
        # reports `full` while the path breaks. An error message that omits that gets
        # triaged as bookkeeping.
        self._inject(references=[("Multisig", "Multisigs")], frozen=[])
        self.assertTrue(any("full" in e and "classifier" in e for e in self.m.check()))

    def test_a_waiver_against_an_open_question_suppresses_the_error(self):
        self._inject(
            references=[("Multisig", "Multisigs")],
            frozen=[],
            waivers={("Multisig", "Multisigs"): {"surface": "Multisig.Multisigs", "sq": "SQ-580"}},
            open_ids=(580,),
        )
        self.assertEqual(self.m.check(), [])

    def test_a_waiver_expires_when_its_question_closes(self):
        # The mechanical expiry. Without it the waiver file quietly becomes the
        # permanent home of the problem.
        self._inject(
            references=[("Multisig", "Multisigs")],
            frozen=[],
            waivers={("Multisig", "Multisigs"): {"surface": "Multisig.Multisigs", "sq": "SQ-580"}},
            open_ids=(999,),
        )
        self.assertTrue(any("expired" in e for e in self.m.check()))

    def test_a_waiver_without_a_question_id_is_refused(self):
        self._inject(
            references=[("Multisig", "Multisigs")],
            frozen=[],
            waivers={("Multisig", "Multisigs"): {"surface": "Multisig.Multisigs"}},
        )
        self.assertTrue(any("must carry" in e for e in self.m.check()))

    def test_a_waiver_for_an_already_frozen_surface_is_stale(self):
        # The other direction: a waiver left behind after the fix would keep excusing
        # a surface that no longer needs excusing, and would hide the next regression.
        self._inject(
            references=[("Multisig", "Multisigs")],
            frozen=[("Multisig", "Multisigs")],
            waivers={("Multisig", "Multisigs"): {"surface": "Multisig.Multisigs", "sq": "SQ-580"}},
        )
        self.assertTrue(any("stale" in e for e in self.m.check()))


class TestAntiVacuity(unittest.TestCase):
    """The gate must fail loudly when it stops being able to check anything."""

    def setUp(self):
        self.m = load()
        self._real = (self.m.client_references, self.m.frozen_surface, self.m.load_waivers, self.m.open_question_ids)

    def tearDown(self):
        (self.m.client_references, self.m.frozen_surface, self.m.load_waivers, self.m.open_question_ids) = self._real

    def test_a_broken_extractor_fails_rather_than_reporting_success(self):
        self.m.client_references = lambda: {}
        self.m.frozen_surface = lambda: set()
        self.m.load_waivers = lambda: {}
        self.m.open_question_ids = lambda: {580}
        errors = self.m.check()
        self.assertTrue(errors, "an extractor returning nothing reported success")
        self.assertTrue(any("anti-vacuity" in e for e in errors), errors)

    def test_a_renamed_manifest_field_fails_rather_than_reporting_success(self):
        # If `frozen_surface()` stops joining, every reference looks unfrozen — but the
        # controls catch it and say *which* half broke. The first probe of this idea
        # looked for a `member` field, found zero surfaces, and read like a catastrophic
        # finding rather than a broken checker.
        refs = {c: ["11-frontend-workflows.md:1"] for c in CONTROLS}
        refs.update({(f"Pad{i}", "Item"): ["11-frontend-workflows.md:9"] for i in range(self.m.MIN_REFERENCES)})
        self.m.client_references = lambda: refs
        self.m.frozen_surface = lambda: set()
        self.m.load_waivers = lambda: {}
        self.m.open_question_ids = lambda: {580}
        errors = self.m.check()
        self.assertTrue(any("did not join to a manifest entry" in e for e in errors), errors)

    def test_no_open_spec_questions_is_treated_as_a_broken_parse(self):
        # Waiver expiry is driven by which questions are open. If that parse silently
        # returns nothing, every waiver expires at once and the gate turns into noise;
        # if the "open" test itself broke, waivers would never expire and the gate goes
        # quiet. Either way the honest response is to stop, so it raises.
        import tempfile

        table = "\n".join(
            [
                "| ID | Question | Spec ref | Raised | Status |",
                "|---|---|---|---|---|",
                "| SQ-1 | closed one | 02 §7 | 2026-01-01 | resolved |",
                "| SQ-2 | closed two | 02 §7 | 2026-01-01 | resolved |",
            ]
        )
        with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as handle:
            handle.write(table + "\n")
            path = Path(handle.name)
        original = self.m.PLAN
        try:
            self.m.PLAN = path
            with self.assertRaises(SystemExit):
                self.m.open_question_ids()
        finally:
            self.m.PLAN = original
            path.unlink()

    def test_open_rows_are_detected_by_prefix_not_by_substring(self):
        # "open" must be tested as a *prefix* of the status cell: an open row
        # legitimately contains the word "resolved" in its prose ("`gate.v_min`
        # resolved; two rows remain"), and a substring test would close it.
        import tempfile

        table = "\n".join(
            [
                "| ID | Question | Spec ref | Raised | Status |",
                "|---|---|---|---|---|",
                "| SQ-7 | a live one | 02 §7 | 2026-01-01 | open — `gate.v_min` resolved; two rows remain |",
                "| SQ-8 | a closed one | 02 §7 | 2026-01-01 | resolved |",
            ]
        )
        with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as handle:
            handle.write(table + "\n")
            path = Path(handle.name)
        original = self.m.PLAN
        try:
            self.m.PLAN = path
            self.assertEqual(self.m.open_question_ids(), {7})
        finally:
            self.m.PLAN = original
            path.unlink()


class TestTheRealWaiverLoader(unittest.TestCase):
    """`load_waivers()` itself, not a monkeypatched stand-in.

    Every test in `TestTheComparisonItself` replaces `load_waivers`, and the real tree has
    no waiver file — so the only path those tests exercise is the missing-file branch, and
    the exact mutation `def load_waivers(): return {}` survives the whole suite while real
    waivers would never be read. These drive the TOML parse.
    """

    def setUp(self):
        self.m = load()
        self._real_waivers = self.m.WAIVERS

    def tearDown(self):
        self.m.WAIVERS = self._real_waivers

    def _with_waiver_file(self, text):
        import tempfile

        handle = tempfile.NamedTemporaryFile("w", suffix=".toml", delete=False)
        handle.write(text)
        handle.close()
        self.addCleanup(lambda: Path(handle.name).unlink(missing_ok=True))
        self.m.WAIVERS = Path(handle.name)

    def test_it_parses_a_real_waiver_file(self):
        self._with_waiver_file('[[waiver]]\nsurface = "Multisig.Multisigs"\nsq = "SQ-580"\n')
        waivers = self.m.load_waivers()
        self.assertEqual(list(waivers), [("Multisig", "Multisigs")])
        self.assertEqual(waivers[("Multisig", "Multisigs")]["sq"], "SQ-580")

    def test_it_parses_several_and_keeps_them_distinct(self):
        self._with_waiver_file(
            '[[waiver]]\nsurface = "Multisig.Multisigs"\nsq = "SQ-580"\n\n'
            '[[waiver]]\nsurface = "Scheduler.Agenda"\nsq = "SQ-581"\n'
        )
        waivers = self.m.load_waivers()
        self.assertEqual(len(waivers), 2)
        self.assertEqual(waivers[("Scheduler", "Agenda")]["sq"], "SQ-581")

    def test_a_surface_that_is_not_pallet_dot_item_is_refused(self):
        self._with_waiver_file('[[waiver]]\nsurface = "NotQualified"\nsq = "SQ-580"\n')
        with self.assertRaises(SystemExit):
            self.m.load_waivers()

    def test_an_absent_waiver_file_is_no_waivers_not_an_error(self):
        self.m.WAIVERS = Path("/nonexistent/client-surface-waivers.toml")
        self.assertEqual(self.m.load_waivers(), {})


class TestManifestElisions(unittest.TestCase):
    """`surface-manifest.json` may render a type as its path instead of expanding it.

    Admissible only when another frozen entry covers the elided subtree; otherwise it
    is a hole that reads as coverage. The manifest declares each one, and this asserts
    the declaration exists and is used.
    """

    def setUp(self):
        self.manifest = json.loads((ROOT / "tools/release/surface-manifest.json").read_text())

    def test_every_elided_path_is_declared_with_what_covers_it(self):
        declared = self.manifest.get("elisions", {})
        used = {path for e in self.manifest["entries"] for path in e.get("elide", ())}
        for path in used:
            self.assertIn(path, declared, f"{path} is elided but not declared")
            self.assertTrue(declared[path].get("covered_by"), f"{path} declares no coverage")
            self.assertTrue(declared[path].get("reason"), f"{path} declares no reason")

    def test_no_declared_elision_is_unused(self):
        declared = set(self.manifest.get("elisions", {}))
        used = {path for e in self.manifest["entries"] for path in e.get("elide", ())}
        self.assertEqual(declared - used, set(), "declared elisions that nothing uses")

    def test_the_elided_entry_still_checks_its_own_container(self):
        # The point of eliding `RuntimeEvent` is to keep checking `EventRecord`. If the
        # elision swallowed the container too, the entry would assert nothing.
        entry = next(e for e in self.manifest["entries"] if e["id"] == "storage.system.events")
        value = entry["layout"]["value"]
        self.assertIn("EventRecord", value)
        self.assertIn("phase", value)
        self.assertIn("topics", value)
        self.assertIn("bleavit_runtime::RuntimeEvent", value)
        self.assertNotIn("ExtrinsicSuccess", value, "RuntimeEvent was expanded, not elided")

    def test_types_no_other_entry_covers_are_not_elided(self):
        # `OriginCaller` is embedded by `Referenda.ReferendumInfoFor` and
        # `Scheduler.Agenda` and frozen by nothing else, so it must be expanded even
        # though it is the reason those two entries are large.
        for entry_id in ("storage.referenda.referendum_info_for", "storage.scheduler.agenda"):
            entry = next(e for e in self.manifest["entries"] if e["id"] == entry_id)
            self.assertEqual(entry.get("elide", []), [], f"{entry_id} elides an uncovered type")
            self.assertIn("OriginCaller", entry["layout"]["value"])


if __name__ == "__main__":
    unittest.main()
