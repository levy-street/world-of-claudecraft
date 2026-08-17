# public/models/props/

Buildings, market stalls, graves, rocks, and other overworld/delve decoration
(`src/render/props.ts`, `src/render/mailbox.ts`, `src/render/delve_props.ts`, and the
sibling modules below). Compression, manifest, and preload rules:
`public/models/CLAUDE.md` (always meshopt, KTX2 textures via
`scripts/assets/compress_glb_textures.mjs`, tier-independent preload).

## Wiring contracts

- Village/overworld structures: `PROP_ASSET_DEFS` in `src/render/props.ts` (url +
  material-dedup `kit` + optional yaw/strip), preloaded in full regardless of graphics
  tier (see the tier-independence comment above `preloadPropKeys`), guarded by
  `tests/render_asset_preload.test.ts`.
- The mailbox pillar (`src/render/mailbox.ts`): `buildMailboxPillar()` prefers the
  deterministic Eastbrook GLB (preloaded via `loadGltf()`/`registerDeferredPreload()`), binds
  the shared Eastbrook atlas, and falls back to a matching procedural silhouette;
  either path attaches the same "unread mail" votive glow child
  (`group.userData.mailGlow`, toggled by the renderer from `IWorld.mailUnread`).
- The Eastbrook noticeboard (`src/render/noticeboard.ts`) uses the same
  immutable-template and shared-atlas contract, with a two-material procedural
  fallback and tier-independent preload.
- Standalone delve props (`src/render/delve_props.ts`): `STANDALONE_PROP_URL` lists
  the standalone GLBs; `buildStandaloneGlb()` clones the preloaded scene, normalizes
  it to the prop's original target height via a `Box3` measure/rescale (mirroring how
  `buildGlbChest()` normalizes the dungeon-kit reward chest), and re-seats the base on
  the floor. Each `buildX()` entry point is
  `buildStandaloneGlb(key, targetHeight) ?? buildProceduralX(entityId)`, the same
  GLB-then-procedural-fallback contract the reward/locked chest uses.
- Dungeon/delve door arch (`src/render/door_portal.ts`): `dungeon_door_arch.glb` is
  preloaded via `loadGltf()`/`registerDeferredPreload()`, yawed 90 degrees on load so its
  authored opening (which faces local X) frames the procedural portal swirl disc
  (which faces Z), and its cloned geometry/materials are marked shared with
  `markSharedGeometry()`/`markSharedMaterial()`: door views never get a pool key, so
  the renderer's traverse-and-dispose churn path would otherwise free GPU buffers
  still used by other door instances. `buildDoorBody()` falls back to the procedural
  stone arch on load races; the Nythraxis crypt door stays a bespoke invisible
  click-box either way.
- Marsh-ruin dressing (`src/render/delve_marsh_dressing.ts`, The Drowned Litany):
  `MARSH_ASSET_URL` lists the dressing GLBs; `placeLoadedMarshAsset()` clones the
  preloaded scene, uniform-rescales it to the anchor's `MARSH_ASSET_SCALE` target
  (height or local-X span, matched to the procedural fallback's footprint) via a
  `Box3` measure, and re-seats the base on the floor, mirroring
  `buildStandaloneGlb()`.
- Yumi maze braziers and torches (`src/render/yumi_maze.ts`): `brazier_stand` and
  `torch_handle` GLBs are cloned per instance; the team-colored flame mesh and its
  point light stay procedural and are re-seated against each loaded asset's authored
  height.

**Dynamic or stateful visuals stay procedural-only** and are drawn alongside either
the GLB or the fallback body: the mailbox glow, the corpse-candle flame and
shrine-fragment glow (marsh dressing), the portal swirl disc, and the team-colored
yumi flames all follow this rule. A visual that needs distinct interaction states
(e.g. the bell rope's pulled/unpulled pose) stays fully procedural rather than
shipping a static GLB that cannot represent them.

`tests/render_glb_replacement_assets.test.ts` asserts every preload URL above
resolves to a real, manifested file.
