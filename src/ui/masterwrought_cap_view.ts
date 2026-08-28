// The Masterwrought equip-cap visibility model (Masterwrought phase 14): how
// many worn pieces carry the masterwrought flag, against the sim's own cap.
//
// A pure core (UI_PURE_CORES, tests/architecture.test.ts): no DOM, no host
// state; i18n limited to key selection and the number formatter (the allowance
// src/ui/CLAUDE.md grants cores). The cap NUMBER and the counted-piece predicate both come
// from the one sim rule (src/sim/equipment_rules.ts): the cap is the imported
// MASTERWROUGHT_EQUIP_CAP constant, and the walk counts exactly what
// masterwroughtConflictSlot counts (a worn id whose def carries the
// `masterwrought` flag; duplicates legal, a two-hander counts once), pinned
// equivalent in tests/masterwrought_cap_view.test.ts so the readout can never
// say "1 of 2" while the equip rule refuses.
import { MASTERWROUGHT_EQUIP_CAP } from '../sim/equipment_rules';
import { ALL_EQUIP_SLOTS, type EquipSlot, type ItemDef } from '../sim/types';
import { itemNumber } from './item_instance_tooltip';

export { MASTERWROUGHT_EQUIP_CAP };

/** The worn equipment slots holding a Masterwrought (apex) piece, in
 *  ALL_EQUIP_SLOTS order: the same flag filter the equip cap's conflict walk
 *  applies. A worn id that no longer resolves counts as not flagged. */
export function wornMasterwroughtSlots(
  equipment: Partial<Record<EquipSlot, string>>,
  items: Record<string, ItemDef>,
): EquipSlot[] {
  const slots: EquipSlot[] = [];
  for (const slot of ALL_EQUIP_SLOTS) {
    const wornId = equipment[slot];
    if (!wornId) continue;
    if (items[wornId]?.masterwrought === true) slots.push(slot);
  }
  return slots;
}

/** The character sheet's slots readout: pieces in use against the cap. `null`
 *  when nothing Masterwrought is worn, so the sheet shows no endgame chrome
 *  to a character the rule does not touch yet. */
export interface MasterwroughtCapReadout {
  used: number;
  cap: number;
  atCap: boolean;
}

export function masterwroughtCapReadout(
  equipment: Partial<Record<EquipSlot, string>>,
  items: Record<string, ItemDef>,
): MasterwroughtCapReadout | null {
  const used = wornMasterwroughtSlots(equipment, items).length;
  if (used === 0) return null;
  return { used, cap: MASTERWROUGHT_EQUIP_CAP, atCap: used >= MASTERWROUGHT_EQUIP_CAP };
}

/** The item tooltip's Masterwrought lines, as key + pre-formatted values rows
 *  the hud resolves through t() one wrapper at a time: the counted-family line
 *  always (the tag names the budget the whole family shares, never this one
 *  copy), and the at-cap line when the viewer's worn set has consumed the
 *  whole budget, so a bag copy being weighed against the cap says so at hover
 *  time. */
export function masterwroughtTooltipLines(
  equipment: Partial<Record<EquipSlot, string>>,
  items: Record<string, ItemDef>,
): {
  key: 'hudChrome.itemMasterwrought' | 'hudChrome.masterwrought.tooltipAtCap';
  values: Record<string, string>;
}[] {
  const lines: ReturnType<typeof masterwroughtTooltipLines> = [
    { key: 'hudChrome.itemMasterwrought', values: { count: itemNumber(MASTERWROUGHT_EQUIP_CAP) } },
  ];
  const readout = masterwroughtCapReadout(equipment, items);
  if (readout?.atCap) {
    lines.push({
      key: 'hudChrome.masterwrought.tooltipAtCap',
      values: { cap: itemNumber(readout.cap) },
    });
  }
  return lines;
}
