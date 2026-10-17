// The painter-side half of the enemy cooldown row: selects which plates carry it
// (living hostile players only), fills the plan through the pure core, then
// resolves each slot's artwork and localized countdown. Lifted beside the
// painter (the dot row's resolve lives in nameplate_painter.ts itself) so the
// coordinator gains one call, not another method bank.
//
// Runs for every plate on screen EVERY frame: the countdown and the swipe are the
// point, so it cannot ride the throttled content pass. The artwork is a Map hit
// after the first resolve per key, and the countdown is re-formatted only when
// the number moves at the precision it is drawn.

import { isTrinketCooldownKey } from '../sim/content/trinkets';
import type { Entity } from '../sim/types';
import { formatNumber } from '../ui/i18n';
import {
  abilityImageUrl,
  cachedProceduralIconDataUrl,
  itemImageUrl,
  proceduralIconDataUrl,
} from '../ui/icons';
import {
  clampNameplateCooldownScale,
  type NameplateCooldownsPlan,
  type NameplateCooldownTimeUnit,
  nameplateCooldownQuantized,
  nameplateCooldownsInto,
} from './nameplate_cooldowns_core';

const ICON_PX = 32;
const NO_COOLDOWNS: ReadonlyMap<string, number> = new Map();
const ICON_URLS = new Map<string, string>();

/** Artwork for a cooldown key: the ability's static art, or the medallion's item
 *  art, falling back to the procedural icon (warm cache first, minted on demand). */
export function nameplateCooldownIconUrl(key: string): string {
  const cached = ICON_URLS.get(key);
  if (cached !== undefined) return cached;
  const isItem = isTrinketCooldownKey(key);
  const id = isItem ? key.slice(key.indexOf(':') + 1) : key;
  const kind = isItem ? 'item' : 'ability';
  const url =
    (isItem ? itemImageUrl(id) : abilityImageUrl(id)) ??
    cachedProceduralIconDataUrl(kind, id, ICON_PX) ??
    proceduralIconDataUrl(kind, id, ICON_PX);
  ICON_URLS.set(key, url);
  return url;
}

// Hoisted: formatNumber keys its formatter cache on the options object, so a
// fresh literal per frame would be an allocation plus a stringify on the hot
// path. Minutes use Intl's narrow unit ("3m" in English), localized per locale.
const NUMBER_OPTIONS: Readonly<Record<NameplateCooldownTimeUnit, Intl.NumberFormatOptions>> = {
  minutes: { style: 'unit', unit: 'minute', unitDisplay: 'narrow', maximumFractionDigits: 0 },
  seconds: { minimumFractionDigits: 0, maximumFractionDigits: 0 },
  tenths: { minimumFractionDigits: 1, maximumFractionDigits: 1 },
};
// Folds the unit into the cached value, so 3 minutes and 3 seconds never share
// a formatted text when a slot crosses the minute boundary.
const UNIT_TAG: Readonly<Record<NameplateCooldownTimeUnit, number>> = {
  minutes: 1e6,
  seconds: 0,
  tenths: 2e6,
};

/**
 * Fill `plan` for `entity`. `scale` is the folded setting (0 means the row is
 * off); `hostile` is the plate's own hostility verdict, so the row follows the
 * exact predicate that turns the name red.
 */
export function resolveNameplateCooldowns(
  plan: NameplateCooldownsPlan,
  entity: Entity,
  hostile: boolean,
  scale: number,
): void {
  if (scale <= 0 || !hostile || entity.kind !== 'player' || entity.dead) {
    plan.count = 0;
    return;
  }
  plan.scale = clampNameplateCooldownScale(scale);
  // `??` arms: a partial mirror (a test fixture, an older shape) must not throw.
  nameplateCooldownsInto(plan, entity.cooldowns ?? NO_COOLDOWNS, entity.auras ?? []);
  for (let i = 0; i < plan.count; i++) {
    const slot = plan.slots[i];
    if (!slot.iconUrl) slot.iconUrl = nameplateCooldownIconUrl(slot.key);
    const quantized = nameplateCooldownQuantized(slot.remaining, slot.unit);
    const tagged = quantized + UNIT_TAG[slot.unit];
    if (slot.timeText === '' || tagged !== slot.timeValue) {
      slot.timeValue = tagged;
      slot.timeText = formatNumber(quantized, NUMBER_OPTIONS[slot.unit]);
    }
  }
}
