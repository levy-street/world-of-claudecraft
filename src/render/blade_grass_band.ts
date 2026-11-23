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
import {
  getActiveWorldContent,
  isBuiltinWorldActive,
  isBuiltinWorldContent,
  WORLD_MAX_X,
  WORLD_MAX_Z,
  WORLD_MIN_Z,
} from '../sim/data';
import { grassClearedAt } from '../sim/grass_clear';
import { roadDistance, terrainCutAtHeight, terrainHeight, zoneBiomeAt } from '../sim/world';
import { bladeSwayGlsl, clusterGeometry, clusterPlacementPad, mulberry32 } from './blade_grass';
import {
  activateDenseSlot,
  type DenseSlotState,
  deactivateDenseSlot,
} from './blade_grass_dense_core';
import { toroidalCell } from './blade_grass_pool_core';
import { buildBladeSectorPool } from './blade_grass_sector_pool';
import { GRASS_BIOME_DENSITY } from './foliage';
import {
  eastbrookGrassExclusions,
  insideAnyBuildingFootprint,
  insideEastbrookGrassExclusion,
  insideGrassHubExclusion,
  insidePavedGrassExclusion,
} from './foliage_core';
import { patchConstantUpNormalVertexShader } from './foliage_shader_core';
import { foliageShoreSkip } from './foliage_shore_gate_core';
import { GFX, sharedUniforms } from './gfx';
import {
  createGrassEdgeTaperContext,
  GRASS_HUB_INNER_RADIUS,
  GRASS_ROAD_INNER_RADIUS,
  grassEdgeCoverageScale,
  grassEdgeHeightScale,
  grassEdgeTaperAt,
  grassEdgeWidthScale,
} from './grass_edge_taper_core';
import { getGrassGroundBake } from './grass_ground_bake';
import {
  attachGrassInteractionUniforms,
  grassBladeInteractionGlsl,
} from './grass_interaction_core';
import {
  GRASS_PAINT_TRIM,
  MEADOW_BAND_BASE_RECOVER_Y,
  MEADOW_BAND_BASE_SINK,
  MEADOW_BAND_CELL,
  MEADOW_BAND_FADE_START,
  MEADOW_BAND_PLACE_BUDGET,
  MEADOW_BAND_RADIUS,
  MEADOW_CAMERA_CLEAR_FAR,
  MEADOW_CAMERA_CLEAR_NEAR,
  meadowClusterHeight,
  meadowClusterScale,
  meadowCoverage,
} from './meadow_tuning';
import { bladeSectorAxis, renderLayerDisabled } from './render_dev_flags';
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
  /** Palette lab: re-place every slot (same spots, fresh ground colour) over
   *  the next frames at the normal placement budget. Nothing hides meanwhile:
   *  a slot keeps its old tint until its turn. */
  recolor(): void;
}

// The live view, so the palette lab can recolour it without a renderer field
// (a graphics rebuild constructs a new one, which replaces this).
let liveView: BladeGrassBandView | null = null;
export function recolorLiveBladeGrassBandView(): void {
  liveView?.recolor();
}

export function buildBladeGrassBand(
  seed: number,
  initialPx: number,
  initialPz: number,
  forceEditorCarpet = false,
): BladeGrassBandView {
  const group = new THREE.Group();
  group.name = 'bladeGrassBand';
  // The band rides the carpet's own tier gate: tiers without the blade
  // carpet keep their existing look. ?meadowband=off is the dev
  // perf-attribution kill switch.
  const RADIUS = MEADOW_BAND_RADIUS;
  if ((GFX.bladeCarpetRadius <= 0 && !forceEditorCarpet) || renderLayerDisabled('meadowband')) {
    // A tier without the carpet still replaces the live view, so a rebuild
    // never keeps the old carpet's buffers reachable from here.
    liveView = { group, update: () => undefined, recolor: () => undefined };
    return liveView;
  }
  const CELL = MEADOW_BAND_CELL;
  const GRID_W = Math.ceil((RADIUS * 2) / CELL);
  const POOL = GRID_W * GRID_W;

  const rng = mulberry32(seed ^ 0x6b1a);
  const geo = clusterGeometry(rng, 2);
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
  // Resolved once at build, like the near carpet (bladeSwayGlsl).
  const classicSway = isBuiltinWorldActive();
  mat.customProgramCacheKey = () =>
    `${mat.onBeforeCompile.toString()}|blade-sway:${classicSway ? 'classic' : 'wind'}`;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = sharedUniforms.uTime;
    sh.uniforms.uPlayerPos = uPlayerPos;
    sh.uniforms.uBandFar = uBandFar;
    sh.uniforms.uBaseSink = uBaseSink;
    attachGrassInteractionUniforms(sh.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform vec2 uPlayerPos;
        uniform vec4 uGrassMove;
        uniform vec4 uGrassWake;
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
          // camera-near collapse: blades within a few yards of the eye shrink
          // to their roots, so a low chase camera never looks through a wall
          // of oversized near blades (the painted-meadow trick)
          transformed *= smoothstep(${MEADOW_CAMERA_CLEAR_NEAR.toFixed(1)}, ${MEADOW_CAMERA_CLEAR_FAR.toFixed(1)},
            distance(bgOrigin, cameraPosition));
          // the carpet's sway, shared: one meadow, one wind; branched around
          // once the fade has collapsed the blade
          ${bladeSwayGlsl(classicSway)}
          ${grassBladeInteractionGlsl()}
        #endif`,
      );
    sh.vertexShader = patchConstantUpNormalVertexShader(sh.vertexShader);
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      `#include <normal_fragment_begin>
      #ifdef DOUBLE_SIDED
        normal *= faceDirection;
      #endif`,
    );
  };

  // the carpet's sector split, verbatim: one mesh per sector of the slot grid,
  // all on this one geometry and material (blade_grass_sector_pool.ts)
  const sectorPool = buildBladeSectorPool({
    gridW: GRID_W,
    axis: bladeSectorAxis(),
    geometry: geo,
    material: mat,
    clusterPad: clusterPlacementPad(geo),
  });
  for (const mesh of sectorPool.meshes) group.add(mesh);

  // per-slot current cell (packed); 0x7fffffff = never placed
  const slotCell = new Int32Array(POOL).fill(0x7fffffff);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const qLean = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const leanAxis = new THREE.Vector3();
  const v = new THREE.Vector3();
  const sv = new THREE.Vector3();
  const c = new THREE.Color();

  const hash = (i: number, j: number, k: number): number => {
    let h = (i * 374761393 + j * 668265263 + k * 2246822519) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  const activeContent = getActiveWorldContent();
  const townExclusions = eastbrookGrassExclusions(
    activeContent.props.buildings,
    isBuiltinWorldContent(activeContent),
    activeContent.services?.noticeboards ?? [],
  );
  const edgeTaperCtx = createGrassEdgeTaperContext(
    activeContent.zones,
    townExclusions,
    activeContent.props.buildings,
    activeContent.grassClear,
  );

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
      const baseCoverage = meadowCoverage(lush) * Math.min(biomeDensity, 1.2);
      const rd = roadDistance(x, z);
      ok = r1 < baseCoverage;
      if (ok) ok = rd > GRASS_ROAD_INNER_RADIUS;
      // The maker's painted no-grass discs, same as the near carpet: a city
      // floor has to be clear in BOTH bands or the meadow reappears the moment
      // the player steps back from it.
      if (ok) ok = !grassClearedAt(activeContent.grassClear, x, z);
      if (ok) ok = !insideGrassHubExclusion(activeContent.zones, x, z, GRASS_HUB_INNER_RADIUS);
      if (ok) ok = !insidePavedGrassExclusion(x, z);
      if (ok) ok = !insideEastbrookGrassExclusion(townExclusions, x, z, 0.85);
      if (ok) ok = !insideAnyBuildingFootprint(activeContent.props.buildings, x, z, 0.85);
      if (ok) {
        const h = terrainHeight(x, z, seed);
        ok = !foliageShoreSkip(x, z, h, seed);
        // no band tufts floating over a boolean cut (mirrors the near carpet)
        if (ok) ok = !terrainCutAtHeight(x, z, h);
        if (ok) ok = Math.abs(terrainHeight(x + 0.9, z, seed) - h) < 0.55;
        if (ok) {
          const edgeTaper = grassEdgeTaperAt(edgeTaperCtx, x, z, rd);
          if (r1 < baseCoverage * grassEdgeCoverageScale(edgeTaper)) {
            const baseScale = meadowClusterScale(lush, hash(ci, cj, 3), hash(ci, cj, 4));
            const s = baseScale * grassEdgeWidthScale(edgeTaper);
            q.setFromAxisAngle(up, r1 * 12.9);
            const rLean = hash(ci, cj, 5);
            leanAxis.set(Math.sin(rLean * 41.3), 0, Math.cos(rLean * 41.3));
            q.premultiply(qLean.setFromAxisAngle(leanAxis, rLean * 0.21));
            const sy =
              meadowClusterHeight(baseScale, lush, hash(ci, cj, 6)) *
              grassEdgeHeightScale(edgeTaper);
            m.compose(v.set(x, h - 0.02, z), q, sv.set(s, sy, s));
            groundGrassColorAt(x, z, seed, c);
            c.multiplyScalar(1.18);
            sectorPool.place(slot, m, c);
            return;
          }
        }
      }
    }
    sectorPool.remove(slot);
  }

  const colCi = new Int32Array(GRID_W);

  const scanTargetBlock = (baseI: number, baseJ: number, initialBudget: number): boolean => {
    for (let gi = 0; gi < GRID_W; gi++) {
      colCi[gi] = toroidalCell(baseI, gi, GRID_W);
    }
    let budget = initialBudget;
    for (let gj = 0; gj < GRID_W && budget > 0; gj++) {
      const cjj = toroidalCell(baseJ, gj, GRID_W);
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
  // Three.js uploads each full attribute on its first draw, so the initial
  // prefix needs its counts and bounds published but no update ranges.
  sectorPool.dropUploads();
  sectorPool.syncSectors();
  let lastBaseI = initialBaseI;
  let lastBaseJ = initialBaseJ;
  let pending = false;
  let fastRefill = false;

  const view: BladeGrassBandView = {
    group,
    recolor(): void {
      slotCell.fill(0x7fffffff);
      pending = true;
    },
    update(px: number, pz: number, bandFar: number, outdoor: boolean): void {
      group.visible = outdoor;
      if (!outdoor) return;
      uPlayerPos.value.set(px, pz);
      uBandFar.value = Math.min(RADIUS, Math.max(0, bandFar));
      const baseI = Math.floor(px / CELL) - (GRID_W >> 1);
      const baseJ = Math.floor(pz / CELL) - (GRID_W >> 1);
      if (baseI === lastBaseI && baseJ === lastBaseJ && !pending) return;
      if (Math.abs(baseI - lastBaseI) >= GRID_W || Math.abs(baseJ - lastBaseJ) >= GRID_W) {
        fastRefill = true;
      }
      lastBaseI = baseI;
      lastBaseJ = baseJ;
      // re-placed slots this frame. Ranges are queued per sector, never
      // cleared here: the renderer clears them after it actually uploads, so
      // a skipped frame keeps its pending spans alive.
      const budget = fastRefill
        ? Math.max(MEADOW_BAND_PLACE_BUDGET, Math.ceil(POOL / 4))
        : MEADOW_BAND_PLACE_BUDGET;
      pending = scanTargetBlock(baseI, baseJ, budget);
      if (!pending) fastRefill = false;
      sectorPool.queueUploads();
      sectorPool.syncSectors();
    },
  };
  liveView = view;
  return view;
}
