import type { SourceCaveRosterEntry } from './types';

// Offline / headless roster used whenever no live GitHub contributor roster is
// available (offline browser world, headless RL env, or a server that failed
// to fetch). Snapshot of the complete real developer leaderboard (2026-07-26),
// so the offline cave honours the same contributors the live one does. The
// roster contains ranked contributors only; synthetic tests cover the unranked
// tier profile separately. mergedPrs values fan across every ranked Source Cave
// contributor tier profile, including five 70+ entries, and rank 1 is the boss.
// It is larger than the 37-slot combat budget (combatants.ts), so the tail of
// the leaderboard rides the cave as overflow guardians.
export const SOURCE_CAVE_PLACEHOLDER_ROSTER: SourceCaveRosterEntry[] = [
  { login: 'jgyy', mergedPrs: 289, rank: 1 },
  { login: 'Rubsey', mergedPrs: 173, rank: 2 },
  { login: 'FernandoX7', mergedPrs: 117, rank: 3 },
  { login: 'TrevCavill', mergedPrs: 74, rank: 4 },
  { login: 'ryan-foo', mergedPrs: 72, rank: 5 },
  { login: 'EnriqueGF', mergedPrs: 51, rank: 6 },
  { login: 'seanghods', mergedPrs: 42, rank: 7 },
  { login: 'madmatah', mergedPrs: 38, rank: 8 },
  { login: 'maxpolaczuk', mergedPrs: 31, rank: 9 },
  { login: 'jamiecypher', mergedPrs: 28, rank: 10 },
  { login: 'Blaine1705', mergedPrs: 26, rank: 11 },
  { login: 'sf-chris', mergedPrs: 24, rank: 12 },
  { login: 'gndk', mergedPrs: 23, rank: 13 },
  { login: 'patrick261', mergedPrs: 21, rank: 14 },
  { login: 'daxdax89', mergedPrs: 17, rank: 15 },
  { login: 'MasterZensei', mergedPrs: 17, rank: 16 },
  { login: 'CharlieSaxton', mergedPrs: 12, rank: 17 },
  { login: 'jbaron34', mergedPrs: 12, rank: 18 },
  { login: 'Donny-Deals', mergedPrs: 11, rank: 19 },
  { login: 'nicadeddu', mergedPrs: 11, rank: 20 },
  { login: 'No898', mergedPrs: 11, rank: 21 },
  { login: 'Nervescraper', mergedPrs: 9, rank: 22 },
  { login: 'DaPandamonium', mergedPrs: 8, rank: 23 },
  { login: 'awidearray', mergedPrs: 4, rank: 24 },
  { login: 'ChrisDBaldwin', mergedPrs: 4, rank: 25 },
  { login: 'Humpalumps', mergedPrs: 4, rank: 26 },
  { login: 'slonce70', mergedPrs: 4, rank: 27 },
  { login: 'Steakmushroompie', mergedPrs: 4, rank: 28 },
  { login: 'aqn96', mergedPrs: 3, rank: 29 },
  { login: 'postoso', mergedPrs: 3, rank: 30 },
  { login: 'Pepijnvdliefvoort', mergedPrs: 2, rank: 31 },
  { login: 'Wmedrado', mergedPrs: 2, rank: 32 },
  { login: 'a-aznar', mergedPrs: 1, rank: 33 },
  { login: 'AccompliceNZ', mergedPrs: 1, rank: 34 },
  { login: 'dems3398', mergedPrs: 1, rank: 35 },
  { login: 'Dubtribe11', mergedPrs: 1, rank: 36 },
  { login: 'gurtymcburty', mergedPrs: 1, rank: 37 },
  { login: 'IMasterChiefI', mergedPrs: 1, rank: 38 },
  { login: 'jfconde', mergedPrs: 1, rank: 39 },
  { login: 'raidolo', mergedPrs: 1, rank: 40 },
  { login: 'snipercup', mergedPrs: 1, rank: 41 },
  { login: 'SturdyStubs', mergedPrs: 1, rank: 42 },
  { login: 'troypolaczuk', mergedPrs: 1, rank: 43 },
  { login: 'zaidsinwan7474', mergedPrs: 1, rank: 44 },
];
