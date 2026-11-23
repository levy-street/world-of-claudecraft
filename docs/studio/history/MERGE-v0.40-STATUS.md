# feat/deepglass -> upstream v0.40.0 merge

**Worktree:** `~/Documents/woc/deepglass`  **Branch:** `feat/deepglass`
**Base before:** `00931c1c0a` (Studio fork @ upstream v0.35.1) + 4 deepglass
commits + ~170 uncommitted files of Deepglass/Tidehold work.
**Restore tags:** `pre-v040-merge/deepglass-2e09a55bf8` (the WIP checkpoint
`5fdedf5ced`), `pre-v040-merge/deepglass-last-real-2e09a55bf8`.
Done 2026-08-21.

## Route: two steps, not one

`release/v0.40.0` sat 3,314 commits ahead of this branch. The `dryrun`
worktree (`merge/v0.37.0`) already carried the Studio fork merged to v0.39.0
with every v0.36-v0.39 conflict resolved, so:

| Step | Merged | Conflicts | Commit |
|---|---|---|---|
| 1 | `merge/v0.37.0` (fork @ v0.39.0, 3,026 commits) | 27 files | `9e39463079` + fix-ups `3ae0be4686` |
| 2 | `origin/release/v0.40.0` (319 commits) | 45 files, 33 artefact noise | `bcba43cb3e` |

`v0.40.0` is **not tagged yet**: `origin/main` is v0.39.1 and the release
branch's `package.json` still says 0.39.0. Re-merge at the tag when it lands.

## Policy

Upstream wins on shared files; fork hooks re-applied on upstream's new shapes;
generated files (asset catalog, media manifest, collision overrides, i18n)
REGENERATED from their scripts, never picked from a side.

## Step 1 resolutions worth knowing

- **`render/characters/*` collided with upstream's authored NPC looks.** The
  fork's `npc_looks.ts` (Baldemar, the marshal, the seeded crowd and Tidehold
  looks) now lives as a FORK DECLARATIONS section under upstream's
  `NPC_LOOKS` roster; `main.ts`'s look provider consults the fork composers
  first, then upstream's `npcLookFor(templateId, kind)`.
- **Portrait rig:** upstream rebuilt the portrait module around a `PortraitRig`;
  the crowd-atlas blit `drawModularPortraitInto` is re-seated on it and
  `renderPortraitFrame` gained a `yaw` param for it.
- **Music:** upstream's pure `music_mix_policy`; the fork's venue track pair
  (Sowfield/Deepglass waiting+match) maps onto `sowfieldActive`.
- **HUD music head** moved above the paint cut upstream; the `deepglass`
  arming signal moved with it.
- **`zonePrewarmTemplateIds`** (upstream's extraction) now takes the ACTIVE
  world's camps/npcs so an authored map does not prewarm every built-in camp.
- **`GOLDCREST_NPCS` must stay spread into the roster**: the fork parks the
  Deepglass fixture desk (`deepglass_steward`, read by sim.ts) and Baldemar's
  Goldcrest stop there. Dropping it (upstream removed the import) broke
  `i18n_build` ("Missing world entity source entry for deepglass_steward").
- Pinned registries extended for fork files: `RENDER_PURE_CORES`
  (decal_stream_core, deepglass_crowd_fx_core, placed_batch_core),
  `UI_DOM_MODULES` (canvas_dpr, deepglass_hud), the pow-site census
  (deepglass_crowd_cards), and `npc_looks.test.ts` (runtime-composed ids +
  a FORK_FIXED_RIG_NPCS list for the Scorching Wastes roster).

## Step 2: the terrain worker rename

v0.40 renamed `terrain_chunk_worker/pool` to `zone_build_worker/pool` (water
fills go off-thread too) and **declines the pool while a custom world is
active** because a worker samples its own built-in copy of the content. The
fork SHIPS the content instead, so authored maps keep off-thread meshing:
`ZoneBuildPool.setContent(generation, content)` (optional on the interface so
test stubs still type), a `'content'` message sent ahead of each worker's next
job, the Carve cut-rim (`cuts`/`cutPatches`, `rim`) riding the chunk job, and
upstream's two "custom-world guard" tests rewritten to the fork contract.
`terrain_chunk_pool.ts` is deleted; `terrain.ts` calls `buildChunk(..., {urgent})`.

Other step-2 seams: `npcLookFor` takes the entity kind; `interactKey` keeps
the Deepglass F-throttle early-return beside upstream's `preferNpcId`;
`dungeon.ts` awaits `attachSceneGroupGated` then `track(group)`; the goal wave
draws inside `presentFrame`'s success branch; `snapshotLastFrameStats` and
`capture()` went with upstream (no callers left).

## Measured

| | pre-merge | post-merge |
|---|---|---|
| `tsc` (whole project) | - | 161, ALL in tests/ and the retired battleground editor mode (dryrun's own baseline: 187) |
| `src/` outside battleground mode | - | **0** |
| Deepglass/Tidehold/npc_looks/architecture/pow/music/portal/prewarm suites | - | **green** |

## Known red, inherited (identical on dryrun @ v0.39)

- `tests/terrain_chunk_geometry.test.ts` (48-mesh pin) and three in
  `tests/terrain_streaming.test.ts` (57-cell pin, the (-195,161) gap, the
  oversized-map margins): the fork's `zoneRects`/`zoneXBounds` ownership
  (the v0.35 black-ground fix) does not hand the Vale its gap cells. Same four
  fail on `dryrun`. Fixing means reconciling `zoneXBounds()` with upstream's
  nearest-rect gap ownership.
- `tests/i18n_completeness.test.ts`: the editor UI is English-only by design
  (see memory `woc-editor-i18n-deferred`).
- `tests/door_portal.test.ts` Infernal Abyss gate: the bespoke gate body is
  missing from `door_portal.ts` since before this merge.
- The tests/ duplicate-import and battleground-mode errors carried from
  `MERGE-v0.39-STATUS.md`.

## Built on top of this merge (same branch)

| Commit | What |
|---|---|
| `6148992c4f` | The Gilded Gull rebuilt 12.5x10 as Tidehold's meeting hall (long feast table, a seven-counter bar with the innkeeper behind it, notice boards, four bedrooms), plus five non-enterable filler houses. Exterior planks are `Planks85_08` from the new asset texture pack. |
| `41bb4400b1` | The Warden's Keep: an enterable castle replacing `biome/hex_castle`, great hall, gallery, roof terrace, two solid stone flights as walkable decks, four spired towers, a walled courtyard and gatehouse. |
| `c69f81d816` | **Renderer fix the keep exposed:** placed-asset fire lights were a global FIRST-COME cap of eight, so buildings that streamed in later were dark inside. They are a camera-ranked pool now; the visible count stays pinned at eight. |
| `47b275e491` | The Blender assembly chain moved out of gitignored `tmp/` into `scripts/assets/blender_tidehold/`. |

## Setup after pulling

`pnpm install --frozen-lockfile` (three 0.185.1 + patch), then
`rm -rf node_modules/.vite` before starting a dev server.
