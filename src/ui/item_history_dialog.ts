// The "Item history" prompt (src/sim/item_provenance.ts): the read-only
// dialog the bag right-click menu opens on a tracked epic or legendary copy
// (bag_item_action_menu.ts). Mounted in the shared #prompt-stack family with
// the same modal recipe the material sources dialog uses
// (material_sources_dialog.ts): one shared instance, the opener's window
// set inert behind it, Escape and the close buttons dismiss and return
// focus. The lines come from the pure item_history_view.ts core; nothing
// here reads the item ID, which never reaches a player surface.

import type { ItemProvenance } from '../sim/types';
import { t } from './i18n';
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
