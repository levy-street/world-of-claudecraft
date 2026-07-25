import type { SourceCaveRosterEntry } from './types';

// Offline / headless roster used whenever no live GitHub contributor roster is
// available (offline browser world, headless RL env, or a server that failed
// to fetch). Snapshot of the complete real developer leaderboard (2026-07-11),
// so the offline cave honours the same contributors the live one does. The
// roster contains ranked contributors only; synthetic tests cover the unranked
// tier profile separately. mergedPrs values fan across every ranked Source Cave
// contributor tier profile, including two 70+ entries, and rank 1 is the boss.
export const SOURCE_CAVE_PLACEHOLDER_ROSTER: SourceCaveRosterEntry[] = [
  { login: 'jgyy', mergedPrs: 204, rank: 1 },
  { login: 'Rubsey', mergedPrs: 125, rank: 2 },
  { login: 'TrevCavill', mergedPrs: 60, rank: 3 },
  { login: 'ryan-foo', mergedPrs: 44, rank: 4 },
  { login: 'madmatah', mergedPrs: 38, rank: 5 },
  { login: 'FernandoX7', mergedPrs: 36, rank: 6 },
  { login: 'EnriqueGF', mergedPrs: 35, rank: 7 },
  { login: 'gndk', mergedPrs: 23, rank: 8 },
  { login: 'Blaine1705', mergedPrs: 22, rank: 9 },
  { login: 'maxpolaczuk', mergedPrs: 22, rank: 10 },
  { login: 'patrick261', mergedPrs: 21, rank: 11 },
  { login: 'sf-chris', mergedPrs: 21, rank: 12 },
  { login: 'MasterZensei', mergedPrs: 15, rank: 13 },
  { login: 'jbaron34', mergedPrs: 12, rank: 14 },
  { login: 'daxdax89', mergedPrs: 11, rank: 15 },
  { login: 'nicadeddu', mergedPrs: 11, rank: 16 },
  { login: 'Donny-Deals', mergedPrs: 10, rank: 17 },
  { login: 'CharlieSaxton', mergedPrs: 9, rank: 18 },
  { login: 'Nervescraper', mergedPrs: 9, rank: 19 },
  { login: 'DaPandamonium', mergedPrs: 8, rank: 20 },
  { login: 'No898', mergedPrs: 5, rank: 21 },
  { login: 'ChrisDBaldwin', mergedPrs: 4, rank: 22 },
  { login: 'slonce70', mergedPrs: 4, rank: 23 },
  { login: 'aqn96', mergedPrs: 3, rank: 24 },
  { login: 'awidearray', mergedPrs: 3, rank: 25 },
  { login: 'jamiecypher', mergedPrs: 3, rank: 26 },
  { login: 'postoso', mergedPrs: 3, rank: 27 },
  { login: 'Steakmushroompie', mergedPrs: 3, rank: 28 },
  { login: 'Humpalumps', mergedPrs: 2, rank: 29 },
  { login: 'Pepijnvdliefvoort', mergedPrs: 2, rank: 30 },
  { login: 'a-aznar', mergedPrs: 1, rank: 31 },
  { login: 'AccompliceNZ', mergedPrs: 1, rank: 32 },
  { login: 'Dubtribe11', mergedPrs: 1, rank: 33 },
  { login: 'gurtymcburty', mergedPrs: 1, rank: 34 },
  { login: 'IMasterChiefI', mergedPrs: 1, rank: 35 },
  { login: 'SturdyStubs', mergedPrs: 1, rank: 36 },
  { login: 'zaidsinwan7474', mergedPrs: 1, rank: 37 },
];
