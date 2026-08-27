<!-- src/render/: the Three.js renderer. Root + src CLAUDE.md (the IWorld seam,
     the import-direction rules, determinism, build commands) already apply, do
     NOT repeat them. This file is render-local only. characters/ and
     ability_vfx/ have their own CLAUDE.md. -->

# src/render/: Three.js renderer

Turns an `IWorld` snapshot into a frame, every frame. **Presentation only:** it
reads the world and draws it; it MUST NOT mutate sim state (`Renderer`'s ctor
takes `private sim: IWorld`). New data/action a draw path needs: extend
`IWorld` first (see src CLAUDE.md), never reach into `Sim`/`ClientWorld`.

## Module map (families + exemplars; enumerate with `ls src/render/*.ts`)
`renderer.ts` is the orchestrator: scene/camera/lights, the
`views: Map<id, EntityView>` mapping world entities to meshes, and `sync()`,
the per-frame entry called from `main.ts` (see its signature in `renderer.ts`).
Everything else is a sibling module in one of these families:
- **World subsystems** export a `build*()` returning a `*View` the renderer
  owns: `terrain.ts` (chunked LOD + PBR splat), `props.ts`/`foliage.ts`/
  `dungeon.ts` (instanced/merged GLBs), `water.ts` (terrain-aware water bodies;
  shore-depth and tier core in `water_core.ts`, sleeping GPU height field and
  facing-aligned character volume wakes in `water_simulation.ts`), `sky.ts`.
  Event/minigame scenes follow the same pattern: `jail_scene.ts`,
  `yumi_*.ts`, `battleground*.ts` (Thornhollow Fields:
  kit-module field from the pure `battleground_core.ts` manifest, entity props
  in `battleground_props.ts`). Rift portals: `door_portal.ts` also builds the
  bespoke world-rift gate GLB with its rank-tinted energy membrane
  (`buildRiftGateBody`), and `rift_rank.ts` is the floating C/B/A/S rank badge
  above a world rift portal.
- **Per-frame overlay/FX modules** ticked from `sync()`: `vfx.ts` (pooled
  particles), `weather.ts` (any weathered biome inside the camera box drives
  precipitation and masked spawns keep it over that zone's own cells, so a
  neighbouring realm's snow is visible from outside; decisions in
  `weather_field_core.ts`), `character_effects.ts`.
- **Cross-surface shader services** own a shared uniform block plus a GLSL
  snippet that SEVERAL materials splice, never a copy per material.
  `biome_haze_field.ts` (+ its `_core`) is the reference: one small world-space
  DataTexture of per-zone haze colour and strength (colour carries the zone's
  light level and its baked weather veil, so a twilight realm reads dim and a
  snowing one white from outside), which `terrain.ts`, the far vista tiles and
  `water.ts` all splice at the same anchor (immediately before
  `<fog_fragment>`) on the same uniform objects, so distant land carries its
  own realm's atmosphere and the detail-horizon handoff cannot draw a ring.
  The sky dome (`sky.ts`) is a fourth consumer on the same uniforms: a
  directional horizon-band tint sampled along the view ray, applied before
  the dome's own fog band so the camera zone's fog still owns the true rim.
  The renderer builds the field once from its outdoor fog presets and pushes
  the camera + `dnGrade.fog` per frame; `?zonehaze=off` is the A/B switch.
- **The nameplate suite** (below) owns all overhead text and badges.
- **Pure logic cores** (below) hold Node-tested per-frame decisions.
- **Perf governors:** `render_budget.ts` (adaptive frame budget, see
  Performance) and `crowd_lod.ts` (pure character LOD policy: the band plan
  `characterLodBands` returns, which pulls shadow/anim cadence in as rig counts
  climb and holds an animated far band, articulated rig at a low cadence, before
  the frozen single-draw far mesh takes over. Its extension eases out on the
  crowd knee, the per-tier `GFX.farCharacterAnimScale` ceiling, and live budget
  pressure; cosmetic-only, and `showsStaticFarMesh` keeps anything a player
  reacts to out of the frozen mesh inside the uncrowded base range).
- **Zone streaming + residency:** `zone_streaming.ts` (pure policy: WHICH
  zones to materialize and in what order, feeding the renderer's background
  prepare queue), `chunk_residency_core.ts` (chunk-level "how far can the
  camera see before unbuilt ground" answer the outdoor fog clamp keys off),
  `resident_scenery_core.ts` (whole-scene traversal/shadow skip policy), and
  `assets/residency_budget.ts` (dev-channel accounting of where decoded bytes
  sit; English console output by design).
- **WebGL context lifecycle:** `context_recycle.ts` (`recycleWebGL2Context`
  cycles the ONE WebGL2 context through `WEBGL_lose_context` on a renderer
  rebuild so the same canvas + context is reused instead of a second context
  being minted), `context_release.ts` (forces context loss on `pagehide`:
  browsers cap live WebGL contexts per GPU process at ~16 and reclaim lost
  ones lazily, and the client reloads on every logout), and
  `software_renderer.ts` (the SINGLE source of truth for detecting a software
  rasterizer from the adapter string; `gfx.ts`, `perf_doctor.ts`, and
  `perf_reporter.ts` all consume it so the detectors cannot drift).
- `view_create_retry.ts`: bounded cooldown state for fail-soft character builds
  in per-frame paths, including required targets, form swaps, and visual-key
  swaps (`tests/view_create_retry.test.ts`).
- `self_motion.ts`/`facing_smooth.ts`: pure display-only self layers (bounded
  online pose extrapolation + rate-limited self yaw; never touch world state,
  see `src/net/CLAUDE.md`).
- `step_smooth_core.ts`/`ground_tilt_core.ts`: the grounded-presentation pair
  the entity loop drives per body. The first eases the vertical step the
  physics solver takes inside one tick (leashed to a step, exact while
  airborne so jumps and landings keep their impact); the second leans a body
  toward the surface under it, in the body's own frame, partial and clamped
  and damped. Both display-only: collision keeps using the physical pose.
  Terrain gradients resample on a per-body TIME budget, never a frame count
  (a frame cadence starves on a slow client). Landing dust rides the same
  loop through `Vfx.groundPuff`, scaled by the display-derived fall speed
  because the wire carries no vy for remote bodies.
- `camera_boom_core.ts`/`camera_feel_core.ts`/`camera_director_core.ts`: the
  AAA chase-camera feel stack `updateCamera` composes (spring-arm pivot lag,
  look-ahead + FOV kicks + landing thump, directed zone-vista/death-drift
  moves). All display-only, all gated by the reduced-motion switch; driven
  from `renderer.ts` `updateCamera` and the hud event hooks
  (`tests/camera_*_core.test.ts`).
## Module-first: pure core + thin painter (where NEW render logic lands)
New per-frame decision logic (visibility, anchors, interpolation, region/LOD
selection) is its own Three/DOM/i18n-free `*_core.ts` or `*_view.ts` module,
registered in `RENDER_PURE_CORES` (`tests/architecture.test.ts`, which sweeps
every on-disk `src/render` `*_view`/`*_core`, fails CI on unregistered ones,
and scans the set Three/DOM/i18n-free and deterministic). The Three/DOM half
is a thin painter the renderer drives; reference pair: `nameplate_view.ts` +
`nameplate_painter.ts` (the render twin of src/ui's `unit_portrait` pattern).
The core's test is a plain Vitest importing it directly; a repro never needs a
browser (the bug-fix workflow itself lives in root CLAUDE.md and the
`extract-and-test` skill).

## The nameplate suite (overhead text/badges land here, never renderer.ts)
`nameplate_view.ts` is the pure plan (show/hide, anchor lift, urgency, threat,
combo; allocation-free: `nameplatePlanInto` fills a caller-owned `NameplatePlan`).
`nameplate_painter.ts` does the Three projection, DOM writes, and ALL the
localization; the significant-contributor name glow lives there too. The
per-tier cadence lever (`ui_tier_knobs.nameplateIntervalSec`) is applied by
`renderer.ts`, which gates how often the painter runs; the painter has no
cadence logic of its own. Narrow helpers:
`nameplate_combo/threat/projection/declutter.ts` plus `entity_labels.ts`
(shared localized display names). Drive changes from `tests/nameplate_*.test.ts`.

## gfx.ts: the shared core (read this before touching any subsystem)
- **`GFX` quality tiers** (the `GfxTier` ladder; ranks are monotone, so gate a
  knob via `gfxTierAtLeast`, never a `=== 'ultra'` string compare a new top
  tier silently skips). Every tier-dependent knob lives here, not in scattered
  ternaries. The renderer MUST call `initGfxTier(webgl)` right after creating
  the `WebGLRenderer` and before building scene content (software GL defaults
  to `low`; `?gfx=<tier>` / `?lowgfx` force a tier).
- **`surfaceMat(opts)`** is the material factory: it dedupes by
  `(color|maps|flags)` so hundreds of boxes share a few programs. Use it instead
  of `new MeshStandardMaterial`; `MeshLambertMaterial` is auto-substituted on low.
- **`sharedUniforms.uTime`** is the one clock for every `onBeforeCompile` shader
  (wind, water, grain); `sync()` ticks it once/frame. `SUN_ANCHOR`/`SUN_DIR` are
  the one sun every consumer (key light, shadows, sky glow, water glints) reads.

## Textures and VFX procedural, models GLB-first
- **Textures:** `textures.ts` builds canvas textures at runtime (no image
  files). Add an `export function xTexture()` using the `makeCanvas` helper; its
  module-local `rnd()` keeps generation deterministic: don't use `Math.random`.
- **VFX:** add an effect to `vfx.ts` (emit into the pooled particle cloud; HDR
  colour multipliers via `hdr()` so it blooms on composer tiers). Sprite atlas
  cells are append-only (`SPRITE_FILES`/`SPR` must stay in sync).
- **Per-ability class VFX have two sanctioned landing spots.** Default: a
  declarative spec in a class-owned `*_vfx_specs.ts` module (exemplars:
  `destruction_vfx_specs.ts`, `necromancy_vfx_specs.ts`,
  `warlock_vfx_specs.ts`) REGISTERED in `ability_vfx_registry.ts`, which plays
  the gallery anatomy on the pooled `ability_vfx/` engine (see its CLAUDE.md).
  A bespoke `src/render/` module (the `paladin_*_visual.ts` set,
  `warlock_meteor_fx.ts`, `necromancy_*_fx.ts`, the frost/mage modules) is for
  effects that need scene objects the pooled primitive families cannot
  express; even then the pure math lands in a registered `_core`.
- **Models are real GLB assets** (CC0 kits, Tripo-generated models, and the
  image-to-GLB procedural exporters: props, foliage, dungeon, fish, gather nodes,
  mailbox, delve props, characters, the Eastbrook town kit), loaded via
  `assets/loader.ts`, then baked/merged/instanced at build time. A new
  reference-image asset follows the `image-to-glb` skill
  (`.claude/skills/image-to-glb/SKILL.md`): exporter under `scripts/assets/`, a
  parsed-GLB contract test, and its own thin `src/render/<asset>.ts` adapter
  (exemplars: `banker_chest.ts`, `eastbrook_grand_armoury.ts`, `noticeboard.ts`).
## Asset loading (`assets/`)
`loader.ts` (`loadGltf`/`loadTexture`/`loadKtx2Texture`, one parse per URL) plus these
rules, all CI-enforced:
- **Cache results are IMMUTABLE: clone before mutating.** `releaseGltf(url)` drops
  the cache entry after geometry is extracted.
- **Never `dispose()` a shared GLB-cache texture that may still be drawn.** With the
  KTX2 mip release (`assets/ktx2_mip_release.ts`) its CPU data is full-shape stubs and
  its restore source drops on dispose, so a later re-upload renders black.
- **`preload.ts` is the boot gate, and it has TWO lanes.** `startGame` awaits
  `assetsReady()` either way, so `build*()` still reads resolved assets
  synchronously; the lanes differ only in WHEN the fetch starts. A new module-load
  fetch MUST register in one of them, and for world content that is the deferred one:
  - `registerDeferredPreload(() => load...())` for world content. Nothing runs until
    `startGame` calls `beginDeferredPreloads()`. The thunk must CREATE the promise
    when invoked, never close over one already in flight.
  - `registerPreload(promise)` stays eager, for the few assets the LAUNCHER itself
    draws. Today that is the critical player/NPC/base-weapon subset in
    `characters/assets.ts` (the character-creation preview; creature/enemy bodies
    stream after first paint through a bounded lane) and `placed_assets.ts` (which
    runs during world build, not at import).
  Fetching world content at import meant merely reaching the home screen decoded the
  whole set, and the spike crossed WKWebView's per-process ceiling: a 12 GB iPhone 17
  Pro was killed 1.6s in and reloaded forever, unseen by the entry crash guard (it
  only arms inside `startGame`). Guarded by `tests/defer_launcher_preloads.test.ts`,
  which also pins that the lane opens BEFORE the `assetsReady()` that gates the
  Renderer, and fails on any new eager registrant outside the two allowed files.
- **Preload sets are tier-INDEPENDENT.** They freeze at the import-time tier
  guess but placement runs against the LIVE tier, so a preload set must be a
  superset of EVERY tier's placement set or world entry crashes with "asset not
  preloaded" (the v0.16.0 P0; see the comment in `characters/manifest.ts` and
  `tests/render_asset_preload.test.ts`).
- **Every asset under `public/` must be in the media manifest** (regenerate via
  `node scripts/build_media_manifest.mjs generate`, automatic in `npm run build`).
  `tests/render_glb_replacement_assets.test.ts` fails on a GLB missing from
  disk or the manifest; export a `*PreloadInternalsForTest` (see `fish.ts`)
  so it covers your module.

## World-entry prewarm (warm-up is a manifest entry, never ad-hoc)
`renderer.ts`'s prewarm runs a manifest of explicit entries (ids like
`vfx.ability-primitives`) so the first in-world frames do not hitch. Any heavy
NEW subsystem's warm-up must land as a manifest entry, in the right lane:
- `prewarm_policy.ts` is the pure decision layer. Constrained (phone-class
  WebKit) devices run a deliberately MINIMAL manifest
  (`CONSTRAINED_PREWARM_KEEP`) because a full one is a world-entry
  process-kill risk two ways: main-thread occupancy trips iOS's
  responsiveness watchdog, and a fully warmed manifest re-inflates GPU memory
  past the per-process ceiling. That rationale is written only in this
  module's header; read it before changing any entry.
- Entries dropped by the entry deadline resume in the background as explicit
  SMALL units (`prewarm_resume.ts`; deliberately no whole-entry callback,
  because `requestIdleCallback` cannot preempt synchronous work once it
  starts; `CONSTRAINED_PREWARM_RESUME` in `prewarm_policy.ts` names what
  constrained devices push to the background instead of the entry).
- The initial page entry has one shared first-paint boundary. Before it,
  `programs.compile-submit` admits only the settled visible `scene` group;
  hidden archetype/material catalogs become bounded
  `programs.compile-post-paint` debt. Ordinary `LIVE_VIEW` entity gates and
  scenery reveal compiles wait on the same boundary, while target/casting
  `ACTIONABLE_VIEW` gates still start immediately. `post.initial-frame` is the
  presentation-owned exception: it renders the composer once with the scene
  root hidden, so fullscreen post shaders and targets warm under the curtain
  without turning hidden catalog debt into a whole-world draw.
- `prewarm_pass.ts` sequences the BACKGROUND zone prewarm (live frames keep
  rendering, so its groups MUST stay invisible; hidden objects still link
  their programs because compile traverses via `scene.traverse`, not
  `traverseVisible`).
- Shared machinery: `compile_gate.ts` (fail-soft async shader-compile gating
  that also BOUNDS in-flight driver links during snapshot bursts, plus the
  `SerialGateLane` for gates that arrive in a burst), `linked_program_touch.ts`
  (the gate's tail: fetch every linked variant's uniform tables so the reveal
  draw issues no synchronous first-use query),
  `background_gpu_queue.ts` (the one priority arbiter for idle-time work that
  reaches WebGL). That queue decides ORDER; it also admits under the per-frame
  BUDGET of `gpu_prep_budget_core.ts` (wired by `gpu_prep_admission.ts`), which
  learns a syncMs per label kind and spends the headroom left by the tier's
  drop-frame threshold, defers a refused unit frame by frame under a starvation
  bound, and arms only once the frame clock runs, with `?prep=legacy` restoring
  the old ADMISSION only (every unit admitted at once, the ledger still
  learning); the reveal-gate policy has no legacy arm and keeps revealing
  piecewise under its soft deadline whatever that flag says. The touch tail runs as one budgeted queue
  unit PER PROGRAM (`linked_program_touch_lane.ts`) on the live gates AND on the
  reveal host, which previously ended at the shadow arm and left streamed decor
  paying the uniform-table round trip on its reveal draw. Its readiness comes
  from the SETTLE and never from a driver query: a settled gate records its
  target's current programs in `linked_program_readiness.ts` and the walk reads
  that record, because three latches `programReady` false after one missed poll,
  so `isReady()` on a program that has been linked and drawing for a minute
  re-issues COMPLETION_STATUS synchronously (5558 ms on the main thread in the
  2026-08-18 production capture, with eighteen reveal units parked behind it).
  A settle means EVERY VARIANT, not the one slot three polled: `compileAsync`
  polls `materialProperties.currentProgram` per material, while a material
  can carry several program variants in `materialProperties.programs` (skinned
  and rigid, morph counts, the depth twin's own map) and a material SHARED by
  concurrent gates (the composed bodies' skin detail, jewels, class tints) has
  that slot repointed by another gate's prologue mid-poll, so the sibling
  variants linked unpolled, were never marked, and paid their link at first
  draw or first uniform query in a live frame (28 raced pending links, 39 to
  125 ms each, in the same capture). Every gate piece therefore runs a THIRD
  arm after its colour and shadow compiles, the variant settle
  (`program_variant_settle.ts`, enumeration and pass in the pure
  `program_variant_settle_core.ts`, the depth twins found through
  `prewarmDepthMaterialsOf`): an asynchronous poll of every program of the
  piece's materials at three's own compileAsync cadence and backoff, bounded
  by the piece's deadline (`PieceDeadline`, handed to each piece by
  `runPieces`), recording each program as it answers ready. That poll is the
  ONE place this code asks `isReady()`; a piece is settled only when every
  variant answered, timed out otherwise. A settled gate links
  programs but uploads NOTHING (three's `compileAsync` never reaches
  `WebGLTextures`), so the same gates also run an upload lane: one budgeted
  queue unit per non-resident texture under the root (`texture_prep_lane.ts`,
  enumeration and the residency predicate in the pure `texture_prep_core.ts`,
  label kind `upload:texture` with the size class appended, `upload-mid` from
  512x512 texels and `upload-big` from 1024x1024, so a large upload is priced by
  its own class; a second context that moves onto the lane passes its own label,
  `upload-preview:texture`, though the paperdoll and portrait contexts still run
  their sliced upload today). A texture whose image has not arrived or not
  finished decoding is not a candidate (three uploads nothing for it and would
  leave it non-resident, so it would be re-queued at every gate). **The order
  inside a gate is LINK, then UPLOADS, then the TOUCH tail, then settle**,
  because the touch's driver round trip flushes behind everything already
  queued, so uploads paid after it are simply measured by it. The lane never
  releases its tail (an upload is main-thread driver work with no off-thread
  arm), never re-arms `needsUpdate` on a texture it does not own (a KTX2 texture
  whose CPU mips were released comes back black; the DataTexture chunk path
  re-arms it per update range by design, that is how three consumes ranges),
  and never wraps its uploads in `compilePrewarmColorPrograms`' render-target
  dance (`initTexture` dispatches on the texture's own flags and unbinds
  itself, so there is nothing to restore). `idle_queue.ts`
  (idle-slot queue draining),
  `prewarm_depth_material.ts` (the shadow arm's depth material: it must link
  the SAME program three's `WebGLShadowMap` draws, so it never sets
  `depthPacking` and keys one instance per caster shape; a three bump is
  re-read from three's source, pinned by `tests/prewarm_depth_material.test.ts`,
  never guessed). The shadow arm (`renderer.ts` `compileShadowPrograms`)
  swaps a twin onto EVERY mesh under the gated root, casting at gate time or
  not: `castShadow` is a runtime distance toggle (entity shadow band, zone
  shadow volume, gather nodes) that flips frames after the gate ran, and a
  rig gated beyond the band otherwise links its depth program cold at its
  first shadow draw. Use these, never a bespoke idle loop.
- **Streamed decor reveals PIECEWISE, per root, nearest first.** The reveal
  gates (`reveal_gate_core.ts` policy, `reveal_gate.ts` host adapter over the
  one `reveal_compile_host.ts`) hold a cull's FIRST hidden-to-visible flip
  until the subtree's programs are linked. A key still warms only once every
  root behind it is ready, but the core also tracks each root (`rootReady`),
  so a consumer whose roots draw independently shows each one as its own
  compile lands: the towns do exactly that (`town_reveal_core.ts`
  `townPiecewiseRevealInto`, closest root to the camera first, at most
  `TOWN_PIECEWISE_REVEALS_PER_FRAME` per frame), because a town key is every
  static batch plus every building group and flipping all of them on the frame
  the slowest link settles IS the burst the gate exists to prevent. A root
  once shown is never hidden again (`numPointLights` is in three's program
  cache key, so a hide and re-show links fresh programs). The props bands and
  the foliage buckets are one root per key, and a far cell's bake meshes swap
  as one representation (its first near flip back after a proven bake holds
  ON the bake under `<key>:near`, `prop_cell_core.ts` `propCellNearKey`, until
  the members' own programs link), so those consults stay all-or-nothing. The
  props HIDEABLES (each camera-ghost building, tent or campfire group) carry
  NO first-sight gate of their own, by measurement: gating them put 116 keys
  into the reveal pipeline at once on the Eastbrook ride and the iGPU could
  not settle them inside the watchdog, so they hid 10 s and drew cold anyway;
  the near-flip hold is what covers a building's unique kit materials.
  The two consults that used to SKIP the gate (a prop band already inside half
  the fog, a camera already inside a town's cull radius: the teleport-arrival
  shape) are IMMINENT HOLDS now, because the premise that such an arrival rides
  a cover whose zone prepare compiled the scene is false wherever the boot
  manifest dropped that content, and revealing on the jump frame linked the
  whole town kit in live frames. They consult and hold like any other reveal;
  what imminence buys is ORDER, never an early draw. There is NO wall-clock
  reveal bound anywhere: the cores take no clock, a held root shows when its own
  compile lands, and the only other ends of a hold are the
  `REVEAL_GATE_WATCHDOG_MS` watchdog and the two reach floors below.
  IMMINENT KEYS GO FIRST, AND NEAREST FIRST. The consult carries the flag into
  the gate's request (`reveal_gate_core.ts` `allow(key, imminent)`), which
  carries it into `reveal_compile_host.ts`: that key's link, upload and touch
  pieces ride at `LIVE_VIEW` instead of `VISIBLE_PREWARM`, still under the
  actionable gates. Within a key the roots are submitted nearest to the camera
  first (`town_reveal_core.ts` `orderTownRootsNearestFirst`, called by each town
  view at request time off that frame's camera), and across keys a frame's
  escaping bands are consulted in distance order (`prop_cull_core.ts`
  `updatePropCullables` over a reused `PropCullPass`; the sort runs only on a
  frame with two or more of them). `gpu_prep_events.ts` counts the marked keys
  as `imminentHolds`.
  TWO REACH FLOORS, and they are the only reveals that may draw a root
  unlinked: colliders are never invisible at arm's length. Bands keep
  `PROP_CULL_REVEAL_REACH` (40 yd, instant, gate or not). Towns get
  `TOWN_REVEAL_REACH_YD` (12 yd, applied in the piecewise pass on the first held
  frame, budget-free, counted as `rootsReach`), and it is DELIBERATELY the
  smaller one: a town kit's programs are shared across its buildings, so
  revealing one unlinked building links the whole kit cold in that live frame.
  It is the fairness floor, not a comfort radius. It also applies ONLY to
  FOOTPRINT-anchored roots (`TownPiecewiseReveal.footprint`, set by each town
  view): every town-spanning static batch anchors at the town centre, so a
  camera standing there is at arm's length of all of them at once, and reach is
  a collider argument a batch cannot make.
  The ARRIVAL COVER (`arrival_cover.ts`, raised by `src/game/arrival_warmup.ts`
  for the whole blocking teleport chain, and at world entry) does two things and
  neither of them reveals anything. It makes the curtain WAIT on the gates
  (`awaitArrivalReveals`, at most `ARRIVAL_REVEAL_SETTLE_MAX_MS`, zero online)
  so an arrival lifts with its decor linked the way boot does. Its first check
  happens after ONE poll interval, never synchronously: the wait starts before
  any cull has consulted a gate at the new position, so a synchronous check read
  "nothing held" because nothing had been asked yet. At world entry that wait
  sits behind `afterActiveAnimationMs`, which is driven by
  `requestAnimationFrame`, so a HIDDEN TAB keeps the cover raised until frames
  resume; nothing renders meanwhile, so nothing is being hidden from anyone. It
  also switches
  `gpu_prep_admission.ts` onto the cover rule (`gpu_prep_budget_core.ts`
  `gpuPrepCoverAdmits`): under a curtain there is no frame to protect, so
  everything from `TAIL_PIECE` up is admitted on the `cover` reason, and
  `BOOT_DEBT` / `BACKGROUND` / `BOOT_RESUME` are refused on
  `cover-not-arrival`. Admitting those too is what starved the arrival
  (measured: after a second of hold, 0 of 1 roots ready per band key and 0 of 12
  on the town, because the debt lane drained ahead of them). A
  `cover-not-arrival` refusal does NOT age: the adapter answers `agesDeferral`
  false for it (`background_gpu_queue.ts` consults the hook in `noteFrame`),
  because ticking `deferredFrames` through a whole curtain left every one of
  those units past `maxDeferFrames` and admitted the entire debt lane as
  `starvation` on the first live frame after the drop. The cover is DEPTH-counted
  (`setArrivalCover(true|false)` increments and decrements, floored at zero): the
  blocking arrival and the world-entry settle are independent owners that can
  overlap, and the curtain stands until the last of them drops it. Beside the
  cover, the blocking arrival also HOLDS THE WORLD DRAW for the same span
  (`src/game/presentation_gate.ts` `worldDrawHeld`); see `src/game/CLAUDE.md`,
  the `arrival_warmup.ts` row.
  Two deadlines beside it, and only one of them reveals: a SOFT deadline per key, from
  the budget's learned reveal cost (one gate PIECE, since a reveal compile is one
  queue unit per material group) times the piece count of the key's roots clamped into
  [`REVEAL_SOFT_DEADLINE_MIN_MS`, `REVEAL_GATE_WATCHDOG_MS`], records a
  `reveal-soft-deadline` gpu-prep event with the key's ready/total roots and
  changes nothing. That learned cost is the compileAsync PROLOGUE (1 to 3 ms),
  not the driver's link wall time, so the deadline sits at its floor in
  practice: a learned wall time is future work, and it is telemetry either
  way; the `REVEAL_GATE_WATCHDOG_MS` hard watchdog still reveals ungated and now
  carries the same counts, plus the `reveal` aggregate in
  `gpu_prep_events.ts` (keys held, roots held, roots revealed piecewise, roots
  revealed on a reach floor, roots still compiling at a watchdog), so a capture
  can attribute a first-draw stall to the roots that never linked in time. On
  initial page entry, neither deadline starts while the loading curtain owns
  presentation: `startAfterInitialPaint` starts the reveal compile and both
  clocks together after the first painted world frame. Later arrivals read the
  already-settled page boundary and retain the normal immediate clock.
- **Every gate names its stand-in: NEVER LEAVE AN ENTITY WITH NO REPRESENTATION.**
  A gate hides a still-linking object so its reveal draw cannot stall the frame;
  the link is not cancellable and the gate timeout is diagnostic only, so the
  hidden window is UNBOUNDED. That is fair only while something else still tells
  the player the entity is there. The reference is the far-bake gate
  (`characters/far_lod_reveal_core.ts` `farMeshShown`: the articulated rig keeps
  drawing until the baked mesh links). `entity_gate_stand_in_core.ts` holds the
  rule: `ENTITY_GATE_STAND_INS` (one row per gate call site, naming what it hides
  and what still draws), `applyCharacterFormVisibility` (the base body is the
  stand-in for a linking FORM rig, held there by `characterFormReadyMask`, which
  treats a rig behind its gate as absent), and `entityHasNoBody`, which the
  nameplate painter uses to force a plate on OVER the player's nameplate toggles
  for the one gate with no in-world stand-in (the arrival gate hides the whole
  group). A new gate adds a row AND a case to `tests/entity_gate_stand_in.test.ts`;
  its coverage pin reds on any unregistered call site, over the gate shapes its
  `GATE_CALL_SITES` table names (the three renderer wrappers plus
  `spiritCompileGate`, the puppet pool's own consult of the host gate it takes
  through `setSpiritCompileGate`). That one REFUSES the spawn instead of
  holding it, because an apparition that pops in late is worse than one that
  never came: the rest of the impact sequence is the stand-in, and the refusals
  are counted as `gpuPrep.gates.spiritSpawnsRefused`.
  The rule has a SECOND-CONTEXT arm: the paperdoll / Inspect preview holds its
  own draws on a cold open (`characters/preview_open_gate_core.ts`, armed from
  `Hud.mountSharedPreview`) while that context links, uploads and touches, and
  its stand-in is a 2D layer, a cached portrait or the class crest, painted
  over the empty canvas by `src/ui/preview_stand_in.ts` with `aria-busy`, on
  EVERY arm including a rebuild in the same container (the mount resizes the
  renderer first, and `setSize` reassigns `canvas.width`, which clears the
  drawing buffer: there is no retained frame left to stand in). It
  needs no `ENTITY_GATE_STAND_INS` row: that table is world ENTITIES the
  renderer hides in the live scene, and this gate hides nothing in the world.
  Its escape is the reveal gates' rule, a soft deadline that records a
  `gate-timeout` gpu-prep event under the `preview-open` key and draws anyway.
- **A program only ONE encounter can reach warms at that interior's attach,
  never in the boot manifest** (`interior_encounter_prewarm.ts` spec +
  `_pass.ts` + `_host.ts`, kill switch `?encounterPrewarm=0`). The Nythraxis
  tenant is Soul Rend: its mark clones every marked body's materials
  `transparent` with `depthWrite = false`, which three keys as a NEW program per
  body AND per mesh SHAPE, so the first mark linked ~32 programs inside one
  frame. Two halves, because neither covers the other: a CATALOG (class rigs,
  VFX weapon skins) and the LIVE looks in the room, since real players carry dye
  and jewel variants no default rig has. Three rules the measurements paid for:
  the stand-in must be SKINNED (a `PlaneGeometry` proxy links a different
  variant and changes nothing), the clone materials are kept alive and never
  disposed (three releases the program with the last material), and BOTH the
  build and the compile drain across idle slots, per body, chained, because a
  raid arrives together and independent idle waits otherwise resolve in one idle
  period and concatenate into a single long task.
  Warm nothing whose cost you have not measured: Brother Aldric was in this
  spec until an A/B from a start zone that had never compiled his model showed
  his spawn linking ZERO programs (the player bodies on screen already carry
  them).

## GPU work: every new producer is a client of the scheduler
The sections above are the machinery; this is the contract EVERY new producer of
GPU work signs. Each rule names its seam and its guard.
- **Every material a live frame can draw for the first time after the curtain has
  a prewarm home:** a twin in an existing prewarm manifest entry, or a compile
  gate at its first appearance (`compileGate`, `attachSceneGroupGated` in
  `gated_scene_attach.ts`, a reveal gate). Never a bare `scene.add` of a group
  carrying new materials after boot; never a module-scope material cache filled on
  first cast without being registered. Guards:
  `tests/ability_material_prewarm_sweep.test.ts`, the `buildInterior` gating pin in
  `tests/renderer_compile_gate.test.ts`, and the `live-program` events in
  `perfStats().gpuPrep`, whose count on an offline tour of the touched content is
  the acceptance bar of a render PR.
- **Every program-key change on a VISIBLE material rides a gated swap with a
  stand-in.** The key inputs: texture-slot presence, `transparent` / `blending` /
  `alphaToCoverage` / `alphaHash`, `defines`, `onBeforeCompile` /
  `customProgramCacheKey` (three's default key IS the hook source), skinning and
  instancing, and any `needsUpdate` on a drawn material.
  `materialProgramSignature` (`prewarm_policy.ts`) is the enumeration, with its
  dimension-by-dimension contract test in `tests/prewarm_policy.test.ts`; `live-program`
  catches what it misses.
- **Never add, remove, or hide a directional, hemisphere, spot, or rect-area light
  after boot:** those counts are program-cache-key inputs, so one change relinks
  every lit material in view. Re-GRADE the constructor's one sun/hemi pair through
  `interior_light_rig.ts` instead. Point lights ride the pad budget
  (`point_light_budget.ts`). Guards: `tests/render_light_census_pin.test.ts` (the
  allowlist of every non-point light constructed under `src/render`) and
  `tests/point_light_budget.test.ts`. The Wildheart caldera rig
  (`wildheart_props.ts`) is the ONE named exception, pinned as such in
  `tests/renderer_compile_gate.test.ts`; pre-linking a scene-wide light census is
  a backlog item, not a precedent.
- **Every new secondary GL context links (`compileAsync`) and uploads
  (`uploadTexturesInSlices`, `texture_prewarm.ts`) before its first draw, and sets
  `debug.checkShaderErrors = shaderDebugRequested()` on the renderer it just built,
  ahead of that renderer's first `render()`.** Guard: the secondary-context pins in
  `tests/shader_debug_flag.test.ts`.
- **No new queue, no new lane, no fourth gate.** New work rides
  `background_gpu_queue.ts` at an existing `GPU_WORK_PRIORITY`, carries a
  `kind:instance` label whose kind the budget can learn (`gpuPrepKindOfLabel`),
  and, if it holds a representation back, names its stand-in in
  `ENTITY_GATE_STAND_INS` plus a case in `tests/entity_gate_stand_in.test.ts`. A
  compile gate submits one unit per material group and variant of its root
  (the material tuple plus what three's program cache key reads off the node:
  skinning, instancing, morph targets, the geometry attributes), one
  representative compile per group plus its variant settle
  (`CompileGateQueue.runPieces` over `linkPieceWork`, `compile_gate_pieces.ts`,
  the settle arm bound by `pieceProgramSettle`), never a whole root in one unit:
  the queue paces between units, and a driver that compiles shader source at
  submission charged every program of a root to the one unit. Each piece arms
  the gate timeout for its OWN work (the driver latency of one unit), so queue
  pacing between pieces never counts against it. No
  wall-clock constant calibrated on one machine inside a gate: the arrival lesson
  is that a hold ends on evidence (its own compile settling), on the
  `REVEAL_GATE_WATCHDOG_MS` watchdog, or on a reach floor, never on a tuned timer.
- **CPU construction pieces ride the same queue and budget.** Main-thread work a
  view build would otherwise pay inside its frame (a composed look's procedural
  decal maps and head cuts, measured at 94 percent of a composed build) is cut into
  pieces the budget can price (a map as a chain of row bands, `LOOK_BAND_ROWS` rows
  per unit, a structural fraction of the map so the budget decides how many units
  fit a frame; a cut as one unit), deduped by style key, and enqueued at the view's
  priority. The live candidate whose pieces are not resident builds its body NOW
  without its face decals (the body IS the stand-in: nameplate, click target and
  silhouette on the frame it enters range, never an invisible player, per the
  fairness rule) and the decals attach later, one budgeted queue unit per body
  (`LookPieces.attachWhenReady`, so a crowd sharing a look never attaches in one
  burst), through the visual's compile gate (`CharacterVisual.attachDeferredDecals`,
  hidden until their programs link).
  Under a cover and for the local target the build stays synchronous, decals
  included. Seam: `characters/look_pieces.ts` (`composedLookPiecesFor`,
  `perfStats().lookPieces`) and `AssembleOptions.deferDecals`, guarded by
  `tests/look_pieces.test.ts`, `tests/deferred_face_decals.test.ts` and
  `tests/renderer_look_pieces_hold.test.ts`.
- **Verify, do not assert.** `?perf`, then `__game.renderer.perfStats().gpuPrep`: the
  budget snapshot, the event ring (`live-program`, `gate-timeout`, `reveal-watchdog`,
  `reveal-soft-deadline`, `submit-stop`, `attach-watchdog`, `touch-unproven` (programs a
  world gate's touch tail found unproven by any settle, the ones a walk mark used to
  bless and block on), plus the `arrival` mark one per teleport-class landing), and the
  reveal counters. The CPU side of the same picture is `perfStats().buildLedger`
  (`build_ledger_core.ts`: main-thread ms per view build class and per zone feature
  builder, each kind's worst sample and when it happened (`maxAtMs`, the one frame
  anchor a nested `view-part:` kind keeps), the worst frame, the slowest builds) and `perfStats().zoneStreaming` (the last prepare's stage wall-times);
  the hitch tracker's `zone-build`, `view-create` and `off-frame` causes read from
  them, on a sample ALIGNED with the span its dt measures (`hitch_frame_align_core.ts`:
  the previous callback plus the gap before this one), so a cause inside a callback
  is filed on the frame that paid it.
  External capture: `node scripts/gpu_hitch_capture.mjs`. Dispatch
  `render-performance-reviewer` on any diff that lands a producer under these rules.

## i18n: overhead labels are the only string surface here
One deliberate exception: `scene_census_core.ts`'s table/format helpers feed the
`?perf` overlay, a dev diagnostic that stays English by the `src/game/CLAUDE.md`
perf-overlay carve-out; never reuse them in player-facing chrome.
The renderer is geometry/shaders; the overhead-text surface is
`nameplate_painter.ts` (owns `t`/`tEntity`/`formatNumber`) plus
`entity_labels.ts` (localized display-name helpers, lifted out of `renderer.ts`
so renderer and painter share them without an import cycle); `renderer.ts`
keeps only `tEntity` for its remaining label writes. Keep it keyed:
- **Entity names** (mob/npc/dungeon/ground-object/ability) localize via `tEntity({
  kind, id, field:'name' })`, never the raw English `e.name`/`e.templateId`.
- **Templated labels** (corpse, dungeon-exit, emote, fishing cast) use `t()` keys.
  The keys live in `src/ui/`, so add a new key there, not inline here.
- **Verbatim by design:** player names and owned-pet names (`e.name` when
  `e.ownerId !== null`) are proper nouns: splice them as-is, do not localize.
- **Deed titles** (the subtitle under a player's name): the entity `title`
  field is a deed id; `nameplate_painter.ts` resolves it via `deedTitleText`
  (`../ui/deed_i18n`), diffed per language + deed id; an unknown id hides the
  line.
- `cast_bar.ts` stays i18n-free on purpose: it returns a stable discriminator
  (`label`/`fishing`) and `nameplate_painter.ts` resolves the visible text.
  Don't add `t()` there.

## Terrain height = sim height (hard invariant)
Render samples `terrainHeight` / `groundHeight` from `src/sim/world.ts` (DOM-free,
deterministic) to place terrain, props, foliage, water-shore depth. **YOU MUST
sample those functions, never re-derive height here.** `groundHeight` is the
dungeon-aware wrapper (flat floor past `DUNGEON_X_THRESHOLD`); plain
`terrainHeight` is the open-world surface. If they drift, visuals desync from
collision/movement.

## Performance discipline: this runs at frame rate
- Three.js is **version-pinned in `package.json`**; the post chain lives in
  `post.ts` (its header comment documents the pass order and the N8AO
  subtleties) plus the `n8ao` package (SSAO). The `postprocessing` dep in
  `package.json` is n8ao's peer dependency, not imported directly, so don't
  remove it as "unused." Don't bump Three or swap the chain casually: shaders
  here patch the pinned release's shader chunks via `onBeforeCompile`, so any
  bump means re-verifying every patched chunk. A bump also touches KTX2:
  `assets/ktx2_support.ts` hand-builds a `workerConfig` on its no-context
  fallback arm (a shape KTX2Loader owns and can change between releases), wraps
  the private `_createTexture` hook to capture restore sources for
  `assets/ktx2_mip_release.ts` (fails soft to resident mips if the hook moves,
  see `tests/ktx2_support.test.ts`), and
  the shipped `public/basis/` transcoder must be regenerated from the new three
  via `node scripts/patch_basis_transcoder.mjs` (never a raw copy: the shipped
  JS carries an eval-free embind patch so the KTX2 blob worker survives the
  Electron shell CSP, which has no 'unsafe-eval'). `tests/glb_texture_compression.test.ts`
  pins shipped === patch(vendored) and `tests/basis_transcoder_csp.test.ts` pins
  the no-dynamic-code invariant; both go red on a raw re-copy.
- Reuse, don't allocate: instancing for repeats, merge one-offs per
  (material, z-band), share materials via `surfaceMat`, distance-cull/LOD in
  `sync` (see the `*_RANGE_SQ` constants). No per-frame `new THREE.*` in hot paths;
  reuse the `tmpV` scratch vectors / scratch arrays already in `renderer.ts`.
  The VFX world-anchor seam follows the same rule with an explicit contract:
  `vfx_anchor.ts` `createVfxAnchor` takes an optional caller-owned destination,
  so a per-frame path passes its own scratch (the reading is valid only until
  that scratch is reused) and a one-shot spawn path omits it and gets a fresh
  retainable vector.
- **A cosmetic subsystem answers to a lever, and the lever says which job it is
  doing.** `weapon_vfx_shed_core.ts` is the shape to copy: it FADES (both arms
  floored above the multiplier at which a part stops drawing) and leaves REMOVAL
  to the character LOD swap, which already owns it on inputs the whole render
  path shares. Read its header before adding a shed of your own, including why
  the distance arm is anchored to the fixed `CHARACTER_LOD_RANGE_SQ` and not to
  the live crowd-adaptive band edge, and
  `docs/design/graphics-settings-fairness.md` for why that choice is what keeps
  a fade fairness-safe.
- **Work that a hidden subtree cannot show is work not to do.** The far-LOD swap
  hides `modelWrap`, so anything parented into the rig (a held weapon and its
  VFX) stops being drawn without any of its own flags changing; a per-frame
  driver over such a subtree should skip. Check the swap ACTUALLY happened
  (`CharacterVisual.setFar` keeps the rig visible when no baked mesh exists,
  or while a fresh bake's materials are still linking behind the far-bake
  compile gate, while `isFar` reads true either way), never just the intent
  flag: `farMeshShown` in `characters/far_lod_reveal_core.ts` is that
  predicate.
- **Cloning a material? Use `material_clone_hooks.ts`.** `Material.clone()` copies
  userData but silently DROPS `onBeforeCompile`, and three keys its program cache
  on `customProgramCacheKey()`, whose default return value IS
  `onBeforeCompile.toString()`. So a bare clone of a patched material (rim glow,
  the worn surface-detail layer, the armour dye that carries a player's outfit
  colorway `characters/armor_dye.ts`, the vertex-colour emissive layer both towns'
  lit building materials carry, `vertex_color_emissive.ts`) both renders un-patched AND links a whole new
  program on its first draw, wherever that draw lands. `cloneMaterialWithHooks`
  re-attaches exactly the layers the source carried, in the source's order, so
  the composed key comes out identical and the clone reuses the linked program.
- **`render_budget.ts` is the renderer's adaptive-budget core** (tier-driven frame
  budget + telemetry, keyed off `gfx.ts` quality bands). `renderer.ts` owns it,
  degrades against it, and pushes the resulting grass/foliage/vfx quality levels into
  those subsystems. Consult it rather than reinventing a frame-level budget.
