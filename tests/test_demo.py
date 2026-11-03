"""Run: python3 -I tests/test_demo.py

Checks the single-file demo built by tools/build_demo.py (sample data only, no network).
"""
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))
import build_demo  # noqa: E402


class DemoBuilder(unittest.TestCase):
    def test_sample_decks_have_one_leader(self):
        cards, _, _, _ = build_demo.build_data()
        by_id = {c["id"]: c for c in cards}
        for deck in build_demo.build_state(cards)["decks"]:
            leaders = [e["id"] for e in deck["entries"] if by_id[e["id"]]["category"] == "LEADER"]
            self.assertEqual(len(leaders), 1, f"{deck['name']}: {leaders}")
        self.assertEqual(by_id["OP13-001"]["category"], "LEADER")
        for cid in ("PRB02-003", "EB05-001", "ST32-002"):
            self.assertNotEqual(by_id[cid]["category"], "LEADER", cid)

    def test_page_is_a_full_document(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "demo.html")
            argv = sys.argv
            sys.argv = ["build_demo.py", out]
            try:
                with redirect_stdout(StringIO()):
                    build_demo.main()
            finally:
                sys.argv = argv
            with open(out, encoding="utf-8") as f:
                page = f.read()
        self.assertTrue(page.lower().startswith("<!doctype html>"))
        head = page.split("<body>", 1)[0]
        self.assertIn('<meta charset="utf-8">', head)
        self.assertIn('name="viewport"', head)
        self.assertIn("<style>", head)
        self.assertNotIn('href="style.css"', page)
        self.assertNotIn('src="engine.js"', page)
        self.assertTrue(page.rstrip().endswith("</html>"))
        self.assertIn("window.OPCG_DEMO = true;", page)
        # Only the three inline scripts close; nothing in the data ends a script early.
        self.assertEqual(page.lower().count("</script"), 3)

    def test_data_cannot_close_the_script(self):
        text = '</script><script>alert(1)</script><!-- 斯摩格'
        line = build_demo.js_assign("X", {"text": text})
        self.assertNotIn("<", line)
        self.assertTrue(line.startswith("window.X = ") and line.endswith(";"))
        self.assertEqual(json.loads(line[len("window.X = "):-1]), {"text": text})

    def test_inline_script_refuses_closing_tag(self):
        self.assertTrue(build_demo.inline_script("var a = 1;").startswith("<script>"))
        for bad in ('var s = "</script>";', "var s = '<!--';"):
            with self.assertRaises(SystemExit):
                build_demo.inline_script(bad, "x.js")


if __name__ == "__main__":
    unittest.main(verbosity=2)
