# tests/parity: the golden-trace parity gate

The sim-drift safety net. The SimContext extraction campaign motivated it (moving a
slice of behavior out of the large `Sim` class risks silent drift during a "move"),
but it now guards ALL sim behavior change: any PR that alters sim behavior turns this
gate red BY DESIGN. The harness records the FULL deterministic Sim behavior for
seeded scenarios and fails if any future change alters it.

## What it captures (the trace)

Per scenario, on a fixed tick cadence, each `Frame` pins:

- **Every player's `PlayerMeta` and every player + explicitly tracked mob/pet
  `Entity`, by EXCLUSION** (`trace.ts`): `samplePlayerMeta`/`sampleEntity` copy every
  field NOT listed in `META_EXCLUDE`/`ENTITY_EXCLUDE`, whose entries each carry a
  per-field justification comment (session-only, presentation, derived from sampled
  inputs). A NEW field is therefore pinned BY DEFAULT (see Adding a field). Players +
  tracked ids only are sampled (NOT every world entity) to keep goldens lean.
- **The SimEvent stream**, folded per window into one `eventDigest` (emit order
  preserved, reordering events IS drift).
- **The rng draw-order fingerprint**: a rolling FNV-1a over every `sim.rng` draw's
  32-bit mulberry output, in draw order, plus the draw count. Pinned per frame.

Maps/Sets are canonicalized to sorted arrays; floats are quantized to 1e-6
(`round6`); non-finite numbers (e.g. `Entity.detonateTimer` Infinity) become string
sentinels so JSON round-trips losslessly. Samples are VALUE COPIES (the sim mutates
in place; the sampler must snapshot, never retain a live reference).

## Adding a field (the everyday workflow)

Every new `Entity`/`PlayerMeta` field interacts with this harness; decide once, in the
same change. **Gameplay-affecting** (persisted, sim-read): leave it sampled (the
default) and regenerate goldens via `UPDATE_PARITY=1` in its own reviewed commit
(precedent: `craftThrottle`). **Session-only / presentation / derived from sampled
inputs**: add it to `ENTITY_EXCLUDE`/`META_EXCLUDE` in `trace.ts` with a one-line
justification comment mirroring the existing entries (precedent: `wireRev`,
`bankBonusSources`, `marketQuery`), or every golden churns for no gameplay reason.

## RNG draw-order log: the design decision

There is ONE shared `mulberry32` stream (`sim.rng`) drawn from sites all over
`src/sim`. A reordered guard or early-bail that draws at a different global stream
position forks the world for all later draws while final scalars can still match by
luck. The draw-order digest is the precise detector.

- We observe **only the shared `sim.rng`** via the default-off `Rng.setObserver`
  seam (`src/sim/rng.ts`). The observer is pure bookkeeping: it never draws, never
  branches sim behavior, and is a no-op when unset (so production determinism and
  `tests/architecture.test.ts` / `tests/sim.test.ts` are unchanged). It is reset
  between recordings (each `Recorder.finish` detaches it).
- We fold the **draw VALUE in draw ORDER** (count + ordered values), NOT a
  callsite tag. A stack-derived tag churns on every `sim.ts` edit (which is
  exactly what an extraction does), so it would make every extraction's golden
  falsely red. Count + ordered-value already catches reordering without that churn.
- **Construction-time draws** happen inside the `Sim` ctor, before the Rng exists
  to be observed; they are pinned by the frame-0 state sample instead. The draw log
  covers everything from `drive()` onward (the tick loop + in-drive internal calls),
  which is the extraction target.
- **Sub-streams** (`FiestaState.rng`, per-delve/lockpick seeds) are NOT folded into
  the digest. Their effects are fully observable through the sampled `PlayerMeta` +
  entity state + event stream, so drift there still turns a scenario red.

## Coverage

`SCENARIOS` in `scenarios.ts` is the source of truth: scenarios span combat (swings,
pets, affixes, ground AoE), arena/duel/fiesta, delves + lockpick, dungeons/raids,
quests, loot rolls, market, bank, trade, chat/social, talents, xp/prestige, casting,
and mob lifecycle. Every playable class appears in some scenario; enumerate with
`grep -o "playerClass: '[a-z]*'\|addPlayer('[a-z]*'" tests/parity/scenarios.ts | sort -u`.
`coverage.test.ts` asserts each scenario's subsystem actually FIRES (not merely named
in a comment). Read those two files, never a hand-written list, before adding a scenario.

## Known boundaries (what is NOT pinned, read before extracting these)

The net is deliberately scoped. These gaps are documented so a later session knows
to add coverage when it extracts the affected subsystem (an adversarial review
confirmed each):

- **Sub-stream draw order is not in the draw digest.** Only the shared `sim.rng` is
  observed. `FiestaState.rng`, the per-delve `run.seed`, and the lockpick board seed
  are distinct `Rng` instances; their draw *order* is not fingerprinted. Their
  *outcomes* are pinned where they surface into a sampled `PlayerMeta`/entity field
  or an emitted event (the fiesta scenario picks an augment so `fiestaAugments` +
  `augmentOffer`/`augmentChosen` are pinned; the delve walks the lockpick so the
  `lockpickStep` stream is pinned). When you extract a subsystem that uses a
  sub-stream, add a sub-stream draw-order check (or observe the sub-stream) in the
  same change.
- **Transient Sim-owned collections are not sampled directly.** `arenaMatches`,
  `delveRuns`, `marketListings`/`marketCollections`, `instances`, `groundAoEs`,
  `pendingMobRespawns` are pinned only via their entity/event/`PlayerMeta`
  projection. Extracting one of these should add a scenario that drives it (the
  precedents: `market_round_trip`, `bank_round_trip`, `dungeon_instances`) or sample
  the collection directly.
- **Construction-time draws + ambient world mobs.** The `Rng` is born inside the Sim
  ctor, so ctor draws are not in the draw digest; ambient camp mobs are spawned but
  never tracked. A same-draw-count reorder of ctor spawns that changes only
  untracked world-mob state is invisible. Scenarios that move ctor/spawn logic should
  track the affected mobs or add a ctor fingerprint.
- **Sample granularity.** Full state is digested every `sampleEvery` ticks (plus
  init/final/snapshots), not every tick. A change that draws no rng, emits no event,
  and reverts within one window is not pinned. The per-draw rng digest is the tighter
  net for anything that touches randomness; use `rec.snapshot()` to pin a precise
  instant when needed.
- **Lockpick hidden cells.** Only the walked solution path + the visibility window in
  the `lockpickStep`/`lockpickSession` events are pinned; un-walked, non-visible
  board cells are not.

## Running it

```
npx vitest run tests/parity                  # the gate (+ coverage + unit tests)
UPDATE_PARITY=1 npx vitest run tests/parity  # mint/refresh goldens (deliberate, reviewable)
du -sh tests/parity/golden                   # sanity: a few MB TOTAL, tens of KB per scenario
```

One scenario ballooning past a few hundred KB means you are tracking too many entities.

## The rule

A red trace means behavior changed. **Fix the extraction, never the harness.** Do
not widen `round6`, delete sampled fields, or regenerate goldens to "make it pass."
Regenerate only via `UPDATE_PARITY=1` as a deliberate, separate, reviewed commit.
