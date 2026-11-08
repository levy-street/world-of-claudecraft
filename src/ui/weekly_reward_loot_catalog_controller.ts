import { ITEMS } from '../sim/data';
import type { PlayerClass } from '../sim/types';
import { WEEKLY_REWARD_MAX_LEVEL_OFFSET } from '../sim/weekly_reward_options';
import { itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import { FOCUS_KEY_ATTR } from './focus_restore';
import { formatNumber, t } from './i18n';
import type { PainterHostPresentation } from './painter_host';
import {
  WEEKLY_LOOT_CONTENT,
  WEEKLY_LOOT_DIFFICULTIES,
  type WeeklyLootContent,
  type WeeklyLootSelection,
  weeklyLootCatalogView,
  weeklyLootHasDifficulty,
} from './weekly_loot_catalog_view';
import { weeklyRewardTableName } from './weekly_reward_table_picker_controller';

export interface WeeklyLootCatalogDeps {
  readonly playerClass: PlayerClass;
  readonly lootSpec?: string;
  readonly presentation: PainterHostPresentation;
  /** Open table keys, kept by the Vault so a repaint keeps them open. */
  readonly expanded: Set<string>;
  readonly selection: () => WeeklyLootSelection;
  readonly select: (selection: WeeklyLootSelection) => void;
}

const RULE_KEY = {
  raid: 'hudChrome.weeklyRewards.catalogBossRule',
  dungeon: 'hudChrome.weeklyRewards.catalogBossRule',
  world: 'hudChrome.weeklyRewards.catalogWorldRule',
  pvp: 'hudChrome.weeklyRewards.catalogPvpRule',
} as const satisfies Record<WeeklyLootContent, string>;

function segmented(
  labelKey: 'hudChrome.weeklyRewards.catalogContent' | 'hudChrome.weeklyRewards.catalogDifficulty',
  className: string,
): HTMLDivElement {
  const group = document.createElement('div');
  group.className = `weekly-loot-picker ${className}`;
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', t(labelKey));
  return group;
}

function choiceButton(
  choices: Map<string, HTMLButtonElement>,
  label: string,
  focusKey: string,
  pressed: boolean,
  onPick: () => void,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'weekly-loot-choice ui-btn';
  button.textContent = label;
  button.setAttribute(FOCUS_KEY_ATTR, focusKey);
  button.setAttribute('aria-pressed', String(pressed));
  button.addEventListener('click', onPick);
  choices.set(focusKey, button);
  return button;
}

/** The possible-loot catalog: pick a content type, then (for raids and dungeons)
 *  a difficulty, and see every table that pool can roll, filtered by class and
 *  the loot focus. Picking repaints only this host. */
export function renderWeeklyLootCatalog(host: HTMLElement, deps: WeeklyLootCatalogDeps): void {
  const paint = (focusKey?: string) => {
    host.replaceChildren();
    // The picker buttons by focus key, so the pressed one regains focus after
    // this repaint without splicing a key into a selector.
    const choices = new Map<string, HTMLButtonElement>();
    const selection = deps.selection();
    const pick = (next: WeeklyLootSelection, key: string) => {
      deps.select(next);
      paint(key);
    };
    const content = segmented('hudChrome.weeklyRewards.catalogContent', 'weekly-loot-content');
    for (const id of WEEKLY_LOOT_CONTENT) {
      const key = `weekly-loot-content:${id}`;
      content.append(
        choiceButton(
          choices,
          t(`hudChrome.weeklyRewards.category.${id}`),
          key,
          id === selection.content,
          () => pick({ ...selection, content: id }, key),
        ),
      );
    }
    const bar = document.createElement('div');
    bar.className = 'weekly-loot-pickers';
    bar.append(content);
    if (weeklyLootHasDifficulty(selection.content)) {
      const difficulty = segmented(
        'hudChrome.weeklyRewards.catalogDifficulty',
        'weekly-loot-difficulty',
      );
      for (const id of WEEKLY_LOOT_DIFFICULTIES) {
        const key = `weekly-loot-difficulty:${id}`;
        difficulty.append(
          choiceButton(
            choices,
            t(`hudChrome.weeklyRewards.${id}`),
            key,
            id === selection.difficulty,
            () => pick({ ...selection, difficulty: id }, key),
          ),
        );
      }
      bar.append(difficulty);
    }
    const view = weeklyLootCatalogView(selection, deps.playerClass, deps.lootSpec);
    const group = document.createElement('section');
    group.className = 'weekly-pool';
    group.id = `weekly-pool-${view.pool}`;
    const title = document.createElement('h4');
    title.textContent = t(`hudChrome.weeklyRewards.pool.${view.pool}`);
    const rule = document.createElement('p');
    rule.className = 'weekly-pool-rule';
    rule.textContent = t(RULE_KEY[selection.content], {
      maxLevelOffset: formatNumber(WEEKLY_REWARD_MAX_LEVEL_OFFSET),
    });
    group.append(title, rule);
    // Defensive: no class or focus empties a pool with today's content
    // (pinned in tests/weekly_loot_catalog_view.test.ts), but new content could.
    if (view.empty) {
      const empty = document.createElement('p');
      empty.className = 'weekly-pool-empty';
      empty.textContent = t(
        view.empty === 'focus'
          ? 'hudChrome.weeklyRewards.noFocusedLoot'
          : 'hudChrome.weeklyRewards.catalogEmpty',
      );
      group.append(empty);
    }
    const tables = document.createElement('div');
    tables.className = 'weekly-loot-tables';
    for (const table of view.tables) {
      const key = `weekly-catalog:${view.pool}:${table.id}`;
      const details = document.createElement('details');
      details.className = 'weekly-loot-table ui-card';
      details.open = deps.expanded.has(key);
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
        { count: formatNumber(table.items.length) },
      );
      summary.append(name, count);
      details.addEventListener('toggle', () => {
        if (details.open) deps.expanded.add(key);
        else deps.expanded.delete(key);
      });
      const list = document.createElement('div');
      list.className = 'weekly-loot-list';
      for (const id of table.items) {
        const item = ITEMS[id];
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = `weekly-loot ui-btn quality-${item.quality}`;
        cell.setAttribute(FOCUS_KEY_ATTR, `weekly-item:${view.pool}:${table.id}:${id}`);
        cell.innerHTML = `${deps.presentation.itemIcon(item)}<span>${esc(itemDisplayName(item))}</span>`;
        deps.presentation.attachTooltip(cell, () => deps.presentation.itemTooltip(item));
        list.append(cell);
      }
      details.append(summary, list);
      tables.append(details);
    }
    group.append(tables);
    host.append(bar, group);
    if (focusKey) choices.get(focusKey)?.focus();
  };
  paint();
}
