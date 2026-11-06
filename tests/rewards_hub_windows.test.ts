// @vitest-environment happy-dom
//
// The Rewards hub (menu consolidation step 7) over a real DOM: the World Quests
// tab's board with Show on Map and the confirmed daily replacement, and the hub
// composition (one member shown at a time, the pill counted from the same reads
// the tabs paint).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorldQuestProgress } from '../src/sim/types';
import { worldQuestCycleForResetDay } from '../src/sim/world_quest_rotation';
import { activeWorldQuestsForCycle } from '../src/sim/world_quests';
import { createRewardsSurfaces } from '../src/ui/hud/rewards/rewards_surfaces';
import { worldQuestMapPoint } from '../src/ui/hud/rewards/rewards_view';
import { WorldQuestsWindow } from '../src/ui/hud/rewards/world_quests_window';

const cycle = worldQuestCycleForResetDay('2026-08-31');
const board = activeWorldQuestsForCycle(cycle);

function worldStub(log: Array<[string, WorldQuestProgress['state']]> = []) {
  return {
    worldQuestCycle: cycle,
    worldQuestLog: new Map<string, WorldQuestProgress>(
      log.map(([questId, state]) => [questId, { questId, count: 0, state } as WorldQuestProgress]),
    ),
    worldQuestReplacements: {},
    worldQuestRerollCycle: '',
    worldQuestExpiresAtMs: Date.now() + 3_600_000,
    player: { level: 60, name: 'Ari' },
    canRerollWorldQuest: vi.fn(() => ({ canReroll: true })),
    rerollWorldQuest: vi.fn(() => true),
    weeklyRewardInfo: null as { readyWeeks: number } | null,
    weeklyQuest: null as { state: 'active' | 'completed'; commended?: string } | null,
  };
}

function root(id: string): HTMLElement {
  const el = document.createElement('div');
  el.id = id;
  el.className = 'window panel';
  el.style.display = 'none';
  document.body.appendChild(el);
  return el;
}

function worldQuestsRig(log: Array<[string, WorldQuestProgress['state']]> = []) {
  const el = root('world-quests-window');
  const world = worldStub(log);
  let selected: string | null = null;
  const showOnMap = vi.fn();
  const confirmDialog = vi.fn();
  const win = new WorldQuestsWindow({
    root: () => el,
    world: () => world as never,
    nowMs: () => Date.now(),
    selectedId: () => selected,
    select: (questId) => {
      selected = questId;
    },
    showOnMap,
    confirmDialog,
    closeOthers: vi.fn(),
    captureFocus: () => null,
    restoreFocus: vi.fn(),
  });
  return { el, world, win, showOnMap, confirmDialog, selected: () => selected };
}

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe('World Quests tab', () => {
  it('paints the whole day board with Show on Map beside every open row only', () => {
    const r = worldQuestsRig([[board[0].id, 'completed']]);
    r.win.open();
    expect(r.el.style.display).toBe('flex');
    expect(r.el.querySelectorAll('[data-map-wq]')).toHaveLength(board.length);
    expect(r.el.querySelector(`[data-wq-show-map="${board[0].id}"]`)).toBeNull();
    expect(r.el.querySelector(`[data-wq-show-map="${board[1].id}"]`)).not.toBeNull();
    expect(r.el.querySelectorAll('[data-wq-show-map]')).toHaveLength(board.length - 1);
  });

  it('Show on Map selects the pin and pans to the point the map pin uses', () => {
    const r = worldQuestsRig();
    r.win.open();
    r.el.querySelector<HTMLButtonElement>(`[data-wq-show-map="${board[1].id}"]`)?.click();
    expect(r.showOnMap).toHaveBeenCalledExactlyOnceWith(board[1].id, worldQuestMapPoint(board[1]));
  });

  it('shares the row selection, and replaces only behind the confirm', () => {
    const r = worldQuestsRig();
    r.win.open();
    r.el.querySelector<HTMLButtonElement>(`[data-map-wq="${board[2].id}"]`)?.click();
    expect(r.selected()).toBe(board[2].id);
    const replace = r.el.querySelector<HTMLButtonElement>('[data-map-wq-reroll]');
    expect(replace?.disabled).toBe(false);
    replace?.click();
    expect(r.world.rerollWorldQuest).not.toHaveBeenCalled();
    expect(r.confirmDialog).toHaveBeenCalledOnce();
    const onOk = r.confirmDialog.mock.calls[0][4] as () => void;
    onOk();
    expect(r.world.rerollWorldQuest).toHaveBeenCalledExactlyOnceWith(board[2].id);
    expect(r.selected()).toBeNull();
  });

  it('repaints on the slow band only when the board moves', () => {
    const r = worldQuestsRig();
    r.win.open();
    const painted = r.el.querySelector('.world-quests-body');
    r.win.refreshIfChanged();
    expect(r.el.querySelector('.world-quests-body')).toBe(painted);
    r.world.worldQuestLog.set(board[3].id, {
      questId: board[3].id,
      count: 0,
      state: 'completed',
    } as WorldQuestProgress);
    r.win.refreshIfChanged();
    expect(r.el.querySelector('.world-quests-body')).not.toBe(painted);
  });
});

describe('Rewards hub composition', () => {
  function hubRig() {
    for (const id of ['weekly-vault-window', 'weekly-quests-window', 'world-quests-window']) {
      root(id);
    }
    const world = worldStub([[board[0].id, 'completed']]);
    const surfaces = createRewardsSurfaces({
      world: () => world as never,
      root: (selector) => document.querySelector<HTMLElement>(selector) as HTMLElement,
      focus: () => ({ captureFocus: () => null, restoreFocus: () => {} }),
      presentation: {} as never,
      touch: () => false,
      beforeOpen: vi.fn(),
      onInventoryChanged: vi.fn(),
      hideTooltip: vi.fn(),
      showOnMap: vi.fn(),
      selectedWorldQuest: () => null,
      selectWorldQuest: vi.fn(),
      confirmDialog: vi.fn(),
      nowMs: () => Date.now(),
    });
    return { world, surfaces };
  }

  it('shows one member at a time and remembers the last tab', () => {
    const { surfaces } = hubRig();
    surfaces.hub.open('worldQuests');
    expect(surfaces.worldQuests.isOpen).toBe(true);
    expect(surfaces.vault.isOpen).toBe(false);
    const strip = document.querySelector('#world-quests-window .rewards-hub-tabs');
    expect(strip?.querySelectorAll('.rewards-hub-tab')).toHaveLength(3);
    surfaces.hub.open('weekly');
    expect(surfaces.weekly.isOpen).toBe(true);
    expect(surfaces.worldQuests.isOpen).toBe(false);
    expect(localStorage.getItem('woc.rewards.tab')).toBe('weekly');
    // A hub open is read-only: the pick stays with the emissary.
    expect(document.querySelector('#weekly-quests-window .wk-remote')).not.toBeNull();
  });

  it('counts the pill from the same reads the tabs paint, as of the last recount', () => {
    const { world, surfaces } = hubRig();
    expect(surfaces.claimCounts()).toEqual({ vault: 0, weekly: 0, worldQuests: 1, total: 1 });
    world.weeklyRewardInfo = { readyWeeks: 2 };
    world.weeklyQuest = { state: 'completed' };
    // Cached until the slow band recounts, so the medium-band rail paint never
    // walks the board.
    expect(surfaces.claimCounts().total).toBe(1);
    surfaces.recount();
    expect(surfaces.claimCounts()).toEqual({ vault: 2, weekly: 1, worldQuests: 1, total: 4 });
  });
});
