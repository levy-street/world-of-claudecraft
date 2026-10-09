// Morthen the Gravecaller's fight on the Rite Ring and the Knellwyrm's heroic
// Burning Knell (plan: morthen_rite_fx_core.ts; the sim:
// src/sim/encounters/hollow_crypt/morthen*.ts, knellwyrm_knell.ts). One gated
// root shared by five painters, each reading the sim's own state off IWorld
// (cast bars, facing, auras with their values, the encounter objects whose
// template carries their state) and its spellfx cues, so offline and online
// draw the same fight:
//
//   morthen_attack_fx.ts  the Shadow Pulse ring charging to its toll, the Reap
//                         the Unquiet cone and its scythe crescent, heroic
//                         Grasp of the Grave (the ring, then the hands).
//   morthen_ward_fx.ts    the Unquiet Ward cracking candle by candle, the
//                         Rite's swirl, the shattering, the Rite Broken, the
//                         Shattered exposure, Grave Chill's floor mist.
//   morthen_candle_fx.ts  the Remembrance Candles dark, named and relit, the
//                         Ledger's guiding beam, the relight's stream and the
//                         life drained out of the lighter, the ignite burst.
//   morthen_soul_fx.ts    the Bound Souls' ghost-fire spirits and wakes, the
//                         soul torn out of its alcove, his empowered surge.
//   knell_fx.ts           the Knellwyrm's marked half (red), its ghost fire
//                         pouring over the whole half, the scorch after.
//
// Rules (src/render/CLAUDE.md, hollow_crypt/CLAUDE.md): one root attached
// through the compile gate with every material present at construction (the
// root IS the prewarm home); pooled everything, no light (the candles' own
// lamps are the crypt lights', reached through rite_candle_decor.ts); GPU
// particles on the crypt kit (crypt_fx_particles.ts). Every telegraph and state
// a player acts on (the rings, the cone, the half, the ward, the candles' state
// and the Ledger's guide, the hands) draws on every tier; motes, mist, smoke
// and sparks shed on the low effects tier. Decoration never out-glows a
// telegraph: the mist and floor glows sit under the telegraph rungs.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import {
  KNELL_HALF_FIRE_TEMPLATE,
  KNELL_HALF_MARK_TEMPLATE,
  KNELLWYRM_ID,
  MORTHEN_ID,
} from '../../sim/encounters/hollow_crypt/ids';
import {
  isRiteCandleTemplate,
  MORTHEN_GRASP_HANDS_TEMPLATE,
  MORTHEN_GRASP_ROOT,
  MORTHEN_GRASP_TEMPLATE,
  MORTHEN_GRAVE_CHILL,
  MORTHEN_RELIGHT_CAST,
  MORTHEN_SOUL_TEMPLATE,
} from '../../sim/encounters/hollow_crypt/morthen_ids';
import type { SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { TelegraphKit } from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX } from '../gfx';
import { getFlameTex } from '../ignivar_fire_vfx';
import { setRenderCategory } from '../renderer_diagnostics';
import { cryptSlotOrigin } from './crypt_boss_fx_core';
import {
  DUST_FRAG,
  FIRE_FRAG,
  FIRE_VERT,
  GHOST_RAMP,
  GLOW_FRAG,
  PARTICLE_VERT,
  ParticlePool,
  type ParticleSpec,
} from './crypt_fx_particles';
import { KnellFx } from './knell_fx';
import { MorthenAttackFx } from './morthen_attack_fx';
import { MorthenCandleFx } from './morthen_candle_fx';
import { remembranceRampGlsl } from './morthen_rite_fx_core';
import {
  RITE_MESH_VERT,
  type RiteFxHost,
  type RiteGlowMesh,
  type RitePainter,
  type RiteScan,
} from './morthen_rite_host';
import { MorthenSoulFx } from './morthen_soul_fx';
import { MorthenWardFx } from './morthen_ward_fx';
import { RiteCandleDecor } from './rite_candle_decor';

const SCAN_SEC = 0.1;
const WAVES = 10;
const FLASHES = 10;

/** The fire shader burning the remembrance ramp (warm holy candle fire). */
const HOLY_FIRE_FRAG = FIRE_FRAG.replace(GHOST_RAMP, remembranceRampGlsl());

/** An expanding shockwave band on the floor, bright at its leading edge. */
const WAVE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uWidth;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float band = smoothstep(1.0 - uWidth, 1.0 - uWidth * 0.35, r) * (1.0 - smoothstep(0.97, 1.0, r));
  float wash = (1.0 - smoothstep(0.0, 1.0, r)) * 0.12;
  gl_FragColor = vec4(uColor * (0.8 + 1.4 * band), (band + wash) * uAlpha);
}
`;

/** A soft camera-facing glow (a flash, a candle's guide, a soul's heart). */
const HALO_VERT = /* glsl */ `
varying vec2 vUv;
${CAMERA_RELATIVE_GLSL}
void main() {
  vUv = uv;
  vec4 c = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float s = length(modelMatrix[0].xyz);
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 w = c.xyz + (camRight * position.x + camUp * position.y) * s;
  gl_Position = projectionMatrix * wocCamRelView(w);
}
`;
const HALO_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float core = pow(max(1.0 - r, 0.0), 2.2);
  float bloom = pow(max(1.0 - r, 0.0), 6.0);
  gl_FragColor = vec4(uColor * (0.9 + 1.4 * bloom), core * uAlpha);
}
`;

/** A beam: light flowing from its base (v 0) to its tip (v 1). */
const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
uniform float uFlow;
varying vec2 vUv;
void main() {
  float along = vUv.y;
  float streak = 0.55 + 0.45 * sin(along * 38.0 - uTime * uFlow * 11.0 + vUv.x * 6.2831);
  float pulse = 0.75 + 0.25 * sin(along * 7.0 - uTime * uFlow * 3.0);
  float ends = smoothstep(0.0, 0.05, along) * (1.0 - smoothstep(0.95, 1.0, along));
  gl_FragColor = vec4(uColor * (0.8 + 0.9 * streak), ends * (0.35 + 0.65 * streak) * pulse * uAlpha);
}
`;

/** A column of light rising out of the floor, fading as it climbs. */
const COLUMN_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
varying vec2 vUv;
void main() {
  float v = vUv.y;
  float rise = 0.6 + 0.4 * sin(v * 16.0 - uTime * 3.2 + vUv.x * 12.566);
  float fade = smoothstep(0.0, 0.04, v) * pow(max(1.0 - v, 0.0), 1.6);
  gl_FragColor = vec4(uColor * (0.9 + 0.7 * rise), fade * rise * uAlpha);
}
`;

interface Wave {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  born: number;
  span: number;
  reach: number;
  alive: boolean;
}

interface Flash {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  born: number;
  span: number;
  size: number;
  alive: boolean;
}

export class MorthenRiteFx implements RiteFxHost {
  readonly root = new THREE.Group();
  readonly kit: TelegraphKit;
  readonly fire: ParticlePool;
  readonly holy: ParticlePool;
  readonly glow: ParticlePool;
  readonly dust: ParticlePool;
  readonly mist: ParticlePool;
  readonly uTime = { value: 0 };
  readonly density: number;
  readonly low: boolean;
  readonly readyForEntry: Promise<void>;
  readonly decor: RiteCandleDecor;
  readonly scan: RiteScan = {
    morthenId: -1,
    wyrmId: -1,
    candles: [],
    grasps: [],
    knells: [],
    souls: [],
    lighters: [],
    rooted: [],
    chill: 0,
  };
  private readonly waves: Wave[] = [];
  private readonly flashes: Flash[] = [];
  private readonly painters: RitePainter[];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly beamGeo: THREE.BufferGeometry;
  private readonly columnGeo: THREE.BufferGeometry;
  private readonly haloGeo: THREE.BufferGeometry;
  private time = 0;
  private scanTimer = 0;
  /** Is the local player inside a Hollow Crypt claim (re-read twice a second)? */
  private inCrypt = false;
  private where = 0;
  private seed = 0x3a7f;
  private disposed = false;
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
  /** The compile gate settled (the root may show only after it). */
  private gateSettled = false;

  constructor(
    scene: THREE.Scene,
    readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    private readonly shake?: (amount: number) => void,
    private readonly playGesture?: (entityId: number, gesture: string) => void,
  ) {
    this.root.name = 'crypt-morthen-rite-fx';
    this.decor = new RiteCandleDecor(scene);
    setRenderCategory(this.root, 'ui3d');
    this.low =
      resolveUiEffectsProfile({ presetLabel: GFX.tier, effectsQuality: 1, reduceMotion: false })
        .tier === 'low';
    this.density = this.low ? 0.45 : 1;
    this.kit = new TelegraphKit(this.root, !this.low);
    const flameTex = typeof document !== 'undefined' ? getFlameTex() : null;
    const particleMat = (frag: string, vert: string, blending: THREE.Blending) =>
      this.own(
        new THREE.ShaderMaterial({
          uniforms: { uTime: this.uTime, uTex: { value: flameTex } },
          vertexShader: vert,
          fragmentShader: frag,
          transparent: true,
          depthWrite: false,
          blending,
        }),
      );
    this.mist = new ParticlePool(
      Math.round(500 * this.density),
      particleMat(DUST_FRAG, PARTICLE_VERT, THREE.NormalBlending),
      floorVfxRenderOrder('encounter', 1),
    );
    this.dust = new ParticlePool(
      Math.round(1200 * this.density),
      particleMat(DUST_FRAG, PARTICLE_VERT, THREE.NormalBlending),
      floorVfxRenderOrder('encounter', 25),
    );
    this.fire = new ParticlePool(
      Math.round(2600 * this.density),
      particleMat(FIRE_FRAG, FIRE_VERT, THREE.AdditiveBlending),
      floorVfxRenderOrder('encounter', 26),
    );
    this.holy = new ParticlePool(
      // The relit candles' flames are a state a player reads (which candle
      // burns): a fixed share on every tier.
      Math.round(500 * this.density) + 200,
      particleMat(HOLY_FIRE_FRAG, FIRE_VERT, THREE.AdditiveBlending),
      floorVfxRenderOrder('encounter', 26),
    );
    this.glow = new ParticlePool(
      Math.round(2000 * this.density),
      particleMat(GLOW_FRAG, PARTICLE_VERT, THREE.AdditiveBlending),
      floorVfxRenderOrder('encounter', 27),
    );
    for (const p of [this.mist, this.dust, this.fire, this.holy, this.glow]) {
      this.geometries.push(p.mesh.geometry);
      this.root.add(p.mesh);
    }
    const waveGeo = this.own(new THREE.CircleGeometry(1, 72));
    waveGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < WAVES; i++) {
      const mat = this.own(
        new THREE.ShaderMaterial({
          uniforms: {
            uColor: { value: new THREE.Color() },
            uAlpha: { value: 0 },
            uWidth: { value: 0.18 },
          },
          vertexShader: RITE_MESH_VERT,
          fragmentShader: WAVE_FRAG,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      );
      const mesh = new THREE.Mesh(waveGeo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 22);
      this.root.add(mesh);
      this.waves.push({ mesh, mat, born: 0, span: 1, reach: 1, alive: false });
    }
    this.beamGeo = this.own(new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).translate(0, 0.5, 0));
    this.columnGeo = this.own(
      new THREE.CylinderGeometry(1, 1, 1, 20, 6, true).translate(0, 0.5, 0),
    );
    this.haloGeo = this.own(new THREE.PlaneGeometry(1, 1));
    for (let i = 0; i < FLASHES; i++) {
      const h = this.halo(0xffffff, 29);
      this.flashes.push({ mesh: h.mesh, mat: h.mat, born: 0, span: 1, size: 1, alive: false });
    }
    this.painters = [
      new MorthenAttackFx(this),
      new MorthenWardFx(this),
      new MorthenCandleFx(this),
      new MorthenSoulFx(this),
      new KnellFx(this),
    ];
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {
        this.gateSettled = true;
      })
      .catch(() => {});
  }

  clock(): number {
    return this.time;
  }

  ps(): ParticleSpec {
    const p = this.spec;
    p.x = 0;
    p.y = 0;
    p.z = 0;
    p.vx = 0;
    p.vy = 0;
    p.vz = 0;
    p.ax = 0;
    p.ay = 0;
    p.az = 0;
    p.life = 1;
    p.drag = undefined;
    p.floor = undefined;
    p.size0 = 1;
    p.size1 = 1;
    p.spin = 0;
    p.seed = undefined;
    p.r = 1;
    p.g = 1;
    p.b = 1;
    p.a = 1;
    return p;
  }

  rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  own<T extends THREE.BufferGeometry | THREE.Material>(o: T): T {
    if (o instanceof THREE.Material) this.materials.push(o);
    else this.geometries.push(o);
    return o;
  }

  gesture(entityId: number, gesture: string): void {
    this.playGesture?.(entityId, gesture);
  }

  private additive(
    geo: THREE.BufferGeometry,
    vert: string,
    frag: string,
    color: number,
    step: number,
    extra: Record<string, THREE.IUniform> = {},
  ): RiteGlowMesh {
    const mat = this.own(
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(color) },
          uAlpha: { value: 0 },
          uTime: this.uTime,
          ...extra,
        },
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = floorVfxRenderOrder('encounter', step);
    this.root.add(mesh);
    return { mesh, mat };
  }

  beam(color: number, flow: number, step: number): RiteGlowMesh {
    return this.additive(this.beamGeo, RITE_MESH_VERT, BEAM_FRAG, color, step, {
      uFlow: { value: flow },
    });
  }

  column(color: number, step: number): RiteGlowMesh {
    return this.additive(this.columnGeo, RITE_MESH_VERT, COLUMN_FRAG, color, step);
  }

  halo(color: number, step: number): RiteGlowMesh {
    return this.additive(this.haloGeo, HALO_VERT, HALO_FRAG, color, step);
  }

  wave(x: number, z: number, reach: number, seconds: number, color: number, width = 0.18): void {
    let w = this.waves[0];
    for (const q of this.waves)
      if (!q.alive) {
        w = q;
        break;
      }
    w.alive = true;
    w.born = this.time;
    w.span = seconds;
    w.reach = reach;
    (w.mat.uniforms.uColor.value as THREE.Color).setHex(color);
    w.mat.uniforms.uWidth.value = width;
    w.mesh.position.set(x, this.groundY(x, z) + 0.14, z);
    w.mesh.scale.setScalar(0.01);
    w.mesh.visible = true;
  }

  flash(x: number, y: number, z: number, size: number, seconds: number, color: number): void {
    let f = this.flashes[0];
    for (const q of this.flashes)
      if (!q.alive) {
        f = q;
        break;
      }
    f.alive = true;
    f.born = this.time;
    f.span = seconds;
    f.size = size;
    (f.mat.uniforms.uColor.value as THREE.Color).setHex(color);
    f.mesh.position.set(x, y, z);
    f.mesh.scale.setScalar(size * 0.4);
    f.mesh.visible = true;
  }

  shakeAt(x: number, z: number, amount: number): void {
    if (!this.shake || this.reducedMotion() || !this.world) return;
    const me = this.world.player;
    if (!me) return;
    const d = Math.hypot(me.pos.x - x, me.pos.z - z);
    if (d < 45) this.shake(amount * (1 - d / 45));
  }

  handleEvent(ev: SimEvent): void {
    if (!this.world || this.disposed || !this.inCrypt) return;
    if (ev.type !== 'spellfx' && ev.type !== 'spellfxAt') return;
    for (const p of this.painters) p.handleEvent(ev, this.world);
  }

  /** Who and what of the fight is in the world (10 Hz). */
  private scanWorld(world: IWorld): void {
    const s = this.scan;
    s.morthenId = -1;
    s.wyrmId = -1;
    s.candles.length = 0;
    s.grasps.length = 0;
    s.knells.length = 0;
    s.souls.length = 0;
    s.lighters.length = 0;
    s.rooted.length = 0;
    s.chill = 0;
    for (const e of world.entities.values()) {
      if (e.kind === 'object') {
        const t = e.templateId;
        if (isRiteCandleTemplate(t)) s.candles.push(e.id);
        else if (t === MORTHEN_GRASP_TEMPLATE || t === MORTHEN_GRASP_HANDS_TEMPLATE)
          s.grasps.push(e.id);
        else if (t === KNELL_HALF_MARK_TEMPLATE || t === KNELL_HALF_FIRE_TEMPLATE)
          s.knells.push(e.id);
        else if (t === MORTHEN_SOUL_TEMPLATE) s.souls.push(e.id);
        continue;
      }
      if (e.kind === 'mob') {
        if (e.templateId === MORTHEN_ID && (s.morthenId < 0 || !e.dead)) s.morthenId = e.id;
        else if (e.templateId === KNELLWYRM_ID && (s.wyrmId < 0 || !e.dead)) s.wyrmId = e.id;
        continue;
      }
      if (e.kind !== 'player' || e.dead) continue;
      if (e.castingAbility === MORTHEN_RELIGHT_CAST && e.castTargetId !== null)
        s.lighters.push(e.id);
      for (const a of e.auras) {
        if (a.id === MORTHEN_GRASP_ROOT) s.rooted.push(e.id);
        else if (a.id === MORTHEN_GRAVE_CHILL) s.chill = Math.max(s.chill, a.value2 ?? 1);
      }
    }
  }

  update(dt: number): void {
    const world = this.world;
    if (!world || this.disposed) return;
    this.time += dt;
    this.uTime.value = this.time;
    // Nothing to paint (and no world to scan) outside the crypt.
    this.where -= dt;
    if (this.where <= 0) {
      this.where = 0.5;
      const me = world.player;
      const o = me ? cryptSlotOrigin(me.pos.x, me.pos.z) : null;
      this.inCrypt =
        !!me && !!o && Math.abs(me.pos.x - o.x) < 130 && Math.abs(me.pos.z - o.z) < 260;
      // Never reveal the root ahead of its compile gate (a rebuild inside the crypt).
      this.root.visible = this.inCrypt && this.gateSettled;
    }
    if (!this.inCrypt) return;
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = SCAN_SEC;
      this.scanWorld(world);
    }
    for (const p of this.painters) p.update(world, dt);
    for (const w of this.waves) {
      if (!w.alive) continue;
      const k = (this.time - w.born) / w.span;
      if (k >= 1) {
        w.alive = false;
        w.mesh.visible = false;
        continue;
      }
      const ease = 1 - (1 - k) ** 3;
      w.mesh.scale.setScalar(w.reach * (0.06 + 0.94 * ease));
      w.mat.uniforms.uAlpha.value = (1 - k) ** 1.3;
    }
    for (const f of this.flashes) {
      if (!f.alive) continue;
      const k = (this.time - f.born) / f.span;
      if (k >= 1) {
        f.alive = false;
        f.mesh.visible = false;
        continue;
      }
      f.mesh.scale.setScalar(f.size * (0.4 + 0.6 * (1 - (1 - k) ** 3)));
      f.mat.uniforms.uAlpha.value = k < 0.1 ? k / 0.1 : (1 - k) ** 1.5;
    }
    this.mist.update(this.time);
    this.dust.update(this.time);
    this.fire.update(this.time);
    this.holy.update(this.time);
    this.glow.update(this.time);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    // A host torn down mid-Rite leaves the candles of every interior still in
    // the scene as their builders made them (a retired one is never touched).
    this.decor.restoreAll();
    this.kit.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
