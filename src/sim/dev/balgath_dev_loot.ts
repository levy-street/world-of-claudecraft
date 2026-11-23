// `/dev balgath loot`: put all of Balgath's new spoils in the caller's bags at once (the
// five trinkets and the Craterglass Stave), so a playtest can try each trinket without
// farming a world boss. Dev-command realms only, like every /dev verb (ctx.devCommands
// is checked by the dispatcher before any /dev line reaches here). Draws no rng.

import { BALGATH_TRINKET_ITEM_IDS } from '../content/trinkets';
import type { SimContext } from '../sim_context';

/** Everything the verb hands out, in the order it tries to. */
export const BALGATH_DEV_LOOT_ITEM_IDS: readonly string[] = [
  ...BALGATH_TRINKET_ITEM_IDS,
  'craterglass_stave',
];

/** The help line (balgath_dev_mechanics.ts balgathDevHelp lists it). */
export const BALGATH_DEV_LOOT_HELP =
  '/dev balgath loot: get all five Balgath trinkets and the Craterglass Stave (equip a trinket, then use it from the character window or your action bar)';

/** True for exactly `/dev balgath loot`. */
export function isBalgathDevLootCommand(raw: string): boolean {
  return /^\/(?:dev\s+balgath|devbalgath)\s+loot\s*$/i.test(raw);
}

/** Grant the missing pieces; reports what landed and what did not fit. */
export function runBalgathDevLoot(ctx: SimContext, pid: number): { ok: boolean; message: string } {
  if (!ctx.resolve(pid)) return { ok: false, message: 'No caller.' };
  const given: string[] = [];
  const full: string[] = [];
  for (const itemId of BALGATH_DEV_LOOT_ITEM_IDS) {
    if (!ctx.canAddItem(itemId, 1, pid)) {
      full.push(itemId);
      continue;
    }
    ctx.addItem(itemId, 1, pid);
    given.push(itemId);
  }
  if (given.length === 0) return { ok: false, message: 'Your bags are full.' };
  return {
    ok: true,
    message:
      full.length === 0
        ? `Balgath's spoils are in your bags: ${given.join(', ')}.`
        : `Gave ${given.join(', ')}; no room for ${full.join(', ')}.`,
  };
}
