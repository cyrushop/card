"""Run: python3 -I tests/test_auto_update.py   (no network: the bots are replaced by a fake runner)"""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bot"))
import auto_update as au  # noqa: E402

DAY = 86400


class AutoUpdate(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name
        self.calls = []

    def tearDown(self):
        self.tmp.cleanup()

    def set_mode(self, **auto):
        with open(os.path.join(self.dir, "collection.json"), "w") as f:
            json.dump({"owned": {}, "settings": {"autoUpdate": auto}}, f)

    def runner(self, code=0):
        def fake(cmd, env):
            self.calls.append(os.path.basename(cmd[0]))
            assert env["OPCG_DATA"] == self.dir
            return code, "Reading...\n更新結果：\n  新系列：沒有\n  新卡：0 張\n"
        return fake

    def status(self):
        with open(os.path.join(self.dir, "auto-update.json")) as f:
            return json.load(f)

    def test_manual_mode_does_nothing(self):
        self.set_mode(mode="manual")
        self.assertEqual(au.run(self.dir, runner=self.runner()), [])
        self.assertEqual(self.calls, [])
        self.assertEqual(self.status()["mode"], "manual")
        # No setting at all also means manual.
        os.remove(os.path.join(self.dir, "collection.json"))
        self.assertEqual(au.run(self.dir, runner=self.runner()), [])

    def test_force_runs_even_in_manual_mode(self):
        self.set_mode(mode="manual", prices=False)
        au.run(self.dir, force=True, runner=self.runner())
        self.assertEqual(self.calls, ["scrape_cards.py", "scrape_decks.py"])

    def test_daily_schedule(self):
        self.set_mode(mode="auto", every="daily", decks=False)
        t0 = 1_800_000_000
        self.assertEqual(au.run(self.dir, now=t0, runner=self.runner()), [("cards", 0), ("prices", 0)])
        self.assertEqual(self.status()["tasks"]["cards"]["summary"], ["更新結果：", "新系列：沒有", "新卡：0 張"])
        self.calls.clear()
        au.run(self.dir, now=t0 + 3600, runner=self.runner())  # one hour later: nothing due
        self.assertEqual(self.calls, [])
        au.run(self.dir, now=t0 + DAY, runner=self.runner())   # next day, same time: due again
        self.assertEqual(self.calls, ["scrape_cards.py", "scrape_prices.py"])

    def test_weekly_and_failures_are_retried(self):
        self.set_mode(mode="auto", every="weekly", prices=False, decks=False)
        conf = au.settings(self.dir)
        now = 1_800_000_000
        self.assertEqual(au.due_tasks(conf, {"cards": {"okAt": now - 3 * DAY}}, now), [])
        self.assertEqual(au.due_tasks(conf, {"cards": {"okAt": now - 7 * DAY}}, now), ["cards"])
        # A failed run keeps the last success, so the task is still due next time.
        res = au.run(self.dir, now=now, runner=self.runner(code=1))
        self.assertEqual(res, [("cards", 1)])
        self.assertNotIn("okAt", self.status()["tasks"]["cards"])
        self.assertEqual(au.due_tasks(conf, self.status()["tasks"], now + 60), ["cards"])

    def test_lock_prevents_two_runs_at_once(self):
        self.set_mode(mode="auto")
        open(os.path.join(self.dir, "auto-update.lock"), "w").close()
        self.assertEqual(au.run(self.dir, runner=self.runner()), [])
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
