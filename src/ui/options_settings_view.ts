// The Settings view's category rail, as a pure model (issue #1653). The Esc
// menu's Settings row opens a full-screen view whose categories stay visible
// at all times, so any category is one press from any other; this core decides
// which categories the rail lists on this host, which one a sub-view belongs
// to, and where the Settings row lands. The DOM half is
// options_settings_rail_controller.ts; the category bodies are the options
// window's existing sub-panel painters, unchanged.
//
// i18n-free like every UI_PURE_CORES entry: it hands out label KEYS only.

import type { TranslationKey } from './i18n.catalog';
import type { OptionsPanelId } from './options_view';

/** The rail's categories, in rail order. Each id is the options window's own
 *  sub-view id, so a rail press routes exactly as a menu press used to. */
export const SETTINGS_CATEGORY_IDS = [
  'graphics',
  'interface',
  'keybinds',
  'controller',
  'overlays',
  'audio',
  'transfer',
] as const;
export type SettingsCategoryId = (typeof SETTINGS_CATEGORY_IDS)[number];

const LABEL_KEYS: Readonly<Record<SettingsCategoryId, TranslationKey>> = {
  graphics: 'hud.options.graphics',
  interface: 'hud.options.interface',
  keybinds: 'hud.options.keyBindings',
  controller: 'hudChrome.controller.title',
  overlays: 'hudChrome.options.overlays',
  audio: 'hud.options.audio',
  transfer: 'hudChrome.fullTransfer.menu',
};

/** Sub-views that live one level under a category: the Overlays panels. */
const CHILD_CATEGORY: Readonly<Partial<Record<OptionsPanelId, SettingsCategoryId>>> = {
  auras: 'overlays',
  cooldowns: 'overlays',
  performance: 'overlays',
};

export interface SettingsRailEnv {
  /** The touch interface is active (useTouchInterface or the native shell).
   *  Keyboard key bindings are desktop-only, so the rail drops them there. */
  touch: boolean;
}

export interface SettingsRailEntry {
  id: SettingsCategoryId;
  labelKey: TranslationKey;
  /** The category the open sub-view belongs to (a child panel marks its parent). */
  current: boolean;
}

/** Whether a category applies on this host. */
export function settingsCategoryAvailable(id: SettingsCategoryId, env: SettingsRailEnv): boolean {
  return !(id === 'keybinds' && env.touch);
}

/** The category a sub-view belongs to, or null for a view outside Settings
 *  (the Esc menu itself and Report a Bug). */
export function settingsCategoryOf(view: 'main' | OptionsPanelId): SettingsCategoryId | null {
  if ((SETTINGS_CATEGORY_IDS as readonly string[]).includes(view)) {
    return view as SettingsCategoryId;
  }
  return CHILD_CATEGORY[view as OptionsPanelId] ?? null;
}

/** The rail for this host, with the open sub-view's category marked current. */
export function buildSettingsRail(
  view: 'main' | OptionsPanelId,
  env: SettingsRailEnv,
): SettingsRailEntry[] {
  const current = settingsCategoryOf(view);
  return SETTINGS_CATEGORY_IDS.filter((id) => settingsCategoryAvailable(id, env)).map((id) => ({
    id,
    labelKey: LABEL_KEYS[id],
    current: id === current,
  }));
}

/** Where the Esc menu's Settings row lands: the category visited last this
 *  session when it still applies on this host, else the first available one. */
export function settingsEntryCategory(
  last: SettingsCategoryId | null,
  env: SettingsRailEnv,
): SettingsCategoryId {
  if (last && settingsCategoryAvailable(last, env)) return last;
  return SETTINGS_CATEGORY_IDS.find((id) => settingsCategoryAvailable(id, env)) ?? 'graphics';
}
