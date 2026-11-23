// The Hollow Crypt trash mechanics pass's hero effects (plan:
// crypt_trash_kit_fx_core.ts), the host its two parts share:
//  - crypt_bone_fx.ts: the necromancers' bones (the Reassemble pile, its glow
//    and soul tether, the warrior standing back up, the crumble), the Grave
//    Rupture blast and its heroic pool, the Splinter Burst, the Marrow Crush;
//  - crypt_mark_fx.ts: the marks on a body (the gargoyle's Granite Skin crust
//    and its Cracked Stone, the Carrion Eye bolt, glyph and crow streaks, the
//    Rimesilk strand and web net) and the drake's heroic Barrow Embers.
//
// The floor telegraphs that decide outcomes (the rupture ring, the pool's and
// the embers' edges, the lanes and kick glyphs) are crypt_trash_fx.ts's, on
// every tier. Here: the hero layer. What a player acts on (the pile's
// countdown glow and tether, the pool's and embers' burning bodies, the eye
// over a marked player and the crows' streaks to it, the web on a rooted
// player, the gargoyle's crust and cracks) draws on every graphics tier; the
// particle budgets shed to under half on the low effects tier and the purely
// cosmetic flourishes (orbiting flakes) shed outright.
//
// Rules (src/render/CLAUDE.md): one root, attached through the compile gate
// with every material present; every geometry and material built once and
// pooled; particles are four GPU-advected draws (crypt_fx_particles.ts) the
// CPU writes only when a particle is born. Everything is read off IWorld
// entity state and spellfx events, so offline and online look the same.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX } from '../gfx';
import { getFlameTex } from '../ignivar_fire_vfx';
import { setRenderCategory, tagVfxSubtree } from '../renderer_diagnostics';
import { CryptBoneFx } from './crypt_bone_fx';
import {
  BEAM_VERT,
  beamGeometry,
  GLYPH_VERT,
  POLAR_VERT,
  polarGeometry,
  SHARD_FRAG,
} from './crypt_fx_floor';
import {
  DUST_FRAG,
  FIRE_FRAG,
  FIRE_VERT,
  GLOW_FRAG,
  PARTICLE_VERT,
  ParticlePool,
  type ParticleSpec,
} from './crypt_fx_particles';
import { CryptMarkFx } from './crypt_mark_fx';
import { inHollowCrypt, KIT_SCAN_SECONDS } from './crypt_trash_kit_fx_core';

/**
 * One reused particle spec, written through a chain and handed to a pool
 * (which copies it into its buffers at once): a particle costs no object.
 * `at` starts a particle and resets every optional field to the pool's
 * default (no acceleration, the minimum drag, no floor, no spin).
 */
export class ParticleBrush {
  private readonly p: ParticleSpec = {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    ax: 0,
    ay: 0,
    az: 0,
    life: 1,
    drag: 0.001,
    floor: -1e6,
    size0: 1,
    size1: 1,
    spin: 0,
    r: 1,
    g: 1,
    b: 1,
    a: 1,
  };

  at(x: number, y: number, z: number): this {
    const p = this.p;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = 0;
    p.vy = 0;
    p.vz = 0;
    p.ax = 0;
    p.ay = 0;
    p.az = 0;
    p.drag = 0.001;
    p.floor = -1e6;
    p.spin = 0;
    return this;
  }

  vel(vx: number, vy: number, vz: number): this {
    this.p.vx = vx;
    this.p.vy = vy;
    this.p.vz = vz;
    return this;
  }

  acc(ax: number, ay: number, az: number): this {
    this.p.ax = ax;
    this.p.ay = ay;
    this.p.az = az;
    return this;
  }

  life(life: number, drag = 0.001, floor = -1e6): this {
    this.p.life = life;
    this.p.drag = drag;
    this.p.floor = floor;
    return this;
  }

  size(size0: number, size1: number, spin = 0): this {
    this.p.size0 = size0;
    this.p.size1 = size1;
    this.p.spin = spin;
    return this;
  }

  rgba(r: number, g: number, b: number, a: number): this {
    this.p.r = r;
    this.p.g = g;
    this.p.b = b;
    this.p.a = a;
    return this;
  }

  emit(pool: ParticlePool, at: number): void {
    pool.emit(at, this.p);
  }
}

/** A part of the kit fed by the host's one roster walk (10 Hz, only inside
 *  the crypt's claim): `beginScan`, then `see` for every entity, then
 *  `endScan` (which runs even when the walk is skipped, to let go of owners). */
export interface CryptKitPart {
  beginScan(): void;
  see(e: Entity): void;
  endScan(): void;
}

/** A pooled floor patch (a draped disc or cone) and its life. */
export interface KitPatch {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  /** Owner key (an entity id, or -1 while free). */
  owner: number;
  born: number;
  /** Seconds since its owner went (negative while it stands). */
  goneAt: number;
}

/** A pooled camera-facing ribbon between two world points. */
export interface KitBeam {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  owner: number;
}

/** A pooled billboard glyph. */
export interface KitGlyph {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  owner: number;
  born: number;
}

/** What a part of the kit draws with: the shared pools, clock and builders. */
export interface CryptKitHost {
  readonly root: THREE.Group;
  readonly world: IWorld;
  readonly groundY: (x: number, z: number) => number;
  readonly glow: ParticlePool;
  readonly dust: ParticlePool;
  readonly fire: ParticlePool;
  /** Bone splinters and stone flakes (solid, spun slivers). */
  readonly shards: ParticlePool;
  /** The one reused particle spec every emit is written through. */
  readonly brush: ParticleBrush;
  /** Particle budget multiplier: 1, or under half on the low effects tier. */
  readonly density: number;
  /** Purely cosmetic flourishes on (off on the low effects tier). */
  readonly detail: boolean;
  /** The shared shader clock (seconds), ticked once a frame. */
  readonly uTime: { value: number };
  now(): number;
  rand(): number;
  shakeAt(x: number, z: number, amount: number): void;
  patch(
    rings: number,
    segments: number,
    frag: string,
    uniforms: Record<string, THREE.IUniform>,
    step: number,
    additive?: boolean,
  ): KitPatch;
  beam(
    frag: string,
    uniforms: Record<string, THREE.IUniform>,
    step: number,
    additive?: boolean,
  ): KitBeam;
  glyph(
    frag: string,
    uniforms: Record<string, THREE.IUniform>,
    step: number,
    additive?: boolean,
  ): KitGlyph;
  /** Register a geometry or material the host disposes. */
  own<T extends THREE.BufferGeometry | THREE.Material>(resource: T): T;
}

/** Ladder rungs of the kit's pieces (encounter band; the telegraphs that
 *  decide outcomes sit at 15 to 19 and the creature effects at 2 to 3 and 24
 *  to 28, crypt_creature_fx.ts). */
export const KIT_STEPS = {
  scorch: 3,
  pileGlow: 4,
  hazardBody: 5,
  webNet: 6,
  shock: 24,
  dust: 25,
  fire: 26,
  glow: 27,
  glyph: 28,
  beam: 29,
} as const;

export class CryptTrashKitFx implements CryptKitHost {
  readonly readyForEntry: Promise<void>;
  readonly root = new THREE.Group();
  readonly glow: ParticlePool;
  readonly dust: ParticlePool;
  readonly fire: ParticlePool;
  readonly shards: ParticlePool;
  readonly brush = new ParticleBrush();
  readonly density: number;
  readonly detail: boolean;
  readonly uTime = { value: 0 };
  private readonly bones: CryptBoneFx;
  private readonly marks: CryptMarkFx;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly glyphGeo: THREE.BufferGeometry;
  private readonly beamGeo: THREE.BufferGeometry;
  private clock = 0;
  private scan = 0;
  private seed = 0x7a5c;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    readonly groundY: (x: number, z: number) => number,
    readonly world: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    private readonly shake?: (amount: number) => void,
  ) {
    this.root.name = 'crypt-trash-kit-fx';
    setRenderCategory(this.root, 'ui3d');
    const low =
      resolveUiEffectsProfile({ presetLabel: GFX.tier, effectsQuality: 1, reduceMotion: false })
        .tier === 'low';
    this.density = low ? 0.45 : 1;
    this.detail = !low;
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
    this.dust = new ParticlePool(
      Math.round(900 * this.density),
      particleMat(DUST_FRAG, PARTICLE_VERT, THREE.NormalBlending),
      floorVfxRenderOrder('encounter', KIT_STEPS.dust),
    );
    this.shards = new ParticlePool(
      Math.round(600 * this.density),
      particleMat(SHARD_FRAG, PARTICLE_VERT, THREE.NormalBlending),
      floorVfxRenderOrder('encounter', KIT_STEPS.dust),
    );
    this.fire = new ParticlePool(
      Math.round(800 * this.density),
      particleMat(FIRE_FRAG, FIRE_VERT, THREE.AdditiveBlending),
      floorVfxRenderOrder('encounter', KIT_STEPS.fire),
    );
    this.glow = new ParticlePool(
      Math.round(1100 * this.density),
      particleMat(GLOW_FRAG, PARTICLE_VERT, THREE.AdditiveBlending),
      floorVfxRenderOrder('encounter', KIT_STEPS.glow),
    );
    for (const p of [this.dust, this.shards, this.fire, this.glow]) {
      this.geometries.push(p.mesh.geometry);
      this.root.add(p.mesh);
    }
    this.glyphGeo = this.own(new THREE.PlaneGeometry(2, 2));
    this.glyphGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.beamGeo = this.own(beamGeometry(20));
    this.bones = new CryptBoneFx(this);
    this.marks = new CryptMarkFx(this);
    for (const child of this.root.children) tagVfxSubtree(child);
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  own<T extends THREE.BufferGeometry | THREE.Material>(resource: T): T {
    if (resource instanceof THREE.Material) this.materials.push(resource);
    else this.geometries.push(resource);
    return resource;
  }

  now(): number {
    return this.clock;
  }

  rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  shakeAt(x: number, z: number, amount: number): void {
    if (!this.shake || this.reducedMotion()) return;
    const me = this.world.player;
    if (!me) return;
    const d = Math.hypot(me.pos.x - x, me.pos.z - z);
    if (d < 30) this.shake(amount * (1 - d / 30));
  }

  patch(
    rings: number,
    segments: number,
    frag: string,
    uniforms: Record<string, THREE.IUniform>,
    step: number,
    additive = false,
  ): KitPatch {
    const mat = this.own(
      new THREE.ShaderMaterial({
        uniforms: { uTime: this.uTime, ...uniforms },
        vertexShader: POLAR_VERT,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    );
    const mesh = new THREE.Mesh(this.own(polarGeometry(rings, segments)), mat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = floorVfxRenderOrder('encounter', step);
    this.root.add(mesh);
    return { mesh, mat, owner: -1, born: 0, goneAt: -1 };
  }

  beam(
    frag: string,
    uniforms: Record<string, THREE.IUniform>,
    step: number,
    additive = true,
  ): KitBeam {
    const mat = this.own(
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: this.uTime,
          uA: { value: new THREE.Vector3() },
          uB: { value: new THREE.Vector3() },
          uWidth: { value: 0.2 },
          uSag: { value: 0 },
          uWave: { value: 0 },
          ...uniforms,
        },
        vertexShader: BEAM_VERT,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    );
    const mesh = new THREE.Mesh(this.beamGeo, mat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = floorVfxRenderOrder('encounter', step);
    this.root.add(mesh);
    return { mesh, mat, owner: -1 };
  }

  glyph(
    frag: string,
    uniforms: Record<string, THREE.IUniform>,
    step: number,
    additive = true,
  ): KitGlyph {
    const mat = this.own(
      new THREE.ShaderMaterial({
        uniforms: { uTime: this.uTime, ...uniforms },
        vertexShader: GLYPH_VERT,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    );
    const mesh = new THREE.Mesh(this.glyphGeo, mat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = floorVfxRenderOrder('encounter', step);
    this.root.add(mesh);
    return { mesh, mat, owner: -1, born: 0 };
  }

  /** True when a part claimed the event (the generic bolt or nova is then
   *  not drawn on top of it). */
  handleEvent(ev: SimEvent): boolean {
    if (this.disposed || ev.type !== 'spellfx') return false;
    const bones = this.bones.handleEvent(ev);
    const marks = this.marks.handleEvent(ev);
    return bones || marks;
  }

  update(dt: number): void {
    if (this.disposed) return;
    this.clock += dt;
    this.uTime.value = this.clock;
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = KIT_SCAN_SECONDS;
      this.walk();
    }
    this.bones.update(dt);
    this.marks.update(dt);
    this.dust.update(this.clock);
    this.shards.update(this.clock);
    this.fire.update(this.clock);
    this.glow.update(this.clock);
  }

  /** One roster walk feeds both parts, and only inside the crypt's claim. */
  private walk(): void {
    this.bones.beginScan();
    this.marks.beginScan();
    if (inHollowCrypt(this.world.player.pos.x)) {
      for (const e of this.world.entities.values()) {
        this.bones.see(e);
        this.marks.see(e);
      }
    }
    this.bones.endScan();
    this.marks.endScan();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.marks.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
