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
import {
  patchConstantUpNormalVertexShader,
  patchGrassShadeLiftFragment,
} from './foliage_shader_core';
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
  meadowScopedEdgeTaper,
} from './grass_edge_taper_core';
import {
  attachGrassInteractionUniforms,
  grassBladeInteractionGlsl,
  stepSharedGrassInteraction,
} from './grass_interaction_core';
import { MEADOW_MAX_STRETCH } from './meadow_fullness_core';
import {
  applyMeadowPatchTint,
  MEADOW_PATCH_MAX_STRETCH,
  meadowPatchContext,
  meadowPatchGrows,
} from './meadow_patch_core';
import {
  MEADOW_CAMERA_CLEAR_FAR,
  MEADOW_CAMERA_CLEAR_NEAR,
  MEADOW_CARPET_FADE_START,
  meadowClusterHeight,
  meadowClusterScale,
  meadowCoverage,
} from './meadow_tuning';
import { paletteLabPanelEnabled } from './palette_lab';
import { bladeSectorAxis, renderLayerDisabled } from './render_dev_flags';
import { groundGrassColorAt, groundLushnessAt } from './terrain_chunk_build';
import { GRASS_WIND_TIME_SCALE } from './tree_sway';

// Near-field blade carpet: a single InstancedMesh of low-poly SOLID grass
// clusters riding a toroidal grid around the player. The card-tuft system in
// foliage.ts owns the mid/far field. Its crossed alpha cards read fine at
// range but resolve into "scattered 3D models" up close, which is exactly
// where this carpet takes over: thousands of small individually-swaying
// blades, dense on the lush soil patches and absent between them, tinted by
// the ground colour under each cluster so the meadow reads as one grown
// surface. Solid geometry (no alphaTest) keeps the cozy low-poly art style.
//
// The pool draws as a grid of sector meshes over one geometry and one
// material (blade_grass_sector_pool.ts), so three can drop the sectors behind
// the camera instead of vertex-shading the whole disc every frame.
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
  /** Palette lab: re-place every slot (same spots, fresh ground colour) over
   *  the next frames at the normal placement budget. Nothing hides meanwhile:
   *  a slot keeps its old tint until its turn. */
  recolor(): void;
}

// The live view, so the palette lab can recolour it without a renderer field
// (a graphics rebuild constructs a new one, which replaces this).
let liveView: BladeGrassView | null = null;
export function recolorLiveBladeGrassView(): void {
  liveView?.recolor();
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
export function clusterGeometry(rng: () => number, segments: 2 | 3 = 3): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const BLADES = 9;
  for (let b = 0; b < BLADES; b++) {
    // even fan for coverage, jittered so blades overlap into a lush patch clump
    const yaw = (b / BLADES) * Math.PI * 2 + (rng() - 0.5) * 1.4;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const ox = (rng() - 0.5) * 0.26;
    const oz = (rng() - 0.5) * 0.26;
    // each blade leaves the ground at its own angle: a base tilt plus a graceful
    // outward bow so the 9 wide ribbons fountain into a cohesive Genshin patch
    const tilt = 0.08 + rng() * 0.36;
    const bow = 0.12 + rng() * 0.42;
    const len = 0.58 + rng() * 0.52;
    const w0 = 0.095 + rng() * 0.045;
    const w1 = w0 * 0.74;
    const w2 = w0 * 0.42;
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
    if (segments === 2) {
      const wMid = w0 * 0.62;
      put(-w0, 0, 0.86);
      put(w0, 0, 0.86);
      put(-wMid, 0.56, 0.98);
      put(wMid, 0.56, 0.98);
      put(0, 1.0, 1.1);
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
      );
    } else {
      put(-w0, 0, 0.86);
      put(w0, 0, 0.86);
      put(-w1, 0.45, 0.95);
      put(w1, 0.45, 0.95);
      put(-w2, 0.78, 1.03);
      put(w2, 0.78, 1.03);
      put(0, 1.0, 1.1);
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
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  geo.setIndex(indices);
  return geo;
}

// Largest scale placeSlot can compose for one cluster: the 0.56 base spread
// times the 1.1 lushness ceiling, the 1.8 tuft size class, and the 1.59
// vertical spread, rounded up. Used to bound how far a cluster reaches beyond
// its instance origin, never to place one.
const CLUSTER_MAX_SCALE = 1.8;
// Local-space reach of the shader's sway at a blade tip (bladeSwayGlsl), which
// rides inside the same instance scale: amplitude 0.085 across the two sine
// terms (1 + 0.4) at 0.6 plus the rolling wave's 0.2 + 0.9, times the 1.25
// variance ceiling, weighted by position.y squared (a blade reaches
// y = 0.55 + 0.55), along a unit wind direction.
const CLUSTER_SWAY_REACH = 0.085 * ((1 + 0.4) * 0.6 + 0.2 + 0.9) * 1.25 * (1.1 * 1.1);

/**
 * World-space slack a placed cluster reaches beyond its instance origin: the
 * cluster geometry's own vertex radius plus the sway, at the largest scale
 * placement composes. The sector bounding spheres pad by this, so a sector is
 * culled only when every blade in it is genuinely outside the frustum.
 */
export function clusterPlacementPad(geo: THREE.BufferGeometry): number {
  const pos = geo.getAttribute('position');
  let maxSq = 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const d = x * x + y * y + z * z;
    if (d > maxSq) maxSq = d;
  }
  // A palette-lab panel session may stretch clusters up to MEADOW_MAX_STRETCH.
  const labReach = paletteLabPanelEnabled() ? MEADOW_MAX_STRETCH : 1;
  return (Math.sqrt(maxSq) + CLUSTER_SWAY_REACH) * CLUSTER_MAX_SCALE * labReach;
}

/**
 * Per-blade sway, shared by the carpet and the far band (blade_grass_band.ts)
 * so the meadow has one wind across their seam. Needs `bgOrigin` (the cluster's
 * world origin) and `bgFade` (its scale-collapse fade) in scope. Runs only
 * while the blade is visible: where the fade has collapsed it the block is
 * branched around (SPACEY, 2026-09-24: "only when they are visiable").
 */
export function bladeSwayGlsl(classic = false): string {
  // The built-in world keeps the sway it shipped with: one clock, no rolling
  // wave or per-cluster variance, a fixed x/z lean, always on.
  if (classic) {
    return `
          float bgPhase = bgOrigin.x * 1.7 + bgOrigin.z * 2.3;
          float bgSway = (sin(uTime * 2.1 + bgPhase) + 0.4 * sin(uTime * 3.7 + bgPhase * 1.31))
            * 0.085 * position.y * position.y;
          transformed.x += bgSway;
          transformed.z += bgSway * 0.7;`;
  }
  return `
          if (bgFade > 0.0) {
            // weighted by height squared so roots stay planted; phase from the
            // instance origin desynchronises neighbours
            float bgPhase = bgOrigin.x * 1.7 + bgOrigin.z * 2.3;
            // the slowed grass clock (SPACEY, 2026-09-24: "slow the animations
            // down by 30%", then "another 30%")
            float bgT = uTime * ${GRASS_WIND_TIME_SCALE.toFixed(4)};
            // a rolling gust band sweeps the field (world-position phase), so
            // patches downwind lean in turn instead of every blade shivering in
            // place; per-cluster amplitude varies 0.75-1.25 from a cheap hash
            // (SPACEY, 2026-09-24: "really nice animation with some variance")
            float bgWave = 0.5 + 0.5 * sin(bgOrigin.x * 0.14 + bgOrigin.z * 0.09 - bgT * 1.9);
            float bgVar = 0.75 + 0.5 * fract(sin(bgPhase * 12.9898) * 43758.5453);
            float bgSway = ((sin(bgT * 2.1 + bgPhase) + 0.4 * sin(bgT * 3.7 + bgPhase * 1.31)) * 0.6
                + (0.2 + 0.9 * bgWave * bgWave))
              * 0.085 * bgVar * position.y * position.y;
            // one WORLD wind direction brought into each cluster's own frame
            // (they are yawed at random), so a gust leans a patch coherently
            vec3 bgWD = normalize(vec3(0.83, 0.0, 0.55) * mat3(instanceMatrix));
            transformed += bgWD * bgSway;
          }`;
}

export function buildBladeGrass(
  seed: number,
  initialPx: number,
  initialPz: number,
  forceEditorCarpet = false,
): BladeGrassView {
  const group = new THREE.Group();
  group.name = 'bladeGrass';
  // The carpet is a close-camera read and one of the graphics-overhaul detail
  // layers: high runs a 24u recovery ring, ultra and insane run the full 34u
  // ring, and tiers below high keep only the card-tuft field. The Advanced
  // Foliage Density dial maps onto the same radius knob.
  // ?bladegrass=off is the dev-only perf-attribution kill switch
  // (render_dev_flags.ts).
  const RADIUS = GFX.bladeCarpetRadius > 0 ? GFX.bladeCarpetRadius : forceEditorCarpet ? 34 : 0;
  if (RADIUS <= 0 || renderLayerDisabled('bladegrass')) {
    // A tier without the carpet still replaces the live view, so a rebuild
    // never keeps the old carpet's buffers reachable from here.
    liveView = {
      group,
      update: (px: number, pz: number) =>
        stepSharedGrassInteraction(px, pz, sharedUniforms.uTime.value),
      recolor: () => undefined,
    };
    return liveView;
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
  // Resolved once at build: a content swap rebuilds the carpet.
  const classicSway = isBuiltinWorldActive();
  // The sway variant is chosen in JS, so name it in the program key (three's
  // default key is the hook source, identical for both variants).
  mat.customProgramCacheKey = () =>
    `${mat.onBeforeCompile.toString()}|blade-sway:${classicSway ? 'classic' : 'wind'}`;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = sharedUniforms.uTime;
    sh.uniforms.uPlayerPos = uPlayerPos;
    attachGrassInteractionUniforms(sh.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform vec2 uPlayerPos;
        uniform vec4 uGrassMove;
        uniform vec4 uGrassWake;`,
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
          // camera-near collapse: blades within a few yards of the eye shrink
          // to their roots, so a low chase camera never looks through a wall
          // of oversized near blades (the painted-meadow trick)
          transformed *= smoothstep(${MEADOW_CAMERA_CLEAR_NEAR.toFixed(1)}, ${MEADOW_CAMERA_CLEAR_FAR.toFixed(1)},
            distance(bgOrigin, cameraPosition));
          ${bladeSwayGlsl(classicSway)}
          ${grassBladeInteractionGlsl()}
        #endif`,
      );
    sh.vertexShader = patchConstantUpNormalVertexShader(sh.vertexShader);
    sh.fragmentShader = patchGrassShadeLiftFragment(
      sh.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
      #ifdef DOUBLE_SIDED
        normal *= faceDirection;
      #endif`,
      ),
    );
  };
  const uPlayerPos = { value: new THREE.Vector2(1e9, 1e9) };

  const activeContent = getActiveWorldContent();
  // The Eastbrook meadow's clumps, drifts and edge growth (meadow_patch_core.ts):
  // one context per world, shared with the band and the card tufts, and the
  // stock carpet everywhere outside its scope.
  const meadowPatch = meadowPatchContext(seed, activeContent);
  const patch = meadowPatch.sample;

  // One mesh per sector instead of one uncullable pool mesh: every sector
  // shares this geometry and material, so the split adds draw calls and no
  // program, and three drops the sectors behind the camera
  // (blade_grass_sector_pool.ts). ?bladesectors=1 restores the single mesh.
  const sectorPool = buildBladeSectorPool({
    gridW: GRID_W,
    axis: bladeSectorAxis(),
    geometry: geo,
    material: mat,
    // a patch clump may stand taller than the stock crop: widen the cull bound
    clusterPad: clusterPlacementPad(geo) * (meadowPatch.scope ? MEADOW_PATCH_MAX_STRETCH : 1),
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
      const baseCoverage = meadowCoverage(lush) * Math.min(biomeDensity, 1.2);
      const rd = roadDistance(x, z);
      // higher floor + gain than the tufts: coverage is the carpet's job,
      // the patch structure just modulates it
      ok = r1 < baseCoverage;
      if (ok) ok = rd > GRASS_ROAD_INNER_RADIUS;
      // the meadow patch keeps most open Eastbrook ground bare before any
      // terrain sample is paid (its own salt, so the gate never tracks r1)
      if (ok) ok = meadowPatchGrows(meadowPatch, x, z, rd, hash(ci, cj, 7));
      // The maker's painted no-grass discs (sim/grass_clear.ts). They had a
      // spatial index, a document field, an editor brush and a sanitizer, and
      // no consumer anywhere in the render, so a paved plaza still grew a
      // meadow through it. This is that consumer: the blade carpet is what
      // actually shows on a city floor.
      if (ok) ok = !grassClearedAt(activeContent.grassClear, x, z);
      if (ok) ok = !insideGrassHubExclusion(activeContent.zones, x, z, GRASS_HUB_INNER_RADIUS);
      if (ok) ok = !insidePavedGrassExclusion(x, z);
      if (ok) ok = !insideEastbrookGrassExclusion(townExclusions, x, z, 0.85);
      if (ok) ok = !insideAnyBuildingFootprint(activeContent.props.buildings, x, z, 0.85);
      if (ok) {
        const h = terrainHeight(x, z, seed);
        ok = !foliageShoreSkip(x, z, h, seed);
        // a boolean cut removes the ground sheet: no carpet floating over the
        // opening (same evaluator the mesher drops quads with)
        if (ok) ok = !terrainCutAtHeight(x, z, h);
        // keep the carpet off banks: the same slope band where the terrain
        // shader fades its relief (planar smear territory)
        if (ok) ok = Math.abs(terrainHeight(x + 0.9, z, seed) - h) < 0.55;
        if (ok) {
          // inside the meadow patch its edge profile replaces the stock taper
          const edgeTaper = meadowScopedEdgeTaper(
            patch.scope,
            grassEdgeTaperAt(edgeTaperCtx, x, z, rd),
          );
          if (r1 < baseCoverage * grassEdgeCoverageScale(edgeTaper)) {
            const baseScale = meadowClusterScale(lush, hash(ci, cj, 3), hash(ci, cj, 4));
            const s = baseScale * grassEdgeWidthScale(edgeTaper) * patch.width;
            q.setFromAxisAngle(up, r1 * 12.9);
            // whole-cluster lean, a hashed direction and up to ~12 degrees
            // (further inside the patch): neighbouring tufts tip different
            // ways instead of standing in a uniform vertical crop
            const rLean = hash(ci, cj, 5);
            leanAxis.set(Math.sin(rLean * 41.3), 0, Math.cos(rLean * 41.3));
            q.premultiply(qLean.setFromAxisAngle(leanAxis, rLean * 0.21 * patch.lean));
            const sy =
              meadowClusterHeight(baseScale, lush, hash(ci, cj, 6)) *
              grassEdgeHeightScale(edgeTaper) *
              patch.height;
            m.compose(v.set(x, h - 0.02, z), q, sv.set(s, sy, s));
            groundGrassColorAt(x, z, seed, c);
            // slight lift over the raw ground tint: blades catch more sky
            // than the soil they stand on
            c.multiplyScalar(1.18);
            // the clump's sunlit or shaded lean (unit outside the patch)
            applyMeadowPatchTint(patch, c);
            sectorPool.place(slot, m, c);
            return;
          }
        }
      }
    }
    sectorPool.remove(slot);
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

  // Build the first dense prefix before the mesh reaches the renderer. Three.js
  // uploads each full attribute on its first draw, so no needsUpdate edge or
  // per-frame backfill is required for this placement.
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

  const view: BladeGrassView = {
    group,
    recolor(): void {
      slotCell.fill(0x7fffffff);
      pending = true;
    },
    update(px: number, pz: number): void {
      uPlayerPos.value.set(px, pz);
      stepSharedGrassInteraction(px, pz, sharedUniforms.uTime.value);
      // target cell block: the GRID_W x GRID_W square centred on the player
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
      const budget = fastRefill ? Math.max(PLACE_BUDGET, Math.ceil(POOL / 4)) : PLACE_BUDGET;
      pending = scanTargetBlock(baseI, baseJ, budget);
      if (!pending) fastRefill = false;
      sectorPool.queueUploads();
      sectorPool.syncSectors();
    },
  };
  liveView = view;
  return view;
}
