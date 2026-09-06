// Dev-only URL kill switches for individual render layers, the perf-attribution
// counterpart of worn_stone.ts's ?wornfade override: ?<name>=off disables one
// layer for an A/B bench run (fps_bench_prod.mjs points two browsers at the
// same build with and without the flag), so a tier's frame cost attributes to
// named layers instead of guesswork. Read once at module load (layer gating is
// build/compile-time); headless hosts without a location keep every layer on.
// NOT a player surface: the options menu owns the supported knobs.
//
// Live flags (grep renderLayerDisabled call sites for the authoritative set):
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

// Beside the ?<name>=off layer switches, two MODE/VALUE flags with their own accessors:
//   ?prep=legacy - restores the pre-scheduler queue ADMISSION only: every unit
//                  is admitted as its turn comes and the ledger keeps learning.
//                  It does NOT revert the reveal-gate policy (piecewise reveal,
//                  soft deadline), which has no legacy arm. It is the rollout
//                  kill switch for pacing: if the budget regresses on a machine,
//                  ?prep=legacy is the A/B that says so without a rebuild, and
//                  the same flag is what a rollback ships as the default.
//   ?terraindetail=<0..1> - pins the live terrain-detail shed level
//                  (render_budget.ts's `detail` bucket, terrain_detail_shed_core.ts)
//                  for the whole session, ignoring live governor pressure, so an
//                  A/B run compares the floor and the tier's own request at a
//                  known, stable level instead of racing the governor's dwell
//                  timers.

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
