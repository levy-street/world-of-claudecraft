// The Anvil of the World's four quarters (phases 2K and 2L, design doc
// section 5.21): the Heart kit's quarter floors, ridges and dais placed on the
// platform, each with its own light, and the quarter the Masterless Strength
// stands in awake (heart_quarters_core.ts steps the state; the shaders are
// heart_quarters_glsl.ts):
//   - the awake quarter's cracks, scorings, veins and fissures ignite in its
//     own colour (HEART_QUARTER_PALETTE), the flood running out of the
//     central ring to the rim with a bright front, its light washed over the
//     stones (a floor mark on the ground rung), its element rising off it in
//     layers: the Hammer's floating grit, its tremor's chips and dust bursts;
//     the Breath's dust devils, wind streaks and ground veils; the Quench's
//     frost mist, rising rime, crystal growing along its veins and its ice
//     lit from inside; the Heat's embers, heat haze, flames licking out of
//     its fissures and the lava pulses running out along them (the Heat
//     smoulders red even asleep);
//   - the ridges bordering it glow, the other three quarters go dark (a
//     faint glow left in their seams, so the room still reads as four);
//   - a crossing drains the old quarter back into the ring (a pulse through
//     the dais) and floods the new one out of it, a shockwave racing along
//     the ridge the boss crossed, its curtain flaring tall, throwing sparks
//     and bursts of dust;
//   - in the ring in its final phase all four wake and the ring blazes: the
//     dais's crystal, a column of its light, motes of the four veins
//     spiralling up; in the ring otherwise no quarter wakes.
// The ridges' spines draw after the floors with no depth write
// (HEART_PLATFORM_ORDER), so a floor telegraph always shows over a spine.
// Gameplay-neutral at every tier: the seams, the floods, the ridges, the
// shockwave, the washes and the ring draw on every tier (which quarter is
// awake is never shed); the low tier keeps a share of the cosmetic air.
//
// GPU preparation: built with the interior (the compile gate links every
// material, hidden or not); the kit's stone, spine and ice slots draw with the
// kit's shared slot materials (their warmers ride every kit group); no light;
// no texture; the per-frame update writes uniforms only (no allocation).

import * as THREE from 'three';
import {
  HEART_ROOM,
  SMITH_HEART_VEINS,
  type SmithHeartVein,
} from '../../sim/content/smith_heart_layout';
import {
  HEART_QUARTER_ORDER,
  HEART_QUARTERS,
  heartQuarterRidges,
  heartRidgeBearingDeg,
} from '../../sim/content/smith_heart_quarters';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { sharedUniforms } from '../gfx';
import { type HeartAirV3, type HeartAirV4, heartQuadGeometry } from './heart_air_quads';
import { heartFloorMaterial } from './heart_floor';
import {
  heartKitMeshes,
  heartKitPiece,
  heartKitSlotMaterial,
  SMITH_HEART_HEART_KIT_URL,
} from './heart_kit';
import { buildHeartLandmarks, heartMaterialCarriers } from './heart_landmarks';
import { heartLandmarkLit } from './heart_landmarks_core';
import { WELL_VERT, wellFrag } from './heart_landmarks_glsl';
import { heartHash } from './heart_plan_core';
import {
  HEART_PLATFORM_ORDER,
  HEART_QUARTER_AIR,
  HEART_QUARTER_PALETTE,
  HEART_RING_LOOK,
  heartQuarterBoss,
  heartQuarterCount,
  heartQuarterLit,
  heartQuarterSeeds,
  heartRidgeNeighbours,
  heartRidgeSparkSeeds,
  newHeartQuartersState,
  stepHeartQuarters,
} from './heart_quarters_core';
import {
  BLAZE_VERT,
  BREATH_DEVIL_VERT,
  BREATH_SHEET_VERT,
  BREATH_STREAK_VERT,
  CRYSTAL_FRAG,
  CRYSTAL_VERT,
  CURTAIN_FRAG,
  CURTAIN_VERT,
  DAIS_GLOW_FRAG,
  HAMMER_CHIP_VERT,
  HAMMER_DUST_VERT,
  HAMMER_GRIT_VERT,
  HEAT_EMBER_VERT,
  HEAT_FLAME_VERT,
  HEAT_GLOW_VERT,
  KIT_GLOW_VERT,
  MOTE_FRAG,
  QUENCH_FROST_VERT,
  QUENCH_MIST_VERT,
  quarterGlowFrag,
  RIDGE_DUST_VERT,
  RIDGE_GLOW_FRAG,
  RIDGE_SPARK_VERT,
  SHADE_FRAG,
  WASH_VERT,
  washFrag,
} from './heart_quarters_glsl';
import { buildHeartRingColumn } from './heart_ring_column';
import { buildHeartSurround } from './heart_surround';

/** Each quarter's kit piece. */
export const HEART_QUARTER_PIECES: Readonly<Record<SmithHeartVein, string>> = {
  hammer: 'Kit_QuarterHammer',
  breath: 'Kit_QuarterBreath',
  quench: 'Kit_QuarterQuench',
  heat: 'Kit_QuarterHeat',
};
/** A ridge's spine on the walk and its horn past the rim (one of each,
 *  turned a quarter per ridge). */
export const HEART_RIDGE_PIECES = { spine: 'Kit_HeartRidge', horn: 'Kit_HeartRidgeHorn' } as const;

/** The faint white-gold of the heart a ridge glows with when neither of its
 *  quarters is awake. */
const HEART_GOLD = 0xffd690;
/** A spine's foot either side of its line (the washes stop short of it). */
const SPINE_HALF = 2.1;

export interface HeartQuarters {
  group: THREE.Group;
  /** Step the room's light for slot `key` at render time `now` (`dt` since
   *  the last frame), the heart `dark` (0 burning, 1 dark: the boss fell). */
  update(key: string, now: number, dt: number, dark: number): void;
}

function glowMaterial(name: string, frag: string, uniforms: Record<string, THREE.IUniform>) {
  return new THREE.ShaderMaterial({
    name,
    vertexColors: true,
    fog: false,
    toneMapped: false,
    uniforms: { uTime: sharedUniforms.uTime, uDark: { value: 0 }, ...uniforms },
    vertexShader: KIT_GLOW_VERT,
    fragmentShader: frag,
  });
}

function airMaterial(
  name: string,
  vert: string,
  color: number,
  hot: number,
  alpha: number,
  uniforms: Record<string, THREE.IUniform> = {},
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name,
    uniforms: {
      uTime: sharedUniforms.uTime,
      uLit: { value: 0 },
      uFront: { value: HEART_QUARTERS.ringR },
      uColor: { value: new THREE.Color(color) },
      uHotColor: { value: new THREE.Color(hot) },
      uAlpha: { value: alpha },
      ...uniforms,
    },
    vertexShader: vert,
    fragmentShader: MOTE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/** The air's bounds, room-local: the platform and the air over it. */
const AIR_BOUNDS = new THREE.Sphere(new THREE.Vector3(0, 10, 0), HEART_QUARTERS.rimR + 16);

/** Room-local quads (position = base point) over the room's bounds. */
function quads(
  bases: HeartAirV3[],
  params: HeartAirV4[],
  others?: HeartAirV3[],
): THREE.BufferGeometry {
  const g = heartQuadGeometry(bases, params, others);
  g.boundingSphere = AIR_BOUNDS.clone();
  return g;
}

/** Points along a quarter's glowing marks (its kit glow slot laid on the
 *  stones, never the fire's bed under them), room-local. */
function seamPoints(vein: SmithHeartVein, n: number, salt = 0): HeartAirV3[] {
  const geo = heartKitPiece(SMITH_HEART_HEART_KIT_URL, HEART_QUARTER_PIECES[vein])?.glow;
  const pos = geo?.getAttribute('position');
  const out: HeartAirV3[] = [];
  if (!pos) return out;
  const cand: number[] = [];
  const col = geo?.getAttribute('color');
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) <= 0.01) continue;
    // Not the border light (its green tag): the crackle alone.
    if (col && col.getY(i) - col.getX(i) > 0.2) continue;
    cand.push(i);
  }
  if (cand.length === 0) return out;
  for (let k = 0; k < n; k++) {
    const i = cand[Math.floor(((k * 0.6180339887 + 0.137 + salt * 0.31) % 1) * cand.length)];
    out.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
  }
  return out;
}

/** Points along the Heat's fire (its glow slot under the fissures). */
function firePoints(n: number, salt: number): HeartAirV3[] {
  const geo = heartKitPiece(SMITH_HEART_HEART_KIT_URL, HEART_QUARTER_PIECES.heat)?.glow;
  const pos = geo?.getAttribute('position');
  const out: HeartAirV3[] = [];
  if (!pos) return out;
  const cand: number[] = [];
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) < 0) cand.push(i);
  if (cand.length === 0) return out;
  for (let k = 0; k < n; k++) {
    const i = cand[Math.floor(((k * 0.7548776662 + 0.29 + salt * 0.17) % 1) * cand.length)];
    out.push([pos.getX(i), 0, pos.getZ(i)]);
  }
  return out;
}

const local = (x: number, z: number): HeartAirV3 => [x - HEART_ROOM.x, 0, z - HEART_ROOM.z];

/** The light washed over a quarter: a grid over its unwound sector, its
 *  edge faded toward the ridges and the rim (`aEdge`). */
function washGeometry(
  vein: SmithHeartVein,
  inset = SPINE_HALF + 0.3,
  y = 0.06,
): THREE.BufferGeometry {
  const { ringR, rimR } = HEART_QUARTERS;
  const [ka, kb] = heartQuarterRidges(vein);
  const rows: number[] = [];
  for (let r = ringR + 0.4; r < rimR; r += 1.4) rows.push(r);
  rows.push(rimR - 0.2);
  const cols = 20;
  const pos: number[] = [];
  const edge: number[] = [];
  for (const r of rows) {
    const ba = heartRidgeBearingDeg(ka, r);
    const span = (((heartRidgeBearingDeg(kb, r) - ba) % 360) + 360) % 360;
    const ins = (inset / r) * (180 / Math.PI);
    for (let c = 0; c <= cols; c++) {
      const t = c / cols;
      const b = ((ba + ins + (span - 2 * ins) * t) * Math.PI) / 180;
      pos.push(Math.sin(b) * r, y, Math.cos(b) * r);
      const side = Math.min(1, Math.min(t, 1 - t) * 6);
      const ends = Math.min(1, (rimR - r) / 2.5, (r - ringR) / 1.5);
      edge.push(Math.max(0, side * ends));
    }
  }
  const idx: number[] = [];
  for (let a = 0; a < rows.length - 1; a++)
    for (let c = 0; c < cols; c++) {
      const i = a * (cols + 1) + c;
      idx.push(i, i + cols + 1, i + 1, i + 1, i + cols + 1, i + cols + 2);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** A ridge's curtain of light: a ribbon standing on its line from the ring
 *  to the rim (`aV` 0 at its foot, 1 at its top; `aR` the radius). */
function curtainGeometry(k: number): THREE.BufferGeometry {
  const { ringR, rimR } = HEART_QUARTERS;
  const pos: number[] = [];
  const v: number[] = [];
  const rr: number[] = [];
  const steps = 64;
  for (let i = 0; i <= steps; i++) {
    const r = ringR + 0.2 + ((rimR - ringR - 0.4) * i) / steps;
    const b = (heartRidgeBearingDeg(k, r) * Math.PI) / 180;
    for (const t of [0, 1]) {
      pos.push(Math.sin(b) * r, 0, Math.cos(b) * r);
      v.push(t);
      rr.push(r);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < steps; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aV', new THREE.Float32BufferAttribute(v, 1));
  g.setAttribute('aR', new THREE.Float32BufferAttribute(rr, 1));
  g.setIndex(idx);
  g.boundingSphere = AIR_BOUNDS.clone();
  return g;
}

interface QuarterRig {
  glow: THREE.ShaderMaterial;
  wash: THREE.ShaderMaterial;
  shade: THREE.ShaderMaterial;
  air: THREE.ShaderMaterial[];
}

interface RidgeRig {
  glows: THREE.ShaderMaterial[];
  shocks: THREE.ShaderMaterial[];
  curtain: THREE.ShaderMaterial;
  color: THREE.Color;
}

/** The wind's direction at radius `r` of the Breath (along the pinwheel's
 *  spiral, outward), room-local. */
function windDir(r: number): HeartAirV3 {
  const kb = heartQuarterRidges('breath')[1];
  const b0 = (heartRidgeBearingDeg(kb, r) * Math.PI) / 180;
  const b1 = (heartRidgeBearingDeg(kb, r + 1) * Math.PI) / 180;
  const dx = Math.sin(b1) * (r + 1) - Math.sin(b0) * r;
  const dz = Math.cos(b1) * (r + 1) - Math.cos(b0) * r;
  const l = Math.hypot(dx, dz) || 1;
  return [dx / l, 0, dz / l];
}

/** The quarters dressed and their light (instance-local). Needs the Heart
 *  kit (the interior builds this only once it has landed). */
export function buildHeartQuarters(lowGfx: boolean): HeartQuarters {
  const group = new THREE.Group();
  group.name = 'smithHeartQuarters';
  const centre = new THREE.Vector3(HEART_ROOM.x, HEART_ROOM.h, HEART_ROOM.z);
  const n = (k: number) => heartQuarterCount(k, lowGfx);
  const rigs = new Map<SmithHeartVein, QuarterRig>();
  const A = HEART_QUARTER_AIR;
  const P = HEART_QUARTER_PALETTE;

  // ---- the quarters' floors, their washes and their air ------------------------------------
  for (const vein of SMITH_HEART_VEINS) {
    const glow = glowMaterial(`smithHeartQuarterGlow:${vein}`, quarterGlowFrag(vein), {
      uColor: { value: new THREE.Color(P[vein].color) },
      uHot: { value: new THREE.Color(P[vein].hot) },
      uBase: { value: 0 },
      uIdle: { value: 0 },
      uAwake: { value: 0 },
      uFront: { value: HEART_QUARTERS.ringR },
      uGain: { value: P[vein].seams },
    });
    const floor = heartKitMeshes(SMITH_HEART_HEART_KIT_URL, HEART_QUARTER_PIECES[vein]);
    if (floor) {
      floor.name = `${HEART_QUARTER_PIECES[vein]}:${vein}`;
      floor.position.copy(centre);
      for (const m of floor.children) {
        if (!(m instanceof THREE.Mesh)) continue;
        if (m.name.endsWith(':glow')) m.material = glow;
        // Phase 2N: the slabs, joints, wear and soot painted on the sheet.
        if (m.name.endsWith(':stone')) m.material = heartFloorMaterial(lowGfx);
        // A floor a breath over the walk casts nothing worth a shadow.
        m.castShadow = false;
        m.renderOrder = HEART_PLATFORM_ORDER.floor;
      }
      group.add(floor);
    }
    const wash = new THREE.ShaderMaterial({
      name: `smithHeartQuarterWash:${vein}`,
      uniforms: {
        uTime: sharedUniforms.uTime,
        uColor: { value: new THREE.Color(P[vein].color) },
        uAwake: { value: 0 },
        uFront: { value: HEART_QUARTERS.ringR },
        uGain: { value: P[vein].wash },
        uDark: { value: 0 },
      },
      vertexShader: WASH_VERT,
      fragmentShader: washFrag(vein),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    const washMesh = new THREE.Mesh(washGeometry(vein), wash);
    washMesh.position.copy(centre);
    washMesh.renderOrder = floorVfxRenderOrder('ground', 4);
    washMesh.name = `heartQuarterWash:${vein}`;
    group.add(washMesh);
    // The shade: a dormant quarter's stones dimmed (a multiply mark under
    // the wash), lifted inside the flood; it stops at the spine's foot.
    const shade = new THREE.ShaderMaterial({
      name: `smithHeartQuarterShade:${vein}`,
      uniforms: {
        uShade: { value: 1 },
        uAwake: { value: 0 },
        uFront: { value: HEART_QUARTERS.ringR },
      },
      vertexShader: WASH_VERT,
      fragmentShader: SHADE_FRAG,
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
      blending: THREE.MultiplyBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    const shadeMesh = new THREE.Mesh(washGeometry(vein, SPINE_HALF - 0.4, 0.055), shade);
    shadeMesh.position.copy(centre);
    shadeMesh.renderOrder = floorVfxRenderOrder('ground', 3);
    shadeMesh.name = `heartQuarterShade:${vein}`;
    group.add(shadeMesh);
    rigs.set(vein, { glow, wash, shade, air: [] });
  }
  const rig = (v: SmithHeartVein) => rigs.get(v) as QuarterRig;
  const addAir = (
    vein: SmithHeartVein,
    name: string,
    geo: THREE.BufferGeometry,
    mat: THREE.ShaderMaterial,
  ) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(centre);
    mesh.name = name;
    group.add(mesh);
    rig(vein).air.push(mat);
  };
  const seedQuads = (
    vein: SmithHeartVein,
    count: number,
    salt: number,
    params: (h: readonly number[], i: number) => HeartAirV4,
  ) => {
    const seeds = heartQuarterSeeds(vein, count, salt);
    return quads(
      seeds.map((s) => local(s.x, s.z)),
      seeds.map((s, i) => params(s.h, i)),
    );
  };
  // The Hammer: grit floating up off the blocks, chips and dust bursts as
  // each tremor runs out.
  addAir(
    'hammer',
    'heartQuarterGrit:hammer',
    seedQuads('hammer', n(A.hammer.grit), 1, (h) => [h[0], h[1], 0.6 + h[2] * 0.8, h[3]]),
    airMaterial('smithHeartQuarterGrit', HAMMER_GRIT_VERT, 0xd8a050, 0xfff2cc, 1),
  );
  addAir(
    'hammer',
    'heartQuarterStones:hammer',
    seedQuads('hammer', n(A.hammer.stones), 7, (h) => [
      h[0],
      0.8 + h[1],
      0.25 + h[2] * 0.3,
      0.5 + h[3] * 0.5,
    ]),
    airMaterial('smithHeartQuarterStones', HAMMER_GRIT_VERT, 0xb07a3a, 0xffd890, 0.85),
  );
  addAir(
    'hammer',
    'heartQuarterChips:hammer',
    seedQuads('hammer', n(A.hammer.chips), 8, (h) => [h[0], h[1], h[2], h[3]]),
    airMaterial('smithHeartQuarterChips', HAMMER_CHIP_VERT, 0x9a6a38, 0xffe0a0, 1),
  );
  addAir(
    'hammer',
    'heartQuarterDust:hammer',
    seedQuads('hammer', n(A.hammer.dust), 2, (h) => [h[0], h[1], 0, 0]),
    airMaterial('smithHeartQuarterDust', HAMMER_DUST_VERT, 0xa07c4c, 0xd8b480, 0.3),
  );
  // The Breath: dust devils (every mote of a devil on its anchor), streaks
  // and low veils of dust along the spiral.
  {
    const anchors = heartQuarterSeeds('breath', A.breath.devils, 3, 5, 20, 54);
    const bases: HeartAirV3[] = [];
    const params: HeartAirV4[] = [];
    anchors.forEach((a, d) => {
      const m = n(A.breath.perDevil);
      for (let i = 0; i < m; i++) {
        bases.push(local(a.x, a.z));
        params.push([
          (i * 0.618034 + d * 0.31) % 1,
          (i * 0.754877) % 1,
          0.7 + a.h[0] * 0.6,
          d / A.breath.devils,
        ]);
      }
    });
    addAir(
      'breath',
      'heartQuarterDevils:breath',
      quads(bases, params),
      airMaterial('smithHeartQuarterDevils', BREATH_DEVIL_VERT, 0xa8a4d8, 0xe4f0ff, 0.55),
    );
    const streaks = heartQuarterSeeds('breath', n(A.breath.streaks), 4);
    addAir(
      'breath',
      'heartQuarterStreaks:breath',
      quads(
        streaks.map((s) => local(s.x, s.z)),
        streaks.map((s) => [s.h[0], 2.2 + s.h[1] * 3.2, 7 + s.h[2] * 8, s.h[3]]),
        streaks.map((s) => windDir(s.r)),
      ),
      airMaterial('smithHeartQuarterStreaks', BREATH_STREAK_VERT, 0xc8c8ff, 0xffffff, 0.42),
    );
    const sheets = heartQuarterSeeds('breath', n(A.breath.sheets), 9);
    addAir(
      'breath',
      'heartQuarterSheets:breath',
      quads(
        sheets.map((s) => local(s.x, s.z)),
        sheets.map((s) => [s.h[0], s.h[1], s.h[2], s.h[3]]),
        sheets.map((s) => windDir(s.r)),
      ),
      airMaterial('smithHeartQuarterSheets', BREATH_SHEET_VERT, 0x8a84b8, 0xb8c4e8, 0.16),
    );
  }
  // The Quench: frost mist, rime rising, crystal growing along its veins.
  addAir(
    'quench',
    'heartQuarterMist:quench',
    seedQuads('quench', n(A.quench.mist), 5, (h) => [h[0], h[1], h[2], h[3]]),
    airMaterial('smithHeartQuarterMist', QUENCH_MIST_VERT, 0x8cc8ff, 0xe8f6ff, 0.16),
  );
  addAir(
    'quench',
    'heartQuarterFrost:quench',
    seedQuads('quench', n(A.quench.frost), 10, (h) => [h[0], h[1], 0.6 + h[2] * 0.8, h[3]]),
    airMaterial('smithHeartQuarterFrost', QUENCH_FROST_VERT, 0x9ad8ff, 0xffffff, 1),
  );
  const crystalMat = new THREE.ShaderMaterial({
    name: 'smithHeartQuarterCrystals',
    uniforms: {
      uTime: sharedUniforms.uTime,
      uLit: { value: 0 },
      uFront: { value: HEART_QUARTERS.ringR },
      uColor: { value: new THREE.Color(P.quench.color) },
      uDark: { value: 0 },
    },
    vertexShader: CRYSTAL_VERT,
    fragmentShader: CRYSTAL_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  {
    const spots = seamPoints('quench', n(A.quench.crystals));
    const geo = new THREE.ConeGeometry(0.17, 1, 5, 1).translate(0, 0.5, 0);
    const mesh = new THREE.InstancedMesh(geo, crystalMat, Math.max(1, spots.length));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    spots.forEach((at, i) => {
      const hh = (k: number) => heartHash(6301 + i, k);
      e.set((hh(1) - 0.5) * 0.8, hh(2) * Math.PI * 2, (hh(3) - 0.5) * 0.8);
      q.setFromEuler(e);
      const tall = 0.35 + 0.75 * hh(4) * hh(4);
      s.set(1 + hh(5), tall, 1 + hh(6));
      p.set(at[0], 0.02, at[2]);
      mesh.setMatrixAt(i, m.compose(p, q, s));
    });
    if (spots.length === 0) mesh.setMatrixAt(0, m.makeScale(0, 0, 0));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.position.copy(centre);
    mesh.frustumCulled = false;
    mesh.name = 'heartQuarterCrystals:quench';
    group.add(mesh);
    rig('quench').air.push(crystalMat);
  }
  // The Heat: embers off its fire, haze rising, flames licking out of its
  // fissures (the lava's pulses are its floor's own).
  {
    const fire = firePoints(n(A.heat.embers), 0);
    const fallback = heartQuarterSeeds('heat', fire.length ? 0 : n(A.heat.embers), 6);
    const bases = fire.length ? fire : fallback.map((s) => local(s.x, s.z));
    addAir(
      'heat',
      'heartQuarterEmbers:heat',
      quads(
        bases,
        bases.map((_, i) => {
          const h = (k: number) => heartHash(6401 + i, k);
          return [h(1), h(2), 0.6 + h(3) * 0.9, h(4)] as HeartAirV4;
        }),
      ),
      airMaterial('smithHeartQuarterEmbers', HEAT_EMBER_VERT, 0xd83a10, 0xffd060, 1),
    );
    const haze = firePoints(n(A.heat.haze), 1);
    addAir(
      'heat',
      'heartQuarterHaze:heat',
      quads(
        haze,
        haze.map((_, i) => [((i + 1) * 0.618034) % 1, ((i + 1) * 0.7548) % 1, 0, 0] as HeartAirV4),
      ),
      airMaterial('smithHeartQuarterHaze', HEAT_GLOW_VERT, 0xff5a1a, 0xffa040, 0.13),
    );
    const flames = firePoints(n(A.heat.flames), 2);
    addAir(
      'heat',
      'heartQuarterFlames:heat',
      quads(
        flames,
        flames.map((_, i) => {
          const h = (k: number) => heartHash(6411 + i, k);
          return [h(1), h(2), h(3), h(4)] as HeartAirV4;
        }),
      ),
      airMaterial('smithHeartQuarterFlames', HEAT_FLAME_VERT, 0xff4410, 0xffd25a, 0.95),
    );
  }

  // ---- the ridges -----------------------------------------------------------------------------
  const ridges: RidgeRig[] = [];
  for (let k = 0; k < 4; k++) {
    const ridgeGlow = (name: string) =>
      glowMaterial(name, RIDGE_GLOW_FRAG, {
        uColor: { value: new THREE.Color(HEART_GOLD) },
        uShockColor: { value: new THREE.Color(HEART_GOLD) },
        uBase: { value: 0 },
        uLit: { value: 0 },
        uFront: { value: HEART_QUARTERS.ringR },
        uShockR: { value: 0 },
        uShockAge: { value: -1 },
      });
    // The spine's light draws over the spine (neither writes depth: a
    // floor telegraph always shows over them); the horn's is plain.
    const spineGlow = ridgeGlow(`smithHeartRidgeGlow:${k}`);
    spineGlow.depthWrite = false;
    const hornGlow = ridgeGlow(`smithHeartRidgeHornGlow:${k}`);
    const turn = (k * Math.PI) / 2;
    const spine = heartKitMeshes(SMITH_HEART_HEART_KIT_URL, HEART_RIDGE_PIECES.spine);
    if (spine) {
      spine.name = `${HEART_RIDGE_PIECES.spine}:${k}`;
      spine.position.copy(centre);
      // The pieces are ridge 0: a quarter turn per ridge (three's yaw turns a
      // bearing clockwise, the same way the ridges follow each other).
      spine.rotation.y = turn;
      for (const m of spine.children) {
        if (!(m instanceof THREE.Mesh)) continue;
        if (m.name.endsWith(':glow')) {
          m.material = spineGlow;
          m.renderOrder = HEART_PLATFORM_ORDER.spineGlow;
        } else {
          m.material = heartKitSlotMaterial('spine');
          m.renderOrder = HEART_PLATFORM_ORDER.spine;
        }
        if (lowGfx) m.castShadow = false;
      }
      group.add(spine);
    }
    const horn = heartKitMeshes(SMITH_HEART_HEART_KIT_URL, HEART_RIDGE_PIECES.horn);
    if (horn) {
      horn.name = `${HEART_RIDGE_PIECES.horn}:${k}`;
      horn.position.copy(centre);
      horn.rotation.y = turn;
      for (const m of horn.children) {
        if (!(m instanceof THREE.Mesh)) continue;
        if (m.name.endsWith(':glow')) m.material = hornGlow;
        if (lowGfx) m.castShadow = false;
      }
      group.add(horn);
    }
    const shockMat = (name: string, vert: string, color: number, hot: number, alpha: number) =>
      new THREE.ShaderMaterial({
        name,
        uniforms: {
          uColor: { value: new THREE.Color(color) },
          uHotColor: { value: new THREE.Color(hot) },
          uAlpha: { value: alpha },
          uShockR: { value: 0 },
          uShockAge: { value: -1 },
        },
        vertexShader: vert,
        fragmentShader: MOTE_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
    const sparks = shockMat(
      `smithHeartRidgeSparks:${k}`,
      RIDGE_SPARK_VERT,
      HEART_GOLD,
      0xffffff,
      1,
    );
    const dust = shockMat(`smithHeartRidgeDust:${k}`, RIDGE_DUST_VERT, 0x8a7458, 0xc8b090, 0.32);
    const seeds = heartRidgeSparkSeeds(k, n(A.sparks));
    for (const [mat, name, list] of [
      [sparks, `heartRidgeSparks:${k}`, seeds],
      [dust, `heartRidgeDust:${k}`, seeds.filter((_, i) => i % 3 === 0)],
    ] as const) {
      const mesh = new THREE.Mesh(
        quads(
          list.map((s) => local(s.x, s.z)),
          list.map((s) => [s.h[0], s.h[1], s.h[2], s.h[3]] as HeartAirV4),
        ),
        mat,
      );
      mesh.position.copy(centre);
      mesh.name = name;
      group.add(mesh);
    }
    const curtain = new THREE.ShaderMaterial({
      name: `smithHeartRidgeCurtain:${k}`,
      uniforms: {
        uTime: sharedUniforms.uTime,
        uColor: { value: new THREE.Color(HEART_GOLD) },
        uShockColor: { value: new THREE.Color(HEART_GOLD) },
        uLit: { value: 0 },
        uFront: { value: HEART_QUARTERS.ringR },
        uShockR: { value: 0 },
        uShockAge: { value: -1 },
        uDark: { value: 0 },
      },
      vertexShader: CURTAIN_VERT,
      fragmentShader: CURTAIN_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    const curtainMesh = new THREE.Mesh(curtainGeometry(k), curtain);
    curtainMesh.position.copy(centre);
    curtainMesh.name = `heartRidgeCurtain:${k}`;
    group.add(curtainMesh);
    ridges.push({
      glows: [spineGlow, hornGlow],
      shocks: [sparks, dust],
      curtain,
      color: new THREE.Color(),
    });
  }

  // ---- the dais and the blaze -----------------------------------------------------------------
  const vein4 = HEART_QUARTER_ORDER.map((v) => ({ value: new THREE.Color(P[v].color) }));
  const daisGlow = glowMaterial('smithHeartDaisGlow', DAIS_GLOW_FRAG, {
    uV0: vein4[0],
    uV1: vein4[1],
    uV2: vein4[2],
    uV3: vein4[3],
    uQ: { value: new THREE.Vector4() },
    uRing: { value: 0 },
    uBlaze: { value: 0 },
    uPulse: { value: 0 },
  });
  // Phase 2M: the central circle's rim is a spine of dark rock round the
  // well (drawn after the floors with no depth write, like the seams', so
  // a telegraph always shows over it); its light in each quarter's colour.
  daisGlow.depthWrite = false;
  const dais = heartKitMeshes(SMITH_HEART_HEART_KIT_URL, 'Kit_HeartDais');
  if (dais) {
    dais.name = 'Kit_HeartDais:ring';
    dais.position.copy(centre);
    for (const m of dais.children) {
      if (!(m instanceof THREE.Mesh)) continue;
      if (m.name.endsWith(':glow')) {
        m.material = daisGlow;
        m.renderOrder = HEART_PLATFORM_ORDER.spineGlow;
      } else {
        m.material = heartKitSlotMaterial('spine');
        m.renderOrder = HEART_PLATFORM_ORDER.spine;
      }
      m.castShadow = false;
    }
    group.add(dais);
  }
  // The well inside it: flat on the walk, drawn as a sunken well of mist
  // and crystal where the heart's light lives (heart_landmarks_glsl.ts).
  const wellMat = new THREE.ShaderMaterial({
    name: 'smithHeartWell',
    uniforms: {
      uTime: sharedUniforms.uTime,
      uV0: vein4[0],
      uV1: vein4[1],
      uV2: vein4[2],
      uV3: vein4[3],
      uQ: daisGlow.uniforms.uQ,
      uRing: { value: 0 },
      uBlaze: { value: 0 },
      uPulse: { value: 0 },
      uDark: { value: 0 },
    },
    vertexShader: WELL_VERT,
    fragmentShader: wellFrag(
      HEART_RING_LOOK.wellR,
      HEART_RING_LOOK.depth,
      HEART_QUARTERS.sweepDeg,
      -45 + HEART_QUARTERS.rimOffsetDeg,
      lowGfx,
    ),
    fog: false,
  });
  const well = heartKitMeshes(SMITH_HEART_HEART_KIT_URL, 'Kit_HeartWell');
  if (well) {
    well.name = 'Kit_HeartWell:ring';
    well.position.copy(centre);
    for (const m of well.children) {
      if (!(m instanceof THREE.Mesh)) continue;
      m.material = wellMat;
      m.castShadow = false;
      m.receiveShadow = false;
      m.renderOrder = HEART_PLATFORM_ORDER.floor;
    }
    group.add(well);
  }
  group.add(heartMaterialCarriers([wellMat, daisGlow]));
  const blazeMat = new THREE.ShaderMaterial({
    name: 'smithHeartRingBlaze',
    uniforms: {
      uTime: sharedUniforms.uTime,
      uBlaze: { value: 0 },
      uColor: { value: new THREE.Color(0xffd690) },
      uHotColor: { value: new THREE.Color(0xffffff) },
      uAlpha: { value: 1 },
    },
    vertexShader: BLAZE_VERT,
    fragmentShader: MOTE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  {
    const m = n(A.blaze);
    const bases: HeartAirV3[] = [];
    const params: HeartAirV4[] = [];
    for (let i = 0; i < m; i++) {
      const b = (i / m) * Math.PI * 2;
      const rr = HEART_RING_LOOK.wellR - 0.4 - 4.5 * ((i * 0.381966) % 1);
      bases.push([Math.sin(b) * rr, 0, Math.cos(b) * rr]);
      params.push([
        (i * 0.618034) % 1,
        (i * 0.754877) % 1,
        0.7 + ((i * 0.5698) % 1) * 0.6,
        (i * 0.3247) % 1,
      ]);
    }
    const mesh = new THREE.Mesh(quads(bases, params), blazeMat);
    mesh.position.copy(centre);
    mesh.name = 'heartRingBlaze';
    group.add(mesh);
  }
  // Phase 2N: the column of the heart's light, layered and swirling, its
  // shards riding it up (heart_ring_column.ts).
  const column = buildHeartRingColumn(lowGfx, centre);
  group.add(column.group);
  // Phase 2N: the abyss's glow under the lip and the haze before the crown
  // (heart_surround.ts).
  const surround = buildHeartSurround(centre);
  group.add(surround.group);

  // ---- the wall landmarks (phase 2M) ----------------------------------------------------------
  const landmarks = buildHeartLandmarks(lowGfx, centre);
  group.add(landmarks.group);

  // ---- the frame ------------------------------------------------------------------------------
  const state = newHeartQuartersState();
  const set = (u: THREE.IUniform, v: number, digits = 1000) => {
    const k = Math.round(v * digits) / digits;
    if (u.value !== k) u.value = k;
  };
  const gold = new THREE.Color(HEART_GOLD);
  const ca = new THREE.Color();
  const cb = new THREE.Color();
  return {
    group,
    update(key, now, dt, dark) {
      const boss = dark > 0.01 ? null : heartQuarterBoss(key);
      stepHeartQuarters(state, boss, now, dt);
      const lit = (v: SmithHeartVein) => heartQuarterLit(state.quarters[v]);
      const awakeRoom = state.mode !== 'asleep';
      for (const vein of SMITH_HEART_VEINS) {
        const q = state.quarters[vein];
        const r = rig(vein);
        set(r.glow.uniforms.uBase, q.base);
        // The quarter's idle life (the Heat's smoulder) wakes with the room.
        set(r.glow.uniforms.uIdle, awakeRoom ? P[vein].idle * (1 - dark) : 0);
        set(r.glow.uniforms.uAwake, q.awake);
        set(r.glow.uniforms.uFront, q.front, 100);
        set(r.glow.uniforms.uDark, dark);
        set(r.wash.uniforms.uAwake, q.awake);
        set(r.wash.uniforms.uFront, q.front, 100);
        set(r.wash.uniforms.uDark, dark);
        const shadeLevel = state.mode === 'rest' || state.mode === 'asleep' ? 0.88 : P[vein].shade;
        set(r.shade.uniforms.uShade, Math.max(0.3, shadeLevel - 0.25 * dark));
        set(r.shade.uniforms.uAwake, q.awake);
        set(r.shade.uniforms.uFront, q.front, 100);
        for (const m of r.air) {
          set(m.uniforms.uLit, q.awake * (1 - dark));
          set(m.uniforms.uFront, q.front, 100);
          if (m.uniforms.uDark) set(m.uniforms.uDark, dark);
        }
        // Its wall landmark: a quiet glow of its tint, erupting as its
        // flood reaches the wall.
        landmarks.set(
          vein,
          q.base * 4 + (awakeRoom ? P[vein].idle * 0.5 : 0),
          heartLandmarkLit(q),
          dark,
        );
      }
      for (let k = 0; k < 4; k++) {
        const [va, vb] = heartRidgeNeighbours(k);
        const qa = state.quarters[va];
        const qb = state.quarters[vb];
        const wa = lit(va);
        const wb = lit(vb);
        ca.setHex(P[va].color);
        cb.setHex(P[vb].color);
        const r = ridges[k];
        if (wa + wb > 0.02) r.color.copy(ca).lerp(cb, wb / (wa + wb));
        else r.color.copy(gold);
        const shock = state.ridges[k];
        const awake = Math.max(qa.awake, qb.awake);
        const front = Math.max(qa.awake > 0 ? qa.front : 0, qb.awake > 0 ? qb.front : 0);
        for (const g of r.glows) {
          const u = g.uniforms;
          (u.uColor.value as THREE.Color).copy(r.color);
          (u.uShockColor.value as THREE.Color).copy(ca).lerp(cb, 0.5);
          set(u.uBase, Math.max(qa.base, qb.base) * 1.3);
          set(u.uLit, awake);
          set(u.uFront, front, 100);
          set(u.uShockR, shock.r, 100);
          set(u.uShockAge, shock.age);
          set(u.uDark, dark);
        }
        for (const s of r.shocks) {
          const su = s.uniforms;
          set(su.uShockR, shock.r, 100);
          set(su.uShockAge, shock.age);
        }
        (r.shocks[0].uniforms.uColor.value as THREE.Color).copy(ca).lerp(cb, 0.5);
        const cu = r.curtain.uniforms;
        (cu.uColor.value as THREE.Color).copy(r.color);
        (cu.uShockColor.value as THREE.Color).copy(ca).lerp(cb, 0.5);
        set(cu.uLit, awake * (1 - dark));
        set(cu.uFront, front, 100);
        set(cu.uShockR, shock.r, 100);
        set(cu.uShockAge, shock.age);
        set(cu.uDark, dark);
      }
      const du = daisGlow.uniforms;
      (du.uQ.value as THREE.Vector4).set(
        lit(HEART_QUARTER_ORDER[0]),
        lit(HEART_QUARTER_ORDER[1]),
        lit(HEART_QUARTER_ORDER[2]),
        lit(HEART_QUARTER_ORDER[3]),
      );
      set(du.uRing, state.ring);
      set(du.uBlaze, state.blaze);
      set(du.uPulse, state.ringPulse);
      set(du.uDark, dark);
      const wu = wellMat.uniforms;
      set(wu.uRing, state.ring);
      set(wu.uBlaze, state.blaze);
      set(wu.uPulse, state.ringPulse);
      set(wu.uDark, dark);
      set(blazeMat.uniforms.uBlaze, state.blaze * (1 - dark));
      column.set(state.blaze, dark);
      surround.set(state.ring, state.blaze, dark);
    },
  };
}
