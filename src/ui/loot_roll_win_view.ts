import { ITEMS } from '../sim/data';
import { itemDisplayName } from './entity_i18n';
import { formatNumber, t } from './i18n';

/** Arguments for the shared gold banner, derived only from an authoritative roll result. */
export function lootRollWinBanner(text: string, playerName: string | undefined) {
  const match = /^(.+) wins \[\[i:([A-Za-z0-9_]+)\]\] \((\d+)\)$/.exec(text);
  if (!match || !playerName || match[1] !== playerName) return null;
  const item = ITEMS[match[2]];
  const roll = Number(match[3]);
  if (!item || roll < 1 || roll > 100) return null;
  const message = t('hudChrome.loot.rollWon', {
    item: `[${itemDisplayName(item)}]`,
    roll: formatNumber(roll),
  });
  // A celebration queues behind an existing one instead of losing the win to a zone banner.
  return [message, true, undefined, 'default', undefined, 5000, null, 'loot'] as const;
}
