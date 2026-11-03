// The "encounter in progress" lock's opt-in (instances/encounter_lock.ts): the
// dungeons whose door holds a released spirit outside while one of their boss
// fights runs, each with the boss templates whose fights count. A dungeon not
// listed keeps the plain door (a returning spirit walks in and rises), which is
// every five-man today. Trash never counts: only the bodies listed here.

import {
  SMITH_HEART_COUNCIL,
  SMITH_HEART_DUNGEON,
  SMITH_HEART_FINAL_BOSS,
  SMITH_HEART_GUARDIANS,
} from './smith_heart';

export const ENCOUNTER_LOCK_BOSSES: Readonly<Record<string, readonly string[]>> = {
  // The Hammer Council's two (one fight), the other three guardians, and the
  // Masterless Strength.
  [SMITH_HEART_DUNGEON]: [
    ...SMITH_HEART_COUNCIL,
    SMITH_HEART_GUARDIANS.breath,
    SMITH_HEART_GUARDIANS.quench,
    SMITH_HEART_GUARDIANS.heat,
    SMITH_HEART_FINAL_BOSS,
  ],
};
