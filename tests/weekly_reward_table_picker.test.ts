// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type WeeklyRewardTableOption,
  weeklyRewardTableOptions,
} from '../src/sim/weekly_reward_options';
import type { WeeklyVaultBatch } from '../src/sim/weekly_rewards';
import {
  appendWeeklyRewardTablePicker,
  weeklyPickerDifficulty,
} from '../src/ui/weekly_reward_table_picker_controller';

const disposers: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('weekly table picker', () => {
  const make = () => {
    const batch: WeeklyVaultBatch = {
      resetAtMs: 1000,
      bossUnlocks: { vael_the_mistcaller: 1, ysolei: 2 },
      choices: [{ pool: 'dungeon' }],
    };
    const footer = document.createElement('div');
    document.body.append(footer);
    const selections = new Map<number, string[]>();
    const expanded = new Set<number>();
    const changed = vi.fn();
    let previous: ReturnType<typeof appendWeeklyRewardTablePicker> | undefined;
    const render = (saving = false, level = 20) => {
      previous?.dispose();
      const picker = appendWeeklyRewardTablePicker({
        footer,
        choice: batch.choices[0],
        tables: weeklyRewardTableOptions(batch, batch.choices[0], 'mage', level),
        index: 0,
        selections,
        saving,
        onChange: changed,
        expanded,
      });
      previous = picker;
      disposers.push(picker.dispose);
      return picker;
    };
    const inputs = () => [...footer.querySelectorAll<HTMLInputElement>('input')];
    return { batch, footer, selections, expanded, changed, render, inputs };
  };
  it('starts empty, supports mixed selection, select all and deselecting the final option', () => {
    const s = make();
    const picker = s.render();
    expect(s.footer.querySelector('summary')!.textContent).toBe('Select which table to roll off');
    expect(picker.canOpen()).toBe(false);
    expect(s.inputs()).toHaveLength(3);
    s.inputs()[1].click();
    expect(s.footer.querySelector('summary')!.textContent).toBe('1 table selected');
    expect(s.footer.querySelector('[role="group"]')!.getAttribute('aria-label')).toBe(
      'Select which table to roll off',
    );
    expect(picker.selected()).toEqual(['sunken_bastion']);
    expect(picker.canOpen()).toBe(true);
    expect(s.inputs()[0].indeterminate).toBe(true);
    s.inputs()[0].click();
    expect(picker.selected()).toEqual(['sunken_bastion', 'drowned_temple']);
    expect(s.inputs()[0].checked).toBe(true);
    s.inputs()[0].click();
    expect(picker.canOpen()).toBe(false);
    expect(s.changed).toHaveBeenCalledTimes(4);
  });
  it('reuses clipping styles on scroll but follows a moving clip rectangle and stops when disposed', () => {
    const s = make();
    s.footer.style.overflowY = 'hidden';
    const picker = s.render();
    const details = s.footer.querySelector('details')!;
    const summary = s.footer.querySelector('summary')!;
    const list = s.footer.querySelector<HTMLElement>('.weekly-table-options')!;
    const styles = vi.spyOn(globalThis, 'getComputedStyle');
    const rect = (top: number, bottom: number) => ({
      top,
      bottom,
      left: 0,
      right: 100,
      width: 100,
      height: bottom - top,
      x: 0,
      y: top,
      toJSON: () => ({}),
    });
    const anchor = vi.spyOn(summary, 'getBoundingClientRect').mockReturnValue(rect(300, 340));
    const clip = vi.spyOn(s.footer, 'getBoundingClientRect').mockReturnValue(rect(0, 500));
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    expect(details.classList.contains('weekly-table-opens-up')).toBe(true);
    const styleCount = styles.mock.calls.length;
    expect(styleCount).toBeGreaterThan(0);
    clip.mockReturnValue(rect(280, 720));
    s.footer.dispatchEvent(new Event('scroll'));
    expect(details.classList.contains('weekly-table-opens-up')).toBe(false);
    expect(styles).toHaveBeenCalledTimes(styleCount);
    expect(list.style.maxHeight).toBe('220px');
    window.dispatchEvent(new Event('resize'));
    expect(styles.mock.calls.length).toBeGreaterThan(styleCount);
    picker.dispose();
    const reads = anchor.mock.calls.length;
    s.footer.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
    expect(anchor).toHaveBeenCalledTimes(reads);
  });
  it('retains selections and expanded state across repaint and prunes ineligible choices', () => {
    const s = make();
    s.render();
    s.inputs()[0].click();
    const details = s.footer.querySelector('details')!;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    expect(s.render().selected()).toEqual(['sunken_bastion', 'drowned_temple']);
    expect(s.footer.querySelector('details')!.open).toBe(true);
    expect(s.footer.querySelector('summary')!.tabIndex).toBe(0);
    s.batch.choices[0].pool = 'dungeon_heroic';
    expect(s.render().selected()).toEqual(['drowned_temple']);
    s.batch.bossUnlocks = {};
    expect(s.render().canOpen()).toBe(false);
  });
  it('disables inputs during saving, but fixed legacy and current sources remain openable at any level', () => {
    const s = make();
    s.render(true);
    expect(s.inputs().every((input) => input.disabled)).toBe(true);
    for (const tableId of ['ysolei', 'sunken_bastion']) {
      s.batch.choices[0].tableId = tableId;
      const picker = s.render(false, 1);
      expect(picker.canOpen()).toBe(true);
      expect(picker.selected()).toBeUndefined();
      expect(s.inputs()).toHaveLength(0);
    }
    s.batch.choices[0] = { pool: 'world', fixed: true };
    expect(s.render().canOpen()).toBe(true);
    expect(s.footer.textContent).toBe('Previously rolled reward');
  });
  it('closes the dropdown on outside click or Escape without losing selected tables', () => {
    const s = make();
    const picker = s.render();
    const details = s.footer.querySelector('details')!;
    const summary = s.footer.querySelector('summary')!;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    s.inputs()[1].click();
    expect(details.open).toBe(true);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(details.open).toBe(false);
    expect(picker.selected()).toEqual(['sunken_bastion']);
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    s.inputs()[1].focus();
    s.inputs()[1].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
    expect(picker.selected()).toEqual(['sunken_bastion']);
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    picker.dispose();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(details.open).toBe(true);
  });
  it('keeps summary activation out of game hotkeys and stays open during scrolling', () => {
    const s = make();
    s.render();
    const summary = s.footer.querySelector('summary')!;
    const gameKey = vi.fn();
    s.footer.addEventListener('keydown', gameKey);
    for (const key of ['Enter', ' ']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      summary.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(gameKey).not.toHaveBeenCalled();
    const details = s.footer.querySelector('details')!;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    s.footer.querySelector('.weekly-table-options')!.dispatchEvent(new Event('scroll'));
    expect(details.open).toBe(true);
    s.footer.dispatchEvent(new Event('scroll'));
    expect(details.open).toBe(true);
  });
  it('clicking option text and row padding toggles exactly once and keeps the menu open', () => {
    const s = make();
    const picker = s.render();
    const details = s.footer.querySelector('details')!;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    const input = s.inputs()[1];
    const label = input.closest('label')!;
    const text = label.querySelector('span')!;
    const press = new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true });
    text.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
    text.click();
    expect(picker.selected()).toEqual(['sunken_bastion']);
    text.click();
    expect(picker.selected()).toEqual([]);
    label.click();
    expect(picker.selected()).toEqual(['sunken_bastion']);
    input.click();
    expect(picker.selected()).toEqual([]);
    expect(details.open).toBe(true);
    const allText = s.inputs()[0].closest('label')!.querySelector('span')!;
    allText.click();
    expect(picker.selected()).toHaveLength(2);
    allText.click();
    expect(picker.selected()).toEqual([]);
    s.render(true);
    s.inputs()[1].closest('label')!.querySelector('span')!.click();
    expect(s.inputs()[1].checked).toBe(false);
  });
  it('opens upward when the remaining space below cannot fit the menu', () => {
    const s = make();
    s.render();
    const details = s.footer.querySelector('details')!;
    const summary = s.footer.querySelector('summary')!;
    vi.spyOn(summary, 'getBoundingClientRect').mockReturnValue({
      top: window.innerHeight - 100,
      bottom: window.innerHeight - 56,
    } as DOMRect);
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    expect(details.classList.contains('weekly-table-opens-up')).toBe(true);
    expect(s.footer.querySelector<HTMLElement>('.weekly-table-options')!.style.maxHeight).toBe(
      '220px',
    );
  });
  describe('a Heroic vault choosing its difficulty', () => {
    const heroic = (saving = false) => {
      const s = make();
      s.batch.choices[0].pool = 'dungeon_heroic';
      const difficulties = new Map<number, 'normal' | 'heroic'>();
      const render = () => {
        const picker = appendWeeklyRewardTablePicker({
          footer: s.footer,
          choice: s.batch.choices[0],
          tables: weeklyRewardTableOptions(s.batch, s.batch.choices[0], 'mage', 20),
          index: 0,
          selections: s.selections,
          saving,
          onChange: s.changed,
          expanded: s.expanded,
          difficulties,
        });
        disposers.push(picker.dispose);
        return picker;
      };
      const toggle = () => [
        ...s.footer.querySelectorAll<HTMLButtonElement>('.weekly-table-difficulty button'),
      ];
      const pressed = () => toggle().map((b) => b.getAttribute('aria-pressed'));
      // The table rows only: the first checkbox row is Select all.
      const tableRows = () =>
        [...s.footer.querySelectorAll('.weekly-table-option span')]
          .slice(1)
          .map((row) => row.textContent);
      return { ...s, render, toggle, pressed, tableRows, difficulties };
    };
    it('switches between the Heroic and Normal tables, one difficulty per roll', () => {
      const s = heroic();
      let picker = s.render();
      expect(s.footer.querySelector('.weekly-table-difficulty')!.getAttribute('aria-label')).toBe(
        'Difficulty',
      );
      expect(s.toggle().map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([
        ['Heroic', 'true'],
        ['Normal', 'false'],
      ]);
      // ysolei is the only Heroic clear; vael's dungeon was cleared on Normal only.
      expect(s.tableRows()).toHaveLength(1);
      s.inputs()[1].click();
      expect(picker.selected()).toEqual(['drowned_temple']);
      expect(s.footer.querySelector('summary .weekly-difficulty')).toBeNull();
      s.toggle()[1].click();
      expect(s.pressed()).toEqual(['false', 'true']);
      expect(s.tableRows()).toHaveLength(2);
      // The Heroic pick left with the switch, so one roll never mixes difficulties.
      expect(picker.selected()).toEqual([]);
      expect(picker.canOpen()).toBe(false);
      s.inputs()[0].click();
      expect(picker.selected()).toEqual(['sunken_bastion:normal', 'drowned_temple:normal']);
      expect(picker.canOpen()).toBe(true);
      // The closed menu still says the vault is set to roll Normal.
      const summary = s.footer.querySelector('summary')!;
      expect(summary.querySelector('.weekly-difficulty-normal')!.textContent).toBe('Normal');
      expect(summary.textContent).toBe('2 tables selectedNormal');
      picker.dispose();
      picker = s.render();
      expect(s.pressed()).toEqual(['false', 'true']);
      expect(picker.selected()).toEqual(['sunken_bastion:normal', 'drowned_temple:normal']);
      s.toggle()[0].click();
      expect(picker.selected()).toEqual([]);
      expect(s.footer.querySelector('summary .weekly-difficulty')).toBeNull();
    });
    it('keeps the open menu open and focused on the pressed button through a switch', async () => {
      const s = heroic();
      s.render();
      const details = s.footer.querySelector('details')!;
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
      s.toggle()[1].focus();
      s.toggle()[1].click();
      await Promise.resolve();
      expect(details.open).toBe(true);
      expect(s.expanded.has(0)).toBe(true);
      expect(document.activeElement).toBe(s.toggle()[1]);
      expect(s.pressed()).toEqual(['false', 'true']);
      // Activation keys never reach the game's hotkeys.
      const bubbled = vi.fn();
      document.addEventListener('keydown', bubbled);
      for (const key of ['Enter', ' '])
        s.toggle()[0].dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      document.removeEventListener('keydown', bubbled);
      expect(bubbled).not.toHaveBeenCalled();
    });
    it('offers only the difficulty that has tables, and nothing while saving', () => {
      const s = heroic();
      // No Heroic clear at all: the Heroic vault can only roll Normal.
      s.batch.bossUnlocks = { vael_the_mistcaller: 1 };
      s.render();
      expect(s.toggle().map((b) => b.disabled)).toEqual([true, false]);
      expect(s.pressed()).toEqual(['false', 'true']);
      expect(s.tableRows()).toHaveLength(1);
      const saving = heroic(true);
      saving.render();
      expect(saving.toggle().map((b) => b.disabled)).toEqual([true, true]);
    });
    it('resolves the shown difficulty from the remembered pick and the tables left', () => {
      const normal: WeeklyRewardTableOption = {
        id: 'a:normal',
        kind: 'mob',
        items: ['x'],
        difficulty: 'normal',
      };
      const earned: WeeklyRewardTableOption = { id: 'a', kind: 'mob', items: ['y'] };
      expect(weeklyPickerDifficulty([earned, normal])).toBe('heroic');
      expect(weeklyPickerDifficulty([earned, normal], 'normal')).toBe('normal');
      expect(weeklyPickerDifficulty([normal])).toBe('normal');
      // A remembered difficulty whose tables ran out falls back to the other.
      expect(weeklyPickerDifficulty([normal], 'heroic')).toBe('normal');
      expect(weeklyPickerDifficulty([earned], 'normal')).toBe('heroic');
      expect(weeklyPickerDifficulty([], 'normal')).toBe('heroic');
    });
    it('marks a vault that rolled Normal beside its source, and gives a Normal vault no switch', () => {
      const s = make();
      s.render();
      expect(s.footer.querySelector('.weekly-table-difficulty')).toBeNull();
      s.batch.choices[0] = {
        pool: 'dungeon_heroic',
        tableId: 'sunken_bastion:normal',
        itemId: 'x',
        opened: true,
      };
      s.render();
      // One footer item holds the name then the badge, so a later sibling (the
      // rolled loot focus) cannot land between them.
      expect(s.footer.children).toHaveLength(1);
      const [name, badge] = [...s.footer.firstElementChild!.children];
      expect(name.textContent!.length).toBeGreaterThan(0);
      expect(name.textContent).not.toContain('normal');
      expect(badge.className).toContain('weekly-difficulty-normal');
      expect(badge.textContent).toBe('Normal');
      s.batch.choices[0] = { ...s.batch.choices[0], tableId: 'sunken_bastion' };
      s.render();
      expect(s.footer.querySelector('.weekly-difficulty')).toBeNull();
      expect(s.footer.textContent).toBe(name.textContent);
    });
  });
  it('lists the sole World/PvP table and supplies it automatically when eligible', () => {
    const s = make();
    for (const pool of ['world', 'pvp'] as const) {
      s.selections.clear();
      s.batch.choices[0] = { pool };
      const picker = s.render();
      expect(picker.canOpen()).toBe(true);
      expect(s.footer.querySelector('details')).toBeNull();
      expect(s.inputs()).toHaveLength(0);
      expect(s.footer.textContent).toBe(
        pool === 'world' ? 'World quest loot' : 'WARFARE equipment',
      );
      expect(picker.selected()).toEqual([pool]);
      const unavailable = s.render(false, 1);
      expect(unavailable.canOpen()).toBe(false);
      expect(unavailable.selected()).toBeUndefined();
      expect(s.footer.querySelector('details')).toBeNull();
    }
  });
});
