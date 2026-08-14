# Phase 7: Render and juice

Farming has been fully simulated and fully invisible since Phase 3. This phase gives it a
body: procedural swap-ready garden beds and crop growth stages at the four farming hubs,
per-viewer stage rendering per D3, plant and harvest VFX, and placeholder SFX cues. It
lands BEFORE go-live on purpose (the ordering rationale in
`docs/farming/implementation-plan.md`): farming must never ship blind. Art follows D19
(procedural wave 1, fixed footprints and pivots so sourced models drop in later without
code changes).

Live-surface note (binding): After this phase merges, garden beds are visible at the four
farming hubs (eastbrook_vale, mirefen_marsh, thornpeak_heights, evergarden): decorative,
walkable, and non-blocking. A player's own crops render growth stages for that player
only (the per-viewer model, D3). Plant and harvest VFX fire only for plot states
reachable via dev commands until go-live (Phase 9). No seeds are obtainable, no UI
window exists, no map pins, no notices.

V0.38.0 SYNC NOTE (2026-08-13, Phase 6b): the release absorbed the three.js audit
batch. Three itself did NOT move (still 0.165.0, patches/three@0.165.0.patch intact
and now pinned by tests/three_compile_async_patch.test.ts), but the render
conventions did: the asset loader gained KTX2 sibling support
(src/render/assets/ktx2_sibling.ts), renderer.ts was reworked, and
src/render/CLAUDE.md changed. Re-read src/render/CLAUDE.md on the CURRENT tree
before authoring any farm GLB or exporter work, and mint fingerprints against the
v0.38.0 lockfile (state.md header note). Also note deviation (an) in state.md: the
release's monolith ratchet leaves renderer.ts and hud.ts near their ceilings, so
every new render block lands as its own src/render/<thing>.ts module from the start
(which this phase already planned).

PHASE 6 QA AMENDMENT (2026-08-13, after the twelfth absorb b08d79ef91): the
headroom premise above is now SHARPER than "near". renderer.ts sits at EXACTLY
its ceiling (13708/13708, zero lines) because the release extracted
fire_light_registry and lowered the ceiling to match, so this phase cannot add
even the import and call-site lines its sibling-module adapters need without
planning a compensating renderer.ts extraction UP FRONT. The release also
reworked render again since the 6b snapshot: the day/night system was
overhauled (longer cycle, moon phases, night ambient floor in day_night_core,
far-terrain night dim), a point-light budget seam and adaptive shader pacing
landed, and RENDER_PURE_CORES gained five entries. The Explore step reads the
current tree, so treat the 6b-era "renderer.ts was reworked" anchor as stale
rather than authoritative.

PHASE OUTCOME (2026-08-14, swept per the state.md rule; the full record is
the progress.md Phase 7 section and state.md deviations (ap) through (ax)):
- The facet DID gain one member, farmNowMs(): the stopping rule's
  surface-before-widening case, resolved as the design's own anticipated
  RaidLockout-template timer read (state.md (ap), maintainer read owed).
  "No dedicated stage, wet, or withered facet read exists or is added"
  HELD: stage, wet band, and withered are all derived locally.
- The render core imports farmGrowthStage directly from the farm_projection
  leaf: the architecture scan pins src/world_api as types-only over
  src/sim, so a facet VALUE re-export is impossible ((ar)); the function
  moved to farm_projection.ts verbatim.
- The exporter is scripts/assets/farm_props/export_farm_props.mjs, not
  build_farm_props.mjs ((as)); biome tints and crop families are
  render-side ((au)); the bed pad/collider decision is NEITHER ((at)).
- "npm run asset:budget green" is amended to the delta bar ((aq)): the
  repo-wide budget is pre-existing red; the phase added exactly
  +174,844 bytes, all in models/props.
- The renderer headroom extraction is delve_interior_scheduler.ts, ceiling
  13708 to 13700 ((aw)); the packet's named candidate was mis-measured.
- Adapter API as landed (for anything quoting the packet's sketch):
  FarmPatchVisuals.sync(world, dt) with a uniform 0.5s read cadence plus
  event-driven resync, and onFarmEvent(ev, viewerPid) with a local pid
  guard; there is no sync(plots, nowMs) form.
- Visual verification artifacts: the exporter's contact sheets at
  docs/screenshots/farming/assets/farm_props/solo-contact.png (all 15
  props) and mounting-contact.png (stage meshes parented at the bed's
  Socket_Soil, six combinations); in-world before/after captures at
  docs/screenshots/farming-phase-07/ (LOW preset, desktop and mobile).

### Starter Prompt

```
This is Phase 7 of the Farming feature: Render and juice.
Model: Opus 4.8, xhigh effort (1m context variant where the file load demands it).
Harness: Claude Code.

Goal: make the farm beautiful before it is reachable: swap-ready procedural beds and
crop growth-stage props at the four farming hubs, a per-viewer render adapter, plant
and harvest VFX, and placeholder SFX cues, with the asset budget green.

STEP 0 - PRE-FLIGHT
- Work ONLY in the persistent worktree ~/Documents/woc-farming-plan. Other sessions
  share the main checkout; never work there.
- git -C ~/Documents/woc-farming-plan status must be clean. Stop if it is not.
- Re-resolve the NEWEST release/** branch: git fetch origin --prune; then
  git branch -r --list 'origin/release/*' | sort -V and take the last row. Create
  branch fix/farming-phase-07-render-and-juice off LOCAL feature/farming-plan
  (D22: never off the release tip, which lacks the packet and all farming work),
  then MERGE the newest release tip INTO the phase branch FIRST: run the
  release-merge-audit skill plus the state.md deviation (al) absorb checklist,
  re-run the parity and count-pin suites, and verify the farming_session golden
  md5 unchanged. A jump of a minor version or more (or a triple-digit
  intersection) runs docs/farming/phase-06b-release-sync.md's shape as its own
  mid-phase BEFORE this phase instead.
- Record the phase-start commit (git rev-parse HEAD) for the STEP 3 diff.
- Scan Claude Code memory: the MEMORY.md index, the farming-skill-program entry, and
  the phase-relevant topics: pr-screenshot-browser-path and
  screenshots-on-low-graphics (this is a visual phase; the standing rule captures
  on the LOW preset), worktree-cwd-drift-misroutes-git,
  pkill-pattern-matches-own-shell, big-diff-reviewer-turn-budgets,
  malware-scan-comment-keywords.

STEP 1 - LOAD CONTEXT
Spawn one Explore agent (thoroughness: very thorough) to read and summarize:
- docs/farming/state.md (whole file; D2, D3, D19 and the seam reference matter most
  here) and docs/farming/progress.md (Phase 1 to 6 notes, deviations, name
  refinements).
- docs/farming/phase-07-render-and-juice.md (this phase file).
- The image-to-glb skill (.claude/skills/image-to-glb/SKILL.md) and
  docs/image-to-glb-asset-workflow.md.
- Source files for this phase: src/sim/content/farm_patches.ts (FARM_PATCHES and
  FarmPatchDef as landed in Phase 2; progress.md notes any name refinement),
  src/sim/professions/farming_zones.ts (FARMING_ZONE_TIERS, its one home),
  src/world_api/farming.ts (the IWorldFarming facet as landed), the closest existing
  scripts/assets/build_*.mjs exporter to use as the template (Explore picks and names
  it), the best existing src/render adapter precedent for signature-guarded rebuilds
  (Explore picks and names it), the RENDER_PURE_CORES allowlist in
  tests/architecture.test.ts, the render VFX entry points and the tier-shedding knob
  path through src/game/ui_effects_profile.ts, and the SFX wiring sites:
  src/game/audio.ts (UI_CUES, the UiCue union), scripts/sfx/sfx_prompts.mjs, the hud
  SimEvent cases, and the completeness guard tests/game_audio.test.ts.
- CLAUDE.md files: root, src/render/CLAUDE.md, src/ui/CLAUDE.md (for the hud cue
  case), src/sim/CLAUDE.md and src/sim/professions/CLAUDE.md (only as far as the
  collider or pad decision could touch sim), plus any scripts/ or scripts/assets/
  CLAUDE.md that exists.
The summary MUST return: (1) the exact exported names and shapes of the FARM_PATCHES
rows and the two IWorldFarming reads the renderer uses (the patch defs and the D3
public plot projection: bed id, crop id, planted-at, ready-at, knob flags, the
notified flag, and the derived status); (2) the exporter template to copy and the practiced
optimizer, media-manifest regen, and parsed-GLB contract-test recipe with the exact
commands; (3) the render adapter precedent for signature-guarded rebuilds and where
RENDER_PURE_CORES is pinned; (4) the VFX seam and exactly how existing cosmetic
effects shed under the tier knob; (5) the full SFX wiring checklist from the state.md
seam reference with commands; (6) the Phase 3 SimEvent names for plant and harvest;
(7) which render test suites exist and which this phase must run; (8) any Phase 1 to
6 deviation recorded in progress.md that touches this phase. The orchestrator never
reads planning docs or coordinator monoliths directly: work from this summary.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
Request fan-out explicitly (this model under-spawns by default). Give each agent ONLY
the Explore summary plus its own slice. Never put a teammate agent in plan mode.
Default split, three agents by vertical slice, each owning its slice AND its tests:

Agent A, assets (scripts/assets/build_farm_props.mjs plus its contract test):
- The procedural factory plus deterministic exporter, following the image-to-glb
  skill conventions exactly (factory, exporter, optimizer spec, media-manifest
  regeneration via the owning build step, never by hand).
- The bed base: about 3 by 2 yards, low wooden border, four biome tints (vale,
  marsh, alpine, formal Evergarden).
- Growth-stage meshes: stage one is a single sprout shared across all families;
  stage two is per family; stages three and four are per family with the crop
  identity visible. Families: grain, root-leaf, gourd.
- A withered variant per family, and the compost bin.
- EVERY asset swap-ready: fixed footprint and pivot documented in the factory
  source, in the form the Phase 13 handoff manifest
  (docs/design/farming-asset-manifest.json) will consume.
- The parsed-GLB contract test with source-fingerprint pins, plus a
  determinism check (two exporter runs, identical bytes).
- npm run asset:budget green over the new assets.

Agent B, render adapter and VFX (src/render/farm_patches.ts):
- Reads IWorldFarming ONLY, and the Phase 2 public projection is sufficient by
  design (D3). Beds render for everyone, always. MY plot states drive the stage
  meshes per the per-viewer model, with the visual stage derived locally from the
  planted-at and ready-at fractions. The wet-soil tint derives from planted-at
  recency. The withered look derives from the projection's derived status. No
  dedicated stage, wet, or withered facet read exists or is added.
- Signature-guarded rebuilds; zero per-frame allocation; pure logic (stage and
  variant resolution, signature computation) extracted into a RENDER_PURE_CORES
  core with its own Node-run suite.
- The bed ground-pad and collider decision, made in-phase: prefer soft or none (the
  herb-cluster precedent; the Phase 2 placement suite already guarantees legal
  ground). Decide, state the choice in your report, and document it in this phase
  file and state.md. If the choice adds anything under src/sim/, flag it: it changes
  the STEP 3 review dispatch.
- Plant and harvest VFX on the Phase 3 events: cosmetic, tier-sheddable per the
  graphics-settings fairness doctrine (VFX may shed; nothing actionable may).

Agent C, SFX (the two-file wiring from the state.md seam reference):
- farm_plant and farm_harvest cues: UI_CUES keys plus facade methods in
  src/game/audio.ts, widening the UiCue union if the family is nested.
- The hud cases for the Phase 3 plant and harvest events, triggering the cues.
- Prompt rows in the SFX catalog, marked PLACEHOLDER for the sound engineer.
  [AS LANDED per (ax): the rows live in scripts/sfx/ui_sfx.mjs and ride into
  sfx_prompts.mjs through its UI_SFX_CATALOG import; no hand row in
  sfx_prompts.mjs itself.]
- Run npm run sfx:ui, then npm run sfx:manifest, then npm run sfx:check; the
  completeness guard tests/game_audio.test.ts must pass.

INVARIANTS THIS PHASE MUST KEEP
- The renderer reads the world and never mutates it: every read in
  src/render/farm_patches.ts goes through the IWorld facet, and the adapter performs
  zero writes to world state.
- src/render/ never imports sim internals beyond IWorld: all farming data enters
  through src/world_api/farming.ts, never through a src/sim/ import.
- Every generated artifact (media manifest, optimized GLBs, SFX manifest and runtime
  pack) is regenerated via its owning build step; none is ever hand-edited.
- Graphics fairness, stated literally: every tier and preset knob touched by this
  phase sheds only cosmetic richness. The plant and harvest VFX may shed; the beds
  and growth-stage meshes render at every tier and no knob may hide or delay them.
- All sim determinism holds: this phase changes no sim behavior; if the collider or
  pad decision adds a sim-side row, it draws no rng and moves no tick order, and all
  randomness anywhere in src/sim/ stays on ctx.rng.

Out of scope (do NOT do in this phase):
- The farm_ready chime (Phase 8) and the golden_harvest sting (Phase 10).
- The feast prop (Phase 12).
- Map and minimap pins (Phase 8).
- Any UI window or HUD surface (Phase 8).
- NPCs, vendor stock, quests, or any reachability change (Phase 9).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Run, in order:
- npx tsc --noEmit
- npx vitest run <the new parsed-GLB contract test file>
- npx vitest run tests/architecture.test.ts tests/game_audio.test.ts plus the render
  suites the Explore summary named
- npm run asset:budget
- npm run ci:changed
Then run git diff --name-only against the phase-start commit and dispatch ONLY the
matching rows per the Review Dispatch Matrix in docs/farming/implementation-plan.md.
Expected matches here: frontend-seam-reviewer (src/render, src/game, and the hud case
changed); architecture-reviewer ONLY if the collider or pad decision touched
src/sim/; qa-checklist once the deliverable set is complete. Every review agent gets
a hard 30-tool-call budget, the coverage instruction ("report every issue including
low-severity and uncertain ones; ranking happens later"), and, if truncated, the
resume line: "Stop reading more files. Output the full report now based on what you
have already seen. No more tool calls. Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE /
VERDICT." No commit while a BLOCKING stands.

STEP 4 - COMMIT CADENCE
2 to 5 Conventional Commits with scopes and bodies, EXPLICIT paths, never git add -A,
no session links or Claude attribution. Suggested cut:
1. feat(assets): farm prop factory, exporter, contract test, manifest regen.
2. feat(render): farm_patches adapter, pure core, plant and harvest VFX.
3. feat(game): farm_plant and farm_harvest placeholder cues and wiring.
4. docs(farming): progress and state ledger updates, screenshots.

STEP 5 - ACCEPTANCE CRITERIA
- [ ] scripts/assets/build_farm_props.mjs exists, follows the image-to-glb skill
      conventions, and exports deterministically (two runs, identical bytes).
- [ ] The parsed-GLB contract test with source-fingerprint pins passes.
- [ ] The bed base reads about 3 by 2 yards with a low wooden border and ships all
      four biome tints (vale, marsh, alpine, formal Evergarden).
- [ ] Growth stages exist as specified: shared stage-one sprout; per-family stage
      two; per-family stages three and four with visible crop identity; families
      grain, root-leaf, gourd; a withered variant per family; the compost bin.
- [ ] Every asset documents a fixed footprint and pivot in the factory, ready for
      the Phase 13 handoff manifest.
- [ ] src/render/farm_patches.ts reads IWorldFarming only; beds render for everyone;
      MY plots drive stage meshes derived from the projection's planted-at and
      ready-at fractions (D3); wet-soil tint from planted-at recency; withered
      silhouette from the derived status; signature-guarded rebuilds; no per-frame
      allocation; its pure logic is registered in RENDER_PURE_CORES with a passing
      Node suite.
- [ ] The ground-pad and collider decision is made, stated, and documented in this
      phase file and state.md.
- [ ] Plant and harvest VFX fire on the Phase 3 events and shed cleanly under the
      cosmetic tier knob; beds and stages do not shed.
- [ ] farm_plant and farm_harvest are wired end to end and marked PLACEHOLDER;
      sfx:check and tests/game_audio.test.ts pass.
- [ ] npm run asset:budget is green.
- [ ] tsc, the contract test, tests/architecture.test.ts, the named render suites,
      ci:changed, and gate_select are green (armory browser exception aside).
- [ ] Before/after screenshots (desktop and mobile) are committed under
      docs/screenshots.

STEP 6 - DOC UPDATES + MEMORY
- Update docs/farming/progress.md: the Phase 7 status row, the acceptance list above
  copied with its check states, and a Notes block (surprises, deviations, deferrals
  with reasons).
- Update the docs/farming/state.md ledgers (new i18n keys if any, refined file
  names, and the collider or pad decision).
- Any deviation decided in-phase gets swept into
  docs/farming/phase-07-render-and-juice.md AND docs/farming/phase-07-qa.md in the
  same pass.
- Record surprises (pipeline quirks, budget tradeoffs, precedent mismatches) in
  Claude Code memory.

STEP 7 - FINAL RESPONSE FORMAT
Report: phase status; files touched; validation results (each command, pass or
fail); review verdicts per agent; deferrals; and a one-line handoff for the Phase 7
QA session.

STOPPING RULES
- Stop if an asset cannot meet the asset budget without dropping a growth stage:
  surface the tradeoff (the budget figure, the offending asset, the options) instead
  of silently cutting a stage.
- The Phase 2 public projection is sufficient by design (D3): derive stage, wet,
  and withered locally and do NOT widen the facet with dedicated reads for them.
  Stop only if something genuinely cannot be derived from the projection: that is
  a design change; surface it before touching the facet.
- Stop if git status is dirty at session start or the release tip cannot be
  resolved.
- Stop if a review BLOCKING cannot be fixed without out-of-scope changes.

Close: gate via BROWSER_PATH=$HOME/.cache/ms-playwright/chromium-1228/chrome-linux64/
chrome node scripts/gate_select.mjs on a FROZEN, committed tree (never edit while it
runs); judge ONLY the log markers (grep for "FAIL": the selective gate prints
"[gate:select] FAIL", the full gate "[gate] FAIL", plus the GATE EXIT marker; the
shell exit code has lied). [AMENDED per D22, swept in Phase 6 QA: no push and no PR.
The phase branch merges back --no-ff into LOCAL feature/farming-plan with the branch
deleted; the gate log is the arbiter and the progress.md Notes block is the phase
report. Before/after screenshots (desktop and mobile, captured on the LOW preset per
the standing rule, via the pr-screenshots skill) are still committed under
docs/screenshots and referenced from the Notes block: this is a visual phase.]
```
