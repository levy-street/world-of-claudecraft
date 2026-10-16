// The Wildheart Basin's gates and seals as living structures:
//  - the Twin Vine Bridges: frayed vine ends dangling over the gorge at both
//    ends while shut; when the ford falls quiet the vines race out from the
//    ford and WEAVE the deck one segment after the next along the bridge's
//    path (the hidden surface the sim opens), until a woven bridge with leafy
//    rope rails spans the gorge (Kit_VineBridge segments once the kit lands);
//  - the thorn walls: a black bramble hedge with red blossoms across the
//    passage (Kit_ThornWall); opening, it sinks back into the earth in a
//    rustle of petals; sealed while a boss is engaged, the thorns surge back
//    up with a dark red pulse running through them;
//  - the Convergence Stair's warded arch: a membrane of Sunbone ochre glyphs
//    burning between the ward posts, failing in flickers;
//  - the Shrine Ward: a wall of jade spirit flame rising from a line of sun
//    glyphs, flaring bright while Zulgar holds it.
//
// Each gate reads its on-screen state from the shared gate memory
// (../hollow_crypt/crypt_gate_state_core.ts, fed by the mirrored gate entities
// through ../gate_objects.ts) in an onBeforeRender hook, so a state swap plays
// as a reveal and costs nothing off screen; instance matrices are written only
// while a gate moves.

import * as THREE from 'three';
import { WILDHEART_BASIN_GATES } from '../../sim/content/wildheart';
import type { DungeonGateDef } from '../../sim/types';
import { sharedUniforms, surfaceMat } from '../gfx';
import { gateMemoryKey, gateView } from '../hollow_crypt/crypt_gate_state_core';
import { markSharedMaterial } from '../shared_resource';
import { radialGlowTexture } from '../textures';
import { type BasinSlot, basinKitPiece, basinKitReady, basinSlotMaterial } from './basin_kit';
import {
  basinHash,
  planVineSegments,
  thornRise,
  thornSealPulse,
  VINE_BRIDGE_HALF_WIDTH,
  VINE_BRIDGE_PATHS,
  vineWeaveGrowth,
  wardCharge,
} from './basin_plan_core';
import { BASIN_NOISE_GLSL } from './basin_sky';

interface GateRig {
  root: THREE.Group;
  /** The one always-drawn node whose render hook drives the gate. */
  driver: THREE.Object3D;
  /** Called every rendered frame with the gate's openness, seal state and clock. */
  apply(openness: number, sealed: boolean, since: number): void;
}

const SLOTS: readonly BasinSlot[] = ['stone', 'glow', 'glass'];
const scratch = new THREE.Matrix4();
const basis = new THREE.Matrix4();
const vx = new THREE.Vector3();
const vy = new THREE.Vector3();
const vz = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);

function vineMaterial(): THREE.Material {
  return surfaceMat({ color: 0x3e5a24, roughness: 0.9 });
}
function ropeMaterial(): THREE.Material {
  return surfaceMat({ color: 0x6a5232, roughness: 0.95 });
}
function thornMaterial(): THREE.Material {
  return surfaceMat({ color: 0x17120f, roughness: 0.7 });
}
function blossomMaterial(): THREE.Material {
  return surfaceMat({ color: 0xa3322a, roughness: 0.6, emissive: 0x2a0606 });
}

/** One instanced mesh per slot of a kit piece, or the procedural parts. */
function instancedPiece(
  piece: string,
  count: number,
  fallback: () => { geometry: THREE.BufferGeometry; material: THREE.Material }[],
): THREE.InstancedMesh[] {
  const out: THREE.InstancedMesh[] = [];
  if (basinKitReady()) {
    const baked = basinKitPiece(piece);
    for (const slot of SLOTS) {
      const g = baked[slot];
      if (!g) continue;
      out.push(new THREE.InstancedMesh(g, basinSlotMaterial(slot), count));
    }
  }
  if (out.length === 0) {
    for (const part of fallback())
      out.push(new THREE.InstancedMesh(part.geometry, part.material, count));
  }
  for (const m of out) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.castShadow = true;
    m.receiveShadow = true;
  }
  return out;
}

// ---- the vine bridge -------------------------------------------------------------------

/** The procedural deck segment (until the kit lands): woven mats on two rope
 *  stringers, posts and a sagging rail each side; 4 yd along x, 8 wide. */
function proceduralDeck(): { geometry: THREE.BufferGeometry; material: THREE.Material }[] {
  const mats = new THREE.BoxGeometry(4, 0.22, 7.8).translate(0, -0.11, 0);
  const stringers: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    stringers.push(new THREE.BoxGeometry(4.1, 0.3, 0.3).translate(0, -0.15, s * 3.95));
    stringers.push(new THREE.CylinderGeometry(0.1, 0.12, 1.4, 6).translate(-1, 0.7, s * 4));
    stringers.push(new THREE.CylinderGeometry(0.1, 0.12, 1.4, 6).translate(1, 0.7, s * 4));
    stringers.push(new THREE.BoxGeometry(4.1, 0.12, 0.12).translate(0, 1.25, s * 4.05));
  }
  return [
    { geometry: mats, material: vineMaterial() },
    { geometry: mergeGeometries(stringers), material: ropeMaterial() },
  ];
}

function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  for (const g0 of list) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.computeBoundingSphere();
  return out;
}

/** Frayed vine ends hanging over the gorge from an anchor (render only). */
function danglingVines(x: number, y: number, z: number, seed: number): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const h = (k: number) => basinHash(seed * 31 + i, k);
    const ox = (h(1) - 0.5) * 6;
    const oz = (h(2) - 0.5) * 6;
    const len = 4 + h(3) * 7;
    const pts = [
      new THREE.Vector3(x + ox * 0.3, y + 0.2, z + oz * 0.3),
      new THREE.Vector3(x + ox * 0.7, y - len * 0.4, z + oz * 0.7),
      new THREE.Vector3(x + ox, y - len, z + oz + (h(4) - 0.5)),
    ];
    parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 8, 0.09 + h(5) * 0.07, 5));
  }
  const mesh = new THREE.Mesh(mergeGeometries(parts), vineMaterial());
  mesh.castShadow = true;
  return mesh;
}

/** The racing vine tips while the bridge weaves: glowing green-gold threads
 *  along each rail, drawn up to the weave front. */
const TIP_VERT = /* glsl */ `
attribute float aAlong;
varying float vAlong;
void main() {
  vAlong = aAlong;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const TIP_FRAG = /* glsl */ `
precision highp float;
uniform float uFront;
uniform float uFade;
varying float vAlong;
void main() {
  float lead = smoothstep(uFront - 0.08, uFront, vAlong) * (1.0 - step(uFront, vAlong));
  float trail = (1.0 - step(uFront, vAlong)) * 0.25;
  float a = (lead * 1.4 + trail) * uFade;
  if (a <= 0.001) discard;
  gl_FragColor = vec4(vec3(0.6, 1.0, 0.35) * a, 1.0);
}
`;

function vineBridge(gate: DungeonGateDef): GateRig {
  const path = gate.id.includes('east') ? VINE_BRIDGE_PATHS.east : VINE_BRIDGE_PATHS.west;
  const segs = planVineSegments(path, 4);
  const root = new THREE.Group();
  const meshes = instancedPiece('Kit_VineBridge', segs.length, proceduralDeck);
  for (const m of meshes) root.add(m);
  // The frayed ends while it is shut: at the ford's anchor and the far lip.
  const [ax, az, ah] = path[0];
  const [bx, bz, bh] = path[path.length - 1];
  const nearEnd = danglingVines(ax, ah, az, gate.id.length);
  const farEnd = danglingVines(bx, bh, bz, gate.id.length + 7);
  root.add(nearEnd, farEnd);
  // The racing tips along both rails (one additive line pair).
  const tipPos: number[] = [];
  const tipAlong: number[] = [];
  const total = segs.length;
  for (const side of [-1, 1]) {
    segs.forEach((s, i) => {
      for (const end of [-0.5, 0.5]) {
        // Across the deck: horizontal perpendicular of the direction.
        const l = Math.hypot(s.dx, s.dz) || 1;
        const px = -s.dz / l;
        const pz = s.dx / l;
        tipPos.push(
          s.x + s.dx * s.length * end + px * side * VINE_BRIDGE_HALF_WIDTH,
          s.y + s.dy * s.length * end + 1.1,
          s.z + s.dz * s.length * end + pz * side * VINE_BRIDGE_HALF_WIDTH,
        );
        tipAlong.push((i + end + 0.5) / total);
      }
    });
  }
  const tipGeo = new THREE.BufferGeometry();
  tipGeo.setAttribute('position', new THREE.Float32BufferAttribute(tipPos, 3));
  tipGeo.setAttribute('aAlong', new THREE.Float32BufferAttribute(tipAlong, 1));
  const tipU = { uFront: { value: 0 }, uFade: { value: 0 } };
  const tips = new THREE.LineSegments(
    tipGeo,
    new THREE.ShaderMaterial({
      name: 'wildheartVineTips',
      vertexShader: TIP_VERT,
      fragmentShader: TIP_FRAG,
      uniforms: tipU,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  tips.frustumCulled = false;
  root.add(tips);
  let last = -1;
  const pose = (openness: number): void => {
    segs.forEach((s, i) => {
      const g = vineWeaveGrowth(openness, i, segs.length);
      // The segment grows out of its ford-side end along the deck.
      vx.set(s.dx, s.dy, s.dz).normalize();
      vz.crossVectors(vx, up).normalize();
      vy.crossVectors(vz, vx).normalize();
      const len = (s.length / 4) * Math.max(0.001, g);
      basis.makeBasis(
        vx.multiplyScalar(len),
        vy.multiplyScalar(Math.max(0.001, g)),
        vz.multiplyScalar(Math.max(0.15, g)),
      );
      const lead = (s.length * (1 - g)) / 2;
      basis.setPosition(s.x - s.dx * lead, s.y - s.dy * lead - (1 - g) * 0.6, s.z - s.dz * lead);
      scratch.copy(basis);
      for (const m of meshes) m.setMatrixAt(i, scratch);
    });
    for (const m of meshes) m.instanceMatrix.needsUpdate = true;
  };
  return {
    root,
    driver: meshes[0],
    apply(openness) {
      const front = Math.min(1, openness * (1 + 1.5 / total));
      tipU.uFront.value = front;
      tipU.uFade.value = openness > 0.001 && openness < 0.999 ? 1 : 0;
      const dangle = 1 - Math.min(1, openness * 3);
      nearEnd.visible = dangle > 0.01;
      farEnd.visible = dangle > 0.01;
      nearEnd.scale.setScalar(Math.max(0.01, dangle));
      farEnd.scale.setScalar(Math.max(0.01, dangle));
      if (Math.abs(openness - last) < 1e-4) return;
      last = openness;
      pose(openness);
    },
  };
}

// ---- the thorn wall ----------------------------------------------------------------------

function proceduralThorns(): { geometry: THREE.BufferGeometry; material: THREE.Material }[] {
  const canes: THREE.BufferGeometry[] = [];
  const blooms: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 12; k++) {
    const h = (a: number) => basinHash(k, a + 300);
    const x0 = (h(1) - 0.5) * 4.2;
    const x1 = Math.max(-2.1, Math.min(2.1, x0 - Math.sign(x0 || 1) * (1.2 + h(2) * 1.4)));
    const apex = 2.6 + h(3) * 2.4;
    const zOff = (h(4) - 0.5) * 1.6;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pts.push(
        new THREE.Vector3(
          x0 + (x1 - x0) * t,
          -0.3 + apex * Math.sin(Math.PI * t) ** 0.8,
          zOff + Math.sin(Math.PI * t) * (h(5) - 0.5),
        ),
      );
    }
    canes.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.12, 5));
    // Hooked thorns along the cane.
    for (let i = 1; i < 8; i += 2) {
      const p = pts[i];
      canes.push(
        new THREE.ConeGeometry(0.07, 0.42, 4).rotateZ(h(6 + i) * 3).translate(p.x, p.y + 0.15, p.z),
      );
    }
    const top = pts[4];
    blooms.push(new THREE.IcosahedronGeometry(0.28, 0).translate(top.x, top.y + 0.2, top.z));
  }
  return [
    { geometry: mergeGeometries(canes), material: thornMaterial() },
    { geometry: mergeGeometries(blooms), material: blossomMaterial() },
  ];
}

const PULSE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const PULSE_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uPulse;
uniform float uPetals;
varying vec2 vUv;
${BASIN_NOISE_GLSL}
void main() {
  // The seal: a dark red pulse running up through the thorns.
  float veins = smoothstep(0.55, 0.9, bnoise(vec2(vUv.x * 18.0, vUv.y * 5.0 - uTime * 1.4)));
  float body = smoothstep(0.0, 0.2, vUv.y) * (1.0 - smoothstep(0.6, 1.0, vUv.y));
  float seal = (veins * 0.8 + 0.25) * body * uPulse;
  // The petals: red flecks whirling up and away as the hedge sinks.
  vec2 cell = floor(vec2(vUv.x * 30.0, (vUv.y - uTime * 0.6) * 12.0));
  float fleck = step(0.9, bhash(cell)) * smoothstep(0.3, 0.0, length(fract(vec2(vUv.x * 30.0, (vUv.y - uTime * 0.6) * 12.0)) - 0.5));
  float petals = fleck * uPetals * body;
  vec3 col = vec3(0.75, 0.06, 0.08) * seal + vec3(0.95, 0.25, 0.22) * petals;
  float a = max(seal, petals);
  if (a <= 0.003) discard;
  gl_FragColor = vec4(col * a, 1.0);
}
`;

function thornWall(gate: DungeonGateDef): GateRig {
  const width = gate.hw * 2 + 1;
  const count = Math.max(2, Math.ceil(width / 4));
  const stretch = width / (count * 4);
  const root = new THREE.Group();
  const meshes = instancedPiece('Kit_ThornWall', count * 2, proceduralThorns);
  for (const m of meshes) root.add(m);
  const pulseU = { uTime: sharedUniforms.uTime, uPulse: { value: 0 }, uPetals: { value: 0 } };
  const pulse = new THREE.Mesh(
    new THREE.PlaneGeometry(width, 6.2).translate(0, 3.1, 0),
    new THREE.ShaderMaterial({
      name: 'wildheartThornPulse',
      vertexShader: PULSE_VERT,
      fragmentShader: PULSE_FRAG,
      uniforms: pulseU,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );
  pulse.frustumCulled = false;
  root.add(pulse);
  let last = -1;
  return {
    root,
    driver: meshes[0],
    apply(openness, sealed, since) {
      const rise = thornRise(openness);
      pulseU.uPulse.value = thornSealPulse(sealed, sharedUniforms.uTime.value) * rise;
      // Petals burst as it sinks and as it surges back.
      pulseU.uPetals.value = since < 2.5 ? (1 - since / 2.5) * 0.9 : 0;
      pulse.scale.y = Math.max(0.05, rise);
      pulse.visible = pulseU.uPulse.value > 0.01 || pulseU.uPetals.value > 0.01;
      if (Math.abs(rise - last) < 1e-4) return;
      last = rise;
      // Two staggered rows of hedge segments, sunk into the ground by the share.
      for (let row = 0; row < 2; row++) {
        for (let i = 0; i < count; i++) {
          const k = row * count + i;
          const x = -width / 2 + (i + 0.5) * (width / count) + (row ? 1.3 : 0);
          const jitter = basinHash(k, gate.id.length) * 0.5;
          const sink = (1 - rise) * (5.6 + jitter);
          basis.makeRotationY(row ? Math.PI : 0);
          scratch.makeScale(stretch * (row ? 0.85 : 1), 0.7 + 0.3 * rise, 1);
          basis.multiply(scratch);
          basis.setPosition(Math.min(width / 2 - 1, x), -sink, row ? 0.9 : -0.6);
          for (const m of meshes) m.setMatrixAt(k, basis);
        }
      }
      // Never hidden: a sunk hedge is simply underground, and its meshes keep
      // the render hook alive for the next seal.
      for (const m of meshes) m.instanceMatrix.needsUpdate = true;
    },
  };
}

// ---- the wards ---------------------------------------------------------------------------

const WARD_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uCharge;
uniform float uSeal;
uniform vec3 uColor;
uniform vec3 uGlyph;
uniform float uFlame;
varying vec2 vUv;
${BASIN_NOISE_GLSL}
void main() {
  // A spent ward costs one compare: out before any noise.
  if (uCharge <= 0.002) discard;
  vec2 uv = vUv;
  // Rising spirit flame: noise licking upward, thick at the base.
  float flame = bfbm(vec2(uv.x * 7.0, uv.y * 3.0 - uTime * 1.3)) ;
  float tongue = smoothstep(uv.y * 1.1 + 0.05, uv.y * 1.1 - 0.35, flame * (1.0 - uv.y * 0.4)) * uFlame;
  // Sun glyphs in a row through the membrane, slowly turning.
  vec2 g = vec2(fract(uv.x * 6.0) - 0.5, (uv.y - 0.45) * 2.2);
  float r = length(g);
  float ang = atan(g.y, g.x) + uTime * 0.6;
  float glyph = smoothstep(0.03, 0.0, abs(r - 0.32)) + smoothstep(0.03, 0.0, abs(r - 0.18)) * 0.6 + smoothstep(0.08, 0.0, abs(sin(ang * 4.0)) * r) * step(r, 0.32) * 0.5;
  float veil = 0.12 + 0.1 * bnoise(uv * vec2(9.0, 4.0) + uTime * 0.2);
  float edge = smoothstep(0.0, 0.06, uv.x) * smoothstep(1.0, 0.94, uv.x) * smoothstep(1.0, 0.7, uv.y);
  vec3 col = uColor * (veil + tongue * 0.9) + uGlyph * glyph * 1.2;
  col *= 1.0 + uSeal * 0.8;
  float a = (veil + tongue + glyph) * edge * uCharge;
  if (a <= 0.003) discard;
  gl_FragColor = vec4(col * a, 1.0);
}
`;

function ward(gate: DungeonGateDef, rite: boolean): GateRig {
  const width = gate.hw * 2 + 1;
  const height = rite ? 11 : 8;
  const u = {
    uTime: sharedUniforms.uTime,
    uCharge: { value: 1 },
    uSeal: { value: 0 },
    uColor: { value: new THREE.Color(rite ? 0x5fe0a0 : 0xd9b26a) },
    uGlyph: { value: new THREE.Color(rite ? 0xd9b26a : 0x5fe0a0) },
    uFlame: { value: rite ? 1 : 0.45 },
  };
  const sheet = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height).translate(0, height / 2, 0),
    new THREE.ShaderMaterial({
      name: 'wildheartWard',
      vertexShader: PULSE_VERT,
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
  // Glow cards at the foot of the ward (on the posts' line), not lights.
  const glowMat = wardGlowMaterial(rite);
  const glows: THREE.Sprite[] = [];
  for (const side of [-1, 1]) {
    const s = new THREE.Sprite(glowMat);
    s.position.set(side * (width / 2), rite ? 1.4 : 6.6, 0);
    s.scale.set(4, 4, 1);
    root.add(s);
    glows.push(s);
  }
  return {
    root,
    driver: sheet,
    apply(openness, sealed) {
      u.uCharge.value = Math.max(wardCharge(openness, sharedUniforms.uTime.value), sealed ? 1 : 0);
      u.uSeal.value = sealed ? 0.6 + 0.4 * Math.sin(sharedUniforms.uTime.value * 5) : 0;
      // The sheet stays drawn (it discards when spent) so its render hook
      // keeps running for a re-seal; the glow cards go out with it.
      for (const g of glows) g.visible = u.uCharge.value > 0.002;
    },
  };
}

const wardGlows = new Map<boolean, THREE.SpriteMaterial>();
function wardGlowMaterial(rite: boolean): THREE.SpriteMaterial {
  let m = wardGlows.get(rite);
  if (!m) {
    m = new THREE.SpriteMaterial({
      map: radialGlowTexture(),
      color: rite ? 0x5fe0a0 : 0xd9b26a,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      name: `wildheartWardGlow:${rite ? 'rite' : 'arch'}`,
    });
    markSharedMaterial(m);
    wardGlows.set(rite, m);
  }
  return m;
}

/**
 * Every gate structure of one slot, driven by the gate memory of the slot
 * anchored at (ox, oz). Returns the group (instance-local frame).
 */
export function buildBasinGates(
  ox: number,
  oz: number,
  ground: (x: number, z: number) => number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'wildheartBasinGates';
  for (const gate of WILDHEART_BASIN_GATES) {
    const key = gateMemoryKey(ox, oz, gate.id);
    const rig =
      gate.kind === 'vine_bridge'
        ? vineBridge(gate)
        : gate.kind === 'thorn_wall'
          ? thornWall(gate)
          : ward(gate, gate.kind === 'rite_ward');
    const holder = new THREE.Group();
    holder.name = `gate:${gate.id}`;
    if (gate.kind !== 'vine_bridge') {
      holder.position.set(gate.x, ground(gate.x, gate.z), gate.z);
      holder.rotation.y = gate.rot;
    }
    holder.add(rig.root);
    // Once per frame (the hook also fires for shadow passes), on the one
    // node that always draws.
    let stamp = -1;
    const refresh = (): void => {
      const now = sharedUniforms.uTime.value;
      if (now === stamp) return;
      stamp = now;
      const view = gateView(key, now);
      rig.apply(view.openness, view.state === 'sealed', view.since);
    };
    // Paint the initial (shut) pose before the first frame.
    rig.apply(0, false, 999);
    const m = rig.driver as THREE.Mesh;
    m.onBeforeRender = refresh;
    group.add(holder);
  }
  return group;
}
