// First-run camera-mode prompt: a dismissible modal shown once on world entry that
// lets the player pick Classic or Mouse Camera (the latter preselected + recommended).
// Thin DOM consumer over the pure camera_mode_prompt_view core; owns no game state.
// Modeled on the controller onboarding overlay (a dynamically created "window panel"
// + a FocusManager trap + markDialogRoot), so it meets the same focus-trap / Esc /
// return-focus contract as the other modals. Confirming applies + persists the choice
// through the SAME effect as the Key Bindings mouseCamera toggle (settings.set +
// input.setMouseCameraEnabled, injected as applyMouseCamera); both confirm and dismiss
// set a localStorage flag so the prompt appears at most once per browser.

import { audio } from '../game/audio';
import {
  CAMERA_MODE_OPTIONS,
  CAMERA_MODE_PROMPT_KEYS,
  type CameraModeId,
  cameraModeById,
  DEFAULT_CAMERA_MODE,
  nextCameraModeForKey,
} from './camera_mode_prompt_view';
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import type { FocusManager, FocusTrapHandle } from './focus_manager';
import { t } from './i18n';
import { svgIcon } from './ui_icons';

const OVERLAY_ID = 'camera-mode-prompt';
// woc.* namespaced, mirroring native_update_prompt's storage keys.
const SEEN_KEY = 'woc.cameraModePrompt.seen';

export interface CameraModePromptDeps {
  focusManager: FocusManager;
  /**
   * Apply + persist the chosen mode. The Hud wires this to the same effect the Key
   * Bindings toggle uses (settings.set('mouseCamera', v) -> input.setMouseCameraEnabled).
   */
  applyMouseCamera(enabled: boolean): void;
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
    // Storage can be unavailable in private or locked-down web views.
  }
}

/** True once the prompt has been answered or dismissed in this browser. */
export function cameraModePromptSeen(): boolean {
  return storageGet(SEEN_KEY) === '1';
}

export class CameraModePrompt {
  private el: HTMLDivElement | null = null;
  private trap: FocusTrapHandle | null = null;
  private selected: CameraModeId = DEFAULT_CAMERA_MODE;

  constructor(private deps: CameraModePromptDeps) {}

  isOpen(): boolean {
    return this.el !== null;
  }

  /** Build and show the modal with Mouse Camera preselected. */
  open(): void {
    this.close();
    this.selected = DEFAULT_CAMERA_MODE;

    const el = document.createElement('div');
    el.id = OVERLAY_ID;
    el.className = 'window panel cmp-overlay';
    el.style.display = 'block';
    markDialogRoot(el, { labelledBy: 'cmp-title', modal: true });

    const dismiss = t(CAMERA_MODE_PROMPT_KEYS.dismiss);
    const recommended = t(CAMERA_MODE_PROMPT_KEYS.recommended);
    const optionHtml = (id: CameraModeId): string => {
      const opt = cameraModeById(id);
      const badge = opt.recommended ? `<span class="cmp-badge">${esc(recommended)}</span>` : '';
      const selected = id === this.selected;
      // Roving tabindex: only the checked radio is in the Tab order, so the group
      // is a single tab stop and Arrow keys move between options (ARIA radiogroup).
      const tabindex = selected ? '0' : '-1';
      return (
        `<button type="button" class="cmp-option" role="radio" aria-checked="${selected ? 'true' : 'false'}" tabindex="${tabindex}" data-mode="${esc(id)}">` +
        `<span class="cmp-option-head"><span class="cmp-option-label">${esc(t(opt.labelKey))}</span>${badge}</span>` +
        `<span class="cmp-option-desc">${esc(t(opt.descKey))}</span>` +
        `</button>`
      );
    };

    el.innerHTML =
      `<div class="panel-title"><span id="cmp-title">${esc(t(CAMERA_MODE_PROMPT_KEYS.title))}</span>` +
      `<button type="button" class="x-btn" data-dismiss aria-label="${esc(dismiss)}">${svgIcon('close')}</button></div>` +
      `<div class="cd-body cmp-body">` +
      `<div class="cmp-intro">${esc(t(CAMERA_MODE_PROMPT_KEYS.body))}</div>` +
      `<div class="cmp-options" role="radiogroup" aria-labelledby="cmp-title">` +
      CAMERA_MODE_OPTIONS.map((o) => optionHtml(o.id)).join('') +
      `</div>` +
      `<div class="cmp-note">${esc(t(CAMERA_MODE_PROMPT_KEYS.note))}</div>` +
      `</div>` +
      `<div class="cd-actions"><button type="button" class="btn cd-ok cmp-ok" data-confirm>${esc(t(CAMERA_MODE_PROMPT_KEYS.confirm))}</button></div>`;

    document.body.appendChild(el);
    this.el = el;
    this.trap = this.deps.focusManager.open({ root: () => el });

    for (const btn of el.querySelectorAll<HTMLElement>('.cmp-option')) {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-mode') as CameraModeId | null;
        if (mode) this.select(mode);
      });
    }
    // ARIA radiogroup keyboard model (nextCameraModeForKey owns the pure logic):
    // Arrow keys move the checked option with wrap and take focus with it, Home/End
    // jump to the ends. Space/Enter fall through to the button's native click, which
    // selects via the handler above.
    el.querySelector<HTMLElement>('.cmp-options')?.addEventListener('keydown', (e) => {
      const next = nextCameraModeForKey(this.selected, (e as KeyboardEvent).key);
      if (!next) return;
      e.preventDefault();
      this.select(next, true);
    });
    el.querySelector<HTMLElement>('[data-dismiss]')?.addEventListener('click', () => {
      audio.click();
      this.dismiss();
    });
    el.querySelector<HTMLElement>('[data-confirm]')?.addEventListener('click', () => {
      audio.click();
      this.confirm();
    });

    // Land focus on the confirm button so a keyboard user can accept the recommended
    // default immediately; the radiogroup is reachable via Tab within the trap.
    el.querySelector<HTMLElement>('[data-confirm]')?.focus();
  }

  // Select an option, syncing aria-checked and the roving tabindex across the
  // group. When `focus` is set (keyboard navigation), move focus to the newly
  // checked radio so it follows the arrow keys.
  private select(mode: CameraModeId, focus = false): void {
    const root = this.el;
    if (!root) return;
    const changed = mode !== this.selected;
    if (changed) {
      audio.click();
      this.selected = mode;
    }
    for (const btn of root.querySelectorAll<HTMLElement>('.cmp-option')) {
      const isSel = btn.getAttribute('data-mode') === mode;
      btn.setAttribute('aria-checked', isSel ? 'true' : 'false');
      btn.tabIndex = isSel ? 0 : -1;
      if (isSel && focus) btn.focus();
    }
  }

  /** Apply the selected mode, mark the prompt seen, and close. */
  confirm(): void {
    const opt = cameraModeById(this.selected);
    this.deps.applyMouseCamera(opt.mouseCamera);
    storageSet(SEEN_KEY, '1');
    this.close();
  }

  /** Close without applying, but still mark seen so it never reappears. */
  dismiss(): void {
    storageSet(SEEN_KEY, '1');
    this.close();
  }

  close(): void {
    this.trap?.release();
    this.trap = null;
    this.el?.remove();
    this.el = null;
    document.getElementById(OVERLAY_ID)?.remove();
  }
}
