// A Heat floor decal drawn so a pool of them can share one rung without a
// flicker (heat_floor_ladder_core.ts): one source shader, two passes.
//
// A normal blend lays `dst * (1 - a) + col * a`. Split, the same picture is a
// CHAR pass that multiplies the floor by `1 - a` and a GLOW pass that adds
// `col * a`. A lone decal looks exactly as before; where two of the same pool
// cross (two swells' wakes out of one crater, two rivers off the lip, two
// Wakefire bands on their shared radius) multiplies and sums commute, so the
// crossing is the same picture whichever piece three.js happens to sort
// first, from every camera angle. The char rungs sit under the glow rungs.
//
// The glow mesh is a child of the char mesh (same geometry, identity local
// transform), so a painter keeps moving, scaling and hiding ONE mesh as it
// always did; both materials read one uniforms object. Built in the owner's
// constructor under its gated root (both programs link at the gate).

import * as THREE from 'three';
import { floorVfxRenderOrder } from '../floor_vfx_layer';

/** The char pass's tail: the floor multiplied by what the source let through. */
const CHAR_TAIL = /* glsl */ `
#ifdef HEAT_CHAR
  gl_FragColor = vec4(vec3(1.0 - clamp(gl_FragColor.a, 0.0, 1.0)), 1.0);
#endif
}
`;

/** `frag` with the char tail spliced before its closing brace. */
export function withCharTail(frag: string): string {
  const end = frag.lastIndexOf('}');
  if (end < 0) throw new Error('heat decal: fragment shader has no main body');
  return frag.slice(0, end) + CHAR_TAIL + frag.slice(end + 1);
}

/** The multiply blend of a char pass (dst * src.rgb, the floor's alpha kept). */
export function applyCharBlend(m: THREE.Material): void {
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.DstColorFactor;
  m.blendDst = THREE.ZeroFactor;
  m.blendEquationAlpha = THREE.AddEquation;
  m.blendSrcAlpha = THREE.ZeroFactor;
  m.blendDstAlpha = THREE.OneFactor;
}

export interface MoltenDecalSpec {
  name: string;
  geometry: THREE.BufferGeometry;
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, THREE.IUniform>;
  /** Encounter steps of the two passes (char under glow). */
  charStep: number;
  glowStep: number;
}

export interface MoltenDecal {
  /** The mesh a painter moves (the char pass; the glow rides it). */
  mesh: THREE.Mesh;
  /** The char pass's material (its uniforms are the shared object). */
  mat: THREE.ShaderMaterial;
  glow: THREE.Mesh;
  glowMat: THREE.ShaderMaterial;
}

/** A decal's two passes; `materials` collects both for the owner's dispose. */
export function moltenDecal(spec: MoltenDecalSpec, materials: THREE.Material[]): MoltenDecal {
  const common = {
    uniforms: spec.uniforms,
    vertexShader: spec.vertexShader,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  };
  const mat = new THREE.ShaderMaterial({
    ...common,
    name: `${spec.name}Char`,
    fragmentShader: withCharTail(spec.fragmentShader),
    defines: { HEAT_CHAR: '' },
  });
  applyCharBlend(mat);
  const glowMat = new THREE.ShaderMaterial({
    ...common,
    name: `${spec.name}Glow`,
    fragmentShader: spec.fragmentShader,
    blending: THREE.AdditiveBlending,
  });
  materials.push(mat, glowMat);
  const mesh = new THREE.Mesh(spec.geometry, mat);
  mesh.name = spec.name;
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = floorVfxRenderOrder('encounter', spec.charStep);
  const glow = new THREE.Mesh(spec.geometry, glowMat);
  glow.name = `${spec.name}Glow`;
  glow.frustumCulled = false;
  glow.renderOrder = floorVfxRenderOrder('encounter', spec.glowStep);
  mesh.add(glow);
  return { mesh, mat, glow, glowMat };
}
