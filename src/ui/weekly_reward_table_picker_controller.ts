import {
  isWeeklyNormalTableId,
  type WeeklyRewardTableOption,
  weeklyNormalPool,
  weeklyTableSource,
  weeklyTableSourceId,
} from '../sim/weekly_reward_options';
import type { WeeklyChoice } from '../sim/weekly_rewards';
import { tEntity } from './entity_i18n';
import { FOCUS_KEY_ATTR } from './focus_restore';
import { formatNumber, t } from './i18n';

export function weeklyRewardTableName(source: {
  id: string;
  kind: 'mob' | 'dungeon' | 'pool';
}): string {
  return source.kind === 'pool'
    ? t(
        source.id === 'world'
          ? 'hudChrome.weeklyRewards.pool.world'
          : 'hudChrome.weeklyRewards.pool.pvp',
      )
    : tEntity({ kind: source.kind, id: weeklyTableSourceId(source.id), field: 'name' });
}

export type WeeklyTableDifficulty = 'normal' | 'heroic';
const TABLE_DIFFICULTIES: readonly WeeklyTableDifficulty[] = ['heroic', 'normal'];

const normalBadge = (): HTMLSpanElement => {
  const badge = document.createElement('span');
  badge.className = 'weekly-difficulty weekly-difficulty-normal';
  badge.textContent = t('hudChrome.weeklyRewards.normal');
  return badge;
};

const tableDifficulty = (table: WeeklyRewardTableOption): WeeklyTableDifficulty =>
  table.difficulty ?? 'heroic';

/** The difficulty a Heroic vault's picker shows: the remembered pick while it
 *  still has tables, else Heroic, else Normal once the Heroic tables run out. */
export function weeklyPickerDifficulty(
  tables: readonly WeeklyRewardTableOption[],
  remembered?: WeeklyTableDifficulty,
): WeeklyTableDifficulty {
  const has = (difficulty: WeeklyTableDifficulty) =>
    tables.some((table) => tableDifficulty(table) === difficulty);
  if (remembered && has(remembered)) return remembered;
  return has('heroic') || !has('normal') ? 'heroic' : 'normal';
}

const MENU_MAX_HEIGHT = 220;
const MENU_MARGIN = 8;
const MENU_TOUCH_HEIGHT = 44;

interface WeeklyRewardTablePickerOptions {
  footer: HTMLElement;
  choice: WeeklyChoice;
  tables: WeeklyRewardTableOption[];
  index: number;
  selections: Map<number, string[]>;
  saving: boolean;
  onChange(): void;
  expanded: Set<number>;
  /** The Normal or Heroic pick of each Heroic vault, kept across repaints. */
  difficulties?: Map<number, WeeklyTableDifficulty>;
}

/** Selection is presentation state only; every submitted table is revalidated. */
export function appendWeeklyRewardTablePicker({
  footer,
  choice,
  tables,
  index,
  selections,
  saving,
  onChange,
  expanded,
  difficulties = new Map(),
}: WeeklyRewardTablePickerOptions): {
  canOpen(): boolean;
  selected(): string[] | undefined;
  dispose(): void;
} {
  if (choice.fixed || choice.tableId || (choice.opened && choice.itemId)) {
    const source = weeklyTableSource(choice.tableId);
    const name = source
      ? weeklyRewardTableName(source)
      : t('hudChrome.weeklyRewards.previouslyRolled');
    if (source && isWeeklyNormalTableId(source.id)) {
      // A Heroic vault rolled on a Normal table: say so beside the source, as
      // one footer item so the badge stays with the name when the row wraps.
      const rolled = document.createElement('span');
      rolled.className = 'weekly-rolled-source';
      const label = document.createElement('span');
      label.textContent = name;
      rolled.append(label, normalBadge());
      footer.replaceChildren(rolled);
    } else footer.textContent = name;
    return { canOpen: () => true, selected: () => undefined, dispose: () => {} };
  }
  if (choice.pool === 'world' || choice.pool === 'pvp') {
    selections.delete(index);
    expanded.delete(index);
    footer.textContent = weeklyRewardTableName({ id: choice.pool, kind: 'pool' });
    return {
      canOpen: () => tables.length > 0,
      selected: () => (tables.length ? [choice.pool] : undefined),
      dispose: () => {},
    };
  }

  // Only a Heroic vault chooses a difficulty; one roll stays on one difficulty.
  const choosesDifficulty = weeklyNormalPool(choice.pool) !== undefined;
  let difficulty = weeklyPickerDifficulty(tables, difficulties.get(index));
  const shown = () =>
    choosesDifficulty ? tables.filter((table) => tableDifficulty(table) === difficulty) : tables;
  const previous = new Set(selections.get(index) ?? []);
  selections.set(
    index,
    shown()
      .filter((table) => previous.has(table.id))
      .map((table) => table.id),
  );
  const details = document.createElement('details');
  details.className = 'weekly-table-picker';
  details.open = expanded.has(index);
  const summary = document.createElement('summary');
  summary.className = 'ui-btn weekly-table-summary';
  summary.tabIndex = 0;
  summary.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
  });
  summary.setAttribute(FOCUS_KEY_ATTR, `weekly-table:${index}`);
  const list = document.createElement('div');
  list.id = `weekly-table-options-${index}`;
  list.className = 'weekly-table-options ui-well';
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', t('hudChrome.weeklyRewards.chooseTable'));
  summary.setAttribute('aria-controls', list.id);
  const tile = footer.closest('.weekly-milestone');
  let listeners: AbortController | undefined;
  let disposed = false;
  let clipAncestors: HTMLElement[] = [];
  const findClipAncestors = () => {
    clipAncestors = [];
    for (let parent = details.parentElement; parent; parent = parent.parentElement) {
      if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY))
        clipAncestors.push(parent);
    }
  };
  const position = () => {
    if (disposed || !details.open || !details.isConnected) return;
    const rect = summary.getBoundingClientRect();
    let top = 0;
    let bottom = window.innerHeight;
    // Ancestors may themselves move inside outer scrollers, so refresh their
    // rectangles while reusing the style-based clipping classification.
    for (const parent of clipAncestors) {
      const bounds = parent.getBoundingClientRect();
      top = Math.max(top, bounds.top);
      bottom = Math.min(bottom, bounds.bottom);
    }
    const below = bottom - rect.bottom - MENU_MARGIN;
    const above = rect.top - top - MENU_MARGIN;
    const up = below < MENU_MAX_HEIGHT && above > below;
    details.classList.toggle('weekly-table-opens-up', up);
    const maxHeight = `${Math.max(MENU_TOUCH_HEIGHT, Math.min(MENU_MAX_HEIGHT, up ? above : below))}px`;
    if (list.style.maxHeight !== maxHeight) list.style.maxHeight = maxHeight;
  };
  const close = () => {
    details.open = false;
    expanded.delete(index);
    tile?.classList.remove('weekly-table-expanded');
    listeners?.abort();
  };
  const syncOpen = () => {
    if (disposed || !details.isConnected) return;
    listeners?.abort();
    tile?.classList.toggle('weekly-table-expanded', details.open);
    if (!details.open) {
      expanded.delete(index);
      return;
    }
    expanded.add(index);
    findClipAncestors();
    position();
    listeners = new AbortController();
    const options = { signal: listeners.signal };
    document.addEventListener(
      'pointerdown',
      (event) => {
        if (event.target instanceof Node && !details.contains(event.target)) close();
      },
      options,
    );
    document.addEventListener(
      'focusin',
      (event) => {
        if (event.target instanceof Node && !details.contains(event.target)) close();
      },
      options,
    );
    window.addEventListener(
      'resize',
      () => {
        if (disposed || !details.open) return;
        findClipAncestors();
        position();
      },
      options,
    );
    document.addEventListener(
      'scroll',
      (event) => {
        if (event.target instanceof Node && !list.contains(event.target)) position();
      },
      { ...options, capture: true },
    );
  };
  details.addEventListener('toggle', syncOpen);
  details.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !details.open) return;
    event.preventDefault();
    event.stopPropagation();
    close();
    summary.focus();
  });
  const disabled = saving || choice.opening === true;
  const checkbox = (text: string, key: string) => {
    const label = document.createElement('label');
    label.className = 'weekly-table-option';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.disabled = disabled;
    input.setAttribute(FOCUS_KEY_ATTR, key);
    const name = document.createElement('span');
    name.textContent = text;
    // A label's text is not focusable. Keep its press inside the menu so
    // outside-focus dismissal cannot hide it before native checkbox activation.
    label.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || input.disabled || event.target === input) return;
      event.preventDefault();
      input.focus({ preventScroll: true });
    });
    label.append(input, name);
    list.append(label);
    return input;
  };
  let inputs: Array<{ table: WeeklyRewardTableOption; input: HTMLInputElement }> = [];
  let all: HTMLInputElement | undefined;
  const update = () => {
    const ids = inputs.filter(({ input }) => input.checked).map(({ table }) => table.id);
    selections.set(index, ids);
    if (all) {
      all.checked = !!inputs.length && ids.length === inputs.length;
      all.indeterminate = ids.length > 0 && ids.length < inputs.length;
    }
    summary.textContent = ids.length
      ? t(
          ids.length === 1
            ? 'hudChrome.weeklyRewards.selectedTable'
            : 'hudChrome.weeklyRewards.selectedTables',
          { count: formatNumber(ids.length) },
        )
      : t('hudChrome.weeklyRewards.chooseTable');
    // The closed menu must still say when a Heroic vault is set to roll Normal.
    if (choosesDifficulty && difficulty === 'normal') {
      const armed = document.createElement('span');
      armed.className = 'weekly-rolled-source';
      const label = document.createElement('span');
      label.textContent = summary.textContent;
      armed.append(label, normalBadge());
      summary.replaceChildren(armed);
    }
    onChange();
  };
  const paintRows = (focusDifficulty = false) => {
    list.replaceChildren();
    if (choosesDifficulty) {
      const group = document.createElement('div');
      group.className = 'weekly-loot-picker weekly-table-difficulty';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', t('hudChrome.weeklyRewards.catalogDifficulty'));
      for (const id of TABLE_DIFFICULTIES) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'weekly-loot-choice ui-btn';
        button.textContent = t(`hudChrome.weeklyRewards.${id}`);
        button.disabled = disabled || !tables.some((table) => tableDifficulty(table) === id);
        button.setAttribute(FOCUS_KEY_ATTR, `weekly-table-difficulty:${index}:${id}`);
        button.setAttribute('aria-pressed', String(id === difficulty));
        button.addEventListener('click', () => {
          if (id === difficulty) return;
          difficulty = id;
          difficulties.set(index, id);
          // Tables of the other difficulty leave the selection with the switch.
          selections.set(index, []);
          paintRows(true);
          update();
        });
        // Keep activation keys out of the game hotkeys, as the summary does.
        button.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
        });
        group.append(button);
        // The pressed button was replaced by this repaint: hand focus to its
        // successor so the menu keeps keyboard focus inside itself.
        if (focusDifficulty && id === difficulty)
          queueMicrotask(() => {
            if (!disposed && button.isConnected) button.focus({ preventScroll: true });
          });
      }
      list.append(group);
    }
    const rows = shown();
    all = checkbox(t('hudChrome.weeklyRewards.selectAllTables'), `weekly-table-all:${index}`);
    all.disabled ||= !rows.length;
    const selectAll = all;
    inputs = rows.map((table) => {
      const input = checkbox(
        weeklyRewardTableName(table),
        `weekly-table-option:${index}:${table.id}`,
      );
      input.checked = (selections.get(index) ?? []).includes(table.id);
      input.addEventListener('change', update);
      return { table, input };
    });
    selectAll.addEventListener('change', () => {
      for (const { input } of inputs) input.checked = selectAll.checked;
      update();
    });
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.textContent = t('hudChrome.weeklyRewards.noLevelLoot');
      list.append(empty);
    }
  };
  paintRows();
  details.append(summary, list);
  footer.replaceChildren(details);
  update();
  syncOpen();
  return {
    canOpen: () => !!selections.get(index)?.length,
    selected: () => [...(selections.get(index) ?? [])],
    dispose: () => {
      disposed = true;
      listeners?.abort();
      tile?.classList.remove('weekly-table-expanded');
    },
  };
}
