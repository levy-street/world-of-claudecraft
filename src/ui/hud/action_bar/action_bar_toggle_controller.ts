// The small plus/minus buttons at the end of the primary action bar (#actionbar)
// that reveal or hide the optional desktop rows (#actionbar2/#actionbar3). A cold,
// click-driven control: it owns no repeating driver and reads no layout. Clicks
// route the matching visibility SETTING through deps.apply (the optionsHooks
// onSettingChange seam), so the Interface options checkboxes, the persisted
// settings, the body classes, and the dependency rule (third requires secondary,
// resolved centrally in main.ts via resolveActionBarVisibility) all stay the
// single source of truth; the buttons never toggle a class themselves. The
// coordinator pushes the resolved visibility back through sync(), which is the
// only state this module holds.

import type { TranslationKey } from '../../i18n';
import { actionBarToggleModel } from './action_bar_toggle_core';
import type { ActionBarVisibility, ActionBarVisibilitySetting } from './action_bar_visibility_core';

const SHOW_KEY: TranslationKey = 'hudChrome.actionBar.showExtraBar';
const HIDE_KEY: TranslationKey = 'hudChrome.actionBar.hideExtraBar';

export interface ActionBarToggleDeps {
  /** The primary action bar row the control appends itself to. */
  container: HTMLElement;
  document: Document;
  /** Row visibility at install time (the live settings when available), so the
   *  buttons never depend on the coordinator's later sync arriving in order. */
  initial?: ActionBarVisibility;
  t(key: TranslationKey): string;
  /** Route a visibility setting change through optionsHooks.onSettingChange. */
  apply(setting: ActionBarVisibilitySetting, value: boolean): void;
  /** Attach the shared HUD tooltip to a button (hud.attachTooltip). */
  tooltip(el: HTMLElement, text: () => string): void;
}

export interface ActionBarToggleControl {
  /** Re-derive both buttons from the resolved visibility (main.ts applySetting). */
  sync(visibility: ActionBarVisibility): void;
}

export function installActionBarToggle(deps: ActionBarToggleDeps): ActionBarToggleControl {
  // Seed from the live settings when the host has them (both rows default off);
  // the boot apply-all loop and every later change re-sync through the same
  // setter the options window uses.
  let visibility: ActionBarVisibility = {
    secondary: deps.initial?.secondary ?? false,
    third: deps.initial?.third ?? false,
  };

  const makeButton = (
    glyph: string,
    labelKey: TranslationKey,
    onClick: () => void,
  ): HTMLButtonElement => {
    const btn = deps.document.createElement('button');
    btn.type = 'button';
    btn.className = 'bar-toggle-btn';
    btn.textContent = glyph;
    // The live aria-label plus the data-i18n-aria attribute, so translatePage
    // re-resolves it on a runtime language switch (the daily-rewards idiom).
    btn.setAttribute('data-i18n-aria', labelKey);
    btn.setAttribute('aria-label', deps.t(labelKey));
    deps.tooltip(btn, () => deps.t(labelKey));
    btn.addEventListener('click', () => {
      onClick();
      btn.blur();
    });
    return btn;
  };

  const plusBtn = makeButton('+', SHOW_KEY, () => {
    const action = actionBarToggleModel(visibility).expand;
    if (action) deps.apply(action.setting, action.value);
  });
  const minusBtn = makeButton('-', HIDE_KEY, () => {
    const action = actionBarToggleModel(visibility).collapse;
    if (action) deps.apply(action.setting, action.value);
  });

  const wrap = deps.document.createElement('div');
  wrap.className = 'bar-toggle';
  wrap.append(plusBtn, minusBtn);
  deps.container.appendChild(wrap);

  const control: ActionBarToggleControl = {
    sync(next: ActionBarVisibility): void {
      visibility = { secondary: next.secondary, third: next.third };
      const model = actionBarToggleModel(visibility);
      plusBtn.disabled = model.expand === null;
      minusBtn.disabled = model.collapse === null;
    },
  };
  control.sync(visibility);
  return control;
}
