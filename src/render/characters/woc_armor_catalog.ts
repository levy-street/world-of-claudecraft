// Every armor piece a WOC body can show, per body fit: the shipped sets' items
// (the warrior, the paladin and the seven class sets, straight from their
// manifests) plus the items of every set a display row names
// (woc_item_display.ts), minted from the class sets' node naming convention.
// Pure and three-free; woc_parts_core.ts resolves worn ids through it, so an
// item that shows another set's piece dresses exactly like the wearer's own.

import type { WocFit } from './woc_armor_core';
import {
  WOC_CLASS_SETS,
  WOC_PALADIN_FEMALE_MANIFEST,
  WOC_PALADIN_MANIFEST,
  WOC_WARRIOR_FEMALE_MANIFEST,
  WOC_WARRIOR_MANIFEST,
  type WocArmorItem,
  type WocCharacterManifest,
  type WocClassSet,
  wocClassManifest,
} from './woc_character_manifest';
import { WOC_ITEM_DISPLAY } from './woc_item_display';

/** The sets shipped as armor files for both fits (build_woc_split.mjs CLASSES). */
export const WOC_SHIPPED_SETS: readonly string[] = ['warrior', 'paladin', ...WOC_CLASS_SETS];

const CLASS_SET_IDS: ReadonlySet<string> = new Set<string>(WOC_CLASS_SETS);

const setManifestCache = new Map<string, WocCharacterManifest>();

/** A shipped set's own manifest (its items and nodes), or null for a set that has none. */
export function wocSetManifest(fit: WocFit, set: string): WocCharacterManifest | null {
  if (set === 'warrior')
    return fit === 'female' ? WOC_WARRIOR_FEMALE_MANIFEST : WOC_WARRIOR_MANIFEST;
  if (set === 'paladin')
    return fit === 'female' ? WOC_PALADIN_FEMALE_MANIFEST : WOC_PALADIN_MANIFEST;
  if (!CLASS_SET_IDS.has(set)) return null;
  const key = `${fit}:${set}`;
  let hit = setManifestCache.get(key);
  if (!hit) {
    hit = wocClassManifest(set as WocClassSet, fit);
    setManifestCache.set(key, hit);
  }
  return hit;
}

/** A set id as it appears in node names: `iron_crown` -> `Iron_Crown`. */
export function wocSetNodeLabel(set: string): string {
  return set
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join('_');
}

/** The convention a set without a manifest of its own is minted from: per armor slot, the
 *  piece id and the node suffixes (the class sets' names, woc_character_manifest.ts). */
const CONVENTION: Readonly<
  Record<string, { piece: string; nodes: readonly string[]; hidesAppearance?: readonly string[] }>
> = {
  head: { piece: 'helm', nodes: ['Helm'], hidesAppearance: ['hair'] },
  chest: { piece: 'chest', nodes: ['Chest_Front', 'Chest_Back'] },
  arms: { piece: 'shoulders', nodes: ['Shoulder_L', 'Shoulder_R'] },
  hands: { piece: 'gauntlets', nodes: ['Gauntlet_L', 'Gauntlet_R'] },
  waist: { piece: 'waist', nodes: ['Waist'] },
  feet: { piece: 'boots', nodes: ['Boot_L', 'Boot_R'] },
};

function mintedSetItems(fit: WocFit, set: string): Record<string, WocArmorItem> {
  const label = wocSetNodeLabel(set);
  const prefix = `Armor_${fit === 'female' ? 'Female_' : ''}${label}`;
  const items: Record<string, WocArmorItem> = {};
  for (const [slot, spec] of Object.entries(CONVENTION)) {
    items[`${fit}_${set}_${spec.piece}`] = {
      label: `${label.replace(/_/g, ' ')} ${spec.piece}`,
      slot,
      set,
      nodes: spec.nodes.map((n) => `${prefix}_${n}`),
      ...(spec.hidesAppearance ? { hidesAppearance: spec.hidesAppearance } : {}),
    };
  }
  return items;
}

const setItemsCache = new Map<string, Readonly<Record<string, WocArmorItem>>>();

/** Every armor item of one set in one fit, by asset id. */
export function wocSetItems(fit: WocFit, set: string): Readonly<Record<string, WocArmorItem>> {
  const key = `${fit}:${set}`;
  let hit = setItemsCache.get(key);
  if (!hit) {
    hit = wocSetManifest(fit, set)?.items ?? mintedSetItems(fit, set);
    setItemsCache.set(key, hit);
  }
  return hit;
}

/** The asset id of a set's piece filling `armorSlot` in `fit`, or null when it has none. */
export function wocSetSlotAsset(fit: WocFit, set: string, armorSlot: string): string | null {
  for (const [id, item] of Object.entries(wocSetItems(fit, set))) {
    if (item.slot === armorSlot) return id;
  }
  return null;
}

const catalogCache = new Map<WocFit, ReadonlyMap<string, WocArmorItem>>();

/** Every item a body of `fit` can show: the shipped sets plus every set a display row names. */
export function wocFitCatalog(fit: WocFit): ReadonlyMap<string, WocArmorItem> {
  let hit = catalogCache.get(fit);
  if (!hit) {
    const sets = new Set<string>(WOC_SHIPPED_SETS);
    for (const row of Object.values(WOC_ITEM_DISPLAY)) sets.add(row.set);
    const map = new Map<string, WocArmorItem>();
    for (const set of sets) {
      for (const [id, item] of Object.entries(wocSetItems(fit, set))) {
        if (!map.has(id)) map.set(id, item);
      }
    }
    hit = map;
    catalogCache.set(fit, hit);
  }
  return hit;
}

/** An item by asset id: the manifest's own, else any set in its fit's catalog. */
export function wocItemRecord(
  manifest: WocCharacterManifest,
  id: string,
): WocArmorItem | undefined {
  return manifest.items[id] ?? wocFitCatalog(manifest.fit).get(id);
}
