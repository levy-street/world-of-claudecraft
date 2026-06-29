<!-- python/: Python Gymnasium bindings for the RL env. Local guidance only.
     The wire format lives in headless/env_server.ts, read that CLAUDE.md too. -->

# python/: Gymnasium client bindings

Thin Python client over the headless env. **No game logic lives here**, it
spawns the Node bundle and talks NDJSON over its stdin/stdout. The protocol is
defined by `headless/env_server.ts`; these are two halves of one wire format, so
**changing a command/field on either side means changing both.**

## Files
- `wow_env.py`: `WoWClassicEnv(gym.Env)` + `make_env(**kwargs)` factory (for `gymnasium.vector` envs).
- `example_random_agent.py`: random-policy smoke test + IPC throughput print.

## How it works
- `__init__` runs `subprocess.Popen(["node", server])` (server defaults to
  `../dist-env/env_server.cjs`, override with `server_path=` / interpreter with
  `node_binary=`; raises `FileNotFoundError` telling you to run `npm run build:env`
  if absent). Each env owns its own subprocess.
- Every call is one request/one reply line via `_request()` (write+flush stdin,
  `readline` stdout); an `{"error":...}` reply becomes a `RuntimeError`.
- Spaces are **queried at startup** from the `info` cmd, never hardcoded (trust the
  queried spaces over any prose or docstring):
  - `observation_space = Box(-2.0, 2.0, shape=(obs_size,), float32)`
  - `action_space = Discrete(num_actions)`; `action_names` = the `ACTIONS` list.
- `reset(seed=...)`/`step(action)` return the Gymnasium 5-tuple
  (`obs, reward, terminated, truncated, info`); `obs` is `np.float32`.
  `close()` sends `{"cmd":"close"}` then waits/kills the proc.

## Gotchas
- **The Node bundle must be rebuilt** after any change to `src/sim/` or
  `headless/`, this client loads `dist-env/env_server.cjs`, not the TS source.
