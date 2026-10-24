# feat/deepglass -> upstream release/v0.41.0 merge

**Worktree:** `~/Documents/woc/deepglass`  **Branch:** `feat/deepglass`
**Base before:** `7f57bc1054` (the WIP checkpoint that parked the in-flight
Tidehold Blender pass). **Restore tag:** `pre-v041-merge/deepglass-7f57bc1054`.
Done 2026-08-26.

## What "v0.41.0" actually is

`v0.41.0` is **not released**. GitHub's latest release is v0.40.0 (2026-08-25);
`origin/release/v0.41.0` is a freshly cut branch pointing at exactly the
`v0.40.0` tag (`ff2837da1f`), zero commits of its own. `origin/main` is 10
commits ahead of it (marketplace terms, wallet re-auth, a realm review arm) and
was deliberately NOT taken.

The sync is still real: the branch's previous merge landed against a *mid-flight*
`release/v0.40.0` head (`65b91fa190`), and the release branch moved **990
commits / 1,446 code files** after that, the v0.39.1, v0.39.3 hotfix line, the
guild pledge board, the deed cartouche, the bot-detector flag seam, the New
Eastbrook rebuild and the final i18n/fingerprint round.

## The load-bearing decision: the Vale Cup is gone

`1c74387b4c feat(world)!: demolish the Sowfield and retire the Vale Cup` removed
the boarball minigame end to end, the match driver, bots, analytic ball, sport
abilities and their dispatch arms, the SimContext vcup surface, the IWorldValeCup
facet with six wire commands and three delta keys, thirteen HUD modules, the
renderer set piece, ball, team rings and practice sky, the stadium's terrain
flatten and colliders, the practice instance band, and the Sowfield music machine.

**Deepglass was built on that substrate.** It never *was* boarball, it only
borrowed the module, so the fork's pieces were re-homed rather than resurrected:

| Was | Is now |
|---|---|
| `dg_*` ability defs, `DEEPBALL_KIT`, `resolveDeepballKit` in `sim/content/vale_cup.ts` | **`src/sim/deepglass/abilities.ts`** (fork-owned) |
| `VALE_CUP_BALL_MOB` / `_TEMPLATE_ID` (the boarball mob) | `DEEPGLASS_BALL_MOB` / `DEEPGLASS_BALL_TEMPLATE_ID`, the Tidesow's own template, same file |
| `...SPORT_ABILITIES` spread in `content/classes.ts` | `...DEEPBALL_ABILITIES` |
| `HotbarForm 'sport'` + `isInSportMatch()` | `HotbarForm 'deepball'` + `isInDeepballBout()`; `'deepball'` joins `ACTION_BAR_LAYOUT_FORMS` |
| `ValeCupBallTrail` in `render/vale_cup_ball.ts` | **`src/render/ball_trail.ts`**, `BallTrail`, radius now a parameter |
| `MusicMixState.sowfieldActive` | `MusicMixState.venueActive` (optional, so upstream's callers read false) |
| `MusicVenue = 'sowfield' \| 'deepglass'` | `MusicVenue = 'deepglass'`, the Sowfield mp3s were deleted upstream |
| `hudChrome.vcup.deepglass*` catalog keys | `hudChrome.deepglass.{gossip,gossipAria,bout,boutAria}` |
| `ball` UiIconName (deleted upstream) | restored as a FORK entry in `ui_icons.ts` |

**The trap worth remembering:** two of the fork's call sites, the Tidesow's
per-frame ball update and its FX tick, lived inside blocks upstream *deleted
cleanly*, so they auto-merged away with no conflict. The Tidesow would have lost
its comet trail silently. Both were re-seated (`updateTidesowBall`,
`tickDeepglassBallFx`). **After a merge that retires a whole feature the fork
rode on, grep for the fork's helpers with no remaining callers.**

Retired with the stadium, deliberately: the Sowfield shipped map in
`editor/shipped_maps.ts` (fork-owned; its layout module is gone), the Sowfield
shell exclusion in `ground_dressing.ts`, `crowdAmbienceAt` in `world_audio.ts`,
the `'vale_cup'` MusicZone, and the vcup i18n catalog. Kept, matching upstream's
own retirement defaults: the `vcupWins`/`vcupBet*` persisted meters and the
`'sport'` action-bar storage key (an existing character's stored layout must
still read).

## Other resolutions worth knowing

- **`sim/world.ts` groundHeight**: upstream gave `dockSurfaceHeight` explicit
  params (`terrainAt`, `WATER_LEVEL`, `content.props.docks`); the fork's editor
  ramp-deck + `collider/plane` floor block re-seated on top of it.
- **`render/dungeon.ts`**: upstream wrapped `buildInterior` in
  `runInteriorBuildTransaction` with a failure-cleanup arm and an
  `OwnedInteriorResourceRegistry`. The fork's `builtByKey` / `disposeInterior`
  (editor live rebuild), `captureOnly` early returns and
  `captureDungeonPlacementRecords` (the Studio shipped-map adapter) all fold in;
  `disposeInterior` now also drops that build's resource registry.
- **`render/terrain_chunk_build.ts`**: the fork's `waterLevel()` (the water-level
  override) AND upstream's dry-dip `shoreWaterGate`, both, not either.
- **`sim/collider_cells.ts`**: upstream moved `colliderBounds` here and only
  knows circle + OBB; the fork's `prism` arm was re-applied (its `br` IS the
  exact extent).
- **`render/renderer.ts`** (15 conflicts): fork's `dgFlier` LOD exemption now
  composes with upstream's `movingFarHoldout`; the zone-isolate residency skip
  re-seated on `requestedFar` (upstream renamed `atmosphericFar`) beside the new
  `detailHorizonDemandFar`; ambience passes `crowd = 0` now that the Sowfield bed
  is gone, keeping the fork's `submerged` arg.
- **Generated files REGENERATED, never picked**: `i18n_build.mjs`,
  `build_media_manifest.mjs`, `wiki/build_content.mjs`.

## Measured

| | result |
|---|---|
| `tsc` src/ outside the retired battleground editor mode | **0** |
| `tsc` src/ total | 25, all in `editor/battleground/*` + the two `BgLayoutRecord` consumers (`regions/region_export_core`, `sim/regions/authored_region`), the same known-red chain as v0.40 |


## The zone collision: Goldcrest Harbor vs The Proving Shore

Upstream v0.40 added a tutorial island, **The Proving Shore**, on the EXACT
rectangle Goldcrest Harbor occupied (x -540..-180, z -180..180). Two live
consequences, both shipped-game bugs:

* `zoneAt` returns the FIRST match and Goldcrest appends first, so the whole
  tutorial island was unreachable.
* `isOnProvingShore` is a pure rect test that never consults `ZONES`, so it read
  TRUE inside the capital, the arrival cinematic, island guidance and the
  island music cue all fired on players walking Goldcrest's streets.

**Resolved by moving the FORK's zone**, so the clash cannot return on the next
merge: Goldcrest is now the strip's northern band, full strip width,
**z 1960..2420**, a rigid translation of **(+360, +2190)**.

The strip and not a column, because the grid's own invariants leave no other
legal rect at the top, the strip must tile gaplessly, and every COLUMN zone
must share z with the strip (`tests/progression` calls an isolated island past
its north end a bug). Starting exactly where the Frostveil ends is the only rect
that is both legal and northernmost. It also keeps `WORLD_MAX_Z` at 2420, which
matters: the terrain's ocean margin (`world.ts` `northEnd`) is derived from that
bound, so a zone pushed further north would have dragged the entire centre-east
coastline north with it.

**Still to do (art / data, not code):**

* `public/map_art/goldcrest_harbor.png` is still painted for the old west-coast
  site and wants repainting for the new northern band.
* The CITY ITSELF did not move. Every placement and terrain stamp lives in the
  map document, so SPACEY's saves and the published
  `world_of_claudecraft_with_goldcrest` map still hold Goldcrest at the old
  coordinates. Re-anchoring the doc is a separate job.
* `public/map_art/proving_shore.png` is missing and `map_art_static` fails on it
, that plate is absent from UPSTREAM too, not a fork regression.
