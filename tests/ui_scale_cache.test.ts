// @vitest-environment happy-dom

// getUiScale is a HOT read: the tooltip mousemove handler calls it on every
// pointer move (Hud.tooltipViewport), and every #ui child that writes a
// coordinate divides by it. Uncached it cost a getComputedStyle on the document
// element (a forced style recalc, the exact thing the per-frame HUD contract
// exists to avoid) plus a localStorage read and a JSON.parse, per move.
//
// It is now cached behind SETTINGS_CHANGE_EVENT, the tap_menu.ts idiom. The two
// halves that matter are both pinned here: the cache is REAL (the hosts are not
// touched on a repeat read) and the invalidation is real (a settings write is
// seen without a reload). The second half is what a cache that silently never
// invalidated would fail, and it is the one that would strand a player at the
// old scale after moving the UI Scale slider.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_CHANGE_EVENT } from '../src/game/settings';
import {
  getUiScale,
  invalidateUiScaleCache,
  resolveUiScale,
  UI_SCALE_DEFAULT,
} from '../src/ui/ui_scale';

function setCssScale(value: string | null): void {
  if (value === null) document.documentElement.style.removeProperty('--ui-scale');
  else document.documentElement.style.setProperty('--ui-scale', value);
}

beforeEach(() => {
  setCssScale(null);
  localStorage.clear();
  invalidateUiScaleCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  setCssScale(null);
  localStorage.clear();
  invalidateUiScaleCache();
});

describe('getUiScale caches the host read', () => {
  it('resolves from the live custom property on the first read', () => {
    setCssScale('1.25');
    expect(getUiScale()).toBe(1.25);
  });

  it('touches neither host again on a repeat read', () => {
    setCssScale('1.25');
    expect(getUiScale()).toBe(1.25);
    const computed = vi.spyOn(globalThis, 'getComputedStyle');
    const stored = vi.spyOn(Storage.prototype, 'getItem');
    for (let i = 0; i < 50; i++) expect(getUiScale()).toBe(1.25);
    expect(
      computed,
      'the forced style recalc is back on the pointer-move path',
    ).not.toHaveBeenCalled();
    expect(stored).not.toHaveBeenCalled();
  });

  it('sees a custom-property write on the very next read, with no event at all', () => {
    // THE LIVENESS ARM. main.ts's applySetting writes `--ui-scale` and calls
    // hud.reapplySavedGeometry() straight after, so every movable frame's
    // reapply divides by the scale the same turn it was written. A cache that
    // waited for anything would misplace every frame for a frame, which is what
    // tests/movable_frame.test.ts caught when this cached the event alone.
    setCssScale('1.25');
    expect(getUiScale()).toBe(1.25);
    setCssScale('1.4');
    expect(getUiScale()).toBe(1.4);
    setCssScale(null);
    expect(getUiScale()).toBe(UI_SCALE_DEFAULT);
  });

  it('checks the property WITHOUT the getComputedStyle it is caching', () => {
    // The liveness above is bought with an inline style read, not by giving the
    // expensive resolve back: the per-call check is off the style attribute and
    // forces no recalc. An implementation that re-read the computed value each
    // call would be live too, and would have cached nothing.
    setCssScale('1.25');
    expect(getUiScale()).toBe(1.25);
    const computed = vi.spyOn(globalThis, 'getComputedStyle');
    expect(getUiScale()).toBe(1.25);
    expect(computed).not.toHaveBeenCalled();
  });

  it('SETTINGS_CHANGE_EVENT drops it, which is the only way the STORED arm moves', () => {
    // With no custom property set the scale comes from the persisted blob, and
    // the per-call property check cannot see that change: nothing about the
    // document moved. The settings broadcast is the whole invalidation here.
    setCssScale(null);
    localStorage.setItem('woc_settings', JSON.stringify({ uiScale: 1.25 }));
    expect(getUiScale()).toBe(1.25);
    localStorage.setItem('woc_settings', JSON.stringify({ uiScale: 1.4 }));
    expect(getUiScale(), 'the stored value was re-read without an event').toBe(1.25);
    window.dispatchEvent(new Event(SETTINGS_CHANGE_EVENT));
    expect(getUiScale()).toBe(1.4);
  });

  it('re-caches after the event rather than resolving every read forever', () => {
    setCssScale(null);
    localStorage.setItem('woc_settings', JSON.stringify({ uiScale: 1.25 }));
    getUiScale();
    localStorage.setItem('woc_settings', JSON.stringify({ uiScale: 0.9 }));
    window.dispatchEvent(new Event(SETTINGS_CHANGE_EVENT));
    expect(getUiScale()).toBe(0.9);
    const computed = vi.spyOn(globalThis, 'getComputedStyle');
    const stored = vi.spyOn(Storage.prototype, 'getItem');
    expect(getUiScale()).toBe(0.9);
    expect(computed).not.toHaveBeenCalled();
    expect(stored).not.toHaveBeenCalled();
  });

  it('applySetting order is safe: the event lands BEFORE the new custom property', () => {
    // main.ts persists the setting first (Settings.save broadcasts the event
    // here) and writes `--ui-scale` immediately after, so the invalidation is
    // deliberately LAZY: it clears the cache and lets the next read resolve.
    // An eager re-resolve inside the listener would cache the OLD value and
    // strand the player there, which is what this ordering pins.
    setCssScale('1');
    expect(getUiScale()).toBe(1);
    window.dispatchEvent(new Event(SETTINGS_CHANGE_EVENT));
    setCssScale('1.3');
    expect(getUiScale()).toBe(1.3);
  });

  it('serves every consumer the same number, and the same one the resolver gives', () => {
    // One cache for the whole module graph: the frames, tooltips, talent grid
    // and FCT must all divide by the same value, which is why the cache lives
    // beside the resolver and not in any consumer.
    localStorage.setItem('woc_settings', JSON.stringify({ uiScale: 1.15 }));
    setCssScale(null);
    invalidateUiScaleCache();
    const live = resolveUiScale(
      document.documentElement.style.getPropertyValue('--ui-scale') || null,
      localStorage.getItem('woc_settings'),
    );
    expect(live).toBe(1.15);
    expect(getUiScale()).toBe(live);
    expect(getUiScale()).toBe(live);
  });

  it('falls back to the default when neither host offers a usable value', () => {
    expect(getUiScale()).toBe(UI_SCALE_DEFAULT);
  });

  it('survives a host that throws on read (blocked site data, a capture context)', () => {
    invalidateUiScaleCache();
    vi.spyOn(globalThis, 'getComputedStyle').mockImplementation(() => {
      throw new Error('no style engine');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('site data blocked');
    });
    expect(getUiScale()).toBe(UI_SCALE_DEFAULT);
  });
});
