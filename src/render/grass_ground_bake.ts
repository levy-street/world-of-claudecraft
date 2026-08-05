// The baked grass ground texture: a tileable world-space albedo the terrain
// paints EVERYWHERE grass grows, near chunks and far-vista tiles alike.
//
// Built by rendering a patch of the REAL blade clusters (blade_grass.ts
// geometry, unlit, vertex shade gradient only) top-down orthographically
// into a mipped render target. Because the strokes ARE the blades, the
// texture's mip chain averages to the blades' own distant appearance by
// construction: the ground colour at any distance equals what a field of
// real clusters would resolve to, with no hand-matched constants. The bake
// is TINT-NEUTRAL (greyscale strokes over a soil floor); the terrain
// multiplies in the per-vertex grass tint (groundGrassColorAt through the
// biome palette), which is how dusk paints violet-cast and vale paints
// green from one texture.
//
// One bake per session, a few milliseconds, before the terrain material
// compiles. ?grassbake=off (dev) keeps the legacy photo splat layer.

import * as THREE from 'three';
import { clusterGeometry, mulberry32 } from './blade_grass';
import {
  GRASS_BAKE_CLUSTER_JITTER,
  GRASS_BAKE_PATCH_YARDS,
  GRASS_BAKE_SOIL_SHADE,
  GRASS_BAKE_TEXTURE_SIZE,
} from './meadow_tuning';

export interface GrassGroundBake {
  /** Tileable linear-space albedo, RepeatWrapping, mipped, anisotropic. */
  texture: THREE.Texture;
  /** Per-channel mean of the baked patch (linear). This IS the blades'
   *  fully-mip-averaged appearance; the band blades sink their bases toward
   *  it so contact points disappear. */
  mean: [number, number, number];
}

// Module singleton: the renderer bakes once at construction; terrain.ts and
// far_terrain.ts read it when their materials build (both happen later in
// the same constructor). Null when baking was skipped (dev flag, headless).
let activeBake: GrassGroundBake | null = null;

export function setGrassGroundBake(bake: GrassGroundBake | null): void {
  activeBake = bake;
}

export function getGrassGroundBake(): GrassGroundBake | null {
  return activeBake;
}

// Same integer hash family the carpet uses for placement decisions.
function hash(i: number, j: number, k: number): number {
  let h = (i * 374761393 + j * 668265263 + k * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Render the bake. `renderer` must be the live WebGLRenderer; state (render
 * target, tone mapping) is saved and restored around the offscreen pass.
 */
export function bakeGrassGroundTexture(
  renderer: THREE.WebGLRenderer,
  seed: number,
): GrassGroundBake {
  const patch = GRASS_BAKE_PATCH_YARDS;
  const size = GRASS_BAKE_TEXTURE_SIZE;

  // Cluster field over the patch at the CARPET's own density (0.46-yard
  // cells) and the carpet's own size formula, so the strokes are the real
  // blades at their real size. Instances are laid on a torus: every cluster
  // is drawn at its cell position plus all eight patch-shifted copies, and
  // the ortho camera clips to one period, so blades crossing an edge wrap
  // and the texture tiles seamlessly.
  const CELL = 0.46;
  const cellsPerAxis = Math.floor(patch / CELL);
  const geo = clusterGeometry(mulberry32(seed ^ 0x6b1a));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const placements: { x: number; z: number; s: number; sy: number; yaw: number; grey: number }[] =
    [];
  for (let cj = 0; cj < cellsPerAxis; cj++) {
    for (let ci = 0; ci < cellsPerAxis; ci++) {
      const r1 = hash(ci, cj, 11);
      // the carpet's coverage gate at a representative mid lushness; the
      // world-position gates (roads, water, slope) do not exist inside a
      // neutral patch, and lushness structure comes from the per-vertex
      // tint, not the texture
      const lush = 0.55;
      if (r1 >= (0.44 + 1.7 * lush * lush) * 1.05) continue;
      const x = (ci + 0.5) * CELL + (r1 - 0.5) * CELL * 1.3;
      const z = (cj + 0.5) * CELL + (hash(ci, cj, 12) - 0.5) * CELL * 1.3;
      const lushHere = 0.5 + lush * 0.6;
      let s = (0.22 + hash(ci, cj, 13) * 0.34) * lushHere;
      const rTuft = hash(ci, cj, 14);
      if (rTuft < 0.1) s *= 1.5 + rTuft * 3.0;
      placements.push({
        x,
        z,
        s,
        sy: s * (0.85 + lush * 0.5) * (0.82 + hash(ci, cj, 16) * 0.36),
        yaw: r1 * 12.9,
        grey: 1 + (hash(ci, cj, 15) - 0.5) * 2 * GRASS_BAKE_CLUSTER_JITTER,
      });
    }
  }

  const im = new THREE.InstancedMesh(geo, mat, placements.length * 9);
  im.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(placements.length * 9 * 3),
    3,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const v = new THREE.Vector3();
  const sv = new THREE.Vector3();
  const c = new THREE.Color();
  let n = 0;
  for (const p of placements) {
    q.setFromAxisAngle(up, p.yaw);
    c.setRGB(p.grey, p.grey, p.grey);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        m.compose(v.set(p.x + di * patch, 0, p.z + dj * patch), q, sv.set(p.s, p.sy, p.s));
        im.setMatrixAt(n, m);
        im.setColorAt(n, c);
        n++;
      }
    }
  }
  im.count = n;
  im.frustumCulled = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(
    GRASS_BAKE_SOIL_SHADE,
    GRASS_BAKE_SOIL_SHADE,
    GRASS_BAKE_SOIL_SHADE,
  );
  scene.add(im);

  // Top-down ortho over exactly one patch period. Y bounds cover the
  // tallest tuft (about 1.2 local yards times the tall-class scale).
  const cam = new THREE.OrthographicCamera(0, patch, patch, 0, 0.1, 20);
  cam.position.set(0, 10, 0);
  cam.up.set(0, 0, -1);
  cam.lookAt(0, 0, 0);

  const rt = new THREE.WebGLRenderTarget(size, size, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    colorSpace: THREE.NoColorSpace,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    depthBuffer: true,
  });
  rt.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const prevTarget = renderer.getRenderTarget();
  const prevToneMapping = renderer.toneMapping;
  // Albedo-space bake: tone mapping belongs to the lit frame, not the map.
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);

  // Per-channel mean via one full readback (a few milliseconds, once per
  // session): the measured distant appearance the band blades sink toward.
  const px = new Uint8Array(size * size * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < px.length; i += 4) {
    r += px[i];
    g += px[i + 1];
    b += px[i + 2];
  }
  const inv = 1 / (size * size * 255);
  const mean: [number, number, number] = [r * inv, g * inv, b * inv];

  renderer.setRenderTarget(prevTarget);
  renderer.toneMapping = prevToneMapping;
  geo.dispose();
  mat.dispose();
  im.dispose();

  return { texture: rt.texture, mean };
}
