"""Regression tests for WoWClassicEnv's optional gathering command methods.

Mocks the Node subprocess entirely (no live env_server.cjs, no real stdin/
stdout pipe): each test only checks the EXACT JSON payload written to a fake
stdin and that the mocked reply comes back untouched. This file does not
install its prerequisites. Run with Gymnasium and NumPy installed using
python3 -m unittest discover -s python -p test_gathering_protocol.py.
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


class GatheringProtocolTest(unittest.TestCase):
    def test_inspect_gathering_sends_exact_payload_and_returns_full_reply(self) -> None:
        reply = {
            "ok": True,
            "verb": "inspect",
            "state": {"fieldKitCount": 0, "copper": 20, "preference": None},
            "corpses": [],
            "vendors": [],
        }
        env = _make_env([_INFO_REPLY, reply])

        result = env.inspect_gathering()

        self.assertEqual(_last_sent(env), {"cmd": "gathering", "verb": "inspect"})
        self.assertEqual(result, reply)

    def test_buy_field_kit_sends_camel_case_npc_id(self) -> None:
        reply = {
            "ok": True,
            "verb": "buy_field_kit",
            "state": {"fieldKitCount": 1, "copper": 0, "preference": None},
        }
        env = _make_env([_INFO_REPLY, reply])

        result = env.buy_field_kit(7)

        self.assertEqual(_last_sent(env), {"cmd": "gathering", "verb": "buy_field_kit", "npcId": 7})
        self.assertEqual(result, reply)

    def test_buy_field_kit_reports_purchase_refused_without_raising(self) -> None:
        reply = {
            "ok": False,
            "verb": "buy_field_kit",
            "reason": "purchase_refused",
            "state": {"fieldKitCount": 0, "copper": 0, "preference": None},
        }
        env = _make_env([_INFO_REPLY, reply])

        result = env.buy_field_kit(7)

        self.assertEqual(result["reason"], "purchase_refused")
        self.assertEqual(result, reply)

    def test_set_harvest_preference_sends_exact_token(self) -> None:
        reply = {
            "ok": True,
            "verb": "set_preference",
            "state": {"fieldKitCount": 0, "copper": 20, "preference": {"kind": "all"}},
        }
        env = _make_env([_INFO_REPLY, reply])

        result = env.set_harvest_preference("all")

        self.assertEqual(
            _last_sent(env), {"cmd": "gathering", "verb": "set_preference", "preference": "all"}
        )
        self.assertEqual(result, reply)

    def test_harvest_corpse_sends_camel_case_corpse_id_and_reports_denial(self) -> None:
        reply = {
            "ok": False,
            "verb": "harvest",
            "reason": "harvest_refused",
            "state": {"fieldKitCount": 1, "copper": 0, "preference": {"kind": "all"}},
        }
        env = _make_env([_INFO_REPLY, reply])

        result = env.harvest_corpse(999)

        self.assertEqual(
            _last_sent(env), {"cmd": "gathering", "verb": "harvest", "corpseId": 999}
        )
        self.assertEqual(result["reason"], "harvest_refused")
        self.assertEqual(result, reply)

    def test_commands_before_reset_are_returned_verbatim_as_refused(self) -> None:
        reply = {"ok": False, "reason": "reset_required"}
        env = _make_env([_INFO_REPLY, reply])

        result = env.inspect_gathering()

        self.assertEqual(result, reply)

    def test_does_not_coerce_an_invalid_argument_type(self) -> None:
        # The TS validator is the sole authority on argument validity: an
        # invalid float/string id is forwarded exactly as given, never
        # rounded, truncated, or parsed into an integer here.
        reply = {"ok": False, "reason": "invalid_request"}
        env = _make_env([_INFO_REPLY, reply])

        env.buy_field_kit(3.5)

        self.assertEqual(_last_sent(env)["npcId"], 3.5)

        env2 = _make_env([_INFO_REPLY, reply])
        env2.harvest_corpse("not-an-id")
        self.assertEqual(_last_sent(env2)["corpseId"], "not-an-id")

    def test_gathering_capability_is_exposed_from_the_info_reply(self) -> None:
        capability = {
            "version": 1,
            "verbs": ["inspect", "buy_field_kit", "set_preference", "harvest"],
        }
        info_with_capability = {**_INFO_REPLY, "gathering": capability}
        env = _make_env([info_with_capability])

        self.assertEqual(env.gathering_capability, capability)

    def test_gathering_capability_is_none_on_an_older_server_bundle(self) -> None:
        env = _make_env([_INFO_REPLY])

        self.assertIsNone(env.gathering_capability)


if __name__ == "__main__":
    unittest.main()
