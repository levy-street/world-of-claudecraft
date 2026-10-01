// The tracked-item history model (src/sim/item_provenance.ts): the plain
// lines the right-click "Item history" dialog renders for an epic or
// legendary copy. Where it came from and who first obtained it (a kill, a
// quest reward, or a generic "obtained"), then every later hand in order,
// and how many earlier hands rolled off the bounded chain. Deliberately NO
// item ID anywhere: the guid stays a server and operator fact
// (docs/design/item-tracking.md), never a player-visible string. Pure
// string builders (a UI_PURE_CORES member): no DOM, no clock; the dates come
// from the record's own host epoch ms through the i18n formatter.

import type { ItemOwnerRecord, ItemProvenance } from '../sim/types';
import { formatDateTime, formatNumber, t } from './i18n';

const MOB_SOURCE_PREFIX = 'mob:';
const QUEST_SOURCE_PREFIX = 'quest:';

/** The origin line's key for a provenance source id. */
export function provenanceOriginKey(
  source: string,
):
  | 'hudChrome.itemTooltip.lootedBy'
  | 'hudChrome.itemTooltip.questRewardTo'
  | 'hudChrome.itemTooltip.obtainedBy' {
  if (source.startsWith(MOB_SOURCE_PREFIX)) return 'hudChrome.itemTooltip.lootedBy';
  if (source.startsWith(QUEST_SOURCE_PREFIX)) return 'hudChrome.itemTooltip.questRewardTo';
  return 'hudChrome.itemTooltip.obtainedBy';
}

function dateOf(record: ItemOwnerRecord): string {
  return formatDateTime(record.at, { dateStyle: 'medium' });
}

export interface ItemHistoryModel {
  /** "Looted by X on date" (or the quest / generic wording). */
  origin: string;
  /** One line per later hand, oldest first: "Passed to X on date". */
  hands: string[];
  /** The "never changed hands" line when `hands` is empty, else null. */
  noTransfers: string | null;
  /** The "N earlier transfers are not shown" line once the bounded chain
   *  has rolled, else null. */
  earlierHidden: string | null;
}

export function itemHistoryModel(provenance: ItemProvenance): ItemHistoryModel {
  const origin = t(provenanceOriginKey(provenance.source), {
    name: provenance.by,
    date: dateOf(provenance),
  });
  const owners = Array.isArray(provenance.owners) ? provenance.owners : [];
  const hands = owners.map((o) =>
    t('hudChrome.itemHistory.passedTo', { name: o.by, date: dateOf(o) }),
  );
  const transfers = provenance.transfers ?? 0;
  const hidden = Math.max(0, transfers - owners.length);
  return {
    origin,
    hands,
    noTransfers: hands.length === 0 ? t('hudChrome.itemHistory.noTransfers') : null,
    earlierHidden:
      hidden > 0 ? t('hudChrome.itemHistory.earlierHidden', { count: formatNumber(hidden) }) : null,
  };
}
