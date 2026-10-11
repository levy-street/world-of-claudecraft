// Zulgar's Jaguar Avatar: while the Spirit of the Hunt holds him (the
// `wildheart_jaguar_avatar` aura), the Great Jaguar's jade spirit body
// (JAGUAR_MODEL.spiritUrl, the same rig and clips as the Fanglord's cat) runs
// round him, a third again its size: it fades in with the hunt's roar, gallops
// and walks with his pace, pounces when he mauls his prey and fades out when
// the hunt ends. A jade trail of motes streams off it while it runs.
//
// Plan in zulgar_avatar_core.ts (Node-tested); this is the thin Three painter.
// GPU rules (src/render/CLAUDE.md): the clone is built off the cached GLB once,
// under its own root, attached through attachSceneGroupGated (its programs
// link before its first frame); the spirit material is cloned once (the GLB
// cache is immutable) and only its opacity moves; no light.

import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import {
  ZULGAR_AMBUSH,
  ZULGAR_AVATAR,
  ZULGAR_ID,
  ZULGAR_MAULED,
} from '../../sim/encounters/wildheart_basin/ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { loadGltf } from '../assets/loader';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { setRenderCategory } from '../renderer_diagnostics';
import type { BasinFxHost } from './basin_fx_host';
import { JAGUAR_MODEL } from './jaguar_model_core';
import {
  AVATAR_LOOK,
  avatarFade,
  avatarGait,
  avatarGaitRate,
  turnToward,
} from './zulgar_avatar_core';

type Clip = 'Idle' | 'Walk' | 'Run' | 'Pounce' | 'Roar';
const LOOPS: readonly Clip[] = ['Idle', 'Walk', 'Run'];

export class ZulgarAvatarFx {
  readonly ready: Promise<void>;
  private readonly root = new THREE.Group();
  private body: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private readonly actions = new Map<Clip, THREE.AnimationAction>();
  private readonly materials: THREE.Material[] = [];
  /** The clone's own skeletons (their bone textures are this module's). */
  private readonly skeletons: THREE.Skeleton[] = [];
  private baseOpacity: number[] = [];
  private loop: Clip | null = null;
  private oneShot: THREE.AnimationAction | null = null;
  private zulgarId = -1;
  private fade = 0;
  private x = 0;
  private z = 0;
  private y = 0;
  private facing = 0;
  private speed = 0;
  private placed = false;
  private trail = 0;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly host: BasinFxHost,
    private readonly world: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
  ) {
    this.root.name = 'wildheart-zulgar-avatar';
    setRenderCategory(this.root, 'ui3d');
    // The gate owns the root's visibility (it reveals it once linked); the body
    // inside is what this module shows and hides.
    this.ready = loadGltf(JAGUAR_MODEL.spiritUrl)
      .then(async (gltf) => {
        if (this.disposed) return;
        this.build(gltf.scene, gltf.animations);
        // Compile with the body present; it stays hidden until a hunt.
        await attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed);
      })
      .catch(() => {});
  }

  private build(source: THREE.Object3D, clips: THREE.AnimationClip[]): void {
    const body = cloneSkinned(source);
    body.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = false;
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) this.skeletons.push(mesh.skeleton);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      const src = mesh.material as THREE.MeshStandardMaterial;
      const m = src.clone();
      m.transparent = true;
      m.depthWrite = false;
      m.name = 'wildheartZulgarAvatarSpirit';
      // Brighter than the Whistle's pet: the hunt's spirit must read across
      // the terrace (its rosettes burn into the bloom).
      m.emissiveIntensity = AVATAR_LOOK.emissive;
      mesh.material = m;
      this.materials.push(m);
      this.baseOpacity.push(Math.min(0.78, m.opacity * AVATAR_LOOK.opacity));
    });
    body.scale.setScalar(AVATAR_LOOK.scale);
    // Hidden until a hunt (the gate links hidden children all the same).
    body.visible = false;
    this.root.add(body);
    this.body = body;
    const mixer = new THREE.AnimationMixer(body);
    for (const name of [...LOOPS, 'Pounce', 'Roar'] as Clip[]) {
      const clip = clips.find((c) => c.name === name);
      if (!clip) continue;
      const action = mixer.clipAction(clip);
      if (name === 'Pounce' || name === 'Roar') {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = false;
      }
      this.actions.set(name, action);
    }
    mixer.addEventListener('finished', (e) => {
      if (e.action === this.oneShot) {
        this.oneShot = null;
        if (this.loop) this.actions.get(this.loop)?.fadeIn(0.2);
      }
    });
    this.mixer = mixer;
  }

  /** The scan saw Zulgar (or not: -1). */
  setZulgar(e: Entity | null): void {
    this.zulgarId = e && e.templateId === ZULGAR_ID ? e.id : -1;
  }

  /** The hunt's moments: its start (the avatar's nova roars), a maul and an
   *  ambush landing (pounces). Never claims the event (the bursts still play). */
  handleEvent(ev: Extract<SimEvent, { type: 'spellfx' }>): void {
    if (ev.ability === ZULGAR_AVATAR) this.playOnce('Roar');
    else if (ev.ability === ZULGAR_MAULED || ev.ability === ZULGAR_AMBUSH) this.playOnce('Pounce');
  }

  private playOnce(name: 'Pounce' | 'Roar'): void {
    const action = this.actions.get(name);
    if (!action) return;
    if (this.oneShot && this.oneShot !== action) this.oneShot.fadeOut(0.15);
    if (this.loop) this.actions.get(this.loop)?.fadeOut(0.15);
    action.reset().setEffectiveWeight(1).fadeIn(0.12).play();
    this.oneShot = action;
  }

  private setLoop(name: Clip, rate: number): void {
    if (this.loop !== name) {
      const next = this.actions.get(name);
      if (next) {
        if (this.loop) this.actions.get(this.loop)?.fadeOut(0.25);
        next.reset().play();
        if (this.oneShot) next.setEffectiveWeight(0);
        else next.fadeIn(0.25);
      }
      this.loop = name;
    }
    const a = this.actions.get(name);
    if (a) a.timeScale = rate;
  }

  update(dt: number): void {
    if (this.disposed || !this.body || !this.mixer) return;
    const e = this.zulgarId >= 0 ? this.world.entities.get(this.zulgarId) : undefined;
    const active = !!e && !e.dead && hasAura(e, ZULGAR_AVATAR);
    this.fade = avatarFade(this.fade, active, dt);
    if (this.fade <= 0.001 || !e) {
      if (this.body.visible) this.body.visible = false;
      this.placed = false;
      return;
    }
    // Follow his displayed body: an exponential chase over the 20 Hz steps.
    if (!this.placed) {
      this.x = e.pos.x;
      this.z = e.pos.z;
      this.facing = e.facing;
      this.speed = 0;
      this.placed = true;
    }
    const k = 1 - Math.exp(-dt * AVATAR_LOOK.follow);
    const nx = this.x + (e.pos.x - this.x) * k;
    const nz = this.z + (e.pos.z - this.z) * k;
    const moved = Math.hypot(nx - this.x, nz - this.z);
    this.speed += ((dt > 0 ? moved / dt : 0) - this.speed) * Math.min(1, dt * 5);
    this.x = nx;
    this.z = nz;
    this.y = this.host.groundY(nx, nz);
    this.facing = turnToward(this.facing, e.facing, dt * AVATAR_LOOK.turnRate);
    this.body.visible = true;
    this.body.position.set(this.x, this.y, this.z);
    this.body.rotation.y = this.facing;
    const gait = avatarGait(this.speed);
    this.setLoop(gait, avatarGaitRate(gait, this.speed));
    this.mixer.update(dt);
    const pulse = 0.9 + 0.1 * Math.sin(this.host.uTime.value * 3.2);
    for (let i = 0; i < this.materials.length; i++) {
      const m = this.materials[i] as THREE.MeshStandardMaterial;
      m.opacity = this.baseOpacity[i] * this.fade * pulse;
      m.visible = this.fade > 0.02;
    }
    // A jade trail off its flanks while it runs.
    if (gait !== 'Idle' && this.fade > 0.5) {
      this.trail += dt * 34 * this.host.density;
      while (this.trail >= 1) {
        this.trail -= 1;
        const side = (this.host.rand() - 0.5) * 2 * AVATAR_LOOK.halfWidth;
        const along = (this.host.rand() - 0.6) * AVATAR_LOOK.length;
        const s = Math.sin(this.facing);
        const c = Math.cos(this.facing);
        this.host.puff(
          this.x + s * along + c * side,
          this.y + 1 + this.host.rand() * AVATAR_LOOK.height * 0.6,
          this.z + c * along - s * side,
          1,
          {
            speed: 0.5,
            up: 0.8,
            life: 1.2,
            size: [0.6, 0.15],
            color: [0.4, 1, 0.66],
            alpha: 0.85 * this.fade,
            glow: true,
          },
        );
      }
    }
  }

  hide(): void {
    this.fade = 0;
    if (this.body) this.body.visible = false;
    this.placed = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.mixer?.stopAllAction();
    if (this.body) this.mixer?.uncacheRoot(this.body);
    for (const sk of this.skeletons) sk.dispose();
    for (const m of this.materials) m.dispose();
  }
}

function hasAura(e: { auras?: readonly { id: string }[] }, id: string): boolean {
  const auras = e.auras;
  if (!auras) return false;
  for (let i = 0; i < auras.length; i++) if (auras[i].id === id) return true;
  return false;
}
