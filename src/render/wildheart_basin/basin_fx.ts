// The Wildheart Basin's encounter visuals (plan: basin_fx_core.ts):
//  - floor telegraphs filling with their bars: the Great Saurian's Tail Swipe
//    (a rear cone, orange) and Earthshaking Stomp (the ring, violet), the Vine
//    Lasher's Entangling Lash (a lane locked at the bar's start, violet), a
//    kick glyph under every Ancestral Sap;
//  - the Spore Burst cloud: its edge drawn on the floor for as long as it
//    stands, filled by a sickly yellow-green fog of spores boiling inside it;
//  - the Stomp's ground shock (a ring racing out, dust and spray thrown up,
//    the camera shaken), the Tail Swipe's sweep of dust and water, the howdah
//    bursting off the Saurian's back (splinters, torn red banners, a flash),
//    the Saurian's enrage (a red glow breathing round it, steam off its back);
//  - the Sunbone Totem's green-gold pulse rings, the Ancestral Sap's channel
//    beam from the Hexcaller to its patient, thorny vines climbing a rooted
//    player, and the streak a Basin Raptor leaves as it Pounces;
//  - the ford's foam round the Saurian's legs (the water's wader uniform) and
//    the jaguar's eyes burning while Zulgar fights.
// Every telegraph is the shared floor telegraph kit (../floor_telegraph).
// The three bosses' visuals are their own module (basin_boss_fx.ts), composed
// here: it draws under this root, on this kit, through these pools.
//
// Rules (src/render/CLAUDE.md): pooled geometry and materials built once,
// attached through the compile gate, no per-frame allocation in the pools.
// The telegraphs are ACTIONABLE: their footprint draws on every tier; the
// particles, rings and glows are cosmetic and thin on the low tier. All state
// comes from IWorld entities and events, so offline and online look the same.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import {
  BLOOM_GORGE,
  BLOOM_POLLINATE,
  BLOOM_SEED_RAIN,
  BLOOM_SEED_SPROUT,
  BLOOM_SPIT,
  BLOOM_VINE_LASH,
  GORGEBLOOM_ID,
  GREAT_SAURIAN_ID,
  SAURIAN_ENRAGE,
  SAURIAN_HOWDAH_BREAK,
  SAURIAN_RIDER_LANDS,
  SAURIAN_STOMP,
  SAURIAN_TAIL_SWIPE,
  ZULGAR_AVATAR,
  ZULGAR_ID,
  ZULGAR_VANISHED,
} from '../../sim/encounters/wildheart_basin/ids';
import {
  WILDHEART_ANCESTRAL_SAP,
  WILDHEART_ENTANGLING_LASH,
  WILDHEART_POUNCE,
  WILDHEART_SPORE_BURST,
  WILDHEART_TOTEM_PULSE,
} from '../../sim/mob/trash_kit/wildheart_cast_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { ZULGAR_HIDE_GESTURE, ZULGAR_SHOW_GESTURE } from '../characters/wildheart_creature_looks';
import { type TelegraphFan, TelegraphKit, type TelegraphLane } from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX, surfaceMat } from '../gfx';
import {
  DUST_FRAG,
  GLOW_FRAG,
  PARTICLE_VERT,
  ParticlePool,
  type ParticleSpec,
} from '../hollow_crypt/crypt_fx_particles';
import { setRenderCategory } from '../renderer_diagnostics';
import { radialGlowTexture } from '../textures';
import { BasinBossFx } from './basin_boss_fx';
import { shockRingLook } from './basin_boss_fx_core';
import {
  BASIN_OBJECT_SPECS,
  type BasinPuffOptions,
  type BasinTelegraphSpec,
  basinCastFill,
  basinTelegraphSpecs,
  cloudPresence,
  enrageGlow,
  entangleGrowth,
  jaguarEyesBurn,
  objectFill,
  POUNCE_TRAIL_SECONDS,
  SAURIAN_DRAW,
  saurianBackPoint,
  TOTEM_PULSE_SECONDS,
  totemPulse,
  VINE_ROOT_AURAS,
  waderRadius,
} from './basin_fx_core';
import type { BasinFxHost } from './basin_fx_host';
import { setBasinJaguarEyesBurn } from './basin_kit';
import { BasinSplash } from './basin_splash';
import { BasinThorns } from './basin_thorns';
import { BASIN_WATER_WADERS } from './basin_water';
import { GorgebloomFx } from './gorgebloom_fx';
import { LasherFx } from './lasher_fx';
import { setBasinMawGlow } from './maw_glow';
import { isBasinMawPortal, mawGlowStrength, stepMawGlow } from './maw_glow_core';
import { SaurianFx } from './saurian_fx';
import { ZulgarAvatarFx } from './zulgar_avatar_fx';

const CAST_SLOTS = 10;
const LANE_SLOTS = 4;
/** Spore clouds plus the bosses' objects: about 12 seedpods, the 6 sun
 *  glyphs and the Ambush circle. */
const CLOUD_SLOTS = 24;
const RING_SLOTS = 16;
const BEAM_SLOTS = 4;
const VINE_SLOTS = 8;
const ENRAGE_SLOTS = 2;
const SCAN_SEC = 0.1;

interface CastSlot extends TelegraphFan {
  casterId: number;
  castId: string;
}
interface LaneSlot extends TelegraphLane {
  casterId: number;
}
interface CloudSlot extends TelegraphFan {
  objectId: number;
  /** The template its look was laid for (a pod ripens, a glyph goes dark). */
  templateId: string;
  since: number;
  emit: number;
  /** Where it was last draped (an object that stays put drapes once). */
  drapedX: number;
  drapedZ: number;
  drapedR: number;
}
interface Ring {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  born: number;
  kind: 'pulse' | 'shock';
  /** A shock's reach (yards) and span (seconds). */
  radius: number;
  span: number;
  alive: boolean;
}
interface Beam {
  mesh: THREE.Mesh;
  casterId: number;
}
interface VineSlot {
  mesh: THREE.Mesh;
  glow: THREE.Sprite;
  entityId: number;
  since: number;
}
interface EnrageSlot {
  sprite: THREE.Mesh;
  entityId: number;
}

const RING_VERT = /* glsl */ `
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** A shockwave: a hot leading edge, a broken dusty wake behind it. */
const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uSeed;
varying vec3 vLocal;
float h(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float r = length(vLocal.xz);
  float a = atan(vLocal.z, vLocal.x);
  float lead = smoothstep(0.8, 0.96, r) * (1.0 - smoothstep(0.96, 1.0, r));
  float broken = 0.65 + 0.35 * h(floor(a * 9.0) + uSeed);
  float wake = smoothstep(0.35, 0.95, r) * 0.28 * step(r, 1.0);
  gl_FragColor = vec4(uColor * (1.0 + lead * 1.2), (lead * broken + wake) * uAlpha);
}
`;

const BEAM_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** The Ancestral Sap: amber-green life flowing from the caster to its patient. */
const BEAM_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
void main() {
  float flow = fract(vUv.y * 4.0 - uTime * 2.2);
  float pulse = smoothstep(0.0, 0.2, flow) * (1.0 - smoothstep(0.35, 0.6, flow));
  float edge = 1.0 - abs(vUv.x - 0.5) * 2.0;
  vec3 col = mix(vec3(0.55, 0.9, 0.35), vec3(1.0, 0.85, 0.4), pulse);
  float a = (0.35 + pulse * 0.9) * edge;
  gl_FragColor = vec4(col * a, 1.0);
}
`;

export class WildheartFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly specs = basinTelegraphSpecs();
  private readonly casts: CastSlot[] = [];
  private readonly lanes: LaneSlot[] = [];
  private readonly clouds: CloudSlot[] = [];
  private readonly rings: Ring[] = [];
  private readonly beams: Beam[] = [];
  private readonly vines: VineSlot[] = [];
  private readonly enrages: EnrageSlot[] = [];
  private readonly trails = new Map<number, number>();
  private readonly kit: TelegraphKit;
  private readonly boss: BasinBossFx | null;
  /** The Great Saurian's body: its water, its howdah, its clips. */
  private readonly saurian: SaurianFx | null;
  /** The Gorgebloom's body: its maw, sacs, lash and death, its clips' gestures. */
  private readonly gorgebloom: GorgebloomFx | null;
  /** The Snarlvine Lashers' Entangling Lash on their Blender bodies. */
  private readonly lasher: LasherFx;
  /** The shared crowns and ripples. */
  private readonly splash: BasinSplash;
  /** The shared thorn spikes. */
  private readonly thorns: BasinThorns;
  /** Zulgar's jade spirit jaguar while he hunts. */
  private readonly avatar: ZulgarAvatarFx | null;
  /** Zulgar's model is hidden (heroic Ambush's vanish). */
  private zulgarHidden = false;
  private readonly smoke: ParticlePool;
  private readonly glow: ParticlePool;
  private readonly uTime = { value: 0 };
  private readonly density: number;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly waders: Entity[] = [];
  private readonly spec: ParticleSpec = {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 1,
    size0: 1,
    size1: 1,
    r: 1,
    g: 1,
    b: 1,
    a: 1,
  };
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private seed = 0x3b11;
  private scan = 0;
  private clock = 0;
  private inBasin = false;
  private zulgarState: 'idle' | 'fight' | 'hunt' = 'idle';
  /** The way out stands open in the jaguar's maw, and its glow's level. */
  private mawOpen = false;
  private mawLevel = 0;
  /** The boss layer drew last frame (put away once on leaving the basin). */
  private bossShown = false;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    private readonly shake?: (amount: number) => void,
    private readonly playGesture?: (entityId: number, gesture: string) => void,
  ) {
    this.root.name = 'wildheart-basin-fx';
    setRenderCategory(this.root, 'ui3d');
    const flashesOn =
      resolveUiEffectsProfile({ presetLabel: GFX.tier, effectsQuality: 1, reduceMotion: false })
        .tier !== 'low';
    this.density = flashesOn ? 1 : 0.4;
    this.kit = new TelegraphKit(this.root, flashesOn);
    for (let i = 0; i < CAST_SLOTS; i++)
      this.casts.push({ ...this.kit.fan(18), casterId: -1, castId: '' });
    for (let i = 0; i < LANE_SLOTS; i++) this.lanes.push({ ...this.kit.lane(17), casterId: -1 });
    for (let i = 0; i < CLOUD_SLOTS; i++)
      this.clouds.push({
        ...this.kit.fan(16),
        objectId: -1,
        templateId: '',
        since: 0,
        emit: 0,
        drapedX: Number.NaN,
        drapedZ: Number.NaN,
        drapedR: 0,
      });
    const particleMat = (frag: string, blending: THREE.Blending) => {
      const m = new THREE.ShaderMaterial({
        name: 'wildheartFxParticles',
        uniforms: { uTime: this.uTime },
        vertexShader: PARTICLE_VERT,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending,
      });
      this.materials.push(m);
      return m;
    };
    this.smoke = new ParticlePool(
      Math.round(1300 * this.density) + 120,
      particleMat(DUST_FRAG, THREE.NormalBlending),
      floorVfxRenderOrder('encounter', 6),
    );
    this.glow = new ParticlePool(
      Math.round(1300 * this.density) + 120,
      particleMat(GLOW_FRAG, THREE.AdditiveBlending),
      floorVfxRenderOrder('encounter', 8),
    );
    for (const pool of [this.smoke, this.glow]) {
      this.geometries.push(pool.mesh.geometry);
      this.root.add(pool.mesh);
    }
    // Shock and pulse rings.
    const ringGeo = new THREE.CircleGeometry(1, 72).rotateX(-Math.PI / 2);
    this.geometries.push(ringGeo);
    for (let i = 0; i < RING_SLOTS; i++) {
      const mat = new THREE.ShaderMaterial({
        name: 'wildheartFxRing',
        uniforms: {
          uColor: { value: new THREE.Color() },
          uAlpha: { value: 0 },
          uSeed: { value: i * 7.1 },
        },
        vertexShader: RING_VERT,
        fragmentShader: RING_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 4);
      this.root.add(mesh);
      this.rings.push({ mesh, mat, born: 0, kind: 'pulse', radius: 0, span: 1, alive: false });
    }
    // The sap beams: a cylinder along +y, oriented each frame.
    const beamGeo = new THREE.CylinderGeometry(0.16, 0.16, 1, 8, 1, true).translate(0, 0.5, 0);
    this.geometries.push(beamGeo);
    const beamMat = new THREE.ShaderMaterial({
      name: 'wildheartSapBeam',
      uniforms: { uTime: this.uTime },
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.materials.push(beamMat);
    for (let i = 0; i < BEAM_SLOTS; i++) {
      const mesh = new THREE.Mesh(beamGeo, beamMat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.root.add(mesh);
      this.beams.push({ mesh, casterId: -1 });
    }
    // Thorny vines coiling up a rooted player's legs.
    const vineGeo = entangleGeometry();
    this.geometries.push(vineGeo);
    const vineMat = surfaceMat({ color: 0x3f5a22, roughness: 0.85, emissive: 0x0c1a04 });
    const vineGlowMat = new THREE.SpriteMaterial({
      map: radialGlowTexture(),
      color: 0xb67bff,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      name: 'wildheartEntangleGlow',
    });
    this.materials.push(vineGlowMat);
    for (let i = 0; i < VINE_SLOTS; i++) {
      const mesh = new THREE.Mesh(vineGeo, vineMat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      const glow = new THREE.Sprite(vineGlowMat);
      glow.visible = false;
      glow.scale.set(3, 1.4, 1);
      this.root.add(mesh, glow);
      this.vines.push({ mesh, glow, entityId: -1, since: 0 });
    }
    // The enrage's breathing red glow, pooled flat on the water round it.
    const enrageMat = new THREE.MeshBasicMaterial({
      map: radialGlowTexture(),
      color: 0xff3a24,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      name: 'wildheartEnrageGlow',
    });
    this.materials.push(enrageMat);
    const enrageGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.geometries.push(enrageGeo);
    for (let i = 0; i < ENRAGE_SLOTS; i++) {
      const sprite = new THREE.Mesh(enrageGeo, enrageMat);
      sprite.visible = false;
      sprite.renderOrder = floorVfxRenderOrder('encounter', 1);
      this.root.add(sprite);
      this.enrages.push({ sprite, entityId: -1 });
    }
    this.splash = new BasinSplash(this.root);
    this.thorns = new BasinThorns(
      this.root,
      (x, z) => this.groundY(x, z),
      () => this.rand(),
    );
    // The three bosses: built under this root before the gated attach.
    this.boss = world ? new BasinBossFx(this.bossHost(), world) : null;
    this.saurian = world ? new SaurianFx(this.bossHost(), world, playGesture) : null;
    this.lasher = new LasherFx(this.bossHost());
    const boss = this.boss;
    this.gorgebloom = world
      ? new GorgebloomFx(this.bossHost(), world, playGesture, (id, fallback) =>
          boss ? boss.lashYaw(id, fallback) : fallback,
        )
      : null;
    this.avatar = world ? new ZulgarAvatarFx(scene, this.bossHost(), world, compileGate) : null;
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  /** What the boss layer borrows: this root, kit, pools and rings. */
  private bossHost(): BasinFxHost {
    return {
      root: this.root,
      kit: this.kit,
      density: this.density,
      uTime: this.uTime,
      groundY: (x, z) => this.groundY(x, z),
      puff: (x, y, z, n, o) => this.puff(x, y, z, n, o),
      shockRing: (x, z, color, radius, seconds) => this.shockRing(x, z, color, radius, seconds),
      rand: () => this.rand(),
      reducedMotion: () => this.reducedMotion(),
      shake: (amount) => this.shake?.(amount),
      splash: this.splash,
      thorns: this.thorns,
    };
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  // ---------------------------------------------------------------- particles

  private puff(x: number, y: number, z: number, n: number, o: BasinPuffOptions): void {
    if (this.reducedMotion() && n > 4) n = Math.ceil(n / 3);
    const pool = o.glow ? this.glow : this.smoke;
    const count = Math.max(1, Math.round(n * this.density));
    const s = this.spec;
    for (let i = 0; i < count; i++) {
      const a = this.rand() * Math.PI * 2;
      const e = (this.rand() - 0.5) * 2;
      let vx = Math.cos(a) * Math.sqrt(1 - e * e);
      let vy = e;
      let vz = Math.sin(a) * Math.sqrt(1 - e * e);
      if (o.dir) {
        const k = o.spread ?? 0.35;
        vx = o.dir[0] + vx * k;
        vy = o.dir[1] + vy * k;
        vz = o.dir[2] + vz * k;
      }
      const sp = o.speed * (0.55 + this.rand() * 0.9);
      const r = o.radius ? Math.sqrt(this.rand()) * o.radius : 0;
      const ra = this.rand() * Math.PI * 2;
      s.x = x + Math.cos(ra) * r;
      s.y = y;
      s.z = z + Math.sin(ra) * r;
      s.vx = vx * sp;
      s.vy = vy * sp + (o.up ?? 0);
      s.vz = vz * sp;
      s.ax = 0;
      s.ay = -(o.gravity ?? 0);
      s.az = 0;
      s.life = o.life * (0.7 + this.rand() * 0.6);
      s.drag = o.drag ?? 1.2;
      s.floor = y - 0.5;
      s.size0 = o.size[0];
      s.size1 = o.size[1];
      s.spin = (this.rand() - 0.5) * 2;
      s.seed = this.rand();
      s.r = o.color[0];
      s.g = o.color[1];
      s.b = o.color[2];
      s.a = o.alpha;
      pool.emit(this.clock, s);
    }
  }

  private ring(kind: Ring['kind'], x: number, z: number, color: number): Ring {
    const slot = this.rings.find((r) => !r.alive) ?? this.rings[0];
    slot.alive = true;
    slot.kind = kind;
    slot.born = this.clock;
    slot.radius = 0;
    slot.span = TOTEM_PULSE_SECONDS;
    (slot.mat.uniforms.uColor.value as THREE.Color).setHex(color);
    slot.mesh.position.set(x, this.groundY(x, z) + 0.14, z);
    slot.mesh.visible = true;
    return slot;
  }

  /** A shock ring racing out to `radius` over `seconds` (the bosses' bursts). */
  private shockRing(x: number, z: number, color: number, radius: number, seconds: number): void {
    const slot = this.ring('shock', x, z, color);
    slot.radius = radius;
    slot.span = seconds;
  }

  // ------------------------------------------------------------------- events

  /** True when the event is one of the basin's own (the renderer then skips
   *  its generic draw of it). */
  handleEvent(ev: SimEvent): boolean {
    if (ev.type !== 'spellfx' || !this.world || this.disposed) return false;
    const ability = ev.ability;
    if (!ability) return false;
    const src = this.world.entities.get(ev.sourceId);
    if (!src) return false;
    const { x, z } = src.pos;
    const gy = this.groundY(x, z);
    switch (ability) {
      case SAURIAN_STOMP:
      case SAURIAN_TAIL_SWIPE:
      case SAURIAN_HOWDAH_BREAK:
      case SAURIAN_ENRAGE:
      case SAURIAN_RIDER_LANDS:
        return this.saurian?.handleEvent(ev, src) ?? false;
      // The Gorgebloom's body beats; the seeds and the spit's glob are still
      // the boss layer's (they land on its pods and slots).
      case BLOOM_POLLINATE:
      case BLOOM_VINE_LASH:
      case BLOOM_GORGE:
      case BLOOM_SEED_SPROUT:
        return this.gorgebloom?.handleEvent(ev, src) ?? false;
      case WILDHEART_ENTANGLING_LASH:
        return this.lasher.handleEvent(ev, src);
      case BLOOM_SEED_RAIN:
      case BLOOM_SPIT:
        this.gorgebloom?.handleEvent(ev, src);
        return this.boss?.handleEvent(ev, src) ?? false;
      case WILDHEART_TOTEM_PULSE: {
        this.ring('pulse', x, z, 0xb8e070);
        this.puff(x, gy + 1.5, z, 10, {
          speed: 1.2,
          up: 2.5,
          life: 1.4,
          size: [0.5, 0.2],
          color: [0.7, 1, 0.5],
          alpha: 0.9,
          glow: true,
          radius: 2,
        });
        return true;
      }
      case WILDHEART_SPORE_BURST: {
        this.puff(x, gy + 1, z, 40, {
          speed: 5,
          up: 1,
          life: 1.6,
          size: [1.6, 4],
          color: [0.78, 0.82, 0.3],
          alpha: 0.8,
          drag: 2,
        });
        return true;
      }
      case WILDHEART_POUNCE:
        this.trails.set(src.id, this.clock + POUNCE_TRAIL_SECONDS);
        return false;
      default:
        this.avatar?.handleEvent(ev);
        return this.boss?.handleEvent(ev, src) ?? false;
    }
  }

  // ------------------------------------------------------------------- frame

  update(dt: number): void {
    const world = this.world;
    if (!world || this.disposed) return;
    this.clock += dt;
    this.uTime.value = this.clock;
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = SCAN_SEC;
      this.scanWorld(world);
    }
    if (!this.inBasin) {
      // Out of the basin: no wake lingers on the shared water, and no boss
      // mark or telegraph stays frozen where the fight left it.
      for (const w of BASIN_WATER_WADERS.value) w.w = 0;
      // The maw's glow is shared by every build of the basin: dark for the next run.
      if (this.mawLevel > 0) {
        this.mawLevel = 0;
        setBasinMawGlow(0);
      }
      if (this.bossShown) {
        this.bossShown = false;
        this.boss?.hideAll();
        this.saurian?.hideAll();
        this.gorgebloom?.hideAll();
        this.lasher.hideAll();
        this.splash.hideAll();
        this.thorns.hideAll();
        this.avatar?.hide();
      }
      // A thorn wave still standing as the basin is left sinks on its clock.
      this.thorns.update(this.clock);
      this.smoke.update(this.clock);
      this.glow.update(this.clock);
      return;
    }
    this.mawLevel = stepMawGlow(this.mawLevel, this.mawOpen, dt);
    setBasinMawGlow(mawGlowStrength(this.mawLevel, this.clock));
    this.paintCasts(world);
    this.paintLanes(world);
    this.paintClouds(world, dt);
    this.paintRings();
    this.paintBeams(world);
    this.paintVines(world);
    this.paintEnrage(world, dt);
    this.paintTrails(world, dt);
    this.paintWaders();
    this.bossShown = true;
    this.boss?.update(dt, this.clock);
    this.saurian?.update(dt, this.clock);
    this.gorgebloom?.update(dt, this.clock);
    this.lasher.update(this.clock);
    this.splash.update(this.clock);
    this.thorns.update(this.clock);
    this.avatar?.update(dt);
    setBasinJaguarEyesBurn(jaguarEyesBurn(this.zulgarState, this.clock));
    this.smoke.update(this.clock);
    this.glow.update(this.clock);
  }

  private castSpec(castId: string): BasinTelegraphSpec | undefined {
    return this.specs[castId];
  }

  private paintCasts(world: IWorld): void {
    for (const slot of this.casts) {
      if (slot.casterId < 0) continue;
      const caster = world.entities.get(slot.casterId);
      const spec = this.castSpec(slot.castId);
      if (!caster || caster.dead || caster.castingAbility !== slot.castId || !spec) {
        slot.casterId = -1;
        slot.group.visible = false;
        continue;
      }
      const fill = basinCastFill(caster.castRemaining, caster.castTotal);
      const yaw = spec.shape === 'sigil' ? this.clock * 1.4 : caster.facing + spec.yawOffset;
      // From the body's centre: the edge the sim tests (the Tail Swipe's rear
      // cone included; its yaw offset turns it behind).
      const x = caster.pos.x;
      const z = caster.pos.z;
      this.kit.drapeFan(slot, this.groundY, x, this.groundY(x, z), z, yaw, spec.range);
      this.kit.paintFan(slot, { fill, clock: this.clock, range: spec.range });
    }
  }

  private paintLanes(world: IWorld): void {
    for (const slot of this.lanes) {
      if (slot.casterId < 0) continue;
      const caster = world.entities.get(slot.casterId);
      const spec = this.castSpec(caster?.castingAbility ?? '');
      if (!caster || caster.dead || !spec || spec.shape !== 'lane') {
        slot.casterId = -1;
        slot.group.visible = false;
        continue;
      }
      const x = caster.pos.x;
      const z = caster.pos.z;
      this.kit.drapeLane(
        slot,
        this.groundY,
        x,
        this.groundY(x, z),
        z,
        caster.facing,
        spec.range,
        spec.halfWidth ?? 1,
        { color: spec.color, accent: spec.accent },
      );
      const fill = basinCastFill(caster.castRemaining, caster.castTotal);
      this.kit.paintLane(slot, { fill, clock: this.clock, range: spec.range });
    }
  }

  private paintClouds(world: IWorld, dt: number): void {
    for (const slot of this.clouds) {
      if (slot.objectId < 0) continue;
      const obj = world.entities.get(slot.objectId);
      const spec = obj ? BASIN_OBJECT_SPECS[obj.templateId] : undefined;
      if (!obj || !spec) {
        slot.objectId = -1;
        slot.group.visible = false;
        continue;
      }
      if (obj.templateId !== slot.templateId) {
        // Its template flipped in place (a pod ripening, a glyph going dark):
        // re-lay its look and restart its sweep.
        this.kit.layOutFan(slot, 360, { color: spec.color, accent: spec.accent });
        slot.templateId = obj.templateId;
        slot.since = this.clock;
        slot.drapedX = Number.NaN;
      }
      const radius = obj.scale;
      const x = obj.pos.x;
      const z = obj.pos.z;
      const gy = this.groundY(x, z);
      const elapsed = this.clock - slot.since;
      const presence = cloudPresence(elapsed, spec.seconds);
      if (x !== slot.drapedX || z !== slot.drapedZ || radius !== slot.drapedR) {
        this.kit.drapeFan(slot, this.groundY, x, gy, z, 0, radius);
        slot.drapedX = x;
        slot.drapedZ = z;
        slot.drapedR = radius;
      }
      // A standing hazard draws its edge full from its first tick; a ripe pod
      // and the Ambush circle sweep over the seconds they leave; a pod or a
      // glyph is a tint and a rim (a spot to use).
      this.kit.paintFan(slot, {
        fill: objectFill(spec, elapsed),
        clock: this.clock,
        range: radius,
        fade: presence * spec.fade,
      });
      if (!spec.fog) continue;
      // The fog of spores boiling inside its edge (cosmetic).
      slot.emit += dt * 26 * this.density;
      while (slot.emit >= 1) {
        slot.emit -= 1;
        this.puff(x, gy + 0.4, z, 1, {
          speed: 0.6,
          up: 0.7,
          life: 2.4,
          size: [1.4, radius * 0.9],
          color: [0.62, 0.72, 0.18],
          alpha: 0.5 * presence,
          radius: radius * 0.85,
          drag: 2,
        });
      }
    }
  }

  private paintRings(): void {
    for (const r of this.rings) {
      if (!r.alive) continue;
      const elapsed = this.clock - r.born;
      if (elapsed > r.span) {
        r.alive = false;
        r.mesh.visible = false;
        continue;
      }
      const look =
        r.kind === 'pulse' ? totemPulse(elapsed) : shockRingLook(elapsed, r.radius, r.span);
      r.mesh.scale.setScalar(Math.max(0.01, look.radius));
      r.mat.uniforms.uAlpha.value = look.alpha;
    }
  }

  private paintBeams(world: IWorld): void {
    for (const b of this.beams) {
      if (b.casterId < 0) continue;
      const caster = world.entities.get(b.casterId);
      const target =
        caster?.castTargetId !== null && caster?.castTargetId !== undefined
          ? world.entities.get(caster.castTargetId)
          : undefined;
      if (!caster || caster.dead || caster.castingAbility !== WILDHEART_ANCESTRAL_SAP || !target) {
        b.casterId = -1;
        b.mesh.visible = false;
        continue;
      }
      const from = this.tmpA.set(
        caster.pos.x,
        caster.pos.y + 2.6 * (caster.scale || 1) * 0.6,
        caster.pos.z,
      );
      const to = this.tmpB.set(
        target.pos.x,
        target.pos.y + 1.6 * (target.scale || 1),
        target.pos.z,
      );
      const len = from.distanceTo(to);
      to.sub(from).normalize();
      b.mesh.position.copy(from);
      b.mesh.quaternion.setFromUnitVectors(this.up, to);
      b.mesh.scale.set(1, Math.max(0.01, len), 1);
      b.mesh.visible = true;
    }
  }

  private paintVines(world: IWorld): void {
    for (const v of this.vines) {
      if (v.entityId < 0) continue;
      const e = world.entities.get(v.entityId);
      if (!e || e.dead || !vineRooted(e)) {
        v.entityId = -1;
        v.mesh.visible = false;
        v.glow.visible = false;
        continue;
      }
      const g = entangleGrowth(this.clock - v.since);
      v.mesh.position.set(e.pos.x, e.pos.y, e.pos.z);
      v.mesh.rotation.y = this.clock * 0.4;
      v.mesh.scale.set(1, Math.max(0.02, g), 1);
      v.glow.position.set(e.pos.x, e.pos.y + 0.25, e.pos.z);
    }
  }

  private paintEnrage(world: IWorld, dt: number): void {
    for (const s of this.enrages) {
      if (s.entityId < 0) continue;
      const e = world.entities.get(s.entityId);
      if (!e || e.dead || !hasAura(e, SAURIAN_ENRAGE)) {
        s.entityId = -1;
        s.sprite.visible = false;
        continue;
      }
      const scale = e.scale || 1;
      const k = enrageGlow(this.clock);
      const h = SAURIAN_DRAW.height * scale;
      // A blood-red glow pooled on the water round its feet (never a card
      // standing through its body), embers and red steam boiling off its back.
      s.sprite.position.set(e.pos.x, this.groundY(e.pos.x, e.pos.z) + 0.4, e.pos.z);
      s.sprite.rotation.y = e.facing;
      s.sprite.scale.set(h * 1.1 * k, 1, h * 2.1 * k);
      if (this.rand() < dt * 14) {
        const [bx, by, bz] = saurianBackPoint(e.pos, scale);
        this.puff(bx, by, bz, 2, {
          speed: 1.2,
          up: 2.6,
          life: 1.9,
          size: [1.6, 4.8],
          color: [0.85, 0.24, 0.18],
          alpha: 0.32,
          radius: h * 0.28,
        });
        this.puff(bx, by - h * 0.15, bz, 3, {
          speed: 1.6,
          up: 3.4,
          life: 1.4,
          size: [0.28, 0.08],
          color: [1, 0.42, 0.18],
          alpha: 1,
          radius: h * 0.32,
          glow: true,
        });
      }
    }
  }

  private paintTrails(world: IWorld, dt: number): void {
    for (const [id, until] of this.trails) {
      const e = world.entities.get(id);
      if (!e || e.dead || this.clock > until) {
        this.trails.delete(id);
        continue;
      }
      if (this.rand() < dt * 50) {
        this.puff(e.pos.x, e.pos.y + 1.2, e.pos.z, 1, {
          speed: 0.4,
          life: 0.45,
          size: [1.4, 0.3],
          color: [0.85, 1, 0.45],
          alpha: 0.75,
          glow: true,
        });
        this.puff(e.pos.x, e.pos.y + 0.6, e.pos.z, 1, {
          speed: 0.6,
          life: 0.8,
          size: [1, 2.4],
          color: [0.6, 0.55, 0.4],
          alpha: 0.4,
        });
      }
    }
  }

  private paintWaders(): void {
    const slots = BASIN_WATER_WADERS.value;
    for (let i = 0; i < slots.length; i++) {
      const e = this.waders[i];
      if (!e || e.dead) {
        slots[i].w = 0;
        continue;
      }
      slots[i].set(e.pos.x, e.pos.z, waderRadius(e.templateId, e.scale || 1), 1);
    }
  }

  private scanWorld(world: IWorld): void {
    this.waders.length = 0;
    let basin = false;
    let zulgar: 'idle' | 'fight' | 'hunt' = 'idle';
    let maw = false;
    this.boss?.beginScan();
    this.saurian?.beginScan();
    this.gorgebloom?.beginScan();
    for (const e of world.entities.values()) {
      if (this.boss?.scanEntity(e)) basin = true;
      if (e.kind === 'player') {
        if (vineRooted(e)) this.claimVine(e);
        continue;
      }
      if (e.kind !== 'mob') {
        if (isBasinMawPortal(e)) maw = true;
        this.scanObject(e);
        continue;
      }
      if (e.templateId === GREAT_SAURIAN_ID) {
        basin = true;
        this.saurian?.scanSaurian(e);
        if (!e.dead && this.waders.length < 4) this.waders.push(e);
        if (!e.dead && hasAura(e, SAURIAN_ENRAGE)) this.claimEnrage(e);
      }
      if (e.templateId === GORGEBLOOM_ID) this.gorgebloom?.scanBloom(e);
      if (e.templateId === ZULGAR_ID) {
        basin = true;
        this.avatar?.setZulgar(e);
        this.syncZulgarHidden(e);
        if (!e.dead && e.inCombat) zulgar = hasAura(e, ZULGAR_AVATAR) ? 'hunt' : 'fight';
      }
      if (e.dead) continue;
      const castId = e.castingAbility;
      const spec = castId ? this.castSpec(castId) : undefined;
      if (!castId || !spec) continue;
      // A basin cast painting the floor means the party fights in the basin,
      // boss or no boss in view (a Snarlvine Lasher's lane far off the bosses).
      basin = true;
      if (castId === WILDHEART_ANCESTRAL_SAP) this.claimBeam(e);
      if (spec.shape === 'lane') {
        if (this.lanes.some((l) => l.casterId === e.id)) continue;
        const lane = this.lanes.find((l) => l.casterId < 0);
        if (!lane) continue;
        lane.casterId = e.id;
        lane.group.visible = true;
        continue;
      }
      if (this.casts.some((t) => t.casterId === e.id)) continue;
      const slot = this.casts.find((t) => t.casterId < 0);
      if (!slot) continue;
      this.kit.layOutFan(slot, spec.arcDeg, {
        color: spec.color,
        accent: spec.accent,
        sigil: spec.shape === 'sigil',
      });
      slot.casterId = e.id;
      slot.castId = castId;
      slot.group.visible = true;
    }
    this.saurian?.endScan();
    this.gorgebloom?.endScan();
    this.mawOpen = maw;
    this.inBasin =
      basin ||
      maw ||
      this.clouds.some((c) => c.objectId >= 0) ||
      this.lasher.busy() ||
      this.thorns.busy();
    this.zulgarState = zulgar;
  }

  private scanObject(e: Entity): void {
    const spec = BASIN_OBJECT_SPECS[e.templateId];
    if (!spec) return;
    if (this.clouds.some((c) => c.objectId === e.id)) return;
    const slot = this.clouds.find((c) => c.objectId < 0);
    if (!slot) return;
    this.kit.layOutFan(slot, 360, { color: spec.color, accent: spec.accent });
    slot.objectId = e.id;
    slot.templateId = e.templateId;
    slot.since = this.clock;
    slot.emit = 0;
    slot.drapedX = Number.NaN;
    slot.group.visible = true;
  }

  /** Heroic Ambush: his model is gone while the vanish holds (the nameplate
   *  and the floor circle still say where the fight is), back on the landing.
   *  Re-sent each scan while it holds, so a view rebuilt mid-vanish hides too. */
  private syncZulgarHidden(e: Entity): void {
    const hidden = !e.dead && hasAura(e, ZULGAR_VANISHED);
    if (hidden) this.playGesture?.(e.id, ZULGAR_HIDE_GESTURE);
    else if (this.zulgarHidden) this.playGesture?.(e.id, ZULGAR_SHOW_GESTURE);
    this.zulgarHidden = hidden;
  }

  private claimVine(e: Entity): void {
    if (this.vines.some((v) => v.entityId === e.id)) return;
    const v = this.vines.find((s) => s.entityId < 0);
    if (!v) return;
    v.entityId = e.id;
    v.since = this.clock;
    v.mesh.visible = true;
    v.glow.visible = true;
  }

  private claimBeam(e: Entity): void {
    if (this.beams.some((b) => b.casterId === e.id)) return;
    const b = this.beams.find((s) => s.casterId < 0);
    if (b) b.casterId = e.id;
  }

  private claimEnrage(e: Entity): void {
    if (this.enrages.some((s) => s.entityId === e.id)) return;
    const s = this.enrages.find((x) => x.entityId < 0);
    if (!s) return;
    s.entityId = e.id;
    s.sprite.visible = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const w of BASIN_WATER_WADERS.value) w.w = 0;
    // Best effort: one throwing release never strands the rest.
    const errors: unknown[] = [];
    const attempt = (release: () => void): void => {
      try {
        release();
      } catch (e) {
        errors.push(e);
      }
    };
    attempt(() => this.root.removeFromParent());
    attempt(() => this.kit.dispose());
    attempt(() => this.splash.dispose());
    attempt(() => this.thorns.dispose());
    if (this.boss) {
      const boss = this.boss;
      attempt(() => boss.dispose());
    }
    if (this.saurian) {
      const saurian = this.saurian;
      attempt(() => saurian.dispose());
    }
    if (this.gorgebloom) {
      const gorgebloom = this.gorgebloom;
      attempt(() => gorgebloom.dispose());
    }
    if (this.avatar) {
      const avatar = this.avatar;
      attempt(() => avatar.dispose());
    }
    for (const g of this.geometries) attempt(() => g.dispose());
    for (const m of this.materials) attempt(() => m.dispose());
    if (errors.length > 0) throw new AggregateError(errors, 'WildheartFx dispose');
  }
}

/** Is the entity held by a root the climbing vines dress (a loop). */
function vineRooted(e: { auras?: readonly { id: string }[] }): boolean {
  for (let i = 0; i < VINE_ROOT_AURAS.length; i++) if (hasAura(e, VINE_ROOT_AURAS[i])) return true;
  return false;
}

/** Does the entity carry the aura (a loop: no per-frame closure). */
function hasAura(e: { auras?: readonly { id: string }[] }, id: string): boolean {
  const auras = e.auras;
  if (!auras) return false;
  for (let i = 0; i < auras.length; i++) if (auras[i].id === id) return true;
  return false;
}

/** Thorny vines in a loose coil, 1.7 yd tall round a body (built once). */
function entangleGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) {
    const pts: THREE.Vector3[] = [];
    const phase = (k / 4) * Math.PI * 2;
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const a = phase + t * Math.PI * 2.4 * (k % 2 ? 1 : -1);
      const r = 0.62 - t * 0.2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, t * 1.7, Math.sin(a) * r));
    }
    parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.07, 5));
    for (let i = 2; i < 14; i += 3) {
      const p = pts[i];
      parts.push(
        new THREE.ConeGeometry(0.05, 0.28, 4)
          .rotateZ(Math.PI / 2)
          .rotateY(-Math.atan2(p.z, p.x))
          .translate(p.x * 1.15, p.y, p.z * 1.15),
      );
    }
  }
  const positions: number[] = [];
  const normals: number[] = [];
  for (const g0 of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    g0.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.computeBoundingSphere();
  return out;
}
