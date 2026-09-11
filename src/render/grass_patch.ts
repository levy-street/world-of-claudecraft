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
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { configureMaskedDoubleSidedVegetationMaterial, GFX, sharedUniforms } from './gfx';

// Patch footprint radius in SOURCE units at the DEFAULT clump size. Grass
// patches skip the placed-assets height normalization (norm = 1), so this is
// yards at placement scale 1.
export const GRASS_PATCH_RADIUS = 2.2;
// Airy on purpose: heavily overlapped cards read as a dark mass instead of a
// meadow (the ambient ring places roughly one tuft per square yard).
export const DEFAULT_TUFTS_PER_PATCH = 16;

/** Disc radius for a clump of `count` tufts: single strands sit AT the anchor,
 *  bigger clumps keep roughly the default density. */
export function grassPatchRadius(count: number): number {
  if (count <= 1) return 0;
  return Math.min(3.2, GRASS_PATCH_RADIUS * Math.sqrt(count / DEFAULT_TUFTS_PER_PATCH));
}
// Matches foliage.ts GRASS_WIND_STRENGTH so painted grass sways like ambient.
const WIND_STRENGTH = 0.08;
// The hue a hue-less patch renders with: the PERCEIVED blade hue of the
// ambient ring's vale grass (olive texture times its pale tint), so default
// painted grass matches the built-in meadows. The blade texture here is
// GRAYSCALE and the whole color rides the instance tint, that is what lets
// the editor's hue slider actually theme the grass (a pale tint multiplied
// over the ring's olive texture could never turn it blue or red).
const DEFAULT_HUE = 105;
const TINT_S = 0.55;
const TINT_L = 0.55;

// Wind sway only (no player-distance fade: patches are small and placed, not
// streamed). Same math as foliage.ts applyGrassShader's wind block; the phase
// keys off the tuft's patch-local base so blades in one patch desynchronize.
function applyPatchSway(mat: THREE.Material): void {
  if (!GFX.windSway) return;
  mat.onBeforeCompile = (sh) => {
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
        float windPhase = tuftBase.x * 0.31 + tuftBase.y * 0.27;
        float windAmt = (sin(uTime * 1.7 + windPhase) + 0.5 * sin(uTime * 3.1 + windPhase * 1.3))
          * ${WIND_STRENGTH.toFixed(3)} * smoothstep(0.0, 0.7, transformed.y);
        transformed.x += windAmt;
        transformed.z += windAmt * 0.6;`,
      );
  };
}

// The ambient ring's tuft texture drawn in GRAYSCALE (same blade strokes as
// textures.ts grassTuftTexture): dark roots, light tips, no baked color. The
// per-instance tint supplies the whole hue.
function grayTuftTexture(blades: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 64, 64);
  for (let i = 0; i < blades; i++) {
    const x = 8 + Math.random() * 48;
    const sway = (Math.random() - 0.5) * 14;
    const h = 26 + Math.random() * 30;
    const root = 70 + Math.floor(Math.random() * 25);
    const tip = 150 + Math.floor(Math.random() * 45);
    const grad = ctx.createLinearGradient(x, 64, x + sway, 64 - h);
    grad.addColorStop(0, `rgba(${root},${root},${root},0.9)`);
    grad.addColorStop(1, `rgba(${tip},${tip},${tip},0.9)`);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.0 + Math.random() * 0.8; // finer blades read as grass, not straps
    ctx.beginPath();
    ctx.moveTo(x, 64);
    ctx.quadraticCurveTo(x + sway * 0.4, 64 - h * 0.6, x + sway, 64 - h);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let sharedGeo: THREE.BufferGeometry | null = null;
let sharedMat: THREE.Material | null = null;

function parts(): { geo: THREE.BufferGeometry; mat: THREE.Material } {
  if (!sharedGeo || !sharedMat) {
    // The grass ring's lush tuft card: two crossed quads seated on y = 0.
    const lush = !GFX.leanFoliage;
    // Knee-high meadow tufts: the old 1.45x0.9 cards at full tuft scale stood
    // chest-high next to the ~2yd player and read as shrubs, not grass.
    const quad = new THREE.PlaneGeometry(lush ? 1.15 : 0.9, lush ? 0.62 : 0.5);
    quad.translate(0, lush ? 0.29 : 0.24, 0);
    const quad2 = quad.clone().rotateY(Math.PI / 2);
    sharedGeo = mergeGeometries([quad, quad2]);
    sharedMat = configureMaskedDoubleSidedVegetationMaterial(
      lush
        ? new THREE.MeshStandardMaterial({
            map: grayTuftTexture(44),
            alphaTest: 0.3,
            roughness: 0.9,
          })
        : new THREE.MeshLambertMaterial({
            map: grayTuftTexture(18),
            alphaTest: 0.35,
          }),
    );
    applyPatchSway(sharedMat);
  }
  return { geo: sharedGeo, mat: sharedMat };
}

/** Deterministic per-patch scatter seed from the placement's anchor. */
export function grassPatchSeed(x: number, z: number): number {
  return ((Math.round(x * 8) * 73856093) ^ (Math.round(z * 8) * 19349663)) >>> 0;
}

/**
 * Build one grass patch: `clump` tuft cards (default a small meadow clump,
 * 1 = a single strand) scattered in a disc around the origin. `hue` (degrees
 * [0, 360]) and `lum` ([0, 1]) recolor the blades for themed maps; undefined
 * keeps the built-in meadow green. Deterministic in `seed`, so undo/reload
 * rebuilds the identical patch.
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
  const up = new THREE.Vector3(0, 1, 0);
  const v = new THREE.Vector3();
  const sv = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const ang = rnd() * Math.PI * 2;
    const rad = Math.sqrt(rnd()) * radius;
    const tuftScale = 0.5 + rnd() * 0.6; // knee-high spread; placement scale multiplies
    q.setFromAxisAngle(up, rnd() * Math.PI * 2);
    m.compose(
      v.set(Math.sin(ang) * rad, 0, Math.cos(ang) * rad),
      q,
      sv.set(tuftScale, tuftScale, tuftScale),
    );
    im.setMatrixAt(i, m);
    c.copy(base);
    c.offsetHSL((rnd() - 0.5) * 0.05, (rnd() - 0.5) * 0.12, (rnd() - 0.5) * 0.05);
    im.setColorAt(i, c);
  }
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.computeBoundingSphere();
  // Like the grass ring: darken under canopy shade, cast nothing (too small).
  im.receiveShadow = true;
  return im;
}
