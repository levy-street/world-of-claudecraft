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
import {
  CATEGORIES,
  CATEGORY_SECTIONS,
  type CategoryId,
  categorySettingKeys,
  type EnvGating,
  type NonSettingSearchRow,
  type OptionRow,
  RAIL_GROUPS,
  type RailGroupId,
  rowEnv,
  SEARCH_SYNONYMS,
} from './options_ia';

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
}

export interface ToggleControl {
  control: 'toggle';
  /** A numeric 0/1 setting key (on when the stored value is >= 0.5). */
  key: string;
  labelKey: TranslationKey;
  on: boolean;
}

export interface BoolToggleControl {
  control: 'boolToggle';
  /** A BOOL_SETTINGS key (true/false stored directly). */
  key: string;
  labelKey: TranslationKey;
  on: boolean;
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
}

/** A standalone explanatory line rendered between controls (class set-note). */
export interface NoteControl {
  control: 'note';
  textKey: TranslationKey;
}

/** Position marker for the bespoke music on/off toggle inside the audio panel.
 *  It reads the live MusicDirector singleton, not a setting, so it carries only a
 *  label; the painter renders + dispatches it. */
export interface MusicToggleControl {
  control: 'musicToggle';
  labelKey: TranslationKey;
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
// Settings projection the control builders read from
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
): BoolToggleControl => ({ control: 'boolToggle', key, labelKey, on: s.bool(key) });

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
  current: Math.round(s.num(key)),
  options,
  rerender,
});

const note = (textKey: TranslationKey): NoteControl => ({ control: 'note', textKey });

// (The pre-redesign per-panel builders, buildOptionsMenu / buildGraphicsControls /
// buildAudioControls / buildControllerControls / buildInterfaceControls, are gone:
// the options_ia tree + renderCategory + buildControlFromRow below are the one
// live path since the Warden's Codex chrome landed, and the legacy builders had
// no consumer left outside their own green pins.)

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

// ===========================================================================
// The Warden's Codex desktop chrome (P2): rail + category detail view-models.
// ---------------------------------------------------------------------------
// These consume the landed options_ia tree (the IA of record) to produce the
// two structural models the painter renders: the vertical rail (groups +
// category tabs, with the per-category changed-from-defaults count) and a
// category's detail pane (env-filtered sections + rows). Both are DOM/i18n-free
// so a Vitest can pin their shape; the painter resolves label keys via t() and
// binds live values through buildControlFromRow (which reuses the existing
// private control builders above, so a row's dispatch stays byte-identical).
// ===========================================================================

/** Device/shell flags gating which categories + rows a host reveals (mirrors
 *  the runtime useTouchInterface()/isNativeAppShell() the painter resolves). */
export interface RailEnv {
  touch: boolean;
  nativeShell: boolean;
}

/** One rail category tab. The conflict slot is reserved for P4 (always false
 *  in P2); the changed count is wired now from the category-to-keys map. */
export interface RailTabModel {
  id: CategoryId;
  iconSlug: string;
  nameKey: TranslationKey;
  subheadKey: TranslationKey;
  changedCount: number;
  hasConflict: boolean;
}

export interface RailGroupModel {
  id: RailGroupId;
  labelKey: TranslationKey;
  tabs: RailTabModel[];
}

/** The full rail: the Overview landing tab (above the groups) + the three
 *  rail groups, each holding its env-visible category tabs. */
export interface RailModel {
  overview: RailTabModel;
  groups: RailGroupModel[];
}

/** True when a category is revealed under the given host environment. The
 *  touch-only Touch category hides on desktop; the desktop-only Keybinds
 *  category hides on touch (nativeShellHidden is a ROW gate, not a category). */
function categoryVisible(env: EnvGating | undefined, e: RailEnv): boolean {
  if (!env) return true;
  if (env.touchOnly && !e.touch) return false;
  if (env.desktopOnly && e.touch) return false;
  return true;
}

/** The effective row gating: the row's own markers merged over its category's,
 *  resolved against the live host environment (see options_ia.rowEnv). */
function rowVisible(row: OptionRow, catEnv: EnvGating | undefined, e: RailEnv): boolean {
  const env: EnvGating = { ...(catEnv ?? {}), ...(row.env ?? {}) };
  if (env.touchOnly && !e.touch) return false;
  if (env.desktopOnly && e.touch) return false;
  if (env.nativeShellHidden && e.nativeShell) return false;
  return true;
}

/** The rail model: Overview first, then Display/Input/System groups with their
 *  env-visible categories. `changedCount(id)` supplies the per-category
 *  changed-from-defaults count (the painter computes it against the live
 *  settings + the SETTING_RANGES/BOOL_SETTINGS defaults). */
export function renderRailModel(e: RailEnv, changedCount: (id: CategoryId) => number): RailModel {
  const tabOf = (c: (typeof CATEGORIES)[number]): RailTabModel => ({
    id: c.id,
    iconSlug: c.iconSlug,
    nameKey: c.nameKey,
    subheadKey: c.subheadKey,
    changedCount: changedCount(c.id),
    hasConflict: false,
  });
  const overview = CATEGORIES.find((c) => c.id === 'overview');
  const groups: RailGroupModel[] = RAIL_GROUPS.map((g) => ({
    id: g.id,
    labelKey: g.labelKey,
    tabs: CATEGORIES.filter((c) => c.group === g.id && categoryVisible(c.env, e)).map(tabOf),
  }));
  return { overview: tabOf(overview as (typeof CATEGORIES)[number]), groups };
}

/** Section heads (spec section 4): a t() key per structural section id. Kept
 *  here (not in options_ia) so the P1 IA-of-record stays untouched; the comment
 *  in options_ia predicted "section HEAD keys are P2 chrome". Section ids are
 *  unique across the tree, so a flat map is unambiguous. */
export const SECTION_HEAD_KEYS: Record<string, TranslationKey> = {
  quality: 'hudChrome.options.sec.quality',
  view: 'hudChrome.options.sec.view',
  general: 'hudChrome.options.sec.general',
  scaleText: 'hudChrome.options.sec.scaleText',
  panels: 'hudChrome.options.sec.panels',
  unitFrames: 'hudChrome.options.sec.unitFrames',
  actionBars: 'hudChrome.options.sec.actionBars',
  chat: 'hudChrome.options.sec.chat',
  combatTooltips: 'hudChrome.options.sec.combatTooltips',
  hudExtras: 'hudChrome.options.sec.hudExtras',
  motionContrast: 'hudChrome.options.sec.motionContrast',
  content: 'hudChrome.options.sec.content',
  camera: 'hudChrome.options.sec.camera',
  movement: 'hudChrome.options.sec.movement',
  combat: 'hudChrome.options.sec.combat',
  feedback: 'hudChrome.options.sec.feedback',
  inputMode: 'hudChrome.options.sec.inputMode',
  feel: 'hudChrome.options.sec.feel',
  sticks: 'hudChrome.options.sec.sticks',
  look: 'hudChrome.options.sec.look',
  buttons: 'hudChrome.options.sec.buttons',
  volume: 'hudChrome.options.sec.volume',
  toggles: 'hudChrome.options.sec.toggles',
  performance: 'hudChrome.options.sec.performance',
  support: 'hudChrome.options.sec.support',
  about: 'hudChrome.options.sec.about',
};

/** The head key for a section id (falls back to the id when unmapped, which a
 *  test forbids for the shipped ids). */
export function sectionHeadKey(sectionId: string): TranslationKey {
  return SECTION_HEAD_KEYS[sectionId] ?? (sectionId as TranslationKey);
}

export interface CategoryDetailSection {
  id: string;
  headKey: TranslationKey;
  rows: OptionRow[];
}

export interface CategoryDetailModel {
  id: CategoryId;
  nameKey: TranslationKey;
  subheadKey: TranslationKey;
  sections: CategoryDetailSection[];
}

/** The detail-pane model for a category: its header/subhead keys plus its
 *  env-visible sections (an empty section is dropped). Overview carries no
 *  settings-key sections (its quick actions + pins are painted bespoke). */
export function renderCategory(id: CategoryId, e: RailEnv): CategoryDetailModel {
  const def = CATEGORIES.find((c) => c.id === id);
  const sections: CategoryDetailSection[] = CATEGORY_SECTIONS[id]
    .map((s) => ({
      id: s.id,
      headKey: sectionHeadKey(s.id),
      rows: s.rows.filter((r) => rowVisible(r, def?.env, e)),
    }))
    // Drop an empty section, and one left with only note rows after gating (e.g.
    // the Controls "Input Mode" section under the native shell, where the sole
    // control is hidden and only its explanatory note would remain).
    .filter((s) => s.rows.some((r) => r.control !== 'note'));
  return {
    id,
    nameKey: def?.nameKey ?? ('' as TranslationKey),
    subheadKey: def?.subheadKey ?? ('' as TranslationKey),
    sections,
  };
}

/** Bind a static OptionRow to a live OptionsControl by reusing the existing
 *  private control builders (so the rendered descriptor, and therefore the
 *  dispatch, is byte-identical to the old per-panel path). Returns null for the
 *  bespoke language / theme-preset rows, which the painter renders itself. The
 *  slider step mirrors the old builders: 1 for the degrees FOV slider, 0.05
 *  everywhere else. */
export function buildControlFromRow(
  s: OptionsSettingsSource,
  row: OptionRow,
): OptionsControl | null {
  switch (row.control) {
    case 'slider': {
      const step = row.fmt === 'degrees' ? 1 : 0.05;
      const base = slider(s, row.key as string, row.labelKey as TranslationKey, row.fmt, step);
      return row.commitOnChange ? { ...base, commitOnChange: true } : base;
    }
    case 'toggle':
      return toggle(s, row.key as string, row.labelKey as TranslationKey);
    case 'boolToggle':
      return boolToggle(s, row.key as string, row.labelKey as TranslationKey);
    case 'choice':
      return choice(
        s,
        row.key as string,
        row.labelKey as TranslationKey,
        row.choices ?? [],
        row.rerender ?? false,
      );
    case 'note':
      return note(row.textKey as TranslationKey);
    case 'musicToggle':
      return { control: 'musicToggle', labelKey: row.labelKey as TranslationKey };
    default:
      // 'language' | 'themePreset' | 'chatTimestamps' | 'chatClock': bespoke rows
      // (no settings.ts key) the painter renders directly.
      return null;
  }
}

// ---------------------------------------------------------------------------
// Environment-gated control binding: the ONE cap/gating path (S1)
// ---------------------------------------------------------------------------

/** The native app shell caps the graphics preset at High: the Ultra / Advanced
 *  tiers (4 / 5) are desktop-browser-only. One named threshold, shared by every
 *  render path so a mirror row can never offer a capped preset. */
export const NATIVE_SHELL_MAX_GRAPHICS_PRESET = 3;

/** True when the merged environment gating for a row admits the given host
 *  environment. A keyed row resolves through rowEnv (its own markers merged over
 *  its home category's); a keyless row carries only its own markers. */
function rowAllowedInEnv(row: OptionRow, e: RailEnv): boolean {
  const env: EnvGating = row.key ? rowEnv(row.key) : (row.env ?? {});
  if (env.touchOnly && !e.touch) return false;
  if (env.desktopOnly && e.touch) return false;
  if (env.nativeShellHidden && e.nativeShell) return false;
  return true;
}

/** Bind a row to a live control with the host environment applied. This is the
 *  ONE gating path every render surface uses (the category detail pane, the
 *  Overview pinned mirrors, the global search results), so the two env rules can
 *  never be bypassed by a mirror row:
 *  - an env-hidden row (e.g. the nativeShellHidden interfaceMode under the native
 *    shell) returns null instead of a control;
 *  - the native-shell graphicsPreset choice is capped at High wherever it renders.
 *  Bespoke rows (language, theme, chat timestamps) still return null; the painter
 *  renders them itself after its own gating. */
export function buildEnvGatedControl(
  s: OptionsSettingsSource,
  row: OptionRow,
  e: RailEnv,
): OptionsControl | null {
  if (!rowAllowedInEnv(row, e)) return null;
  const control = buildControlFromRow(s, row);
  if (!control) return null;
  if (control.control === 'choice' && row.key === 'graphicsPreset' && e.nativeShell)
    control.options = control.options.filter((o) => o.value <= NATIVE_SHELL_MAX_GRAPHICS_PRESET);
  return control;
}

/** The per-category changed-from-defaults count: how many of a category's
 *  homed settings keys currently differ from their default. `changed(key)` is
 *  supplied by the painter (which reads the live value vs the range/bool def). */
export function categoryChangedCount(id: CategoryId, changed: (key: string) => boolean): number {
  return categorySettingKeys(id).filter(changed).length;
}

/** The total changed-from-defaults count across every homed key (Overview has
 *  none of its own; its pins are mirrors of other categories' keys). */
export function totalChangedCount(changed: (key: string) => boolean): number {
  let n = 0;
  for (const c of CATEGORIES) n += categorySettingKeys(c.id).filter(changed).length;
  return n;
}

/** The keys a scoped "Reset [category]" restores: exactly that category's homed
 *  settings keys (the painter resets each to its default and re-applies it). */
export function categoryResetKeys(id: CategoryId): string[] {
  return categorySettingKeys(id);
}

/** Section-scope search: does a row match the query? The label TEXT is resolved
 *  by the painter (t() is a runtime dependency); a query also matches through
 *  the explicit synonym overlay (e.g. "fps" -> showFps). An empty query matches
 *  everything (the full category shows). */
export function rowMatchesQuery(labelText: string, settingKey: string, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  if (labelText.toLowerCase().includes(q)) return true;
  for (const [term, target] of Object.entries(SEARCH_SYNONYMS)) {
    if (target === settingKey && term.toLowerCase().includes(q)) return true;
  }
  return false;
}

/** Global / section search for a NON-settings row (language, theme preset): matches
 *  its label OR any explicit synonym (contains-match, mirroring rowMatchesQuery and
 *  the synonym overlay semantics). An empty query matches. These rows carry no
 *  settings key, so they are searched through this helper rather than rowMatchesQuery
 *  + the settings-key SEARCH_SYNONYMS overlay. */
export function nonSettingRowMatches(
  row: NonSettingSearchRow,
  labelText: string,
  rawQuery: string,
): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  if (labelText.toLowerCase().includes(q)) return true;
  return row.synonyms.some((term) => term.toLowerCase().includes(q));
}
