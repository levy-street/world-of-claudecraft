// Guild tab pane painter for the Bank window (#bank-window): renders the
// officer-plus pooled guild bank (treasury, slot grid, gold deposit/withdraw,
// expansion purchase) from the structured GuildBankViewModel
// (guild_bank_view.ts). The pure core decides slot flags (dormant, unknown),
// capacity, action enablement and the buy panel; this thin consumer renders
// that and wires every action back through the IWorldGuildBank facet commands.
// It is composed by BankWindow (bank_window.ts), which owns the tab strip, the
// open/close lifecycle, the refresh signature, and the prompt-dialog chrome
// (injected here as installPromptDialog so the guild prompts share the exact
// WCAG wiring, #prompt-stack mount, and force-close teardown the personal
// prompts have; the shared '.bank-quantity-prompt' / '.bank-buy-prompt'
// classes keep them inside BANK_PROMPT_SELECTOR's reach).
//
// Cold-pane contract (the bank_window cold-bucket rules): no forced-reflow
// layout read (BankWindow owns the .bank-scroll offset capture) and no
// repeating driver. No raw hex: quality comes from the shared QUALITY_COLOR
// map with the --color-quality-default token fallback, exactly like the
// personal grid.
//
// DORMANT slots (the carried-forward Phase 3 QA line): a pipe-refused slot is
// unwithdrawable in BOTH directions and blocks guild disband (the documented
// v1 limitation), so it renders visibly distinct (dimmed + lock mark + text
// legend + its own aria wording), NEVER hidden. Its click still sends the
// withdraw so the sim's own localized refusal line round-trips through the
// facet; that same path covers a projected-lock copy the client cannot flag.

import { audio } from '../game/audio';
import { ITEMS } from '../sim/data';
import type { IWorld } from '../world_api';
import { showQuantityPrompt } from './bank_quantity_prompt';
import { itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import {
  buildGuildBankView,
  clampGoldAmount,
  coinFieldsToCopper,
  type GuildBankSlotModel,
  type GuildBankViewModel,
  guildBankGoldDepositMax,
  guildBankGoldWithdrawMax,
  guildBankSlotAction,
} from './guild_bank_view';
import { formatMoney, formatNumber, t } from './i18n';
import { QUALITY_COLOR } from './icons';
import type { PainterHostPresentation } from './painter_host';
import { tSim } from './sim_i18n';
import { svgIcon } from './ui_icons';

// The unranked quality fallback as a CSS custom property (mirrors bank_window's
// QUALITY_DEFAULT_COLOR; kept local so the pane stays independently importable).
const QUALITY_DEFAULT_COLOR = 'var(--color-quality-default)';

/**
 * BankWindow-supplied glue. The icon/money/tooltip painters are the shared
 * PainterHostPresentation bag; on top ride the world reads/commands, the
 * peek-suppression, the sibling repaint nudge, and the prompt-dialog installer
 * (BankWindow's own, so guild prompts share its aria wiring and teardown).
 */
export interface GuildBankTabDeps extends PainterHostPresentation {
  /** The #bank-window root (for prompt focus landing; never hardcoded). */
  root(): HTMLElement;
  /** The live world (offline Sim or online ClientWorld mirror). */
  world(): IWorld;
  hideTooltip(): void;
  /** True when this click is the release of a long-press tooltip peek (the
   *  bank grid semantics: the release inspects, never withdraws). */
  consumePeek(): boolean;
  /** A guild op moved inventory or coin: repaint the bags companion. */
  onInventoryChanged(): void;
  /** BankWindow's WCAG prompt-dialog wiring (Tab cycle, Escape, inert root). */
  installPromptDialog(
    prompt: HTMLElement,
    opener: HTMLElement | null,
    close: () => void,
  ): { dismiss: () => void; dismissAndReturn: () => void };
  /** BankWindow's sibling-prompt teardown (dismissBankPrompts): every guild
   *  prompt opener calls it first so two prompts can never stack. */
  dismissPrompts(): void;
  /** Ask the owning window for a full repaint (after an op, mirroring the
   *  personal pane's post-op render()). */
  requestRender(): void;
}

export class GuildBankTab {
  constructor(private readonly deps: GuildBankTabDeps) {}

  /** Build the guild pane model from the live world. Exposed so BankWindow can
   *  branch on 'hidden' (tab fallback) without duplicating the core call. */
  model(): GuildBankViewModel {
    return buildGuildBankView(this.deps.world().guildBankInfo, (id) => ITEMS[id]);
  }

  /** Append the guild pane sections (capacity, treasury, grid, buy row) to the
   *  window root. BankWindow has already painted the title + tab strip and
   *  captured the .bank-scroll offset it restores after this returns. */
  renderInto(el: HTMLElement): void {
    const model = this.model();
    if (model.kind !== 'guild') return; // raced null: BankWindow falls back next paint
    const capacity = document.createElement('div');
    capacity.className = 'bank-capacity';
    const used = this.fmt(model.capacity.used);
    const total = this.fmt(model.capacity.total);
    capacity.textContent = t('hudChrome.bank.capacity', { used, total });
    capacity.setAttribute('aria-label', t('hudChrome.bank.guildCapacityAria', { used, total }));
    el.appendChild(capacity);
    el.appendChild(this.buildTreasuryRow(model));
    if (model.hasDormant) {
      // The dormant legend is always-visible TEXT (never tooltip-only, the
      // mobile rule): these slots cannot leave and block disbanding the guild.
      const note = document.createElement('div');
      note.className = 'gbank-dormant-note';
      note.textContent = t('hudChrome.bank.guildDormantNote');
      el.appendChild(note);
    }
    const scroll = document.createElement('div');
    scroll.className = 'bank-scroll';
    const grid = document.createElement('div');
    grid.className = 'bank-grid';
    this.fillGrid(grid, model);
    scroll.appendChild(grid);
    el.appendChild(scroll);
    el.appendChild(this.buildBuyRow(model));
  }

  private fmt(n: number): string {
    return formatNumber(n, { maximumFractionDigits: 0 });
  }

  // The treasury header row: label + coin readout + the two gold actions.
  // Enablement comes from the pure model (snapshot state only, never the live
  // purse, so the window's purse-free refresh signature stays honest).
  private buildTreasuryRow(model: GuildBankViewModel & { kind: 'guild' }): HTMLElement {
    const row = document.createElement('div');
    row.className = 'gbank-treasury';
    const label = document.createElement('span');
    label.className = 'gbank-treasury-label';
    label.textContent = t('hudChrome.bank.guildTreasury');
    const amount = document.createElement('span');
    amount.className = 'gbank-treasury-amount';
    amount.innerHTML = this.deps.moneyHtml(model.treasury.copper);
    const actions = document.createElement('div');
    actions.className = 'gbank-treasury-actions';
    const deposit = document.createElement('button');
    deposit.type = 'button';
    deposit.className = 'gbank-gold-btn';
    deposit.textContent = t('hudChrome.bank.guildDepositGold');
    deposit.disabled = !model.treasury.canDepositGold;
    deposit.addEventListener('click', () => this.showGoldPrompt('deposit', model.treasury.copper));
    const withdraw = document.createElement('button');
    withdraw.type = 'button';
    withdraw.className = 'gbank-gold-btn';
    withdraw.textContent = t('hudChrome.bank.guildWithdrawGold');
    withdraw.disabled = !model.treasury.canWithdrawGold;
    withdraw.addEventListener('click', () =>
      this.showGoldPrompt('withdraw', model.treasury.copper),
    );
    actions.append(deposit, withdraw);
    row.append(label, amount, actions);
    return row;
  }

  private fillGrid(grid: HTMLElement, model: GuildBankViewModel & { kind: 'guild' }): void {
    if (model.empty) {
      grid.innerHTML = `<div class="bank-empty">${esc(t('hudChrome.bank.guildEmpty'))}</div>`;
      return;
    }
    // NO filter/sort layer and NO unknown-id drop: every slot renders at its
    // wire index, dormant ones visibly distinct (the carried-forward line).
    for (const slot of model.slots) grid.appendChild(this.buildCell(slot));
    for (let i = 0; i < model.emptyCells; i++) {
      const cell = document.createElement('div');
      cell.className = 'bank-item empty';
      cell.setAttribute('aria-hidden', 'true');
      grid.appendChild(cell);
    }
  }

  private buildCell(slot: GuildBankSlotModel): HTMLElement {
    const item = ITEMS[slot.itemId];
    const cell = document.createElement('button');
    cell.type = 'button';
    const dormantClass = slot.dormant ? ' gbank-dormant' : '';
    const itemName = item ? itemDisplayName(item) : t('hudChrome.bank.guildUnknownItem');
    const count = this.fmt(slot.count);
    if (slot.known && item) {
      cell.className = `bank-item q-${slot.qualityKey}${dormantClass}`;
      const qColor = QUALITY_COLOR[slot.qualityKey] ?? QUALITY_DEFAULT_COLOR;
      cell.style.setProperty('--bank-slot-quality', qColor);
      const mark = slot.dormant ? `<span class="gbank-dormant-mark">${svgIcon('lock')}</span>` : '';
      cell.innerHTML = `${this.deps.itemIcon(item)}<span class="bank-count">${
        slot.showCount ? esc(t('itemUi.bags.stackCount', { count })) : ''
      }</span>${mark}`;
      this.deps.attachTooltip(cell, () => {
        const hint = slot.dormant
          ? `<div class="tt-sub">${esc(t('hudChrome.bank.guildDormantHint'))}</div>`
          : `<div class="tt-sub">${esc(t('hudChrome.bank.withdrawHint'))}</div>${
              slot.showCount && !slot.instance
                ? `<div class="tt-sub">${esc(t('hudChrome.bank.withdrawPartialHint'))}</div>`
                : ''
            }`;
        return `${this.deps.itemTooltip(item, slot.instance)}${hint}`;
      });
    } else {
      // Unknown id (a removed def): a recoverable dormant-shaped cell. The sim
      // ALLOWS withdrawing it (the recovery path), so it stays actionable; the
      // raw id is the only name that exists for it.
      cell.className = `bank-item gbank-unknown${dormantClass}`;
      cell.innerHTML = `<span class="gbank-unknown-label">${esc(
        t('hudChrome.bank.guildUnknownItem'),
      )}</span><span class="bank-count">${
        slot.showCount ? esc(t('itemUi.bags.stackCount', { count })) : ''
      }</span>`;
      this.deps.attachTooltip(cell, () => {
        const hint = slot.dormant
          ? t('hudChrome.bank.guildDormantHint')
          : t('hudChrome.bank.withdrawHint');
        return `<div class="tt-title">${esc(t('hudChrome.bank.guildUnknownItem'))}</div><div class="tt-sub">${esc(slot.itemId)}</div><div class="tt-sub">${esc(hint)}</div>`;
      });
    }
    cell.setAttribute(
      'aria-label',
      slot.dormant
        ? t('hudChrome.bank.guildDormantAria', { item: itemName, count })
        : t('itemUi.bags.itemAria', { item: itemName, count }),
    );
    cell.addEventListener('click', (ev) => {
      if (this.deps.consumePeek()) {
        this.deps.hideTooltip();
        return;
      }
      this.onSlotClick(slot, ev.shiftKey);
    });
    return cell;
  }

  // Plain click withdraws the whole stack (a dormant slot round-trips to the
  // sim's localized refusal); shift-click on a splittable non-dormant stack
  // opens the quantity prompt. The pure guildBankSlotAction decides which.
  private onSlotClick(slot: GuildBankSlotModel, shift: boolean): void {
    const live = this.deps.world().guildBankInfo?.slots[slot.slotIndex];
    // Identity guard, the prompt-submit rule applied to the PLAIN click too: in
    // a multi-officer book another officer's op can shift indices a tick before
    // this click sends, and withdrawing the WRONG item is worse than a no-op
    // (the next repaint shows the moved grid).
    if (live && live.itemId !== slot.itemId) return;
    const action = guildBankSlotAction(live, slot.slotIndex, shift, slot.dormant);
    if (action.kind === 'withdraw') {
      this.deps.world().guildBankWithdraw(action.slotIndex);
      audio.click();
      this.deps.hideTooltip();
      // The item may just have moved into the bags; repaint the companion (the
      // personal-pane idiom; a refused dormant withdraw repaints harmlessly).
      this.deps.onInventoryChanged();
      this.deps.requestRender();
    } else if (action.kind === 'withdrawPartial') {
      this.showWithdrawQuantityPrompt(action.slotIndex, action.max);
    }
  }

  // The split-stack withdraw prompt: the shared builder owns the chrome
  // (bank_quantity_prompt.ts); this owns the guild closures: the stale-index
  // identity guard and the guildBankWithdraw send.
  private showWithdrawQuantityPrompt(slotIndex: number, maxCount: number): void {
    const slot = this.deps.world().guildBankInfo?.slots[slotIndex];
    if (!slot) return;
    const item = ITEMS[slot.itemId];
    const itemName = item ? itemDisplayName(item) : slot.itemId;
    showQuantityPrompt(
      {
        installPromptDialog: (prompt, opener, close) =>
          this.deps.installPromptDialog(prompt, opener, close),
        dismissSiblings: () => this.deps.dismissPrompts(),
      },
      {
        className: 'bank-quantity-prompt gbank-quantity-prompt',
        titleText: t('hudChrome.bank.withdrawQuantityTitle', { item: itemName }),
        inputAriaText: t('hudChrome.bank.withdrawQuantityInput'),
        confirmText: t('hudChrome.bank.withdrawQuantityConfirm'),
        cancelText: t('itemUi.vendor.sellQuantityCancel'),
        maxCount,
        resolveCount: (requested) => {
          // Re-resolve the live slot; refuse on a mismatch (withdrawing the
          // wrong item is worse than dismissing). Clamp to the live stack.
          const live = this.deps.world().guildBankInfo?.slots[slotIndex];
          if (!live || live.itemId !== slot.itemId) return null;
          return Math.max(1, Math.min(maxCount, live.count, requested));
        },
        send: (count) => {
          this.deps.world().guildBankWithdraw(slotIndex, count);
          audio.click();
          this.deps.onInventoryChanged();
        },
        afterClose: (sent) => {
          if (sent) this.deps.requestRender();
          this.focusClose();
        },
      },
    );
  }

  // The gold deposit/withdraw prompt: the mailbox coin-row idiom (three
  // gold/silver/copper fields) inside the bank prompt chrome. Bounds resolve
  // HERE from the live purse + treasury (never at render time, so the window's
  // refresh signature stays purse-free). DEPOSIT refuses rather than clamps
  // (the sim's refuse-and-keep semantics: an over-purse entry must never
  // silently drain the whole purse), voicing the exact matching sim line in an
  // inline status line; WITHDRAW clamps to the treasury BY DESIGN, documented:
  // the treasury readout is on screen in the same window, so the clamp target
  // is visible, and the carry-cap bound is integer-safe headroom no real purse
  // reaches. An all-zero submit cancels silently (nothing was asked).
  private showGoldPrompt(direction: 'deposit' | 'withdraw', treasuryCopper: number): void {
    this.deps.dismissPrompts();
    const opener = document.activeElement as HTMLElement | null;
    const stack = document.getElementById('prompt-stack');
    if (!stack) return;
    const purse = this.deps.world().copper;
    const max =
      direction === 'deposit'
        ? guildBankGoldDepositMax(purse, treasuryCopper)
        : guildBankGoldWithdrawMax(purse, treasuryCopper);
    const prompt = document.createElement('div');
    prompt.className = 'prompt panel bank-quantity-prompt gbank-gold-prompt';
    const title =
      direction === 'deposit'
        ? t('hudChrome.bank.guildDepositGoldTitle')
        : t('hudChrome.bank.guildWithdrawGoldTitle');
    const available =
      direction === 'deposit'
        ? t('hudChrome.bank.guildGoldAvailable', { amount: formatMoney(purse) })
        : t('hudChrome.bank.guildGoldAvailable', { amount: formatMoney(treasuryCopper) });
    prompt.innerHTML =
      `<div class="prompt-text">${esc(title)}</div>` +
      `<div class="gbank-gold-available">${esc(available)}</div>`;
    const coinRow = document.createElement('div');
    coinRow.className = 'gbank-coin-row';
    const mkCoin = (cls: 'g' | 's' | 'c', ariaText: string, capped: boolean): HTMLInputElement => {
      const input = document.createElement('input');
      input.className = 'coininput';
      input.type = 'number';
      input.min = '0';
      if (capped) input.max = '99';
      input.value = '0';
      input.setAttribute('aria-label', ariaText);
      // Select-on-focus so typing replaces the seeded 0 (the mailbox idiom).
      input.addEventListener('focus', () => {
        input.select();
        input.addEventListener('mouseup', (e) => e.preventDefault(), { once: true });
      });
      const coin = document.createElement('span');
      coin.className = `coin ${cls}`;
      coin.setAttribute('aria-hidden', 'true');
      coinRow.append(input, coin);
      return input;
    };
    const gold = mkCoin('g', t('itemUi.money.gold'), false);
    const silver = mkCoin('s', t('itemUi.money.silver'), true);
    const copper = mkCoin('c', t('itemUi.money.copper'), true);
    prompt.appendChild(coinRow);
    // The inline refusal line (polite live region): a refused submit keeps the
    // prompt open and says WHY, never a silent dismiss (the seam review line).
    const errorLine = document.createElement('div');
    errorLine.className = 'gbank-gold-error';
    errorLine.setAttribute('role', 'status');
    errorLine.setAttribute('aria-live', 'polite');
    prompt.appendChild(errorLine);
    const confirm = document.createElement('button');
    confirm.className = 'btn';
    confirm.textContent =
      direction === 'deposit'
        ? t('hudChrome.bank.depositQuantityConfirm')
        : t('hudChrome.bank.withdrawQuantityConfirm');
    const cancel = document.createElement('button');
    cancel.className = 'btn';
    cancel.textContent = t('itemUi.vendor.sellQuantityCancel');
    prompt.append(confirm, cancel);
    const { dismiss, dismissAndReturn } = this.deps.installPromptDialog(prompt, opener, () =>
      prompt.remove(),
    );
    const submit = () => {
      const entered = coinFieldsToCopper(
        Number(gold.value),
        Number(silver.value),
        Number(copper.value),
      );
      if (entered <= 0) {
        // Nothing asked: cancel semantics, silent (mirrors an empty cancel).
        dismissAndReturn();
        return;
      }
      if (direction === 'deposit') {
        // Refuse-and-keep, the sim's own validation order voiced with its own
        // lines: over-purse first, then the treasury-cap headroom.
        if (entered > purse) {
          errorLine.textContent = t('itemUi.errors.notEnoughMoney');
          return;
        }
        if (entered > max) {
          errorLine.textContent = tSim('error.guildBankTreasuryCap');
          return;
        }
        this.deps.world().guildBankDepositGold(entered);
      } else {
        const amount = clampGoldAmount(entered, max);
        if (amount === null) {
          // The treasury cannot give anything right now (drained since the
          // paint): surface it, keep the prompt open.
          errorLine.textContent = t('hudChrome.bank.guildGoldCannotMove');
          return;
        }
        this.deps.world().guildBankWithdrawGold(amount);
      }
      audio.coin();
      this.deps.onInventoryChanged();
      dismiss();
      this.deps.requestRender();
      this.focusClose();
    };
    confirm.addEventListener('click', submit);
    for (const input of [gold, silver, copper]) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit();
      });
    }
    cancel.addEventListener('click', dismissAndReturn);
    stack.appendChild(prompt);
    window.setTimeout(() => {
      gold.focus();
      gold.select();
    }, 0);
  }

  // The footer expansion row: the next block's TREASURY price on a buy button,
  // or a maxed label. Never disabled on affordability (family precedent: the
  // sim refuses with its own localized line); an unaffordable price carries a
  // visible text marker on top of the styling class, never color alone.
  private buildBuyRow(model: GuildBankViewModel & { kind: 'guild' }): HTMLElement {
    const row = document.createElement('div');
    row.className = 'bank-buy-row gbank-buy-row';
    const buy = model.buy;
    if (buy.maxed || buy.nextPrice === null) {
      const maxed = document.createElement('span');
      maxed.className = 'bank-buy-maxed';
      maxed.textContent = t('hudChrome.bank.buySlotsMaxed');
      row.appendChild(maxed);
      return row;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `bank-buy-btn${buy.affordable ? '' : ' gbank-buy-short'}`;
    const short = buy.affordable
      ? ''
      : `<span class="gbank-buy-short-label">${esc(t('hudChrome.bank.guildTreasuryShort'))}</span>`;
    btn.innerHTML =
      `<span class="bank-buy-label">${esc(t('hudChrome.bank.buySlots', { count: this.fmt(buy.blockSlots) }))}</span>` +
      this.deps.moneyHtml(buy.nextPrice) +
      short;
    const price = buy.nextPrice;
    btn.addEventListener('click', () => this.showBuySlotsPrompt(price, buy.blockSlots));
    row.appendChild(btn);
    // The treasury-paid note: always-visible text (the price above is the
    // guild's money, not the officer's purse; saying so prevents mis-reads).
    const note = document.createElement('div');
    note.className = 'gbank-buy-note';
    note.textContent = t('hudChrome.bank.guildBuyNote');
    row.appendChild(note);
    return row;
  }

  private showBuySlotsPrompt(price: number, blockSlots: number): void {
    this.deps.dismissPrompts();
    const opener = document.activeElement as HTMLElement | null;
    const stack = document.getElementById('prompt-stack');
    if (!stack) return;
    const prompt = document.createElement('div');
    prompt.className = 'prompt panel bank-buy-prompt gbank-buy-prompt';
    prompt.innerHTML = `<div class="prompt-text">${esc(
      t('hudChrome.bank.guildBuyConfirm', {
        count: this.fmt(blockSlots),
        price: formatMoney(price),
      }),
    )}</div>`;
    const confirm = document.createElement('button');
    confirm.className = 'btn';
    confirm.textContent = t('hudChrome.bank.buyConfirmAccept');
    const cancel = document.createElement('button');
    cancel.className = 'btn';
    cancel.textContent = t('itemUi.vendor.sellQuantityCancel');
    prompt.append(confirm, cancel);
    const { dismiss, dismissAndReturn } = this.deps.installPromptDialog(prompt, opener, () =>
      prompt.remove(),
    );
    confirm.addEventListener('click', () => {
      this.deps.world().guildBankBuySlots();
      audio.coin();
      dismiss();
      this.deps.requestRender();
      this.focusClose();
    });
    cancel.addEventListener('click', dismissAndReturn);
    stack.appendChild(prompt);
    window.setTimeout(() => confirm.focus(), 0);
  }

  // Land focus on the window's always-present close button after an op-driven
  // rebuild detached the opener (the personal pane's idiom).
  private focusClose(): void {
    (this.deps.root().querySelector('[data-close]') as HTMLElement | null)?.focus();
  }
}
