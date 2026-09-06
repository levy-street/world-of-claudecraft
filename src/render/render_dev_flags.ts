// Dev-only URL kill switches for individual render layers, the perf-attribution
// counterpart of worn_stone.ts's ?wornfade override: ?<name>=off disables one
// layer for an A/B bench run (fps_bench_prod.mjs points two browsers at the
// same build with and without the flag), so a tier's frame cost attributes to
// named layers instead of guesswork. Read once at module load (layer gating is
// build/compile-time); headless hosts without a location keep every layer on.
// NOT a player surface: the options menu owns the supported knobs.
//
// Live flags (grep renderLayerDisabled call sites for the authoritative set):
//   charcull    - the per-rig character cull (character_cull_core.ts); off
//                 restores the pre-cull submission, every rig in the draw band
//                 drawn and shadowed every frame, which is the A/B arm for
//                 pricing the cull on a machine whose driver hates the extra
//                 sphere tests more than it hates the draws
//   worndetail  - the whole triplanar surface-detail family layer (worn_stone)
//   ebdetail    - the Eastbrook town triplanar-over-atlas layer only
//   bladegrass  - the near-field blade-grass carpet
//   canopy      - the canopy clump-detail layer
//   n8ao        - the N8AO ambient-occlusion pass
//   smaa        - the tail SMAA pass (high and above)
//   fxaa        - the FXAA arm fused into the output grade pass (the
//                 grade-only chain's edge AA); off leaves the grade otherwise
//                 untouched, so it prices the extra taps on their own
//   tmicroshadow - the terrain micro sun-shadow taps (ultra+)
//   zonehaze    - the per-zone aerial haze field (biome_haze_field)
//   nightlights - the night light field (night_light_field); off falls back
//                 to the draped ground-glow pools and the mob glow discs
//   fardetail   - the far vista mesh's world-scale rock detail (far_terrain);
//                 off returns the tiles to one flat baked colour per vertex
//   farvista    - the whole coarse far-vista terrain layer (far_terrain); off
//                 is the A/B that says whether a suspect distant surface is
//                 this layer or the real splat terrain underneath it
//   postshed    - the render budget's post shed (post_shed_core.ts): off
//                 builds no FXAA grade twin and pins the governor's `post`
//                 level at 1, so a bench reads the tier-static chain
//
// Beside the ?<name>=off layer switches, knobs with their own accessors:
//   ?bladesectors=<n> - how many ways each blade-grass pool's slot grid is split
//                  per axis, so three can frustum-cull the sectors behind the
//                  camera (blade_grass_sector_pool.ts). 1 collapses each pool
//                  back to ONE mesh, the A/B arm for pricing the split against
//                  the extra draw calls on a given driver. It is not the
//                  pre-split build: that one mesh still carries a measured
//                  bounding sphere and the banded uploads, so a verdict about
//                  those belongs to a real before/after build, not to this arm.
//   ?prep=legacy - restores the pre-scheduler queue ADMISSION only: every unit
//                  is admitted as its turn comes and the ledger keeps learning.
//                  It does NOT revert the reveal-gate policy (piecewise reveal,
//                  soft deadline), which has no legacy arm. It is the rollout
//                  kill switch for pacing: if the budget regresses on a machine,
//                  ?prep=legacy is the A/B that says so without a rebuild, and
//                  the same flag is what a rollback ships as the default.
//   ?canvasalpha=on - restore three's own world-context attributes (alpha: true,
//                     the translucent surface every build before this shipped).
//                     The world canvas is opaque by default now; this is the A/B
//                     arm for measuring the compositor difference on one build.
//   ?terraindetail=<0..1> - pins the live terrain-detail shed level
//                  (render_budget.ts's `detail` bucket, terrain_detail_shed_core.ts)
//                  for the whole session, ignoring live governor pressure, so an
//                  A/B run compares the floor and the tier's own request at a
//                  known, stable level instead of racing the governor's dwell
//                  timers.
//   ?postshed=<0..1> - pins the render budget's `post` level
//                  (post_shed_core.ts: 1 full chain, 0.75 SMAA to FXAA, 0.5
//                  bloom tail mips, 0.25 bloom off, 0 AO passthrough) for the
//                  whole session, governor on or off, so a bench or a
//                  screenshot reads a known rung instead of racing the
//                  governor's cooldowns. The same parameter's `off` value is
//                  the layer kill switch above.

/**
 * Sectors per axis each blade-grass pool splits its slot grid into. Four is
 * the default: it keeps the toroidal seam down to one sector column plus one
 * sector row of the sixteen, so most of the pool stays cullable, while the
 * sectors stay large enough that a crossing still touches only a few of them.
 */
export const BLADE_SECTOR_AXIS_DEFAULT = 4;

const bladeSectors = ((): number => {
  if (typeof location === 'undefined') return BLADE_SECTOR_AXIS_DEFAULT;
  const raw = new URLSearchParams(location.search).get('bladesectors');
  if (raw === null) return BLADE_SECTOR_AXIS_DEFAULT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return BLADE_SECTOR_AXIS_DEFAULT;
  return Math.min(n, 16);
})();

/** Sectors per axis for this session's blade-grass pools (`?bladesectors=`). */
export function bladeSectorAxis(): number {
  return bladeSectors;
}

/** Which GPU-preparation behaviour this session runs. */
export type GpuPrepMode = 'adaptive' | 'legacy';

const disabled = ((): ReadonlySet<string> => {
  const set = new Set<string>();
  if (typeof location === 'undefined') return set;
  const params = new URLSearchParams(location.search);
  for (const [key, value] of params) {
    if (value === 'off') set.add(key);
  }
  return set;
})();

/** True when the named render layer is disabled via `?<name>=off` (dev only). */
export function renderLayerDisabled(name: string): boolean {
  return disabled.has(name);
}

const gpuPrep = ((): GpuPrepMode => {
  if (typeof location === 'undefined') return 'adaptive';
  return new URLSearchParams(location.search).get('prep') === 'legacy' ? 'legacy' : 'adaptive';
})();

/** The session's GPU-preparation mode: 'legacy' only under `?prep=legacy`. */
export function gpuPrepMode(): GpuPrepMode {
  return gpuPrep;
}

const canvasAlpha = ((): boolean => {
  if (typeof location === 'undefined') return false;
  return new URLSearchParams(location.search).get('canvasalpha') === 'on';
})();

/** True under `?canvasalpha=on`: keep the legacy TRANSLUCENT world context. */
export function worldCanvasAlphaRequested(): boolean {
  return canvasAlpha;
}

const terrainDetailPin = ((): number | null => {
  if (typeof location === 'undefined') return null;
  const raw = new URLSearchParams(location.search).get('terraindetail');
  if (raw === null || raw.trim() === '') return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(1, Math.max(0, parsed));
})();

/** The `?terraindetail=<0..1>` dev pin, clamped, or null when absent/invalid. */
export function terrainDetailLevelPin(): number | null {
  return terrainDetailPin;
}

const postShedPin = ((): number | null => {
  if (typeof location === 'undefined') return null;
  const raw = new URLSearchParams(location.search).get('postshed');
  if (raw === null || raw.trim() === '') return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(1, Math.max(0, parsed));
})();

/** The `?postshed=<0..1>` dev pin, clamped, or null when absent, `off`, or
 *  otherwise not a number. */
export function postShedLevelPin(): number | null {
  return postShedPin;
}
