// The Hollow Crypt wing bosses' effects (plan: crypt_boss_fx_core.ts): one
// gated root shared by three painters, one per boss, each reading the sim's
// own state off IWorld (cast bars, auras, encounter objects) and its spellfx
// cues:
//
//   marrow_fx.ts   Sexton Marrow: the Shovelful cone and its dirt, the
//                  Measured mark, the Open Graves (pit, mound, grave mist),
//                  the bell rope and the Burial Toll's peals.
//   lady_fx.ts     the Lady of the Bonechill: the grave lanterns (flame,
//                  light pool, darkening, kindling) and the frozen bridal
//                  grave, the Bride's Lament, the Frozen Embrace, the Rime
//                  Path and the frozen ravine.
//   ilvane_fx.ts   Cantor Ilvane: the Dirge (its interrupt glyph, the
//                  pillars' sight shadows, the blast), Harmony's threads to
//                  her Choristers, the Bone Organ's note lanes.
//
// Rules (src/render/CLAUDE.md, hollow_crypt/CLAUDE.md): one root attached
// through the compile gate with every material present at construction;
// pooled everything; GPU particles on the crypt kit (crypt_fx_particles.ts).
// Every telegraph and hazard a player acts on (cones, rings, lanes, pits, the
// lanterns' light, the ice) draws on every tier; motes, mist and sparks shed on
// the low effects tier.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import type { SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { TelegraphKit } from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX } from '../gfx';
import { setRenderCategory } from '../renderer_diagnostics';
import { cryptSlotOrigin } from './crypt_boss_fx_core';
import { DUST_FRAG, GLOW_FRAG, PARTICLE_VERT, ParticlePool } from './crypt_fx_particles';
import { IlvaneFx } from './ilvane_fx';
import { LadyFx } from './lady_fx';
import { MarrowFx } from './marrow_fx';

const WAVES = 10;

const WAVE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

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

interface Wave {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  born: number;
  span: number;
  reach: number;
  alive: boolean;
}

/** What a boss painter shares from the host. */
export interface CryptBossFxHost {
  readonly root: THREE.Group;
  readonly kit: TelegraphKit;
  readonly dust: ParticlePool;
  readonly glow: ParticlePool;
  readonly uTime: { value: number };
  readonly groundY: (x: number, z: number) => number;
  /** 0.45 on the low effects tier, 1 otherwise (cosmetic counts only). */
  readonly density: number;
  readonly low: boolean;
  clock(): number;
  rand(): number;
  /** A shockwave band across the floor. */
  wave(x: number, z: number, reach: number, seconds: number, color: number, width?: number): void;
  /** Shake the camera if the local player stands near (x, z). */
  shakeAt(x: number, z: number, amount: number): void;
  /** Keep a geometry or material for disposal. */
  own<T extends THREE.BufferGeometry | THREE.Material>(o: T): T;
  /** Play a one-shot gesture clip on an entity (the manifest's attackByAbility). */
  gesture(entityId: number, gesture: string): void;
}

/** One boss painter on the host. */
export interface CryptBossPainter {
  update(world: IWorld, dt: number): void;
  handleEvent(ev: SimEvent & { type: 'spellfx' }, world: IWorld): void;
}

export class CryptBossFx implements CryptBossFxHost {
  readonly root = new THREE.Group();
  readonly kit: TelegraphKit;
  readonly dust: ParticlePool;
  readonly glow: ParticlePool;
  readonly uTime = { value: 0 };
  readonly density: number;
  readonly low: boolean;
  readonly readyForEntry: Promise<void>;
  private readonly waves: Wave[] = [];
  private readonly painters: CryptBossPainter[];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private time = 0;
  /** Is the local player inside a Hollow Crypt claim (re-read twice a second)? */
  private inCrypt = false;
  private where = 0;
  private seed = 0x2b4e;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    private readonly shake?: (amount: number) => void,
    private readonly playGesture?: (entityId: number, gesture: string) => void,
  ) {
    this.root.name = 'crypt-boss-fx';
    setRenderCategory(this.root, 'ui3d');
    this.low =
      resolveUiEffectsProfile({ presetLabel: GFX.tier, effectsQuality: 1, reduceMotion: false })
        .tier === 'low';
    this.density = this.low ? 0.45 : 1;
    this.kit = new TelegraphKit(this.root, !this.low);
    const particleMat = (frag: string, blending: THREE.Blending) =>
      this.own(
        new THREE.ShaderMaterial({
          uniforms: { uTime: this.uTime },
          vertexShader: PARTICLE_VERT,
          fragmentShader: frag,
          transparent: true,
          depthWrite: false,
          blending,
        }),
      );
    this.dust = new ParticlePool(
      Math.round(900 * this.density),
      particleMat(DUST_FRAG, THREE.NormalBlending),
      floorVfxRenderOrder('encounter', 25),
    );
    this.glow = new ParticlePool(
      Math.round(1600 * this.density),
      particleMat(GLOW_FRAG, THREE.AdditiveBlending),
      floorVfxRenderOrder('encounter', 27),
    );
    for (const p of [this.dust, this.glow]) this.root.add(p.mesh);
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
          vertexShader: WAVE_VERT,
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
      mesh.renderOrder = floorVfxRenderOrder('encounter', 23);
      this.root.add(mesh);
      this.waves.push({ mesh, mat, born: 0, span: 1, reach: 1, alive: false });
    }
    this.painters = [new MarrowFx(this), new LadyFx(this), new IlvaneFx(this)];
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  clock(): number {
    return this.time;
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

  wave(x: number, z: number, reach: number, seconds: number, color: number, width = 0.18): void {
    const w = this.waves.find((q) => !q.alive) ?? this.waves[0];
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

  shakeAt(x: number, z: number, amount: number): void {
    if (!this.shake || this.reducedMotion() || !this.world) return;
    const me = this.world.player;
    if (!me) return;
    const d = Math.hypot(me.pos.x - x, me.pos.z - z);
    if (d < 40) this.shake(amount * (1 - d / 40));
  }

  handleEvent(ev: SimEvent): void {
    if (ev.type !== 'spellfx' || !this.world || this.disposed) return;
    for (const p of this.painters) p.handleEvent(ev, this.world);
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
      this.root.visible = this.inCrypt;
    }
    if (!this.inCrypt) return;
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
    this.dust.update(this.time);
    this.glow.update(this.time);
  }

  dispose(): void {
    this.disposed = true;
    this.root.parent?.remove(this.root);
    this.kit.dispose();
    this.dust.dispose();
    this.glow.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
