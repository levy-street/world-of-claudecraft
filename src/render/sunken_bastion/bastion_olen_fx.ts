// Olen the fallen paladin's visuals (plan: bastion_olen_fx_core.ts), read off
// mirrored entity state and his spellfx cues so offline and online look the
// same:
//  - Hallowed Brine: a gathering of gold motes round his blade over the bar,
//    then the sword strikes the flags: a burst of dark holy sea-water, a
//    shockwave and a jolt, the swell's front surging out to the pool's full
//    9 yd (10 heroic) in spray and gold light, and the pool itself (black-teal
//    water churning over the flags, rings of holy light rolling outward, a
//    burning gold rim of drowned runes, light motes rising through it; its
//    grain and runes keep their size in yards) for as long as it stands;
//  - Rebounding Bulwark: his kite shield spinning through the air from body
//    to body along a shallow arc with a gold trail, a ringing impact at each
//    player it strikes, and his catch when it flies home (the held shield is
//    hidden while it flies, through his meshToggles);
//  - Sentence of the Tide: a floor ring round the marked player filling over
//    the five seconds (its reach is the mark's own value2, the sim's radius),
//    and a column of drowned light closing down on them from the sky,
//    thickening and burning white as it nears; the strike is a slamming
//    pillar, a flash ring the size of the splash and a jolt for those near;
//  - the Unbroken Oath: a water bubble swelling round him as he kneels,
//    rippling with gold caustics while he keeps his vigil, bursting into
//    spray when it breaks; each soldier of his order rises in a geyser of
//    sea-water and gold light.
//
// Rules (src/render/CLAUDE.md): every mesh and material is built once in the
// constructor under the Bastion telegraph root (compile-gated by BastionFx),
// no per-frame allocation. What a player acts on draws on every tier: the
// brine pool and its rim, the Sentence's ring and column, the bubble, the
// flying shield. The motes, sprays, chunks, trails and flashes are cosmetic
// and shed on the low tier.

import * as THREE from 'three';
import {
  HALLOWED_BRINE_TEMPLATE,
  OLEN_HALLOWED_BRINE,
  OLEN_ID,
  OLEN_KIT,
  OLEN_OATH_KNEEL,
  OLEN_OATH_VIGIL,
  OLEN_REBOUNDING_BULWARK,
  OLEN_SENTENCED,
  OLEN_TIDE_SENTENCE,
  OLEN_UNBROKEN_OATH,
} from '../../sim/encounters/sunken_bastion/ids';
import type { SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import {
  TELEGRAPH_ACCENTS,
  TELEGRAPH_THREAT_COLORS,
  type TelegraphFan,
  TelegraphKit,
} from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { GFX, sharedUniforms } from '../gfx';
import { radialGlowTexture } from '../textures';
import {
  BRINE_DRAWN_RADIUS,
  BRINE_WELL_SECONDS,
  BULWARK_HOP_SECONDS,
  BULWARK_SPIN,
  brineFrontSprays,
  brineSwell,
  bulwarkFlight,
  flashAlpha,
  OATH_BUBBLE_RADIUS,
  OATH_BURST_SECONDS,
  OLEN_SHIELD_AWAY_GESTURE,
  OLEN_SHIELD_CATCH_GESTURE,
  OLEN_SHIELD_HOME_GESTURE,
  oathBubbleScale,
  oathBurst,
  SENTENCE_STRIKE_SECONDS,
  SHAKE_BRINE,
  SHAKE_OATH_BURST,
  SHAKE_REACH,
  SHAKE_SENTENCE,
  sentenceColumnBase,
  sentenceColumnGlow,
  sentenceFill,
  sentenceStrike,
} from './bastion_olen_fx_core';
import { BastionParticles } from './bastion_particles';

const POOL_SLOTS = 4;
const FLIGHT_SLOTS = 2;
const MARK_SLOTS = 2;
const STRIKE_SLOTS = 2;
const TRAIL = 6;
const SCAN_SEC = 0.1;
const LIFT = 0.05;
const GOLD = 0xffd98a;
const SEA = 0x6fe8d0;

const DISC_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// The Hallowed Brine: black-teal sea-water churning over the flags, gold light
// seeping up through it, and a burning gold rim of drowned runes (the edge a
// player reads, bright on every tier).
const BRINE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uSeed;
// The pool's radius over the 6 yd it was first drawn at: the water's grain,
// the runes and the rim keep their size in yards however wide it wells.
uniform float uScale;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  vec2 c = vUv - 0.5;
  float r = length(c) * 2.0;
  if (r > 1.0) discard;
  float a = atan(c.y, c.x);
  float t = uTime + uSeed;
  float k = max(0.5, uScale);
  float swirl = a + t * 0.5 + r * 3.0 * k;
  float n = noise(vec2(cos(swirl), sin(swirl)) * 3.0 + r * 4.0 * k - t * 0.6);
  float caust = noise(c * 14.0 * k + vec2(t * 0.9, -t * 0.7));
  caust = smoothstep(0.62, 0.8, caust) * (1.0 - r * 0.6);
  vec3 deep = vec3(0.01, 0.05, 0.06);
  vec3 sea = vec3(0.05, 0.32, 0.3);
  vec3 gold = vec3(1.0, 0.82, 0.42);
  vec3 col = mix(deep, sea, n * 0.8);
  col += gold * caust * 0.9;
  // Holy light rolling outward through the water in slow rings.
  float ring = fract(r * 1.5 * k - t * 0.45);
  col += gold * smoothstep(0.92, 1.0, ring) * (1.0 - smoothstep(0.75, 0.95, r)) * 0.35;
  // The rune rim: a burning band of glyph segments that pulse round the edge,
  // about a yard and a half wide, with as many glyphs as its yards of rim hold.
  float w = 0.2 / sqrt(k);
  float band = smoothstep(1.0 - w, 1.0 - w * 0.5, r) * (1.0 - smoothstep(0.97, 1.0, r));
  float segs = floor(24.0 * k + 0.5) / 6.2831853;
  float seg = step(0.35, fract(a * segs + t * 0.15));
  float glyph = step(0.5, fract((a * segs + t * 0.15) * 3.0 + noise(vec2(a * 6.0 * k, 1.0))));
  float pulse = 0.75 + 0.25 * sin(t * 4.0 + a * 3.0);
  col += gold * band * (0.6 + 0.9 * seg * glyph) * pulse * 1.6;
  float edge = smoothstep(0.985, 1.0, r);
  float alpha = (0.82 * (1.0 - edge) + band * 0.5) * uAlpha;
  gl_FragColor = vec4(col, min(1.0, alpha));
  #include <colorspace_fragment>
}
`;

const COLUMN_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * wocCamRelView(w.xyz);
}
`;

// The drowned light: a shaft of white-gold with a sea-teal fringe, streaming
// down its length, brightest at its silhouette.
const COLUMN_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormalW;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  float h = vUv.y;
  float streaks = noise(vec2(vUv.x * 18.0, h * 2.0 + uTime * 6.0));
  vec3 view = normalize(cameraPosition - vWorld);
  float rim = 1.0 - abs(dot(normalize(vNormalW), view));
  vec3 white = vec3(1.0, 0.96, 0.82);
  vec3 sea = vec3(0.4, 0.95, 0.85);
  vec3 col = mix(white, sea, rim * 0.6);
  float body = (0.45 + 0.55 * streaks) * (0.35 + 1.1 * rim * rim);
  float ends = smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.85, 1.0, h));
  // Brightest at the foot where it stands on the mark, fading up into the sky.
  float foot = 1.0 + 1.5 * (1.0 - smoothstep(0.0, 0.25, h));
  float i = body * ends * foot * uAlpha;
  // Additive at SrcAlpha: lift both so the shaft reads against the storm sky.
  gl_FragColor = vec4(col * i * 2.4, min(1.0, i * 1.8));
  #include <colorspace_fragment>
}
`;

// The Oath's bubble: a shell of sea-water, clear at its heart, bright at its
// silhouette, gold caustics crawling over it.
const BUBBLE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormalW;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  vec3 view = normalize(cameraPosition - vWorld);
  float fres = 1.0 - abs(dot(normalize(vNormalW), view));
  fres = pow(max(fres, 0.0), 2.2);
  float c1 = noise(vWorld.xz * 1.4 + vWorld.y * 1.1 + uTime * 0.6);
  float c2 = noise(vWorld.xy * 2.3 - uTime * 0.8);
  float caust = smoothstep(0.55, 0.62, c1) - smoothstep(0.62, 0.7, c1);
  caust += (smoothstep(0.6, 0.66, c2) - smoothstep(0.66, 0.72, c2)) * 0.6;
  vec3 sea = vec3(0.2, 0.75, 0.72);
  vec3 gold = vec3(1.0, 0.85, 0.5);
  vec3 col = sea * (0.25 + 1.4 * fres) + gold * caust * 1.2;
  float a = (0.1 + 0.85 * fres + caust * 0.5) * uAlpha;
  gl_FragColor = vec4(col * uAlpha, min(1.0, a));
  #include <colorspace_fragment>
}
`;

interface PoolSlot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  objectId: number;
  age: number;
}

interface FlightSlot {
  shield: THREE.Group;
  trail: THREE.Sprite[];
  fromId: number;
  toId: number;
  from: THREE.Vector3;
  t: number;
  active: boolean;
}

interface MarkSlot {
  ring: TelegraphFan;
  column: THREE.Mesh;
  columnMat: THREE.ShaderMaterial;
  glow: THREE.Sprite;
  entityId: number;
}

interface StrikeSlot {
  column: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  ring: TelegraphFan | null;
  x: number;
  y: number;
  z: number;
  radius: number;
  age: number;
}

type EntityView = IWorld['entities'] extends Map<number, infer E> ? E : never;

function auraOf(e: EntityView, id: string) {
  for (const a of e.auras) if (a.id === id) return a;
  return null;
}

export class BastionOlenFx {
  private readonly root = new THREE.Group();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly fx: BastionParticles;
  private readonly kit: TelegraphKit;
  private readonly pools: PoolSlot[] = [];
  private readonly flights: FlightSlot[] = [];
  private readonly marks: MarkSlot[] = [];
  private readonly strikes: StrikeSlot[] = [];
  private readonly bubble: THREE.Mesh;
  private readonly bubbleMat: THREE.ShaderMaterial;
  private readonly bubbleCore: THREE.Sprite;
  private readonly bladeGlow: THREE.Sprite;
  private readonly tmp = { x: 0, y: 0, z: 0 };
  private readonly brineIds: number[] = [];
  private readonly markIds: number[] = [];
  private olenId = -1;
  private oathAge = -1;
  private burstAge = -1;
  private burstX = 0;
  private burstY = 0;
  private burstZ = 0;
  private bladeAge = -1;
  private scan = 0;
  private clock = 0;

  constructor(
    parent: THREE.Group,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world: IWorld | undefined,
    private readonly cosmetic: boolean,
    private readonly shake?: (amount: number) => void,
    private readonly reducedMotion?: () => boolean,
    private readonly playGesture?: (entityId: number, gesture: string) => void,
  ) {
    this.root.name = 'sunken-bastion-olen-fx';
    parent.add(this.root);
    this.fx = new BastionParticles(this.root, cosmetic);
    this.kit = new TelegraphKit(this.root, cosmetic);
    const glowTex = radialGlowTexture();
    const sprite = (color: number, size: number, blend = THREE.AdditiveBlending) => {
      const mat = new THREE.SpriteMaterial({
        map: glowTex,
        color,
        opacity: 0,
        transparent: true,
        depthWrite: false,
        blending: blend,
        toneMapped: false,
      });
      this.materials.push(mat);
      const s = new THREE.Sprite(mat);
      s.scale.set(size, size, 1);
      s.visible = false;
      this.root.add(s);
      return s;
    };
    const shader = (frag: string, vert: string, side: THREE.Side, blending: THREE.Blending) => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: vert,
        fragmentShader: frag,
        uniforms: {
          uTime: sharedUniforms.uTime,
          uAlpha: { value: 0 },
          uSeed: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        side,
        blending,
      });
      this.materials.push(mat);
      return mat;
    };
    // The brine pools (every tier: they burn).
    const disc = this.geo(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2));
    for (let i = 0; i < POOL_SLOTS; i++) {
      const mat = shader(BRINE_FRAG, DISC_VERT, THREE.DoubleSide, THREE.NormalBlending);
      mat.name = 'sunkenBastionHallowedBrine';
      mat.uniforms.uSeed.value = i * 7.3;
      mat.uniforms.uScale = { value: 1 };
      const mesh = new THREE.Mesh(disc, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 7);
      this.root.add(mesh);
      this.pools.push({ mesh, mat, objectId: -1, age: 0 });
    }
    // The kite shield in flight (every tier: it strikes).
    const kite = new THREE.Shape();
    kite.moveTo(0, 0.85);
    kite.quadraticCurveTo(0.55, 0.8, 0.6, 0.35);
    kite.quadraticCurveTo(0.55, -0.35, 0, -0.95);
    kite.quadraticCurveTo(-0.55, -0.35, -0.6, 0.35);
    kite.quadraticCurveTo(-0.55, 0.8, 0, 0.85);
    const board = this.geo(
      new THREE.ExtrudeGeometry(kite, {
        depth: 0.12,
        bevelEnabled: true,
        bevelThickness: 0.04,
        bevelSize: 0.05,
        bevelSegments: 2,
        curveSegments: 10,
      }).translate(0, 0, -0.06),
    );
    const boss = this.geo(new THREE.SphereGeometry(0.16, 12, 8).scale(1, 1, 0.5));
    // The kit's material policy (bastion_kit.ts): PBR where the tier carries
    // it, Lambert below; the shield itself draws on every tier (it strikes).
    const metal = (color: number, emissive: number, glow: number): THREE.Material =>
      GFX.standardMaterials
        ? new THREE.MeshStandardMaterial({
            color,
            metalness: 0.85,
            roughness: 0.32,
            emissive,
            emissiveIntensity: glow,
          })
        : new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity: glow });
    const steel = metal(0x8c9aa0, 0x6a4a1a, 0.35);
    const brass = metal(0xc8a050, 0x7a5a20, 0.6);
    this.materials.push(steel, brass);
    for (let i = 0; i < FLIGHT_SLOTS; i++) {
      const shield = new THREE.Group();
      const b = new THREE.Mesh(board, steel);
      const knob = new THREE.Mesh(boss, brass);
      knob.position.z = 0.1;
      shield.add(b, knob);
      shield.scale.setScalar(1.25);
      shield.rotation.order = 'YXZ';
      shield.visible = false;
      this.root.add(shield);
      const trail: THREE.Sprite[] = [];
      if (cosmetic) for (let k = 0; k < TRAIL; k++) trail.push(sprite(GOLD, 1.6 - k * 0.18));
      this.flights.push({
        shield,
        trail,
        fromId: -1,
        toId: -1,
        from: new THREE.Vector3(),
        t: 0,
        active: false,
      });
    }
    // The Sentence's marks: a floor ring and the closing column (every tier).
    const columnGeo = this.geo(
      new THREE.CylinderGeometry(1, 1, 1, 28, 1, true).translate(0, 0.5, 0),
    );
    for (let i = 0; i < MARK_SLOTS; i++) {
      const ring = this.kit.fan(19);
      this.kit.layOutFan(ring, 360, {
        color: TELEGRAPH_THREAT_COLORS.lethal,
        accent: TELEGRAPH_ACCENTS.holy,
      });
      ring.group.visible = false;
      const columnMat = shader(COLUMN_FRAG, COLUMN_VERT, THREE.FrontSide, THREE.AdditiveBlending);
      columnMat.name = 'sunkenBastionTideSentence';
      const column = new THREE.Mesh(columnGeo, columnMat);
      column.visible = false;
      column.frustumCulled = false;
      column.renderOrder = floorVfxRenderOrder('encounter', 3);
      this.root.add(column);
      this.marks.push({ ring, column, columnMat, glow: sprite(0xfff2c8, 4), entityId: -1 });
    }
    for (let i = 0; i < STRIKE_SLOTS; i++) {
      const mat = shader(COLUMN_FRAG, COLUMN_VERT, THREE.FrontSide, THREE.AdditiveBlending);
      mat.name = 'sunkenBastionTideSentenceStrike';
      const column = new THREE.Mesh(columnGeo, mat);
      column.visible = false;
      column.frustumCulled = false;
      column.renderOrder = floorVfxRenderOrder('encounter', 3);
      this.root.add(column);
      let ring: TelegraphFan | null = null;
      if (cosmetic) {
        ring = this.kit.fan(21);
        this.kit.layOutFan(ring, 360, { color: 0xfff2c8, accent: 0xffffff });
        ring.group.visible = false;
      }
      this.strikes.push({ column, mat, ring, x: 0, y: 0, z: 0, radius: 6, age: -1 });
    }
    // The Oath's bubble (every tier: he is untouchable inside it).
    this.bubbleMat = shader(BUBBLE_FRAG, COLUMN_VERT, THREE.FrontSide, THREE.NormalBlending);
    this.bubbleMat.name = 'sunkenBastionOathBubble';
    this.bubble = new THREE.Mesh(this.geo(new THREE.SphereGeometry(1, 40, 24)), this.bubbleMat);
    this.bubble.visible = false;
    this.bubble.frustumCulled = false;
    this.bubble.renderOrder = floorVfxRenderOrder('encounter', 4);
    this.root.add(this.bubble);
    this.bubbleCore = sprite(GOLD, 7);
    this.bladeGlow = sprite(GOLD, 3);
  }

  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private jolt(amount: number, x: number, z: number): void {
    if (!this.shake || this.reducedMotion?.()) return;
    const me = this.world?.entities.get(this.world.playerId);
    if (!me || Math.hypot(me.pos.x - x, me.pos.z - z) > SHAKE_REACH) return;
    this.shake(amount);
  }

  /** Olen's cues. True when it CLAIMED the event (the generic projectile,
   *  nova or flash must not draw it too). */
  handleEvent(ev: SimEvent): boolean {
    if (ev.type !== 'spellfx' || !this.world) return false;
    const a = ev.ability;
    if (
      a !== OLEN_HALLOWED_BRINE &&
      a !== OLEN_REBOUNDING_BULWARK &&
      a !== OLEN_TIDE_SENTENCE &&
      a !== OLEN_OATH_KNEEL &&
      a !== OLEN_OATH_VIGIL &&
      a !== OLEN_UNBROKEN_OATH
    )
      return false;
    const src = this.world.entities.get(ev.sourceId);
    const dst = this.world.entities.get(ev.targetId);
    if (a === OLEN_HALLOWED_BRINE && src) {
      if (ev.fx === 'windup') {
        this.bladeAge = 0;
        return true;
      }
      // The sword strikes the flags: holy sea-water bursts out.
      const y = this.groundY(src.pos.x, src.pos.z);
      this.fx.burst(src.pos.x, y + 0.4, src.pos.z, SEA, 14, 1.2, 4.5, 0.9, 1.6, 5);
      this.fx.burst(src.pos.x, y + 0.6, src.pos.z, GOLD, 10, 0.8, 3, 0.7, 2.6, 3);
      this.fx.chunksAt(src.pos.x, y + 0.2, src.pos.z, y, 0x5c6a66, 10, 6, 0.8);
      this.jolt(SHAKE_BRINE, src.pos.x, src.pos.z);
      this.bladeAge = -1;
      return true;
    }
    if (a === OLEN_REBOUNDING_BULWARK && ev.fx === 'projectile' && src) {
      const slot = this.flights.find((f) => !f.active) ?? this.flights[0];
      if (!slot) return true;
      slot.active = true;
      slot.fromId = src.id;
      slot.toId = ev.targetId;
      slot.t = 0;
      slot.from.set(src.pos.x, src.pos.y, src.pos.z);
      // His first throw: the held shield leaves his arm.
      if (src.templateId === OLEN_ID) this.playGesture?.(src.id, OLEN_SHIELD_AWAY_GESTURE);
      // A rebound: the ring of the strike on the body it left.
      else this.impact(src.pos.x, src.pos.y + 1.4, src.pos.z);
      return true;
    }
    if (a === OLEN_TIDE_SENTENCE) {
      if (ev.fx !== 'detonate' || !dst) return true;
      const slot = this.strikes.find((s) => s.age < 0) ?? this.strikes[0];
      const y = this.groundY(dst.pos.x, dst.pos.z);
      slot.age = 0;
      slot.x = dst.pos.x;
      slot.y = y;
      slot.z = dst.pos.z;
      slot.radius = this.lastSentenceRadius(dst.id);
      this.fx.burst(dst.pos.x, y + 0.5, dst.pos.z, 0xfff2c8, 16, 1.5, 6, 0.8, 3, 6);
      this.fx.burst(dst.pos.x, y + 0.3, dst.pos.z, SEA, 12, 1.2, 4, 1.1, 1.2, 7, true);
      this.fx.chunksAt(dst.pos.x, y + 0.2, dst.pos.z, y, 0x6a6a5e, 12, 7, 0.9);
      this.jolt(SHAKE_SENTENCE, dst.pos.x, dst.pos.z);
      return true;
    }
    if (a === OLEN_OATH_KNEEL) return true;
    if (a === OLEN_OATH_VIGIL && src) {
      // A soldier of his order rises in a geyser of sea-water and gold light.
      const y = this.groundY(src.pos.x, src.pos.z);
      this.fx.burst(src.pos.x, y + 0.3, src.pos.z, SEA, 14, 1, 3.5, 1.2, 4.5, 1.2);
      this.fx.burst(src.pos.x, y + 1.5, src.pos.z, GOLD, 8, 1.5, 4, 0.9, 2.5, 1);
      this.fx.chunksAt(src.pos.x, y + 0.2, src.pos.z, y, 0x5c6a66, 8, 5, 0.7);
      return true;
    }
    if (a === OLEN_UNBROKEN_OATH && src) {
      // The bubble bursts into spray.
      this.burstAge = 0;
      this.burstX = src.pos.x;
      this.burstY = src.pos.y;
      this.burstZ = src.pos.z;
      const r = OATH_BUBBLE_RADIUS * src.scale;
      this.fx.burst(src.pos.x, src.pos.y + r * 0.6, src.pos.z, SEA, 20, 1.2, 4, 1, 1.5, 7);
      this.fx.burst(src.pos.x, src.pos.y + r * 0.6, src.pos.z, GOLD, 10, 1, 3, 0.7, 2, 5);
      this.jolt(SHAKE_OATH_BURST, src.pos.x, src.pos.z);
      return true;
    }
    return true;
  }

  private sentenceRadii = new Map<number, number>();

  private lastSentenceRadius(id: number): number {
    return this.sentenceRadii.get(id) ?? OLEN_KIT.sentenceRadius;
  }

  private impact(x: number, y: number, z: number): void {
    this.fx.burst(x, y, z, 0xfff2c8, 8, 0.6, 2.4, 0.4, 1.5, 4);
    this.fx.burst(x, y, z, GOLD, 4, 1.4, 3.2, 0.35, 0.5, 1);
  }

  private scanWorld(world: IWorld): void {
    this.brineIds.length = 0;
    this.markIds.length = 0;
    this.olenId = -1;
    for (const e of world.entities.values()) {
      if (e.kind === 'object') {
        if (e.templateId === HALLOWED_BRINE_TEMPLATE) this.brineIds.push(e.id);
        continue;
      }
      if (e.dead) continue;
      if (e.kind === 'mob' && e.templateId === OLEN_ID) this.olenId = e.id;
      else if (e.kind === 'player') {
        const mark = auraOf(e, OLEN_SENTENCED);
        if (mark) {
          this.markIds.push(e.id);
          this.sentenceRadii.set(e.id, mark.value2 ?? OLEN_KIT.sentenceRadius);
        }
      }
    }
    if (this.sentenceRadii.size > 16)
      for (const id of this.sentenceRadii.keys())
        if (!world.entities.has(id)) this.sentenceRadii.delete(id);
  }

  update(dt: number): void {
    const world = this.world;
    if (!world) return;
    this.clock += dt;
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = SCAN_SEC;
      this.scanWorld(world);
    }
    this.updatePools(world, dt);
    this.updateFlights(world, dt);
    this.updateMarks(world);
    this.updateStrikes(dt);
    this.updateOath(world, dt);
    this.fx.update(dt);
  }

  private updatePools(world: IWorld, dt: number): void {
    for (const p of this.pools) {
      if (p.objectId >= 0 && !this.brineIds.includes(p.objectId)) {
        // The pool dried: one last sigh of spray.
        const at = p.mesh.position;
        this.fx.burst(at.x, at.y + 0.2, at.z, SEA, 6, 1, 2.5, 0.8, 0.8, 1.5, true);
        p.objectId = -1;
        p.mesh.visible = false;
      }
    }
    for (const id of this.brineIds) {
      if (this.pools.some((p) => p.objectId === id)) continue;
      const p = this.pools.find((s) => s.objectId < 0);
      if (!p) break;
      p.objectId = id;
      p.age = 0;
    }
    for (const p of this.pools) {
      if (p.objectId < 0) continue;
      const e = world.entities.get(p.objectId);
      if (!e) continue;
      p.age += dt;
      const swell = brineSwell(p.age);
      const full = Math.max(0.5, e.scale);
      const r = full * (0.25 + 0.75 * swell);
      p.mesh.visible = true;
      p.mesh.position.set(e.pos.x, this.groundY(e.pos.x, e.pos.z) + LIFT, e.pos.z);
      p.mesh.scale.set(r, 1, r);
      p.mat.uniforms.uAlpha.value = Math.min(1, p.age / (BRINE_WELL_SECONDS * 0.5));
      p.mat.uniforms.uScale.value = r / BRINE_DRAWN_RADIUS;
      // The swell's front: sea-water and gold light surging out round the rim
      // as it wells (cosmetic; the pool itself draws on every tier).
      if (this.cosmetic && p.age < BRINE_WELL_SECONDS) {
        const n = brineFrontSprays(full, dt, this.fx.rand());
        for (let k = 0; k < n; k++) {
          const a = this.fx.rand() * Math.PI * 2;
          const fy = p.mesh.position.y + 0.2;
          const gold = k % 3 === 0;
          this.fx.burst(
            e.pos.x + Math.sin(a) * r,
            fy,
            e.pos.z + Math.cos(a) * r,
            gold ? GOLD : SEA,
            1,
            0.7,
            2.4,
            0.8,
            2.2,
            1.4,
            !gold,
          );
        }
      }
      // Light motes rising through the brine (cosmetic), as dense however wide.
      if (this.cosmetic && this.fx.rand() < dt * 5 * (full / BRINE_DRAWN_RADIUS) ** 2) {
        const a = this.fx.rand() * Math.PI * 2;
        const d = Math.sqrt(this.fx.rand()) * r * 0.9;
        this.fx.burst(
          e.pos.x + Math.sin(a) * d,
          p.mesh.position.y + 0.1,
          e.pos.z + Math.cos(a) * d,
          this.fx.rand() < 0.5 ? GOLD : SEA,
          1,
          0.25,
          0.6,
          1.4,
          1.4,
        );
      }
    }
  }

  private updateFlights(world: IWorld, dt: number): void {
    for (const f of this.flights) {
      if (!f.active) continue;
      const to = world.entities.get(f.toId);
      if (!to) {
        f.active = false;
        f.shield.visible = false;
        for (const s of f.trail) s.visible = false;
        continue;
      }
      f.t += dt;
      const k = f.t / BULWARK_HOP_SECONDS;
      bulwarkFlight(f.from.x, f.from.y, f.from.z, to.pos.x, to.pos.y, to.pos.z, k, this.tmp);
      f.shield.visible = true;
      f.shield.position.set(this.tmp.x, this.tmp.y, this.tmp.z);
      // Laid nearly flat and spinning like a thrown discus, tipped toward its flight.
      f.shield.rotation.set(-Math.PI / 2 + 0.3, this.clock * BULWARK_SPIN * Math.PI * 2, 0);
      for (let i = 0; i < f.trail.length; i++) {
        const back = Math.max(0, k - (i + 1) * 0.07);
        bulwarkFlight(f.from.x, f.from.y, f.from.z, to.pos.x, to.pos.y, to.pos.z, back, this.tmp);
        const s = f.trail[i];
        s.visible = k > 0.02;
        s.position.set(this.tmp.x, this.tmp.y, this.tmp.z);
        (s.material as THREE.SpriteMaterial).opacity = 0.55 * (1 - i / f.trail.length);
      }
      if (k < 1) continue;
      f.active = false;
      f.shield.visible = false;
      for (const s of f.trail) s.visible = false;
      if (to.templateId === OLEN_ID) {
        // Home: he catches it on his arm.
        this.playGesture?.(to.id, OLEN_SHIELD_CATCH_GESTURE);
        this.playGesture?.(to.id, OLEN_SHIELD_HOME_GESTURE);
        this.fx.burst(to.pos.x, to.pos.y + 1.6, to.pos.z, GOLD, 5, 0.6, 2, 0.35, 0.6, 1);
      } else this.impact(to.pos.x, to.pos.y + 1.4, to.pos.z);
    }
  }

  private updateMarks(world: IWorld): void {
    for (const m of this.marks) {
      if (m.entityId >= 0 && !this.markIds.includes(m.entityId)) {
        m.entityId = -1;
        m.ring.group.visible = false;
        m.column.visible = false;
        m.glow.visible = false;
      }
    }
    for (const id of this.markIds) {
      if (this.marks.some((m) => m.entityId === id)) continue;
      const m = this.marks.find((s) => s.entityId < 0);
      if (!m) break;
      m.entityId = id;
    }
    for (const m of this.marks) {
      if (m.entityId < 0) continue;
      const e = world.entities.get(m.entityId);
      const mark = e ? auraOf(e, OLEN_SENTENCED) : null;
      if (!e || !mark) continue;
      const fill = sentenceFill(mark.remaining, mark.duration);
      const radius = mark.value2 ?? OLEN_KIT.sentenceRadius;
      const y = this.groundY(e.pos.x, e.pos.z);
      m.ring.group.visible = true;
      this.kit.drapeFan(m.ring, this.groundY, e.pos.x, y, e.pos.z, 0, radius);
      this.kit.paintFan(m.ring, { fill, clock: this.clock, range: radius });
      // A shaft of drowned light stands on them from the sky, thickening and
      // burning brighter as the Sentence nears, while its head (the gathering
      // glow) closes down from the clouds onto the mark.
      const base = sentenceColumnBase(fill);
      const glow = sentenceColumnGlow(fill);
      const w = 0.35 + fill * 1.25;
      m.column.visible = true;
      m.column.position.set(e.pos.x, y, e.pos.z);
      m.column.scale.set(w, 40, w);
      m.columnMat.uniforms.uAlpha.value = glow;
      m.glow.visible = this.cosmetic;
      m.glow.position.set(e.pos.x, y + base, e.pos.z);
      m.glow.scale.setScalar(3 + 4 * fill);
      (m.glow.material as THREE.SpriteMaterial).opacity = glow;
    }
  }

  private updateStrikes(dt: number): void {
    for (const s of this.strikes) {
      if (s.age < 0) continue;
      s.age += dt;
      if (s.age >= SENTENCE_STRIKE_SECONDS) {
        s.age = -1;
        s.column.visible = false;
        if (s.ring) s.ring.group.visible = false;
        continue;
      }
      const k = sentenceStrike(s.age);
      const w = s.radius * 0.35 * k.scale;
      s.column.visible = true;
      s.column.position.set(s.x, s.y, s.z);
      s.column.scale.set(w, 30, w);
      s.mat.uniforms.uAlpha.value = 1.6 * k.alpha;
      if (s.ring) {
        s.ring.group.visible = true;
        this.kit.drapeFan(s.ring, this.groundY, s.x, s.y, s.z, 0, s.radius * k.scale);
        this.kit.paintFan(s.ring, {
          fill: 1,
          clock: this.clock,
          range: s.radius * k.scale,
          fade: flashAlpha(s.age, SENTENCE_STRIKE_SECONDS),
          front: 0,
        });
      }
    }
  }

  private updateOath(world: IWorld, dt: number): void {
    const olen = this.olenId >= 0 ? world.entities.get(this.olenId) : undefined;
    const sealed = !!olen && !olen.dead && auraOf(olen, OLEN_UNBROKEN_OATH) !== null;
    if (sealed && olen) {
      if (this.oathAge < 0) this.oathAge = 0;
      this.oathAge += dt;
      const r = OATH_BUBBLE_RADIUS * olen.scale * oathBubbleScale(this.oathAge, this.clock);
      this.bubble.visible = r > 0.05;
      this.bubble.position.set(olen.pos.x, olen.pos.y + r * 0.55, olen.pos.z);
      this.bubble.scale.set(r, r * 0.92, r);
      this.bubbleMat.uniforms.uAlpha.value = 1;
      this.bubbleCore.visible = this.cosmetic;
      this.bubbleCore.position.set(olen.pos.x, olen.pos.y + r * 0.45, olen.pos.z);
      (this.bubbleCore.material as THREE.SpriteMaterial).opacity =
        0.35 + 0.15 * Math.sin(this.clock * 3);
      if (this.cosmetic && this.fx.rand() < dt * 4) {
        const a = this.fx.rand() * Math.PI * 2;
        this.fx.burst(
          olen.pos.x + Math.sin(a) * r * 0.9,
          olen.pos.y + 0.2,
          olen.pos.z + Math.cos(a) * r * 0.9,
          SEA,
          1,
          0.3,
          0.8,
          1.2,
          1.6,
        );
      }
    } else {
      this.oathAge = -1;
      if (this.burstAge < 0) this.bubble.visible = false;
      this.bubbleCore.visible = false;
    }
    if (this.burstAge >= 0 && !sealed) {
      this.burstAge += dt;
      const b = oathBurst(this.burstAge);
      const r = OATH_BUBBLE_RADIUS * (olen?.scale ?? 1.5) * b.scale;
      this.bubble.visible = b.alpha > 0.01;
      this.bubble.position.set(this.burstX, this.burstY + r * 0.5, this.burstZ);
      this.bubble.scale.set(r, r * 0.92, r);
      this.bubbleMat.uniforms.uAlpha.value = b.alpha;
      if (this.burstAge >= OATH_BURST_SECONDS) this.burstAge = -1;
    }
    // The gold gathering round his blade over the Hallowed Brine's bar.
    if (this.bladeAge >= 0 && olen && this.cosmetic) {
      this.bladeAge += dt;
      const k = Math.min(1, this.bladeAge / OLEN_KIT.brineCast);
      this.bladeGlow.visible = true;
      this.bladeGlow.position.set(olen.pos.x, olen.pos.y + 2.2 * olen.scale, olen.pos.z);
      this.bladeGlow.scale.setScalar(1.5 + 3 * k);
      (this.bladeGlow.material as THREE.SpriteMaterial).opacity = 0.4 + 0.6 * k;
      if (this.fx.rand() < dt * 18)
        this.fx.burst(
          olen.pos.x + (this.fx.rand() - 0.5) * 3,
          olen.pos.y + 0.5 + this.fx.rand() * 2,
          olen.pos.z + (this.fx.rand() - 0.5) * 3,
          GOLD,
          1,
          0.3,
          0.1,
          0.5,
          1.5,
        );
      if (this.bladeAge > OLEN_KIT.brineCast + 0.3) this.bladeAge = -1;
    } else this.bladeGlow.visible = false;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.fx.dispose();
    this.kit.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
