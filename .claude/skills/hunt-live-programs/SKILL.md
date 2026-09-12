---
name: hunt-live-programs
description: Find, name and fix the shader programs World of ClaudeCraft links live (ungated, after the loading curtain) so they stop freezing the frame. Use when a fleet capture or perf report shows live-program events, shader-compile hitches or multi-second long tasks, or when asked to hunt, audit or gate live programs. Runs an instrumented ONLINE session (this worktree's dev client proxied to the production realm) through scripts/live_program_hunt.mjs, reads its aggregated report, and applies the render rule (prewarm twin or compile gate) per owner.
user-invocable: true
---

# Hunt live programs

The rule (`src/render/CLAUDE.md`, "Every material a live frame can draw for the first time
after the curtain has a prewarm home"): a program linked live blocks the presenting thread
for 40 ms when the driver cache is warm and for 0.4 to 2.3 s when it is cold, and several in
one frame add up to the multi-second freezes the fleet reports. This skill is the procedure
to find WHICH materials escape, name their owner, and give each one a home.

## Why a fleet capture is not enough

- The `live-program` events in `renderer.gpuPrep.events` carry a LABEL, which is
  `program.name || cacheKey`, and three names a program after `material.name`. Most escapees
  are unnamed, so the label is a raw cache key nobody can map to a file.
- The two tools that name materials, `renderDiagnostics` (`newMaterials`,
  `firstVisibleObjects`) and the shader warm audit (`unexpectedByName`), only arm on a DEV
  build served on localhost with `?perfTrace=1`.
- An offline tour misses what a live world brings: gear, mounts, pets, other players,
  dungeon and raid content, encounter VFX.

So the hunt runs the dev client of THIS worktree, proxied to production, in a browser the
operator plays in, and aggregates at the end. Nobody reads the raw feed live.

## Step 1: run the session

```
node scripts/live_program_hunt.mjs
```

What it does, in order: kills the port, purges `node_modules/.vite` and `.vite-temp`,
starts vite with `--force` on a generated prod-hookup config (`/api` and `/ws` proxied to
`https://worldofclaudecraft.com`, `changeOrigin` on the WebSocket entry, the part the base
config lacks), grep-verifies the served module, opens a headed Chrome on
`http://localhost:5173/?perfTrace=1&perf` with a persistent profile under `tmp/` (the login
survives sessions), polls the renderer four times a second while the operator plays, and on
Enter, Ctrl-C or browser close writes `tmp/live-program-hunt-<id>/report.md` (plus the raw
`samples.ndjson` and `meta.json`) and stops vite.

Flags: `--offline` (no realm proxy, the offline world: fewer live-world variants, no account
needed), `--target`, `--port`, `--out`, `--headless`, `--angle <backend>`, `--profile <dir>`,
`--allow-dirty`. Re-aggregate a past session with `--report <samples.ndjson>`.

Tell the operator where to go: the content the capture pointed at (zone, position), then
the usual suspects of a live world (mount up, summon a pet, swap gear, enter a dungeon,
open the map and the character sheet, watch a boss). Ask for at least ten seconds standing
still at each stop so gates have time to settle or to time out.

Traps the script already handles, do not re-derive them: the vite cache and the blind
watcher in `.claude/worktrees` (memories `vite-blind-in-claude-worktrees`,
`purge-vite-cache-before-restart`), puppeteer's own SIGINT handler (disabled so the report
is always written), the WebSocket upgrade refused without `changeOrigin`.

## Step 2: read the report

`report.md` has four parts:

- **Live programs, first sighting.** One row per distinct label: time, zone, position,
  material name (or `(unnamed)`), shortened key, `readyRoots/totalRoots`, count, and the
  materials and objects the render diagnostics saw for the first time in the same poll. The
  `firstVisibleObjects` column reads `category:objectName:materialLabel` and is the owner
  when the material is unnamed.
- **Bursts.** Runs of live programs within 50 ms: one burst is one frozen frame.
- **Gate failures.** `attach-watchdog`, `gate-timeout`, `reveal-watchdog`: a gate that gave
  up reveals its group ungated, so live programs right after one are charged to the gate
  not settling (admission starvation), not to a missing gate.
- **Shader warm audit.** `unexpectedByName` and samples with their attribution.

Reading a label: `onBeforeCompile(){}` at the tail is the default hook (no
`customProgramCacheKey`); a `name|...` prefix in the tail is a custom key and names its
owner; a head like `47,48` is a bare `ShaderMaterial` (custom vertex and fragment shader
ids); `kit:` with nothing after it is a `props.ts` kit material whose GLB surface has no
name. `readyRoots 0/0` means no gate root was pending when the program linked.

## Step 3: give each owner a home

Per owner, the CLAUDE.md choice:

- **Predictable at boot** (a material the entry zone or every session draws): a twin in an
  existing prewarm manifest entry (`renderer.ts` manifest entries, `zone_prewarm_groups.ts`,
  `ABILITY_MATERIAL_SOURCES` for ability VFX). Check the prewarm budget: the manifest already
  overruns `maxMs` on some machines, so measure on an integrated GPU before adding.
- **Reached later** (a zone feature, an interior, a prop group streamed in): a compile gate
  at the first appearance (`attachSceneGroupGated` in `gated_scene_attach.ts`, `compileGate`,
  a reveal gate). Never a bare `scene.add` of a group carrying new materials.
- **A `customProgramCacheKey` with a runtime-varying segment** (a distance cap, a tier): each
  value is a distinct program; prewarm every value the session can reach, or pin the value
  before the reveal.
- **Always: name the material** (`mat.name = 'module:role'`) so the next fleet capture names
  it without a hunt. A kit conversion must never produce an empty surface name.
- **A burst right after a gate failure** is an admission problem, not a gating one; say so
  in the PR and do not add a gate for it.

Do it test-first where a pure core exists (`materialProgramSignature` in
`prewarm_policy.ts` has a dimension-by-dimension contract test; a new key dimension is
pinned there) and keep the guard tests green:
`tests/ability_material_prewarm_sweep.test.ts`, `tests/renderer_compile_gate.test.ts`,
`tests/prewarm_policy.test.ts`, `tests/post_reveal_links_core.test.ts`,
`tests/live_program_watch.test.ts`, `tests/live_program_hunt_report.test.ts`.

Never add, remove or hide a directional, hemisphere, spot or rect-area light after boot:
the light counts are key inputs and one change relinks every lit material in view.

## Step 4: prove it and hand off

Re-run the session on the same route and quote, in the PR body, the owner rows and the
live-program count before and after for the content the fix touched. This is the acceptance
of a HUNT fix only: an ordinary render PR is reviewed by reading the code (each new material
traced to its manifest twin or gate), never by demanding a session. A render diff that
creates GPU work also gets `render-performance-reviewer` and `/qa` before handoff.
