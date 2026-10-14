import { apiUrl } from '../../../client_origin';
import type { CourierDispatchRequest, CourierInfo } from '../../../sim/courier/types';
import { ITEMS } from '../../../sim/data';
import { isItemLocked } from '../../../sim/item_lock_flag';
import type { InvSlot } from '../../../sim/types';
import { bagCornerMark, bagRimClasses } from '../../bag_corner_mark_view';
import { bagFineMark } from '../../bag_fine_mark_view';
import { bagInstanceGlyphKind } from '../../bag_instance_glyph_view';
import { markDialogRoot } from '../../dialog_root';
import { esc } from '../../esc';
import {
  captureFocusKey,
  findFocusKey,
  focusKeyAttr,
  restoreFirstEnabled,
} from '../../focus_restore';
import { formatNumber, t } from '../../i18n';
import { QUALITY_COLOR } from '../../icons';
import {
  cornerMarkHtml,
  INSTANCE_GLYPH_ARIA_KEYS,
  lockMarkHtml,
} from '../../item_instance_glyph_mark';
import { knownItemDef } from '../../known_item';
import type { PainterHostPresentation } from '../../painter_host';
import { svgIcon } from '../../ui_icons';
import { unknownItemIconHtml } from '../../unknown_item_icon';
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
  inventoryCapacity?(): number;
  hideTooltip(): void;
  dispatch(request: CourierDispatchRequest): void;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  onClosed?(): void;
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
    this.deps.onClosed?.();
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
    const cheapSignature = `${info?.phase}:${info?.active}:${info?.revision}:${info?.inventoryRevision}:${info?.bankRevision}:${info?.bankCapacity}:${this.deps.inventoryCapacity?.()}`;
    if (!force && cheapSignature === this.cheapSignature) return;
    this.cheapSignature = cheapSignature;
    const inventory = info?.phase === 'ready' ? this.deps.inventory() : [];
    const ready = info?.phase === 'ready';
    const inventoryCapacity = this.deps.inventoryCapacity?.() ?? inventory.length;
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
      ready ? info.bankCapacity : null,
      inventoryCapacity,
      this.draft,
    ]);
    if (!force && signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.deps.hideTooltip();
    const focus = captureFocusKey(this.el);
    const scroll = this.el.querySelector('.ui-win-body')?.scrollTop ?? 0;
    const gridScroll = new Map(
      [...this.el.querySelectorAll<HTMLElement>('[data-courier-storage]')].map((pane) => [
        pane.dataset.courierStorage,
        pane.querySelector('.courier-grid')?.scrollTop ?? 0,
      ]),
    );
    markDialogRoot(this.el, { labelledBy: 'courier-title' });
    const count = this.draft.deposits.length + this.draft.withdrawals.length;
    const status = info ? t(`hudChrome.courier.${info.phase}`) : t('hudChrome.courier.unavailable');
    this.el.innerHTML = `<div class="panel-title ui-win-head"><span id="courier-title" class="ui-win-title">${esc(t('hudChrome.courier.title'))}</span><button type="button" class="x-btn ui-x-btn" aria-label="${esc(t('hudChrome.courier.close'))}"${focusKeyAttr('close')}>×</button></div>
      <div class="ui-win-body"><p role="status">${esc(status)}</p>
      ${info && !info.active ? `<p class="ui-muted">${esc(t('hudChrome.courier.membership'))}</p>` : ''}
      ${ready ? `<p class="ui-muted courier-instructions">${esc(t('hudChrome.courier.instructions'))}</p><div class="courier-columns">${this.rows('withdrawals', info.bankSlots, !!info.active, info.bankCapacity)}${this.portrait()}${this.rows('deposits', inventory, !!info.active, inventoryCapacity)}</div>` : this.portrait()}
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
    for (const pane of this.el.querySelectorAll<HTMLElement>('[data-courier-storage]')) {
      const grid = pane.querySelector('.courier-grid');
      if (grid) grid.scrollTop = gridScroll.get(pane.dataset.courierStorage) ?? 0;
    }
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
    capacity: number,
  ): string {
    const title = t(
      side === 'deposits' ? 'hudChrome.courier.inventory' : 'hudChrome.courier.bankTitle',
    );
    const hint = t(side === 'deposits' ? 'hudChrome.courier.bags' : 'hudChrome.courier.bank');
    const atLimit =
      this.draft.deposits.length + this.draft.withdrawals.length >= COURIER_SELECTION_LIMIT;
    const cells = slots.map((slot, index) => {
      const selected = this.draft[side].some(
        (selection) => selection.index === index && courierSelectionMatches(selection, slots),
      );
      const def = knownItemDef(ITEMS, slot.itemId);
      const parts = def ? wornItemCellParts(def, slot.instance) : null;
      const item = parts?.ariaName ?? slot.itemId;
      const selectable = courierStackSelectable(slot);
      const fine = bagFineMark(slot.itemId);
      const quest = def?.kind === 'quest' ? 'quest' : null;
      const glyph = bagInstanceGlyphKind(slot.instance);
      const mark = bagCornerMark(glyph, quest, fine);
      const description = isItemLocked(slot.instance)
        ? t('hudChrome.bags.itemAriaLocked', { item, count: formatNumber(slot.count) })
        : glyph
          ? t(INSTANCE_GLYPH_ARIA_KEYS[glyph], { item, count: formatNumber(slot.count) })
          : '';
      const quality = parts?.quality ?? 'common';
      return `<button type="button" class="bank-item ${side === 'deposits' ? 'bag-item' : ''} ui-socket ui-socket--bag courier-item q-${quality}${bagRimClasses(quest, fine)}" style="--bank-slot-quality:${QUALITY_COLOR[quality]}" data-courier-side="${side}" data-courier-index="${index}" data-courier-item="${side}" data-courier-slot="${index}" aria-pressed="${selected}" aria-description="${esc(description)}" aria-label="${esc(t(selected ? 'hudChrome.courier.selectedItem' : 'hudChrome.courier.select', { item, count: formatNumber(slot.count) }))}"${focusKeyAttr(`${side}-${index}`)} ${!active || !selectable || (atLimit && !selected) ? 'disabled' : ''}>${def && parts ? this.deps.itemIcon(def, parts.quality) : unknownItemIconHtml(slot.itemId)}${parts?.qualityBadge ?? ''}${cornerMarkHtml(mark)}${lockMarkHtml(isItemLocked(slot.instance))}<span class="bank-count">${slot.count > 1 ? esc(formatNumber(slot.count)) : ''}</span>${selected ? `<span class="courier-selected" aria-hidden="true">${svgIcon('check')}</span>` : ''}</button>`;
    });
    for (let index = slots.length; index < capacity; index++)
      cells.push(
        '<span class="bank-item empty ui-socket ui-socket--bag" aria-hidden="true"></span>',
      );
    return `<section class="courier-storage" data-courier-storage="${side}" aria-labelledby="courier-${side}-title"><div class="courier-storage-head"><h3 id="courier-${side}-title">${esc(title)}</h3><span class="ui-num ui-muted">${esc(t('hudChrome.courier.capacity', { used: formatNumber(slots.length), capacity: formatNumber(capacity) }))}</span></div><p class="ui-muted courier-storage-hint">${esc(hint)}</p><div class="bank-grid courier-grid">${cells.join('')}</div></section>`;
  }
  private portrait(): string {
    return `<section class="courier-companion"><div class="courier-portrait"><img src="${esc(apiUrl('/ui/courier/donkey.webp'))}" alt="" draggable="false"></div><span class="courier-emblem" aria-hidden="true">${svgIcon('mail')}</span><strong>${esc(t('hudChrome.courier.title'))}</strong><p class="ui-muted">${esc(t('hudChrome.courier.travelTime'))}</p></section>`;
  }
  private cargo(slots: readonly InvSlot[]): string {
    if (!slots.length) return `<p class="ui-muted">${esc(t('hudChrome.courier.empty'))}</p>`;
    return `<ul class="courier-cargo">${slots
      .map((slot, index) => {
        const item = knownItemDef(ITEMS, slot.itemId);
        const parts = item ? wornItemCellParts(item, slot.instance) : null;
        const fine = bagFineMark(slot.itemId);
        const glyph = bagInstanceGlyphKind(slot.instance);
        const mark = bagCornerMark(glyph, null, fine);
        const quality = parts?.quality ?? 'common';
        const label = t(
          isItemLocked(slot.instance)
            ? 'hudChrome.bags.itemAriaLocked'
            : glyph
              ? INSTANCE_GLYPH_ARIA_KEYS[glyph]
              : 'itemUi.bags.itemAria',
          { item: parts?.ariaName ?? slot.itemId, count: formatNumber(slot.count) },
        );
        return `<li data-courier-item="cargo" data-courier-slot="${index}" tabindex="0" aria-label="${esc(label)}"${focusKeyAttr(`cargo-${index}`)}><span class="courier-item-label"><span class="bank-item ui-socket ui-socket--bag courier-cargo-icon q-${quality}${bagRimClasses(null, fine)}" style="--bank-slot-quality:${QUALITY_COLOR[quality]}">${item && parts ? this.deps.itemIcon(item, parts.quality) : unknownItemIconHtml(slot.itemId)}${cornerMarkHtml(mark)}${lockMarkHtml(isItemLocked(slot.instance))}</span><span>${esc(parts?.name ?? slot.itemId)}${parts?.qualityBadgeLabelled ?? ''}</span></span><span class="ui-num">${esc(formatNumber(slot.count))}</span></li>`;
      })
      .join('')}</ul>`;
  }
}
