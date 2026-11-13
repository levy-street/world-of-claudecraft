// The Anvil falling apart (Mythic's hidden phase, design doc section 7.5; the pure half
// is heart_collapse_core.ts, the shaders heart_collapse_glsl.ts, the real pieces
// heart_collapse_rig.ts): a part of the room's quarters.
//   - the warning: a web of cracks glowing in the quarter's element, its whole edge lit
//     (every tier: which quarter falls next is actionable), staying lit over the floor
//     until it has left (the sim kills from the first instant);
//   - the fall: the kit's real pieces cut at the sim's exact edge (`hiddenFallenAt`: ring
//     lip, ridges, rim and past it) break from the wall inward and drop into the void,
//     the Heart's crater and its light far below; rubble and dust go with them (a share
//     on the low tier, the pieces themselves on every tier);
//   - after it: the hole itself, and an ember line along the ground left standing at
//     its exact edge (every tier);
//   - the ring's own cracks and, at the end, its abyss.
//
// GPU preparation: built with the interior with the quarters (the compile gate links
// every material, hidden or not); no light; no texture; the per-frame update writes
// uniforms and, only while something moves, matrices (no allocation).

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
import { FINAL_PHASES } from '../../sim/encounters/smith_heart/final_phase_ids';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { sharedUniforms } from '../gfx';
import { heartQuadGeometry } from './heart_air_quads';
import {
  HEART_COLLAPSE_LOOK,
  HEART_FALL_DEPTH,
  HEART_FALL_VEIL,
  type HeartCollapseState,
  type HeartSlabPose,
  heartCollapseView,
  heartFallEdgeLight,
  heartSlabPose,
  heartSlabsLive,
  newHeartCollapseState,
  stepHeartCollapse,
} from './heart_collapse_core';
import {
  ABYSS_FRAG,
  COLLAPSE_VERT,
  CRACK_FRAG,
  DEPTH_FRAG,
  DEPTH_VERT,
  DUST_FRAG,
  DUST_VERT,
  LIP_FRAG,
  LIP_VERT,
  VEIL_FRAG,
} from './heart_collapse_glsl';
import {
  buildHeartFallRig,
  type HeartFallAltar,
  type HeartFallMaterials,
} from './heart_collapse_rig';
import { HEART_QUARTER_PALETTE, HEART_RING_LOOK, heartQuarterSeeds } from './heart_quarters_core';

/** How far past the rim a fallen quarter's abyss runs (the sim's own slack). */
const RIM_PAST = 2.5;
/** The width of the lit edge and the rock lip (yards). */
const EDGE_YARDS = 3.5;
/** Pieces of rubble per quarter (the floor itself is the real kit's). */
const SLABS = { high: 96, low: 44 } as const;
/** Puffs of dust per quarter. */
const DUST = { high: 170, low: 56 } as const;
/** How wide the ember line runs on the ground left standing (yards). */
const LIP_WIDTH = 0.8;
const LIP_Y = 0.1;

/** A quarter's exact shape from the ring's lip to past the rim: every row bears on
 *  its two ridges, as `heartQuarterAt` does. `aEdge`: 1 inside, 0 at the edge. */
function sectorGeometry(vein: SmithHeartVein, y: number): THREE.BufferGeometry {
  const { ringR, rimR } = HEART_QUARTERS;
  const r0 = ringR + FINAL_PHASES.ringLip;
  const r1 = rimR + RIM_PAST;
  const [ka, kb] = heartQuarterRidges(vein);
  const rows: number[] = [];
  for (let r = r0; r < r1; r += 1.2) rows.push(r);
  rows.push(r1);
  const cols = 28;
  const pos: number[] = [];
  const edge: number[] = [];
  for (const r of rows) {
    const ba = heartRidgeBearingDeg(ka, r);
    const span = (((heartRidgeBearingDeg(kb, r) - ba) % 360) + 360) % 360;
    const arc = (span * Math.PI * r) / 180;
    for (let c = 0; c <= cols; c++) {
      const t = c / cols;
      const b = ((ba + span * t) * Math.PI) / 180;
      pos.push(Math.sin(b) * r, y, Math.cos(b) * r);
      const yards = Math.min(t * arc, (1 - t) * arc, r - r0, r1 - r);
      edge.push(Math.max(0, Math.min(1, yards / EDGE_YARDS)));
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

/** A flat ring (r0 to r1) with its `aEdge`. */
function annulusGeometry(r0: number, r1: number, y: number): THREE.BufferGeometry {
  const rows = 8;
  const cols = 72;
  const pos: number[] = [];
  const edge: number[] = [];
  for (let a = 0; a <= rows; a++) {
    const r = r0 + ((r1 - r0) * a) / rows;
    for (let c = 0; c <= cols; c++) {
      const b = (c / cols) * Math.PI * 2;
      pos.push(Math.sin(b) * r, y, Math.cos(b) * r);
      edge.push(Math.min(1, (r1 - r) / 1.5));
    }
  }
  const idx: number[] = [];
  for (let a = 0; a < rows; a++)
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

/** The ember line along a path of the ground left standing: `aEdge` 0 on the exact
 *  edge, 1 at its far side. */
function lipGeometry(rows: readonly (readonly number[])[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const edge: number[] = [];
  const idx: number[] = [];
  rows.forEach(([x, z, ix, iz], i) => {
    pos.push(x, LIP_Y, z, ix, LIP_Y, iz);
    edge.push(0, 1);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Quarter `vein`'s edge on the ring: the sim's lip, the line running in over the rim. */
function ringLipRows(vein: SmithHeartVein): number[][] {
  const r = HEART_QUARTERS.ringR + FINAL_PHASES.ringLip;
  const [ka, kb] = heartQuarterRidges(vein);
  const ba = heartRidgeBearingDeg(ka, r);
  const span = (((heartRidgeBearingDeg(kb, r) - ba) % 360) + 360) % 360;
  const rows: number[][] = [];
  for (let c = 0; c <= 26; c++) {
    const b = ((ba + (span * c) / 26) * Math.PI) / 180;
    const [s, k] = [Math.sin(b), Math.cos(b)];
    rows.push([s * r, k * r, s * (r - LIP_WIDTH), k * (r - LIP_WIDTH)]);
  }
  return rows;
}

/** Ridge `k`'s line from the ring to the rim, the ember line on one side of it
 *  (`side` +1 clockwise: the bearing grows). */
function ridgeLipRows(k: number, side: number): number[][] {
  const { ringR, rimR } = HEART_QUARTERS;
  const r0 = ringR + FINAL_PHASES.ringLip;
  const rows: number[][] = [];
  const steps = 56;
  for (let i = 0; i <= steps; i++) {
    const r = r0 + ((rimR - r0) * i) / steps;
    const b = heartRidgeBearingDeg(k, r);
    const off = ((side * LIP_WIDTH) / r) * (180 / Math.PI);
    const a = (b * Math.PI) / 180;
    const c = ((b + off) * Math.PI) / 180;
    rows.push([Math.sin(a) * r, Math.cos(a) * r, Math.sin(c) * r, Math.cos(c) * r]);
  }
  return rows;
}

/** One chunk of broken floor: a jittered box, its top flat, faces flat-shaded. */
function slabGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1).toNonIndexed();
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = Math.sin(x * 12.9 + z * 78.2 + y * 3.1) * 0.5 + 0.5;
    // The underside tapers to a jagged keel; the top stays level with the floor.
    if (y < 0) p.setXYZ(i, x * (0.45 + k * 0.4), y - k * 0.8, z * (0.45 + (1 - k) * 0.4));
  }
  g.computeVertexNormals();
  return g;
}

function lipMaterial(name: string, color: number, hot: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name,
    uniforms: {
      uTime: sharedUniforms.uTime,
      uHeat: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uHot: { value: new THREE.Color(hot) },
    },
    vertexShader: LIP_VERT,
    fragmentShader: LIP_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  });
}

function abyssMaterial(name: string, color: number, hot: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name,
    uniforms: {
      uTime: sharedUniforms.uTime,
      uHeat: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uHot: { value: new THREE.Color(hot) },
    },
    vertexShader: COLLAPSE_VERT,
    fragmentShader: ABYSS_FRAG,
    fog: false,
    toneMapped: false,
    // Over the platform it cannot open, whatever the band's depth precision.
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
}

function crackMaterial(
  name: string,
  color: number,
  hot: number,
  r0: number,
  r1: number,
  inward: boolean,
  depthTest: boolean,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name,
    uniforms: {
      uTime: sharedUniforms.uTime,
      uCrack: { value: 0 },
      uR0: { value: r0 },
      uR1: { value: r1 },
      uInward: { value: inward ? 1 : 0 },
      uColor: { value: new THREE.Color(color) },
      uHot: { value: new THREE.Color(hot) },
    },
    vertexShader: COLLAPSE_VERT,
    fragmentShader: CRACK_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  });
}

interface SlabRig {
  mesh: THREE.InstancedMesh;
  x: Float32Array;
  z: Float32Array;
  r: Float32Array;
  h: Float32Array;
  w: Float32Array;
  thick: Float32Array;
  spin: Float32Array;
  /** The last `t` written (-2: none), so a settled quarter writes nothing. */
  written: number;
}

interface CollapseRig {
  crack: THREE.Mesh;
  crackMat: THREE.ShaderMaterial;
  slabs: SlabRig;
  dust: THREE.Mesh;
  dustMat: THREE.ShaderMaterial;
  /** The ember line on the ring, shown once this quarter has gone. */
  lipRing: THREE.Mesh;
  /** On this quarter's side of each of its ridges, shown once the other side has gone. */
  lipCcw: THREE.Mesh;
  lipCw: THREE.Mesh;
}

export interface HeartCollapse {
  group: THREE.Group;
  state: HeartCollapseState;
  /** Step and paint for slot `key`. */
  update(key: string, dt: number): void;
  /** Seconds into a quarter's fall (-1 whole). */
  fallT(vein: SmithHeartVein): number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _pose: HeartSlabPose = { drop: 0, turn: 0, gone: false };

export function buildHeartCollapse(
  lowGfx: boolean,
  centre: THREE.Vector3,
  mats: HeartFallMaterials,
  altars: (vein: SmithHeartVein) => HeartFallAltar | null,
): HeartCollapse {
  const group = new THREE.Group();
  group.name = 'smithHeartCollapse';
  // The real pieces, every tier.
  const fall = buildHeartFallRig(lowGfx, centre, mats, altars);
  group.add(fall.group);
  const P = HEART_QUARTER_PALETTE;
  const state = newHeartCollapseState();
  const rigs = new Map<SmithHeartVein, CollapseRig>();
  const { ringR, rimR } = HEART_QUARTERS;
  const slabGeo = slabGeometry();
  const slabMat = new THREE.MeshStandardMaterial({
    name: 'smithHeartCollapseSlab',
    color: 0xffffff,
    roughness: 0.95,
    flatShading: true,
  });
  const count = lowGfx ? SLABS.low : SLABS.high;
  const tint = new THREE.Color();
  const stone = new THREE.Color(0x5c5148);
  for (const vein of SMITH_HEART_VEINS) {
    const crackMat = crackMaterial(
      `smithHeartCollapseCrack:${vein}`,
      P[vein].color,
      P[vein].hot,
      ringR,
      rimR,
      true,
      true,
    );
    const crack = new THREE.Mesh(sectorGeometry(vein, 0.09), crackMat);
    crack.name = `heartCollapseCrack:${vein}`;
    crack.position.copy(centre);
    crack.renderOrder = floorVfxRenderOrder('ground', 5);
    crack.visible = false;
    crack.frustumCulled = false;
    group.add(crack);
    const seeds = heartQuarterSeeds(vein, count, 41, 0.5, ringR + 2, rimR);
    const n = seeds.length;
    const mesh = new THREE.InstancedMesh(slabGeo, slabMat, Math.max(1, n));
    mesh.name = `heartCollapseSlabs:${vein}`;
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.castShadow = false;
    mesh.position.copy(centre);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const slabs: SlabRig = {
      mesh,
      x: new Float32Array(n),
      z: new Float32Array(n),
      r: new Float32Array(n),
      h: new Float32Array(n),
      w: new Float32Array(n),
      thick: new Float32Array(n),
      spin: new Float32Array(n),
      written: -2,
    };
    // Rubble off the broken edges: a few yards at most, the cells are the real floor.
    const area = (Math.PI * (rimR * rimR - ringR * ringR)) / 4;
    const side = Math.min(3.4, Math.sqrt(area / Math.max(1, n)) * 0.55);
    seeds.forEach((s, i) => {
      slabs.x[i] = s.x - HEART_ROOM.x;
      slabs.z[i] = s.z - HEART_ROOM.z;
      slabs.r[i] = s.r;
      slabs.h[i] = s.h[0];
      slabs.w[i] = side * (0.85 + s.h[1] * 0.4);
      slabs.thick[i] = 0.7 + s.h[2] * 1.5;
      slabs.spin[i] = s.h[3] * Math.PI * 2;
      tint.copy(stone).lerp(new THREE.Color(P[vein].color), s.h[1] * 0.06);
      tint.multiplyScalar(0.7 + s.h[2] * 0.5);
      mesh.setColorAt(i, tint);
      mesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
    });
    group.add(mesh);
    // Dust out of the breaks, rising a little and falling away with the floor.
    const dustSeeds = heartQuarterSeeds(
      vein,
      lowGfx ? DUST.low : DUST.high,
      67,
      0.5,
      ringR + 1,
      rimR,
    );
    const dustMat = new THREE.ShaderMaterial({
      name: `smithHeartCollapseDust:${vein}`,
      uniforms: {
        uFall: { value: -1 },
        uColor: { value: new THREE.Color(0x6e6054).lerp(new THREE.Color(P[vein].color), 0.1) },
        uGlow: { value: new THREE.Color(0xff9a50) },
      },
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    const dust = new THREE.Mesh(
      heartQuadGeometry(
        dustSeeds.map((s) => [s.x - HEART_ROOM.x, 0, s.z - HEART_ROOM.z] as const),
        dustSeeds.map((s) => [s.h[0], s.h[1], s.h[2], s.h[3]] as const),
      ),
      dustMat,
    );
    dust.name = `heartCollapseDust:${vein}`;
    dust.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -20, 0), rimR + 60);
    dust.position.copy(centre);
    dust.visible = false;
    group.add(dust);
    // The ember line on what is left standing, at the sim's exact edge.
    const lip = (rows: number[][], name: string) => {
      const m = new THREE.Mesh(
        lipGeometry(rows),
        lipMaterial(`smithHeartCollapseLip:${name}`, P[vein].color, P[vein].hot),
      );
      m.name = `heartCollapseLip:${name}`;
      m.position.copy(centre);
      m.renderOrder = floorVfxRenderOrder('ground', 6);
      m.visible = false;
      group.add(m);
      return m;
    };
    const [ka, kb] = heartQuarterRidges(vein);
    const lipRing = lip(ringLipRows(vein), `ring:${vein}`);
    // This quarter's own side of its ridges: its counter-clockwise ridge's bearing grows
    // into it, its clockwise one's falls.
    const lipCcw = lip(ridgeLipRows(ka, 1), `ccw:${vein}`);
    const lipCw = lip(ridgeLipRows(kb, -1), `cw:${vein}`);
    rigs.set(vein, { crack, crackMat, slabs, dust, dustMat, lipRing, lipCcw, lipCw });
  }
  // The real depth under a fallen quarter: layers of the heart's light and its smoke in
  // the chasm, seen only through the hole (nothing draws them while the floor is whole).
  const depth = new THREE.Group();
  depth.name = 'heartCollapseDepth';
  depth.visible = false;
  const veil = new THREE.Mesh(
    new THREE.CircleGeometry(HEART_FALL_VEIL.r, 64)
      .rotateX(-Math.PI / 2)
      .translate(0, HEART_FALL_VEIL.y, 0),
    new THREE.ShaderMaterial({
      name: 'smithHeartCollapseVeil',
      uniforms: { uTime: sharedUniforms.uTime },
      vertexShader: DEPTH_VERT,
      fragmentShader: VEIL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
    }),
  );
  veil.name = 'heartCollapseVeil';
  veil.position.copy(centre);
  veil.renderOrder = floorVfxRenderOrder('ground', 0) - 8;
  depth.add(veil);
  for (const [i, layer] of HEART_FALL_DEPTH.entries()) {
    const m = new THREE.ShaderMaterial({
      name: `smithHeartCollapseDepth:${i}`,
      uniforms: {
        uTime: sharedUniforms.uTime,
        uK: { value: layer.k },
        uScale: { value: layer.scale },
        uSeed: { value: i * 17.3 },
      },
      vertexShader: DEPTH_VERT,
      fragmentShader: DEPTH_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
    });
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(layer.r, 64).rotateX(-Math.PI / 2).translate(0, layer.y, 0),
      m,
    );
    disc.name = `heartCollapseDepth:${i}`;
    disc.renderOrder = floorVfxRenderOrder('ground', 0) - 7 + (HEART_FALL_DEPTH.length - i);
    disc.position.copy(centre);
    depth.add(disc);
  }
  group.add(depth);
  // The ring: its cracks, and the abyss that ends the fight.
  // The ring's abyss stays what it was: nobody stands to see past it.
  const ringCrackMat = crackMaterial(
    'smithHeartCollapseRingCrack',
    0xffc070,
    0xffffff,
    HEART_RING_LOOK.wellR - 2,
    HEART_RING_LOOK.rimOut,
    false,
    false,
  );
  const ringCrack = new THREE.Mesh(
    annulusGeometry(HEART_RING_LOOK.wellR - 2, HEART_RING_LOOK.rimOut, 1.2),
    ringCrackMat,
  );
  ringCrack.name = 'heartCollapseRingCrack';
  ringCrack.position.copy(centre);
  ringCrack.renderOrder = floorVfxRenderOrder('ground', 6);
  ringCrack.visible = false;
  ringCrack.frustumCulled = false;
  group.add(ringCrack);
  const ringAbyssMat = abyssMaterial('smithHeartAbyss:ring', 0xffc070, 0xffffff);
  const ringAbyss = new THREE.Mesh(annulusGeometry(0, HEART_RING_LOOK.rimOut, 2.2), ringAbyssMat);
  ringAbyss.name = 'heartCollapseRingAbyss';
  ringAbyss.position.copy(centre);
  ringAbyss.visible = false;
  ringAbyss.frustumCulled = false;
  group.add(ringAbyss);

  const set = (u: THREE.IUniform, v: number) => {
    const k = Math.round(v * 1000) / 1000;
    if (u.value !== k) u.value = k;
  };
  const showLip = (m: THREE.Mesh, t: number) => {
    const on = t >= 0;
    if (m.visible !== on) m.visible = on;
    if (on) set((m.material as THREE.ShaderMaterial).uniforms.uHeat, Math.max(0, 1 - t / 5));
  };
  const paintSlabs = (s: SlabRig, t: number) => {
    if (!heartSlabsLive(t)) {
      if (s.mesh.visible) s.mesh.visible = false;
      s.written = -2;
      return;
    }
    if (t === s.written) return;
    s.written = t;
    s.mesh.visible = true;
    for (let i = 0; i < s.x.length; i++) {
      heartSlabPose(s.r[i], s.h[i], t, _pose);
      if (_pose.gone) {
        s.mesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
        continue;
      }
      // It tips about an axis on the floor, as if torn away on one side.
      _a.set(Math.cos(s.spin[i]), 0, Math.sin(s.spin[i]));
      _q.setFromAxisAngle(_a, _pose.turn);
      // Under the walk until it goes: rubble out of the breaks, never over a whole floor.
      _p.set(s.x[i], -0.7 - s.thick[i] * 0.5 - _pose.drop, s.z[i]);
      _s.set(s.w[i], s.thick[i], s.w[i]);
      _m.compose(_p, _q, _s);
      s.mesh.setMatrixAt(i, _m);
    }
    s.mesh.instanceMatrix.needsUpdate = true;
  };

  return {
    group,
    state,
    fallT: (v) => state.quarters[v].t,
    update(key, dt) {
      const view = heartCollapseView(key);
      stepHeartCollapse(state, view, dt);
      for (const vein of SMITH_HEART_VEINS) {
        const q = state.quarters[vein];
        const r = rigs.get(vein) as CollapseRig;
        const i = HEART_QUARTER_ORDER.indexOf(vein);
        const ccwT = state.quarters[HEART_QUARTER_ORDER[(i + 3) % 4]].t;
        const cwT = state.quarters[HEART_QUARTER_ORDER[(i + 1) % 4]].t;
        fall.paint(vein, q.t, ccwT, cwT);
        const down = q.t >= 0;
        // The warning stays lit over the floor while it leaves.
        const crack = Math.max(q.crack, heartFallEdgeLight(q.t));
        const lit = crack > 0.004;
        if (r.crack.visible !== lit) r.crack.visible = lit;
        if (lit) set(r.crackMat.uniforms.uCrack, crack);
        paintSlabs(r.slabs, q.t);
        const puff = down && q.t < HEART_COLLAPSE_LOOK.fallSeconds;
        if (r.dust.visible !== puff) r.dust.visible = puff;
        if (puff) set(r.dustMat.uniforms.uFall, q.t);
        // The ember line: hot at the break, then a steady glow.
        showLip(r.lipRing, q.t);
        showLip(r.lipCcw, down ? -1 : ccwT);
        showLip(r.lipCw, down ? -1 : cwT);
      }
      const anyDown = SMITH_HEART_VEINS.some((v) => state.quarters[v].t >= 0);
      if (depth.visible !== anyDown) depth.visible = anyDown;
      const rc = state.ringCrack > 0.004 && !state.ringBroken;
      if (ringCrack.visible !== rc) ringCrack.visible = rc;
      if (rc) set(ringCrackMat.uniforms.uCrack, state.ringCrack);
      if (ringAbyss.visible !== state.ringBroken) ringAbyss.visible = state.ringBroken;
    },
  };
}
