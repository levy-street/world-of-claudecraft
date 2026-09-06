// The Rift Forge window's pure view-core: the player's bags and worn slots in,
// one row per Riftbound band out, with every affordance already decided (the
// band's item level now and after the next essence upgrade, whether that
// upgrade is affordable, which owned gems could be socketed and which gem a
// socket would replace). DOM-free and host-agnostic: the same snapshot shape
// comes from the offline Sim and the online mirror, so the painter never
// re-derives a number the sim already owns (src/sim/rift/progression.ts
// riftUpgradeCost, src/sim/rift/band_ladder.ts riftBandItemLevel).
//
// Only BAGGED bands are forgeable: the sim resolves a forge target through
// the inventory (riftInventorySlot), so a worn band is listed with its state
// but flagged `worn`, and the painter renders the unequip hint instead of
// the buttons. Listing it at all keeps the window honest about what the
// player owns when they walk up wearing the ring they came to upgrade.

import {
  RIFT_ESSENCE_ITEM_ID,
  RIFT_GEM_IDS,
  type RiftGemId,
} from '../../../sim/content/rift/items';
import type { PlayerEquipmentInstances } from '../../../sim/entity';
import {
  RIFT_GEM_RATING,
  RIFT_GEM_RATING_STAT,
  type RiftGemRating,
  riftBandItemLevel,
} from '../../../sim/rift/band_ladder';
import { isRiftForgeNpc } from '../../../sim/rift/forge_gate';
import { riftUpgradeCost } from '../../../sim/rift/progression';
import type { Entity, EquipSlot, InvSlot, ItemInstancePayload, RiftTier } from '../../../sim/types';

export interface RiftForgeInput {
  inventory: readonly InvSlot[];
  /** Worn slot -> item id (IWorld.equipment). */
  equipment: Partial<Record<EquipSlot, string>>;
  /** Worn slot -> per-copy payload (IWorld.equipmentInstances). */
  equipmentInstances: PlayerEquipmentInstances;
}

export type RiftForgeRingSource =
  | { kind: 'bag'; slotIndex: number }
  | { kind: 'worn'; slot: EquipSlot };

export interface RiftForgeRingRow {
  itemId: string;
  source: RiftForgeRingSource;
  instance: ItemInstancePayload;
  tier: RiftTier;
  upgradeLevel: number;
  maxUpgradeLevel: number;
  /** The band's item level at its current upgrade (band_ladder.ts). */
  itemLevel: number;
  /** The item level the next essence upgrade buys; null at the ladder's top. */
  nextItemLevel: number | null;
  /** Essence the next upgrade costs; null at the ladder's top. */
  nextUpgradeCost: number | null;
  canUpgrade: boolean;
  gems: readonly RiftGemId[];
  gemSlots: number;
  /** Owned gem ids that could be socketed (empty when none owned or worn).
   *  Sockets are replaceable, so a full band still lists them. */
  socketable: readonly RiftGemId[];
  /** The gem a socket would destroy: the oldest, once every socket is filled. */
  replaces: RiftGemId | null;
  /** Worn bands are shown, never forged (unequip first). */
  worn: boolean;
}

export interface RiftForgeGemStack {
  id: RiftGemId;
  count: number;
  /** The rating line this colour grants once socketed. */
  stat: RiftGemRating;
  rating: number;
}

export interface RiftForgeView {
  rings: RiftForgeRingRow[];
  essence: number;
  gems: RiftForgeGemStack[];
}

function countOf(inventory: readonly InvSlot[], itemId: string): number {
  let n = 0;
  for (const s of inventory) if (s.itemId === itemId) n += s.count;
  return n;
}

function row(
  itemId: string,
  source: RiftForgeRingSource,
  instance: ItemInstancePayload,
  essence: number,
  owned: readonly RiftGemId[],
): RiftForgeRingRow | null {
  const rift = instance.rift;
  if (!rift) return null;
  const worn = source.kind === 'worn';
  const atMax = rift.upgradeLevel >= rift.maxUpgradeLevel;
  const nextUpgradeCost = atMax ? null : riftUpgradeCost(rift.upgradeLevel);
  const gems = rift.gems.filter((g): g is RiftGemId =>
    (RIFT_GEM_IDS as readonly string[]).includes(g),
  );
  const socketable = worn ? [] : owned;
  const full = gems.length >= rift.gemSlots;
  return {
    itemId,
    source,
    instance,
    tier: rift.tier,
    upgradeLevel: rift.upgradeLevel,
    maxUpgradeLevel: rift.maxUpgradeLevel,
    itemLevel: riftBandItemLevel(rift.tier, rift.upgradeLevel),
    nextItemLevel: atMax ? null : riftBandItemLevel(rift.tier, rift.upgradeLevel + 1),
    nextUpgradeCost,
    canUpgrade: !worn && nextUpgradeCost !== null && essence >= nextUpgradeCost,
    gems,
    gemSlots: rift.gemSlots,
    socketable,
    replaces: full && socketable.length > 0 && gems.length > 0 ? gems[0] : null,
    worn,
  };
}

/** Whether a riftForge NPC stands within `range` yards (2D) of `player`: the
 *  window's walk-away close, the market and vendor windows' rule. The sim's
 *  own place gate (forge_gate.ts) is what refuses a forge command; this only
 *  decides when the open window should follow the player out of reach. */
export function riftForgeInReach(
  player: { pos: { x: number; z: number } },
  entities: Iterable<Entity>,
  range: number,
): boolean {
  for (const e of entities) {
    if (!isRiftForgeNpc(e)) continue;
    const dx = e.pos.x - player.pos.x;
    const dz = e.pos.z - player.pos.z;
    if (dx * dx + dz * dz <= range * range) return true;
  }
  return false;
}

export function buildRiftForgeView(input: RiftForgeInput): RiftForgeView {
  const essence = countOf(input.inventory, RIFT_ESSENCE_ITEM_ID);
  const gems: RiftForgeGemStack[] = RIFT_GEM_IDS.map((id) => ({
    id,
    count: countOf(input.inventory, id),
    stat: RIFT_GEM_RATING_STAT[id],
    rating: RIFT_GEM_RATING,
  }));
  const owned = gems.filter((g) => g.count > 0).map((g) => g.id);
  const rings: RiftForgeRingRow[] = [];
  input.inventory.forEach((slot, slotIndex) => {
    if (!slot.instance?.rift) return;
    const r = row(slot.itemId, { kind: 'bag', slotIndex }, slot.instance, essence, owned);
    if (r) rings.push(r);
  });
  for (const [slot, instance] of Object.entries(input.equipmentInstances)) {
    const itemId = input.equipment[slot as EquipSlot];
    if (!instance?.rift || !itemId) continue;
    const r = row(itemId, { kind: 'worn', slot: slot as EquipSlot }, instance, essence, owned);
    if (r) rings.push(r);
  }
  return { rings, essence, gems };
}
