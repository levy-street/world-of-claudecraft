// What the world fetches right after first paint, ahead of need: the rest of the crowd set,
// step two of the loading model in src/render/CLAUDE.md "Asset loading". World entry made the
// minimum to draw ANY player resident (woc_entry_core.ts: both fits' base, animation library
// and head core), so nothing here can hold a body back. Each file listed below only saves a
// stand-in from showing the first time its wearer walks into view:
//
//   - every hairstyle and facial hair file of each fit's head type (the bare head stands in);
//   - every shipped armor set of both fits at the tier OTHER characters draw (the body's own
//     suit stands in); the top detail of a set is the local player's and the previews', and
//     stays on demand;
//   - every under-armor atlas a class body wears beneath its chest piece (the suit's own
//     atlas stands in).
//
// A constrained profile (every phone, every iOS host) prefetches NOTHING: its page already
// runs near its memory ceiling, the head store never frees a file, and whether the whole
// crowd set fits there is a measurement nobody has taken on a device. It keeps fetching on
// first sight, with the same stand-ins. So does a browser that asks to save data (the
// Save-Data hint): megabytes nobody has asked for yet are exactly what it is there to stop.
//
// Three-free and DOM-free, and DERIVED from the catalogs (never a typed list), so a new set,
// fit or hairstyle joins the plan by existing.
import { WOC_SHIPPED_SETS, wocSetManifest } from './woc_armor_catalog';
import { type WocTierProfile, wocArmorPackUrl, wocArmorTierFor } from './woc_armor_core';
import { wocEntryFits } from './woc_entry_core';
import { wocHeadTypeForGender } from './woc_head_catalog';
import { WOC_HEAD_STREAMED_SLOTS, wocHeadSlotUrls } from './woc_head_stream_core';

/** What the plan reads of the graphics profile: the static preset and memory class, never the
 *  frame-rate governor. The iOS flag is read beside the memory class it already implies
 *  (gfx.ts derives `constrainedMemory` from it), so a profile that sets only one of the two
 *  is still a phone. */
export interface WocCrowdPrefetchProfile extends WocTierProfile {
  readonly iosMemoryProfile?: boolean;
  /** The browser's Save-Data hint (the runner reads it; never a graphics setting). */
  readonly saveData?: boolean;
}

function constrained(profile: WocCrowdPrefetchProfile): boolean {
  return (
    profile.constrainedMemory || profile.iosMemoryProfile === true || profile.saveData === true
  );
}

/** The files one profile fetches ahead of need, by store. */
export interface WocCrowdPrefetchPlan {
  /** hairstyle and facial hair files (the head store) */
  readonly headFiles: readonly string[];
  /** armor packs at the crowd tier (the armor store) */
  readonly armorPacks: readonly string[];
  /** under-armor body atlases (the skin atlas store) */
  readonly underArmorAtlases: readonly string[];
}

const NOTHING: WocCrowdPrefetchPlan = { headFiles: [], armorPacks: [], underArmorAtlases: [] };

/** Every hairstyle and facial hair file of each body fit's head type (the files a head core
 *  does not carry). */
export function wocCrowdHeadFileUrls(): string[] {
  const urls = new Set<string>();
  for (const fit of wocEntryFits()) {
    const type = wocHeadTypeForGender(fit);
    for (const slot of WOC_HEAD_STREAMED_SLOTS) {
      for (const url of wocHeadSlotUrls(type, slot)) urls.add(url);
    }
  }
  return [...urls];
}

/** What `profile` fetches ahead of need: nothing on a constrained profile, else the rest of
 *  the crowd set at the tier other characters draw there. Reads only the static profile. */
export function wocCrowdPrefetchPlan(profile: WocCrowdPrefetchProfile): WocCrowdPrefetchPlan {
  if (constrained(profile)) return NOTHING;
  const tier = wocArmorTierFor(profile, 'crowd');
  const armorPacks: string[] = [];
  const atlases = new Set<string>();
  for (const fit of wocEntryFits()) {
    for (const set of WOC_SHIPPED_SETS) {
      armorPacks.push(wocArmorPackUrl(fit, set, tier));
      const atlas = wocSetManifest(fit, set)?.underArmorAtlas?.url;
      if (atlas) atlases.add(atlas);
    }
  }
  return { headFiles: wocCrowdHeadFileUrls(), armorPacks, underArmorAtlases: [...atlases] };
}

/** What tells two plans apart without comparing their lists: the prefetch runs once per
 *  signature, so a preset change that moves the crowd tier fetches the new tier's sets and
 *  one that does not fetches nothing twice. */
export function wocCrowdPrefetchSignature(profile: WocCrowdPrefetchProfile): string {
  return constrained(profile) ? 'none' : wocArmorTierFor(profile, 'crowd');
}
