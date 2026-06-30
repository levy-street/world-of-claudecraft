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
import threading
from collections import deque
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
    nearest interactable, quest states). Action: Discrete(23) --
    movement/turn/strafe/jump, targeting, attack, 10 ability slots,
    interact, stop, eat/drink. Sizes are content-dependent and queried
    from the env's `info` cmd at startup -- never hardcode them.
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
        request_timeout: float = 5.0,
    ) -> None:
        super().__init__()
        self.player_class = player_class
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
        self._request_timeout = request_timeout
        self._closed = False
        self._stdout_lines: queue.Queue[str | None] = queue.Queue()
        self._stderr_tail: deque[str] = deque(maxlen=40)
        self._proc = subprocess.Popen(
            [node_binary, server],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        self._start_pipe_readers()
        meta = self._request({"cmd": "info"})
        self._obs_size = int(meta["obs_size"])
        self.action_names: list[str] = list(meta["actions"])
        self.observation_space = spaces.Box(-2.0, 2.0, shape=(self._obs_size,), dtype=np.float32)
        self.action_space = spaces.Discrete(int(meta["num_actions"]))
        self._episode_seed = 0

    # ------------------------------------------------------------------
    def _start_pipe_readers(self) -> None:
        if self._proc.stdout is not None:
            threading.Thread(
                target=self._read_stdout,
                args=(self._proc.stdout,),
                name="woc-env-stdout",
                daemon=True,
            ).start()
        if self._proc.stderr is not None:
            threading.Thread(
                target=self._read_stderr,
                args=(self._proc.stderr,),
                name="woc-env-stderr",
                daemon=True,
            ).start()

    def _read_stdout(self, pipe) -> None:
        try:
            for line in pipe:
                self._stdout_lines.put(line)
        except (OSError, ValueError):
            pass
        finally:
            self._stdout_lines.put(None)

    def _read_stderr(self, pipe) -> None:
        try:
            for line in pipe:
                text = line.rstrip()
                if text:
                    self._stderr_tail.append(text)
        except (OSError, ValueError):
            pass

    def _stderr_summary(self) -> str:
        if not self._stderr_tail:
            return ""
        return "\nLast env server stderr:\n" + "\n".join(self._stderr_tail)

    def _write_message(self, msg: dict[str, Any]) -> None:
        stdin = self._proc.stdin
        if stdin is None:
            raise RuntimeError("env server stdin is closed" + self._stderr_summary())
        code = self._proc.poll()
        if code is not None:
            raise RuntimeError(f"env server exited with code {code}" + self._stderr_summary())
        try:
            stdin.write(json.dumps(msg) + "\n")
            stdin.flush()
        except (BrokenPipeError, OSError) as e:
            code = self._proc.poll()
            exited = f" exited with code {code}" if code is not None else ""
            raise RuntimeError(f"env server pipe broke{exited}" + self._stderr_summary()) from e

    def _request(self, msg: dict[str, Any]) -> dict[str, Any]:
        if self._closed:
            raise RuntimeError("env is closed")
        self._write_message(msg)
        try:
            line = self._stdout_lines.get(timeout=self._request_timeout)
        except queue.Empty as e:
            code = self._proc.poll()
            if code is not None:
                raise RuntimeError(
                    f"env server exited with code {code}" + self._stderr_summary()
                ) from e
            raise TimeoutError(
                f"env server did not respond within {self._request_timeout:.1f}s"
                + self._stderr_summary()
            ) from e
        if not line:
            code = self._proc.poll()
            exited = f" with code {code}" if code is not None else ""
            raise RuntimeError(f"env server stdout closed{exited}" + self._stderr_summary())
        try:
            out = json.loads(line)
        except json.JSONDecodeError as e:
            raise RuntimeError(f"env server sent invalid JSON: {line.strip()}") from e
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
        if self._closed:
            return
        try:
            if self._proc.poll() is None:
                try:
                    self._write_message({"cmd": "close"})
                except Exception:
                    pass
                try:
                    self._proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self._proc.kill()
                    try:
                        self._proc.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        pass
        finally:
            self._closed = True
            for pipe in (self._proc.stdin, self._proc.stdout, self._proc.stderr):
                if pipe is None:
                    continue
                try:
                    pipe.close()
                except OSError:
                    pass


def make_env(**kwargs):
    """Factory for gymnasium vector envs."""

    def _thunk():
        return WoWClassicEnv(**kwargs)

    return _thunk
