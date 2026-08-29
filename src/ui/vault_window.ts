// The Materials Vault tab of the bank window: the third pane BankWindow
// composes, the GuildBankTab shape (a pane class with model() + renderInto(),
// never mounted on its own and never owning a repaint decision: BankWindow's
// refreshIfChanged signature drives every rebuild, and this pane asks for one
// with deps.requestRender()). Renders the VaultViewModel the pure core
// (vault_view.ts) builds: the locked unlock offer, the stocked per-material
// rows with withdraw actions, the batched deposit-all button, and the
// gold-only ceiling upgrade with its confirm in the prompt stack.
//
// Cold contract (the *_window perf bucket): rebuilt via renderInto on open,
// real data change, and language switch; no forced-reflow layout read (the
// .bank-scroll offset capture stays in BankWindow, the guild precedent) and no
// repeating driver of its own (the two summary timers are one-shot
// setTimeouts). Registered in UI_DOM_MODULES (tests/architecture.test.ts).
//
// Every displayed price and capacity comes from the WIRE model
// (nextUpgradeCost, perMaterialCap): no client price table, no client cap
// constant beyond the ladder-geometry nextCap the pure core derives. The
// prompts reuse the bank family's classes (bank-buy-prompt /
// bank-quantity-prompt) so dismissBankPrompts and the force-close teardown
// reach them.

import { audio } from '../game/audio';
import { ITEMS } from '../sim/data';
import { isItemLocked } from '../sim/item_lock';
import { resolveVaultSpecialIndex, vaultMaterialIds } from '../sim/materials_vault';
import type { InvSlot, ItemDef, ItemInstancePayload } from '../sim/types';
import type { IWorld, VaultSpecialRef } from '../world_api';
import { bagCornerMark, bagRimClasses } from './bag_corner_mark_view';
import { bagInstanceGlyphKind } from './bag_instance_glyph_view';
import { showBuyConfirmPrompt } from './bank_buy_prompt';
import { showQuantityPrompt } from './bank_quantity_prompt';
import { appendBankStatusLine, type BankStatusAnnouncementState } from './bank_status_line';
import { formatCount } from './count_format';
import { itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import { FOCUS_KEY_ATTR, findFocusKey, restoreFirstEnabled } from './focus_restore';
import { formatMoney, type TranslationKey, t } from './i18n';
import { QUALITY_COLOR } from './icons';
import {
  cornerMarkHtml,
  INSTANCE_GLYPH_ARIA_KEYS,
  lockMarkHtml,
  UNKNOWN_INSTANCE_GLYPH_ARIA_KEYS,
} from './item_instance_glyph_mark';
import { knownItemDef } from './known_item';
import { StorageRungEchoLatch } from './storage_rung_echo_core';
import { svgIcon } from './ui_icons';
import { unknownItemIconHtml } from './unknown_item_icon';
import {
  buildVaultView,
  hasVaultDepositable,
  predictVaultDepositAll,
  type VaultRowModel,
  type VaultSpecialRowModel,
  type VaultViewModel,
  vaultDepositAllSummaryKey,
  vaultRowAction,
  vaultSpecialRef,
  vaultWithdrawFit,
  vaultWithdrawNotice,
} from './vault_view';

// The unranked quality fallback, the bank/bags token (no raw hex in painters).
const QUALITY_DEFAULT_COLOR = 'var(--color-quality-default)';

// How long the transient deposit-all / shortfall summary stays on screen (the
// bank's DEPOSIT_STATUS_MS twin, kept module-local so the two panes stay
// independently tunable).
const VAULT_STATUS_MS = 4_000;

/** Stable ids so BankWindow can stamp aria-controls on the strip tab and the
 *  panel can point aria-labelledby back at it (the guild pane precedent). */
export const VAULT_PANEL_ID = 'bank-panel-vault';
export const VAULT_TAB_ID = 'bank-tab-vault';
// The deposit-all button's visually-hidden description (aria-describedby):
// a module constant like the two ids above, so the pair cannot drift.
const VAULT_DEPOSIT_ALL_DESC_ID = 'vault-deposit-all-desc';

type VaultFocusRole = 'row' | 'partial';

interface VaultStatus extends BankStatusAnnouncementState {
  key: TranslationKey;
  params?: Record<string, string>;
  at: number;
}

/** A pooled key is stable across row insertion and sorting (pure item
 * identity). A special key is NOT fully stable: it interpolates the raw
 * snapshot index, so removing an EARLIER special slot shifts every later
 * key and the exact-key restore misses (behaviorally safe: the restore
 * ladder falls back instead of landing on a different physical copy, and
 * itemId in the key prevents an index reuse from resolving to another
 * material). Resolution uses dataset equality, so an arbitrary tolerated
 * item id never enters a selector. */
function vaultFocusKey(model: VaultRowModel, role: VaultFocusRole): string {
  const identity =
    model.kind === 'pooled'
      ? `pooled:${model.itemId}`
      : `special:${model.specialRef.index}:${model.itemId}`;
  return `vault:${role}:${identity}`;
}

/** BankWindow-supplied glue, the GuildBankTabDeps shape: the shared
 *  presentation painters plus the window's prompt-dialog chrome. */
export interface VaultTabDeps {
  root(): HTMLElement;
  world(): IWorld;
  itemIcon(item: ItemDef): string;
  moneyHtml(copper: number): string;
  itemTooltip(item: ItemDef, instance?: ItemInstancePayload): string;
  attachTooltip(el: HTMLElement, html: () => string): void;
  hideTooltip(): void;
  /** True when this click released a long-press tooltip peek (suppress the
   *  withdraw, the bank grid rule). */
  consumePeek(): boolean;
  onInventoryChanged(): void;
  installPromptDialog(
    prompt: HTMLElement,
    opener: HTMLElement | null,
    close: () => void,
  ): { dismiss: () => void; dismissAndReturn: () => void };
  dismissPrompts(): void;
  requestRender(): void;
}

export class VaultTab {
  // The transient status (deposit-all summary, withdraw shortfall, or refreshed
  // purchase price) and its self-expire timer: a synchronous visible band plus
  // an empty-then-published polite live region. Stored as KEY plus params,
  // resolved at build time, so a language switch inside the 4-second window
  // relocalizes the line with the rest of the pane.
  private status: VaultStatus | null = null;
  private statusTimer: number | null = null;

  // In-flight guard for deposit-all: ONE command, but the online mirror still
  // lags its echo by about a tick, so a rapid second click would re-predict
  // from the stale mirror and show a summary for materials already stocked.
  // Held until BankWindow's signature moves (clearDepositAllPending) or the
  // fallback timer clears a lost echo.
  private depositAllPending = false;
  private depositAllTimer: number | null = null;
  private readonly purchaseEcho: StorageRungEchoLatch;

  constructor(private readonly deps: VaultTabDeps) {
    this.purchaseEcho = new StorageRungEchoLatch(
      {
        schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
        cancel: (handle) => window.clearTimeout(handle),
      },
      () => this.deps.requestRender(),
    );
  }

  /** The render model off the live mirror. 'away' collapses the tab
   *  (BankWindow's strip rule); the window never calls renderInto with it. */
  model(): VaultViewModel {
    const info = this.deps.world().vaultInfo;
    this.purchaseEcho.observe(info?.upgrades);
    return buildVaultView(info, (id) => knownItemDef(ITEMS, id));
  }

  /** Release an in-flight rung when the authoritative command path refuses it. */
  onDefinitivePurchaseRefusal(): boolean {
    return this.purchaseEcho.refuse();
  }

  /** True while the pane shows a stocked, UNLOCKED vault: the bags companion
   *  routes a bag click to vaultDeposit only then (the locked offer is a
   *  purchase surface, not a deposit target; BankWindow composes this into
   *  vaultTabActive). */
  get unlocked(): boolean {
    return (this.deps.world().vaultInfo?.upgrades ?? 0) > 0;
  }

  /** Close/teardown: drop transient status and the deposit-all guard so a
   *  reopened bank never flashes a stale line (BankWindow.close calls this).
   *  A purchase guard deliberately survives until echo, refusal, or timeout. */
  reset(): void {
    this.clearStatus();
    this.clearDepositAllPending();
  }

  /** The bank data signature moved: any in-flight deposit-all has echoed, so
   *  the button may re-enable on this repaint (BankWindow.refreshIfChanged). */
  clearDepositAllPending(): void {
    if (this.depositAllTimer !== null) {
      window.clearTimeout(this.depositAllTimer);
      this.depositAllTimer = null;
    }
    this.depositAllPending = false;
  }

  private clearStatus(): void {
    if (this.statusTimer !== null) {
      window.clearTimeout(this.statusTimer);
      this.statusTimer = null;
    }
    this.status = null;
  }

  /** The pane stopped rendering (a tab switch): stop the STATUS self-expire
   *  timer so it cannot fire a whole-window rebuild for a line nobody can
   *  see. The status itself is kept: switching back inside the window
   *  re-shows it and appendStatusLine's age check still owns expiry. The
   *  depositAllTimer deliberately keeps running: its fallback re-enables the
   *  button after a lost echo, which must happen wherever the player is, or
   *  switching back would find it wedged shut. */
  pauseStatusTimer(): void {
    if (this.statusTimer !== null) {
      window.clearTimeout(this.statusTimer);
      this.statusTimer = null;
    }
  }

  /** Build the pane into the freshly wiped window root (BankWindow.render owns
   *  the wipe, the strip, and the scroll-offset restore). */
  renderInto(root: HTMLElement, model: VaultViewModel): void {
    if (model.kind === 'away') return; // the tab is collapsing on this paint
    const panel = document.createElement('div');
    panel.className = 'vault-pane';
    panel.id = VAULT_PANEL_ID;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', VAULT_TAB_ID);
    if (model.kind === 'locked') {
      this.buildLockedPane(panel, model.unlockCost, model.unlockCap);
      root.appendChild(panel);
      return;
    }
    const note = document.createElement('div');
    note.className = 'bank-capacity vault-cap-note';
    note.textContent = t('hudChrome.bank.vaultCapacityNote', {
      cap: formatCount(model.perMaterialCap),
    });
    panel.appendChild(note);
    this.appendStatusLine(panel);
    const scroll = document.createElement('div');
    scroll.className = 'bank-scroll';
    if (model.empty) {
      const empty = document.createElement('div');
      empty.className = 'bank-empty';
      empty.textContent = t('hudChrome.bank.vaultEmpty');
      scroll.appendChild(empty);
    } else {
      const list = document.createElement('div');
      list.className = 'vault-list';
      for (const row of model.rows) this.appendRow(list, row);
      scroll.appendChild(list);
    }
    panel.appendChild(scroll);
    panel.appendChild(
      this.buildFooter(
        model.upgrade.currentUpgrades,
        model.upgrade.nextCost,
        model.upgrade.nextCap,
      ),
    );
    root.appendChild(panel);
  }

  // The locked pane: the unlock offer, rendered ENTIRELY from the wire shape
  // ({ stock: {}, upgrades: 0, perMaterialCap: 0, nextUpgradeCost: <price> },
  // pinned by tests/vault_wire.test.ts). A null price (impossible from a sane
  // snapshot) renders the pitch without a buy row rather than a 0-price offer.
  private buildLockedPane(panel: HTMLElement, unlockCost: number | null, unlockCap: number): void {
    const intro = document.createElement('div');
    intro.className = 'vault-locked-intro';
    intro.textContent = t('hudChrome.bank.vaultLockedIntro', {
      cap: formatCount(unlockCap),
    });
    panel.appendChild(intro);
    // A stale unlock confirm can discover a refreshed rung-0 price. The same
    // transient status used by the stocked pane must therefore render here too
    // (before the refreshed offer the keyboard focus lands on).
    this.appendStatusLine(panel);
    if (unlockCost === null) return;
    const row = document.createElement('div');
    row.className = 'bank-buy-row';
    const btn = document.createElement('button');
    btn.type = 'button';
    // Never DISABLED on affordability (the sim is authoritative and refuses
    // with its own line); an unaffordable price carries the guild open-row's
    // visible shortfall marker instead, which is what the purse term in
    // BankWindow's repaint signature repaints.
    const affordable = this.deps.world().copper >= unlockCost;
    btn.className = `bank-buy-btn vault-unlock-btn${affordable ? '' : ' bank-buy-short'}`;
    btn.innerHTML =
      `<span class="bank-buy-label">${esc(t('hudChrome.bank.vaultUnlockButton'))}</span>` +
      this.deps.moneyHtml(unlockCost) +
      (affordable
        ? ''
        : `<span class="bank-buy-short-label">${esc(t('hudChrome.bank.guildPurseShort'))}</span>`);
    this.markPurchaseBusy(btn);
    btn.addEventListener('click', () =>
      this.showBuyPrompt(
        t('hudChrome.bank.vaultUnlockConfirm', { price: formatMoney(unlockCost) }),
        { upgrades: 0, cost: unlockCost },
      ),
    );
    row.appendChild(btn);
    panel.appendChild(row);
  }

  // The thin consumer of one VaultRowModel: every presentation DECISION
  // (known, qualityKey, atCap, overCap) comes from the core; the painter
  // resolves the ItemDef only for the icon/name/tooltip PAINTERS, which need
  // the def itself rather than a decision about it.
  //
  // No node pooling, as a DECISION rather than an omission: the row count is
  // bounded (one row per stocked pooled material id, capped by the sim's
  // storable-material set, plus one per special slot), and this is a cold
  // path: rows mint only when BankWindow's refreshIfChanged signature moves
  // (the HUD's 500ms slow band while the tab is open), never per frame.
  private appendRow(list: HTMLElement, model: VaultRowModel): void {
    const { itemId, count, storedTotal, cap } = model;
    const ordinal = list.childElementCount;
    const item = model.known ? knownItemDef(ITEMS, itemId) : undefined;
    const wrap = document.createElement('div');
    wrap.className = 'vault-row-wrap';
    const row = document.createElement('button');
    row.type = 'button';
    // over-cap (a tolerated legacy over-stock) composes ON TOP of at-cap: the
    // count text carries the fact either way; the classes are styling hooks.
    // The fine rim (bag-rim-fine) joins per the release's all-surfaces
    // mark-family rule: a fine grade is marked in bags, bank, and guild bank,
    // so the vault row beside them marks it the same way.
    const glyphKind = model.kind === 'special' ? bagInstanceGlyphKind(model.instance) : null;
    const cornerMark = bagCornerMark(glyphKind, null, model.fine);
    const locked = model.kind === 'special' && isItemLocked(model.instance);
    row.className = `vault-row vault-row-${model.kind}${model.atCap ? ' at-cap' : ''}${model.overCap ? ' over-cap' : ''}${bagRimClasses(null, model.fine)}`;
    row.dataset.itemId = itemId;
    if (model.kind === 'special') row.dataset.vaultSpecialIndex = String(model.specialRef.index);
    row.setAttribute(FOCUS_KEY_ATTR, vaultFocusKey(model, 'row'));
    row.style.setProperty(
      '--bank-slot-quality',
      QUALITY_COLOR[model.qualityKey] ?? QUALITY_DEFAULT_COLOR,
    );
    // Stale-client guard (R34): a dormant id this bundle predates still holds
    // real recoverable stock, so it renders (fallback icon, raw id label) and
    // its withdraw stays live (the server resolves by itemId, no def needed).
    const name = item ? itemDisplayName(item) : itemId;
    const countLabel = formatCount(count);
    const totalLabel = formatCount(storedTotal);
    const capLabel = formatCount(cap);
    const rowStateId = `vault-row-state-${ordinal}`;
    const instanceStateId = `vault-row-instance-${ordinal}`;
    row.setAttribute('aria-label', t('hudChrome.bank.vaultRowWithdrawName', { item: name }));
    row.setAttribute(
      'aria-describedby',
      glyphKind ? `${rowStateId} ${instanceStateId}` : rowStateId,
    );
    // Match the personal and guild bank accessibility priority: the player
    // lock is the actionable owner fact, so it outranks the still-visible
    // per-copy glyph in the announcement. The lock seal itself is aria-hidden.
    const instanceState = locked
      ? t('hudChrome.bags.itemAriaLocked', { item: name, count: countLabel })
      : glyphKind
        ? t(
            model.known
              ? INSTANCE_GLYPH_ARIA_KEYS[glyphKind]
              : UNKNOWN_INSTANCE_GLYPH_ARIA_KEYS[glyphKind],
            {
              ...(model.known ? { item: name } : { id: itemId }),
              count: countLabel,
            },
          )
        : '';
    row.innerHTML =
      `${item ? this.deps.itemIcon(item) : unknownItemIconHtml(itemId)}` +
      cornerMarkHtml(cornerMark) +
      lockMarkHtml(locked) +
      `<span class="vault-row-name">${esc(name)}</span>` +
      (model.kind === 'special'
        ? `<span class="vault-row-stack-count">${esc(t('itemUi.bags.stackCount', { count: countLabel }))}</span>`
        : '') +
      `<span class="vault-row-count">${esc(t('hudChrome.bank.capacity', { used: totalLabel, total: capLabel }))}</span>` +
      `<span class="visually-hidden" id="${rowStateId}">${esc(t('hudChrome.bank.vaultRowAria', { item: name, count: totalLabel, cap: capLabel }))}</span>` +
      (instanceState
        ? `<span class="visually-hidden" id="${instanceStateId}">${esc(instanceState)}</span>`
        : '');
    row.addEventListener('click', (ev) => {
      if (this.deps.consumePeek()) {
        this.deps.hideTooltip();
        return;
      }
      this.onRowClick(model, ev.shiftKey);
    });
    this.deps.attachTooltip(row, () => {
      const body = item
        ? this.deps.itemTooltip(item, model.kind === 'special' ? model.instance : undefined)
        : `<div class="tt-title">${esc(itemId)}</div><div class="tt-sub">${esc(t('itemUi.bags.unknownItem'))}</div>`;
      const partial = model.canChooseQuantity
        ? `<div class="tt-sub">${esc(t('hudChrome.bank.withdrawPartialHint'))}</div>`
        : '';
      return `${body}<div class="tt-sub">${esc(t('hudChrome.bank.withdrawHint'))}</div>${partial}`;
    });
    wrap.appendChild(row);
    if (model.canChooseQuantity && model.partialMax !== null) {
      // A visible sibling action gives touch and switch users the same partial
      // withdraw path desktop users have through Shift-click. It is a sibling,
      // not a nested button, so both controls retain valid native semantics.
      const partial = document.createElement('button');
      partial.type = 'button';
      partial.className = 'vault-row-partial';
      partial.setAttribute(FOCUS_KEY_ATTR, vaultFocusKey(model, 'partial'));
      // Label-in-name (WCAG 2.5.3): the accessible name embeds the chip's
      // visible label text in every filled locale (the English value leads
      // with it; the non-Latin fills nest their own withdrawQuantityInput
      // translation), so voice-control users can speak what they see.
      const partialLabel = t('hudChrome.bank.withdrawQuantityAction', { item: name });
      partial.setAttribute('aria-label', partialLabel);
      // The shared tooltip, not a native title (every sibling control's rule);
      // re-resolved at show time so a language switch relocalizes it. TWO
      // lines: the action sentence AND the chip's own visible label. The 72px
      // chip ellipsis-caps that label in EVERY locale (the English text
      // already overflows the cap at 11px), and in a locale whose action
      // translation is still pending the first line falls back to English, so
      // the second line is what guarantees the elided TRANSLATED label stays
      // recoverable from the tooltip.
      this.deps.attachTooltip(
        partial,
        () =>
          `<div class="tt-sub">${esc(t('hudChrome.bank.withdrawQuantityAction', { item: name }))}</div>` +
          `<div class="tt-sub">${esc(t('hudChrome.bank.withdrawQuantityInput'))}</div>`,
      );
      partial.innerHTML =
        svgIcon('more') +
        `<span class="vault-row-partial-label">${esc(t('hudChrome.bank.withdrawQuantityInput'))}</span>`;
      const partialMax = model.partialMax;
      partial.addEventListener('click', () => this.showWithdrawQuantityPrompt(model, partialMax));
      wrap.appendChild(partial);
    }
    list.appendChild(wrap);
  }

  // Plain click withdraws the whole pooled count; shift-click on a multi-count
  // row opens the shared quantity prompt. Both explain a partial fit from the
  // CLICK-TIME snapshot: the sim resolves a bags-can-only-hold-part withdraw
  // silently (the phase 01 recorded open call, resolved UI-side here), while a
  // zero-fit click stays quiet because the sim emits its own bags-full line.
  private onRowClick(model: VaultRowModel, shift: boolean): void {
    const world = this.deps.world();
    const liveSpecial = model.kind === 'special' ? this.liveSpecialRow(model) : null;
    if (model.kind === 'special' && !liveSpecial) return;
    const count = liveSpecial?.slot.count ?? this.stockCount(model.itemId);
    const action = vaultRowAction(count, shift && model.canChooseQuantity);
    if (action.kind === 'none') return;
    if (action.kind === 'withdraw') {
      this.noteShortfall(
        model.itemId,
        count,
        liveSpecial?.slot.instance,
        liveSpecial?.slot.craftedRecipeId,
      );
      if (liveSpecial) world.vaultWithdraw(model.itemId, undefined, liveSpecial.ref);
      else world.vaultWithdraw(model.itemId);
      audio.click();
      this.deps.onInventoryChanged();
      this.deps.requestRender();
      return;
    }
    this.showWithdrawQuantityPrompt(model, action.max);
  }

  // hasOwn, not a plain index: a tolerated save can stock a dormant
  // prototype-named id ('constructor'), and this read must not resolve it to
  // an inherited function (the vault_view core and the sim make the same call).
  private stockCount(itemId: string): number {
    const stock = this.deps.world().vaultInfo?.stock;
    if (!stock || !Object.hasOwn(stock, itemId)) return 0;
    return stock[itemId];
  }

  // Predict the withdraw's bag fit from the click-time snapshot and stage the
  // shortfall line when only part will move (fit 0 stays silent: the sim's own
  // bags-full error covers it, and a second line would double-speak).
  private noteShortfall(
    itemId: string,
    want: number,
    instance?: ItemInstancePayload,
    craftedRecipeId?: string,
  ): void {
    const world = this.deps.world();
    // While dead every vault op is a silent sim no-op (the town-service
    // idiom), so predicting a shortfall would explain a withdraw that never
    // happens: send and stay quiet, like the sim.
    if (world.player.dead) return;
    const fit = vaultWithdrawFit(
      world.inventory,
      world.bags,
      itemId,
      want,
      instance,
      craftedRecipeId,
    );
    const notice = vaultWithdrawNotice(fit, want);
    if (notice.kind !== 'short') return;
    this.setStatus('hudChrome.bank.vaultWithdrawShort', {
      fit: formatCount(notice.fit),
      count: formatCount(want),
    });
  }

  private showWithdrawQuantityPrompt(model: VaultRowModel, maxCount: number): void {
    const { itemId } = model;
    const item = knownItemDef(ITEMS, itemId);
    const itemName = item ? itemDisplayName(item) : itemId;
    let resolvedSpecial: { slot: InvSlot; ref: VaultSpecialRef } | null =
      model.kind === 'special' ? this.liveSpecialRow(model) : null;
    showQuantityPrompt(
      {
        installPromptDialog: (prompt, opener, close) =>
          this.deps.installPromptDialog(prompt, opener, close),
        dismissSiblings: () => this.deps.dismissPrompts(),
      },
      {
        // The bank family's teardown selector reaches this via the first class.
        className: 'bank-quantity-prompt vault-quantity-prompt',
        titleText: t('hudChrome.bank.withdrawQuantityTitle', { item: itemName }),
        inputAriaText: t('hudChrome.bank.withdrawQuantityInput'),
        confirmText: t('hudChrome.bank.withdrawQuantityConfirm'),
        cancelText: t('itemUi.vendor.sellQuantityCancel'),
        maxCount,
        resolveCount: (requested) => {
          // Re-resolve the LIVE stock at submit (the mirror can move under an
          // open prompt) and clamp to it; a row that emptied refuses. The
          // shared prompt owns the number parsing, so no raw parsed value ever
          // reaches vaultWithdraw (the recorded non-number count ruling).
          let live: number;
          if (model.kind === 'special') {
            resolvedSpecial = this.liveSpecialRow(model);
            live = resolvedSpecial?.slot.count ?? 0;
          } else {
            live = this.stockCount(itemId);
          }
          if (live <= 0) return null;
          return Math.max(1, Math.min(maxCount, live, requested));
        },
        send: (count) => {
          this.noteShortfall(
            itemId,
            count,
            resolvedSpecial?.slot.instance,
            resolvedSpecial?.slot.craftedRecipeId,
          );
          this.deps.world().vaultWithdraw(itemId, count, resolvedSpecial?.ref);
          audio.click();
          this.deps.onInventoryChanged();
        },
        afterClose: () => {
          this.deps.requestRender();
          restoreFirstEnabled([
            findFocusKey(this.deps.root(), vaultFocusKey(model, 'partial')),
            findFocusKey(this.deps.root(), vaultFocusKey(model, 'row')),
            this.deps.root().querySelector<HTMLElement>('[data-close]'),
          ]);
        },
      },
    );
  }

  /** Re-resolve a special row from the live mirror by its full fingerprint.
   *  The snapshot index is the fast path; the shared resolver scans exact
   *  identity on a stale index and never falls back by item id. */
  private liveSpecialRow(
    model: VaultSpecialRowModel,
  ): { slot: InvSlot; ref: VaultSpecialRef } | null {
    const special = this.deps.world().vaultInfo?.special;
    if (!special) return null;
    const index = resolveVaultSpecialIndex(special, model.itemId, model.specialRef);
    if (index < 0) return null;
    const slot = special[index];
    return { slot, ref: vaultSpecialRef(index, slot) };
  }

  // The footer: the batched deposit-all button beside the ceiling upgrade row.
  private buildFooter(
    currentUpgrades: number,
    nextCost: number | null,
    nextCap: number | null,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'bank-buy-row vault-footer';

    const deposit = document.createElement('button');
    deposit.type = 'button';
    deposit.className = 'bank-deposit-all vault-deposit-all';
    deposit.textContent = t('hudChrome.bank.vaultDepositAll');
    const tooltip = t('hudChrome.bank.vaultDepositAllTooltip');
    deposit.title = tooltip;
    deposit.setAttribute('aria-describedby', VAULT_DEPOSIT_ALL_DESC_ID);
    deposit.disabled =
      this.depositAllPending ||
      !hasVaultDepositable(this.deps.world().inventory, vaultMaterialIds());
    deposit.addEventListener('click', () => this.onDepositAll());
    row.appendChild(deposit);
    const desc = document.createElement('span');
    desc.id = VAULT_DEPOSIT_ALL_DESC_ID;
    desc.className = 'visually-hidden';
    desc.textContent = tooltip;
    row.appendChild(desc);

    if (nextCost === null || nextCap === null) {
      const maxed = document.createElement('span');
      maxed.className = 'bank-buy-maxed';
      maxed.textContent = t('hudChrome.bank.buySlotsMaxed');
      row.appendChild(maxed);
      return row;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    // The unlock button's rule: enabled always, marked when the purse is short
    // (the wording reuses the guild key; the English is target-neutral).
    const affordable = this.deps.world().copper >= nextCost;
    btn.className = `bank-buy-btn vault-upgrade-btn${affordable ? '' : ' bank-buy-short'}`;
    btn.innerHTML =
      `<span class="bank-buy-label">${esc(t('hudChrome.bank.vaultUpgrade', { cap: formatCount(nextCap) }))}</span>` +
      this.deps.moneyHtml(nextCost) +
      (affordable
        ? ''
        : `<span class="bank-buy-short-label">${esc(t('hudChrome.bank.guildPurseShort'))}</span>`);
    this.markPurchaseBusy(btn);
    btn.addEventListener('click', () =>
      this.showBuyPrompt(
        t('hudChrome.bank.vaultUpgradeConfirm', {
          cap: formatCount(nextCap),
          price: formatMoney(nextCost),
        }),
        { upgrades: currentUpgrades, cost: nextCost },
      ),
    );
    row.appendChild(btn);
    return row;
  }

  // ONE wire command; the summary is the pure core's click-time replay (the
  // server's sweep is authoritative and follows the same rules, so at command
  // cadence the two agree; the bank's plan-derived summary has the same
  // mirror-lag tolerance). Never disabled by a full vault: the click reports
  // the outcome, the bank button's rule.
  private onDepositAll(): void {
    const world = this.deps.world();
    const info = world.vaultInfo;
    if (!info || info.upgrades <= 0) return; // walked away or locked between paint and click
    // Predict BEFORE the send, without exception: offline, world.inventory is
    // the LIVE sim array and vaultDepositAll mutates it SYNCHRONOUSLY, so a
    // post-send replay would find the bags already swept and report "nothing
    // deposited" after a fully successful sweep (and skip the coin, the
    // pending guard, and the bags repaint with it). Online the mirror lags a
    // tick either way. The dead flag is captured on the same snapshot.
    const dead = world.player.dead;
    const prediction = predictVaultDepositAll(world.inventory, info, vaultMaterialIds());
    world.vaultDepositAll();
    // While dead the sim silently no-ops the sweep (the town-service idiom):
    // the command still goes (server decides), but the predicted "Materials
    // deposited: N." would be a false claim, so the summary stays quiet (the
    // personal bank's deposit-all makes the same false claim today; recorded
    // family follow-up).
    if (dead) return;
    if (prediction.items > 0) {
      audio.coin();
      this.depositAllPending = true;
      if (this.depositAllTimer !== null) window.clearTimeout(this.depositAllTimer);
      this.depositAllTimer = window.setTimeout(() => {
        this.depositAllTimer = null;
        if (!this.depositAllPending) return;
        this.depositAllPending = false;
        this.deps.requestRender();
      }, VAULT_STATUS_MS);
      this.deps.onInventoryChanged();
    }
    const key = vaultDepositAllSummaryKey(prediction);
    this.setStatus(
      key,
      prediction.items === 0 ? undefined : { count: formatCount(prediction.items) },
    );
    this.deps.requestRender();
  }

  private setStatus(key: TranslationKey, params?: Record<string, string>): void {
    this.status = { key, params, at: performance.now(), announcedText: null };
  }

  // Paint the visible band synchronously, then mount a separate EMPTY live
  // region and publish into it on a microtask. A live region created already
  // populated is commonly never announced. Keeping the nodes separate also
  // leaves the visible text available to virtual-cursor users without giving
  // the freshly inserted band live semantics of its own.
  private appendStatusLine(parent: HTMLElement): void {
    const s = this.status;
    if (!s) return;
    const age = performance.now() - s.at;
    if (age >= VAULT_STATUS_MS) {
      this.clearStatus();
      return;
    }
    const text = t(s.key, s.params);
    appendBankStatusLine(parent, s, {
      text,
      visibleClass: 'vault-status',
      liveDataAttribute: 'data-vault-status-live',
      // A locale switch or signature repaint may replace this node before the
      // microtask. Its replacement schedules its own guarded publication.
      isCurrent: () => this.status === s,
    });
    if (this.statusTimer !== null) window.clearTimeout(this.statusTimer);
    this.statusTimer = window.setTimeout(() => {
      this.statusTimer = null;
      this.status = null;
      this.deps.requestRender();
    }, VAULT_STATUS_MS - age);
  }

  // The unlock / upgrade confirm in the prompt stack (the shared family
  // builder; both purchases send the same next-rung command, so one call
  // serves both with its caller-localized body).
  private showBuyPrompt(body: string, offer: { upgrades: number; cost: number }): void {
    if (this.purchaseEcho.pending) return;
    showBuyConfirmPrompt(
      {
        installPromptDialog: (prompt, opener, close) =>
          this.deps.installPromptDialog(prompt, opener, close),
        dismissSiblings: () => this.deps.dismissPrompts(),
      },
      {
        className: 'vault-buy-prompt',
        text: body,
        // The economy disclaimer rides every tunable-price commit (the
        // buy-slots rule): since phase 09 the vault ladder is server-tunable
        // (SimConfig.storagePrices), so the price on this confirm is live wire
        // data the operator can retune between sessions.
        secondaryText: t('hudChrome.bank.priceDisclaimer'),
        confirmLabel: t('hudChrome.bank.buyConfirmAccept'),
        cancelLabel: t('itemUi.vendor.sellQuantityCancel'),
        onConfirm: (dismiss) => {
          const world = this.deps.world();
          const info = world.vaultInfo;
          if (
            !info ||
            info.upgrades !== offer.upgrades ||
            info.nextUpgradeCost !== offer.cost ||
            !this.purchaseEcho.arm(offer.upgrades, offer.upgrades + 1)
          ) {
            this.setStatus('hudChrome.bank.priceChanged');
            dismiss();
            this.deps.requestRender();
            this.focusPurchaseOffer();
            return;
          }
          this.clearStatus();
          world.vaultBuyUpgrade();
          audio.coin();
          this.deps.onInventoryChanged();
          dismiss();
          this.deps.requestRender();
          (this.deps.root().querySelector('[data-close]') as HTMLElement | null)?.focus();
        },
      },
    );
  }

  private markPurchaseBusy(button: HTMLButtonElement): void {
    if (!this.purchaseEcho.pending) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  }

  /** A stale confirmation always returns the keyboard user to the refreshed
   * offer they must review. If the snapshot removed the offer entirely, the
   * window close remains the safe, always-present fallback. */
  private focusPurchaseOffer(): void {
    const root = this.deps.root();
    const offer = root.querySelector<HTMLElement>(
      '.vault-unlock-btn:not(:disabled):not([aria-disabled="true"]), ' +
        '.vault-upgrade-btn:not(:disabled):not([aria-disabled="true"])',
    );
    (offer ?? root.querySelector<HTMLElement>('[data-close]'))?.focus();
  }
}
