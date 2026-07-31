# Chunk-level streaming and the outdoor fog clamp

How the overworld streams terrain and why the fog clamp keys off chunks. The
measurements below were taken during the original diagnosis and are the
baseline any future streaming change should be compared against.

## Why this exists

Players report "the fog is overwhelming, I cannot see in front of me". It is not
weather (`src/render/weather.ts` is precipitation particles and contains zero
references to fog; only `renderer.ts`, `sky.ts` and `vale_cup_practice_sky.ts`
touch `scene.fog`). It is the zone-residency fog clamp.

Outdoor fog far is `fogFarForPreparedZones` (`src/render/zone_streaming.ts`):
it contracts the view in front of the nearest UNPREPARED zone rectangle and
floors at `MIN_OUTDOOR_FOG_FAR = 45`. An unprepared rectangle within ~53 yd
therefore pins the view at 45 yd, and `targetNear = min(preset.near, far * 0.55)`
drags near down to ~25 with it.

Two reproductions, both measured:

1. Portal into the Drakelands at (217, 1871). Frostveil rect 37 yd away,
   Wraithwood 51 yd, both unprepared. Live readout `near=25 far=45` held for
   **198 s and was still clamped** when the probe stopped. Authored ember haze
   is `far: 360`, so the player never saw the zone as designed.
2. Login at (-2, 580) in Thornpeak Heights. Mirefen rect is **40 yd** south.
   `peaks` preset is `far: 850`. Reported as a white wall that cleared to the
   full valley vista about a minute later, unprompted. `40 - 8 = 32`, floored
   to 45.

## The structural flaw

**Residency is answered per ZONE; the fog needs it per CHUNK.**

- Terrain already builds in `CHUNK_SIZE = 60` yd chunks: `chunksX = 18`,
  `chunksZ = 44`, 792 across the world (`src/render/terrain.ts`).
- A zone rectangle is 360x360 (Frostveil 360x520), i.e. **36 to 54 chunks**.
- `preparedZones` is a `Set<zoneId>`, all-or-nothing, and the clamp asks "is
  that whole rectangle done?" when the only question that matters is "how far
  before I hit unbuilt ground?"

At the Thornpeak login, one or two chunk rows would have lifted the clamp. The
system instead waited on all 36 Mirefen chunks plus its HDRI. Roughly a 20x
overshoot between the work that unblocks the view and the work the clamp waits on.

Consequences, all downstream of that one choice:

| symptom | cause |
|---|---|
| minutes of wall, not seconds | unit of work ~20x too big |
| a stale zone blocks the urgent one | one build in flight (`visibleZonePrepareActive`), no preemption |
| idle pace unbounded in wall-clock | `idleSlot` per chunk row over hundreds of cells, no deadline |
| view snaps 45 -> 170 -> 850 | residency is discrete per zone |
| 30-70% of every prepare is sky | HDRI + PMREM bundled into the same gate |

Measured `lastZonePrepareStats` (software GL, so treat as ratios not absolutes):

| zone | pace | totalMs | skyMs | terrainMs |
|---|---|---|---|---|
| eastbrook_vale | fast | 2910 | 935 | 1870 |
| drakelands | fast | 8982 | 6083 | 2698 |
| frostveil | fast | 7465 | 3418 | 3914 |
| wraithwood | fast | 7076 | 5139 | 1833 |
| mirefen_marsh | **idle** | **72408** | 324 | 62487 |
| frostveil | **idle** | **105386** | 10237 | 85523 |

Fast vs idle is a 14x to 44x gap. That gap is why the clamp always wins.

## Proposed mechanism

A camera-driven chunk streamer on a frame budget.

1. **Unit = terrain chunk**, not zone. The grid already exists.
2. **Priority = distance from camera minus a forward bias**, one global queue,
   re-sorted on meaningful camera travel. Not zone-then-chunk.
3. **Pacing = a fixed ms budget per frame** (~3ms), escalating (~8ms) while the
   clamp is binding. Replaces both `'fast'` (stalls the frame) and `'idle'`
   (unbounded latency) with one knob that is bounded AND deterministic.
4. **Fog clamp keys off the nearest unbuilt CHUNK.** ORDER MATTERS HERE: the
   tempting optimisation (cache a single frontier radius, since nearest-first
   building makes the built set a disc) is only valid ONCE STAGE 3 LANDS. Until
   then builds are zone-ordered and the built set is a union of rectangles, so
   a frontier radius silently reports a clamp that is too generous and you get
   holes. Stage 2 must therefore implement a true nearest-unbuilt-chunk query
   that assumes nothing about the built set's shape (a bounded outward ring walk
   over the 792-cell grid is cheap enough; measure before optimising). The
   frontier cache is a stage-3 follow-up, not a stage-2 shortcut.
5. **Sky/IBL gets its own lane and never gates fog.** A neighbouring realm's
   HDRI has nothing to do with whether you can see ground.
6. **Cancellation becomes free.** A chunk is ~10-30ms, so a stale item is simply
   never picked again. No aborting mid-build, no `visibleZonePrepareActive`
   deadlock, no stale zone finishing while the urgent neighbour waits.

The payoff is not only speed. Today the view snaps open as whole zones land.
Under this the fog frontier tracks the build frontier continuously: the world
expands smoothly outward, and the clamp becomes self-correcting, since seeing
100 yd means you only need 100 yd of ground and building outward earns you more.

## Staging

| stage | change | status |
|---|---|---|
| 0 | stream the arrival neighbourhood on login / teleport / rift exit | **DONE** (`1f5e57d40`) |
| 1 | split sky/IBL out of the fog gate | **DONE** |
| 2 | fog clamp on nearest unbuilt chunk | **DONE** |
| 3 | budgeted global chunk queue, retire both paces | not started |
| 4 | retire `preparedZones` as the residency source of truth | not started |

Stages 1 and 2 get most of the benefit and are strictly compatible with 3.

**Forward constraints on stages 1-2, so 3 and 4 do not require unpicking them.**
You do not need stage 3's design to build 1 and 2, but you do need these two
facts, and they are the only things about 3 and 4 that bear on the work:
- Stage 3 will re-order builds globally nearest-first. So the stage-2 clamp
  query must be correct for BOTH a zone-shaped and a disc-shaped built set (see
  the ORDER MATTERS note above), and the "which chunk next" decision must be a
  seam you can swap, not logic inlined into the zone lane.
- Stage 4 will retire `preparedZones` as the residency source of truth. So do
  not add new consumers of it. Read residency through a narrow accessor instead,
  and stage 4 becomes a change of one implementation rather than a hunt.

**Blast radius for stage 4 is small.** Outside `renderer.ts`, zone residency is
consumed in exactly three places: `onZonePrepared` (`src/main.ts:1239`, HUD map
prewarm), `isZoneReadyAt` (`src/main.ts:3036`, the warmup gate), and the prepare
entry points. Zone-keyed FEATURES (props, foliage, water via
`ensureZoneFeatures`) stay zone-keyed behind their own gate; only terrain needs
to go chunk-level for the fog to work.

## Stage 0, as landed

- `src/render/zone_streaming.ts`: new `ARRIVAL_NEIGHBOR_STREAM_RADIUS = 160`.
- `src/main.ts`: all three blocking arrival paths now call `prepareZonesAround`,
  not just the rift exit. Login is at the `prepareZoneAt(world.player.pos...)`
  site; teleport at the `maybeWarmCurrentZone` blocking path (rift exits keep
  the wider `RIFT_EXIT_STREAM_RADIUS = 240`). Also an explicit
  `setLoadingProgressRange(1, 1, 55, 94)` so an instance arrival (99k yd off the
  strip, no overworld neighbours, so no progress reported) does not leave the
  bar at 55.
- `src/render/renderer.ts`: a near-first readability pass on the murky
  `BIOME_FOG` presets. ember 80/360 -> 115/385, marsh 45/110 -> 75/165,
  haunt 45/225 -> 85/265, frost 55/285 -> 95/325, dusk 80/375 -> 115/400,
  amber 95/405 -> 130/430, volcano and cave likewise, `LOW_FOG` 90/325 ->
  115/340. Clear realms (vale, peaks, fen, jungle, garden, gale, night)
  untouched. `near` moves further than `far` on purpose: `far` drives terrain,
  prop and foliage culling plus `impostorDistanceFloor` in `foliage_lod.ts`, so
  it is the expensive half.
- `tests/zone_streaming.test.ts`: 4 regression tests, including both reported
  coordinates.

Verified: `tsc` clean, 17 tests in `zone_streaming`, 103 across
`foliage_lod` / `terrain_streaming` / `day_night` / `architecture`, biome clean
on the touched files. `tests/parity` `draws` is RNG draws not render calls, so
no golden re-mint.

Radius sizing data (zone rects are 360 yd, so 160 is cheap): r160 reaches 1 zone
at the Eastbrook / Wraithwood / Amberfall / Willowfen / Galecrest hubs, 2-3 at
most others, 4 at Palmreach. r240 reaches up to 7. Instance arrivals cost
nothing (`INSTANCE_X_BASE` is 99,400).

## Stages 1 and 2, as landed

**New module: `src/render/chunk_residency_core.ts`** (Three-free pure core,
registered in `RENDER_PURE_CORES`). Owns the chunk lattice type, the
nearest-unbuilt-ground query, the fog clamp, and `orderCellsForEntry` (the
"which chunk next" seam, moved out of `terrain.ts`'s `ensureZone`).

**The clamp query is an exact bounded outward ring walk**, per the ORDER MATTERS
note above: no frontier-radius cache, no assumption about the built set's shape.
A cell on Chebyshev ring r cannot be nearer than `(r - 1) * size`, so it stops a
ring or two after the first hit. Pinned by two brute-force equivalence tests, one
over a zone-shaped (union of rectangles) built set and one over a disc-shaped
one, so stage 3's reordering cannot silently invalidate it.

**Residency flips on ATTACH, not on claim.** This was the one real trap.
`terrain.ts` already had a `built: Set<number>`, but it marks a cell BEFORE
awaiting the (idle-paced, multi-second) geometry build, so keying the fog off it
would open the view over ground that has not arrived. The residency bitmap is
cleared in `attachChunk`, where the mesh actually joins the group, and a
far-band 2x2 super-chunk clears all four of its cells. There is a mutation-tested
pin for this in `tests/terrain_streaming.test.ts` (clearing at claim time makes
it fail with "cell (7, 0) cleared with no attached mesh over it").

**Unowned cells never clamp.** Confirmed empirically: 96 of the 792 cells are
covered by no zone rectangle (the rects do not tile), so nothing will ever build
them. The bitmap is seeded from cell OWNERSHIP, so those stay non-pending
forever. Treating them as pending would pin the view against a hole that never
fills, which is worse than the zone clamp this replaces; the old clamp did not
clamp for them either, so this is behaviour-preserving.

**Stage 1 is scoped to the background lane.** `prepareZoneAt` now runs the sky
as its own lane (`prepareZoneSky`). A background (`idle`) prepare no longer waits
for the HDRI before STARTING terrain, which was the second way sky gated the fog:
the chunk clamp alone would not have fixed it, because a neighbour's terrain
build did not begin until its sky finished. The gating path deliberately keeps
sky first (the player arrives INTO that sky behind an opaque screen, and the
progress bar stays monotonic). Zone RESIDENCY still awaits both lanes, since the
HUD map prewarm and the warmup gate key off it; only the fog was decoupled.

**Deliberately NOT done:** running sky and terrain concurrently on the BLOCKING
path. It would cut a Drakelands arrival from ~9.0 s to ~6.1 s (max instead of
sum), but it needs a two-lane weighted progress bar or the bar hits 100 and
waits. Worth doing, separately.

### Two things to know before re-measuring

- **`lastZonePrepareStats` no longer sums.** On a background prepare `skyMs` and
  `terrainMs` now OVERLAP, because the lanes run concurrently. Each is still its
  own lane's wall time. The pre-change table above was measured under strict
  sequencing; do not compare the two directly.
- **The walked case is improved but not closed.** The clamp now tracks the build
  frontier continuously, so a partially built neighbour already buys view
  distance (the Thornpeak login opens from 45 to 152 once two of Mirefen's six
  chunk rows land, instead of waiting for all 36 plus an HDRI). But
  `pumpVisibleZonePrepareQueue` still will not start a zone while one is in
  flight, so a stale build 1330 yd behind the player can still delay the urgent
  neighbour STARTING. Stage 3 dissolves that; stage 2 only shrinks it.

### The one behaviour trade this makes

The clamp is now terrain-only, so during a BACKGROUND build a zone's ground can
become visible before its water and zone features (`ensureZoneFeatures`) land:
those still run per zone, after all of that zone's terrain. On the measured idle
numbers that window is about 10 s (mirefen idle: 72408 total, 62487 terrain), and
what it replaces is a 45-yard wall for the entire 105 s. Foliage and props
already pop in on their own LOD/impostor schedule, so distance pop-in is the
established idiom here; a dry lakebed for a few seconds is the new part. Flagged
rather than hidden: if it reads badly in the water-heavy realms (Mirefen above
all), the cheap fix is to gate the REVEAL of a zone's cells on that zone's water
pass, at the cost of going back to per-zone granularity for those realms.

## Verification recipes (these cost hours to rediscover)

- **Force the graphics tier.** Software GL (swiftshader, every headless script)
  auto-detects LOW, and `outdoorFogPreset()` returns the single `LOW_FOG` preset
  on the low tier, so the biome table never runs. Use `?gfx=medium`.
- **Introspect the live renderer.** `window.__game.renderer` exposes
  `scene.fog`, `preparedZones`, `pendingZonePrepares`, `visibleZonePrepareQueue`,
  `lastRequestedFogFar` and `lastZonePrepareStats`. This is how every number
  above was obtained.
- **Run your own dev server on your own port** (`npx vite --port 5188
  --strictPort`). Other worktrees grab 5173 and you will silently probe THEIR
  bundle. Tell-tale: `requested` reads an old preset value.
- **Do not edit `src/` while a headless probe runs.** Vite HMR reloads the page,
  `window.__game` disappears, and the probe dies or hangs.
- **Node buffers stdout to a pipe.** Write probe progress with
  `fs.appendFileSync`, not `console.log`, or you see nothing until exit.
- **Kill orphaned browser trees** between runs (`ps -eo pid,command | grep
  swiftshader`); they starve the next run's boot past its timeout.
- Zone rects, for reasoning about clamp distances:
  `eastbrook_vale x[-180,180] z[-180,180]`, `mirefen_marsh z[180,540]`,
  `thornpeak_heights z[540,900]`, `veiled_hollow z[900,1440]`,
  `frostveil z[1440,1960]`, `drakelands x[180,540] z[1820,2420]`,
  `wraithwood x[180,540] z[1260,1820]`, `galecrest x[180,540] z[180,700]`,
  `evergarden x[180,540] z[700,1260]`, `farshore_isle x[180,540] z[-180,180]`,
  `willowfen x[-540,-180] z[180,700]`, `palmreach x[-540,-180] z[700,1260]`,
  `nightbloom x[-540,-180] z[1260,1820]`, `amberfall x[-540,-180] z[1820,2380]`.

## Repo constraints that bite here

- Module-first: `renderer.ts` (~4.5k lines) and `main.ts` (~6.4k) are ACTIVE
  extraction targets. Never grow them. The new streamer belongs in its own
  module(s) under `src/render/`, with a DOM/Three-free pure core that a Vitest
  imports directly (`zone_streaming.ts` is the existing precedent and already in
  the pure-core allowlist). `main.ts` is a firewall, not a home.
- `src/sim/` must stay free of render concerns; this work is render-only, so no
  determinism or parity exposure. Confirm with `tests/architecture.test.ts`.
- Biome gates CHANGED FILES ONLY. Never run a whole-repo `--write`; it reformats
  a monolith into a huge unrelated diff. `npx @biomejs/biome check --write
  <changed-file.ts>`.
- No em dashes, en dashes or emojis anywhere (a `Stop` hook blocks on them).
- Run `npm run gate` before calling it done, and read the `[gate] PASS/FAIL`
  line: `npm run gate | tail` MASKS the exit code.

## Open question inherited from the analysis

Even with stage 0, the WALKED case is unfixed: stroll to within ~50 yd of a
border the idle lane has not reached and the same 45-yard wall appears, because
`queueVisibleZonePrepares` skips anything already in `pendingZonePrepares` and
`pumpVisibleZonePrepareQueue` will not start a zone while one is in flight. A
build started before you teleported runs to completion first. In the measured
baseline that meant ~3 minutes finishing Mirefen, 1330 yd behind the player,
before the lane even reached the 51 yd neighbour holding the view shut.

Stage 3 dissolves this rather than patching it: with a chunk-sized unit and a
re-sorted global queue there is no long-running in-flight item to preempt.
