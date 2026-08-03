# idle/: the Idle Classic game host

`idle/` is a NEW host over the deterministic `src/sim` `Sim`, like `headless/env_server.ts`
but for an idle game instead of an RL env. It owns the auto-combat/auto-quest policy that
drives the sim, the per-character JSON save/load, and a terminal CLI. Same sim core, so
idle runs are byte-reproducible from a (seed, gameplay-session) pair.

## What it is
- One process, one `IdleEngine` holding one `Sim` (one character). No networking, no DB,
  no threads, no Three.js, no `src/sim/` edits.
- The action surface is **NOT defined here**. It comes from `src/sim/obs.ts`
  (`ACTIONS`, `applyAction`). `idle/auto_combat.ts` is a pure policy that picks an action
  INDEX per step; it never extends the action/obs vector. Edit `src/sim/obs.ts` to add an
  action (then every host stays in sync), never here.
- Input parsing + log formatting live in the pure sibling `idle/cli.ts`; the per-character
  save round-trip is `idle/storage.ts`. Policies are pure (`auto_combat.ts`,
  `auto_quest.ts`, `movement.ts`) and `Vitest`-tested under `tests/idle/`.

## How a step runs (matches headless/env_server.ts:99-100)
Per `engine.step(realMs)`:
1. Pick ONE action index from the auto policy (`auto_combat` first, `auto_quest` fallthrough).
2. `applyAction(sim, idx)` ONCE. This clears/sets the held `moveInput` for the ticks; the
   dead-handling (`releaseSpirit` + `resurrectAtSpiritHealer`) fires automatically inside
   `applyAction` when `sim.player.dead`, so a `noop` index is enough on death.
3. `for (let i = 0; i < frameSkip; i++) sim.tick()` (default 20 = 1 sim-sec per real sec).
4. Drain the returned `SimEvent[]` for CLI highlight + counters diff.
5. Persist between steps only (post-tick, never mid-tick).

## Save/load: reuse the canonical sim path
- Save: `sim.serializeCharacter(sim.primaryId)` -> `CharacterState` (`src/sim/sim.ts`).
- Restore: `new Sim({ seed, playerClass, autoEquip: false, noPlayer: true })` then
  `sim.addPlayer(playerClass, name, { state })`. `noPlayer: true` stops the ctor from
  auto-creating a throwaway primary; our `addPlayer` becomes the primary. A fresh `Sim(seed)`
  reproduces the seed-derived SPAWN world, not the world at save time; the save carries the
  PLAYER only. The save/restore test compares next-step counter deltas between a never-saved
  control and a restored run, never world-position equality.

## Where new logic lands + tests
- A NEW idle behavior is its own pure sibling module (the `movement.ts` pattern) with a unit
  test, never more inline code in `engine.ts`'s step or `cli.ts`'s print loop.
- `tests/idle/engine.test.ts` pins: `expect(run()).toEqual(run())` determinism (two engines,
  same seed, same step count -> byte-identical counters), progression (kills>0 after N steps),
  save/restore round-trip (identical next counter delta), all-9-classes ladder-never-throws.
- Add no test under `tests/parity/`: the parity golden traces gate `src/sim/` behavior only;
  idle creates its own Sim instances and never calls `Rng.setObserver`, so it cannot perturb them.

## Run
`npm run idle` builds (esbuild -> `dist-idle/idle.cjs`) and runs the CLI on stdio. Flags:
`--class <warrior|mage|...>`, `--seed <int>`, `--speed <frameSkip>`. Prints a one-line
summary per step plus colored SimEvent highlights (kill via `counters.kills` delta + a
`type:'death'` whose `killerId === sim.player.id`; loot via `type:'loot'`; levelup via
`type:'levelup'`/`'virtualLevelUp'`; the four quest events).

## Never here
- **Never extend the action/obs vector**: edit `src/sim/obs.ts` so all three hosts stay in
  sync; idle just picks an index into the existing `ACTIONS`. Adding an action here forks the
  surface from the RL env.
- **Never use `Math.random` / `Date.now` / `performance.now` in idle decision logic**: the
  only randomness/timing flows through the `Sim` (seeded `Rng`, sim-clock). The CLI's wall
  clock feeds only `setInterval` cadence, never a sim decision. Adding nondeterminism breaks
  replay and the `tests/idle` determinism test.
- **Never import from `src/render/`, `src/ui/`, `src/game/`, `src/net/`, or `three`**: `idle/`
  is a host over `src/sim/` only, like `headless/`. Anything visual belongs in a future
  dashboard entry (`idle.html`), built on a thin API over `IdleEngine` (later milestone).
