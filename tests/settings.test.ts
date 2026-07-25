import { beforeEach, describe, expect, it } from 'vitest';
import {
  clickMoveButtonLabel,
  normalizeClickMoveButton,
  perCharacterSettingKey,
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

  it('remembers the camera zoom distance across sessions, clamped to the zoom range (issue 1657)', () => {
    // Range mirrors Input.zoomBy's clamp so a persisted value is always applicable; def 12 is the
    // shipped starting distance.
    expect(SETTING_RANGES.cameraZoom).toEqual({ min: 3, max: 22, def: 12 });
    const s = new Settings();
    expect(s.get('cameraZoom')).toBe(12);
    expect(s.set('cameraZoom', 100)).toBe(22); // clamped to max
    expect(s.set('cameraZoom', 1)).toBe(3); // clamped to min
    expect(s.set('cameraZoom', 8)).toBe(8);
    // Persisted like every other setting: a fresh Settings (next session) reads the saved value.
    expect(new Settings().get('cameraZoom')).toBe(8);
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

  it('defaults the own nameplate on for a fresh player and preserves an existing off choice', () => {
    const fresh = new Settings();
    expect(fresh.get('showOwnNameplate')).toBe(true);

    fresh.set('showOwnNameplate', false);
    expect(new Settings().get('showOwnNameplate')).toBe(false);
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

  // Issue 2341: the Esc options menu's Graphics/Audio/Controller sub-views each
  // have a "Reset to Defaults" button, but they used to share the same no-arg
  // reset(), which wiped EVERY setting (all panels), not just the ones the
  // player was looking at. reset(keys) scopes the restore to only the keys
  // passed, so a sub-view can reset itself without touching the rest.
  it('reset(keys) restores only the given keys, leaving out-of-scope settings untouched', () => {
    const s = new Settings();
    // In-scope for this call: one numeric key and one bool key.
    s.set('sfxVolume', 0.1);
    s.set('voiceEnabled', false);
    // Out of scope: settings a different sub-view owns (graphics + interface).
    s.set('graphicsPreset', 4);
    s.set('uiScale', 1.3);
    s.set('reduceMotion', true);

    s.reset(['sfxVolume', 'voiceEnabled']);

    expect(s.get('sfxVolume')).toBe(SETTING_RANGES.sfxVolume.def);
    expect(s.get('voiceEnabled')).toBe(true); // BOOL_SETTINGS.voiceEnabled.def
    // Untouched: these custom values must survive a reset scoped elsewhere.
    expect(s.get('graphicsPreset')).toBe(4);
    expect(s.get('uiScale')).toBe(1.3);
    expect(s.get('reduceMotion')).toBe(true);

    // The scoped restore also persists, like the full reset does.
    expect(new Settings().get('sfxVolume')).toBe(SETTING_RANGES.sfxVolume.def);
    expect(new Settings().get('graphicsPreset')).toBe(4);
  });

  it('reset() with no arguments still does a full reset (other callers keep their behavior)', () => {
    const s = new Settings();
    s.set('sfxVolume', 0.1);
    s.set('graphicsPreset', 4);
    s.set('reduceMotion', true);
    s.reset();
    expect(s.get('sfxVolume')).toBe(SETTING_RANGES.sfxVolume.def);
    expect(s.get('graphicsPreset')).toBe(SETTING_RANGES.graphicsPreset.def);
    expect(s.get('reduceMotion')).toBe(false);
  });

  it('action button scale defaults to 1.0 and clamps to its slider bounds', () => {
    const s = new Settings();
    expect(s.get('actionButtonScale')).toBe(1);
    expect(s.set('actionButtonScale', 5)).toBe(SETTING_RANGES.actionButtonScale.max);
    expect(s.set('actionButtonScale', 0)).toBe(SETTING_RANGES.actionButtonScale.min);
    expect(s.set('actionButtonScale', 1.1)).toBe(1.1);
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
    expect(s.get('showSecondaryActionBar')).toBe(false);
    expect(s.get('showThirdActionBar')).toBe(false);
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

// The Attack button and attack-on-cast toggles are PER-CHARACTER: a mage that
// drops the Attack button and turns off attack-on-cast must not force those on a
// paladin. They keep the same keys/defs in BOOL_SETTINGS, but once a character
// context is bound (Settings.setCharacter, wired from startGame) they resolve to
// a per-character localStorage entry keyed by class+name like the action bar.
describe('per-character combat settings (Attack button / attack-on-cast)', () => {
  it('lets two characters hold independent values that persist across sessions', () => {
    const mage = new Settings();
    mage.setCharacter('mage', 'Gandalf');
    // The mage drops the Attack button and turns off attack-on-cast.
    mage.set('showAttackButton', false);
    mage.set('startAttackOnAbilityUse', false);
    expect(mage.get('showAttackButton')).toBe(false);
    expect(mage.get('startAttackOnAbilityUse')).toBe(false);

    // The paladin, bound on the same device, keeps the classic defaults and can
    // set its own value without disturbing the mage's.
    const paladin = new Settings();
    paladin.setCharacter('paladin', 'Uther');
    expect(paladin.get('showAttackButton')).toBe(true);
    expect(paladin.get('startAttackOnAbilityUse')).toBe(true);
    paladin.set('showAttackButton', true);

    // A fresh session for each reads back its OWN stored value.
    const mageAgain = new Settings();
    mageAgain.setCharacter('mage', 'Gandalf');
    expect(mageAgain.get('showAttackButton')).toBe(false);
    expect(mageAgain.get('startAttackOnAbilityUse')).toBe(false);

    const paladinAgain = new Settings();
    paladinAgain.setCharacter('paladin', 'Uther');
    expect(paladinAgain.get('showAttackButton')).toBe(true);
    expect(paladinAgain.get('startAttackOnAbilityUse')).toBe(true);
  });

  it('keys per-character storage by class+name and leaves the global blob out of it', () => {
    const s = new Settings();
    s.setCharacter('mage', 'Gandalf');
    s.set('showAttackButton', false);
    expect(
      localStorage.getItem(perCharacterSettingKey('showAttackButton', 'mage', 'Gandalf')),
    ).toBe('false');
    // Same-named characters of a different class do not collide.
    expect(
      localStorage.getItem(perCharacterSettingKey('showAttackButton', 'paladin', 'Gandalf')),
    ).toBeNull();
  });

  it('migrates the existing GLOBAL value into each character on first read (no visible change on upgrade)', () => {
    // A returning player had turned the Attack button OFF globally before the split.
    localStorage.setItem(
      'woc_settings',
      JSON.stringify({ showAttackButton: false, startAttackOnAbilityUse: false }),
    );

    // First time each character is bound with nothing stored yet, it inherits the
    // player's current global value, so their setup does not visibly change.
    const mage = new Settings();
    mage.setCharacter('mage', 'Gandalf');
    expect(mage.get('showAttackButton')).toBe(false);
    expect(mage.get('startAttackOnAbilityUse')).toBe(false);

    const paladin = new Settings();
    paladin.setCharacter('paladin', 'Uther');
    expect(paladin.get('showAttackButton')).toBe(false);
    expect(paladin.get('startAttackOnAbilityUse')).toBe(false);

    // After migration each character owns its value: flipping the paladin on does
    // not change the mage.
    paladin.set('showAttackButton', true);
    const mageAgain = new Settings();
    mageAgain.setCharacter('mage', 'Gandalf');
    expect(mageAgain.get('showAttackButton')).toBe(false);
  });

  it('does not leak one character onto a not-yet-migrated character via the global blob', () => {
    // The global seed starts at the defaults (on). The mage plays first, turns the
    // Attack button off, and also changes an unrelated GLOBAL setting (which calls
    // save()). That save must NOT rewrite the blob's showAttackButton to the mage's
    // off, or a paladin logging in later would wrongly inherit off.
    const mage = new Settings();
    mage.setCharacter('mage', 'Gandalf');
    mage.set('showAttackButton', false);
    mage.set('sfxVolume', 0.3); // unrelated global write -> save()

    const paladin = new Settings();
    paladin.setCharacter('paladin', 'Uther');
    expect(paladin.get('showAttackButton')).toBe(true); // still the original global seed
  });

  it('without a bound character, resolves to the global blob exactly as before', () => {
    const s = new Settings();
    expect(s.get('showAttackButton')).toBe(true);
    s.set('showAttackButton', false);
    // Stored on the global blob (no per-character context), read back by a fresh instance.
    expect(new Settings().get('showAttackButton')).toBe(false);
  });

  it("reset() restores the bound character's per-character keys to their defaults", () => {
    const mage = new Settings();
    mage.setCharacter('mage', 'Gandalf');
    mage.set('showAttackButton', false);
    mage.set('startAttackOnAbilityUse', false);
    mage.reset();
    expect(mage.get('showAttackButton')).toBe(true);
    expect(mage.get('startAttackOnAbilityUse')).toBe(true);
    // The restore persists for the next session too.
    const mageAgain = new Settings();
    mageAgain.setCharacter('mage', 'Gandalf');
    expect(mageAgain.get('showAttackButton')).toBe(true);
    expect(mageAgain.get('startAttackOnAbilityUse')).toBe(true);
  });

  it('scoped reset(keys) restores a per-character key on the bound character', () => {
    const mage = new Settings();
    mage.setCharacter('mage', 'Gandalf');
    mage.set('showAttackButton', false);
    mage.reset(['showAttackButton']);
    expect(mage.get('showAttackButton')).toBe(true);
    const next = new Settings();
    next.setCharacter('mage', 'Gandalf');
    expect(next.get('showAttackButton')).toBe(true);
  });
});
