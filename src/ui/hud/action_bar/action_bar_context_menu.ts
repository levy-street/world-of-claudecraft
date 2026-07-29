// Thin adapter for the action-bar entry in the shared #ctx-menu popup family.
// The pure state transition lives in action_bar_lock_core.ts.

import { CTX_MENU_PICKER_CLASS } from '../../bag_item_action_menu';
import { esc } from '../../esc';
import { t } from '../../i18n';
import { actionBarLockMenuAction } from './action_bar_lock_core';

export interface ActionBarContextMenuDeps {
  element(): HTMLElement;
  locked(): boolean;
  setLocked(locked: boolean): void;
  setOpener(opener: HTMLElement | null): void;
  place(
    element: HTMLElement,
    x: number,
    y: number,
    reserveRight: number,
    reserveBottom: number,
  ): void;
  bind(onActivate: (action: string) => void): void;
}

export class ActionBarContextMenu {
  private activeOpener: HTMLElement | null = null;
  private restoreOpenerFocus = false;

  constructor(private readonly deps: ActionBarContextMenuDeps) {}

  openForEvent(event: Pick<MouseEvent, 'clientX' | 'clientY'>, opener: HTMLElement): void {
    const rect = opener.getBoundingClientRect();
    const x = event.clientX || rect.left;
    const y = event.clientY || rect.bottom;
    this.open(x, y, opener, false);
  }

  openForKeyboardEvent(
    event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault' | 'stopPropagation'>,
    opener: HTMLElement,
  ): boolean {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return false;
    event.preventDefault();
    event.stopPropagation();
    const rect = opener.getBoundingClientRect();
    this.open(rect.left, rect.bottom, opener, true);
    this.deps.element().querySelector<HTMLElement>('.ctx-item')?.focus();
    return true;
  }

  open(x: number, y: number, opener: HTMLElement, restoreOpenerFocus = false): void {
    const menu = this.deps.element();
    if (menu.style.display === 'block' && this.activeOpener === opener) {
      menu.style.display = 'none';
      this.finishInteraction();
      return;
    }
    const action = actionBarLockMenuAction(this.deps.locked());
    menu.classList.remove(CTX_MENU_PICKER_CLASS);
    menu.innerHTML = `<div class="ctx-title">${esc(t('hudChrome.actionBar.title'))}</div><div class="ctx-item" data-act="toggle-lock">${esc(t(action.labelKey))}</div>`;
    menu.style.display = 'block';
    this.activeOpener = opener;
    this.restoreOpenerFocus = restoreOpenerFocus;
    this.deps.setOpener(opener);
    this.deps.place(menu, x, y, 220, 120);
    this.deps.bind((id) => {
      if (id !== 'toggle-lock') return;
      this.deps.setLocked(action.nextLocked);
      this.finishInteraction();
    });
  }

  isOpenFor(opener: HTMLElement): boolean {
    return this.deps.element().style.display === 'block' && this.activeOpener === opener;
  }

  onSharedClose(): void {
    this.finishInteraction();
  }

  private finishInteraction(): void {
    const opener = this.activeOpener;
    const restoreFocus = this.restoreOpenerFocus;
    this.activeOpener = null;
    this.restoreOpenerFocus = false;
    this.deps.setOpener(null);
    if (!opener) return;
    if (restoreFocus) opener.focus();
    else opener.blur();
  }
}
