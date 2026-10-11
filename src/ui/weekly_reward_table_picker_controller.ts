import { type WeeklyRewardTableOption, weeklyTableSource } from '../sim/weekly_reward_options';
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
    : tEntity({ kind: source.kind, id: source.id, field: 'name' });
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
}: WeeklyRewardTablePickerOptions): {
  canOpen(): boolean;
  selected(): string[] | undefined;
  dispose(): void;
} {
  if (choice.fixed || choice.tableId || (choice.opened && choice.itemId)) {
    const source = weeklyTableSource(choice.tableId);
    footer.textContent = source
      ? weeklyRewardTableName(source)
      : t('hudChrome.weeklyRewards.previouslyRolled');
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

  const previous = new Set(selections.get(index) ?? []);
  selections.set(
    index,
    tables.filter((table) => previous.has(table.id)).map((table) => table.id),
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
  const all = checkbox(t('hudChrome.weeklyRewards.selectAllTables'), `weekly-table-all:${index}`);
  all.disabled ||= !tables.length;
  const inputs = tables.map((table) => {
    const input = checkbox(
      weeklyRewardTableName(table),
      `weekly-table-option:${index}:${table.id}`,
    );
    input.checked = (selections.get(index) ?? []).includes(table.id);
    return { table, input };
  });
  const update = () => {
    const ids = inputs.filter(({ input }) => input.checked).map(({ table }) => table.id);
    selections.set(index, ids);
    all.checked = !!inputs.length && ids.length === inputs.length;
    all.indeterminate = ids.length > 0 && ids.length < inputs.length;
    summary.textContent = ids.length
      ? t(
          ids.length === 1
            ? 'hudChrome.weeklyRewards.selectedTable'
            : 'hudChrome.weeklyRewards.selectedTables',
          { count: formatNumber(ids.length) },
        )
      : t('hudChrome.weeklyRewards.chooseTable');
    onChange();
  };
  all.addEventListener('change', () => {
    for (const { input } of inputs) input.checked = all.checked;
    update();
  });
  for (const { input } of inputs) input.addEventListener('change', update);
  if (!tables.length) {
    const empty = document.createElement('p');
    empty.textContent = t('hudChrome.weeklyRewards.noLevelLoot');
    list.append(empty);
  }
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
