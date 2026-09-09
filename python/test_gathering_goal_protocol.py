"""Regression tests for WoWClassicEnv's optional gathering-goal command methods.

Mocks the Node subprocess entirely (no live env_server.cjs, no real stdin/
stdout pipe): each test only checks the EXACT JSON payload written to a fake
stdin and that the mocked reply comes back untouched. This file does not
install its prerequisites. Run with Gymnasium and NumPy installed using
python3 -m unittest discover -s python -p test_gathering_goal_protocol.py.
"""

from __future__ import annotations

import json
import unittest
from unittest import mock

from wow_env import WoWClassicEnv


_INFO_REPLY = {
    "obs_size": 4,
    "num_actions": 3,
    "actions": ["noop", "forward", "stop"],
}


class _FakeStdin:
    def __init__(self) -> None:
        self.lines: list[str] = []

    def write(self, data: str) -> None:
        self.lines.append(data)

    def flush(self) -> None:
        pass


class _FakeStdout:
    def __init__(self, replies: list[dict]) -> None:
        self._replies = [json.dumps(r) + "\n" for r in replies]

    def readline(self) -> str:
        return self._replies.pop(0) if self._replies else ""


def _make_env(replies: list[dict]) -> "WoWClassicEnv":
    """Build a WoWClassicEnv whose subprocess is entirely mocked.

    `replies` is consumed in order, starting with the `__init__` info request.
    """
    with (
        mock.patch("wow_env.subprocess.Popen") as popen,
        mock.patch("wow_env.os.path.exists", return_value=True),
    ):
        proc = mock.Mock()
        proc.stdin = _FakeStdin()
        proc.stdout = _FakeStdout(replies)
        proc.poll.return_value = None
        popen.return_value = proc
        env = WoWClassicEnv()
    return env


def _last_sent(env: "WoWClassicEnv") -> dict:
    return json.loads(env._proc.stdin.lines[-1])


class GatheringGoalProtocolTest(unittest.TestCase):
    def test_inspect_gathering_goal_sends_exact_payload_and_returns_full_reply(self) -> None:
        reply = {"ok": True, "verb": "inspect", "goal": None}
        env = _make_env([_INFO_REPLY, reply])

        result = env.inspect_gathering_goal()

        self.assertEqual(_last_sent(env), {"cmd": "gathering_goal", "verb": "inspect"})
        self.assertEqual(result, reply)

    def test_track_gathering_recipe_sends_camel_case_recipe_id_and_count(self) -> None:
        reply = {
            "ok": True,
            "verb": "track_recipe",
            "goal": {
                "goal": {"kind": "recipe", "recipeId": "recipe_tough_jerky", "count": 5},
                "status": "collecting",
                "reason": None,
                "materials": [],
                "payableCrafts": 0,
                "storageRestricted": False,
            },
        }
        env = _make_env([_INFO_REPLY, reply])

        result = env.track_gathering_recipe("recipe_tough_jerky", 5)

        self.assertEqual(
            _last_sent(env),
            {
                "cmd": "gathering_goal",
                "verb": "track_recipe",
                "recipeId": "recipe_tough_jerky",
                "count": 5,
            },
        )
        self.assertEqual(result, reply)

    def test_track_gathering_recipe_reports_tracking_refused_without_raising(self) -> None:
        reply = {"ok": False, "verb": "track_recipe", "goal": None, "reason": "tracking_refused"}
        env = _make_env([_INFO_REPLY, reply])

        result = env.track_gathering_recipe("not_a_real_recipe", 1)

        self.assertEqual(result["reason"], "tracking_refused")
        self.assertEqual(result, reply)

    def test_track_gathering_commission_sends_camel_case_order_id(self) -> None:
        reply = {
            "ok": True,
            "verb": "track_commission",
            "goal": {
                "goal": {
                    "kind": "commission",
                    "recipeId": "recipe_tough_jerky",
                    "orderId": 7,
                    "count": 1,
                },
                "status": "collecting",
                "reason": None,
                "materials": [],
                "payableCrafts": 0,
                "storageRestricted": False,
            },
        }
        env = _make_env([_INFO_REPLY, reply])

        result = env.track_gathering_commission(7)

        self.assertEqual(
            _last_sent(env), {"cmd": "gathering_goal", "verb": "track_commission", "orderId": 7}
        )
        self.assertEqual(result, reply)

    def test_clear_gathering_goal_sends_exact_payload_and_returns_full_reply(self) -> None:
        reply = {"ok": True, "verb": "clear", "goal": None}
        env = _make_env([_INFO_REPLY, reply])

        result = env.clear_gathering_goal()

        self.assertEqual(_last_sent(env), {"cmd": "gathering_goal", "verb": "clear"})
        self.assertEqual(result, reply)

    def test_commands_before_reset_are_returned_verbatim_as_refused(self) -> None:
        reply = {"ok": False, "reason": "reset_required"}
        env = _make_env([_INFO_REPLY, reply])

        result = env.inspect_gathering_goal()

        self.assertEqual(result, reply)

    def test_does_not_coerce_an_invalid_argument_type(self) -> None:
        # The TS validator is the sole authority on argument validity: an
        # invalid float/string id is forwarded exactly as given, never
        # rounded, truncated, or parsed into an integer here.
        reply = {"ok": False, "reason": "invalid_request"}
        env = _make_env([_INFO_REPLY, reply])

        env.track_gathering_recipe("recipe_tough_jerky", 3.5)

        self.assertEqual(_last_sent(env)["count"], 3.5)

        env2 = _make_env([_INFO_REPLY, reply])
        env2.track_gathering_commission("not-an-id")
        self.assertEqual(_last_sent(env2)["orderId"], "not-an-id")

    def test_gathering_goal_capability_is_exposed_from_the_info_reply(self) -> None:
        capability = {
            "version": 1,
            "verbs": ["inspect", "track_recipe", "track_commission", "clear"],
        }
        info_with_capability = {**_INFO_REPLY, "gathering_goal": capability}
        env = _make_env([info_with_capability])

        self.assertEqual(env.gathering_goal_capability, capability)

    def test_gathering_goal_capability_is_none_on_an_older_server_bundle(self) -> None:
        env = _make_env([_INFO_REPLY])

        self.assertIsNone(env.gathering_goal_capability)


if __name__ == "__main__":
    unittest.main()
