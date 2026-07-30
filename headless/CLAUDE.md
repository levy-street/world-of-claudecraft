<!-- headless/: the RL env server. Local guidance only; root + src/sim/ CLAUDE.md
     load alongside this, don't repeat them (determinism rules live in src/sim/). -->

# headless/: RL environment server

`env_server.ts` wraps the deterministic `src/sim` `Sim` as a gym-like RL env.
Same sim core as the browser/server hosts, so episodes are byte-reproducible from a
seed, which is the whole point of using it for RL. The Python half is `python/`.

## What it is
- One process, one `Env` holding one `Sim`. No networking, no DB, no threads.
- Action/observation surface is **not defined here**, it comes from
  `src/sim/obs.ts` (`ACTIONS`, `applyAction`, `encodeObs`, `obsSize`). This file
  only adds episode framing (frame-skip, termination, reward).
- Input validation (action bounds, player-class names, the 1 MiB stdin line cap)
  lives in the pure sibling `headless/protocol.ts`, not `env_server.ts`.

## Wire protocol: NDJSON over stdin/stdout
**IMPORTANT:** transport is line-delimited JSON on **stdin/stdout** (one object
per line via `node:readline`). Not a socket / WS / HTTP. The Python client in
`python/wow_env.py` is the other half of this exact format: change one, change both.
The request/reply shapes (`info`/`reset`/`step`/`close`) are documented in the
header comment of `env_server.ts`; that header is the reference, don't restate it.
- `obs` is a plain `number[]` of length `obsSize()` (query it, never hardcode,
  it scales with content). `action` is an int index into `ACTIONS`. Bad JSON, an
  unknown cmd, or a thrown error replies `{error: "..."}`.
- `player_class` is any `PlayerClass` in `ALL_CLASSES` (default `warrior`);
  an unknown class is rejected with `{error: ...}`. The obs/action space is
  identical for every class (ability slots pad to the largest kit), so switching
  `player_class` never changes a trained config's vector shape.

## Episode framing (this file's job)
- **`step`**: `applyAction` once, then `sim.tick()` runs `frameSkip` times (default
  5, so 4 decisions/sim-sec @ 20 Hz), then diff `sim.counters` (`RewardCounters`) for reward.
- **reward** = weighted sum of counter deltas (xp, damageDealt/Taken, kills,
  deaths, quests, levelUps) + `timePenalty`; weights in `DEFAULT_CONFIG.rewards`,
  overridable per-reset via `config.rewards`.
- **terminated** = `terminateOnDeath && died`, or `level >= MAX_LEVEL`.
  **truncated** = `maxSteps` reached. `info` = level/xp/hp/kills/etc.

## Where new logic lands + tests
- **New validation or framing behavior is its own pure sibling module** (the
  `protocol.ts` pattern) with a unit test, never more inline code in
  `env_server.ts`'s command switch or the `Env` class.
- `tests/env_protocol.test.ts` pins the protocol: action bounds, every class
  accepted, identical obs shape across all classes, the line cap. Extend it with
  any protocol or obs change. Bug fixes are test-first: a failing test that
  reproduces the bug, then the smallest change that turns it green.

## Run
`npm run env` builds and serves on stdio; `npm run bench` benchmarks the same bundle.
Manual poke: `echo '{"cmd":"info"}' | node dist-env/env_server.cjs`.

## Never here
- **Never use wall-clock or `Math.random`**: all randomness/timing flows through
  the `Sim` (seeded `Rng`, sim-clock). Adding nondeterminism here breaks replay.
- **Don't extend the action/obs vector here**: edit `src/sim/obs.ts` so all three
  hosts stay in sync; this server just relays it.
