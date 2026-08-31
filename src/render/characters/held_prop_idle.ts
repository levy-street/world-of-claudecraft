// Ambient idle animation for held props (weapons/offhands whose GLB ships its
// own looping clip, e.g. the Ignivar legendaries' piston-and-gear "Idle").
// Each animated payload gets its OWN mixer rooted at the payload, never the
// character mixer: clip tracks bind by node NAME, and two props can ship
// colliding part names (both Tripo exports carry tripo_part_N nodes), so a
// shared mixer could bind a shield track onto a hammer node. attachProp
// registers every animated payload here at attach time (hand AND stowed pose:
// a sheathed engine keeps idling on the back); CharacterVisual pumps
// updateHeldPropIdles from its animated update branch, and entries self-prune
// once their payload is detached (every replace path calls removeFromParent).
import * as THREE from 'three';

/** Index of the clip to loop for a held prop: the clip named "Idle" (any case),
 *  else the first clip, else -1 for an empty list. Pure, Node-testable. */
export function selectHeldPropIdleClip(names: readonly string[]): number {
  if (names.length === 0) return -1;
  const idle = names.findIndex((n) => n.toLowerCase() === 'idle');
  return idle >= 0 ? idle : 0;
}

interface HeldPropIdleEntry {
  payload: THREE.Object3D;
  mixer: THREE.AnimationMixer;
}

// Registry key on the character model root's userData: the payloads' lifecycle
// (attach/replace/stow) lives in assets.ts free functions that only share the
// root object, so the root carries the per-character list.
const REGISTRY_KEY = 'heldPropIdleEntries';

function registryOf(root: THREE.Object3D): HeldPropIdleEntry[] {
  const existing = root.userData[REGISTRY_KEY] as HeldPropIdleEntry[] | undefined;
  if (existing) return existing;
  const list: HeldPropIdleEntry[] = [];
  root.userData[REGISTRY_KEY] = list;
  return list;
}

/** Start the payload's own looping idle. No-op when the source GLB has no
 *  clips (every static weapon), so the common path costs one length check. */
export function registerHeldPropIdle(
  root: THREE.Object3D,
  payload: THREE.Object3D,
  clips: readonly THREE.AnimationClip[],
): void {
  const index = selectHeldPropIdleClip(clips.map((c) => c.name));
  if (index < 0) return;
  const mixer = new THREE.AnimationMixer(payload);
  const action = mixer.clipAction(clips[index]);
  action.setLoop(THREE.LoopRepeat, Infinity);
  action.play();
  registryOf(root).push({ payload, mixer });
}

/** Advance every live held-prop idle; drop entries whose payload was detached
 *  (removeFromParent leaves parent null, the shared detach signal for every
 *  swap/stow/replace path). Compacts in place, no per-frame allocation. */
export function updateHeldPropIdles(root: THREE.Object3D, dt: number): void {
  const list = root.userData[REGISTRY_KEY] as HeldPropIdleEntry[] | undefined;
  if (!list || list.length === 0) return;
  let write = 0;
  for (const entry of list) {
    if (!entry.payload.parent) {
      releaseEntry(entry);
      continue;
    }
    list[write++] = entry;
    entry.mixer.update(dt);
  }
  list.length = write;
}

function releaseEntry(entry: HeldPropIdleEntry): void {
  entry.mixer.stopAllAction();
  entry.mixer.uncacheRoot(entry.payload);
}

/** Drop detached entries WITHOUT advancing time: the replace/stow paths call
 *  this right after their removeFromParent sweep, so a pooled or offscreen
 *  visual (whose animated update may not run again for a while) never holds a
 *  stale mixer plus its detached payload subtree between swaps. */
export function pruneHeldPropIdles(root: THREE.Object3D): void {
  const list = root.userData[REGISTRY_KEY] as HeldPropIdleEntry[] | undefined;
  if (!list || list.length === 0) return;
  let write = 0;
  for (const entry of list) {
    if (!entry.payload.parent) {
      releaseEntry(entry);
      continue;
    }
    list[write++] = entry;
  }
  list.length = write;
}

/** Terminal release for CharacterVisual.dispose(): stop and unbind every
 *  mixer (attached or not) and empty the registry. */
export function disposeHeldPropIdles(root: THREE.Object3D): void {
  const list = root.userData[REGISTRY_KEY] as HeldPropIdleEntry[] | undefined;
  if (!list) return;
  for (const entry of list) releaseEntry(entry);
  list.length = 0;
}
