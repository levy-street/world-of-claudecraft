// Thin DOM action sheet for deliberate mobile interactions with a selected bag item.

import type { MobileBagItemAction, MobileBagItemActionId } from './bag_item_actions_view';
import { formatNumber, t } from './i18n';
import { svgIcon } from './ui_icons';

export interface BagItemActionMenuDeps {
  showError(text: string): void;
  restoreFocus(target: HTMLElement | null): void;
  onDismiss(): void;
}

export interface BagItemActionMenuOpenOptions {
  host: HTMLElement;
  itemId: string;
  itemName: string;
  /** Trusted, escaped markup produced only by the canonical itemTooltip renderer. */
  itemDetailsHtml: string;
  actions: readonly MobileBagItemAction[];
  canAssignConsumable: boolean;
  layout: readonly (string | null)[] | null;
  customLayout?: boolean;
  itemNameForId?: (itemId: string) => string;
  onAction(action: MobileBagItemActionId): boolean;
  onAssign(slotIndex: number): boolean;
  onReset(): boolean;
  opener: HTMLElement | null;
}

const ACTION_LABELS: Record<MobileBagItemActionId, Parameters<typeof t>[0]> = {
  equip: 'hudChrome.bags.itemActionEquip',
  equipBag: 'hudChrome.bags.itemActionEquipBag',
  use: 'hudChrome.bags.itemActionUse',
  consume: 'hudChrome.bags.itemActionConsume',
  linkToChat: 'hudChrome.bags.itemActionLinkToChat',
  destroy: 'hudChrome.bags.itemActionDestroy',
};

export class BagItemActionMenu {
  private root: HTMLElement | null = null;
  private opener: HTMLElement | null = null;

  constructor(private readonly deps: BagItemActionMenuDeps) {}

  get isOpen(): boolean {
    return this.root !== null;
  }

  open(options: BagItemActionMenuOpenOptions): void {
    this.close(false);
    this.opener = options.opener;

    const root = document.createElement('div');
    root.className = 'bag-item-action-menu';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'bag-item-action-title');

    const sheet = document.createElement('div');
    sheet.className = 'bag-item-action-sheet panel';
    root.appendChild(sheet);

    const header = document.createElement('div');
    header.className = 'bag-item-action-header panel-title';
    const title = document.createElement('strong');
    title.id = 'bag-item-action-title';
    title.textContent = t('hudChrome.bags.itemActionsTitle', { item: options.itemName });
    header.appendChild(title);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'bag-item-action-close x-btn';
    close.innerHTML = svgIcon('close');
    close.setAttribute('aria-label', t('hudChrome.bags.itemActionClose'));
    close.addEventListener('click', () => this.dismiss());
    header.appendChild(close);
    sheet.appendChild(header);

    const layout = document.createElement('div');
    layout.className = 'bag-item-action-layout';
    const detailPane = document.createElement('section');
    detailPane.className = 'bag-item-action-detail-pane';
    const detailHeading = document.createElement('h3');
    detailHeading.id = 'bag-item-action-detail-title';
    detailHeading.className = 'bag-item-action-detail-heading';
    detailHeading.textContent = t('hudChrome.bags.itemActionDetails');
    detailPane.appendChild(detailHeading);
    const details = document.createElement('div');
    details.className = 'bag-item-action-details';
    details.setAttribute('role', 'region');
    details.setAttribute('aria-labelledby', detailHeading.id);
    // Trust boundary: this is assigned verbatim from BagsWindow's itemTooltip(item)
    // result. The menu never concatenates raw item/player/translation text into it.
    details.innerHTML = options.itemDetailsHtml;
    detailPane.appendChild(details);
    const controls = document.createElement('div');
    controls.className = 'bag-item-action-controls';
    layout.append(detailPane, controls);
    sheet.appendChild(layout);

    const actions = document.createElement('div');
    actions.className = 'bag-item-actions cd-actions';
    let firstAction: HTMLButtonElement | null = null;
    for (const action of options.actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `bag-item-action btn${
        action.destructive ? ' destructive' : action.id === 'linkToChat' ? ' secondary' : ' cd-ok'
      }`;
      button.dataset.action = action.id;
      button.textContent = t(ACTION_LABELS[action.id]);
      button.setAttribute('aria-label', t(ACTION_LABELS[action.id]));
      firstAction ??= button;
      button.addEventListener('click', () => {
        if (options.onAction(action.id)) this.close(action.id !== 'linkToChat');
        else this.deps.showError(t('hudChrome.bags.itemActionFailed'));
      });
      actions.appendChild(button);
    }
    controls.appendChild(actions);

    if (options.canAssignConsumable) {
      const label = document.createElement('div');
      label.className = 'bag-item-action-assign-title';
      label.textContent = t('hudChrome.bags.itemActionAssignTitle');
      controls.appendChild(label);
      const destinations = document.createElement('div');
      destinations.className = 'bag-item-destinations';
      for (let index = 0; index < 6; index++) {
        const slotNumber = formatNumber(index + 1, { maximumFractionDigits: 0 });
        const assignedId = options.layout?.[index] ?? null;
        const assignedName = assignedId
          ? (options.itemNameForId?.(assignedId) ?? assignedId)
          : undefined;
        const selectedHere = assignedId === options.itemId;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `bag-item-destination btn${selectedHere ? ' current cd-ok' : ''}`;
        button.dataset.slot = String(index);
        button.textContent = slotNumber;
        button.setAttribute(
          'aria-label',
          selectedHere
            ? t('hudChrome.bags.itemActionRemoveSlot', { slot: slotNumber })
            : t('hudChrome.bags.itemActionAssignSlot', { slot: slotNumber }),
        );
        button.setAttribute(
          'title',
          assignedName
            ? t('hudChrome.bags.itemActionSlotCurrent', {
                slot: slotNumber,
                item: assignedName,
              })
            : t('hudChrome.bags.itemActionSlotEmpty', { slot: slotNumber }),
        );
        button.addEventListener('click', () => {
          if (options.onAssign(index)) this.close(true);
          else this.deps.showError(t('hudChrome.bags.itemActionInvalid'));
        });
        destinations.appendChild(button);
      }
      controls.appendChild(destinations);

      if (options.customLayout ?? options.layout !== null) {
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'bag-item-action-reset btn';
        reset.textContent = t('hudChrome.bags.itemActionResetAutomatic');
        reset.setAttribute('aria-label', t('hudChrome.bags.itemActionResetAutomatic'));
        reset.addEventListener('click', () => {
          if (options.onReset()) this.close(true);
          else this.deps.showError(t('hudChrome.bags.itemActionFailed'));
        });
        controls.appendChild(reset);
      }
    }

    root.addEventListener('pointerdown', (event) => {
      if (event.target === root) this.dismiss();
    });
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Tab') {
        const controls = Array.from(
          root.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
        return;
      }
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      this.dismiss();
    });
    options.host.appendChild(root);
    this.root = root;
    (firstAction ?? close).focus();
  }

  close(returnFocus: boolean): void {
    this.root?.remove();
    // Keep isOpen true until focus has returned. The originating bag row uses
    // that lifecycle as a live guard for its shared desktop tooltip; clearing it
    // first lets focusin repaint the tooltip while the mobile sheet is closing.
    if (returnFocus) this.deps.restoreFocus(this.opener);
    this.root = null;
    this.opener = null;
  }

  private dismiss(): void {
    if (!this.root) return;
    this.close(true);
    this.deps.onDismiss();
  }
}
