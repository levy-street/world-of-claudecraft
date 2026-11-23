// The crowd prefetch: right after the first painted world frame, fetch the rest of the crowd
// set ahead of need, as background work (step two of the loading model in
// src/render/CLAUDE.md "Asset loading"). WHAT is fetched for which profile is the pure
// woc_crowd_prefetch_core.ts; this is the thin runner that hands each file to its store.
//
// Everything here is speculative, so everything is background work end to end:
//   - a download waits in the loader's background class (assets/load_queue_core.ts), behind
//     every file somebody needs now, and is promoted the moment a body asks for it;
//   - an armor pack's prepare rides the BACKGROUND lane of the renderer's work queue
//     (woc_armor_packs.ts prefetchWocArmorPack), so no frame pays for it;
//   - a file that fails is nobody's loss: its first wearer asks for it again.
// Nothing is attached and nothing is drawn here. A body that meets a file before it lands
// draws its stand-in exactly as it does on a profile that prefetches nothing.
import { loadGltf } from '../assets/loader';
import { renderLayerDisabled } from '../render_dev_flags';
import { prefetchWocArmorPack } from './woc_armor_packs';
import {
  type WocCrowdPrefetchProfile,
  wocCrowdPrefetchPlan,
  wocCrowdPrefetchSignature,
} from './woc_crowd_prefetch_core';
import { ensureWocHeadFile, wocHeadFileResident } from './woc_head_packs';

/** Fetch one hairstyle or facial hair file as background work and hand it to the head store
 *  once it is parsed (the store then answers from the loader's cache, with no second fetch).
 *  A body that needs the file first asks the store itself, which promotes the load. */
function prefetchWocHeadFile(url: string): void {
  if (wocHeadFileResident(url)) return;
  loadGltf(url, { priority: 'background' }).then(
    () => ensureWocHeadFile(url),
    () => undefined,
  );
}

/** `?woccrowdprefetch=off` (dev): nothing is fetched ahead of need, so every file streams on
 *  first sight as it does on a constrained profile. The A/B arm that prices the prefetch
 *  itself: the frames after first paint, and what it keeps resident. */
export const WOC_CROWD_PREFETCH_FLAG = 'woccrowdprefetch';

/** The browser's data-saver hint, false where it is unknown (the landing backdrop reads the
 *  same hint: sky.ts navigatorSaveData). */
function saveDataRequested(): boolean {
  if (typeof navigator === 'undefined') return false;
  type Hinted = { readonly saveData?: boolean };
  const nav = navigator as Navigator & {
    readonly connection?: Hinted;
    readonly mozConnection?: Hinted;
    readonly webkitConnection?: Hinted;
  };
  return (nav.connection ?? nav.mozConnection ?? nav.webkitConnection)?.saveData === true;
}

/** The plan signature the prefetch last ran for (null: not started in this page). */
let startedFor: string | null = null;

/**
 * Start fetching the rest of the crowd set for `profile`. Runs once per plan signature, so
 * the call after first paint starts it and a later preset change that moves the crowd tier
 * fetches that tier's sets (what is already resident or in flight is asked for again at no
 * cost). `loadAtlas` loads one under-armor atlas into the skin atlas store as background
 * work (assets.ts owns that store). Returns how many files this call asked for.
 */
export function startWocCrowdPrefetch(
  profile: WocCrowdPrefetchProfile,
  loadAtlas: (url: string) => void,
): number {
  if (renderLayerDisabled(WOC_CROWD_PREFETCH_FLAG)) return 0;
  const asked: WocCrowdPrefetchProfile = {
    tier: profile.tier,
    constrainedMemory: profile.constrainedMemory,
    iosMemoryProfile: profile.iosMemoryProfile,
    saveData: profile.saveData ?? saveDataRequested(),
  };
  const signature = wocCrowdPrefetchSignature(asked);
  if (signature === startedFor) return 0;
  startedFor = signature;
  const plan = wocCrowdPrefetchPlan(asked);
  for (const url of plan.headFiles) prefetchWocHeadFile(url);
  for (const url of plan.armorPacks) prefetchWocArmorPack(url);
  for (const url of plan.underArmorAtlases) loadAtlas(url);
  return plan.headFiles.length + plan.armorPacks.length + plan.underArmorAtlases.length;
}

/** Whether the prefetch has started in this page: the world painted its first frame. A
 *  graphics change re-plans it only then, never on the launcher, where nothing of the world
 *  may start. */
export function wocCrowdPrefetchStarted(): boolean {
  return startedFor !== null;
}

/** Test seam: forget that the prefetch ran. */
export function resetWocCrowdPrefetchForTest(): void {
  startedFor = null;
}
