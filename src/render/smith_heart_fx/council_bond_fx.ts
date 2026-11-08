// The Hammer Council's Bond of the Stone (encounters/smith_heart/council_bond.ts,
// COUNCIL_AURAS.bond), a part of CouncilFx. While the two members stand within
// reach of each other (either one wears the bond):
//  - a thick tether of gold energy arches from one member's chest to the
//    other's, always climbing over both heads (council_mechanic_look_core.ts
//    `bondArch`), so it reads when they stand shoulder to shoulder and from a
//    raid camera far off: a hot braided core and a soft halo, the energy
//    running in from both ends to meet in the middle, quicker and brighter as
//    the bond's pulses grow;
//  - shards of quarry stone drawn along it, tumbling in from both ends;
//  - under each member a gold sigil on the floor and a column of light round
//    its body (the bond's aura on the boss itself), and between the two
//    sigils a chain of light on the floor, its links running in to meet in
//    the middle (the link still reads when a body stands between the camera
//    and the arch);
//  - each raid pulse (COUNCIL_CUES.bondPulse) flares all of it, with a ring at
//    both ends.
// The moment neither wears the bond every piece hides, and the tether snaps in
// a spray of gold sparks at its middle.
// It says why the council takes so little damage and that the tanks must pull
// them apart, so the tether, the halo, the sigils, the columns and the chain
// draw on EVERY tier; only the motes, the shards and the snap's sparks thin.
// Built in the constructor under the host's root (the host's one gated attach
// links every program, the instanced shards' variant too); fixed pieces, no
// light, no per-frame allocation; the members are found at the host's scan
// pace.

import * as THREE from 'three';
import { type CouncilRole, councilRoleOf } from '../../sim/encounters/smith_heart/council_ids';
import type { Aura, Entity } from '../../sim/types';
import { fxAnchor } from '../attached_fx_anchor';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { COUNCIL_FX_COLORS as C, COUNCIL_AURAS } from './council_fx_core';
import {
  type BondTetherLook,
  bondAnchorY,
  bondArch,
  bondArchPoint,
  bondSigil,
  bondTetherLook,
} from './council_mechanic_look_core';
import type { CouncilFxHost } from './council_pillars_fx';

/** The tether's tube: rings along the arch, sides round it. */
const TUBE_SEGMENTS = 64;
const TUBE_SIDES = 12;
/** The stone shards drawn along it (the low tier draws fewer). */
const SHARDS = 16;

/** The tube, built in the shader along the arch from the mesh's origin (A) to
 *  uB, rising uRise over their line (the core's `bondArchPoint`). Projected
 *  through modelViewMatrix: the instance sits far out, so world positions
 *  never reach the shader. */
const TUBE_VERT = /* glsl */ `
attribute float aT;
attribute float aA;
uniform vec3 uB;
uniform float uRise;
uniform float uRadius;
uniform float uTime;
uniform float uWrithe;
varying float vT;
varying float vA;
varying float vFace;
void main() {
  float t = aT;
  float u = 1.0 - t;
  vec3 c = vec3(0.5 * uB.x, 0.5 * uB.y + 2.0 * uRise, 0.5 * uB.z);
  vec3 p = 2.0 * u * t * c + t * t * uB;
  vec3 tang = normalize(2.0 * u * c + 2.0 * t * (uB - c) + vec3(1e-5, 0.0, 0.0));
  vec3 side = cross(tang, vec3(0.0, 1.0, 0.0));
  side = length(side) < 1e-3 ? vec3(1.0, 0.0, 0.0) : normalize(side);
  vec3 up = normalize(cross(side, tang));
  // Knots of energy running in from both ends, the ends anchored a little
  // thinner into the bodies.
  float m = min(t, 1.0 - t);
  float knot = 0.5 + 0.5 * sin(m * 46.0 - uTime * 9.0);
  float twist = sin(aA * 3.0 + t * 30.0 - uTime * 5.0);
  float taper = 0.55 + 0.45 * smoothstep(0.0, 0.1, m);
  float r = uRadius * taper * (1.0 + uWrithe * (0.3 * knot + 0.12 * twist));
  vec3 n = cos(aA) * side + sin(aA) * up;
  vec4 mv = modelViewMatrix * vec4(p + n * r, 1.0);
  vec3 vn = normalize(normalMatrix * n);
  vFace = abs(dot(vn, normalize(-mv.xyz)));
  vT = t;
  vA = aA;
  gl_Position = projectionMatrix * mv;
}
`;

/** The core: a white-hot heart in a gold skin, bands of light running in
 *  from both ends, braided seams of ochre across it. */
const CORE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uGlow;
uniform float uFlow;
uniform vec3 uColor;
uniform vec3 uHot;
uniform vec3 uSeam;
varying float vT;
varying float vA;
varying float vFace;
void main() {
  float m = min(vT, 1.0 - vT);
  float run = fract(m * 7.0 - uTime * uFlow);
  float band = smoothstep(0.0, 0.12, run) * (1.0 - smoothstep(0.12, 0.45, run));
  float braid = abs(sin(vA * 1.5 + vT * 60.0 - uTime * 4.0));
  float seam = smoothstep(0.9, 1.0, braid);
  float heart = pow(max(vFace, 0.0), 2.2);
  vec3 col = mix(uColor, uHot, clamp(heart * 0.4 + band * 0.55, 0.0, 1.0));
  col = mix(col, uSeam, seam * 0.55 * (1.0 - band));
  float a = (0.35 + 0.65 * vFace) * (0.85 + 0.4 * band);
  gl_FragColor = vec4(col * uGlow, clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

/** The halo: a soft gold glow round the core, brightest where it faces the
 *  eye, so the tether reads as a thick bar of light from far off. */
const HALO_FRAG = /* glsl */ `
uniform float uTime;
uniform float uGlow;
uniform vec3 uColor;
varying float vT;
varying float vFace;
void main() {
  float m = min(vT, 1.0 - vT);
  float shimmer = 0.8 + 0.2 * sin(m * 30.0 - uTime * 6.0);
  float a = pow(max(vFace, 0.0), 2.2) * 0.6 * shimmer * smoothstep(0.0, 0.05, m);
  gl_FragColor = vec4(uColor * uGlow, a);
  #include <colorspace_fragment>
}
`;

/** A tumbling shard of quarry stone: dark ochre rock lit from above, its
 *  edges burning gold in the bond's light. */
const SHARD_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vView;
void main() {
  mat3 im = mat3(instanceMatrix);
  vN = normalize(normalMatrix * (im * normal));
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;
const SHARD_FRAG = /* glsl */ `
uniform vec3 uStone;
uniform vec3 uRim;
uniform float uGlow;
varying vec3 vN;
varying vec3 vView;
void main() {
  vec3 n = normalize(vN);
  float lit = 0.35 + 0.65 * clamp(dot(n, normalize(vec3(0.2, 0.9, 0.35))), 0.0, 1.0);
  float rim = pow(1.0 - clamp(abs(dot(n, vView)), 0.0, 1.0), 2.0);
  vec3 col = uStone * lit + uRim * rim * uGlow;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

/** The sigil under a member: an outer double ring, a turning band of runes
 *  and spokes, a soft fill, drawn on the floor (a disc of radius 1). */
const SIGIL_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const SIGIL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uGlow;
uniform float uSpin;
uniform vec3 uColor;
uniform vec3 uHot;
varying vec2 vP;
float ring(float r, float at, float w) {
  return 1.0 - smoothstep(0.0, w, abs(r - at));
}
void main() {
  float r = length(vP);
  if (r > 1.0) discard;
  float ang = atan(vP.y, vP.x);
  float outer = ring(r, 0.95, 0.035) + 0.7 * ring(r, 0.86, 0.018);
  float inner = 0.8 * ring(r, 0.5, 0.02);
  // Runes: notched blocks in the band between the rings, turning.
  float a = ang + uTime * uSpin;
  float cell = fract(a * 12.0 / 6.2832);
  float rune = step(0.18, cell) * step(cell, 0.72) * step(0.6, r) * step(r, 0.78);
  float glyph = rune * (0.55 + 0.45 * step(0.5, fract(cell * 3.0 + floor(a * 12.0 / 6.2832) * 0.37)));
  // Spokes from the inner ring to the runes, counter-turning.
  float b = ang - uTime * uSpin * 0.6;
  float spoke = (1.0 - smoothstep(0.0, 0.05, abs(fract(b * 6.0 / 6.2832) - 0.5) * 2.0 - 0.94))
    * step(0.5, r) * step(r, 0.6);
  float fill = 0.16 * (1.0 - r) + 0.08;
  float breath = 0.85 + 0.15 * sin(uTime * 3.0 - r * 6.0);
  float v = (outer + inner + glyph * 0.85 + spoke * 0.5) * breath + fill;
  vec3 col = mix(uColor, uHot, clamp(outer * 0.5 + glyph * 0.3, 0.0, 1.0));
  gl_FragColor = vec4(col * uGlow, clamp(v, 0.0, 1.0) * smoothstep(1.0, 0.97, r));
  #include <colorspace_fragment>
}
`;

/** The column of light round a bonded member: gold streaks climbing it,
 *  fading as they rise. */
const COLUMN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const COLUMN_FRAG = /* glsl */ `
uniform float uTime;
uniform float uGlow;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float x = vUv.x * 6.2832;
  float lanes = pow(max(0.5 + 0.5 * sin(x * 9.0 + sin(x * 3.0) * 1.7), 0.0), 6.0);
  float climb = fract(vUv.y * 1.6 - uTime * 0.9 + sin(x * 5.0) * 0.3);
  float streak = lanes * smoothstep(0.0, 0.25, climb) * (1.0 - smoothstep(0.25, 0.7, climb));
  float base = (1.0 - smoothstep(0.0, 0.35, vUv.y)) * 0.35;
  float a = (streak * 0.9 + base) * pow(max(1.0 - vUv.y, 0.0), 1.3) * smoothstep(0.0, 0.04, vUv.y);
  gl_FragColor = vec4(uColor * uGlow, a);
  #include <colorspace_fragment>
}
`;

/** The chain on the floor between the two sigils: a plane of length 1
 *  (z, 0 at A to 1 at B) and width 1 (x, -0.5 to 0.5). Links of light run
 *  in from both ends and meet in the middle, a bright rim along each side. */
const CHAIN_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = vec2(position.x, position.z);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const CHAIN_FRAG = /* glsl */ `
uniform float uTime;
uniform float uGlow;
uniform float uLen;
uniform float uFlow;
uniform vec3 uColor;
uniform vec3 uHot;
varying vec2 vP;
void main() {
  float t = vP.y;
  float x = abs(vP.x) * 2.0;
  float m = min(t, 1.0 - t) * uLen;
  // Chevrons pointing to the middle, marching in.
  float chev = fract((m - x * 0.6) * 0.55 - uTime * uFlow * 0.9);
  float link = smoothstep(0.0, 0.08, chev) * (1.0 - smoothstep(0.22, 0.42, chev));
  float rim = 1.0 - smoothstep(0.0, 0.12, abs(x - 0.82));
  float ends = smoothstep(0.0, 1.5, m);
  float body = (1.0 - smoothstep(0.55, 1.0, x)) * 0.18;
  float v = (link * (1.0 - smoothstep(0.7, 1.0, x)) + rim * 0.7 + body) * ends;
  vec3 col = mix(uColor, uHot, link * 0.5);
  gl_FragColor = vec4(col * uGlow, clamp(v, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _p = { x: 0, y: 0, z: 0 };
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _look: BondTetherLook = { core: 0, halo: 0, glow: 0, sigil: 0, flow: 0, flare: 0 };
const _mote = {
  speed: 0.8,
  up: 0.6,
  life: 0.7,
  size: [0.5, 0.14] as const,
  color: [1, 0.86, 0.42] as const,
  alpha: 0.95,
  pool: 'glow' as const,
};
const _spark = {
  speed: 7,
  up: 3,
  life: 0.55,
  size: [0.55, 0.12] as const,
  color: [1, 0.9, 0.55] as const,
  alpha: 1,
  pool: 'glow' as const,
};

function bondOf(e: Entity): Aura | undefined {
  const auras: Aura[] = e.auras;
  for (let i = 0; i < auras.length; i++) if (auras[i].id === COUNCIL_AURAS.bond) return auras[i];
  return undefined;
}

/** A tube of rings along t (0..1) and sides round it (the shader bends it). */
function tubeGeometry(): THREE.BufferGeometry {
  const rows = TUBE_SEGMENTS + 1;
  const cols = TUBE_SIDES + 1;
  const pos = new Float32Array(rows * cols * 3);
  const at = new Float32Array(rows * cols);
  const aa = new Float32Array(rows * cols);
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++) {
      const k = i * cols + j;
      at[k] = i / TUBE_SEGMENTS;
      aa[k] = (j / TUBE_SIDES) * Math.PI * 2;
    }
  const idx: number[] = [];
  for (let i = 0; i < TUBE_SEGMENTS; i++)
    for (let j = 0; j < TUBE_SIDES; j++) {
      const a = i * cols + j;
      const b = a + cols;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.BufferAttribute(at, 1));
  g.setAttribute('aA', new THREE.BufferAttribute(aa, 1));
  g.setIndex(idx);
  return g;
}

interface Member {
  id: number;
  role: CouncilRole;
  sigil: THREE.Mesh;
  sigilMat: THREE.ShaderMaterial;
  column: THREE.Mesh;
  columnMat: THREE.ShaderMaterial;
}

export class CouncilBondFx {
  private readonly tether = new THREE.Group();
  private readonly core: THREE.Mesh;
  private readonly halo: THREE.Mesh;
  private readonly coreMat: THREE.ShaderMaterial;
  private readonly haloMat: THREE.ShaderMaterial;
  private readonly shards: THREE.InstancedMesh;
  private readonly shardMat: THREE.ShaderMaterial;
  private readonly shardCount: number;
  private readonly members: Member[] = [];
  private readonly chain: THREE.Mesh;
  private readonly chainMat: THREE.ShaderMaterial;
  private readonly scanIds: number[] = [];
  private readonly scanRoles: CouncilRole[] = [];
  /** When the bond last pulsed (the host clock), or far in the past. */
  private pulsedAt = -99;
  private moteAcc = 0;
  private wasOn = false;
  /** Where the tether last stood (its middle), for the snap's sparks. */
  private readonly lastMid = new THREE.Vector3();

  constructor(private readonly h: CouncilFxHost) {
    const tube = tubeGeometry();
    const shardGeo = new THREE.IcosahedronGeometry(0.62, 0).scale(1, 0.7, 1.3);
    // The disc stays in its own xy plane (the sigil's shader reads it); the
    // mesh lies it on the floor.
    const discGeo = new THREE.CircleGeometry(1, 64);
    const columnGeo = new THREE.CylinderGeometry(1, 1, 1, 40, 1, true).translate(0, 0.5, 0);
    // The chain: flat on the floor, 0 to 1 along +z, centred across x.
    const chainGeo = new THREE.PlaneGeometry(1, 1, 1, 16)
      .rotateX(-Math.PI / 2)
      .translate(0, 0, 0.5);
    h.geometries.push(tube, shardGeo, discGeo, columnGeo, chainGeo);
    const tubeUniforms = () => ({
      uTime: h.uTime,
      uB: { value: new THREE.Vector3() },
      uRise: { value: 4 },
      uRadius: { value: 0.3 },
      uWrithe: { value: 1 },
      uGlow: { value: 1 },
    });
    this.coreMat = new THREE.ShaderMaterial({
      name: 'smithHeartCouncilBondCore',
      uniforms: {
        ...tubeUniforms(),
        uFlow: { value: 1.4 },
        uColor: { value: new THREE.Color(C.bond) },
        uHot: { value: new THREE.Color(0xffe7a8) },
        uSeam: { value: new THREE.Color(C.ochre) },
      },
      vertexShader: TUBE_VERT,
      fragmentShader: CORE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
      toneMapped: false,
    });
    this.haloMat = new THREE.ShaderMaterial({
      name: 'smithHeartCouncilBondHalo',
      uniforms: { ...tubeUniforms(), uColor: { value: new THREE.Color(0xffb83a) } },
      vertexShader: TUBE_VERT,
      fragmentShader: HALO_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
      toneMapped: false,
    });
    this.haloMat.uniforms.uWrithe.value = 0.35;
    this.shardMat = new THREE.ShaderMaterial({
      name: 'smithHeartCouncilBondShard',
      uniforms: {
        uStone: { value: new THREE.Color(0x5a4430) },
        uRim: { value: new THREE.Color(C.bond) },
        uGlow: { value: 1.4 },
      },
      vertexShader: SHARD_VERT,
      fragmentShader: SHARD_FRAG,
      toneMapped: false,
    });
    h.materials.push(this.coreMat, this.haloMat, this.shardMat);
    this.tether.name = 'smithHeartCouncilBondThread';
    this.tether.visible = false;
    this.core = new THREE.Mesh(tube, this.coreMat);
    this.core.name = 'smithHeartCouncilBondCore';
    this.halo = new THREE.Mesh(tube, this.haloMat);
    this.halo.name = 'smithHeartCouncilBondHalo';
    this.shardCount = Math.max(6, Math.round(SHARDS * h.density));
    this.shards = new THREE.InstancedMesh(shardGeo, this.shardMat, SHARDS);
    this.shards.name = 'smithHeartCouncilBondShards';
    this.shards.count = this.shardCount;
    this.shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (const m of [this.core, this.halo, this.shards]) {
      m.frustumCulled = false;
      this.tether.add(m);
    }
    h.root.add(this.tether);
    this.chainMat = new THREE.ShaderMaterial({
      name: 'smithHeartCouncilBondChain',
      uniforms: {
        uTime: h.uTime,
        uGlow: { value: 1 },
        uLen: { value: 1 },
        uFlow: { value: 1.4 },
        uColor: { value: new THREE.Color(C.bond) },
        uHot: { value: new THREE.Color(0xfff0c8) },
      },
      vertexShader: CHAIN_VERT,
      fragmentShader: CHAIN_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    h.materials.push(this.chainMat);
    this.chain = new THREE.Mesh(chainGeo, this.chainMat);
    this.chain.name = 'smithHeartCouncilBondChain';
    this.chain.visible = false;
    this.chain.frustumCulled = false;
    this.chain.renderOrder = floorVfxRenderOrder('encounter', 10);
    h.root.add(this.chain);
    for (let i = 0; i < 2; i++) {
      const sigilMat = new THREE.ShaderMaterial({
        name: 'smithHeartCouncilBondSigil',
        uniforms: {
          uTime: h.uTime,
          uGlow: { value: 1 },
          uSpin: { value: i === 0 ? 0.35 : -0.35 },
          uColor: { value: new THREE.Color(C.bond) },
          uHot: { value: new THREE.Color(0xfff0c8) },
        },
        vertexShader: SIGIL_VERT,
        fragmentShader: SIGIL_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      const sigil = new THREE.Mesh(discGeo, sigilMat);
      sigil.name = 'smithHeartCouncilBondSigil';
      sigil.rotation.x = -Math.PI / 2;
      sigil.renderOrder = floorVfxRenderOrder('encounter', 10);
      sigil.visible = false;
      sigil.frustumCulled = false;
      const columnMat = new THREE.ShaderMaterial({
        name: 'smithHeartCouncilBondColumn',
        uniforms: {
          uTime: h.uTime,
          uGlow: { value: 1 },
          uColor: { value: new THREE.Color(C.bond) },
        },
        vertexShader: COLUMN_VERT,
        fragmentShader: COLUMN_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const column = new THREE.Mesh(columnGeo, columnMat);
      column.name = 'smithHeartCouncilBondColumn';
      column.visible = false;
      column.frustumCulled = false;
      h.materials.push(sigilMat, columnMat);
      h.root.add(sigil, column);
      this.members.push({ id: -1, role: 'guardian', sigil, sigilMat, column, columnMat });
    }
  }

  beginScan(): void {
    this.scanIds.length = 0;
    this.scanRoles.length = 0;
  }

  /** A living council member the host's scan found. */
  see(e: Entity): void {
    const role = councilRoleOf(e.templateId);
    if (role === null || this.scanIds.length >= 2) return;
    this.scanIds.push(e.id);
    this.scanRoles.push(role);
  }

  endScan(): void {
    for (let i = 0; i < this.members.length; i++) {
      const m = this.members[i];
      m.id = i < this.scanIds.length ? this.scanIds[i] : -1;
      m.role = i < this.scanRoles.length ? this.scanRoles[i] : 'guardian';
    }
  }

  /** `heart_bond_of_the_stone_pulse`: everything flares, a ring at each end. */
  pulse(sourceId: number, targetId: number): void {
    this.pulsedAt = this.h.now();
    for (const id of [sourceId, targetId]) {
      const e = this.h.entity(id);
      if (!e) continue;
      const at = fxAnchor(e);
      this.h.particles.shockRing(at.x, at.z, C.bond, 6, 0.55);
    }
  }

  update(dt: number): void {
    const ma = this.members[0];
    const mb = this.members[1];
    const a = ma.id >= 0 ? this.h.entity(ma.id) : undefined;
    const b = mb.id >= 0 ? this.h.entity(mb.id) : undefined;
    const auraA = a && !a.dead ? bondOf(a) : undefined;
    const auraB = b && !b.dead ? bondOf(b) : undefined;
    const on = !!a && !!b && !a.dead && !b.dead && (!!auraA || !!auraB);
    if (!on || !a || !b) {
      if (this.wasOn) this.snap(!!a && !!b && !a.dead && !b.dead);
      this.hide();
      return;
    }
    this.wasOn = true;
    const now = this.h.now();
    const pulses = Math.max(auraA?.stacks ?? 0, auraB?.stacks ?? 0);
    const look = bondTetherLook(now - this.pulsedAt, pulses, now, _look);
    // The anchors: each member's upper chest on its real body.
    const pa = fxAnchor(a);
    const ax = pa.x;
    const az = pa.z;
    const ga = this.h.groundY(ax, az);
    _a.set(ax, ga + bondAnchorY(ma.role), az);
    const pb = fxAnchor(b);
    const gb = this.h.groundY(pb.x, pb.z);
    _b.set(pb.x, gb + bondAnchorY(mb.role), pb.z);
    const span = Math.hypot(_b.x - _a.x, _b.z - _a.z);
    const rise = bondArch(span);
    this.tether.position.copy(_a);
    _v.subVectors(_b, _a);
    this.coreMat.uniforms.uB.value.copy(_v);
    this.coreMat.uniforms.uRise.value = rise;
    this.haloMat.uniforms.uB.value.copy(_v);
    this.haloMat.uniforms.uRise.value = rise;
    this.coreMat.uniforms.uRadius.value = look.core;
    this.coreMat.uniforms.uGlow.value = look.glow;
    this.coreMat.uniforms.uFlow.value = look.flow;
    this.haloMat.uniforms.uRadius.value = look.halo;
    this.haloMat.uniforms.uGlow.value = 0.8 + 0.6 * look.flare;
    this.shardMat.uniforms.uGlow.value = 1.2 + 1.2 * look.flare;
    this.tether.visible = true;
    bondArchPoint(0.5, _v.x, _v.y, _v.z, rise, _p);
    this.lastMid.set(_a.x + _p.x, _a.y + _p.y, _a.z + _p.z);
    this.placeShards(now, rise, look);
    this.placeMember(ma, a, look);
    this.placeMember(mb, b, look);
    this.placeChain(ax, ga, az, pb.x, gb, pb.z, span, look);
    // Gold motes shed along it (cosmetic: thin on the low tier).
    this.moteAcc += dt * 14 * this.h.density;
    while (this.moteAcc >= 1) {
      this.moteAcc -= 1;
      const t = this.h.rand();
      bondArchPoint(t, _v.x, _v.y, _v.z, rise, _p);
      this.h.particles.puff(_a.x + _p.x, _a.y + _p.y, _a.z + _p.z, 1, _mote);
    }
  }

  /** The shards: tumbling in from both ends along the arch, growing out of
   *  the bodies and crumbling to nothing as they meet in the middle. */
  private placeShards(now: number, rise: number, look: BondTetherLook): void {
    for (let i = 0; i < this.shardCount; i++) {
      const seed = (i * 0.618034) % 1;
      const f = (seed + now * (0.16 + 0.05 * look.flow) * (0.8 + 0.4 * ((i * 0.37) % 1))) % 1;
      const t = i % 2 === 0 ? 0.5 * f : 1 - 0.5 * f;
      bondArchPoint(t, _v.x, _v.y, _v.z, rise, _p);
      const swirl = now * 2.2 + i * 1.7;
      const off = look.core * 1.6;
      const size = Math.sin(Math.PI * f) * (0.55 + 0.45 * ((i * 0.71) % 1));
      _s.setScalar(Math.max(0.001, size));
      _e.set(now * (1.3 + (i % 3)), now * (0.9 + (i % 4) * 0.4), i);
      _q.setFromEuler(_e);
      _pos.set(_p.x + Math.cos(swirl) * off, _p.y + Math.sin(swirl) * off, _p.z);
      _m.compose(_pos, _q, _s);
      this.shards.setMatrixAt(i, _m);
    }
    this.shards.instanceMatrix.needsUpdate = true;
  }

  /** A bonded member's sigil on the floor and its column of light. */
  private placeMember(m: Member, e: Entity, look: BondTetherLook): void {
    const at = fxAnchor(e);
    const y = this.h.groundY(at.x, at.z);
    const spec = bondSigil(m.role);
    const r = spec.radius * (1 + 0.12 * look.flare);
    m.sigil.position.set(at.x, y + 0.12, at.z);
    m.sigil.scale.set(r, r, 1);
    m.sigilMat.uniforms.uGlow.value = look.sigil;
    m.sigil.visible = true;
    const cr = spec.radius * 0.62;
    m.column.position.set(at.x, y + 0.05, at.z);
    m.column.scale.set(cr, spec.column * (1 + 0.1 * look.flare), cr);
    m.columnMat.uniforms.uGlow.value = 0.7 * look.sigil;
    m.column.visible = true;
  }

  /** The chain on the floor from sigil to sigil. */
  private placeChain(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    span: number,
    look: BondTetherLook,
  ): void {
    const ra = bondSigil(this.members[0].role).radius * 0.85;
    const rb = bondSigil(this.members[1].role).radius * 0.85;
    const len = span - ra - rb;
    if (len < 0.5) {
      this.chain.visible = false;
      return;
    }
    const ux = (bx - ax) / span;
    const uz = (bz - az) / span;
    this.chain.position.set(ax + ux * ra, 0.5 * (ay + by) + 0.1, az + uz * ra);
    this.chain.rotation.set(0, Math.atan2(ux, uz), 0);
    this.chain.scale.set(1.5 + 0.4 * look.flare, 1, len);
    this.chainMat.uniforms.uLen.value = len;
    this.chainMat.uniforms.uGlow.value = look.sigil;
    this.chainMat.uniforms.uFlow.value = look.flow;
    this.chain.visible = true;
  }

  /** The bond broke with both still standing: the tether snaps in a spray
   *  of gold sparks at its middle (cosmetic: thin on the low tier). */
  private snap(apart: boolean): void {
    this.wasOn = false;
    if (!apart) return;
    const n = Math.max(4, Math.round(22 * this.h.density));
    this.h.particles.puff(this.lastMid.x, this.lastMid.y, this.lastMid.z, n, _spark);
    this.h.particles.shockRing(this.lastMid.x, this.lastMid.z, C.bond, 4, 0.4);
  }

  /** The shards' instance buffer (the host disposes the geometries and
   *  materials). */
  dispose(): void {
    this.shards.dispose();
  }

  private hide(): void {
    this.tether.visible = false;
    this.chain.visible = false;
    for (const m of this.members) {
      m.sigil.visible = false;
      m.column.visible = false;
    }
  }
}
