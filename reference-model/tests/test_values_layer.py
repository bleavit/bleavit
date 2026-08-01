"""Derives 06 §2.1 and 08 §2.1 without implementation artifacts.

The six-track table and genesis allocations come only from architecture text.
SQ-560 pins the missing support denominator while treating controller
coordination and vesting-vote eligibility as explicit scenario inputs. No Rust
constant, runtime configuration, or chain-spec validator is an oracle here.
"""

import unittest
from dataclasses import replace
from fractions import Fraction
from pathlib import Path

from bleavit_reference_model.values_layer import (
    BLOCKS_PER_DAY,
    COMMUNITY_DISTRIBUTION_VIT,
    ECOSYSTEM_OPS_VIT,
    FOUNDING_TEAM_VIT,
    GENESIS_ALLOCATIONS,
    GENESIS_PHASE,
    GenesisVotingScenario,
    INCENTIVE_PROGRAMS_VIT,
    TREASURY_RESERVE_VIT,
    VIT_TOTAL_SUPPLY,
    VoteBloc,
    ValuesLayerError,
    check_claims,
    document_tracks,
    genesis_coalition_outcomes,
    genesis_electorate,
    minimum_aye_stake_at_start,
    passes_at_start,
    signable_at,
    support_base_mentions,
    tally_votes,
)


REPO_ROOT = Path(__file__).resolve().parents[2]


class TrackTableDerivationTests(unittest.TestCase):
    """06 §2.1 is the sole source for all six track records."""

    @classmethod
    def setUpClass(cls):
        cls.document = document_tracks(REPO_ROOT)

    def test_all_six_named_tracks_are_parsed_from_the_document(self):
        names = (
            "metric",
            "constitution",
            "entrenched",
            "guardian",
            "ratify",
            "oracle",
        )
        self.assertEqual(tuple(track.name for track in self.document), names)

    def test_document_rows_derive_the_published_starting_support_floors(self):
        self.assertEqual(
            {track.name: track.support.start for track in self.document},
            {
                "metric": Fraction(10, 100),
                "constitution": Fraction(15, 100),
                "entrenched": Fraction(20, 100),
                "guardian": Fraction(5, 100),
                "ratify": Fraction(5, 100),
                "oracle": Fraction(10, 100),
            },
        )

    def test_entrenched_enactment_uses_the_published_epoch_ceiling(self):
        # Regression pin for 06 §2.1's exceptional symbolic duration: four
        # times the 42-day epoch ceiling, not four times the 21-day default.
        entrenched = next(track for track in self.document if track.name == "entrenched")
        self.assertEqual(entrenched.enactment_blocks, 168 * BLOCKS_PER_DAY)


class GenesisAllocationTests(unittest.TestCase):
    """08 §2.1 custody, with vesting eligibility kept conditional."""

    def test_five_allocations_derive_the_fixed_total_supply(self):
        amounts = [allocation.amount_vit for allocation in GENESIS_ALLOCATIONS]
        self.assertEqual(
            amounts,
            [
                TREASURY_RESERVE_VIT,
                COMMUNITY_DISTRIBUTION_VIT,
                FOUNDING_TEAM_VIT,
                ECOSYSTEM_OPS_VIT,
                INCENTIVE_PROGRAMS_VIT,
            ],
        )
        self.assertEqual(sum(amounts), VIT_TOTAL_SUPPLY)
        self.assertEqual(
            [allocation.share for allocation in GENESIS_ALLOCATIONS],
            [
                Fraction(30, 100),
                Fraction(25, 100),
                Fraction(20, 100),
                Fraction(15, 100),
                Fraction(10, 100),
            ],
        )

    def test_vesting_eligible_scenario_has_two_keyed_allocations(self):
        signable = signable_at(GENESIS_PHASE, vesting_vote_eligible=True)
        self.assertEqual(
            tuple(allocation.name for allocation in signable),
            ("founding_team", "ecosystem_ops_fund"),
        )
        founding = next(
            allocation for allocation in signable if allocation.name == "founding_team"
        )
        self.assertTrue(founding.vesting_locked)
        self.assertEqual(sum(allocation.amount_vit for allocation in signable), 350_000_000)
        self.assertEqual(
            sum(
                allocation.amount_vit
                for allocation in GENESIS_ALLOCATIONS
                if not allocation.keyed_account
            ),
            650_000_000,
        )

    def test_vesting_ineligible_scenario_excludes_the_founding_allocation(self):
        signable = signable_at(GENESIS_PHASE, vesting_vote_eligible=False)
        self.assertEqual(
            tuple(allocation.name for allocation in signable),
            ("ecosystem_ops_fund",),
        )
        self.assertEqual(sum(item.amount_vit for item in signable), 150_000_000)

    def test_phase_does_not_manufacture_a_signing_key_for_a_protocol_pot(self):
        for phase in range(8):
            with self.subTest(phase=phase):
                self.assertEqual(
                    tuple(
                        allocation.name
                        for allocation in signable_at(
                            phase, vesting_vote_eligible=True
                        )
                    ),
                    ("founding_team", "ecosystem_ops_fund"),
                )
        with self.assertRaises(ValuesLayerError):
            signable_at(8, vesting_vote_eligible=True)


class GenesisElectorateTests(unittest.TestCase):
    """SQ-560 as conditional scenarios around two document properties."""

    @classmethod
    def setUpClass(cls):
        cls.tracks = document_tracks(REPO_ROOT)

    @staticmethod
    def scenario(
        *,
        coalition: tuple[str, ...],
        vesting_vote_eligible: bool,
        turnout_base_vit: int | None,
    ) -> GenesisVotingScenario:
        return GenesisVotingScenario(
            controller_coalition=coalition,
            vesting_vote_eligible=vesting_vote_eligible,
            turnout_base_vit=turnout_base_vit,
        )

    def test_docs_never_name_the_support_base_and_absence_is_reported(self):
        """SQ-560. 06 publishes support percentages without their denominator.

        Neither 06 nor 13 names turnout, a support base, or a support
        denominator. The model accepts ``None`` rather than importing a Rust
        implementation choice, and declines to evaluate support thresholds.
        """
        scenario = self.scenario(
            coalition=("founding_team", "ecosystem_ops_fund"),
            vesting_vote_eligible=True,
            turnout_base_vit=None,
        )
        self.assertEqual(support_base_mentions(REPO_ROOT), ())
        findings = {item.key: item for item in check_claims(
            REPO_ROOT, self.tracks, scenario=scenario
        )}
        self.assertFalse(findings["06.support-turnout-base-specified"].ok)
        self.assertTrue(findings["A-3.genesis-capture-scenario"].ok)
        self.assertIn(
            "turnout base absent",
            findings["A-3.genesis-capture-scenario"].detail,
        )

    def test_no_external_stake_and_650m_keyless_are_unconditional(self):
        scenario = self.scenario(
            coalition=(),
            vesting_vote_eligible=False,
            turnout_base_vit=None,
        )
        electorate = genesis_electorate(scenario=scenario)
        self.assertEqual(electorate.external_signable_vit, 0)
        self.assertEqual(electorate.keyless_vit, 650_000_000)
        self.assertEqual(electorate.ineligible_vesting_vit, 200_000_000)
        finding = next(
            item
            for item in check_claims(REPO_ROOT, self.tracks, scenario=scenario)
            if item.key == "08.external-signable-genesis-stake-is-zero"
        )
        self.assertTrue(finding.ok)

    def test_collusion_and_vesting_eligibility_change_the_scenario_result(self):
        colluding = self.scenario(
            coalition=("founding_team", "ecosystem_ops_fund"),
            vesting_vote_eligible=True,
            turnout_base_vit=VIT_TOTAL_SUPPLY,
        )
        separate = self.scenario(
            coalition=(),
            vesting_vote_eligible=True,
            turnout_base_vit=VIT_TOTAL_SUPPLY,
        )
        vesting_ineligible = self.scenario(
            coalition=("founding_team", "ecosystem_ops_fund"),
            vesting_vote_eligible=False,
            turnout_base_vit=VIT_TOTAL_SUPPLY,
        )
        electorate = genesis_electorate(scenario=colluding)
        self.assertEqual(electorate.signable_vit, 350_000_000)
        self.assertEqual(electorate.coalition_signable_vit, 350_000_000)
        self.assertEqual(electorate.external_signable_vit, 0)
        self.assertEqual(electorate.keyless_vit, 650_000_000)
        self.assertEqual(electorate.signable_share_of_base, Fraction(35, 100))
        self.assertEqual(electorate.coalition_share_of_signable, 1)
        self.assertEqual(
            genesis_electorate(scenario=separate).coalition_signable_vit, 0
        )
        ineligible = genesis_electorate(scenario=vesting_ineligible)
        self.assertEqual(ineligible.signable_vit, 150_000_000)
        self.assertEqual(ineligible.coalition_signable_vit, 150_000_000)

    def test_colluding_total_supply_scenario_clears_every_track_conditionally(self):
        scenario = self.scenario(
            coalition=("founding_team", "ecosystem_ops_fund"),
            vesting_vote_eligible=True,
            turnout_base_vit=VIT_TOTAL_SUPPLY,
        )
        outcomes = genesis_coalition_outcomes(self.tracks, scenario=scenario)
        self.assertEqual(len(outcomes), 6)
        self.assertTrue(all(outcome.passed for outcome in outcomes))
        self.assertEqual({outcome.support for outcome in outcomes}, {Fraction(35, 100)})
        self.assertEqual({outcome.approval for outcome in outcomes}, {Fraction(1)})
        finding = next(
            item
            for item in check_claims(REPO_ROOT, self.tracks, scenario=scenario)
            if item.key == "A-3.genesis-capture-scenario"
        )
        self.assertTrue(finding.ok)
        self.assertIn("conditional only", finding.detail)
        self.assertIn("scenario clears: metric", finding.detail)

    def test_founding_only_total_supply_scenario_meets_each_support_floor(self):
        # This is a sensitivity under an explicitly supplied one-billion-VIT
        # denominator and a whole-allocation founding controller.
        outcomes = [
            passes_at_start(
                track,
                (VoteBloc("founding", FOUNDING_TEAM_VIT, True),),
                turnout_base_vit=VIT_TOTAL_SUPPLY,
            )
            for track in self.tracks
        ]
        self.assertTrue(all(outcome.passed for outcome in outcomes))
        entrenched = next(outcome for outcome in outcomes if outcome.track == "entrenched")
        self.assertEqual(entrenched.support, Fraction(20, 100))
        self.assertEqual(entrenched.required_support, Fraction(20, 100))

    def test_minimum_stake_is_derived_and_rounds_against_the_claimant(self):
        required = {
            track.name: minimum_aye_stake_at_start(
                track, turnout_base_vit=VIT_TOTAL_SUPPLY
            )
            for track in self.tracks
        }
        self.assertEqual(
            required,
            {
                "metric": 100_000_000,
                "constitution": 150_000_000,
                "entrenched": 200_000_000,
                "guardian": 50_000_000,
                "ratify": 50_000_000,
                "oracle": 100_000_000,
            },
        )
        # Isolate approval from the support leg: 67% against one nay requires
        # ceil(67/33)=3 VIT, never a claimant-favouring truncation to 2.
        constitution = next(track for track in self.tracks if track.name == "constitution")
        approval_only = replace(
            constitution,
            support=replace(constitution.support, start=Fraction(0), end=Fraction(0)),
        )
        self.assertEqual(
            minimum_aye_stake_at_start(
                approval_only,
                turnout_base_vit=VIT_TOTAL_SUPPLY,
                opposition_vit=1,
            ),
            3,
        )

    def test_invalid_scenario_inputs_refuse(self):
        with self.assertRaises(ValuesLayerError):
            GenesisVotingScenario(("founding_team", "founding_team"), True, None)
        with self.assertRaises(ValuesLayerError):
            genesis_electorate(
                scenario=GenesisVotingScenario(("unknown",), True, None)
            )
        with self.assertRaises(ValuesLayerError):
            genesis_coalition_outcomes(
                self.tracks,
                scenario=GenesisVotingScenario((), True, None),
            )


class ConvictionArithmeticTests(unittest.TestCase):
    """The audit's approval examples, including the symmetric-opposition caveat."""

    def test_founding_vs_community_at_one_to_six_x_reproduces_exact_approval(self):
        approvals = []
        for conviction in range(1, 7):
            tally = tally_votes(
                (
                    VoteBloc("founding", 200_000_000, True, conviction),
                    VoteBloc("community", 250_000_000, False, 1),
                ),
                turnout_base_vit=VIT_TOTAL_SUPPLY,
            )
            approvals.append(tally.approval)
            self.assertEqual(tally.support, Fraction(20, 100))
        self.assertEqual(
            approvals,
            [
                Fraction(4, 9),
                Fraction(8, 13),
                Fraction(12, 17),
                Fraction(16, 21),
                Fraction(4, 5),
                Fraction(24, 29),
            ],
        )

    def test_five_x_is_exactly_eighty_percent_and_six_x_is_827586_percent(self):
        five = tally_votes(
            (
                VoteBloc("founding", 200_000_000, True, 5),
                VoteBloc("community", 250_000_000, False, 1),
            ),
            turnout_base_vit=VIT_TOTAL_SUPPLY,
        )
        six = tally_votes(
            (
                VoteBloc("founding", 200_000_000, True, 6),
                VoteBloc("community", 250_000_000, False, 1),
            ),
            turnout_base_vit=VIT_TOTAL_SUPPLY,
        )
        self.assertEqual(five.approval, Fraction(80, 100))
        self.assertEqual(six.approval, Fraction(24, 29))

    def test_symmetric_conviction_can_defeat_the_claimed_asymmetry(self):
        founders_vs_two_x = tally_votes(
            (
                VoteBloc("founding", 200_000_000, True, 6),
                VoteBloc("community", 250_000_000, False, 2),
            ),
            turnout_base_vit=VIT_TOTAL_SUPPLY,
        )
        insiders_vs_three_x = tally_votes(
            (
                VoteBloc("insiders", 350_000_000, True, 6),
                VoteBloc("community", 250_000_000, False, 3),
            ),
            turnout_base_vit=VIT_TOTAL_SUPPLY,
        )
        self.assertEqual(founders_vs_two_x.approval, Fraction(12, 17))
        self.assertLess(founders_vs_two_x.approval, Fraction(80, 100))
        self.assertEqual(insiders_vs_three_x.approval, Fraction(14, 19))
        self.assertLess(insiders_vs_three_x.approval, Fraction(80, 100))

    def test_tally_refuses_more_capital_than_the_explicit_base(self):
        with self.assertRaises(ValuesLayerError):
            tally_votes(
                (VoteBloc("impossible", VIT_TOTAL_SUPPLY + 1, True),),
                turnout_base_vit=VIT_TOTAL_SUPPLY,
            )


if __name__ == "__main__":
    unittest.main()
