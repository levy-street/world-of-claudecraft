from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import types
import unittest
from collections import deque
from typing import Any

sys.path.insert(0, os.path.dirname(__file__))

numpy_stub = types.ModuleType("numpy")
numpy_stub.float32 = "float32"
numpy_stub.asarray = lambda value, dtype=None: value
sys.modules.setdefault("numpy", numpy_stub)

gym_stub = types.ModuleType("gymnasium")


class Env:
    def reset(self, *, seed=None):
        self.np_random = types.SimpleNamespace(integers=lambda start, stop: start)


class Box:
    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs


class Discrete:
    def __init__(self, value):
        self.value = value


gym_stub.Env = Env
gym_stub.spaces = types.SimpleNamespace(Box=Box, Discrete=Discrete)
sys.modules.setdefault("gymnasium", gym_stub)

import wow_env


class FakePipe:
    def __init__(self, broken: bool = False):
        self.broken = broken
        self.closed = False
        self.writes: list[str] = []
        self.flushed = False

    def write(self, value: str) -> None:
        if self.broken:
            raise BrokenPipeError("closed")
        self.writes.append(value)

    def flush(self) -> None:
        if self.broken:
            raise BrokenPipeError("closed")
        self.flushed = True

    def close(self) -> None:
        self.closed = True


class FakeProc:
    def __init__(self, returncode: int | None = None, wait_timeout: bool = False):
        self.returncode = returncode
        self.wait_timeout = wait_timeout
        self.stdin = FakePipe()
        self.stdout = FakePipe()
        self.stderr = FakePipe()
        self.killed = False
        self.wait_calls: list[float | None] = []

    def poll(self) -> int | None:
        return self.returncode

    def kill(self) -> None:
        self.killed = True
        self.returncode = -9

    def wait(self, timeout: float | None = None) -> int:
        self.wait_calls.append(timeout)
        if self.wait_timeout and not self.killed:
            raise subprocess.TimeoutExpired("node", timeout)
        if self.returncode is None:
            self.returncode = 0
        return self.returncode


def make_env(proc: FakeProc, *, stderr: list[str] | None = None, timeout: float = 0.01):
    env = object.__new__(wow_env.WoWClassicEnv)
    env._proc = proc
    env._closed = False
    env._request_timeout = timeout
    env._stdout_lines = queue.Queue()
    env._stderr_tail = deque(stderr or [], maxlen=40)
    return env


class WowEnvIpcTest(unittest.TestCase):
    def test_request_returns_json_reply(self):
        proc = FakeProc()
        env = make_env(proc)
        env._stdout_lines.put('{"ok": true, "value": 7}\n')

        self.assertEqual(env._request({"cmd": "info"}), {"ok": True, "value": 7})
        self.assertEqual(json.loads(proc.stdin.writes[0]), {"cmd": "info"})
        self.assertTrue(proc.stdin.flushed)

    def test_request_timeout_reports_stderr_tail(self):
        proc = FakeProc()
        env = make_env(proc, stderr=["stack line", "fatal detail"])

        with self.assertRaisesRegex(RuntimeError, "timed out waiting.*fatal detail"):
            env._request({"cmd": "step", "action": 1})

    def test_request_reports_exited_server_and_stderr(self):
        proc = FakeProc(returncode=7)
        env = make_env(proc, stderr=["boom"])

        with self.assertRaisesRegex(RuntimeError, "exit_code=7.*boom"):
            env._request({"cmd": "info"})
        self.assertEqual(proc.stdin.writes, [])

    def test_request_reports_broken_pipe_with_stderr(self):
        proc = FakeProc()
        proc.stdin = FakePipe(broken=True)
        env = make_env(proc, stderr=["pipe broke"])

        with self.assertRaisesRegex(RuntimeError, "pipe broke"):
            env._request({"cmd": "reset"})

    def test_close_kills_after_wait_timeout_and_closes_pipes(self):
        proc = FakeProc(wait_timeout=True)
        env = make_env(proc)
        env._request = lambda msg: None

        env.close()

        self.assertTrue(proc.killed)
        self.assertEqual(proc.wait_calls, [5, None])
        self.assertTrue(proc.stdin.closed)
        self.assertTrue(proc.stdout.closed)
        self.assertTrue(proc.stderr.closed)
        self.assertTrue(env._closed)

    def test_close_kills_when_close_request_fails(self):
        proc = FakeProc()
        env = make_env(proc, stderr=["request failed"])

        def fail(_msg: dict[str, Any]) -> None:
            raise RuntimeError("no reply")

        env._request = fail
        env.close()

        self.assertTrue(proc.killed)
        self.assertTrue(proc.stdin.closed)
        self.assertTrue(proc.stdout.closed)
        self.assertTrue(proc.stderr.closed)


if __name__ == "__main__":
    unittest.main()
