import { beforeEach, describe, expect, it } from 'vitest';
import {
  clickMoveButtonLabel,
  normalizeClickMoveButton,
  SETTING_RANGES,
  Settings,
} from '../src/game/settings';

function installStorage(): void {
  const map = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
  };
}

beforeEach(() => installStorage());

describe('Settings', () => {
  it('defaults fresh sessions and initial logins to the medium graphics preset', () => {
    const s = new Settings();

    expect(localStorage.getItem('woc_settings')).toBeNull();
    // def is MEDIUM (the Reset target + the pre-probe value); first-run device detection in
    // main.ts persists a device-appropriate preset over it (see resolveDefaultGraphicsPreset).
    expect(SETTING_RANGES.graphicsPreset.def).toBe(2);
    expect(s.get('graphicsPreset')).toBe(2);
  });

  it('keeps graphicsDefaultApplied false through an unrelated save and clears it on reset', () => {
    const s = new Settings();
    expect(s.get('graphicsDefaultApplied')).toBe(false);
    // save() persists the whole values object; an unrelated write must NOT flip the marker
    // (that is what would silently defeat first-run device detection, since firstRunGraphicsPreset
    // gates on this marker and never on the def-filled graphicsPreset key).
    s.set('showFps', true);
    expect(new Settings().get('graphicsDefaultApplied')).toBe(false);
    // a conclusive detection sets it; reset() restores it to false so Reset re-detects.
    s.set('graphicsDefaultApplied', true);
    expect(new Settings().get('graphicsDefaultApplied')).toBe(true);
    s.reset();
    expect(s.get('graphicsDefaultApplied')).toBe(false);
  });

  it('starts at the documented defaults (camera calmer than the old 1.0)', () => {
    const s = new Settings();
    expect(s.get('cameraSpeed')).toBe(SETTING_RANGES.cameraSpeed.def);
    expect(s.get('cameraSpeed')).toBeLessThan(1); // addresses the "too fast" complaint
    expect(s.get('sfxVolume')).toBe(SETTING_RANGES.sfxVolume.def);
    expect(s.get('graphicsPreset')).toBe(SETTING_RANGES.graphicsPreset.def);
    expect(s.get('terrainDetail')).toBe(SETTING_RANGES.terrainDetail.def);
    expect(s.get('foliageDensity')).toBe(SETTING_RANGES.foliageDensity.def);
    expect(s.get('effectsQuality')).toBe(SETTING_RANGES.effectsQuality.def);
    expect(s.get('shadowQuality')).toBe(SETTING_RANGES.shadowQuality.def);
    expect(s.get('renderScale')).toBe(1);
    expect(s.get('fullscreen')).toBe(1);
    expect(s.get('clickToMove')).toBe(0);
    expect(s.get('clickToMoveButton')).toBe(0);
    expect(s.get('cameraFov')).toBe(SETTING_RANGES.cameraFov.def);
    expect(s.get('cameraFov')).toBe(60); // unchanged from the shipped look by default
    expect(s.get('mouseCamera')).toBe(false);
    // walk-by autoloot is opt-in: auto-grabbing loot by walking past can feel jarring.
    expect(s.get('walkByAutoloot')).toBe(false);
    // both unit frames ship at their stock size; the scale sliders are opt-in tuning.
    expect(s.get('playerFrameScale')).toBe(1);
    expect(s.get('targetFrameScale')).toBe(1);
    // the classic top-right aura corner stays the default; frame-anchoring is opt-in.
    expect(s.get('aurasOnPlayerFrame')).toBe(false);
    expect(s.get('joystickDeadzone')).toBe(SETTING_RANGES.joystickDeadzone.def);
    // Interface Mode defaults to Auto (0): detect desktop vs touch from the device.
    expect(s.get('interfaceMode')).toBe(SETTING_RANGES.interfaceMode.def);
    expect(s.get('interfaceMode')).toBe(0);
  });

  it('clamps the touch joystick deadzone to its bounds', () => {
    const s = new Settings();
    expect(s.set('joystickDeadzone', 99)).toBe(SETTING_RANGES.joystickDeadzone.max);
    expect(s.set('joystickDeadzone', 0)).toBe(SETTING_RANGES.joystickDeadzone.min);
  });

  it('clamps the camera FOV to its comfort range', () => {
    const s = new Settings();
    expect(s.set('cameraFov', 999)).toBe(SETTING_RANGES.cameraFov.max);
    expect(s.set('cameraFov', 0)).toBe(SETTING_RANGES.cameraFov.min);
    expect(s.set('cameraFov', 75)).toBe(75);
  });

  it('clamps out-of-range values to the slider bounds', () => {
    const s = new Settings();
    expect(s.set('cameraSpeed', 99)).toBe(SETTING_RANGES.cameraSpeed.max);
    expect(s.set('cameraSpeed', -5)).toBe(SETTING_RANGES.cameraSpeed.min);
    expect(s.set('sfxVolume', 0.5)).toBe(0.5);
    expect(s.set('graphicsPreset', 99)).toBe(SETTING_RANGES.graphicsPreset.max);
    expect(s.set('terrainDetail', -1)).toBe(SETTING_RANGES.terrainDetail.min);
    expect(s.set('foliageDensity', -1)).toBe(SETTING_RANGES.foliageDensity.min);
    expect(s.set('effectsQuality', 99)).toBe(SETTING_RANGES.effectsQuality.max);
    expect(s.set('shadowQuality', -1)).toBe(SETTING_RANGES.shadowQuality.min);
    expect(s.set('fullscreen', -1)).toBe(0);
    // Interface Mode (0 Auto, 1 Desktop, 2 Touch) clamps to its 0..2 bounds.
    expect(s.set('interfaceMode', 99)).toBe(SETTING_RANGES.interfaceMode.max);
    expect(s.set('interfaceMode', -1)).toBe(SETTING_RANGES.interfaceMode.min);
    expect(s.set('interfaceMode', 1)).toBe(1);
  });

  it('clamps touch opacity to its 0.3–1.0 bounds and defaults to fully opaque', () => {
    const s = new Settings();
    expect(s.get('touchOpacity')).toBe(SETTING_RANGES.touchOpacity.def);
    expect(s.set('touchOpacity', 5)).toBe(SETTING_RANGES.touchOpacity.max);
    expect(s.set('touchOpacity', 0)).toBe(SETTING_RANGES.touchOpacity.min);
    expect(s.set('touchOpacity', 0.6)).toBe(0.6);
  });

  it('defaults the joystick size to stock and clamps to its 0.7–1.3 range', () => {
    const s = new Settings();
    expect(s.get('joystickScale')).toBe(1);
    expect(s.set('joystickScale', 5)).toBe(SETTING_RANGES.joystickScale.max);
    expect(s.set('joystickScale', 0)).toBe(SETTING_RANGES.joystickScale.min);
    expect(s.set('joystickScale', 1.15)).toBe(1.15);
    const reloaded = new Settings();
    expect(reloaded.get('joystickScale')).toBe(1.15); // persisted
  });

  it('ignores non-finite input, keeping a valid value', () => {
    const s = new Settings();
    s.set('brightness', NaN);
    expect(Number.isFinite(s.get('brightness'))).toBe(true);
  });

  it('persists across instances', () => {
    const a = new Settings();
    a.set('cameraSpeed', 0.4);
    a.set('musicVolume', 0.2);
    a.set('fullscreen', 0);
    const b = new Settings();
    expect(b.get('cameraSpeed')).toBe(0.4);
    expect(b.get('musicVolume')).toBe(0.2);
    expect(b.get('fullscreen')).toBe(0);
  });

  it('persists boolean settings across instances', () => {
    const a = new Settings();
    a.set('mouseCamera', true);
    const b = new Settings();
    expect(b.get('mouseCamera')).toBe(true);
  });

  it('defaults left-handed touch off and persists it across instances', () => {
    const a = new Settings();
    expect(a.get('leftHandedTouch')).toBe(false);
    a.set('leftHandedTouch', true);
    const b = new Settings();
    expect(b.get('leftHandedTouch')).toBe(true);
  });

  it('defaults the mobile camera joystick off and persists enabling it across instances', () => {
    const a = new Settings();
    expect(a.get('mobileCameraJoystick')).toBe(false);
    a.set('mobileCameraJoystick', true);
    const b = new Settings();
    expect(b.get('mobileCameraJoystick')).toBe(true);
  });

  it('defaults footstep sounds off and persists re-enabling across instances', () => {
    const a = new Settings();
    expect(a.get('footstepSfx')).toBe(false);
    a.set('footstepSfx', true);
    const b = new Settings();
    expect(b.get('footstepSfx')).toBe(true);
  });

  it('defaults touch look speed to 1x, clamps, and persists', () => {
    const a = new Settings();
    expect(a.get('touchLookSpeed')).toBe(SETTING_RANGES.touchLookSpeed.def);
    expect(a.set('touchLookSpeed', 99)).toBe(SETTING_RANGES.touchLookSpeed.max);
    expect(a.set('touchLookSpeed', -5)).toBe(SETTING_RANGES.touchLookSpeed.min);
    a.set('touchLookSpeed', 1.5);
    const b = new Settings();
    expect(b.get('touchLookSpeed')).toBe(1.5);
  });

  it('falls back to defaults for missing/corrupt keys', () => {
    localStorage.setItem('woc_settings', JSON.stringify({ cameraSpeed: 0.5 }));
    const s = new Settings();
    expect(s.get('cameraSpeed')).toBe(0.5);
    expect(s.get('brightness')).toBe(SETTING_RANGES.brightness.def); // missing -> default
    expect(s.get('fullscreen')).toBe(SETTING_RANGES.fullscreen.def);
  });

  it('reset() restores every default', () => {
    const s = new Settings();
    s.set('cameraSpeed', 1.2);
    s.set('renderScale', 0.5);
    s.set('graphicsPreset', 4);
    s.set('terrainDetail', 0);
    s.set('foliageDensity', 0);
    s.set('effectsQuality', 0);
    s.set('shadowQuality', 0);
    s.set('fullscreen', 0);
    s.set('mouseCamera', true);
    s.set('mobileCameraJoystick', true);
    s.reset();
    expect(s.get('cameraSpeed')).toBe(SETTING_RANGES.cameraSpeed.def);
    expect(s.get('renderScale')).toBe(SETTING_RANGES.renderScale.def);
    expect(s.get('graphicsPreset')).toBe(SETTING_RANGES.graphicsPreset.def);
    expect(s.get('terrainDetail')).toBe(SETTING_RANGES.terrainDetail.def);
    expect(s.get('foliageDensity')).toBe(SETTING_RANGES.foliageDensity.def);
    expect(s.get('effectsQuality')).toBe(SETTING_RANGES.effectsQuality.def);
    expect(s.get('shadowQuality')).toBe(SETTING_RANGES.shadowQuality.def);
    expect(s.get('fullscreen')).toBe(SETTING_RANGES.fullscreen.def);
    expect(s.get('clickToMoveButton')).toBe(SETTING_RANGES.clickToMoveButton.def);
    expect(s.get('mouseCamera')).toBe(false);
    expect(s.get('mobileCameraJoystick')).toBe(false);
  });

  it('action button scale defaults to 1.0 and clamps to its slider bounds', () => {
    const s = new Settings();
    expect(s.get('actionButtonScale')).toBe(1);
    expect(s.set('actionButtonScale', 5)).toBe(SETTING_RANGES.actionButtonScale.max);
    expect(s.set('actionButtonScale', 0)).toBe(SETTING_RANGES.actionButtonScale.min);
    expect(s.set('actionButtonScale', 1.1)).toBe(1.1);
  });

  it('action button scale spans the widened 25 to 200 percent band (default 100%)', () => {
    // Live user feedback (PR #1736): the old 0.8-1.3 band was too narrow. The
    // spell/action button size must reach 200% with a 100% default. The lower
    // edge is a 25% floor, not 0: a 0 scale collapsed the whole button cluster
    // to nothing and soft-locked the player, so 25% is the smallest usable size.
    // def stays 1 so no stored value migrates when the band widens.
    expect(SETTING_RANGES.actionButtonScale).toEqual({ min: 0.25, max: 2, def: 1 });
    const s = new Settings();
    // The new extremes are reachable and clamp exactly at the widened edges.
    expect(s.set('actionButtonScale', 0.25)).toBe(0.25);
    expect(s.set('actionButtonScale', 2)).toBe(2);
    expect(s.set('actionButtonScale', 3)).toBe(2); // above-max clamps down to 2
    expect(s.set('actionButtonScale', 0)).toBe(0.25); // below-floor clamps up to 25%
    expect(s.set('actionButtonScale', -1)).toBe(0.25); // below-min clamps up to the floor
    expect(s.set('actionButtonScale', 0.5)).toBe(0.5); // a mid-band 50% value survives
  });

  it('widening action button scale does not migrate a value stored under the old band', () => {
    // A value a player saved under the old {min:0.8,max:1.3} band stays
    // byte-identical under the widened band: the load clamp only widens the
    // allowed interval, so a stored value already inside it is never re-clamped.
    localStorage.setItem('woc_settings', JSON.stringify({ actionButtonScale: 1.25 }));
    expect(new Settings().get('actionButtonScale')).toBe(1.25);
    localStorage.setItem('woc_settings', JSON.stringify({ actionButtonScale: 0.8 }));
    expect(new Settings().get('actionButtonScale')).toBe(0.8);
  });

  it('all() returns an independent snapshot', () => {
    const s = new Settings();
    const snap = s.all();
    snap.cameraSpeed = 99;
    expect(s.get('cameraSpeed')).not.toBe(99);
  });
});

describe('Interface & Comfort settings pack', () => {
  it('defaults to the unchanged classic look (all scales 1.0, toggles off)', () => {
    const s = new Settings();
    expect(s.get('hudOpacity')).toBe(1);
    expect(s.get('tooltipScale')).toBe(1);
    expect(s.get('fctScale')).toBe(1);
    expect(s.get('chatFontScale')).toBe(1);
    expect(s.get('chatOpacity')).toBe(1);
    expect(s.get('reduceMotion')).toBe(false);
    expect(s.get('highContrastText')).toBe(false);
    expect(s.get('frostedPanels')).toBe(false);
    expect(s.get('compactChat')).toBe(false);
    expect(s.get('showFps')).toBe(false);
    expect(s.get('showWalletOnCharacterScreen')).toBe(true);
    expect(s.get('showWalletOnPlayerCard')).toBe(true);
    expect(s.get('showDevBadges')).toBe(true);
    expect(s.get('showDailyRewardsChest')).toBe(true);
    expect(s.get('invertLookY')).toBe(false);
  });

  it('clamps the comfort sliders to their documented bounds', () => {
    const s = new Settings();
    expect(s.set('hudOpacity', 0)).toBe(SETTING_RANGES.hudOpacity.min);
    expect(s.set('hudOpacity', 9)).toBe(SETTING_RANGES.hudOpacity.max);
    expect(s.set('tooltipScale', 9)).toBe(SETTING_RANGES.tooltipScale.max);
    expect(s.set('fctScale', 0)).toBe(SETTING_RANGES.fctScale.min);
    expect(s.set('chatFontScale', 1.2)).toBe(1.2);
    expect(s.set('chatOpacity', 0)).toBe(SETTING_RANGES.chatOpacity.min);
  });

  it('persists the comfort toggles across reloads and restores them on reset', () => {
    const s = new Settings();
    s.set('reduceMotion', true);
    s.set('showFps', true);
    s.set('invertLookY', true);
    s.set('frostedPanels', true);
    s.set('showWalletOnCharacterScreen', false);
    s.set('showWalletOnPlayerCard', false);
    s.set('showDevBadges', false);
    // a fresh instance reads the same backing store
    expect(new Settings().get('reduceMotion')).toBe(true);
    expect(new Settings().get('showFps')).toBe(true);
    expect(new Settings().get('showWalletOnCharacterScreen')).toBe(false);
    expect(new Settings().get('showWalletOnPlayerCard')).toBe(false);
    expect(new Settings().get('showDevBadges')).toBe(false);
    s.reset();
    expect(s.get('reduceMotion')).toBe(false);
    expect(s.get('showFps')).toBe(false);
    expect(s.get('showWalletOnCharacterScreen')).toBe(true);
    expect(s.get('showWalletOnPlayerCard')).toBe(true);
    expect(s.get('showDevBadges')).toBe(true);
    expect(s.get('invertLookY')).toBe(false);
    expect(s.get('frostedPanels')).toBe(false);
  });

  it('adds a global UI Scale (default 1, clamped to bounds) and a landing high-contrast toggle', () => {
    const s = new Settings();
    expect(s.get('uiScale')).toBe(1);
    expect(s.get('landingHighContrast')).toBe(false);
    expect(s.set('uiScale', 5)).toBe(SETTING_RANGES.uiScale.max);
    expect(s.set('uiScale', 0)).toBe(SETTING_RANGES.uiScale.min);
    s.set('landingHighContrast', true);
    expect(new Settings().get('landingHighContrast')).toBe(true);
    s.reset();
    expect(s.get('uiScale')).toBe(1);
    expect(s.get('landingHighContrast')).toBe(false);
  });
});

describe('click-to-move mouse button setting', () => {
  it('normalizes to left or right click labels', () => {
    expect(normalizeClickMoveButton(0)).toBe(0);
    expect(normalizeClickMoveButton(0.4)).toBe(0);
    expect(normalizeClickMoveButton(1)).toBe(2);
    expect(normalizeClickMoveButton(2)).toBe(2);
    expect(clickMoveButtonLabel(0)).toBe('Left Click');
    expect(clickMoveButtonLabel(2)).toBe('Right Click');
  });
});
