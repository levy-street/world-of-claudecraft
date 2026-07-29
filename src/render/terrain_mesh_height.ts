// The height the TERRAIN MESH is built from.
//
// The chunk generator samples a vertex lattice (1.2yd at the densest LOD band,
// 3.0yd on the low tier) and draws flat triangles between the samples, so it
// can only carry features WIDER than that lattice. Anything sharper renders as
// a smeared ramp while the sim keeps the exact cliff, and the two surfaces
// disagree: a player standing at the sim height either floats over the drawn
// ground or sinks into it.
//
// The castle's built masses already avoid this: the curtain walls, bastions
// and stair flights live in castleLift, which groundHeight adds and
// terrainHeight does not, and render/castle_features.ts draws each one with a
// visible cap so nobody stands on air. The Last Keep's inner ward was the one
// exception, a 2.6yd terrace with a 0.7yd retaining blend baked into
// terrainHeight; its faces smeared up to 1.7yd out over the bailey and buried
// anyone walking along them (player report: characters sinking into the ground
// on the keep's east and west faces).
//
// So the mesh subtracts the ward terrace and castle_features.ts draws it as
// masonry. This is a RENDER view only: groundHeight, the climb gate, the
// steepness field, and every collision path still see the exact terrace.
import { castlePadWeight, wardTerraceRise } from '../sim/castle_layout';
import { terrainHeight } from '../sim/world';

export function meshTerrainHeight(x: number, z: number, seed: number): number {
  const rise = wardTerraceRise(x, z);
  const h = terrainHeight(x, z, seed);
  // exactly the contribution applyCastlePad added: target lerped in by weight
  return rise > 0 ? h - rise * castlePadWeight(x, z) : h;
}
