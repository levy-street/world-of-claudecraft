// The viewer's slotted tool effects, projected for the IWorld seam. Moved out
// of the Sim coordinator unchanged (it reads only the player record), so the
// Sim keeps a one-line delegation.
//
// The Sim method takes an explicit pid (the gatheringProficiencyFor precedent)
// so the server can build one player's delta while the offline getter reads
// the primary.
//
// Returns [] for the absent field, which is the default and must stay that
// way: an empty object still serializes into the parity state digest, so
// initialising the map would move every golden for a feature no scenario
// uses. Sorted by professionId so the JSON form is a stable delta signature.

import type { ToolEffectSlotView } from '../../world_api';
import { GATHERING_PROFESSION_IDS } from '../content/professions';
import type { PlayerMeta } from '../sim';
import { EMPTY_TOOL_EFFECT_SLOT_VIEWS } from './tools';

export function toolEffectSlotViewsOf(meta: PlayerMeta | undefined): readonly ToolEffectSlotView[] {
  const slots = meta?.toolEffectSlots;
  // The empty arms return the shared frozen instance: this runs per tick
  // per session on the snapshot path, and a fresh [] here was two
  // allocations per player per tick (the array plus its serialized "[]")
  // for the overwhelming majority who never slot an effect.
  if (!meta || !slots) return EMPTY_TOOL_EFFECT_SLOT_VIEWS;
  const rows: ToolEffectSlotView[] = [];
  for (const professionId of GATHERING_PROFESSION_IDS) {
    const slot = slots[professionId];
    if (!slot) continue;
    rows.push({
      professionId,
      effectId: slot.effectId,
      charges: slot.durability,
      maxCharges: slot.maxDurability,
      confirmMode: slot.confirmMode,
      // The R48 privacy-preserving provenance projection: a boolean, never
      // the name (a foreign crafter's identity stays server-side).
      selfCrafted: slot.craftedBy !== undefined && slot.craftedBy === meta.name,
    });
  }
  if (rows.length === 0) return EMPTY_TOOL_EFFECT_SLOT_VIEWS;
  // GATHERING_PROFESSION_IDS is already a stable content order, but the sort
  // is what the signature contract actually promises, so state it. A plain
  // codepoint compare, never localeCompare: this runs per tick per session on
  // the snapshot path, and an ICU collation inside the deterministic core
  // would make the wire order depend on the host's locale data.
  return rows.sort((a, b) =>
    a.professionId < b.professionId ? -1 : a.professionId > b.professionId ? 1 : 0,
  );
}
