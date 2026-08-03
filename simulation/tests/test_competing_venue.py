"""16 §8.4 / 14 TH-72 — the competing-venue diversion and its Phase-4 arming leg.

Three things need to be true and none of them is self-evident from reading the
diff:

1. **Zero diversion is a strict no-op.** The published Phase-0 result was
   measured on a chain with no hosted service, and this term must not move it
   by one digit. That is asserted on executed evidence, not on the arithmetic
   identity `x * 1 == x`, because a term that consumed one RNG draw would
   satisfy the identity and still reshuffle the entire population.
2. **The diversion reaches the books it claims to.** It thins organic
   formation on decision, gate and Baseline books — measured as contest
   capital, the quantity 04 §7a actually grades — and leaves attacker budgets
   alone. The asymmetry is the whole content of the term.
3. **The arming block agrees with its own rungs**, and the checker refuses a
   block that does not.
"""

from dataclasses import replace
from decimal import Decimal
import unittest

from bleavit_simulation.calibration import (
    _competing_venue,
    _simulate_population,
)
from bleavit_simulation.config import (
    CLASSES,
    COMPETING_VENUE_ARMING_DIVERSION,
    DEFAULT_SEED,
    SimulationConfig,
)
from bleavit_simulation.engine import _diverted, simulate_proposal
from bleavit_simulation.evidence import _check_competing_venue
from bleavit_simulation.proposals import generate_proposal_with_config

ARMING = COMPETING_VENUE_ARMING_DIVERSION


def _population(config, count):
    return [
        generate_proposal_with_config(DEFAULT_SEED, index, config)
        for index in range(count)
    ]


def _run(proposals, config):
    return _simulate_population(
        proposals=proposals,
        seed=DEFAULT_SEED,
        config=config,
        budget_multiple=Decimal(config.primary_manipulator_budget_multiple),
        flow_cap=Decimal(config.diagnostic_probe_flow_cap),
    )


class DiversionIsANoOpAtZeroTests(unittest.TestCase):
    """The Phase-0 population must survive this milestone byte-identical."""

    def test_default_config_diverts_nothing(self):
        self.assertEqual(SimulationConfig().competing_venue_diversion, "0.00")

    def test_executed_evidence_is_byte_identical_at_zero_diversion(self):
        config = SimulationConfig(proposal_count=20)
        proposals = _population(config, 20)
        default = [row.evidence() for row in _run(proposals, config)]
        explicit = [
            row.evidence()
            for row in _run(proposals, replace(config, competing_venue_diversion="0.00"))
        ]
        self.assertEqual(default, explicit)

    def test_zero_diversion_consumes_no_randomness(self):
        # The identity `x * 1 == x` would hold even if the term drew from the
        # RNG first, and that draw would shift every subsequent proposal. So
        # assert the stronger property directly: the helper returns the SAME
        # object, having done nothing at all.
        config = SimulationConfig()
        formation = Decimal("0.83")
        self.assertIs(_diverted(formation, config), formation)

    def test_a_nonzero_diversion_scales_the_ratio(self):
        config = replace(SimulationConfig(), competing_venue_diversion="0.25")
        self.assertEqual(_diverted(Decimal("0.80"), config), Decimal("0.60"))


class DiversionThinsTheRightBooksTests(unittest.TestCase):
    """It must reach decision books, not only the gate books."""

    def _pair_contest(self, proposal, diversion):
        config = replace(
            SimulationConfig(proposal_count=60), competing_venue_diversion=diversion
        )
        result = simulate_proposal(
            proposal,
            seed=DEFAULT_SEED,
            config=config,
            budget_multiple=Decimal(config.primary_manipulator_budget_multiple),
            flow_cap=Decimal(config.diagnostic_probe_flow_cap),
        )
        evidence = result.evidence()
        return Decimal(evidence["contest_accept"]) + Decimal(
            evidence["contest_reject"]
        )

    def test_decision_pair_contest_capital_falls_under_diversion(self):
        config = SimulationConfig(proposal_count=60)
        # PARAM carries no gate books, so a PARAM proposal isolates the
        # decision-pair path: if its contest capital moves, the diversion
        # reached the decision books themselves.
        proposals = [
            row for row in _population(config, 60) if row.proposal_class == "param"
        ][:5]
        self.assertTrue(proposals)
        for proposal in proposals:
            control = self._pair_contest(proposal, "0.00")
            diverted = self._pair_contest(proposal, ARMING)
            self.assertLess(diverted, control, f"proposal {proposal.proposal_id}")

    def test_attacker_budget_is_not_diverted(self):
        # The asymmetry that makes the term meaningful: an adversary targeting
        # one proposal is not diverted by a venue elsewhere (14 TH-72). The
        # manipulator's spend is budget-driven, so it must be unchanged while
        # the organic side thins.
        config = SimulationConfig(proposal_count=60)
        proposal = next(
            row for row in _population(config, 60) if row.proposal_class == "param"
        )
        spends = []
        for diversion in ("0.00", ARMING):
            local = replace(config, competing_venue_diversion=diversion)
            result = simulate_proposal(
                proposal,
                seed=DEFAULT_SEED,
                config=local,
                budget_multiple=Decimal(local.primary_manipulator_budget_multiple),
                flow_cap=Decimal(local.diagnostic_probe_flow_cap),
            )
            spends.append(Decimal(result.evidence()["manipulator_flow"]))
        self.assertEqual(spends[0], spends[1])


class ArmingBlockTests(unittest.TestCase):
    # Built once for the class: the block simulates its sample three times
    # over (control plus two rungs), so a per-method `setUp` would pay that
    # cost once per assertion for no added coverage.
    @classmethod
    def setUpClass(cls):
        cls.config = SimulationConfig(
            proposal_count=80, competing_venue_sample_per_class=4
        )
        cls.proposals = _population(cls.config, 80)
        cls.primary = _run(cls.proposals, cls.config)
        cls.block = _competing_venue(
            cls.proposals,
            DEFAULT_SEED,
            cls.config,
            Decimal(cls.config.diagnostic_probe_flow_cap),
            cls.primary,
        )

    def test_rungs_cover_the_control_and_the_configured_ladder(self):
        self.assertEqual(
            list(self.block["rungs"]),
            ["0.00", *self.config.competing_venue_diversions],
        )

    def test_control_reproduces_the_primary_population(self):
        # The rungs are read against this control, so if it disagrees with the
        # artifact's own primary run the whole block is measuring a different
        # population than the one the artifact publishes.
        self.assertTrue(self.block["control_matches_primary"])

    def test_arming_rung_is_the_derived_bound_not_a_chosen_one(self):
        self.assertEqual(self.block["arming_diversion"], "0.50")

    def test_arming_verdict_agrees_with_its_own_rungs(self):
        arming = self.block["rungs"][ARMING]
        derived = {
            name: arming[name]["decidable_harm"] > 0
            and Decimal(arming[name]["decidable_harm_false_pass_rate"])
            < Decimal("0.01")
            for name in arming
        }
        self.assertEqual(self.block["arming_by_class"], derived)
        self.assertEqual(
            self.block["security_leg_clean"],
            all(derived.values()) and self.block["control_matches_primary"],
        )

    def test_no_composite_arming_verdict_is_published(self):
        # On the committed corpus a composite `arming_ready` read True while
        # decision-grade formation fell 39-84 % and every class's security
        # gate was `all_or_nothing`. A boolean named "ready" that a phase gate
        # could consume must not be derivable from this block.
        self.assertNotIn("arming_ready", self.block)
        self.assertIn("no_single_verdict", self.block)
        self.assertIn("liveness_loss_at_arming", self.block)

    def test_the_sample_is_whole_epoch_slates(self):
        # `_simulate_population` pools TH-7's baseline-suppression budget over
        # each epoch group, and rebuilds those groups from the list it is
        # handed. A sample of loose ids therefore hands it PARTIAL slates and
        # shrinks the attacker's budget — a confound in the exact comparison
        # this leg makes. Asserted structurally rather than by outcome,
        # because `control_matches_primary` only catches it when the budget
        # change happens to flip something.
        from bleavit_simulation.calibration import _epoch_groups

        size = self.config.epoch_slate_size
        full = {
            epoch: len(rows)
            for epoch, rows in _epoch_groups(self.proposals, self.config).items()
        }
        for epoch, rows in _epoch_groups(
            [row for row in self.proposals if row.proposal_id // size in self._sampled()],
            self.config,
        ).items():
            self.assertEqual(len(rows), full[epoch], f"epoch {epoch} is partial")

    def _sampled(self):
        from bleavit_simulation.calibration import _stratified_sample

        seeds = _stratified_sample(
            self.proposals,
            self.config.competing_venue_sample_per_class,
            DEFAULT_SEED ^ 0x43564E55,
        )
        return {row.proposal_id // self.config.epoch_slate_size for row in seeds}

    def test_baseline_liveness_is_measured_separately(self):
        # A failed Baseline does not surface as a decision outcome: the engine
        # falls back to the previous epoch's Baseline and carries on. Without
        # this field a diversion that destroys Baseline formation is invisible.
        for name, row in self.block["liveness"].items():
            self.assertIn("baseline_carried_control", row, name)
            self.assertIn("baseline_carried_at_arming", row, name)

    def test_the_generated_block_satisfies_the_artifact_checker(self):
        # The bridge test. `ArtifactCheckerTests` exercises the checker against
        # hand-built payloads and the rest of this class exercises the
        # generator, but nothing otherwise runs the REAL generated block
        # through the REAL checker — and a shape disagreement between them
        # would only surface after a multi-hour `--full` run, at the point
        # where `run-calibration.py --check` refuses the artifact it just
        # produced. This is that check, at a cost of nothing.
        errors: list[str] = []
        _check_competing_venue({"competing_venue": self.block}, self.config, errors)
        self.assertEqual(errors, [])

    def test_resolution_is_published_so_a_zero_rate_cannot_be_over_read(self):
        # "0.000000" over 12 decidable-harm proposals and over 1,200 read the
        # same. The gate is < 1 %, so a class whose denominator cannot express
        # a value below 1 % is really reporting "none observed".
        for name, row in self.block["resolution"].items():
            self.assertIn("decidable_harm_at_arming", row, name)
            if row["decidable_harm_at_arming"]:
                self.assertEqual(
                    Decimal(row["smallest_detectable_rate"]),
                    (
                        Decimal(1) / Decimal(row["decidable_harm_at_arming"])
                    ).quantize(Decimal("0.000001")),
                    name,
                )
                self.assertEqual(
                    row["gate_is_all_or_nothing"],
                    Decimal(1) / Decimal(row["decidable_harm_at_arming"])
                    > Decimal("0.01"),
                    name,
                )

    def test_stress_rung_is_reported_beside_the_arming_verdict(self):
        self.assertEqual(self.block["stress_diversion"], "0.75")
        self.assertEqual(set(self.block["stress_by_class"]), set(CLASSES))
        self.assertIn("ANCHORED, not derived", self.block["flow_model"])

    def test_liveness_is_reported_for_every_class(self):
        # TH-72's named harm is denial, not corruption, and a false-pass-only
        # criterion reads cleaner the more decisions the diversion destroys.
        # The liveness leg exists so that shape cannot be mistaken for health.
        for name, row in self.block["liveness"].items():
            self.assertIn("decision_grade_loss", row, name)
            self.assertEqual(
                Decimal(row["decision_grade_loss"]),
                Decimal(row["decision_grade_control"])
                - Decimal(row["decision_grade_at_arming"]),
                name,
            )

    def test_criterion_states_both_legs_and_disclaims_the_phase_0_gate(self):
        criterion = self.block["criterion"]
        self.assertIn("SECURITY", criterion)
        self.assertIn("LIVENESS", criterion)
        self.assertIn("never enters `violations`", criterion)


class ArtifactCheckerTests(unittest.TestCase):
    """`_check_competing_venue` — structural, never economic.

    A `False` `security_leg_clean` is a legitimate and informative state that
    must NOT fail `--check`; what must fail is a block that disagrees with its
    own rungs, because then the Phase-4 decision rests on numbers nothing
    re-derives. These run against a hand-built payload so they cost nothing and
    can be asserted in both directions.
    """

    def _payload(self, **overrides):
        rung = {
            name: {
                "decidable_harm": 10,
                "decidable_harm_false_pass_rate": "0.000000",
                "decision_grade_formation_rate": "0.500000",
                "not_decision_grade": 1,
                "baseline_carried": 0,
            }
            for name in CLASSES
        }
        ladder = SimulationConfig().competing_venue_diversions
        block = {
            "arming_by_class": {name: True for name in CLASSES},
            "arming_diversion": ARMING,
            "security_leg_clean": True,
            "liveness_loss_at_arming": {name: "0.0000" for name in CLASSES},
            "control_matches_primary": True,
            "stress_by_class": {name: True for name in CLASSES},
            "stress_diversion": ladder[-1],
            "rungs": {"0.00": rung, **{level: rung for level in ladder}},
        }
        block.update(overrides)
        return {"competing_venue": block}

    def _errors(self, payload):
        errors: list[str] = []
        _check_competing_venue(payload, SimulationConfig(), errors)
        return errors

    def test_a_self_consistent_block_passes(self):
        self.assertEqual(self._errors(self._payload()), [])

    def test_a_missing_block_is_refused(self):
        self.assertTrue(self._errors({}))

    def test_rungs_must_match_the_configured_ladder(self):
        payload = self._payload()
        payload["competing_venue"]["rungs"].pop("0.50")
        self.assertTrue(self._errors(payload))

    def test_class_verdicts_must_agree_with_the_measured_rates(self):
        payload = self._payload()
        payload["competing_venue"]["arming_by_class"]["param"] = False
        self.assertTrue(self._errors(payload))

    def test_a_class_with_no_evidence_does_not_pass_on_an_empty_denominator(self):
        # SQ-269's rule, applied to this leg: `_rate(0, 0)` is "0.000000", so a
        # class that measured nothing would otherwise satisfy `< 1 %`.
        payload = self._payload()
        for level in payload["competing_venue"]["rungs"]:
            payload["competing_venue"]["rungs"][level] = {
                **payload["competing_venue"]["rungs"][level],
                "param": {
                    "decidable_harm": 0,
                    "decidable_harm_false_pass_rate": "0.000000",
                    "decision_grade_formation_rate": "0.500000",
                    "not_decision_grade": 0,
                },
            }
        self.assertTrue(self._errors(payload))

    def test_losing_the_control_agreement_flag_is_refused(self):
        payload = self._payload()
        del payload["competing_venue"]["control_matches_primary"]
        self.assertTrue(self._errors(payload))

    def test_a_failing_arming_verdict_is_accepted_when_self_consistent(self):
        # The point of the whole leg: a red arming verdict is evidence, not a
        # broken artifact. `--check` must still pass on it.
        payload = self._payload()
        for level in payload["competing_venue"]["rungs"]:
            payload["competing_venue"]["rungs"][level] = {
                **payload["competing_venue"]["rungs"][level],
                "meta": {
                    "decidable_harm": 10,
                    "decidable_harm_false_pass_rate": "0.050000",
                    "decision_grade_formation_rate": "0.100000",
                    "not_decision_grade": 8,
                },
            }
        payload["competing_venue"]["arming_by_class"]["meta"] = False
        payload["competing_venue"]["security_leg_clean"] = False
        # The fixture fails `meta` at EVERY rung, so the stress verdict has to
        # move with it. Leaving it True is what the checker is for, and it
        # caught this fixture when the stress leg was first added.
        payload["competing_venue"]["stress_by_class"]["meta"] = False
        self.assertEqual(self._errors(payload), [])

    def test_an_arming_verdict_that_ignores_a_failing_class_is_refused(self):
        payload = self._payload()
        payload["competing_venue"]["arming_by_class"]["meta"] = False
        payload["competing_venue"]["security_leg_clean"] = True
        self.assertTrue(self._errors(payload))

    def test_a_composite_arming_verdict_is_refused_outright(self):
        # The checker must refuse the field's RETURN, not merely stop emitting
        # it: a future contributor recomposing the two legs into one boolean
        # would otherwise reintroduce the exact false comfort this artifact
        # was corrected to remove.
        payload = self._payload()
        payload["competing_venue"]["arming_ready"] = True
        self.assertTrue(self._errors(payload))

    def test_a_missing_liveness_magnitude_is_refused(self):
        payload = self._payload()
        del payload["competing_venue"]["liveness_loss_at_arming"]
        self.assertTrue(self._errors(payload))

    def test_dropping_the_stress_rung_is_refused(self):
        # Without it the artifact presents an anchored verdict as an
        # unconditional one — the whole point of the correction that added it.
        payload = self._payload()
        del payload["competing_venue"]["stress_diversion"]
        self.assertTrue(self._errors(payload))

    def test_a_stress_rung_at_or_below_the_arming_rung_is_refused(self):
        payload = self._payload()
        payload["competing_venue"]["stress_diversion"] = ARMING
        self.assertTrue(self._errors(payload))

    def test_stress_verdicts_must_agree_with_the_measured_rates(self):
        payload = self._payload()
        payload["competing_venue"]["stress_by_class"]["param"] = False
        self.assertTrue(self._errors(payload))


class ConfigValidationTests(unittest.TestCase):
    def test_diversion_must_be_a_proper_fraction(self):
        for bad in ("-0.01", "1.00", "1.50"):
            with self.assertRaises(ValueError):
                replace(SimulationConfig(), competing_venue_diversion=bad).validate()

    def test_ladder_must_probe_above_the_arming_rung(self):
        # The proportional-flow model that anchors the arming rung at one half
        # errs in the UNSAFE direction (flow can exceed depth share), so a
        # ladder that stops at the anchor never probes its own weakest
        # assumption. An earlier revision REFUSED rungs above 0.50; that was
        # backwards and this test pins the corrected direction.
        with self.assertRaises(ValueError):
            replace(
                SimulationConfig(), competing_venue_diversions=("0.25", "0.50")
            ).validate()

    def test_a_rung_above_the_arming_rung_is_admissible(self):
        replace(
            SimulationConfig(), competing_venue_diversions=("0.50", "0.90")
        ).validate()

    def test_ladder_must_contain_the_arming_rung(self):
        with self.assertRaises(ValueError):
            replace(
                SimulationConfig(), competing_venue_diversions=("0.10", "0.25")
            ).validate()

    def test_ladder_must_be_strictly_increasing(self):
        for bad in (("0.50", "0.25"), ("0.25", "0.25", "0.50")):
            with self.assertRaises(ValueError):
                replace(SimulationConfig(), competing_venue_diversions=bad).validate()

    def test_ladder_is_canonicalized_as_a_list(self):
        canonical = SimulationConfig().canonical()["competing_venue_diversions"]
        self.assertEqual(canonical, ["0.25", "0.50", "0.75"])
        self.assertIsInstance(canonical, list)


if __name__ == "__main__":
    unittest.main()
