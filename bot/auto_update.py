#!/usr/bin/env python3
"""Automatic updates: runs the bots that are due, following the choice made in
the app (設定 → 更新方式). Does nothing while the app is set to manual.

    python3 bot/auto_update.py           # run what is due
    python3 bot/auto_update.py --force   # run every enabled update now

Who calls it:
  * serve.py on a computer: every 30 minutes while the app is open.
  * Google Cloud: a Cloud Run job started daily by Cloud Scheduler (deploy/deploy.sh).

The setting lives in data/collection.json -> settings.autoUpdate:
    {"mode": "auto" | "manual", "every": "daily" | "weekly",
     "cards": true, "prices": true, "decks": true}
Results go to data/auto-update.json, which the app shows in Settings.
Standard library only.
"""
import argparse
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.abspath(os.environ.get("OPCG_DATA") or os.path.join(HERE, "..", "data"))

# task -> (bot command, label shown in the app)
TASKS = {
    "cards": ([os.path.join(HERE, "scrape_cards.py"), "--images"], "卡表及卡圖"),
    "prices": ([os.path.join(HERE, "scrape_prices.py")], "價格"),
    "decks": ([os.path.join(HERE, "scrape_decks.py")], "熱門牌組"),
}
INTERVAL = {"daily": 20 * 3600, "weekly": 6.5 * 86400}  # a little under a day / a week, so a fixed daily time never slips
LOCK_STALE = 4 * 3600
# Exit code when another update holds the lock: the run did nothing, and it must not look like a
# success (a manual update started from GitHub only sees the exit code).
LOCKED = 75


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def settings(data_dir):
    s = (load_json(os.path.join(data_dir, "collection.json"), {}).get("settings") or {}).get("autoUpdate") or {}
    return {
        "mode": s.get("mode") if s.get("mode") in ("auto", "manual") else "manual",
        "every": s.get("every") if s.get("every") in INTERVAL else "daily",
        "tasks": [t for t in TASKS if s.get(t, True)],
    }


def due_tasks(conf, last, now, force=False):
    """Enabled tasks whose last successful run is older than the chosen interval."""
    if conf["mode"] != "auto" and not force:
        return []
    out = []
    for t in conf["tasks"]:
        prev = (last.get(t) or {}).get("okAt") or 0
        if force or now - prev >= INTERVAL[conf["every"]]:
            out.append(t)
    return out


def default_runner(cmd, env):
    p = subprocess.run([sys.executable, "-u", "-I"] + cmd, env=env, stdout=subprocess.PIPE,
                       stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
    return p.returncode, p.stdout


def run(data_dir=DATA, force=False, now=None, runner=default_runner):
    """Run what is due. Returns the list of (task, exit code)."""
    os.makedirs(data_dir, exist_ok=True)
    now_given = now is not None
    now = now if now_given else time.time()
    lock = os.path.join(data_dir, "auto-update.lock")
    if os.path.exists(lock) and now - os.path.getmtime(lock) < LOCK_STALE:
        mins = int((now - os.path.getmtime(lock)) // 60)
        print(f"另一次更新正在進行（{mins} 分鐘前開始），這次沒有執行，以失敗結束（代碼 {LOCKED}）。請稍後再試。")
        return [("locked", LOCKED)]
    status_path = os.path.join(data_dir, "auto-update.json")
    status = load_json(status_path, {})
    last = status.get("tasks") or {}
    conf = settings(data_dir)
    todo = due_tasks(conf, last, now, force)
    status["checkedAt"] = now
    status["mode"] = conf["mode"]
    if not todo:
        save_json(status_path, status)
        print("手動模式，不會自動更新。" if conf["mode"] != "auto" and not force else "未到更新時間。")
        return []
    with open(lock, "w") as f:
        f.write(str(os.getpid()))
    results = []
    try:
        env = dict(os.environ, OPCG_DATA=data_dir)
        for t in todo:
            cmd, label = TASKS[t]
            print(f"== 更新{label}")
            started = now if now_given else time.time()
            code, out = runner(cmd, env)
            lines = [l.strip() for l in (out or "").splitlines() if l.strip()]
            # Keep the Chinese summary the card bot prints, else the last lines.
            i = next((k for k, l in enumerate(lines) if l.startswith("更新結果")), None)
            summary = lines[i:] if i is not None else lines[-3:]
            rec = {"at": started, "code": code, "summary": summary[-6:]}
            if code == 0:
                rec["okAt"] = started
            elif (last.get(t) or {}).get("okAt"):
                rec["okAt"] = last[t]["okAt"]  # keep the last success so it is retried next time
            last[t] = rec
            results.append((t, code))
            print(("  完成" if code == 0 else f"  失敗（代碼 {code}）") + (": " + " / ".join(summary[-2:]) if summary else ""))
            status["tasks"] = last
            save_json(status_path, status)
    finally:
        try:
            os.remove(lock)
        except OSError:
            pass
    return results


def main(argv=None, data_dir=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--force", action="store_true", help="run every enabled update now, even in manual mode")
    args = ap.parse_args(argv)
    results = run(data_dir or DATA, force=args.force)
    codes = [code for _, code in results]
    if LOCKED in codes:
        return LOCKED
    return 1 if any(codes) else 0


if __name__ == "__main__":
    sys.exit(main())
