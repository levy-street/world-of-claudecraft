import type { PlayerProfessionSkill } from '../sim/professions/types';

// Render-safe projection of a player's professions standing. Stub as of
// #1164, now real for the gathering professions (#1119): `skills` carries one
// entry per gathering profession (Mining/Logging/Herbalism), independent
// additive counters. Crafting/secondary professions still contribute nothing
// until #1120/#1125/#1126/#1140 land.
export interface PlayerProfessionsView {
  skills: readonly PlayerProfessionSkill[];
}

// The professions read-surface facet (#1164). `Sim` (src/sim/sim.ts
// `professionsState`/`professionsStateFor`) and `ClientWorld` (src/net/
// online.ts, mirrored from the `prof` wire delta) both implement this; see
// src/sim/professions/CLAUDE.md for the settled wire/persistence key names.
export interface IWorldProfessions {
  professionsState: PlayerProfessionsView;
}
