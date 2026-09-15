// Pure resolver for the functional role tag an NPC's nameplate shows under
// its name (the classic `<Weapon Vendor>` / `<Banker>` line). An NPC's name
// alone never says what it does; the role tag does. Host-agnostic and
// deterministic: it reads only the merged content tables (NpcDef flags, the
// profession STATIONS roster, and the kinds of the items a vendor stocks), so
// the offline Sim, the online ClientWorld and the headless env all agree.
// Localization stays on the consumer side (the nameplate painter maps the
// role id to hudChrome.nameplate.npcRole.<id>); this module never calls t().
//
// Priority order matters: a service flag (market, banker, forge, card table,
// a themed quartermaster) is the NPC's whole purpose, so it beats the copper
// stock it may also carry; a profession master is a trainer first and a tool
// vendor second; a plain vendor is classified by what it sells. An NPC with
// no role at all resolves to null, and the painter falls back to the authored
// flavor title (npcDisplayTitle) so every NPC still reads as something.

import { STATIONS } from './content/professions';
import { ITEMS } from './data';
import type { ItemKind, NpcDef, StationType } from './types';

export type NpcRole =
  | 'auctioneer'
  | 'banker'
  | 'riftForgemaster'
  | 'cardMaster'
  | 'crucibleQuartermaster'
  | 'heroicQuartermaster'
  | 'pvpVendor'
  | 'weaponsmithTrainer'
  | 'cookingTrainer'
  | 'tailoringTrainer'
  | 'engineeringTrainer'
  | 'leatherworkingTrainer'
  | 'alchemyTrainer'
  | 'weaponVendor'
  | 'armorVendor'
  | 'armsDealer'
  | 'foodVendor'
  | 'potionVendor'
  | 'stableMaster'
  | 'generalGoods';

/** Every role id, so the i18n pin can assert a catalog key exists per role. */
export const NPC_ROLES: readonly NpcRole[] = [
  'auctioneer',
  'banker',
  'riftForgemaster',
  'cardMaster',
  'crucibleQuartermaster',
  'heroicQuartermaster',
  'pvpVendor',
  'weaponsmithTrainer',
  'cookingTrainer',
  'tailoringTrainer',
  'engineeringTrainer',
  'leatherworkingTrainer',
  'alchemyTrainer',
  'weaponVendor',
  'armorVendor',
  'armsDealer',
  'foodVendor',
  'potionVendor',
  'stableMaster',
  'generalGoods',
];

const TRAINER_ROLE_BY_STATION: Readonly<Record<StationType, NpcRole>> = {
  forge: 'weaponsmithTrainer',
  kitchens: 'cookingTrainer',
  loom: 'tailoringTrainer',
  toolworks: 'engineeringTrainer',
  tannery: 'leatherworkingTrainer',
  apothecary: 'alchemyTrainer',
};

/** Resident profession masters by NPC id, derived once from STATIONS. */
const TRAINER_ROLE_BY_NPC: ReadonlyMap<string, NpcRole> = new Map(
  STATIONS.map((station) => [station.masterNpcId, TRAINER_ROLE_BY_STATION[station.type]]),
);

/** Classify a copper vendor by the kinds of item it stocks. Unknown item ids
 *  (a stale stock entry) count as nothing, never as a crash. */
export function vendorRoleForStock(vendorItems: readonly string[]): NpcRole | null {
  let weapon = false;
  let armor = false;
  let food = false;
  let potion = false;
  let mount = false;
  let other = false;
  let any = false;
  for (const id of vendorItems) {
    const item = ITEMS[id];
    if (!item) continue;
    any = true;
    const kind: ItemKind = item.kind;
    if (kind === 'weapon') weapon = true;
    else if (kind === 'armor' || kind === 'held_offhand') armor = true;
    else if (kind === 'food' || kind === 'drink') food = true;
    else if (kind === 'potion' || kind === 'elixir') potion = true;
    else if (kind === 'mount' || item.teachesRiding) mount = true;
    else other = true;
  }
  if (!any) return null;
  if (mount) return 'stableMaster';
  if (other) return 'generalGoods';
  if (weapon && armor) return 'armsDealer';
  if (weapon && !food && !potion) return 'weaponVendor';
  if (armor && !food && !potion) return 'armorVendor';
  if (food && !weapon && !armor && !potion) return 'foodVendor';
  if (potion && !weapon && !armor && !food) return 'potionVendor';
  return 'generalGoods';
}

/** The functional role tag for an NPC def, or null when it has none (the
 *  painter then shows the authored flavor title). Pure: same def, same role. */
export function npcRoleFor(def: NpcDef): NpcRole | null {
  if (def.market) return 'auctioneer';
  if (def.banker) return 'banker';
  if (def.riftForge) return 'riftForgemaster';
  if (def.cardMaster) return 'cardMaster';
  if (def.crucibleVendor) return 'crucibleQuartermaster';
  if (def.heroicVendor) return 'heroicQuartermaster';
  if (def.warfareVendor) return 'pvpVendor';
  const trainer = TRAINER_ROLE_BY_NPC.get(def.id);
  if (trainer) return trainer;
  if (def.vendorItems && def.vendorItems.length > 0) return vendorRoleForStock(def.vendorItems);
  return null;
}
