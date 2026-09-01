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
//
// THE STORAGE SPY GOES ON THE INSTANCE, NEVER ON Storage.prototype. Every arm
// below that watches the persisted host spies `window.localStorage` directly,
// because a prototype spy here installs successfully and intercepts nothing:
// Node predefines a `localStorage` global descriptor that resolves to
// undefined, vitest's happy-dom environment skips installing its own Storage
// over a global that already exists, and tests/jsdom_local_storage_setup.ts
// therefore substitutes a plain OBJECT LITERAL whose prototype is
// Object.prototype. Both `not.toHaveBeenCalled()` arms below were VACUOUS under
// a prototype spy (measured: an unconditional `localStorage.getItem(STORE_KEY)`
// added at the top of getUiScale left all ten cases green), which is the same
// trap tests/reliquary_window_behavior.test.ts records and fixes the same way.
// Each arm that asserts a spy was NOT called therefore carries its own POSITIVE
// CONTROL first: an uncached read the spy must be seen intercepting, so the
// negative half can never go quiet again.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_CHANGE_EVENT } from '../src/game/settings';
import {
  getUiScale,
  invalidateUiScaleCache,
  resolveUiScale,
  UI_SCALE_DEFAULT,
} from '../src/ui/ui_scale';

/** The persisted settings blob's key, mirroring the module-private STORE_KEY.
 *  Spelled once here so the spy assertions pin the ARGUMENT the module reads
 *  with, not merely that some read happened. */
const STORE_KEY = 'woc_settings';

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
  it('pins the default scale to its literal value', () => {
    // Every fallback assertion in this file compares getUiScale() against
    // UI_SCALE_DEFAULT, which the module also returns: a self-comparison that
    // holds whatever the constant is set to. This is the one literal pin behind
    // them, the ACTIVITY_WINDOW_DAYS idiom from
    // tests/server/admin_activity_cache.test.ts. 1 means "no zoom": #ui is
    // styled `zoom: var(--ui-scale)`, so any other default would scale the
    // whole HUD for every player who never touched the slider.
    expect(UI_SCALE_DEFAULT).toBe(1);
  });

  it('resolves from the live custom property on the first read', () => {
    setCssScale('1.25');
    expect(getUiScale()).toBe(1.25);
  });

  it('a Storage.prototype spy intercepts NOTHING here; the instance spy does', () => {
    // The trap this suite shipped with, pinned so a later edit cannot quietly
    // reintroduce it: both spies are armed over the SAME read, and only the
    // instance one sees it. (The claim also holds in an environment where
    // localStorage is a real Storage: vi.spyOn installs an OWN property on the
    // instance, which shadows the prototype either way. So this pins the rule
    // "spy the instance", not a quirk of the current polyfill.)
    const viaPrototype = vi.spyOn(Storage.prototype, 'getItem');
    const viaInstance = vi.spyOn(window.localStorage, 'getItem');
    setCssScale(null);
    expect(getUiScale()).toBe(UI_SCALE_DEFAULT);
    expect(viaInstance, 'the instance spy saw no read at all').toHaveBeenCalledWith(STORE_KEY);
    expect(
      viaPrototype,
      'a Storage.prototype spy is what made the not-called arms below vacuous',
    ).not.toHaveBeenCalled();
  });

  it('touches neither host again on a repeat read', () => {
    setCssScale('1.25');
    const computed = vi.spyOn(globalThis, 'getComputedStyle');
    const stored = vi.spyOn(window.localStorage, 'getItem');
    // THE POSITIVE CONTROL, in the same test as the negative claim it guards:
    // the FIRST read is uncached, so both hosts must be seen through these
    // spies before "not called again" can mean anything.
    expect(getUiScale()).toBe(1.25);
    expect(computed, 'the getComputedStyle spy intercepted nothing').toHaveBeenCalled();
    expect(stored, 'the localStorage spy intercepted nothing').toHaveBeenCalledWith(STORE_KEY);
    computed.mockClear();
    stored.mockClear();
    for (let i = 0; i < 50; i++) expect(getUiScale()).toBe(1.25);
    expect(
      computed,
      'the forced style recalc is back on the pointer-move path',
    ).not.toHaveBeenCalled();
    expect(stored, 'the persisted blob is re-read on the pointer-move path').not.toHaveBeenCalled();
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
    localStorage.setItem(STORE_KEY, JSON.stringify({ uiScale: 1.25 }));
    expect(getUiScale()).toBe(1.25);
    localStorage.setItem(STORE_KEY, JSON.stringify({ uiScale: 1.4 }));
    expect(getUiScale(), 'the stored value was re-read without an event').toBe(1.25);
    window.dispatchEvent(new Event(SETTINGS_CHANGE_EVENT));
    expect(getUiScale()).toBe(1.4);
  });

  it('re-caches after the event rather than resolving every read forever', () => {
    setCssScale(null);
    localStorage.setItem(STORE_KEY, JSON.stringify({ uiScale: 1.25 }));
    getUiScale();
    localStorage.setItem(STORE_KEY, JSON.stringify({ uiScale: 0.9 }));
    window.dispatchEvent(new Event(SETTINGS_CHANGE_EVENT));
    const computed = vi.spyOn(globalThis, 'getComputedStyle');
    const stored = vi.spyOn(window.localStorage, 'getItem');
    // The post-event read is the uncached one, so it doubles as this arm's
    // positive control: both spies must see it before the repeat read below
    // can claim anything by staying silent.
    expect(getUiScale()).toBe(0.9);
    expect(computed, 'the getComputedStyle spy intercepted nothing').toHaveBeenCalled();
    expect(stored, 'the localStorage spy intercepted nothing').toHaveBeenCalledWith(STORE_KEY);
    computed.mockClear();
    stored.mockClear();
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
    localStorage.setItem(STORE_KEY, JSON.stringify({ uiScale: 1.15 }));
    setCssScale(null);
    invalidateUiScaleCache();
    const live = resolveUiScale(
      document.documentElement.style.getPropertyValue('--ui-scale') || null,
      localStorage.getItem(STORE_KEY),
    );
    expect(live).toBe(1.15);
    expect(getUiScale()).toBe(live);
    expect(getUiScale()).toBe(live);
  });

  it('falls back to the default when neither host offers a usable value', () => {
    expect(getUiScale()).toBe(UI_SCALE_DEFAULT);
  });

  it('survives a host that throws on read (blocked site data, a capture context)', () => {
    // The persisted host is SEEDED with a usable scale before the throw is
    // armed, and that seeding is what makes this arm real. With an empty store
    // the default came back whether the read threw, was caught, or never
    // happened at all, so the case passed with the localStorage arm untouched
    // (a Storage.prototype spy reaches nothing here; see the header). Seeded,
    // the default is reachable ONLY by the throw being raised on the module's
    // own read and caught inside it: a dead spy returns 1.4 instead, and a
    // deleted try/catch propagates out of getUiScale on the tooltip mousemove
    // path, which is exactly what a browser with site data blocked does.
    localStorage.setItem(STORE_KEY, JSON.stringify({ uiScale: 1.4 }));
    invalidateUiScaleCache();
    vi.spyOn(globalThis, 'getComputedStyle').mockImplementation(() => {
      throw new Error('no style engine');
    });
    const stored = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('site data blocked');
    });
    expect(getUiScale()).toBe(UI_SCALE_DEFAULT);
    expect(stored, 'the throwing read was never reached').toHaveBeenCalledWith(STORE_KEY);
  });
});
