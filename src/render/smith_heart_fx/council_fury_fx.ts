// The Hammer Council's Grieving Fury (encounters/smith_heart/council_fury.ts,
// COUNCIL_AURAS.fury), a part of CouncilFx: the survivor once the fallen one's
// soul has reached it, burning in the FALLEN one's colour (the Guardian's
// ember red on the Singer, the Singer's sky blue on the Guardian; the aura's
// value2 names it, council_fury.ts furyFallenOf):
//  - the wake (COUNCIL_CUES.furyWake): a white-hot flash through all of it,
//    two shock rings and a burst of embers, the floor shaken;
//  - the body swells (bodySwell, read by the renderer's display scale: the
//    shipped models grow to COUNCIL_TUNING.furySwell, a breath past it as
//    they grow) and throbs with a double heartbeat;
//  - a column of ragged flame-light round the body, climbing past its crown;
//  - a cracked sigil on the floor under it, its seams burning;
//  - shards of quarry stone torn loose, orbiting its chest, their edges lit;
//  - embers rising off it;
//  - the landing's heal (COUNCIL_CUES.furyHeal, all at once since the
//    playtest of 2026-11-19): a big healing flash up the whole body (a
//    column of green-gold light motes, two wide rings in the healing green
//    and one in the fallen one's colour); the number itself is the HUD's
//    floating heal text off the sim's `heal` event.
// It says the survivor is enraged and healed, so the column, the sigil and
// the swell draw on EVERY tier; only the embers and the shards thin. Built in
// the constructor under the host's root (the host's one gated attach links
// every program); fixed pieces, no light, no per-frame allocation; the members
// are found at the host's scan pace.

import * as THREE from 'three';
import {
  type CouncilRole,
  councilRoleOf,
  furyFallenOf,
} from '../../sim/encounters/smith_heart/council_ids';
import type { Aura, Entity } from '../../sim/types';
import { fxAnchor } from '../attached_fx_anchor';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { radialGlowTexture } from '../textures';
import { COUNCIL_AURAS, SOUL_COLORS } from './council_fx_core';
import {
  FURY_FLOOR,
  type FuryLook,
  furyFloorDim,
  furyLook,
  MEMBER_BODY,
} from './council_mechanic_look_core';
import type { CouncilFxHost } from './council_pillars_fx';

/** The stone shards torn loose round the survivor (the low tier draws fewer). */
const SHARDS = 12;
/** The Singer's storm on the Guardian: lightning arcs crawling over his body,
 *  each a jagged run of segments, drawn as two crossed ribbons (so it reads
 *  from every side), re-struck many times a second. */
const ARCS = 14;
const ARC_SEGS = 9;
/** Seconds an arc holds its shape before it re-strikes (the flicker). */
const ARC_HOLD = 0.11;

/** An arc ribbon: its across-coordinate (-1 to 1), its place along the arc
 *  (0 to 1) and its own flicker. A white-hot core in a steel-blue halo. */
const ARC_VERT = /* glsl */ `
attribute float aSide;
attribute float aT;
attribute float aLive;
varying float vSide;
varying float vT;
varying float vLive;
void main() {
  vSide = aSide;
  vT = aT;
  vLive = aLive;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const ARC_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uHot;
uniform float uGlow;
varying float vSide;
varying float vT;
varying float vLive;
void main() {
  float across = abs(vSide);
  float core = 1.0 - smoothstep(0.0, 0.32, across);
  float halo = pow(max(1.0 - across, 0.0), 2.0);
  float ends = smoothstep(0.0, 0.12, vT) * (1.0 - smoothstep(0.85, 1.0, vT));
  float a = (core + halo * 0.55) * ends * vLive;
  vec3 col = mix(uColor, uHot, core);
  gl_FragColor = vec4(col * uGlow, clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

/** The scorch under the fury: a dark burn in the floor (normal blending, so
 *  the light of the sigil over it reads against the warm quarry stone). */
const SCORCH_FRAG = /* glsl */ `
uniform float uAlpha;
varying vec2 vP;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  float r = length(vP);
  if (r > 1.0) discard;
  float ang = atan(vP.y, vP.x);
  float ragged = 0.82 + 0.12 * sin(ang * 7.0) + 0.06 * sin(ang * 17.0 + 1.3);
  float burn = 1.0 - smoothstep(ragged * 0.55, ragged, r);
  float grain = 0.85 + 0.15 * hash(floor(vP * 40.0));
  gl_FragColor = vec4(vec3(0.03, 0.035, 0.06), burn * uAlpha * grain);
  #include <colorspace_fragment>
}
`;

/** The column: ragged tongues of light climbing an open cylinder (uv.y up),
 *  hottest at its foot, a heartbeat throbbing up it. */
const COLUMN_VERT = /* glsl */ `
varying vec2 vUv;
varying float vFace;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vFace = abs(dot(n, normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}
`;
const COLUMN_FRAG = /* glsl */ `
uniform float uTime;
uniform float uGlow;
uniform float uBeat;
uniform vec3 uColor;
uniform vec3 uHot;
varying vec2 vUv;
varying float vFace;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
void main() {
  // Around the column (wrapped: 8 cells round it) and up it.
  float x = vUv.x * 8.0;
  float y = vUv.y;
  // Tongues of fire: domain-warped noise stretched up the column, racing up,
  // each one tapering to a point as it climbs.
  float warp = noise(vec2(x * 1.3, y * 2.0 - uTime * 0.9)) * 1.4;
  float n = noise(vec2(x + warp, y * 2.6 - uTime * 2.4)) * 0.6
    + noise(vec2(x * 2.1 - warp, y * 5.0 - uTime * 3.7)) * 0.4;
  float tongue = smoothstep(0.45 + y * 0.35, 0.8 + y * 0.15, n + (1.0 - y) * 0.2);
  float core = smoothstep(0.7 + y * 0.2, 0.98, n + (1.0 - y) * 0.2);
  // The heartbeat's band climbing it.
  float bd = (y - fract(uTime * 0.95)) * 7.0;
  float band = exp(-(bd * bd)) * uBeat * tongue;
  // No hard silhouette (a volume of fire, not a glass tube): it fades out at
  // the column's edges and stays thin where it faces the eye, so the body
  // inside reads through it.
  float soft = smoothstep(0.02, 0.45, vFace) * (0.35 + 0.65 * (1.0 - vFace));
  float a = (tongue * 0.7 + core * 0.45 + band * 0.5) * soft * smoothstep(0.0, 0.04, y)
    * pow(max(1.0 - y, 0.0), 0.6);
  vec3 col = mix(uColor, uHot, clamp(core * 0.8 + band * 0.5, 0.0, 1.0));
  gl_FragColor = vec4(col * uGlow, clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

/** The sigil: a disc of radius 1 on the floor, cracked into cells whose seams
 *  burn, a ring at its rim, the light breathing out from the middle. */
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
uniform float uBeat;
uniform vec3 uColor;
uniform vec3 uHot;
uniform float uCrack;
varying vec2 vP;
float hash1(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
void main() {
  float r = length(vP);
  if (r > 1.0) discard;
  // Cell seams (the distance to the nearest edge of a jittered grid's cells).
  vec2 g = vP * 4.2;
  vec2 i = floor(g);
  vec2 f = fract(g);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 p = o + hash2(i + o) - f;
      float d = dot(p, p);
      if (d < d1) { d2 = d1; d1 = d; }
      else if (d < d2) d2 = d;
    }
  float seam = 1.0 - smoothstep(0.0, 0.09, sqrt(d2) - sqrt(d1));
  float wave = 0.5 + 0.5 * sin(r * 14.0 - uTime * 5.0);
  float ring = 1.0 - smoothstep(0.0, 0.04, abs(r - 0.95));
  float inner = 1.0 - smoothstep(0.0, 0.03, abs(r - 0.42 - 0.04 * uBeat));
  float fade = 1.0 - smoothstep(0.75, 1.0, r);
  // The storm's floor (uCrack): no tiled seams and no rings, but cracks
  // burning out of the burn from under the body, forking as they run, each
  // dying out at its own length; the seams only where a crack passes.
  float ang = atan(vP.y, vP.x);
  float k = ang * 9.0 / 6.2832;
  float lane = floor(k);
  float jit = (hash1(vec2(lane, 3.0)) - 0.5) * 0.6;
  float wob = sin(r * 23.0 + lane * 4.1) * 0.06 + sin(r * 51.0 + lane) * 0.025;
  float dk = abs(fract(k) - 0.5 - jit * 0.5 - wob * 4.0);
  float reach = 0.55 + 0.4 * hash1(vec2(lane, 7.0));
  float crack = (1.0 - smoothstep(0.0, 0.035 + 0.02 * (1.0 - r), dk)) * (1.0 - smoothstep(reach - 0.15, reach, r));
  float fork = seam * step(0.5, hash1(i)) * (1.0 - smoothstep(0.25, 0.8, r));
  float burning = max(crack, fork * 0.8) * (0.65 + 0.35 * wave);
  float vSt = burning + (1.0 - smoothstep(0.0, 0.22, r)) * 0.35 * (1.0 + uBeat);
  float vRune = seam * (0.55 + 0.45 * wave) * fade + ring * 0.9 + inner * 0.55
    + (1.0 - r) * 0.18 * (1.0 + uBeat);
  float v = mix(vRune, vSt, uCrack);
  seam = mix(seam, burning, uCrack);
  vec3 col = mix(uColor, uHot, clamp(seam * wave * 0.6 + uBeat * 0.3, 0.0, 1.0));
  gl_FragColor = vec4(col * uGlow, clamp(v, 0.0, 1.0) * smoothstep(1.0, 0.96, r));
  #include <colorspace_fragment>
}
`;

/** A shard of the fallen one's crystal: a burning spike, white-hot at its
 *  heart and the fury's colour toward its edges, a dark seam of stone down
 *  its faces. */
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
uniform vec3 uHot;
uniform float uGlow;
varying vec3 vN;
varying vec3 vView;
void main() {
  vec3 n = normalize(vN);
  float lit = 0.35 + 0.65 * clamp(dot(n, normalize(vec3(0.2, 0.9, 0.35))), 0.0, 1.0);
  float face = clamp(abs(dot(n, vView)), 0.0, 1.0);
  float rim = pow(max(1.0 - face, 0.0), 1.4);
  vec3 body = mix(uRim * 0.55, uHot, pow(max(face, 0.0), 3.0) * 0.6) * lit;
  vec3 col = mix(uStone * lit, body, 0.8) + uRim * rim * uGlow * 0.7;
  gl_FragColor = vec4(col * (0.7 + 0.3 * uGlow), 1.0);
  #include <colorspace_fragment>
}
`;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _look: FuryLook = { swell: 1, glow: 0, flash: 0, beat: 0 };
const _ember = {
  speed: 1.2,
  up: 3.2,
  life: 1.1,
  size: [0.75, 0.15] as [number, number],
  color: [1, 0.5, 0.2] as [number, number, number],
  alpha: 0.95,
  pool: 'glow' as const,
};
const _burst = {
  speed: 9,
  up: 5,
  life: 1.1,
  size: [2.4, 0.4] as [number, number],
  color: [1, 0.5, 0.2] as [number, number, number],
  alpha: 1,
  pool: 'glow' as const,
};
/** The landing heal's motes: a fountain of healing light up the body. */
const _heal = {
  speed: 2.4,
  up: 7,
  life: 1.5,
  size: [2.2, 0.3] as [number, number],
  color: [0.55, 1, 0.5] as [number, number, number],
  alpha: 1,
  pool: 'glow' as const,
};
/** The healing green of its rings and flash. */
const HEAL_GREEN = 0x7dff8a;
const HEAL_GOLD = 0xfff2a8;

function furyOf(e: Entity): Aura | undefined {
  const auras: Aura[] = e.auras;
  for (let i = 0; i < auras.length; i++) if (auras[i].id === COUNCIL_AURAS.fury) return auras[i];
  return undefined;
}

/** A fury colour's linear rgb from its hex (into `out`). */
function rgbOf(hex: number, out: [number, number, number]): [number, number, number] {
  out[0] = ((hex >> 16) & 255) / 255;
  out[1] = ((hex >> 8) & 255) / 255;
  out[2] = (hex & 255) / 255;
  return out;
}

/** The hot core colour of a fallen role's fury (its soul colour, whitened). */
const HOT: Readonly<Record<CouncilRole, number>> = { guardian: 0xffd9a8, singer: 0xd8f0ff };

export class CouncilFuryFx {
  private readonly column: THREE.Mesh;
  private readonly columnMat: THREE.ShaderMaterial;
  private readonly sigil: THREE.Mesh;
  private readonly sigilMat: THREE.ShaderMaterial;
  private readonly shards: THREE.InstancedMesh;
  private readonly shardMat: THREE.ShaderMaterial;
  private readonly shardCount: number;
  /** The Singer's storm on the Guardian: the arcs' ribbons, rebuilt in place. */
  private readonly arcs: THREE.Mesh;
  private readonly arcMat: THREE.ShaderMaterial;
  private readonly arcPos: Float32Array;
  private readonly arcLive: Float32Array;
  private readonly arcGeo: THREE.BufferGeometry;
  /** Each arc's points (body-relative unit shell), its strike clock and seed. */
  private readonly arcPts: Float32Array = new Float32Array(ARCS * (ARC_SEGS + 1) * 3);
  private readonly arcClock: Float32Array = new Float32Array(ARCS);
  /** The burn in the floor under the fury. */
  private readonly scorch: THREE.Mesh;
  private readonly scorchMat: THREE.ShaderMaterial;
  /** A glow behind the body, throbbing with the heartbeat (it burns). */
  private readonly glow: THREE.Sprite;
  private readonly glowMat: THREE.SpriteMaterial;
  private readonly glowTex: THREE.Texture | null;
  /** The survivor wearing the fury (the scan's find), its role and the
   *  fallen one's, and when its fury woke on the host clock. */
  private id = -1;
  private role: CouncilRole = 'guardian';
  private fallen: CouncilRole | null = null;
  private wokeAt = -99;
  private scanId = -1;
  private scanRole: CouncilRole = 'guardian';
  private scanFallen: CouncilRole = 'guardian';
  private emberAcc = 0;
  private readonly rgb: [number, number, number] = [1, 0.5, 0.2];

  constructor(private readonly h: CouncilFxHost) {
    const columnGeo = new THREE.CylinderGeometry(1, 1.25, 1, 48, 1, true).translate(0, 0.5, 0);
    const discGeo = new THREE.CircleGeometry(1, 72);
    const shardGeo = new THREE.OctahedronGeometry(0.55, 0).scale(0.42, 1.5, 0.32);
    h.geometries.push(columnGeo, discGeo, shardGeo);
    this.columnMat = new THREE.ShaderMaterial({
      name: 'smithHeartCouncilFuryColumn',
      uniforms: {
        uTime: h.uTime,
        uGlow: { value: 1 },
        uBeat: { value: 0 },
        uColor: { value: new THREE.Color(SOUL_COLORS.guardian.hex) },
        uHot: { value: new THREE.Color(HOT.guardian) },
      },
      vertexShader: COLUMN_VERT,
      fragmentShader: COLUMN_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.sigilMat = new THREE.ShaderMaterial({
      name: 'smithHeartCouncilFurySigil',
      uniforms: {
        uTime: h.uTime,
        uGlow: { value: 1 },
        uBeat: { value: 0 },
        uColor: { value: new THREE.Color(SOUL_COLORS.guardian.hex) },
        uHot: { value: new THREE.Color(HOT.guardian) },
        uCrack: { value: 0 },
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
    this.shardMat = new THREE.ShaderMaterial({
      name: 'smithHeartCouncilFuryShard',
      uniforms: {
        uStone: { value: new THREE.Color(0x3a2c22) },
        uRim: { value: new THREE.Color(SOUL_COLORS.guardian.hex) },
        uHot: { value: new THREE.Color(HOT.guardian) },
        uGlow: { value: 1.6 },
      },
      vertexShader: SHARD_VERT,
      fragmentShader: SHARD_FRAG,
      toneMapped: false,
    });
    // The arcs: ARCS x ARC_SEGS segments, each two crossed quads.
    const quads = ARCS * ARC_SEGS * 2;
    this.arcPos = new Float32Array(quads * 4 * 3);
    this.arcLive = new Float32Array(quads * 4);
    const side = new Float32Array(quads * 4);
    const along = new Float32Array(quads * 4);
    const idx: number[] = [];
    for (let a = 0; a < ARCS; a++)
      for (let s = 0; s < ARC_SEGS; s++)
        for (let k = 0; k < 2; k++) {
          const q = (a * ARC_SEGS + s) * 2 + k;
          const v = q * 4;
          side.set([-1, 1, -1, 1], v);
          const t0 = s / ARC_SEGS;
          const t1 = (s + 1) / ARC_SEGS;
          along.set([t0, t0, t1, t1], v);
          idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
        }
    this.arcGeo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(this.arcPos, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    const liveAttr = new THREE.BufferAttribute(this.arcLive, 1);
    liveAttr.setUsage(THREE.DynamicDrawUsage);
    this.arcGeo.setAttribute('position', posAttr);
    this.arcGeo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    this.arcGeo.setAttribute('aT', new THREE.BufferAttribute(along, 1));
    this.arcGeo.setAttribute('aLive', liveAttr);
    this.arcGeo.setIndex(idx);
    this.arcMat = new THREE.ShaderMaterial({
      name: 'smithHeartCouncilFuryArc',
      uniforms: {
        uColor: { value: new THREE.Color(0x3d7bff) },
        uHot: { value: new THREE.Color(0xeaf4ff) },
        uGlow: { value: 1.6 },
      },
      vertexShader: ARC_VERT,
      fragmentShader: ARC_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.arcs = new THREE.Mesh(this.arcGeo, this.arcMat);
    this.arcs.name = 'smithHeartCouncilFuryArcs';
    this.arcs.renderOrder = 4;
    h.geometries.push(this.arcGeo);
    this.scorchMat = new THREE.ShaderMaterial({
      name: 'smithHeartCouncilFuryScorch',
      uniforms: { uAlpha: { value: 0.6 } },
      vertexShader: SIGIL_VERT,
      fragmentShader: SCORCH_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.scorch = new THREE.Mesh(discGeo, this.scorchMat);
    this.scorch.name = 'smithHeartCouncilFuryScorch';
    this.scorch.rotation.x = -Math.PI / 2;
    // The floor ladder: the burn under, the burning sigil over it.
    this.scorch.renderOrder = floorVfxRenderOrder('encounter', 9);
    this.glowTex = typeof document !== 'undefined' ? radialGlowTexture() : null;
    this.glowMat = new THREE.SpriteMaterial({
      name: 'smithHeartCouncilFuryGlow',
      map: this.glowTex,
      color: new THREE.Color(SOUL_COLORS.guardian.hex),
      transparent: true,
      depthWrite: false,
      // Over the body, not hidden behind it: the survivor itself burns in
      // the fallen one's light (soft, so nothing it covers stops reading).
      depthTest: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.glow = new THREE.Sprite(this.glowMat);
    this.glow.renderOrder = 5;
    this.glow.name = 'smithHeartCouncilFuryGlow';
    h.materials.push(
      this.columnMat,
      this.sigilMat,
      this.shardMat,
      this.glowMat,
      this.arcMat,
      this.scorchMat,
    );
    this.column = new THREE.Mesh(columnGeo, this.columnMat);
    this.column.name = 'smithHeartCouncilFuryColumn';
    this.sigil = new THREE.Mesh(discGeo, this.sigilMat);
    this.sigil.name = 'smithHeartCouncilFurySigil';
    this.sigil.rotation.x = -Math.PI / 2;
    this.sigil.renderOrder = floorVfxRenderOrder('encounter', 10);
    this.shardCount = Math.max(5, Math.round(SHARDS * h.density));
    this.shards = new THREE.InstancedMesh(shardGeo, this.shardMat, SHARDS);
    this.shards.name = 'smithHeartCouncilFuryShards';
    this.shards.count = this.shardCount;
    this.shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (const m of [this.column, this.sigil, this.shards, this.glow, this.arcs, this.scorch]) {
      m.visible = false;
      m.frustumCulled = false;
      h.root.add(m);
    }
  }

  beginScan(): void {
    this.scanId = -1;
  }

  /** The floor's strength this frame: dimmed while a council warning lies
   *  on the floor (CouncilFx says so each frame). */
  private floorDim = 1;
  setTelegraphs(any: boolean): void {
    this.floorDim = furyFloorDim(any);
  }

  /** A living council member the host's scan found. */
  see(e: Entity): void {
    if (this.scanId >= 0) return;
    const aura = furyOf(e);
    const role = councilRoleOf(e.templateId);
    if (!aura || role === null) return;
    this.scanId = e.id;
    this.scanRole = role;
    this.scanFallen = furyFallenOf(aura.value2);
  }

  endScan(): void {
    if (this.scanId === this.id) return;
    this.id = this.scanId;
    if (this.id < 0) {
      this.fallen = null;
      this.hide();
      return;
    }
    this.role = this.scanRole;
    // A fury first seen without its wake cue (a late joiner): already grown.
    if (this.h.now() - this.wokeAt > 1) this.wokeAt = this.h.now() - 10;
    this.tint(this.scanFallen);
  }

  /** `heart_grieving_fury_wake`: the soul lands in the survivor. */
  wake(survivorId: number): void {
    const e = this.h.entity(survivorId);
    if (!e) return;
    this.wokeAt = this.h.now();
    const aura = furyOf(e);
    const role = councilRoleOf(e.templateId);
    if (role) {
      this.id = survivorId;
      this.role = role;
    }
    // The aura rides the same tick as the cue; a mirror that lags a tick
    // still knows the fallen: it is the one that is not this survivor.
    this.tint(aura ? furyFallenOf(aura.value2) : role === 'guardian' ? 'singer' : 'guardian');
    const at = fxAnchor(e);
    const y = this.h.groundY(at.x, at.z);
    _burst.color = this.rgb;
    // (The particles thin the count on the low tier themselves.)
    this.h.particles.puff(at.x, y + this.chest() * 0.8, at.z, 56, _burst);
    const hex = SOUL_COLORS[this.fallen ?? 'guardian'].hex;
    this.h.particles.shockRing(at.x, at.z, hex, 12, 0.9);
    this.h.particles.shockRing(at.x, at.z, HOT[this.fallen ?? 'guardian'], 7, 0.55);
    this.h.shakeNear(at.x, at.z, 0.45, 45);
  }

  /** `heart_grieving_fury_heal`: the landing heals the survivor at once: a
   *  big healing flash up the whole body, read from across the Quarry. */
  heal(survivorId: number): void {
    const e = this.h.entity(survivorId);
    if (!e) return;
    const role = councilRoleOf(e.templateId) ?? this.role;
    const at = fxAnchor(e);
    const y = this.h.groundY(at.x, at.z);
    const height = MEMBER_BODY[role].height;
    // A fountain of light at the feet, the chest and the crown.
    this.h.particles.puff(at.x, y + 1, at.z, 40, _heal);
    this.h.particles.puff(at.x, y + height * MEMBER_BODY[role].chest, at.z, 36, _heal);
    this.h.particles.puff(at.x, y + height * 0.95, at.z, 24, _heal);
    this.h.particles.shockRing(at.x, at.z, HEAL_GREEN, 14, 1.1);
    this.h.particles.shockRing(at.x, at.z, HEAL_GOLD, 9, 0.8);
    this.h.particles.shockRing(at.x, at.z, HOT[this.fallen ?? 'guardian'], 5.5, 0.55);
  }

  /** The body's size against its own: the renderer's display scale reads it
   *  (1 for anyone but the survivor). */
  bodySwell(id: number): number {
    if (id !== this.id || this.id < 0 || this.fallen === null) return 1;
    return furyLook(this.h.now() - this.wokeAt, _look).swell;
  }

  update(dt: number): void {
    if (this.id < 0 || this.fallen === null) return;
    const e = this.h.entity(this.id);
    if (!e || e.dead) {
      this.hide();
      return;
    }
    const look = furyLook(this.h.now() - this.wokeAt, _look);
    const at = fxAnchor(e);
    const y = this.h.groundY(at.x, at.z);
    const body = MEMBER_BODY[this.role];
    const height = body.height * look.swell;
    const r = Math.max(2.2, body.height * 0.3) * look.swell;
    // The Guardian's fury (the Singer's soul) is a storm that hugs his body:
    // arcs crawling over the stone, never a column over him. The Singer's (the
    // Guardian's soul) is fire round her.
    const storm = this.fallen === 'singer';
    if (storm) {
      this.column.visible = false;
      this.placeArcs(dt, at.x, y, at.z, height, look);
    } else {
      this.arcs.visible = false;
      this.column.position.set(at.x, y + 0.05, at.z);
      this.column.scale.set(r, height * 1.45, r);
      this.columnMat.uniforms.uGlow.value = look.glow;
      this.columnMat.uniforms.uBeat.value = look.beat;
      this.column.visible = true;
    }
    // The floor stays close and soft, dimmer still under a warning
    // (FURY_FLOOR: the team's playtest of 2026-11-25).
    const sr = r * FURY_FLOOR.reach * (1 + 0.05 * look.beat + 0.25 * look.flash);
    this.scorch.position.set(at.x, y + 0.1, at.z);
    this.scorch.scale.set(sr * 1.08, sr * 1.08, 1);
    this.scorchMat.uniforms.uAlpha.value =
      (storm ? FURY_FLOOR.scorch.storm : FURY_FLOOR.scorch.fire) * this.floorDim;
    this.sigilMat.uniforms.uCrack.value = storm ? 1 : 0;
    this.scorch.visible = true;
    this.sigil.position.set(at.x, y + 0.13, at.z);
    this.sigil.scale.set(sr, sr, 1);
    this.sigilMat.uniforms.uGlow.value = FURY_FLOOR.sigilGlow * look.glow * this.floorDim;
    this.sigilMat.uniforms.uBeat.value = look.beat;
    this.sigil.visible = true;
    this.placeShards(at.x, y + height * body.chest, at.z, r, look);
    const gs = height * (0.95 + 0.1 * look.beat + 0.5 * look.flash);
    this.glow.position.set(at.x, y + height * 0.55, at.z);
    this.glow.scale.set(gs, gs * 1.15, 1);
    this.glowMat.opacity =
      (this.fallen === 'singer' ? 0.36 : 0.22) + 0.18 * look.beat + 0.6 * look.flash;
    this.glow.visible = true;
    // Embers rising off it (cosmetic: thin on the low tier).
    this.emberAcc += dt * (18 + 40 * look.flash) * this.h.density;
    _ember.color = this.rgb;
    while (this.emberAcc >= 1) {
      this.emberAcc -= 1;
      const a = this.h.rand() * Math.PI * 2;
      const d = r * (0.4 + 0.6 * this.h.rand());
      this.h.particles.puff(
        at.x + Math.sin(a) * d,
        y + height * (0.15 + 0.7 * this.h.rand()),
        at.z + Math.cos(a) * d,
        1,
        _ember,
      );
    }
  }

  /** The storm's arcs: each runs a jagged way over a shell hugging the body
   *  (most of them climbing), re-strikes every ARC_HOLD seconds, a few dark
   *  at any moment so it crackles. More and brighter at the wake. */
  private placeArcs(
    dt: number,
    x: number,
    y: number,
    z: number,
    height: number,
    look: FuryLook,
  ): void {
    // A shell just outside the stone (the Guardian is broad in the shoulders
    // and fists): the arcs crawl over it, the body hiding the far ones.
    const R = Math.max(1.8, height * 0.34);
    const H = height * 0.47;
    const cy = y + height * 0.52;
    const P = this.arcPts;
    const pos = this.arcPos;
    const live = this.arcLive;
    const w = Math.max(0.12, height * 0.016) * (1 + 0.6 * look.flash);
    for (let a = 0; a < ARCS; a++) {
      this.arcClock[a] -= dt;
      const base = a * (ARC_SEGS + 1) * 3;
      if (this.arcClock[a] <= 0) {
        this.arcClock[a] = ARC_HOLD * (0.6 + 0.8 * this.h.rand());
        // A new path on the unit shell: an angle round the body and a height.
        let th = this.h.rand() * Math.PI * 2;
        let v = -0.85 + this.h.rand() * 1.2;
        for (let s = 0; s <= ARC_SEGS; s++) {
          const rr = 1 + (this.h.rand() - 0.5) * 0.18;
          P[base + s * 3] = Math.cos(th) * rr;
          P[base + s * 3 + 1] = v;
          P[base + s * 3 + 2] = Math.sin(th) * rr;
          th += (this.h.rand() - 0.5) * 0.55;
          v += 0.06 + (this.h.rand() - 0.35) * 0.22;
        }
        // Dark this strike? (about a third are, more at rest, fewer in the wake)
        const on = this.h.rand() < 0.62 + 0.35 * look.flash ? 1 : 0;
        const vv = a * ARC_SEGS * 2 * 4;
        live.fill(on * (0.6 + 0.4 * this.h.rand()), vv, vv + ARC_SEGS * 2 * 4);
      }
      for (let s = 0; s < ARC_SEGS; s++) {
        const i0 = base + s * 3;
        const i1 = i0 + 3;
        const ax = x + P[i0] * R;
        const ay = cy + P[i0 + 1] * H;
        const az = z + P[i0 + 2] * R;
        const bx = x + P[i1] * R;
        const by = cy + P[i1 + 1] * H;
        const bz = z + P[i1 + 2] * R;
        _a.set(bx - ax, by - ay, bz - az);
        // Two crossed ribbons: across the run, flat to the shell, and out of it.
        _b.set(P[i0], 0, P[i0 + 2]).normalize();
        _c.crossVectors(_a, _b).normalize().multiplyScalar(w);
        _b.multiplyScalar(w);
        for (let k = 0; k < 2; k++) {
          const off = k === 0 ? _c : _b;
          const v = ((a * ARC_SEGS + s) * 2 + k) * 4 * 3;
          pos[v] = ax - off.x;
          pos[v + 1] = ay - off.y;
          pos[v + 2] = az - off.z;
          pos[v + 3] = ax + off.x;
          pos[v + 4] = ay + off.y;
          pos[v + 5] = az + off.z;
          pos[v + 6] = bx - off.x;
          pos[v + 7] = by - off.y;
          pos[v + 8] = bz - off.z;
          pos[v + 9] = bx + off.x;
          pos[v + 10] = by + off.y;
          pos[v + 11] = bz + off.z;
        }
      }
    }
    (this.arcGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.arcGeo.getAttribute('aLive') as THREE.BufferAttribute).needsUpdate = true;
    this.arcMat.uniforms.uGlow.value = 1.5 + 0.7 * look.beat + 1.8 * look.flash;
    this.arcs.visible = true;
  }

  /** The shards: orbiting the chest on tilted rings, tumbling, flung wide by
   *  the wake and drawn back in. */
  private placeShards(x: number, y: number, z: number, r: number, look: FuryLook): void {
    const now = this.h.now();
    const reach = r * (1.25 + 0.9 * look.flash);
    for (let i = 0; i < this.shardCount; i++) {
      const k = i / this.shardCount;
      const speed = 0.55 + 0.25 * ((i * 0.37) % 1);
      const a = k * Math.PI * 2 + now * speed * (i % 2 === 0 ? 1 : -1);
      const tilt = 0.35 * Math.sin(k * 11.0);
      const bob = Math.sin(now * 1.7 + i * 1.3) * 0.6;
      const d = reach * (0.85 + 0.3 * ((i * 0.618) % 1));
      _pos.set(x + Math.cos(a) * d, y + bob + Math.sin(a) * d * tilt, z + Math.sin(a) * d);
      const size = (0.6 + 0.55 * ((i * 0.71) % 1)) * (1 + 0.2 * look.beat);
      _s.setScalar(size);
      _e.set(now * (1.1 + (i % 3) * 0.4), now * (0.7 + (i % 4) * 0.3), i * 0.9);
      _q.setFromEuler(_e);
      _m.compose(_pos, _q, _s);
      this.shards.setMatrixAt(i, _m);
    }
    this.shards.instanceMatrix.needsUpdate = true;
    this.shardMat.uniforms.uGlow.value = 1.1 + 0.8 * look.beat + 1.6 * look.flash;
    this.shards.visible = true;
  }

  /** Light every piece in the fallen one's colour (a write per fury, never a
   *  frame). */
  private tint(fallen: CouncilRole): void {
    if (this.fallen === fallen) return;
    this.fallen = fallen;
    const c = SOUL_COLORS[fallen].hex;
    // The Singer's steel blue over the warm quarry: a deep saturated blue on
    // a dark burn (never a pale wash, which reads as glass), white-hot cores.
    const storm = fallen === 'singer';
    const lift = storm ? 1.4 : 1.2;
    const deep = storm ? 0x2f6bff : c;
    this.columnMat.uniforms.uColor.value.setHex(c).multiplyScalar(lift);
    this.columnMat.uniforms.uHot.value.setHex(HOT[fallen]);
    this.sigilMat.uniforms.uColor.value.setHex(deep).multiplyScalar(storm ? 1.6 : lift);
    this.sigilMat.uniforms.uHot.value.setHex(HOT[fallen]);
    this.shardMat.uniforms.uRim.value.setHex(c);
    this.shardMat.uniforms.uHot.value.setHex(HOT[fallen]);
    this.glowMat.color.setHex(storm ? deep : c).multiplyScalar(lift);
    rgbOf(c, this.rgb);
  }

  private chest(): number {
    return MEMBER_BODY[this.role].height * MEMBER_BODY[this.role].chest;
  }

  private hide(): void {
    this.column.visible = false;
    this.sigil.visible = false;
    this.shards.visible = false;
    this.glow.visible = false;
    this.arcs.visible = false;
    this.scorch.visible = false;
  }

  /** The shards' instance buffer (the host disposes the geometries and
   *  materials). */
  dispose(): void {
    this.shards.dispose();
    this.glowTex?.dispose();
  }
}
