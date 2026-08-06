// Guild tab pane painter for the Bank window (#bank-window): renders the
// officer-plus pooled guild bank (treasury, slot grid, gold deposit/withdraw,
// expansion purchase; for an UNOPENED bank the treasury plus the purse-paid
// open-the-bank row) from the structured GuildBankViewModel
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
import { bagInstanceGlyphKind } from './bag_instance_glyph_view';
import { showQuantityPrompt } from './bank_quantity_prompt';
import { itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import { buildGuildBankLogView, guildBankLogSignature } from './guild_bank_log_view';
import { GuildBankLogPane } from './guild_bank_log_window';
import {
  buildGuildBankView,
  clampGoldAmount,
  coinFieldsToCopper,
  type GuildBankOpenModel,
  type GuildBankSlotModel,
  type GuildBankTreasuryModel,
  type GuildBankViewModel,
  guildBankGoldDepositMax,
  guildBankGoldWithdrawMax,
  guildBankSlotAction,
} from './guild_bank_view';
import { formatMoney, formatNumber, t } from './i18n';
import { QUALITY_COLOR } from './icons';
import { INSTANCE_GLYPH_ARIA_KEYS, instanceGlyphMarkHtml } from './item_instance_glyph_mark';
import { knownItemDef } from './known_item';
import type { PainterHostPresentation } from './painter_host';
import { tSim } from './sim_i18n';
import { focusActiveTab, wireTabStrip } from './tab_strip_painter';
import { tabStripHtml, tabStripModel } from './tab_strip_view';
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

/** The two views inside the Guild pane: the bank itself, and its activity log. */
export type GuildBankPaneView = 'contents' | 'log';

/** The Guild pane's role=tabpanel element id. Exported so BankWindow can point
 *  the outer Guild tab's aria-controls at it: the pane holds a nested tab list,
 *  and without the tab/panel relationship that inner strip reads to assistive
 *  tech as a second, unrelated top-level tab list appearing for no reason. */
export const GUILD_PANEL_ID = 'bank-panel-guild';

/** The outer Guild TAB's element id: BankWindow stamps it through the shared
 *  strip's `buttonId` and the panel above names it in aria-labelledby.
 *  Exported and declared beside its partner so the pair cannot drift apart. */
export const GUILD_TAB_ID = 'bank-tab-guild';

export class GuildBankTab {
  // Which view of the Guild pane is showing. Owned here (not by BankWindow)
  // because the sub-strip, the log pane, and the on-demand fetch trigger are
  // all this pane's business; BankWindow reads it through the getters below for
  // its repaint gate and its scroll scoping.
  private view: GuildBankPaneView = 'contents';
  private readonly logPane = new GuildBankLogPane({
    itemDef: (id) => knownItemDef(ITEMS, id),
  });

  constructor(private readonly deps: GuildBankTabDeps) {}

  /** The active sub-view, for BankWindow's per-pane scroll scoping. */
  get activeView(): GuildBankPaneView {
    return this.view;
  }

  /** Reset to the bank contents. BankWindow calls this on close so a reopened
   *  bank never starts on the log (and never refetches it unasked). */
  resetView(): void {
    this.view = 'contents';
  }

  /**
   * READ THE LOG AND, IF IT IS DUE, REQUEST IT, returning the repaint key; null
   * while the log view is CLOSED.
   *
   * The name says "request" because this is not a pure observation: reading
   * world.guildBankLog() is what SENDS the wire command, and a signature helper
   * that quietly sends is exactly the shape that hides a leak. The null arm is
   * therefore load-bearing, and so is the caller's own visibility gate
   * (BankWindow only calls this while the Guild tab is the ACTIVE tab and the
   * mirror is non-null): between them, an officer who is not looking at the log
   * never touches it, which is what keeps "fetch on demand" from becoming a
   * poll.
   */
  readAndRequestLog(): string | null {
    if (this.view !== 'log') return null;
    return guildBankLogSignature(this.deps.world().guildBankLog());
  }

  /** Build the guild pane model from the live world. Exposed so BankWindow can
   *  branch on 'hidden' (tab fallback) without duplicating the core call. The
   *  purse rides in for the unopened pane's rung-0 (purse-paid) affordability
   *  marker; the opened pane ignores it (snapshot-only enablement). */
  model(): GuildBankViewModel {
    const world = this.deps.world();
    // knownItemDef, never a raw ITEMS index: a prototype key ('constructor',
    // '__proto__') indexes to a truthy Function, which would send an unknown
    // server item id down the KNOWN arm below. The release's stale-client sweep
    // made every other bags/bank read go through this; the guild pane follows.
    return buildGuildBankView(world.guildBankInfo, (id) => knownItemDef(ITEMS, id), world.copper);
  }

  /** Append the guild pane sections (capacity, treasury, grid, buy row; for
   *  an UNOPENED bank: treasury plus the open-the-bank row) to the window
   *  root. BankWindow has already painted the title + tab strip and
   *  captured the .bank-scroll offset it restores after this returns; it hands
   *  the model it already built for the tab-visibility branch (one core call
   *  per paint, never two). */
  renderInto(root: HTMLElement, model: GuildBankViewModel): void {
    if (model.kind === 'hidden') return; // raced null: BankWindow falls back next paint
    // A REAL role=tabpanel, unlike the personal pane, which mounts flat. This
    // pane holds a nested tab list, and an inner tablist with no owning panel
    // reads to a screen reader as a second unrelated top-level strip that came
    // from nowhere. The wrapper is a transparent flex passthrough (see
    // .gbank-pane) so the window's column sizing is unchanged.
    const el = document.createElement('div');
    el.id = GUILD_PANEL_ID;
    el.className = 'gbank-pane';
    el.setAttribute('role', 'tabpanel');
    el.setAttribute('aria-labelledby', GUILD_TAB_ID);
    root.appendChild(el);
    // The Contents / Log sub-strip, INSIDE the panel. It renders for the
    // UNOPENED bank too: the treasury works from day one, so a bank nobody has
    // opened can already have gold movements and a charter fee worth reading.
    this.renderViewStrip(el);
    if (this.view === 'log') {
      // Reading the log is what REQUESTS it (cold data, no snapshot key), so
      // this call is the whole fetch trigger and it only happens here, on a
      // paint of the open log view.
      this.logPane.renderInto(el, buildGuildBankLogView(this.deps.world().guildBankLog()));
      return;
    }
    if (model.kind === 'unopened') {
      // No rung bought yet: the treasury works from day one, the item store
      // does not exist until an officer opens it from their own purse.
      el.appendChild(this.buildTreasuryRow(model.treasury));
      el.appendChild(this.buildOpenRow(model.open));
      return;
    }
    const capacity = document.createElement('div');
    capacity.className = 'bank-capacity';
    const used = this.fmt(model.capacity.used);
    const total = this.fmt(model.capacity.total);
    capacity.textContent = t('hudChrome.bank.capacity', { used, total });
    capacity.setAttribute('aria-label', t('hudChrome.bank.guildCapacityAria', { used, total }));
    el.appendChild(capacity);
    el.appendChild(this.buildTreasuryRow(model.treasury));
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

  // The Contents / Log sub-strip: the shared WAI-ARIA tab strip core, the same
  // building block BankWindow's Personal/Guild strip uses. Its own aria-label,
  // because a nested tablist that borrowed the outer one's name would announce
  // two identically-named tab lists. No panelId (the sections mount directly on
  // the window root, the bank strip's precedent).
  private renderViewStrip(el: HTMLElement): void {
    el.insertAdjacentHTML(
      'beforeend',
      tabStripHtml(
        tabStripModel({
          ariaLabel: t('hudChrome.bank.guildViewsAria'),
          stripClass: 'bank-tabs gbank-view-tabs',
          tabClass: 'gbank-view-tab',
          selectedClass: 'on',
          tabs: [
            { id: 'contents', label: t('hudChrome.bank.guildContentsTab') },
            { id: 'log', label: t('hudChrome.bank.guildLogTab') },
          ],
          selected: this.view,
        }),
      ),
    );
    wireTabStrip(el, 'gbank-view-tab', (id, focusFollow) => {
      if (id !== 'contents' && id !== 'log') return;
      if (this.view !== id) audio.click();
      this.view = id;
      this.deps.requestRender();
      if (focusFollow) focusActiveTab(this.deps.root(), 'gbank-view-tab', 'on');
    });
  }

  private fmt(n: number): string {
    return formatNumber(n, { maximumFractionDigits: 0 });
  }

  // The treasury header row: label + coin readout + the two gold actions.
  // Shared by the opened AND unopened panes (gold ops work from day one).
  // Enablement comes from the pure model (snapshot state only, never the live
  // purse, so the window's purse-free refresh signature stays honest; the
  // unopened pane's OPEN row is the one purse-read exception, see buildOpenRow).
  private buildTreasuryRow(treasury: GuildBankTreasuryModel): HTMLElement {
    const row = document.createElement('div');
    row.className = 'gbank-treasury';
    const label = document.createElement('span');
    label.className = 'gbank-treasury-label';
    label.textContent = t('hudChrome.bank.guildTreasury');
    const amount = document.createElement('span');
    amount.className = 'gbank-treasury-amount';
    amount.innerHTML = this.deps.moneyHtml(treasury.copper);
    const actions = document.createElement('div');
    actions.className = 'gbank-treasury-actions';
    const deposit = document.createElement('button');
    deposit.type = 'button';
    deposit.className = 'gbank-gold-btn';
    deposit.textContent = t('hudChrome.bank.guildDepositGold');
    deposit.disabled = !treasury.canDepositGold;
    deposit.addEventListener('click', () => this.showGoldPrompt('deposit', treasury.copper));
    const withdraw = document.createElement('button');
    withdraw.type = 'button';
    withdraw.className = 'gbank-gold-btn';
    withdraw.textContent = t('hudChrome.bank.guildWithdrawGold');
    withdraw.disabled = !treasury.canWithdrawGold;
    withdraw.addEventListener('click', () => this.showGoldPrompt('withdraw', treasury.copper));
    actions.append(deposit, withdraw);
    row.append(label, amount, actions);
    return row;
  }

  // The UNOPENED pane's one action row: "Open the guild bank" at rung 0's
  // table price, paid from the CLICKING OFFICER'S OWN PURSE (never the
  // treasury). Mirrors the expansion row's contract: never disabled on
  // affordability (the sim refuses with its own localized 'Not enough
  // money.'), an unaffordable price carries a visible text marker on top of
  // the styling class, and the always-visible note says whose money it is.
  private buildOpenRow(open: GuildBankOpenModel): HTMLElement {
    const row = document.createElement('div');
    // `.gbank-open-row` is a structural marker (no CSS rule of its own; the
    // shared bank-buy-row classes carry the styling): it distinguishes the
    // open row in tests and DOM tooling.
    row.className = 'bank-buy-row gbank-buy-row gbank-open-row';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `bank-buy-btn${open.affordable ? '' : ' gbank-buy-short'}`;
    const short = open.affordable
      ? ''
      : `<span class="gbank-buy-short-label">${esc(t('hudChrome.bank.guildPurseShort'))}</span>`;
    btn.innerHTML =
      `<span class="bank-buy-label">${esc(t('hudChrome.bank.guildOpenBank'))}</span>` +
      this.deps.moneyHtml(open.price) +
      short;
    btn.addEventListener('click', () => this.showOpenBankPrompt(open.price));
    row.appendChild(btn);
    const note = document.createElement('div');
    note.className = 'gbank-buy-note';
    note.textContent = t('hudChrome.bank.guildOpenNote');
    row.appendChild(note);
    return row;
  }

  // The open-the-bank confirm: same chrome as the expansion confirm; the wire
  // token is the same guildBankBuySlots (the sim decides the next rung and
  // charges the PURSE for rung 0; the price is never client-supplied).
  // `.gbank-open-prompt` is a structural marker (no CSS rule of its own; the
  // shared bank-buy-prompt classes carry the styling): it distinguishes the
  // open confirm in tests and DOM tooling.
  private showOpenBankPrompt(price: number): void {
    this.showBuyConfirmPrompt({
      className: 'gbank-open-prompt',
      text: t('hudChrome.bank.guildOpenConfirm', { price: formatMoney(price) }),
      confirmLabel: t('hudChrome.bank.guildOpenAccept'),
    });
  }

  // The ONE confirm-prompt builder behind the expansion and open-the-bank
  // confirms (the rule of three landed with the open prompt: the personal
  // pane's buy confirm in bank_window.ts is the third sibling; fold it in if
  // it ever grows guild-shaped needs). Both actions send the same
  // guildBankBuySlots token; the sim decides the rung and the payer.
  private showBuyConfirmPrompt(opts: {
    className?: string;
    text: string;
    confirmLabel: string;
  }): void {
    this.deps.dismissPrompts();
    const opener = document.activeElement as HTMLElement | null;
    const stack = document.getElementById('prompt-stack');
    if (!stack) return;
    const prompt = document.createElement('div');
    prompt.className = ['prompt panel bank-buy-prompt gbank-buy-prompt', opts.className]
      .filter(Boolean)
      .join(' ');
    prompt.innerHTML = `<div class="prompt-text">${esc(opts.text)}</div>`;
    const confirm = document.createElement('button');
    confirm.className = 'btn';
    confirm.textContent = opts.confirmLabel;
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
    const item = knownItemDef(ITEMS, slot.itemId);
    const cell = document.createElement('button');
    cell.type = 'button';
    // Focus keys are BankWindow's business: annotateGuildFocusKeys stamps every
    // guild control after renderInto returns, keeping the shared focus-key
    // namespace inside the one module that imports focus_restore (the guard in
    // tests/focus_restore.test.ts pins that single-reader rule).
    const dormantClass = slot.dormant ? ' gbank-dormant' : '';
    const itemName = item ? itemDisplayName(item) : t('hudChrome.bank.guildUnknownItem');
    const count = this.fmt(slot.count);
    // Per-copy corner marks share the bags/personal-bank helper so a guild-banked
    // masterwork keeps its seal. Dormant lock mark sits top-right; instance glyphs
    // sit top-left, so both can coexist without colliding.
    const glyphKind = bagInstanceGlyphKind(slot.instance);
    const instanceMark = instanceGlyphMarkHtml(glyphKind);
    if (slot.known && item) {
      cell.className = `bank-item q-${slot.qualityKey}${dormantClass}`;
      const qColor = QUALITY_COLOR[slot.qualityKey] ?? QUALITY_DEFAULT_COLOR;
      cell.style.setProperty('--bank-slot-quality', qColor);
      const mark = slot.dormant ? `<span class="gbank-dormant-mark">${svgIcon('lock')}</span>` : '';
      cell.innerHTML = `${this.deps.itemIcon(item)}${instanceMark}<span class="bank-count">${
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
      )}</span>${instanceMark}<span class="bank-count">${
        slot.showCount ? esc(t('itemUi.bags.stackCount', { count })) : ''
      }</span>`;
      this.deps.attachTooltip(cell, () => {
        const hint = slot.dormant
          ? t('hudChrome.bank.guildDormantHint')
          : t('hudChrome.bank.withdrawHint');
        return `<div class="tt-title">${esc(t('hudChrome.bank.guildUnknownItem'))}</div><div class="tt-sub">${esc(slot.itemId)}</div><div class="tt-sub">${esc(hint)}</div>`;
      });
    }
    // Dormant wording outranks the per-copy flag (the lock is the action fact);
    // otherwise a masterwork / signed / enchanted copy announces itself. The
    // guild pane keeps the KNOWN key family even for an unknown id: itemName is
    // already the localized unknown-item label here (the label carries the
    // unknown fact, the raw id lives in the tooltip), where the personal bank
    // announces the raw id via the UNKNOWN_ siblings instead. Deliberate; the
    // guild marker suite pins the exact strings.
    cell.setAttribute(
      'aria-label',
      slot.dormant
        ? t('hudChrome.bank.guildDormantAria', { item: itemName, count })
        : t(glyphKind ? INSTANCE_GLYPH_ARIA_KEYS[glyphKind] : 'itemUi.bags.itemAria', {
            item: itemName,
            count,
          }),
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
    const item = knownItemDef(ITEMS, slot.itemId);
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
    // Announce via clear-then-append of a fresh child node so a REPEATED
    // identical refusal is a DOM change AT re-announces (a same-text
    // textContent write is not).
    const errorLine = document.createElement('div');
    errorLine.className = 'gbank-gold-error';
    errorLine.setAttribute('role', 'status');
    errorLine.setAttribute('aria-live', 'polite');
    prompt.appendChild(errorLine);
    const voiceRefusal = (text: string): void => {
      errorLine.textContent = '';
      const line = document.createElement('span');
      line.textContent = text;
      errorLine.appendChild(line);
    };
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
          voiceRefusal(t('itemUi.errors.notEnoughMoney'));
          return;
        }
        if (entered > max) {
          voiceRefusal(tSim('error.guildBankTreasuryCap'));
          return;
        }
        this.deps.world().guildBankDepositGold(entered);
      } else {
        const amount = clampGoldAmount(entered, max);
        if (amount === null) {
          // The treasury cannot give anything right now (drained since the
          // paint): surface it, keep the prompt open.
          voiceRefusal(t('hudChrome.bank.guildGoldCannotMove'));
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
    this.showBuyConfirmPrompt({
      text: t('hudChrome.bank.guildBuyConfirm', {
        count: this.fmt(blockSlots),
        price: formatMoney(price),
      }),
      confirmLabel: t('hudChrome.bank.buyConfirmAccept'),
    });
  }

  // Land focus on the window's always-present close button after an op-driven
  // rebuild detached the opener (the personal pane's idiom).
  private focusClose(): void {
    (this.deps.root().querySelector('[data-close]') as HTMLElement | null)?.focus();
  }
}
