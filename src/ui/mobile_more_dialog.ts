import type { FocusManager, FocusTrapHandle } from './focus_manager';

export interface MobileMoreDialogElements {
  trigger: () => HTMLElement | null;
  dialog: () => HTMLElement | null;
}

/**
 * Owns the accessibility lifecycle for the class-driven mobile More dialog.
 * Every visual close path mutates the same body class; the shared class observer
 * then routes the resulting state here, so focus and ARIA cannot drift when the
 * tray is closed by its X, outside tap, an action, Escape, or layout teardown.
 */
export class MobileMoreDialogController {
  private trap: FocusTrapHandle | null = null;
  private open = false;

  constructor(
    private readonly focusManager: Pick<FocusManager, 'open'>,
    private readonly elements: MobileMoreDialogElements,
  ) {}

  sync(open: boolean, restoreFocus = true): void {
    const trigger = this.elements.trigger();
    const dialog = this.elements.dialog();
    trigger?.setAttribute('aria-expanded', open ? 'true' : 'false');
    dialog?.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (this.open === open) return;
    this.open = open;

    if (open) {
      this.trap?.release(false);
      this.trap = this.focusManager.open({
        root: this.elements.dialog,
        returnFocusTo: trigger,
      });
      this.trap.focusFirst('#mobile-more-close');
      return;
    }

    this.trap?.release(restoreFocus);
    this.trap = null;
  }
}
