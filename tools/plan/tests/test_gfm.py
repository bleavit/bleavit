"""The shared GFM cell splitter, and the unescaping its callers need.

PLAN.md row S7 carries `boundary-screened \\| consumer-validated \\| unchecked`
inside its Milestone cell. Two gates split on a bare "|", read that row as eight
cells, and took the Spec ref as the Status — so a finished milestone counted as
open. The row is valid GFM, so check-plan-tables.py passed it.

Row SQ-523 omits its trailing pipe, which GFM allows. Any splitter that demands
both outer delimiters raises on real data, which is why this module moves the
existing implementation rather than writing a new one.
"""

import unittest

from tools.plan.gfm import split_cells, unescape_cell


class SplitCellsTests(unittest.TestCase):
    def test_plain_row(self):
        row = "| F8 | FE-6 local-index | 10 §6 | F3 | ✅ | done |"
        self.assertEqual(
            split_cells(row),
            ["F8", "FE-6 local-index", "10 §6", "F3", "✅", "done"],
        )

    def test_escaped_pipe_stays_inside_its_cell(self):
        row = (
            "| S7 | binding site (boundary-screened \\| consumer-validated "
            "\\| unchecked) | 13 §1 | S6 | ✅ | Done 2026-08-01. |"
        )
        cells = split_cells(row)
        self.assertEqual(len(cells), 6)
        self.assertEqual(cells[0], "S7")
        self.assertEqual(cells[4], "✅")

    def test_missing_trailing_pipe_is_accepted(self):
        row = "| SQ-523 | question | 15 §4.5 | 2026-07-29 | resolved 2026-07-30"
        self.assertEqual(len(split_cells(row)), 5)

    def test_unescape_cell_is_separate_from_splitting(self):
        cells = split_cells("| a \\| b | c |")
        self.assertEqual(cells[0], "a \\| b")
        self.assertEqual(unescape_cell(cells[0]), "a | b")
