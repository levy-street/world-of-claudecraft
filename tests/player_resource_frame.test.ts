// @vitest-environment happy-dom
// The detachable player resource bar (the 'playerResource' HUD_FRAME_SPECS
// row): the Detach Resource Bar option lifts the bar's wrapper out of the
// player frame onto #ui as a governed frame, sized by its own two settings,
// and turning the option off rides it back to the end of the bars column.
// Driven through the REAL registry wiring (registerHudFrames + InterfaceUnlock),
// the target-of-target independence test's shape in hud_frame_groups.test.ts.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyFrameGeometrySetting } from '../src/game/frame_geometry_settings';
import { BOOL_SETTINGS, SETTING_RANGES } from '../src/game/settings';
import {
  additionalUnitDimensions,
  RESOURCE_BAR_DETACH_GAP,
  resourceBarFirstSeat,
} from '../src/ui/frame_dimensions';
import { frameMenuGroup, frameSettingRelated } from '../src/ui/frame_menu_core';
import { HudFrameGroups } from '../src/ui/hud_frame_groups';
import { registerHudFrames } from '../src/ui/hud_frame_registry';
import { InterfaceUnlock } from '../src/ui/interface_unlock';
import { HUD_FRAME_SPECS } from '../src/ui/interface_unlock_core';
import type { FramesMenuSettingsHooks } from '../src/ui/interface_unlock_menu_core';
import { FRAME_USER_HIDDEN_CLASS } from '../src/ui/movable_frame';

const SPEC = HUD_FRAME_SPECS.find((row) => row.id === 'playerResource')!;

function mountPlayerFrame(): { bars: HTMLElement; wrap: HTMLElement; bar: HTMLElement } {
  document.body.innerHTML =
    '<div id="ui"><div id="player-frame" class="unitframe"><div class="uf-bars" id="pf-bars">' +
    '<div class="bar hp"></div>' +
    '<div id="pf-resource-frame"><div class="bar mana" id="pf-resource"></div></div>' +
    '</div></div></div>';
  return {
    bars: document.getElementById('pf-bars')!,
    wrap: document.getElementById('pf-resource-frame')!,
    bar: document.getElementById('pf-resource')!,
  };
}

function rig(store: Record<string, number | boolean>, mobile: boolean | (() => boolean) = false) {
  const writes: Array<[string, number | boolean]> = [];
  const hooks: FramesMenuSettingsHooks = {
    settings: {
      get: (key) => store[key],
      set: (key, value) => {
        store[key] = value;
        return value;
      },
    },
    onSettingChange: (key, value) => writes.push([key, value]),
  };
  const registry = new InterfaceUnlock({ document });
  const sync = registerHudFrames({
    document,
    registry,
    groups: new HudFrameGroups(document, HUD_FRAME_SPECS),
    isMobileLayout: () => (typeof mobile === 'function' ? mobile() : mobile),
    snapToGrid: () => false,
    labelKey: (row) => row.labelKey,
    isActive: () => true,
    onPositioned: () => {},
    options: () => hooks,
  });
  return { registry, sync, writes };
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('player resource frame (Detach Resource Bar)', () => {
  it('is a wrapper frame seated last in the player frame bars column', () => {
    expect(SPEC).toMatchObject({
      elementId: 'pf-resource-frame',
      detachToUiRoot: true,
      stockHome: { parentId: 'pf-bars', slot: 'last' },
    });
    // The setting ships off, so nothing changes for a player who never asks.
    expect(BOOL_SETTINGS.playerFrameResourceDetached.def).toBe(false);
    expect(frameMenuGroup('playerResource')).toBe('units');
  });

  it('stays on the player frame and never loosens while the option is off', () => {
    const { bars, wrap } = mountPlayerFrame();
    const { registry, sync } = rig({ playerFrameResourceDetached: false });
    sync(true);
    registry.setUnlocked(true);
    expect(wrap.parentElement).toBe(bars);
    expect(wrap.classList.contains('tf-unlocked')).toBe(false);
    expect(wrap.classList.contains('hud-frame-detached')).toBe(false);
  });

  it('detaches onto #ui at a seat of its own, and re-docks with its saved spot kept', () => {
    const { bars, wrap, bar } = mountPlayerFrame();
    const store: Record<string, number | boolean> = { playerFrameResourceDetached: false };
    const { registry, sync } = rig(store);
    sync(true);
    registry.setUnlocked(true);

    store.playerFrameResourceDetached = true;
    sync();
    expect(wrap.parentElement!.id).toBe('ui');
    expect(wrap.classList.contains('hud-frame-detached')).toBe(true);
    // The first detach persists a seat at once, so a reload finds it.
    const saved = JSON.parse(localStorage.getItem(SPEC.storageKey)!);
    expect(typeof saved.left).toBe('number');
    expect(wrap.style.left).not.toBe('');
    // Live mid-edit: the frame gains its chrome without a lock/unlock cycle.
    expect(wrap.classList.contains('tf-unlocked')).toBe(true);
    // The painter's cached bar node rides inside the wrapper, untouched.
    expect(wrap.contains(bar)).toBe(true);

    store.playerFrameResourceDetached = false;
    sync();
    expect(wrap.parentElement).toBe(bars);
    expect(bars.lastElementChild).toBe(wrap);
    expect(wrap.style.left).toBe('');
    expect(wrap.classList.contains('hud-frame-detached')).toBe(false);
    expect(wrap.classList.contains('tf-unlocked')).toBe(false);
    expect(JSON.parse(localStorage.getItem(SPEC.storageKey)!)).toMatchObject({
      left: saved.left,
      top: saved.top,
    });
  });

  it('a live flip seeds the size from the docked bar; a boot keeps the stored size', () => {
    mountPlayerFrame();
    const store: Record<string, number | boolean> = {
      playerFrameResourceDetached: false,
      playerFrameResourceWidth: 300,
    };
    const { sync, writes } = rig(store);
    sync(true);
    store.playerFrameResourceDetached = true;
    sync();
    // happy-dom lays nothing out, so the docked rect is empty and the seed
    // falls back to the stock size (the seat math is pinned separately).
    expect(writes).toEqual([
      ['playerFrameResourceWidth', SETTING_RANGES.playerFrameResourceWidth.def],
      ['playerFrameResourceHeight', SETTING_RANGES.playerFrameResourceHeight.def],
    ]);
    localStorage.clear();
    mountPlayerFrame();
    const booted: Record<string, number | boolean> = {
      playerFrameResourceDetached: true,
      playerFrameResourceWidth: 300,
    };
    const second = rig(booted);
    second.sync(true);
    expect(second.writes).toEqual([]);
    expect(booted.playerFrameResourceWidth).toBe(300);
  });

  it('stays docked and stores nothing on the touch HUD', () => {
    const { bars, wrap } = mountPlayerFrame();
    const store: Record<string, number | boolean> = { playerFrameResourceDetached: false };
    const { sync, writes } = rig(store, true);
    sync(true);
    store.playerFrameResourceDetached = true;
    sync();
    expect(wrap.parentElement).toBe(bars);
    expect(localStorage.getItem(SPEC.storageKey)).toBeNull();
    expect(writes).toEqual([]);
  });

  it('seats a first detach just below the player frame at its docked size', () => {
    const bar = { left: 520, top: 790, width: 232, height: 11 };
    const frame = { bottom: 805, height: 60 };
    expect(resourceBarFirstSeat(bar, frame, 1)).toEqual({
      seat: { left: 520, top: 805 + RESOURCE_BAR_DETACH_GAP },
      width: 232,
      height: 11,
    });
    // Visual px back to setting px under UI Scale, clamped to the ranges.
    expect(resourceBarFirstSeat({ ...bar, width: 464, height: 2 }, frame, 2)).toMatchObject({
      width: 232,
      height: SETTING_RANGES.playerFrameResourceHeight.min,
    });
    // No laid-out frame or bar: the stock size and a reachable fallback seat.
    expect(resourceBarFirstSeat({ left: 0, top: 0, width: 0, height: 0 }, null, 1)).toEqual({
      seat: { left: 320, top: 200 },
      width: SETTING_RANGES.playerFrameResourceWidth.def,
      height: SETTING_RANGES.playerFrameResourceHeight.def,
    });
  });

  it('uses the below-frame seat when a first live detach has real layout geometry', () => {
    const { wrap } = mountPlayerFrame();
    vi.spyOn(wrap, 'getBoundingClientRect').mockReturnValue(new DOMRect(120, 140, 232, 11));
    vi.spyOn(document.getElementById('player-frame')!, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(100, 100, 278, 60),
    );
    const store: Record<string, number | boolean> = { playerFrameResourceDetached: false };
    const { sync, writes } = rig(store);
    sync(true);
    store.playerFrameResourceDetached = true;
    sync();
    expect(JSON.parse(localStorage.getItem(SPEC.storageKey)!)).toMatchObject({
      left: 120,
      top: 166,
    });
    expect(wrap.style.top).toBe('166px');
    expect(writes).toEqual([
      ['playerFrameResourceWidth', 232],
      ['playerFrameResourceHeight', 11],
    ]);
  });

  it('keeps an existing saved seat and size when nonzero docked geometry differs', () => {
    const { wrap } = mountPlayerFrame();
    vi.spyOn(wrap, 'getBoundingClientRect').mockReturnValue(new DOMRect(120, 140, 232, 11));
    localStorage.setItem(SPEC.storageKey, JSON.stringify({ left: 410, top: 520 }));
    const store: Record<string, number | boolean> = {
      playerFrameResourceDetached: false,
      playerFrameResourceWidth: 300,
      playerFrameResourceHeight: 18,
    };
    const { sync, writes } = rig(store);
    sync(true);
    store.playerFrameResourceDetached = true;
    sync();
    expect(wrap.style.left).toBe('410px');
    expect(wrap.style.top).toBe('520px');
    expect(writes).toEqual([]);
    expect(store.playerFrameResourceWidth).toBe(300);
    expect(store.playerFrameResourceHeight).toBe(18);
  });

  it.each([false, true])(
    'shows the docked touch resource while preserving a hidden desktop seat (mobile boot: %s)',
    (mobileBoot) => {
      const { bars, wrap } = mountPlayerFrame();
      const saved = JSON.stringify({ left: 410, top: 520, vw: 1024, vh: 768 });
      localStorage.setItem(SPEC.storageKey, saved);
      localStorage.setItem(`${SPEC.storageKey}_hidden`, '1');
      let mobile = mobileBoot;
      const { registry, sync, writes } = rig({ playerFrameResourceDetached: true }, () => mobile);
      sync(true);
      const check = () => {
        expect(wrap.parentElement).toBe(mobile ? bars : document.getElementById('ui'));
        expect(wrap.classList.contains(FRAME_USER_HIDDEN_CLASS)).toBe(!mobile);
        expect(wrap.classList.contains('hud-frame-detached')).toBe(!mobile);
        expect(localStorage.getItem(`${SPEC.storageKey}_hidden`)).toBe('1');
        expect(localStorage.getItem(SPEC.storageKey)).toBe(saved);
        expect(writes).toEqual([]);
        if (mobile) {
          expect(wrap.style.left).toBe('');
          expect(wrap.style.top).toBe('');
        } else {
          expect(wrap.style.left).toBe('410px');
          expect(wrap.style.top).toBe('520px');
        }
      };
      check();
      // The same shared reapply path used on a viewport/layout change.
      mobile = !mobile;
      registry.reapplyAll();
      check();
      mobile = !mobile;
      registry.reapplyAll();
      check();
    },
  );

  it('styles the detached bar from its own settings and leaves it click-through while locked', () => {
    const css = readFileSync(join(import.meta.dirname, '..', 'src', 'styles', 'hud.css'), 'utf8');
    const rule = (selector: string) => {
      const at = css.indexOf(`${selector} {`);
      expect(at, `${selector} rule`).toBeGreaterThan(-1);
      return css.slice(at, css.indexOf('}', at));
    };
    expect(rule('#pf-resource-frame.hud-frame-detached')).toContain(
      'width: var(--player-resource-width',
    );
    const bar = rule('#pf-resource-frame.hud-frame-detached > .bar');
    expect(bar).toContain('height: var(--player-resource-height');
    expect(bar).toContain('--uf-bar-height: var(--player-resource-height');
    expect(rule('#pf-resource-frame.hud-frame-detached:not(.tf-unlocked)')).toContain(
      'pointer-events: none',
    );
  });

  it('comes back to the spot the player chose', () => {
    mountPlayerFrame();
    localStorage.setItem(SPEC.storageKey, JSON.stringify({ left: 410, top: 520 }));
    const { sync } = rig({ playerFrameResourceDetached: true });
    sync(true);
    const wrap = document.getElementById('pf-resource-frame')!;
    expect(wrap.parentElement!.id).toBe('ui');
    expect(wrap.style.left).toBe('410px');
    expect(wrap.style.top).toBe('520px');
  });

  it('drops a saved spot applied at boot while the option is off', () => {
    const { bars, wrap } = mountPlayerFrame();
    localStorage.setItem(SPEC.storageKey, JSON.stringify({ left: 410, top: 520 }));
    const { sync } = rig({ playerFrameResourceDetached: false });
    sync(true);
    expect(wrap.parentElement).toBe(bars);
    expect(wrap.style.left).toBe('');
  });

  it('a frames-menu hide belongs to the detached frame only: re-docking shows the bar', () => {
    const { wrap } = mountPlayerFrame();
    // Hidden from the frames menu in an earlier session (the mover's own flag).
    localStorage.setItem(`${SPEC.storageKey}_hidden`, '1');
    const store: Record<string, number | boolean> = { playerFrameResourceDetached: true };
    const { sync } = rig(store);
    sync(true);
    expect(wrap.classList.contains(FRAME_USER_HIDDEN_CLASS)).toBe(true);
    store.playerFrameResourceDetached = false;
    sync();
    expect(wrap.classList.contains(FRAME_USER_HIDDEN_CLASS)).toBe(false);
    expect(localStorage.getItem(`${SPEC.storageKey}_hidden`)).toBeNull();
  });

  it('sizes through its own two settings, one bar thick, at the slider bounds', () => {
    const store: Record<string, number | boolean> = {};
    const writes: Array<[string, number | boolean]> = [];
    const dims = additionalUnitDimensions('playerResource', () => ({
      settings: {
        get: (key) => store[key],
        set: (key, value) => {
          store[key] = value;
          return value;
        },
      },
      onSettingChange: (key, value) => writes.push([key, value]),
    }))!;
    expect(dims.width?.get()).toBe(SETTING_RANGES.playerFrameResourceWidth.def);
    expect(dims.height?.get()).toBe(SETTING_RANGES.playerFrameResourceHeight.def);
    expect([dims.width?.min, dims.width?.max]).toEqual([
      SETTING_RANGES.playerFrameResourceWidth.min,
      SETTING_RANGES.playerFrameResourceWidth.max,
    ]);
    // One unzoomed bar: a drag pixel is a setting pixel on both axes.
    expect(dims.width?.factor?.()).toBe(1);
    expect(dims.height?.factor?.()).toBe(1);
    dims.width?.set(300);
    expect(writes).toEqual([['playerFrameResourceWidth', 300]]);
  });

  it('publishes its size as root vars and opens its own options in the frame menu', () => {
    const vars: Record<string, string> = {};
    const style = {
      setProperty: (name: string, value: string) => {
        vars[name] = value;
      },
    };
    expect(applyFrameGeometrySetting(style, 'playerFrameResourceWidth', 300)).toBe(true);
    expect(applyFrameGeometrySetting(style, 'playerFrameResourceHeight', 18)).toBe(true);
    expect(vars).toEqual({
      '--player-resource-width': '300px',
      '--player-resource-height': '18px',
    });
    for (const key of [
      'playerFrameResourceDetached',
      'playerFrameResourceWidth',
      'playerFrameResourceHeight',
    ]) {
      expect(frameSettingRelated('playerResource', key)).toBe(true);
      // The player frame's own options carry the same rows.
      expect(frameSettingRelated('playerFrame', key)).toBe(true);
    }
    expect(frameSettingRelated('playerResource', 'playerFrameWidth')).toBe(false);
  });
});
