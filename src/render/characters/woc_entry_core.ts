// Which WOC player files world entry loads: the entry-critical set of the loading model in
// src/render/CLAUDE.md "Asset loading". Three-free and DOM-free, and DERIVED from the
// manifest and the head catalog (never a typed list), so a new body fit or a new class joins
// the set by existing.
//
//   ENTRY-CRITICAL, awaited (wocEntryBodyUrls, wocEntryHeadCoreUrls): the minimum to draw ANY
//   player. Every WOC def's base and animation library (one of each per body fit) and the
//   core file of each fit's head type. With these resident before the Renderer exists, no
//   player body is ever held back by a download: the body is on screen, with its nameplate
//   and click target, the frame it enters range.
//
// Nothing else of a player is entry's: a hairstyle or facial hair file, an armor set and an
// under-armor atlas each have a stand-in (the bare head, the body's own suit and its atlas),
// stream the first time somebody wears them, and are prefetched after the first painted frame
// on a profile with the memory for it (woc_crowd_prefetch_core.ts).
import { VISUALS } from './manifest';
import type { WocFit } from './woc_armor_core';
import { wocHeadCoreUrl, wocHeadTypeForGender } from './woc_head_catalog';

/** Every WOC player visual key (both fits of every class), in manifest order. A mob def
 *  copied from a class body (the Tideglass Colossus's Reflections, manifest.ts) is no
 *  player: it shares the class body's files, which are entry's already, and is built when
 *  its encounter needs it. */
export function wocVisualKeys(): string[] {
  return Object.keys(VISUALS).filter(
    (key) => key.startsWith('player_') && VISUALS[key].wocCharacter !== undefined,
  );
}

/** The body fits the manifest ships a WOC body for. */
export function wocEntryFits(): WocFit[] {
  const fits = new Set<WocFit>();
  for (const key of wocVisualKeys()) {
    const fit = VISUALS[key].wocCharacter?.fit;
    if (fit) fits.add(fit);
  }
  return [...fits];
}

/** ENTRY-CRITICAL body files: the base and animation library of every body fit. */
export function wocEntryBodyUrls(): string[] {
  const urls = new Set<string>();
  for (const key of wocVisualKeys()) {
    const def = VISUALS[key];
    urls.add(def.url);
    for (const url of def.animUrls ?? []) urls.add(url);
  }
  return [...urls];
}

/** ENTRY-CRITICAL head files: the core of each body fit's head type. */
export function wocEntryHeadCoreUrls(): string[] {
  return [...new Set(wocEntryFits().map((fit) => wocHeadCoreUrl(wocHeadTypeForGender(fit))))];
}
