// Shared professions contracts. Content and mechanics should import these shapes
// rather than defining parallel skill/craft/recipe/node records.

/** CharacterState JSONB key reserved for persisted profession progress. */
export const PROFESSIONS_CHARACTER_STATE_KEY = 'professions';
/** Self-snapshot key reserved for the future professions client mirror. */
export const PROFESSIONS_SELF_WIRE_KEY = 'professions';

export type ProfessionKind = 'gathering' | 'crafting';
export type ProfessionSkillId = string;
export type ProfessionCraftId = string;
export type ProfessionRecipeId = string;
export type ProfessionNodeId = string;
export type ProfessionItemId = string;
export type ProfessionNodeKind = string;
export type ProfessionZoneId = string;
export type ProfessionTier = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface ProfessionItemQuantity {
  itemId: ProfessionItemId;
  count: number;
}

export interface ProfessionSkillRecord {
  id: ProfessionSkillId;
  kind: ProfessionKind;
  nameKey: string;
  maxRank: number;
}

export interface ProfessionCraftRecord {
  id: ProfessionCraftId;
  skillId: ProfessionSkillId;
  nameKey: string;
  unlockRank: number;
}

export interface ProfessionRecipeRecord {
  id: ProfessionRecipeId;
  craftId: ProfessionCraftId;
  output: ProfessionItemQuantity;
  inputs: readonly ProfessionItemQuantity[];
  tier: ProfessionTier;
  unlockRank: number;
}

export interface ProfessionNodeRecord {
  id: ProfessionNodeId;
  skillId: ProfessionSkillId;
  zoneId: ProfessionZoneId;
  kind: ProfessionNodeKind;
  material: ProfessionItemQuantity;
  tier: ProfessionTier;
  respawnSeconds: number;
}

export interface ProfessionSkillProgress {
  skillId: ProfessionSkillId;
  rank: number;
}

export interface ProfessionsStateSnapshot {
  skills: readonly ProfessionSkillProgress[];
}

export interface ProfessionsInfo {
  skills: readonly ProfessionSkillRecord[];
  crafts: readonly ProfessionCraftRecord[];
  recipes: readonly ProfessionRecipeRecord[];
  nodes: readonly ProfessionNodeRecord[];
  state: ProfessionsStateSnapshot;
}

export const EMPTY_PROFESSIONS_INFO: ProfessionsInfo = {
  skills: [],
  crafts: [],
  recipes: [],
  nodes: [],
  state: { skills: [] },
};
