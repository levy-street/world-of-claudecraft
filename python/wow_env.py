"""Gymnasium environment wrapping the headless World of Claudecraft sim.

The heavy lifting happens in a Node subprocess running the deterministic
TypeScript simulation (the same code the playable browser build uses).
Communication is newline-delimited JSON over stdin/stdout.

Build the server bundle once:   npm run build:env
Then:

    from wow_env import WoWClassicEnv
    env = WoWClassicEnv(player_class="warrior")
    obs, info = env.reset(seed=42)
    obs, reward, terminated, truncated, info = env.step(env.action_space.sample())

For parallel training just create N envs (each owns its own subprocess) or use
gymnasium.vector.AsyncVectorEnv / SyncVectorEnv with `make_env`.
"""

from __future__ import annotations

import json
import os
import queue
import subprocess
import tempfile
import threading
from typing import Any

import numpy as np

try:
    import gymnasium as gym
    from gymnasium import spaces
except ImportError as e:  # pragma: no cover
    raise ImportError("pip install gymnasium numpy") from e

_HERE = os.path.dirname(os.path.abspath(__file__))
_DEFAULT_SERVER = os.path.join(_HERE, "..", "dist-env", "env_server.cjs")


class WoWClassicEnv(gym.Env):
    """Single-agent World of Claudecraft environment.

    Observation: float32 vector (self, abilities, target, nearby mobs,
    nearest interactable, quest states). Action: Discrete(23) — movement,
    targeting, attack, 10 ability slots, interact, stop, eat_drink. The
    exact observation/action sizes are reported by the server in the
    ``info`` payload and read at runtime, so size policy networks from
    ``env.observation_space`` / ``env.action_space`` rather than from
    these docstring values.
    """

    metadata = {"render_modes": []}

    def __init__(
        self,
        player_class: str = "warrior",
        frame_skip: int = 5,
        max_steps: int = 3000,
        respawn_seconds: float = 15,
        terminate_on_death: bool = False,
        rewards: dict[str, float] | None = None,
        server_path: str | None = None,
        node_binary: str = "node",
        request_timeout: float | None = 30.0,
    ) -> None:
        super().__init__()
        self.player_class = player_class
        # Per-request read timeout (seconds). Bounds how long the Python side
        # will wait for the Node subprocess to answer before raising, so a
        # crashed-mid-write or hung server can't block training forever. Set
        # to None to wait indefinitely (the old behaviour).
        self._request_timeout = request_timeout
        # Set to a reason string once a request times out or the server dies;
        # the env is then unusable (a late response would desync the protocol).
        self._broken: str | None = None
        self._config: dict[str, Any] = {
            "frameSkip": frame_skip,
            "maxSteps": max_steps,
            "respawnSeconds": respawn_seconds,
            "terminateOnDeath": terminate_on_death,
        }
        if rewards:
            self._config["rewards"] = rewards

        server = os.path.abspath(server_path or _DEFAULT_SERVER)
        if not os.path.exists(server):
            raise FileNotFoundError(
                f"env server bundle not found at {server}. Run `npm run build:env` first."
            )
        # Capture the child's stderr to a temp file rather than discarding it,
        # so a crash reason can be surfaced when a request fails. A regular
        # file (not a PIPE) avoids the deadlock where a full, undrained stderr
        # pipe blocks the child.
        self._stderr_file = tempfile.TemporaryFile()
        self._proc = subprocess.Popen(
            [node_binary, server],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=self._stderr_file,
            text=True,
            bufsize=1,
        )
        # A daemon thread drains stdout into a queue so reads can be bounded by
        # a wall-clock timeout on every platform (select() does not work on
        # Windows subprocess pipes) and so the deadline covers reading a
        # COMPLETE line rather than just the first available byte.
        self._stdout_q: queue.Queue = queue.Queue()
        self._reader = threading.Thread(target=self._reader_loop, daemon=True)
        self._reader.start()
        meta = self._request({"cmd": "info"})
        self._obs_size = int(meta["obs_size"])
        self.action_names: list[str] = list(meta["actions"])
        self.observation_space = spaces.Box(-2.0, 2.0, shape=(self._obs_size,), dtype=np.float32)
        self.action_space = spaces.Discrete(int(meta["num_actions"]))
        self._episode_seed = 0

    # ------------------------------------------------------------------
    def _stderr_tail(self, max_lines: int = 20) -> str:
        """Return a formatted tail of the child's stderr, for error messages."""
        f = getattr(self, "_stderr_file", None)
        if f is None:
            return ""
        try:
            f.flush()
            f.seek(0)
            data = f.read()
        except (ValueError, OSError):
            return ""
        text = data.decode("utf-8", errors="replace").strip() if isinstance(data, bytes) else str(data).strip()
        if not text:
            return ""
        lines = text.splitlines()
        tail = "\n".join(lines[-max_lines:])
        return f"\n--- env server stderr (last {min(len(lines), max_lines)} lines) ---\n{tail}"

    def _kill(self) -> None:
        """Force-terminate the child and reap it, ignoring teardown errors."""
        try:
            self._proc.kill()
        except Exception:
            pass
        try:
            self._proc.wait(timeout=5)
        except Exception:
            pass

    def _reader_loop(self) -> None:
        """Forward COMPLETE stdout lines to the queue; enqueue None on EOF.

        ``readline()`` only returns once a newline (or EOF) arrives, so a child
        that writes a partial line and then stalls leaves the queue empty and
        trips the read timeout instead of hanging the trainer.
        """
        out = self._proc.stdout
        try:
            assert out is not None
            while True:
                line = out.readline()
                if line == "":
                    break  # EOF: the child closed stdout
                self._stdout_q.put(line)
        except Exception:
            pass
        finally:
            self._stdout_q.put(None)

    def _readline(self) -> str:
        """Return one response line, bounded by request_timeout (wall clock).

        Raises a clear error (and kills / marks the env unusable) instead of
        blocking forever when the child has exited or stopped responding.
        """
        try:
            line = self._stdout_q.get(timeout=self._request_timeout)
        except queue.Empty:
            # No complete line within the deadline. If the child has exited,
            # report that; otherwise it is hung -- and a late response would be
            # misread as the reply to the NEXT request, desyncing the protocol,
            # so kill the child and mark the env unusable.
            code = self._proc.poll()
            if code is not None:
                self._broken = f"env server exited (code {code}) before responding"
                raise RuntimeError(f"{self._broken}{self._stderr_tail()}")
            self._kill()
            self._broken = (
                f"env server did not respond within {self._request_timeout}s; subprocess killed"
            )
            raise TimeoutError(f"{self._broken}{self._stderr_tail()}")
        if line is None:
            code = self._proc.poll()
            self._broken = f"env server closed the connection (exit code {code})"
            raise RuntimeError(f"{self._broken}{self._stderr_tail()}")
        return line

    def _request(self, msg: dict[str, Any]) -> dict[str, Any]:
        if self._broken is not None:
            raise RuntimeError(f"env is no longer usable ({self._broken}); create a new env")
        assert self._proc.stdin and self._proc.stdout
        try:
            self._proc.stdin.write(json.dumps(msg) + "\n")
            self._proc.stdin.flush()
        except (BrokenPipeError, ValueError) as e:
            code = self._proc.poll()
            raise RuntimeError(
                f"env server is not accepting input (exit code {code}){self._stderr_tail()}"
            ) from e
        out = json.loads(self._readline())
        if "error" in out:
            raise RuntimeError(f"env server error: {out['error']}")
        return out

    # ------------------------------------------------------------------
    def reset(self, *, seed: int | None = None, options: dict | None = None):
        super().reset(seed=seed)
        if seed is not None:
            self._episode_seed = seed
        else:
            self._episode_seed = int(self.np_random.integers(0, 2**31 - 1))
        res = self._request(
            {
                "cmd": "reset",
                "seed": self._episode_seed,
                "player_class": self.player_class,
                "config": self._config,
            }
        )
        obs = np.asarray(res["obs"], dtype=np.float32)
        return obs, res.get("info", {})

    def step(self, action):
        res = self._request({"cmd": "step", "action": int(action)})
        obs = np.asarray(res["obs"], dtype=np.float32)
        return obs, float(res["reward"]), bool(res["terminated"]), bool(res["truncated"]), res.get("info", {})

    def close(self):
        proc = getattr(self, "_proc", None)
        if proc is None:
            return
        try:
            if proc.poll() is None:
                try:
                    self._request({"cmd": "close"})
                except Exception:
                    pass  # graceful close failed; fall through to wait/kill
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self._kill()
        finally:
            for stream in (proc.stdin, proc.stdout):
                try:
                    if stream is not None:
                        stream.close()
                except Exception:
                    pass
            try:
                self._stderr_file.close()
            except Exception:
                pass


def make_env(**kwargs):
    """Factory for gymnasium vector envs."""

    def _thunk():
        return WoWClassicEnv(**kwargs)

    return _thunk
