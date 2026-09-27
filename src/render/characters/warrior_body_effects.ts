import type * as THREE from 'three';
import type { AnimState } from './anim_state';
import { WarriorContactRecoil } from './warrior_contact_recoil';
import { WarriorRushPose } from './warrior_rush_pose';

/** Gated live state for a warrior player rig: the receiving-body contact
 *  recoil and the Charge/Intervene rush pose. `forKey` constructs the two
 *  underlying instances only for `player_warrior`/`player_warrior_modular`
 *  (the same gate `WarriorActionProps` uses) and hands every other key the
 *  shared disabled instance, so every mob, NPC and pet visual carries a
 *  field that never allocates and whose per-frame calls are no-ops, instead
 *  of two live instances it never drives. `visual.ts` calls this
 *  unconditionally: the gate lives here, not at each call site. */
export class WarriorBodyEffects {
  private static readonly disabled = new WarriorBodyEffects(false);

  static forKey(key: string): WarriorBodyEffects {
    return key === 'player_warrior' || key === 'player_warrior_modular'
      ? new WarriorBodyEffects(true)
      : WarriorBodyEffects.disabled;
  }

  private readonly contactRecoil: WarriorContactRecoil | null;
  private readonly rush: WarriorRushPose | null;

  private constructor(active: boolean) {
    this.contactRecoil = active ? new WarriorContactRecoil() : null;
    this.rush = active ? new WarriorRushPose() : null;
  }

  updateRush(dt: number, s: AnimState): boolean {
    return this.rush?.update(dt, s) ?? false;
  }

  get rushActive(): boolean {
    return this.rush?.active ?? false;
  }

  get rushArrivalStarted(): boolean {
    return this.rush?.arrivalStarted ?? false;
  }

  get rushRecovering(): boolean {
    return this.rush?.recovering ?? false;
  }

  get rushOwnsBody(): boolean {
    return this.rush?.ownsBody ?? false;
  }

  beginRush(ability: 'charge' | 'intervene'): void {
    this.rush?.begin(ability);
  }

  cancelRush(): void {
    this.rush?.cancel();
  }

  arrive(): boolean {
    return this.rush?.arrive() ?? false;
  }

  applyContactRecoil(pose: THREE.Object3D, dt: number, suppressed: boolean): void {
    this.contactRecoil?.apply(pose, dt, suppressed);
  }

  clearContactRecoil(): void {
    this.contactRecoil?.clear();
  }

  triggerContactRecoil(
    id: string,
    beat: number,
    height: number,
    root?: THREE.Object3D,
    source?: { x: number; z: number },
  ): boolean {
    return this.contactRecoil?.trigger(id, beat, height, root, source) ?? false;
  }
}
