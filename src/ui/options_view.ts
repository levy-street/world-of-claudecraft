// Pure, host-agnostic view-model for the Esc options window.
//
// The pure-core half of the cold-window pure-core + thin-painter split (root
// CLAUDE.md Conventions; reference vendor_view.ts / social_view.ts). The options
// window is the densest control surface in the HUD: nine sub-panels reached
// through a small family of reusable control primitives. This module owns the
// DECLARATIVE model the painter renders: which control of which kind sits in
// which panel, its setting key, its label key, its choice set, and the pure
// value-coercion each control fires when changed. The DOM, the i18n runtime, the
// audio/music singletons, and the dispatch wiring all live in options_window.ts;
// the structure and the dispatch contract are decided here so a Vitest can pin
// every sub-panel's dispatch without a DOM.
//
// DOM/Three-free and game-free: setting keys are plain strings (the painter
// narrows them against the real GameSettings), label keys are t() keys the
// painter resolves. Registered in tests/architecture.test.ts UI_PURE_CORES.

import type { TranslationKey } from './i18n.catalog';

/** Copy at the ownership boundary so a caller can never mutate the applied
 *  renderer snapshot while editing its local options draft. */
export function copyGraphicsDraft<K extends string>(
  source: Readonly<Record<K, number>>,
): Record<K, number> {
  return { ...source };
}

/** Dirty is intentionally raw-value equality. A change and exact revert clears
 *  dirty even when two distinct raw profiles would resolve to the same effective
 *  renderer tier. Effective no-op detection belongs to the apply coordinator. */
export function graphicsDraftDirty<K extends string>(
  keys: readonly K[],
  draft: Readonly<Record<K, number>>,
  applied: Readonly<Record<K, number>>,
): boolean {
  return keys.some((key) => draft[key] !== applied[key]);
}

/** Overlay just the caller-identified staged numbers onto the live settings projection. */
export function withGraphicsDraft<K extends string>(
  live: OptionsSettingsSource,
  keys: readonly K[],
  draft: Readonly<Record<K, number>>,
): OptionsSettingsSource {
  const keySet: ReadonlySet<string> = new Set(keys);
  return {
    num: (key) => (keySet.has(key) ? draft[key as K] : live.num(key)),
    bool: (key) => live.bool(key),
    range: (key) => live.range(key),
  };
}

// ---------------------------------------------------------------------------
// Control primitive descriptors (cluster 1)
// ---------------------------------------------------------------------------
// The four setting-write controls share a uniform dispatch (each fires
// onSettingChange(key, value)); they differ only in the value contract, which is
// the one thing worth modelling per kind. Do NOT collapse them: a slider carries
// a numeric range, a toggle an on/off, a boolToggle a true/false store key, a
// choice an enumerated set.

/** How a slider's readout is formatted; the painter maps this to a formatter. */
export type SliderFmt = 'percent' | 'degrees' | 'oneDecimal';

/** Which Interface-panel tab a control belongs to. The Interface panel is split
 *  into four tabs (the interface list grew to ~40 rows in one scroll); every
 *  declarative interface control carries exactly one category so the painter can
 *  filter the list per tab. Non-interface panels (graphics/audio/controller)
 *  leave `category` unset. */
export type InterfaceTab = 'general' | 'frames' | 'chat' | 'combat';

export interface SliderControl {
  control: 'slider';
  /** A NumericSettingKey (the painter narrows it to the live settings store). */
  key: string;
  labelKey: TranslationKey;
  min: number;
  max: number;
  step: number;
  /** Current value at build time; the painter re-reads the live value on input. */
  value: number;
  fmt: SliderFmt;
  /** Commit the setting on release ('change') instead of live on every 'input'
   *  tick. Set for uiScale, whose live rescale moves the slider under the cursor
   *  mid-drag (issue 1558); dragging updates only the readout, not the setting.
   *  Other sliders keep their intended live preview (volume, fov, frame scale). */
  commitOnChange?: boolean;
  /** Interface-panel tab this control lives in (unset on other panels). */
  category?: InterfaceTab;
}

export interface ToggleControl {
  control: 'toggle';
  /** A numeric 0/1 setting key (on when the stored value is >= 0.5). */
  key: string;
  labelKey: TranslationKey;
  on: boolean;
  /** Interface-panel tab this control lives in (unset on other panels). */
  category?: InterfaceTab;
}

export interface BoolToggleControl {
  control: 'boolToggle';
  /** A BOOL_SETTINGS key (true/false stored directly). */
  key: string;
  labelKey: TranslationKey;
  on: boolean;
  /** Disabled controls remain visible but cannot dispatch until their dependency is met. */
  disabled?: boolean;
  /** Rebuild the panel after dispatch so dependent controls refresh immediately. */
  rerender?: boolean;
  /** Interface-panel tab this control lives in (unset on other panels). */
  category?: InterfaceTab;
}

export interface ChoiceOption {
  value: number;
  labelKey: TranslationKey;
}

export interface ChoiceControl {
  control: 'choice';
  key: string;
  labelKey: TranslationKey;
  /** The currently selected value (rounded, matching the inline button-sync). */
  current: number;
  options: ChoiceOption[];
  /** True when selecting an option re-renders the panel (preset + interfaceMode). */
  rerender: boolean;
  /** Interface-panel tab this control lives in (unset on other panels). */
  category?: InterfaceTab;
}

/** A standalone explanatory line rendered between controls (class set-note). */
export interface NoteControl {
  control: 'note';
  textKey: TranslationKey;
  /** Interface-panel tab this control lives in (unset on other panels). */
  category?: InterfaceTab;
}

/** Position marker for the bespoke music on/off toggle inside the audio panel.
 *  It reads the live MusicDirector singleton, not a setting, so it carries only a
 *  label; the painter renders + dispatches it. */
export interface MusicToggleControl {
  control: 'musicToggle';
  labelKey: TranslationKey;
  /** Interface-panel tab this control lives in (unset on other panels). */
  category?: InterfaceTab;
}

export type OptionsControl =
  | SliderControl
  | ToggleControl
  | BoolToggleControl
  | ChoiceControl
  | NoteControl
  | MusicToggleControl;

// ---------------------------------------------------------------------------
// Pure dispatch-value functions (the dispatch matrix's load-bearing contract)
// ---------------------------------------------------------------------------
// Pinning each control's value coercion as a pure function lets the per-sub-panel
// dispatch test prove a control still fires the SAME write after extraction, with
// no DOM. The painter calls these exact functions, so the dispatch cannot drift.

/** A slider input dispatches the raw input value coerced to a Number. */
export const sliderDispatchValue = (rawValue: string): number => Number(rawValue);

/** A numeric toggle flips between 0 and 1 off the current stored value. */
export const toggleNextValue = (current: number): number => (current >= 0.5 ? 0 : 1);

/** A numeric toggle reads as on when its stored value is >= 0.5. */
export const toggleIsOn = (current: number): boolean => current >= 0.5;

/** A bool toggle flips the stored boolean. */
export const boolToggleNextValue = (current: boolean): boolean => !current;

// ---------------------------------------------------------------------------
// Settings projection + environment the panel builders read from
// ---------------------------------------------------------------------------

/** The minimal settings projection the options view-model needs. The painter
 *  builds it from the live Settings + SETTING_RANGES, keeping this core game-free. */
export interface OptionsSettingsSource {
  /** Current numeric value for a range/choice/slider setting key. */
  num(key: string): number;
  /** Current boolean value for a BOOL_SETTINGS key. */
  bool(key: string): boolean;
  /** Static [min, max] range for a numeric setting key (from SETTING_RANGES). */
  range(key: string): { min: number; max: number };
}

/** Device/shell flags that gate which rows a panel shows. */
export interface OptionsEnv {
  /** useTouchInterface(): reveals the touch-only sliders. */
  touch: boolean;
  /** isNativeAppShell(): hides the Interface Mode picker (the shell forces touch). */
  nativeShell: boolean;
}

const slider = (
  s: OptionsSettingsSource,
  key: string,
  labelKey: TranslationKey,
  fmt: SliderFmt = 'percent',
  step = 0.05,
): SliderControl => {
  const r = s.range(key);
  return { control: 'slider', key, labelKey, min: r.min, max: r.max, step, value: s.num(key), fmt };
};

const toggle = (
  s: OptionsSettingsSource,
  key: string,
  labelKey: TranslationKey,
): ToggleControl => ({
  control: 'toggle',
  key,
  labelKey,
  on: toggleIsOn(s.num(key)),
});

const boolToggle = (
  s: OptionsSettingsSource,
  key: string,
  labelKey: TranslationKey,
  opts: Pick<BoolToggleControl, 'disabled' | 'rerender'> = {},
): BoolToggleControl => ({ control: 'boolToggle', key, labelKey, on: s.bool(key), ...opts });

/** The option value nearest the stored setting (the level ladders persist
 *  half-step values like 0.5, which plain rounding would mis-select). Exact
 *  matches behave exactly as before. */
export function nearestOptionValue(value: number, options: ChoiceOption[]): number {
  let best = options[0]?.value ?? 0;
  for (const option of options) {
    if (Math.abs(option.value - value) < Math.abs(best - value)) best = option.value;
  }
  return best;
}

const choice = (
  s: OptionsSettingsSource,
  key: string,
  labelKey: TranslationKey,
  options: ChoiceOption[],
  rerender = false,
): ChoiceControl => ({
  control: 'choice',
  key,
  labelKey,
  current: nearestOptionValue(s.num(key), options),
  options,
  rerender,
});

const note = (textKey: TranslationKey): NoteControl => ({ control: 'note', textKey });

// The advanced-preset sub-setting ladders (round 10). Values are the
// PERSISTED numbers gfx.ts maps to knob levels: the historical binary rows
// stored 0 (Low) and 1 (High), so those keep their meaning and the new
// levels slot in at 0.5 (Medium) and 2 (Insane). Labels reuse the preset
// quality words so the ladders read consistently with the preset picker.
const qualityLadderOptions: ChoiceOption[] = [
  { value: 0, labelKey: 'hud.options.graphicsPresetLow' },
  { value: 0.5, labelKey: 'hud.options.graphicsPresetMedium' },
  { value: 1, labelKey: 'hud.options.graphicsPresetHigh' },
  { value: 2, labelKey: 'hud.options.graphicsPresetInsane' },
];
// Effects & Lighting stops at High (the full high-tier post stack); the
// ultra/insane tiers' full-res AO rides the preset, not this dial.
const effectsLadderOptions: ChoiceOption[] = [
  { value: 0, labelKey: 'hud.options.graphicsPresetLow' },
  { value: 0.5, labelKey: 'hud.options.graphicsPresetMedium' },
  { value: 1, labelKey: 'hud.options.graphicsPresetHigh' },
];
// The worn-surface layer dial (the town-street cost driver): Off sheds the
// layer, Basic keeps grime/normals without parallax, Full runs the ultra
// execution, Insane the everything-on walk.
const surfaceDetailOptions: ChoiceOption[] = [
  { value: 0, labelKey: 'hud.options.off' },
  { value: 0.5, labelKey: 'hud.options.surfaceDetailBasic' },
  { value: 1, labelKey: 'hud.options.surfaceDetailFull' },
  { value: 2, labelKey: 'hud.options.graphicsPresetInsane' },
];

// ---------------------------------------------------------------------------
// Main menu (cluster 5 routing)
// ---------------------------------------------------------------------------

/** A sub-view the main menu can route to (matches the painter's view discriminator). */
export type OptionsPanelId =
  | 'keybinds'
  | 'controller'
  | 'graphics'
  | 'interface'
  | 'auras'
  | 'audio'
  | 'performance'
  | 'bugreport';

export type OptionsMenuAction =
  | { kind: 'goto'; view: OptionsPanelId }
  | { kind: 'unstuck' }
  | { kind: 'logout' }
  | { kind: 'close' };

export interface OptionsMenuEntry {
  labelKey: TranslationKey;
  action: OptionsMenuAction;
}

/** The main Esc-menu button list. The "Report a Bug" row is online-only (it needs
 *  an authoritative server to receive the report). */
export function buildOptionsMenu(opts: { bugReportAvailable: boolean }): OptionsMenuEntry[] {
  const entries: OptionsMenuEntry[] = [
    { labelKey: 'hud.options.keyBindings', action: { kind: 'goto', view: 'keybinds' } },
    { labelKey: 'hudChrome.controller.title', action: { kind: 'goto', view: 'controller' } },
    { labelKey: 'hud.options.graphics', action: { kind: 'goto', view: 'graphics' } },
    { labelKey: 'hud.options.interface', action: { kind: 'goto', view: 'interface' } },
    { labelKey: 'hudChrome.auraOverlay.title', action: { kind: 'goto', view: 'auras' } },
    { labelKey: 'hud.options.audio', action: { kind: 'goto', view: 'audio' } },
    { labelKey: 'hudChrome.perf.title', action: { kind: 'goto', view: 'performance' } },
  ];
  if (opts.bugReportAvailable)
    entries.push({
      labelKey: 'hudChrome.bugReport.menuButton',
      action: { kind: 'goto', view: 'bugreport' },
    });
  entries.push({ labelKey: 'hudChrome.unstuck.menuButton', action: { kind: 'unstuck' } });
  entries.push({ labelKey: 'hud.options.logout', action: { kind: 'logout' } });
  entries.push({ labelKey: 'hud.options.returnToGame', action: { kind: 'close' } });
  return entries;
}

// ---------------------------------------------------------------------------
// Graphics panel (cluster 3) -- the static WebGL preset is read as a plain
// setting value here. This panel must NEVER read the FPS governor or define the
// effects-quality cutoff: that resolver and per-element tiering live in their
// own modules.
// ---------------------------------------------------------------------------

/** One titled card of the two-column Graphics sub-panel. */
export interface GraphicsSection {
  titleKey: TranslationKey;
  /** Desktop placement: column 1 (left), column 2 (right), or 'full' (a card
   *  spanning both columns below them, its rows flowing two-up). Narrow/touch
   *  stacks everything in section order. */
  column: 1 | 2 | 'full';
  controls: OptionsControl[];
}

// The two-option Off/On ladder the per-effect binaries render with.
const offOnOptions: ChoiceOption[] = [
  { value: 0, labelKey: 'hud.options.off' },
  { value: 1, labelKey: 'hud.options.on' },
];
// Ambient Occlusion's three rungs: Off, half-resolution, full-resolution
// (Full is how an Advanced mix reaches the ultra tiers' full-res AO).
const ambientOcclusionOptions: ChoiceOption[] = [
  { value: 0, labelKey: 'hud.options.off' },
  { value: 0.5, labelKey: 'hudChrome.options.gfxHalf' },
  { value: 1, labelKey: 'hud.options.surfaceDetailFull' },
];
// The two-step Low/High ladder (Character Detail's distant-rig animation
// band, Dynamic Lights' point-light pool).
const lowHighOptions: ChoiceOption[] = [
  { value: 0, labelKey: 'hud.options.graphicsPresetLow' },
  { value: 1, labelKey: 'hud.options.graphicsPresetHigh' },
];

/** The Graphics sub-panel as titled cards in a two-column form (the perf
 *  panel's categorized layout). The per-system dials render for EVERY preset
 *  (round 12): under a fixed preset they display that preset's seeded levels
 *  and editing one switches the staged draft to the Advanced custom mix
 *  (graphics_rebuild_core.stageGraphicsDraftChange, wired by the painter); the
 *  dial ladders re-render so the preset row tracks that switch. The native
 *  shell keeps its capped preset row only (its memory profile owns most of the
 *  dial-mapped knobs, so the dials would be dead controls there). */
export function buildGraphicsSections(
  s: OptionsSettingsSource,
  env: OptionsEnv,
): GraphicsSection[] {
  const quality: OptionsControl[] = [];
  const graphicsPresetOptions: ChoiceOption[] = [
    { value: 1, labelKey: 'hud.options.graphicsPresetLow' },
    { value: 2, labelKey: 'hud.options.graphicsPresetMedium' },
    { value: 3, labelKey: 'hud.options.graphicsPresetHigh' },
  ];
  if (!env.nativeShell) {
    // Display order runs up the quality ladder (Insane sits above Ultra) with
    // the expert Advanced profile last; the persisted VALUES stay historical
    // (5 = Advanced predates 6 = Insane and can never renumber).
    graphicsPresetOptions.push(
      { value: 4, labelKey: 'hud.options.graphicsPresetUltra' },
      { value: 6, labelKey: 'hud.options.graphicsPresetInsane' },
      { value: 5, labelKey: 'hud.options.graphicsPresetAdvanced' },
    );
  }
  quality.push(
    choice(s, 'graphicsPreset', 'hud.options.graphicsQuality', graphicsPresetOptions, true),
  );
  // The custom-switch explainer renders only under a FIXED preset: once the
  // Advanced mix is active the dials edit in place and the note is a no-op.
  if (!env.nativeShell && Math.round(s.num('graphicsPreset')) !== 5)
    quality.push(note('hudChrome.options.gfxCustomNote'));

  // The per-system dial cards: the world's geometry/dressing layers in one,
  // the light-and-post passes in the other.
  const world: OptionsControl[] = [
    choice(s, 'terrainDetail', 'hud.options.terrainDetail', qualityLadderOptions, true),
    choice(s, 'foliageDensity', 'hud.options.foliageDensity', qualityLadderOptions, true),
    choice(s, 'surfaceDetail', 'hud.options.surfaceDetail', surfaceDetailOptions, true),
    choice(s, 'viewDistance', 'hudChrome.options.gfxViewDistance', qualityLadderOptions, true),
    choice(s, 'waterQuality', 'hudChrome.options.gfxWaterQuality', qualityLadderOptions, true),
    choice(s, 'characterDetail', 'hudChrome.options.gfxCharacterDetail', lowHighOptions, true),
  ];
  const lighting: OptionsControl[] = [
    choice(s, 'effectsQuality', 'hud.options.effectsQuality', effectsLadderOptions, true),
    choice(s, 'shadowQuality', 'hud.options.shadowQuality', qualityLadderOptions, true),
    choice(
      s,
      'ambientOcclusion',
      'hudChrome.options.gfxAmbientOcclusion',
      ambientOcclusionOptions,
      true,
    ),
    choice(s, 'bloomQuality', 'hudChrome.options.gfxBloom', offOnOptions, true),
    choice(s, 'antiAliasing', 'hudChrome.options.gfxAntiAliasing', offOnOptions, true),
    choice(s, 'dynamicLights', 'hudChrome.options.gfxDynamicLights', lowHighOptions, true),
    choice(
      s,
      'particleEffects',
      'hudChrome.options.gfxParticleEffects',
      effectsLadderOptions,
      true,
    ),
    // The per-effect switches ride the post chain: Effects & Lighting on Low
    // sheds that whole chain, so they have nothing to run on there.
    note('hudChrome.options.gfxEffectsNote'),
  ];

  const camera: OptionsControl[] = [slider(s, 'cameraSpeed', 'hud.options.cameraSpeed')];
  // Camera Speed only scales mouselook; touch gets a dedicated look-rate slider.
  if (env.touch) camera.push(slider(s, 'touchLookSpeed', 'hud.options.touchLookSpeed'));

  const display: OptionsControl[] = [
    slider(s, 'renderScale', 'hud.options.renderQuality'),
    slider(s, 'brightness', 'hud.options.brightness'),
    slider(s, 'cameraFov', 'hud.options.fieldOfView', 'degrees', 1),
    toggle(s, 'fullscreen', 'hud.options.fullscreen'),
    toggle(s, 'weather', 'game.settings.weather'),
    toggle(s, 'showOverflowXp', 'game.settings.showOverflowXp'),
  ];

  const system: OptionsControl[] = [
    choice(s, 'browserEffects', 'hudChrome.options.browserEffects', [
      { value: 0, labelKey: 'hudChrome.options.browserEffectsAuto' },
      { value: 1, labelKey: 'hudChrome.options.browserEffectsFull' },
      { value: 2, labelKey: 'hudChrome.options.browserEffectsReduced' },
      { value: 3, labelKey: 'hudChrome.options.browserEffectsMinimal' },
    ]),
    note('hudChrome.options.browserEffectsNote'),
  ];
  // Desktop vs on-screen touch controls. Hidden in the native shell (forces touch).
  if (!env.nativeShell) {
    system.push(
      choice(
        s,
        'interfaceMode',
        'hudChrome.options.interfaceMode',
        [
          { value: 0, labelKey: 'hudChrome.options.interfaceModeAuto' },
          { value: 1, labelKey: 'hudChrome.options.interfaceModeDesktop' },
          { value: 2, labelKey: 'hudChrome.options.interfaceModeTouch' },
        ],
        true,
      ),
    );
    system.push(note('hudChrome.options.interfaceModeNote'));
  }

  // The two dial cards balance the columns (Quality + World left, Lighting +
  // Camera right); the row-style cards (Display, System, Touch) span FULL
  // width below them with their rows flowing two-up, so neither column ends
  // in a ragged gap. The dial cards are omitted on the native shell (its
  // memory profile owns the dial-mapped knobs, so they would be dead rows).
  const sections: GraphicsSection[] = [
    { titleKey: 'hudChrome.options.gfxSectionQuality', column: 1, controls: quality },
  ];
  if (!env.nativeShell) {
    sections.push(
      { titleKey: 'hudChrome.options.gfxSectionWorld', column: 1, controls: world },
      { titleKey: 'hudChrome.options.gfxSectionLighting', column: 2, controls: lighting },
    );
  }
  sections.push(
    { titleKey: 'hudChrome.options.gfxSectionCamera', column: 2, controls: camera },
    { titleKey: 'hudChrome.options.gfxSectionDisplay', column: 'full', controls: display },
    { titleKey: 'hudChrome.options.gfxSectionSystem', column: 'full', controls: system },
  );
  if (env.touch) {
    sections.push({
      titleKey: 'hudChrome.options.gfxSectionTouch',
      column: 'full',
      controls: [
        slider(s, 'touchOpacity', 'hud.options.touchOpacity'),
        slider(s, 'joystickScale', 'hud.options.joystickSize'),
        slider(s, 'actionButtonScale', 'hud.options.buttonSize'),
        slider(s, 'joystickDeadzone', 'hud.options.joystickDeadzone'),
        boolToggle(s, 'touchInvertLook', 'hud.options.invertLook'),
        // Camera joystick is hidden/off by default (swipe-look is primary);
        // left-handed layout already has a Key Bindings row (leftHandedTouch),
        // but is surfaced here too since it is squarely a touch/graphics-panel
        // concern for touch players.
        boolToggle(s, 'mobileCameraJoystick', 'hudChrome.options.mobileCameraJoystick'),
        boolToggle(s, 'leftHandedTouch', 'hudChrome.options.mobileLeftHanded'),
      ],
    });
  }
  return sections;
}

/** The one flatten both consumers share: the painter feeds the reset footer
 *  with flattenGraphicsSections(sections) over the SAME section objects it
 *  painted, so the card layout and the reset-key scope can never disagree. */
export function flattenGraphicsSections(sections: GraphicsSection[]): OptionsControl[] {
  return sections.flatMap((section) => section.controls);
}

/** The Graphics sub-panel's controls as one flat list (the card sections in
 *  order), for the dispatch tests that pin the full set. */
export function buildGraphicsControls(s: OptionsSettingsSource, env: OptionsEnv): OptionsControl[] {
  return flattenGraphicsSections(buildGraphicsSections(s, env));
}

// ---------------------------------------------------------------------------
// Audio panel (cluster 4)
// ---------------------------------------------------------------------------

/** Body control rows for the Audio sub-panel: three volume sliders, the bespoke
 *  music on/off toggle (reads the live MusicDirector), then the three audio bool
 *  toggles. The painter appends the footer. */
export function buildAudioControls(s: OptionsSettingsSource): OptionsControl[] {
  return [
    slider(s, 'sfxVolume', 'hud.options.soundEffects'),
    slider(s, 'musicVolume', 'hud.options.musicVolume'),
    slider(s, 'voiceVolume', 'hud.options.voiceVolume'),
    { control: 'musicToggle', labelKey: 'hud.options.music' },
    boolToggle(s, 'voiceEnabled', 'hud.options.npcVoices'),
    boolToggle(s, 'footstepSfx', 'hudChrome.options.footstepSounds'),
    boolToggle(s, 'interfaceSfx', 'hudChrome.options.interfaceSounds'),
    boolToggle(s, 'clickFeedback', 'hudChrome.options.clickFeedback'),
  ];
}

// ---------------------------------------------------------------------------
// Controller panel (cluster 5) -- the enable/invert toggles + the three sliders.
// The per-button remap rows are bespoke (a dropdown per pad button) and live in
// the painter.
// ---------------------------------------------------------------------------

export function buildControllerControls(s: OptionsSettingsSource): OptionsControl[] {
  return [
    boolToggle(s, 'gamepadEnabled', 'hudChrome.controller.enable'),
    boolToggle(s, 'gamepadInvertY', 'hudChrome.controller.invertY'),
    slider(s, 'gamepadStickDeadzone', 'hudChrome.controller.deadzone'),
    slider(s, 'gamepadCameraSpeed', 'hudChrome.controller.cameraSpeed', 'oneDecimal'),
    slider(s, 'gamepadVibration', 'hudChrome.controller.vibration'),
  ];
}

// ---------------------------------------------------------------------------
// Interface & Comfort panel (cluster 5) -- split into four tabs (the interface
// list grew to ~40 rows in one scroll). The declarative controls below carry a
// `category` each; the painter renders one tab strip and filters the list per
// tab via interfaceControlsForTab(). The bespoke rows painted alongside them
// (language + theme in General, the chat-timestamp / chat-window-reset / deed-
// broadcast rows in Chat, the unit-frames-reset row in Frames) live in the
// painter and are placed by the same taxonomy. See INTERFACE_TAB_ORDER.
// ---------------------------------------------------------------------------

/** The four Interface-panel tabs, in strip order. Also the canonical set the
 *  completeness test partitions the control list against, so a control added
 *  without a category (or added to two tabs) fails the guard. */
export const INTERFACE_TAB_ORDER: readonly InterfaceTab[] = ['general', 'frames', 'chat', 'combat'];

/** The tab-strip label key per tab (short single words; rendered via t()). */
export const INTERFACE_TAB_LABEL_KEY: Record<InterfaceTab, TranslationKey> = {
  general: 'hudChrome.interfaceTabs.general',
  frames: 'hudChrome.interfaceTabs.frames',
  chat: 'hudChrome.interfaceTabs.chat',
  combat: 'hudChrome.interfaceTabs.combat',
};

// Stamp a category onto each control in a per-tab sub-list. Kept pure (a plain
// map) so the tagged list round-trips through the same determinism guard.
const tag = (category: InterfaceTab, controls: OptionsControl[]): OptionsControl[] =>
  controls.map((c): OptionsControl => ({ ...c, category }));

export function buildInterfaceControls(s: OptionsSettingsSource): OptionsControl[] {
  return [
    ...tag('general', [
      // uiScale commits on release: applying it live rescales the whole UI (the
      // options window included), which shoves the slider under the cursor and
      // makes the value hard to land (issue 1558).
      { ...slider(s, 'uiScale', 'hudChrome.options.uiScale'), commitOnChange: true },
      slider(s, 'hudOpacity', 'hud.options.hudOpacity'),
      slider(s, 'tooltipScale', 'hud.options.tooltipScale'),
      boolToggle(s, 'frostedPanels', 'hud.options.frostedPanels'),
      boolToggle(s, 'highContrastText', 'hud.options.highContrastText'),
      boolToggle(s, 'reduceMotion', 'hud.options.reduceMotion'),
      // Camera comfort (mouse-look direction), so it sits with the comfort
      // toggles rather than the Combat tab's attack/action-bar cluster.
      boolToggle(s, 'invertLookY', 'hud.options.invertLookY'),
      boolToggle(s, 'landingHighContrast', 'hudChrome.options.highContrastBackground'),
      boolToggle(s, 'showDevBadges', 'hudChrome.options.showDevBadges'),
      boolToggle(s, 'showWalletOnCharacterScreen', 'hudChrome.options.showWalletOnCharacterScreen'),
      boolToggle(s, 'showWalletOnPlayerCard', 'hudChrome.options.showWalletOnPlayerCard'),
      boolToggle(s, 'showDailyRewardsChest', 'hudChrome.options.showDailyRewardsChest'),
      boolToggle(s, 'showItemLevel', 'hudChrome.options.showItemLevel'),
      boolToggle(s, 'showOwnNameplate', 'hudChrome.options.showOwnNameplate'),
      boolToggle(s, 'showPlayerNameplates', 'hudChrome.options.showPlayerNameplates'),
    ]),
    ...tag('frames', [
      slider(s, 'playerFrameScale', 'hudChrome.options.playerFrameScale'),
      slider(s, 'targetFrameScale', 'hudChrome.options.targetFrameScale'),
      choice(s, 'partyFrameStyle', 'hudChrome.partyFrames.style', [
        { value: 0, labelKey: 'hudChrome.partyFrames.styleAutomatic' },
        { value: 1, labelKey: 'hudChrome.partyFrames.styleClassic' },
        { value: 2, labelKey: 'hudChrome.partyFrames.styleRaid' },
      ]),
      slider(s, 'partyFrameScale', 'hudChrome.partyFrames.scale'),
      slider(s, 'partyFrameWidth', 'hudChrome.partyFrames.width', 'oneDecimal', 5),
      slider(s, 'partyFrameHeight', 'hudChrome.partyFrames.height', 'oneDecimal', 2),
      slider(s, 'partyFrameSpacing', 'hudChrome.partyFrames.spacing', 'oneDecimal', 1),
      slider(s, 'partyFrameColumns', 'hudChrome.partyFrames.columns', 'oneDecimal', 1),
      choice(s, 'partyFrameHealthText', 'hudChrome.partyFrames.healthText', [
        { value: 0, labelKey: 'hudChrome.partyFrames.healthNone' },
        { value: 1, labelKey: 'hudChrome.partyFrames.healthPercent' },
        { value: 2, labelKey: 'hudChrome.partyFrames.healthCurrent' },
        { value: 3, labelKey: 'hudChrome.partyFrames.healthCurrentMax' },
      ]),
      choice(s, 'partyFrameSort', 'hudChrome.partyFrames.sort', [
        { value: 0, labelKey: 'hudChrome.partyFrames.sortGroup' },
        { value: 1, labelKey: 'hudChrome.partyFrames.sortRole' },
        { value: 2, labelKey: 'hudChrome.partyFrames.sortName' },
      ]),
      boolToggle(s, 'partyFrameShowResource', 'hudChrome.partyFrames.showResource'),
      boolToggle(s, 'partyFrameShowAbsorbs', 'hudChrome.partyFrames.showAbsorbs'),
      boolToggle(s, 'partyFrameShowAuras', 'hudChrome.partyFrames.showAuras'),
      boolToggle(s, 'partyFrameShowSelf', 'hudChrome.partyFrames.showSelf'),
      boolToggle(s, 'aurasOnPlayerFrame', 'hudChrome.options.aurasOnPlayerFrame'),
      boolToggle(s, 'showTargetOfTarget', 'hudChrome.options.showTargetOfTarget'),
      boolToggle(s, 'showPetFrame', 'hudChrome.options.showPetFrame'),
    ]),
    ...tag('chat', [
      slider(s, 'chatFontScale', 'hud.options.chatFontScale'),
      slider(s, 'chatOpacity', 'hud.options.chatOpacity'),
      boolToggle(s, 'compactChat', 'hud.options.compactChat'),
    ]),
    ...tag('combat', [
      boolToggle(s, 'startAttackOnAbilityUse', 'hudChrome.options.startAttackOnAbility'),
      boolToggle(
        s,
        'stopAutoAttackOnTargetSwitch',
        'hudChrome.options.stopAutoAttackOnTargetSwitch',
      ),
      boolToggle(s, 'showAttackButton', 'hudChrome.options.showAttackButton'),
      boolToggle(s, 'walkByAutoloot', 'hudChrome.options.walkByAutoloot'),
      boolToggle(s, 'groundReticle', 'hudChrome.options.groundReticle'),
      boolToggle(s, 'mouseoverCast', 'hudChrome.options.mouseoverCast'),
      boolToggle(s, 'stickyTarget', 'hudChrome.options.stickyTarget'),
      slider(s, 'fctScale', 'hud.options.fctScale'),
      boolToggle(s, 'showSecondaryActionBar', 'hudChrome.options.showSecondaryActionBar', {
        rerender: true,
      }),
      boolToggle(s, 'showThirdActionBar', 'hudChrome.options.showThirdActionBar', {
        disabled: !s.bool('showSecondaryActionBar'),
      }),
      boolToggle(s, 'hideUnusedActionSlots', 'hudChrome.options.hideUnusedActionSlots'),
      boolToggle(s, 'lockActionBars', 'hudChrome.options.lockActionBars'),
    ]),
  ];
}

/** Keys of the controls in `controls` that write a GameSettings value: sliders,
 *  toggles, boolToggles and choices all carry a `key`. NoteControl (a display-only
 *  line) and MusicToggleControl (reads the live MusicDirector, not a stored
 *  setting) carry no key and are skipped. Used to scope a sub-view's "Reset to
 *  Defaults" button to only the settings that view actually renders, instead of
 *  resetting the whole GameSettings object (issue 2341). */
export function optionsControlKeys(controls: OptionsControl[]): string[] {
  const keys = new Set<string>();
  for (const c of controls) {
    if (c.control === 'note' || c.control === 'musicToggle') continue;
    keys.add(c.key);
  }
  return [...keys];
}

/** The interface controls that belong to `tab`, in declaration order. The
 *  painter calls this per tab; the completeness test partitions the full list
 *  through it (union across INTERFACE_TAB_ORDER equals the full list, no dupes). */
export function interfaceControlsForTab(
  controls: OptionsControl[],
  tab: InterfaceTab,
): OptionsControl[] {
  const seen = new Set<string>();
  return controls.filter((c) => {
    if (c.category !== tab) return false;
    if (c.control === 'note' || c.control === 'musicToggle') return true;
    if (seen.has(c.key)) return false;
    seen.add(c.key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Bug report (cluster 2) -- the ONE slice of IWorld the options window reads, so
// it is the ClientWorld-vs-Sim parity surface. The painter formats
// the coords; this core returns the raw values so both world shapes round-trip
// to the same info block.
// ---------------------------------------------------------------------------

export interface BugReportPlayer {
  name: string;
  pos: { x: number; y: number; z: number };
}

export interface BugReportInfo {
  /** True when the realm is known; the painter shows the 'unknown' key when false. */
  realmKnown: boolean;
  realm: string;
  characterName: string;
  pos: { x: number; y: number; z: number };
}

export function buildBugReportInfo(
  realm: string | null | undefined,
  player: BugReportPlayer,
): BugReportInfo {
  const known = !!realm;
  return {
    realmKnown: known,
    realm: known ? (realm as string) : '',
    characterName: player.name,
    pos: { x: player.pos.x, y: player.pos.y, z: player.pos.z },
  };
}
