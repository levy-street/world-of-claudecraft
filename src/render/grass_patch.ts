// Procedural grass-patch model for 'procedural://grass-patch' placements (the
// map editor's animated-grass foliage brush). Each patch is one InstancedMesh
// of the same cross-quad tuft cards the built-in world's streaming grass ring
// draws (src/render/foliage.ts), wind sway included, scattered in a small
// disc. There is no GLB behind it: the placed-assets view intercepts the
// sentinel path and builds the mesh synchronously.
//
// One geometry and ONE material are shared by every patch; the per-patch hue
// rides the per-instance color (the tuft texture is olive, so the instance
// tint carries the theme color, exactly like the grass ring's biome tint).

import * as THREE from 'three';
import { clusterGeometry, mulberry32 } from './blade_grass';
import { patchConstantUpNormalVertexShader } from './foliage_shader_core';
import { GFX, sharedUniforms } from './gfx';
import { GRASS_WIND_TIME_SCALE } from './tree_sway';

// Patch footprint radius in SOURCE units at the DEFAULT clump size. Grass
// patches skip the placed-assets height normalization (norm = 1), so this is
// yards at placement scale 1.
export const GRASS_PATCH_RADIUS = 2.2;
// Lush 3D blade-cluster patches: each tuft is a full arched ribbon cluster
// from blade_grass.ts, so painted patches in the Map Editor match the 3D
// Genshin meadow carpet.
export const DEFAULT_TUFTS_PER_PATCH = 22;

/** Disc radius for a clump of `count` tufts: single strands sit AT the anchor,
 *  bigger clumps keep roughly the default density. */
export function grassPatchRadius(count: number): number {
  if (count <= 1) return 0;
  return Math.min(3.2, GRASS_PATCH_RADIUS * Math.sqrt(count / DEFAULT_TUFTS_PER_PATCH));
}
// Matches foliage.ts GRASS_WIND_STRENGTH so painted grass sways like ambient.
const WIND_STRENGTH = 0.095;
// Default vibrant Genshin meadow hue/sat/lum when no custom hue/lum is set on
// the placement; custom hue/lum sliders in the Map Editor recolor the 3D
// blade clusters directly via instanceColor.
const DEFAULT_HUE = 87;
const TINT_S = 0.44;
const TINT_L = 0.54;

// Constant upward normal (clusterGeometry ships position + vertex color only)
// plus double-sided normal flip undo and live wind sway.
function applyPatchSway(mat: THREE.Material): void {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = patchConstantUpNormalVertexShader(sh.vertexShader);
    if (GFX.windSway) {
      sh.uniforms.uTime = sharedUniforms.uTime;
      sh.vertexShader = sh.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
        uniform float uTime;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 tuftBase = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        #else
          vec2 tuftBase = vec2(0.0);
        #endif
        float grassT = uTime * ${GRASS_WIND_TIME_SCALE.toFixed(4)};
        float windPhase = tuftBase.x * 0.31 + tuftBase.y * 0.27;
        float windAmt = (sin(grassT * 1.7 + windPhase) + 0.5 * sin(grassT * 3.1 + windPhase * 1.3))
          * ${WIND_STRENGTH.toFixed(3)} * smoothstep(0.0, 0.7, transformed.y);
        transformed.x += windAmt;
        transformed.z += windAmt * 0.6;`,
        );
    }
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      `#include <normal_fragment_begin>
      #ifdef DOUBLE_SIDED
        normal *= faceDirection;
      #endif`,
    );
  };
  mat.customProgramCacheKey = () => `woc-grass-patch-3d-${GFX.windSway ? 1 : 0}`;
}

let sharedGeo: THREE.BufferGeometry | null = null;
let sharedMat: THREE.Material | null = null;

function parts(): { geo: THREE.BufferGeometry; mat: THREE.Material } {
  if (!sharedGeo || !sharedMat) {
    sharedGeo = clusterGeometry(mulberry32(0x5eedcafe));
    sharedMat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    applyPatchSway(sharedMat);
  }
  return { geo: sharedGeo, mat: sharedMat };
}

/** Deterministic per-patch scatter seed from the placement's anchor. */
export function grassPatchSeed(x: number, z: number): number {
  return ((Math.round(x * 8) * 73856093) ^ (Math.round(z * 8) * 19349663)) >>> 0;
}

/**
 * Build one grass patch: `clump` 3D Genshin blade clusters (default a lush
 * meadow clump, 1 = a single cluster) scattered in a disc around the origin.
 * `hue` (degrees [0, 360]) and `lum` ([0, 1]) recolor the blades for themed
 * maps; undefined keeps the built-in Genshin meadow green. Deterministic in
 * `seed`, so undo/reload rebuilds the identical patch.
 */
export function buildGrassPatchModel(
  hue: number | undefined,
  lum: number | undefined,
  clump: number | undefined,
  seed: number,
): THREE.InstancedMesh {
  const { geo, mat } = parts();
  let s = seed || 1;
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const h = (((hue ?? DEFAULT_HUE) % 360) + 360) % 360;
  const l = Math.min(1, Math.max(0, lum ?? TINT_L));
  const count = Math.round(Math.min(60, Math.max(1, clump ?? DEFAULT_TUFTS_PER_PATCH)));
  const radius = grassPatchRadius(count);
  const base = new THREE.Color().setHSL(h / 360, TINT_S, l);
  const im = new THREE.InstancedMesh(geo, mat, count);
  im.userData.renderCategory = 'grass';
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const qLean = new THREE.Quaternion();
  const leanAxis = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const v = new THREE.Vector3();
  const sv = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const ang = rnd() * Math.PI * 2;
    const rad = Math.sqrt(rnd()) * radius;
    const tuftScale = 0.56 + rnd() * 0.54;
    q.setFromAxisAngle(up, rnd() * Math.PI * 2);
    const rLean = rnd();
    leanAxis.set(Math.cos(ang), 0, -Math.sin(ang));
    q.premultiply(
      qLean.setFromAxisAngle(leanAxis, (0.06 + rLean * 0.14) * (rad / Math.max(0.25, radius))),
    );
    const sxz = tuftScale * 1.18;
    const sy = tuftScale * (0.94 + rnd() * 0.28);
    m.compose(v.set(Math.sin(ang) * rad, -0.02, Math.cos(ang) * rad), q, sv.set(sxz, sy, sxz));
    im.setMatrixAt(i, m);
    c.copy(base);
    c.offsetHSL((rnd() - 0.5) * 0.045, (rnd() - 0.5) * 0.1, (rnd() - 0.42) * 0.08);
    im.setColorAt(i, c);
  }
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.computeBoundingSphere();
  // Like the grass ring: darken under canopy shade, cast nothing (too small).
  im.receiveShadow = true;
  return im;
}
