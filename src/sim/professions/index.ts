// Public barrel for the professions subsystem contracts (#1164). Only
// re-exports the shared types; the IWorld read-surface facet lives at
// src/world_api/professions.ts (parallel to every other facet under
// src/world_api/), which imports the PlayerProfessionSkill type from here.
export type {
  PlayerProfessionSkill,
  ProfessionCategory,
  ProfessionCraftRecord,
  ProfessionNodeRecord,
  ProfessionReagent,
  ProfessionRecipeRecord,
  ProfessionRecord,
} from './types';
