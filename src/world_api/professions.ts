import type { ProfessionsInfo } from '../sim/professions/types';

export type {
  ProfessionCraftId,
  ProfessionCraftRecord,
  ProfessionItemId,
  ProfessionItemQuantity,
  ProfessionKind,
  ProfessionNodeId,
  ProfessionNodeKind,
  ProfessionNodeRecord,
  ProfessionRecipeId,
  ProfessionRecipeRecord,
  ProfessionSkillId,
  ProfessionSkillProgress,
  ProfessionSkillRecord,
  ProfessionsInfo,
  ProfessionsStateSnapshot,
  ProfessionTier,
  ProfessionZoneId,
} from '../sim/professions/types';

export interface IWorldProfessions {
  professionsInfo(): ProfessionsInfo;
}
