// Weapon-model idle animation: plays the clips baked into a weapon GLB itself.
//
// The magical Armory tiers (Hoarfrost epics, Fallen Star legendaries) ship split
// models — a base weapon plus separately-authored moving parts hung off pivot
// nodes — and each carries ONE looping clip that spins, orbits, bobs or shakes
// those parts (`legendary_idle`, `rings_orbit`, `starfall_idle`, `idle`, ...).
// Nothing else in the renderer touched them: CharacterVisual runs a mixer for
// the humanoid RIG only, and the held weapon is a plain attached prop, so the
// solheim sun-disk sat frozen in the hand and on the store turntable alike.
//
// This is the missing mixer. It is deliberately clip-name agnostic — it plays
// every clip a model ships, looping forever — so an artist can name the clip
// whatever the split describes without also editing the engine.
//
// Cost: one AnimationMixer per animated payload, and only for the handful of
// skins that ship clips (weaponModelClips is empty for every other model, and
// build() then allocates nothing at all).

import * as THREE from 'three';
import { weaponModelClips } from './assets';

interface WeaponClipRig {
  mixer: THREE.AnimationMixer;
  root: THREE.Object3D;
}

export class WeaponIdleAnimator {
  private rigs: WeaponClipRig[] = [];

  /** True while at least one payload is actually animating (used by callers
   *  that want to skip per-frame work entirely). */
  get active(): boolean {
    return this.rigs.length > 0;
  }

  /** Rebuild for a fresh set of attached weapon payloads. Each payload is an
   *  attachProp/weaponSkinDisplayModel clone tagged with its source url, so the
   *  clips resolve straight off the cached GLTF and are SHARED across every
   *  clone — a clip is immutable sampling data, only the mixer is per-rig. */
  build(payloads: readonly THREE.Object3D[]): void {
    this.dispose();
    for (const payload of payloads) {
      const clips = weaponModelClips(payload.userData.weaponModelUrl as string | undefined);
      if (clips.length === 0) continue;
      const mixer = new THREE.AnimationMixer(payload);
      for (const clip of clips) {
        const action = mixer.clipAction(clip);
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.play();
      }
      this.rigs.push({ mixer, root: payload });
    }
  }

  /** Advance every payload's clip. No-op without animated payloads. */
  update(dt: number): void {
    for (const rig of this.rigs) rig.mixer.update(dt);
  }

  /** Drop the mixers and restore each payload's bound nodes to their rest pose,
   *  so a re-attach (gear swap, sheathe, skin change) never inherits a stale
   *  mid-clip transform on a node the next model happens to share a name with. */
  dispose(): void {
    for (const rig of this.rigs) {
      rig.mixer.stopAllAction();
      rig.mixer.uncacheRoot(rig.root);
    }
    this.rigs.length = 0;
  }
}
