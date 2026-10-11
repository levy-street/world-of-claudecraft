import { ITEMS } from '../sim/data';
import { WEEKLY_REWARD_MAX_LEVEL_OFFSET } from '../sim/weekly_reward_options';
import { itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import { FOCUS_KEY_ATTR } from './focus_restore';
import { formatNumber, t } from './i18n';
import type { PainterHostPresentation } from './painter_host';
import { weeklyRewardTableName } from './weekly_reward_table_picker_controller';
import type { buildWeeklyRewardsView } from './weekly_rewards_view';

/** Content categories contain difficulty sections and collapsible loot tables. */
export function appendWeeklyLootCategory(
  host: HTMLElement,
  row: ReturnType<typeof buildWeeklyRewardsView>[number],
  presentation: PainterHostPresentation,
  expanded: Set<string>,
): void {
  const category = document.createElement('section');
  category.className = 'weekly-loot-category ui-well';
  const heading = document.createElement('h3');
  heading.textContent = t(`hudChrome.weeklyRewards.category.${row.category}`);
  category.append(heading);
  for (const pool of row.pools) {
    const group = document.createElement('section');
    group.className = 'weekly-pool';
    group.id = `weekly-pool-${pool.pool}`;
    const title = document.createElement('h4');
    title.textContent = t(`hudChrome.weeklyRewards.pool.${pool.pool}`);
    const rule = document.createElement('p');
    rule.textContent = t(
      pool.pool === 'world'
        ? 'hudChrome.weeklyRewards.worldPoolRule'
        : 'hudChrome.weeklyRewards.selectionPoolRule',
      { maxLevelOffset: formatNumber(WEEKLY_REWARD_MAX_LEVEL_OFFSET) },
    );
    group.append(title, rule);
    if (!pool.tables.length) {
      const empty = document.createElement('p');
      empty.textContent = t('hudChrome.weeklyRewards.noLevelLoot');
      group.append(empty);
    }
    for (const table of pool.tables) {
      const key = `weekly-catalog:${pool.pool}:${table.id}`;
      const details = document.createElement('details');
      details.className = 'weekly-loot-table ui-card';
      details.open = expanded.has(key);
      const summary = document.createElement('summary');
      summary.tabIndex = 0;
      summary.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
      });
      summary.className = 'ui-btn';
      summary.setAttribute(FOCUS_KEY_ATTR, key);
      const name = document.createElement('span');
      name.textContent = weeklyRewardTableName(table);
      const count = document.createElement('span');
      count.className = 'ui-num';
      count.textContent = t(
        table.items.length === 1
          ? 'hudChrome.weeklyRewards.tableItem'
          : 'hudChrome.weeklyRewards.tableItemCount',
        {
          count: formatNumber(table.items.length),
        },
      );
      summary.append(name, count);
      details.addEventListener('toggle', () => {
        if (details.open) expanded.add(key);
        else expanded.delete(key);
      });
      const list = document.createElement('div');
      list.className = 'weekly-loot-list';
      for (const id of table.items) {
        const item = ITEMS[id];
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = `weekly-loot ui-btn quality-${item.quality}`;
        cell.setAttribute(FOCUS_KEY_ATTR, `weekly-item:${pool.pool}:${table.id}:${id}`);
        cell.innerHTML = `${presentation.itemIcon(item)}<span>${esc(itemDisplayName(item))}</span>`;
        presentation.attachTooltip(cell, () => presentation.itemTooltip(item));
        list.append(cell);
      }
      details.append(summary, list);
      group.append(details);
    }
    category.append(group);
  }
  host.append(category);
}
