// The seasonal event items' tooltip lines (src/sim/content/gourdlight_eve.ts):
// what the pumpkin head, the Jar of Mischief, the treat pouch and the sweet do,
// stated from the live content (the pouch's count is read off the sim constant).
// One small view the item tooltip composes, so the bags, the vendor and the
// market all say the same thing.
import {
  CARVED_PUMPKIN_HEAD_ID,
  GOURDLIGHT_BROOM_ID,
  GOURDLIGHT_COSTUMES,
  GOURDLIGHT_POUCH_SWEETS,
  GOURDLIGHT_SWEET_ID,
  GOURDLIGHT_TITLE_WRITS,
  GOURDLIGHT_TREAT_POUCH_ID,
  JAR_OF_MISCHIEF_ID,
} from '../sim/content/gourdlight_eve';
import {
  STRAWLING_CHARM_ID,
  STRAWLING_GUISE,
  THATCHGRIN_SACK_ID,
  THATCHGRIN_SACK_SWEETS,
} from '../sim/content/gourdlight_eve_scarecrow';
import type { ItemDef } from '../sim/types';
import { deedTitleText } from './deed_i18n';
import { formatNumber, type TranslationKey, t } from './i18n';
import { createTooltipLine } from './tooltip_line';

/** Each costume draught's own sentence (catalog keys by aura id). */
const COSTUME_USE_KEYS: Readonly<Record<string, TranslationKey>> = {
  gourdlight_costume_skeleton: 'seasonal.itemUse.costumeSkeleton',
  gourdlight_costume_ghost: 'seasonal.itemUse.costumeGhost',
  gourdlight_costume_bat: 'seasonal.itemUse.costumeBat',
};

/** The use or purpose line for a seasonal item, or null for any other item. */
export function seasonalItemTooltipText(item: Pick<ItemDef, 'id'>): string | null {
  const costume = GOURDLIGHT_COSTUMES.find((c) => c.itemId === item.id);
  if (costume) {
    const key = COSTUME_USE_KEYS[costume.auraId];
    return key ? t(key, { minutes: formatNumber(costume.duration / 60) }) : null;
  }
  const writ = GOURDLIGHT_TITLE_WRITS.find((w) => w.itemId === item.id);
  if (writ) return t('seasonal.itemUse.titleWrit', { title: deedTitleText(writ.deedId) });
  switch (item.id) {
    case GOURDLIGHT_BROOM_ID:
      return t('seasonal.itemUse.broom');
    case CARVED_PUMPKIN_HEAD_ID:
      return t('seasonal.itemUse.pumpkinHead');
    case JAR_OF_MISCHIEF_ID:
      return t('seasonal.itemUse.trickJar');
    case GOURDLIGHT_TREAT_POUCH_ID:
      return t('seasonal.itemUse.pouch', { count: formatNumber(GOURDLIGHT_POUCH_SWEETS) });
    case GOURDLIGHT_SWEET_ID:
      return t('seasonal.itemUse.sweet');
    case THATCHGRIN_SACK_ID:
      return t('seasonal.itemUse.pouch', { count: formatNumber(THATCHGRIN_SACK_SWEETS) });
    case STRAWLING_CHARM_ID:
      return t('seasonal.itemUse.strawlingCharm', {
        seconds: formatNumber(STRAWLING_GUISE.duration),
      });
    default:
      return null;
  }
}

/** The line as tooltip HTML (empty for any other item). */
export function seasonalItemTooltipLines(item: Pick<ItemDef, 'id'>): string {
  const text = seasonalItemTooltipText(item);
  return text ? createTooltipLine(text, 'tt-desc').outerHTML : '';
}
