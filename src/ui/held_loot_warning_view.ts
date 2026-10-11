import { ITEMS } from '../sim/data';
import { itemDisplayName } from './entity_i18n';
import { tSim } from './sim_i18n';

/** Promote the personal corpse-hold line, resolving chat tokens for a plain-text toast. */
export function heldLootWarningText(text: string): string | null {
  const match = /^Your bags are full; \[\[i:([^\]]+)\]\] is waiting on the corpse for you\.$/.exec(
    text,
  );
  const item = match ? ITEMS[match[1]] : undefined;
  return item ? tSim('loot.awardHeldOnCorpse', { item: `[${itemDisplayName(item)}]` }) : null;
}
