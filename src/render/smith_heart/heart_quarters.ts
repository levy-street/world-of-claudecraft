// The Anvil of the World's four quarters (phase 2K, design doc section 5.21):
// the Heart kit's quarter floors, ridges and dais placed on the platform,
// each with its own light, and the quarter the Masterless Strength stands in
// awake (heart_quarters_core.ts steps the state; the shaders are
// heart_quarters_glsl.ts):
//   - the awake quarter's seams ignite in its vein's colour, the flood
//     running out of the central ring to the rim with a bright front, its
//     light washed over the stones (a floor mark on the ground rung), its
//     element rising off it: the Breath's dust devils and wind streaks, the
//     Hammer's grit and the tremors running out through its slabs, the
//     Quench's frost mist and crystal growing along its frost veins, the
//     Heat's embers and molten seams;
//   - the ridges bordering it glow, the other three quarters go dark (a
//     faint glow left in their seams, so the room still reads as four);
//   - a crossing drains the old quarter back into the ring (a pulse through
//     the dais) and floods the new one out of it, a shockwave racing along
//     the ridge the boss crossed, throwing sparks;
//   - in the ring with a fight on, all four wake and the ring blazes: the
//     dais's crystal, a column of its light, motes of the four veins
//     spiralling up; in the ring before the pull every quarter breathes.
// Gameplay-neutral at every tier: the seams, the floods, the ridges, the
// shockwave, the washes and the ring draw on every tier (which quarter is
// awake is never shed); the low tier keeps a share of the cosmetic air.
//
// GPU preparation: built with the interior (the compile gate links every
// material, hidden or not); the kit's stone and ice slots draw with the
// kit's shared slot materials; no light; no texture; the per-frame update
// writes uniforms only (no allocation).

import * as THREE from 'three';
import {
  HEART_ROOM,
  SMITH_HEART_VEIN_COLORS,
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
import { heartBeamMaterial } from './heart_fx_materials';
import { heartKitMeshes, heartKitPiece, SMITH_HEART_HEART_KIT_URL } from './heart_kit';
import { heartHash } from './heart_plan_core';
import {
  HEART_QUARTER_AIR,
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
  BREATH_STREAK_VERT,
  CRYSTAL_FRAG,
  CRYSTAL_VERT,
  CURTAIN_FRAG,
  CURTAIN_VERT,
  DAIS_GLOW_FRAG,
  HAMMER_DUST_VERT,
  HAMMER_GRIT_VERT,
  HEAT_EMBER_VERT,
  HEAT_GLOW_VERT,
  KIT_GLOW_VERT,
  MOTE_FRAG,
  QUENCH_MIST_VERT,
  quarterGlowFrag,
  RIDGE_GLOW_FRAG,
  RIDGE_SPARK_VERT,
  SHADE_FRAG,
  WASH_FRAG,
  WASH_VERT,
} from './heart_quarters_glsl';

/** Each quarter's kit piece. */
export const HEART_QUARTER_PIECES: Readonly<Record<SmithHeartVein, string>> = {
  hammer: 'Kit_QuarterHammer',
  breath: 'Kit_QuarterBreath',
  quench: 'Kit_QuarterQuench',
  heat: 'Kit_QuarterHeat',
};

/** The faint white-gold of the heart a ridge glows with when neither of its
 *  quarters is awake. */
const HEART_GOLD = 0xffd690;
/** How far a dormant quarter's stones are dimmed (multiplied) while another
 *  is awake or the final look burns. */
const HEART_QUARTER_SHADE = 0.42;
/** Each quarter's light gain (seams, wash): the Breath's and the Quench's
 *  cold colours over their pale stone need more to read as awake beside the
 *  Hammer's gold and the Heat's white-gold. */
const QUARTER_GAIN: Readonly<Record<SmithHeartVein, { seams: number; wash: number }>> = {
  hammer: { seams: 1, wash: 1 },
  breath: { seams: 1.7, wash: 1.9 },
  quench: { seams: 1.35, wash: 1.2 },
  heat: { seams: 1, wash: 0.85 },
};

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
const AIR_BOUNDS = new THREE.Sphere(new THREE.Vector3(0, 8, 0), HEART_QUARTERS.rimR + 14);

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

/** Points along a quarter's glowing seams (its kit glow slot, the strips
 *  laid on the paving, never the sheet under it), room-local. */
function seamPoints(vein: SmithHeartVein, n: number): HeartAirV3[] {
  const geo = heartKitPiece(SMITH_HEART_HEART_KIT_URL, HEART_QUARTER_PIECES[vein])?.glow;
  const pos = geo?.getAttribute('position');
  const out: HeartAirV3[] = [];
  if (!pos) return out;
  const cand: number[] = [];
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0.01) cand.push(i);
  if (cand.length === 0) return out;
  for (let k = 0; k < n; k++) {
    const i = cand[Math.floor(((k * 0.6180339887 + 0.137) % 1) * cand.length)];
    out.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
  }
  return out;
}

const local = (x: number, z: number): HeartAirV3 => [x - HEART_ROOM.x, 0, z - HEART_ROOM.z];

/** The light washed over a quarter: a grid over its unwound sector, its
 *  edge faded toward the ridges and the rim (`aEdge`). */
function washGeometry(
  vein: SmithHeartVein,
  inset = HEART_QUARTERS.ridgeHalfWidth + 0.2,
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
  glow: THREE.ShaderMaterial;
  sparks: THREE.ShaderMaterial;
  curtain: THREE.ShaderMaterial;
  color: THREE.Color;
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
  const colorOf = (v: SmithHeartVein) => SMITH_HEART_VEIN_COLORS[v];

  // ---- the quarters' floors, their washes and their air ------------------------------------
  for (const vein of SMITH_HEART_VEINS) {
    const glow = glowMaterial(`smithHeartQuarterGlow:${vein}`, quarterGlowFrag(vein), {
      uColor: { value: new THREE.Color(colorOf(vein)) },
      uBase: { value: 0 },
      uAwake: { value: 0 },
      uFront: { value: HEART_QUARTERS.ringR },
      uGain: { value: QUARTER_GAIN[vein].seams },
    });
    const floor = heartKitMeshes(SMITH_HEART_HEART_KIT_URL, HEART_QUARTER_PIECES[vein]);
    if (floor) {
      floor.name = `${HEART_QUARTER_PIECES[vein]}:${vein}`;
      floor.position.copy(centre);
      for (const m of floor.children) {
        if (!(m instanceof THREE.Mesh)) continue;
        if (m.name.endsWith(':glow')) m.material = glow;
        // A floor a breath over the walk casts nothing worth a shadow.
        m.castShadow = false;
      }
      group.add(floor);
    }
    const wash = new THREE.ShaderMaterial({
      name: `smithHeartQuarterWash:${vein}`,
      uniforms: {
        uTime: sharedUniforms.uTime,
        uColor: { value: new THREE.Color(colorOf(vein)) },
        uAwake: { value: 0 },
        uFront: { value: HEART_QUARTERS.ringR },
        uGain: { value: QUARTER_GAIN[vein].wash },
        uDark: { value: 0 },
      },
      vertexShader: WASH_VERT,
      fragmentShader: WASH_FRAG,
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
    // the wash), lifted inside the flood.
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
    const shadeMesh = new THREE.Mesh(washGeometry(vein, 0.9, 0.055), shade);
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
  // The Hammer: grit glinting up off the slabs, dust off each tremor.
  addAir(
    'hammer',
    'heartQuarterGrit:hammer',
    seedQuads('hammer', n(A.hammer.grit), 1, (h) => [h[0], h[1], 0.6 + h[2] * 0.8, h[3]]),
    airMaterial('smithHeartQuarterGrit', HAMMER_GRIT_VERT, 0xc89048, 0xfff0c8, 0.9),
  );
  addAir(
    'hammer',
    'heartQuarterDust:hammer',
    seedQuads('hammer', n(A.hammer.dust), 2, (h) => [h[0], h[1], 0, 0]),
    airMaterial('smithHeartQuarterDust', HAMMER_DUST_VERT, 0x8a6a40, 0xc8a070, 0.18),
  );
  // The Breath: dust devils (every mote of a devil on its anchor) and
  // streaks along the spiral.
  {
    const anchors = heartQuarterSeeds('breath', A.breath.devils, 3, 5, 15, 36);
    const bases: HeartAirV3[] = [];
    const params: HeartAirV4[] = [];
    anchors.forEach((a, d) => {
      const m = n(A.breath.perDevil);
      for (let i = 0; i < m; i++) {
        bases.push(local(a.x, a.z));
        params.push([
          (i * 0.618034 + d * 0.31) % 1,
          ((i * 0.754877) % 1) * 1,
          0.7 + a.h[0] * 0.6,
          d / 4,
        ]);
      }
    });
    addAir(
      'breath',
      'heartQuarterDevils:breath',
      quads(bases, params),
      airMaterial('smithHeartQuarterDevils', BREATH_DEVIL_VERT, 0x9aa8c8, 0xd8e4ff, 0.42),
    );
    const streaks = heartQuarterSeeds('breath', n(A.breath.streaks), 4);
    // The wind's direction at a seed: along the pinwheel's spiral, outward.
    const dirs: HeartAirV3[] = streaks.map((s) => {
      const r = s.r;
      const kb = heartQuarterRidges('breath')[1];
      const b0 = (heartRidgeBearingDeg(kb, r) * Math.PI) / 180;
      const b1 = (heartRidgeBearingDeg(kb, r + 1) * Math.PI) / 180;
      const dx = Math.sin(b1) * (r + 1) - Math.sin(b0) * r;
      const dz = Math.cos(b1) * (r + 1) - Math.cos(b0) * r;
      const l = Math.hypot(dx, dz) || 1;
      return [dx / l, 0, dz / l];
    });
    addAir(
      'breath',
      'heartQuarterStreaks:breath',
      quads(
        streaks.map((s) => local(s.x, s.z)),
        streaks.map((s) => [s.h[0], 1.6 + s.h[1] * 2.6, 6 + s.h[2] * 7, s.h[3]]),
        dirs,
      ),
      airMaterial('smithHeartQuarterStreaks', BREATH_STREAK_VERT, 0xd8e8ff, 0xffffff, 0.5),
    );
  }
  // The Quench: frost mist and crystal growing along its frost veins.
  addAir(
    'quench',
    'heartQuarterMist:quench',
    seedQuads('quench', n(A.quench.mist), 5, (h) => [h[0], h[1], 0, h[2]]),
    airMaterial('smithHeartQuarterMist', QUENCH_MIST_VERT, 0x9ccfff, 0xe8f6ff, 0.1),
  );
  const crystalMat = new THREE.ShaderMaterial({
    name: 'smithHeartQuarterCrystals',
    uniforms: {
      uTime: sharedUniforms.uTime,
      uLit: { value: 0 },
      uFront: { value: HEART_QUARTERS.ringR },
      uColor: { value: new THREE.Color(colorOf('quench')) },
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
    const geo = new THREE.ConeGeometry(0.11, 1, 5, 1).translate(0, 0.5, 0);
    const mesh = new THREE.InstancedMesh(geo, crystalMat, Math.max(1, spots.length));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    spots.forEach((at, i) => {
      const hh = (k: number) => heartHash(6301 + i, k);
      e.set((hh(1) - 0.5) * 0.7, hh(2) * Math.PI * 2, (hh(3) - 0.5) * 0.7);
      q.setFromEuler(e);
      const tall = 0.16 + 0.24 * hh(4);
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
  // The Heat: embers off its fire crystal and seams, molten glow over them.
  {
    const spots = seamPoints('heat', n(A.heat.embers));
    const fallback = heartQuarterSeeds('heat', spots.length ? 0 : n(A.heat.embers), 6);
    const bases = spots.length ? spots : fallback.map((s) => local(s.x, s.z));
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
      airMaterial('smithHeartQuarterEmbers', HEAT_EMBER_VERT, 0xe8a040, 0xfff4d0, 0.95),
    );
    const glowSpots = seamPoints('heat', n(A.heat.haze));
    addAir(
      'heat',
      'heartQuarterHaze:heat',
      quads(
        glowSpots,
        glowSpots.map(
          (_, i) => [((i + 1) * 0.618034) % 1, ((i + 1) * 0.7548) % 1, 0, 0] as HeartAirV4,
        ),
      ),
      airMaterial('smithHeartQuarterHaze', HEAT_GLOW_VERT, 0xffc860, 0xfff0c0, 0.14),
    );
  }

  // ---- the ridges -----------------------------------------------------------------------------
  const ridges: RidgeRig[] = [];
  for (let k = 0; k < 4; k++) {
    const glow = glowMaterial(`smithHeartRidgeGlow:${k}`, RIDGE_GLOW_FRAG, {
      uColor: { value: new THREE.Color(HEART_GOLD) },
      uShockColor: { value: new THREE.Color(HEART_GOLD) },
      uBase: { value: 0 },
      uLit: { value: 0 },
      uFront: { value: HEART_QUARTERS.ringR },
      uShockR: { value: 0 },
      uShockAge: { value: -1 },
    });
    const holder = heartKitMeshes(SMITH_HEART_HEART_KIT_URL, 'Kit_HeartRidge');
    if (holder) {
      holder.name = `Kit_HeartRidge:${k}`;
      holder.position.copy(centre);
      // The piece is ridge 0: a quarter turn per ridge (three's yaw turns a
      // bearing clockwise, the same way the ridges follow each other).
      holder.rotation.y = (k * Math.PI) / 2;
      for (const m of holder.children) {
        if (!(m instanceof THREE.Mesh)) continue;
        if (m.name.endsWith(':glow')) m.material = glow;
        if (lowGfx) m.castShadow = false;
      }
      group.add(holder);
    }
    const sparks = new THREE.ShaderMaterial({
      name: `smithHeartRidgeSparks:${k}`,
      uniforms: {
        uColor: { value: new THREE.Color(HEART_GOLD) },
        uHotColor: { value: new THREE.Color(0xffffff) },
        uAlpha: { value: 1 },
        uShockR: { value: 0 },
        uShockAge: { value: -1 },
      },
      vertexShader: RIDGE_SPARK_VERT,
      fragmentShader: MOTE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const seeds = heartRidgeSparkSeeds(k, n(A.sparks));
    const mesh = new THREE.Mesh(
      quads(
        seeds.map((s) => local(s.x, s.z)),
        seeds.map((s) => [s.h[0], s.h[1], s.h[2], s.h[3]] as HeartAirV4),
      ),
      sparks,
    );
    mesh.position.copy(centre);
    mesh.name = `heartRidgeSparks:${k}`;
    group.add(mesh);
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
    ridges.push({ glow, sparks, curtain, color: new THREE.Color() });
  }

  // ---- the dais and the blaze -----------------------------------------------------------------
  const vein4 = HEART_QUARTER_ORDER.map((v) => ({ value: new THREE.Color(colorOf(v)) }));
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
  const dais = heartKitMeshes(SMITH_HEART_HEART_KIT_URL, 'Kit_HeartDais');
  if (dais) {
    dais.name = 'Kit_HeartDais:ring';
    dais.position.copy(centre);
    for (const m of dais.children) {
      if (!(m instanceof THREE.Mesh)) continue;
      if (m.name.endsWith(':glow')) m.material = daisGlow;
      m.castShadow = false;
    }
    group.add(dais);
  }
  const blazeMat = new THREE.ShaderMaterial({
    name: 'smithHeartRingBlaze',
    uniforms: {
      uTime: sharedUniforms.uTime,
      uBlaze: { value: 0 },
      uColor: { value: new THREE.Color(0xffd690) },
      uHotColor: { value: new THREE.Color(0xffffff) },
      uAlpha: { value: 0.9 },
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
      bases.push([Math.sin(b) * 10.6, 0, Math.cos(b) * 10.6]);
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
  const columnMat = heartBeamMaterial(0xffe2a8, 'smithHeartRingColumn', 1.2);
  {
    const h = 30;
    const g = new THREE.CylinderGeometry(10.4, 7.5, h, 48, 1, true).translate(0, h / 2, 0);
    const column = new THREE.Mesh(g, columnMat);
    column.position.copy(centre);
    column.name = 'heartRingColumn';
    group.add(column);
  }

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
      for (const vein of SMITH_HEART_VEINS) {
        const q = state.quarters[vein];
        const r = rig(vein);
        set(r.glow.uniforms.uBase, q.base);
        set(r.glow.uniforms.uAwake, q.awake);
        set(r.glow.uniforms.uFront, q.front, 100);
        set(r.glow.uniforms.uDark, dark);
        set(r.wash.uniforms.uAwake, q.awake);
        set(r.wash.uniforms.uFront, q.front, 100);
        set(r.wash.uniforms.uDark, dark);
        const shadeLevel =
          state.mode === 'rest' || state.mode === 'asleep' ? 0.88 : HEART_QUARTER_SHADE;
        set(r.shade.uniforms.uShade, Math.max(0.3, shadeLevel - 0.25 * dark));
        set(r.shade.uniforms.uAwake, q.awake);
        set(r.shade.uniforms.uFront, q.front, 100);
        for (const m of r.air) {
          set(m.uniforms.uLit, q.awake * (1 - dark));
          set(m.uniforms.uFront, q.front, 100);
          if (m.uniforms.uDark) set(m.uniforms.uDark, dark);
        }
      }
      for (let k = 0; k < 4; k++) {
        const [va, vb] = heartRidgeNeighbours(k);
        const qa = state.quarters[va];
        const qb = state.quarters[vb];
        const wa = lit(va);
        const wb = lit(vb);
        ca.setHex(SMITH_HEART_VEIN_COLORS[va]);
        cb.setHex(SMITH_HEART_VEIN_COLORS[vb]);
        const r = ridges[k];
        if (wa + wb > 0.02) r.color.copy(ca).lerp(cb, wb / (wa + wb));
        else r.color.copy(gold);
        const u = r.glow.uniforms;
        (u.uColor.value as THREE.Color).copy(r.color);
        (u.uShockColor.value as THREE.Color).copy(ca).lerp(cb, 0.5);
        set(u.uBase, Math.max(qa.base, qb.base) * 1.3);
        const awake = Math.max(qa.awake, qb.awake);
        set(u.uLit, awake);
        set(u.uFront, Math.max(qa.awake > 0 ? qa.front : 0, qb.awake > 0 ? qb.front : 0), 100);
        const shock = state.ridges[k];
        set(u.uShockR, shock.r, 100);
        set(u.uShockAge, shock.age);
        set(u.uDark, dark);
        const su = r.sparks.uniforms;
        (su.uColor.value as THREE.Color).copy(ca).lerp(cb, 0.5);
        set(su.uShockR, shock.r, 100);
        set(su.uShockAge, shock.age);
        const cu = r.curtain.uniforms;
        (cu.uColor.value as THREE.Color).copy(r.color);
        (cu.uShockColor.value as THREE.Color).copy(ca).lerp(cb, 0.5);
        set(cu.uLit, awake * (1 - dark));
        set(cu.uFront, u.uFront.value as number, 100);
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
      set(blazeMat.uniforms.uBlaze, state.blaze * (1 - dark));
      set(columnMat.uniforms.uK, state.blaze * 0.9 * (1 - dark));
    },
  };
}
