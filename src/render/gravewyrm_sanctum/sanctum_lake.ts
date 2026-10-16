// The Wyrm's Hollow: the frozen lake Korzul fights on (design sections 4,
// 6.3 and 8), and the old lake ice that runs on north to the foot of the
// Calving Face.
//
// The nineteen plates are ONE draw: every Voronoi cell of LAKE_PLATES
// (sanctum_lake_core.ts) triangulated into one mesh, its look computed in the
// fragment from the plate set itself (the shader finds the owning plate and
// the distance to its seam exactly as the core does), so the seams the eye
// reads are the seams phase B's plate floor owns. The ice is matte and
// readable, never a mirror: a frosted top over cloudy blue depth that darkens
// toward each plate's middle, bubble streams and milky veils drawn with a
// two-layer parallax, rime heaped white along the seams. Each plate's state
// (sound, cracked, broken) is one float in a uniform array
// (setSanctumPlateState), all sound today. Pressure ridges heave along the
// seams (Kit_PressureRidge, a knee high at most). The apron (render only, a
// little under the lake top) is snow-dusted broken lake ice with old calved
// blocks frozen in, ending in a broken ice-shelf edge over the crevasse, so
// the face stands in the lake. The ripple (triggerSanctumLakeRipple) is a
// ring of frost powder and glint racing out across both, uniform-driven.
//
// Built with the interior (linked by its compile gate); every material is
// module-cached and shared. No lights; cosmetic except the plates' state look,
// which is phase B's floor read and draws on every tier.

import * as THREE from 'three';
import { LAKE_PLATES, WYRMS_HOLLOW } from '../../sim/content/gravewyrm_sanctum_layout';
import { GFX, sharedUniforms } from '../gfx';
import { markSharedMaterial } from '../shared_resource';
import {
  instanceSanctumPlacements,
  mergeSanctumParts,
  registerSanctumFallback,
  type SanctumPart,
  upgradeWhenSanctumKitLands,
} from './sanctum_kit';
import {
  APRON_CELL,
  APRON_SKIRT_DEPTH,
  APRON_Y,
  apronCovers,
  apronHeight,
  FACE_HALF_WIDTH,
  faceFootZ,
  planApronBlocks,
  planLakeCells,
  planPressureRidges,
  RIPPLE,
} from './sanctum_lake_core';
import { sanctumHash, sanctumNoise } from './sanctum_plan_core';
import { iceCrystal } from './sanctum_shapes';

type Placement = Parameters<typeof instanceSanctumPlacements>[0][number];

/** The plates' top: a real height over the field's own ice top. */
export const LAKE_PLATE_Y = 0.04;

// ---- shared uniforms --------------------------------------------------------------

const centres = LAKE_PLATES.map((p) => new THREE.Vector2(p.x, p.z));
const plateState = { value: new Array<number>(LAKE_PLATES.length).fill(0) };
const ripples = {
  value: [new THREE.Vector4(0, 0, -100, 0), new THREE.Vector4(0, 0, -100, 0)],
};
let nextRipple = 0;

/** Set a plate's state for the floor look: 0 sound, 1 cracked, 2 broken
 *  (phase B's plate floor). A uniform write. */
export function setSanctumPlateState(index: number, state: number): void {
  if (index < 0 || index >= plateState.value.length) return;
  plateState.value[index] = Math.max(0, Math.min(2, Math.round(state)));
}

/** A ring of frost powder and glint racing out across the lake ice from
 *  (x, z), instance-local, starting at render time `now` (seconds). Two slots
 *  round-robin, so a second shock never cuts the first short. */
export function triggerSanctumLakeRipple(x: number, z: number, now: number): void {
  ripples.value[nextRipple].set(x, z, now, 1);
  nextRipple = (nextRipple + 1) % ripples.value.length;
}

// ---- GLSL ----------------------------------------------------------------------

const NOISE_GLSL = /* glsl */ `
float lhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float lnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(lhash(i), lhash(i + vec2(1.0, 0.0)), u.x),
             mix(lhash(i + vec2(0.0, 1.0)), lhash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float lfbm(vec2 p) {
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < 4; i++) { s += lnoise(p) * a; p = p * 2.03 + 17.0; a *= 0.5; }
  return s / 0.9375;
}
`;

const RIPPLE_GLSL = /* glsl */ `
uniform vec4 uRipple[2];
// The ripple's frost ring at p (the core's rippleAt, in GLSL).
float lakeRipple(vec2 p) {
  float rip = 0.0;
  for (int i = 0; i < 2; i++) {
    vec4 r = uRipple[i];
    float age = uTime - r.z;
    if (r.w < 0.5 || age <= 0.0 || age >= ${RIPPLE.life.toFixed(2)}) continue;
    float t = age / ${RIPPLE.life.toFixed(2)};
    float rad = ${RIPPLE.reach.toFixed(1)} * (1.0 - pow(max(1.0 - t, 0.0), 1.8));
    float str = pow(max(1.0 - t, 0.0), 1.4) * min(1.0, age / 0.15);
    float d = length(p - r.xy);
    float w = 1.6 + age * 2.4;
    float ring = exp(-pow(abs((d - rad) / w), 2.0));
    // A thin powder wake behind the front, broken up by the ice's grain.
    float wake = smoothstep(rad, rad - w * 4.0, d) * smoothstep(0.0, w * 6.0, rad - d + w * 6.0) * 0.22;
    rip += (ring + wake) * str * (0.55 + 0.45 * lfbm(p * 0.35 + age * 3.0));
  }
  return clamp(rip, 0.0, 1.0);
}
`;

const PLATE_COUNT = LAKE_PLATES.length;

function plateFragmentHead(): string {
  return /* glsl */ `
uniform float uTime;
uniform vec2 uCentres[${PLATE_COUNT}];
uniform float uPlateState[${PLATE_COUNT}];
uniform vec3 uLake;
varying vec3 vLakeLocal;
varying vec3 vLakeWorld;
${NOISE_GLSL}
${RIPPLE_GLSL}
// The owning plate (nearest centre) and the distance to its seam or rim.
float lakeEdge(vec2 p, out int own) {
  float best = 1e9;
  own = 0;
  for (int i = 0; i < ${PLATE_COUNT}; i++) {
    vec2 d = p - uCentres[i];
    float dd = dot(d, d);
    if (dd < best) { best = dd; own = i; }
  }
  float e = uLake.z - length(p - uLake.xy);
  vec2 o = uCentres[own];
  for (int i = 0; i < ${PLATE_COUNT}; i++) {
    if (i == own) continue;
    vec2 q = uCentres[i];
    vec2 dq = p - q;
    e = min(e, (dot(dq, dq) - best) / (2.0 * length(q - o)));
  }
  return e;
}
`;
}

// Linear colours: the plate's frosted top over cloudy blue depth.
const PLATE_COLOR_GLSL = /* glsl */ `
  vec2 lp = vLakeLocal.xz;
  int own;
  float edge = lakeEdge(lp, own);
  float lstate = uPlateState[own];
  vec3 lv = normalize(vLakeWorld - cameraPosition);
  float lk = 1.0 / max(0.3, -lv.y);
  vec2 par1 = lp + lv.xz * lk * 0.6;
  vec2 par2 = lp + lv.xz * lk * 1.7;
  float fown = float(own);
  float cloud = lfbm(par2 * 0.16 + fown * 3.7);
  float veil = lfbm(par1 * 0.42 + 11.0 + fown);
  float clearIce = smoothstep(1.0, 7.5, edge);
  vec3 deep = vec3(0.022, 0.085, 0.17);
  vec3 midIce = vec3(0.13, 0.30, 0.46);
  vec3 pale = vec3(0.40, 0.56, 0.68);
  vec3 frost = vec3(0.64, 0.74, 0.83);
  vec3 lakeCol = mix(midIce, deep, clearIce * smoothstep(0.3, 0.8, cloud) * 0.9);
  lakeCol = mix(lakeCol, pale, smoothstep(0.55, 0.9, veil) * 0.5);
  // Bubble streams caught in the ice (a little under the top).
  vec2 bp = par1 * 2.3;
  vec2 bi = floor(bp);
  vec2 bf = fract(bp) - 0.5 - (vec2(lhash(bi + 3.1), lhash(bi + 7.7)) - 0.5) * 0.5;
  float stream = smoothstep(0.6, 0.78, lfbm(vec2(lp.x * 0.09 + lp.y * 0.05, lp.y * 0.3) + 5.0));
  float bub = step(0.8, lhash(bi + fown)) * smoothstep(0.13, 0.03, length(bf)) * stream;
  lakeCol = mix(lakeCol, vec3(0.78, 0.86, 0.93), bub * 0.75);
  // The matte frosted top: rime heaped white near the seams, wind-polished
  // patches, hairline cracks.
  float rime = smoothstep(2.4, 0.15, edge);
  float dust = lfbm(lp * 0.8 + 21.0);
  float hair = 1.0 - smoothstep(0.0, 0.03, abs(lfbm(lp * 0.2 + 31.0 + fown) - 0.5));
  lakeCol = mix(lakeCol, frost, clamp(0.3 + 0.22 * dust + rime * 0.75, 0.0, 1.0));
  lakeCol = mix(lakeCol, vec3(0.86, 0.91, 0.96), hair * 0.32 * (1.0 - rime));
  // Phase B's plate states: cracked (an ember fracture web) and broken
  // (black water with floating chunks).
  float web = 0.0;
  if (lstate > 0.5 && lstate < 1.5) {
    float wl = abs(lfbm(lp * 0.32 + fown * 5.1) - 0.5);
    web = 1.0 - smoothstep(0.0, 0.045, wl);
    lakeCol = mix(lakeCol * 0.8, vec3(0.1, 0.05, 0.03), web * 0.6);
  } else if (lstate > 1.5) {
    float chunk = step(0.68, lfbm(lp * 0.45 + vec2(uTime * 0.03, 0.0)));
    lakeCol = mix(vec3(0.008, 0.015, 0.025), vec3(0.32, 0.44, 0.54), chunk * 0.7);
  }
  float lrip = lakeRipple(lp);
  lakeCol = mix(lakeCol, vec3(0.9, 0.94, 0.98), lrip * 0.65);
  diffuseColor.rgb = lakeCol;
`;

const PLATE_EMISSIVE_GLSL = /* glsl */ `
  totalEmissiveRadiance += vec3(1.0, 0.36, 0.07) * web * 1.5;
  totalEmissiveRadiance += vec3(0.5, 0.72, 0.95) * lrip * 0.55;
`;

const LAKE_VERTEX_HEAD = /* glsl */ `
varying vec3 vLakeLocal;
varying vec3 vLakeWorld;
`;

const LAKE_VERTEX_BODY = /* glsl */ `
  vLakeLocal = position;
  vLakeWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

function litMaterial(
  name: string,
  vertexColors: boolean,
): THREE.MeshStandardMaterial | THREE.MeshLambertMaterial {
  return GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({ name, vertexColors, roughness: 0.9, metalness: 0 })
    : new THREE.MeshLambertMaterial({ name, vertexColors });
}

let plateMat: THREE.Material | null = null;
let apronMat: THREE.Material | null = null;

function plateMaterial(): THREE.Material {
  if (plateMat) return plateMat;
  const m = litMaterial('sanctumLakePlates', false);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uCentres = { value: centres };
    shader.uniforms.uPlateState = plateState;
    shader.uniforms.uLake = {
      value: new THREE.Vector3(WYRMS_HOLLOW.x, WYRMS_HOLLOW.z, WYRMS_HOLLOW.lakeR),
    };
    shader.uniforms.uRipple = ripples;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${LAKE_VERTEX_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${LAKE_VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${plateFragmentHead()}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${PLATE_COLOR_GLSL}`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>\n${PLATE_EMISSIVE_GLSL}`,
      );
  };
  m.customProgramCacheKey = () => 'sanctumLakePlates';
  plateMat = markSharedMaterial(m);
  return m;
}

function apronMaterial(): THREE.Material {
  if (apronMat) return apronMat;
  const m = litMaterial('sanctumLakeApron', true);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uRipple = ripples;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${LAKE_VERTEX_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${LAKE_VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float uTime;\nvarying vec3 vLakeLocal;\nvarying vec3 vLakeWorld;\n${NOISE_GLSL}\n${RIPPLE_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
  float arip = lakeRipple(vLakeLocal.xz) * smoothstep(-3.0, -0.6, vLakeLocal.y);
  // Wind-blown frost glitter on the old ice.
  float glit = step(0.985, lhash(floor(vLakeLocal.xz * 3.0))) * 0.25;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.94, 0.98), arip * 0.6 + glit);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>\n  totalEmissiveRadiance += vec3(0.5, 0.72, 0.95) * arip * 0.5;`,
      );
  };
  m.customProgramCacheKey = () => 'sanctumLakeApron';
  apronMat = markSharedMaterial(m);
  return m;
}

// ---- the plates ----------------------------------------------------------------------

function buildPlates(): THREE.Mesh {
  const pos: number[] = [];
  const nor: number[] = [];
  const tri = (
    a: readonly [number, number],
    b: readonly [number, number],
    c: readonly [number, number],
  ) => {
    // Wind every triangle so its face looks up.
    const cross = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    const [p, q] = cross >= 0 ? [b, c] : [c, b];
    pos.push(a[0], LAKE_PLATE_Y, a[1], p[0], LAKE_PLATE_Y, p[1], q[0], LAKE_PLATE_Y, q[1]);
    nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
  };
  for (const cell of planLakeCells()) {
    const c: [number, number] = [cell.cx, cell.cz];
    const n = cell.poly.length;
    const inner = cell.poly.map(
      (p) => [c[0] + (p[0] - c[0]) * 0.55, c[1] + (p[1] - c[1]) * 0.55] as [number, number],
    );
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      tri(c, inner[i], inner[j]);
      tri(inner[i], cell.poly[i], cell.poly[j]);
      tri(inner[i], cell.poly[j], inner[j]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, plateMaterial());
  mesh.name = 'sanctumLakePlates';
  mesh.receiveShadow = true;
  return mesh;
}

// ---- the ridges and the calved blocks (kit pieces, stand-ins here) ------------------

/** A heap of broken ice blocks along x, 18 yd, under 0.8 tall. */
function ridgeStandIn(): SanctumPart[] {
  const out: SanctumPart[] = [];
  const m = new THREE.Matrix4();
  const e = new THREE.Euler();
  for (let k = 0; k < 15; k++) {
    const x = -8.6 + k * 1.23 + (sanctumHash(k, 3) - 0.5) * 0.6;
    const w = 0.7 + sanctumHash(k, 5) * 0.9;
    const h = 0.35 + sanctumHash(k, 7) * 0.4;
    const g = iceCrystal(w, h, 0.6 + sanctumHash(k, 9) * 0.7, k * 7 + 3, {
      sides: 6,
      boxy: 0.85,
      jitter: 0.25,
      foot: [0.3, 0.48, 0.62],
      top: [0.62, 0.74, 0.84],
    });
    e.set(
      (sanctumHash(k, 11) - 0.5) * 0.9,
      sanctumHash(k, 13) * Math.PI,
      (sanctumHash(k, 15) - 0.5) * 0.7,
    );
    m.makeRotationFromEuler(e).setPosition(x, -0.08, (sanctumHash(k, 17) - 0.5) * 0.7);
    g.applyMatrix4(m);
    out.push({ slot: 'stone', g });
  }
  return out;
}

/** An old calved slab frozen in at its waterline (y 0), tipped. */
function chunkStandIn(size: number, seed: number): () => SanctumPart[] {
  return () => {
    const g = iceCrystal(size * 1.4, size * 0.9, size, seed, {
      sides: 8,
      boxy: 0.75,
      jitter: 0.3,
      foot: [0.12, 0.3, 0.46],
      top: [0.5, 0.68, 0.82],
    });
    g.applyMatrix4(
      new THREE.Matrix4()
        .makeRotationFromEuler(new THREE.Euler(0.35, 0.2, -0.25))
        .setPosition(0, -size * 0.45, 0),
    );
    return [{ slot: 'stone', g }];
  };
}

registerSanctumFallback('Kit_PressureRidge', ridgeStandIn);
registerSanctumFallback('Kit_IceChunkA', chunkStandIn(4.2, 61));
registerSanctumFallback('Kit_IceChunkB', chunkStandIn(2.8, 63));
registerSanctumFallback('Kit_IceChunkC', chunkStandIn(1.9, 65));

function planLakeKit(lowGfx: boolean): Placement[] {
  const out: Placement[] = [];
  for (const r of planPressureRidges()) {
    out.push({
      piece: 'Kit_PressureRidge',
      x: r.x,
      z: r.z,
      y: LAKE_PLATE_Y - 0.06,
      rot: r.rot,
      scale: 1,
      stretch: r.stretch,
      scaleY: r.scaleY,
    } as Placement);
  }
  for (const b of planApronBlocks(lowGfx)) {
    out.push({
      piece: b.piece,
      x: b.x,
      z: b.z,
      y: apronHeight(b.x, b.z),
      rot: b.rot,
      scale: b.scale,
    } as Placement);
  }
  return out;
}

// ---- the apron ---------------------------------------------------------------------

type Rgb = [number, number, number];

function apronTopColor(x: number, z: number): Rgb {
  const scour = sanctumNoise(x * 0.07, z * 0.07, 61, 3);
  const grain = sanctumNoise(x * 0.4, z * 0.4, 63, 2);
  const snow: Rgb = [0.7, 0.78, 0.86];
  const ice: Rgb = [0.17, 0.36, 0.52];
  // Wind-scoured to blue ice in streaks along the wind; snow elsewhere,
  // heavier in the debris at the face's foot.
  const foot = Math.max(0, 1 - (faceFootZ(x) - z) / 14);
  const k = Math.min(1, Math.max(0, (scour - 0.42) * 3.2) * (1 - foot * 0.7));
  const crack = Math.max(0, 1 - Math.abs(sanctumNoise(x * 0.11, z * 0.11, 67, 2) - 0.5) / 0.03);
  const s = 0.93 + grain * 0.12;
  const out: Rgb = [
    (snow[0] + (ice[0] - snow[0]) * k) * s,
    (snow[1] + (ice[1] - snow[1]) * k) * s,
    (snow[2] + (ice[2] - snow[2]) * k) * s,
  ];
  const ck = crack * 0.5 * (1 - foot);
  return [
    out[0] * (1 - ck) + 0.06 * ck,
    out[1] * (1 - ck) + 0.15 * ck,
    out[2] * (1 - ck) + 0.26 * ck,
  ];
}

function buildApron(lowGfx: boolean): THREE.Mesh {
  const cell = lowGfx ? APRON_CELL * 2 : APRON_CELL;
  const x0 = -FACE_HALF_WIDTH - 10;
  const z0 = WYRMS_HOLLOW.z - 16;
  const nx = Math.ceil((FACE_HALF_WIDTH * 2 + 20) / cell);
  const nz = Math.ceil((262 - z0) / cell);
  const covered = (i: number, j: number): boolean =>
    i >= 0 &&
    j >= 0 &&
    i < nx &&
    j < nz &&
    apronCovers(x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell);
  // The top: one indexed grid sharing its corners (smooth heave).
  const cornerIndex = new Map<number, number>();
  const tPos: number[] = [];
  const tCol: number[] = [];
  const tIdx: number[] = [];
  const corner = (i: number, j: number): number => {
    // j runs 0..nz inclusive, so a stride of nz + 1 keys every corner uniquely.
    const key = i * (nz + 1) + j;
    let v = cornerIndex.get(key);
    if (v !== undefined) return v;
    const x = x0 + i * cell;
    const z = z0 + j * cell;
    v = tPos.length / 3;
    tPos.push(x, apronHeight(x, z), z);
    tCol.push(...apronTopColor(x, z));
    cornerIndex.set(key, v);
    return v;
  };
  // The broken shelf edge: walls down into the crevasse where the apron
  // meets open air (never under the face, never against the shelf).
  const sPos: number[] = [];
  const sCol: number[] = [];
  const wall = (ax: number, az: number, bx: number, bz: number, seed: number) => {
    const ay = apronHeight(ax, az);
    const by = apronHeight(bx, bz);
    const da = APRON_SKIRT_DEPTH * (0.7 + 0.5 * sanctumHash(ax * 0.7, az * 0.3));
    const db = APRON_SKIRT_DEPTH * (0.7 + 0.5 * sanctumHash(bx * 0.7, bz * 0.3));
    const lip = 0.9 + sanctumHash(seed, 3) * 0.8;
    // Two bands: a pale fresh lip, then the blue face falling into the dark.
    const rows: [number, number, Rgb][] = [
      [0, 0, [0.7, 0.8, 0.88]],
      [lip, lip, [0.24, 0.46, 0.62]],
      [da * 0.45, db * 0.45, [0.09, 0.24, 0.4]],
      [da, db, [0.02, 0.06, 0.12]],
    ];
    for (let r = 0; r < rows.length - 1; r++) {
      const [a0, b0, c0] = rows[r];
      const [a1, b1, c1] = rows[r + 1];
      const p00 = [ax, ay - a0, az];
      const p10 = [bx, by - b0, bz];
      const p01 = [ax, ay - a1, az];
      const p11 = [bx, by - b1, bz];
      sPos.push(...p00, ...p01, ...p11, ...p00, ...p11, ...p10);
      sCol.push(...c0, ...c1, ...c1, ...c0, ...c1, ...c0);
    }
  };
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      if (!covered(i, j)) continue;
      const a = corner(i, j);
      const b = corner(i + 1, j);
      const c = corner(i + 1, j + 1);
      const d = corner(i, j + 1);
      tIdx.push(a, d, c, a, c, b);
      const cx = x0 + (i + 0.5) * cell;
      const cz = z0 + (j + 0.5) * cell;
      const open = (di: number, dj: number): boolean => {
        if (covered(i + di, j + dj)) return false;
        const ox = cx + di * cell;
        const oz = cz + dj * cell;
        // Against the shelf's own cliff or under the face: no wall.
        if (Math.hypot(ox - WYRMS_HOLLOW.x, oz - WYRMS_HOLLOW.z) < WYRMS_HOLLOW.shelfR + 1.5)
          return false;
        return oz < faceFootZ(ox) - 0.5;
      };
      const x1 = x0 + i * cell;
      const z1 = z0 + j * cell;
      // Each wall faces out of the apron (wound so its face looks outward).
      if (open(0, -1)) wall(x1 + cell, z1, x1, z1, i + j * 7);
      if (open(0, 1)) wall(x1, z1 + cell, x1 + cell, z1 + cell, i + j * 11);
      if (open(-1, 0)) wall(x1, z1, x1, z1 + cell, i * 3 + j);
      if (open(1, 0)) wall(x1 + cell, z1 + cell, x1 + cell, z1, i * 5 + j);
    }
  }
  const top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.Float32BufferAttribute(tPos, 3));
  top.setAttribute('color', new THREE.Float32BufferAttribute(tCol, 3));
  top.setIndex(tIdx);
  top.computeVertexNormals();
  const parts = [top];
  if (sPos.length > 0) {
    const skirt = new THREE.BufferGeometry();
    skirt.setAttribute('position', new THREE.Float32BufferAttribute(sPos, 3));
    skirt.setAttribute('color', new THREE.Float32BufferAttribute(sCol, 3));
    skirt.computeVertexNormals();
    parts.push(skirt);
  }
  const geo = mergeSanctumParts(parts);
  for (const p of parts) p.dispose();
  const mesh = new THREE.Mesh(geo, apronMaterial());
  mesh.name = 'sanctumLakeApron';
  mesh.receiveShadow = true;
  return mesh;
}

/** The whole lake: the plates, the ridges, the apron and its calved blocks
 *  (instance-local frame). */
export function buildSanctumLake(lowGfx: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'sanctumLake';
  group.add(buildPlates());
  group.add(buildApron(lowGfx));
  const kit = instanceSanctumPlacements(planLakeKit(lowGfx), lowGfx, 'sanctumLakeKit');
  group.add(kit);
  upgradeWhenSanctumKitLands(kit, () =>
    instanceSanctumPlacements(planLakeKit(lowGfx), lowGfx, 'sanctumLakeKit'),
  );
  return group;
}

/** The apron's lowest point, for callers placing scenery under it. */
export const SANCTUM_APRON_BOTTOM = APRON_Y - APRON_SKIRT_DEPTH * 1.2;
