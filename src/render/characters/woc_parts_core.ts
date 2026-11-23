// Which parts of a WOC modular body are drawn: the pure selection rule behind
// the artist's handoff adapter (modular-character.mjs `apply()`), three-free so
// a Vitest reads it directly, plus the renderer-owned mapping from the game's
// worn equipment onto the manifest's ASSET ids.
//
// The rule, in one paragraph: the base body always shows; every worn armor item
// adds its nodes; every appearance slot adds its selected variant's nodes unless
// a worn item hides that slot (the helm hides the hair, and taking the helm off
// restores it); a required appearance slot can never
// be empty; and an armor slot with no mesh (legs, back) selects nothing.
//
// The equipment mapping is the handoff's integration table: the game's helmet,
// shoulder, gloves, chest, waist and feet slots map onto the manifest's head,
// arms, hands, chest, waist and feet; legs and back are reserved and stay empty
// (the body's own trousers show); weapons ride the separate held-item path.
// An equipped armor item shows the piece its display row names
// (woc_item_display.ts), else its wearer's class piece for that slot. An empty
// slot shows nothing; the full-kit default is only for standalone previews.
//
// A worn id resolves through the manifest's own items first and then the fit's
// whole catalog (woc_armor_catalog.ts), so another set's piece dresses exactly
// like the class's own; which armor FILES a worn set needs is wocWornSets.

import type { EquipSlot, PlayerClass } from '../../sim/types';
import { wocFitCatalog, wocItemRecord, wocSetSlotAsset } from './woc_armor_catalog';
import type { WocCharacterManifest } from './woc_character_manifest';
import { WOC_ITEM_DISPLAY } from './woc_item_display';

/** Classes whose player body is a WOC modular character rather than a KayKit
 *  rig. A class listed here never composes the KayKit modular library (its
 *  authored look, sliders and kit are ignored in-world, at char-select and on
 *  the creation turntable) and keeps its fixed `player_<class>` def; the
 *  manifest test pins that every such def carries a `wocCharacter` manifest. */
export const WOC_BODY_CLASSES: ReadonlySet<PlayerClass> = new Set<PlayerClass>([
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'mage',
  'priest',
  'warlock',
  'druid',
  'shaman',
]);

/** Whether a class's body composes the KayKit modular library (false for a WOC body). */
export function classBodyComposes(cls: PlayerClass): boolean {
  return !WOC_BODY_CLASSES.has(cls);
}

/** Manifest armor slot per game equip slot. Slots absent here (legs, back,
 *  neck, rings, both hands) select no armor mesh. */
export const WOC_ARMOR_SLOT_BY_EQUIP_SLOT: Readonly<Partial<Record<EquipSlot, string>>> = {
  helmet: 'head',
  shoulder: 'arms',
  gloves: 'hands',
  chest: 'chest',
  waist: 'waist',
  feet: 'feet',
};

/** Manifest armor slot -> asset id (null = nothing worn in that slot). */
export type WocWorn = Readonly<Record<string, string | null>>;
/** Manifest appearance slot -> variant id (null = the optional slot is empty). */
export type WocAppearance = Readonly<Record<string, string | null>>;

/** The equip slots that can dress a WOC body, in a fixed order (diffs read it). */
export const WOC_DRESSABLE_EQUIP_SLOTS: readonly EquipSlot[] = Object.keys(
  WOC_ARMOR_SLOT_BY_EQUIP_SLOT,
) as EquipSlot[];

/** The slot's own piece when an equipped item has no mapping of its own: the
 *  first manifest item filling that slot, or null for a slot with no mesh. */
export function wocSlotFallbackAsset(
  manifest: WocCharacterManifest,
  armorSlot: string,
): string | null {
  for (const [id, item] of Object.entries(manifest.items)) if (item.slot === armorSlot) return id;
  return null;
}

/** The armor piece a worn item shows: its display row's set piece for the slot
 *  (woc_item_display.ts), else the class's own piece; null for an empty slot or
 *  one with no mesh. */
export function wocArmorAssetFor(
  manifest: WocCharacterManifest,
  equipSlot: EquipSlot,
  itemId: string | null | undefined,
): string | null {
  const armorSlot = WOC_ARMOR_SLOT_BY_EQUIP_SLOT[equipSlot];
  if (!armorSlot || !itemId) return null;
  const row = WOC_ITEM_DISPLAY[itemId];
  if (row) {
    const shown = wocSetSlotAsset(manifest.fit, row.set, armorSlot);
    if (shown) return shown;
  }
  return wocSlotFallbackAsset(manifest, armorSlot);
}

/** The worn set a player's equipment resolves to. `helmHidden` (the paperdoll
 *  eye) empties the head slot without touching the rest of the kit. */
export function wocWornFromEquipment(
  manifest: WocCharacterManifest,
  equipped: Readonly<Partial<Record<EquipSlot, string>>> | null | undefined,
  helmHidden: boolean,
): WocWorn {
  const worn: Record<string, string | null> = {};
  for (const slot of Object.keys(manifest.armorSlots)) worn[slot] = null;
  for (const equipSlot of WOC_DRESSABLE_EQUIP_SLOTS) {
    const armorSlot = WOC_ARMOR_SLOT_BY_EQUIP_SLOT[equipSlot];
    if (!armorSlot) continue;
    worn[armorSlot] = wocArmorAssetFor(manifest, equipSlot, equipped?.[equipSlot] ?? null);
  }
  if (helmHidden) worn.head = null;
  return worn;
}

/** The manifest's default kit: what a portrait, a preview with no equipment
 *  handed in, and the shared far-LOD bake wear. */
export function wocDefaultWorn(manifest: WocCharacterManifest): WocWorn {
  return { ...manifest.defaultEquipment };
}

export function wocDefaultAppearance(manifest: WocCharacterManifest): WocAppearance {
  return { ...manifest.defaultAppearance };
}

/**
 * The node names drawn for an appearance + worn set: the handoff adapter's
 * `apply()`. Fail-soft on purpose (a stale id selects nothing rather than
 * throwing on a render path); `tests/woc_character.test.ts` pins that every id
 * the game can hand in is valid.
 */
export function wocVisibleParts(
  manifest: WocCharacterManifest,
  appearance: WocAppearance,
  worn: WocWorn,
): Set<string> {
  const shown = new Set<string>(manifest.baseNodes);
  const hiddenAppearance = new Set<string>();
  for (const [slot, id] of Object.entries(worn)) {
    if (id === null || id === undefined) continue;
    const item = wocItemRecord(manifest, id);
    if (!item || item.slot !== slot) continue;
    for (const name of item.nodes) shown.add(name);
    for (const hidden of item.hidesAppearance ?? []) hiddenAppearance.add(hidden);
  }
  for (const [slot, id] of Object.entries(appearance)) {
    const def = manifest.appearance[slot];
    if (!def) continue;
    // A required slot never goes empty: an invalid or null choice keeps the
    // default variant, which every manifest is pinned to carry.
    const chosen = id !== null && def.variants[id] ? id : def.required ? 'default' : null;
    if (chosen === null || hiddenAppearance.has(slot)) continue;
    const variant = def.variants[chosen];
    if (!variant) continue;
    for (const name of variant.nodes) shown.add(name);
  }
  return shown;
}

/** Every node name the manifest can ever select (base, every variant, every item
 *  of its own and of every set its fit's catalog carries), memoized per manifest. */
export function wocAllPartNames(manifest: WocCharacterManifest): readonly string[] {
  const hit = allPartNamesCache.get(manifest);
  if (hit) return hit;
  const names = new Set<string>(wocBodyPartNames(manifest));
  for (const item of Object.values(manifest.items)) for (const n of item.nodes) names.add(n);
  for (const item of wocFitCatalog(manifest.fit).values()) for (const n of item.nodes) names.add(n);
  const out = [...names];
  allPartNamesCache.set(manifest, out);
  return out;
}
const allPartNamesCache = new WeakMap<WocCharacterManifest, readonly string[]>();

/** The node names the BASE file carries (the body and every appearance variant): the
 *  parts a body always resolves, where an armor piece resolves only once its set's
 *  file is attached. */
export function wocBodyPartNames(manifest: WocCharacterManifest): readonly string[] {
  const names = new Set<string>(manifest.baseNodes);
  for (const slot of Object.values(manifest.appearance)) {
    for (const variant of Object.values(slot.variants)) for (const n of variant.nodes) names.add(n);
  }
  return [...names];
}

/** The armor sets a worn set draws from (the files it needs), in slot order. */
export function wocWornSets(manifest: WocCharacterManifest, worn: WocWorn): string[] {
  const sets: string[] = [];
  for (const [slot, id] of Object.entries(worn)) {
    if (id === null || id === undefined) continue;
    const item = wocItemRecord(manifest, id);
    if (!item || item.slot !== slot || sets.includes(item.set)) continue;
    sets.push(item.set);
  }
  return sets;
}

/** The armor sets a manifest's own items come from (its class set). */
export function wocManifestSets(manifest: WocCharacterManifest): string[] {
  const sets: string[] = [];
  for (const item of Object.values(manifest.items))
    if (!sets.includes(item.set)) sets.push(item.set);
  return sets;
}

/** The canonical anatomy (the body and any part cut into its base, no armor):
 *  what the height normalization measures up to the pinned crown
 *  (woc_armor_core.ts WOC_ANATOMY_TOP), so a tall helm can never shrink the
 *  whole character and every loadout shares one scale. */
export function wocAnatomyParts(manifest: WocCharacterManifest): Set<string> {
  const bare: Record<string, string | null> = {};
  for (const slot of Object.keys(manifest.armorSlots)) bare[slot] = null;
  return wocVisibleParts(manifest, wocDefaultAppearance(manifest), bare);
}

/** The body atlas the worn set selects: the manifest's under-armor atlas while
 *  its slot is filled (the paladin's cloth under its chest plate), else null
 *  for the GLB's own black suit. */
export function wocUnderArmorAtlas(manifest: WocCharacterManifest, worn: WocWorn): string | null {
  const swap = manifest.underArmorAtlas;
  return swap && worn[swap.slot] ? swap.url : null;
}

/** The merged-mesh suffix rig_merge.ts mints (`<canon>_bodymerged`). */
export const WOC_MERGED_SUFFIX = '_bodymerged';

/** The manifest node a three.js mesh name stands for: rig_merge's
 *  `_bodymerged` suffix and GLTFLoader's `_<n>` primitive split both come off
 *  (a two-material boot loads as `Armor_Female_Warrior_Boot_L_1` and `_2`,
 *  under a Group carrying the node's own name). */
export function wocNodeNameOf(meshName: string): string {
  const base = meshName.endsWith(WOC_MERGED_SUFFIX)
    ? meshName.slice(0, -WOC_MERGED_SUFFIX.length)
    : meshName;
  return base.replace(/_\d+$/, '');
}

/** The merge partition a mesh belongs to: its manifest item (both chest
 *  halves, both boots), its appearance slot, or the base body, and a node the
 *  manifest never names stays alone. Two independently toggleable parts must
 *  never share a merged mesh, whatever material they happen to share (the
 *  female pack's boots and gauntlets both use one leather material). */
export function wocMergePartition(manifest: WocCharacterManifest, meshName: string): string {
  const node = wocNodeNameOf(meshName);
  if (manifest.baseNodes.includes(node)) return 'base';
  for (const [id, item] of Object.entries(manifest.items)) {
    if (item.nodes.includes(node)) return `item:${id}`;
  }
  for (const [id, item] of wocFitCatalog(manifest.fit)) {
    if (item.nodes.includes(node)) return `item:${id}`;
  }
  for (const [slot, def] of Object.entries(manifest.appearance)) {
    for (const variant of Object.values(def.variants)) {
      if (variant.nodes.includes(node)) return `appearance:${slot}`;
    }
  }
  return `node:${node}`;
}
