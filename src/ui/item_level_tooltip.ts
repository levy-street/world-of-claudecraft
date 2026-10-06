import { isItemLevelEligible, itemInstanceLevel, itemScore } from '../sim/item_level';
import { isMembershipArmour, membershipItemLevel } from '../sim/membership_armour';
import type { ItemDef, ItemInstancePayload } from '../sim/types';
import { esc } from './esc';
import { t } from './i18n';
import { itemNumber } from './item_instance_tooltip';
import { itemLevelReadout } from './rift_band_tooltip';

/** Membership and quality gear always show their tier; ordinary gear obeys the setting. */
export function itemLevelTooltipLines(
  item: ItemDef,
  instance: ItemInstancePayload | undefined,
  showItemLevel: boolean,
  wearerLevel: number,
): string {
  const membership = isMembershipArmour(item.id);
  if (!isItemLevelEligible(item) || !(membership || instance?.lootQuality || showItemLevel))
    return '';
  let readout: { level: number; score: number } | undefined;
  if (membership) {
    readout = { level: membershipItemLevel(wearerLevel), score: itemScore(item) };
  } else if (instance?.rift || instance?.lootQuality) {
    readout = itemLevelReadout(item, instance);
  } else {
    const level = itemInstanceLevel(item, instance);
    readout = level === undefined ? undefined : { level, score: itemScore(item) };
  }
  if (!readout) return '';
  return `<div class="tt-stat" style="color:var(--gold)">${esc(
    t('hudChrome.options.itemLevelLine', { level: itemNumber(readout.level) }),
  )}</div><div class="tt-sub">${esc(
    t('hudChrome.options.itemScoreLine', {
      score: itemNumber(readout.score, 1),
    }),
  )}</div>`;
}
