// Which file a placed building loads at a texture tier.
//
// The repainted Tidehold town carries its colour in per-building atlases, by
// far the largest part of a building's download and of its GPU memory. Beside
// `<name>.glb` the kit ships `<name>.half.glb` and `<name>.quarter.glb`: the
// same model with every map at half and at a quarter of the size (a quarter
// and a sixteenth of the memory), and the same pair beside its far twin
// (`<name>.lod.half.glb`). A profile that cannot afford the full maps loads
// one of those instead. The geometry, the nodes and the bounds are the same
// in every tier, so collision, seating, the interior reveal and everything
// else keyed on the building's own path never see the difference: only the
// URL handed to the loader changes (tests/tidehold_texture_tiers.test.ts pins
// the files, tests/placed_texture_tier_core.test.ts this rule).
//
// Cosmetic sharpness only, so it sits on the right side of the graphics
// fairness line: nothing a player reacts to is in a texture's top level.
//
// Pure: the caller says which files exist (the media manifest), so this needs
// no manifest to test.

export type PlacedTextureTier = 'full' | 'half' | 'quarter';

/** The sizes a tier asks for, most wanted first: a model that does not ship
 *  the quarter set falls back to its half set, then to the full file. */
const WANTED: Record<PlacedTextureTier, readonly string[]> = {
  full: [],
  half: ['half'],
  quarter: ['quarter', 'half'],
};

/**
 * The path to load for `path` at `tier`. A piece carved out of a pieces twin
 * (`<file>.glb#node:<name>`), a path with a query, and anything that is not a
 * GLB keep their own file, as does every model with no tier files.
 */
export function placedTextureTierPath(
  path: string,
  tier: PlacedTextureTier,
  exists: (path: string) => boolean,
): string {
  if (tier === 'full') return path;
  const m = /^([^#?]+)\.glb$/i.exec(path);
  if (!m) return path;
  for (const size of WANTED[tier]) {
    const candidate = `${m[1]}.${size}.glb`;
    if (exists(candidate)) return candidate;
  }
  return path;
}
