// The first-person camera's thin consumer over first_person_core.ts. The
// renderer calls place() once per frame, AFTER the chase camera has placed
// itself and after the entity loop has set the local view's visibility, so
// first person only overrides the finished chase pose and never fights it:
// leaving first person needs no restore beyond the head bone, because the
// next frame's chase camera and entity loop rewrite everything else.

import type * as THREE from 'three';
import type { CharacterVisual } from './characters';
import {
  createFirstPersonPose,
  FIRST_PERSON_FALLBACK_EYE,
  type FirstPersonMode,
  firstPersonActive,
  firstPersonEyeHeight,
  firstPersonHiding,
  firstPersonModeFromSetting,
  firstPersonPoseInto,
} from './first_person_core';
import { lookAtFrozen } from './static_matrix';

/** The slice of the renderer's EntityView the rig reads. */
export interface FirstPersonSelfView {
  group: THREE.Object3D;
  visual: CharacterVisual | null;
  height: number;
  mountLift: number;
  liveScale: number;
  wasSwimming: boolean;
}

export class FirstPersonRig {
  private mode: FirstPersonMode = 0;
  private headHiddenOn: CharacterVisual | null = null;
  private readonly pose = createFirstPersonPose();

  /** The firstPersonMode setting (0 off, 1 body, 2 no body). */
  setMode(value: number): void {
    this.mode = firstPersonModeFromSetting(value);
  }

  /**
   * Take the camera over when first person is engaged. `selfPos` is the
   * fallback foot point before the local view exists; `yaw` and `pitch` are
   * the chase camera's. Returns true when first person placed the camera.
   */
  place(
    camera: THREE.PerspectiveCamera,
    lookAt: THREE.Vector3,
    self: FirstPersonSelfView | undefined,
    selfPos: THREE.Vector3,
    yaw: number,
    pitch: number,
    camDist: number,
    blocked: boolean,
  ): boolean {
    // Upright eye height and base-rig head hiding do not describe swimming
    // or alternate forms. Keep their existing chase framing until they return.
    const active = firstPersonActive({
      mode: this.mode,
      camDist,
      blocked: blocked || !!self?.wasSwimming || self?.visual?.root.visible === false,
    });
    const hiding = firstPersonHiding(this.mode, active);
    this.syncHead(hiding.head && !hiding.body ? (self?.visual ?? null) : null);
    if (!active) return false;
    // The entity loop shows the local view every frame, so this hide lasts
    // exactly one frame and leaving first person restores it on its own.
    if (hiding.body && self) self.group.visible = false;
    const foot = self ? self.group.position : selfPos;
    const eye = self
      ? firstPersonEyeHeight(self.height, self.mountLift, self.liveScale)
      : FIRST_PERSON_FALLBACK_EYE;
    const p = firstPersonPoseInto(this.pose, foot.x, foot.y, foot.z, yaw, pitch, eye);
    camera.position.set(p.x, p.y, p.z);
    lookAt.set(p.lookX, p.lookY, p.lookZ);
    lookAtFrozen(camera, lookAt);
    return true;
  }

  /** Collapse the head on `target` (null: no head hidden), restoring any
   *  other visual it was hidden on (a skin swap rebuilds the visual). */
  private syncHead(target: CharacterVisual | null): void {
    if (this.headHiddenOn && this.headHiddenOn !== target) this.headHiddenOn.setHeadHidden(false);
    // Every frame while hidden: a clip that keys the head's scale would
    // otherwise restore it on its next mixer update.
    target?.setHeadHidden(true);
    this.headHiddenOn = target;
  }
}
