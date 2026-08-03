"""Pins every published figure in 16 §5.2/§8.1/§8.2, 13 §1's fee-floor
derivation and 08 §10's instrument-D paragraph, so a spec table and the model
cannot drift apart silently.

The suite deliberately also pins what must NOT hold: the superseded displacement
form of `b_min`, and the reading of the tariff as per-market rather than
per-question. Both were real drafting errors in this section's history, and a
suite that only asserts the right answers cannot catch their return.
"""

import math
import unittest
from decimal import Decimal

from bleavit_reference_model import service_economics as se

STAKE = Decimal(100_000)
EPSILON = Decimal("0.05")


class CertificationSizingTests(unittest.TestCase):
    """16 §5.2 — what certification forces the client to post."""

    def test_b_min_matches_the_published_absorption_form(self):
        self.assertEqual(
            round(se.b_min(STAKE, EPSILON) / STAKE, 4), Decimal("14.2368")
        )

    def test_superseded_displacement_form_does_not_reproduce_it(self):
        # 16 §5.2 marks this form "do not use". It differs by ~1.9x, so
        # confusing the two silently halves the escrow a certified question
        # posts -- the failure this assertion exists to make loud.
        superseded = se.b_min_superseded(STAKE, EPSILON) / STAKE
        self.assertEqual(round(superseded, 4), Decimal("7.4749"))
        self.assertNotEqual(round(superseded, 4), Decimal("14.2368"))

    def test_b_min_rounds_up_against_the_relying_party(self):
        # R-7: rounding always goes against the claimant, and here the party
        # relying on the certificate is the one a short b_min would harm.
        for stake in (Decimal(1), Decimal(7), Decimal(999)):
            exact = 3 * stake / (
                2 * se._ln(Decimal("0.5") / (Decimal("0.5") - EPSILON))
            )
            self.assertGreaterEqual(se.b_min(stake, EPSILON), exact)

    def test_b_min_grows_as_epsilon_shrinks(self):
        # A tighter manipulation tolerance is strictly more expensive to certify.
        sizes = [se.b_min(STAKE, Decimal(e)) for e in ("0.10", "0.05", "0.02")]
        self.assertEqual(sizes, sorted(sizes))

    def test_client_subsidy_is_two_books_of_b_ln2_not_two_b(self):
        self.assertEqual(
            round(se.client_subsidy(STAKE, EPSILON) / STAKE, 3),
            Decimal("19.736"),
        )
        # The superseded figure conflated the liquidity parameter with the cash
        # funding it. 2*b_min would be 28.47*S; the corrected form is smaller.
        self.assertLess(
            se.client_subsidy(STAKE, EPSILON), 2 * se.b_min(STAKE, EPSILON)
        )


class RevenueInstrumentTests(unittest.TestCase):
    """16 §8.1/§8.2 and 08 §10's instrument-D paragraph."""

    def test_instrument_b_on_the_clients_own_escrow(self):
        self.assertEqual(
            round(se.instrument_b(STAKE, EPSILON) / STAKE, 4), Decimal("0.0296")
        )

    def test_instrument_d_at_the_adopted_rate(self):
        self.assertEqual(
            round(se.instrument_d(STAKE) / STAKE, 3), Decimal("0.100")
        )

    def test_instrument_d_is_77_percent_of_evidenced_revenue(self):
        share = se.instrument_d_share(STAKE, EPSILON)
        self.assertEqual(round(100 * share, 0), Decimal("77"))

    def test_the_superseded_100_bps_illustration_still_reproduces(self):
        # 08 s10 keeps the pre-adoption figure so the change is auditable.
        original = se.SVC_FEE_RATE
        try:
            se.SVC_FEE_RATE = Decimal(10_000_000) / Decimal(10**9)  # 100 bps
            self.assertEqual(
                round(se.instrument_d(STAKE) / STAKE, 3), Decimal("0.010")
            )
            self.assertEqual(
                round(100 * se.instrument_d_share(STAKE, EPSILON), 0),
                Decimal("25"),
            )
        finally:
            se.SVC_FEE_RATE = original

    def test_floor_crossover_is_3930_usdc(self):
        self.assertEqual(se.floor_crossover(), Decimal(3_930))

    def test_floor_binds_below_the_crossover_and_the_rate_above_it(self):
        self.assertEqual(se.instrument_d(Decimal(1_000)), se.SVC_FEE_FLOOR)
        self.assertEqual(se.instrument_d(Decimal(3_930)), se.SVC_FEE_FLOOR)
        self.assertGreater(se.instrument_d(Decimal(10_000)), se.SVC_FEE_FLOOR)

    def test_the_tariff_is_charged_per_question_not_per_market(self):
        # A question carries exactly two books, so a per-market reading charges
        # 2x what 16 s8.1's arithmetic justifies. The discriminator is the
        # share: 77% is the PUBLISHED figure (16 s8.2) and corresponds to the
        # per-question charge; 87% is DERIVED HERE as the counterfactual the
        # wrong reading would produce, and no document states it -- that is the
        # point, since a test that only restated the published number could not
        # tell the two readings apart. Same convention as the superseded b_min
        # assertion above and as S6-S11's `check_*` accessors: pin the derived
        # value, never assert a number back at a document that does not have it.
        per_question = se.instrument_d(STAKE)
        per_market = 2 * per_question
        b = se.instrument_b(STAKE, EPSILON)
        self.assertEqual(
            round(100 * per_question / (per_question + b), 0), Decimal("77")
        )
        self.assertEqual(
            round(100 * per_market / (per_market + b), 0), Decimal("87")
        )

    def test_instrument_d_share_excludes_hypothetical_order_flow(self):
        # D + B only. Instrument A depends on external traders showing up, and
        # 08 s10 forbids presenting that hypothesis as a forecast.
        d = se.instrument_d(STAKE)
        b = se.instrument_b(STAKE, EPSILON)
        self.assertEqual(se.instrument_d_share(STAKE, EPSILON), d / (d + b))


class FeeFloorDerivationTests(unittest.TestCase):
    """13 §1 — why the floor is 393 USDC and not the marginal cost."""

    def test_marginal_cost_per_question(self):
        self.assertEqual(
            round(se.marginal_cost_per_question(), 2), Decimal("15.42")
        )

    def test_floor_is_anchored_to_fully_allocated_not_marginal_cost(self):
        # Pricing a scarce slot at marginal cost prices it at ~zero. The floor
        # is 25x the marginal figure, and that ratio is the design statement.
        self.assertGreater(se.SVC_FEE_FLOOR, 25 * se.marginal_cost_per_question())

    def test_fully_allocated_cost_ceils_to_the_frozen_constant(self):
        for basis in (se.EPOCHS_PER_YEAR_STATED, se.EPOCHS_PER_YEAR_EXACT):
            allocated = se.fully_allocated_cost_per_question(basis)
            self.assertEqual(math.ceil(allocated), int(se.SVC_FEE_FLOOR))

    def test_published_intermediate_is_a_truncation_of_the_exact_quotient(self):
        # 13 s1 publishes 392.75. The exact quotient at its own stated 17.39
        # epochs/yr is 392.758, which it truncated rather than rounded. Neither
        # 392.758 nor the truncation to 392 appears in any document, and both
        # are pinned here as DERIVED values -- deliberately, per the convention
        # that a model never asserts a document's imprecise number back at it,
        # because doing so would freeze the imprecision instead of exposing it.
        # The frozen kernel constant 393 is unaffected either way: every basis
        # in `test_fully_allocated_cost_ceils_to_the_frozen_constant` ceils to
        # it, which is why this is an imprecision and not a defect.
        exact = se.fully_allocated_cost_per_question(se.EPOCHS_PER_YEAR_STATED)
        self.assertEqual(round(exact, 3), Decimal("392.758"))
        self.assertEqual(int(exact), 392)


if __name__ == "__main__":
    unittest.main()
