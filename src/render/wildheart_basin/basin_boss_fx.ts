// The Wildheart Basin's three boss encounters, PLACEHOLDER looks (plan:
// basin_boss_fx_core.ts). Composed and driven by WildheartFx (basin_fx.ts),
// which lends it its fx root (so every mesh here rides the same compile-gated
// attach), its telegraph kit, its particle pools and its shock rings.
//  - the Fanglord Beastmaster: the Beast Pit Quake ring, heroic Heel!'s leap
//    lane from the crouching jaguar to its master, the jade spirit cord of
//    Pack Bond (brighter as they close), the red fang over the Stalked prey,
//    the hide shimmer of Thickhide Ward, the red roar of Call of the Hunt;
//  - the Gorgebloom: Seed Rain's gold charge sigil and the seeds lobbed onto
//    the loam, the fat red pods swelling (throbbing once ripe) over their
//    touch rings, the Vine Lash lane, Gorge's tank-buster mark, Bloom Spit,
//    the pollen haze on the Pollinated, sprouts bursting in thorns;
//  - Zulgar: the Wildheart Pulse ring, Spirit of the Hunt's jade sigil, the
//    Jaguar Avatar's spirit glow and trail, the jade claw over his Prey
//    (brighter on the one he chases now), the sun glyphs burning gold or
//    smouldering dark, the Sunstruck flare, the heroic Ambush smoke.
// The one-shot bursts each boss event throws up are basin_boss_bursts.ts.
//
// Rules (src/render/CLAUDE.md): every mesh and material is built here once,
// in the constructor, under the host's root before WildheartFx's gated attach;
// the hot paint paths reuse their paint, style and mote options. The telegraphs are ACTIONABLE (the shared kit, the
// threat palette, every tier); glows, sigils and motes are cosmetic and thin
// on the low tier through the host's density. All state comes from IWorld
// entities and events, so offline and online look the same. No light here.

import * as THREE from 'three';
import {
  BEAST_PACK_BOND,
  BEAST_THICKHIDE_WARD,
  BEASTMASTER_ID,
  BLOOM_VINE_LASH,
  FANGLORD_JAGUAR_ID,
  WILDHEART_SEEDPOD,
  WILDHEART_SEEDPOD_RIPE,
  WILDHEART_SUN_GLYPH_DARK,
  WILDHEART_SUN_GLYPH_LIT,
} from '../../sim/encounters/wildheart_basin/ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import type { TelegraphFan, TelegraphLane, TelegraphPaint } from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { radialGlowTexture } from '../textures';
import { type BossBurstHooks, playBasinBossBurst } from './basin_boss_bursts';
import {
  BASIN_AURA_LOOKS,
  BASIN_BOSS_TEMPLATES,
  BASIN_HEAD_MARKS,
  BOSS_SPLASH,
  type BossCastSpec,
  basinBossCastSpecs,
  bondCordStrength,
  bossBodyHeight,
  bossCastYaw,
  bossLaneLength,
  chargeLook,
  glyphLook,
  headMarkLook,
  podSwell,
  SEED_FLIGHT_SECONDS,
  SPIT_FLIGHT_SECONDS,
  seedArcInto,
  wardShimmer,
} from './basin_boss_fx_core';
import { type BasinPuffOptions, basinCastFill } from './basin_fx_core';
import type { BasinFxHost } from './basin_fx_host';
import { huntRingMaterial, huntSigilTexture } from './basin_mark_art';
import { seedpodGeometry, seedpodMaterial } from './basin_seedpod';
import { BondCord } from './bond_cord';
import { jaguarBondAnchor } from './jaguar_model_core';

const FAN_SLOTS = 4;
const LANE_SLOTS = 3;
const CHARGE_SLOTS = 2;
const POD_SLOTS = 12;
const GLYPH_SLOTS = 6;
const SEED_SLOTS = 12;
const MARK_SLOTS = 6;
const DRESS_SLOTS = 16;
const WARD_SLOTS = 2;

interface FanSlot extends TelegraphFan {
  casterId: number;
  castId: string;
}
interface LaneSlot extends TelegraphLane {
  casterId: number;
  castId: string;
  yaw: number | null;
}
interface ChargeSlot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  halo: THREE.Sprite;
  haloMat: THREE.SpriteMaterial;
  casterId: number;
  castId: string;
  emit: number;
}
interface PodSlot {
  body: THREE.Mesh;
  glow: THREE.Sprite;
  glowMat: THREE.SpriteMaterial;
  objectId: number;
  /** The last pod this slot drew (kept after it goes, for its burst). */
  lastId: number;
  x: number;
  z: number;
  landAt: number;
  ripeSince: number;
}
interface GlyphSlot {
  disc: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  /** The shaft of sunlight standing on a lit glyph. */
  shaft: THREE.Mesh;
  shaftMat: THREE.ShaderMaterial;
  halo: THREE.Sprite;
  haloMat: THREE.SpriteMaterial;
  objectId: number;
  emit: number;
}
interface SeedSlot {
  body: THREE.Mesh;
  glow: THREE.Sprite;
  glowMat: THREE.SpriteMaterial;
  alive: boolean;
  spit: boolean;
  born: number;
  flight: number;
  apex: number;
  targetId: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
}
interface MarkSlot {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  /** The ring of claw rakes under the hunted player's feet. */
  ring: THREE.Mesh;
  ringMat: THREE.ShaderMaterial;
  entityId: number;
  auraId: string;
}
interface DressSlot {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  entityId: number;
  auraId: string;
  emit: number;
  lastX: number;
  lastZ: number;
}
interface WardSlot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  entityId: number;
}

const DISC_VERT = /* glsl */ `
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** The charge sigil: an outer rune band, petals turning, a spiral drawn in. */
const CHARGE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uAccent;
uniform float uFill;
uniform float uAlpha;
uniform float uTime;
varying vec3 vLocal;
void main() {
  float r = length(vLocal.xz);
  if (r > 1.0) discard;
  float a = atan(vLocal.z, vLocal.x);
  float outer = smoothstep(0.86, 0.9, r) * (1.0 - smoothstep(0.95, 1.0, r));
  float runes = step(0.6, fract(a * 1.909859 + 0.25)) * smoothstep(0.72, 0.75, r)
    * (1.0 - smoothstep(0.82, 0.85, r));
  float inner = smoothstep(0.5, 0.53, r) * (1.0 - smoothstep(0.56, 0.59, r));
  float petals = pow(max(0.0, cos(a * 6.0)), 10.0) * smoothstep(0.58, 0.62, r)
    * (1.0 - smoothstep(0.8, 0.84, r));
  float spiral = fract(a * 0.477465 + r * 2.0 - uTime * 0.9);
  float swirl = smoothstep(0.82, 1.0, spiral) * step(r, 0.5) * r * 2.0;
  float core = (1.0 - smoothstep(0.0, 0.18 + 0.22 * uFill, r)) * uFill;
  float a1 = outer * 0.9 + runes * 0.55 + inner * 0.6 + petals * 0.7 + swirl * 0.55 + core * 0.9;
  vec3 col = mix(uColor, uAccent, core * 0.6 + runes * 0.3);
  gl_FragColor = vec4(col * (1.0 + core * 0.8), a1 * uAlpha);
}
`;
/** A sun glyph: a gold disc and its rays when lit, a smouldering ember dark. */
const GLYPH_FRAG = /* glsl */ `
uniform float uLit;
uniform float uAlpha;
uniform float uTime;
varying vec3 vLocal;
void main() {
  float r = length(vLocal.xz);
  if (r > 1.0) discard;
  float a = atan(vLocal.z, vLocal.x);
  float rays = pow(max(0.0, cos(a * 8.0 + uTime * 0.3)), 6.0) * smoothstep(0.3, 0.42, r)
    * (1.0 - smoothstep(0.7, 0.92, r));
  float disc = 1.0 - smoothstep(0.2, 0.3, r);
  float band = smoothstep(0.8, 0.84, r) * (1.0 - smoothstep(0.9, 0.95, r));
  float shimmer = 0.75 + 0.25 * sin(uTime * 2.0 + r * 10.0);
  float litA = disc * 0.6 + rays * 0.6 * shimmer + band * 0.75;
  float crack = pow(max(0.0, cos(a * 5.0 + r * 9.0)), 12.0) * step(r, 0.9);
  float darkA = (disc * 0.22 + band * 0.3 + crack * 0.35) * (0.6 + 0.4 * sin(uTime * 1.3 + a * 3.0));
  vec3 col = mix(vec3(0.62, 0.2, 0.06), vec3(1.0, 0.8, 0.36), uLit);
  gl_FragColor = vec4(col, mix(darkA, litA, uLit) * uAlpha);
}
`;
/** A lit sun glyph's shaft of light: brightest at its foot, rays turning. */
const SHAFT_VERT = /* glsl */ `
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const SHAFT_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uTime;
varying vec3 vLocal;
void main() {
  float a = atan(vLocal.z, vLocal.x);
  float v = vLocal.y;
  float rays = 0.55 + 0.45 * pow(max(0.0, cos(a * 5.0 + uTime * 0.5 + v * 1.5)), 3.0);
  float fall = (1.0 - smoothstep(0.0, 1.0, v)) * smoothstep(0.0, 0.04, v);
  float motes = 0.8 + 0.2 * sin(v * 24.0 - uTime * 3.0 + a * 3.0);
  gl_FragColor = vec4(vec3(1.0, 0.82, 0.45) * fall * rays * motes * uAlpha, 1.0);
}
`;

const WARD_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
  vP = position;
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;
/** Thickhide Ward: a hide-gold shell, bright at its rim, plates rippling. */
const WARD_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
  float f = pow(max(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0), 2.2);
  float plates = step(0.82, fract(vP.y * 5.0 + sin(vP.x * 6.0) * 0.4 - uTime * 0.6));
  vec3 col = mix(vec3(0.95, 0.66, 0.28), vec3(1.0, 0.92, 0.7), plates);
  gl_FragColor = vec4(col, (f * 0.85 + plates * f * 0.4 + 0.04) * uAlpha);
}
`;

export class BasinBossFx implements BossBurstHooks {
  private readonly specs = basinBossCastSpecs();
  private readonly fans: FanSlot[] = [];
  private readonly lanes: LaneSlot[] = [];
  private readonly charges: ChargeSlot[] = [];
  private readonly pods: PodSlot[] = [];
  private readonly glyphs: GlyphSlot[] = [];
  private readonly seeds: SeedSlot[] = [];
  private readonly marks: MarkSlot[] = [];
  private readonly dresses: DressSlot[] = [];
  private readonly wards: WardSlot[] = [];
  private readonly cord: BondCord;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly arc = { x: 0, y: 0, z: 0 };
  private readonly flat = { x: 0, z: 0, facing: 0 };
  private readonly flatTarget = { x: 0, z: 0 };
  /** Reused per-frame: the kit's paint and style, and the busiest motes. */
  private readonly paint: TelegraphPaint = { fill: 0, clock: 0, range: 1 };
  private readonly style = { color: 0xffffff, accent: 0xffffff };
  private readonly chargeMote: BasinPuffOptions & {
    color: [number, number, number];
    dir: [number, number, number];
  } = {
    speed: 1,
    life: 0.75,
    size: [0.45, 0.12],
    color: [1, 1, 1],
    alpha: 0.9,
    glow: true,
    dir: [0, 0, 0],
    spread: 0.08,
    drag: 0.4,
  };
  private readonly auraMote: BasinPuffOptions = {
    speed: 0.5,
    life: 1,
    size: [1, 1],
    color: [1, 1, 1],
    alpha: 1,
    drag: 1,
  };
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly feet: [number, number, number, number] = [0, 0, 0, 0];
  private bondMaster = -1;
  private bondJaguarId = -1;
  /** The Vine Lash lane's last locked yaw (its burst lands after the bar). */
  private lashCaster = -1;
  private lashYawLocked = 0;
  private clock = 0;

  constructor(
    private readonly host: BasinFxHost,
    private readonly world: IWorld,
  ) {
    const { root, kit } = host;
    for (let i = 0; i < FAN_SLOTS; i++) fansPush(this.fans, kit.fan(19));
    for (let i = 0; i < LANE_SLOTS; i++)
      this.lanes.push({ ...kit.lane(17), casterId: -1, castId: '', yaw: null });
    const glowTex = radialGlowTexture();
    // Minted per call (not a shared cache): this fx owns and disposes it.
    this.textures.push(glowTex);
    const sprite = (color: number, opacity: number, name: string, map: THREE.Texture = glowTex) => {
      const mat = new THREE.SpriteMaterial({
        map,
        color,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        name,
      });
      this.materials.push(mat);
      const s = new THREE.Sprite(mat);
      s.visible = false;
      root.add(s);
      return { s, mat };
    };
    // Charge sigils (a disc on the floor) and their halo.
    const discGeo = new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2);
    this.geometries.push(discGeo);
    for (let i = 0; i < CHARGE_SLOTS; i++) {
      const mat = new THREE.ShaderMaterial({
        name: 'wildheartChargeSigil',
        uniforms: {
          uColor: { value: new THREE.Color() },
          uAccent: { value: new THREE.Color() },
          uFill: { value: 0 },
          uAlpha: { value: 1 },
          uTime: host.uTime,
        },
        vertexShader: DISC_VERT,
        fragmentShader: CHARGE_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(discGeo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 5);
      root.add(mesh);
      const halo = sprite(0xffffff, 0.6, 'wildheartChargeHalo');
      this.charges.push({
        mesh,
        mat,
        halo: halo.s,
        haloMat: halo.mat,
        casterId: -1,
        castId: '',
        emit: 0,
      });
    }
    // The seed: a ribbed bulb whose veins burn as it ripens (basin_seedpod.ts),
    // a material per pod for its own glow; the lobbed seeds share one.
    const seedGeo = seedpodGeometry();
    this.geometries.push(seedGeo);
    const seedMat = seedpodMaterial(host.uTime);
    seedMat.uniforms.uGlow.value = 0.9;
    seedMat.uniforms.uRipe.value = 1;
    this.materials.push(seedMat);
    for (let i = 0; i < POD_SLOTS; i++) {
      const podMat = seedpodMaterial(host.uTime);
      this.materials.push(podMat);
      const body = new THREE.Mesh(seedGeo, podMat);
      body.visible = false;
      root.add(body);
      const g = sprite(0xd82a2a, 0.5, 'wildheartPodGlow');
      this.pods.push({
        body,
        glow: g.s,
        glowMat: g.mat,
        objectId: -1,
        lastId: -1,
        x: 0,
        z: 0,
        landAt: 0,
        ripeSince: -1,
      });
    }
    for (let i = 0; i < SEED_SLOTS; i++) {
      const body = new THREE.Mesh(seedGeo, seedMat);
      body.visible = false;
      root.add(body);
      const g = sprite(0xff5a3a, 0.8, 'wildheartSeedGlow');
      this.seeds.push({
        body,
        glow: g.s,
        glowMat: g.mat,
        alive: false,
        spit: false,
        born: 0,
        flight: 1,
        apex: 0,
        targetId: -1,
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
      });
    }
    // The sun glyphs' overlay, their shafts of light and halo.
    const shaftGeo = new THREE.CylinderGeometry(0.7, 1, 1, 32, 1, true).translate(0, 0.5, 0);
    this.geometries.push(shaftGeo);
    for (let i = 0; i < GLYPH_SLOTS; i++) {
      const mat = new THREE.ShaderMaterial({
        name: 'wildheartSunGlyph',
        uniforms: { uLit: { value: 1 }, uAlpha: { value: 1 }, uTime: host.uTime },
        vertexShader: DISC_VERT,
        fragmentShader: GLYPH_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      this.materials.push(mat);
      const disc = new THREE.Mesh(discGeo, mat);
      disc.frustumCulled = false;
      disc.visible = false;
      disc.renderOrder = floorVfxRenderOrder('encounter', 3);
      root.add(disc);
      const shaftMat = new THREE.ShaderMaterial({
        name: 'wildheartSunShaft',
        uniforms: { uAlpha: { value: 0 }, uTime: host.uTime },
        vertexShader: SHAFT_VERT,
        fragmentShader: SHAFT_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      this.materials.push(shaftMat);
      const shaft = new THREE.Mesh(shaftGeo, shaftMat);
      shaft.frustumCulled = false;
      shaft.visible = false;
      root.add(shaft);
      const halo = sprite(0xffc860, 0.5, 'wildheartGlyphHalo');
      this.glyphs.push({
        disc,
        mat,
        shaft,
        shaftMat,
        halo: halo.s,
        haloMat: halo.mat,
        objectId: -1,
        emit: 0,
      });
    }
    // Head marks: the fang and the claw.
    const clawTex = huntSigilTexture();
    const ringGeo = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
    this.geometries.push(ringGeo);
    this.textures.push(clawTex);
    for (let i = 0; i < MARK_SLOTS; i++) {
      const mat = new THREE.SpriteMaterial({
        map: clawTex,
        color: 0xffffff,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        name: 'wildheartHeadMark',
      });
      this.materials.push(mat);
      const s = new THREE.Sprite(mat);
      s.visible = false;
      root.add(s);
      const ringMat = huntRingMaterial(host.uTime);
      this.materials.push(ringMat);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.frustumCulled = false;
      ring.visible = false;
      ring.renderOrder = floorVfxRenderOrder('encounter', 6);
      root.add(ring);
      this.marks.push({ sprite: s, mat, ring, ringMat, entityId: -1, auraId: '' });
    }
    // Aura dressing: one glow sprite per bearer and aura.
    for (let i = 0; i < DRESS_SLOTS; i++) {
      const g = sprite(0xffffff, 0.5, 'wildheartAuraGlow');
      this.dresses.push({
        sprite: g.s,
        mat: g.mat,
        entityId: -1,
        auraId: '',
        emit: 0,
        lastX: 0,
        lastZ: 0,
      });
    }
    // Thickhide Ward's hide shell.
    const wardGeo = new THREE.IcosahedronGeometry(1, 3);
    this.geometries.push(wardGeo);
    for (let i = 0; i < WARD_SLOTS; i++) {
      const mat = new THREE.ShaderMaterial({
        name: 'wildheartThickhideWard',
        uniforms: { uTime: host.uTime, uAlpha: { value: 0 } },
        vertexShader: WARD_VERT,
        fragmentShader: WARD_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(wardGeo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      root.add(mesh);
      this.wards.push({ mesh, mat, entityId: -1 });
    }
    // Pack Bond's braided jade cord (bond_cord.ts).
    this.cord = new BondCord(host);
  }

  // ------------------------------------------------------------------- scan

  beginScan(): void {
    this.bondMaster = -1;
    this.bondJaguarId = -1;
  }

  /** Claim what this entity needs; true when it is one of the basin's bosses. */
  scanEntity(e: Entity): boolean {
    if (e.kind === 'object') {
      this.scanObject(e);
      return false;
    }
    if (e.dead) return BASIN_BOSS_TEMPLATES.has(e.templateId);
    const auras = e.auras;
    if (auras) {
      for (let i = 0; i < auras.length; i++) {
        const id = auras[i].id;
        if (BASIN_HEAD_MARKS[id]) this.claimMark(e, id);
        if (BASIN_AURA_LOOKS[id]) this.claimDress(e, id);
        if (id === BEAST_THICKHIDE_WARD) this.claimWard(e);
        if (id === BEAST_PACK_BOND) {
          if (e.templateId === BEASTMASTER_ID) this.bondMaster = e.id;
          if (e.templateId === FANGLORD_JAGUAR_ID) this.bondJaguarId = e.id;
        }
      }
    }
    if (e.kind !== 'mob') return false;
    const castId = e.castingAbility;
    const spec = castId ? this.specs[castId] : undefined;
    if (castId && spec) this.claimCast(e, castId, spec);
    return BASIN_BOSS_TEMPLATES.has(e.templateId);
  }

  private claimCast(e: Entity, castId: string, spec: BossCastSpec): void {
    if (spec.shape === 'charge') {
      if (this.charges.some((c) => c.casterId === e.id)) return;
      const c = this.charges.find((s) => s.casterId < 0);
      if (!c) return;
      c.casterId = e.id;
      c.castId = castId;
      c.emit = 0;
      (c.mat.uniforms.uColor.value as THREE.Color).setHex(spec.color);
      (c.mat.uniforms.uAccent.value as THREE.Color).setHex(spec.accent);
      c.haloMat.color.setHex(spec.color);
      c.mesh.visible = true;
      c.halo.visible = true;
      return;
    }
    if (spec.shape === 'lane') {
      if (this.lanes.some((l) => l.casterId === e.id)) return;
      const l = this.lanes.find((s) => s.casterId < 0);
      if (!l) return;
      l.casterId = e.id;
      l.castId = castId;
      // The sim turns the caster onto the locked line as the bar opens.
      l.yaw = spec.lockYaw ? e.facing : null;
      l.group.visible = true;
      return;
    }
    if (this.fans.some((f) => f.casterId === e.id)) return;
    const f = this.fans.find((s) => s.casterId < 0);
    if (!f) return;
    this.host.kit.layOutFan(f, spec.shape === 'ring' ? 360 : spec.arcDeg, {
      color: spec.color,
      accent: spec.accent,
    });
    f.casterId = e.id;
    f.castId = castId;
    f.group.visible = true;
  }

  private scanObject(e: Entity): void {
    const t = e.templateId;
    if (t === WILDHEART_SEEDPOD || t === WILDHEART_SEEDPOD_RIPE) {
      if (this.pods.some((p) => p.objectId === e.id)) return;
      const p = this.pods.find((s) => s.objectId < 0);
      if (!p) return;
      p.objectId = e.id;
      p.lastId = e.id;
      p.x = e.pos.x;
      p.z = e.pos.z;
      p.ripeSince = -1;
      // A seed still in flight to it lands it; otherwise it is already down.
      const seed = this.seeds.find((s) => s.alive && s.targetId === e.id);
      p.landAt = seed ? seed.born + seed.flight : this.clock;
      return;
    }
    if (t === WILDHEART_SUN_GLYPH_LIT || t === WILDHEART_SUN_GLYPH_DARK) {
      if (this.glyphs.some((g) => g.objectId === e.id)) return;
      const g = this.glyphs.find((s) => s.objectId < 0);
      if (!g) return;
      g.objectId = e.id;
      g.emit = 0;
      g.disc.visible = true;
      g.halo.visible = true;
    }
  }

  private claimMark(e: Entity, auraId: string): void {
    if (this.marks.some((m) => m.entityId === e.id && m.auraId === auraId)) return;
    const m = this.marks.find((s) => s.entityId < 0);
    if (!m) return;
    m.entityId = e.id;
    m.auraId = auraId;
    m.sprite.visible = true;
  }

  private claimDress(e: Entity, auraId: string): void {
    if (this.dresses.some((d) => d.entityId === e.id && d.auraId === auraId)) return;
    const d = this.dresses.find((s) => s.entityId < 0);
    if (!d) return;
    d.entityId = e.id;
    d.auraId = auraId;
    d.emit = 0;
    d.lastX = e.pos.x;
    d.lastZ = e.pos.z;
    const glow = BASIN_AURA_LOOKS[auraId]?.glow;
    if (glow) d.mat.color.setHex(glow.color);
    d.sprite.visible = !!glow;
  }

  private claimWard(e: Entity): void {
    if (this.wards.some((w) => w.entityId === e.id)) return;
    const w = this.wards.find((s) => s.entityId < 0);
    if (!w) return;
    w.entityId = e.id;
    w.mesh.visible = true;
  }

  // ------------------------------------------------------------------- frame

  update(dt: number, clock: number): void {
    this.clock = clock;
    const world = this.world;
    this.paintFans(world);
    this.paintLanes(world);
    this.paintCharges(world, dt);
    this.paintPods(world, dt);
    this.paintGlyphs(world, dt);
    this.paintSeeds();
    this.paintMarks(world);
    this.paintDresses(world, dt);
    this.paintWards(world);
    this.paintCord(world, dt);
  }

  /** The caster's flat spot and facing, in a reused object. */
  private flatOf(e: Entity): { x: number; z: number; facing: number } {
    this.flat.x = e.pos.x;
    this.flat.z = e.pos.z;
    this.flat.facing = e.facing;
    return this.flat;
  }

  private castTarget(world: IWorld, caster: Entity): Entity | undefined {
    const id = caster.castTargetId;
    return id !== null && id !== undefined ? world.entities.get(id) : undefined;
  }

  private paintFans(world: IWorld): void {
    for (const f of this.fans) {
      if (f.casterId < 0) continue;
      const caster = world.entities.get(f.casterId);
      const spec = this.specs[f.castId];
      const target = caster && spec?.anchor === 'target' ? this.castTarget(world, caster) : caster;
      if (!caster || caster.dead || caster.castingAbility !== f.castId || !spec || !target) {
        f.casterId = -1;
        f.group.visible = false;
        continue;
      }
      const fill = basinCastFill(caster.castRemaining, caster.castTotal);
      const yaw = bossCastYaw(spec, this.flatOf(caster), null, null);
      const x = target.pos.x;
      const z = target.pos.z;
      this.host.kit.drapeFan(f, this.host.groundY, x, this.host.groundY(x, z), z, yaw, spec.range);
      this.paint.fill = fill;
      this.paint.clock = this.clock;
      this.paint.range = spec.range;
      this.host.kit.paintFan(f, this.paint);
    }
  }

  private paintLanes(world: IWorld): void {
    for (const l of this.lanes) {
      if (l.casterId < 0) continue;
      const caster = world.entities.get(l.casterId);
      const spec = this.specs[l.castId];
      const target = caster ? this.castTarget(world, caster) : undefined;
      if (
        !caster ||
        caster.dead ||
        caster.castingAbility !== l.castId ||
        !spec ||
        (spec.reachToTarget && !target)
      ) {
        l.casterId = -1;
        l.group.visible = false;
        continue;
      }
      const x = caster.pos.x;
      const z = caster.pos.z;
      let flatTarget: { x: number; z: number } | null = null;
      if (target) {
        flatTarget = this.flatTarget;
        flatTarget.x = target.pos.x;
        flatTarget.z = target.pos.z;
      }
      const yaw = bossCastYaw(spec, this.flatOf(caster), flatTarget, l.yaw);
      const distance = target ? Math.hypot(target.pos.x - x, target.pos.z - z) : 0;
      const length = bossLaneLength(spec, distance);
      if (l.castId === BLOOM_VINE_LASH) {
        this.lashCaster = caster.id;
        this.lashYawLocked = yaw;
      }
      this.host.kit.drapeLane(
        l,
        this.host.groundY,
        x,
        this.host.groundY(x, z),
        z,
        yaw,
        length,
        spec.halfWidth,
        this.styleOf(spec),
      );
      const fill = basinCastFill(caster.castRemaining, caster.castTotal);
      this.paint.fill = fill;
      this.paint.clock = this.clock;
      this.paint.range = length;
      this.host.kit.paintLane(l, this.paint);
    }
  }

  private paintCharges(world: IWorld, dt: number): void {
    for (const c of this.charges) {
      if (c.casterId < 0) continue;
      const caster = world.entities.get(c.casterId);
      const spec = this.specs[c.castId];
      if (!caster || caster.dead || caster.castingAbility !== c.castId || !spec) {
        c.casterId = -1;
        c.mesh.visible = false;
        c.halo.visible = false;
        continue;
      }
      const fill = basinCastFill(caster.castRemaining, caster.castTotal);
      const look = chargeLook(fill, this.clock);
      const { x, z } = caster.pos;
      const gy = this.host.groundY(x, z);
      c.mesh.position.set(x, gy + 0.11, z);
      c.mesh.rotation.y = look.spin;
      c.mesh.scale.setScalar(spec.range);
      c.mat.uniforms.uFill.value = fill;
      c.mat.uniforms.uAlpha.value = look.alpha;
      const h = bossBodyHeight(caster.templateId, caster.scale || 1);
      c.halo.position.set(x, caster.pos.y + h * 0.55, z);
      c.halo.scale.setScalar(h * (0.6 + 0.9 * look.glow));
      c.haloMat.opacity = 0.25 + 0.45 * look.glow;
      // Motes drawn in from the sigil's edge to its heart.
      c.emit += dt * 34 * this.host.density;
      const col = c.haloMat.color;
      const mote = this.chargeMote;
      mote.speed = spec.range * 1.3;
      mote.color[0] = col.r;
      mote.color[1] = col.g;
      mote.color[2] = col.b;
      while (c.emit >= 1) {
        c.emit -= 1;
        const a = this.host.rand() * Math.PI * 2;
        const r = spec.range * (0.85 + 0.2 * this.host.rand());
        mote.dir[0] = -Math.cos(a);
        mote.dir[1] = 0.35 + fill;
        mote.dir[2] = -Math.sin(a);
        this.host.puff(x + Math.cos(a) * r, gy + 0.3, z + Math.sin(a) * r, 1, mote);
      }
    }
  }

  private paintPods(world: IWorld, dt: number): void {
    for (const p of this.pods) {
      if (p.objectId < 0) continue;
      const obj = world.entities.get(p.objectId);
      const t = obj?.templateId;
      if (!obj || (t !== WILDHEART_SEEDPOD && t !== WILDHEART_SEEDPOD_RIPE)) {
        p.objectId = -1;
        p.body.visible = false;
        p.glow.visible = false;
        continue;
      }
      p.x = obj.pos.x;
      p.z = obj.pos.z;
      const landed = this.clock >= p.landAt;
      p.body.visible = landed;
      p.glow.visible = landed;
      if (!landed) continue;
      const ripe = t === WILDHEART_SEEDPOD_RIPE;
      if (ripe && p.ripeSince < 0) p.ripeSince = this.clock;
      const swell = podSwell(
        ripe,
        ripe ? this.clock - p.ripeSince : this.clock - p.landAt,
        this.clock + p.objectId * 0.37,
      );
      const gy = this.host.groundY(p.x, p.z);
      const s = swell.scale * 1.1;
      // Seated in the loam, leaning a little, its glow climbing as it ripens.
      p.body.position.set(p.x, gy - 0.08 * s, p.z);
      p.body.scale.setScalar(s);
      p.body.rotation.set(
        0.08 * Math.sin(p.objectId),
        p.objectId * 1.7,
        0.08 * Math.cos(p.objectId),
      );
      const podMat = p.body.material as THREE.ShaderMaterial;
      podMat.uniforms.uGlow.value = Math.min(1, 0.25 + swell.glow);
      podMat.uniforms.uRipe.value = ripe ? 1 : 0;
      p.glow.position.set(p.x, gy + 0.6 * s, p.z);
      p.glow.scale.setScalar(1.2 + swell.glow * 2.2);
      p.glowMat.color.setHex(ripe ? 0xff6a2a : 0xd82a2a);
      p.glowMat.opacity = Math.min(1, swell.glow * 0.8);
      // A ripe pod spits spores as it strains.
      if (ripe && this.host.rand() < dt * 8 * this.host.density) {
        this.host.puff(p.x, gy + s, p.z, 1, {
          speed: 1.2,
          up: 1.6,
          life: 1.1,
          size: [0.35, 0.9],
          color: [0.85, 0.7, 0.3],
          alpha: 0.6,
          radius: 0.4,
        });
      }
    }
  }

  private paintGlyphs(world: IWorld, dt: number): void {
    for (const g of this.glyphs) {
      if (g.objectId < 0) continue;
      const obj = world.entities.get(g.objectId);
      const t = obj?.templateId;
      if (!obj || (t !== WILDHEART_SUN_GLYPH_LIT && t !== WILDHEART_SUN_GLYPH_DARK)) {
        g.objectId = -1;
        g.disc.visible = false;
        g.halo.visible = false;
        g.shaft.visible = false;
        continue;
      }
      const lit = t === WILDHEART_SUN_GLYPH_LIT;
      const look = glyphLook(lit, this.clock + g.objectId * 0.61);
      const r = obj.scale || 1;
      const { x, z } = obj.pos;
      const gy = this.host.groundY(x, z);
      g.disc.position.set(x, gy + 0.1, z);
      g.disc.scale.setScalar(r);
      g.mat.uniforms.uLit.value = look.lit;
      g.mat.uniforms.uAlpha.value = look.alpha;
      g.halo.position.set(x, gy + 0.9, z);
      g.halo.scale.set(r * 2.6, r * 1.3, 1);
      g.haloMat.color.setHex(lit ? 0xffc860 : 0xb0401a);
      g.haloMat.opacity = look.halo;
      // A lit glyph stands in a shaft of sunlight; a spent one has none.
      g.shaft.visible = lit;
      if (lit) {
        g.shaft.position.set(x, gy + 0.05, z);
        g.shaft.scale.set(r * 0.85, 11, r * 0.85);
        g.shaftMat.uniforms.uAlpha.value = 0.32 * look.alpha;
      }
      // A lit glyph breathes gold sparks upward.
      g.emit += dt * (lit ? 5 : 0.8) * this.host.density;
      while (g.emit >= 1) {
        g.emit -= 1;
        this.host.puff(x, gy + 0.2, z, 1, {
          speed: 0.3,
          up: lit ? 2.2 : 0.8,
          life: lit ? 1.6 : 1.2,
          size: lit ? [0.3, 0.08] : [0.25, 0.08],
          color: lit ? [1, 0.82, 0.4] : [0.9, 0.3, 0.1],
          alpha: 0.9,
          glow: true,
          radius: r * 0.8,
        });
      }
    }
  }

  private paintSeeds(): void {
    for (const s of this.seeds) {
      if (!s.alive) continue;
      const u = (this.clock - s.born) / s.flight;
      if (u < 0) continue;
      if (u >= 1) {
        s.alive = false;
        s.body.visible = false;
        s.glow.visible = false;
        this.seedImpact(s);
        continue;
      }
      const p = seedArcInto(this.arc, s.from, s.to, u, s.apex);
      s.body.visible = !s.spit;
      s.glow.visible = true;
      s.body.position.set(p.x, p.y - 0.35, p.z);
      s.body.rotation.x = this.clock * 9;
      s.glow.position.set(p.x, p.y, p.z);
      if (this.host.rand() < 0.6 * this.host.density) {
        this.host.puff(p.x, p.y, p.z, 1, {
          speed: 0.3,
          life: 0.4,
          size: s.spit ? [0.9, 0.2] : [0.6, 0.15],
          color: s.spit ? [0.55, 0.95, 0.25] : [1, 0.45, 0.25],
          alpha: 0.8,
          glow: true,
        });
      }
    }
  }

  private seedImpact(s: SeedSlot): void {
    const { x, y, z } = s.to;
    if (s.spit) {
      this.host.puff(x, y, z, 16, {
        speed: 4,
        up: 1.5,
        life: 0.7,
        size: [0.5, 0.15],
        color: [0.55, 0.95, 0.25],
        alpha: 0.9,
        glow: true,
        gravity: 8,
      });
      return;
    }
    // The pod thumps into the loam: a crown of earth and a ring through it.
    const gy = this.host.groundY(x, z);
    this.host.splash.crown(x, gy - 0.05, z, BOSS_SPLASH.podLand.crown, BOSS_SPLASH.podLand.tint);
    if (BOSS_SPLASH.podLand.ripple)
      this.host.splash.ripple(
        x,
        gy + 0.04,
        z,
        BOSS_SPLASH.podLand.ripple,
        BOSS_SPLASH.podLand.tint,
      );
    this.host.puff(x, y + 0.2, z, 12, {
      speed: 3.5,
      up: 2,
      life: 0.9,
      size: [0.9, 2.2],
      color: [0.48, 0.36, 0.22],
      alpha: 0.6,
      drag: 2,
    });
  }

  private paintMarks(world: IWorld): void {
    for (const m of this.marks) {
      if (m.entityId < 0) continue;
      const e = world.entities.get(m.entityId);
      const aura = e && !e.dead ? findAura(e, m.auraId) : undefined;
      if (!e || !aura) {
        m.entityId = -1;
        m.sprite.visible = false;
        m.ring.visible = false;
        continue;
      }
      const look = headMarkLook(m.auraId, aura.value2 === 1, this.clock);
      const h = bossBodyHeight(e.templateId, e.scale || 1);
      m.sprite.position.set(e.pos.x, e.pos.y + h + 1.1, e.pos.z);
      m.sprite.scale.setScalar(look.size * 1.25);
      m.mat.color.setHex(look.color);
      m.mat.opacity = look.alpha;
      // The ring of rakes at their feet: the hunted read from any angle.
      m.ring.visible = true;
      m.ring.position.set(e.pos.x, this.host.groundY(e.pos.x, e.pos.z) + 0.08, e.pos.z);
      m.ring.scale.setScalar(1.5 + 0.25 * look.size);
      (m.ringMat.uniforms.uColor.value as THREE.Color).setHex(look.color);
      m.ringMat.uniforms.uAlpha.value = look.alpha * 0.85;
    }
  }

  private paintDresses(world: IWorld, dt: number): void {
    for (const d of this.dresses) {
      if (d.entityId < 0) continue;
      const e = world.entities.get(d.entityId);
      const look = BASIN_AURA_LOOKS[d.auraId];
      if (!e || e.dead || !look || !findAura(e, d.auraId)) {
        d.entityId = -1;
        d.sprite.visible = false;
        continue;
      }
      const h = bossBodyHeight(e.templateId, e.scale || 1);
      const { x, y, z } = e.pos;
      const glow = look.glow;
      if (glow) {
        const k =
          1 - glow.pulse + glow.pulse * (0.5 + 0.5 * Math.sin(this.clock * glow.pulseHz * 6.283));
        d.sprite.position.set(x, y + h * glow.lift, z);
        d.sprite.scale.setScalar(h * glow.size * (0.85 + 0.15 * k));
        d.mat.opacity = glow.alpha * k;
      }
      const motes = look.motes;
      if (motes) {
        const moved = Math.hypot(x - d.lastX, z - d.lastZ) > 0.01;
        if (!motes.trail || moved) d.emit += dt * motes.rate * this.host.density;
        const mote = this.auraMote;
        mote.up = motes.up;
        mote.life = motes.life;
        mote.size = motes.size;
        mote.color = motes.color;
        mote.alpha = motes.alpha;
        mote.glow = motes.glow;
        mote.gravity = motes.gravity;
        mote.radius = h * motes.spread;
        while (d.emit >= 1) {
          d.emit -= 1;
          const my = y + h * (motes.trail ? 0.45 : 0.15 + 0.6 * this.host.rand());
          this.host.puff(x, my, z, 1, mote);
        }
      }
      d.lastX = x;
      d.lastZ = z;
    }
  }

  private paintWards(world: IWorld): void {
    for (const w of this.wards) {
      if (w.entityId < 0) continue;
      const e = world.entities.get(w.entityId);
      if (!e || e.dead || !findAura(e, BEAST_THICKHIDE_WARD)) {
        w.entityId = -1;
        w.mesh.visible = false;
        continue;
      }
      const h = bossBodyHeight(e.templateId, e.scale || 1);
      w.mesh.position.set(e.pos.x, e.pos.y + h * 0.5, e.pos.z);
      w.mesh.rotation.y = e.facing;
      // The great cat is long: the shell runs nose to tail.
      w.mesh.scale.set(h * 0.75, h * 0.62, h * 1.25);
      w.mat.uniforms.uAlpha.value = wardShimmer(this.clock);
    }
  }

  private paintCord(world: IWorld, dt: number): void {
    const bm = this.bondMaster >= 0 ? world.entities.get(this.bondMaster) : undefined;
    const cat = this.bondJaguarId >= 0 ? world.entities.get(this.bondJaguarId) : undefined;
    if (
      !bm ||
      !cat ||
      bm.dead ||
      cat.dead ||
      !findAura(bm, BEAST_PACK_BOND) ||
      !findAura(cat, BEAST_PACK_BOND)
    ) {
      this.cord.hide();
      return;
    }
    const strength = bondCordStrength(Math.hypot(bm.pos.x - cat.pos.x, bm.pos.z - cat.pos.z));
    const from = this.tmpA.set(
      bm.pos.x,
      bm.pos.y + bossBodyHeight(bm.templateId, bm.scale || 1) * 0.6,
      bm.pos.z,
    );
    // The jaguar end ties to its collar's jade ring, over its shoulders.
    const ring = jaguarBondAnchor(cat.scale || 1);
    const to = this.tmpB.set(
      cat.pos.x + Math.sin(cat.facing) * ring.forward,
      cat.pos.y + ring.up,
      cat.pos.z + Math.cos(cat.facing) * ring.forward,
    );
    this.feet[0] = bm.pos.x;
    this.feet[1] = bm.pos.z;
    this.feet[2] = cat.pos.x;
    this.feet[3] = cat.pos.z;
    this.cord.show(from, to, this.feet, strength, dt);
  }

  // ------------------------------------------------------------------- events

  /** True when the event is one of the three bosses' (drawn here). */
  handleEvent(ev: Extract<SimEvent, { type: 'spellfx' }>, src: Entity): boolean {
    return playBasinBossBurst(this.host, ev, src, this.world.entities.get(ev.targetId), this);
  }

  bondJaguar(): Entity | undefined {
    const cat = this.bondJaguarId >= 0 ? this.world.entities.get(this.bondJaguarId) : undefined;
    return cat && !cat.dead ? cat : undefined;
  }

  lashYaw(casterId: number, fallback: number): number {
    // Read once: a later lash never painted must not borrow this line.
    const yaw = this.lashCaster === casterId ? this.lashYawLocked : fallback;
    this.lashCaster = -1;
    return yaw;
  }

  /** The kit style of a spec, in a reused object. */
  private styleOf(spec: BossCastSpec): { color: number; accent: number } {
    this.style.color = spec.color;
    this.style.accent = spec.accent;
    return this.style;
  }

  /** Out of the basin (a wipe, a leave): put every boss visual away. */
  hideAll(): void {
    for (const f of this.fans) {
      f.casterId = -1;
      f.group.visible = false;
    }
    for (const l of this.lanes) {
      l.casterId = -1;
      l.group.visible = false;
    }
    for (const c of this.charges) {
      c.casterId = -1;
      c.mesh.visible = false;
      c.halo.visible = false;
    }
    for (const p of this.pods) {
      p.objectId = -1;
      p.body.visible = false;
      p.glow.visible = false;
    }
    for (const g of this.glyphs) {
      g.objectId = -1;
      g.disc.visible = false;
      g.halo.visible = false;
      g.shaft.visible = false;
    }
    for (const s of this.seeds) {
      s.alive = false;
      s.body.visible = false;
      s.glow.visible = false;
    }
    for (const m of this.marks) {
      m.entityId = -1;
      m.sprite.visible = false;
      m.ring.visible = false;
    }
    for (const d of this.dresses) {
      d.entityId = -1;
      d.sprite.visible = false;
    }
    for (const w of this.wards) {
      w.entityId = -1;
      w.mesh.visible = false;
    }
    this.cord.hide();
    this.lashCaster = -1;
  }

  /** A pod's spot, while drawn or just gone (the sim drops it the tick its
   *  burst fires); else where `fallback` stands. */
  podSpot(podId: number, fallback: Entity): { x: number; z: number } {
    for (const p of this.pods) if (p.lastId === podId) return { x: p.x, z: p.z };
    return { x: fallback.pos.x, z: fallback.pos.z };
  }

  launchSeed(
    from: { x: number; y: number; z: number },
    target: Entity,
    spit: boolean,
    delay: number,
  ): void {
    const s = this.seeds.find((x) => !x.alive) ?? this.seeds[0];
    s.alive = true;
    s.spit = spit;
    // A delayed launch (the spit's glob) waits unseen at the maw.
    s.born = this.clock + Math.max(0, delay);
    s.flight = spit ? SPIT_FLIGHT_SECONDS : SEED_FLIGHT_SECONDS;
    s.targetId = target.id;
    s.from.set(from.x, from.y, from.z);
    const th =
      target.kind === 'object' ? 0.4 : bossBodyHeight(target.templateId, target.scale || 1) * 0.5;
    const ty =
      target.kind === 'object' ? this.host.groundY(target.pos.x, target.pos.z) : target.pos.y;
    s.to.set(target.pos.x, ty + th, target.pos.z);
    const d = Math.hypot(s.to.x - s.from.x, s.to.z - s.from.z);
    s.apex = spit ? 0.8 : 3 + d * 0.3;
    s.body.visible = false;
    s.body.scale.setScalar(0.9);
    s.glow.visible = false;
    s.glow.scale.setScalar(spit ? 1.4 : 1.8);
    s.glowMat.color.setHex(spit ? 0x9cff4a : 0xff5a3a);
    // A pod already claimed waits for its seed to land.
    for (const p of this.pods) if (p.objectId === target.id) p.landAt = s.born + s.flight;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.cord.dispose();
  }
}

function fansPush(fans: FanSlot[], fan: TelegraphFan): void {
  fans.push({ ...fan, casterId: -1, castId: '' });
}

/** The entity's aura of id `id` (a loop: no per-frame closure). */
function findAura(
  e: { auras?: readonly { id: string; value2?: number }[] },
  id: string,
): { id: string; value2?: number } | undefined {
  const auras = e.auras;
  if (!auras) return undefined;
  for (let i = 0; i < auras.length; i++) if (auras[i].id === id) return auras[i];
  return undefined;
}
