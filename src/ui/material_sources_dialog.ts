// Accessible, uncapped material-source details and selection dialog.
//
// The source list is a snapshot captured by the opener. This dialog never
// recaptures a bag row or resolves a new target when Confirm is pressed. The
// authoritative world command receives the same captured stack selection and
// revalidates it itself.

import type { MaterialComposition } from '../sim/material_sources';
import { formatNumber, t } from './i18n';
import {
  type MaterialSourceChoice,
  materialSourceChoices,
  materialSourceSummary,
  type SelectedMaterialSources,
  selectedMaterialComposition,
} from './material_sources_view';
import { installPromptDialog, type PromptDialogHandle } from './prompt_dialog';
import { svgIcon } from './ui_icons';

export type MaterialSourcesDialogOpener = (options: MaterialSourcesDialogOptions) => void;

export interface MaterialSourcesSelectionSession {
  /** Canonical source order captured with the command target. */
  readonly sources: MaterialComposition;
  readonly onConfirm: (selected: SelectedMaterialSources) => void;
  /** Other windows whose lifetime this selection depends on. The opener's
   * owning window is always captured separately by the dialog. */
  readonly associatedOwners?: readonly HTMLElement[];
}

export type MaterialSourcesSelectionFactory =
  | (() => MaterialSourcesSelectionSession | null)
  | undefined;

export interface MaterialSourcesDialogOptions {
  /** The item name is already localized by the owning item surface. */
  itemName: string;
  sources: MaterialComposition | undefined;
  /** When present, the dialog offers exact per-source quantities. The caller
   * captures the stack pin when this dialog opens and closes over it here. */
  onConfirm?: (selected: SelectedMaterialSources) => void;
  /** Focus target to restore when the dialog closes. */
  opener?: HTMLElement | null;
  /** Other windows whose lifetime this dialog depends on. */
  associatedOwners?: readonly HTMLElement[];
}

/** Add the shared keyboard/context-menu details entry point to an existing item
 *  row. Touch long-press remains the row's tooltip peek; desktop right-click and
 *  the native Context Menu key open the full uncapped source list. */
export function attachMaterialSourcesContextMenu(
  element: HTMLElement,
  itemName: string,
  sources: MaterialComposition | undefined,
  open: MaterialSourcesDialogOpener | undefined,
): void {
  if (sources === undefined || sources.length === 0 || open === undefined) return;
  element.addEventListener('contextmenu', (event) => {
    const pointerType = (event as PointerEvent).pointerType;
    if (
      pointerType === 'touch' ||
      pointerType === 'pen' ||
      (document.body.classList.contains('mobile-touch') && pointerType !== 'mouse')
    ) {
      return;
    }
    event.preventDefault();
    open({ itemName, sources, opener: element });
  });
}

/** Add the same details affordance beside an existing row/cell. The wrapper is
 * one intentional layout item, and each nested button keeps one purpose. */
export function appendMaterialSourcesActionAfter(
  element: HTMLElement,
  itemName: string,
  sources: MaterialComposition | undefined,
  open: MaterialSourcesDialogOpener | undefined,
  selectionFactory?: MaterialSourcesSelectionFactory,
): HTMLButtonElement | null {
  if (sources === undefined || sources.length === 0 || open === undefined) return null;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn material-sources-action';
  button.setAttribute('aria-haspopup', 'dialog');
  button.textContent = t(
    selectionFactory ? 'hudChrome.materialSources.choose' : 'hudChrome.materialSources.view',
  );
  button.setAttribute(
    'aria-label',
    t(
      selectionFactory
        ? 'hudChrome.materialSources.chooseAria'
        : 'hudChrome.materialSources.viewAria',
      { item: itemName },
    ),
  );
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const selection = selectionFactory?.();
    if (selectionFactory && !selection) return;
    open({
      itemName,
      sources: selection?.sources ?? sources,
      opener: button,
      ...(selection ? { onConfirm: selection.onConfirm } : {}),
      ...(selection?.associatedOwners ? { associatedOwners: selection.associatedOwners } : {}),
    });
  });
  const existingWrapper = element.parentElement?.classList.contains('material-source-item')
    ? element.parentElement
    : null;
  if (existingWrapper) {
    existingWrapper.appendChild(button);
    return button;
  }
  const parent = element.parentElement;
  if (!parent) return null;
  const wrapper = document.createElement(
    element.classList.contains('mail-attachment-item') ||
      element.classList.contains('mail-parcel-name')
      ? 'span'
      : 'div',
  );
  wrapper.className = 'material-source-item';
  if (element.classList.contains('bank-item')) wrapper.classList.add('material-source-item-cell');
  if (element.classList.contains('mkt-row')) wrapper.classList.add('material-source-item-market');
  if (
    element.classList.contains('mail-attachment-item') ||
    element.classList.contains('mail-parcel-name')
  ) {
    wrapper.classList.add('material-source-item-mail');
  }
  if (element.classList.contains('trade-item')) wrapper.classList.add('material-source-item-trade');
  parent.insertBefore(wrapper, element);
  wrapper.append(element, button);
  return button;
}

export interface MaterialSourcesDialogModel {
  readonly choices: readonly MaterialSourceChoice[];
  readonly total: number;
  readonly selectable: boolean;
}

/** Pure model used by the DOM painter and its focused unit tests. */
export function materialSourcesDialogModel(
  sources: MaterialComposition | undefined,
  selectable: boolean,
): MaterialSourcesDialogModel {
  const summary = materialSourceSummary(sources);
  return {
    choices: materialSourceChoices(sources),
    total: summary?.total ?? 0,
    selectable,
  };
}

const rowId = (_key: string, index: number): string => `material-source-${index}`;

function sourceLabel(choice: MaterialSourceChoice): string {
  if (choice.row.kind === 'gatherer') {
    return choice.row.premium
      ? t('hudChrome.materialSources.gathererSigned', {
          name: choice.row.name,
          signer: choice.row.signer,
        })
      : t('hudChrome.materialSources.gatherer', { name: choice.row.name });
  }
  if (choice.row.premium && choice.row.name.length > 0) {
    return t('hudChrome.materialSources.unrecordedSigned', { name: choice.row.name });
  }
  return t('hudChrome.materialSources.unrecorded');
}

function sourceRowText(choice: MaterialSourceChoice): string {
  return t('hudChrome.materialSources.row', {
    count: formatNumber(choice.row.count, { maximumFractionDigits: 0 }),
    source: sourceLabel(choice),
  });
}

function appendText(parent: HTMLElement, className: string, text: string): HTMLElement {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  parent.appendChild(el);
  return el;
}

/**
 * Thin DOM consumer for the source details/picker surface. The caller owns
 * placement and the world command; this module owns semantics, focus, exact
 * quantity collection, and escaping of historic display-name snapshots.
 */
export class MaterialSourcesDialog {
  private promptHandle: PromptDialogHandle | null = null;
  private root: HTMLElement | null = null;
  private openState = false;
  private options: MaterialSourcesDialogOptions | null = null;
  private ownerRoots: readonly HTMLElement[] = [];
  private associatedOwnerStates: readonly {
    owner: HTMLElement;
    wasInert: boolean;
  }[] = [];
  private returnFocusOnDismiss = true;

  open(options: MaterialSourcesDialogOptions): void {
    this.close(false);
    const stack = document.getElementById('prompt-stack');
    const inertRoot = options.opener?.closest<HTMLElement>('.window');
    if (!stack || !inertRoot) return;
    const associatedOwners = Array.from(new Set(options.associatedOwners ?? [])).filter(
      (owner) => owner !== inertRoot,
    );
    this.ownerRoots = [inertRoot, ...associatedOwners];
    this.returnFocusOnDismiss = true;
    this.associatedOwnerStates = associatedOwners.map((owner) => ({
      owner,
      wasInert: owner.inert,
    }));
    for (const owner of associatedOwners) owner.inert = true;
    const root = document.createElement('div');
    root.id = 'material-sources-dialog';
    stack.appendChild(root);
    this.root = root;
    this.options = options;
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
        this.options = null;
        for (const { owner, wasInert } of this.associatedOwnerStates) owner.inert = wasInert;
        this.associatedOwnerStates = [];
        this.ownerRoots = [];
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
      {
        inertRoot,
        idPrefix: 'material-sources-title',
      },
    );
    root
      .querySelector<HTMLElement>(options.onConfirm ? 'input' : '[data-material-sources-close]')
      ?.focus();
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

  /** Whether this open prompt depends on this exact, stably captured window. */
  hasOwner(owner: HTMLElement): boolean {
    return this.openState && this.ownerRoots.includes(owner);
  }

  private paint(root: HTMLElement, options: MaterialSourcesDialogOptions): void {
    const model = materialSourcesDialogModel(options.sources, options.onConfirm !== undefined);
    const titleId = 'material-sources-dialog-title';
    root.className = 'prompt panel material-sources-dialog';

    const header = document.createElement('div');
    header.className = 'panel-title';
    const title = document.createElement('span');
    title.id = titleId;
    title.className = 'prompt-text';
    title.textContent = t(
      model.selectable
        ? 'hudChrome.materialSources.pickerTitle'
        : 'hudChrome.materialSources.detailsTitle',
      { item: options.itemName },
    );
    header.appendChild(title);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'x-btn';
    close.dataset.materialSourcesClose = 'true';
    close.dataset.close = '';
    close.setAttribute('aria-label', t('hudChrome.materialSources.close'));
    close.innerHTML = svgIcon('close');
    close.addEventListener('click', () => this.close());
    header.appendChild(close);
    root.appendChild(header);

    const summary = document.createElement('div');
    summary.className = 'material-sources-summary';
    summary.id = 'material-sources-dialog-summary';
    summary.textContent = t('hudChrome.materialSources.total', {
      units: formatNumber(model.total, { maximumFractionDigits: 0 }),
    });
    root.appendChild(summary);

    const list = document.createElement('div');
    list.className = 'material-sources-list';
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', t('hudChrome.materialSources.listAria'));
    const quantities = new Map<number, number>();
    const submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'btn material-sources-confirm';
    submit.textContent = t('hudChrome.materialSources.confirm');
    submit.disabled = true;

    for (const [index, choice] of model.choices.entries()) {
      const row = document.createElement('div');
      row.className = 'material-sources-row';
      row.setAttribute('role', 'listitem');
      if (!model.selectable) {
        appendText(row, 'material-sources-row-label', sourceRowText(choice));
      } else {
        const label = document.createElement('label');
        label.className = 'material-sources-label';
        const inputId = rowId(choice.row.key, index);
        const input = document.createElement('input');
        input.type = 'number';
        input.id = inputId;
        input.min = '0';
        input.max = String(choice.row.count);
        input.step = '1';
        input.value = '0';
        input.dataset.materialSourceIndex = String(choice.sourceIndex);
        const source = sourceLabel(choice);
        // +/- changes this value while focus stays on the step button. Match
        // the mailbox quantity control's polite live-value announcement.
        input.setAttribute('aria-live', 'polite');
        input.setAttribute(
          'aria-label',
          t('hudChrome.materialSources.quantityAria', {
            source,
            count: formatNumber(choice.row.count, { maximumFractionDigits: 0 }),
          }),
        );
        const quantity = document.createElement('span');
        quantity.className = 'material-sources-quantity';
        const decrease = document.createElement('button');
        decrease.type = 'button';
        decrease.className = 'btn material-sources-step';
        decrease.dataset.materialSourceDecrease = String(choice.sourceIndex);
        decrease.textContent = '−';
        decrease.setAttribute(
          'aria-label',
          t('hudChrome.materialSources.decreaseAria', { source }),
        );
        const increase = document.createElement('button');
        increase.type = 'button';
        increase.className = 'btn material-sources-step';
        increase.dataset.materialSourceIncrease = String(choice.sourceIndex);
        increase.textContent = '+';
        increase.setAttribute(
          'aria-label',
          t('hudChrome.materialSources.increaseAria', { source }),
        );
        const syncQuantity = (): void => {
          const value = input.value.trim() === '' ? Number.NaN : Number(input.value);
          quantities.set(choice.sourceIndex, value);
          const valid = Number.isSafeInteger(value) && value >= 0 && value <= choice.row.count;
          decrease.disabled = !valid || value <= 0;
          increase.disabled = !valid || value >= choice.row.count;
          submit.disabled = selectedMaterialComposition(model.choices, quantities) === null;
        };
        const stepQuantity = (delta: -1 | 1): void => {
          const value = input.value.trim() === '' ? Number.NaN : Number(input.value);
          if (!Number.isSafeInteger(value) || value < 0 || value > choice.row.count) {
            return;
          }
          const next = value + delta;
          if (next < 0 || next > choice.row.count) return;
          input.value = String(next);
          syncQuantity();
        };
        input.addEventListener('input', syncQuantity);
        decrease.addEventListener('click', () => stepQuantity(-1));
        increase.addEventListener('click', () => stepQuantity(1));
        syncQuantity();
        label.htmlFor = inputId;
        appendText(label, 'material-sources-row-label', sourceRowText(choice));
        row.appendChild(label);
        quantity.append(decrease, input, increase);
        row.appendChild(quantity);
      }
      list.appendChild(row);
    }
    root.appendChild(list);

    const footer = document.createElement('div');
    footer.className = 'material-sources-footer';
    if (model.selectable && options.onConfirm !== undefined) {
      submit.addEventListener('click', () => {
        const selected = selectedMaterialComposition(model.choices, quantities);
        if (selected === null) return;
        const callback = this.options?.onConfirm;
        if (!callback) return;
        this.close();
        callback(selected);
      });
      footer.appendChild(submit);
    }
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn material-sources-cancel';
    cancel.textContent = t('hudChrome.materialSources.cancel');
    cancel.addEventListener('click', () => this.close());
    footer.appendChild(cancel);
    root.appendChild(footer);
    root.setAttribute('aria-describedby', summary.id);
  }
}

let sharedDialog: MaterialSourcesDialog | null = null;

/** Close the shared source dialog from the host's existing Escape/close-all
 * dispatcher. The modal marker is removed with the DOM so hidden source UI
 * cannot block the HUD's ordinary input gate. */
export function closeMaterialSourcesDialog(returnFocus = true): boolean {
  if (sharedDialog === null || !sharedDialog.isOpen()) return false;
  sharedDialog.close(returnFocus);
  return true;
}

/** Close only when the shared dialog belongs to the window being hidden. The
 * identity check prevents one window from dismissing another window's prompt. */
export function closeMaterialSourcesDialogForOwner(owner: HTMLElement): boolean {
  if (sharedDialog === null || !sharedDialog.hasOwner(owner)) return false;
  sharedDialog.close(false);
  return true;
}

/** Mount into the existing #prompt-stack family and its shared modal recipe. */
export function openMaterialSourcesDialog(options: MaterialSourcesDialogOptions): void {
  sharedDialog ??= new MaterialSourcesDialog();
  sharedDialog.open(options);
}
