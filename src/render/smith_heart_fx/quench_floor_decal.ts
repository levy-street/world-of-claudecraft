// A Quench floor decal pool made to commute (quench_floor_ladder_core.ts):
// the Heat's split (heat_molten_decal.ts) applied to a mesh already built with
// a normal-blended ShaderMaterial. The mesh's own material becomes the CHAR
// pass (the floor multiplied by `1 - a`), and a child mesh on the same
// geometry draws the GLOW pass (`col * a` added). A lone decal looks exactly
// as its normal blend did; where two of a pool cross (two breaths' frost, two
// thrown blades' lines, two strikes' cracks) multiplies and sums commute, so
// the crossing is the same picture from every camera angle.
//
// The glow rides the char mesh (identity local transform), so the painter
// keeps moving, scaling and hiding ONE mesh; both materials read one uniforms
// object. Called in the owner's constructor (both programs link at its gate).

import * as THREE from 'three';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { applyCharBlend } from './heat_molten_decal';

/** The char pass's tail: the floor multiplied by what the source let through. */
const CHAR_TAIL = /* glsl */ `
#ifdef QUENCH_CHAR
  gl_FragColor = vec4(vec3(1.0 - clamp(gl_FragColor.a, 0.0, 1.0)), 1.0);
#endif
}
`;

/** `frag` with the char tail spliced before its closing brace. */
export function withQuenchCharTail(frag: string): string {
  const end = frag.lastIndexOf('}');
  if (end < 0) throw new Error('quench decal: fragment shader has no main body');
  return frag.slice(0, end) + CHAR_TAIL + frag.slice(end + 1);
}

/** Split `mesh` (a normal-blended ShaderMaterial) into its char pass on
 *  `charStep` and a glow child on `glowStep`; the new glow material joins
 *  `materials` for the owner's dispose. Returns the glow mesh. */
export function splitQuenchDecal(
  mesh: THREE.Mesh,
  charStep: number,
  glowStep: number,
  materials: THREE.Material[],
): THREE.Mesh {
  const src = mesh.material as THREE.ShaderMaterial;
  const glowMat = src.clone();
  // One uniforms object for both passes (a clone copies them).
  glowMat.uniforms = src.uniforms;
  glowMat.name = `${src.name}Glow`;
  glowMat.blending = THREE.AdditiveBlending;
  src.fragmentShader = withQuenchCharTail(src.fragmentShader);
  src.defines = { ...(src.defines ?? {}), QUENCH_CHAR: '' };
  src.name = `${src.name}Char`;
  applyCharBlend(src);
  src.needsUpdate = true;
  materials.push(glowMat);
  mesh.renderOrder = floorVfxRenderOrder('encounter', charStep);
  const glow = new THREE.Mesh(mesh.geometry, glowMat);
  glow.name = `${mesh.name}Glow`;
  glow.frustumCulled = false;
  glow.renderOrder = floorVfxRenderOrder('encounter', glowStep);
  mesh.add(glow);
  return glow;
}
