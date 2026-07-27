# src/sim/physics - the character physics engine

The collision and traversal solver behind player movement. Pure, deterministic,
host-agnostic: the same code runs the offline browser Sim, the authoritative
server, the headless RL env, and the client's display-only self extrapolator.

## Why this is in-house and not a physics library
The sim's contract is a fixed 20 Hz step, one seeded `Rng`, and byte-identical
behavior across three hosts (root `CLAUDE.md`, Invariants). A third-party engine
(Rapier, Ammo, Cannon) brings its own solver, its own float behavior, and in
several cases its own RNG and broadphase iteration order, none of which the
parity gate could hold still. It would also violate the tiny-dependency rule for
a feature that is, in this world's geometry, a few hundred lines of exact math.

## What the world's collision geometry actually is
EXTRUDED 2D. Every obstacle is a circle or an oriented box in XZ that rises from
the ground to a known top (`Collider.moveTopY`, absent = full height), and the
walkable surface is a heightfield (`world.ts` `groundHeight`). So a body capsule
reduces EXACTLY to a circle sweep in XZ plus scalar height tests: cheaper than a
general 3D solver and exact rather than approximate for this content.

## The two files
- `sweep.ts`: the math leaf. Continuous time-of-impact for a moving body circle
  against a circle or an OBB (slab test plus rounded corners via the Minkowski
  sum), and the minimum-translation overlap query used for depenetration.
  Returns contact normals; no state, no allocation.
- `character.ts`: the solver. Depenetrate, then up to four sweep-and-slide
  passes, with STEP UP when a blocking obstacle is standable and its top is
  within `MAX_STEP_HEIGHT`, then the terrain wall gate with contour sliding.
  Also `floorHeightAt` (terrain maxed with the standable prop top), which IS
  what the kernel's vertical pass lands and snaps against.

`index.ts` is the barrel; import from it, never from the files directly.

## Rules that are load-bearing here
- **Step-up applies to COLLIDERS, never to the heightfield.** A per-tick step
  allowance on terrain is a cliff-climbing ladder: a body covers about 0.35 yd
  per tick, so a step-height rise every tick would raise the effective climb limit to
  `stepHeight / 0.35` and defeat `PLAYER_MAX_CLIMB_SLOPE`. Terrain keeps the
  original wall rule; the contour retry is height-neutral and therefore safe.
- **A step must COMMIT, not just raise.** Contact happens at
  `collider.r + bodyRadius`, but `supportHeightAt` only holds a body up well
  inside that, so raising the feet at the contact point alone leaves them
  unsupported: the vertical pass drops them and depenetration pushes back out,
  which locks anyone moving slower than about three quarters of run speed
  (backpedalling, snared, diagonal). `moveCharacter` therefore advances the
  body onto the surface until the floor query agrees, and abandons the step if
  no clear supported spot exists (the body then slides, never sticks).
- **The terrain gate has three exemptions and all of them matter.** A swimmer
  is never gated; an airborne body is gated only by ground above its feet (or
  jumps onto banks die mid-arc); and the slope ratio uses the REQUESTED step,
  not the collision-shortened one.
- **Grounded bodies step; airborne bodies mantle.** `blocksAt` grants the
  `MANTLE_REACH` lift only when airborne over a standable top, mirroring
  `colliders.ts` `passesOver`, so a jump that falls just short of a rim still
  carries over. Grounded climbing goes through `steppableAt` alone.
- **Every step-up is headroom-gated** (`isClear`): climbing must never push a
  body into a wall.
- **The solver runs the open world; interiors share its traversal queries.**
  Instanced interiors (dungeon, delve, arena, Yumi maze) keep the
  long-standing `resolveMove` path in `player_motion.ts` for horizontal
  collision (their delve bounds/door clamps live there), but DUNGEON
  interiors are no longer flat rooms of walls: `supportHeightAt` and the
  ledge grab resolve their standable furniture tops (coffin lids, cargo
  stacks; `dungeon_layout.ts` layoutColliders), `groundHeight` carries the
  raised boss dais (`dungeon_floor.ts`), and the instanced kernel arm grants
  the step allowance up the dais rim plus the airborne mantle over it. The
  delve/arena/yumi bands stay flat-floor by contract.
- **Standable tops may be SHAPED** (`TopSlope`: gabled ridge with a per-asset
  axis, or cone), sampled
  everywhere through `colliderTopAt`: support, landing, pass-over, the ledge
  fit, and the solver's blocking test all read the pitched surface at the
  query point, never the ridge max (a ridge-max blocking read depenetrates a
  roof-walker off the roof; the sampled read is what lets feet track the
  stall canopy's cone and the chapel hall's gable).
- **Allocation-light steady state.** Module scratch (`candidates`, `hit`,
  `push`) is reused and `moveCharacter` fills a caller-owned result, so no
  per-call lists or poses are minted; the kernel owns one params/result pair
  (`player_motion.ts`). Small vector literals do still escape from `rotY` in
  the OBB path, which is the next thing to squeeze if this ever shows up in a
  profile.
- **No rng, no wall clock.** Guarded by `tests/architecture.test.ts`.

## Tuning
`MAX_STEP_HEIGHT` (character.ts) is the one knob that decides what a player
strides over. It is chosen against MEASURED world geometry, not taste: rock
heights come from `src/sim/decoration_dims.ts`, which is derived from the
shipped GLB bounds. Changing either one without the other re-opens the bug this
engine was built to fix (a collider top that does not match the silhouette).

## Efficiency: what the hot path may cost
This runs for every player, every tick, on the authoritative server, so the
budget is real. Three properties hold it:
- **Allocation-free broadphase.** Grid cells are keyed by a packed integer
  (`colliders.ts` `cellKey`), never a template string: string keys were the
  single largest source of per-tick garbage, and every movement, camera, and
  line-of-sight query built one. Multi-cell dedupe uses a stamp buffer owned by
  the grid.
- **Prune once, then iterate.** `pruneCandidates` drops everything the swept
  body cannot reach BEFORE any slide iteration, so the inner loops scale with
  obstacles in range rather than with cell population, and step-up resolves
  support from that same list instead of re-entering the broadphase.
- **Pinned by counted WORK, not wall clock.** `physicsStats` (solves,
  candidates, sweeps, overlaps) is asserted in
  `tests/physics_character.test.ts`; a timing budget would rot across machines.
  Open ground must cost zero sweeps and zero overlap tests.

The presentation half lives in `src/render/` (`step_smooth_core.ts`,
`ground_tilt_core.ts`): the solver may move a body a full step inside one tick
because that is correct simulation, and the renderer is what makes it read as a
stride. Never "fix" a visual pop by slowing the solver.

## Tests
`tests/physics_character.test.ts` pins the solver directly (sweeps, sliding,
no-tunnelling, depenetration, step-up and its refusals, the terrain gate, the
floor query, and the rock size model). `tests/parkour.test.ts` covers the same
behavior end to end through a live `Sim`, including kernel-vs-Sim parity.
