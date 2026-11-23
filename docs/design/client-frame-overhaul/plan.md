# Client frame-cost overhaul: plan

Status: PLAN (no phase started). Program tracker: [progress.md](./progress.md).
Date: 2026-11-23. Base: `release/v0.46.0`.

A data-oriented renderer on its own thread: GPU-driven crowds, a lighter static world, a
renderer fed by plain data, a governor that turns headroom into frames, and a hard
per-frame budget so the gains stay.

## 1. Context

### Symptom (measured 2026-11-23)
- Windows desktop build, Low preset, Display frame limit, RTX 3070 + i7-11700K at
  3440x1440 (143 Hz): about 75 FPS in the starting town.
- Mid-range Android phone, same preset and town: about 50 FPS.
- Low already removes shadows, the post chain, PBR materials and terrain splatting, yet an
  RTX 3070 barely clears 75 FPS. The town frame is bound by single-thread CPU work, not
  by the GPU. On a vsync-paced 143 Hz panel, 75 FPS means real busy time lies anywhere
  from about 7 to 14 ms, so Phase 0 measures busy milliseconds, not FPS.

### Root cause
The client is built as "one Three.js object per thing, everything re-evaluated every
frame, all on one JavaScript thread":
- Every visible character runs its own `AnimationMixer` and `Skeleton` on the CPU
  (`src/render/characters/visual.ts`). A WOC player is several draws per pass; a frozen
  far-LOD body is one `THREE.Mesh` with several groups and is never instanced (40 far
  bodies measured at 540 draws on High in the September 2026 character crowd capture).
- The world subsystems are hard-wired calls in `Renderer.sync()` (`src/render/renderer.ts`)
  with no registry and few dormancy gates.
- three r185 `updateMatrixWorld` visits every node every frame even when frozen (header of
  `src/render/static_matrix.ts`), and nothing counts nodes.
- Nameplates are a full 2D-canvas repaint (`src/render/nameplate_painter.ts`) and chat
  bubbles are DOM divs moved every frame (`src/render/chat_bubble_layer.ts`).
- Rendering, the HUD DOM, network apply (`ClientWorld.applySnapshot` on the WebSocket
  message handler), input and garbage collection share one thread. The July capture in
  `docs/design/player-performance/brainstorm.md` (section 1) put about 17 ms in the
  renderer and about 15 ms in other main-thread work in a 91-player town; the confirming
  trace was never taken (`docs/design/player-performance/baselines.md`, section 4).

The browser and JavaScript multiply this cost (roughly 2 to 3x against native code, a rule
of thumb) but are not the cause: the same build runs several hundred FPS on Low in an empty
scene and collapses toward the same number on every preset once a crowd is around
(`docs/design/player-performance/baselines.md`, section 1).

### Intended outcome and provisional targets
Town frame cost scales with pixels, not with how many things and features exist.
Provisional targets, re-set at the Phase 0 gate:
- town at Low on the reference desktop at least 2x today;
- phone at least 60 FPS sustained in town at Low;
- main-thread busy time in town at most 6 ms on the reference desktop CPU;
- zero new `live-program` (shader link) events.

### Relationship to existing work
Supersedes Packet 1 (crowd character cost) and parts of Packets 2 and 5 of
`docs/design/player-performance/` (all unauthored per its `progress.md`). The server, the
sim and the wire protocol are untouched.

## 2. Guardrails (every phase)
- **One sim, three hosts.** No `src/sim/` behavior change. `IWorld` is unchanged; the
  renderer narrows its own view of it.
- **Fairness** (`docs/design/graphics-settings-fairness.md`). Never hide, delay, reposition
  or freeze an actionable body. Reuse the `animatesEveryFrame` carve-out
  (`src/render/crowd_lod.ts`): self, target, casters and in-combat-with-you keep the full
  CPU rig. Clips and timing are identical on every path, and blade-contact timing (the
  `playAttack` return value plus the contact queue) is preserved.
- **Module-first.** `renderer.ts` and `main.ts` sit at their ceilings in
  `tests/monolith_budget.test.ts` and never grow. New logic lands in siblings, pure cores
  register in `RENDER_PURE_CORES` / `UI_PURE_CORES` (`tests/architecture.test.ts`), and
  ceilings are lowered after each extraction.
- **GPU work.** Every new program has a prewarm home or a compile gate, a stand-in row
  (`src/render/entity_gate_stand_in_core.ts`), a depth twin and a
  `src/render/context_restore_registry.ts` entry. Acceptance bar: zero `live-program`
  events.
- **Per PR.** A worktree off the latest release branch, `node scripts/gate_select.mjs`,
  `/qa`, plus `render-performance-reviewer`, `frontend-seam-reviewer` and
  `cross-platform-sync` where they apply; before/after screenshots for visual changes.

## 3. Sequencing
- Phase 0 first, ending in a decision gate.
- Then two tracks in parallel:
  - **Track A:** Phase 1 in the order 1A0, 1A1, 1D, 1A2, 1B (1C can run any time).
  - **Track B:** the Phase 2 items that need no boundary (2A, 2B, 2C, 2E) plus Phase 4A.
- 2D (GPU nameplates) needs 1A2 and 1B. Phase 3 needs Phase 1 and 2D.
- 4B lands with 1D and gains one budget row per Phase 2 item; 4C closes the program.

## 4. Phase 0: measure first
Goal: attribute at least 90% of mean and p95 busy time per presented frame in the town
scenario, on the desktop and the phone, including work outside `requestAnimationFrame`.

**New modules**
- `src/game/frame_attribution_core.ts` (pure, `UI_PURE_CORES`): a section ledger with
  interned ids, nesting, a per-frame ring, busy versus unattributed time, p50 and p95.
- `src/game/frame_attribution.ts`: the thin consumer. It emits `performance.measure` marks
  in trace mode and runs a post-frame `MessageChannel` probe that approximates style,
  layout, paint and commit, so a phone without DevTools still reports them.
- `src/render/scene_graph_census_core.ts` (pure): total nodes (what `updateMatrixWorld`
  walks), nodes visible through the whole chain (what `projectObject` walks), auto-update
  nodes, meshes, skinned meshes and bones. Sampled at 1 Hz in perf mode only.
- `scripts/perf_trace_capture.mjs`: a CDP `Tracing.start` capture (timeline, V8 execute,
  GC, CPU profiler, user timing, GPU) against Chrome on the dev server, the Electron dev
  shell with a remote-debugging port, and an Android WebView through `adb forward`.
- `scripts/lib/trace_attribution.mjs` (pure analyzer): segments frames and buckets user-timing
  sections, unsectioned script time by module URL, out-of-frame tasks (WebSocket
  messages, timers, input), browser steps (style, layout, paint, commit), GC and GPU
  process time. Prints the attributed share and a verdict.

**Changed files**
- `src/game/perf.ts`: the existing `startTrace` / `finishTrace` sites in `frame()` also feed
  the ledger under `?perf` or `?attrib=1`. The overlay gets an attribution line and the
  report an `attribution` block. `src/main.ts` stays net-zero.
- `src/net/net_pipeline_stats.ts`: per-message parse and apply time into the out-of-frame
  bucket.
- `src/render/renderer_frame_telemetry_core.ts`, `src/render/renderer_perf_stats.ts`: rolling
  p50/p95 per world sub-phase (today only the last frame), entity-loop sub-phases (create
  and drop, view update, mixers), and the census sample.
- `scripts/crowd_fps_bench.mjs`: `CROWD_TRACE=1`, a documented 3440x1440 Low scenario
  (`CROWD_W`, `CROWD_H`, `CROWD_GFX=low`), and an offline no-bots arm.

**Tests**
- `tests/frame_attribution_core.test.ts`: nesting, unattributed math, percentiles, zero
  allocation.
- `tests/trace_attribution.test.ts`: the analyzer over a small committed synthetic trace.
- `tests/scene_graph_census_core.test.ts`: counts, including a hidden ancestor pruning its
  subtree.
- `tests/client_frame_allocations.test.ts`: extended so the ledger path allocates nothing,
  on or off.

**Captures**
- Electron at 3440x1440 Low with 40 or more players in town (local server plus bots):
  trace and attribution.
- Render scale 100% versus 50% A/B.
- A separate `?gputimer=1` run. That flag retires the shader-warm worker, so it is never
  combined with the attribution run.
- The phone, same scenario, through Android remote debugging.

**Exit and decision gate**
- At least 90% attributed on both devices, published in
  `docs/design/client-frame-overhaul/phase-0-attribution.md`: R (render), M (all other
  main-thread work), browser steps, GC, out-of-frame time, and the GPU verdict.
- The worker speedup bound (R + M) / max(R, M) decides how much of 1B is built before
  Phase 3 and the Phase 2 priority order. The targets in section 1 are re-set here.

## 5. Phase 1: the render boundary, in-process
Goal: the renderer reads a plain-data feed and publishes outputs instead of being called
synchronously. No FPS change is expected; the budget is at most 0.3 ms of regression on the
desktop and 1.0 ms on the phone. This is what Phase 3 moves across a thread, and it also
gives a server-free replay bench.

**Design rules**
- Hot state is state-based, so coalescing a skipped packet loses nothing; events and
  commands are one ordered stream.
- Each entity id keeps one stable record for its lifetime.
- Every sweep has a two-way ratchet allowlist: a new violation fails, and so does a stale
  entry.

New subsystem `src/render/feed/` (barrel `index.ts` plus `CLAUDE.md`, template
`src/render/characters/`); every `*_core.ts` in it is pure and registered.

### 1A0. Type narrowing (zero runtime change, the smallest de-risking slice)
- `feed/render_world.ts`: `RenderWorld = Pick<IWorld, ...>`, `RenderEntity = Pick<Entity, ...>`
  and `RenderAura`. Commands are excluded; the dev spell lab
  (`src/render/spell_lab/spell_lab_runtime.ts`) gets an injected `SpellLabCommands` handle.
- A mechanical sweep of every `src/render` file that imports `IWorld`: `IWorld` becomes
  `RenderWorld`, and world-sourced `Entity` becomes `RenderEntity`. Sim helpers called with
  entities get `Pick<Entity, ...>` parameters. `Sim` and `ClientWorld` still satisfy the
  narrowed types, so `src/editor/3d/viewport.ts` is unchanged. Lands as per-directory PRs.
- Pin: `tests/render_world_parity.test.ts` (`RENDER_WORLD_MEMBERS`, `RENDER_ENTITY_FIELDS`,
  `AssertNever` exhaustiveness, every member present in `IWORLD_MEMBERS` with the same kind).

### 1A1. Columnar entity table (pilot, shadow mode)
- Modules: `feed_schema_core.ts` (column descriptors, hot/warm/cold classes, clock domain,
  `FEED_SCHEMA_VERSION`), `entity_table_core.ts` (struct of arrays, stable rows, free list),
  `string_table_core.ts` (append-only interning; a generation reset forces a resync),
  `feed_builder_core.ts` (main side, `packFrame`), `feed_world_core.ts` (render side,
  `FeedWorld implements RenderWorld`).
- Columns:
  - hot, Float64 for bit-exact parity: position, previous position, facing, hp, resource,
    cast timers, climb progress, `netUpdatedAt` / `netInterval`, with a per-row `hotSeq`;
  - warm: a u32 flags bitfield, target / aggro / owner ids, level, scale, skin, kind, emote
    sequence, interned strings;
  - cold side tables with epochs: aura arena, modular appearance, equipment, labels, ferry
    deck;
  - a per-row `rowVersion`, the hook for the version-gated diffs in 2F.
- Change detection on main compares warm fields one by one and compares cold objects
  structurally against the last encoded copy, which catches the Sim's in-place mutation.
- Identity on decode:
  - one record per id, updated in place, and `prevPos` is a stable object;
  - `modularAppearance`, `equippedInstances` and `auras` are replaced only when their epoch
    bumps, which keeps the live identity compares (`live_look_diff.ts`, the
    `legendaryRegaliaRef` check in `renderer.ts`) correct;
  - `FeedWorld.entities` is a real `Map`, with source order rebuilt when
    `entityRosterVersion` changes;
  - `player === entities.get(playerId)` holds, including the spectate swap.
- Pilot scope: the entity roster only (entities, player, playerId, roster version, cfg). If
  parity or cost fails here, redesign before going further.

### 1D. Feed record and replay bench (pulled forward as the harness for Phase 2 and 4B)
- `feed_recorder_core.ts` / `feed_replay_core.ts`: a chunked container. The header holds
  schema version, seed, content id, build sha, tier and viewport. Each frame holds the
  packet, the command stream, the frame inputs and environment deltas. Saved gzipped
  through `CompressionStream`.
- `src/game/feed_record_wiring.ts`: `?feedrec=<sec>` and `window.__wocFeedRecord`, on
  loopback origins only, because recordings contain player names.
- A dev-only `feed_replay.html` with `src/dev/feed_replay.ts` (the `music_editor.html`
  pattern): `Renderer` over a `FeedWorld` with no Sim, server or bots, fixed dt, any
  viewport, and a pinned-governor mode.
- `scripts/feed_synth_town.mjs` (headless Sim plus seeded bots in the starting town, the
  hermetic CI fixture) and `scripts/feed_replay_bench.mjs` (phase ms, draws, programs,
  node census and heap delta through `scripts/lib/bench_gate.mjs`).

### 1A2. Facets, events, module state
- `facet_codecs_core.ts`: one codec per `RenderWorld` data member, each with a frequency
  class:
  - frame: ferry view, the `active*` ground effects, rift floor;
  - tick: quests, party, markers, battleground / arena / hill / vehicle views;
  - rare: cfg, stations, cosmetics, mounts.

  Methods with arguments become keyed tables (`questState(qid)`, `markerFor(id)`).
- `feed_events_core.ts`: SimEvents carry a monotone `seq` in the command stream, and
  `src/render/contact_queue.ts` keys on `seq` instead of a `WeakMap` of events.
- `module_state_codecs_core.ts`: an inventory of state the renderer reads outside `IWorld`.
  It covers sim module-level state read through pure helpers (active world content, voxel
  data, collider and dungeon gates, rift region, server time phase, and so on) and render
  module state written by main (`chosen_cadence.ts`, `arrival_cover.ts`,
  `background_gpu_queue.ts`, `context_restore_hold.ts`, `day_night_clock.ts`, the gfx tier).
  It is a no-op in-process; Phase 3 replays it in the worker.

### 1B. RenderPort and outputs
New `src/render/port/` (barrel plus `CLAUDE.md`).
- `render_port.ts`: the only renderer type `src/ui`, `src/game` and `src/main.ts` may
  reference. Every member is tagged command, mirror, async, lifecycle or dev.
  `inline_render_port.ts` runs in `direct` or `deferred` mode; `deferred` exercises the
  Phase 3 semantics in-process.
- `src/game/render_host_wiring.ts` composes builder, `FeedWorld`, renderer and port from the
  flags. `main.ts` replaces `renderer.sync(...)` and the camera property writes with one
  `renderHost.frame(inputs)` call on a reused struct (net-zero lines).
- `render_outputs_core.ts` publishes at the end of `sync`:
  - **Camera mirror:** `mirrored_camera.ts` keeps a real camera on main, so
    `worldToScreen`, `groundPoint`, the seat pick and `src/game/interactions.ts` work
    unchanged.
  - **Pick mirror:** `pick_scene.ts` is a never-rendered scene on main holding the shared
    click-proxy cylinders (`clickGeo` in `src/render/characters/visual.ts`) and the
    object, gather-node and placed-mover hulls (each published once), synced lazily on a
    pick. `src/render/world_picking.ts` keeps its logic and swaps hosts; the sloppy pick
    reads a view-metrics table, and the health-bar pick reads published bar rects.
  - **Audio and haptic queue:** `audio_command_core.ts` implements `SpatialAudioSink` as a
    ring that is replayed on main at the end of `sync`, and the sink's queries become an
    `audioState` codec. The direct `game/sfx` imports (`authored_map/placed_frame.ts`,
    `drowned_temple/temple_moonbridge_fx.ts`, the hoard audio uses) and
    `playContactHaptic` in `impact_contact.ts` move onto the sink.
  - **Contact answers:** `contact_answer_core.ts` maps seq to delay; the answer is
    synchronous in `direct` mode and at most one frame late in `deferred` mode.

### 1C. RenderEnv (independent; can start on day one)
- `src/render/render_env_core.ts`: a pure snapshot of viewport, DPR, visual viewport, media
  bits, body classes, fx level, frozen search string, boot `woc_settings`, navigator facts,
  hidden state and a fonts epoch, plus derived queries such as `reducedMotion`.
- `src/render/render_env.ts` holds the reader and `createRenderCanvas`.
- `src/game/render_env_wiring.ts` becomes the sole owner of the DOM listeners.
- Sweep the renderer's DOM reads to it, including the per-frame `dataset.fxLevel` read for
  the nameplate cadence and the `localStorage` / `location` reads in `gfx.ts`. Then sweep
  every `document.createElement('canvas')` site in `src/render` to the factory; that part
  may trail into Phase 3 prep.
- DOM-painter allowlist until 2D: `nameplate_canvas.ts`, `chat_bubble_layer.ts`,
  `travel_speed_fx_painter.ts`, `context_release.ts`.

### Phase 1 tests (each pins one decisive property)
- `render_world_parity`: the member and field lists, exhaustiveness, and schema
  completeness (every field has exactly one column or side table).
- `render_feed_sim_parity`: an offline Sim with bots runs a scripted session (cast, auras,
  mount, death, ghost, emote, roster churn). Every tick it packs, decodes and compares every
  member and field, plus the identity invariants.
- `render_feed_client_parity`: the same over a GameServer and `tests/helpers/bare_client.ts`
  (lite versus full records, prune, `prevPos` reassignment, spectate, reconnect).
- `render_feed_cost`: 150 entities, zero allocations after warmup, a packet byte budget,
  and zero bytes for unchanged cold facets.
- Unit suites:
  - `entity_table_core`, `string_table_core`, `facet_codecs_core`;
  - `feed_recorder_core` (refuses a schema mismatch; a replay reproduces the states);
  - `render_port_members` (every member categorized and implemented);
  - `camera_mirror` (`worldToScreen` parity, including the behind flag);
  - `pick_mirror_parity` (at least 10k seeded rays give identical ids, order and
    distances against the live scene, plus a descendant-type census of the object
    builders);
  - `audio_command_queue` (an exhaustive op table over `SpatialAudioSink`, ordering,
    overflow);
  - `render_env_core`;
  - `render_feed_module_state` (every module-level mutable binding reachable from the
    renderer is codec'd or allowlisted).
- Updated: `desktop_presentation_threading`, `client_frame_allocations`, the contact-queue
  suites, `architecture`, `monolith_budget`.

### Phase 1 guard
`tests/render_boundary_guard.test.ts` holds two-way ratchets. Each tracks one set of
files, with the floor it must shrink to:
- render files importing `IWorld`: only `feed/render_world.ts` and the builder;
- render DOM-global reads: only the painter allowlist and `render_env.ts`;
- render imports of `game/sfx`, `game/haptics` or `game/audio`: none;
- canvas creation: only the factory;
- `ui` / `game` / `main.ts` references to `Renderer`: only the editor.

### Phase 1 flags and rollout
- Flags: `?renderfeed=off|shadow|on`, `?pickmirror=off|shadow|on`,
  `?renderport=direct|deferred`, `?audioqueue=direct|queued` and `?feedrec=<sec>`, read
  only in `render_host_wiring.ts`.
- Rollout:
  1. Dev runs shadow mode with a mismatch counter in `?perf`.
  2. Dev turns it on, and production samples shadow sessions with a `renderFeed` block in
     `src/game/perf_reporter.ts`.
  3. Production turns it on, with `off` as a kill switch for one release.
  4. The `off` paths are deleted and the allowlists reach their floor.

### Phase 1 exit criteria
- Pack plus decode p95 at most 0.25 ms on the desktop and 0.8 ms on the phone at 150
  entities; typical packet at most 32 KB; zero steady-state allocation.
- Zero parity mismatches in both Node suites and in a 10-minute 40-bot shadow run; zero
  pick mismatches; hover and click no longer raycast the live scene.
- Allowlists at their floor; feed replay reproduces the live renderer phase cost within
  10% at 3440x1440, 844x390@3 and 1280x720; the `renderer.ts` ceiling lowered.

## 6. Phase 2: GPU crowds and a lighter world
Goal: halve the renderer's own CPU cost in town. Each item adds a row to the 4B budget file.

- **2A. Batched far bodies.** Far-LOD meshes move from one `Mesh` per body into a
  `BatchedMesh` per material shape.
  - Seams: `setFar` / `syncFarVisibility` in `characters/visual.ts`,
    `characters/far_lod_reveal_core.ts`, `woc_far_bake.ts`, `static_pose_bake.ts`.
  - Requires adding `WEBGL_multi_draw` to `RENDERER_CONTEXT_EXTENSIONS`
    (`src/render/renderer_extensions.ts`, pinned in `tests/renderer_extensions.test.ts` and
    `tests/context_restore.test.ts`) and `batching` to
    `characters/material_program_shape_core.ts`.
- **2B. GPU-animated crowd tier.**
  - **Bake.** Runtime-baked bone-matrix textures per (skeleton, clip), built from the
    `prepareVisual` clip map (`characters/assets.ts`):
    - model-space matrices at 30 Hz (or 20 Hz with shader interpolation), half-float
      RGBA, three texels per bone per frame;
    - estimated about 1.8 MB per player body type and about 1.3 MB per creature, baked
      only for resident skeletons, with no download or repo growth;
    - baked as `background_gpu_queue.ts` units (the `woc-far-*` pattern), with an optional
      IndexedDB cache.
  - **Shader.** One module-scope chunk patch (template `final_color_nan_guard.ts`) adds a
    `USE_BAKED_SKIN` arm with per-instance clipA, timeA, clipB, timeB and blend.
    - It composes with the `tintedMaterial` layers through `material_clone_hooks.ts`, with
      a depth twin through `shadow_depth_materials.ts`.
    - Rigid bone-attached children (merged head, weapons, halo) become 1-bone skinned
      pieces, as the `woc_armor_merge` rigid-part path already does.
  - **CPU side.** `CharacterVisual` keeps its state machine. A pure `clip_clock_core.ts`
    mirrors the mixer's crossfade, timeScale and clamp semantics and writes instance
    attributes instead of calling `mixer.update`.
  - **What stays on the CPU rig:** bodies with procedural edits (ride IK, climb, stow lift,
    bone dials, gesture toggles, effigy, metamorph wings).
  - **Swap.** Follows the `far_lod_latch.ts` pattern, gated, with stand-in rows and prewarm
    manifest entries.
  - **Exit:** skinned draws at most the number of rig families, and entity-phase time
    halved at 90 rigs.
- **2C. Static world nodes.** Driven by the Phase 0 census:
  - a `patches/three@0.185.1.patch` hunk that lets a frozen root skip its subtree walk,
    and/or `BatchedMesh` per material for the towns (`eastbrook_town.ts`, `fenbridge_town.ts`
    per-building groups and their per-frame `staticCullTargets` / `roofHideTargets` loops);
  - freezing `dungeon.ts` interiors and distance-gating `updateWallOcclusion`;
  - replacing the per-frame foliage bucket walk with a visible set recomputed when the
    camera changes cell.
- **2D. GPU nameplates and chat bubbles.** Needs 1A2 and 1B, and must land before Phase 3.
  - Instanced quads over cached label rasters (the `ui/text_sprite_cache` leaf; text stays
    `t()` / `tEntity`), with labels and hp from the feed and bar rects sent to the pick
    mirror.
  - Forced-colors and fairness parity pinned. This retires the DOM-painter allowlist.
- **2E. Frame-system registry.** `src/render/frame_systems/` (barrel plus `CLAUDE.md`).
  - Each driver declares its phase and an `activeWhen` predicate, and is dormant by
    default; `sync()` calls `registry.run(phase)`.
  - A source-scan pin requires every driver called from `sync` to be registered, and each
    system reports rolling milliseconds.
  - Fix the per-frame allocations in `realm_flora.ts` on the way.
- **2F. Version-gated view diffs** (needs 1A1). Skip the skin, weapon, look and aura diffs
  while `rowVersion` is unchanged.

Exit: town draws and renderer-phase time at or under the gate targets on both devices;
screenshot parity of baked versus CPU crowds; zero live programs.

## 7. Phase 3: the renderer on its own thread
- **Spike first: confirm host support.** Check `transferControlToOffscreen`, WebGL2 in a
  module worker, nested workers (the KTX2 loader, the zone build pool), `createImageBitmap`
  textures, the Electron CSP `worker-src`, and iOS WKWebView on a real device.
- **Seams.** `src/render/host/render_worker.ts` (entry), `worker_render_port.ts` (main), and
  `render_host_protocol.ts` (modeled on `shader_warm_protocol.ts`). They reuse the port
  categories, `FeedWorld`, RenderEnv and the module-state replay.
- **Transport.** Two feed buffers and two output buffers ping-pong as transferables.
  - While the worker is busy, main coalesces: state is replaced and commands are appended.
  - No `SharedArrayBuffer`: COEP stays off for cross-origin GLB and HDRI loads
    (`server/http/middleware/security_headers.ts`).
  - Clock-tagged fields are translated at decode.
- **Worker side.**
  - The canvas factory returns `OffscreenCanvas`, and the asset loaders run in the worker.
  - Context loss and restore and the graphics rebuild run inside it (a canvas transfers
    only once). i18n and fonts load in the worker.
  - Decision point: either the camera is an output (overlays one frame late), or
    `updateCamera` is extracted into a plain-data rig that runs on main.
- **Inline fallback is first-class:** for the editor, older WKWebView, a failed probe and
  the iOS memory profiles.
- **Exit:**
  - main busy time at most M plus pack, and worker busy time at most R;
  - input-to-visible within one frame of inline;
  - FPS targets met on both devices;
  - the fallback engages automatically.

## 8. Phase 4: governor, Low resolution, budgets
- **4A. Governor and Low resolution** (right after Phase 0, on Track B).
  - **Governor.** Retarget it from its fixed 60 FPS band (`GFX_BUDGETS` in
    `src/render/gfx.ts`; `canRecover` / `canEnrich` in `src/render/render_budget.ts`, which
    refill headroom with scene density) to ratios of the measured refresh interval
    (`display_refresh_estimator_core.ts`) times the cadence divisor.
  - **Auto ceiling.** Review its cross-session memory (`frame_cadence_auto_memory.ts`).
  - **Low runtime resolution.** Enable the grade-only path for Low (the `?cel=on` /
    Effects-Low arm) and unlock the resolution rung (the min equals max lock behind
    `dynamicResolutionGovernorRange`).
    - The blit does ACES and sRGB.
    - `CompileArmHost.offscreen()` in `compile_arms.ts` reports true for Low, so prewarm
      links the offscreen variants.
    - Measure the extra pass on the phone.
  - **Fairness:** the governor sheds cosmetic detail only.
- **4B. Deterministic CI budgets** (with 1D). Feed replay runs in headless Chrome with a
  pinned governor and fixed dt, and gates draw calls, programs, node visits, heap delta per
  frame and feed bytes. The budget file is diffed in CI.
- **4C. Close-out.** A release-tier real-GPU run through `scripts/perf_tour.mjs` with new
  2560x1440, 3440x1440 and 844x390@3 viewports and absolute `PERF_MAX_*` thresholds
  including phase time. Add a "frame budget" rule to `src/render/CLAUDE.md`.

## 9. Top risks
1. **FeedWorld drifts from the live world** (in-place mutation, identity, order).
   Mitigation: type narrowing first, parity tests against both worlds, a
   schema-completeness pin, shadow mode, a kill switch.
2. **Pack cost eats the phone win.** Mitigation: the 1A1 pilot measures it before the
   sweep, and `hotSeq` row skipping.
3. **Sweep size and merge churn.** Mitigation: per-directory type-only PRs, a codemod, and
   ratchet allowlists.
4. **Pick regressions.** Mitigation: three's own raycast over mirrored geometry, a
   descendant-type census, shadow-mode parity.
5. **Synchronous round trips that cannot cross a thread** (contact delays,
   `worldToScreen`, audio queries). Mitigation: every port member is categorized, and
   `deferred` mode runs in-process first.
6. **Hidden cross-realm module state.** Mitigation: a module-graph pin test.
7. **Baked-animation fidelity.** Mitigation: the CPU rig stays for actionable and
   procedural bodies, plus screenshot parity.
8. **More shader programs from the new skin variants.** Mitigation: prewarm manifest
   entries and gates, with zero live programs as the bar.
9. **Phase 1 alone yields no FPS.** Mitigation: Track B (2A, 2B, 2C, 2E, 4A) runs in
   parallel after Phase 0.
10. **Platform gaps in Phase 3.** Mitigation: a spike first, a capability probe, the inline
    fallback.

## 10. Verification
- **Every step:**
  - its pure-core Vitest suites;
  - `tests/architecture.test.ts` and `tests/monolith_budget.test.ts`;
  - `tests/world_api_parity.test.ts` unchanged;
  - `node scripts/gate_select.mjs` and `/qa`.
- **Phase 0:** the `trace_attribution` fixture test, plus real captures on the reference
  desktop (Electron, 3440x1440 Low, a 40-bot town through `npm run perf:crowd` with
  `CROWD_TRACE=1`) and on the phone.
- **Phase 1:** shadow-mode mismatch counters at zero in a 10-minute crowd bench; feed
  replay within 10% of live.
- **Phases 2 and 4:**
  - a feed-replay bench before and after each item (draws, programs, node visits, phase
    time);
  - the 4B budget file in CI;
  - desktop and mobile screenshots for crowd and nameplate changes;
  - zero new live programs in the hitch referee.
- **Phase 3:** identical replay frames inline and in the worker, plus device runs (the
  Windows build on the reference desktop, the phone) against the Phase 0 baseline table.
