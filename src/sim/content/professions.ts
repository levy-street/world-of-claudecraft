// Professions & crafting — data-as-code framework.
//
// This is the declarative source for every tradeskill and secondary skill. The
// Sim reads PROFESSIONS / RECIPES; it never hardcodes a profession. Adding a new
// profession (tailoring, mining, ...) is a data edit here plus a trainer NPC and
// any materials in items.ts — no engine change. See
// docs/prd/professions-and-crafting.md.
//
// Skill model: caps at PROFESSION_MAX (100). Two trainable tiers gate the cap —
// Apprentice (1–50) and Journeyman (1–100, trainable only at skill >= 40). A
// recipe's difficulty color vs current skill drives the skill-up chance
// (orange always, grey never).

import {
  APPRENTICE_CAP, JOURNEYMAN_CAP, JOURNEYMAN_REQ_SKILL, JOURNEYMAN_REQ_LEVEL, PROFESSION_MAX,
} from '../types';
import type { MobFamily } from '../types';

export type ProfessionKind = 'primary' | 'secondary';
export type TierId = 'apprentice' | 'journeyman';
export type DifficultyColor = 'orange' | 'yellow' | 'green' | 'grey';

export interface ProfessionTier {
  id: TierId;
  cap: number;          // skill ceiling this tier unlocks
  requiresSkill: number; // skill needed before a trainer will teach this tier
  requiresLevel: number; // character level needed to train this tier
}

export interface ProfessionDef {
  id: string;
  name: string;
  kind: ProfessionKind;
  maxSkill: number;
  tiers: ProfessionTier[]; // ordered apprentice -> journeyman
  recipes: string[];       // recipe ids (RECIPES keys)
}

export interface RecipeDef {
  id: string;
  profId: string;
  name: string;
  icon: string;
  requiredSkill: number; // min skill to craft (== orange threshold)
  // Difficulty thresholds: orange below yellowAt, yellow below greenAt, green
  // below greyAt, grey at/above greyAt. Drives the skill-up chance.
  yellowAt: number;
  greenAt: number;
  greyAt: number;
  reagents: { itemId: string; count: number }[];
  output: { itemId: string; count: number };
  castTime: number; // seconds
  station?: string; // 'forge' | 'cookfire' | ... ; omitted = craftable anywhere
  batch?: number;   // bulk variant: x reagents and output, still ONE skill-up
}

// Most professions share the same two-tier cap structure.
export const STANDARD_TIERS: ProfessionTier[] = [
  { id: 'apprentice', cap: APPRENTICE_CAP, requiresSkill: 0, requiresLevel: 1 },
  { id: 'journeyman', cap: JOURNEYMAN_CAP, requiresSkill: JOURNEYMAN_REQ_SKILL, requiresLevel: JOURNEYMAN_REQ_LEVEL },
];

export const RECIPES: Record<string, RecipeDef> = {
  // First Aid ladder, 1..100, using all three cloth tiers. Wool/Silk bandages sit
  // above 50 so they are only reachable once Journeyman is trained — exercising
  // the tier gate end to end.
  // Apprentice tier (cap 50): linen bandages.
  linen_bandage: {
    id: 'linen_bandage', profId: 'first_aid', name: 'Linen Bandage', icon: 'linen_bandage',
    requiredSkill: 1, yellowAt: 20, greenAt: 35, greyAt: 45,
    reagents: [{ itemId: 'linen_cloth', count: 1 }],
    output: { itemId: 'linen_bandage', count: 1 },
    castTime: 3,
  },
  heavy_linen_bandage: {
    id: 'heavy_linen_bandage', profId: 'first_aid', name: 'Heavy Linen Bandage', icon: 'heavy_linen_bandage',
    requiredSkill: 25, yellowAt: 40, greenAt: 52, greyAt: 62,
    reagents: [{ itemId: 'linen_cloth', count: 2 }],
    output: { itemId: 'heavy_linen_bandage', count: 1 },
    castTime: 3,
  },
  // Journeyman tier (cap 100): wool then silk. Reachable only after training
  // Journeyman (at skill 40), which raises the cap above 50.
  wool_bandage: {
    id: 'wool_bandage', profId: 'first_aid', name: 'Wool Bandage', icon: 'wool_bandage',
    requiredSkill: 50, yellowAt: 62, greenAt: 73, greyAt: 85,
    reagents: [{ itemId: 'wool_cloth', count: 1 }],
    output: { itemId: 'wool_bandage', count: 1 },
    castTime: 3,
  },
  heavy_wool_bandage: {
    id: 'heavy_wool_bandage', profId: 'first_aid', name: 'Heavy Wool Bandage', icon: 'heavy_wool_bandage',
    requiredSkill: 60, yellowAt: 70, greenAt: 80, greyAt: 90,
    reagents: [{ itemId: 'wool_cloth', count: 2 }],
    output: { itemId: 'heavy_wool_bandage', count: 1 },
    castTime: 3,
  },
  silk_bandage: {
    id: 'silk_bandage', profId: 'first_aid', name: 'Silk Bandage', icon: 'silk_bandage',
    requiredSkill: 70, yellowAt: 80, greenAt: 90, greyAt: 97,
    reagents: [{ itemId: 'silk_cloth', count: 1 }],
    output: { itemId: 'silk_bandage', count: 1 },
    castTime: 3,
  },
  heavy_silk_bandage: {
    id: 'heavy_silk_bandage', profId: 'first_aid', name: 'Heavy Silk Bandage', icon: 'heavy_silk_bandage',
    requiredSkill: 80, yellowAt: 88, greenAt: 95, greyAt: 100,
    reagents: [{ itemId: 'silk_cloth', count: 2 }],
    output: { itemId: 'heavy_silk_bandage', count: 1 },
    castTime: 3,
  },

  // ----- Tailoring (cloth → caster armor; MAG archetype) ----------------------
  // Bolts are the cheap skill-up spine: a bolt of linen is the free starter.
  bolt_of_linen: {
    id: 'bolt_of_linen', profId: 'tailoring', name: 'Bolt of Linen Cloth', icon: 'bolt_of_linen',
    requiredSkill: 1, yellowAt: 20, greenAt: 40, greyAt: 60,
    reagents: [{ itemId: 'linen_cloth', count: 3 }], output: { itemId: 'bolt_of_linen', count: 1 }, castTime: 2,
  },
  bolt_of_woolen: {
    id: 'bolt_of_woolen', profId: 'tailoring', name: 'Bolt of Woolen Cloth', icon: 'bolt_of_woolen',
    requiredSkill: 50, yellowAt: 65, greenAt: 78, greyAt: 90,
    reagents: [{ itemId: 'wool_cloth', count: 4 }], output: { itemId: 'bolt_of_woolen', count: 1 }, castTime: 2,
  },
  bolt_of_silk: {
    id: 'bolt_of_silk', profId: 'tailoring', name: 'Bolt of Silk Cloth', icon: 'bolt_of_silk',
    requiredSkill: 70, yellowAt: 82, greenAt: 92, greyAt: 100,
    reagents: [{ itemId: 'silk_cloth', count: 5 }], output: { itemId: 'bolt_of_silk', count: 1 }, castTime: 2,
  },
  linen_boots: {
    id: 'linen_boots', profId: 'tailoring', name: 'Linen Boots', icon: 'linen_boots',
    requiredSkill: 15, yellowAt: 30, greenAt: 43, greyAt: 55,
    reagents: [{ itemId: 'bolt_of_linen', count: 2 }, { itemId: 'coarse_thread', count: 1 }], output: { itemId: 'linen_boots', count: 1 }, castTime: 3,
  },
  linen_pants: {
    id: 'linen_pants', profId: 'tailoring', name: 'Linen Pants', icon: 'linen_pants',
    requiredSkill: 30, yellowAt: 45, greenAt: 58, greyAt: 70,
    reagents: [{ itemId: 'bolt_of_linen', count: 3 }, { itemId: 'coarse_thread', count: 1 }], output: { itemId: 'linen_pants', count: 1 }, castTime: 3,
  },
  linen_robe: {
    id: 'linen_robe', profId: 'tailoring', name: 'Linen Robe', icon: 'linen_robe',
    requiredSkill: 45, yellowAt: 58, greenAt: 70, greyAt: 82,
    reagents: [{ itemId: 'bolt_of_linen', count: 4 }, { itemId: 'coarse_thread', count: 2 }], output: { itemId: 'linen_robe', count: 1 }, castTime: 3,
  },
  woolen_slippers: {
    id: 'woolen_slippers', profId: 'tailoring', name: 'Woolen Slippers', icon: 'woolen_slippers',
    requiredSkill: 52, yellowAt: 65, greenAt: 78, greyAt: 90,
    reagents: [{ itemId: 'bolt_of_woolen', count: 2 }, { itemId: 'rough_thread', count: 1 }], output: { itemId: 'woolen_slippers', count: 1 }, castTime: 3,
  },
  woolen_leggings: {
    id: 'woolen_leggings', profId: 'tailoring', name: 'Woolen Leggings', icon: 'woolen_leggings',
    requiredSkill: 58, yellowAt: 70, greenAt: 82, greyAt: 95,
    reagents: [{ itemId: 'bolt_of_woolen', count: 3 }, { itemId: 'light_leather_straps', count: 1 }, { itemId: 'rough_thread', count: 1 }], output: { itemId: 'woolen_leggings', count: 1 }, castTime: 3,
  },
  woolen_tunic: {
    id: 'woolen_tunic', profId: 'tailoring', name: 'Woolen Tunic', icon: 'woolen_tunic',
    requiredSkill: 65, yellowAt: 78, greenAt: 90, greyAt: 100,
    reagents: [{ itemId: 'bolt_of_woolen', count: 4 }, { itemId: 'light_leather_straps', count: 1 }, { itemId: 'rough_thread', count: 2 }], output: { itemId: 'woolen_tunic', count: 1 }, castTime: 3,
  },
  silk_slippers: {
    id: 'silk_slippers', profId: 'tailoring', name: 'Silk Slippers', icon: 'silk_slippers',
    requiredSkill: 74, yellowAt: 84, greenAt: 93, greyAt: 100,
    reagents: [{ itemId: 'bolt_of_silk', count: 2 }, { itemId: 'fine_thread', count: 1 }], output: { itemId: 'silk_slippers', count: 1 }, castTime: 3,
  },
  silk_leggings: {
    id: 'silk_leggings', profId: 'tailoring', name: 'Silk Leggings', icon: 'silk_leggings',
    requiredSkill: 78, yellowAt: 87, greenAt: 95, greyAt: 100,
    reagents: [{ itemId: 'bolt_of_silk', count: 3 }, { itemId: 'fine_thread', count: 2 }], output: { itemId: 'silk_leggings', count: 1 }, castTime: 3,
  },
  silk_brocade_robe: {
    id: 'silk_brocade_robe', profId: 'tailoring', name: 'Silk Brocade Robe', icon: 'silk_brocade_robe',
    requiredSkill: 85, yellowAt: 92, greenAt: 97, greyAt: 100,
    reagents: [
      { itemId: 'bolt_of_silk', count: 3 }, { itemId: 'fine_thread', count: 1 },
      { itemId: 'heavy_leather_straps', count: 2 }, { itemId: 'cured_heavy_hide', count: 1 },
    ], output: { itemId: 'silk_brocade_robe', count: 1 }, castTime: 4,
  },

  // ----- Leatherworking (leather → rogue/hunter armor; ROG archetype) ---------
  // Free starter recycles the skin-failure consolation into usable leather.
  light_leather_from_scraps: {
    id: 'light_leather_from_scraps', profId: 'leatherworking', name: 'Light Leather', icon: 'light_leather',
    requiredSkill: 1, yellowAt: 20, greenAt: 40, greyAt: 60,
    reagents: [{ itemId: 'ruined_leather_scraps', count: 3 }], output: { itemId: 'light_leather', count: 1 }, castTime: 2,
  },
  light_leather_boots: {
    id: 'light_leather_boots', profId: 'leatherworking', name: 'Light Leather Boots', icon: 'light_leather_boots',
    requiredSkill: 1, yellowAt: 16, greenAt: 30, greyAt: 45,
    reagents: [{ itemId: 'light_leather', count: 3 }, { itemId: 'coarse_thread', count: 1 }], output: { itemId: 'light_leather_boots', count: 1 }, castTime: 3,
  },
  light_leather_straps: {
    id: 'light_leather_straps', profId: 'leatherworking', name: 'Light Leather Straps', icon: 'light_leather_straps',
    requiredSkill: 10, yellowAt: 25, greenAt: 40, greyAt: 55,
    reagents: [{ itemId: 'light_leather', count: 3 }], output: { itemId: 'light_leather_straps', count: 1 }, castTime: 2,
  },
  light_leather_vest: {
    id: 'light_leather_vest', profId: 'leatherworking', name: 'Light Leather Vest', icon: 'light_leather_vest',
    requiredSkill: 20, yellowAt: 35, greenAt: 48, greyAt: 60,
    reagents: [{ itemId: 'light_leather', count: 5 }, { itemId: 'coarse_thread', count: 1 }], output: { itemId: 'light_leather_vest', count: 1 }, castTime: 3,
  },
  cured_light_hide: {
    id: 'cured_light_hide', profId: 'leatherworking', name: 'Cured Light Hide', icon: 'cured_light_hide',
    requiredSkill: 25, yellowAt: 40, greenAt: 53, greyAt: 65,
    reagents: [{ itemId: 'salt', count: 1 }, { itemId: 'light_hide', count: 1 }], output: { itemId: 'cured_light_hide', count: 1 }, castTime: 2,
  },
  cured_leather_pants: {
    id: 'cured_leather_pants', profId: 'leatherworking', name: 'Cured Leather Pants', icon: 'cured_leather_pants',
    requiredSkill: 40, yellowAt: 55, greenAt: 68, greyAt: 80,
    reagents: [{ itemId: 'light_leather', count: 6 }, { itemId: 'cured_light_hide', count: 1 }, { itemId: 'coarse_thread', count: 2 }], output: { itemId: 'cured_leather_pants', count: 1 }, castTime: 3,
  },
  medium_leather_upcycle: {
    id: 'medium_leather_upcycle', profId: 'leatherworking', name: 'Medium Leather', icon: 'medium_leather',
    requiredSkill: 50, yellowAt: 62, greenAt: 75, greyAt: 88,
    reagents: [{ itemId: 'light_leather', count: 3 }], output: { itemId: 'medium_leather', count: 1 }, castTime: 2,
  },
  medium_leather_boots: {
    id: 'medium_leather_boots', profId: 'leatherworking', name: 'Medium Leather Boots', icon: 'medium_leather_boots',
    requiredSkill: 50, yellowAt: 65, greenAt: 78, greyAt: 90,
    reagents: [{ itemId: 'medium_leather', count: 3 }, { itemId: 'rough_thread', count: 1 }], output: { itemId: 'medium_leather_boots', count: 1 }, castTime: 3,
  },
  medium_leather_vest: {
    id: 'medium_leather_vest', profId: 'leatherworking', name: 'Medium Leather Vest', icon: 'medium_leather_vest',
    requiredSkill: 55, yellowAt: 68, greenAt: 80, greyAt: 92,
    reagents: [{ itemId: 'medium_leather', count: 5 }, { itemId: 'light_leather_straps', count: 1 }, { itemId: 'rough_thread', count: 2 }], output: { itemId: 'medium_leather_vest', count: 1 }, castTime: 3,
  },
  cured_medium_hide: {
    id: 'cured_medium_hide', profId: 'leatherworking', name: 'Cured Medium Hide', icon: 'cured_medium_hide',
    requiredSkill: 60, yellowAt: 72, greenAt: 85, greyAt: 97,
    reagents: [{ itemId: 'salt', count: 1 }, { itemId: 'medium_hide', count: 1 }], output: { itemId: 'cured_medium_hide', count: 1 }, castTime: 2,
  },
  medium_leather_pants: {
    id: 'medium_leather_pants', profId: 'leatherworking', name: 'Medium Leather Pants', icon: 'medium_leather_pants',
    requiredSkill: 62, yellowAt: 75, greenAt: 88, greyAt: 100,
    reagents: [{ itemId: 'medium_leather', count: 4 }, { itemId: 'light_leather_straps', count: 1 }, { itemId: 'rough_thread', count: 1 }], output: { itemId: 'medium_leather_pants', count: 1 }, castTime: 3,
  },
  studded_leather_vest: {
    id: 'studded_leather_vest', profId: 'leatherworking', name: 'Studded Leather Vest', icon: 'studded_leather_vest',
    requiredSkill: 70, yellowAt: 82, greenAt: 93, greyAt: 100,
    reagents: [{ itemId: 'medium_leather', count: 5 }, { itemId: 'cured_medium_hide', count: 1 }, { itemId: 'rough_thread', count: 2 }], output: { itemId: 'studded_leather_vest', count: 1 }, castTime: 3,
  },
  heavy_leather_upcycle: {
    id: 'heavy_leather_upcycle', profId: 'leatherworking', name: 'Heavy Leather', icon: 'heavy_leather',
    requiredSkill: 73, yellowAt: 84, greenAt: 94, greyAt: 100,
    reagents: [{ itemId: 'medium_leather', count: 4 }], output: { itemId: 'heavy_leather', count: 1 }, castTime: 2,
  },
  heavy_leather_straps: {
    id: 'heavy_leather_straps', profId: 'leatherworking', name: 'Heavy Leather Straps', icon: 'heavy_leather_straps',
    requiredSkill: 75, yellowAt: 86, greenAt: 95, greyAt: 100,
    reagents: [{ itemId: 'heavy_leather', count: 3 }], output: { itemId: 'heavy_leather_straps', count: 1 }, castTime: 2,
  },
  cured_heavy_hide: {
    id: 'cured_heavy_hide', profId: 'leatherworking', name: 'Cured Heavy Hide', icon: 'cured_heavy_hide',
    requiredSkill: 80, yellowAt: 90, greenAt: 97, greyAt: 100,
    reagents: [{ itemId: 'salt', count: 1 }, { itemId: 'heavy_hide', count: 1 }], output: { itemId: 'cured_heavy_hide', count: 1 }, castTime: 2,
  },
  heavy_leather_vest: {
    id: 'heavy_leather_vest', profId: 'leatherworking', name: 'Heavy Leather Vest', icon: 'heavy_leather_vest',
    requiredSkill: 82, yellowAt: 91, greenAt: 97, greyAt: 100,
    reagents: [{ itemId: 'heavy_leather', count: 5 }, { itemId: 'cured_heavy_hide', count: 1 }, { itemId: 'fine_thread', count: 1 }], output: { itemId: 'heavy_leather_vest', count: 1 }, castTime: 3,
  },
  direhide_legguards: {
    id: 'direhide_legguards', profId: 'leatherworking', name: 'Direhide Legguards', icon: 'direhide_legguards',
    requiredSkill: 88, yellowAt: 94, greenAt: 98, greyAt: 100,
    reagents: [
      { itemId: 'heavy_leather', count: 6 }, { itemId: 'heavy_leather_straps', count: 2 },
      { itemId: 'cured_heavy_hide', count: 1 }, { itemId: 'bolt_of_silk', count: 1 }, { itemId: 'fine_thread', count: 1 },
    ], output: { itemId: 'direhide_legguards', count: 1 }, castTime: 4,
  },
};

export const PROFESSIONS: Record<string, ProfessionDef> = {
  first_aid: {
    id: 'first_aid', name: 'First Aid', kind: 'secondary', maxSkill: JOURNEYMAN_CAP,
    tiers: STANDARD_TIERS,
    recipes: [
      'linen_bandage', 'heavy_linen_bandage', 'wool_bandage',
      'heavy_wool_bandage', 'silk_bandage', 'heavy_silk_bandage',
    ],
  },
  // Skinning is a gathering primary — it skins beast corpses for leather/hides
  // and crafts nothing, so `recipes` is empty (the K Skills pane shows it as a
  // bar-only profession). Its skill-up loop lives in the Sim's completeSkin.
  skinning: {
    id: 'skinning', name: 'Skinning', kind: 'primary', maxSkill: JOURNEYMAN_CAP,
    tiers: STANDARD_TIERS, recipes: [],
  },
  leatherworking: {
    id: 'leatherworking', name: 'Leatherworking', kind: 'primary', maxSkill: JOURNEYMAN_CAP,
    tiers: STANDARD_TIERS,
    recipes: [
      'light_leather_from_scraps', 'light_leather_boots', 'light_leather_straps',
      'light_leather_vest', 'cured_light_hide', 'cured_leather_pants',
      'medium_leather_upcycle', 'medium_leather_boots', 'medium_leather_vest',
      'cured_medium_hide', 'medium_leather_pants', 'studded_leather_vest',
      'heavy_leather_upcycle', 'heavy_leather_straps', 'cured_heavy_hide',
      'heavy_leather_vest', 'direhide_legguards',
    ],
  },
  tailoring: {
    id: 'tailoring', name: 'Tailoring', kind: 'primary', maxSkill: JOURNEYMAN_CAP,
    tiers: STANDARD_TIERS,
    recipes: [
      'bolt_of_linen', 'bolt_of_woolen', 'bolt_of_silk',
      'linen_boots', 'linen_pants', 'linen_robe',
      'woolen_slippers', 'woolen_leggings', 'woolen_tunic',
      'silk_slippers', 'silk_leggings', 'silk_brocade_robe',
    ],
  },
};

// Cloth dropped by humanoids (family-gated injection in rollLoot). Three tiers
// band by mob level with deliberate overlap, so the linen->wool and wool->silk
// transitions are gradual: a level 7-8 humanoid drops linen OR wool, a level
// 14-15 humanoid drops wool OR silk. The drop-or-not roll (CLOTH_DROP_CHANCE) is
// independent of tier — a humanoid often drops no cloth; only on a hit is a tier
// chosen. Silk caps at 20 (today's level ceiling). Higher cloth tiers
// (mageweave, runecloth) get appended here once Alternate Advancement adds
// level-20+ humanoids — see docs/prd/professions-and-crafting.md §22.
export const CLOTH_DROP_CHANCE = 0.35;
export const CLOTH_QTY = { min: 1, max: 2 } as const;
// Families that drop cloth (the cloth-wearing humanoid types). These are exactly
// the families that used to drop the legacy linen_scrap junk.
export const CLOTH_FAMILIES: MobFamily[] = ['humanoid', 'murloc', 'kobold'];
// Cloth scrap is a consolation junk drop: a cloth-band mob that fails its cloth
// roll can still drop the scrap matching its tier (one scrap per cloth tier).
export const SCRAP_DROP_CHANCE = 0.3;
export const CLOTH_SCRAP: Record<string, string> = {
  linen_cloth: 'linen_scrap',
  wool_cloth: 'wool_scrap',
  silk_cloth: 'silk_scrap',
};
export const CLOTH_BANDS: { itemId: string; min: number; max: number }[] = [
  { itemId: 'linen_cloth', min: 1, max: 8 },
  { itemId: 'wool_cloth', min: 7, max: 15 },
  { itemId: 'silk_cloth', min: 14, max: 20 },
];
// precomputed level -> tier-ids, built once at load (rollLoot runs this per kill,
// hot under RL bench). generous ceiling above today's level cap; out-of-range
// falls back to the shared empty array.
const CLOTH_BANDS_MAX_LEVEL = 40;
const NO_CLOTH: readonly string[] = Object.freeze([]);
const CLOTH_BY_LEVEL: readonly (readonly string[])[] = Object.freeze(
  Array.from({ length: CLOTH_BANDS_MAX_LEVEL + 1 }, (_, lvl) =>
    Object.freeze(CLOTH_BANDS.filter((b) => lvl >= b.min && lvl <= b.max).map((b) => b.itemId))),
);
export function clothCandidates(mobLevel: number): readonly string[] {
  return CLOTH_BY_LEVEL[mobLevel] ?? NO_CLOTH;
}

// Leather from Skinning beast corpses — same level bands / overlap as cloth.
// The skin yields 1–2 of the level-banded tier (or, on a difficulty-scaled
// failure, ruined scraps), and rolls a rare tier-matched hide independently.
export const LEATHER_BANDS: { itemId: string; min: number; max: number }[] = [
  { itemId: 'light_leather', min: 1, max: 8 },
  { itemId: 'medium_leather', min: 7, max: 15 },
  { itemId: 'heavy_leather', min: 14, max: 20 },
];
export const SKIN_QTY = { min: 1, max: 2 } as const;
// rare tier-matched hide roll (independent of the leather/scrap result)
export const SKIN_HIDE_CHANCE = 0.03; // tunable 2–5%
export const HIDE_BY_LEATHER: Record<string, string> = {
  light_leather: 'light_hide',
  medium_leather: 'medium_hide',
  heavy_leather: 'heavy_hide',
};
// chance to get ruined scraps INSTEAD of leather, by difficulty color — highest
// at orange, zero at grey (out-levelling a beast guarantees clean leather)
export const SKIN_FAILURE_CHANCE: Record<DifficultyColor, number> = {
  orange: 0.30, yellow: 0.20, green: 0.10, grey: 0,
};
// ruined-scrap count on a failed skin, by leather tier
export const SCRAP_COUNT_BY_LEATHER: Record<string, { min: number; max: number }> = {
  light_leather: { min: 1, max: 2 },
  medium_leather: { min: 2, max: 4 },
  heavy_leather: { min: 3, max: 5 },
};
const LEATHER_BANDS_MAX_LEVEL = 40;
const NO_LEATHER: readonly string[] = Object.freeze([]);
const LEATHER_BY_LEVEL: readonly (readonly string[])[] = Object.freeze(
  Array.from({ length: LEATHER_BANDS_MAX_LEVEL + 1 }, (_, lvl) =>
    Object.freeze(LEATHER_BANDS.filter((b) => lvl >= b.min && lvl <= b.max).map((b) => b.itemId))),
);
export function leatherCandidates(mobLevel: number): readonly string[] {
  return LEATHER_BY_LEVEL[mobLevel] ?? NO_LEATHER;
}

// Skinning gate vs. difficulty are two quantities (PRD §16.3). `skinNat` is the
// beast's natural skill value and anchors the difficulty color; `skinReq` is the
// minimum skill to skin at all — graced to 1 for level ≤ 3 so low beasts are
// skinnable from the start while still colouring by their natural level.
export function skinNat(mobLevel: number): number { return mobLevel * 5; }
export function skinReq(mobLevel: number): number { return mobLevel <= 3 ? 1 : mobLevel * 5; }
export function skinDifficulty(skill: number, mobLevel: number): DifficultyColor {
  const nat = skinNat(mobLevel);
  if (skill < nat + 5) return 'orange';
  if (skill < nat + 10) return 'yellow';
  if (skill < nat + 15) return 'green';
  return 'grey';
}

// Vendor trade goods — defined once and spread into each Provisioner's
// vendorItems (one source of truth; seeds a future trade-goods-vendor template).
export const TRADE_GOODS: string[] = ['coarse_thread', 'rough_thread', 'fine_thread', 'salt'];

// --- helpers (pure) ------------------------------------------------------

export function difficultyColor(skill: number, r: RecipeDef): DifficultyColor {
  if (skill < r.yellowAt) return 'orange';
  if (skill < r.greenAt) return 'yellow';
  if (skill < r.greyAt) return 'green';
  return 'grey';
}

// The skill ceiling a player can currently reach given the highest tier learned.
export function tierCap(prof: ProfessionDef, learnedTier: TierId | undefined): number {
  if (!learnedTier) return APPRENTICE_CAP;
  const t = prof.tiers.find((x) => x.id === learnedTier);
  return t ? t.cap : APPRENTICE_CAP;
}

// The next tier a player may train (or null if fully trained), and whether their
// current skill qualifies.
export function nextTier(prof: ProfessionDef, learnedTier: TierId | undefined): ProfessionTier | null {
  const idx = learnedTier ? prof.tiers.findIndex((t) => t.id === learnedTier) : -1;
  return prof.tiers[idx + 1] ?? null;
}

// --- learning costs (copper) ----------------------------------------------
// Costs start cheap and ramp up fast. Tiers jump ~10x from Apprentice to
// Journeyman; primaries cost ~3x secondaries. Recipe cost scales with the SQUARE
// of required skill, so a recipe at skill 20 costs the same across same-kind
// professions but high-skill recipes get expensive quickly. The starter recipe
// (skill <= 1) is taught free. Calibrated against the live economy (median quest
// ~600c, vendor gear ~1500c); see docs/prd/professions-and-crafting.md open
// question on economy weight.
// Apprentice (the entry cost to start a profession) stays cheap; everything past it
// ramps hard — Journeyman and recipes are ~3x the first pass so a fully-trained
// profession is a real gold investment, not pocket change.
export const TIER_COST: Record<ProfessionKind, Record<TierId, number>> = {
  secondary: { apprentice: 50, journeyman: 1500 },
  primary: { apprentice: 150, journeyman: 4500 },
};
// quadratic coefficient: cost = round(requiredSkill^2 * k), floored at MIN
export const RECIPE_COST_K: Record<ProfessionKind, number> = { secondary: 0.3, primary: 0.6 };
const MIN_RECIPE_COST = 5;

export function tierLearnCost(prof: ProfessionDef, tier: TierId): number {
  return TIER_COST[prof.kind][tier];
}
export function recipeLearnCost(recipe: RecipeDef): number {
  const kind = PROFESSIONS[recipe.profId]?.kind ?? 'secondary';
  return Math.max(MIN_RECIPE_COST, Math.round(recipe.requiredSkill * recipe.requiredSkill * RECIPE_COST_K[kind]));
}

// Validate the registry against the item table. Returns a list of problems
// (empty = ok). Called at data.ts module load (throws) and from tests.
export function validateProfessions(items: Record<string, { id: string }>): string[] {
  const errs: string[] = [];
  for (const prof of Object.values(PROFESSIONS)) {
    if (prof.maxSkill > PROFESSION_MAX) errs.push(`${prof.id}: maxSkill ${prof.maxSkill} > ${PROFESSION_MAX}`);
    for (const rid of prof.recipes) {
      const r = RECIPES[rid];
      if (!r) { errs.push(`${prof.id}: missing recipe ${rid}`); continue; }
      if (r.profId !== prof.id) errs.push(`${rid}: profId ${r.profId} != ${prof.id}`);
      if (!(r.requiredSkill <= r.yellowAt && r.yellowAt <= r.greenAt && r.greenAt <= r.greyAt)) {
        errs.push(`${rid}: difficulty thresholds out of order`);
      }
      if (r.requiredSkill > prof.maxSkill) errs.push(`${rid}: requiredSkill above maxSkill`);
      if (!items[r.output.itemId]) errs.push(`${rid}: unknown output item ${r.output.itemId}`);
      for (const reg of r.reagents) {
        if (!items[reg.itemId]) errs.push(`${rid}: unknown reagent ${reg.itemId}`);
      }
    }
  }
  // Skinning yields + trade goods aren't all referenced as recipe reagents, so
  // validate them directly (same fail-fast as recipes).
  for (const b of [...CLOTH_BANDS, ...LEATHER_BANDS]) {
    if (!items[b.itemId]) errs.push(`band: unknown item ${b.itemId}`);
  }
  for (const id of Object.values(HIDE_BY_LEATHER)) {
    if (!items[id]) errs.push(`hide: unknown item ${id}`);
  }
  for (const id of TRADE_GOODS) {
    if (!items[id]) errs.push(`trade good: unknown item ${id}`);
  }
  return errs;
}
