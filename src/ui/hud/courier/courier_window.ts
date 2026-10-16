import type { CourierDispatchRequest, CourierInfo } from '../../../sim/courier/types';
import { ITEMS } from '../../../sim/data';
import type { InvSlot } from '../../../sim/types';
import { markDialogRoot } from '../../dialog_root';
import { esc } from '../../esc';
import {
  captureFocusKey,
  findFocusKey,
  focusKeyAttr,
  restoreFirstEnabled,
} from '../../focus_restore';
import { formatNumber, t } from '../../i18n';
import type { PainterHostPresentation } from '../../painter_host';
import { wornItemCellParts } from '../../worn_item_cell_view';
import {
  COURIER_SELECTION_LIMIT,
  canDispatchCourier,
  courierSelectionMatches,
  courierStackSelectable,
  emptyCourierDraft,
  reconcileCourierDraft,
  toggleCourierStack,
} from './courier_core';

export interface CourierWindowDeps
  extends Pick<PainterHostPresentation, 'itemIcon' | 'itemTooltip' | 'attachTooltip'> {
  info(): CourierInfo | null;
  inventory(): readonly InvSlot[];
  hideTooltip(): void;
  dispatch(request: CourierDispatchRequest): void;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  onClosed(): void;
}

/** Cold, signature-gated window. All custody and travel are authoritative. */
export class CourierWindow {
  private draft = emptyCourierDraft();
  private lastSignature = '';
  private cheapSignature = '';
  private opened = false;
  private opener: HTMLElement | null = null;
  constructor(
    private el: HTMLElement,
    private deps: CourierWindowDeps,
  ) {}
  isOpen(): boolean {
    return this.opened;
  }
  open(): void {
    if (this.opened) {
      this.render(true);
      return;
    }
    this.deps.closeOthers();
    this.opener = this.deps.captureFocus();
    this.opened = true;
    this.el.style.display = 'flex';
    this.render(true);
    this.el.querySelector<HTMLButtonElement>('.x-btn')?.focus({ preventScroll: true });
  }
  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.deps.hideTooltip();
    this.el.style.display = 'none';
    this.reset();
    this.deps.restoreFocus(this.opener);
    this.opener = null;
    this.deps.onClosed();
  }
  refreshIfChanged(): void {
    if (this.opened) this.render();
  }
  reset(): void {
    this.draft = emptyCourierDraft();
    this.lastSignature = '';
    this.cheapSignature = '';
  }
  render(force = false): void {
    const info = this.deps.info();
    const cheapSignature = `${info?.phase}:${info?.active}:${info?.revision}:${info?.inventoryRevision}:${info?.bankRevision}`;
    if (!force && cheapSignature === this.cheapSignature) return;
    this.cheapSignature = cheapSignature;
    const inventory = info?.phase === 'ready' ? this.deps.inventory() : [];
    const ready = info?.phase === 'ready';
    this.draft = ready
      ? reconcileCourierDraft(this.draft, inventory, info.bankSlots)
      : emptyCourierDraft();
    // Pose is deliberately absent: moving the donkey never rebuilds this window.
    const signature = JSON.stringify([
      info?.phase,
      info?.active,
      info?.revision,
      info?.cargo,
      ready ? inventory : null,
      ready ? info.bankSlots : null,
      this.draft,
    ]);
    if (!force && signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.deps.hideTooltip();
    const focus = captureFocusKey(this.el);
    const scroll = this.el.querySelector('.ui-win-body')?.scrollTop ?? 0;
    markDialogRoot(this.el, { labelledBy: 'courier-title' });
    const count = this.draft.deposits.length + this.draft.withdrawals.length;
    const status = info ? t(`hudChrome.courier.${info.phase}`) : t('hudChrome.courier.unavailable');
    this.el.innerHTML = `<div class="panel-title ui-win-head"><span id="courier-title" class="ui-win-title">${esc(t('hudChrome.courier.title'))}</span><button type="button" class="x-btn ui-x-btn" aria-label="${esc(t('hudChrome.courier.close'))}"${focusKeyAttr('close')}>×</button></div>
      <div class="ui-win-body"><p role="status">${esc(status)}</p>
      ${info && !info.active ? `<p class="ui-muted">${esc(t('hudChrome.courier.membership'))}</p>` : ''}
      ${ready ? `<p class="ui-muted">${esc(t('hudChrome.courier.instructions'))}</p><div class="courier-columns">${this.rows('deposits', inventory, !!info.active)}${this.rows('withdrawals', info.bankSlots, !!info.active)}</div>` : ''}
      ${info && !ready ? `<section><h3>${esc(t('hudChrome.courier.cargo'))}</h3>${this.cargo(info.cargo)}<p class="ui-muted">${esc(t('hudChrome.courier.cargoSafe'))}</p></section>` : ''}</div>
      ${ready ? `<div class="ui-win-foot"><span>${esc(t('hudChrome.courier.selected', { count: formatNumber(count), limit: formatNumber(COURIER_SELECTION_LIMIT) }))}</span><button class="ui-btn ui-btn--gold courier-send" type="button"${focusKeyAttr('send')} ${canDispatchCourier(info, this.draft) ? '' : 'disabled'}>${esc(t('hudChrome.courier.send'))}</button></div>` : ''}`;
    this.el.querySelector<HTMLButtonElement>('.x-btn')!.onclick = () => this.close();
    for (const button of this.el.querySelectorAll<HTMLButtonElement>('[data-courier-side]')) {
      button.onclick = () => {
        const live = this.deps.info();
        if (!live?.active || live.phase !== 'ready') return;
        const side = button.dataset.courierSide as keyof CourierDispatchRequest;
        const slots = side === 'deposits' ? this.deps.inventory() : live.bankSlots;
        // Refresh before applying a stale row click; never silently select its replacement.
        const index = Number(button.dataset.courierIndex);
        if (!courierStackSelectable(slots[index])) return;
        const previous = side === 'deposits' ? inventory : info!.bankSlots;
        if (JSON.stringify(previous[index]) !== JSON.stringify(slots[index])) {
          this.render(true);
          return;
        }
        this.draft = toggleCourierStack(this.draft, side, index, slots);
        this.render(true);
      };
    }
    for (const cell of this.el.querySelectorAll<HTMLElement>('[data-courier-item]')) {
      const side = cell.dataset.courierItem;
      const slots =
        side === 'deposits'
          ? inventory
          : side === 'withdrawals'
            ? (info?.bankSlots ?? [])
            : (info?.cargo ?? []);
      const slot = slots[Number(cell.dataset.courierSlot)];
      const item = slot && ITEMS[slot.itemId];
      if (item)
        this.deps.attachTooltip(cell, () =>
          this.deps.itemTooltip(item, slot.instance, slot.materialSources),
        );
    }
    const send = this.el.querySelector<HTMLButtonElement>('.courier-send');
    if (send)
      send.onclick = () => {
        const live = this.deps.info();
        this.draft = reconcileCourierDraft(
          this.draft,
          this.deps.inventory(),
          live?.bankSlots ?? [],
        );
        if (canDispatchCourier(live, this.draft)) {
          this.deps.dispatch(this.draft);
          this.draft = emptyCourierDraft();
        }
        this.render(true);
      };
    const body = this.el.querySelector('.ui-win-body');
    if (body) body.scrollTop = scroll;
    if (focus)
      restoreFirstEnabled([
        findFocusKey(this.el, focus),
        this.el.querySelector<HTMLButtonElement>('.x-btn'),
      ]);
  }
  private rows(
    side: keyof CourierDispatchRequest,
    slots: readonly InvSlot[],
    active: boolean,
  ): string {
    const title = t(side === 'deposits' ? 'hudChrome.courier.bags' : 'hudChrome.courier.bank');
    const atLimit =
      this.draft.deposits.length + this.draft.withdrawals.length >= COURIER_SELECTION_LIMIT;
    return `<section><h3>${esc(title)}</h3><div class="courier-list">${
      slots.length
        ? slots
            .map((slot, index) => {
              const selected = this.draft[side].some(
                (s) => s.index === index && courierSelectionMatches(s, slots),
              );
              const def = ITEMS[slot.itemId];
              const parts = def ? wornItemCellParts(def, slot.instance) : null;
              const item = parts?.ariaName ?? slot.itemId;
              const selectable = courierStackSelectable(slot);
              return `<button type="button" class="ui-btn courier-item ${selected ? 'ui-btn--on' : ''}" data-courier-side="${side}" data-courier-index="${index}" data-courier-item="${side}" data-courier-slot="${index}" aria-pressed="${selected}" aria-label="${esc(t(selected ? 'hudChrome.courier.selectedItem' : 'hudChrome.courier.select', { item, count: formatNumber(slot.count) }))}"${focusKeyAttr(`${side}-${index}`)} ${!active || !selectable || (atLimit && !selected) ? 'disabled' : ''}><span class="courier-item-label">${def && parts ? this.deps.itemIcon(def, parts.quality) : ''}<span>${esc(parts?.name ?? item)}${parts?.qualityBadge ?? ''}</span></span><span class="ui-num">${esc(formatNumber(slot.count))}</span></button>`;
            })
            .join('')
        : `<p class="ui-muted">${esc(t('hudChrome.courier.empty'))}</p>`
    }</div></section>`;
  }
  private cargo(slots: readonly InvSlot[]): string {
    if (!slots.length) return `<p class="ui-muted">${esc(t('hudChrome.courier.empty'))}</p>`;
    return `<ul class="courier-cargo">${slots
      .map((slot, index) => {
        const item = ITEMS[slot.itemId];
        const parts = item ? wornItemCellParts(item, slot.instance) : null;
        return `<li data-courier-item="cargo" data-courier-slot="${index}" tabindex="0"${focusKeyAttr(`cargo-${index}`)}><span class="courier-item-label">${item && parts ? this.deps.itemIcon(item, parts.quality) : ''}<span>${esc(parts?.name ?? slot.itemId)}${parts?.qualityBadgeLabelled ?? ''}</span></span><span class="ui-num">${esc(formatNumber(slot.count))}</span></li>`;
      })
      .join('')}</ul>`;
  }
}
