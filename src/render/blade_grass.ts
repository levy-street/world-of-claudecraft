import * as THREE from 'three';
import { getActiveWorldContent, WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_Z } from '../sim/data';
import { isInSowfieldShell } from '../sim/vale_cup_layout';
import { roadDistance, terrainHeight, WATER_LEVEL, zoneBiomeAt } from '../sim/world';
import {
  activateDenseSlot,
  type DenseSlotState,
  deactivateDenseSlot,
} from './blade_grass_dense_core';
import { GRASS_BIOME_DENSITY } from './foliage';
import { insideGrassHubExclusion } from './foliage_core';
import { patchConstantUpNormalVertexShader } from './foliage_shader_core';
import { GFX, sharedUniforms } from './gfx';
import { MEADOW_CARPET_FADE_START } from './meadow_tuning';
import { renderLayerDisabled } from './render_dev_flags';
import { groundGrassColorAt, groundLushnessAt } from './terrain_chunk_build';

// Near-field blade carpet: a single InstancedMesh of low-poly SOLID grass
// clusters riding a toroidal grid around the player. The card-tuft system in
// foliage.ts owns the mid/far field. Its crossed alpha cards read fine at
// range but resolve into "scattered 3D models" up close, which is exactly
// where this carpet takes over: thousands of small individually-swaying
// blades, dense on the lush soil patches and absent between them, tinted by
// the ground colour under each cluster so the meadow reads as one grown
// surface. Solid geometry (no alphaTest) keeps the cozy low-poly art style
// and costs one draw call.
//
// The grid is toroidal: slot (i, j) always owns the world cell congruent to
// (i, j) mod GRID_W nearest the player, so walking re-places only the ring of
// slots whose target cell changed, with no allocation or map churn. Placement is
// budgeted per frame; a sprint briefly thins the leading edge and backfills
// within a second.

// Denser and finer than the first cut (blades were reading as sparse
// standalone clumps): tighter cells, smaller blades, and a wider ring so
// the carpet blends into the card tufts instead of ending at your feet.
// The RADIUS comes from GFX.bladeCarpetRadius (24 on high, 34 on ultra and
// insane; the Advanced Foliage Density dial trims or extends it; 0 disables
// the carpet), so the grid dimensions derive per build inside buildBladeGrass.
const CELL = 0.46; // yards between clusters
const PLACE_BUDGET = 560; // re-placements per frame while moving
// of RADIUS: where the outer scale-collapse fade begins. Shared with the
// meadow tuning surface: a short fade ring read as grass "loading in"
// around the player, so the ramp now spans the outer half of the carpet.
const FADE_START = MEADOW_CARPET_FADE_START;

export interface BladeGrassView {
  group: THREE.Group;
  update(px: number, pz: number): void;
}

// same tiny deterministic PRNG the motes pool uses (module-local there);
// exported for the mid-band and the ground bake, which reuse the exact
// cluster look
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One cluster: a handful of tapered three-segment blades scattered around the
// origin. Every blade rolls its own yaw, root offset, base tilt, bow, length,
// and width, and the bow eases in quadratically toward the tip, so the tuft
// reads as grown grass arcing over rather than a symmetric fan of straight
// spikes. Vertex colors carry a base->tip brighten so blades read rooted
// without a texture; instanceColor multiplies in the per-spot ground tint.
// Exported (geometry unchanged): the mid-band (blade_grass_band.ts) and the
// ground bake (grass_ground_bake.ts) must use these EXACT clusters so the
// carpet, the band, and the painted ground are one look by construction.
export function clusterGeometry(rng: () => number): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const BLADES = 5;
  for (let b = 0; b < BLADES; b++) {
    // even fan for coverage, heavy jitter so no two blades pair up
    const yaw = (b / BLADES) * Math.PI * 2 + (rng() - 0.5) * 2.4;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const ox = (rng() - 0.5) * 0.4;
    const oz = (rng() - 0.5) * 0.4;
    // each blade leaves the ground at its own angle: a straight base tilt
    // (some near-vertical, some well leant) plus a bow the tip eases into
    const tilt = rng() * 0.38;
    const bow = 0.1 + rng() * 0.45;
    const len = 0.55 + rng() * 0.55;
    const w0 = 0.042 + rng() * 0.022;
    const w1 = w0 * 0.62;
    const w2 = w0 * 0.34;
    const base = positions.length / 3;
    // widths run perpendicular to the lean so the silhouette shows the bow
    const px = -sin;
    const pz = cos;
    const put = (wx: number, t: number, shade: number): void => {
      // quadratic bend: roots stay planted, tips arc over like real grass
      const lean = (tilt * t + bow * t * t) * len;
      positions.push(ox + px * wx + cos * lean, len * t, oz + pz * wx + sin * lean);
      // all-up normals: blades take the terrain's lighting response, the
      // same trick the card tufts use, so the carpet never shades apart
      // from the ground it grows in
      colors.push(shade, shade, shade);
    };
    put(-w0, 0, 0.62);
    put(w0, 0, 0.62);
    put(-w1, 0.45, 0.86);
    put(w1, 0.45, 0.86);
    put(-w2, 0.76, 1.04);
    put(w2, 0.76, 1.04);
    put(0, 1.0, 1.18);
    indices.push(
      base,
      base + 1,
      base + 2,
      base + 1,
      base + 3,
      base + 2,
      base + 2,
      base + 3,
      base + 4,
      base + 3,
      base + 5,
      base + 4,
      base + 4,
      base + 5,
      base + 6,
    );
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  geo.setIndex(indices);
  return geo;
}

export function buildBladeGrass(
  seed: number,
  initialPx: number,
  initialPz: number,
): BladeGrassView {
  const group = new THREE.Group();
  group.name = 'bladeGrass';
  // The carpet is a close-camera read and one of the graphics-overhaul detail
  // layers: high runs a 24u recovery ring, ultra and insane run the full 34u
  // ring, and tiers below high keep only the card-tuft field. The Advanced
  // Foliage Density dial maps onto the same radius knob.
  // ?bladegrass=off is the dev-only perf-attribution kill switch
  // (render_dev_flags.ts).
  const RADIUS = GFX.bladeCarpetRadius;
  if (RADIUS <= 0 || renderLayerDisabled('bladegrass')) {
    return { group, update: () => undefined };
  }
  const GRID_W = Math.ceil((RADIUS * 2) / CELL); // slots per axis
  const POOL = GRID_W * GRID_W;

  const rng = mulberry32(seed ^ 0x6b1a);
  const geo = clusterGeometry(rng);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
    // flat strips with all-up normals light the same from either face, and
    // culling the back faces read as half the blades missing per cluster
    side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = sharedUniforms.uTime;
    sh.uniforms.uPlayerPos = uPlayerPos;
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform vec2 uPlayerPos;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 bgOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          // outer-ring fade by collapse: alpha would need transparency and a
          // sort; shrinking toward the root is invisible in motion
          float bgFade = 1.0 - smoothstep(${(RADIUS * FADE_START).toFixed(1)}, ${RADIUS.toFixed(1)}, distance(bgOrigin.xz, uPlayerPos));
          transformed *= bgFade;
          // per-blade sway, weighted by height squared so roots stay planted;
          // phase from the instance origin desynchronises neighbours
          float bgPhase = bgOrigin.x * 1.7 + bgOrigin.z * 2.3;
          float bgSway = (sin(uTime * 2.1 + bgPhase) + 0.4 * sin(uTime * 3.7 + bgPhase * 1.31))
            * 0.085 * position.y * position.y;
          transformed.x += bgSway;
          transformed.z += bgSway * 0.7;
        #endif`,
      );
    sh.vertexShader = patchConstantUpNormalVertexShader(sh.vertexShader);
  };
  const uPlayerPos = { value: new THREE.Vector2(1e9, 1e9) };

  const im = new THREE.InstancedMesh(geo, mat, POOL);
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  im.receiveShadow = true;
  im.castShadow = false;
  im.frustumCulled = false; // pool is centred on the player
  im.count = 0;
  im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(POOL * 3), 3);
  im.instanceColor.setUsage(THREE.DynamicDrawUsage);
  group.add(im);

  // per-slot current cell (packed), Number.MIN_SAFE_INTEGER = never placed
  const slotCell = new Int32Array(POOL).fill(0x7fffffff);
  const denseSlots: DenseSlotState = {
    count: 0,
    slotToDense: new Int32Array(POOL).fill(-1),
    denseToSlot: new Int32Array(POOL).fill(-1),
  };
  const m = new THREE.Matrix4();
  const movedMatrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const qLean = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const leanAxis = new THREE.Vector3();
  const v = new THREE.Vector3();
  const sv = new THREE.Vector3();
  const c = new THREE.Color();
  const movedColor = new THREE.Color();
  let dirtyLo = POOL;
  let dirtyHi = -1;

  const markDirty = (dense: number): void => {
    if (dense < dirtyLo) dirtyLo = dense;
    if (dense > dirtyHi) dirtyHi = dense;
  };

  const hash = (i: number, j: number, k: number): number => {
    let h = (i * 374761393 + j * 668265263 + k * 2246822519) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  function placeSlot(slot: number, ci: number, cj: number): void {
    const r1 = hash(ci, cj, 1);
    const x = ci * CELL + (r1 - 0.5) * CELL * 1.3;
    const z = cj * CELL + (hash(ci, cj, 2) - 0.5) * CELL * 1.3;
    let ok = Math.abs(x) <= WORLD_MAX_X - 16 && z >= WORLD_MIN_Z + 16 && z <= WORLD_MAX_Z - 16;
    if (ok) {
      // same soil-noise gate as the card tufts: dense on lush patches,
      // bare between them (squared for hard patch edges)
      const lush = groundLushnessAt(x, z, seed);
      const biomeDensity = GRASS_BIOME_DENSITY[zoneBiomeAt(x, z)] ?? 1;
      // higher floor + gain than the tufts: coverage is the carpet's job,
      // the patch structure just modulates it
      ok = r1 < (0.44 + 1.7 * lush * lush) * 1.05 * Math.min(biomeDensity, 1.2);
      if (ok) ok = roadDistance(x, z) > 2.4;
      if (ok) ok = !isInSowfieldShell(x, z);
      if (ok) ok = !insideGrassHubExclusion(getActiveWorldContent().zones, x, z);
      if (ok) {
        const h = terrainHeight(x, z, seed);
        ok = h > WATER_LEVEL + 1.4;
        // keep the carpet off banks: the same slope band where the terrain
        // shader fades its relief (planar smear territory)
        if (ok) ok = Math.abs(terrainHeight(x + 0.9, z, seed) - h) < 0.55;
        if (ok) {
          // smaller blades at higher count: ground COVER, not standalone
          // clumps, so the meadow reads as one grown surface. A hash-gated
          // size class turns ~10% of cells into taller tufts (x1.5 to x1.8)
          // that punctuate the fine carpet the rest of the cells lay down.
          const lushHere = 0.5 + lush * 0.6;
          let s = (0.22 + hash(ci, cj, 3) * 0.34) * lushHere;
          const rTuft = hash(ci, cj, 4);
          if (rTuft < 0.1) s *= 1.5 + rTuft * 3.0;
          q.setFromAxisAngle(up, r1 * 12.9);
          // whole-cluster lean, a hashed direction and up to ~12 degrees:
          // neighbouring tufts tip different ways instead of standing in a
          // uniform vertical crop
          const rLean = hash(ci, cj, 5);
          leanAxis.set(Math.sin(rLean * 41.3), 0, Math.cos(rLean * 41.3));
          q.premultiply(qLean.setFromAxisAngle(leanAxis, rLean * 0.21));
          // per-cluster height jitter on top of the blade-level length spread
          const hJit = 0.82 + hash(ci, cj, 6) * 0.36;
          m.compose(v.set(x, h - 0.02, z), q, sv.set(s, s * (0.85 + lush * 0.5) * hJit, s));
          groundGrassColorAt(x, z, seed, c);
          // slight lift over the raw ground tint: blades catch more sky
          // than the soil they stand on
          c.multiplyScalar(1.18);
          const dense = activateDenseSlot(denseSlots, slot);
          im.setMatrixAt(dense, m);
          im.setColorAt(dense, c);
          markDirty(dense);
          return;
        }
      }
    }
    const removedDense = denseSlots.slotToDense[slot];
    if (removedDense < 0) return;
    const movedSlot = deactivateDenseSlot(denseSlots, slot);
    if (movedSlot >= 0) {
      // The old last element remains readable at the new count index until
      // this copy completes. Moving it into the gap keeps the submitted
      // prefix dense without changing the matrix or colour bytes.
      im.getMatrixAt(denseSlots.count, movedMatrix);
      im.setMatrixAt(removedDense, movedMatrix);
      im.getColorAt(denseSlots.count, movedColor);
      im.setColorAt(removedDense, movedColor);
      markDirty(removedDense);
    }
  }

  // Scan bookkeeping: the toroidal scan only has work when the target block
  // moved (the player crossed a cell boundary) or a previous scan ran out of
  // budget mid-pass, so idle and within-cell frames skip the whole loop.
  // colCi hoists the per-column congruence out of the inner loop: the owned
  // world column depends only on (gi, baseI), so a scan computes it GRID_W
  // times instead of GRID_W * GRID_W times.
  const colCi = new Int32Array(GRID_W);

  const scanTargetBlock = (baseI: number, baseJ: number, initialBudget: number): boolean => {
    for (let gi = 0; gi < GRID_W; gi++) {
      // world cell owned by slot (gi, gj): the unique cell in the target
      // block congruent to (gi, gj) mod GRID_W
      colCi[gi] = baseI + ((((gi - baseI) % GRID_W) + GRID_W) % GRID_W);
    }
    let budget = initialBudget;
    for (let gj = 0; gj < GRID_W && budget > 0; gj++) {
      const cjj = baseJ + ((((gj - baseJ) % GRID_W) + GRID_W) % GRID_W);
      const packedLo = cjj & 0xffff;
      const rowBase = gj * GRID_W;
      for (let gi = 0; gi < GRID_W && budget > 0; gi++) {
        const packed = ((colCi[gi] & 0xffff) << 16) | packedLo;
        const slot = rowBase + gi;
        if (slotCell[slot] === packed) continue;
        slotCell[slot] = packed;
        placeSlot(slot, colCi[gi], cjj);
        budget--;
      }
    }
    return budget <= 0;
  };

  // Build the first dense prefix before the mesh reaches the renderer. Three.js
  // uploads each full attribute on its first draw, so no needsUpdate edge or
  // per-frame backfill is required for this placement.
  const initialBaseI = Math.floor(initialPx / CELL) - (GRID_W >> 1);
  const initialBaseJ = Math.floor(initialPz / CELL) - (GRID_W >> 1);
  scanTargetBlock(initialBaseI, initialBaseJ, Number.POSITIVE_INFINITY);
  im.count = denseSlots.count;
  dirtyLo = POOL;
  dirtyHi = -1;
  let lastBaseI = initialBaseI;
  let lastBaseJ = initialBaseJ;
  let pending = false;

  return {
    group,
    update(px: number, pz: number): void {
      uPlayerPos.value.set(px, pz);
      // target cell block: the GRID_W x GRID_W square centred on the player
      const baseI = Math.floor(px / CELL) - (GRID_W >> 1);
      const baseJ = Math.floor(pz / CELL) - (GRID_W >> 1);
      if (baseI === lastBaseI && baseJ === lastBaseJ && !pending) return;
      lastBaseI = baseI;
      lastBaseJ = baseJ;
      // dirty slot span: re-placed slots this frame, so the GPU upload can
      // cover just that range of the instance buffers instead of the pool
      dirtyLo = POOL;
      dirtyHi = -1;
      const previousCount = denseSlots.count;
      pending = scanTargetBlock(baseI, baseJ, PLACE_BUDGET);
      if (denseSlots.count !== previousCount) im.count = denseSlots.count;
      if (dirtyHi >= 0) {
        // partial upload: only the touched slot span goes to the GPU. Ranges
        // are queued, never cleared here: the renderer clears them after it
        // actually uploads, so a skipped frame keeps its pending span alive.
        const count = dirtyHi - dirtyLo + 1;
        im.instanceMatrix.addUpdateRange(dirtyLo * 16, count * 16);
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) {
          im.instanceColor.addUpdateRange(dirtyLo * 3, count * 3);
          im.instanceColor.needsUpdate = true;
        }
      }
    },
  };
}
