// Trade window painter: paints #trade-window from the structured TradeViewModel
// (trade_view.ts) and wires the offer/accept/cancel/currency controls. Cold,
// event-driven window (the vendor/bank shape): a full innerHTML rebuild on any
// change to the offer signature, driven from Hud's slow-band update; nothing
// here runs on the per-frame hot path.
//
// Replaces the formerly-inline Hud.updateTradeWindow/itemRow (house rule: the
// HUD monolith never grows, extract). Closes two real pre-extraction gaps: a
// markDialogRoot chrome root (WCAG 2.2 AA, previously missing) and item
// tooltips on every offered/received row (previously icon+label only, unlike
// vendor_window's deps.attachTooltip usage).

import { ITEMS } from '../sim/data';
import { markDialogRoot } from './dialog_root';
import { itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import { formatMoney as formatLocalizedMoney, formatNumber, t } from './i18n';
import type { PainterHostPresentation } from './painter_host';
import { buildWocPayPanel } from './payment_panel';
import type { TradeItemRowModel, TradeSettleModel, TradeViewModel } from './trade_view';
import { svgIcon } from './ui_icons';

/**
 * Hud-supplied glue. Composes the shared PainterHostPresentation icon/money/
 * tooltip bag (see vendor_window.ts's identical composition) and adds the
 * trade-specific offer/accept/cancel/currency callbacks. `addItem` is
 * deliberately NOT part of this deps bag: staging an item is driven by the
 * bags window (Hud.addItemToTrade), never by a control painted here.
 */
export interface TradeWindowDeps extends PainterHostPresentation {
  /** Remove one unit of the offered row at this index in myRows (a fungible
   *  row decrements by one; an instance row, always count 1, removes the row). */
  onRemoveOffered(index: number): void;
  onMoneyChange(copper: number): void;
  onClaudiumChange(amount: number): void;
  onWocChange(raw: string): void;
  onConfirm(): void;
  onCancel(): void;
  /** Best-effort clipboard write for the settling panel's payment-link copy
   *  button; failures are swallowed by the caller (Hud), never thrown here. */
  copyToClipboard(text: string): void;
  /** Install the shared FocusManager Tab-trap for #trade-window on open, returning
   *  the opener to restore (fix F7e/r8#3). Driven by Hud on the open transition. */
  captureFocus(): HTMLElement | null;
  /** Release the Tab-trap and return focus to the captured opener on close. */
  restoreFocus(target: HTMLElement | null): void;
}

const SETTLE_STATUS_KEYS = {
  pending: 'hud.trade.statusPending',
  done: 'hud.trade.statusDone',
} as const;

function itemName(itemId: string): string {
  const item = ITEMS[itemId];
  return item ? itemDisplayName(item) : itemId;
}

function rowInner(row: TradeItemRowModel, deps: TradeWindowDeps): string {
  const item = ITEMS[row.itemId];
  const label = row.showCount
    ? `${itemName(row.itemId)} ${t('itemUi.bags.stackCount', { count: formatNumber(row.count, { maximumFractionDigits: 0 }) })}`
    : itemName(row.itemId);
  const icon = item ? deps.itemIcon(item) : `<span class="item-icon q-${row.qualityKey}"></span>`;
  return `${icon}<span>${esc(label)}</span>`;
}

// A signer / rolled-stats line for an instanced row (fix F7d/r8#2), so a player
// can tell a signed/enchanted/rolled copy apart from a plain one before
// confirming. Every interpolated value routes through esc().
function instanceTooltipLine(instance: TradeItemRowModel['instance']): string {
  if (!instance) return '';
  const lines: string[] = [];
  if (instance.signer) {
    lines.push(esc(t('hud.trade.instanceSignedBy', { name: instance.signer })));
  }
  const stats = instance.rolled?.stats;
  const entries = stats ? Object.entries(stats) : [];
  if (entries.length > 0) {
    lines.push(esc(entries.map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v}`).join(', ')));
  }
  if (lines.length === 0) lines.push(esc(t('hud.trade.instanceUnique')));
  return lines.map((line) => `<div class="tt-instance">${line}</div>`).join('');
}

function attachRowTooltip(el: HTMLElement, row: TradeItemRowModel, deps: TradeWindowDeps): void {
  const item = ITEMS[row.itemId];
  if (!item) return;
  deps.attachTooltip(el, () => deps.itemTooltip(item) + instanceTooltipLine(row.instance));
}

function buildOfferColumn(
  rows: TradeItemRowModel[],
  mine: boolean,
  deps: TradeWindowDeps,
  onEmptyKey: 'hud.trade.emptyMine' | 'hud.trade.emptyTheirs',
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'trade-items';
  if (rows.length === 0) {
    wrap.innerHTML = `<div class="trade-empty">${esc(t(onEmptyKey))}</div>`;
    return wrap;
  }
  rows.forEach((row, index) => {
    const el = document.createElement(mine ? 'button' : 'div') as HTMLElement;
    el.className = `trade-item${mine ? ' mine' : ''}${row.instance ? ' instance' : ''}`;
    if (mine) (el as HTMLButtonElement).type = 'button';
    el.innerHTML = rowInner(row, deps);
    if (mine) {
      el.addEventListener('click', () => deps.onRemoveOffered(index));
    }
    attachRowTooltip(el, row, deps);
    wrap.appendChild(el);
  });
  return wrap;
}

function settleStatusText(status: 'none' | 'pending' | 'done'): string {
  if (status === 'none') return '';
  return t(SETTLE_STATUS_KEYS[status]);
}

function buildSettleRow(
  labelKey:
    | 'hud.trade.legYourClaudium'
    | 'hud.trade.legTheirClaudium'
    | 'hud.trade.legYourWoc'
    | 'hud.trade.legTheirWoc',
  status: 'none' | 'pending' | 'done',
): HTMLElement | null {
  if (status === 'none') return null;
  const row = document.createElement('div');
  row.className = `trade-settle-leg is-${status}`;
  row.innerHTML = `<span class="trade-settle-label">${esc(t(labelKey))}</span><span class="trade-settle-status">${esc(settleStatusText(status))}</span>`;
  return row;
}

function buildSettlePanel(settle: TradeSettleModel | null): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'trade-settle';
  if (!settle) return panel;
  const rows: Array<HTMLElement | null> = [
    buildSettleRow('hud.trade.legYourClaudium', settle.claudiumMine),
    buildSettleRow('hud.trade.legTheirClaudium', settle.claudiumTheirs),
    buildSettleRow('hud.trade.legYourWoc', settle.wocMine),
    buildSettleRow('hud.trade.legTheirWoc', settle.wocTheirs),
  ];
  for (const row of rows) if (row) panel.appendChild(row);
  return panel;
}

/** Paint #trade-window from a prepared view. Hides the window on 'closed'; the
 *  caller (Hud) owns the bags companion visibility and stagedTrade reset. */
export function renderTradeWindow(
  el: HTMLElement,
  view: TradeViewModel,
  deps: TradeWindowDeps,
): void {
  if (view.kind === 'closed') {
    el.style.display = 'none';
    return;
  }

  const titleText =
    view.kind === 'settling'
      ? t('hud.trade.settlingTitle')
      : t('hud.trade.title', { name: view.otherName });
  markDialogRoot(el, { label: titleText });

  el.innerHTML = `<div class="panel-title"><span>${esc(titleText)}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('hud.trade.cancel'))}">${svgIcon('close')}</button></div>`;
  el.querySelector('[data-close]')?.addEventListener('click', () => deps.onCancel());

  const cols = document.createElement('div');
  cols.className = 'trade-cols';

  const myCol = document.createElement('div');
  myCol.className = `trade-col${view.kind === 'open' && view.myAccepted ? ' accepted' : ''}`;
  const myHeader = document.createElement('h4');
  myHeader.textContent = t('hud.trade.yourOffer');
  myCol.appendChild(myHeader);
  myCol.appendChild(buildOfferColumn(view.myRows, true, deps, 'hud.trade.emptyMine'));

  const theirCol = document.createElement('div');
  theirCol.className = `trade-col${view.kind === 'open' && view.theirAccepted ? ' accepted' : ''}`;
  const theirHeader = document.createElement('h4');
  theirHeader.textContent = t('hud.trade.theirOffer', { name: view.otherName });
  theirCol.appendChild(theirHeader);
  theirCol.appendChild(buildOfferColumn(view.theirRows, false, deps, 'hud.trade.emptyTheirs'));

  if (view.kind === 'open') {
    // --- my side: editable inputs (coin trio, gated Claudium, gated WOC) ---
    const money = document.createElement('div');
    money.className = 'trade-money';
    money.innerHTML =
      `<span class="trade-money-label">${esc(t('hud.trade.money'))}:</span>` +
      `<span class="trade-coins">` +
      `<input class="coininput" id="trade-g" type="number" min="0" value="${view.myCoin.gold}" aria-label="${esc(t('itemUi.money.gold'))}"><span class="coin g" aria-hidden="true"></span><span class="mkt-coin-tag">${esc(t('itemUi.money.goldShort'))}</span>` +
      `<input class="coininput" id="trade-s" type="number" min="0" max="99" value="${view.myCoin.silver}" aria-label="${esc(t('itemUi.money.silver'))}"><span class="coin s" aria-hidden="true"></span><span class="mkt-coin-tag">${esc(t('itemUi.money.silverShort'))}</span>` +
      `<input class="coininput" id="trade-c" type="number" min="0" max="99" value="${view.myCoin.copper}" aria-label="${esc(t('itemUi.money.copper'))}"><span class="coin c" aria-hidden="true"></span><span class="mkt-coin-tag">${esc(t('itemUi.money.copperShort'))}</span>` +
      `</span>`;
    myCol.appendChild(money);

    if (view.rails.claudium) {
      const row = document.createElement('div');
      row.className = 'trade-currency trade-currency-claudium';
      row.innerHTML =
        `<span class="trade-money-label">${esc(t('hud.trade.claudiumLabel'))}:</span>` +
        `<img class="claudium-coin" src="/claudium/icons/claudium_coin_64.webp" alt="">` +
        `<input class="trade-currency-input" id="trade-claudium" type="number" min="0" step="1" inputmode="numeric" value="${Math.max(0, Math.floor(view.myClaudium))}" aria-label="${esc(t('hud.trade.claudiumLabel'))}">`;
      myCol.appendChild(row);
    }
    if (view.rails.woc) {
      const row = document.createElement('div');
      row.className = 'trade-currency trade-currency-woc';
      row.innerHTML =
        `<span class="trade-money-label">${esc(t('hud.trade.wocLabel'))}:</span>` +
        `<span class="woc-coin" aria-hidden="true"></span>` +
        `<input class="trade-currency-input" id="trade-woc" type="text" inputmode="decimal" pattern="[0-9]*\\.?[0-9]*" value="${esc(view.myWoc === '0' ? '' : view.myWoc)}" aria-label="${esc(t('hud.trade.wocLabel'))}">`;
      myCol.appendChild(row);
    }

    // --- their side: read-only money/currency readouts ---
    const theirMoney = document.createElement('div');
    theirMoney.className = 'trade-money';
    theirMoney.innerHTML = `${esc(t('hud.trade.money'))}: <span class="gold">${formatLocalizedMoney(view.theirCopper)}</span>`;
    theirCol.appendChild(theirMoney);
    if (view.theirClaudium > 0) {
      const row = document.createElement('div');
      row.className = 'trade-currency trade-currency-readonly';
      row.textContent = `${t('hud.trade.claudiumLabel')}: ${formatNumber(view.theirClaudium, { maximumFractionDigits: 0 })}`;
      theirCol.appendChild(row);
    }
    if (view.theirWoc !== '0') {
      const row = document.createElement('div');
      row.className = 'trade-currency trade-currency-readonly';
      row.textContent = `${t('hud.trade.wocLabel')}: ${view.theirWoc}`;
      theirCol.appendChild(row);
    }
  } else {
    // settling: money/currency readouts on both sides (no inputs, escrowed)
    for (const [col, copper, claudium, woc] of [
      [myCol, view.myCopper, view.myClaudium, view.myWoc] as const,
      [theirCol, view.theirCopper, view.theirClaudium, view.theirWoc] as const,
    ]) {
      const money = document.createElement('div');
      money.className = 'trade-money';
      money.innerHTML = `${esc(t('hud.trade.money'))}: <span class="gold">${formatLocalizedMoney(copper)}</span>`;
      col.appendChild(money);
      if (claudium > 0) {
        const row = document.createElement('div');
        row.className = 'trade-currency trade-currency-readonly';
        row.textContent = `${t('hud.trade.claudiumLabel')}: ${formatNumber(claudium, { maximumFractionDigits: 0 })}`;
        col.appendChild(row);
      }
      if (woc !== '0') {
        const row = document.createElement('div');
        row.className = 'trade-currency trade-currency-readonly';
        row.textContent = `${t('hud.trade.wocLabel')}: ${woc}`;
        col.appendChild(row);
      }
    }
  }

  cols.append(myCol, theirCol);
  el.appendChild(cols);

  if (view.kind === 'open') {
    const hint = document.createElement('div');
    hint.className = 'trade-hint';
    hint.textContent = t('hud.trade.hint');
    el.appendChild(hint);

    const acceptBtn = document.createElement('button');
    acceptBtn.type = 'button';
    acceptBtn.className = 'btn';
    acceptBtn.textContent = view.myAccepted ? t('hud.trade.waiting') : t('hud.trade.accept');
    acceptBtn.disabled = view.myAccepted;
    acceptBtn.addEventListener('click', () => deps.onConfirm());
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn';
    cancelBtn.textContent = t('hud.trade.cancel');
    cancelBtn.addEventListener('click', () => deps.onCancel());
    el.append(acceptBtn, cancelBtn);

    const syncMoney = () => {
      const g = Math.max(
        0,
        Math.floor(Number((el.querySelector('#trade-g') as HTMLInputElement)?.value) || 0),
      );
      const s = Math.max(
        0,
        Math.floor(Number((el.querySelector('#trade-s') as HTMLInputElement)?.value) || 0),
      );
      const c = Math.max(
        0,
        Math.floor(Number((el.querySelector('#trade-c') as HTMLInputElement)?.value) || 0),
      );
      deps.onMoneyChange(g * 10000 + s * 100 + c);
    };
    el.querySelector('#trade-g')?.addEventListener('change', syncMoney);
    el.querySelector('#trade-s')?.addEventListener('change', syncMoney);
    el.querySelector('#trade-c')?.addEventListener('change', syncMoney);
    el.querySelector('#trade-claudium')?.addEventListener('change', (ev) => {
      const raw = Math.max(0, Math.floor(Number((ev.target as HTMLInputElement).value) || 0));
      deps.onClaudiumChange(raw);
    });
    el.querySelector('#trade-woc')?.addEventListener('change', (ev) => {
      deps.onWocChange((ev.target as HTMLInputElement).value);
    });
  } else {
    el.appendChild(buildSettlePanel(view.settle));
    if (view.wocPay) {
      el.appendChild(
        buildWocPayPanel(
          t('hud.trade.wocPayPrompt', { amount: view.wocPay.amountUi }),
          view.wocPay.uri,
          deps,
        ),
      );
    }
    // Settling is not necessarily un-cancellable: the server orchestrator (not
    // the sim) decides whether trade_cancel still unwinds the escrow at this
    // phase (refused only once a $WOC leg has verified on-chain). The button
    // stays live and simply issues the same cancel command as the open phase.
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn';
    cancelBtn.textContent = t('hud.trade.cancel');
    cancelBtn.addEventListener('click', () => deps.onCancel());
    el.appendChild(cancelBtn);
  }

  el.style.display = 'block';
}
