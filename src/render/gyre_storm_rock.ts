// The Gyre's storm-rock pillars (spire, bluff, arch, standing stone) share ONE painted cliff tile
// (render/gyre_surface.ts) instead of an atlas each: their GLBs ship no texture, every triangle is
// projected into the tile, and the prop kit converter (props.ts convertMaterial) binds the tile to
// any material named here. The two wall modules keep their own masonry atlas and are not named.
//
// Kept in its own tiny module so the name rule has one home that the converter and its guard test
// both import.

/** The GLB material names that wear the shared cliff tile. */
export const STORM_ROCK_MATERIAL = /^gyre_storm_(spire|bluff|arch|stone)$/;

/** True for a material the shared cliff tile is bound to. */
export function isStormRockMaterial(name: string): boolean {
  return STORM_ROCK_MATERIAL.test(name);
}

/** The pillar models, with the budget each is built to: triangles at most, file bytes at most. */
export const STORM_ROCK_BUDGET: Readonly<
  Record<'spire' | 'bluff' | 'arch' | 'stone', { tris: number; bytes: number }>
> = {
  spire: { tris: 1600, bytes: 110_000 },
  bluff: { tris: 1200, bytes: 90_000 },
  arch: { tris: 1500, bytes: 110_000 },
  stone: { tris: 800, bytes: 60_000 },
};
