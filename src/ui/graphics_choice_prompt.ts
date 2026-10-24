// First-login graphics prompt: a one-shot modal on a player's first world entry in a browser
// that asks which graphics preset to play on (Auto, Low, Medium, High, Ultra). It runs inside
// main.ts's prepareWorldEntry, BEFORE the renderer exists, because the preset decides the render
// tier and preload set at renderer construction (initGfxTier re-reads the stored preset there), so
// the answer takes effect on this very entry with no reload.
//
// Self-contained top-level modal (the shape of the retired first-run camera prompt): it owns its
// backdrop, accessibility wiring, and the persisted graphicsPromptAnswered marker. The policy
// (options, parsing, what a choice persists, when to ask) is graphics_choice_core.ts.

import { isNativeAppShell, isPhoneTouchDevice } from '../game/mobile_controls';
import { SETTING_RANGES, Settings } from '../game/settings';
import { detectedDefaultGraphicsPreset, forcedTierFromSearch } from '../render/gfx';
import { markDialogRoot } from './dialog_root';
import { graphicsPresetDisplayName } from './entry_guard_banner';
import { FocusManager } from './focus_manager';
import {
  GRAPHICS_CHOICE_AUTO,
  type GraphicsChoice,
  type GraphicsChoiceOption,
  graphicsChoiceOptions,
  graphicsChoicePatch,
  parseGraphicsChoice,
  shouldPromptGraphicsChoice,
} from './graphics_choice_core';
import { t } from './i18n';

const RADIO_NAME = 'graphics-prompt-choice';

let pending: Promise<void> | null = null;
const focusManager = new FocusManager();

/**
 * Resolve once the player has a graphics preset to enter the world on: immediately when the
 * prompt was already answered in this browser (or shouldPromptGraphicsChoice skips it), otherwise
 * after the player confirms a choice. Concurrent callers share the one open prompt.
 */
export function promptGraphicsChoiceOnFirstLogin(): Promise<void> {
  if (pending) return pending;
  const settings = new Settings();
  const show = shouldPromptGraphicsChoice({
    answered: settings.get('graphicsPromptAnswered'),
    tierForcedByUrl: forcedTierFromSearch(location.search) !== null,
    automated: navigator.webdriver === true,
  });
  if (!show) return Promise.resolve();
  pending = new Promise<void>((resolve) => {
    showPrompt((choice) => {
      // A fresh read: another Settings instance may have written since this one loaded.
      new Settings().patch({
        ...graphicsChoicePatch(choice, SETTING_RANGES.graphicsPreset.def),
        graphicsPromptAnswered: true,
      });
      pending = null;
      resolve();
    });
  });
  return pending;
}

function optionDescription(option: GraphicsChoiceOption): string {
  if (option.choice !== GRAPHICS_CHOICE_AUTO) return t(option.descKey);
  return t(option.descKey, { preset: graphicsPresetDisplayName(detectedDefaultGraphicsPreset()) });
}

function buildOption(
  option: GraphicsChoiceOption,
  index: number,
  checked: boolean,
): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'graphics-prompt-option';

  const input = document.createElement('input');
  input.type = 'radio';
  input.name = RADIO_NAME;
  input.value = String(option.choice);
  input.className = 'graphics-prompt-radio';
  input.checked = checked;
  // The radio's name is its title; the description is read as its description, not its name.
  const descId = `graphics-prompt-option-desc-${index}`;
  input.setAttribute('aria-describedby', descId);

  const body = document.createElement('span');
  body.className = 'graphics-prompt-option-body';
  const title = document.createElement('span');
  title.className = 'graphics-prompt-option-title';
  title.textContent = t(option.titleKey);
  const desc = document.createElement('span');
  desc.className = 'graphics-prompt-option-desc';
  desc.id = descId;
  desc.textContent = optionDescription(option);
  body.append(title, desc);

  label.append(input, body);
  return label;
}

function showPrompt(onConfirm: (choice: GraphicsChoice) => void): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'graphics-prompt-backdrop';
  backdrop.setAttribute('role', 'presentation');

  // A form, so Enter on a selected radio confirms (implicit submission through the submit button).
  const dialog = document.createElement('form');
  dialog.className = 'ui-panel graphics-prompt-dialog';
  dialog.noValidate = true;
  markDialogRoot(dialog, { labelledBy: 'graphics-prompt-title', modal: true });
  dialog.setAttribute('aria-describedby', 'graphics-prompt-desc');

  const title = document.createElement('h2');
  title.id = 'graphics-prompt-title';
  title.className = 'graphics-prompt-title';
  title.textContent = t('graphicsPrompt.title');

  const desc = document.createElement('p');
  desc.id = 'graphics-prompt-desc';
  desc.className = 'graphics-prompt-desc';
  desc.textContent = t('graphicsPrompt.intro');

  const group = document.createElement('div');
  group.className = 'graphics-prompt-options';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-labelledby', 'graphics-prompt-title');
  const touchDevice = isPhoneTouchDevice() || isNativeAppShell();
  graphicsChoiceOptions({ touchDevice }).forEach((option, index) => {
    group.append(buildOption(option, index, option.choice === GRAPHICS_CHOICE_AUTO));
  });

  const note = document.createElement('p');
  note.className = 'graphics-prompt-note';
  note.textContent = t('graphicsPrompt.changeLater');

  const actions = document.createElement('div');
  actions.className = 'graphics-prompt-actions';
  const confirm = document.createElement('button');
  confirm.type = 'submit';
  confirm.className = 'ui-btn ui-btn--gold graphics-prompt-confirm';
  confirm.textContent = t('graphicsPrompt.confirm');
  actions.append(note, confirm);

  dialog.append(title, desc, group, actions);
  backdrop.append(dialog);
  document.body.append(backdrop);
  const focusHandle = focusManager.open({ root: () => dialog });

  const selected = (): GraphicsChoice => {
    const checked = group.querySelector<HTMLInputElement>(`input[name="${RADIO_NAME}"]:checked`);
    return parseGraphicsChoice(checked?.value ?? null, SETTING_RANGES.graphicsPreset);
  };
  let closed = false;
  const close = (choice: GraphicsChoice): void => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    focusHandle.release();
    onConfirm(choice);
  };

  dialog.addEventListener('submit', (e) => {
    e.preventDefault();
    close(selected());
  });
  // Escape keeps the device default (Auto) and still counts as an answer, so the prompt can never
  // strand a player in front of world entry. Every key stops here, so no start-screen or global key
  // handler behind the modal reacts; the radios and button have already run their native keys
  // (arrow selection, Enter/Space activation) by this bubble phase.
  backdrop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close(GRAPHICS_CHOICE_AUTO);
    }
    e.stopPropagation();
  });

  // The pre-selected Auto radio is the first control in DOM order.
  focusHandle.focusFirst();
}
