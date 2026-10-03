# src/sim/graveyard_shift - the Graveyard Shift side adventure

The player covers Morthen's shift in a private copy of the Hollow Crypt against a
party of adventurer bots. Concept and lot plan live outside the repo while this is
a prototype; this directory is built lot by lot, and today holds the RUN SHELL only
(enter, exit, survive every exit). No identity, bots or kit yet.

## Contract
- **Offline only while a prototype.** `canStartGraveyardShift` refuses unless
  `ctx.cfg.offlineHost` (set only by `src/game/offline_world_config.ts`) and
  `ctx.devCommands`. A server would autosave the run's state over the real
  character. Lifting this gate is a step of its own (save override, client mirror).
- **Reachable only through `/dev graveyardshift`** (`src/sim/dev/graveyard_shift_dev.ts`),
  so every message is dev-channel English with a `[dev]` prefix. Player-facing
  strings arrive with the content step, as catalog keys.
- **State on Sim.** Runs live in `Sim.graveyardShiftRuns` (owner pid to run),
  exposed as the `ctx.graveyardShiftRuns` live view. Modules here hold functions.
- **Zero shared rng.** Nothing here calls `ctx.rng`; with no run the tick entry
  returns at once, so a world without a run is byte-identical to one without
  this module (pinned in `tests/graveyard_shift_run.test.ts`).
- **One teardown.** Every exit funnels into `endGraveyardShift`: the arena pools
  snapshot (`snapshotArenaReturnPools`) goes back, the stowed pet returns (any pet
  summoned during the run is dismissed first), the slot is freed. A dead owner,
  corpse or released ghost, is revived at the Crypt door drop. It is an
  arena-style CLEAN SLATE, not an exact restore: auras carried in (buffs, food,
  flasks) are shed and not given back, as in every arena-shaped mode (owner
  decision for the prototype; the shipped version should restore them). A path
  that decides mid-tick (the dev `end`, later a lethal hit) only sets
  `pendingOutcome`; `updateGraveyardShift` tears down on the next tick.
  Exits nobody announces (a teleport, a logout, a death, a party) are caught by the
  same tick watch, one tick late at most.
- **The slot is claimed directly**, never through `enterDungeon`: no roster spawn on
  shared rng, no exit portal, no lockout. Its key (`gshift:<pid>`) is never an
  `instanceKeyFor` key, so Reset All Instances and the Crypt door ignore it.

## Known limits of the shell (each owned by a later lot)
- **A death still runs `handleDeath`** (death counter, deeds death hooks, the
  `playerDeath` event). Only `/dev kill` reaches it today. The lethal-hit intercept
  must clamp BEFORE `handleDeath` so the real character's counters never move.
- **The slot has no exit object** (`exitId === null`), so everything that resolves a
  claim through `claimedInstanceAt` / `instanceClaimIdAt` (the instance combat hold,
  corpse rebinding, unstuck lookups) treats it as unclaimed. In-run Unstuck refuses.
  Revisit when mobs and bots arrive.

## Modules
| File | Owns |
|---|---|
| `run_state.ts` | `GraveyardShiftRun`, its key, the owner lookup |
| `run_layout.ts` | pure placements as slot-origin offsets (the borrowed dungeon id, the arrival point, the door drop) |
| `run_slot.ts` | claim and release of the private Crypt slot |
| `run_lifecycle.ts` | `canStartGraveyardShift`, `startGraveyardShift`, `endGraveyardShift`, `updateGraveyardShift` (the one tick entry, called just before the delve runs) |
| `index.ts` | the public barrel |

`sim.ts` and the dev command use the barrel. A combat, instance or spirit module
that later needs a predicate from here imports the LEAF module, never the barrel:
the barrel pulls in the lifecycle, which imports those same modules back.
