// The Settings view's persistent category rail (issue #1653): the DOM half of
// the pure options_settings_view.ts core. The options window calls sync() on
// every render (the full-screen classes follow the open view) and mount() from
// its window shell, so every category body (the window's existing sub-panel
// painters, unchanged) gets the rail seated after its head however it repaints:
// a full render, a sub-panel's own self-rerender through the shell, or the
// Performance panel's self-contained rebuild (its afterRender hook).
//
// The rail is a <nav> of plain buttons with aria-current on the open category:
// every category is one Tab stop (and Arrow / Home / End move between them), a
// press repaints the window on that category and puts focus back on the rail,
// so a keyboard player can walk the categories without losing their place.
// Named *_controller so it sits in the painter gate's cold bucket
// (tests/hud_perf_budget.test.ts); registered in UI_DOM_MODULES.

import { audio } from '../game/audio';
import { isNativeAppShell, useTouchInterface } from '../game/mobile_controls';
import { t } from './i18n';
import {
  buildSettingsRail,
  type SettingsCategoryId,
  type SettingsRailEnv,
  settingsCategoryOf,
  settingsEntryCategory,
} from './options_settings_view';
import type { OptionsPanelId } from './options_view';
import { rovingTarget } from './roving_index';

/** Classes the open Settings view carries on the window root. The second is
 *  the generic full-screen marker the drag and resize gestures stand down on. */
export const SETTINGS_VIEW_CLASS = 'options-settings';
export const FULLSCREEN_WINDOW_CLASS = 'window-fullscreen';

/** The touch interface (or the native shell, which forces it) is up. */
function railEnv(): SettingsRailEnv {
  return { touch: useTouchInterface() || isNativeAppShell() };
}

export class OptionsSettingsRail {
  // The category visited last this session, so the Esc menu's Settings row
  // returns to it (a field, not a persisted setting, like the Interface tab).
  private last: SettingsCategoryId | null = null;

  /** `select` routes a rail press: the window opens that category. */
  constructor(private readonly select: (id: SettingsCategoryId) => void) {}

  /** Where the Esc menu's Settings row lands on this host. */
  entryCategory(): SettingsCategoryId {
    return settingsEntryCategory(this.last, railEnv());
  }

  /** Run on every window render: the full-screen classes follow the view. */
  sync(root: HTMLElement, view: 'main' | OptionsPanelId): void {
    const category = settingsCategoryOf(view);
    if (category) this.last = category;
    root.classList.toggle(SETTINGS_VIEW_CLASS, category !== null);
    root.classList.toggle(FULLSCREEN_WINDOW_CLASS, category !== null);
  }

  /** Seat the rail after the head of a freshly painted Settings view (no-op
   *  for a view outside Settings). Idempotent: a repaint replaces it. */
  mount(root: HTMLElement, view: 'main' | OptionsPanelId): void {
    root.querySelector(':scope > .opt-rail')?.remove();
    if (settingsCategoryOf(view) === null) return;
    const nav = document.createElement('nav');
    nav.className = 'opt-rail';
    nav.setAttribute('aria-label', t('hudChrome.options.settingsCategories'));
    const title = document.createElement('div');
    title.className = 'opt-rail-title ui-win-title';
    title.setAttribute('aria-hidden', 'true');
    title.textContent = t('hudChrome.options.settings');
    nav.appendChild(title);
    const buttons = buildSettingsRail(view, railEnv()).map((entry) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = entry.current
        ? 'btn ui-btn opt-rail-btn ui-btn--on'
        : 'btn ui-btn opt-rail-btn';
      b.dataset.settingsCategory = entry.id;
      b.textContent = t(entry.labelKey);
      if (entry.current) b.setAttribute('aria-current', 'page');
      b.addEventListener('click', () => {
        audio.click();
        this.select(entry.id);
      });
      nav.appendChild(b);
      return b;
    });
    nav.addEventListener('keydown', (e) => {
      const i = buttons.indexOf(e.target as HTMLButtonElement);
      if (i < 0) return;
      const next = rovingTarget(e.key, i, buttons.length, 'both');
      if (next === null) return;
      e.preventDefault();
      buttons[next]?.focus();
    });
    const head = root.querySelector(':scope > .ui-win-head, :scope > .panel-title');
    if (head) head.after(nav);
    else root.prepend(nav);
  }

  /** Put focus on the open category's rail button (after a rail press or on
   *  entering Settings, whose repaint destroyed the focused control). */
  focusCurrent(root: HTMLElement): void {
    root.querySelector<HTMLElement>('.opt-rail [aria-current="page"]')?.focus();
  }
}
