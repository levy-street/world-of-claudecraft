// Two Options-panel row shapes beside the On/Off plate rows options_window.ts
// paints: a gold group heading, and a checkbox row for a set of independent
// options any mix of which may be on at once (Interface > Combat's Style of
// Enemy Highlight). The checkbox row writes the same bool settings store and
// fires the same onSettingChange dispatch as the plate toggle; only the
// control's shape differs, so Reset to Defaults and the apply path are shared.

import { audio } from '../game/audio';
import type { BoolSettingKey } from '../game/settings';
import { FOCUS_KEY_ATTR } from './focus_restore';
import type { OptionsHooks } from './hud';
import { t } from './i18n';
import type { TranslationKey } from './i18n.catalog';
import { optionsText } from './options_text_values';
import type { BoolToggleControl } from './options_view';

/** A gold `.set-subhead` heading that titles the rows painted under it. */
export function optionsSubheadRow(parent: HTMLElement, text: string): void {
  const head = document.createElement('div');
  head.className = 'set-subhead';
  head.textContent = text;
  parent.appendChild(head);
}

/** A whole-row `<label>` holding a native checkbox and its name, so the full
 *  row is the tap target. Keyed for focus restore and rerender lookup exactly
 *  like the plate toggle (`data-setting-key` / `data-focus-key`). */
export function optionsCheckRow(
  parent: HTMLElement,
  c: BoolToggleControl,
  hooks: Pick<OptionsHooks, 'settings' | 'onSettingChange'>,
): void {
  const key = c.key as BoolSettingKey;
  const row = document.createElement('label');
  row.className = 'set-row set-check-row';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.className = 'ui-check';
  box.dataset.settingKey = key;
  box.setAttribute(FOCUS_KEY_ATTR, key);
  box.checked = hooks.settings.get(key);
  box.disabled = c.disabled ?? false;
  const name = document.createElement('span');
  name.className = 'set-name';
  name.textContent = t(c.labelKey);
  box.addEventListener('change', () => {
    audio.click();
    hooks.onSettingChange(key, hooks.settings.set(key, box.checked));
    box.checked = hooks.settings.get(key);
  });
  row.append(box, name);
  parent.appendChild(row);
}
export function optionsNoteRow(
  parent: HTMLElement,
  textKey: TranslationKey,
  valueKeys?: Record<string, TranslationKey>,
): void {
  const note = document.createElement('div');
  note.className = 'set-note';
  // The view names its placeholders as keys and this resolves them, so the
  // whole sentence including the value stays one translatable string.
  note.textContent = optionsText(textKey, valueKeys);
  parent.appendChild(note);
}
