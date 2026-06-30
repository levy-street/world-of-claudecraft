import os
import queue
import subprocess
import sys
import types
import unittest
from collections import deque


class _Env:
    def reset(self, *, seed=None):
        return None


class _Box:
    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs


class _Discrete:
    def __init__(self, n):
        self.n = n


gymnasium = types.ModuleType("gymnasium")
gymnasium.Env = _Env
gymnasium.spaces = types.SimpleNamespace(Box=_Box, Discrete=_Discrete)
sys.modules.setdefault("gymnasium", gymnasium)

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))
from wow_env import WoWClassicEnv  # noqa: E402


class _Pipe:
    def __init__(self):
        self.writes = []
        self.closed = False

    def write(self, text):
        self.writes.append(text)

    def flush(self):
        pass

    def close(self):
        self.closed = True


class _Proc:
    def __init__(self, poll_value=None, wait_error=None):
        self.stdin = _Pipe()
        self.stdout = _Pipe()
        self.stderr = _Pipe()
        self._poll_value = poll_value
        self._wait_error = wait_error
        self.killed = False
        self.waits = 0

    def poll(self):
        return self._poll_value

    def wait(self, timeout=None):
        self.waits += 1
        if self._wait_error is not None and self.waits == 1:
            raise self._wait_error
        self._poll_value = 0
        return 0

    def kill(self):
        self.killed = True
        self._poll_value = -9


def env_for(proc):
    env = WoWClassicEnv.__new__(WoWClassicEnv)
    env._proc = proc
    env._closed = False
    env._request_timeout = 0.01
    env._stdout_lines = queue.Queue()
    env._stderr_tail = deque(maxlen=40)
    return env


class WoWEnvIpcTests(unittest.TestCase):
    def test_request_times_out_with_stderr_tail_when_child_stays_alive(self):
        proc = _Proc()
        env = env_for(proc)
        env._stderr_tail.append("sim exploded")

        with self.assertRaises(TimeoutError) as ctx:
            env._request({"cmd": "step", "action": 0})

        self.assertIn("did not respond", str(ctx.exception))
        self.assertIn("sim exploded", str(ctx.exception))
        self.assertEqual(proc.stdin.writes, ['{"cmd": "step", "action": 0}\n'])

    def test_request_reports_child_exit_before_writing(self):
        proc = _Proc(poll_value=7)
        env = env_for(proc)
        env._stderr_tail.append("stack trace line")

        with self.assertRaises(RuntimeError) as ctx:
            env._request({"cmd": "info"})

        self.assertIn("exited with code 7", str(ctx.exception))
        self.assertIn("stack trace line", str(ctx.exception))
        self.assertEqual(proc.stdin.writes, [])

    def test_close_does_not_block_on_request_and_kills_stuck_child(self):
        proc = _Proc(wait_error=subprocess.TimeoutExpired("env", 5))
        env = env_for(proc)

        env.close()

        self.assertEqual(proc.stdin.writes, ['{"cmd": "close"}\n'])
        self.assertTrue(proc.killed)
        self.assertTrue(proc.stdin.closed)
        self.assertTrue(proc.stdout.closed)
        self.assertTrue(proc.stderr.closed)

    def test_close_is_idempotent(self):
        proc = _Proc()
        env = env_for(proc)

        env.close()
        env.close()

        self.assertEqual(proc.waits, 1)


if __name__ == "__main__":
    unittest.main()
