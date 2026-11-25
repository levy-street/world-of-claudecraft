// Thin DOM consumer for the commission order board (issue #1298).
//
// The consumer half of the pure-core + thin-consumer split (reference
// unbind_window.ts): paints #commission-board-window from the structured
// CommissionOrderBoardModel (commission_order_view.ts) and reports the
// open/cancel/accept/deliver clicks back through the injected callbacks. The
// "open a new order" form reads straight off its own DOM inputs at submit
// time. Reuses the vendor family's row anatomy (.vendor-item, .vi-name,
// .vi-sub) and the crafting recipe socket for icons.
//
// LIVE: CommissionOrderBoardPainter (below) is the Hud's handle. Other
// players accept, deliver, cancel and post orders, and online the viewer's
// own commissionOrderResult can land before the corder mirror moves, so the
// Hud's slow band polls refreshIfChanged(), which compares the text-free
// commissionOrderBoardSig and repaints ONLY the three row sections when it
// moved: the form (picked recipe, scope radios, typed crafter name, an open
// select, focus inside it) is never touched by a poll. A full repaint of an
// open board (an own-action result, a language switch) carries the form's
// state across the rebuild instead. Every paint re-latches the signature.

import { ITEMS } from '../../../sim/data';
import { isCommissionEligibleKind } from '../../../sim/professions/commission';
import type { IWorld } from '../../../world_api';
import { markDialogRoot } from '../../dialog_root';
import { esc } from '../../esc';
import { captureFocusKey, findFocusKey, restoreFirstEnabled } from '../../focus_restore';
import { captureFormDraft, type FormDraft, restoreFormDraft } from '../../form_draft';
import { formatList, formatNumber, t, tPlural } from '../../i18n';
import { QUALITY_COLOR } from '../../icons';
import type { PainterHostPresentation } from '../../painter_host';
import { qualityGlowShadow } from '../../quality_glow';
import { svgIcon } from '../../ui_icons';
import {
  buildCommissionOrderBoardModel,
  type CommissionOrderBoardModel,
  type CommissionOrderRowModel,
  commissionOrderBoardSig,
} from './commission_order_view';

export interface CommissionOrderWindowDeps extends PainterHostPresentation {
  hideTooltip(): void;
  onOpen(recipeId: string, scope: 'open' | 'crafter', crafterName: string | undefined): void;
  onCancel(orderId: number): void;
  onAccept(orderId: number): void;
  onDeliver(orderId: number): void;
  onClose(): void;
  /**
   * The gathering goal Track control (Intentional Gathering PR4). Optional:
   * omitted, no row renders the affordance. Rendered ONLY alongside Deliver,
   * i.e. exactly `row.canDeliver` (accepted AND mineToCraft): a targeted
   * order that is still open also carries mineToCraft, and that row must NOT
   * offer Track, which is exactly what reusing canDeliver's own gate gives
   * for free rather than a second, easily-drifting condition here.
   */
  onTrack?(orderId: number): void;
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

/** The crafter's-record line (Masterwrought phase 14, the commission quality
 *  signal): a muted label with parchment tabular values, rendered only when
 *  the view model resolved a record for the row (accepted/delivered rows off
 *  a record-carrying wire; commission_order_view.ts owns the gate). Counts
 *  ride formatNumber; the words pluralize per locale via tPlural. */
function crafterRecordHtml(row: CommissionOrderRowModel): string {
  const record = row.crafterRecord;
  if (!record) return '';
  const count = (n: number) => formatNumber(n, { maximumFractionDigits: 0 });
  const masterworks = tPlural('hudChrome.plurals.commissionMasterworks', record.masterworks, {
    count: count(record.masterworks),
  });
  const legendaries = tPlural('hudChrome.plurals.commissionLegendaries', record.legendaries, {
    count: count(record.legendaries),
  });
  const values = formatList([masterworks, legendaries]);
  return `<span class="vi-sub commission-crafter-record"><span class="ccr-label">${esc(
    t('hudChrome.commissionBoard.crafterRecordLabel'),
  )}</span> <span class="ccr-values">${esc(values)}</span></span>`;
}

/** One row action button, keyed by action and order id so a sections-only
 *  repaint can carry focus across the rebuild (the focus_restore seam). */
function actionButton(
  row: CommissionOrderRowModel,
  action: string,
  className: string,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = label;
  btn.dataset.focusKey = `cob:${action}:${row.id}`;
  btn.addEventListener('click', onClick);
  return btn;
}

function renderRow(row: CommissionOrderRowModel, deps: CommissionOrderWindowDeps): HTMLElement {
  const name = itemName(row);
  const item = document.createElement('div');
  item.className = 'vendor-item ui-card commission-order-row';
  const glow = row.item?.quality ? qualityGlowShadow(QUALITY_COLOR[row.item.quality]) : '';
  const socket = `<span class="crafting-recipe-socket ui-socket ui-socket--bag"${glow ? ` style="box-shadow:${glow}"` : ''}>${row.item ? deps.itemIcon(row.item) : ''}</span>`;
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
  const statusDetails = formatList(acceptedLine ? [statusText, acceptedLine] : [statusText]);
  item.innerHTML = `${socket}<span class="vi-name">${esc(line)}<span class="vi-sub">${esc(statusDetails)}</span>${crafterRecordHtml(row)}</span>`;
  if (row.item) {
    const displayItem = row.item;
    deps.attachTooltip(item, () => deps.itemTooltip(displayItem));
  }
  const actions = document.createElement('div');
  actions.className = 'commission-order-actions';
  if (row.canCancel) {
    actions.appendChild(
      actionButton(
        row,
        'cancel',
        'vi-price-chip ui-btn commission-order-btn',
        t('hudChrome.commissionBoard.cancelButton'),
        () => deps.onCancel(row.id),
      ),
    );
  }
  if (row.canAccept) {
    actions.appendChild(
      actionButton(
        row,
        'accept',
        'vi-price-chip ui-btn commission-order-btn',
        t('hudChrome.commissionBoard.acceptButton'),
        () => deps.onAccept(row.id),
      ),
    );
  }
  if (row.canDeliver) {
    const btn = actionButton(
      row,
      'deliver',
      'vi-price-chip ui-btn ui-btn--red commission-order-btn',
      t('hudChrome.commissionBoard.deliverButton'),
      () => deps.onDeliver(row.id),
    );
    btn.title = t('hudChrome.commissionBoard.deliverHint');
    actions.appendChild(btn);
  }
  // The gathering goal Track control: `row.canDeliver` alone (accepted AND
  // mineToCraft) so an open targeted order, which also carries mineToCraft,
  // never shows it.
  if (row.canDeliver && deps.onTrack) {
    const onTrack = deps.onTrack;
    actions.appendChild(
      actionButton(
        row,
        'track',
        'vi-price-chip commission-order-btn commission-order-track-btn',
        t('hudChrome.commissionBoard.trackButton'),
        () => onTrack(row.id),
      ),
    );
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
    // The professions family empty state (.prof-empty, phase 14), replacing
    // the borrowed vendor-family class: body line alone, the section variant.
    const empty = document.createElement('div');
    empty.className = 'prof-empty';
    const line = document.createElement('p');
    line.textContent = t(emptyKey as never);
    empty.appendChild(line);
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
  el.innerHTML = `<div class="panel-title ui-win-head"><span class="ui-win-title">${esc(t('hudChrome.commissionBoard.title'))}</span><button type="button" class="x-btn ui-x-btn" data-close aria-label="${esc(t('hudChrome.commissionBoard.close'))}">${svgIcon('close')}</button></div>`;
  // The chrome dialog contract (src/ui/CLAUDE.md): role=dialog, ONE accessible
  // name (the label form; the title span carries no id), aria-modal false like
  // the crafting window it opens from (Hud installs the shared focus trap).
  markDialogRoot(el, { label: t('hudChrome.commissionBoard.title') });

  const intro = document.createElement('div');
  intro.className = 'vi-sub commission-board-intro';
  intro.textContent = t('hudChrome.commissionBoard.intro');
  el.appendChild(intro);

  // --- the "open a new order" form ---
  const form = document.createElement('div');
  form.className = 'commission-board-form ui-card';
  const recipeOptions = model.openableRecipes
    .map((r) => `<option value="${esc(r.recipeId)}">${esc(r.item?.name ?? r.itemId)}</option>`)
    .join('');
  form.innerHTML =
    `<div class="commission-form-title">${esc(t('hudChrome.commissionBoard.formTitle'))}</div>` +
    (model.openableRecipes.length === 0
      ? `<div class="vi-sub">${esc(t('hudChrome.commissionBoard.recipeEmpty'))}</div>`
      : `<div class="commission-field"><label for="cob-recipe">${esc(t('hudChrome.commissionBoard.recipeLabel'))}</label><select id="cob-recipe" class="ui-input">${recipeOptions}</select></div>` +
        `<div class="commission-field"><label>${esc(t('hudChrome.commissionBoard.scopeLabel'))}</label><div class="commission-radio-row">` +
        `<label><input type="radio" name="cob-scope" value="open" checked>${esc(t('hudChrome.commissionBoard.scopeOpen'))}</label>` +
        `<label><input type="radio" name="cob-scope" value="crafter">${esc(t('hudChrome.commissionBoard.scopeCrafter'))}</label>` +
        `</div></div>` +
        `<div class="commission-field" id="cob-crafter-field" style="display:none"><label for="cob-crafter-name">${esc(t('hudChrome.commissionBoard.crafterNameLabel'))}</label><input id="cob-crafter-name" class="ui-input" type="text" maxlength="32" autocomplete="off" placeholder="${esc(t('hudChrome.commissionBoard.crafterNamePlaceholder'))}"></div>` +
        `<button type="button" class="commission-submit-btn ui-btn ui-btn--red" id="cob-submit">${esc(t('hudChrome.commissionBoard.openSubmit'))}</button>`);
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
  renderSections(body, model, deps);

  el.querySelector('[data-close]')?.addEventListener('click', () => deps.onClose());
  // The family's flex-column shell (every professions window opens with
  // display:flex over a flex-direction:column rule on its id; the board's rule
  // lives beside #professions-window in components.css), replacing the
  // display:block the board alone used to open with.
  el.style.display = 'flex';
  el.scrollTop = scrollTop;
}

/** The three row sections, painted into `body` (the board's
 *  .commission-board-sections container): the part a live poll rebuilds. */
function renderSections(
  body: HTMLElement,
  model: CommissionOrderBoardModel,
  deps: CommissionOrderWindowDeps,
): void {
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
}

/** The order form's live state across a FULL repaint of an open board: the
 *  picked recipe and scope (a select and radios, which form_draft does not
 *  carry) plus the typed crafter name and focus (which it does). */
interface CommissionFormState {
  readonly recipeId: string | null;
  readonly scope: string | null;
  readonly draft: FormDraft;
}

function captureFormState(el: HTMLElement): CommissionFormState {
  return {
    recipeId: el.querySelector<HTMLSelectElement>('#cob-recipe')?.value ?? null,
    scope: el.querySelector<HTMLInputElement>('input[name="cob-scope"]:checked')?.value ?? null,
    draft: captureFormDraft(el),
  };
}

function restoreFormState(el: HTMLElement, state: CommissionFormState): void {
  const select = el.querySelector<HTMLSelectElement>('#cob-recipe');
  // A recipe that left the picker is dropped, never forced back in.
  if (select && state.recipeId !== null) {
    if ([...select.options].some((option) => option.value === state.recipeId)) {
      select.value = state.recipeId;
    }
  }
  for (const radio of el.querySelectorAll<HTMLInputElement>('input[name="cob-scope"]')) {
    if (radio.value === state.scope) radio.checked = true;
  }
  const crafterField = el.querySelector<HTMLElement>('#cob-crafter-field');
  if (crafterField && state.scope !== null) {
    crafterField.style.display = state.scope === 'crafter' ? '' : 'none';
  }
  restoreFormDraft(el, state.draft);
}

/** The world reads the board paints from (a narrow IWorld slice, so the
 *  painter's tests need no full world). */
type CommissionBoardWorld = Pick<IWorld, 'commissionOrders' | 'recipeList'>;

/**
 * The Hud's handle on the commission board (see the header): owns the
 * repaint signature and the last paint's root and callbacks, so the slow-band
 * poll and the language arm need no arguments. The "open a new order" picker
 * is the CUSTOMER side of the board, so it is fed the full recipe catalog
 * (`recipeList`), which buildCommissionOrderBoardModel narrows to
 * commission-eligible outputs itself.
 */
export class CommissionOrderBoardPainter {
  /** commissionOrderBoardSig of the orders the row sections were last painted
   *  from; re-latched by every paint, never cleared. */
  private lastSig: string | null = null;
  private root: HTMLElement | null = null;
  private deps: CommissionOrderWindowDeps | null = null;

  constructor(private readonly world: () => CommissionBoardWorld) {}

  private get isOpen(): boolean {
    return this.root !== null && this.root.style.display === 'flex';
  }

  private model(): CommissionOrderBoardModel {
    const world = this.world();
    return buildCommissionOrderBoardModel(world.commissionOrders, world.recipeList, ITEMS);
  }

  /** The full paint (open, an own-action result). Opening a closed board, or
   *  `resetForm` (the player's own order just posted), starts the form clean;
   *  any other repaint of an open one carries the form across. */
  render(el: HTMLElement, deps: CommissionOrderWindowDeps, resetForm = false): void {
    const carry = el.style.display === 'flex' && !resetForm ? captureFormState(el) : null;
    this.root = el;
    this.deps = deps;
    renderCommissionOrderWindow(el, this.model(), deps);
    if (carry) restoreFormState(el, carry);
    this.lastSig = commissionOrderBoardSig(this.world().commissionOrders);
  }

  /** The Hud's slow-band poll: repaints the row sections only, and only
   *  when the board's orders moved since the last paint. */
  refreshIfChanged(): void {
    const el = this.root;
    const deps = this.deps;
    if (!this.isOpen || el === null || deps === null) return;
    const sig = commissionOrderBoardSig(this.world().commissionOrders);
    if (sig === this.lastSig) return;
    const body = el.querySelector<HTMLElement>('.commission-board-sections');
    if (body === null) {
      this.render(el, deps);
      return;
    }
    // The rebuilt rows drop any hovered tooltip, and a focused row button is
    // carried by its key; a button whose action went away degrades to Close
    // so focus never falls out of the window's trap. Focus in the form has
    // no key here and is simply never disturbed.
    deps.hideTooltip();
    const focusKey = captureFocusKey(el);
    const scrollTop = el.scrollTop;
    body.replaceChildren();
    renderSections(body, this.model(), deps);
    el.scrollTop = scrollTop;
    if (focusKey !== null) {
      restoreFirstEnabled([
        findFocusKey(el, focusKey),
        el.querySelector<HTMLElement>('[data-close]'),
      ]);
    }
    this.lastSig = sig;
  }

  /** The language arm: an open board repaints once in the new locale, the
   *  form carried across and the signature re-latched. Self-gated. */
  relocalize(): void {
    if (this.isOpen && this.root && this.deps) this.render(this.root, this.deps);
  }
}

// Re-exported so the crafting window's "Orders" button can gate on whether
// there is anything commissionable at all before it bothers opening an
// empty board (used by hud.ts; keeps the eligibility predicate in ONE
// place, the commission.ts source, never duplicated here).
export { isCommissionEligibleKind };
