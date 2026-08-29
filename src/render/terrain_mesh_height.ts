// The height the TERRAIN MESH is built from.
//
// The chunk generator samples a vertex lattice (1.2yd at the densest LOD band,
// 3.0yd on the low tier) and draws flat triangles between the samples, so it
// can only carry features WIDER than that lattice. Anything sharper renders as
// a smeared ramp while the sim keeps the exact cliff, and the two surfaces
// disagree: a player standing at the sim height either floats over the drawn
// ground or sinks into it.
//
// Today every authored surface obeys that rule on its own: sheer walkable
// masses live in the lift fields (walk_lifts.ts), which groundHeight adds and
// terrainHeight does not, and their render modules draw each one with a
// visible cap; the remaining authored pads (Dawnhold, the Bulwark, the Last
// Keep's build site) blend over skirts wider than the lattice. So the mesh
// height IS terrainHeight. The seam stays because the exception class is
// real: the Last Keep's old inner-ward terrace baked a 0.7yd retaining blend
// into terrainHeight and had to be subtracted here and drawn as masonry. A
// future feature sharper than the lattice subtracts itself here the same way.
import { terrainHeight } from '../sim/world';

export function meshTerrainHeight(x: number, z: number, seed: number): number {
  return terrainHeight(x, z, seed);
}
