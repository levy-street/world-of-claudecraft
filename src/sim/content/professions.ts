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
export const CLOTH_FAMILIES: string[] = ['humanoid', 'murloc', 'kobold'];
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
export function clothCandidates(mobLevel: number): string[] {
  return CLOTH_BANDS.filter((b) => mobLevel >= b.min && mobLevel <= b.max).map((b) => b.itemId);
}

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
// ~600c, vendor gear ~1500c) in .claude/design/economy-reference.local.md.
export const TIER_COST: Record<ProfessionKind, Record<TierId, number>> = {
  secondary: { apprentice: 50, journeyman: 500 },
  primary: { apprentice: 150, journeyman: 1500 },
};
// quadratic coefficient: cost = round(requiredSkill^2 * k), floored at MIN
export const RECIPE_COST_K: Record<ProfessionKind, number> = { secondary: 0.1, primary: 0.2 };
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
  return errs;
}
