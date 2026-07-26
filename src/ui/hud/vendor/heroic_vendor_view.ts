// Pure, host-agnostic view model for the Heroic Quartermaster window.
//
// The pure-core half of the pure-core + thin-consumer split (reference
// vendor_view.ts): it decides which stock rows render and whether the viewer
// can afford each at their current Heroic Marks balance. The DOM/i18n side
// lives in heroic_vendor_window.ts. DOM-free and i18n-free so
// tests/heroic_vendor.test.ts can drive it directly.

import { HEROIC_MARK_ITEM_ID } from '../../../sim/content/dungeon_difficulty';
import type { HeroicVendorOffer } from '../../../sim/content/heroic_vendor';
import {
  PROCEDURAL_LEGENDARY_POWERS,
  type ProceduralLegendaryPowerId,
} from '../../../sim/content/procedural_legendary_powers';
import { proceduralBossLegendarySignatures } from '../../../sim/content/procedural_legendary_sources';
import { PROCEDURAL_BASE_POOLS, PROCEDURAL_ITEM_BASES } from '../../../sim/content/procedural_loot';
import {
  DEATHLESS_FRAGMENT_ITEM_ID,
  NYTHRAXIS_AUTHORED_FORGE_OFFERS,
  NYTHRAXIS_FORGE_COSTS,
  NYTHRAXIS_PROCEDURAL_RAID_PROFILES,
  NYTHRAXIS_RAID_BOSS_ID,
} from '../../../sim/content/procedural_raid_loot';
import { canEquipItem } from '../../../sim/equipment_rules';
import { itemLevel } from '../../../sim/item_level';
import type { InvSlot, ItemDef, ItemInstancePayload, PlayerClass } from '../../../sim/types';

export interface HeroicShopRow {
  itemId: string;
  item: ItemDef;
  /** Price in Heroic Marks (the heroic_mark inventory item). */
  marks: number;
  affordable: boolean;
}

export interface HeroicShopView {
  rows: HeroicShopRow[];
  /** The viewer's current Heroic Marks balance (bag count). */
  balance: number;
}

export type HeroicVendorTab = 'gear' | 'forge' | 'tune';
export type ForgeOfferKind = 'normal_procedural' | 'heroic_procedural' | 'signature' | 'authored';
export type QuartermasterBlockReason = 'class' | 'heroic_clear' | 'fragments' | 'marks' | null;

export interface QuartermasterCost {
  fragments: number;
  heroicMarks: number;
}

export interface NythraxisForgeRow {
  offerId: string;
  kind: ForgeOfferKind;
  itemId: string;
  item: ItemDef;
  itemLevel: number;
  quality: 'epic' | 'legendary';
  cost: QuartermasterCost;
  compatible: boolean;
  requiresHeroicClear: boolean;
  randomAffixes: boolean;
  raidForged: boolean;
  powerId: ProceduralLegendaryPowerId | null;
  blockReason: QuartermasterBlockReason;
}

export interface NythraxisTuneRow {
  itemId: string;
  item: ItemDef;
  instance: ItemInstancePayload;
  instanceUid: string;
  powerId: ProceduralLegendaryPowerId;
  itemLevel: number;
  raidForged: boolean;
  reforgeCount: number;
  cost: QuartermasterCost;
  compatible: boolean;
  blockReason: QuartermasterBlockReason;
}

export interface HeroicQuartermasterView {
  tab: HeroicVendorTab;
  gear: HeroicShopView;
  fragments: number;
  heroicMarks: number;
  heroicClear: boolean;
  forgeRows: NythraxisForgeRow[];
  tuneRows: NythraxisTuneRow[];
}

export interface HeroicQuartermasterViewInput {
  tab: HeroicVendorTab;
  stock: readonly HeroicVendorOffer[];
  items: Record<string, ItemDef>;
  inventory: readonly InvSlot[];
  playerClass: PlayerClass;
  heroicClear: boolean;
}

function bagCount(inventory: readonly InvSlot[], itemId: string): number {
  return inventory.reduce((sum, slot) => sum + (slot.itemId === itemId ? slot.count : 0), 0);
}

function blockReason(
  compatible: boolean,
  requiresHeroicClear: boolean,
  heroicClear: boolean,
  cost: QuartermasterCost,
  fragments: number,
  heroicMarks: number,
): QuartermasterBlockReason {
  if (!compatible) return 'class';
  if (requiresHeroicClear && !heroicClear) return 'heroic_clear';
  if (fragments < cost.fragments) return 'fragments';
  if (heroicMarks < cost.heroicMarks) return 'marks';
  return null;
}

function forgeRow(
  input: Omit<NythraxisForgeRow, 'blockReason'>,
  balances: { fragments: number; heroicMarks: number; heroicClear: boolean },
): NythraxisForgeRow {
  return {
    ...input,
    blockReason: blockReason(
      input.compatible,
      input.requiresHeroicClear,
      balances.heroicClear,
      input.cost,
      balances.fragments,
      balances.heroicMarks,
    ),
  };
}

function looksLikeNythraxisLegendary(slot: InvSlot): boolean {
  const procedural = slot.instance?.procedural;
  if (!procedural || procedural.rarity !== 'legendary' || !procedural.legendaryPowerId)
    return false;
  // Presentation-only shortlist. The authoritative command receives only the
  // exact opaque UID; the sim/server then verifies source, bag ownership and
  // every cost again. Public owner projections deliberately omit dropContext.
  return (
    procedural.raidForged === true || procedural.itemLevel === 32 || procedural.itemLevel === 36
  );
}

function buildForgeRows(
  items: Record<string, ItemDef>,
  playerClass: PlayerClass,
  balances: { fragments: number; heroicMarks: number; heroicClear: boolean },
): NythraxisForgeRow[] {
  const rows: NythraxisForgeRow[] = [];
  const normalProfile = NYTHRAXIS_PROCEDURAL_RAID_PROFILES.normal;
  const heroicProfile = NYTHRAXIS_PROCEDURAL_RAID_PROFILES.heroic;

  // The broad procedural pool is filtered to bases this character can equip.
  // Authored and signature targets stay visible and are explicitly marked when
  // they belong to another class, so deterministic paths remain discoverable.
  for (const baseId of PROCEDURAL_BASE_POOLS.nythraxis_raid.baseIds) {
    const base = PROCEDURAL_ITEM_BASES[baseId];
    const item = base ? items[base.visualItemId] : undefined;
    if (!base || !item || !canEquipItem(playerClass, item)) continue;
    rows.push(
      forgeRow(
        {
          offerId: `normal:${baseId}`,
          kind: 'normal_procedural',
          itemId: item.id,
          item,
          itemLevel: normalProfile.itemLevels.epic,
          quality: 'epic',
          cost: NYTHRAXIS_FORGE_COSTS.normalProceduralEpic,
          compatible: true,
          requiresHeroicClear: false,
          randomAffixes: true,
          raidForged: false,
          powerId: null,
        },
        balances,
      ),
      forgeRow(
        {
          offerId: `heroic:${baseId}`,
          kind: 'heroic_procedural',
          itemId: item.id,
          item,
          itemLevel: heroicProfile.itemLevels.epic,
          quality: 'epic',
          cost: NYTHRAXIS_FORGE_COSTS.heroicProceduralEpic,
          compatible: true,
          requiresHeroicClear: true,
          randomAffixes: true,
          raidForged: false,
          powerId: null,
        },
        balances,
      ),
    );
  }

  for (const powerId of proceduralBossLegendarySignatures(NYTHRAXIS_RAID_BOSS_ID)) {
    const power = PROCEDURAL_LEGENDARY_POWERS[powerId];
    const baseId = power.compatibleBaseIds[0];
    const base = PROCEDURAL_ITEM_BASES[baseId];
    const item = base ? items[base.visualItemId] : undefined;
    if (!base || !item) continue;
    rows.push(
      forgeRow(
        {
          offerId: `signature:${powerId}:${baseId}`,
          kind: 'signature',
          itemId: item.id,
          item,
          itemLevel: heroicProfile.itemLevels.legendary,
          quality: 'legendary',
          cost: NYTHRAXIS_FORGE_COSTS.raidForgedSignature,
          compatible:
            canEquipItem(playerClass, item) &&
            (!('requiredClass' in power) || (power.requiredClass as PlayerClass) === playerClass),
          requiresHeroicClear: true,
          randomAffixes: true,
          raidForged: true,
          powerId,
        },
        balances,
      ),
    );
  }

  for (const authored of NYTHRAXIS_AUTHORED_FORGE_OFFERS) {
    const item = items[authored.itemId];
    if (!item) continue;
    rows.push(
      forgeRow(
        {
          offerId: authored.offerId,
          kind: 'authored',
          itemId: authored.itemId,
          item,
          itemLevel: itemLevel(item) ?? heroicProfile.itemLevels.epic,
          quality: authored.quality,
          cost:
            authored.quality === 'legendary'
              ? NYTHRAXIS_FORGE_COSTS.heroicAuthoredLegendary
              : NYTHRAXIS_FORGE_COSTS.heroicAuthoredEpic,
          compatible: canEquipItem(playerClass, item),
          requiresHeroicClear: true,
          randomAffixes: false,
          raidForged: false,
          powerId: null,
        },
        balances,
      ),
    );
  }
  return rows;
}

function buildTuneRows(
  items: Record<string, ItemDef>,
  inventory: readonly InvSlot[],
  playerClass: PlayerClass,
  balances: { fragments: number; heroicMarks: number },
): NythraxisTuneRow[] {
  const cost = NYTHRAXIS_FORGE_COSTS.legendaryPowerTune;
  const rows: NythraxisTuneRow[] = [];
  for (const slot of inventory) {
    if (slot.count !== 1 || !looksLikeNythraxisLegendary(slot)) continue;
    const item = items[slot.itemId];
    const instance = slot.instance;
    const procedural = instance?.procedural;
    if (
      !item ||
      !instance ||
      !procedural?.legendaryPowerId ||
      !(procedural.legendaryPowerId in PROCEDURAL_LEGENDARY_POWERS)
    )
      continue;
    const powerId = procedural.legendaryPowerId as ProceduralLegendaryPowerId;
    const compatible = canEquipItem(playerClass, item);
    rows.push({
      itemId: slot.itemId,
      item,
      instance,
      instanceUid: procedural.uid,
      powerId,
      itemLevel: procedural.itemLevel,
      raidForged: procedural.raidForged === true,
      reforgeCount: procedural.reforgeCount ?? 0,
      cost,
      compatible,
      blockReason: blockReason(
        compatible,
        false,
        true,
        cost,
        balances.fragments,
        balances.heroicMarks,
      ),
    });
  }
  return rows;
}

/** Build the structured shop view: stock rows resolved against the item table
 * and the viewer's marks balance. Unknown item ids are dropped (never render a
 * row the sim would refuse to sell). */
export function buildHeroicVendorView(
  stock: readonly HeroicVendorOffer[],
  items: Record<string, ItemDef>,
  balance: number,
): HeroicShopView {
  const rows: HeroicShopRow[] = [];
  for (const offer of stock) {
    const item = items[offer.itemId];
    if (!item) continue;
    rows.push({
      itemId: offer.itemId,
      item,
      marks: offer.marks,
      affordable: balance >= offer.marks,
    });
  }
  return { rows, balance };
}

/** Build every Quartermaster tab from static content and IWorld-shaped state.
 * This view never resolves a forge/tune outcome and never decides authority. */
export function buildHeroicQuartermasterView(
  input: HeroicQuartermasterViewInput,
): HeroicQuartermasterView {
  const fragments = bagCount(input.inventory, DEATHLESS_FRAGMENT_ITEM_ID);
  const heroicMarks = bagCount(input.inventory, HEROIC_MARK_ITEM_ID);
  const balances = { fragments, heroicMarks, heroicClear: input.heroicClear };
  return {
    tab: input.tab,
    gear: buildHeroicVendorView(input.stock, input.items, heroicMarks),
    fragments,
    heroicMarks,
    heroicClear: input.heroicClear,
    forgeRows: buildForgeRows(input.items, input.playerClass, balances),
    tuneRows: buildTuneRows(input.items, input.inventory, input.playerClass, balances),
  };
}
