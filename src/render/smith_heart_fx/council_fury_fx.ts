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
//  - embers rising off it, and each mend beat (COUNCIL_CUES.furyMend) a soft
//    ring and a breath of light drawn in.
// It says the survivor is enraged and healing, so the column, the sigil and
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
import { COUNCIL_AURAS, SOUL_COLORS } from './council_fx_core';
import { BOND_BODY, type FuryLook, furyLook } from './council_mechanic_look_core';
import type { CouncilFxHost } from './council_pillars_fx';

/** The stone shards torn loose round the survivor (the low tier draws fewer). */
const SHARDS = 12;

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
  float x = vUv.x * 12.0;
  float y = vUv.y;
  // Tongues: noise stretched up the column, racing upward.
  float n = noise(vec2(x, y * 3.0 - uTime * 2.6)) * 0.65
    + noise(vec2(x * 2.3, y * 6.0 - uTime * 4.1)) * 0.35;
  float tongue = smoothstep(0.35 + y * 0.45, 0.95, n + (1.0 - y) * 0.35);
  // The heartbeat's band climbing it.
  float band = exp(-pow((y - fract(uTime * 0.95)) * 7.0, 2.0)) * uBeat;
  float foot = (1.0 - smoothstep(0.0, 0.3, y)) * 0.45;
  float rim = 0.45 + 0.55 * (1.0 - vFace);
  float a = (tongue * 0.85 + foot + band * 0.6) * rim
    * pow(max(1.0 - y, 0.0), 1.15) * smoothstep(0.0, 0.03, y);
  vec3 col = mix(uColor, uHot, clamp(tongue * 0.45 + band * 0.5 + foot, 0.0, 1.0));
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
varying vec2 vP;
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
  float v = seam * (0.55 + 0.45 * wave) * fade + ring * 0.9 + inner * 0.55
    + (1.0 - r) * 0.18 * (1.0 + uBeat);
  vec3 col = mix(uColor, uHot, clamp(seam * wave * 0.6 + uBeat * 0.3, 0.0, 1.0));
  gl_FragColor = vec4(col * uGlow, clamp(v, 0.0, 1.0) * smoothstep(1.0, 0.96, r));
  #include <colorspace_fragment>
}
`;

/** A torn shard of quarry stone: dark rock lit from above, its edges burning
 *  in the fury's colour. */
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
  float lit = 0.3 + 0.7 * clamp(dot(n, normalize(vec3(0.2, 0.9, 0.35))), 0.0, 1.0);
  float rim = pow(1.0 - clamp(abs(dot(n, vView)), 0.0, 1.0), 1.6);
  gl_FragColor = vec4(uStone * lit + uRim * rim * uGlow, 1.0);
  #include <colorspace_fragment>
}
`;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _pos = new THREE.Vector3();
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
const _mend = {
  speed: 0.6,
  up: 2.2,
  life: 0.9,
  size: [1.1, 0.2] as [number, number],
  color: [1, 0.9, 0.6] as [number, number, number],
  alpha: 0.9,
  pool: 'glow' as const,
};

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
    const shardGeo = new THREE.DodecahedronGeometry(0.55, 0).scale(0.8, 1.35, 0.7);
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
        uGlow: { value: 1.6 },
      },
      vertexShader: SHARD_VERT,
      fragmentShader: SHARD_FRAG,
      toneMapped: false,
    });
    h.materials.push(this.columnMat, this.sigilMat, this.shardMat);
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
    for (const m of [this.column, this.sigil, this.shards]) {
      m.visible = false;
      m.frustumCulled = false;
      h.root.add(m);
    }
  }

  beginScan(): void {
    this.scanId = -1;
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

  /** `heart_grieving_fury_mend`: a mend beat on the survivor. */
  mend(survivorId: number): void {
    const e = this.h.entity(survivorId);
    if (!e) return;
    const at = fxAnchor(e);
    const y = this.h.groundY(at.x, at.z);
    _mend.color = this.rgb;
    this.h.particles.puff(at.x, y + 1, at.z, 14, _mend);
    this.h.particles.shockRing(at.x, at.z, HOT[this.fallen ?? 'guardian'], 4.5, 0.45);
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
    const body = BOND_BODY[this.role];
    const height = body.height * look.swell;
    const r = Math.max(2.2, body.height * 0.3) * look.swell;
    this.column.position.set(at.x, y + 0.05, at.z);
    this.column.scale.set(r, height * 1.25, r);
    this.columnMat.uniforms.uGlow.value = look.glow;
    this.columnMat.uniforms.uBeat.value = look.beat;
    this.column.visible = true;
    const sr = r * 2.3 * (1 + 0.05 * look.beat + 0.25 * look.flash);
    this.sigil.position.set(at.x, y + 0.13, at.z);
    this.sigil.scale.set(sr, sr, 1);
    this.sigilMat.uniforms.uGlow.value = 0.8 * look.glow;
    this.sigilMat.uniforms.uBeat.value = look.beat;
    this.sigil.visible = true;
    this.placeShards(at.x, y + height * body.chest, at.z, r, look);
    // Embers rising off it (cosmetic: thin on the low tier).
    this.emberAcc += dt * (10 + 30 * look.flash) * this.h.density;
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
      const size = (0.75 + 0.6 * ((i * 0.71) % 1)) * (1 + 0.25 * look.beat);
      _s.setScalar(size);
      _e.set(now * (1.1 + (i % 3) * 0.4), now * (0.7 + (i % 4) * 0.3), i * 0.9);
      _q.setFromEuler(_e);
      _m.compose(_pos, _q, _s);
      this.shards.setMatrixAt(i, _m);
    }
    this.shards.instanceMatrix.needsUpdate = true;
    this.shardMat.uniforms.uGlow.value = 1.4 + 1.2 * look.beat + 2 * look.flash;
    this.shards.visible = true;
  }

  /** Light every piece in the fallen one's colour (a write per fury, never a
   *  frame). */
  private tint(fallen: CouncilRole): void {
    if (this.fallen === fallen) return;
    this.fallen = fallen;
    const c = SOUL_COLORS[fallen].hex;
    this.columnMat.uniforms.uColor.value.setHex(c);
    this.columnMat.uniforms.uHot.value.setHex(HOT[fallen]);
    this.sigilMat.uniforms.uColor.value.setHex(c);
    this.sigilMat.uniforms.uHot.value.setHex(HOT[fallen]);
    this.shardMat.uniforms.uRim.value.setHex(c);
    rgbOf(c, this.rgb);
  }

  private chest(): number {
    return BOND_BODY[this.role].height * BOND_BODY[this.role].chest;
  }

  private hide(): void {
    this.column.visible = false;
    this.sigil.visible = false;
    this.shards.visible = false;
  }

  /** The shards' instance buffer (the host disposes the geometries and
   *  materials). */
  dispose(): void {
    this.shards.dispose();
  }
}
