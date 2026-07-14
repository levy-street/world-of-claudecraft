// First-run camera-mode prompt (issue #1727): a one-shot modal shown once, on the
// first world entry in a given browser, that lets the player pick Classic or Mouse
// Camera. Classic appears first and is pre-selected, while both options use neutral
// descriptions with no recommendation badge. Confirming applies and persists the
// existing `mouseCamera` setting exactly as the Esc, Key Bindings toggle does.
// Skipped on touch-controls devices (joystick controls apply there).
//
// Self-contained top-level modal (like native_update_prompt.ts), spawned by main.ts
// rather than composed into Hud: it owns its own backdrop, accessibility wiring, and
// the localStorage "already shown" flag. The pure show/apply policy lives in
// camera_prompt_core.ts so it is unit-tested without the DOM.

import { isNativeAppShell, useTouchInterface } from '../game/mobile_controls';
import {
  type CameraModeChoice,
  cameraChoiceEnablesMouseCamera,
  DEFAULT_CAMERA_CHOICE,
  shouldShowCameraPrompt,
} from './camera_prompt_core';
import { markDialogRoot } from './dialog_root';
import { FocusManager, type FocusTrapHandle } from './focus_manager';
import { t } from './i18n';

// Per-browser flag: set once the prompt has been answered or dismissed so it never
// reappears. Namespaced like the other one-shot prompts (woc.nativeUpdate.*).
const SHOWN_KEY = 'woc.cameraModePrompt.shown';
// While the spawn cinematic is running it swallows input and hides the HUD, so the
// prompt waits for it to finish before appearing; a short poll with a safety cap.
const BLOCKED_POLL_MS = 250;
const BLOCKED_WAIT_CAP_MS = 15_000;

let promptOpen = false;
let promptClose: (() => void) | null = null;
let promptFocusHandle: FocusTrapHandle | null = null;
const promptFocusManager = new FocusManager();

/** Shared gameplay/gamepad gate queried by main.ts while this modal is live. */
export function cameraPromptOpen(): boolean {
  return promptOpen;
}

/** Close an open prompt from an external modal dispatcher such as gamepad Escape. */
export function dismissCameraPrompt(): boolean {
  if (!promptClose) return false;
  promptClose();
  return true;
}

function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in private mode; the prompt simply shows again.
  }
}

// The on-screen touch interface is active (phone or forced-touch device, including
// the packaged native shell): mouse-camera control does not apply there.
function touchControlsActive(): boolean {
  return useTouchInterface() || isNativeAppShell();
}

export interface CameraPromptDeps {
  /** Persist + apply the mouseCamera setting (main.ts applySetting). */
  applyMouseCamera: (enabled: boolean) => void;
  /** True while a blocking intro/cinematic is running; the prompt waits for it. */
  isBlocked?: () => boolean;
}

/**
 * Show the first-run camera prompt if this browser has not seen it and the player
 * is on a mouse-driven interface. Waits out any running intro cinematic first.
 */
export function maybeShowFirstRunCameraPrompt(deps: CameraPromptDeps): void {
  if (promptOpen) return;
  const show = shouldShowCameraPrompt({
    touchControlsActive: touchControlsActive(),
    alreadyShown: storageGet(SHOWN_KEY) === '1',
  });
  if (!show) return;
  waitUntilUnblocked(deps.isBlocked, () => showCameraPrompt(deps));
}

function waitUntilUnblocked(isBlocked: (() => boolean) | undefined, run: () => void): void {
  if (isBlocked === undefined) {
    run();
    return;
  }
  const check = isBlocked;
  if (!check()) {
    run();
    return;
  }
  const startedAt = Date.now();
  const tick = (): void => {
    if (!check() || Date.now() - startedAt >= BLOCKED_WAIT_CAP_MS) {
      run();
      return;
    }
    window.setTimeout(tick, BLOCKED_POLL_MS);
  };
  window.setTimeout(tick, BLOCKED_POLL_MS);
}

interface OptionRefs {
  label: HTMLLabelElement;
  input: HTMLInputElement;
}

function buildOption(
  value: CameraModeChoice,
  titleText: string,
  descText: string,
  checked: boolean,
): OptionRefs {
  const label = document.createElement('label');
  label.className = 'camera-prompt-option';

  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'camera-prompt-mode';
  input.value = value;
  input.className = 'camera-prompt-radio';
  input.checked = checked;

  const body = document.createElement('span');
  body.className = 'camera-prompt-option-body';

  const titleEl = document.createElement('span');
  titleEl.className = 'camera-prompt-option-title';
  titleEl.textContent = titleText;

  const descEl = document.createElement('span');
  descEl.className = 'camera-prompt-option-desc';
  descEl.textContent = descText;

  body.append(titleEl, descEl);
  label.append(input, body);
  return { label, input };
}

function showCameraPrompt(deps: CameraPromptDeps): void {
  if (promptOpen) return;
  promptOpen = true;

  const backdrop = document.createElement('div');
  backdrop.className = 'camera-prompt-backdrop';
  backdrop.setAttribute('role', 'presentation');

  const dialog = document.createElement('div');
  dialog.className = 'panel camera-prompt-dialog';
  markDialogRoot(dialog, { labelledBy: 'camera-prompt-title', modal: true });
  dialog.setAttribute('aria-describedby', 'camera-prompt-desc');

  const title = document.createElement('div');
  title.id = 'camera-prompt-title';
  title.className = 'camera-prompt-title';
  title.textContent = t('hudChrome.cameraPrompt.title');

  const desc = document.createElement('div');
  desc.id = 'camera-prompt-desc';
  desc.className = 'camera-prompt-desc';
  desc.textContent = t('hudChrome.cameraPrompt.intro');

  const group = document.createElement('div');
  group.className = 'camera-prompt-options';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-labelledby', 'camera-prompt-title');

  const classicOpt = buildOption(
    'classic',
    t('hudChrome.cameraPrompt.classicTitle'),
    t('hudChrome.cameraPrompt.classicDesc'),
    DEFAULT_CAMERA_CHOICE === 'classic',
  );
  const mouseOpt = buildOption(
    'mouse',
    t('hud.options.mouseCamera'),
    t('hudChrome.cameraPrompt.mouseDesc'),
    DEFAULT_CAMERA_CHOICE === 'mouse',
  );
  group.append(classicOpt.label, mouseOpt.label);

  const note = document.createElement('div');
  note.className = 'camera-prompt-note';
  note.textContent = t('hudChrome.cameraPrompt.changeLater');

  const actions = document.createElement('div');
  actions.className = 'camera-prompt-actions';
  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'btn camera-prompt-confirm';
  confirm.textContent = t('hudChrome.cameraPrompt.confirm');
  actions.append(confirm);

  dialog.append(title, desc, group, note, actions);
  backdrop.append(dialog);
  document.body.append(backdrop);
  promptFocusHandle = promptFocusManager.open({ root: () => dialog });

  const close = (): void => {
    if (!promptOpen) return;
    promptOpen = false;
    promptClose = null;
    const focusHandle = promptFocusHandle;
    promptFocusHandle = null;
    // Record the flag on any resolution (confirm or Esc dismiss) so the prompt is
    // shown at most once per browser.
    storageSet(SHOWN_KEY, '1');
    backdrop.remove();
    focusHandle?.release();
  };
  promptClose = close;

  const selectedChoice = (): CameraModeChoice => (mouseOpt.input.checked ? 'mouse' : 'classic');

  confirm.addEventListener('click', () => {
    deps.applyMouseCamera(cameraChoiceEnablesMouseCamera(selectedChoice()));
    close();
  });

  // Esc dismisses without changing the setting (the flag still records). Tab is
  // trapped by the shared FocusManager. This listener stops every other key from
  // bubbling to the live game behind the modal, so gameplay keybinds
  // (movement, Tab target-nearest, abilities) do not fire while the prompt is up.
  // The radios / button have already handled their native keys by this bubble
  // phase, so stopPropagation does not break arrow selection or Enter-to-confirm.
  backdrop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
    e.stopPropagation();
  });

  // The default Classic radio is the first meaningful control in DOM order.
  promptFocusHandle.focusFirst();
}
