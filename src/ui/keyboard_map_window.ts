// The keyboard overview's pop-out: the same live keyboard the Key Bindings panel
// shows (keyboard_map.ts), in its own movable `.window.panel` so it can stay up
// while the player plays or rebinds. Fully interactive (click a key to rebind
// or assign, exactly as in the panel). Built in code and appended to #ui the
// first time it opens; the HUD's window management (titlebar drag, stacking,
// the shared resize grip, Esc / closeAll) picks it up through the `.window.panel`
// class, and Hud.closeManagedWindow routes its id through
// OptionsWindow.closeKeyboardWindow (the CODE_BUILT row in
// tests/managed_window_close_registry.test.ts). No trap, no timer: every open
// repaints from the live bindings.
// Desktop only: the panel offers the Pop Out button only off touch. Registered
// in tests/architecture.test.ts UI_DOM_MODULES.

import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import type { FocusTrapHandle } from './focus_manager';
import { t } from './i18n';
import {
  type KeyboardMapHandle,
  type KeyboardMapPaintDeps,
  paintKeyboardMap,
} from './keyboard_map';
import { svgIcon } from './ui_icons';

const TITLE_ID = 'keyboard-map-title';

export interface KeyboardMapWindowFocus {
  /** The shared HUD focus-manager stack (OptionsWindowDeps.openFocusTrap):
   *  Tab stays inside while focus is inside, and focus returns to the opener
   *  on close (WCAG 2.2 AA, the confirm-dialog precedent). */
  openFocusTrap: (root: () => HTMLElement, returnFocusTo: HTMLElement) => FocusTrapHandle;
}

export class KeyboardMapWindow {
  private rootEl: HTMLElement | null = null;
  private map: KeyboardMapHandle | null = null;
  private trap: FocusTrapHandle | null = null;

  /** `deps` is read at every open so the board always reflects the live
   *  bindings and the panel's current modifier layer. */
  constructor(
    private readonly deps: () => KeyboardMapPaintDeps,
    private readonly focus: KeyboardMapWindowFocus,
  ) {}

  get isOpen(): boolean {
    return this.rootEl?.style.display === 'block';
  }

  open(): void {
    const root = this.root();
    this.paint(root);
    root.style.display = 'block';
    // The opener is whatever had focus (the Pop Out button's menu is closing
    // under it, so the manager falls back gracefully when it cannot restore).
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : root;
    this.trap?.release(false);
    this.trap = this.focus.openFocusTrap(() => root, opener);
    this.trap.focusFirst();
  }

  close(): void {
    if (!this.rootEl) return;
    // Drop any capture a clicked key armed: a one-shot capture outliving the
    // window would rebind through it on the player's next keypress.
    this.map?.dispose();
    this.rootEl.style.display = 'none';
    this.trap?.release();
    this.trap = null;
  }

  /** Redraw from the live bindings (a rebind made elsewhere while open). */
  repaint(): void {
    if (this.isOpen) this.map?.repaint();
  }

  /** A runtime language switch: rebuild the whole window while open (title,
   *  captions, legends), the woc:languagechange fan-out arm. */
  relocalize(): void {
    if (this.rootEl && this.isOpen) this.paint(this.rootEl);
  }

  private root(): HTMLElement {
    if (this.rootEl) return this.rootEl;
    const root = document.createElement('section');
    root.id = 'keyboard-map-window';
    root.className = 'window panel keyboard-map-window';
    root.style.display = 'none';
    markDialogRoot(root, { labelledBy: TITLE_ID });
    document.getElementById('ui')?.appendChild(root);
    this.rootEl = root;
    return root;
  }

  private paint(root: HTMLElement): void {
    this.map?.dispose();
    root.innerHTML = `<div class="panel-title"><span id="${TITLE_ID}">${esc(t('hudChrome.keyboardMap.title'))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.keyboardMap.close'))}">${svgIcon('close')}</button></div>`;
    root.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    const body = document.createElement('div');
    body.className = 'keyboard-map-body';
    root.appendChild(body);
    this.map = paintKeyboardMap(body, this.deps());
  }
}
