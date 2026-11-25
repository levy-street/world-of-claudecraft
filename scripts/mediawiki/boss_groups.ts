import { CAVE_THEMES } from '../../src/sim/content/rift/cave_themes';
import { RIFT_THEMES } from '../../src/sim/content/rift/themes';

// Where a boss is fought. Rift and hoard bosses are easy to lose among dungeon bosses, so
// the wiki lists them by the activity they belong to.

/** The Infernal Citadel is a fixed two-floor rift with its own pair of bosses. */
const CITADEL = 'Infernal Citadel';
const CITADEL_BOSSES = ['rift_boss_ritualist', 'rift_boss_pitlord'];

export interface BossPlace {
  mobId: string;
  /** The rift floor theme, or the kind of hoard, the boss guards. */
  place: string;
}

/** Every rift boss with the floor it is fought on. */
export function riftBosses(): BossPlace[] {
  return [
    ...RIFT_THEMES.map((t) => ({ mobId: t.boss, place: t.name })),
    ...CITADEL_BOSSES.map((mobId) => ({ mobId, place: CITADEL })),
  ];
}

export const CAVE_HOARD = 'Cave hoards (common and rare maps)';
export const VALLEY_HOARD = 'Valley hoards (epic and legendary maps)';

/** Every buried-hoard guardian with the kind of hoard it guards. */
export function hoardBosses(): BossPlace[] {
  return [
    ...CAVE_THEMES.map((t) => ({ mobId: t.boss, place: CAVE_HOARD })),
    ...RIFT_THEMES.map((t) => ({ mobId: t.boss, place: VALLEY_HOARD })),
  ];
}
