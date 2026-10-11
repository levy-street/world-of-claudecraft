// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import { SETTING_RANGES, Settings } from '../src/game/settings';
import { migratePetFrameSize } from '../src/ui/frame_dimensions';
import { FramePresets } from '../src/ui/frame_presets';
import { applySavedFrameLayout } from '../src/ui/frame_presets_live';
import type { FramesMenuSettingsHooks } from '../src/ui/interface_unlock_menu_core';
import { getUiScale } from '../src/ui/ui_scale';

beforeEach(() => localStorage.clear());
it('restores settings and live owners while preserving preset geometry through reanchoring', () => {
  const settings = new Settings();
  const presets = new FramePresets(localStorage);
  presets.save(2, 'Default');
  expect(presets.list()[2]?.settings.uiScale).toBe(1);
  settings.set('uiScale', 1.5);
  settings.set('combineTrackerFrames', false);
  localStorage.setItem('woc_party_frame_pos', '{"left":80,"top":40}');
  presets.save(0, 'Raid');
  settings.set('uiScale', 1);
  settings.set('combineTrackerFrames', true);
  localStorage.setItem('woc_party_frame_pos', '{"left":400,"top":20}');
  presets.save(1, 'Questing');
  const seen: string[] = [];
  let expectedScale = 1.5;
  let expectedGeometry = '{"left":80,"top":40}';
  const frames = {
    reapplyAll: vi.fn(),
    refreshSettings: vi.fn(),
    restoreSavedLayout: () => {
      expect(settings.get('uiScale')).toBe(expectedScale);
      expect(getUiScale()).toBe(expectedScale);
      expect(settings.get('combineTrackerFrames')).toBe(expectedScale === 1);
      expect(localStorage.getItem('woc_party_frame_pos')).toBe(expectedGeometry);
      expect(localStorage.getItem('woc_target_frame_pos')).toBeNull();
      seen.push('frames');
    },
  };
  const owners = {
    frames,
    chat: { reapply: vi.fn(), restoreSavedLayout: () => seen.push('chat') },
    meters: { reapplyFrames: vi.fn(), restoreSavedLayout: () => seen.push('meters') },
    auras: { reapplyFrame: vi.fn(), restoreSavedLayout: () => seen.push('auras') },
    settle: () => seen.push('settle'),
  };
  expect(presets.apply(0)).toBe(true);
  applySavedFrameLayout(
    {
      settings,
      onSettingChange: (key, value) => {
        if (key === 'uiScale')
          document.documentElement.style.setProperty('--ui-scale', String(value));
        localStorage.setItem('woc_party_frame_pos', 'intermediate');
        localStorage.setItem('woc_target_frame_pos', 'intermediate');
      },
    },
    true,
    owners,
  );
  expect(seen).toEqual(['frames', 'chat', 'meters', 'auras', 'settle']);
  expect(frames.refreshSettings).toHaveBeenCalledOnce();
  expect(frames.reapplyAll).not.toHaveBeenCalled();
  expectedScale = 1;
  expectedGeometry = '{"left":400,"top":20}';
  expect(presets.apply(1)).toBe(true);
  applySavedFrameLayout(
    {
      settings,
      onSettingChange: (key, value) => {
        if (key === 'uiScale')
          document.documentElement.style.setProperty('--ui-scale', String(value));
      },
    },
    true,
    owners,
  );
  expect(new Settings().get('uiScale')).toBe(1);
  document.documentElement.style.removeProperty('--ui-scale');
});

it('reclamps every owner on scale changes without replacing settings or saved geometry', () => {
  const settings = new Settings();
  settings.set('uiScale', 1.5);
  localStorage.setItem('woc_party_frame_pos', '{"left":80,"top":40}');
  const saved = localStorage.getItem('woc_party_frame_pos');
  const values = settings.all();
  const restore = vi.fn();
  const owners = {
    frames: { reapplyAll: vi.fn(), restoreSavedLayout: restore, refreshSettings: vi.fn() },
    chat: { reapply: vi.fn(), restoreSavedLayout: restore },
    meters: { reapplyFrames: vi.fn(), restoreSavedLayout: restore },
    auras: { reapplyFrame: vi.fn(), restoreSavedLayout: restore },
    settle: vi.fn(),
  };
  const onSettingChange = vi.fn();
  applySavedFrameLayout({ settings, onSettingChange }, false, owners);
  for (const reapply of [
    owners.frames.reapplyAll,
    owners.chat.reapply,
    owners.meters.reapplyFrames,
    owners.auras.reapplyFrame,
  ]) {
    expect(reapply).toHaveBeenCalledOnce();
  }
  expect(restore).not.toHaveBeenCalled();
  expect(owners.frames.refreshSettings).not.toHaveBeenCalled();
  expect(owners.settle).not.toHaveBeenCalled();
  expect(onSettingChange).not.toHaveBeenCalled();
  expect(settings.all()).toEqual(values);
  expect(localStorage.getItem('woc_party_frame_pos')).toBe(saved);
});

it('preserves legacy pet size until settings are ready, then migrates once without losing position', () => {
  const key = 'woc_hud_frame_pet';
  const saved = JSON.stringify({ left: 100, top: 120, scale: 1.2, scaleY: 1.5, vw: 1024, vh: 768 });
  localStorage.setItem(key, saved);
  migratePetFrameSize(localStorage, key, () => null);
  expect(localStorage.getItem(key)).toBe(saved);
  const settings = new Settings();
  const hooks = { settings, onSettingChange: () => {} } as unknown as FramesMenuSettingsHooks;
  migratePetFrameSize(localStorage, key, () => hooks);
  expect(settings.get('petFrameWidth')).toBe(SETTING_RANGES.petFrameWidth.def * 1.2);
  expect(settings.get('petFrameHeight')).toBe(SETTING_RANGES.petFrameHeight.def * 1.5);
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual({
    left: 100,
    top: 120,
    vw: 1024,
    vh: 768,
  });
  settings.set('petFrameWidth', 300);
  migratePetFrameSize(localStorage, key, () => hooks);
  expect(settings.get('petFrameWidth')).toBe(300);
});
