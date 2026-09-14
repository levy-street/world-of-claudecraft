// Quality modifies the original item line. Enchants and gems retain attribution.
import { lootQualityBonuses, lootQualityWeapon } from '../sim/loot_quality';
import type { ItemDef, ItemInstancePayload } from '../sim/types';
import { esc } from './esc';
import { t } from './i18n';
import { itemAffixTooltipLines, itemRatingTooltipLines } from './item_affix_tooltip';
import { instanceBonusStatLines, itemNumber, itemStatName } from './item_instance_tooltip';
import { riftBandTooltipLines, riftGemTooltipLines } from './rift_band_tooltip';

export function itemCombatTooltipLines(item: ItemDef, instance?: ItemInstancePayload): string {
  const bonuses = instance?.rift ? {} : lootQualityBonuses(item, instance);
  const stats = { ...item.stats };
  for (const key of ['armor', 'str', 'agi', 'sta', 'int', 'spi'] as const) {
    if (bonuses[key]) stats[key] = (stats[key] ?? 0) + bonuses[key];
  }
  const resolved = { ...item, stats };
  for (const key of [
    'spellPower',
    'healPower',
    'hitRating',
    'critRating',
    'hasteRating',
  ] as const) {
    const bonus = bonuses[key === 'healPower' ? 'healingPower' : key];
    if (bonus) resolved[key] = (item[key] ?? 0) + bonus;
  }
  let html = '';
  const weapon = lootQualityWeapon(item, instance);
  if (weapon) {
    html += `<div class="tt-stat">${esc(
      t('itemUi.tooltip.damageSpeed', {
        min: itemNumber(weapon.min),
        max: itemNumber(weapon.max),
        speed: itemNumber(weapon.speed, 1),
      }),
    )}</div>`;
    html += `<div class="tt-stat">${esc(
      t('itemUi.tooltip.dps', {
        dps: itemNumber((weapon.min + weapon.max) / 2 / weapon.speed, 1),
      }),
    )}</div>`;
  }
  for (const [key, value] of Object.entries(stats)) {
    if (value === undefined) continue;
    html +=
      key === 'armor'
        ? `<div class="tt-stat">${esc(t('itemUi.tooltip.armorStat', { value: itemNumber(value) }))}</div>`
        : `<div class="tt-green">${esc(t('itemUi.tooltip.stat', { value: itemNumber(value), stat: itemStatName(key) }))}</div>`;
  }
  return (
    html +
    instanceBonusStatLines(instance, instance?.rift ? item : undefined) +
    riftBandTooltipLines(instance) +
    itemAffixTooltipLines(resolved) +
    riftGemTooltipLines(item) +
    itemRatingTooltipLines(resolved)
  );
}
