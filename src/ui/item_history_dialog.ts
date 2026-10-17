// The "Item history" prompt (src/sim/item_provenance.ts): the read-only
// dialog the bag right-click menu opens on a tracked epic or legendary copy
// (bag_item_action_menu.ts). Mounted in the shared #prompt-stack family with
// the same modal recipe the material sources dialog uses
// (material_sources_dialog.ts): one shared instance, the opener's window
// set inert behind it, Escape and the close buttons dismiss and return
// focus. The lines come from the pure item_history_view.ts core; nothing
// here reads the item ID, which never reaches a player surface.
//
// The trade window and the guild bank reach the same dialog through the two
// affordance helpers at the bottom (the material sources dialog's
// attach/append pair, same doors): a right-click / Context Menu key door and
// a visible button. Which record a viewer reads and which door shows where
// is decided by the pure item_history_access_view.ts core.

import type { ItemProvenance } from '../sim/types';
import { t } from './i18n';
import {
  contextMenuOpensItemHistory,
  type ItemHistorySurface,
  itemHistoryButtonShown,
} from './item_history_access_view';
import { itemHistoryModel } from './item_history_view';
import { installPromptDialog, type PromptDialogHandle } from './prompt_dialog';
import { svgIcon } from './ui_icons';

export interface ItemHistoryDialogOptions {
  /** The item name is already localized by the owning item surface. */
  itemName: string;
  provenance: ItemProvenance;
  /** Focus target to restore when the dialog closes. */
  opener?: HTMLElement | null;
}

export class ItemHistoryDialog {
  private promptHandle: PromptDialogHandle | null = null;
  private root: HTMLElement | null = null;
  private openState = false;
  private ownerRoot: HTMLElement | null = null;
  private returnFocusOnDismiss = true;

  open(options: ItemHistoryDialogOptions): void {
    this.close(false);
    const stack = document.getElementById('prompt-stack');
    const inertRoot = options.opener?.closest<HTMLElement>('.window');
    if (!stack || !inertRoot) return;
    this.ownerRoot = inertRoot;
    this.returnFocusOnDismiss = true;
    const root = document.createElement('div');
    root.id = 'item-history-dialog';
    stack.appendChild(root);
    this.root = root;
    this.paint(root, options);
    this.openState = true;
    this.promptHandle = installPromptDialog(
      root,
      options.opener ?? null,
      () => {
        const returnFocus = this.returnFocusOnDismiss;
        root.removeAttribute('aria-modal');
        root.remove();
        this.root = null;
        this.ownerRoot = null;
        this.openState = false;
        this.promptHandle = null;
        this.returnFocusOnDismiss = true;
        if (
          returnFocus &&
          !options.opener?.isConnected &&
          inertRoot.isConnected &&
          inertRoot.style.display !== 'none'
        ) {
          inertRoot.querySelector<HTMLButtonElement>('button[data-close]:not([disabled])')?.focus();
        }
      },
      { inertRoot, idPrefix: 'item-history-title' },
    );
    root.querySelector<HTMLElement>('[data-item-history-close]')?.focus();
  }

  close(returnFocus = true): void {
    if (!this.openState) return;
    this.returnFocusOnDismiss = returnFocus;
    const handle = this.promptHandle;
    if (returnFocus) handle?.dismissAndReturn();
    else handle?.dismiss();
  }

  isOpen(): boolean {
    return this.openState;
  }

  /** Whether this open prompt belongs to this exact window. */
  hasOwner(owner: HTMLElement): boolean {
    return this.openState && this.ownerRoot === owner;
  }

  private paint(root: HTMLElement, options: ItemHistoryDialogOptions): void {
    const model = itemHistoryModel(options.provenance);
    root.className = 'prompt panel item-history-dialog';

    const header = document.createElement('div');
    header.className = 'panel-title';
    const title = document.createElement('span');
    title.id = 'item-history-dialog-title';
    title.className = 'prompt-text';
    title.textContent = t('hudChrome.itemHistory.title', { item: options.itemName });
    header.appendChild(title);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'x-btn';
    close.dataset.itemHistoryClose = 'true';
    close.dataset.close = '';
    close.setAttribute('aria-label', t('hudChrome.itemHistory.close'));
    close.innerHTML = svgIcon('close');
    close.addEventListener('click', () => this.close());
    header.appendChild(close);
    root.appendChild(header);

    const list = document.createElement('div');
    list.className = 'item-history-list';
    const addRow = (text: string, kind: 'origin' | 'hand' | 'note') => {
      const row = document.createElement('div');
      row.className = `item-history-row item-history-${kind}`;
      row.textContent = text;
      list.appendChild(row);
    };
    addRow(model.origin, 'origin');
    for (const hand of model.hands) addRow(hand, 'hand');
    if (model.noTransfers !== null) addRow(model.noTransfers, 'note');
    if (model.earlierHidden !== null) addRow(model.earlierHidden, 'note');
    root.appendChild(list);

    const actions = document.createElement('div');
    actions.className = 'prompt-actions';
    const done = document.createElement('button');
    done.type = 'button';
    // No data-close here: the prompt installer styles every [data-close] as
    // the compact x button, and this one carries a text label.
    done.className = 'btn';
    done.textContent = t('hudChrome.itemHistory.close');
    done.addEventListener('click', () => this.close());
    actions.appendChild(done);
    root.appendChild(actions);
  }
}

let sharedDialog: ItemHistoryDialog | null = null;

export function closeItemHistoryDialog(returnFocus = true): boolean {
  if (sharedDialog === null || !sharedDialog.isOpen()) return false;
  sharedDialog.close(returnFocus);
  return true;
}

/** Close only when the open prompt belongs to the window being hidden. */
export function closeItemHistoryDialogForOwner(owner: HTMLElement): boolean {
  if (sharedDialog === null || !sharedDialog.hasOwner(owner)) return false;
  sharedDialog.close(false);
  return true;
}

/** Mount into the existing #prompt-stack family and its shared modal recipe. */
export function openItemHistoryDialog(options: ItemHistoryDialogOptions): void {
  sharedDialog ??= new ItemHistoryDialog();
  sharedDialog.open(options);
}

function touchLayout(): boolean {
  return document.body.classList.contains('mobile-touch');
}

/** The right-click door onto an item row/cell outside the bags (the trade
 *  window, the guild bank): desktop right-click and the native Context Menu
 *  key open the history; a touch long-press stays the row's tooltip peek
 *  (item_history_access_view.ts decides both). `provenance` is the record the
 *  caller already resolved for this viewer (itemHistoryProvenanceFor), so a
 *  copy someone else holds arrives here as the public projection; null wires
 *  nothing. */
export function attachItemHistoryContextMenu(
  element: HTMLElement,
  itemName: string,
  provenance: ItemProvenance | null,
): void {
  if (provenance === null) return;
  element.addEventListener('contextmenu', (event) => {
    if (!contextMenuOpensItemHistory((event as PointerEvent).pointerType, touchLayout())) return;
    event.preventDefault();
    openItemHistoryDialog({ itemName, provenance, opener: element });
  });
}

/** The visible "Item history" button beside a row/cell: on every layout for
 *  a list row, on touch layouts only for a grid cell
 *  (itemHistoryButtonShown). It joins the row's existing row-plus-action
 *  wrapper when the material sources button already made one, else mints the
 *  same wrapper (the shared `.material-source-item` layout family, so the
 *  pair lays out exactly like a Sources row). Returns the button, or null when
 *  none renders. */
export function appendItemHistoryActionAfter(
  element: HTMLElement,
  itemName: string,
  provenance: ItemProvenance | null,
  surface: ItemHistorySurface,
): HTMLButtonElement | null {
  if (provenance === null) return null;
  if (!itemHistoryButtonShown(surface, touchLayout())) return null;
  const parent = element.parentElement;
  if (!parent) return null;
  const button = document.createElement('button');
  button.type = 'button';
  // The material sources action's sizing (40px floor, focus ring) is the
  // family look for a per-row action; the second class is this door's hook.
  button.className = 'btn material-sources-action item-history-action';
  button.setAttribute('aria-haspopup', 'dialog');
  button.textContent = t('hudChrome.itemMenu.itemHistory');
  button.setAttribute('aria-label', t('hudChrome.itemHistory.openAria', { item: itemName }));
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    openItemHistoryDialog({ itemName, provenance, opener: button });
  });
  if (parent.classList.contains('material-source-item')) {
    parent.appendChild(button);
    return button;
  }
  const wrapper = document.createElement('div');
  wrapper.className = 'material-source-item';
  if (element.classList.contains('bank-item')) wrapper.classList.add('material-source-item-cell');
  if (element.classList.contains('trade-item')) wrapper.classList.add('material-source-item-trade');
  if (element.classList.contains('equip-slot')) wrapper.classList.add('material-source-item-slot');
  parent.insertBefore(wrapper, element);
  wrapper.append(element, button);
  return button;
}
