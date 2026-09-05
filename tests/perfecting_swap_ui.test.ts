// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/game/audio', () => ({
  audio: { perfectingSuccess: vi.fn(), perfectingAttempt: vi.fn() },
}));

import { STATIONS } from '../src/sim/content/professions';
import { type PerfectItemRef, perfectingInfoFrom } from '../src/sim/professions/perfecting';
import { capturePerfectItemRef } from '../src/sim/professions/perfecting_copy';
import { perfectingSwapInfoFrom } from '../src/sim/professions/perfecting_swap';
import type { InvSlot } from '../src/sim/types';
import { PerfectingWindow } from '../src/ui/hud/professions/perfecting_window';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import type { IWorld } from '../src/world_api';

const CHEST = 'crucible_str_mail_chest';
const WAIST = 'crucible_str_mail_waist';
const FEET = 'crucible_str_mail_feet';

class SwapWorld {
  player = { id: 1 };
  equipment = {};
  equipmentInstances = {};
  inventory: InvSlot[] = [
    {
      itemId: CHEST,
      count: 1,
      instance: {
        perfected: true,
        perfectingBonus: { str: 2 },
        perfectingBound: true,
        enchant: 'enchant_lucent_infusion',
        rolled: { stats: { str: 2, sta: 13 } },
      },
    },
    { itemId: WAIST, count: 1, instance: { perfecting: 1 } },
    { itemId: FEET, count: 1 },
  ];
  craftingIdentity = { synced: true };
  craftSkills = { armorcrafting: 125 };
  reason: 'out_of_range' | undefined;
  perfectItem = vi.fn();
  swapPerfectingRanks = vi.fn();
  perfectingInfo(ref: PerfectItemRef) {
    return perfectingInfoFrom({ ...this, ref });
  }
  perfectingSwapInfo(request: { source: PerfectItemRef; target: PerfectItemRef }) {
    const info = perfectingSwapInfoFrom({
      ...this,
      ...request,
      dead: false,
      inCombat: false,
      pos: STATIONS.find((station) => station.type === 'forge')!.pos,
    });
    return this.reason ? { ...info, reason: this.reason } : info;
  }
}

let world: SwapWorld;
let win: PerfectingWindow;
const root = () => document.getElementById('perfecting-window') as HTMLElement;
const target = (index = 0) =>
  root().querySelectorAll<HTMLButtonElement>('[data-swap-target]')[index];
const action = () => root().querySelector<HTMLButtonElement>('[data-swap-action]')!;

beforeEach(() => {
  vi.useFakeTimers();
  world = new SwapWorld();
  document.body.innerHTML = '<div id="ui"></div><div id="prompt-stack"></div>';
  win = new PerfectingWindow({
    world: () => world as unknown as IWorld,
    itemIcon: () => '',
    itemTooltip: () => '',
    attachTooltip: () => {},
    moneyHtml: () => '',
    closeOthers: () => {},
    captureFocus: () => null,
    restoreFocus: () => {},
  });
});
afterEach(() => {
  win.close();
  setLanguage('en');
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('Perfecting rank exchange inside the existing window', () => {
  it('requires a second owned selection and previews both rank changes before confirming', () => {
    win.open();
    expect(root().querySelector('[data-swap-section]')).not.toBeNull();
    expect(action().disabled).toBe(true);
    target().click();
    expect(root().querySelector('[data-swap-preview]')?.textContent).toContain('4 to 1');
    expect(root().querySelector('[data-swap-preview]')?.textContent).toContain('1 to 4');
    action().click();
    expect(world.swapPerfectingRanks).not.toHaveBeenCalled();
    expect(document.querySelector('.pf-swap-prompt')?.textContent).toContain('permanently bound');
    expect(document.querySelector('.pf-swap-prompt')?.textContent).toContain('inactive');
    expect(root().inert).toBe(true);
    document.querySelector<HTMLButtonElement>('[data-swap-confirm]')!.click();
    expect(world.swapPerfectingRanks).toHaveBeenCalledWith({
      source: capturePerfectItemRef(world, { bag: 0, itemId: CHEST }),
      target: capturePerfectItemRef(world, { bag: 1, itemId: WAIST }),
    });
    expect(root().getAttribute('aria-busy')).toBe('true');
  });

  it('uses radio arrow navigation, preserving target focus across a repaint', () => {
    win.open();
    target().focus();
    target().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(target(1).getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(target(1));
    expect(target(1).tabIndex).toBe(0);
    expect(target().tabIndex).toBe(-1);
  });

  it('revalidates captured references and refuses a changed copy under the confirm prompt', () => {
    win.open();
    target().click();
    action().click();
    world.inventory[1] = { itemId: WAIST, count: 1, instance: { perfecting: 2 } };
    document.querySelector<HTMLButtonElement>('[data-swap-confirm]')!.click();
    expect(world.swapPerfectingRanks).not.toHaveBeenCalled();
    expect(root().textContent).toContain('changed');
    expect(root().inert).toBe(false);
  });

  it('does not rearm a pending exchange for unrelated errors or another result', () => {
    win.open();
    target().click();
    action().click();
    document.querySelector<HTMLButtonElement>('[data-swap-confirm]')!.click();
    win.notifyErrorToast();
    expect(root().getAttribute('aria-busy')).toBe('true');
    win.onSwapResult({
      type: 'perfectingSwapResult',
      pid: 2,
      ok: false,
      sourceItemId: CHEST,
      targetItemId: WAIST,
      reason: 'busy',
      request: world.swapPerfectingRanks.mock.calls[0][0],
    });
    expect(root().getAttribute('aria-busy')).toBe('true');
    win.onSwapResult({
      type: 'perfectingSwapResult',
      pid: 1,
      ok: false,
      sourceItemId: CHEST,
      targetItemId: WAIST,
      reason: 'out_of_range',
      request: world.swapPerfectingRanks.mock.calls[0][0],
    });
    expect(root().getAttribute('aria-busy')).toBe('false');
    expect(root().textContent).toContain('station');
  });

  it('closes a confirmation without sending and releases inert state on teardown', () => {
    win.open();
    target().click();
    action().click();
    win.close();
    expect(document.querySelector('.pf-swap-prompt')).toBeNull();
    expect(root().inert).toBe(false);
    expect(world.swapPerfectingRanks).not.toHaveBeenCalled();
  });

  it('gates station admission from the shared read and repaints when it changes', () => {
    win.open();
    target().click();
    expect(action().disabled).toBe(false);
    world.reason = 'out_of_range';
    vi.advanceTimersByTime(1000);
    expect(action().disabled).toBe(true);
    expect(root().textContent).toContain('station');
  });

  it('keeps unchanged polls free of DOM queries and rewrites', () => {
    win.open();
    target().click();
    const section = root().querySelector('[data-swap-section]');
    const queries = vi.spyOn(root(), 'querySelector');
    const plural = vi.spyOn(root(), 'querySelectorAll');
    vi.advanceTimersByTime(5000);
    expect(queries).not.toHaveBeenCalled();
    expect(plural).not.toHaveBeenCalled();
    queries.mockRestore();
    plural.mockRestore();
    expect(root().querySelector('[data-swap-section]')).toBe(section);
  });

  it('accepts the matching stale-copy denial without item IDs and blocks duplicate sends', () => {
    win.open();
    target().click();
    action().click();
    const confirm = document.querySelector<HTMLButtonElement>('[data-swap-confirm]')!;
    confirm.click();
    confirm.click();
    expect(world.swapPerfectingRanks).toHaveBeenCalledTimes(1);
    const request = world.swapPerfectingRanks.mock.calls[0][0];
    win.onSwapResult({ type: 'perfectingSwapResult', pid: 1, ok: false, reason: 'no_item' });
    expect(root().getAttribute('aria-busy')).toBe('true');
    win.onSwapResult({
      type: 'perfectingSwapResult',
      pid: 1,
      ok: false,
      reason: 'no_item',
      request,
    });
    expect(root().getAttribute('aria-busy')).toBe('false');
    expect(root().textContent).toContain('changed');
  });

  it('reports a correlated success and makes choosing another exchange deliberate', () => {
    win.open();
    target().click();
    action().click();
    document.querySelector<HTMLButtonElement>('[data-swap-confirm]')!.click();
    win.onSwapResult({
      type: 'perfectingSwapResult',
      pid: 1,
      ok: true,
      request: world.swapPerfectingRanks.mock.calls[0][0],
    });
    expect(root().getAttribute('aria-busy')).toBe('false');
    expect(root().querySelector('[role="status"]')?.textContent).toContain('ranks exchanged');
    expect(action().disabled).toBe(true);
  });

  it('escapes player-chosen names in target rows and previews', () => {
    world.inventory[1].instance = {
      name: '<img src=x onerror=alert(1)>',
      perfecting: 1,
      perfectingBound: true,
      rolled: { quality: 'legendary' },
    };
    win.open();
    target().click();
    expect(root().querySelector('[data-swap-preview]')?.textContent).toContain('<img src=x');
    expect(root().querySelector('[data-swap-section] img')).toBeNull();
  });

  it('requires a fresh second selection after changing the first piece', () => {
    win.open();
    target().click();
    root().querySelectorAll<HTMLButtonElement>('[data-cand-i]')[2].click();
    expect(action().disabled).toBe(true);
    expect(root().querySelector('[data-swap-preview]')).toBeNull();
  });

  it('keeps a promoted piece available for rank attempts after its Perfected status moved', () => {
    world.inventory[0] = {
      itemId: CHEST,
      count: 1,
      instance: {
        name: 'Old Friend',
        perfecting: 1,
        perfectingBound: true,
        boundTo: 1,
        rolled: { quality: 'legendary' },
      },
    };
    world.inventory.push(
      { itemId: 'makers_ember', count: 1 },
      { itemId: 'sundered_essence', count: 1 },
      { itemId: 'prismglass_setting', count: 1 },
    );
    win.open();
    expect(root().querySelector('[data-action]')?.textContent).toBe('Attempt Perfecting');
    expect(root().textContent).toContain('Old Friend');
    expect(root().querySelector('.pf-track-label')?.textContent).toContain('Rank 1 of 4');
  });

  it('relocalizes the selection and open confirmation without changing the captured request', async () => {
    win.open();
    target().click();
    action().click();
    const before = document.querySelector('.pf-swap-prompt')?.textContent;
    await ensureLocaleLoaded('zh_CN');
    setLanguage('zh_CN');
    win.relocalize();
    expect(document.querySelector('.pf-swap-prompt')?.textContent).not.toBe(before);
    document.querySelector<HTMLButtonElement>('[data-swap-confirm]')!.click();
    expect(world.swapPerfectingRanks).toHaveBeenCalledTimes(1);
    expect(world.swapPerfectingRanks.mock.calls[0][0].target.itemId).toBe(WAIST);
  });
});
