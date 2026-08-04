// The meadow-continuum blade BAND: real solid blade clusters, the exact
// geometry and placement rules of the near carpet (blade_grass.ts), carried
// out to MEADOW_BAND_RADIUS at ONE constant density. The band is the "3D
// blades near the camera" half of the meadow rule: the painted terrain
// carries the grass look at every distance, and this layer only adds
// parallax and silhouette where blades still resolve. Nothing here scales
// an element up and nothing varies with distance except the outer
// scale-collapse fade (from MEADOW_BAND_FADE_START of the radius outward)
// and the residency clamp handed in by the renderer.
//
// The band's grid covers the full disc, INCLUDING the ground under the near
// carpet. Cutting an inner hole at the carpet edge would make every band
// cluster pop in and out at a fixed 34-yard ring as the player walks; run
// under the carpet instead (a few percent extra instances) and there is no
// inner edge at all: the carpet's fine clusters fade by collapse over the
// same ground the band already stands on.
//
// Colour: instanceColor is the carpet's own tint (groundGrassColorAt times
// the blade lift), but each blade's BASE sinks toward the painted ground's
// measured mip-average (grass_ground_bake.ts mean), recovering to the grass
// tint by MEADOW_BAND_BASE_RECOVER_Y. Contact points disappear because the
// blade root is, by construction, the same colour as the pixel under it.

import * as THREE from 'three';
import { getActiveWorldContent, WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_Z } from '../sim/data';
import { isInSowfieldShell } from '../sim/vale_cup_layout';
import { roadDistance, terrainHeight, WATER_LEVEL, zoneBiomeAt } from '../sim/world';
import { clusterGeometry, mulberry32 } from './blade_grass';
import {
  activateDenseSlot,
  type DenseSlotState,
  deactivateDenseSlot,
} from './blade_grass_dense_core';
import { GRASS_BIOME_DENSITY } from './foliage';
import { insideGrassHubExclusion } from './foliage_core';
import { patchConstantUpNormalVertexShader } from './foliage_shader_core';
import { GFX, sharedUniforms } from './gfx';
import { getGrassGroundBake } from './grass_ground_bake';
import {
  GRASS_PAINT_TRIM,
  MEADOW_BAND_BASE_RECOVER_Y,
  MEADOW_BAND_BASE_SINK,
  MEADOW_BAND_CELL,
  MEADOW_BAND_FADE_START,
  MEADOW_BAND_PLACE_BUDGET,
  MEADOW_BAND_RADIUS,
} from './meadow_tuning';
import { renderLayerDisabled } from './render_dev_flags';
import { groundGrassColorAt, groundLushnessAt } from './terrain_chunk_build';

export interface BladeGrassBandView {
  group: THREE.Group;
  /**
   * `bandFar` is the residency-clamped detail horizon (the renderer's
   * subsystem cull far): the band's effective radius is min(bandFar,
   * MEADOW_BAND_RADIUS), so blades never stand past ground that has not
   * been built. `outdoor` follows the same visibility rule the far vista
   * uses: dungeons and interiors never draw the band.
   */
  update(px: number, pz: number, bandFar: number, outdoor: boolean): void;
}

export function buildBladeGrassBand(
  seed: number,
  initialPx: number,
  initialPz: number,
): BladeGrassBandView {
  const group = new THREE.Group();
  group.name = 'bladeGrassBand';
  // The band rides the carpet's own tier gate: tiers without the blade
  // carpet keep their existing look. ?meadowband=off is the dev
  // perf-attribution kill switch.
  const RADIUS = MEADOW_BAND_RADIUS;
  if (GFX.bladeCarpetRadius <= 0 || renderLayerDisabled('meadowband')) {
    return { group, update: () => undefined };
  }
  const CELL = MEADOW_BAND_CELL;
  const GRID_W = Math.ceil((RADIUS * 2) / CELL);
  const POOL = GRID_W * GRID_W;

  const rng = mulberry32(seed ^ 0x6b1a);
  const geo = clusterGeometry(rng);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const uPlayerPos = { value: new THREE.Vector2(1e9, 1e9) };
  // effective outer radius, per frame: min(residency-clamped horizon, RADIUS)
  const uBandFar = { value: RADIUS };
  // the painted ground's measured mip-average under the paint trim: what a
  // blade base must match for its contact point to vanish (fallback to the
  // carpet's rooted-shade look when the bake was skipped)
  const bake = getGrassGroundBake();
  const uBaseSink = {
    value: bake
      ? new THREE.Vector3(
          bake.mean[0] * GRASS_PAINT_TRIM,
          bake.mean[1] * GRASS_PAINT_TRIM,
          bake.mean[2] * GRASS_PAINT_TRIM,
        )
      : new THREE.Vector3(0.62, 0.62, 0.62),
  };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = sharedUniforms.uTime;
    sh.uniforms.uPlayerPos = uPlayerPos;
    sh.uniforms.uBandFar = uBandFar;
    sh.uniforms.uBaseSink = uBaseSink;
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform vec2 uPlayerPos;
        uniform float uBandFar;
        uniform vec3 uBaseSink;`,
      )
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
        #if defined( USE_COLOR ) && defined( USE_INSTANCING_COLOR )
          // base-sink: the blade root takes the painted ground's colour
          // (instance tint times the measured bake mean), recovering to the
          // grass tint toward the tip, so contact points disappear
          float bandBaseT = smoothstep(0.0, ${MEADOW_BAND_BASE_RECOVER_Y.toFixed(3)}, position.y);
          vec3 bandGroundCol = mix(vColor.rgb, instanceColor.rgb * uBaseSink,
            ${MEADOW_BAND_BASE_SINK.toFixed(3)});
          vColor.rgb = mix(bandGroundCol, vColor.rgb, bandBaseT);
        #endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 bgOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          // outer fade by scale collapse over the outer band fraction, and
          // the same collapse against the residency-clamped horizon: alpha
          // would need transparency and a sort; shrinking toward the root
          // is invisible in motion
          float bgFade = 1.0 - smoothstep(uBandFar * ${MEADOW_BAND_FADE_START.toFixed(2)},
            uBandFar, distance(bgOrigin.xz, uPlayerPos));
          transformed *= bgFade;
          // the carpet's sway, verbatim: one meadow, one wind
          float bgPhase = bgOrigin.x * 1.7 + bgOrigin.z * 2.3;
          float bgSway = (sin(uTime * 2.1 + bgPhase) + 0.4 * sin(uTime * 3.7 + bgPhase * 1.31))
            * 0.085 * position.y * position.y;
          transformed.x += bgSway;
          transformed.z += bgSway * 0.7;
        #endif`,
      );
    sh.vertexShader = patchConstantUpNormalVertexShader(sh.vertexShader);
  };

  const im = new THREE.InstancedMesh(geo, mat, POOL);
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  im.receiveShadow = true;
  im.castShadow = false;
  im.frustumCulled = false; // pool is centred on the player
  im.count = 0;
  im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(POOL * 3), 3);
  im.instanceColor.setUsage(THREE.DynamicDrawUsage);
  group.add(im);

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

  // The carpet's placeSlot, at the band's cell size: same coverage gate,
  // same road/water/slope/hub rules, same size classes, same tint. The two
  // systems must stay one look; if a rule changes there, change it here.
  function placeSlot(slot: number, ci: number, cj: number): void {
    const r1 = hash(ci, cj, 1);
    const x = ci * CELL + (r1 - 0.5) * CELL * 1.3;
    const z = cj * CELL + (hash(ci, cj, 2) - 0.5) * CELL * 1.3;
    let ok = Math.abs(x) <= WORLD_MAX_X - 16 && z >= WORLD_MIN_Z + 16 && z <= WORLD_MAX_Z - 16;
    if (ok) {
      const lush = groundLushnessAt(x, z, seed);
      const biomeDensity = GRASS_BIOME_DENSITY[zoneBiomeAt(x, z)] ?? 1;
      ok = r1 < (0.44 + 1.7 * lush * lush) * 1.05 * Math.min(biomeDensity, 1.2);
      if (ok) ok = roadDistance(x, z) > 2.4;
      if (ok) ok = !isInSowfieldShell(x, z);
      if (ok) ok = !insideGrassHubExclusion(getActiveWorldContent().zones, x, z);
      if (ok) {
        const h = terrainHeight(x, z, seed);
        ok = h > WATER_LEVEL + 1.4;
        if (ok) ok = Math.abs(terrainHeight(x + 0.9, z, seed) - h) < 0.55;
        if (ok) {
          const lushHere = 0.5 + lush * 0.6;
          let s = (0.22 + hash(ci, cj, 3) * 0.34) * lushHere;
          const rTuft = hash(ci, cj, 4);
          if (rTuft < 0.1) s *= 1.5 + rTuft * 3.0;
          q.setFromAxisAngle(up, r1 * 12.9);
          const rLean = hash(ci, cj, 5);
          leanAxis.set(Math.sin(rLean * 41.3), 0, Math.cos(rLean * 41.3));
          q.premultiply(qLean.setFromAxisAngle(leanAxis, rLean * 0.21));
          const hJit = 0.82 + hash(ci, cj, 6) * 0.36;
          m.compose(v.set(x, h - 0.02, z), q, sv.set(s, s * (0.85 + lush * 0.5) * hJit, s));
          groundGrassColorAt(x, z, seed, c);
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
      im.getMatrixAt(denseSlots.count, movedMatrix);
      im.setMatrixAt(removedDense, movedMatrix);
      im.getColorAt(denseSlots.count, movedColor);
      im.setColorAt(removedDense, movedColor);
      markDirty(removedDense);
    }
  }

  const colCi = new Int32Array(GRID_W);

  const scanTargetBlock = (baseI: number, baseJ: number, initialBudget: number): boolean => {
    for (let gi = 0; gi < GRID_W; gi++) {
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
    update(px: number, pz: number, bandFar: number, outdoor: boolean): void {
      group.visible = outdoor;
      if (!outdoor) return;
      uPlayerPos.value.set(px, pz);
      uBandFar.value = Math.min(RADIUS, Math.max(0, bandFar));
      const baseI = Math.floor(px / CELL) - (GRID_W >> 1);
      const baseJ = Math.floor(pz / CELL) - (GRID_W >> 1);
      if (baseI === lastBaseI && baseJ === lastBaseJ && !pending) return;
      lastBaseI = baseI;
      lastBaseJ = baseJ;
      dirtyLo = POOL;
      dirtyHi = -1;
      const previousCount = denseSlots.count;
      pending = scanTargetBlock(baseI, baseJ, MEADOW_BAND_PLACE_BUDGET);
      if (denseSlots.count !== previousCount) im.count = denseSlots.count;
      if (dirtyHi >= 0) {
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
