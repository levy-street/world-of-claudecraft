import { describe, expect, it } from 'vitest';
import { SETTING_RANGES } from '../src/game/settings';
import {
  boolToggleNextValue,
  buildAudioControls,
  buildBugReportInfo,
  buildControllerControls,
  buildGraphicsControls,
  buildInterfaceControls,
  buildOptionsMenu,
  INTERFACE_TAB_LABEL_KEY,
  INTERFACE_TAB_ORDER,
  type InterfaceTab,
  interfaceControlsForTab,
  type OptionsControl,
  type OptionsSettingsSource,
  sliderDispatchValue,
  toggleIsOn,
  toggleNextValue,
} from '../src/ui/options_view';

// A fake settings projection over plain records, with the real numeric ranges so
// slider descriptors carry the true min/max. The painter builds the same shape
// from the live Settings store.
function makeSource(
  num: Record<string, number> = {},
  bool: Record<string, boolean> = {},
): OptionsSettingsSource {
  return {
    num: (k) => num[k] ?? 0,
    bool: (k) => bool[k] ?? false,
    range: (k) => {
      const r = (SETTING_RANGES as Record<string, { min: number; max: number }>)[k];
      return r ? { min: r.min, max: r.max } : { min: 0, max: 1 };
    },
  };
}

// Render-order signature for a control list: a slider/toggle/boolToggle/choice
// shows as its setting key, a note as note:<key>, the music toggle as musicToggle.
function keysOf(controls: OptionsControl[]): string[] {
  return controls.map((c) => {
    if (c.control === 'note') return `note:${c.textKey}`;
    if (c.control === 'musicToggle') return 'musicToggle';
    return c.key;
  });
}

function find(controls: OptionsControl[], key: string): OptionsControl | undefined {
  return controls.find((c) => c.control !== 'note' && c.control !== 'musicToggle' && c.key === key);
}

// ---------------------------------------------------------------------------
// Cluster 1: the four control primitives + their dispatch-value coercion
// ---------------------------------------------------------------------------
describe('options_view: control primitive dispatch (cluster 1)', () => {
  it('settingSlider dispatches the raw input value coerced to a Number', () => {
    expect(sliderDispatchValue('0.35')).toBe(0.35);
    expect(sliderDispatchValue('60')).toBe(60);
    // identical coercion regardless of formatting kind
    expect(sliderDispatchValue('1')).toBe(1);
  });

  it('settingToggle flips 0<->1 off the stored value and reads on at >=0.5', () => {
    expect(toggleNextValue(0)).toBe(1);
    expect(toggleNextValue(1)).toBe(0);
    expect(toggleNextValue(0.6)).toBe(0);
    expect(toggleNextValue(0.4)).toBe(1);
    expect(toggleIsOn(0.5)).toBe(true);
    expect(toggleIsOn(0.49)).toBe(false);
    expect(toggleIsOn(0)).toBe(false);
  });

  it('settingBoolToggle flips the stored boolean', () => {
    expect(boolToggleNextValue(true)).toBe(false);
    expect(boolToggleNextValue(false)).toBe(true);
  });

  it('a slider descriptor carries the live value, range, step and format', () => {
    const controls = buildGraphicsControls(makeSource({ cameraSpeed: 0.9, cameraFov: 75 }), {
      touch: false,
      nativeShell: false,
    });
    const cam = find(controls, 'cameraSpeed');
    expect(cam).toMatchObject({ control: 'slider', value: 0.9, step: 0.05, fmt: 'percent' });
    expect(cam).toMatchObject({
      min: SETTING_RANGES.cameraSpeed.min,
      max: SETTING_RANGES.cameraSpeed.max,
    });
    const fov = find(controls, 'cameraFov');
    expect(fov).toMatchObject({ control: 'slider', value: 75, step: 1, fmt: 'degrees' });
  });
});

// ---------------------------------------------------------------------------
// Cluster 3: graphics. Static preset read as a plain value; advanced/touch/
// native-shell gating preserved; the preset + interfaceMode choices re-render.
// ---------------------------------------------------------------------------
describe('options_view: graphics dispatch matrix (cluster 3)', () => {
  it('lists the base desktop controls in order, no advanced sub-pickers', () => {
    const controls = buildGraphicsControls(makeSource({ graphicsPreset: 4 }), {
      touch: false,
      nativeShell: false,
    });
    expect(keysOf(controls)).toEqual([
      'graphicsPreset',
      'browserEffects',
      'note:hudChrome.options.browserEffectsNote',
      'interfaceMode',
      'note:hudChrome.options.interfaceModeNote',
      'cameraSpeed',
      'brightness',
      'cameraFov',
      'renderScale',
      'fullscreen',
      'showOverflowXp',
      'weather',
    ]);
  });

  it('the graphics preset picker is an enumerated choice [1..5] that re-renders', () => {
    const controls = buildGraphicsControls(makeSource({ graphicsPreset: 3 }), {
      touch: false,
      nativeShell: false,
    });
    const preset = find(controls, 'graphicsPreset');
    expect(preset).toMatchObject({ control: 'choice', current: 3, rerender: true });
    if (preset?.control === 'choice')
      expect(preset.options.map((o) => o.value)).toEqual([1, 2, 3, 4, 5]);
  });

  it('reveals the four advanced sub-pickers only at preset 5', () => {
    const advanced = buildGraphicsControls(makeSource({ graphicsPreset: 5 }), {
      touch: false,
      nativeShell: false,
    });
    expect(keysOf(advanced).slice(0, 5)).toEqual([
      'graphicsPreset',
      'terrainDetail',
      'foliageDensity',
      'effectsQuality',
      'shadowQuality',
    ]);
    // each advanced sub-picker is a low/high choice that does NOT re-render
    const terrain = find(advanced, 'terrainDetail');
    expect(terrain).toMatchObject({ control: 'choice', rerender: false });
    if (terrain?.control === 'choice') expect(terrain.options.map((o) => o.value)).toEqual([0, 1]);
  });

  it('the interfaceMode choice re-renders; browserEffects does not', () => {
    const controls = buildGraphicsControls(makeSource(), { touch: false, nativeShell: false });
    expect(find(controls, 'interfaceMode')).toMatchObject({ control: 'choice', rerender: true });
    expect(find(controls, 'browserEffects')).toMatchObject({ control: 'choice', rerender: false });
  });

  it('hides Interface Mode + its note in the native app shell', () => {
    const controls = buildGraphicsControls(makeSource(), { touch: false, nativeShell: true });
    expect(find(controls, 'interfaceMode')).toBeUndefined();
    expect(keysOf(controls)).not.toContain('note:hudChrome.options.interfaceModeNote');
  });

  it('caps native graphics presets at High for the native app shell', () => {
    const controls = buildGraphicsControls(makeSource({ graphicsPreset: 3 }), {
      touch: true,
      nativeShell: true,
    });
    const preset = find(controls, 'graphicsPreset');
    expect(preset).toMatchObject({ control: 'choice', current: 3, rerender: true });
    if (preset?.control === 'choice') expect(preset.options.map((o) => o.value)).toEqual([1, 2, 3]);
  });

  it('reveals the touch-only sliders only on a touch interface, in order', () => {
    const controls = buildGraphicsControls(makeSource({ graphicsPreset: 4 }), {
      touch: true,
      nativeShell: false,
    });
    const keys = keysOf(controls);
    expect(keys).toContain('touchLookSpeed');
    expect(keys).toContain('touchOpacity');
    expect(keys).toContain('joystickScale');
    expect(keys).toContain('actionButtonScale');
    expect(keys).toContain('joystickDeadzone');
    expect(keys).toContain('touchInvertLook');
    expect(keys).toContain('mobileCameraJoystick');
    expect(keys).toContain('leftHandedTouch');
    // touchLookSpeed sits right after cameraSpeed
    expect(keys[keys.indexOf('cameraSpeed') + 1]).toBe('touchLookSpeed');
    // mobileCameraJoystick and leftHandedTouch are the last two touch-only rows,
    // right after touchInvertLook, in that order.
    const touchInvertIdx = keys.indexOf('touchInvertLook');
    expect(keys[touchInvertIdx + 1]).toBe('mobileCameraJoystick');
    expect(keys[touchInvertIdx + 2]).toBe('leftHandedTouch');
  });

  it('hides mobileCameraJoystick and leftHandedTouch on a desktop interface', () => {
    const controls = buildGraphicsControls(makeSource({ graphicsPreset: 4 }), {
      touch: false,
      nativeShell: false,
    });
    const keys = keysOf(controls);
    expect(keys).not.toContain('mobileCameraJoystick');
    expect(keys).not.toContain('leftHandedTouch');
  });

  it('gives mobileCameraJoystick and leftHandedTouch their correct i18n keys', () => {
    const controls = buildGraphicsControls(makeSource({ graphicsPreset: 4 }), {
      touch: true,
      nativeShell: false,
    });
    expect(find(controls, 'mobileCameraJoystick')).toMatchObject({
      control: 'boolToggle',
      labelKey: 'hudChrome.options.mobileCameraJoystick',
    });
    expect(find(controls, 'leftHandedTouch')).toMatchObject({
      control: 'boolToggle',
      labelKey: 'hudChrome.options.mobileLeftHanded',
    });
  });
});

// ---------------------------------------------------------------------------
// Cluster 4: audio
// ---------------------------------------------------------------------------
describe('options_view: audio dispatch matrix (cluster 4)', () => {
  it('lists three volume sliders, the bespoke music toggle, then the audio bool toggles', () => {
    const controls = buildAudioControls(makeSource());
    expect(keysOf(controls)).toEqual([
      'sfxVolume',
      'musicVolume',
      'voiceVolume',
      'musicToggle',
      'voiceEnabled',
      'footstepSfx',
      'interfaceSfx',
      'clickFeedback',
    ]);
    expect(find(controls, 'sfxVolume')).toMatchObject({ control: 'slider' });
    expect(find(controls, 'voiceEnabled')).toMatchObject({ control: 'boolToggle' });
  });
});

// ---------------------------------------------------------------------------
// Cluster 5: controller + the remaining interface toggles
// ---------------------------------------------------------------------------
describe('options_view: controller dispatch matrix (cluster 5)', () => {
  it('lists the enable/invert toggles then the three controller sliders', () => {
    const controls = buildControllerControls(makeSource());
    expect(keysOf(controls)).toEqual([
      'gamepadEnabled',
      'gamepadInvertY',
      'gamepadStickDeadzone',
      'gamepadCameraSpeed',
      'gamepadVibration',
    ]);
    expect(find(controls, 'gamepadEnabled')).toMatchObject({ control: 'boolToggle' });
    // camera speed renders with a one-decimal readout, not a percent
    expect(find(controls, 'gamepadCameraSpeed')).toMatchObject({
      control: 'slider',
      fmt: 'oneDecimal',
    });
  });
});

// The declarative interface controls, grouped by tab in their painted order.
// interfaceControlsForTab(all, tab) must return exactly these, in order; the
// concatenation (in INTERFACE_TAB_ORDER) is the whole deduped list.
const GENERAL_KEYS = [
  'uiScale',
  'hudOpacity',
  'tooltipScale',
  'frostedPanels',
  'highContrastText',
  'reduceMotion',
  'invertLookY',
  'landingHighContrast',
  'showDevBadges',
  'showWalletOnCharacterScreen',
  'showWalletOnPlayerCard',
  'showDailyRewardsChest',
  'showItemLevel',
  'showOwnNameplate',
];
const FRAMES_KEYS = [
  'playerFrameScale',
  'targetFrameScale',
  'partyFrameStyle',
  'partyFrameScale',
  'partyFrameWidth',
  'partyFrameHeight',
  'partyFrameSpacing',
  'partyFrameColumns',
  'partyFrameHealthText',
  'partyFrameSort',
  'partyFrameShowResource',
  'partyFrameShowAbsorbs',
  'partyFrameShowAuras',
  'partyFrameShowSelf',
  'aurasOnPlayerFrame',
  'showTargetOfTarget',
];
const CHAT_KEYS = ['chatFontScale', 'chatOpacity', 'compactChat'];
const COMBAT_KEYS = [
  'startAttackOnAbilityUse',
  'showAttackButton',
  'walkByAutoloot',
  'groundReticle',
  'mouseoverCast',
  'fctScale',
  'showSecondaryActionBar',
  'showThirdActionBar',
];
const INTERFACE_KEYS_BY_TAB: Record<InterfaceTab, string[]> = {
  general: GENERAL_KEYS,
  frames: FRAMES_KEYS,
  chat: CHAT_KEYS,
  combat: COMBAT_KEYS,
};

describe('options_view: interface dispatch matrix (cluster 5)', () => {
  it('lists the four tabs concatenated in order (deduped, partyFrames note dropped)', () => {
    const controls = buildInterfaceControls(makeSource());
    expect(keysOf(controls)).toEqual([
      ...GENERAL_KEYS,
      ...FRAMES_KEYS,
      ...CHAT_KEYS,
      ...COMBAT_KEYS,
    ]);
    // the redundant partyFrames.section note is gone now that Frames is its own tab
    expect(keysOf(controls)).not.toContain('note:hudChrome.partyFrames.section');
    expect(find(controls, 'partyFrameStyle')).toMatchObject({
      control: 'choice',
      options: [
        { value: 0, labelKey: 'hudChrome.partyFrames.styleAutomatic' },
        { value: 1, labelKey: 'hudChrome.partyFrames.styleClassic' },
        { value: 2, labelKey: 'hudChrome.partyFrames.styleRaid' },
      ],
    });
    expect(find(controls, 'reduceMotion')).toMatchObject({ control: 'boolToggle' });
  });

  it('enables the third action-bar toggle only while the secondary row is visible', () => {
    const hidden = buildInterfaceControls(makeSource());
    expect(find(hidden, 'showSecondaryActionBar')).toMatchObject({
      control: 'boolToggle',
      rerender: true,
    });
    expect(find(hidden, 'showThirdActionBar')).toMatchObject({
      control: 'boolToggle',
      disabled: true,
    });

    const visible = buildInterfaceControls(makeSource({}, { showSecondaryActionBar: true }));
    expect(find(visible, 'showThirdActionBar')).toMatchObject({ disabled: false });
  });

  it('marks only uiScale as commit-on-release; the other comfort sliders stay live (#1558)', () => {
    const controls = buildInterfaceControls(makeSource());
    // uiScale rescales the whole UI (window included), so it must apply on release.
    expect(find(controls, 'uiScale')).toMatchObject({ control: 'slider', commitOnChange: true });
    // Sibling sliders keep their live preview (no commitOnChange flag).
    expect(find(controls, 'playerFrameScale')).not.toHaveProperty('commitOnChange');
    expect(find(controls, 'tooltipScale')).not.toHaveProperty('commitOnChange');
    expect(find(controls, 'fctScale')).not.toHaveProperty('commitOnChange');
  });
});

// ---------------------------------------------------------------------------
// Interface tab taxonomy (the four-tab split): every control has exactly one
// category, the union of the tabs is the whole list with no duplicates, and each
// tab filters to its mapped controls in order. The no-duplicate assertion is what
// catches the historical showAttackButton dupe (and any future control added
// without a category, which would land uncategorized / drop out of the union).
// ---------------------------------------------------------------------------
describe('options_view: interface tab taxonomy', () => {
  it('declares the four tabs, in strip order, each with a label key', () => {
    expect([...INTERFACE_TAB_ORDER]).toEqual(['general', 'frames', 'chat', 'combat']);
    for (const tab of INTERFACE_TAB_ORDER) {
      expect(INTERFACE_TAB_LABEL_KEY[tab]).toBe(`hudChrome.interfaceTabs.${tab}`);
    }
  });

  it('assigns every interface control to exactly one of the four tabs', () => {
    const all = buildInterfaceControls(makeSource());
    for (const c of all) {
      // an uncategorized control (someone added a setting without a category)
      // fails here: undefined is not one of the four tabs
      expect(INTERFACE_TAB_ORDER).toContain(c.category);
    }
  });

  it('partitions the full list: the union of the tabs equals it, with NO duplicate keys', () => {
    const all = buildInterfaceControls(makeSource());
    const union = INTERFACE_TAB_ORDER.flatMap((tab) => interfaceControlsForTab(all, tab));
    // every control lands in exactly one tab: the union is the same objects, same size
    expect(union).toHaveLength(all.length);
    expect(new Set(union)).toEqual(new Set(all));
    // no setting key appears twice across the whole interface list. This is RED
    // while the showAttackButton duplicate is present and GREEN once deduped.
    // (the interface list is all keyed controls: no notes / music toggle here)
    const keys = all.map((c) => ('key' in c ? c.key : ''));
    expect(keys).not.toContain('');
    expect(new Set(keys).size).toBe(keys.length);
    // showAttackButton in particular resolves to a single combat-tab control
    expect(all.filter((c) => 'key' in c && c.key === 'showAttackButton')).toHaveLength(1);
    expect(find(all, 'showAttackButton')?.category).toBe('combat');
  });

  it('filters each tab to its mapped controls, in order', () => {
    const all = buildInterfaceControls(makeSource());
    for (const tab of INTERFACE_TAB_ORDER) {
      expect(keysOf(interfaceControlsForTab(all, tab))).toEqual(INTERFACE_KEYS_BY_TAB[tab]);
    }
  });

  it('keeps the dependent action-bar toggles together in the combat tab', () => {
    // showThirdActionBar's disabled state depends on showSecondaryActionBar, so
    // both must sit in the same tab or the dependency would span a tab boundary.
    const all = buildInterfaceControls(makeSource());
    expect(find(all, 'showSecondaryActionBar')?.category).toBe('combat');
    expect(find(all, 'showThirdActionBar')?.category).toBe('combat');
  });
});

// ---------------------------------------------------------------------------
// Main menu routing (cluster 5)
// ---------------------------------------------------------------------------
describe('options_view: main menu routing', () => {
  it('routes each row to its sub-view, with logout + close, omitting bug report offline', () => {
    const offline = buildOptionsMenu({ bugReportAvailable: false });
    expect(offline.map((e) => e.labelKey)).toEqual([
      'hud.options.keyBindings',
      'hudChrome.controller.title',
      'hud.options.graphics',
      'hud.options.interface',
      'hud.options.audio',
      'hudChrome.perf.title',
      'hud.options.logout',
      'hud.options.returnToGame',
    ]);
    expect(offline.at(-2)?.action).toEqual({ kind: 'logout' });
    expect(offline.at(-1)?.action).toEqual({ kind: 'close' });
    // exactly one interface entry (no duplicates), routing to the interface view
    const interfaceRows = offline.filter((e) => e.labelKey === 'hud.options.interface');
    expect(interfaceRows).toHaveLength(1);
    expect(interfaceRows[0].action).toEqual({ kind: 'goto', view: 'interface' });
  });

  it('adds the online-only Report a Bug row when bug reporting is available', () => {
    const online = buildOptionsMenu({ bugReportAvailable: true });
    const bug = online.find((e) => e.labelKey === 'hudChrome.bugReport.menuButton');
    expect(bug?.action).toEqual({ kind: 'goto', view: 'bugreport' });
  });
});

// ---------------------------------------------------------------------------
// Cluster 2: bug report. The ONE IWorld slice the window reads, so it is the
// ClientWorld-vs-Sim parity surface.
// ---------------------------------------------------------------------------
describe('options_view: bug report info (cluster 2)', () => {
  it('derives realm/character/coords; unknown realm flagged when blank', () => {
    const info = buildBugReportInfo('Stormrend', {
      name: 'Tharos',
      pos: { x: 12.6, y: -3.1, z: 88.9 },
    });
    expect(info).toEqual({
      realmKnown: true,
      realm: 'Stormrend',
      characterName: 'Tharos',
      pos: { x: 12.6, y: -3.1, z: 88.9 },
    });
    const offline = buildBugReportInfo('', { name: 'Tharos', pos: { x: 0, y: 0, z: 0 } });
    expect(offline.realmKnown).toBe(false);
    expect(offline.realm).toBe('');
    const nullRealm = buildBugReportInfo(null, { name: 'Tharos', pos: { x: 0, y: 0, z: 0 } });
    expect(nullRealm.realmKnown).toBe(false);
  });

  it('derives the documented info from BOTH a Sim shape and a ClientWorld-mirror shape (parity)', () => {
    // Two GENUINELY different world shapes, not a self-clone: the offline Sim hands
    // the window a live player Entity (a prototyped instance carrying extra offline
    // fields the window must ignore) and an empty realm string (IWorld.realm is ''
    // in offline play); the online ClientWorld hands it a plain wire-mirrored object
    // and a populated realm. The slice the window reads (name + pos) must come out
    // identical from both, so an offline-only field shape can't silently misrender
    // online; only realm (a documented online/offline difference) differs.
    const simPlayer = Object.assign(Object.create({ speed: 7 }), {
      name: 'Tharos',
      pos: { x: 5.5, y: 2.25, z: -7.75 },
      hp: 120, // offline-only field the bug-report slice must not read
    });
    const simInfo = buildBugReportInfo('', simPlayer);
    expect(simInfo).toEqual({
      realmKnown: false,
      realm: '',
      characterName: 'Tharos',
      pos: { x: 5.5, y: 2.25, z: -7.75 },
    });

    const clientInfo = buildBugReportInfo('Stormrend', {
      name: 'Tharos',
      pos: { x: 5.5, y: 2.25, z: -7.75 },
    });
    expect(clientInfo).toEqual({
      realmKnown: true,
      realm: 'Stormrend',
      characterName: 'Tharos',
      pos: { x: 5.5, y: 2.25, z: -7.75 },
    });

    // The read slice is identical across the two shapes; realm is the only divergence.
    expect(clientInfo.characterName).toBe(simInfo.characterName);
    expect(clientInfo.pos).toEqual(simInfo.pos);
  });
});

// ---------------------------------------------------------------------------
// Determinism: same input -> same output (deterministic pure core)
// ---------------------------------------------------------------------------
describe('options_view: determinism', () => {
  it('produces identical control lists for identical inputs', () => {
    const src = makeSource({ graphicsPreset: 5, cameraSpeed: 0.8 }, { reduceMotion: true });
    const env = { touch: true, nativeShell: false };
    expect(buildGraphicsControls(src, env)).toEqual(buildGraphicsControls(src, env));
    expect(buildAudioControls(src)).toEqual(buildAudioControls(src));
    expect(buildInterfaceControls(src)).toEqual(buildInterfaceControls(src));
    expect(buildControllerControls(src)).toEqual(buildControllerControls(src));
    expect(buildOptionsMenu({ bugReportAvailable: true })).toEqual(
      buildOptionsMenu({ bugReportAvailable: true }),
    );
  });
});
