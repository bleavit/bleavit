"""Pins 06 §2.1↔runtime drift and executes 08 §2.1 against A-3.

The six-track check reads the document and runtime independently; it is red if
either changes alone. The allocation tests derive the signable electorate from
custody, not from the published shares alone: keyed vesting accounts can vote,
while three pallet-derived pots cannot sign. SQ-560 records the resulting A-3
genesis contradiction and the missing normative support denominator.
"""

import unittest
from dataclasses import replace
from fractions import Fraction
from pathlib import Path

from bleavit_reference_model.values_layer import (
    BLOCKS_PER_DAY,
    COMMUNITY_DISTRIBUTION_VIT,
    ECOSYSTEM_OPS_VIT,
    FOUNDING_CLIFF_BLOCKS,
    FOUNDING_TEAM_VIT,
    GENESIS_ALLOCATIONS,
    GENESIS_PHASE,
    INCENTIVE_PROGRAMS_VIT,
    MAX_CONVICTION_WEEKS,
    TREASURY_RESERVE_VIT,
    VIT_TOTAL_SUPPLY,
    VoteBloc,
    ValuesLayerError,
    check_claims,
    conviction_lock_extension_blocks,
    document_tracks,
    genesis_electorate,
    genesis_insider_outcomes,
    minimum_aye_stake_at_start,
    passes_at_start,
    runtime_tracks,
    runtime_turnout_base_vit,
    signable_at,
    support_base_mentions,
    tally_votes,
    track_differences,
    validator_classification,
)


REPO_ROOT = Path(__file__).resolve().parents[2]


class TrackTableDifferentialTests(unittest.TestCase):
    """06 §2.1 is the source; the Rust extraction is only its differential."""

    @classmethod
    def setUpClass(cls):
        cls.document = document_tracks(REPO_ROOT)
        cls.runtime = runtime_tracks(REPO_ROOT)

    def test_all_six_named_tracks_are_parsed_from_both_artifacts(self):
        names = (
            "metric",
            "constitution",
            "entrenched",
            "guardian",
            "ratify",
            "oracle",
        )
        self.assertEqual(tuple(track.name for track in self.document), names)
        self.assertEqual(tuple(track.name for track in self.runtime), names)
        self.assertEqual(tuple(track.track_id for track in self.runtime), tuple(range(6)))

    def test_document_and_runtime_track_tables_agree(self):
        # The load-bearing drift check: every deposit, schedule duration and
        # curve kind/endpoint is extracted independently before comparison.
        self.assertEqual(track_differences(self.document, self.runtime), ())

    def test_the_differential_detects_a_one_field_wrong_world(self):
        changed = list(self.runtime)
        changed[0] = replace(
            changed[0], decision_blocks=changed[0].decision_blocks + BLOCKS_PER_DAY
        )
        differences = track_differences(self.document, tuple(changed))
        self.assertEqual(len(differences), 1)
        self.assertEqual(
            (differences[0].track, differences[0].field),
            ("metric", "decision_blocks"),
        )

    def test_entrenched_enactment_uses_the_published_epoch_ceiling(self):
        # Regression pin for 06 §2.1's exceptional symbolic duration: four
        # times the 42-day epoch ceiling, not four times the 21-day default.
        entrenched = next(track for track in self.document if track.name == "entrenched")
        self.assertEqual(entrenched.enactment_blocks, 168 * BLOCKS_PER_DAY)
        self.assertEqual(
            next(track for track in self.runtime if track.name == "entrenched").enactment_blocks,
            entrenched.enactment_blocks,
        )


class GenesisAllocationTests(unittest.TestCase):
    """08 §2.1 custody determines who can sign, not transferability."""

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

    def test_vesting_locked_founding_vit_is_signable_but_protocol_pots_are_not(self):
        signable = signable_at(GENESIS_PHASE)
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
                if not allocation.signable_at(GENESIS_PHASE)
            ),
            650_000_000,
        )
        # 32 weeks = 224 days, wholly inside the one-year cliff. Because locks
        # overlay by max rather than sum, maximum conviction adds no transfer
        # restriction at genesis; it is economically free at that instant.
        self.assertEqual(
            conviction_lock_extension_blocks(
                existing_lock_blocks=FOUNDING_CLIFF_BLOCKS,
                conviction_weeks=MAX_CONVICTION_WEEKS,
            ),
            0,
        )

    def test_phase_does_not_manufacture_a_signing_key_for_a_protocol_pot(self):
        for phase in range(8):
            with self.subTest(phase=phase):
                self.assertEqual(
                    tuple(allocation.name for allocation in signable_at(phase)),
                    ("founding_team", "ecosystem_ops_fund"),
                )
        with self.assertRaises(ValuesLayerError):
            signable_at(8)

    def test_shipped_genesis_validator_enforces_the_same_partition(self):
        # The validator identifies three derived pots, exactly 200M of balances
        # with founding vesting rows, and exactly 150M in every other keyed row.
        validator = validator_classification(REPO_ROOT)
        self.assertEqual(validator.total_supply_vit, VIT_TOTAL_SUPPLY)
        self.assertEqual(validator.founding_vested_vit, FOUNDING_TEAM_VIT)
        self.assertEqual(validator.ecosystem_ops_keyed_vit, ECOSYSTEM_OPS_VIT)
        self.assertEqual(validator.protocol_pots_vit, 650_000_000)


class GenesisElectorateTests(unittest.TestCase):
    """A-3 and the Phase-4 ratification consequence, computed exactly."""

    @classmethod
    def setUpClass(cls):
        cls.tracks = document_tracks(REPO_ROOT)
        cls.turnout_base = runtime_turnout_base_vit(REPO_ROOT)

    def test_runtime_support_base_is_total_supply_but_the_docs_never_name_it(self):
        """SQ-560. 06 publishes support percentages without their denominator.

        The runtime sets MaxTurnout to the fixed one-billion-VIT total supply,
        but neither 06 nor 13 names turnout, MaxTurnout, a support base, or a
        support denominator. The model therefore requires the base as input.
        """
        self.assertEqual(self.turnout_base, VIT_TOTAL_SUPPLY)
        self.assertEqual(support_base_mentions(REPO_ROOT), ())
        finding = next(
            finding
            for finding in check_claims(
                REPO_ROOT, self.tracks, turnout_base_vit=self.turnout_base
            )
            if finding.key == "06.support-turnout-base-specified"
        )
        self.assertFalse(finding.ok)

    def test_sq_560_genesis_electorate_is_entirely_insider_controlled(self):
        """SQ-560. A-3 says the values electorate is not majority-captured.

        Executing 08 §2.1 yields 350M directly signable VIT, all in the
        founding and ecosystem/ops allocations, and zero external opposition
        stake before a protocol pot distributes. This is 100%, not merely a
        majority, of the electorate that can sign at genesis.
        """
        electorate = genesis_electorate(turnout_base_vit=self.turnout_base)
        self.assertEqual(electorate.signable_vit, 350_000_000)
        self.assertEqual(electorate.insider_signable_vit, 350_000_000)
        self.assertEqual(electorate.external_signable_vit, 0)
        self.assertEqual(electorate.keyless_vit, 650_000_000)
        self.assertEqual(electorate.signable_share_of_base, Fraction(35, 100))
        self.assertEqual(electorate.insider_share_of_signable, 1)
        finding = next(
            finding
            for finding in check_claims(
                REPO_ROOT, self.tracks, turnout_base_vit=self.turnout_base
            )
            if finding.key == "A-3.genesis-electorate-not-majority-captured"
        )
        self.assertFalse(finding.ok)

    def test_insiders_clear_every_track_against_all_external_genesis_opposition(self):
        outcomes = genesis_insider_outcomes(
            self.tracks, turnout_base_vit=self.turnout_base
        )
        self.assertEqual(len(outcomes), 6)
        self.assertTrue(all(outcome.passed for outcome in outcomes))
        self.assertEqual({outcome.support for outcome in outcomes}, {Fraction(35, 100)})
        self.assertEqual({outcome.approval for outcome in outcomes}, {Fraction(1)})
        finding = next(
            finding
            for finding in check_claims(
                REPO_ROOT, self.tracks, turnout_base_vit=self.turnout_base
            )
            if finding.key == "09.phase3-to-4-needs-external-aye"
        )
        self.assertFalse(finding.ok)

    def test_founding_allocation_alone_meets_every_starting_support_floor(self):
        # The most entrenched row binds exactly: 200M / 1B = 20%. With no nay
        # voter, approval is 100%, so equality is enough to clear all six rows.
        outcomes = [
            passes_at_start(
                track,
                (VoteBloc("founding", FOUNDING_TEAM_VIT, True),),
                turnout_base_vit=self.turnout_base,
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
                track, turnout_base_vit=self.turnout_base
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
                turnout_base_vit=self.turnout_base,
                opposition_vit=1,
            ),
            3,
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
