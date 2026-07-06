// Controller onboarding overlay: a dismissible modal that shows the current pad
// layout (sticks + button->action rows) the first time a controller connects, and
// on demand from the Controller options panel. Thin DOM consumer over the pure
// controllerGuideModel core; owns no game state. Modeled on the HUD's confirm
// dialog (dynamically created "window panel" + a FocusManager trap), so it meets
// the same focus-trap / Esc / return-focus contract as the other modals.

import { audio } from '../game/audio';
import { type GamepadKind, gamepadButtonLabel } from '../game/gamepad_map';
import { controllerGuideModel } from './controller_guide_view';
import { esc } from './esc';
import type { FocusManager, FocusTrapHandle } from './focus_manager';
import { t } from './i18n';
import { svgIcon } from './ui_icons';

export interface ControllerGuideDeps {
  focusManager: FocusManager;
  // Live gamepad layout (the same seam the Controller options panel reads).
  entries(): { button: number; action: string }[];
  kind(): GamepadKind;
  // Localized display name for a bound action id (shared with the options panel).
  actionLabel(actionId: string): string;
}

const OVERLAY_ID = 'controller-guide';

export class ControllerGuide {
  private el: HTMLDivElement | null = null;
  private trap: FocusTrapHandle | null = null;

  constructor(private deps: ControllerGuideDeps) {}

  isOpen(): boolean {
    return this.el !== null;
  }

  /** Build and show the overlay (a no-op reopen just re-renders current bindings). */
  open(): void {
    this.close();
    const kind = this.deps.kind();
    const model = controllerGuideModel(this.deps.entries(), kind, {
      glyph: (button, k) => gamepadButtonLabel(button, k),
      actionLabel: (id) => this.deps.actionLabel(id),
    });

    const el = document.createElement('div');
    el.id = OVERLAY_ID;
    el.className = 'window panel cg-overlay';
    el.style.display = 'block';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'cg-title');

    const title = t('hudChrome.controller.title');
    const dismiss = t('hudChrome.controller.guideDismiss');
    // Sticks are labeled with non-localized hardware tokens (like the button
    // glyphs) plus the localized action; the button rows come from the pure core.
    const stickRows = [
      { glyph: 'L-Stick', action: t('hudChrome.controller.guideMove') },
      { glyph: 'R-Stick', action: t('hudChrome.controller.guideLook') },
    ];
    const rowHtml = (glyph: string, action: string): string =>
      `<div class="cg-row"><span class="cg-glyph">${esc(glyph)}</span><span class="cg-action">${esc(action)}</span></div>`;

    el.innerHTML =
      `<div class="panel-title"><span id="cg-title">${esc(title)}</span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(dismiss)}">${svgIcon('close')}</button></div>` +
      `<div class="cd-body cg-body">` +
      `<div class="cg-intro">${esc(t('hudChrome.controller.help'))}</div>` +
      `<div class="cg-grid">${stickRows.map((r) => rowHtml(r.glyph, r.action)).join('')}</div>` +
      `<div class="kb-cat cg-head">${esc(t('hudChrome.controller.buttons'))}</div>` +
      `<div class="cg-grid">${model.buttons.map((r) => rowHtml(r.glyph, r.action)).join('')}</div>` +
      `</div>` +
      `<div class="cd-actions"><button type="button" class="btn cd-ok" data-close>${esc(dismiss)}</button></div>`;

    document.body.appendChild(el);
    this.el = el;
    this.trap = this.deps.focusManager.open({ root: () => el });
    el.querySelector<HTMLElement>('[data-close].cd-ok')?.focus();
    el.querySelectorAll('[data-close]').forEach((b) => {
      b.addEventListener('click', () => {
        audio.click();
        this.close();
      });
    });
  }

  close(): void {
    this.trap?.release();
    this.trap = null;
    this.el?.remove();
    this.el = null;
    document.getElementById(OVERLAY_ID)?.remove();
  }
}
