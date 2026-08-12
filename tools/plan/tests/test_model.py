"""The frontmatter parser refuses everything it does not understand.

It is deliberately narrower than YAML, matching tools/deploy/check-runbooks.py.
A permissive parser would re-admit the ambiguity the split exists to remove.
"""

import tempfile
import unittest
from pathlib import Path

from tools.plan.model import (
    PlanError,
    load_milestones,
    parse_frontmatter,
)

MILESTONE = """---
id: F8
track: F
title: FE-6 packages/local-index — three-layer history
spec: ["10 §6", "10 §7"]
depends: [F3]
status: done
verify: [V-201]
---

Three-layer history, gap-tolerant coverage, candles.
"""


class FrontmatterTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, name: str, text: str) -> Path:
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def test_parses_scalars_lists_and_body(self):
        values, body = parse_frontmatter(self.write("F8.md", MILESTONE))
        self.assertEqual(values["id"], "F8")
        self.assertEqual(values["spec"], ["10 §6", "10 §7"])
        self.assertEqual(values["depends"], ["F3"])
        self.assertIn("gap-tolerant coverage", body)

    def test_rejects_a_tab(self):
        text = MILESTONE.replace("track: F", "track:\tF")
        with self.assertRaises(PlanError) as caught:
            parse_frontmatter(self.write("F8.md", text))
        self.assertIn("tabs are forbidden", str(caught.exception))

    def test_rejects_a_duplicate_key(self):
        text = MILESTONE.replace("status: done", "status: done\nstatus: pending")
        with self.assertRaises(PlanError) as caught:
            parse_frontmatter(self.write("F8.md", text))
        self.assertIn("duplicate", str(caught.exception))

    def test_rejects_block_scalar_syntax(self):
        text = MILESTONE.replace("title: FE-6 packages/local-index — three-layer history", "title: |")
        with self.assertRaises(PlanError) as caught:
            parse_frontmatter(self.write("F8.md", text))
        self.assertIn("unsupported frontmatter syntax", str(caught.exception))

    def test_rejects_a_missing_closing_delimiter(self):
        with self.assertRaises(PlanError) as caught:
            parse_frontmatter(self.write("F8.md", "---\nid: F8\n"))
        self.assertIn("no closing ---", str(caught.exception))


class LoadMilestonesTests(FrontmatterTests):
    def test_loads_a_milestone(self):
        self.write("plan/milestones/F8.md", MILESTONE)
        items, errors = load_milestones(self.root)
        self.assertEqual(errors, [])
        self.assertEqual(items[0].id, "F8")
        self.assertEqual(items[0].status, "done")
        self.assertEqual(items[0].spec, ("10 §6", "10 §7"))

    def test_id_must_match_the_filename(self):
        self.write("plan/milestones/F9.md", MILESTONE)
        _, errors = load_milestones(self.root)
        self.assertTrue(any("does not match its filename" in e for e in errors))

    def test_status_must_be_in_the_enum(self):
        self.write("plan/milestones/F8.md", MILESTONE.replace("status: done", "status: finished"))
        _, errors = load_milestones(self.root)
        self.assertTrue(any("status must be one of" in e for e in errors))

    def test_unknown_key_is_refused(self):
        self.write("plan/milestones/F8.md", MILESTONE.replace("track: F", "track: F\nowner: nobody"))
        _, errors = load_milestones(self.root)
        self.assertTrue(any("unknown key 'owner'" in e for e in errors))
