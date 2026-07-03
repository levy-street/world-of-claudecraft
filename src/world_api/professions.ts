import type { PlayerProfessionSkill } from '../sim/professions/types';

// Render-safe projection of a player's professions standing. Stub as of
// #1164: always empty until #1119/#1120 land skill tracking + recipes.
export interface PlayerProfessionsView {
  skills: readonly PlayerProfessionSkill[];
}

// The professions read-surface facet (#1164). Stub read surface: both `Sim`
// and `ClientWorld` return an empty `PlayerProfessionsView` for now. Future
// issues (#1119/#1120/#1125/#1126/#1140) extend this facet with the real
// skill/craft/recipe/node mechanics; see src/sim/professions/CLAUDE.md for the
// settled wire/persistence key names those issues build against.
export interface IWorldProfessions {
  professionsState: PlayerProfessionsView;
}
