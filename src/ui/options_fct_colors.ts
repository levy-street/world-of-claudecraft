// Interface > Combat > Combat Text Colors: the entry row on the Combat tab and the panel it
// opens. One row per kind of combat number: a live sample drawn with the real floating
// combat text classes, a colour picker, and a Custom / Default choice. Kept out of
// options_window.ts, which sits at its line ceiling (tests/monolith_budget.test.ts), so the
// window only asks this module whether the panel is open and where to paint it.

import { audio } from '../game/audio';
import {
  FCT_COLOR_DEFAULTS,
  FCT_COLOR_SLOTS,
  type FctColorHooks,
  type FctColorSlot,
} from './fct_colors';
import { t } from './i18n';
import type { TranslationKey } from './i18n.catalog';

// The options window is a single instance, so the panel's open state lives here. Every
// way out of the Combat tab (a tab switch, Back, reopening the window) closes it.
let panelOpen = false;

/** Close the panel (the window calls this wherever it leaves the Combat tab). */
export function closeFctColorsPanel(): void {
  panelOpen = false;
}

/** The floater classes and sample text each slot previews with (the vivid look's own). */
function sample(slot: FctColorSlot): { cls: string; text: string } {
  switch (slot) {
    case 'white':
      return { cls: 'fct-damage-done-auto', text: '642' };
    case 'whiteCrit':
      return { cls: 'fct-damage-done-auto crit', text: '1284!' };
    case 'ability':
      return { cls: 'fct-damage-done-ability', text: '918' };
    case 'abilityCrit':
      return { cls: 'fct-damage-done-ability crit', text: '1836!' };
    case 'dot':
      return { cls: 'fct-damage-done-ability fct-dot', text: '96' };
    case 'dotCrit':
      return { cls: 'fct-damage-done-ability fct-dot crit', text: '192!' };
    case 'heal':
      return { cls: 'fct-heal', text: '+412' };
    case 'healCrit':
      return { cls: 'fct-heal crit', text: '+824!' };
    case 'hot':
      return { cls: 'fct-heal fct-dot', text: '+64' };
    case 'hotCrit':
      return { cls: 'fct-heal fct-dot crit', text: '+128!' };
    case 'pet':
      return { cls: 'fct-damage-done-ability fct-pet', text: '58' };
    case 'petCrit':
      return { cls: 'fct-damage-done-ability fct-pet crit', text: '116!' };
    case 'block':
      return { cls: 'fct-damage-done-block', text: t('hud.combat.floatingBlock', { amount: 88 }) };
    case 'avoid':
      return { cls: 'fct-miss-other', text: t('hud.combat.floatingMiss') };
    case 'absorb':
      return { cls: 'fct-absorb', text: t('hudChrome.fct.absorbed', { amount: 120 }) };
    case 'taken':
      return { cls: 'fct-damage-taken', text: '-245' };
    case 'takenCrit':
      return { cls: 'fct-damage-taken crit', text: '-490!' };
  }
}

function button(text: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn ui-btn ui-btn--plate set-toggle ${className}`;
  b.textContent = text;
  b.addEventListener('click', () => {
    audio.click();
    onClick();
  });
  return b;
}

/** The Combat tab's "Combat Text Colors [Customize]" row. Absent hooks: no row. */
export function fctColorsEntryRow(
  body: HTMLElement,
  hooks: FctColorHooks | undefined,
  rerender: () => void,
): void {
  if (!hooks) return;
  const row = document.createElement('div');
  row.className = 'set-row ui-stat-row';
  const name = document.createElement('span');
  name.className = 'set-name';
  name.textContent = t('hudChrome.fctColors.title');
  row.append(
    name,
    button(t('hudChrome.fctColors.open'), 'fct-colors-open', () => {
      panelOpen = true;
      rerender();
      document.querySelector<HTMLElement>('.fct-colors-back')?.focus();
    }),
  );
  body.append(row);
}

/**
 * Paint the Combat Text Colors panel into `body` when it is open. Returns false (painting
 * nothing) when it is closed or the host wired no hooks, so the Combat tab renders as usual.
 */
export function fctColorsPanel(
  body: HTMLElement,
  hooks: FctColorHooks | undefined,
  rerender: () => void,
): boolean {
  if (!panelOpen || !hooks) return false;
  const head = document.createElement('div');
  head.className = 'set-row ui-stat-row fct-colors-head';
  const title = document.createElement('span');
  title.className = 'set-name';
  title.textContent = t('hudChrome.fctColors.title');
  const resetAll = button(t('hudChrome.fctColors.resetAll'), 'fct-colors-reset', () => {
    hooks.reset();
    rerender();
  });
  resetAll.disabled = Object.keys(hooks.get()).length === 0;
  const back = button(t('hudChrome.fctColors.back'), 'fct-colors-back', () => {
    panelOpen = false;
    rerender();
    document.querySelector<HTMLElement>('.fct-colors-open')?.focus();
  });
  head.append(title, resetAll, back);
  const note = document.createElement('div');
  note.className = 'set-note';
  note.textContent = t('hudChrome.fctColors.note');
  const list = document.createElement('div');
  list.className = 'fct-colors-list';
  const state = hooks.get();
  for (const slot of FCT_COLOR_SLOTS) list.append(colorRow(slot, state[slot], hooks, resetAll));
  body.append(head, note, list);
  return true;
}

function colorRow(
  slot: FctColorSlot,
  custom: string | undefined,
  hooks: FctColorHooks,
  resetAll: HTMLButtonElement,
): HTMLElement {
  const label = t(`hudChrome.fctColors.slot.${slot}` as TranslationKey);
  const row = document.createElement('div');
  row.className = 'set-row ui-stat-row fct-color-row';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', label);
  const name = document.createElement('span');
  name.className = 'set-name';
  name.textContent = label;
  // The sample is a real floater node (static here), so a Custom colour previews live
  // through the same body-class rule the combat text uses.
  const look = sample(slot);
  const preview = document.createElement('span');
  preview.className = 'fct-color-sample';
  preview.setAttribute('aria-hidden', 'true');
  const num = document.createElement('span');
  num.className = `fct fct-vivid ${look.cls}`;
  num.textContent = look.text;
  preview.append(num);

  const picker = document.createElement('input');
  picker.type = 'color';
  picker.className = 'set-color';
  picker.value = custom ?? FCT_COLOR_DEFAULTS[slot];
  picker.setAttribute('aria-label', label);

  const choice = (key: TranslationKey, checked: boolean) => {
    const wrap = document.createElement('label');
    wrap.className = 'fct-color-choice';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = `fct-color-${slot}`;
    radio.checked = checked;
    wrap.append(radio, document.createTextNode(t(key)));
    return { wrap, radio };
  };
  const customChoice = choice('hudChrome.fctColors.custom', custom !== undefined);
  const defaultChoice = choice('hudChrome.fctColors.default', custom === undefined);

  const setCustom = () => {
    hooks.set(slot, picker.value);
    customChoice.radio.checked = true;
    resetAll.disabled = false;
  };
  // 'input' fires while dragging in the picker: a live preview on the sample and in combat.
  picker.addEventListener('input', setCustom);
  customChoice.radio.addEventListener('change', setCustom);
  defaultChoice.radio.addEventListener('change', () => {
    hooks.set(slot, null);
    picker.value = FCT_COLOR_DEFAULTS[slot];
    resetAll.disabled = Object.keys(hooks.get()).length === 0;
  });
  row.append(name, preview, picker, customChoice.wrap, defaultChoice.wrap);
  return row;
}
