// @vitest-environment happy-dom
//
// The mob inspect window painter (src/ui/hud/mob_inspect/mob_inspect_window.ts)
// and the target-frame menu controller, driven over happy-dom with stub deps:
// open paints the pending state, a settled live read repaints the stats, a
// late answer for an earlier open never paints over the current mob, the
// Promise (online) and synchronous (offline) read shapes behave the same, and
// the menu wires Inspect and the raid markers to their actions.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MOBS } from '../src/sim/data';
import { CTX_MENU_PICKER_CLASS } from '../src/ui/bag_item_action_menu';
import {
  MobInspectWindow,
  type MobInspectWindowDeps,
  type MobTargetMenuDeps,
  openMobTargetMenu,
} from '../src/ui/hud/mob_inspect';
import { formatNumber, t } from '../src/ui/i18n';
import type { MobInspectInfo } from '../src/world_api';

const WOLF = MOBS.forest_wolf;

function info(id: number, over: Partial<MobInspectInfo> = {}): MobInspectInfo {
  return {
    mobId: id,
    templateId: 'forest_wolf',
    level: 6,
    maxHp: 150,
    weaponMin: 8,
    weaponMax: 12,
    attackSpeed: 2,
    armor: 100,
    ccImmune: false,
    slowImmune: false,
    ...over,
  };
}

function rig(requestStats: MobInspectWindowDeps['requestStats']) {
  const el = document.createElement('div');
  el.id = 'mob-inspect-window';
  document.body.appendChild(el);
  const deps: MobInspectWindowDeps = {
    root: () => el,
    closeOthers: vi.fn(),
    hideTooltip: () => {},
    captureFocus: () => null,
    restoreFocus: vi.fn(),
    itemIcon: () => '<img class="item-icon">',
    moneyHtml: (c) => `<span class="money">${c}</span>`,
    itemTooltip: () => '',
    attachTooltip: vi.fn(),
    subject: (id) => (id === 404 ? null : { id, templateId: 'forest_wolf', level: 6, maxHp: 140 }),
    viewerLevel: () => 6,
    requestStats,
  };
  return { el, deps, w: new MobInspectWindow(deps) };
}

function statText(el: HTMLElement): string {
  return el.querySelector('.mob-inspect-section')?.textContent ?? '';
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('MobInspectWindow', () => {
  it('refuses a non-mob subject without opening', () => {
    const { w, el, deps } = rig(() => null);
    expect(w.open(404)).toBe(false);
    expect(w.isOpen).toBe(false);
    expect(el.style.display).toBe('');
    expect(deps.closeOthers).not.toHaveBeenCalled();
  });

  it('paints pending, then the live stats once the online read settles', async () => {
    let resolve!: (v: MobInspectInfo | null) => void;
    const { w, el } = rig(() => new Promise((r) => (resolve = r)));
    expect(w.open(5)).toBe(true);
    expect(el.style.display).toBe('flex');
    expect(el.getAttribute('role')).toBe('dialog');
    expect(statText(el)).toContain(t('hudChrome.mobInspect.statsPending'));
    resolve(info(5, { weaponMin: 31, weaponMax: 47 }));
    await Promise.resolve();
    await Promise.resolve();
    expect(statText(el)).not.toContain(t('hudChrome.mobInspect.statsPending'));
    expect(statText(el)).toContain(
      t('hudChrome.mobInspect.damageRange', { min: formatNumber(31), max: formatNumber(47) }),
    );
  });

  it('a synchronous (offline) read paints live stats immediately', () => {
    const { w, el } = rig((id) => info(id, { armor: 321 }));
    w.open(5);
    expect(statText(el)).toContain(formatNumber(321));
  });

  it('a null read shows the unavailable note', () => {
    const { w, el } = rig(() => null);
    w.open(5);
    expect(statText(el)).toContain(t('hudChrome.mobInspect.statsUnavailable'));
  });

  it('ignores a late answer from an earlier open', async () => {
    const pending: ((v: MobInspectInfo | null) => void)[] = [];
    const { w, el } = rig(() => new Promise((r) => pending.push(r)));
    w.open(5);
    w.open(6);
    pending[0](info(5, { weaponMin: 900, weaponMax: 901 }));
    await Promise.resolve();
    await Promise.resolve();
    expect(statText(el)).toContain(t('hudChrome.mobInspect.statsPending'));
    expect(w.mobId).toBe(6);
  });

  it('lists the template drops with their chances and wires an item tooltip per row', () => {
    const { w, el, deps } = rig(() => null);
    w.open(5);
    const itemRows = WOLF.loot.filter((e) => e.itemId).length;
    const rendered = el.querySelectorAll('.mob-inspect-drop[data-item-id]');
    expect(rendered.length).toBe(itemRows);
    expect(deps.attachTooltip).toHaveBeenCalledTimes(itemRows);
  });

  it('closes through the X button and restores the opener focus', () => {
    const { w, el, deps } = rig(() => null);
    w.open(5);
    el.querySelector<HTMLElement>('[data-close]')?.click();
    expect(w.isOpen).toBe(false);
    expect(el.style.display).toBe('none');
    expect(deps.restoreFocus).toHaveBeenCalled();
  });
});

describe('openMobTargetMenu', () => {
  function menuRig(markable: boolean) {
    const menu = document.createElement('div');
    menu.classList.add(CTX_MENU_PICKER_CLASS);
    document.body.appendChild(menu);
    const deps: MobTargetMenuDeps = {
      menu: () => menu,
      place: vi.fn(),
      markerIconUrl: () => 'data:,',
      markerFor: () => 3,
      setMarker: vi.fn(),
      clearMarker: vi.fn(),
      inspect: vi.fn(),
    };
    openMobTargetMenu(deps, { id: 77, name: 'Forest Wolf', markable }, 10, 20);
    return { menu, deps };
  }

  it('opens with Inspect, clears picker mode, and Inspect opens the window', () => {
    const { menu, deps } = menuRig(false);
    expect(menu.classList.contains(CTX_MENU_PICKER_CLASS)).toBe(false);
    expect(menu.style.display).toBe('block');
    expect(deps.place).toHaveBeenCalledWith(menu, 10, 20);
    expect(menu.querySelectorAll('.ctx-item')).toHaveLength(2);
    menu.querySelector<HTMLElement>('[data-act="inspect"]')?.click();
    expect(deps.inspect).toHaveBeenCalledWith(77);
    expect(menu.style.display).toBe('none');
  });

  it('keeps the marker picker for a markable mob: set by click, clear by Enter', () => {
    const { menu, deps } = menuRig(true);
    expect(menu.querySelectorAll('.ctx-mark')).toHaveLength(8);
    expect(menu.querySelector('[data-act="m3"] .ctx-selected')).not.toBeNull();
    menu.querySelector<HTMLElement>('[data-act="m5"]')?.click();
    expect(deps.setMarker).toHaveBeenCalledWith(77, 5);
    menu
      .querySelector<HTMLElement>('[data-act="clear"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(deps.clearMarker).toHaveBeenCalledWith(77);
  });
});
