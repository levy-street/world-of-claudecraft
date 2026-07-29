// Thin DOM consumer for the commission order board (issue #1298).
//
// The consumer half of the pure-core + thin-consumer split (reference
// unbind_window.ts): paints #commission-board-window from the structured
// CommissionOrderBoardModel (commission_order_view.ts) and reports the
// open/cancel/accept/deliver clicks back through the injected callbacks. It
// owns no state: the "open a new order" form reads straight off its own DOM
// inputs at submit time (the crafting window's commission-checkbox precedent
// does not apply here, since this window only repaints right after one of
// ITS OWN actions, never on an unrelated tick, so there is nothing to carry
// across a repaint the player did not trigger). Reuses the vendor family's
// row anatomy (.vendor-item, .vi-name, .vi-sub) and the crafting recipe
// socket for icons.

import { isCommissionEligibleKind } from '../sim/professions/commission';
import type { CommissionOrderBoardModel, CommissionOrderRowModel } from './commission_order_view';
import { esc } from './esc';
import { t } from './i18n';
import { QUALITY_COLOR } from './icons';
import type { PainterHostPresentation } from './painter_host';
import { qualityGlowShadow } from './quality_glow';
import { svgIcon } from './ui_icons';

export interface CommissionOrderWindowDeps extends PainterHostPresentation {
  hideTooltip(): void;
  onOpen(recipeId: string, scope: 'open' | 'crafter', crafterName: string | undefined): void;
  onCancel(orderId: number): void;
  onAccept(orderId: number): void;
  onDeliver(orderId: number): void;
  onClose(): void;
}

function statusLabel(status: CommissionOrderRowModel['status']): string {
  switch (status) {
    case 'open':
      return t('hudChrome.commissionBoard.statusOpen');
    case 'accepted':
      return t('hudChrome.commissionBoard.statusAccepted');
    case 'delivered':
      return t('hudChrome.commissionBoard.statusDelivered');
    case 'cancelled':
      return t('hudChrome.commissionBoard.statusCancelled');
    default:
      return t('hudChrome.commissionBoard.statusExpired');
  }
}

function itemName(row: CommissionOrderRowModel): string {
  return row.item?.name ?? row.itemId;
}

function renderRow(row: CommissionOrderRowModel, deps: CommissionOrderWindowDeps): HTMLElement {
  const name = itemName(row);
  const item = document.createElement('div');
  item.className = 'vendor-item commission-order-row';
  const glow = row.item?.quality ? qualityGlowShadow(QUALITY_COLOR[row.item.quality]) : '';
  const socket = `<span class="crafting-recipe-socket"${glow ? ` style="box-shadow:${glow}"` : ''}>${row.item ? deps.itemIcon(row.item) : ''}</span>`;
  const line =
    row.scope === 'crafter' && row.crafterName
      ? t('hudChrome.commissionBoard.rowTargeted', {
          item: name,
          requester: row.requesterName,
          crafter: row.crafterName,
        })
      : t('hudChrome.commissionBoard.rowFor', { item: name, requester: row.requesterName });
  const statusText = statusLabel(row.status);
  const acceptedLine = row.acceptedByName
    ? t('hudChrome.commissionBoard.acceptedBy', { name: row.acceptedByName })
    : '';
  item.innerHTML = `${socket}<span class="vi-name">${esc(line)}<span class="vi-sub">${esc(statusText)}${acceptedLine ? ` · ${esc(acceptedLine)}` : ''}</span></span>`;
  if (row.item) {
    const displayItem = row.item;
    deps.attachTooltip(item, () => deps.itemTooltip(displayItem));
  }
  const actions = document.createElement('div');
  actions.className = 'commission-order-actions';
  if (row.canCancel) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vi-price-chip commission-order-btn';
    btn.textContent = t('hudChrome.commissionBoard.cancelButton');
    btn.addEventListener('click', () => deps.onCancel(row.id));
    actions.appendChild(btn);
  }
  if (row.canAccept) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vi-price-chip commission-order-btn';
    btn.textContent = t('hudChrome.commissionBoard.acceptButton');
    btn.addEventListener('click', () => deps.onAccept(row.id));
    actions.appendChild(btn);
  }
  if (row.canDeliver) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vi-price-chip commission-order-btn';
    btn.textContent = t('hudChrome.commissionBoard.deliverButton');
    btn.title = t('hudChrome.commissionBoard.deliverHint');
    btn.addEventListener('click', () => deps.onDeliver(row.id));
    actions.appendChild(btn);
  }
  if (actions.childElementCount > 0) item.appendChild(actions);
  return item;
}

function renderSection(
  body: HTMLElement,
  titleKey: string,
  rows: readonly CommissionOrderRowModel[],
  emptyKey: string,
  deps: CommissionOrderWindowDeps,
): void {
  const heading = document.createElement('div');
  heading.className = 'vendor-section-title';
  heading.setAttribute('role', 'heading');
  heading.setAttribute('aria-level', '3');
  heading.textContent = t(titleKey as never);
  body.appendChild(heading);
  if (rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'vendor-empty';
    empty.textContent = t(emptyKey as never);
    body.appendChild(empty);
    return;
  }
  for (const row of rows) body.appendChild(renderRow(row, deps));
}

/** Paint the commission board from a prepared model. */
export function renderCommissionOrderWindow(
  el: HTMLElement,
  model: CommissionOrderBoardModel,
  deps: CommissionOrderWindowDeps,
): void {
  deps.hideTooltip();
  const scrollTop = el.scrollTop;
  el.innerHTML = `<div class="panel-title"><span>${esc(t('hudChrome.commissionBoard.title'))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.commissionBoard.close'))}">${svgIcon('close')}</button></div>`;

  const intro = document.createElement('div');
  intro.className = 'vi-sub commission-board-intro';
  intro.textContent = t('hudChrome.commissionBoard.intro');
  el.appendChild(intro);

  // --- the "open a new order" form ---
  const form = document.createElement('div');
  form.className = 'commission-board-form';
  const recipeOptions = model.openableRecipes
    .map((r) => `<option value="${esc(r.recipeId)}">${esc(r.item?.name ?? r.itemId)}</option>`)
    .join('');
  form.innerHTML =
    `<div class="commission-form-title">${esc(t('hudChrome.commissionBoard.formTitle'))}</div>` +
    (model.openableRecipes.length === 0
      ? `<div class="vi-sub">${esc(t('hudChrome.commissionBoard.recipeEmpty'))}</div>`
      : `<div class="commission-field"><label for="cob-recipe">${esc(t('hudChrome.commissionBoard.recipeLabel'))}</label><select id="cob-recipe" class="hud-select">${recipeOptions}</select></div>` +
        `<div class="commission-field"><label>${esc(t('hudChrome.commissionBoard.scopeLabel'))}</label><div class="commission-radio-row">` +
        `<label><input type="radio" name="cob-scope" value="open" checked>${esc(t('hudChrome.commissionBoard.scopeOpen'))}</label>` +
        `<label><input type="radio" name="cob-scope" value="crafter">${esc(t('hudChrome.commissionBoard.scopeCrafter'))}</label>` +
        `</div></div>` +
        `<div class="commission-field" id="cob-crafter-field" style="display:none"><label for="cob-crafter-name">${esc(t('hudChrome.commissionBoard.crafterNameLabel'))}</label><input id="cob-crafter-name" type="text" maxlength="32" autocomplete="off" placeholder="${esc(t('hudChrome.commissionBoard.crafterNamePlaceholder'))}"></div>` +
        `<button type="button" class="commission-submit-btn" id="cob-submit">${esc(t('hudChrome.commissionBoard.openSubmit'))}</button>`);
  el.appendChild(form);

  const crafterField = form.querySelector<HTMLElement>('#cob-crafter-field');
  for (const radio of form.querySelectorAll<HTMLInputElement>('input[name="cob-scope"]')) {
    radio.addEventListener('change', () => {
      if (crafterField) crafterField.style.display = radio.value === 'crafter' ? '' : 'none';
    });
  }
  form.querySelector('#cob-submit')?.addEventListener('click', () => {
    const recipeSelect = form.querySelector<HTMLSelectElement>('#cob-recipe');
    const recipeId = recipeSelect?.value;
    if (!recipeId) return;
    const scopeInput = form.querySelector<HTMLInputElement>('input[name="cob-scope"]:checked');
    const scope = scopeInput?.value === 'crafter' ? 'crafter' : 'open';
    const crafterName = form.querySelector<HTMLInputElement>('#cob-crafter-name')?.value.trim();
    deps.onOpen(recipeId, scope, scope === 'crafter' && crafterName ? crafterName : undefined);
  });

  // --- the three row sections ---
  const body = document.createElement('div');
  body.className = 'commission-board-sections';
  el.appendChild(body);
  renderSection(
    body,
    'hudChrome.commissionBoard.sectionMine',
    model.myOrders,
    'hudChrome.commissionBoard.mineEmpty',
    deps,
  );
  renderSection(
    body,
    'hudChrome.commissionBoard.sectionToCraft',
    model.toCraft,
    'hudChrome.commissionBoard.toCraftEmpty',
    deps,
  );
  renderSection(
    body,
    'hudChrome.commissionBoard.sectionBoard',
    model.board,
    'hudChrome.commissionBoard.boardEmpty',
    deps,
  );

  el.querySelector('[data-close]')?.addEventListener('click', () => deps.onClose());
  el.style.display = 'block';
  el.scrollTop = scrollTop;
}

// Re-exported so the crafting window's "Orders" button can gate on whether
// there is anything commissionable at all before it bothers opening an
// empty board (used by hud.ts; keeps the eligibility predicate in ONE
// place, the commission.ts source, never duplicated here).
export { isCommissionEligibleKind };
