# Performance and Feel Audit

Date: 2026-06-14

This audit is based on the current `main` worktree plus the open GitHub issue/PR queue as of 2026-06-14. It focuses on browser and mobile feel: frame pacing, input authority, camera/rotation response, network cadence, DOM/HUD cost, asset upload, and release overlap.

## Executive Read

The current renderer is already past the obvious first pass. It has graphics tiers, software-GL detection, render scale, no default-framebuffer MSAA, entity draw distance, far LOD, proxy shadows, point-light budgeting, cached materials, terrain/prop/foliage distance updates, network interpolation, server interest management, and per-session wire deltas.

The remaining money is therefore not a single "make it faster" change. It is:

1. **Adaptive quality under real frame pressure.** Static `high` can still crush mobile Safari, Android Chrome, integrated GPUs, and thermal-throttled laptops. The game needs to react to measured frame time.
2. **Input and movement authority.** Community feedback specifically calls out rotation lag, delayed movement, airborne turning, camera/right-click edge cases, and target loss. These are feel issues even when FPS is fine.
3. **Main-thread/HUD discipline.** `Hud.update()` still touches many DOM nodes every frame. Several paths are diffed, but the high-level update cadence is still render-frame-driven rather than dirty-state-driven.
4. **Asset memory/upload budgets.** Local assets are about 25 MB models, 33 MB textures, and 30 MB HDR environment maps. Multi-megabyte terrain maps and 2K HDRs are especially risky on phones because decode and GPU upload can stall the main thread.
5. **Measurement before tuning.** There is no always-on lightweight client frame telemetry, input latency telemetry, GPU-ish renderer stats sampling, or browser/device bucketing. Without it, release decisions rely on anecdotes.

## What Is Already Covered By Open Work

Avoid duplicating these:

- `#84 perf: bound and dedupe autosaves` is already included in the v0.5 moderate batch. This addresses server persistence spikes, not client frame feel.
- `#140 fix: stabilize mobile joystick pointers` is directly mobile-control related. Do not duplicate pointer capture stabilization there.
- `#116 Annoying mouse capture spam` is marked landed on `release/v0.5`. Do not reintroduce pointer-lock/capture prompts as a camera fix.
- `#134 Expose quest log on mobile controls` is landed for v0.5. Mobile HUD access should build on it.
- `#153 Tune mob reset and social pull behavior`, `#102`, `#103`, `#94`, and `#95` are gameplay-feel adjacent, but not renderer performance.
- `#78 Agent movement input channel` landed on v0.5 for browser-driven testing. Use it to automate feel/perf tours rather than inventing a second test API.
- `#142 Release: v0.5` is the active release coordination issue and already lists verification commands and manual smoke paths.

Community feedback from `#10` is the clearest movement-feel signal:

- Running/jumping jitter was previously reported and apparently improved.
- Remaining complaints include rotation lag while strafing/right-clicking, short right-click taps not rotating as expected, online rotation being worse than offline, preserving airborne momentum, instant forward/back/strafe response, instant 180-degree camera turns, target brittleness when left-drag starts over enemies, jumping animation, and a general request to make movement/animations feel robust like WoW.

## Change Made In This Pass

`src/render/renderer.ts` now has runtime adaptive render scale, and `src/game/perf.ts` adds the first client perf telemetry slice behind `?perf`.

The user setting remains the quality ceiling. The renderer tracks an EMA of frame time and temporarily lowers the effective render scale after sustained bad frame times, with mobile-biased thresholds and slow recovery. Mobile sessions now start at an effective scale no higher than 0.85 unless `?gfx=high`/`ultra` explicitly forces quality, then recover toward the saved ceiling only after sustained stable frames. This is intentionally runtime-only and does not rewrite `localStorage`.

The perf monitor samples frame time, coarse main-thread buckets (`renderer`, `hud`, `events`, `sim`), browser Long Tasks, JS heap pressure where the browser exposes it, renderer draw/memory stats, network snapshot cadence, input intent latency, startup asset load timing, viewport/DPR/mobile state, and exposes it as `window.__game.perf.report()` plus a click-to-copy overlay when `?perf` or `localStorage.woc_perf = "1"` is enabled.

The renderer also no longer performs a layout-read viewport measurement every frame. Resize/orientation/fullscreen/visualViewport events still apply immediately, while the render loop keeps only a 4 Hz safety poll for missed browser viewport changes.

Nameplate DOM work is now cadenced: all plates refresh at 24 Hz on desktop and 15 Hz on mobile, while selected, very-near, or casting entities still update between full passes. Per-nameplate display, transform, label, marker, opacity, and HP width writes are cached so unchanged values do not hit the DOM every frame.

The HUD now keeps combat-critical widgets frame-rate responsive while cadencing lower-urgency work: minimap at 10 Hz, party/trade/arena/map/zone/music/quest maintenance at 4 Hz, and heavier social/market refreshes at 2 Hz. The remaining frame-rate widgets now cache their DOM handles and diff hot text/style writes before mutating the DOM, with `window.__game.perf.report().hud` exposing hot write/skip totals so releases can prove UI churn is falling.

The sky preload now chooses the shipped 1K HDR environment maps for phone-class or low-memory browser sessions, while preserving 2K HDRs for explicit high/ultra and normal desktop sessions. This cuts the HDR environment payload from roughly 17 MB to roughly 4 MB before decode/upload on the devices most likely to stall.

The initial graphics tier now also treats phone-class or low-memory browsers as `low` unless the URL explicitly forces `?gfx=high` or `?gfx=ultra`. This matters because terrain splat texture preloads are kicked off at module import time, before the renderer can inspect the actual WebGL context. Mobile now avoids the expensive terrain splat shader path and its external terrain color/normal texture preload by default instead of merely lowering render scale after the payload is already fetched.

Low/mobile water now stays fully procedural too: the shader-tier water normal JPEGs are only preloaded when `GFX.standardMaterials` is active. The legacy Phong water path uses generated canvas normal maps, removing three more external texture fetch/decode/upload steps from automatic mobile startup.

Dungeon interior kit models are no longer part of the boot preload gate. The renderer now starts loading/extracting the dungeon kit only when the player is inside an arena/dungeon interior band, then emits the interior asynchronously when those assets are ready. Outdoor first-playable time should no longer wait on roughly sixty interior-only GLBs.

Low/mobile foliage now uses a smaller source-variant set at preload time and a smaller runtime world budget. The low tier already capped each bucket to one variant per species; this makes the asset preload match that runtime behavior instead of fetching every high-tier tree/rock variant that low/mobile would never show in a single bucket. Low/mobile also skips tiny ground-dressing GLBs entirely, pulls foliage/rock LODs closer, thins deterministic tree/rock decoration placement before instancing, and shrinks the grass alpha ring so weak GPUs submit fewer offscreen/fogged triangles and transparent pixels. A live Three scene probe showed the low-tier spawn view was foliage-bound: roughly 2.67M visible foliage triangles versus ~43k terrain and ~220k props. After deterministic foliage thinning, the mobile tour's max sampled triangles fell from 2.878M to 1.019M, and input-intent-to-visible p95 in that run improved from 1584 ms to 258 ms.

Low/mobile props now use a reduced asset subset too. Large gameplay/world silhouettes remain: buildings, fences, campfires, tents, mines, docks, huts, grave markers, and ruin columns. Small decorative-only prop GLBs such as stall clutter, lantern models, extra grave variants, toadstools, and toppled relic dressing are not preloaded or drawn on low/mobile.

Low/mobile character visuals now alias the most expensive role-only variants before the preload gate: skeleton warrior/rogue/mage roles reuse the minion skeleton rig, hooded bandits reuse the regular rogue rig, and external weapon attachments are skipped on low tier. High/default graphics still load the full visual manifest. On the mobile tour this dropped preload tasks from 73 to 62, GLBs from 57 to 46, and boot payload from 19.991 MiB to 12.608 MiB. This is a deliberate mobile tradeoff: fewer first-play stalls and less memory pressure are worth more than distant enemy silhouette variety on constrained browsers.

Entity views are now created from a client-side interest band instead of eagerly building a Three group, rig, nameplate DOM node, click proxy, animation mixer, and cached pose data for every sim entity at renderer startup. The player and selected target are immediate; nearby missing views are created closest-first with a low-tier budget of four per frame and a wider destroy hysteresis band. The hot per-frame animation/render update loop and nameplate overlay pass now iterate live renderer views instead of every sim entity, so runtime cost scales with visible interest instead of total world population. On the mobile tour, steady renderer views dropped from 323 to 41, input-intent-to-visible p95 dropped from 1001 ms to 210 ms, and browser Long Task max dropped from 2623 ms to 2348 ms while keeping the same 12.608 MiB boot payload. This is the browser-client equivalent of MMO interest management: the sim may know about the world, but the renderer should only pay for the world near the camera.

`npm run asset:budget` now reports total media bytes, per-class budgets, largest files, JSON output, and CI-friendly failures. The current repo is 225 tracked media files / 88.426 MiB: textures 32.929 MiB, env HDRs 29.994 MiB, character GLBs 15.305 MiB, and all other model/VFX groups under 4 MiB each. Budgets can be tightened per release with `ASSET_BUDGET_TOTAL_MIB`, `ASSET_BUDGET_TEXTURES_MIB`, `ASSET_BUDGET_ENV_MIB`, `ASSET_BUDGET_MODELS_CHARS_MIB`, and the other printed group names.

Asset startup timing is now recorded by type (`gltf`, `hdr`, `texture`) with count/failures/avg/p95/max/bytes/slowest plus the total preload gate wait. This makes the first playable frame delay visible in the same `?perf` report as runtime jank.

The asset timing snapshot also includes the full successful loaded-file list, which lets the perf tour derive static byte totals for the actual boot path. This is separate from the repo-wide asset budget: mobile can now fail a release gate for loading too many GLBs/textures/HDRs before first play even if the total asset library is still within budget.

Online input now flushes movement/facing changes immediately, throttled to roughly one packet per frame, while keeping the old 50 ms interval as a heartbeat. This removes up to one sim tick of avoidable timer-phase latency from camera/mouselook and movement changes.

Input feel now has first-class perf samples: key/mouse/touch movement and look intents record time to next frame-loop pickup, time to sim/network consumption, time from sent input packet to authoritative snapshot echo, and time to the next rendered frame. Online sends are counted only when `flushInput()` actually writes a changed packet, and snapshots echo the last processed input sequence, so the report can distinguish input throttling, server/snapshot delay, and render delay.

Camera follow now keeps the existing one-to-one interpolation for server/keyboard turns, but settles behind the character more aggressively while moving and snaps very large behind-camera offsets instead of easing a 180-degree turn across multiple frames. The follow math is covered by unit tests so future camera tuning can be deliberate instead of subjective.

Mouse click-pick resolution now uses the mouse-down screen point instead of the mouse-up point, rejects real drag gestures using both movement deltas and pointer-position drift, and treats pointer-locked release coordinates as unreliable. This prevents small camera drags or pointer-lock release quirks from clearing or changing targets from an empty release point when the player started the gesture on an enemy.

Jump movement now preserves horizontal launch momentum while airborne. Grounded movement still changes direction immediately, but once a jump leaves the ground, facing/camera can continue changing without rewriting the airborne movement vector until landing or splashing into water. This directly targets the "airborne turning without movement-vector correction" feedback.

The perf report now includes WebGL vendor/renderer identity and context lost/restored counters, so browser-specific lag reports can be bucketed by actual GPU/driver/backend instead of user agent alone.

`npm run perf:tour` now drives a repeatable offline browser tour and writes a JSON artifact under `tmp/` with desktop and mobile viewport samples from `window.__game.perf.report()`. The tour boots with `?perf`, samples spawn, town/nameplate, movement, strafe, look, and map-open/close states, and records page errors separately from ignorable local `/api/project-stats` failures. Use `PERF_VIEWPORT=desktop|mobile|both`, `PERF_STEP_MS`, `PERF_SETTLE_MS`, `PERF_BOOT_TIMEOUT_MS`, `PERF_OUT`, and `GAME_URL` to tune release captures. The summary also maps the loaded file list back to `public/` and reports actual boot MiB by type, with optional gates through `PERF_MAX_BOOT_MIB`, `PERF_MAX_BOOT_GLTF_MIB`, `PERF_MAX_BOOT_TEXTURE_MIB`, and `PERF_MAX_BOOT_HDR_MIB`. It also gates the newly measured feel/perf invariants via `PERF_MAX_VIEWS`, `PERF_MAX_SAMPLE_CALLS`, `PERF_MAX_SAMPLE_TRIANGLES`, `PERF_MAX_INPUT_FRAME_P95`, and `PERF_MAX_INPUT_VISIBLE_P95`.

Browser hitch telemetry now records Long Task count/avg/p95/max/last age via `PerformanceObserver` when the browser supports it, plus Chromium-style JS heap usage via `performance.memory` when available. This catches "laggy browser" cases where frames are bad but the explicit renderer/HUD/sim buckets do not explain the stall: GC, extension/browser work, image decode, shader compile, or other main-thread tasks outside the measured game sections.

Boot asset starts are now queued by asset class instead of firing every import-time preload immediately. Phone-class or low-memory sessions start fewer GLB and texture loads at once, and HDR loads stay serial. A short mobile browser tour with the same 73 boot assets kept the 19.991 MiB boot payload unchanged while reducing observed boot Long Task p95/max from 6381 ms to 2698 ms and total Long Task time from 11.116 s to 7.561 s; the tradeoff is that the preload gate now honestly waits for the queued tail instead of the browser already being saturated before `assetsReady()`.

`npm run feel:smoke` now adds a browser-driven crispness gate for the movement complaints in `#10`. It boots offline, finds a dry unblocked test patch, drives the live `Input` object through the real frame loop, waits for authoritative sim ticks, and asserts forward response, reverse response, mouselook 180 response, airborne launch momentum with facing turn, and mouselook A/D strafe semantics from a deterministic mouselook yaw. The reset explicitly clears renderer and input camera yaw so stale camera-follow closure state cannot cascade between checks. The JSON artifact includes tick counts, chosen spot, latched input state, and wall-clock elapsed time so a failure can be separated into input latch, sim cadence, collision, or renderer stall.

Renderer reports now include `renderer.phaseMs` with rolling setup, entity, world-system, nameplate/chat-bubble, render-submit, and total phase summaries. The overlay shows the key p95s as `rph e/w/np/sub`, which turns "some browsers are laggy" reports into a first branch: entity animation/view churn, world update work, DOM overlay work, or GL/composer submit.

Why this is high-value:

- Mobile jank is often fill-rate and thermal bound. Reducing pixel work is the fastest quality lever.
- Users should not need to open settings while the game is already stuttering.
- It complements the existing `renderScale` slider instead of replacing it.
- Every further performance change can now be validated against renderer, HUD, sim, and network timing instead of a subjective "feels laggy" report.
- Avoiding per-frame layout reads removes a small but persistent source of browser-specific jank, especially on mobile viewports where browser chrome and visual viewport changes are expensive.
- Nameplates are one of the few renderer features that become browser DOM work instead of GPU work; cadencing and caching them reduces main-thread pressure in towns, parties, and combat clusters without making the current target feel stale.
- HUD work no longer fans every subsystem out of the animation frame path; action bars, cast bars, player/target frames, and cooldowns remain immediate while expensive panels update on humane cadences.
- Mobile HDR preload now uses assets already present in the repo instead of forcing 2K equirects through fetch, HDR decode, PMREM generation, and GPU upload on phone-class devices.
- Startup stalls can now be bucketed by asset class and slowest files instead of being reported only as "loading feels slow."
- Constrained browsers no longer begin every boot preload at once; GLB/texture/HDR starts are throttled to reduce browser-main-thread pileups during fetch/decode/parse callbacks.
- Online controls no longer wait for the next arbitrary 50 ms input timer before sending a changed movement/facing state, directly targeting the community report that online rotation feels worse than offline.
- Input latency, including server echo timing for online sessions, is now measurable in the same JSON artifact as frame/network/GPU-ish renderer stats. That is the missing bridge between "FPS is fine" and "controls feel mushy."
- Camera follow no longer treats a large moving turn as a slow cinematic settle; sharp turn-behind behavior is now explicit and tested.
- Browser-driven feel checks now cover forward/back response, instant 180 mouselook movement, airborne momentum while turning, and mouselook A/D strafe behavior through the real offline frame loop.
- WebGL identity, context-loss telemetry, browser Long Tasks, and JS heap snapshots make "laggy on some browsers" actionable: SwiftShader, ANGLE backend, integrated GPU, context reset, GC/heap pressure, and browser-main-thread stalls can now be separated.

## Highest-Value Next Work

### P0: Expand The Client Performance HUD/Telemetry Ring

The first profiler slice now exists behind `?perf` and `window.__game.perf`. Expand it into a release-quality measurement workflow.

Track:

- Rolling-window frame stats now exist in `window.__game.perf.report().windows.last10s/last30s`, alongside since-session counters. The overlay shows the 10-second FPS/p95/>50ms burst line so sustained stutter can be separated from a one-time boot spike.
- WebGL renderer/vendor string and context-loss counters are now in `window.__game.perf.report()`.
- Browser Long Task and JS heap telemetry now exist in `window.__game.perf.report().browser`; the overlay shows long-task count/p95/max and heap used/limit when available.
- First asset timing slice exists: preload gate wait, per-type load/parse/decode-ish timing, slowest assets, browser resource bytes, and the successful loaded-file list used by the tour's static boot-byte budget. Next: separate fetch, decode, GPU upload, shader compile, and first-render stalls more explicitly.
- First input latency slice exists: pointer/key/touch movement/look intent time to frame pickup, sim/network consumption, authoritative snapshot echo, and next rendered frame. Next: persist automated tour artifacts across desktop/mobile sessions.
- Automated JSON artifact emission now exists as `npm run perf:tour`. It now emits per-viewport summaries in the JSON and console, plus optional threshold failures through `PERF_MAX_FRAME_P95`, `PERF_MAX_LONG50`, `PERF_MAX_LONGTASKS`, `PERF_MAX_LONGTASK_P95`, `PERF_MAX_LONGTASK_MAX`, `PERF_MAX_PRELOAD_TASKS`, `PERF_MAX_GLTF`, `PERF_MAX_TEXTURES`, `PERF_MAX_BOOT_MIB`, `PERF_MAX_BOOT_GLTF_MIB`, `PERF_MAX_BOOT_TEXTURE_MIB`, `PERF_MAX_BOOT_HDR_MIB`, `PERF_MAX_CALLS`, `PERF_MAX_TRIANGLES`, `PERF_MAX_SAMPLE_CALLS`, `PERF_MAX_SAMPLE_TRIANGLES`, `PERF_MAX_VIEWS`, `PERF_MAX_INPUT_FRAME_P95`, and `PERF_MAX_INPUT_VISIBLE_P95`. Next: wire those thresholds into the release issue/CI once enough baseline artifacts exist.

This is the core missing AAA practice. You cannot manage feel without a frame budget dashboard.

Acceptance:

- `?perf` shows a compact overlay and copyable JSON samples, including rolling-window frame stats.
- Browser smoke tests can assert the overlay is present and non-crashing.
- A browser tour can produce a JSON artifact and compact summary for desktop and mobile viewports, including actual boot-path MiB by asset type. Use `PERF_STEP_MS=20000 npm run perf:tour` for a longer release-style capture, then add `PERF_MAX_*` thresholds when using it as a gate.

### P0: Movement/Camera Feel Pass Separate From FPS

Treat this as a control-system problem, not renderer optimization.

Areas to inspect:

- Server-authoritative facing: online applies `setMouselookFacing()` and sends changed input immediately with a frame throttle, while render camera interpolates facing. Community feedback says online rotation feels worse than offline; the perf report now separates client pickup, send, authoritative echo, and render response timing.
- First slice implemented: changed online movement/facing state now flushes immediately with a frame-level throttle, with the old 50 ms sender retained as heartbeat/backstop.
- Movement acceleration: if `Sim.tick()` uses any smoothing, friction, or delayed direction convergence, evaluate against the desired WoW-like immediate direction changes.
- Airborne rules: first slice implemented. Jump captures horizontal launch velocity and keeps it until landing/water, while grounded direction changes remain immediate and facing still updates for camera/targeting.
- Right-click semantics: short right-click/tap should enter the expected rotate path without browser capture spam.
- Browser feel smoke: `npm run feel:smoke` now drives the real offline frame loop and asserts forward, reverse, mouselook 180, airborne momentum/facing, and mouselook A/D strafe behavior. Next: extend it to online/jittered snapshots and synthetic drag-over-target coverage.
- Camera settle: large moving offsets now snap and medium offsets settle faster. Next: collect player feel notes against `window.__game.perf.report().input` while strafing, mouselooking, and doing instant 180-degree turns.
- Target clearing: first slice implemented. Mouse pick gestures are resolved from the press point and real drags are rejected, including pointer-lock release quirks. Next: add browser-driven drag-over-target coverage with `window.__game.controller` once the controller can synthesize mouse gestures.

Acceptance:

- Offline and online use the same movement/facing fixtures where possible.
- `npm run feel:smoke` produces a browser JSON artifact and fails on movement/camera regressions for rotation, strafe, jump, and 180-degree camera cases.
- Add online/jittered snapshot coverage and a browser drag-over-target case.
- Add a manual feel checklist to `#142` or a dedicated issue, because this cannot be validated fully by unit tests.

### P0: Continue Converting HUD Updates From Frame-Driven To Dirty/Cadenced

`Hud.update()` currently runs every animation frame and touches player frame, target frame, action bar, XP, zone/music, quest tracker, party, trade, arena, minimap, map, social, loot, vendor, and market.

Several subpaths already diff their own HTML or icon state. The first cadence split is implemented; the bigger remaining win is to make more panels event/dirty driven instead of timer driven.

Split:

- Current: frame-rate player/target/cast/action widgets with cached hot DOM handles and write-diffing; 10 Hz minimap; 4 Hz party/trade/arena/map/zone/music/quest maintenance; 2 Hz social/market while open.
- Next: make quest tracker, party frames, social snapshot, arena snapshot, inventory/bags/vendor, and market browse/collect dirty/event-driven where practical.

Acceptance:

- `window.__game.perf.report().hud` now exposes hot DOM write/skip counts for the frame-rate player/target/cast/action/XP path. Next: extend this to panel rebuild counts and DOM mutations per second for quest/social/market/bags.
- No visual regressions in action bar cooldowns/cast bar/nameplates.

### P1: Continue Asset Budget And Mobile Texture Tier

Current local asset weights:

- `public/models`: about 25 MB.
- `public/textures`: about 33 MB.
- `public/env`: about 30 MB.
- Largest HDR files: 5.2-6.7 MB each for 2K envs.
- Terrain normal/color maps are commonly 1.5-2.3 MB each.
- Character GLBs are 1.5-1.9 MB each.

The first HDR tier selection is implemented for phone/low-memory sessions. Continue making asset tier selection explicit:

- Low/mobile now loads 1K HDRs for the high-tier sky path, automatic phone/low-memory sessions start on the low terrain/material tier before terrain splat preloads are registered, low-tier water avoids external normal-map preloads, low-tier foliage/props/character variants preload fewer source assets and draw a tighter outdoor scene, and dungeon kits lazy-load on first interior use instead of blocking outdoor boot. Low-tier terrain also uses coarser heightfield spacing because the scene probe showed terrain is not the mobile triangle bottleneck. Next: consider no-HDR PMREM on the weakest devices after perf telemetry proves the need.
- Mobile now avoids terrain splat normal maps unless explicitly forced to high/ultra. Continue applying the same principle to foliage/prop material maps where the perf tour proves decode/upload pressure.
- Use compressed GPU texture formats for terrain where practical: KTX2/Basis for color/normal/roughness/AO.
- Use glTF compression where possible: meshopt/Draco plus texture compression for character GLBs.
- `npm run asset:budget` now reports byte sizes by asset class and fails when totals exceed the configured budgets. `npm run perf:tour` now covers the automatic boot-path side by deriving loaded-file MiB from `window.__game.perf.report().assets.files`. Constrained browser asset starts are queued (GLB 2, texture 3, HDR 1) so startup work is staggered instead of import-time burst loaded. Next: add tier requirement metadata if repo-wide budgets need to model optional high-tier-only assets without running a browser tour, and split the remaining parse/upload work by converting boot GLBs to lower-detail mobile variants or lazy-loading non-combat silhouettes. The latest mobile tour still loads 46 GLBs / 12.608 MiB before play, so GLB parse/upload remains a release-risk area even after the character aliasing and lazy renderer-view cuts.

Acceptance:

- Mobile startup fetch/upload path is visibly smaller in the network panel.
- No 2K HDR fetch, high-tier terrain splat preload, or external water-normal preload on automatic low/mobile tier unless explicitly forced with `?gfx=high`/`ultra`.
- CI can now report total bytes per asset class via `npm run asset:budget -- --json`; next is wiring the command into the release/CI gate.

### P1: Renderer Work Bucketing

The renderer loops all entities and updates several world systems every frame.

Keep:

- Current entity draw-distance culling, far LOD, mixer throttling, shadow gating, and light budget.

Improve:

- Nameplates now update in a 24 Hz desktop / 15 Hz mobile full pass, with selected/near/casting entities refreshed between passes. Nameplate/chat-bubble timing is now exposed as `renderer.phaseMs.nameplates`.
- Fire/flame animation: update visible flames only, and cadence distant flames.
- Clouds/god rays/sky/env biome: cadence some non-critical updates.
- Viewport measurement has been reduced from every frame to immediate resize events plus a 4 Hz safety poll. Future work can replace the safety poll with a `ResizeObserver` if browser coverage is acceptable.
- Raycast targets: keep proxy picking, but consider a spatial/screen-space list for sloppy pick instead of scanning all views.

Acceptance:

- `renderer.sync()` category timing is split so the cost of setup, entity loop, nameplates/chat bubbles, world systems, and render submit is visible in `?perf` and perf-tour JSON artifacts.
- Mobile viewport resize still works across orientation/fullscreen/browser chrome changes.

### P1: Network Feel And Snapshot Cadence

Server-side interest management is good: 90/100 yd hysteresis, NPC 120/130 yd, update divisors by distance, cached wire fragments, keep lists, and settle records.

Potential gaps:

- Client input send cadence and server echo timing are now visible through the perf report. The remaining gap is automated jittered-network capture, not blind instrumentation.
- Online interpolation allows alpha up to 1.25 for position but caps facing at 1 in the main loop. This may prevent oscillation, but it also means late snapshots can produce perceived camera/character disagreement.
- Combat-critical actors already update full-rate when target/aggro. Add direct metrics showing target/fighting entities are never starved during event-loop degradation.

Acceptance:

- Client input latency and server snapshot echo counters are exposed through the perf overlay.
- Add a two-client or simulated-network test with delayed/jittered snapshots.
- Prove camera/facing behavior under 100 ms and 200 ms jitter.

### P2: Mobile UX And Thermal Strategy

Existing mobile work includes fullscreen/landscape preflight, stable viewport handling, touch controls, and a render quality setting.

Next:

- Mobile now begins below full effective scale on phone-class sessions and recovers only after stable frames. Next: expose that behavior as an explicit preset so users understand why the quality ceiling and current effective scale may differ.
- Add explicit "Performance" graphics preset on mobile: low HDR, lower grass radius, nameplates cadenced, reduced post, fewer point lights.
- Make the mobile joystick and camera look path measurable: event-to-move/facing timestamps.
- Ensure all touch listeners that can be passive are passive. Keep non-passive only where pinch/double-tap prevention requires it.

Acceptance:

- iOS Safari and Android Chrome manual checklist includes 5-minute thermal play, rotation, combat, vendor/bags, chat, and map.
- Perf overlay records no sustained long-frame burst after entering world.

## Browser-Specific Risks

- **Safari/iOS:** WebGL memory pressure, context loss, expensive HDR/PMREM, limited fullscreen/orientation APIs, browser chrome viewport resize churn.
- **Chrome Android:** high DPR fill-rate, thermal throttling, shader compile/upload stalls, pointer/touch cancellation edge cases.
- **Integrated/old GPUs:** software GL is detected, but weak real GPUs may still get `high`. Adaptive render scale helps, but tier detection should also consider renderer string and measured startup frame time.
- **Extensions/ad blockers:** UI copy already warns that blockers can cause lag. Perf telemetry should record obvious blocked fetches and slow startup phases.

## Suggested Issue Breakdown

Create focused issues instead of one mega issue:

- `perf: add client frame/network telemetry overlay`
- `perf: make HUD update cadence dirty-state driven`
- `perf: mobile asset tier and HDR/texture budget`
- `feel: online movement/facing latency pass`
- `feel: camera/right-click/drag targeting audit`
- `feel: airborne momentum and instant direction response`
- `perf: browser smoke tour emits performance JSON`
- `perf: CI asset budget report`

## Verification Plan

Baseline commands:

```sh
npx tsc --noEmit
npm test
npm run build
npm run asset:budget
```

Browser checks:

- Desktop Chrome: fresh load, enter world, rotate camera, fight a mob, open bags/vendor/map/social.
- Mobile viewport in Chrome devtools: same path, with touch controls.
- Real phone: at least iOS Safari and Android Chrome, 5-minute play session each.
- `?gfx=low`, default, `?gfx=high`, and `?perf` overlays.

Automated:

- Use `window.__game.controller` from PR `#78` to run movement/combat tours.
- Capture perf JSON before and after each optimization.
- Fail only on strong invariants at first: no context loss, no startup exception, no blank canvas, no runaway long frames on test hardware.
- Current mobile smoke gate example, based on the retained `tmp/perf-tour-mobile-view-budget4-smoke.json` baseline with headroom for run-to-run SwiftShader variance:

```sh
PERF_VIEWPORT=mobile \
PERF_MAX_PRELOAD_TASKS=65 \
PERF_MAX_GLTF=50 \
PERF_MAX_BOOT_MIB=13 \
PERF_MAX_VIEWS=55 \
PERF_MAX_SAMPLE_TRIANGLES=1300000 \
PERF_MAX_INPUT_VISIBLE_P95=400 \
npm run perf:tour
```

## Bottom Line

The renderer has many correct local optimizations already. The biggest missing AAA-grade layer is a performance operating model: measure, adapt, budget, and verify by device class. For "crisp feel", the parallel track is movement/camera authority. Players will forgive lower pixels on mobile if input response is immediate; they will not forgive delayed turning, target loss, or camera disagreement even at high FPS.
