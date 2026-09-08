import type * as THREE from 'three';
import type { AnimState } from './anim_state';
import type { VisualDef } from './manifest';

interface Binding {
  node: THREE.Object3D;
  property: 'quaternion' | 'position';
  sample: { evaluate(t: number): ArrayLike<number> };
  saved: Float32Array;
}
interface Pose {
  duration: number;
  bindings: Binding[];
}
const LOWER = /^(hips|upperleg[lr]|lowerleg[lr]|foot[lr]|toes[lr])$/;
const UPPER =
  /^(spine|chest|neck|head|shoulder[lr]|upperarm[lr]|lowerarm[lr]|wrist[lr]|hand[lr]|handslot[lr])$/;
/** Native gait below a moving cast, native upper action above swim/jump.
 * All track/bone lookup happens when the visual is prepared, never on a cast.
 * Applied after the mixer only on frames which actually animate the body. */
export class CastLocomotion {
  private readonly lower = new Map<string, Pose>();
  private readonly upper = new Map<string, Pose>();
  private ability: string | null = null;
  private castTime = 0;
  private gaitTime = 0;
  private held: Pose | undefined;
  private channel = false;
  private readonly touched: (Binding | undefined)[] = new Array(64);
  private touchedCount = 0;
  private flickPose: Pose | undefined;
  private flickTime = -1;
  constructor(
    rig: THREE.Object3D,
    clips: ReadonlyMap<string, THREE.AnimationClip>,
    private readonly def: VisualDef,
  ) {
    const flick = clips.get('Signature_fire_blast');
    if (flick) this.flickPose = bind(rig, flick, /^(upperarmr|lowerarmr|wristr|handslotr)$/);
    for (const [name, clip] of clips)
      if (name.startsWith('Signature_Hold_') || name.startsWith('Signature_Channel_'))
        this.upper.set(name, bind(rig, clip, UPPER));
    if (this.upper.size === 0) return;
    for (const name of new Set([def.clips.walk, def.clips.walkBack, def.clips.run])) {
      const clip = name ? clips.get(name) : null;
      if (clip && name) this.lower.set(name, bind(rig, clip, LOWER));
    }
  }
  restart(): void {
    this.castTime = 0;
  }
  restore(): void {
    for (let i = this.touchedCount - 1; i >= 0; i--) {
      const b = this.touched[i]!;
      if (b.property === 'quaternion') b.node.quaternion.fromArray(b.saved);
      else b.node.position.fromArray(b.saved);
      this.touched[i] = undefined;
    }
    this.touchedCount = 0;
  }
  private apply(pose: Pose, time: number): void {
    for (const b of pose.bindings) {
      if (b.property === 'quaternion') b.node.quaternion.toArray(b.saved);
      else b.node.position.toArray(b.saved);
      this.touched[this.touchedCount++] = b;
      const v = b.sample.evaluate(time);
      if (b.property === 'quaternion') b.node.quaternion.fromArray(v);
      else b.node.position.fromArray(v);
    }
  }
  triggerFlick(): boolean {
    if (!this.flickPose) return false;
    this.flickTime = 0;
    return true;
  }
  update(dt: number, s: AnimState): void {
    this.updateCast(dt, s);
    if (this.flickTime < 0 || !this.flickPose) return;
    if (s.dead) {
      this.flickTime = -1;
      return;
    }
    this.flickTime += dt;
    if (this.flickTime > 0.23) {
      this.flickTime = -1;
      return;
    }
    this.apply(this.flickPose, 0.1 + this.flickTime * 2.5);
  }
  private updateCast(dt: number, s: AnimState): void {
    const id = s.casting && !s.dead ? (s.castingAbility ?? null) : null;
    if (id !== this.ability) {
      this.ability = id;
      this.castTime = 0;
      this.held = id ? this.upper.get('Signature_Channel_' + id) : undefined;
      this.channel = this.held !== undefined;
      if (!this.held && id) this.held = this.upper.get('Signature_Hold_' + id);
    }
    if (!id) return;
    this.castTime += dt;
    const held = this.held,
      channel = this.channel;
    if (!held) return;
    if (s.airborne || s.swimming) {
      this.apply(held, channel ? this.castTime % held.duration : Math.min(0.72, this.castTime));
      return;
    }
    if (!s.moving || s.sitting) return;
    const c = this.def.clips,
      name = s.backwards ? (c.walkBack ?? c.walk) : s.running ? c.run : c.walk;
    const gait = this.lower.get(name ?? '');
    if (!gait) return;
    const speed = Math.max(
      0.1,
      s.speed / (s.running ? (this.def.runRef ?? 7) : (this.def.walkRef ?? 2.2)),
    );
    this.gaitTime = (this.gaitTime + dt * speed) % gait.duration;
    this.apply(gait, s.backwards && !c.walkBack ? gait.duration - this.gaitTime : this.gaitTime);
  }
}
function bind(rig: THREE.Object3D, clip: THREE.AnimationClip, joints: RegExp): Pose {
  const bindings: Binding[] = [];
  for (const t of clip.tracks) {
    const split = t.name.lastIndexOf('.'),
      name = t.name.slice(0, split),
      property = t.name.slice(split + 1);
    if (!joints.test(name) || (property !== 'quaternion' && property !== 'position')) continue;
    const node = rig.getObjectByName(name);
    if (node)
      bindings.push({ node, property, sample: t.createInterpolant(), saved: new Float32Array(4) });
  }
  return { duration: Math.max(0.01, clip.duration), bindings };
}
