// Which ground set the overworld terrain wears: the pure half of the
// `?ground=` switch. terrain.ts reads it once at module load (the splat layers
// are resolved once per page), so a flip needs a reload.
//
// The painted set is the default. `?ground=photo` puts back the photo layers it
// replaced, so the two grounds can be looked at side by side from the same spot.
// The value is matched against an allowlist and is never spliced into a texture
// file name unchecked: anything else, a misspelt set included, wears the default.

/** Every painted set shipped under public/textures/terrain, by the prefix its
 *  files carry (`<set>_Meadow_Color.jpg` and its siblings, and the packed
 *  relief `GroundAO_Packed_<set>.png`). A set built beside the default joins
 *  this list in the change that ships its files, and `?ground=<set>` then picks
 *  it; tests/ground_set_core.test.ts holds the list to what is on disk. */
export const PAINTED_GROUND_SETS = ['Painted'] as const;
export type PaintedGroundSet = (typeof PAINTED_GROUND_SETS)[number];

/** The photo layers the painted ground replaced (`?ground=photo`). */
export const PHOTO_GROUND_SET = 'photo';

export type GroundSet = PaintedGroundSet | typeof PHOTO_GROUND_SET;

export const DEFAULT_GROUND_SET: PaintedGroundSet = 'Painted';

/** The session's ground set from a `location.search` string. */
export function groundSetFromQuery(search: string): GroundSet {
  const value = new URLSearchParams(search).get('ground');
  if (value === PHOTO_GROUND_SET) return PHOTO_GROUND_SET;
  return PAINTED_GROUND_SETS.find((set) => set === value) ?? DEFAULT_GROUND_SET;
}
