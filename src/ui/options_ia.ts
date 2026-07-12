// Pure information architecture for the Esc settings menu ("The Warden's Codex").
//
// The single source of truth for the settings menu's STRUCTURE: the category
// tree of record (an Overview landing plus nine categories under three rail
// groups), the per-category/per-section control-descriptor lists, the
// category-to-settings-keys map (drives rendering AND scoped reset), the
// exclusion allowlist, the Overview pin/mirror set, the per-row sprint tier
// flags (spec section 12a), the environment-gating markers, and the structural
// search index + synonym overlay.
//
// Phase 1 lands this as PURE DATA: nothing consumes it yet (P2 rewires the
// painter onto it), so there is zero visual or behavioral change. The
// exhaustiveness guard (tests/options_ia.test.ts) binds to the REAL
// SETTING_RANGES / BOOL_SETTINGS tables and fails on any unassigned or
// double-assigned settings key.
//
// PURITY: DOM/i18n-runtime-free. Setting keys are plain strings (P2 narrows them
// against the live GameSettings, exactly as options_view already does); label
// keys are t() keys the painter resolves. Registered in tests/architecture.test.ts
// UI_PURE_CORES (and BARE_NAMED, since the file name is bare, not *_view/*_core).
//
// CONTROL-TYPE REUSE + THE ONE DEVIATION: this module reuses the control
// discriminator, the SliderFmt readout kinds, and the ChoiceOption shape from
// options_view. It does NOT embed the live-valued OptionsControl instances
// (SliderControl.value, ToggleControl.on, ChoiceControl.current), because those
// carry per-build state unfit for a STATIC IA tree. P2 maps each OptionRow here
// through the existing options_view builders (which read the live settings
// source) to produce the rendered OptionsControl, and consumes the pinned
// dispatch coercions (sliderDispatchValue / toggleNextValue / boolToggleNextValue)
// unchanged from options_view; this module never redefines them.

import type { TranslationKey } from './i18n.catalog';
import type { ChoiceOption, SliderFmt } from './options_view';

// ---------------------------------------------------------------------------
// Rail groups
// ---------------------------------------------------------------------------

/** The three rail-group headers the nine non-landing categories sit under. */
export type RailGroupId = 'display' | 'input' | 'system';

export interface RailGroup {
  id: RailGroupId;
  labelKey: TranslationKey;
}

export const RAIL_GROUPS: readonly RailGroup[] = [
  { id: 'display', labelKey: 'hudChrome.options.ia.railDisplay' },
  { id: 'input', labelKey: 'hudChrome.options.ia.railInput' },
  { id: 'system', labelKey: 'hudChrome.options.ia.railSystem' },
];

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export type CategoryId =
  | 'overview'
  | 'graphics'
  | 'interface'
  | 'accessibility'
  | 'controls'
  | 'keybinds'
  | 'controller'
  | 'touch'
  | 'audio'
  | 'system';

/** Environment gating DATA (not logic): which rows/categories a given host
 *  reveals. The painter reads these markers; it owns the runtime resolution. */
export interface EnvGating {
  /** (T) Reveal only on a touch interface (useTouchInterface()). */
  touchOnly?: boolean;
  /** Reveal only in online mode (needs an authoritative server). */
  onlineOnly?: boolean;
  /** Hide under body.mobile-touch (keyboard/mouse-specific surfaces). */
  desktopOnly?: boolean;
  /** Hide under the native app shell (which forces the touch interface). */
  nativeShellHidden?: boolean;
}

export interface CategoryDef {
  id: CategoryId;
  /** The rail group this category sits under; null for the Overview landing,
   *  which sits ABOVE the groups as the first rail item and default on open. */
  group: RailGroupId | null;
  /** Icon recipe slug for the rail item (resolved by the painter). */
  iconSlug: string;
  nameKey: TranslationKey;
  subheadKey: TranslationKey;
  env?: EnvGating;
}

// The IA of record (spec section 3): Overview landing first, then the nine
// categories in rail-group order (Display, Input, System).
export const CATEGORIES: readonly CategoryDef[] = [
  {
    id: 'overview',
    group: null,
    iconSlug: 'home',
    nameKey: 'hudChrome.options.ia.catOverviewName',
    subheadKey: 'hudChrome.options.ia.catOverviewSub',
  },
  {
    id: 'graphics',
    group: 'display',
    iconSlug: 'display',
    nameKey: 'hud.options.graphics',
    subheadKey: 'hudChrome.options.ia.catGraphicsSub',
  },
  {
    id: 'interface',
    group: 'display',
    iconSlug: 'layout',
    nameKey: 'hud.options.interface',
    subheadKey: 'hudChrome.options.ia.catInterfaceSub',
  },
  {
    id: 'accessibility',
    group: 'display',
    iconSlug: 'accessibility',
    nameKey: 'hudChrome.options.ia.catAccessibilityName',
    subheadKey: 'hudChrome.options.ia.catAccessibilitySub',
  },
  {
    id: 'controls',
    group: 'input',
    iconSlug: 'mouse',
    nameKey: 'hudChrome.options.ia.catControlsName',
    subheadKey: 'hudChrome.options.ia.catControlsSub',
  },
  {
    id: 'keybinds',
    group: 'input',
    iconSlug: 'keyboard',
    nameKey: 'hud.options.keyBindings',
    subheadKey: 'hudChrome.options.ia.catKeybindsSub',
    // Keyboard bindings are keyboard/mouse-specific: hidden on touch.
    env: { desktopOnly: true },
  },
  {
    id: 'controller',
    group: 'input',
    iconSlug: 'gamepad',
    nameKey: 'hudChrome.controller.title',
    subheadKey: 'hudChrome.options.ia.catControllerSub',
  },
  {
    id: 'touch',
    group: 'input',
    iconSlug: 'touch',
    nameKey: 'hudChrome.options.ia.catTouchName',
    subheadKey: 'hudChrome.options.ia.catTouchSub',
    // (T) The whole category only exists on a touch interface.
    env: { touchOnly: true },
  },
  {
    id: 'audio',
    group: 'system',
    iconSlug: 'audio',
    nameKey: 'hud.options.audio',
    subheadKey: 'hudChrome.options.ia.catAudioSub',
  },
  {
    id: 'system',
    group: 'system',
    iconSlug: 'gauge',
    nameKey: 'hudChrome.options.ia.catSystemName',
    subheadKey: 'hudChrome.options.ia.catSystemSub',
  },
];

// ---------------------------------------------------------------------------
// Rows: static control descriptors (reusing the options_view control kinds)
// ---------------------------------------------------------------------------

/** Per-sprint implementation tier (spec section 12a). `required` = full
 *  new-grammar treatment + per-variant QA; `migrated` = mechanically moved,
 *  dispatch-parity tested only; `conditional` = gated on an existing store. */
export type SprintTier = 'required' | 'migrated' | 'conditional';

/** The control kind. The first six reuse the options_view discriminator set;
 *  `language` and `themePreset` are the two non-settings rows (they write the
 *  i18n language / theme.ts store, not a settings.ts key), modeled the way
 *  options_view renders them today: bespoke, kept OUT of the settings-key count.
 *  `chatTimestamps` (show on/off) and `chatClock` (12h/24h) are hud-owned state
 *  (localStorage via the OptionsHooks chat accessors), likewise bespoke and
 *  keyless. */
export type RowControl =
  | 'slider'
  | 'toggle'
  | 'boolToggle'
  | 'choice'
  | 'note'
  | 'musicToggle'
  | 'language'
  | 'themePreset'
  | 'chatTimestamps'
  | 'chatClock';

export interface OptionRow {
  control: RowControl;
  /** The settings key this row reads/writes. Absent for note / music-toggle /
   *  language / theme-preset rows (which carry no settings.ts key). */
  key?: string;
  /** t() label key. Absent for a note row (which uses textKey). */
  labelKey?: TranslationKey;
  /** Explanatory-line key for a note row. */
  textKey?: TranslationKey;
  /** Slider readout format (reused from options_view). */
  fmt?: SliderFmt;
  /** Commit-on-release semantics (uiScale, issue 1558). */
  commitOnChange?: boolean;
  /** Enumerated options for a choice row (reused ChoiceOption shape). */
  choices?: ChoiceOption[];
  /** True when selecting an option re-renders the pane (preset + interfaceMode). */
  rerender?: boolean;
  sprintTier: SprintTier;
  /** Row-level environment gating, merged over the category's (see rowEnv). */
  env?: EnvGating;
}

export interface Section {
  /** Structural id (also the search index's sectionId). Section HEAD keys are
   *  P2 chrome (not rendered in P1), so no head key lives here yet. */
  id: string;
  rows: OptionRow[];
}

// Small row constructors keep the tables terse and uniform. They are the static
// twins of options_view's private slider()/toggle()/choice() helpers (which are
// not exported), carrying the STRUCTURE without binding a live value.
const slider = (
  key: string,
  labelKey: TranslationKey,
  sprintTier: SprintTier,
  fmt: SliderFmt = 'percent',
  extra: Partial<OptionRow> = {},
): OptionRow => ({ control: 'slider', key, labelKey, fmt, sprintTier, ...extra });

const toggle = (
  key: string,
  labelKey: TranslationKey,
  sprintTier: SprintTier,
  extra: Partial<OptionRow> = {},
): OptionRow => ({
  control: 'toggle',
  key,
  labelKey,
  sprintTier,
  ...extra,
});

const boolToggle = (
  key: string,
  labelKey: TranslationKey,
  sprintTier: SprintTier,
  extra: Partial<OptionRow> = {},
): OptionRow => ({
  control: 'boolToggle',
  key,
  labelKey,
  sprintTier,
  ...extra,
});

const choice = (
  key: string,
  labelKey: TranslationKey,
  choices: ChoiceOption[],
  sprintTier: SprintTier,
  extra: Partial<OptionRow> = {},
): OptionRow => ({ control: 'choice', key, labelKey, choices, sprintTier, ...extra });

const note = (textKey: TranslationKey, sprintTier: SprintTier): OptionRow => ({
  control: 'note',
  textKey,
  sprintTier,
});

// Reused enumerated option sets (label keys already exist in the catalog).
const lowHighOptions: ChoiceOption[] = [
  { value: 0, labelKey: 'hud.options.terrainLow' },
  { value: 1, labelKey: 'hud.options.terrainHigh' },
];

// ---------------------------------------------------------------------------
// The per-category, per-section descriptor tables (spec section 3)
// ---------------------------------------------------------------------------

export const CATEGORY_SECTIONS: Record<CategoryId, Section[]> = {
  // The Overview landing renders quick actions + pins + alerts + status, not
  // settings-key rows; its content lives in OVERVIEW_QUICK_ACTIONS / OVERVIEW_PINS.
  overview: [],

  graphics: [
    {
      id: 'quality',
      rows: [
        choice(
          'graphicsPreset',
          'hud.options.graphicsQuality',
          [
            { value: 1, labelKey: 'hud.options.graphicsPresetLow' },
            { value: 2, labelKey: 'hud.options.graphicsPresetMedium' },
            { value: 3, labelKey: 'hud.options.graphicsPresetHigh' },
            { value: 4, labelKey: 'hud.options.graphicsPresetUltra' },
            { value: 5, labelKey: 'hud.options.graphicsPresetAdvanced' },
          ],
          'required',
          { rerender: true },
        ),
        // Advanced-preset detail rows (revealed at preset 5; visibility is a P2
        // render concern, so they live in the tree unconditionally).
        choice('terrainDetail', 'hud.options.terrainDetail', lowHighOptions, 'migrated'),
        choice('foliageDensity', 'hud.options.foliageDensity', lowHighOptions, 'migrated'),
        choice('effectsQuality', 'hud.options.effectsQuality', lowHighOptions, 'required'),
        choice('shadowQuality', 'hud.options.shadowQuality', lowHighOptions, 'migrated'),
        slider('renderScale', 'hud.options.renderQuality', 'migrated'),
        toggle('weather', 'game.settings.weather', 'migrated'),
        choice(
          'browserEffects',
          'hudChrome.options.browserEffects',
          [
            { value: 0, labelKey: 'hudChrome.options.browserEffectsAuto' },
            { value: 1, labelKey: 'hudChrome.options.browserEffectsFull' },
            { value: 2, labelKey: 'hudChrome.options.browserEffectsReduced' },
            { value: 3, labelKey: 'hudChrome.options.browserEffectsMinimal' },
          ],
          'required',
        ),
        note('hudChrome.options.browserEffectsNote', 'required'),
      ],
    },
    {
      id: 'view',
      rows: [
        slider('brightness', 'hud.options.brightness', 'migrated'),
        slider('cameraFov', 'hud.options.fieldOfView', 'migrated', 'degrees'),
        toggle('fullscreen', 'hud.options.fullscreen', 'migrated'),
      ],
    },
  ],

  interface: [
    {
      id: 'general',
      rows: [
        { control: 'language', labelKey: 'hud.options.language', sprintTier: 'required' },
        { control: 'themePreset', labelKey: 'hudChrome.theme.preset', sprintTier: 'required' },
      ],
    },
    {
      id: 'scaleText',
      rows: [
        slider('uiScale', 'hudChrome.options.uiScale', 'required', 'percent', {
          commitOnChange: true,
        }),
        slider('tooltipScale', 'hud.options.tooltipScale', 'required'),
      ],
    },
    {
      id: 'panels',
      rows: [
        slider('hudOpacity', 'hud.options.hudOpacity', 'required'),
        boolToggle('frostedPanels', 'hud.options.frostedPanels', 'required'),
      ],
    },
    {
      id: 'unitFrames',
      rows: [
        slider('playerFrameScale', 'hudChrome.options.playerFrameScale', 'required'),
        slider('targetFrameScale', 'hudChrome.options.targetFrameScale', 'required'),
        boolToggle('aurasOnPlayerFrame', 'hudChrome.options.aurasOnPlayerFrame', 'required'),
        boolToggle('showOwnNameplate', 'hudChrome.options.showOwnNameplate', 'required'),
      ],
    },
    {
      id: 'actionBars',
      rows: [
        boolToggle(
          'showSecondaryActionBar',
          'hudChrome.options.showSecondaryActionBar',
          'required',
        ),
      ],
    },
    {
      id: 'chat',
      rows: [
        slider('chatFontScale', 'hud.options.chatFontScale', 'required'),
        slider('chatOpacity', 'hud.options.chatOpacity', 'required'),
        boolToggle('compactChat', 'hud.options.compactChat', 'required'),
        // Chat timestamps (show + 12h/24h): hud-owned localStorage state applied
        // per chat line, reached through the OptionsHooks chat accessors rather
        // than a settings.ts key, so both rows are bespoke keyless controls the
        // painter renders itself (like language / themePreset). Without them a
        // player who ever enabled timestamps had NO surface to turn them off.
        {
          control: 'chatTimestamps',
          labelKey: 'hudChrome.chatTimestamps.show',
          sprintTier: 'conditional',
        },
        {
          control: 'chatClock',
          labelKey: 'hudChrome.chatTimestamps.format',
          sprintTier: 'conditional',
        },
      ],
    },
    {
      id: 'combatTooltips',
      rows: [
        slider('fctScale', 'hud.options.fctScale', 'required'),
        boolToggle('showItemLevel', 'hudChrome.options.showItemLevel', 'required'),
      ],
    },
    {
      id: 'hudExtras',
      rows: [
        toggle('showOverflowXp', 'game.settings.showOverflowXp', 'required'),
        boolToggle(
          'showWalletOnCharacterScreen',
          'hudChrome.options.showWalletOnCharacterScreen',
          'required',
        ),
        boolToggle(
          'showWalletOnPlayerCard',
          'hudChrome.options.showWalletOnPlayerCard',
          'required',
        ),
        boolToggle('showDevBadges', 'hudChrome.options.showDevBadges', 'required'),
        boolToggle('showDailyRewardsChest', 'hudChrome.options.showDailyRewardsChest', 'required'),
      ],
    },
  ],

  accessibility: [
    {
      id: 'motionContrast',
      rows: [
        boolToggle('reduceMotion', 'hud.options.reduceMotion', 'required'),
        boolToggle('highContrastText', 'hud.options.highContrastText', 'required'),
        boolToggle('landingHighContrast', 'hudChrome.options.highContrastBackground', 'required'),
      ],
    },
    {
      id: 'content',
      rows: [boolToggle('filterProfanity', 'hud.options.filterProfanity', 'required')],
    },
  ],

  controls: [
    {
      id: 'camera',
      rows: [
        boolToggle('mouseCamera', 'hud.options.mouseCamera', 'migrated', {
          env: { desktopOnly: true },
        }),
        slider('cameraSpeed', 'hud.options.cameraSpeed', 'migrated', 'percent', {
          env: { desktopOnly: true },
        }),
        boolToggle('invertLookY', 'hud.options.invertLookY', 'migrated', {
          env: { desktopOnly: true },
        }),
        boolToggle('lockCursorOnRotate', 'hudChrome.options.lockCursorOnRotate', 'migrated', {
          env: { desktopOnly: true },
        }),
      ],
    },
    {
      id: 'movement',
      rows: [
        toggle('clickToMove', 'hud.options.clickToMove', 'migrated', {
          env: { desktopOnly: true },
        }),
        choice(
          'clickToMoveButton',
          'hud.options.clickMoveButton',
          [
            { value: 0, labelKey: 'hudChrome.options.clickMoveLeft' },
            { value: 2, labelKey: 'hudChrome.options.clickMoveRight' },
          ],
          'migrated',
          { env: { desktopOnly: true } },
        ),
      ],
    },
    {
      id: 'combat',
      rows: [
        boolToggle('attackMove', 'hud.keybinds.actions.attackMove', 'migrated'),
        boolToggle('startAttackOnAbilityUse', 'hudChrome.options.startAttackOnAbility', 'migrated'),
        boolToggle('groundReticle', 'hudChrome.options.groundReticle', 'migrated'),
        boolToggle('walkByAutoloot', 'hudChrome.options.walkByAutoloot', 'migrated'),
      ],
    },
    {
      id: 'feedback',
      rows: [boolToggle('clickFeedback', 'hudChrome.options.clickFeedback', 'migrated')],
    },
    {
      id: 'inputMode',
      rows: [
        choice(
          'interfaceMode',
          'hudChrome.options.interfaceMode',
          [
            { value: 0, labelKey: 'hudChrome.options.interfaceModeAuto' },
            { value: 1, labelKey: 'hudChrome.options.interfaceModeDesktop' },
            { value: 2, labelKey: 'hudChrome.options.interfaceModeTouch' },
          ],
          'required',
          { rerender: true, env: { nativeShellHidden: true } },
        ),
        note('hudChrome.options.interfaceModeNote', 'required'),
      ],
    },
  ],

  // The bind table + reset action are bespoke (P2/P4); no settings-key rows.
  keybinds: [],

  controller: [
    {
      id: 'feel',
      rows: [
        boolToggle('gamepadEnabled', 'hudChrome.controller.enable', 'migrated'),
        boolToggle('gamepadInvertY', 'hudChrome.controller.invertY', 'migrated'),
        slider('gamepadStickDeadzone', 'hudChrome.controller.deadzone', 'migrated'),
        slider('gamepadCameraSpeed', 'hudChrome.controller.cameraSpeed', 'migrated', 'oneDecimal'),
        slider('gamepadVibration', 'hudChrome.controller.vibration', 'migrated'),
      ],
    },
    // The per-button remap section is bespoke (P2); no settings-key rows.
  ],

  touch: [
    {
      id: 'sticks',
      rows: [
        slider('joystickScale', 'hud.options.joystickSize', 'migrated'),
        slider('joystickDeadzone', 'hud.options.joystickDeadzone', 'migrated'),
        boolToggle('leftHandedTouch', 'hudChrome.options.mobileLeftHanded', 'migrated'),
        boolToggle('mobileCameraJoystick', 'hudChrome.options.mobileCameraJoystick', 'migrated'),
      ],
    },
    {
      id: 'look',
      rows: [
        slider('touchLookSpeed', 'hud.options.touchLookSpeed', 'migrated'),
        boolToggle('touchInvertLook', 'hud.options.invertLook', 'migrated'),
      ],
    },
    {
      id: 'buttons',
      rows: [
        slider('actionButtonScale', 'hud.options.buttonSize', 'migrated'),
        slider('touchOpacity', 'hud.options.touchOpacity', 'migrated'),
      ],
    },
  ],

  audio: [
    {
      id: 'volume',
      rows: [
        slider('sfxVolume', 'hud.options.soundEffects', 'migrated'),
        slider('musicVolume', 'hud.options.musicVolume', 'migrated'),
        slider('voiceVolume', 'hud.options.voiceVolume', 'migrated'),
      ],
    },
    {
      id: 'toggles',
      rows: [
        { control: 'musicToggle', labelKey: 'hud.options.music', sprintTier: 'migrated' },
        boolToggle('voiceEnabled', 'hud.options.npcVoices', 'migrated'),
        boolToggle('footstepSfx', 'hudChrome.options.footstepSounds', 'migrated'),
      ],
    },
  ],

  system: [
    {
      id: 'performance',
      rows: [
        boolToggle('showFps', 'hud.options.showFps', 'required'),
        // The performance-overlay panel is delegated (PerfOverlaySettingsPanel);
        // the About version readout is bespoke. Neither is a settings-key row.
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Overview landing: quick actions + pinned mirror rows
// ---------------------------------------------------------------------------

export type QuickActionId = 'resume' | 'reportBug' | 'logout' | 'resetAll';

export interface QuickAction {
  id: QuickActionId;
  labelKey: TranslationKey;
  sprintTier: SprintTier;
  env?: EnvGating;
}

/** The Overview quick actions, mirroring the footer for discoverability. */
export const OVERVIEW_QUICK_ACTIONS: readonly QuickAction[] = [
  { id: 'resume', labelKey: 'hud.options.returnToGame', sprintTier: 'required' },
  {
    id: 'reportBug',
    labelKey: 'hudChrome.bugReport.menuButton',
    sprintTier: 'required',
    env: { onlineOnly: true },
  },
  // Log out is reachable in BOTH modes: offline it runs location.reload() back to
  // the title screen (a meaningful action), so it carries no online gate. The
  // painter renders it unconditionally and the P5 mobile back-stack shell consumes
  // this list, so the marker and the shipped behavior stay in agreement.
  {
    id: 'logout',
    labelKey: 'hud.options.logout',
    sprintTier: 'required',
  },
  { id: 'resetAll', labelKey: 'hud.options.resetToDefaults', sprintTier: 'required' },
];

/** An Overview pinned MIRROR row. A mirror is NOT a second home: it writes the
 *  SAME home setting (or the non-settings theme/language home) and jumps
 *  nowhere. The exhaustiveness test counts ONLY the home assignment, so a mirror
 *  never contributes to the category-to-keys map. */
export interface OverviewPin {
  /** The home settings key this mirror writes (for the six settings-backed pins). */
  key?: string;
  /** The non-settings home for the theme-preset / language pins. */
  nonSettingsHome?: 'themePreset' | 'language';
  /** t() label key (reuses the home row's label). */
  labelKey: TranslationKey;
  /** The category whose detail pane hosts the home row (for the future jump). */
  homeCategory: CategoryId;
  sprintTier: 'required';
}

export const OVERVIEW_PINS: readonly OverviewPin[] = [
  // Language leads the Overview (maintainer direction): a player who cannot
  // read the current language must reach it before anything else.
  {
    nonSettingsHome: 'language',
    labelKey: 'hud.options.language',
    homeCategory: 'interface',
    sprintTier: 'required',
  },
  {
    key: 'graphicsPreset',
    labelKey: 'hud.options.graphicsQuality',
    homeCategory: 'graphics',
    sprintTier: 'required',
  },
  {
    key: 'uiScale',
    labelKey: 'hudChrome.options.uiScale',
    homeCategory: 'interface',
    sprintTier: 'required',
  },
  {
    nonSettingsHome: 'themePreset',
    labelKey: 'hudChrome.theme.preset',
    homeCategory: 'interface',
    sprintTier: 'required',
  },
  {
    key: 'musicVolume',
    labelKey: 'hud.options.musicVolume',
    homeCategory: 'audio',
    sprintTier: 'required',
  },
  {
    key: 'sfxVolume',
    labelKey: 'hud.options.soundEffects',
    homeCategory: 'audio',
    sprintTier: 'required',
  },
  {
    key: 'reduceMotion',
    labelKey: 'hud.options.reduceMotion',
    homeCategory: 'accessibility',
    sprintTier: 'required',
  },
  {
    key: 'interfaceMode',
    labelKey: 'hudChrome.options.interfaceMode',
    homeCategory: 'controls',
    sprintTier: 'required',
  },
];

// ---------------------------------------------------------------------------
// Exclusion allowlist
// ---------------------------------------------------------------------------

/** Settings keys deliberately never rendered in the menu: an internal first-run
 *  flag and a toggle owned by the quest-tracker header. */
export const EXCLUDED_SETTING_KEYS: readonly string[] = [
  'graphicsDefaultApplied',
  'questTrackerCollapsed',
];

// ---------------------------------------------------------------------------
// Derived accessors (category->keys map, tier/env resolution, flat row list)
// ---------------------------------------------------------------------------

/** Flatten every rendered OptionRow across the nine categories (Overview's
 *  quick actions + pins are NOT OptionRows and are excluded). */
export function allRows(): OptionRow[] {
  const rows: OptionRow[] = [];
  for (const sections of Object.values(CATEGORY_SECTIONS)) {
    for (const section of sections) rows.push(...section.rows);
  }
  return rows;
}

/** The settings keys homed in a category (drives rendering AND scoped reset). */
export function categorySettingKeys(id: CategoryId): string[] {
  const keys: string[] = [];
  for (const section of CATEGORY_SECTIONS[id]) {
    for (const row of section.rows) if (row.key) keys.push(row.key);
  }
  return keys;
}

/** The category a settings key is homed in, or undefined if unassigned. */
export function categoryOf(key: string): CategoryId | undefined {
  for (const c of CATEGORIES) {
    if (categorySettingKeys(c.id).includes(key)) return c.id;
  }
  return undefined;
}

/** The rendered row for a settings key, or undefined if unassigned. */
export function settingRow(key: string): OptionRow | undefined {
  return allRows().find((r) => r.key === key);
}

/** The effective environment gating for a settings-key row: the row's own
 *  markers merged over its category's (a Touch row inherits the category's
 *  touch-only gate; a mouse-specific Controls row adds its own desktop-only). */
export function rowEnv(key: string): EnvGating {
  const catId = categoryOf(key);
  const cat = CATEGORIES.find((c) => c.id === catId);
  const row = settingRow(key);
  return { ...(cat?.env ?? {}), ...(row?.env ?? {}) };
}

// ---------------------------------------------------------------------------
// Structural search index + synonym overlay
// ---------------------------------------------------------------------------

export interface SearchIndexRow {
  settingKey: string;
  labelKey: TranslationKey;
  categoryId: CategoryId;
  sectionId: string;
}

/** Explicit synonym overlay: search terms that do not appear in a row's label
 *  but should still find it. Targets a real indexed settings key. */
export const SEARCH_SYNONYMS: Record<string, string> = {
  fps: 'showFps',
  framerate: 'showFps',
  motion: 'reduceMotion',
};

/** Category-level search synonyms (P4): terms that surface a whole CATEGORY rather
 *  than a settings-key row. The Keybinds category is bespoke (its bind table has no
 *  settings-key rows to index), so "bind / binding / hotkey / shortcut" reach it
 *  through this overlay instead of SEARCH_SYNONYMS (which targets indexed keys). */
export const CATEGORY_SEARCH_SYNONYMS: Record<string, CategoryId> = {
  bind: 'keybinds',
  binding: 'keybinds',
  keybind: 'keybinds',
  keybinds: 'keybinds',
  hotkey: 'keybinds',
  shortcut: 'keybinds',
};

/** The categories a query surfaces via CATEGORY_SEARCH_SYNONYMS (a term matches when
 *  it contains the query, mirroring the settings-key synonym semantics). */
export function categoriesForSearch(rawQuery: string): CategoryId[] {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return [];
  const ids = new Set<CategoryId>();
  for (const [term, id] of Object.entries(CATEGORY_SEARCH_SYNONYMS)) {
    if (term.includes(q)) ids.add(id);
  }
  return [...ids];
}

/** A rendered row that carries NO settings key (language, theme preset), so it is
 *  absent from buildSearchIndex (which is settings-key-only, and whose index test
 *  asserts every row names a REAL settings key). Global search consumes THIS list
 *  so both rows stay reachable, matched by label OR a synonym and rendered through
 *  the painter's bespoke languageRow / themeRow. */
export interface NonSettingSearchRow {
  control: 'language' | 'themePreset';
  labelKey: TranslationKey;
  categoryId: CategoryId;
  sectionId: string;
  /** Extra search terms beyond the label (contains-match, like SEARCH_SYNONYMS). */
  synonyms: readonly string[];
}

/** The two non-settings rows homed in Interface > general. Their labelKey mirrors
 *  the CATEGORY_SECTIONS.interface general rows, so search and the detail pane name
 *  the same control. */
export const NON_SETTING_SEARCH_ROWS: readonly NonSettingSearchRow[] = [
  {
    control: 'language',
    labelKey: 'hud.options.language',
    categoryId: 'interface',
    sectionId: 'general',
    synonyms: ['language', 'locale'],
  },
  {
    control: 'themePreset',
    labelKey: 'hudChrome.theme.preset',
    categoryId: 'interface',
    sectionId: 'general',
    synonyms: ['theme', 'colour', 'color', 'appearance'],
  },
];

/** Build the STRUCTURAL search index from the SAME descriptor tables the panes
 *  render: one row per rendered control that carries a settings key + label, so
 *  the index cannot drift from what is shown (a test asserts the equality). */
export function buildSearchIndex(): SearchIndexRow[] {
  const index: SearchIndexRow[] = [];
  for (const category of CATEGORIES) {
    for (const section of CATEGORY_SECTIONS[category.id]) {
      for (const row of section.rows) {
        if (!row.key || !row.labelKey) continue;
        index.push({
          settingKey: row.key,
          labelKey: row.labelKey,
          categoryId: category.id,
          sectionId: section.id,
        });
      }
    }
  }
  return index;
}
