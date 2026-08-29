// @vitest-environment happy-dom
// The two host-reaching halves of tap mode that a Node test can drive: the
// CACHED setting read, and the registry Hud's single Escape dispatcher asks.
//
// The read runs at the head of a combat-critical press on the ring, the seat and
// the menu control. It used to construct a Settings every time, which rebuilds
// every numeric and boolean setting from a localStorage read plus a JSON.parse
// to answer one boolean. Caching it is only correct if the options row still
// takes effect without a reload, so both halves are pinned here: no repeat read,
// AND the flip is seen.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_CHANGE_EVENT, Settings } from '../src/game/settings';
import { closeOpenTouchMenu, registerTouchMenu, tapMenusEnabled } from '../src/ui/hud/tap_menu';

function store(touchTapMenus: boolean): void {
  localStorage.setItem('woc_settings', JSON.stringify({ touchTapMenus }));
  // The cache is invalidated by the broadcast, not by the write, so a test that
  // seeds the store directly has to say so the same way the options row does.
  window.dispatchEvent(new Event(SETTINGS_CHANGE_EVENT));
}

/** Counts real reads of the settings blob, whichever localStorage happy-dom
 *  installs (the spy is on the live object, not on a prototype it may not use). */
function spyOnStoreRead() {
  const original = localStorage.getItem.bind(localStorage);
  const counter = { reads: 0, restore: () => {} };
  const patched = (key: string): string | null => {
    if (key === 'woc_settings') counter.reads++;
    return original(key);
  };
  vi.spyOn(localStorage, 'getItem').mockImplementation(patched);
  counter.restore = () => {
    vi.mocked(localStorage.getItem).mockRestore();
  };
  return counter;
}

beforeEach(() => {
  localStorage.clear();
  store(false);
});

describe('tapMenusEnabled: cached, invalidated on a settings write', () => {
  it('reads the store once and answers every later press from the cache', () => {
    expect(tapMenusEnabled()).toBe(false);
    const getItem = spyOnStoreRead();
    for (let press = 0; press < 20; press++) expect(tapMenusEnabled()).toBe(false);
    expect(getItem.reads).toBe(0);
    getItem.restore();
  });

  it('sees the options row flip without a reload', () => {
    expect(tapMenusEnabled()).toBe(false);
    // Exactly what the options panel does: its own Settings instance, whose
    // persisted write broadcasts the invalidation.
    new Settings().set('touchTapMenus', true);
    expect(tapMenusEnabled()).toBe(true);
    new Settings().set('touchTapMenus', false);
    expect(tapMenusEnabled()).toBe(false);
  });

  it('re-reads once per invalidation, not once per press', () => {
    expect(tapMenusEnabled()).toBe(false);
    new Settings().set('touchTapMenus', true);
    const getItem = spyOnStoreRead();
    expect(tapMenusEnabled()).toBe(true);
    expect(getItem.reads).toBe(1);
    for (let press = 0; press < 10; press++) tapMenusEnabled();
    expect(getItem.reads).toBe(1);
    getItem.restore();
  });
});

describe('the touch menu registry Escape asks', () => {
  it('closes every registered menu that is showing and reports it', () => {
    const open = { a: true, b: false };
    registerTouchMenu(() => {
      if (!open.a) return false;
      open.a = false;
      return true;
    });
    registerTouchMenu(() => {
      if (!open.b) return false;
      open.b = false;
      return true;
    });
    expect(closeOpenTouchMenu()).toBe(true);
    expect(open).toEqual({ a: false, b: false });
    // Nothing left showing: Escape must fall through to whatever Hud would have
    // closed instead, rather than being swallowed here.
    expect(closeOpenTouchMenu()).toBe(false);
  });
});
