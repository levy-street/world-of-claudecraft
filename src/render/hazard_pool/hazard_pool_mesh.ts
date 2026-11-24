// The hazard pool's Three half: one disc geometry per pool (its per-pool data
// baked into vertex attributes, so pools of one style can share a material)
// and the material factory over the one shared shader program.

import * as THREE from 'three';
import type { HazardPoolStyle } from '../../world_api/dungeons';
import { sharedUniforms } from '../gfx';
import {
  HAZARD_POOL_LOOKS,
  HAZARD_POOL_STATIC_PHASE,
  type HazardPoolPhase,
  hazardPoolDiscExtent,
  hazardPoolEdgeMargin,
  hazardPoolSeed,
} from './hazard_pool_core';
import { HAZARD_POOL_FRAG, HAZARD_POOL_VERT } from './hazard_pool_shader';

/** One pool's footprint: the sim's damage circle, or ellipse via rx/rz. */
export interface HazardPoolShape {
  x: number;
  z: number;
  r: number;
  rx?: number;
  rz?: number;
}

const RINGS = 10;
const SEGS = 72;

/**
 * A polar disc covering the pool plus its outward edge margin. With `centred`
 * the disc is built around the origin (a dynamic pool's mesh is moved to its
 * spot); otherwise it is baked at (x, z) in its parent's frame (static rooms).
 * Attributes: aPool (radius units: |aPool| = 1 is the damage edge), aLocal
 * (yards from the centre, for the noise), aInfo (radius, edge margin as a
 * fraction of the radius, noise seed).
 */
export function buildHazardPoolGeometry(
  shape: HazardPoolShape,
  centred = false,
): THREE.BufferGeometry {
  const r = Math.max(shape.r, 0.1);
  const rx = shape.rx ?? r;
  const rz = shape.rz ?? r;
  const ext = hazardPoolDiscExtent(r);
  const ox = centred ? 0 : shape.x;
  const oz = centred ? 0 : shape.z;
  const count = 1 + RINGS * SEGS;
  const pos = new Float32Array(count * 3);
  const pool = new Float32Array(count * 2);
  const local = new Float32Array(count * 2);
  const info = new Float32Array(count * 3);
  const margin = hazardPoolEdgeMargin(r) / r;
  const seed = hazardPoolSeed(shape.x, shape.z);
  pos[0] = ox;
  pos[2] = oz;
  for (let ring = 0; ring < RINGS; ring++) {
    const rad = ((ring + 1) / RINGS) * ext;
    for (let i = 0; i < SEGS; i++) {
      const a = (i / SEGS) * Math.PI * 2;
      const k = 1 + ring * SEGS + i;
      const ux = Math.cos(a) * rad;
      const uz = Math.sin(a) * rad;
      pos[k * 3] = ox + ux * rx;
      pos[k * 3 + 2] = oz + uz * rz;
      pool[k * 2] = ux;
      pool[k * 2 + 1] = uz;
      local[k * 2] = ux * rx;
      local[k * 2 + 1] = uz * rz;
    }
  }
  for (let k = 0; k < count; k++) {
    info[k * 3] = r;
    info[k * 3 + 1] = margin;
    info[k * 3 + 2] = seed;
  }
  const index: number[] = [];
  for (let i = 0; i < SEGS; i++) index.push(0, 1 + ((i + 1) % SEGS), 1 + i);
  for (let ring = 0; ring + 1 < RINGS; ring++) {
    const a0 = 1 + ring * SEGS;
    const b0 = 1 + (ring + 1) * SEGS;
    for (let i = 0; i < SEGS; i++) {
      const j = (i + 1) % SEGS;
      index.push(a0 + i, a0 + j, b0 + i, a0 + j, b0 + j, b0 + i);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aPool', new THREE.BufferAttribute(pool, 2));
  g.setAttribute('aLocal', new THREE.BufferAttribute(local, 2));
  g.setAttribute('aInfo', new THREE.BufferAttribute(info, 3));
  g.setIndex(index);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(ox, 0.1, oz), Math.max(rx, rz) * ext + 0.2);
  return g;
}

/**
 * A material over the shared hazard pool program. Static pools tick on the
 * world's shared clock; a dynamic host passes its own (so reduced motion can
 * hold it still). Every material starts in the static (fully formed) phase.
 */
export function createHazardPoolMaterial(
  style: HazardPoolStyle,
  time: { value: number } = sharedUniforms.uTime,
): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    name: 'hazardPool',
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: time,
      uBase: { value: new THREE.Color() },
      uFilm: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color() },
      uSheen: { value: new THREE.Color() },
      uThick: { value: 0 },
      uLift: { value: 0 },
      uDome: { value: 0 },
      uFilmAmt: { value: 1 },
      uBody: { value: 1 },
      uArming: { value: 0 },
      uFade: { value: 0 },
    },
    vertexShader: HAZARD_POOL_VERT,
    fragmentShader: HAZARD_POOL_FRAG,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  setHazardPoolStyle(mat, style);
  setHazardPoolPhase(mat, HAZARD_POOL_STATIC_PHASE);
  return mat;
}

/** Repaint a material in another style (a pooled dynamic slot reuses it). */
export function setHazardPoolStyle(mat: THREE.ShaderMaterial, style: HazardPoolStyle): void {
  const look = HAZARD_POOL_LOOKS[style];
  const u = mat.uniforms;
  (u.uBase.value as THREE.Color).setHex(look.base);
  (u.uFilm.value as THREE.Color).setHex(look.film);
  (u.uGlow.value as THREE.Color).setHex(look.glow);
  (u.uSheen.value as THREE.Color).setHex(look.sheen);
  u.uThick.value = look.thick;
  u.uLift.value = look.lift;
  u.uDome.value = look.dome;
}

/** Write one frame of a pool's life into its material. */
export function setHazardPoolPhase(
  mat: THREE.ShaderMaterial,
  phase: Readonly<HazardPoolPhase>,
): void {
  const u = mat.uniforms;
  u.uFilmAmt.value = phase.film;
  u.uBody.value = phase.body;
  u.uArming.value = phase.arming;
  u.uFade.value = phase.fade;
}
