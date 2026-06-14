"""Unit tests for the WoWClassicEnv stdio IPC and teardown robustness.

These tests do not need the real Node env bundle. They run a tiny fake server
(plain Python, stdlib only) that speaks the same newline-delimited JSON protocol
and can be put into pathological modes (crash mid-episode, hang, ignore close).
The fake is launched through WoWClassicEnv itself by passing
``node_binary=sys.executable`` and a generated server script as ``server_path``,
so the real ``_request`` / ``_readline`` / ``close`` code paths are exercised.

Run (after `pip install gymnasium numpy`):
    python -m unittest python/test_wow_env.py
"""

from __future__ import annotations

import os
import shutil
import sys
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from wow_env import WoWClassicEnv  # noqa: E402

# A stdlib-only NDJSON server. ``__MODE__`` is substituted per scenario.
FAKE_SERVER = r'''
import sys, json, time, os

MODE = "__MODE__"
OBS = [0.0] * 8
INFO = {"obs_size": 8, "num_actions": 23, "actions": ["noop", "forward", "attack"], "max_level": 20}

def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()

while True:
    line = sys.stdin.readline()
    if not line:
        break
    line = line.strip()
    if not line:
        continue
    msg = json.loads(line)
    cmd = msg.get("cmd")
    if cmd == "info":
        send(INFO)
    elif cmd == "reset":
        send({"obs": OBS, "info": {}})
    elif cmd == "step":
        if MODE == "die_on_step":
            sys.stderr.write("boom: simulated crash in sim.tick()\n")
            sys.stderr.flush()
            os._exit(1)
        elif MODE == "hang_on_step":
            time.sleep(30)
            send({"obs": OBS, "reward": 0.0, "terminated": False, "truncated": False, "info": {}})
        elif MODE == "slow_step":
            time.sleep(1.0)  # exceeds the test's short request_timeout, then replies
            send({"obs": OBS, "reward": 1.0, "terminated": False, "truncated": False, "info": {}})
        elif MODE == "partial_then_hang":
            sys.stdout.write('{"obs": [0.0, 0.0')  # partial line, never newline-terminated
            sys.stdout.flush()
            time.sleep(30)
        else:
            send({"obs": OBS, "reward": 1.0, "terminated": False, "truncated": False, "info": {}})
    elif cmd == "close":
        if MODE == "stuck_close":
            continue  # never acknowledge close; the parent must kill us
        send({"ok": True})
        break
'''

_TMPDIRS: list[str] = []


def make_fake_env(mode: str, **kwargs) -> WoWClassicEnv:
    d = tempfile.mkdtemp(prefix="wow_env_test_")
    _TMPDIRS.append(d)
    path = os.path.join(d, "fake_server.py")
    with open(path, "w") as f:
        f.write(FAKE_SERVER.replace("__MODE__", mode))
    return WoWClassicEnv(server_path=path, node_binary=sys.executable, **kwargs)


def tearDownModule():
    for d in _TMPDIRS:
        shutil.rmtree(d, ignore_errors=True)


class HappyPathTest(unittest.TestCase):
    def test_info_reset_step_and_clean_close(self):
        env = make_fake_env("normal")
        try:
            self.assertEqual(env.observation_space.shape, (8,))
            self.assertEqual(env.action_space.n, 23)
            obs, info = env.reset(seed=1)
            self.assertEqual(obs.shape, (8,))
            obs, reward, terminated, truncated, info = env.step(0)
            self.assertEqual(reward, 1.0)
            self.assertFalse(terminated)
        finally:
            env.close()
        # close() is idempotent and leaves the child dead.
        env.close()
        self.assertIsNotNone(env._proc.poll())


class DeadChildTest(unittest.TestCase):
    def test_step_on_crashed_child_raises_and_surfaces_stderr(self):
        env = make_fake_env("die_on_step", request_timeout=5.0)
        try:
            env.reset(seed=1)
            with self.assertRaises(RuntimeError) as cm:
                env.step(0)
            # The child's stderr ("boom") must be surfaced, not swallowed.
            self.assertIn("boom", str(cm.exception))
        finally:
            env.close()


class HungChildTest(unittest.TestCase):
    def test_step_times_out_instead_of_blocking_forever(self):
        env = make_fake_env("hang_on_step", request_timeout=0.5)
        try:
            env.reset(seed=1)
            t0 = time.monotonic()
            with self.assertRaises(TimeoutError):
                env.step(0)
            self.assertLess(time.monotonic() - t0, 5.0)
        finally:
            env.close()


class StuckCloseTest(unittest.TestCase):
    def test_close_kills_a_child_that_ignores_close(self):
        env = make_fake_env("stuck_close", request_timeout=0.5)
        env.reset(seed=1)
        env.step(0)
        # Must neither raise nor hang even though the child never acks close.
        env.close()
        self.assertIsNotNone(env._proc.poll())
        self.assertTrue(env._proc.stdin.closed)
        self.assertTrue(env._proc.stdout.closed)


class TimeoutDesyncTest(unittest.TestCase):
    def test_env_is_unusable_after_a_timeout(self):
        # A slow (not dead) server's late response must never be read as the
        # answer to a later call. After a timeout the env is marked unusable.
        env = make_fake_env("slow_step", request_timeout=0.3)
        try:
            env.reset(seed=1)
            with self.assertRaises(TimeoutError):
                env.step(0)
            with self.assertRaises(RuntimeError):
                env.reset(seed=2)
            with self.assertRaises(RuntimeError):
                env.step(0)
        finally:
            env.close()


class PartialLineStallTest(unittest.TestCase):
    def test_partial_line_then_stall_still_times_out(self):
        # A child that writes a partial (un-terminated) line and then stalls
        # must still trip the timeout -- the deadline covers reading a complete
        # line, not just the first available byte.
        env = make_fake_env("partial_then_hang", request_timeout=0.5)
        try:
            env.reset(seed=1)
            t0 = time.monotonic()
            with self.assertRaises(TimeoutError):
                env.step(0)
            self.assertLess(time.monotonic() - t0, 5.0)
        finally:
            env.close()


if __name__ == "__main__":
    unittest.main()
