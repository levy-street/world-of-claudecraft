// The seasonal event items' tooltip lines (src/sim/content/gourdlight_eve.ts):
// what the pumpkin head, the Jar of Mischief, Hester's toys, the treat pouch, the sweet, the broom and
// its Emberwoven Sheaf do, stated from the live content (the pouch's count and the
// broom's sheaf price are read off the sim constants).
// One small view the item tooltip composes, so the bags, the vendor and the
// market all say the same thing.
import {
  CARVED_PUMPKIN_HEAD_ID,
  GOURDLIGHT_BROOM_ID,
  GOURDLIGHT_BROOM_SHEAVES,
  GOURDLIGHT_COSTUMES,
  GOURDLIGHT_POUCH_SWEETS,
  GOURDLIGHT_SHEAF_ID,
  GOURDLIGHT_SWEET_ID,
  GOURDLIGHT_TITLE_WRITS,
  GOURDLIGHT_TREAT_POUCH_ID,
  type GourdlightToy,
  gourdlightToy,
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

/** Each toy's own sentence (catalog keys by effect). */
const TOY_USE_KEYS: Readonly<Record<GourdlightToy['effect'], TranslationKey>> = {
  prank: 'seasonal.itemUse.toyPrank',
  lantern: 'seasonal.itemUse.toyLantern',
  bats: 'seasonal.itemUse.toyBats',
  candle: 'seasonal.itemUse.toyCandleShadows',
  cauldron: 'seasonal.itemUse.toyCauldron',
};

/** The use or purpose line for a seasonal item, or null for any other item. */
export function seasonalItemTooltipText(item: Pick<ItemDef, 'id'>): string | null {
  const toy = gourdlightToy(item.id);
  if (toy) {
    return t(TOY_USE_KEYS[toy.effect], {
      seconds: formatNumber(toy.duration),
      cooldown: formatNumber(toy.cooldown),
      range: formatNumber(toy.range ?? 0),
      standing: formatNumber(toy.standsFor ?? 0),
    });
  }
  const costume = GOURDLIGHT_COSTUMES.find((c) => c.itemId === item.id);
  if (costume) {
    const key = COSTUME_USE_KEYS[costume.auraId];
    return key ? t(key, { minutes: formatNumber(costume.duration / 60) }) : null;
  }
  const writ = GOURDLIGHT_TITLE_WRITS.find((w) => w.itemId === item.id);
  if (writ) return t('seasonal.itemUse.titleWrit', { title: deedTitleText(writ.deedId) });
  switch (item.id) {
    case GOURDLIGHT_BROOM_ID:
      return t('seasonal.itemUse.broomSources', {
        count: formatNumber(GOURDLIGHT_BROOM_SHEAVES),
      });
    case GOURDLIGHT_SHEAF_ID:
      return t('seasonal.itemUse.sheaf', { count: formatNumber(GOURDLIGHT_BROOM_SHEAVES) });
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

/** Where a seasonal item comes from, for the items no shop sells (the Carved Pumpkin
 *  Head is Old Thatchgrin's first-kill drop only), or null for any other item. */
export function seasonalItemSourceText(item: Pick<ItemDef, 'id'>): string | null {
  return item.id === CARVED_PUMPKIN_HEAD_ID ? t('seasonal.itemSource.pumpkinHead') : null;
}

/** The lines as tooltip HTML (empty for any other item). */
export function seasonalItemTooltipLines(item: Pick<ItemDef, 'id'>): string {
  const text = seasonalItemTooltipText(item);
  const source = seasonalItemSourceText(item);
  return (
    (text ? createTooltipLine(text, 'tt-desc').outerHTML : '') +
    (source ? createTooltipLine(source, 'tt-desc').outerHTML : '')
  );
}
