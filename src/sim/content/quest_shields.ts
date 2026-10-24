// Leveling quest shields: one shield per starting zone (two uncommon, the
// Thornpeak tower shield rare), for the warrior/paladin/shaman reward archetype
// (REWARD_ARCHETYPE in data.ts shares the warrior entry with paladins and
// shamans, so each quest lists warrior only).
// Each piece is paid by a quest that previously granted no item at all, so no
// existing reward is displaced:
//   - lychgate_buckler          q_bones         (Eastbrook Vale, level 5)
//   - bastion_kite_shield       q_bastion_door  (Mirefen Marsh, level 12)
//   - barrowfield_tower_shield  q_revenants     (Thornpeak Heights, level 18)
//
// Numbers follow the established shield line (see bonewrought_bulwark in
// zone3.ts and pearlward_aegis in temple.ts):
//   - item level: the quest's source level (item_level.ts buildSourceIndex) plus
//     the quality bump (uncommon 1, rare 3): 7 + 1 = 8 (restless_skull drops at
//     7), 12 + 1 = 13 (minLevel 12, the ward stone has no mob source), 19 + 3 = 22
//     (the Boneclad Revenant's maxLevel, rare).
//   - armor and blockValue: the two greens sit UNDER pearlward_aegis (rare, item
//     level 19: 240 armor, 12 block) so a quest green never out-mitigates the
//     same-band dungeon blue, stepped down by item level from there while still
//     clearing the common vendor shields (eastbrook_buckler 34,
//     highwatch_wallshield 112): 160 / 7 at 8, 200 / 9 at 13. The rare tower
//     shield reads the rare shield line between pearlward_aegis (19: 240 / 12)
//     and rare_glacier_hewn_bulwark (28: 657 / 29) at 22: 380 / 18, which is also
//     ~2x the same-tier rare mail chest (moonshroud 200 at 21, boneguard 210 at
//     23).
//   - stats: exactly primaryStatBudget(ilvl, quality, offhand) = 2 / 4 / 9 on
//     the physical line, stamina-heavy for the tank identity (about 2:1 like
//     the Bulwark, rounded: 1/1 at the 2-point floor, 3/1 at 4, 6/3 at 9) and at
//     or above the stamina baseline. As a rare the tower shield is level gated
//     (item_level_req.ts requiredLevelFor) at its source level, 19, one above
//     the quest's minLevel, like the other rare quest rewards (e.g.
//     knight_commanders_greaves at 13 on the level-12 q_olen).
import type { ItemDef } from '../types';

const SHIELD_CLASSES: ItemDef['requiredClass'] = ['warrior', 'paladin', 'shaman'];

export const QUEST_SHIELD_ITEMS: Record<string, ItemDef> = {
  lychgate_buckler: {
    id: 'lychgate_buckler',
    name: 'Lychgate Buckler',
    kind: 'armor',
    armorType: 'mail',
    slot: 'offhand',
    shield: true,
    quality: 'uncommon',
    blockValue: 7,
    stats: { armor: 160, sta: 1, str: 1 },
    sellValue: 180,
    requiredClass: SHIELD_CLASSES,
  },
  bastion_kite_shield: {
    id: 'bastion_kite_shield',
    name: 'Bastion Kite Shield',
    kind: 'armor',
    armorType: 'mail',
    slot: 'offhand',
    shield: true,
    quality: 'uncommon',
    blockValue: 9,
    stats: { armor: 200, sta: 3, str: 1 },
    sellValue: 420,
    requiredClass: SHIELD_CLASSES,
  },
  barrowfield_tower_shield: {
    id: 'barrowfield_tower_shield',
    name: 'Barrowfield Tower Shield',
    kind: 'armor',
    armorType: 'mail',
    slot: 'offhand',
    shield: true,
    quality: 'rare',
    blockValue: 18,
    stats: { armor: 380, sta: 6, str: 3 },
    sellValue: 1900,
    requiredClass: SHIELD_CLASSES,
  },
};

// All three shield paintings ship under public/ui/items; no art debt remains.
export const QUEST_SHIELD_ART_PENDING_ITEM_IDS: readonly string[] = [];
