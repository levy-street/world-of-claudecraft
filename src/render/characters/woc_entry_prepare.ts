// What world entry does with the WOC player bodies under the curtain, before any of them is
// built (Renderer.prewarmInitialScene awaits this ahead of its budgeted manifest, at entry
// and again after a graphics rebuild, which drops every prepared body). The files are
// resident by now: woc_entry_preload.ts awaited them in the deferred preload lane.
//
// Two steps, both off the live frame:
//
//   1. The local player's own look. Their hairstyle and facial hair are not entry-critical
//      (the launcher's preview normally fetched them; the rest of the head library is only
//      prefetched after first paint, woc_crowd_prefetch.ts); here they are asked for as a
//      demand and given a bounded chance to settle, so a player who entered with no preview
//      behind them (the boot resume after a WebView reload) does not meet their own
//      character bald on the first frame. Settled means resident OR failed: a file that is
//      not coming never holds the entry, and neither does a link too slow to be worth the
//      wait.
//
//   2. Both body fits' class keys. prepareVisual measures a key's body once (assets.ts), and
//      on a tier with dynamic shadows bakes its shadow stand-in (woc_shadow_stand_in.ts),
//      synchronously, on the first build of that key. The zone prewarm builds one rig per
//      class, all of the LOCAL player's fit, so the first player of the other fit used to
//      pay that inside the live frame they walked into view on (PR 4360 review, S8). A key
//      is one indivisible piece of work of a few milliseconds (about 7 ms a key in Node on
//      the shipped files, measured 2026-10-05 while a key still baked a whole far mesh
//      here; not measured again since it stopped, and never in a browser or on a phone),
//      too large to hide in a live frame on a slower machine. So they are paid here, a
//      slice at a time, under the curtain. Nothing is kept but the prepared data and
//      nothing new is fetched: the throwaway each key is measured on is the bare body, so
//      no armor set is pulled for it.
//
// It runs AHEAD of the prewarm manifest's budget clock on purpose: the first step waits on
// the network, and a network wait inside the manifest starves every entry behind it. It is
// announced like a manifest entry (`onStart`), so the entry crash probe names it.
import type { Entity } from '../../sim/types';
import { logAssetMissOnce } from './asset_miss_log';
import { prepareVisual, visualAssetsResident } from './assets';
import { VISUALS, visualKeyFor } from './manifest';
import { wocVisualKeys } from './woc_entry_core';
import { wocHeadTypeForGender } from './woc_head_catalog';
import { ensureWocHeadForAppearance, wocHeadFileState } from './woc_head_packs';
import { wocHeadAppearanceUrls, wocHeadAwaited } from './woc_head_stream_core';

/** The longest world entry waits for the local player's own hairstyle and facial hair. A
 *  backstop for a link too slow to hold the curtain for, never the normal end of the wait:
 *  that is the files settling, which on any link that just delivered the entry's critical
 *  set takes a fraction of this. */
export const WOC_ENTRY_LOOK_WAIT_MS = 4000;

/** How often the wait re-reads the head store (it has no settle signal for a failure). */
const LOOK_POLL_MS = 50;

/** The main-thread time one slice of prepares may take before the next key yields first. */
const PREPARE_SLICE_MS = 8;

/** The clock and the yield, injected so a Vitest drives both. */
export interface WocEntryPrepareClock {
  now(): number;
  /** Resolve after `ms` (0: the next task, so the page can paint and answer input). */
  wait(ms: number): Promise<void>;
}

const liveClock: WocEntryPrepareClock = {
  now: () => performance.now(),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Ask for the head files the local player's look draws and wait until they have settled
 * (every one resident, or any one failed) or WOC_ENTRY_LOOK_WAIT_MS has passed. Returns
 * whether the look is resident. Never rejects; a body with no WOC head (the Combat Mech)
 * has nothing to wait for.
 */
export async function settleWocEntryLook(
  player: Entity | null | undefined,
  clock: WocEntryPrepareClock = liveClock,
): Promise<boolean> {
  if (player?.kind !== 'player') return true;
  const fit = VISUALS[visualKeyFor(player)]?.wocCharacter?.fit;
  if (!fit) return true;
  const app = player.modularAppearance ?? null;
  if (ensureWocHeadForAppearance(fit, app)) return true;
  const urls = wocHeadAppearanceUrls(app, wocHeadTypeForGender(fit));
  const deadline = clock.now() + WOC_ENTRY_LOOK_WAIT_MS;
  while (wocHeadAwaited(urls.map(wocHeadFileState)) && clock.now() < deadline) {
    await clock.wait(LOOK_POLL_MS);
  }
  return urls.every((url) => wocHeadFileState(url) === 'resident');
}

/**
 * Prepare every WOC class key of both body fits whose files are resident, a slice at a time.
 * Returns how many keys are prepared. A key that cannot be prepared is logged once and left
 * to its first build, which takes the same fail-soft path as any other body.
 */
export async function prepareWocEntryVisuals(
  clock: WocEntryPrepareClock = liveClock,
): Promise<number> {
  let prepared = 0;
  let sliceStart = clock.now();
  for (const key of wocVisualKeys()) {
    if (!visualAssetsResident(key, false)) continue;
    if (clock.now() - sliceStart >= PREPARE_SLICE_MS) {
      await clock.wait(0);
      sliceStart = clock.now();
    }
    try {
      prepareVisual(key);
      prepared++;
    } catch (err) {
      logAssetMissOnce(
        `woc-entry-prepare:${key}`,
        `WOC body not prepared at world entry (${key}):`,
        err,
      );
    }
  }
  return prepared;
}

/** Both steps, in order: the bodies are prepared once nothing of the look is left to wait
 *  for. `onStart` announces the step to the host's diagnostics (the entry crash probe).
 *  Never rejects: this is a head start, and whatever it could not do is done by the first
 *  build that needs it. */
export async function prepareWocEntry(
  player: Entity | null | undefined,
  onStart?: () => void,
  clock: WocEntryPrepareClock = liveClock,
): Promise<void> {
  try {
    onStart?.();
  } catch {
    // Diagnostics must never change whether the step runs.
  }
  try {
    await settleWocEntryLook(player, clock);
    await prepareWocEntryVisuals(clock);
  } catch (err) {
    logAssetMissOnce('woc-entry-prepare', 'WOC world-entry preparation failed:', err);
  }
}
