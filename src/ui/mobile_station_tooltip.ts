// Mobile-station tool tooltip lines: what placing the Master's Field Forge
// does, the party-share radius, the duration, that the tool is never
// consumed, and the replace rule. Pure string-builder composed inside
// Hud.itemTooltip (the tool_effect_tooltip.ts pattern): t() + esc here, no
// DOM, no Hud state, so tests/mobile_station_tooltip.test.ts drives it
// directly.
//
// Numbers come from the sim constants, never re-invented copy:
// STATION_RADIUS and MOBILE_CRAFTING_STATION_DURATION_TICKS
// (content/professions.ts), with TICK_RATE (types.ts) turning ticks into
// the minutes the English speaks.

import { MOBILE_CRAFTING_STATION_DURATION_TICKS, STATION_RADIUS } from '../sim/content/professions';
import { type ItemDef, type ItemUse, TICK_RATE } from '../sim/types';
import { esc } from './esc';
import { formatNumber, t } from './i18n';

function line(cls: 'tt-sub' | 'tt-desc' | 'tt-green', text: string): string {
  return `<div class="${cls}">${esc(text)}</div>`;
}

type PlaceMobileStationUse = Extract<ItemUse, { type: 'placeMobileStation' }>;

/** True when the def places a mobile crafting station (use.type
 *  'placeMobileStation'). Generic so the guarded branch keeps the caller's
 *  full item type, not just the pick. */
export function isPlaceMobileStationItem<T extends Pick<ItemDef, 'use'>>(
  item: T,
): item is T & { use: PlaceMobileStationUse } {
  return item.use?.type === 'placeMobileStation';
}

/** The tooltip lines for one mobile-station tool item, or '' for any other
 *  item. Composed into Hud.itemTooltip so bags, bank, crafting, market, and
 *  every other surface that reuses itemTooltip show the same card. No title:
 *  the item tooltip already prints the name. */
export function mobileStationTooltipLines(item: ItemDef): string {
  if (!isPlaceMobileStationItem(item)) return '';
  const radius = formatNumber(STATION_RADIUS, { maximumFractionDigits: 0 });
  const minutes = formatNumber(MOBILE_CRAFTING_STATION_DURATION_TICKS / TICK_RATE / 60, {
    maximumFractionDigits: 0,
  });
  return (
    line('tt-sub', t('hudChrome.professions.mobileStationTooltip.kind')) +
    line('tt-green', t('hudChrome.professions.mobileStationTooltip.use')) +
    line('tt-desc', t('hudChrome.professions.mobileStationTooltip.radius', { radius })) +
    line('tt-desc', t('hudChrome.professions.mobileStationTooltip.duration', { minutes })) +
    line('tt-desc', t('hudChrome.professions.mobileStationTooltip.notConsumed')) +
    line('tt-sub', t('hudChrome.professions.mobileStationTooltip.replace'))
  );
}
