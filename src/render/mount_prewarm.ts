// Rideable-mount program prewarm (#2571): one hidden rig per catalog MountKey
// so the FIRST sighting of any mount, yours or another player's, never links
// its shader programs on a live frame. Mount GLBs are lazyPreload
// (characters/assets.ts), so warming one is real async fetch work, unlike the
// purely procedural vfx.weapon-skins rigs beside it in renderer.ts. This
// module builds each hidden rig AND stages it into the shared prewarm group
// (renderer.ts's `vfx.mount-programs` manifest entry owns only compiling the
// staged rig and scheduling the pass as idle-time background work: see that
// entry for why).

import * as THREE from 'three';
import { DEFAULT_MOUNT, type MountKey } from '../sim/content/mounts';
import { type CharacterVisual, createMountVisual } from './characters';
import { mountAssetsReady, preloadMountAssets } from './characters/assets';
import { MOUNT_VISUAL_SPECS } from './mount_visuals';
import { setRenderCategory } from './renderer_diagnostics';

/**
 * Bound on how long one mount's lazy GLB fetch may hold up a caller. Mount
 * fetches are memoized with no fetch-level timeout (assets/loader.ts retries
 * but never aborts a stalled connection), so an unbounded await here could
 * park a caller (in particular the resume lane's serial per-unit await,
 * see renderer.ts's vfx.mount-programs comment) on a never-settling
 * connection for the rest of the session. On timeout the underlying fetch
 * keeps running in the background (still memoized for a later successful
 * pass); this just stops THIS pass waiting on it, same as a genuine failure.
 */
const MOUNT_PREWARM_FETCH_TIMEOUT_MS = 8000;

function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve('timeout');
      },
    );
  });
}

/** The mounts worth warming for THIS session: the horse (the one purchasable
 *  mount, the default pick) plus the mounts the player owns, in catalog
 *  order, deduplicated. Upstream warmed every catalog key; on this branch the
 *  first sight of any other mount (a rare collectible on another player, a
 *  developer-only special) already goes through the live view gate with a
 *  stand-in, so warming all nine cost nine lazy GLB fetches (4.5 MB, the
 *  Groundshaker alone 1.16 MB), nine hidden rigs and nine compiles on the
 *  post-reveal resume lane for content most sessions never draw. Validated
 *  against MOUNT_VISUAL_SPECS (typed Record<MountKey, ...>), so an owned key
 *  the specs do not carry is dropped rather than thrown. */
export function mountPrewarmKeys(owned: readonly MountKey[] = []): MountKey[] {
  const wanted = new Set<MountKey>([DEFAULT_MOUNT, ...owned]);
  return (Object.keys(MOUNT_VISUAL_SPECS) as MountKey[]).filter((key) => wanted.has(key));
}

function createReadyMountPrewarmVisual(key: MountKey): CharacterVisual | null {
  const { visualKey } = MOUNT_VISUAL_SPECS[key];
  if (!mountAssetsReady(visualKey)) return null;
  const visual = createMountVisual(visualKey);
  visual.root.name = `prewarm-mount:${key}`;
  visual.root.position.set(0, -1000, 0); // off-screen; compile ignores position
  setRenderCategory(visual.root, 'prewarm');
  return visual;
}

/**
 * Build one hidden, off-screen rig for a mount, resolving its lazy GLB first
 * if it has not been fetched yet (bounded by MOUNT_PREWARM_FETCH_TIMEOUT_MS).
 * Returns null when the asset never arrives in time (a fetch failure or a
 * stalled connection): the caller skips this mount for the pass and a later
 * idle pass retries it, exactly like every other lazy character asset miss
 * in this renderer (never a synchronous throw on the render path).
 */
export async function buildMountPrewarmVisual(key: MountKey): Promise<CharacterVisual | null> {
  const { visualKey } = MOUNT_VISUAL_SPECS[key];
  if (!mountAssetsReady(visualKey)) {
    await raceTimeout(
      preloadMountAssets(visualKey).catch(() => undefined),
      MOUNT_PREWARM_FETCH_TIMEOUT_MS,
    );
  }
  return createReadyMountPrewarmVisual(key);
}

export interface MountPrewarmStageResult {
  /** The shared prewarm group, created and added to `scene` on first use. */
  group: THREE.Group;
  visual: CharacterVisual;
}

/**
 * Build a mount's hidden rig (if its asset resolves in time) and parent it
 * into `group`, creating and adding that group to `scene` on the first call.
 * Callers must feed the returned `group` back in as `group` on the next call
 * so the whole pass shares one group; `group` is `THREE.Group | null` because
 * a THREE.Group instance is expensive to construct speculatively per call.
 *
 * IMPORTANT: never add `visual.root` to `scene` directly. `Object3D.add`
 * reparents its argument out of any prior parent first, so adding a rig to
 * both `group` and `scene` silently detaches it from `group`, leaving the
 * group empty (and never itself added to `scene`) while the rig stays
 * resident in the live scene graph forever, unreachable by every cleanup
 * path that walks the group.
 */
export async function stageMountPrewarmVisual(
  scene: THREE.Scene,
  group: THREE.Group | null,
  key: MountKey,
): Promise<MountPrewarmStageResult | null> {
  const visual = await buildMountPrewarmVisual(key);
  return stageReadyMountPrewarmVisual(scene, group, visual);
}

function stageReadyMountPrewarmVisual(
  scene: THREE.Scene,
  group: THREE.Group | null,
  visual: CharacterVisual | null,
): MountPrewarmStageResult | null {
  if (!visual) return null;
  let targetGroup = group;
  if (!targetGroup) {
    targetGroup = new THREE.Group();
    scene.add(targetGroup);
  }
  targetGroup.add(visual.root);
  return { group: targetGroup, visual };
}

/**
 * Stages only already-resident mount assets. This is the world-entry path:
 * slow lazy GLB fetches stay out of the loading-cover budget and are retried
 * by the explicit background resume units.
 */
export function stageResidentMountPrewarmVisual(
  scene: THREE.Scene,
  group: THREE.Group | null,
  key: MountKey,
): MountPrewarmStageResult | null {
  return stageReadyMountPrewarmVisual(scene, group, createReadyMountPrewarmVisual(key));
}
