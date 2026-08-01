# Player Performance Overhaul: Brainstorm

Status: BRAINSTORM (input to the feature-packet planning docs; no phases authored yet)
Date: 2026-07-23, revision 2 (amended the same day after an external design review; every
adopted review claim was independently verified against the code first, and the refuted ones
are recorded in section 6 so they are not re-raised)
Base: release/v0.30.0 (investigated at the 16aeff8b0 tip)
Owner symptom: heavy lag while turning the camera and moving with arrow keys in the crowded
starting town, at roughly 100 concurrent players, in a desktop browser. Reproduces identically
on the LOW and ULTRA presets on the owner's Mac.

Goal: make the game absolutely performant and smooth at current and future scale while keeping
it beautiful. No band-aids: every fix lands module-first behind an existing seam, test-first,
inside the graphics-fairness invariant (a knob may shed cosmetic richness but never actionable
information).

---

## 1. Evidence base

How this document was produced: three adversarial investigation rounds over release/v0.30.0
(a 64-agent fan-out across nine subsystems, then two verification rounds of four deep
verifiers each), with every medium-or-higher finding independently re-verified against the
code, plus cross-examination of three external (codex) reports. Refuted claims are in
section 6.

Key data points (measured or replicated during this investigation):

- Owner repro: LOW preset lags the same as ULTRA in the crowded town. LOW disables the
  composer, AO, and dynamic shadows and caps pixel ratio at 1.48, so this strongly indicates
  the frame is main-thread CPU-bound on that machine (a browser CPU/allocation/GPU trace in
  Packet 0 confirms it formally; LOW parity alone is strong evidence, not proof).
- Fleet reports: some players report MEDIUM outperforming LOW. Verified real; see 4.5.
- 91-player Ultra capture (produced by scripts/crowd_fps_bench.mjs with vsync disabled;
  numbers below are from that capture, image not retained in-tree): frame p95 32 ms vs renderer p95 16.8 ms,
  entities 2.9 ms, nameplates 1.0 ms. Roughly 15 ms per frame of non-renderer main-thread
  work (HUD, snapshot apply, GC, style/layout); order-of-magnitude, since percentiles do not
  subtract. Note the same capture's "1 draw / 1 triangle" row is the draw-stats bug (4.6).
- Entity-stream bandwidth at 30 players walking in town: 115.3 KB/s/client
  (tests/bandwidth.test.ts, log-only figure; the committed gate is only "under 50% of the
  legacy protocol"). A 100-player town plausibly parses several hundred KB/s of snapshot
  JSON per client on the main thread; Packet 0 measures it directly.
- Server sim tick at 100 clustered players: about 1 ms median (bench replication), far under
  the 50 ms budget. The July 8 production profile (p95 loop ~31 ms, broadcast ~22.5 ms at
  54-85 players) predates the v0.29 broadcast fixes.
- Input-drop replication (exact bucket math, stated with assumptions): steady-state drop at
  offered rate r against the 40/s refill is (r - 40) / r once the 60-token burst drains
  (~3 s of continuous turning): 33% at 60 fps, exactly 50% at 80 msg/s (120 Hz), zero at or
  below ~30 fps. The drop regime therefore requires healthy FPS and is inactive during the
  owner's current low-FPS repro.
- Town census at spawn: roughly 90 skinned rigs in the 80 yd draw band with ~40 players
  present (players + 15 always-on NPCs + ~33 camp mobs), which pins the crowd LOD governor
  at its 48-rig saturation floor permanently.

Fleet context: production is one 4-vCPU box; DB load is now ~5% steady (fixed in v0.29).
A meaningful share of web players are on hybrid-GPU laptops where the browser binds the
integrated GPU (the page already requests powerPreference high-performance; Linux PRIME
ignores it; the desktop build forces the discrete GPU).

---

## 2. Root-cause model

Three independent problem families produce the symptom:

A. Steady low FPS in crowds (all tiers): per-rig character cost has no shedding lever
   anywhere: not in crowd LOD past its saturation point, not in the render-budget governor,
   not in any preset, and characters are not frustum-culled on shadow tiers. HUD adds an
   unbounded per-frame nameplate set on top.

B. Discrete hitches (movement, streaming, camera turns): synchronous player-rig rebuilds on
   interest churn (players are the one unpooled entity kind), count-based view-create bursts
   with no time deadline, full-scene compileAsync light-gather walks per created view, and
   shader program re-key/recompile waves whenever the effective point-light count flaps (the
   flap arms are tier-dependent; on LOW they fire during camera turns, which also explains
   the medium-beats-low reports). Plus per-event layout thrash in chat/log append and the
   hover tooltip.

C. Fleet defaults and dead instruments: strong desktops (including integrated Apple M-series)
   auto-resolve to ULTRA where the adaptive governor is disabled and retina DPR is uncapped
   in practice; draw-call statistics are garbage on composer tiers (so telemetry and the
   governor's draw signal are blind exactly where they matter); production perf reports
   carry no zone or crowd dimension.

Server-side: the crowded town stresses BOTH sides simultaneously, and the server share is
crowd-multiplicative, not merely CCU-linear. The per-viewer broadcast loop is
viewers x nearby entities: 100 co-located players is on the order of 10,000 personalized
candidate visits per pass (~200,000/s at 20 Hz) before NPCs, mobs, pets, event routing,
delta comparison, and JSON assembly. Costs are linear in CCU only when the population is
spread out. At 100 CCU this surfaces as snapshot cadence jitter (rubber-banding), never as
client frame drops; it is the dominant scaling risk for 200+ and Packet 6 treats it as such.

---

## 3. Guiding constraints (apply to every packet)

- Graphics-settings fairness (docs/design/graphics-settings-fairness.md): tier and governor
  knobs shed cosmetic richness only. Self, current target, and casting characters keep
  full-rate animation (the existing animatesEveryFrame carve-out), and Packet 1 extends that
  exemption to the far-LOD swap (section 4.1). Hostile nameplates, cast bars, HP, debuffs,
  and positions are never shed.
- One sim, three hosts: nothing here touches src/sim/ behavior except explicitly flagged
  server-side encoder work; determinism and rng draw order are preserved (parity goldens
  where a scan is replaced by a grid query).
- The snapshot wire is a stateful delta stream. Per-session delta state (lastSent strings,
  sentEnts versions, timer-wire caches) may be treated as durable only once the frame is
  enqueued on a live socket. Today this holds because every discard path (backpressure
  terminate, dead readyState) tears the session down and the resume path forces a full
  resync; any future frame skip, coalesce, or worker offload must preserve the invariant
  (commit after enqueue, or force resync).
- Module-first: new logic lands as small tested modules behind existing seams (RENDER_PURE
  CORES, PainterHost, the render-budget governor, settingsFor as the single knob source, the
  game-signals counter seam, RouteDef for any endpoint). The four coordinators never grow.
- Test-first: every behavior change gets a decisive pin; every tuned constant gets a test
  that fails on regression, never a constant-self-comparison.
- Measure before tuning: Packet 0 repairs the instruments; governor caps and LOD curves are
  retuned against real captures, not invented.
- i18n: any new player-visible string (the perf-doctor nudge, a distinct rate-limit kick
  reason) is a t() key in the matching catalog domain with client-matcher lockstep where the
  server emits it.

---

## 4. Verified findings by family

Anchors cite paths and exported symbols per the docs anchor rule. Severities are
post-verification for the reported symptom.

### 4.1 Crowd character cost (steady FPS; the primary all-tier problem)

1. Crowd LOD saturates below town reality. `crowdLodScaleSq` (src/render/crowd_lod.ts) has a
   hard knee at 48 rigs and a 0.6 scale floor; the town holds ~90. At the floor the
   articulated band still covers the whole town square. Load-bearing mechanism: mixer
   cadence gates ONLY clip sampling; three r165 runs skeleton update plus bone-texture
   upload once per frame for every RENDERED SkinnedMesh regardless of cadence, and skinned
   meshes ship frustumCulled false. Animation cadence is therefore never a cost ceiling;
   the only real ceilings are the far-mesh swap (static baked mesh, no skeleton) or not
   rendering. The policy is also open-loop (reads rig count, never frame time). Severity:
   high.
2. No character lever exists anywhere. The render-budget governor (`RenderBudgetGovernor`,
   src/render/render_budget.ts) degrades only foliage/grass/lighting/vfx/resolution;
   characters are declared non-governable (src/render/gfx.ts bucket config); its resolution
   rung is additionally hard-locked (min == max) at the renderer callsite on every tier; no
   preset caps character count, LOD distance, or nameplate count. Dropping to LOW removes
   shadows and post but leaves all rigs, draws, and DOM intact (the owner's low == ultra
   observation is this finding, measured live). Severity: high.
3. Characters are never frustum-culled on shadow tiers. Renderer sets
   `cullCharacters = !sun.castShadow`, so on medium/high/ultra every ARTICULATED rig in the
   80 yd band submits in both passes every frame regardless of camera facing (far-LOD
   meshes are plain meshes and DO frustum-cull; in a packed plaza most rigs sit inside the
   articulated band, so the distinction matters little there). Culling the MAIN pass only
   (keeping the shadow proxy casting) is safe: three culls the shadow pass against the
   light frustum independently. Severity: high.
4. Shadow-pass count is crowd-insensitive. The proxy-shadow band constant
   (ENTITY_PROXY_SHADOW_RANGE_SQ in src/render/renderer.ts) is not multiplied by the crowd
   scale like its sibling ranges, so ~90 town rigs each add a shadow draw; the shadow map
   (4096 on high/ultra, 2560 on medium) re-renders every frame over a box containing the
   whole town (no autoUpdate throttle, no governor shadow knob). Severity: medium.
5. The far-LOD swap has no actionable-unit exemption (fairness-consistency gap, found in
   review round 3 and verified). The isFar decision (renderer entity loop) exempts only
   self and active forms, never the current target or casting entities, while the
   animatesEveryFrame carve-out exists only for CADENCE. At 48+ rigs the far threshold is
   34.8 yd, INSIDE max ability range (42 yd), so a targeted or casting hostile at 35-42 yd
   in a packed town renders as a frozen baked-idle statue today; crowd_lod.ts's own comment
   declares the cast wind-up an actionable telegraph. The formally actionable channel (the
   cast bar) survives via nameplates (55 yd) and the HUD target frame, so this is an
   internal-consistency gap rather than a formal fairness violation, but Packet 1's deeper
   radii would widen it, and with player nameplates hidden a non-target casting player past
   the threshold has only the cast-sparkle VFX. No test covers setFar/isFar today. Bonus
   waste: far-swapped rigs still advance their hidden mixers. Severity: medium, mandatory
   to fix inside Packet 1.
6. Town content floor: 15 always-on plaza NPCs cost exactly like players (full rigs,
   nameplates, quest markers); zone 1 concentrates its whole mob census inside one interest
   radius around the hub. Spirit healers build full rigs for living viewers that are hidden
   every frame. Severity: medium (constant floor, not root cause).
7. Nameplates have no count bound, and the unbounded part is structural: anchor projection,
   declutter, and the per-plate transform write/compare run for EVERY visible plate on
   EVERY rendered frame (the content throttle gates only content resolution), roughly
   0.1-0.5 ms/frame at 60-80 plates plus style-recalc and compositor-layer pressure.
   Cosmetic sub-element shedding cannot reduce this floor; only capping or shedding the
   ANCHOR SET bounds it. There is a behind-camera cull but no x/y viewport cull. The 14 yd
   urgent radius additionally bypasses the content cadence for idle nearby players (low
   severity, same fix batch). Severity: medium.

### 4.2 Hitch sources (movement, streaming, combat, camera turns)

8. Player rigs are the one entity kind excluded from the visual pool. `visualPoolKeyFor`
   (src/render/renderer.ts) returns a pool key for mobs and NPCs and null for players, so
   every 80/96 yd interest crossing disposes (Skeleton + GPU bone texture) and synchronously
   rebuilds a full rig: SkeletonUtils clone, per-clip AnimationAction interpolant
   allocations, plus a fresh ~23-node nameplate DOM subtree per view. IMPORTANT DESIGN
   FACT (verified round 3): pooling players is NOT a drop-in. The per-view diff trackers
   are seeded from the incoming entity's values at createView, so the live diffs
   (setSkin/setWeapon/weapon-skin/stow) structurally cannot correct a pooled rig carrying
   the previous owner's appearance; mob/NPC pooling is safe only because their pool keys
   encode appearance. Player pooling requires an explicit reconcile-on-acquire contract
   (section 7, Packet 2) plus a pool cap: maxPooledCharacterVisuals is Infinity everywhere
   except native iOS, including constrained mobile web, and a pooled player rig retains
   roughly 0.5-1 MB heap. Severity: high.
9. View creation is count-budgeted with no time bound. The runtime path passes NO deadline
   at all (the parameter defaults to Infinity; only the prewarm path passes one), allowing
   up to 8 full synchronous builds in one frame; the backoff is reactive (engages after a
   50 ms frame already shipped). The deadline plumbing checks BETWEEN builds, so any added
   deadline is a START budget: one slow build can still overrun it, and several build paths
   bypass the budgeted queue entirely (required self/target views, object template swaps,
   mech/visual-key rebuilds, lazy form builds, weapon/skin prop swaps). Severity: high.
10. Every created view triggers a compileAsync whose three r165 implementation walks the
    entire visible scene per call for light gathering (up to 8 full-scene walks in one
    stream-in frame; already-linked programs are cheap, the walk is not); no known-compiled
    short-circuit exists, and pool hits re-pay the gate. Severity: medium.
11. The constant-point-light-count invariant is broken in two ways (shader program re-key +
    first-seen-count synchronous compile waves, the repo's documented dominant-travel-freeze
    class):
    a. `LightPulses` (src/render/light_pulses.ts) toggles scene point lights entirely
       outside the budget on talent procs/teleports. All tiers; concentrates in crowd
       combat.
    b. `applyPointLightBudget` (src/render/point_light_budget.ts) sets only the light's own
       visible flag; three prunes hidden ANCESTORS during traversal, so a ranked light under
       a hidden group (compile-gated streaming views on all tiers; character frustum-cull
       and lowProps campfire ghosting on LOW; fogFar prop hiding) drops the real count.
       On LOW both extra arms fire during camera turns, and zone 1 places a campfire in the
       spawn plaza. Severity: high (and the primary medium-beats-low mechanism).
12. HUD layout thrash: chat/combat log appends force one synchronous layout per line inside
    a single event drain (src/ui/hud.ts appendLog/chatLogFrom); the hover tooltip rebuilds
    innerHTML and reads offsetWidth per picked-id flip. With a parked cursor during an
    arrow-key turn the flip rate is bounded by the 50 ms stationary repick (~20 Hz); a
    moving cursor sweep can flip at frame rate. Mouse-drag turning is exempt. Severity:
    medium.
13. Terrain far-chunk streaming runs 4 unbudgeted chunk builds per idle slot during the
    first seconds after entry (only ~4 slots total per entry; one-time hitches, not
    steady). Severity: low.

### 4.3 Fleet defaults and pixel fill (the auto-ultra problem)

14. Strong desktops auto-resolve to ULTRA with every relief valve off. `classifyGpuRenderer`
    (src/render/gfx.ts) matches integrated Apple M-series as strongDesktop; strongDesktop
    plus ample-or-unknown memory resolves PRESET_ULTRA; ultra's pixelRatioCap (2.5) never
    binds on desktop, so retina renders a ~5-6 MP buffer through the six-pass composer with
    FULL-resolution N8AO (16 AO + 8 denoise samples per pixel; the "~1ms-class" comment in
    src/render/post.ts was measured on high's half-res path); `shouldUseAutoGovernor`
    returns tier !== 'ultra' so the governor is constructed disabled; the only path down is
    the manual Render Quality slider. Safari masks the GPU string (lands medium), so this
    hits Chrome/Firefox Macs and 4K Windows. Severity: critical for the fleet on defaults;
    NOT the owner's repro (which persists on LOW and is presumed main-thread CPU-bound
    pending the Packet 0 trace).
15. The governor resolution rung is dead config on every tier (finding 2). Re-enable behind
    guards (strong GPUs only, hysteresis, apply during an already-slow frame).
16. Hybrid-GPU laptops: the browser binds the iGPU; the page hint is already set; the
    desktop build forces the dGPU. The in-repo lever is wiring `perf_doctor.ts` (a complete
    triage library with no live importer) to nudge affected sessions, and quantifying the
    cohort from the existing admin worstGpuBuckets.

### 4.4 Input pipeline defect (confirmed; currently dormant in the owner's repro)

17. The server message rate limiter starves legitimate turning. The client flushes changed
    facing from the rAF loop behind a 16 ms gate (`flushInput`, src/net/online.ts) and a
    held arrow-key turn changes facing every frame (src/game/keyboard_turn_facing.ts), so a
    healthy client sends ~60 msg/s (80 at 120 Hz); the server bucket
    (server/msg_rate_limit.ts: burst 60, refill 40/s) sits before JSON.parse and is shared
    by input, commands (casts), and chat; sustained turning past ~3 s silently drops
    (r - 40)/r of messages (33% at 60/s, 50% at 80/s), including fire-and-forget casts. The
    high-water ack makes the loss invisible to input-echo telemetry, and no server drop
    counter exists (the inbound metric counts before the verdict). Additional verified
    facts: the consecutive-violation kick counter resets on ANY allowed frame, and with
    continuous refill the longest drop run at a steady 100/s is 2, so the 200-drop kick is
    unreachable below ~200 frames inside one 25 ms refill window (about 8,000 frames per second): the kick is dead code for sustained
    moderate over-limit senders, and any refill increase widens that. The only per-frame
    byte cap is the ws maxPayload (16 KiB). A limiter kick currently reuses the moderation
    kick reason string. tests/msg_rate_limit.test.ts pins the stale 20 Hz premise.
    CRITICAL CALIBRATION: zero drops at or below ~30 fps, so this is inactive during the
    current lag, but the render fixes will ACTIVATE it fleet-wide; it must ship with or
    before them. Severity: high (correctness), low (for today's symptom).

### 4.5 Graphics settings incoherence (why some players see medium beat low)

18. Ranked verified mechanisms making LOW slower than MEDIUM on some machines:
    1. The point-light flap arms are LOW-only on desktop (finding 11b): dynamicShadows off
       arms cullCharacters; lowProps arms whole-group campfire ghosting; each camera turn
       can re-key every lit program. Medium avoids both arms. (On constrained-memory
       devices dynamicShadows is off on EVERY tier, so the flap follows them to medium+.)
    2. Inverted knobs: LOW fog-far 520 vs medium 470 (~22% more visible prop/terrain area)
       and LOW grass radius/step 80/2.05 vs 76/2.0 (~5% more instances). LOW literally
       draws more world than MEDIUM.
    3. LOW-only grass chunk cache 96 vs 128 (leanFoliage): more rebuild churn while moving.
    4. LOW's governor is twitchier (dropFrameMs 22 / cooldown 1.1 s vs 24 / 1.35 s), which
       pumps its grass/foliage/vfx/lighting levels more often near the boundary. (It does
       NOT step render scale: the resolution rung is locked on every tier, finding 15; an
       earlier draft claimed render-scale oscillation and is corrected here.)
    Refuted along the way: maxPointLights is NOT a tier lever (6 on all desktop tiers);
    msaaSamples is DEAD config (the composer and AO predicates are identical, so the no-AO
    composer branch is unreachable); nameplate cadence favors LOW.
    Medium doing strictly more steady-state work yet feeling better confirms LOW's cost is
    spiky (recompile hitches), matching the reported symptom shape.

### 4.6 Broken and missing instruments

19. Draw statistics are garbage on composer tiers. Nothing sets `info.autoReset = false`;
    three r165 resets info inside every render() and the composer renders multiple passes
    per frame, so every post-frame reader (perf overlay draws row, production
    rendererCalls/rendererTriangles, the profiler harness) sees the final fullscreen pass:
    1 call / 1 triangle. Born broken (the composer predates every consumer). The governor's
    draw-pressure input is permanently green on high/ultra (its frame/submit/stall signals
    still work). Even low/medium counts exclude shadow-pass draws (three resets
    mid-render). The phaseMs timings and renderDiagnostics estimates are unaffected and
    trustworthy.
20. Production perf reports carry no zone (`zoneOrScenario` hardwired to gameplay in
    src/game/perf_reporter.ts) and no crowd-size fields; the mainMs bucket split and input
    chain are zeroed unless ?perf is set; 5-minute cumulative reports dilute discrete hitch
    storms (the rolling buffer also evicts them). The client net pipeline (JSON.parse,
    applySnapshot) runs synchronously OUTSIDE every existing timing bucket, so its cost is
    invisible today (see section 6 on why it is downgraded but not yet cleared).
21. No automated gate covers the crowd regime: the real-browser HUD frame assertion is
    env-gated off and its 250 ms threshold equals the sample clamp (mathematically
    unfailable); scripts/crowd_fps_bench.mjs and scripts/server_load_jitter.mjs tolerate
    partial joins, can emit null metrics or too-few samples without failing, have no
    pass/fail ceilings, and are not CI gates. (The other hud_perf_budget arms and
    tests/mob_update_perf.test.ts / tests/bandwidth.test.ts are real gates and stay.)

### 4.7 Server residuals (snapshot cadence under load; the 200+ CCU story)

22. The self-snapshot encoder still builds and stringifies ~30-35 delta fields per player
    per tick before change detection (the maybe() chain in server/game.ts; the heavy-field
    dirty gate and the v0.29 timer caches cover the rest). ~60k stringify/s at 100 players.
23. The entity wire cache re-serializes identity plus base dynamics for every in-interest
    entity every tick purely to derive version numbers (acknowledged in-code); ~1-2.5 ms
    per tick at ~500 live entities. NOTE for the fix design: identity is NOT sim-owned
    state; see the invalidation matrix requirement in Packet 6 (verified round 3: at least
    seven server-side async write sites, including the 60 s flair/holder/dev-badge
    refreshers, the instant admin streamer push, and guild changes via the social
    chokepoint; account UNLINK reaches the entity only via the 60 s interval, and today's
    per-tick fingerprint is what catches everything).
24. The catch-up loop remains an amplifier with two verified sharp edges: (a) the 0.5 s
    clamp applies to dt per callback, so a single long stall drops excess debt (sim slews),
    but under sustained overload (every gap under 0.5 s, ticks over 50 ms) NOTHING is
    dropped and the loop spirals; (b) `acc` itself is never clamped, and a tick that throws
    aborts the drain loop before acc decrements, so the thrown-tick path can bank unbounded
    debt that one healthy callback then drains as a sprint. runAntibotTick (a per-session
    snapshot per sim tick) and event routing run inside the loop; broadcast runs once per
    callback outside it. Clock domains are mixed and must be ledgered by any policy change:
    sim-time-keyed (cooldowns, auras, respawns, input staleness clearing, anti-bot idle
    windows), wall-keyed (daily delve reset, msg rate limiter, linkdead grace, keepalive,
    liveness), clamped-dt-keyed (autosave cadence, social position push).
25. Proximity views rebuild per parked player per tick with no cache: market (whole-book
    filter + localeCompare sort in src/sim/market.ts marketInfoFor; measured 19-64 us/call
    at 100-300 listings, so real but far smaller than early estimates), mail (whole-realm
    scan in post_office deliveredFor), bank (full clone). All three anchors sit in the
    spawn plaza where players AFK. Verified dependency facts for the cache design: market
    listing expiry is a 1 Hz sim-tick sweep MUTATION (not read-time), mail delivery IS a
    read-time now >= deliverAt comparison with a same-tick derived-state hook (deliverDue),
    bank has no time terms, and the lockouts self field is a read-time wall-clock filter
    over lazily-deleted entries.
26. Small: bot-detector runtime snapshot per player per sim tick (BLOCKED as a simple
    cadence change: the private contract routes onTick every server tick as the only place
    a strategy can score absence, and arena_win_trading records a per-tick minimum HP
    precisely so end-of-bout regen cannot hide it; any change needs a private-repo contract
    evolution landing in BOTH copies), 1 Hz social push O(guild^2), heavy-self modulo gate
    skippable under catch-up strides, autosave kick-off burst on-thread, jail enforcement
    runs per sim tick (keep per-tick unless proven safe).

---

## 5. Already fixed (verified on this branch; do not re-plan)

v0.29 and earlier landed: party-frame projection caching (#2136), shared grid interest
candidates (one padded query per occupied cell), stable timer wire (#2141: absolute aura
deadlines stop cache defeat), heavy-self dirty gate (#891), bounded/deduped autosave,
serialize-once event batches, realm-readout memos (Vale Cup, dungeon finder board),
catch-up-safe >= dueness broadcast gates, merged single-draw rigs (#1726), bounded
nameplate writes and idle-bark audio (#2143), zero-rim terrain early exits (issue #1620),
delve-run movement-path gating, spatial-grid mob ally scans (#2179), pet AI grid queries.

## 6. Refuted or downgraded during verification (do not re-litigate)

- Net-apply pipeline as a PRIMARY lag cause: downgraded by code reading and microbenchmarks
  (in-place decode, allocation-free interp, no local Sim online; talent-recompute waste
  measured ~3 us/call), but NOT yet cleared: parse/apply run outside every timing bucket,
  so Packet 0 instruments them directly (bytes, parse ms, apply ms, record counts,
  snapshots per rAF, arrival gaps, GC evidence) before a final verdict. The self-motion
  leash freeze during snapshot stalls is intended anti-divergence behavior (latency-scaled
  budget, 0.47 yd floor to 2.5 yd cap, exhausted within ~0.07-0.36 s of held movement);
  Packet 0 adds a predictor replay test covering 100-500 ms broadcast gaps, which no test
  exercises today. Yaw is never server-gated, so yaw stutter during lag is client jank by
  construction (useful field diagnostic).
- Hover/occlusion raycasts: capsule proxies + analytic sweep, microseconds (the tooltip DOM
  path, not the raycast, is the cost).
- WebAudio in crowds: well defended post-#2143 (one gap: sfx.loop() bypasses the voice cap
  and distance cull; crowd-fight polish only).
- Terrain streaming as a steady cost: 4 one-time entry batches, not sustained.
- Sim tick as a cause: ~1 ms class at 100 clustered players. Wall-standoff sampling is a
  real linear cleanup (~0.3-1 ms total) but not a cause; delve companion full-roster scan
  is delve-bounded.
- Market rebuild "several ms per tick": measured 10x smaller; still worth the epoch cache.
- Market expiry as a read-time time-crossing (review round 3): refuted; expiry is a 1 Hz
  sweep mutation, so a book revision bumped BY THE SWEEP is sufficient (no time term in the
  cache key).
- Mail staleness under a mutation-keyed cache is bounded (~1 s via the sweep) and exact if
  the revision is bumped in deliverDue; the round-3 concern was right in kind, softer in
  degree.
- "~935 mobs ticking": actual census ~307; mob update ~0.22 ms/tick at 100 players.
- Nameplate urgent-radius bypass: real, but ~2.5x multiplier on a subset, not a driver.
- Governor external-frame-cap misclassification: real blind spot, marginal in practice.
- The far-LOD statue gap (finding 5) is an internal-consistency gap, not a formal fairness
  violation: the shed is crowd-driven and preset-independent, and the formally actionable
  cast-bar channel survives. It still gets fixed (Packet 1).
- The wocc-snapshot-offload worker design: still the eventual >200 CCU capacity fix, but
  the implementation branch predates the v0.29 optimizations; treat as reference, not a
  merge base. Not needed at 100 CCU. Note its design must honor the delta-commit invariant
  (section 3).

---

## 7. Packet plan (execution order)

Each packet ships as its own worktree + branch off the latest release branch, phased-packet
cadence (phase -> phase-NN-qa.md -> next), full gate + /qa before done, before/after
screenshots for visual changes, and a consequence ledger entry in the PR body.

Execution order note: Packet 0 first (instruments), Packet 3 with or BEFORE Packets 1-2
(restoring FPS activates the input-drop defect), Packets 1-2 next (the owner symptom),
then 4-5 (fleet defaults and settings coherence), 6 alongside as server capacity work.

### Packet 0: Instruments (first; everything downstream tunes against these)

- draw_stats accumulator module (new small render core): info.autoReset = false, snapshot
  and reset exactly once at sync() start; also reset after screenshot/prewarm renders.
  perfStats, the overlay, and telemetry consume the snapshot. MEASUREMENT-ONLY GUARANTEE:
  the render-budget governor KEEPS consuming its current draw signal in this packet (its
  draw arm is blind on composer tiers today, and feeding it real counts would change
  visible shedding); the governor switches to accumulated counts only in Packet 5 together
  with retuned caps.
- Client net-pipeline instrumentation: perf.trace spans for message parse and snapshot
  apply, plus counters for snapshot bytes, changed-record and keep counts, snapshots
  applied per rAF, raw inter-arrival gaps, and heap-sawtooth/GC evidence, all dimensioned
  by the new crowd bucket. This closes the one timing blind spot and settles the net-apply
  verdict with data.
- Perf report dimensions: zone id (via the existing IWorld zone read) replaces the
  hardwired gameplay label; add simEntities/activeViews/visibleViews + a crowd bucket to
  the payload, row, and one GROUPING SETS dimension.
- Ungate the four mainMs time() buckets (renderer/hud/events/sim) for fleet reports.
- Promote a worst-10s-window p95 to an indexed column (hitch storms currently dilute).
- Make the real-browser frame gate honest: replace the clamp-equal threshold with a
  long-frame-count metric re-baselined on real hardware.
- Crowd scripts grow teeth: exact join-count enforcement (fail on partial joins), minimum
  finite-sample requirements, ceilings enforced whenever the opt-in env keys
  (CROWD_MIN_FPS, JITTER_MAX_P95) are set, nonzero exit on missing evidence; pure summarize/threshold logic in scripts/lib with
  tests; stays operator-run.
- Wire perf_doctor to ingestion (store triggered suggestion ids server-side) and add the
  client nudge toast (new t() keys) for software-GL/iGPU sessions.
- Predictor replay test: drive self_motion/net interp through scripted 100-500 ms broadcast
  gaps (no test covers stalls today).
- Baselines captured at the end of the packet: owner Mac town session (?perf JSON plus a
  browser Performance trace to formally confirm main-thread-boundness), per-tier 360-orbit
  bench at the spawn campfire, admin tick capture at peak, crowd_fps_bench curve at
  CROWD_BATCHES=20..80.
Consequences: telemetry discontinuity (draw counts jump from 1/1 to real values); the nudge
toast is a new player-visible string (i18n); zero gameplay/visual change otherwise (the
governor input swap is deliberately deferred to Packet 5).

### Packet 1: Crowd character cost (the owner's steady-FPS fix)

- MANDATORY ARTICULATED-RIG CEILING, rendered-rig semantics: bound the number of rigs
  RENDERED ARTICULATED (SkinnedMesh visible); a rig over the ceiling takes the far swap
  (setFar) or is not rendered. Animation cadence is never the ceiling (finding 1); the
  top-K cadence idea survives only as a smoothness knob LAYERED on the ceiling, and a NEW
  second crowd-LOD knee (letting scale drop below today's 0.6 floor past 48 rigs) composes
  with the ceiling (AND, not OR).
- FAR-SWAP EXEMPTION SET: extend the animatesEveryFrame set (self, current target, casting
  entities) to the far-swap decision; an exempt entity within max actionable range (42 yd
  plus pad) never takes the far swap at any crowd scale; the ceiling recruits the next
  non-exempt rig instead. Extract the isFar/far-swap policy into a pure RENDER_PURE_CORES
  module with a unit test (net-new coverage; nothing pins setFar/isFar today), and stop
  advancing the mixer for far-swapped rigs. This closes the pre-existing statue gap
  (finding 5): ledger it as a fairness-consistency FIX.
- Character rung in the render-budget governor: pressure tightens the articulated ceiling /
  crowdLodScaleSq / cadence below their static values (closes the open loop).
- Main-pass frustum culling on shadow tiers: sphere-cull hides modelWrap/farMesh, shadow
  proxy keeps casting; generous radius padding.
- Crowd-scale the proxy-shadow band; measure 4096 -> 2560 shadow map on HIGH (A/B first).
- NPC handling: NPCs stay IN visibleRigCount (every rendered rig costs the same; the
  earlier exclude-NPCs idea is withdrawn). Player prioritization happens at SELECTION under
  the ceiling: exempt set first, then players by distance, then mobs, then stationary NPCs.
  The stationary-NPC mid-cadence tier stays; spirit healers excluded from view candidates
  for living players.
- Nameplate work: viewport x/y rejection, cosmetic sub-element shedding (guild line,
  title, badges beyond ~25 yd), AND the anchor-set cap per RESOLVED Decision 1: nearest-M
  friendly plates (~25-30, tuned against the Packet 0 baselines) with hostile/target/
  party/casting exemptions always shown, default on, player-adjustable in a later pass.
  The cap is the only true bound on the per-frame anchor floor (finding 7).
Consequences ledger: overflow crowd members beyond the articulated ceiling become static
far meshes sooner in big crowds (positions still glide; self/target/casters exempt and now
also statue-proof at combat range, a strict fairness improvement over today); far blob
shadows vanish in dense crowds; softer shadow edges on HIGH if the A/B holds; idle vendors
subtly choppier when crowded; behind-camera characters stop being drawn (invisible by
definition); friendly nameplates beyond the nearest-M cap disappear in packed towns
(Decision 1: accepted social trade; hostiles/target/party/casters always shown). No
gameplay change; fairness suite plus the new far-swap exemption test gate it.

### Packet 2: Hitch elimination (streaming, compile, lights, HUD thrash)

- Pool player visuals with an explicit reconcile-on-acquire contract (NOT diff-based: the
  trackers are seeded from the incoming entity, finding 8). resetForEntity must cover, at
  minimum: body skin, mainhand/offhand props, weaponSkinId including its VFX handles and
  owned materials, stow state machine, death/ghost pose and the collapsed click capsule
  (deadLock/revive), and animation/emote state; tint/aura/ghost re-apply per frame already
  and root transform is reset by the pool today. Pool key includes class; player_mech is
  keyed per wearer class or excluded. Add a pool cap with LRU eviction for player keys on
  ALL profiles (today only native iOS caps the pool; constrained web is Infinity, and 100
  churned rigs is roughly 50-100 MB heap). Reuse tests: acquire-after-different-owner pins
  for every reconciled field. Scope fact: the pool stores only the CharacterVisual; the
  ~23-node nameplate DOM subtree is created per view and still churns on every interest
  crossing after pooling lands. ACCEPTED as a ledgered residual (a minor share of the
  crossing cost); if the Packet 0 traces disagree, the follow-up is a nameplate-subtree
  pool with clear-on-acquire (hide and empty child elements: view sigs restart empty on a
  fresh view, element content does not).
- Per-frame START budget (~2-3 ms) for runtime createCandidateViews (count stays as a
  ceiling). Stated honestly: the deadline is checked between builds, one slow build can
  overrun it, and required-view/template-swap/mech/form paths bypass the queue, so the
  packet does not promise a hard hitch ceiling from the deadline alone; it removes the
  8-build burst class.
- Compile-gate batching (one compileAsync per frame for the frame's created views) and a
  known-compiled key skip; route the lazy form builds through the gate.
- Point-light invariant repair: ancestor-aware eligibility in applyPointLightBudget (or an
  injected eligible() predicate) with the budget pass ordered after cull/ghost state
  settles; LightPulses pre-created as always-visible intensity-0 pool members (raise the
  constant by the pool size); keep static campfire lights out of ghost-hidden groups on
  LOW (reparent or keep the material-flip arm).
- HUD thrash: batch log appends per frame (DocumentFragment or overflow-anchor), hover
  tooltip anchored via CSS (no offsetWidth read) + rebuild throttle, nameplate content
  version-key gate (update the pinned urgent-semantics test deliberately).
- sfx.loop() distance cull + concurrent-loop cap (crowd-fight polish, same seam as playAt).
Consequences ledger: fewer/no hitches (the point); pooled players always re-dressed
correctly by contract (the naive version would have worn the previous owner's gear:
that is why the contract and tests are the packet's core); campfire light keeps shining
while its mesh ghosts on LOW (restores intent; small visible lighting change); weapon
lights of frustum-culled rigs on LOW hand their slot to the next-nearest light (a small
promoted-light pop during camera turns) instead of silently dropping the traversed count;
pulse lights live permanently inside the constant count at intensity 0, so every lit
shader loops over the pool lights at all times (1 on low/medium, up to 4 on high/ultra),
a tiny constant cost traded for zero recompiles; nameplate DOM churn on interest
crossings remains (accepted residual, see the pooling bullet); tooltip/log pixels
unchanged; inaudible far cast loops stop rendering. Pool memory becomes BOUNDED (cap + eviction) where today mob/NPC
pooling is unbounded on web.

### Packet 3: Input cadence contract (ship with or before Packets 1-2)

- Keep the cheap pre-parse per-connection frame-rate ceiling (its placement before
  JSON.parse is load-bearing flood defense) but size it to the real documented client
  cadence (20 Hz timer + 16 ms-gated rAF flush; up to ~80/s at 120 Hz plus headroom), and
  rewrite the stale 20 Hz header comment. Keep the 16 KiB ws maxPayload as the per-frame
  byte cap and add a per-window byte budget.
- Add per-class POST-parse budgets (movement input vs commands/casts vs chat) so
  legitimate high-Hz input can never starve fire-and-forget casts: the reserved-lane
  requirement, satisfied after the cheap gate.
- Replace the reset-on-allow consecutive kick counter with a windowed or decaying abuse
  score that allowed frames cannot reset (the current 200-consecutive kick is unreachable
  below ~200 frames inside one 25 ms refill window (about 8,000 frames per second) and becomes fully dead at any higher refill). Give the
  limiter kick its own reason literal (today it reuses the moderation string; client
  matcher lockstep applies).
- Observability: count drops and kicks in the game-signals seam (today the inbound metric
  counts before the verdict and the loss is invisible); optionally gap-aware echo
  accounting.
- Cadence-model tests: simulate the real client send scheme against consumeMsgToken at
  30/60/120/144/240 Hz with timer-phase variation and mixed movement/cast/chat/logout
  traffic; assert zero drops for legitimate streams; replace the stale 20 Hz pin; update
  the tunables pins.
- Client-side send coalescing is deliberately OUT of the initial scope (the facing-feel
  cluster in src/game/ is interlocking and self-feel is client-authoritative); revisit
  only if soak data demands it.
Consequences ledger: casts stop being silently eaten during sustained turns at healthy
FPS; other players see smoother remote headings; micro rubber-banding while running plus
turning disappears. Flood posture changes shape: sustained moderate over-limit senders
move from throttled-forever to score-kickable, while parse exposure rises with the higher
ceiling (bounded by the byte budget). No visual/balance/determinism change.

### Packet 4: Fleet pixel-fill defaults

- Ultra pixelRatioCap 2.5 -> ~2.0; half-res + depth-aware-upsampled AO whenever the drawing
  buffer exceeds ~3 MP; enable the governor on AUTO-RESOLVED ultra (explicit player choice
  keeps the opt-out); re-enable the resolution rung behind guards (strong non-software
  GPUs, hysteresis, step applied during an already-slow frame); debounce resizeViewport
  events.
- Per RESOLVED Decision 2: map integrated Apple M-series to HIGH by default (ultra stays
  selectable; discrete-GPU desktops keep ultra).
- Fold GradePass into the output stage (one fewer full-screen pass); delete the unreachable
  RenderPass/MSAA composer branch.
Consequences ledger, stated precisely: the AO half-res switch and any DPR cap that binds
are UNCONDITIONAL visual changes on the affected configs (a retina buffer exceeds 3 MP at
idle too): retina-ultra AO becomes slightly softer at all times, matching HIGH's existing
look; the 2.0 DPR cap binds only above DPR 2 (browser zoom). The governor effects
(grass/vfx thinning, temporary resolution softening) are load-only and recover. The
default-remap changes out-of-box visuals for M-series users (Decision 2: accepted).

### Packet 5: Graphics settings rationalization (the audit)

- Fix inverted knobs so LOW never covers more than MEDIUM: fogFar 520 -> at most 470,
  grassRadius 80 -> at most 76 (fairness-reviewed; sightline-parity rule respected), and
  align LOW's grass chunk cache (96) with medium's 128 to stop LOW-only rebuild churn.
- Delete dead config: msaaSamples, LOW's unused shadowMap row, dead constrained shadow
  values; align the governor budget constants across tiers where unjustified.
- Switch the governor's draw input to the Packet 0 accumulator AND retune CAPS_BY_TIER
  against real captured counts in the same change (the old caps were tuned against a dead
  signal on composer tiers and scene-only counts elsewhere); this is the deliberate,
  reviewed behavior change Packet 0 deferred. Reference hardware per RESOLVED Decision 4:
  the owner's M-series Mac and Linux iGPU laptop as local anchors, fleet GPU-bucket
  percentiles as the cross-check.
- Land the per-tier scripted 360-orbit + strafe bench (at the spawn campfire) as the
  standing audit harness, recording frame p50/95/99, long tasks, programs.length growth
  (recompile signature), real draw calls, light-count flap counter, governor steps, grass
  rebuilds.
- Acceptance: programs.length flat during the LOW orbit; LOW frame p95 <= MEDIUM frame p95
  on the same machine; no tier does more work than the tier above it on any axis.
Consequences ledger: LOW's draw distance visibly shortens ~50 units (that is the fix);
slightly less distant grass on LOW; the governor sheds cosmetics sooner under crowds on
high/ultra once it sees real counts (deliberate, reviewed here, not in Packet 0);
dead-knob deletion is zero-visual (verify via screenshots).

### Packet 6: Server broadcast residuals (the 200+ CCU headroom)

- Scope framing: broadcast work is crowd-multiplicative (section 2); this packet is the
  capacity story, not a small residual.
- Dirty epochs for the chatty self fields (professionsRev, lootRollsRev, wireRev-keyed
  lockout handling; cadence trackers for slow-moving keys) so the encoder checks before
  building.
- REQUIRED DELIVERABLE: a per-field dependency/invalidation matrix (field -> inputs ->
  mutation sites -> time-crossings -> null edges) covering every cached view, with these
  verified anchors baked in:
  - identity: a revision bumped ONLY in sim command handlers is incorrect; identity fields
    include wallet/Discord/GitHub/streamer flair written by at least seven server-side
    async sites (the 60 s refreshers, the instant admin flair push, join stamps, guild via
    the social chokepoint, the dev override). Spec: bump identityRev at every enumerated
    write site (each already has an if-changed arm), keep the admin push's instant
    visibility, AND keep a low-rate (about 1 Hz) fingerprint backstop so any future
    unenumerated write site degrades to bounded ~1 s staleness instead of
    visible-until-reconnect. The backstop is the actual optimization: today's design IS a
    per-tick fingerprint; 1 Hz keeps the catch-everything property at 1/20th the cost.
    Exhaustive unlink/revocation tests (Discord, GitHub, wallet, streamer un-mark).
  - market: key on (bookRev, viewer query + page, viewer ownership, collections, name);
    bookRev MUST be bumped by the 1 Hz expiry sweep's mutations, not just list/buy/cancel.
    No time term needed (expiry is a sweep mutation, verified).
  - mail: bump mailRev in deliverDue (the delivery time-crossing's same-tick hook) plus
    all command mutators, the 1 Hz sweep arms, returnToSender, rekeyMailOwner.
  - bank: pure revision (deposit/withdraw/buySlots/join stamp) is sufficient.
  - lockouts: read-time wall-clock filter over lazily-deleted entries; keep the per-tick
    rebuild (it is tiny) or add an expiry-aware key term; a plain rev-cache would show a
    raid locked past the reset.
  - null edges: proximity predicates stay OUTSIDE the cache and run per tick; the maybe()
    diff must still see null when far so the one-shot explicit null ships (a cache that
    skips the builder must not freeze the last near-side view).
  - aliasing rule: cache SERIALIZED strings by default, never built objects (the encoder
    family passes live entity refs elsewhere, e.g. stats/weapon); object caching is
    per-field opt-in with a documented clone guarantee.
- Sim-side identityRev feeding the entity wire cache (per the matrix above); keep or
  motion-gate the dyn refresh.
- Catch-up policy, named and executable: DROP-BEYOND-CAP: run at most ~4 ticks per
  callback, then discard residual debt (acc = min(acc, CAP * DT)), so the sim clock slews
  smoothly behind wall clock under ANY sustained overload instead of freeze-then-sprint.
  Also clamp acc itself to close the thrown-tick unbounded-debt leak (verified: a throwing
  tick aborts the drain before acc decrements). Ship with a clock-domain ledger: sim-keyed
  systems stay self-consistent but stretch in wall terms; wall-keyed systems (daily reset,
  limiter refill, linkdead grace, keepalive, liveness) keep real-time meaning; clamped-dt
  timers (autosave, social push) follow wall. Each border case is declared acceptable in
  the plan doc, and the alternatives (retain-up-to-clamp = today; amortized recovery)
  are rejected per RESOLVED Decision 7.
- Anti-bot cadence, per RESOLVED Decision 5: the per-tick capture STAYS (the private
  contract routes onTick every server tick and arena win-trading depends on per-tick min
  HP) and only the allocation is optimized (reused scratch snapshot object); the
  wocc-bot-protection contract evolution (host-supplied per-callback HP min/max
  aggregates, both copies) is not pursued now and is revisited only if Packet 6 load
  captures demand it. enforceJailStates stays per-tick unless proven safe.
- Delta-commit invariant (section 3) stated in the plan as a standing constraint for any
  frame skip, coalesce, or worker-offload work.
- Epoch caches for market/mail/bank views per the matrix; precomputed sort keys instead of
  localeCompare in the comparator; memoize the 1 Hz social rows per pass; fix the
  heavy-self modulo gate to a >= tracker; autosave kick-off via setImmediate.
- Validation: clustered AND spread scenarios at 100 and 200 players, with movement,
  combat, chat/event bursts, and idlers parked at the shop/mail/bank anchors (not just
  BOTS=80 IDLE=1), measuring candidate visits, retained-entity and removal scans, encoded
  records, bytes per recipient, aggregate egress, socket backlog, catchUpCallbacks, and
  maxTicksPerCallback; release-tier soak with a committed gap-p99 baseline.
Consequences ledger: no player-visible change except steadier snapshots under load, plus
the flagged sub-second delays on slow-moving cosmetic fields and the slow-motion-under-
overload trade of drop-beyond-cap (uniform stretch, mutually consistent, no actionable
information affected; wall-keyed systems unchanged: the daily reset still flips at real
UTC midnight and linkdead grace still expires in real minutes). Identity flair keeps
today's instant admin push and gains a hard 1 s worst-case staleness bound instead of the
current 60 s unlink window.

---

## 8. Deferral ledger (explicitly owned or deferred)

- Terrain idle-slot time budget (finding 13): DEFERRED unless Packet 2's entry-hitch
  measurements say otherwise; the grass streamer's per-frame ms budget is the template.
- Grass chunk cache size (LOW 96 vs 128): Packet 5 (knob coherence).
- Weapon-skin VFX draw multiplier (per-rig unshared ShaderMaterials, roughly 40-100 extra
  transparent draws when many Armory-skin wearers stand inside the ~35 yd articulated
  ring, ~1-2 ms class, confirmed low): DEFERRED; the far-LOD swap already cuts the rigs at
  distance and the Packet 1 articulated ceiling shrinks the exposed set; revisit with the
  Packet 5 orbit-bench draw counts (candidate fix: hide fx parts beyond mid LOD plus a
  shared material cache per skin model and part kind).
- Event-routing fanout under crowd combat: measured in Packet 6 validation; optimization
  deferred until those numbers exist.
- Client snapshot parse/apply optimization (beyond the talent memo + prevPos reuse
  cleanups): DECIDED BY Packet 0 data; candidate work (container reuse, cadence tiers for
  non-actionable remotes) pre-scoped but not committed. Worker offload of parse/apply:
  deferred, reference design only, subject to the delta-commit invariant.
- Bandwidth per client (the 115.3 KB/s figure): becomes a tracked Packet 0 metric; no
  wire-format changes planned in this program.
- Wall-standoff terrain sampling and delve companion grid migration (sim cleanups):
  deferred to a future sim-hygiene packet; not part of this program's critical path.

## 9. Decisions (all seven resolved by the owner, 2026-07-23)

1. Friendly-nameplate ANCHOR policy (Packet 1): RESOLVED: nearest-M anchor cap (~25-30,
   tuned against the Packet 0 baselines), DEFAULT ON, with hostile/target/party/casting
   exemptions always shown, plus a player setting to adjust the cap in a later pass.
   Packet 1 plans with the cap in scope; the visible social trade (friendly plates beyond
   the cap disappear in packed towns) is accepted and ledgered.
2. Integrated Apple M-series default preset (Packet 4): RESOLVED: default to HIGH; ultra
   stays manually selectable; discrete-GPU desktops keep ultra.
3. Rate-limit contract (Packet 3): RESOLVED: full contract redesign as specified (sized
   pre-parse ceiling + per-window byte budget, per-class post-parse budgets so casts have
   their own lane, windowed abuse score replacing the dead consecutive-kick counter,
   drop/kick observability, dedicated kick reason string, multi-rate soak tests).
4. Governor cap retune reference hardware (Packet 5): RESOLVED: the owner's M-series Mac
   and Linux iGPU laptop as the strong/weak local anchors, cross-checked against fleet
   GPU-bucket percentiles once Packet 0's telemetry dimensions ship.
5. Anti-bot cadence (Packet 6): RESOLVED: keep the per-tick capture and optimize only the
   allocation (reused scratch snapshot); the private-repo contract evolution is NOT
   pursued now and is revisited only if Packet 6 load captures show the capture matters
   at 200+ CCU.
6. LOW draw-distance realignment (Packet 5): RESOLVED: trim LOW below MEDIUM; the visible
   shorter draw distance on LOW is accepted as the coherence fix.
7. Catch-up policy (Packet 6): RESOLVED: DROP-BEYOND-CAP at ~4 ticks per callback with
   the debt-accumulator clamp, accepting the uniform slow-motion-under-overload trade;
   retain-up-to-clamp and amortized recovery are rejected.

## 10. Validation gates (standing, after all packets)

- Existing: tests/architecture.test.ts, world_api parity, tests/server/perf_gate.test.ts,
  tests/mob_update_perf.test.ts, tests/bandwidth.test.ts, hud_perf_budget ARMs 1-2,
  graphics-fairness suite, full npm run gate per packet.
- New from Packet 0/1/5: honest frame gate (long-frame count), crowd bench join/sample/
  threshold enforcement, per-tier orbit bench acceptance, far-swap exemption unit test,
  net parse/apply trace assertions, predictor stall-replay test.
- New from Packet 3: multi-rate cadence soak (30-240 Hz) with zero legitimate drops; drop/
  kick counters visible in game signals.
- New from Packet 6: invalidation-matrix tests per cached field (including unlink/
  revocation and null-edge transitions), clustered+spread load scenarios with committed
  baselines.
- Field verification: owner Mac town session before/after each client packet (?perf JSON
  plus browser trace), fleet perf summary by zone and crowd bucket once Packet 0 ships,
  input-drop counter flat at zero after Packet 3 under a 120 Hz turn soak.

## 11. Reference material

- v0.29 server perf history: PR #2200; docs in the perf-relief packet.
- Snapshot-offload worker design (reference only; stale vs v0.29; delta-commit invariant
  applies): the wocc-snapshot-offload worktree (its docs/design/snapshot-broadcast-offload/
  package; not present on release/v0.30.0).
- Fairness rules: docs/design/graphics-settings-fairness.md; UI contracts: src/ui/CLAUDE.md;
  render contracts: src/render/CLAUDE.md; server hot paths: server/CLAUDE.md.
- Bot detection private repo (contract for the Packet 6 anti-bot decision):
  worktree wocc-bot-protection (overlay at private/bot_detector/).
- External reports cross-examined 2026-07 (codex v1 July 8 profile, codex v2 v0.30 review,
  codex v3 design review of revision 1 of this document): scorecards folded into sections
  5 and 6; adopted-and-verified v3 corrections: crowd-multiplicative server scaling, net
  instrumentation before clearance, rendered-rig ceiling semantics, far-swap exemptions,
  pooling reconcile contract and caps, limiter redesign constraints, identity/mail/lockout
  invalidation surfaces, catch-up policy precision, benchmark rigor; v3 claims refuted or
  softened: market read-time expiry, unbounded mail staleness, formal-fairness framing of
  the statue gap, and the 43% (at ~70 msg/s offered) vs 50% (at 80 msg/s offered) drop
  arithmetic, each correct at its stated offered rate.
