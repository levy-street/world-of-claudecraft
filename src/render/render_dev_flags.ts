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
//   tmicroshadow - the terrain micro sun-shadow taps (ultra+)

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
