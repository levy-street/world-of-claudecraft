// The one-time raid quest shaping. The existing legendary stays at its
// authored iLvl 55 and is outside Masterwrought equipment/Perfecting rules.
import type { ProfessionRecipeRecord } from '../professions/types';

export const FORGEBREAKER_RECIPES: ProfessionRecipeRecord[] = [
  {
    id: 'recipe_varkhul_forgebreaker',
    professionId: 'weaponcrafting',
    resultItemId: 'varkhul_forgebreaker',
    resultCount: 1,
    reagents: [
      { itemId: 'forgefathers_ember', count: 1, noDiscount: true },
      { itemId: 'lastflame_core', count: 15, noDiscount: true },
      { itemId: 'fine_thorium_ore', count: 10 },
      { itemId: 'fine_elderwood_log', count: 6 },
    ],
    skillReq: 125,
    // The source index retains its authored raid flag: 42 + legendary 10 + raid 3.
    itemLevelBudget: 42,
    level: 42,
    stationType: 'forge',
    acquisition: ['quest'],
    consumeOnCraft: true,
  },
];
