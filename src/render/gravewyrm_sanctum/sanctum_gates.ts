// The Gravewyrm Sanctum's gates and seals as structures, on the kit
// (sanctum_kit.ts) with procedural stand-ins until it lands:
//   - ice_wall (the Rime Gate, the Tithe Gate): a wall of clear glacier ice in
//     rimed slate jambs. Opening, cracks race over it in a cold glow, then its
//     seven shards (Kit_IceWall_A..G) let go top first, topple and fall in a
//     burst of ice dust, and lie broken at the sides of the way.
//   - chain_gate (the West and East Chain Stairs): a forged grate on two great
//     chains between seal-stone posts under a rune lintel. Opening, the chains
//     take the weight with a jerk and hoist it up into the lintel, frost
//     shaking off the bars; sealed (Korgath engaged) it slams down and the
//     Smith's runes over its bars burn rune blue, pulsing.
//   - chain_bridge (the Chain Bridge): the Smith's mast-thick chain hangs
//     slack from the Lock Terrace's rim down into the crevasse; opening, it is
//     hauled up and falls across the gulf, lands on the Thaw Works' rim in a
//     burst of frost, hauls out taut with a last shudder, and the rime freezes
//     up through its links into the walkway, its top exactly on the sim's
//     path (what you see is what you stand on).
//   - rite_ward (the Vault Ward, the Hollow Ward): a curtain of the cult's
//     soulfire, violet-green, between two iron ward stakes; it gutters out
//     when it opens and flares brighter and denser when sealed.
//
// Each gate reads its on-screen state from the shared gate memory
// (../hollow_crypt/crypt_gate_state_core.ts, fed by the mirrored gate entities
// through ../gate_objects.ts) in ONE onBeforeRender hook on a mesh that
// always draws, and plays its reveal on its own slow clock
// (sanctum_gates_core.ts). Every material is built with the interior (the
// compile gate links it); no lights.

import * as THREE from 'three';
import { GRAVEWYRM_SANCTUM_GATES } from '../../sim/content/gravewyrm_sanctum';
import type { DungeonGateDef } from '../../sim/types';
import { sharedUniforms } from '../gfx';
import { gateMemoryKey, gateView } from '../hollow_crypt/crypt_gate_state_core';
import { markSharedMaterial } from '../shared_resource';
import { radialGlowTexture } from '../textures';
import {
  CHAIN_BRIDGE_DECK,
  CHAIN_BRIDGE_LAND,
  CHAIN_GATE,
  chainBridgeCrust,
  chainBridgeDeckAt,
  chainBridgeDeckHeight,
  chainBridgeLength,
  chainBridgePoint,
  chainGateLift,
  ICE_WALL,
  ICE_WALL_FALL_START,
  ICE_WALL_PIECES,
  iceWallCell,
  iceWallCellCentre,
  iceWallCracks,
  iceWallShardPose,
  riteWardCharge,
  SANCTUM_GATE_SECONDS,
  SanctumGateClock,
  type SanctumGateRigKind,
  sanctumGateRig,
} from './sanctum_gates_core';
import {
  mergeSanctumParts,
  registerSanctumFallback,
  SANCTUM_SLOTS,
  type SanctumPart,
  sanctumKitMeshes,
  sanctumPieceGeometry,
  sanctumSlotMaterial,
  upgradeWhenSanctumKitLands,
} from './sanctum_kit';
import { sanctumHash } from './sanctum_plan_core';
import {
  chainLinkGeometry,
  iceCrystal,
  type Rgb,
  ringLoft,
  rockLump,
  snowDrift,
} from './sanctum_shapes';

interface GateRig {
  root: THREE.Group;
  /** The one mesh that always draws: it carries the gate's render hook. */
  driver: THREE.Object3D;
  /** True when the rig places itself in the instance frame (the bridge). */
  absolute?: boolean;
  /** Called once per rendered frame with the gate memory's view. */
  apply(openness: number, seal: number, since: number, open: boolean): void;
}

/** Push a node's own matrix and its descendants' world matrices (the rigs
 *  move inside an onBeforeRender, after the scene's matrix pass). */
function settle(node: THREE.Object3D): void {
  node.updateMatrix();
  if (node.parent) node.matrixWorld.multiplyMatrices(node.parent.matrixWorld, node.matrix);
  else node.matrixWorld.copy(node.matrix);
  for (const c of node.children) settle(c);
}

// ---- colours (linear) --------------------------------------------------------------------

const IRON: Rgb = [0.045, 0.048, 0.056];
const IRON_WORN: Rgb = [0.11, 0.115, 0.13];
const SEAL_STONE: Rgb = [0.06, 0.066, 0.082];
const SEAL_EDGE: Rgb = [0.12, 0.13, 0.15];
const RIME: Rgb = [0.78, 0.85, 0.92];
const LEATHER: Rgb = [0.13, 0.08, 0.05];
const SOOT: Rgb = [0.025, 0.024, 0.026];
const RUNE_DIM: Rgb = [0.06, 0.24, 0.5];
const SOUL: Rgb = [0.32, 0.95, 0.55];

const box = (w: number, h: number, d: number, x = 0, y = h / 2, z = 0) =>
  new THREE.BoxGeometry(w, h, d).translate(x, y, z);

/** Rime on every up-facing face of a part (in place). */
function rimed(g: THREE.BufferGeometry, base: Rgb, rime = 0.75): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  n.computeVertexNormals();
  const nor = n.getAttribute('normal');
  const col = new Float32Array(nor.count * 3);
  for (let i = 0; i < nor.count; i++) {
    const k = Math.max(0, Math.min(1, (nor.getY(i) - 0.45) * 2.4)) * rime;
    col[i * 3] = base[0] + (RIME[0] - base[0]) * k;
    col[i * 3 + 1] = base[1] + (RIME[1] - base[1]) * k;
    col[i * 3 + 2] = base[2] + (RIME[2] - base[2]) * k;
  }
  n.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return n;
}

// ---- stand-ins ----------------------------------------------------------------------------

/** One ice wall shard: its voronoi cell extruded through the wall, the front
 *  cut in three facets that bulge toward +z, rime on its top edge. */
function shardParts(i: number): SanctumPart[] {
  const cell = iceWallCell(i);
  const [cx, cy] = iceWallCellCentre(i);
  const t = ICE_WALL.thick / 2;
  const gap = 0.05;
  const ring = cell.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const l = Math.hypot(dx, dy) || 1;
    return [x - (dx / l) * gap, y - (dy / l) * gap] as [number, number];
  });
  const mid = ring.map(([x, y], k) => [
    cx + (x - cx) * 0.55,
    cy + (y - cy) * 0.55,
    t + 0.28 + sanctumHash(i, k) * 0.24,
  ]);
  const apexZ = t + 0.5 + sanctumHash(i, 9) * 0.2;
  const v: number[] = [];
  const n = ring.length;
  for (let k = 0; k < n; k++) {
    const a = ring[k];
    const b = ring[(k + 1) % n];
    const ma = mid[k];
    const mb = mid[(k + 1) % n];
    const za = t + (sanctumHash(i + k, 3) - 0.5) * 0.2;
    const zb = t + (sanctumHash(i + ((k + 1) % n), 3) - 0.5) * 0.2;
    // Front: outer band and the inner fan to the apex.
    v.push(a[0], a[1], za, b[0], b[1], zb, mb[0], mb[1], mb[2]);
    v.push(a[0], a[1], za, mb[0], mb[1], mb[2], ma[0], ma[1], ma[2]);
    v.push(ma[0], ma[1], ma[2], mb[0], mb[1], mb[2], cx, cy, apexZ);
    // Back (flat, a hair rough) and the fracture sides.
    v.push(a[0], a[1], -t, cx, cy, -t - 0.15, b[0], b[1], -t);
    v.push(a[0], a[1], -t, b[0], b[1], -t, b[0], b[1], zb);
    v.push(a[0], a[1], -t, b[0], b[1], zb, a[0], a[1], za);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const col = new Float32Array(pos.count * 3);
  for (let q = 0; q < pos.count; q++) {
    const y = pos.getY(q);
    const z = pos.getZ(q);
    // Clear deep blue in the thick of it, paler at the fracture edges, rime
    // on the top and along any face turned up.
    const depth = Math.min(1, Math.max(0, (z + t) / (2 * t + 0.6)));
    let c: Rgb = [0.1 + depth * 0.14, 0.3 + depth * 0.2, 0.48 + depth * 0.18];
    const up = nor.getY(q);
    const rime = Math.max(0, (up - 0.4) * 2) + Math.max(0, (y - ICE_WALL.height + 0.6) * 1.2);
    const k = Math.min(1, rime);
    c = [c[0] + (RIME[0] - c[0]) * k, c[1] + (RIME[1] - c[1]) * k, c[2] + (RIME[2] - c[2]) * k];
    col.set(c, q * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return [{ slot: 'stone', g }];
}

function registerStandIns(): void {
  for (const [i, piece] of ICE_WALL_PIECES.entries()) {
    registerSanctumFallback(piece, () => shardParts(i));
  }
  // The ice wall's jambs: a rimed slate buttress with a glacier spur
  // leaning on it, snow drifted at the foot.
  registerSanctumFallback('SanctumGate_IceJamb', () => [
    { slot: 'stone', g: rockLump(3.4, 14.5, 3.8, 71, [0.07, 0.075, 0.09]) },
    {
      slot: 'stone',
      g: iceCrystal(2.6, 10.5, 2.6, 73, { boxy: 0.3, leanX: 0.6, sides: 8 }).translate(0.4, 0, 1.2),
    },
    { slot: 'stone', g: snowDrift(4.6, 1.3, 2.2, 75).translate(0, 0, 1.6) },
  ]);
  // The Chain Stair's grate: forged square bars with spiked feet on three
  // riveted bands, a top beam with two lifting eyes, rime on every ledge.
  registerSanctumFallback('Kit_ChainGate', () => {
    const parts: SanctumPart[] = [];
    for (let k = 0; k < 13; k++) {
      const x = -4.8 + k * 0.8;
      parts.push({ slot: 'stone', g: rimed(box(0.24, 7.6, 0.24, x, 0.4 + 3.8), IRON) });
      parts.push({
        slot: 'stone',
        g: rimed(new THREE.ConeGeometry(0.17, 0.6, 4).rotateX(Math.PI).translate(x, 0.3, 0), IRON),
      });
    }
    for (const y of [0.8, 3.6, 6.4]) {
      parts.push({ slot: 'stone', g: rimed(box(10, 0.36, 0.34, 0, y, -0.05), IRON_WORN) });
    }
    parts.push({ slot: 'stone', g: rimed(box(10.4, 0.55, 0.55, 0, 7.95), IRON_WORN) });
    for (const x of [-CHAIN_GATE.eyeX, CHAIN_GATE.eyeX]) {
      parts.push({
        slot: 'stone',
        g: rimed(new THREE.TorusGeometry(0.38, 0.11, 6, 12).translate(x, CHAIN_GATE.eyeY, 0), IRON),
      });
    }
    return parts;
  });
  // A Chain Stair post: a shaft of black seal stone with a flared foot and a
  // capstone, the chain wheel on its -x face, dim runes down that face.
  registerSanctumFallback('Kit_ChainGatePost', () => {
    const shaft = ringLoft(
      [
        [2.0, 0],
        [2.0, 0.8],
        [1.55, 0.9],
        [1.42, 5],
        [1.36, 10.1],
        [1.85, 10.2],
        [1.85, 10.95],
        [1.4, 11.2],
      ],
      4,
      81,
      (y) => (y < 0.9 || y > 10.15 ? SEAL_EDGE : SEAL_STONE),
      0.04,
    ).rotateY(Math.PI / 4);
    const drum = ringLoft(
      [
        [0.95, -0.12],
        [0.95, 0],
        [0.6, 0.02],
        [0.6, 0.86],
        [0.95, 0.88],
        [0.95, 1.0],
      ],
      14,
      83,
      () => IRON,
      0,
    )
      .rotateZ(Math.PI / 2)
      .translate(-1.05, 9.4, 0);
    const parts: SanctumPart[] = [
      { slot: 'stone', g: rimed(shaft, SEAL_STONE, 0.6) },
      { slot: 'stone', g: rimed(drum, IRON) },
      {
        slot: 'stone',
        g: rimed(iceCrystal(2.6, 0.45, 2.6, 85, { boxy: 0.95 }), RIME, 1).translate(0, 11.15, 0),
      },
    ];
    for (let k = 0; k < 5; k++) {
      parts.push({ slot: 'glow', g: box(0.05, 0.42, 0.14, -1.42, 2.6 + k * 1.2), rgb: RUNE_DIM });
    }
    return parts;
  });
  // The lintel the grate rises into: one rough-hewn block of seal stone
  // across both posts, a band of the Smith's runes, snow on its back.
  registerSanctumFallback('SanctumGate_ChainLintel', () => [
    {
      slot: 'stone',
      g: rimed(rockLump(15.4, 5.6, 3.8, 87, SEAL_STONE, RIME, 2), SEAL_STONE, 0.7),
    },
    { slot: 'stone', g: snowDrift(13, 0.9, 1.6, 89).translate(0, 4.4, -0.3) },
    { slot: 'glow', g: box(9, 0.16, 0.08, 0, 2.6, 1.72), rgb: RUNE_DIM },
  ]);
  // One mast-thick link of the Smith's chain (Kit_ChainLink's contract: 9.25
  // long along x, standing in the xy plane, origin at its middle).
  registerSanctumFallback('Kit_ChainLink', () => [
    { slot: 'stone', g: rimed(chainLinkGeometry(CHAIN_BRIDGE_DECK.linkLength, 0.75), IRON_WORN) },
  ]);
  // A small link for the grate's hoist chains.
  registerSanctumFallback('SanctumGate_HoistLink', () => [
    { slot: 'stone', g: rimed(chainLinkGeometry(0.9, 0.11).rotateZ(Math.PI / 2), IRON, 0.5) },
  ]);
  // The bridge's bollards: an iron bollard with a ring, its cap rimed.
  registerSanctumFallback('SanctumGate_BridgeBollard', () => [
    {
      slot: 'stone',
      g: rimed(
        ringLoft(
          [
            [0.75, 0],
            [0.8, 0.3],
            [0.56, 0.42],
            [0.5, 1.6],
            [0.72, 1.74],
            [0.68, 2.0],
            [0.3, 2.18],
          ],
          10,
          91,
          () => IRON,
          0.03,
        ),
        IRON,
      ),
    },
    {
      slot: 'stone',
      g: rimed(new THREE.TorusGeometry(0.42, 0.12, 6, 12).translate(0, 1.1, 0.62), IRON_WORN),
    },
  ]);
  // A cult ward stake: an iron stake wrapped in leather and soot, a cage at
  // its head with the soulfire ember burning in it.
  registerSanctumFallback('SanctumGate_WardPost', () => {
    const stake = ringLoft(
      [
        [0.62, 0],
        [0.58, 0.35],
        [0.26, 0.55],
        [0.22, 2.2],
        [0.3, 2.3],
        [0.3, 3.1],
        [0.22, 3.2],
        [0.2, 5.6],
        [0.46, 5.75],
        [0.42, 5.95],
        [0.12, 6.1],
      ],
      8,
      93,
      (y) => (y > 2.2 && y < 3.2 ? LEATHER : y < 0.5 ? SOOT : IRON),
      0.05,
    );
    const parts: SanctumPart[] = [{ slot: 'stone', g: rimed(stake, IRON, 0.4) }];
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      parts.push({
        slot: 'stone',
        g: box(0.08, 1.4, 0.08, Math.cos(a) * 0.42, 6.75, Math.sin(a) * 0.42),
        rgb: IRON,
      });
    }
    parts.push({ slot: 'stone', g: box(1.0, 0.1, 1.0, 0, 7.48), rgb: IRON });
    parts.push({
      slot: 'glow',
      g: iceCrystal(0.55, 0.85, 0.55, 95, { boxy: 0.2, sides: 6 }).translate(0, 6.1, 0),
      rgb: SOUL,
    });
    return parts;
  });
}

registerStandIns();

// ---- shared GLSL ---------------------------------------------------------------------------

const NOISE_GLSL = /* glsl */ `
float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), u.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float gFbm(vec2 p) {
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < 4; i++) { s += gNoise(p) * a; p *= 2.03; a *= 0.5; }
  return s;
}
`;

const SHEET_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// ---- the dust and frost bursts ---------------------------------------------------------------

const BURST_VERT = /* glsl */ `
attribute vec3 aBase;
attribute vec4 aSeed;
uniform float uAge;
uniform float uLife;
uniform float uLift;
uniform float uSpread;
uniform float uSize;
varying float vFade;
varying vec2 vQuad;
void main() {
  float age = uAge - aSeed.w * 0.25;
  vQuad = position.xy + 0.5;
  if (age < 0.0 || age > uLife) {
    vFade = 0.0;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec3 vel = vec3((aSeed.x - 0.5) * uSpread, uLift * (0.4 + aSeed.y), (aSeed.z - 0.5) * uSpread);
  // Ice dust slows in the air (drag) and sinks.
  float drag = (1.0 - exp(-age * 1.6)) / 1.6;
  vec3 p = aBase + vel * drag + vec3(0.0, -1.2 * age * age, 0.0);
  float t = age / uLife;
  vFade = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.45, 1.0, t));
  float size = uSize * (0.5 + 1.6 * t) * (0.6 + 0.8 * aSeed.y);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;
}
`;

const BURST_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
varying float vFade;
varying vec2 vQuad;
void main() {
  float r = length(vQuad - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.35, 1.0, r)) * vFade * 0.55;
  if (a <= 0.004) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

interface Burst {
  mesh: THREE.Mesh;
  uniforms: { uAge: { value: number } };
}

/** A burst of ice dust or frost: `count` motes spawned over `spots` (local
 *  frame), alive `life` seconds from uAge 0. One instanced draw. */
function makeBurst(
  name: string,
  spots: (k: number) => [number, number, number],
  count: number,
  opts: { life: number; lift: number; spread: number; size: number; color: number },
): Burst {
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  const base = new Float32Array(count * 3);
  const seed = new Float32Array(count * 4);
  for (let k = 0; k < count; k++) {
    base.set(spots(k), k * 3);
    seed.set(
      [sanctumHash(k, 1.3), sanctumHash(k, 2.9), sanctumHash(k, 4.1), sanctumHash(k, 6.7)],
      k * 4,
    );
  }
  geo.setAttribute('aBase', new THREE.InstancedBufferAttribute(base, 3));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  geo.instanceCount = count;
  quad.dispose();
  const uniforms = {
    uAge: { value: -1 },
    uLife: { value: opts.life },
    uLift: { value: opts.lift },
    uSpread: { value: opts.spread },
    uSize: { value: opts.size },
    uColor: { value: new THREE.Color(opts.color) },
  };
  const mesh = new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({
      name: 'sanctumGateBurst',
      vertexShader: BURST_VERT,
      fragmentShader: BURST_FRAG,
      uniforms,
      transparent: true,
      depthWrite: false,
    }),
  );
  mesh.name = name;
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}

// ---- the ice wall --------------------------------------------------------------------------

const CRACK_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uCrack;
uniform float uAlpha;
uniform float uSeal;
uniform float uTime;
uniform vec2 uSeeds[7];
${NOISE_GLSL}
void main() {
  if (uAlpha <= 0.002 || (uCrack <= 0.002 && uSeal <= 0.002)) discard;
  vec2 p = vec2((vUv.x - 0.5) * ${(ICE_WALL.half * 2).toFixed(1)}, vUv.y * ${ICE_WALL.height.toFixed(1)});
  vec2 q = p + (vec2(gNoise(p * 1.7), gNoise(p * 1.7 + 9.1)) - 0.5) * 0.5;
  float d1 = 1e5; float d2 = 1e5;
  for (int i = 0; i < 7; i++) {
    float d = length(q - uSeeds[i]);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  float edge = d2 - d1;
  // The fracture lines (the shards' own borders) and a web of fine cracks.
  float line = smoothstep(0.16, 0.0, edge);
  float fine = smoothstep(0.06, 0.0, abs(gFbm(q * 2.3) - 0.5)) * 0.45;
  // They race out from the first blow, low in the middle of the wall.
  float reach = length(p - vec2(0.3, 3.4)) / 11.0;
  float raced = smoothstep(reach, reach - 0.08, uCrack);
  vec3 glow = vec3(0.45, 0.82, 1.0) * (line * 1.4 + fine) * raced;
  // A seal (never in data, handled all the same): the wall burns rune blue.
  vec3 rune = vec3(0.1, 0.42, 1.0) * uSeal * (0.25 + line * 0.9);
  vec3 col = (glow + rune) * uAlpha;
  float a = max(col.r, max(col.g, col.b));
  if (a <= 0.003) discard;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

function iceWall(gate: DungeonGateDef): GateRig {
  const clock = new SanctumGateClock(SANCTUM_GATE_SECONDS.iceWall);
  const sx = gate.hw / ICE_WALL.half;
  const sy = 1.12;
  const wall = new THREE.Group();
  wall.scale.set(sx, sy, 1);
  // Each shard on a pivot at its cell's centre, so it tumbles about itself.
  const pivots = ICE_WALL_PIECES.map((piece, i) => {
    const [cx, cy] = iceWallCellCentre(i);
    const pivot = new THREE.Group();
    pivot.position.set(cx, cy, 0);
    const meshes = sanctumKitMeshes(piece);
    meshes.position.set(-cx, -cy, 0);
    pivot.add(meshes);
    wall.add(pivot);
    return { pivot, cx, cy };
  });
  const u = {
    uCrack: { value: 0 },
    uAlpha: { value: 1 },
    uSeal: { value: 0 },
    uTime: sharedUniforms.uTime,
    uSeeds: { value: ICE_WALL.seeds.map(([x, y]) => new THREE.Vector2(x, y)) },
  };
  const crackMat = new THREE.ShaderMaterial({
    name: 'sanctumIceWallCracks',
    vertexShader: SHEET_VERT,
    fragmentShader: CRACK_FRAG,
    uniforms: u,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const sheetGeo = new THREE.PlaneGeometry(ICE_WALL.half * 2, ICE_WALL.height).translate(
    0,
    ICE_WALL.height / 2,
    0,
  );
  const front = new THREE.Mesh(sheetGeo, crackMat);
  front.position.z = ICE_WALL.thick / 2 + 0.62;
  front.frustumCulled = false;
  const back = new THREE.Mesh(sheetGeo, crackMat);
  back.position.z = -ICE_WALL.thick / 2 - 0.2;
  wall.add(front, back);
  const dust = makeBurst(
    'sanctumIceWallDust',
    (k) => [
      (sanctumHash(k, 11) - 0.5) * ICE_WALL.half * 2,
      sanctumHash(k, 13) * ICE_WALL.height,
      (sanctumHash(k, 17) - 0.5) * 3,
    ],
    90,
    { life: 3.4, lift: 1.6, spread: 7, size: 1.9, color: 0xdcecf8 },
  );
  wall.add(dust.mesh);
  const root = new THREE.Group();
  root.add(wall);
  // The jambs stand outside the wall's span, unscaled.
  for (const side of [-1, 1]) {
    const jamb = sanctumKitMeshes('SanctumGate_IceJamb');
    jamb.position.set(side * (gate.hw + 1.4), -0.4, 0);
    jamb.rotation.y = side > 0 ? Math.PI : 0;
    root.add(jamb);
  }
  const q = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  let lastK = -1;
  return {
    root,
    driver: front,
    apply(openness, seal, since, open) {
      const k = clock.step(openness, since, open);
      u.uCrack.value = iceWallCracks(k);
      u.uSeal.value = seal;
      u.uAlpha.value = Math.max(0, 1 - Math.max(0, k - ICE_WALL_FALL_START) * 4);
      // The dust bursts as the shards fall (only on a played opening).
      const fallAt = ICE_WALL_FALL_START * SANCTUM_GATE_SECONDS.iceWall.open;
      dust.uniforms.uAge.value = open && clock.played && since >= fallAt ? since - fallAt : -1;
      if (k === lastK) return;
      lastK = k;
      for (const [i, s] of pivots.entries()) {
        const pose = iceWallShardPose(i, k);
        s.pivot.position.set(s.cx + pose.dx, s.cy + pose.dy, pose.dz);
        axis.set(pose.ax, pose.ay, pose.az);
        q.setFromAxisAngle(axis, pose.angle);
        s.pivot.quaternion.copy(q);
      }
      settle(wall);
    },
  };
}

// ---- the chain gate ------------------------------------------------------------------------

const RUNE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uSeal;
uniform float uTime;
${NOISE_GLSL}
void main() {
  if (uSeal <= 0.002) discard;
  // The Smith's runes worked into the grate: angular strokes in a band across
  // each bar's height, burning rune blue while a boss holds the stair.
  vec2 g = vec2(vUv.x * 13.0, vUv.y * 9.0);
  vec2 c = fract(g) - 0.5;
  vec2 cell = floor(g);
  float h = gHash(cell);
  float stroke = smoothstep(0.08, 0.0, abs(c.x + (h - 0.5) * c.y * 1.4)) * step(abs(c.y), 0.36);
  float bar = step(0.5, gHash(cell + 3.1)) * stroke;
  float hum = 0.75 + 0.25 * sin(uTime * 5.0 + cell.y * 0.7);
  vec3 col = vec3(0.12, 0.5, 1.0) * (bar * 1.6 + 0.08) * uSeal * hum;
  float a = max(col.r, max(col.g, col.b));
  if (a <= 0.003) discard;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

/** Links per hoist chain run (each side carries two runs: wheel to sheave,
 *  sheave to the grate's eye). */
const HOIST_PITCH = 0.72;
const HOIST_MAX = 7;

function chainGate(gate: DungeonGateDef): GateRig {
  const clock = new SanctumGateClock(SANCTUM_GATE_SECONDS.chainGate);
  const sc = gate.hw / CHAIN_GATE.postX;
  const root = new THREE.Group();
  for (const side of [-1, 1]) {
    const post = sanctumKitMeshes('Kit_ChainGatePost');
    post.position.set(side * CHAIN_GATE.postX * sc, 0, 0);
    // The chain wheel sits on the post's -x face: the west post is mirrored
    // so both wheels face the opening.
    if (side < 0) post.scale.x = -1;
    root.add(post);
  }
  const lintel = sanctumKitMeshes('SanctumGate_ChainLintel');
  lintel.position.set(0, CHAIN_GATE.lintelY - 0.4, 0);
  lintel.scale.x = sc;
  root.add(lintel);
  const grate = new THREE.Group();
  grate.add(sanctumKitMeshes('Kit_ChainGate'));
  grate.scale.x = sc;
  const u = { uSeal: { value: 0 }, uTime: sharedUniforms.uTime };
  const runeMat = new THREE.ShaderMaterial({
    name: 'sanctumChainGateRunes',
    vertexShader: SHEET_VERT,
    fragmentShader: RUNE_FRAG,
    uniforms: u,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const runes = new THREE.Mesh(
    new THREE.PlaneGeometry(CHAIN_GATE.half * 2, 7.8).translate(0, 4.3, 0),
    runeMat,
  );
  runes.position.z = 0.42;
  runes.frustumCulled = false;
  const runesBack = new THREE.Mesh(runes.geometry, runeMat);
  runesBack.position.z = -0.42;
  grate.add(runes, runesBack);
  root.add(grate);
  // The hoist chains: per side, a fixed run from the post's wheel up to the
  // lintel's sheave and a hanging run from the sheave down to the eye.
  const link = sanctumPieceGeometry('SanctumGate_HoistLink');
  const chainMeshes: THREE.InstancedMesh[] = [];
  for (const slot of SANCTUM_SLOTS) {
    const g = link[slot];
    if (!g) continue;
    const m = new THREE.InstancedMesh(g, sanctumSlotMaterial(slot), HOIST_MAX * 4);
    m.name = `sanctumHoistChain:${slot}`;
    m.frustumCulled = false;
    m.castShadow = slot === 'stone';
    root.add(m);
    chainMeshes.push(m);
  }
  const frost = makeBurst(
    'sanctumChainGateFrost',
    (k) => [
      (sanctumHash(k, 21) - 0.5) * CHAIN_GATE.half * 2,
      0.5 + sanctumHash(k, 23) * 8,
      (sanctumHash(k, 29) - 0.5) * 0.8,
    ],
    70,
    { life: 2.6, lift: -0.6, spread: 2.2, size: 0.9, color: 0xe8f2fa },
  );
  root.add(frost.mesh);
  const m4 = new THREE.Matrix4();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const sheaveY = CHAIN_GATE.lintelY - 0.3;
  const writeRun = (start: number, x: number, y0: number, y1: number, twist: number): void => {
    const len = Math.max(0, y1 - y0);
    const n = Math.min(HOIST_MAX, Math.floor(len / HOIST_PITCH));
    for (let i = 0; i < HOIST_MAX; i++) {
      if (i < n) {
        m4.makeRotationY((i % 2) * (Math.PI / 2) + twist);
        m4.setPosition(x * sc, y1 - (i + 0.5) * HOIST_PITCH, 0);
      } else m4.copy(zero);
      for (const m of chainMeshes) m.setMatrixAt(start + i, m4);
    }
  };
  let lastLift = -1;
  const pose = (lift: number): void => {
    grate.position.y = lift;
    settle(grate);
    const eyeY = CHAIN_GATE.eyeY + lift;
    for (const [s, side] of [-1, 1].entries()) {
      const x = side * CHAIN_GATE.eyeX;
      writeRun(s * HOIST_MAX * 2, x * 1.03, 9.4, sheaveY, 0.3);
      writeRun(s * HOIST_MAX * 2 + HOIST_MAX, x, eyeY, sheaveY, 0);
    }
    for (const m of chainMeshes) m.instanceMatrix.needsUpdate = true;
  };
  pose(0);
  return {
    root,
    driver: runes,
    apply(openness, seal, since, open) {
      const k = clock.step(openness, since, open);
      const lift = chainGateLift(k) * CHAIN_GATE.travel;
      u.uSeal.value = seal;
      // Frost shakes off the bars as the hoist takes the weight; a seal's
      // slam throws it off again at the foot.
      frost.uniforms.uAge.value = clock.played && since < 3.2 ? since : -1;
      if (lift === lastLift) return;
      lastLift = lift;
      pose(lift);
    },
  };
}

// ---- the chain bridge ----------------------------------------------------------------------

/** The rime crust frozen over the taut chain: a ribbon along the sim's own
 *  walkway, its top exactly on the path (a hair proud where it meets the
 *  rims), lumpy flanks spilling past the links, the standing links' worn
 *  tops showing through it as strips of iron. */
const CRUST_LIFT = 0.04;

function crustGeometry(): THREE.BufferGeometry {
  const L = chainBridgeLength();
  const cols = 64;
  const W = CHAIN_BRIDGE_DECK.crustHalfWidth;
  // Cross-section across x: (x, drop below the top).
  const prof: [number, number][] = [
    [-W - 0.7, 2.4],
    [-W - 0.4, 0.9],
    [-W, 0.12],
    [-W + 0.5, 0],
    [-0.8, 0],
    [0.8, 0],
    [W - 0.5, 0],
    [W, 0.12],
    [W + 0.4, 0.9],
    [W + 0.7, 2.4],
  ];
  const v: number[] = [];
  const c: number[] = [];
  const ring = (i: number): [number, number, number][] => {
    const s = (i / cols) * L;
    const p = chainBridgeDeckAt(s);
    const top = p.y + CRUST_LIFT;
    return prof.map(([x, drop], k) => {
      const lump = k === 0 || k === prof.length - 1 ? (sanctumHash(i, k) - 0.5) * 1.2 : 0;
      const side = k === 1 || k === prof.length - 2 ? (sanctumHash(i, k + 7) - 0.5) * 0.5 : 0;
      return [x + side * Math.sign(x), top - drop - lump, p.z];
    });
  };
  const colorAt = (i: number, k: number): Rgb => {
    // The standing links run through the deck every other pitch.
    const s = (i / cols) * L;
    const inLink = Math.floor(s / CHAIN_BRIDGE_DECK.pitch) % 2 === 1;
    if ((k === 4 || k === 5) && inLink) return IRON_WORN;
    if (k <= 1 || k >= prof.length - 2) return [0.36, 0.56, 0.72];
    const n = sanctumHash(i * 3.1, k);
    return [0.74 + n * 0.08, 0.81 + n * 0.07, 0.9 + n * 0.05];
  };
  let prev = ring(0);
  for (let i = 1; i <= cols; i++) {
    const cur = ring(i);
    for (let k = 0; k < prof.length - 1; k++) {
      const quad = [prev[k], prev[k + 1], cur[k + 1], prev[k], cur[k + 1], cur[k]];
      const cols4 = [
        colorAt(i - 1, k),
        colorAt(i - 1, k + 1),
        colorAt(i, k + 1),
        colorAt(i - 1, k),
        colorAt(i, k + 1),
        colorAt(i, k),
      ];
      for (let q = 0; q < 6; q++) {
        v.push(...quad[q]);
        c.push(...cols4[q]);
      }
    }
    prev = cur;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  g.computeVertexNormals();
  return g;
}

function chainBridge(): GateRig {
  const clock = new SanctumGateClock(SANCTUM_GATE_SECONDS.chainBridge);
  const root = new THREE.Group();
  const L = chainBridgeLength();
  const count = Math.max(2, Math.round(L / CHAIN_BRIDGE_DECK.pitch));
  const step = L / count;
  const link = sanctumPieceGeometry('Kit_ChainLink');
  const links: THREE.InstancedMesh[] = [];
  for (const slot of SANCTUM_SLOTS) {
    const g = link[slot];
    if (!g) continue;
    const m = new THREE.InstancedMesh(g, sanctumSlotMaterial(slot), count);
    m.name = `sanctumChainBridgeLinks:${slot}`;
    m.frustumCulled = false;
    m.castShadow = slot === 'stone';
    m.receiveShadow = slot === 'stone';
    root.add(m);
    links.push(m);
  }
  const crust = new THREE.Mesh(crustGeometry(), sanctumSlotMaterial('stone'));
  crust.name = 'sanctumChainBridgeCrust';
  crust.receiveShadow = true;
  crust.castShadow = true;
  crust.visible = false;
  root.add(crust);
  // The bollards at both ends, beside the walk.
  for (const z of [-1.5, 29.5]) {
    for (const x of [-5.4, 5.4]) {
      const b = sanctumKitMeshes('SanctumGate_BridgeBollard');
      b.position.set(x, chainBridgeDeckHeight(z), z);
      b.rotation.y = z < 0 ? 0 : Math.PI;
      root.add(b);
    }
  }
  // Frost thrown off the links where it lands and as it hauls taut.
  const frost = makeBurst(
    'sanctumChainBridgeFrost',
    (k) => {
      const s = sanctumHash(k, 31) * L;
      const p = chainBridgeDeckAt(s);
      return [(sanctumHash(k, 37) - 0.5) * 7, p.y - 1.5, p.z];
    },
    110,
    { life: 3.2, lift: 2.4, spread: 6, size: 1.7, color: 0xe2eef8 },
  );
  root.add(frost.mesh);
  const m4 = new THREE.Matrix4();
  const tx = new THREE.Vector3();
  const ty = new THREE.Vector3();
  const tz = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const across = new THREE.Vector3();
  const DROP = 3.0;
  let lastK = -1;
  const write = (k: number): void => {
    for (let i = 0; i < count; i++) {
      const s = (i + 0.5) * step;
      const a = chainBridgePoint(Math.max(0, s - 0.6), k);
      const b = chainBridgePoint(Math.min(L, s + 0.6), k);
      const p = chainBridgePoint(s, k);
      // Long axis along the chain; the "up" normal turned from the tangent
      // in the chain's vertical plane; the third axis across the walk.
      tx.set(0, b.y - a.y, b.z - a.z).normalize();
      ty.set(0, tx.z, -tx.y);
      if (ty.y < 0) ty.negate();
      tz.crossVectors(tx, ty);
      // Laid along the walk the links hang their height under the deck's
      // top line (the standing links' worn tops flush with it); hanging, the
      // line is the chain's own middle.
      pos.set(CHAIN_BRIDGE_DECK.x, p.y, p.z).addScaledVector(ty, -DROP * tx.z * tx.z);
      if (i % 2 === 0) {
        // A flat link: a quarter turn about its long axis.
        m4.makeBasis(tx, across.copy(tz).negate(), ty);
      } else {
        m4.makeBasis(tx, ty, tz);
      }
      m4.setPosition(pos);
      for (const m of links) m.setMatrixAt(i, m4);
    }
    for (const m of links) m.instanceMatrix.needsUpdate = true;
  };
  write(0);
  return {
    root,
    driver: links[0],
    absolute: true,
    apply(openness, _seal, since, open) {
      const k = clock.step(openness, since, open);
      // The rime freezes up through the links once the chain is taut.
      const crustK = chainBridgeCrust(k);
      crust.visible = crustK > 0;
      crust.position.y = -(1 - crustK) * 2.6;
      if (crust.visible) settle(crust);
      // The frost bursts as the chain lands on the far rim and hauls taut.
      const landAt = CHAIN_BRIDGE_LAND * SANCTUM_GATE_SECONDS.chainBridge.open;
      frost.uniforms.uAge.value =
        open && clock.played && since >= landAt && since < landAt + 6 ? since - landAt : -1;
      if (k === lastK) return;
      lastK = k;
      write(k);
    },
  };
}

// ---- the rite ward -------------------------------------------------------------------------

const WARD_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uCharge;
uniform float uSeal;
${NOISE_GLSL}
void main() {
  // A spent ward costs one compare: out before any noise.
  if (uCharge <= 0.002) discard;
  vec2 uv = vUv;
  float t = uTime;
  // Soulfire licking up from the foot, thick low, torn high.
  float flame = gFbm(vec2(uv.x * 6.0, uv.y * 2.6 - t * 1.1));
  float tongue = smoothstep(uv.y * 1.05 + 0.02, uv.y * 1.05 - 0.4, flame * (1.05 - uv.y * 0.35));
  // The stolen souls: pale wisps rising in slow columns, faces half formed.
  float col = gNoise(vec2(uv.x * 9.0, 0.0) + 3.0);
  float wisp = smoothstep(0.62, 0.95, gNoise(vec2(uv.x * 14.0, uv.y * 3.0 - t * 0.55 + col * 4.0)));
  float veil = 0.1 + 0.08 * gNoise(uv * vec2(8.0, 3.0) + vec2(0.0, -t * 0.3));
  veil *= 1.0 + uSeal * 1.6;
  float edge = smoothstep(0.0, 0.07, uv.x) * smoothstep(1.0, 0.93, uv.x) * smoothstep(1.0, 0.62, uv.y);
  vec3 green = vec3(0.27, 0.67, 0.36);
  vec3 violet = vec3(0.19, 0.1, 0.48);
  vec3 base = mix(green, violet, smoothstep(0.1, 0.85, uv.y));
  vec3 colr = base * (veil + tongue * 1.1) + vec3(0.62, 0.95, 0.75) * wisp * 0.55;
  colr *= 1.0 + uSeal * (0.9 + 0.3 * sin(t * 6.0));
  float a = (veil + tongue + wisp * 0.5) * edge * uCharge;
  if (a <= 0.003) discard;
  gl_FragColor = vec4(colr * a, 1.0);
  #include <colorspace_fragment>
}
`;

let wardGlowMat: THREE.SpriteMaterial | null = null;
function wardGlowMaterial(): THREE.SpriteMaterial {
  if (!wardGlowMat) {
    wardGlowMat = new THREE.SpriteMaterial({
      map: radialGlowTexture(),
      color: 0x8fd6a0,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      name: 'sanctumWardGlow',
    });
    markSharedMaterial(wardGlowMat);
  }
  return wardGlowMat;
}

function riteWard(gate: DungeonGateDef): GateRig {
  const clock = new SanctumGateClock(SANCTUM_GATE_SECONDS.riteWard);
  const width = gate.hw * 2 + 1.2;
  const height = 10;
  const u = {
    uTime: sharedUniforms.uTime,
    uCharge: { value: 1 },
    uSeal: { value: 0 },
  };
  const sheet = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height).translate(0, height / 2, 0),
    new THREE.ShaderMaterial({
      name: 'sanctumRiteWard',
      vertexShader: SHEET_VERT,
      fragmentShader: WARD_FRAG,
      uniforms: u,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  sheet.frustumCulled = false;
  const root = new THREE.Group();
  root.add(sheet);
  const glows: THREE.Sprite[] = [];
  for (const side of [-1, 1]) {
    const post = sanctumKitMeshes('SanctumGate_WardPost');
    post.position.set(side * (width / 2 + 0.3), 0, 0);
    root.add(post);
    const glow = new THREE.Sprite(wardGlowMaterial());
    glow.position.set(side * (width / 2 + 0.3), 6.6, 0);
    glow.scale.set(3.4, 3.4, 1);
    root.add(glow);
    glows.push(glow);
  }
  return {
    root,
    driver: sheet,
    apply(openness, seal, since, open) {
      const k = clock.step(openness, since, open);
      const charge = Math.max(riteWardCharge(k, sharedUniforms.uTime.value), seal > 0 ? 1 : 0);
      u.uCharge.value = charge;
      u.uSeal.value = seal;
      // The sheet stays drawn (it discards when spent) so its hook keeps
      // running for a re-seal; the glow cards go out with it.
      for (const g of glows) g.visible = charge > 0.002;
    },
  };
}

// ---- the gates ---------------------------------------------------------------------------

function rigFor(kind: SanctumGateRigKind, gate: DungeonGateDef): GateRig {
  if (kind === 'iceWall') return iceWall(gate);
  if (kind === 'chainGate') return chainGate(gate);
  if (kind === 'chainBridge') return chainBridge();
  return riteWard(gate);
}

function buildGates(ox: number, oz: number, ground: (x: number, z: number) => number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'gravewyrmSanctumGates';
  for (const gate of GRAVEWYRM_SANCTUM_GATES) {
    const kind = sanctumGateRig(gate.kind);
    if (!kind) continue;
    const key = gateMemoryKey(ox, oz, gate.id);
    const rig = rigFor(kind, gate);
    const holder = new THREE.Group();
    holder.name = `gate:${gate.id}`;
    if (!rig.absolute) {
      holder.position.set(gate.x, ground(gate.x, gate.z), gate.z);
      holder.rotation.y = gate.rot;
    }
    holder.add(rig.root);
    // Once per frame (the hook also fires for shadow passes), on the one
    // node that always draws.
    let stamp = Number.NaN;
    const refresh = (): void => {
      const now = sharedUniforms.uTime.value;
      if (now === stamp) return;
      stamp = now;
      const view = gateView(key, now);
      const seal = view.state === 'sealed' ? 0.7 + 0.3 * Math.sin(now * 5) : 0;
      rig.apply(view.openness, seal, view.since, view.state === 'open');
    };
    // (No paint before the first frame: each rig is built in its shut pose,
    // and its clock's first sight must come from the gate memory.)
    const m = rig.driver as THREE.Mesh;
    m.onBeforeRender = refresh;
    group.add(holder);
  }
  return group;
}

/**
 * Every gate structure of one slot, driven by the gate memory of the slot
 * anchored at (ox, oz). Returns the group (instance-local frame).
 */
export function buildSanctumGates(
  ox: number,
  oz: number,
  ground: (x: number, z: number) => number,
): THREE.Group {
  const group = buildGates(ox, oz, ground);
  upgradeWhenSanctumKitLands(group, () => buildGates(ox, oz, ground));
  return group;
}

/** The stand-in geometry of a gate piece merged (tests; the kit contract). */
export function sanctumGateStandInForTest(piece: string): THREE.BufferGeometry | null {
  const g = sanctumPieceGeometry(piece);
  const list = SANCTUM_SLOTS.map((s) => g[s]).filter((x): x is THREE.BufferGeometry => !!x);
  return list.length ? mergeSanctumParts(list) : null;
}
