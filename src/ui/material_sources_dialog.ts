// Accessible, uncapped material-source details and selection dialog.
//
// The source list is a snapshot captured by the opener. This dialog never
// recaptures a bag row or resolves a new target when Confirm is pressed. The
// authoritative world command receives the same captured stack selection and
// revalidates it itself.

import { DEFAULT_STACK } from '../sim/bags';
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
import { mountQuantityStepper, type QuantityStepper } from './quantity_stepper';
import { svgIcon } from './ui_icons';

export type MaterialSourcesDialogOpener = (options: MaterialSourcesDialogOptions) => void;

export interface MaterialSourcesSelectionSession {
  /** Canonical source order captured with the command target. */
  readonly sources: MaterialComposition;
  readonly onConfirm: (selected: SelectedMaterialSources) => void;
  /** Other windows whose lifetime this selection depends on. The opener's
   * owning window is always captured separately by the dialog. */
  readonly associatedOwners?: readonly HTMLElement[];
  /** The most units the destination can take right now (the vault's live
   * per-material headroom), when it has such a ceiling: the picker caps the
   * rows' total at it so a confirm can never exceed what fits. */
  readonly limit?: number;
  /** Units one press of the big step pair moves: the item's bag stack size,
   * supplied by the factory that knows the item so the picker and the
   * quantity prompt step by the same amount. */
  readonly stepSize?: number;
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
  /** Ceiling on the selected total (see MaterialSourcesSelectionSession). */
  limit?: number;
  /** The big step pair's size; DEFAULT_STACK when the opener has no item. */
  stepSize?: number;
}

/** Whether the visible per-row "Sources" button is shown at all. Touch layouts
 *  have no right-click, so the button stays their only door into the full
 *  source list and the exact-quantity picker; on desktop the same actions ride
 *  the row's context menu (right-click / the native Context Menu key) and the
 *  button is withheld so material rows stay as lean as every other row. */
export function materialSourcesButtonShown(): boolean {
  return document.body.classList.contains('mobile-touch');
}

/** Open the shared dialog for one row: the exact-quantity picker when a
 *  selection factory yields a live session (the caller captured its stack pin
 *  the moment the affordance fired, so nothing is re-resolved here), or the
 *  read-only details list otherwise. A factory that returns null means the
 *  row has left the live inventory, and the affordance REFUSES rather than
 *  falling back to a stale read-only view. Exported for the rows whose own
 *  handler already owns the gesture (the bag cell's right-click at an open
 *  storage pane, the vault row's chosen-quantity button): they open the same
 *  session here instead of growing a second listener. */
export function openMaterialSourcesForRow(
  open: MaterialSourcesDialogOpener,
  itemName: string,
  sources: MaterialComposition,
  opener: HTMLElement,
  selectionFactory?: MaterialSourcesSelectionFactory,
): void {
  const selection = selectionFactory?.();
  if (selectionFactory && !selection) return;
  open({
    itemName,
    sources: selection?.sources ?? sources,
    opener,
    ...(selection ? { onConfirm: selection.onConfirm } : {}),
    ...(selection?.associatedOwners ? { associatedOwners: selection.associatedOwners } : {}),
    ...(selection?.limit === undefined ? {} : { limit: selection.limit }),
    ...(selection?.stepSize === undefined ? {} : { stepSize: selection.stepSize }),
  });
}

/** Add the shared keyboard/context-menu entry point to an existing item row.
 *  Touch long-press remains the row's tooltip peek; desktop right-click and the
 *  native Context Menu key open the full uncapped source list, or, when
 *  `selectionFactory` is supplied, the exact-quantity picker (the same session
 *  the touch-only button opens), so a desktop row needs no extra control. */
export function attachMaterialSourcesContextMenu(
  element: HTMLElement,
  itemName: string,
  sources: MaterialComposition | undefined,
  open: MaterialSourcesDialogOpener | undefined,
  selectionFactory?: MaterialSourcesSelectionFactory,
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
    openMaterialSourcesForRow(open, itemName, sources, element, selectionFactory);
  });
}

/** Add the same details affordance beside an existing row/cell, on touch
 * layouts only (materialSourcesButtonShown): desktop rows reach it through
 * attachMaterialSourcesContextMenu instead. The wrapper is one intentional
 * layout item, and each nested button keeps one purpose. */
export function appendMaterialSourcesActionAfter(
  element: HTMLElement,
  itemName: string,
  sources: MaterialComposition | undefined,
  open: MaterialSourcesDialogOpener | undefined,
  selectionFactory?: MaterialSourcesSelectionFactory,
): HTMLButtonElement | null {
  if (sources === undefined || sources.length === 0 || open === undefined) return null;
  if (!materialSourcesButtonShown()) return null;
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
    openMaterialSourcesForRow(open, itemName, sources, button, selectionFactory);
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
    // A destination with a live ceiling below the stack (a near-cap vault)
    // says so up front, and the rows below cannot select past it.
    const limit = options.limit;
    if (model.selectable && limit !== undefined && limit < model.total) {
      const fits = document.createElement('div');
      fits.className = 'material-sources-summary material-sources-fits';
      fits.textContent = t('hudChrome.materialSources.fits', {
        units: formatNumber(limit, { maximumFractionDigits: 0 }),
      });
      root.appendChild(fits);
    }

    const list = document.createElement('div');
    list.className = 'material-sources-list';
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', t('hudChrome.materialSources.listAria'));
    const quantities = new Map<number, number>();
    const stepSize = options.stepSize ?? DEFAULT_STACK;
    const stepLabel = formatNumber(stepSize, { maximumFractionDigits: 0 });
    const steppers: QuantityStepper[] = [];
    /** One filler per selectable row: sets the row to as much of its count as
     *  `remaining` allows and returns what it took. */
    const fillers: Array<(remaining: number) => number> = [];
    const submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'btn material-sources-confirm';
    submit.textContent = t('hudChrome.materialSources.confirm');
    submit.disabled = true;
    const validQuantity = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
    /** Units the OTHER rows already claim, for the shared ceiling. */
    const claimedExcept = (sourceIndex: number): number => {
      let total = 0;
      for (const [index, value] of quantities) {
        if (index !== sourceIndex && validQuantity(value)) total += value;
      }
      return total;
    };
    const remainingFor = (sourceIndex: number): number =>
      limit === undefined
        ? Number.MAX_SAFE_INTEGER
        : Math.max(0, limit - claimedExcept(sourceIndex));
    const syncSubmit = (): void => {
      const selected = selectedMaterialComposition(model.choices, quantities);
      submit.disabled = selected === null || (limit !== undefined && selected.count > limit);
      // Every row's ceiling moves with the others' claims on a shared limit.
      for (const stepper of steppers) stepper.sync();
    };

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
        const syncQuantity = (): void => {
          const value = input.value.trim() === '' ? Number.NaN : Number(input.value);
          quantities.set(choice.sourceIndex, value);
          syncSubmit();
        };
        // The shared stepper (quantity_stepper.ts): a unit pair inside a
        // bag-stack pair, clamped so the last press lands on the row's bound.
        // The bound is the row's own units less whatever the other rows
        // already claim of a shared destination ceiling.
        const stepper = mountQuantityStepper({
          input,
          bounds: () => ({
            min: 0,
            max: Math.min(choice.row.count, remainingFor(choice.sourceIndex)),
          }),
          size: stepSize,
          labels: {
            bigDown: t('hudChrome.materialSources.decreaseByAria', { source, count: stepLabel }),
            unitDown: t('hudChrome.materialSources.decreaseAria', { source }),
            unitUp: t('hudChrome.materialSources.increaseAria', { source }),
            bigUp: t('hudChrome.materialSources.increaseByAria', { source, count: stepLabel }),
          },
          className: 'material-sources-step',
          bigClassName: 'material-sources-step-big',
          onChange: syncQuantity,
          decorate: (button, kind) => {
            const attr = {
              bigDown: 'materialSourceDecreaseBy',
              unitDown: 'materialSourceDecrease',
              unitUp: 'materialSourceIncrease',
              bigUp: 'materialSourceIncreaseBy',
            }[kind];
            button.dataset[attr] = String(choice.sourceIndex);
          },
        });
        steppers.push(stepper);
        fillers.push((remaining) => {
          const take = Math.min(choice.row.count, remaining);
          input.value = String(take);
          syncQuantity();
          return take;
        });
        input.addEventListener('input', syncQuantity);
        syncQuantity();
        label.htmlFor = inputId;
        appendText(label, 'material-sources-row-label', sourceRowText(choice));
        row.appendChild(label);
        quantity.append(
          stepper.buttons.bigDown,
          stepper.buttons.unitDown,
          input,
          stepper.buttons.unitUp,
          stepper.buttons.bigUp,
        );
        row.appendChild(quantity);
      }
      list.appendChild(row);
    }
    root.appendChild(list);

    const footer = document.createElement('div');
    footer.className = 'material-sources-footer';
    if (model.selectable && options.onConfirm !== undefined) {
      const confirmSelection = (): void => {
        const selected = selectedMaterialComposition(model.choices, quantities);
        if (selected === null) return;
        const callback = this.options?.onConfirm;
        if (!callback) return;
        this.close();
        callback(selected);
      };
      submit.addEventListener('click', confirmSelection);
      // Move all: every row to its whole count (or as much as the ceiling
      // allows), then the same confirm the Move selected button runs, so the
      // whole stack moves in one press with its full composition (the classic
      // whole-stack click, from inside the picker).
      const moveAll = document.createElement('button');
      moveAll.type = 'button';
      moveAll.className = 'btn material-sources-move-all';
      moveAll.textContent = t('hudChrome.materialSources.moveAll');
      moveAll.addEventListener('click', () => {
        // Rows fill in display order until the shared ceiling (if any) is
        // spent, so Move all at a near-cap vault moves exactly what fits.
        let remaining = limit ?? Number.MAX_SAFE_INTEGER;
        for (const fill of fillers) remaining -= fill(remaining);
        confirmSelection();
      });
      footer.append(moveAll, submit);
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
