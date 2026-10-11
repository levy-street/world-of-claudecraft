// @vitest-environment happy-dom
//
// The weekly window painter (src/ui/weekly_quests_window.ts) over jsdom: the
// four cards, the inner confirm dialog, the pick command, and the held state.
import { describe, expect, it, vi } from 'vitest';
import type { WeeklyQuestProgress } from '../src/sim/types';
import { WeeklyQuestsWindow } from '../src/ui/weekly_quests_window';

function rig(weeklyQuest: WeeklyQuestProgress | null = null) {
  const el = document.createElement('div');
  el.id = 'weekly-quests-window';
  el.className = 'window panel';
  document.body.appendChild(el);
  const chooseWeeklyQuest = vi.fn();
  const commendWeeklyQuest = vi.fn();
  const world = {
    weeklyQuest,
    weeklyQuestResetAtMs: Date.now() + 3_600_000,
    player: { level: 8, name: 'Ari' },
    factions: { rift_watch: 3000, church_order: 0, automatons: 0 },
    chooseWeeklyQuest,
    commendWeeklyQuest,
  };
  const closeOthers = vi.fn();
  const restoreFocus = vi.fn();
  const window = new WeeklyQuestsWindow({
    root: () => el,
    world: () => world as never,
    closeOthers,
    captureFocus: () => null,
    restoreFocus,
  });
  return { el, world, window, chooseWeeklyQuest, commendWeeklyQuest, closeOthers, restoreFocus };
}

describe('weekly quests window', () => {
  it('opens with four cards, closes others, and returns focus on close', () => {
    const r = rig();
    r.window.open();
    expect(r.window.isOpen).toBe(true);
    expect(r.el.style.display).toBe('flex');
    expect(r.closeOthers).toHaveBeenCalledTimes(1);
    expect(r.el.querySelectorAll('.wk-card')).toHaveLength(4);
    expect(r.el.querySelector('#weekly-quests-title')?.textContent).toBe('Weekly Quests');
    expect(r.el.querySelector('.wk-backdrop')).toBeNull();
    (r.el.querySelector('[data-close]') as HTMLButtonElement).click();
    expect(r.window.isOpen).toBe(false);
    expect(r.el.style.display).toBe('none');
    expect(r.restoreFocus).toHaveBeenCalledTimes(1);
  });

  it('confirms a pick through the inner dialog and sends exactly one command', () => {
    const r = rig();
    r.window.open();
    (r.el.querySelector('[data-wk-choose="wk_raid"]') as HTMLButtonElement).click();
    const dialog = r.el.querySelector('.wk-dialog');
    expect(dialog).not.toBeNull();
    expect(dialog?.querySelector('#weekly-quest-dialog-title')?.textContent).toBe(
      'Weekly quest: Raid',
    );
    expect(dialog?.querySelector('.wk-who-name')?.textContent).toBe('Cham Pete');
    (r.el.querySelector('[data-wk-decline]') as HTMLButtonElement).click();
    expect(r.el.querySelector('.wk-dialog')).toBeNull();
    expect(r.chooseWeeklyQuest).not.toHaveBeenCalled();
    (r.el.querySelector('[data-wk-choose="wk_raid"]') as HTMLButtonElement).click();
    (r.el.querySelector('[data-wk-accept]') as HTMLButtonElement).click();
    expect(r.chooseWeeklyQuest).toHaveBeenCalledExactlyOnceWith('wk_raid');
    expect(r.el.querySelector('.wk-dialog')).toBeNull();
  });

  it('paints the held charge and disables every card once the pick lands', () => {
    const r = rig({ questId: 'wk_dungeons', week: 'wk_1', count: 1, state: 'active' });
    r.window.open();
    const buttons = Array.from(r.el.querySelectorAll<HTMLButtonElement>('[data-wk-choose]'));
    expect(buttons.map((b) => b.disabled)).toEqual([true, true, true, true]);
    expect(buttons[0].textContent).toBe('In progress (1/3)');
    expect(buttons[1].textContent).toBe('Locked this week');
    expect(r.el.querySelector('.wk-card-active')?.getAttribute('data-wk-card')).toBe('wk_dungeons');
    // A refresh repaints once the mirror changes.
    r.world.weeklyQuest = { questId: 'wk_dungeons', week: 'wk_1', count: 3, state: 'completed' };
    r.window.refreshIfChanged();
    expect(r.el.querySelector('[data-wk-choose="wk_dungeons"]')?.textContent).toBe(
      'Completed this week',
    );
  });

  it('offers the commendation once the charge is finished and sends the faction on a click', () => {
    const active = rig({ questId: 'wk_raid', week: 'wk_2', count: 0, state: 'active' });
    active.window.open();
    expect(active.el.querySelector('.wk-commend')).toBeNull();
    const r = rig({ questId: 'wk_raid', week: 'wk_2', count: 1, state: 'completed' });
    r.window.open();
    const buttons = [...r.el.querySelectorAll<HTMLButtonElement>('[data-wk-commend]')];
    expect(buttons.map((b) => [b.dataset.wkCommend, b.disabled])).toEqual([
      // Level 8 sits under the low-level cap and the Rift Watch is already there.
      ['rift_watch', true],
      ['church_order', false],
      ['automatons', false],
    ]);
    expect(r.el.querySelector('.wk-foot')).toBeNull();
    expect(r.el.querySelector('.wk-commend-note')?.textContent).toContain('1,000');
    buttons[1].click();
    expect(r.commendWeeklyQuest).toHaveBeenCalledExactlyOnceWith('church_order');
    // Once the mirror carries the claim, every button is inert and the line names it.
    r.world.weeklyQuest = {
      questId: 'wk_raid',
      week: 'wk_2',
      count: 1,
      state: 'completed',
      commended: 'church_order',
    };
    r.window.refreshIfChanged();
    expect(
      [...r.el.querySelectorAll<HTMLButtonElement>('[data-wk-commend]')].every((b) => b.disabled),
    ).toBe(true);
    expect(r.el.querySelector('.wk-commend-note')?.textContent).toBe(
      "This week's commendation went to the Church Order.",
    );
  });
});
