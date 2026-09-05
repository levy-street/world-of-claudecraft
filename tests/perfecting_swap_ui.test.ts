// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/game/audio', () => ({
  audio: { perfectingSuccess: vi.fn(), perfectingAttempt: vi.fn() },
}));

import { audio } from '../src/game/audio';
import { Input } from '../src/game/input';
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
  it('keeps a mouse-opened confirmation focused through the real input focus release', () => {
    win.open();
    target().click();
    action().click();
    const prompt = document.querySelector<HTMLElement>('.pf-swap-prompt')!;
    // The input's bubbling click handler runs AFTER the opener focused Cancel.
    // A dialog without a focusable root drops that focus to body, allowing
    // Escape to reach the game dispatcher and close the underlying window.
    const input = Input.prototype as unknown as {
      releaseMouseActivatedFocus(event: { type: string; detail: number }): void;
    };
    input.releaseMouseActivatedFocus({ type: 'click', detail: 1 });
    expect(document.activeElement).toBe(prompt);
    prompt.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    expect(document.querySelector('.pf-swap-prompt')).toBeNull();
    expect(win.isOpen).toBe(true);
    expect(document.activeElement).toBe(action());
  });

  it('distinguishes duplicate bagged and worn targets by rank and copy location through confirmation', () => {
    world.equipment = { waist: WAIST };
    world.equipmentInstances = { waist: { perfecting: 3 } };
    world.inventory.push({
      itemId: WAIST,
      count: 1,
      instance: { perfecting: 2, perfectingBound: true },
    });
    win.open();
    root().querySelectorAll<HTMLButtonElement>('[data-cand-i]')[1].click();
    const labels = [...root().querySelectorAll<HTMLButtonElement>('[data-swap-target]')].map(
      (row) => row.textContent,
    );
    expect(new Set(labels).size).toBe(labels.length);
    expect(target(0).textContent).toContain('Worn (Waist)');
    expect(target(0).textContent).toContain('Rank 3 of 4');
    expect(target(1).textContent).toContain('Bag copy 1 of 2');
    expect(target(1).textContent).toContain('Rank 1 of 4');
    expect(target(3).textContent).toContain('Bag copy 2 of 2');
    expect(target(3).textContent).toContain('Rank 2 of 4');
    expect(root().querySelectorAll<HTMLButtonElement>('[data-cand-i]')[1].textContent).toContain(
      'Bag copy 1 of 1',
    );
    target(3).click();
    action().click();
    const prompt = document.querySelector('.pf-swap-prompt')!;
    expect(prompt.textContent).toContain('Bag copy 1 of 1');
    expect(prompt.textContent).toContain('Bag copy 2 of 2');
    // Confirmation keeps the captured copy labels even if a same-id sibling
    // leaves before relocalization; the stale authorization must then refuse.
    world.inventory.splice(1, 1);
    win.relocalize();
    expect(prompt.textContent).toContain('Bag copy 2 of 2');
    document.querySelector<HTMLButtonElement>('[data-swap-confirm]')!.click();
    expect(world.swapPerfectingRanks).not.toHaveBeenCalled();
  });

  it('names a worn target location alongside the bagged source in the preview and confirmation', () => {
    world.equipment = { waist: WAIST };
    world.equipmentInstances = { waist: { perfecting: 2 } };
    win.open();
    root().querySelectorAll<HTMLButtonElement>('[data-cand-i]')[1].click();
    target().click();
    const preview = root().querySelector('[data-swap-preview]')!;
    expect(preview.textContent).toContain('Worn (Waist)');
    expect(preview.textContent).toContain('Bag copy 1 of 1');
    action().click();
    expect(document.querySelector('.pf-swap-prompt')?.textContent).toContain('Worn (Waist)');
    expect(document.querySelector('.pf-swap-prompt')?.textContent).toContain('Bag copy 1 of 1');
  });

  it('recovers a lost success after reconnect without guessing the outcome or replaying the exchange', () => {
    world.inventory[0] = { itemId: CHEST, count: 1, instance: { perfecting: 1 } };
    world.inventory[1] = {
      itemId: WAIST,
      count: 1,
      instance: { perfected: true, perfectingBonus: { str: 2 }, rolled: { stats: { str: 2 } } },
    };
    win.open();
    target().click();
    action().click();
    document.querySelector<HTMLButtonElement>('[data-swap-confirm]')!.click();
    const request = world.swapPerfectingRanks.mock.calls[0][0];
    win.onReconnected();
    expect(root().getAttribute('aria-busy')).toBe('false');
    expect(action().disabled).toBe(true);
    expect(target().disabled).toBe(true);
    expect(root().querySelector('[role="status"]')?.textContent).toContain('could not confirm');
    // A full post-reconnect snapshot arrives after hello. Its cprof identity is
    // a fresh object even when progression values did not change.
    world.inventory[0] = {
      itemId: CHEST,
      count: 1,
      instance: { perfected: true, perfectingBonus: { str: 2 }, rolled: { stats: { str: 2 } } },
    };
    world.inventory[1] = { itemId: WAIST, count: 1, instance: { perfecting: 1 } };
    world.craftingIdentity = { synced: true };
    vi.advanceTimersByTime(1000);
    win.onSwapResult({ type: 'perfectingSwapResult', pid: 1, ok: true, request });
    expect(root().querySelector('[role="status"]')?.textContent).toContain('could not confirm');
    expect(root().textContent).not.toContain('ranks exchanged');
    expect(audio.perfectingSuccess).not.toHaveBeenCalled();
    expect(world.swapPerfectingRanks).toHaveBeenCalledTimes(1);
    expect(target().disabled).toBe(false);
    expect(action().disabled).toBe(true);
  });

  it('recovers a lost refusal after reconnect but waits for a fresh snapshot before permitting a new deliberate exchange', () => {
    win.open();
    target().click();
    action().click();
    document.querySelector<HTMLButtonElement>('[data-swap-confirm]')!.click();
    win.onReconnected();
    vi.advanceTimersByTime(30_000);
    expect(root().getAttribute('aria-busy')).toBe('false');
    expect(target().disabled).toBe(true);
    target().click();
    expect(action().disabled).toBe(true);
    expect(world.swapPerfectingRanks).toHaveBeenCalledTimes(1);
    win.close();
    win.open();
    expect(target().disabled).toBe(true);
    world.craftingIdentity = { synced: false };
    vi.advanceTimersByTime(1000);
    expect(target().disabled).toBe(true);
    world.craftingIdentity = { synced: true };
    vi.advanceTimersByTime(1000);
    expect(target().disabled).toBe(false);
    expect(action().disabled).toBe(true);
    target().click();
    action().click();
    expect(world.swapPerfectingRanks).toHaveBeenCalledTimes(1);
    document.querySelector<HTMLButtonElement>('[data-swap-confirm]')!.click();
    expect(world.swapPerfectingRanks).toHaveBeenCalledTimes(2);
  });

  it('dismisses an unsent pre-reconnect confirmation and makes its detached confirm inert', () => {
    win.open();
    target().click();
    action().click();
    const oldConfirm = document.querySelector<HTMLButtonElement>('[data-swap-confirm]')!;
    win.onReconnected();
    expect(document.querySelector('.pf-swap-prompt')).toBeNull();
    expect(root().inert).toBe(false);
    oldConfirm.click();
    expect(world.swapPerfectingRanks).not.toHaveBeenCalled();
    expect(root().querySelector('[role="status"]')?.textContent).not.toContain('could not confirm');
  });

  it('routes reconnect to Perfecting and preserves the existing market resync', () => {
    const hud = readFileSync('src/ui/hud.ts', 'utf8');
    const main = readFileSync('src/main.ts', 'utf8');
    const method = hud.slice(
      hud.indexOf('resyncAfterReconnect(): void {'),
      hud.indexOf('resyncAfterReconnect(): void {') + 250,
    );
    expect(method).toContain('this.marketWindow.onReconnected();');
    expect(method).toContain('this.perfectingWindow?.onReconnected();');
    const chain = main.slice(
      main.indexOf('const priorOnReconnected = online.onReconnected;'),
      main.indexOf('const priorOnReconnected = online.onReconnected;') + 650,
    );
    expect(chain).toContain('priorOnReconnected?.();');
    expect(chain).toContain('hud.resyncAfterReconnect();');
  });

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
