// The TWIN of a clip: the same animation under the same name, as a second clip object.
//
// A one-shot started again while it still drives the rig (an ability strike on the swing
// just begun) must blend from where the running one is, and one action cannot crossfade
// into itself. A mixer keeps ONE action per clip and root (AnimationMixer.clipAction keys
// on the clip's uuid), so the second action needs a clip of its own: this clone.
//
// The twin is data like its source, so it is minted once per source clip and shared by
// every rig, each of which binds its own action to it (CharacterVisual.twinOf). Weak on the
// source: a library that is let go takes its twins with it.
import type * as THREE from 'three';

const twins = new WeakMap<THREE.AnimationClip, THREE.AnimationClip>();

/** The twin of `clip`, minted on first use and handed to every caller after. Never mutate
 *  what this returns. */
export function twinClipOf(clip: THREE.AnimationClip): THREE.AnimationClip {
  let twin = twins.get(clip);
  if (!twin) {
    twin = clip.clone();
    twins.set(clip, twin);
  }
  return twin;
}
