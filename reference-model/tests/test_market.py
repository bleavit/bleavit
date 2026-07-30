import unittest

from bleavit_reference_model.market import (
    MARKET_FEE_BPS,
    USDC_SCALE,
    BaselineBook,
    BaselineMarketError,
    InsufficientBookInventory,
)


class BaselineMarketTests(unittest.TestCase):
    def test_buy_segregates_a_complete_fee_set_before_delivery(self):
        seed = 7_000 * USDC_SCALE
        amount = 1_000 * USDC_SCALE
        book = BaselineBook(
            epoch=4,
            b=10_000 * USDC_SCALE,
            book_long=seed,
            book_short=seed,
        )

        execution = book.buy("Long", amount, MARKET_FEE_BPS)

        self.assertGreater(execution["fee"], 0)
        self.assertEqual(book.fees_long, execution["fee"])
        self.assertEqual(book.fees_short, execution["fee"])
        self.assertEqual(book.book_long, seed + execution["cost"] - amount)
        self.assertEqual(book.book_short, seed + execution["cost"])
        self.assertEqual(book.buyer_long, amount)
        self.assertEqual(book.buyer_short, 0)

    def test_thin_book_refuses_atomically_instead_of_using_fee_revenue(self):
        amount = 1_000 * USDC_SCALE
        probe = BaselineBook(
            epoch=4,
            b=10_000 * USDC_SCALE,
            book_long=0,
            book_short=0,
        )
        cost, fee = probe.quote_buy("Long", amount)
        inventory = amount - cost - 1
        self.assertEqual(inventory + cost, amount - 1)
        self.assertGreaterEqual(inventory + cost + fee, amount)

        book = BaselineBook(
            epoch=4,
            b=10_000 * USDC_SCALE,
            book_long=inventory,
            book_short=inventory,
        )
        before = book.balances()
        with self.assertRaises(InsufficientBookInventory):
            book.buy("Long", amount)
        self.assertEqual(book.balances(), before)
        self.assertEqual((book.q_long, book.q_short), (0, 0))

    def test_sweep_requires_terminal_and_redeems_only_the_complete_set(self):
        book = BaselineBook(
            epoch=4,
            b=10_000 * USDC_SCALE,
            book_long=0,
            book_short=0,
            fees_long=17,
            fees_short=11,
        )
        with self.assertRaises(BaselineMarketError):
            book.sweep_buy_fees()

        book.settle()
        self.assertEqual(book.sweep_buy_fees(), 11)
        self.assertEqual((book.fees_long, book.fees_short), (6, 0))
        self.assertEqual(book.main_usdc, 11)
        self.assertEqual(book.sweep_buy_fees(), 0)


if __name__ == "__main__":
    unittest.main()
