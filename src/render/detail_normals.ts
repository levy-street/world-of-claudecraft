// Shared tiling detail normal for the flat-palette stone families (dungeon
// module packs, delve stone masses, castle slab caps). The 379 dungeon GLBs
// and the procedural castle/delve boxes carry solid-color swatch textures, so
// a height-from-albedo bake has nothing to work with; instead every stone
// material family attaches this ONE gently tiling rock normal (the already
// shipped terrain rock pack) at a low normalScale, which gives flat-shaded
// low-poly walls a faint surface grain without breaking the toy-like style.
//
// We own a CLONE of the terrain texture: loadTexture dedupes by URL and the
// terrain splat samples the same file with its own repeat/transform, so
// mutating the shared instance's repeat would corrupt the terrain. The clone
// shares the decoded image (one fetch, one decode) and costs one extra GPU
// texture, shared by every stone material that opts in.
import * as THREE from 'three';
import { loadTexture } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { GFX } from './gfx';

/** Subtle by design: the grain must read as surface response, not noise. */
export const STONE_DETAIL_NORMAL_SCALE = 0.3;
const STONE_DETAIL_REPEAT = 3;

let stoneNormal: THREE.Texture | null = null;

// Lambert (low tier) ignores normal maps entirely, so skip the fetch there,
// mirroring terrain.ts's GFX.terrainSplat gate. Consumers fail soft on null:
// the material simply ships without the detail grain.
if (GFX.standardMaterials) {
  registerDeferredPreload(() =>
    loadTexture('/textures/terrain/Rock051_NormalGL.jpg', { repeat: true }).then((tex) => {
      const detail = tex.clone();
      detail.wrapS = THREE.RepeatWrapping;
      detail.wrapT = THREE.RepeatWrapping;
      detail.repeat.set(STONE_DETAIL_REPEAT, STONE_DETAIL_REPEAT);
      detail.anisotropy = 4;
      detail.needsUpdate = true;
      stoneNormal = detail;
      return detail;
    }),
  );
}

/** Resolved once the preload gate has run (or the first dungeon ensure
 *  completes); null before that and on the Lambert tier. */
export function stoneDetailNormal(): THREE.Texture | null {
  return stoneNormal;
}
