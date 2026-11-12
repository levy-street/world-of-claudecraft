// Quality modifies the original item line. Enchants and gems retain attribution.
import { lootQualityBonuses, lootQualityWeapon } from '../sim/loot_quality';
import type { ItemDef, ItemInstancePayload } from '../sim/types';
import { esc } from './esc';
import { t } from './i18n';
import { itemAffixTooltipLines, itemRatingTooltipLines } from './item_affix_tooltip';
import type { CompareStat } from './item_compare';
import { compareStatLineHtml, type ItemCompareMarks } from './item_compare_view';
import { instanceBonusStatLines, itemNumber, itemStatName } from './item_instance_tooltip';
import { riftBandTooltipLines, riftGemTooltipLines } from './rift_band_tooltip';

/** `marks` is the comparison against the worn piece (item_compare_view.ts):
 *  with it, each stat line carries its change cell and the unclaimed changes
 *  close the block. */
export function itemCombatTooltipLines(
  item: ItemDef,
  instance?: ItemInstancePayload,
  marks?: ItemCompareMarks,
): string {
  const bonuses = instance?.rift ? {} : lootQualityBonuses(item, instance);
  const stats = { ...item.stats };
  for (const key of ['armor', 'str', 'agi', 'sta', 'int', 'spi'] as const) {
    if (bonuses[key]) stats[key] = (stats[key] ?? 0) + bonuses[key];
  }
  const resolved = { ...item, stats };
  // Every lane qualityBonusesAtLevel emits, so the Warfare line (the lower of
  // the two PvP ratings) resolves like combat does in recalcPlayerStats.
  for (const key of [
    'spellPower',
    'healPower',
    'hitRating',
    'critRating',
    'hasteRating',
    'pvpOffenseRating',
    'pvpDefenseRating',
  ] as const) {
    const bonus = bonuses[key === 'healPower' ? 'healingPower' : key];
    if (bonus) resolved[key] = (item[key] ?? 0) + bonus;
  }
  let html = marks?.headHtml() ?? '';
  const weapon = lootQualityWeapon(item, instance);
  if (weapon) {
    html += `<div class="tt-stat">${esc(
      t('itemUi.tooltip.damageSpeed', {
        min: itemNumber(weapon.min),
        max: itemNumber(weapon.max),
        speed: itemNumber(weapon.speed, 1),
      }),
    )}</div>`;
    const dps = itemNumber((weapon.min + weapon.max) / 2 / weapon.speed, 1);
    html += compareStatLineHtml('tt-stat', esc(t('itemUi.tooltip.dps', { dps })), marks, 'dps');
  }
  for (const [key, value] of Object.entries(stats)) {
    if (value === undefined) continue;
    const text =
      key === 'armor'
        ? t('itemUi.tooltip.armorStat', { value: itemNumber(value) })
        : t('itemUi.tooltip.stat', { value: itemNumber(value), stat: itemStatName(key) });
    const cls = key === 'armor' ? 'tt-stat' : 'tt-green';
    html += compareStatLineHtml(cls, esc(text), marks, key as CompareStat);
  }
  return (
    html +
    instanceBonusStatLines(instance, instance?.rift ? item : undefined) +
    riftBandTooltipLines(instance) +
    itemAffixTooltipLines(resolved, marks) +
    riftGemTooltipLines(item) +
    itemRatingTooltipLines(resolved, marks) +
    (marks?.restHtml() ?? '')
  );
}
