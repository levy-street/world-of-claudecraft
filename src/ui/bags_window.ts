// Bags window painter: owns the #bags DOM + the window-local filter state (the
// category/sort/search chips, persisted to localStorage), reads the player's
// inventory + copper from IWorld, and runs the mode-dependent bag click (trade /
// market-sell / vendor-sell / pet-feed / quest-discard / plain-use) plus the
// bag-only discard/sell prompts. The pure click/tooltip/grid decisions live in
// bags_view.ts (which reuses bag_filter.ts for the filter/sort); this is the thin
// DOM consumer per the unit_portrait / vendor_window template, composing the shared
// PainterHostPresentation bag (icon/money/tooltip) plus the bags-specific glue.
//
// Bags is the inventory cluster's hub: it rides alongside the vendor / market /
// trade windows, and those cross-window modes + shared drag state stay on the HUD
// behind the injected deps (tradeOpen / marketSell / vendorOpen / pet-feed), so the
// painter owns no cross-window state of its own. The HUD keeps toggleBags() +
// onInventoryChanged() as the coordinator and calls render() to repaint.
//
// Chrome is the shared AAA window frame (window_frame.ts) mounted on an inner
// container so the #bags root stays pristine for the docking CSS; the slot grid uses
// the .item-cell grammar (rarity via data-quality from the quality tokens, no raw
// hex in the painter), the filter is a .filter-row / .chip / .search-field header,
// and empty states use .empty-state.

import { audio } from '../game/audio';
import { BACKPACK_SLOTS, bagSlotsOf } from '../sim/bags';
import { ITEMS } from '../sim/data';
import type { InvSlot } from '../sim/types';
import type { IWorld } from '../world_api';
import {
  BAG_CATEGORIES,
  BAG_SORTS,
  type BagCategory,
  type BagFilterState,
  type BagSort,
  DEFAULT_BAG_FILTER,
  parseBagFilter,
  serializeBagFilter,
} from './bag_filter';
import {
  type BagMode,
  bagDestroyAction,
  bagItemAction,
  bagQualityKey,
  bagShiftLinks,
  bagStackIndex,
  bagTooltipHintKey,
  bankDepositOpensPrompt,
  buildBagBar,
  buildBagGrid,
  resolveDepositSubmit,
} from './bags_view';
import { itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import { FOCUSABLE_SELECTOR } from './focus_manager';
import { encodeHotbarAction, HOTBAR_ACTION_MIME } from './hotbar';
import { formatNumber, type TranslationKey, t } from './i18n';
import { iconDataUrl } from './icons';
import type { PainterHostPresentation } from './painter_host';
import { tSim } from './sim_i18n';
import { renderWindowFrame } from './window_frame';
import type { WindowFrameDescriptor } from './window_frame_view';

const BAG_FILTER_KEY = 'woc_bag_filter';

// A closable frame WITH the sticky footer: the bag bar, filter header, and slot
// grid render into the scrollable body, and the player's money lives in the
// pinned .window-footer (the classic bags anatomy). It used to sit as the last
// child of the scrollable body, where the touch sheet pushed it below the fold
// and the coin readout was effectively invisible on mobile (live maintainer
// feedback). Reuses the existing bag title + close keys. Instance-parameterized
// on the '#bags' id (title id 'bags-title').
const BAGS_FRAME: WindowFrameDescriptor = {
  id: 'bags',
  titleKey: 'itemUi.bags.title',
  closeLabelKey: 'itemUi.bags.close',
  footer: true,
};

// Monotonic id source for the ad-hoc prompt dialogs' aria-labelledby target, so the
// id never couples to class ordering (was prompt.classList[last]).
let promptDialogSeq = 0;

// The ad-hoc discard / sell / bank-deposit quantity prompts mount into #prompt-stack
// (outside #bags). A window-level close() removes any that are open so it never leaves
// an orphaned aria-modal dialog floating over the closed window (the show* paths
// already clear a prior same-type prompt with these classes).
const BAG_PROMPT_SELECTOR = '.discard-item-prompt, .sell-quantity-prompt, .bank-deposit-prompt';
// Exported for the HUD's mobile cluster-close paths (closeVendor / onBankClosed),
// which hide #bags without running close(): they must not strand a still-visible
// prompt in #prompt-stack (promptModalOpen() would keep gating game keys on it).
export function dismissBagPrompts(): void {
  for (const p of document.querySelectorAll(BAG_PROMPT_SELECTOR)) p.remove();
}

const BAG_CATEGORY_LABEL_KEYS: Record<BagCategory, TranslationKey> = {
  all: 'hudChrome.bags.filterAll',
  weapon: 'hudChrome.bags.filterWeapon',
  armor: 'hudChrome.bags.filterArmor',
  consumable: 'hudChrome.bags.filterConsumable',
  material: 'hudChrome.bags.filterMaterial',
  quest: 'hudChrome.bags.filterQuest',
};
const BAG_SORT_LABEL_KEYS: Record<BagSort, TranslationKey> = {
  recent: 'hudChrome.bags.sortRecent',
  quality: 'hudChrome.bags.sortQuality',
  name: 'hudChrome.bags.sortName',
};

/**
 * Hud-supplied glue. The icon/money/tooltip painters are the shared
 * PainterHostPresentation bag (Hud builds it once and hands it to every window that
 * renders item rows); this composes that base and adds the inventory-cluster
 * surface: the world reads, the cross-window mode flags + commands, the pet-feed /
 * drag / wallet plumbing, and the close/teardown chrome. The module never reaches
 * into Hud directly.
 */
export interface BagsWindowDeps extends PainterHostPresentation {
  /** The #bags root (Hud owns the id; the painter stays instance-parameterized). */
  root(): HTMLElement;
  /** The live world (offline Sim or online ClientWorld mirror). */
  world(): IWorld;
  /** Localized $WOC on-chain balance markup for the money footer. */
  wocBalanceHtml(): string;
  hideTooltip(): void;
  /** True when this click is the release of a long-press tooltip peek, so the
   *  stack's action (use / sell / deposit / feed) must be SUPPRESSED. Wired to the
   *  shared Hud TouchPeekGuard; a plain tap and every desktop click return false. */
  consumePeek(): boolean;
  cancelPetFeed(): void;
  // Non-modal focus capture/return (WCAG 2.4.3). Bags rides alongside vendor / trade /
  // market, so it does NOT trap focus; it only records its opener on open and returns
  // focus there on close. Wired to the FocusManager's activeFocusable / restore, NOT
  // the trap-installing windowFocus helper.
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  renderCharIfOpen(): void;
  // Cross-window mode flags (read each click so the painter never caches stale modes).
  vendorOpen(): boolean;
  tradeOpen(): boolean;
  /** The World Market is open on its Sell tab. */
  isMarketSell(): boolean;
  /** The Ravenpost mailbox is open on its Send tab (clicks attach parcels). */
  isMailAttach(): boolean;
  /** The bank window is open (docked beside the bags): a click deposits the stack. */
  isBankOpen(): boolean;
  pendingPetFeed(): boolean;
  // Cross-window commands the bag click fans out to.
  closeVendor(): void;
  /** Close the bank cluster (bank + this bags companion). On touch the bank hides
   *  its own x-btn under the pairing, so the bags x-btn is the cluster's single
   *  close control, mirroring closeVendor. */
  closeBank(): void;
  /** Fired after close() finished its teardown. The HUD uses it to undock a still
   *  open bank companion on touch (the tray/minimap bags toggle hides bags without
   *  closing the bank; dropping the docking class lets the mobile standalone
   *  full-screen rule take over instead of leaving a half-width orphan). */
  onClosed(): void;
  addItemToTrade(itemId: string): void;
  /** Stage a bag item for a Market listing (selects it + repaints the market). */
  stageMarketSell(itemId: string): void;
  /** Stage a bag stack as a mail parcel (repaints the mailbox Send tab). */
  stageMailParcel(itemId: string): void;
  /** Shift-click: insert a readable item link into the chat input. */
  insertItemChatLink(itemId: string): void;
  showError(text: string): void;
  setPendingPetFeed(active: boolean): void;
  resetPetBarSig(): void;
  // Hotbar drag plumbing (cross-window drag state lives on the HUD).
  isHotbarItemId(itemId: string): boolean;
  setDragAction(action: { type: 'item'; id: string } | null): void;
  clearActionDropTargets(): void;
}

export class BagsWindow {
  // Window-local filter state: category chips + sort + live search, persisted across
  // sessions. Pure logic lives in bag_filter.ts / bags_view.ts; this is the consumer.
  private filter: BagFilterState = (() => {
    try {
      return parseBagFilter(localStorage.getItem(BAG_FILTER_KEY));
    } catch {
      return { ...DEFAULT_BAG_FILTER };
    }
  })();

  // The element that opened the bags window, captured on open and refocused on close
  // (WCAG 2.4.3). Null when bags was opened by a pointer-driven cross-window path
  // (vendor / mobile), where a null restore is a safe no-op.
  private openerFocus: HTMLElement | null = null;

  constructor(private readonly deps: BagsWindowDeps) {}

  /** Record the element that opened the window, so close() can return focus to it.
   *  Called by the HUD's toggleBags on the keyboard/minimap open path. */
  noteOpener(): void {
    this.openerFocus = this.deps.captureFocus();
  }

  /** Hide the window and return focus to the opener. NON-MODAL: no focus trap is
   *  installed (bags is a companion of vendor / trade / market), so this is a plain
   *  capture-and-return. Preserves the inline path's tooltip + pet-feed teardown. */
  close(): void {
    const el = this.deps.root();
    // Early-return only when already hidden. Bags is shown as 'flex' (toggle / vendor) OR
    // 'block' (the pet-feed path), so guard on 'none', not a specific shown value, or a
    // 'block'-shown bags would never close.
    if (el.style.display === 'none') return;
    // A discard / sell prompt is a modal CHILD of this window (it sets #bags inert). The
    // window can be force-closed out from under it (the bags keybind fires while the
    // prompt's confirm BUTTON has focus, which input.ts does not suppress), a path that
    // never runs the prompt's dismiss(). Tear any open prompt down here so it is not left
    // an orphaned aria-modal dialog floating over the closed window, then clear the inert
    // it set: a hidden window must never stay inert or the next open shows a dead grid.
    dismissBagPrompts();
    el.style.display = 'none';
    el.inert = false;
    this.deps.hideTooltip();
    this.deps.cancelPetFeed();
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
    this.deps.onClosed();
  }

  // The window close control (wired to the shared frame's onClose). On touch the
  // vendor / bank clusters hide their LEFT panel's own close, so this bags close is
  // the whole cluster's single close control: it closes the companion window too
  // (mirroring closeVendor's / onBankClosed's teardown), never leaving a half-screen
  // orphan. Desktop and standalone touch fall through to the plain close().
  private handleClose(): void {
    if (document.body.classList.contains('mobile-touch')) {
      if (this.deps.vendorOpen()) {
        this.deps.closeVendor();
        return;
      }
      if (this.deps.isBankOpen()) {
        this.deps.closeBank();
        return;
      }
    }
    this.close();
  }

  render(): void {
    const el = this.deps.root();
    const world = this.deps.world();
    // .bag-grid (not #bags) is the scroll container; it is recreated on every
    // rebuild, so capture its scroll offset and reapply it to the fresh grid:
    // otherwise using an item (e.g. a potion) snaps the list back to the top.
    const prevScrollTop = el.querySelector('.bag-grid')?.scrollTop ?? 0;
    // Stamp the shared AAA window frame onto an INNER mount, leaving the #bags root
    // pristine (never a builder class / role / aria): the root stays the docking
    // anchor the cluster CSS targets by id, and .window:has(> .window-frame) makes it
    // the clipping flex column the frame fills. The bag bar, filter header, and slot
    // grid render into the scrollable body; the money readout is pinned in the
    // frame's sticky footer so it stays visible however far the grid scrolls.
    const mount = document.createElement('div');
    const { body, footer } = renderWindowFrame(mount, BAGS_FRAME, {
      onClose: () => this.handleClose(),
    });
    body.appendChild(this.buildBagBar());
    // Skip the chip/search row entirely when the bag is empty: a full filter bar
    // above a grid of empty squares is just noise.
    if (world.inventory.length > 0) body.appendChild(this.buildFilterBar());
    const grid = document.createElement('div');
    grid.className = 'bag-grid';
    this.fillGrid(grid);
    body.appendChild(grid);
    const moneyRow = document.createElement('div');
    moneyRow.className = 'money';
    moneyRow.innerHTML = `${this.deps.wocBalanceHtml()}${this.deps.moneyHtml(world.copper)}`;
    (footer ?? body).appendChild(moneyRow);
    el.replaceChildren(mount);
    grid.scrollTop = prevScrollTop;
  }

  // The classic bag bar: the implicit backpack, the 4 equip sockets, and the
  // used/capacity counter. Clicking an equipped bag returns it to the inventory
  // (the sim refuses when the shrunk budget cannot hold the items); a bag ITEM
  // in the grid is equipped by clicking it (bagItemAction 'equipBag').
  private buildBagBar(): HTMLElement {
    const world = this.deps.world();
    const model = buildBagBar(
      world.bags,
      world.inventory.length,
      world.bagCapacity,
      BACKPACK_SLOTS,
      (itemId) => bagSlotsOf(ITEMS[itemId]),
    );
    const bar = document.createElement('div');
    bar.className = 'bag-bar';
    // The backpack and empty sockets are informational, not actionable, but a
    // keyboard user still needs to reach their tooltip, so they are rendered as
    // focusable no-op buttons (aria-disabled, cursor default via CSS).
    const backpack = document.createElement('button');
    backpack.type = 'button';
    backpack.className = 'bag-socket backpack';
    backpack.setAttribute('aria-disabled', 'true');
    backpack.innerHTML = `<img class="item-icon q-common" src="${iconDataUrl('item', 'backpack')}" alt="" draggable="false">`;
    backpack.setAttribute(
      'aria-label',
      t('hudChrome.bags.bagSocketAria', {
        name: t('hudChrome.bags.backpack'),
        slots: t('itemUi.tooltip.bagSlots', {
          slots: formatNumber(model.backpackSlots, { maximumFractionDigits: 0 }),
        }),
      }),
    );
    this.deps.attachTooltip(
      backpack,
      () =>
        `<div class="tt-title">${esc(t('hudChrome.bags.backpack'))}</div><div class="tt-sub">${esc(t('itemUi.tooltip.bagSlots', { slots: formatNumber(model.backpackSlots, { maximumFractionDigits: 0 }) }))}</div>`,
    );
    bar.appendChild(backpack);
    for (const socket of model.sockets) {
      const item = socket.itemId ? ITEMS[socket.itemId] : undefined;
      if (item) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `bag-socket q-${bagQualityKey(item)}`;
        btn.innerHTML = this.deps.itemIcon(item);
        btn.setAttribute(
          'aria-label',
          t('hudChrome.bags.bagSocketAria', {
            name: itemDisplayName(item),
            slots: t('itemUi.tooltip.bagSlots', {
              slots: formatNumber(socket.slots, { maximumFractionDigits: 0 }),
            }),
          }),
        );
        btn.addEventListener('click', () => {
          this.deps.world().unequipBag(socket.socket);
          this.deps.hideTooltip();
          this.render();
        });
        this.deps.attachTooltip(
          btn,
          () =>
            `${this.deps.itemTooltip(item)}<div class="tt-sub">${esc(t('hudChrome.bags.unequipHint'))}</div>`,
        );
        bar.appendChild(btn);
      } else {
        const emptySocket = document.createElement('button');
        emptySocket.type = 'button';
        emptySocket.className = 'bag-socket empty';
        emptySocket.setAttribute('aria-disabled', 'true');
        emptySocket.setAttribute('aria-label', t('hudChrome.bags.socketEmpty'));
        this.deps.attachTooltip(
          emptySocket,
          () => `<div class="tt-sub">${esc(t('hudChrome.bags.socketEmpty'))}</div>`,
        );
        bar.appendChild(emptySocket);
      }
    }
    const counter = document.createElement('span');
    counter.className = `bag-capacity${model.used > model.capacity ? ' over' : ''}`;
    const fmt = (n: number): string => formatNumber(n, { maximumFractionDigits: 0 });
    counter.textContent = t('hudChrome.bags.capacity', {
      used: fmt(model.used),
      total: fmt(model.capacity),
    });
    counter.setAttribute(
      'aria-label',
      t('hudChrome.bags.capacityAria', { used: fmt(model.used), total: fmt(model.capacity) }),
    );
    bar.appendChild(counter);
    return bar;
  }

  private persistFilter(): void {
    try {
      localStorage.setItem(BAG_FILTER_KEY, serializeBagFilter(this.filter));
    } catch {
      /* storage unavailable (private mode); filter still works in-session */
    }
  }

  // The category-chip + sort + search controls above the bag grid. Each control
  // mutates this.filter, persists, and re-renders; the actual filtering is the pure
  // buildBagGrid() in bags_view.ts (which reuses bag_filter.ts).
  private buildFilterBar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'bag-filter-bar';

    const chips = document.createElement('div');
    chips.className = 'filter-row';
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', t('hudChrome.bags.filterGroupAria'));
    for (const category of BAG_CATEGORIES) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = t(BAG_CATEGORY_LABEL_KEYS[category]);
      chip.setAttribute('aria-pressed', this.filter.category === category ? 'true' : 'false');
      chip.addEventListener('click', () => {
        if (this.filter.category === category) return;
        this.filter.category = category;
        this.persistFilter();
        audio.click();
        this.render();
      });
      chips.appendChild(chip);
    }
    bar.appendChild(chips);

    const tools = document.createElement('div');
    tools.className = 'bag-tools';

    const searchField = document.createElement('div');
    searchField.className = 'search-field';
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'bag-search';
    search.placeholder = t('hudChrome.bags.searchPlaceholder');
    search.setAttribute('aria-label', t('hudChrome.bags.searchAria'));
    search.value = this.filter.search;
    search.addEventListener('input', () => {
      this.filter.search = search.value;
      this.persistFilter();
      this.refreshGrid();
    });
    searchField.appendChild(search);
    tools.appendChild(searchField);

    const sort = document.createElement('select');
    sort.className = 'bag-sort';
    sort.setAttribute('aria-label', t('hudChrome.bags.sortAria'));
    for (const option of BAG_SORTS) {
      const opt = document.createElement('option');
      opt.value = option;
      opt.textContent = t(BAG_SORT_LABEL_KEYS[option]);
      if (this.filter.sort === option) opt.selected = true;
      sort.appendChild(opt);
    }
    sort.addEventListener('change', () => {
      this.filter.sort = sort.value as BagSort;
      this.persistFilter();
      audio.click();
      this.render();
    });
    tools.appendChild(sort);

    bar.appendChild(tools);
    return bar;
  }

  // Populate (or repopulate) the .bag-grid scroll container from the current filter
  // state. Split out so a search keystroke can refresh just the grid (refreshGrid)
  // without rebuilding the filter bar and stealing input focus.
  private fillGrid(grid: HTMLElement): void {
    const world = this.deps.world();
    const model = buildBagGrid(world.inventory, (id) => ITEMS[id], this.filter, world.bagCapacity);
    if (model.state === 'empty') {
      grid.innerHTML = `<div class="empty-state">${esc(t('itemUi.bags.empty'))}</div>`;
      return;
    }
    if (model.state === 'noMatch') {
      grid.innerHTML = `<div class="empty-state">${esc(t('hudChrome.bags.noMatch'))}</div>`;
      return;
    }
    for (const s of model.visible) {
      const item = ITEMS[s.itemId];
      if (!item) continue;
      const row = document.createElement('button');
      row.type = 'button';
      // AAA item-cell grammar: rarity border from the quality tokens via
      // data-quality (no painter-set colour prop), the stack count in the corner,
      // and the shared focus ring (components.css .window-frame .item-cell).
      row.className = 'item-cell';
      row.setAttribute('data-quality', bagQualityKey(item));
      const itemName = itemDisplayName(item);
      row.setAttribute(
        'aria-label',
        t('itemUi.bags.itemAria', {
          item: itemName,
          count: formatNumber(s.count, { maximumFractionDigits: 0 }),
        }),
      );
      row.innerHTML = `${this.deps.itemIcon(item)}${s.count > 1 ? `<span class="item-cell-count">${esc(t('itemUi.bags.stackCount', { count: formatNumber(s.count, { maximumFractionDigits: 0 }) }))}</span>` : ''}`;
      row.addEventListener('click', (ev) => {
        // On touch, the click that ends a long-press peek inspects the stack (its
        // tooltip is already shown) instead of running its action (use / sell /
        // deposit / feed): the release dismisses the tooltip and fires nothing. A
        // plain tap / desktop click falls through.
        if (this.deps.consumePeek()) {
          this.deps.hideTooltip();
          return;
        }
        if (ev.shiftKey && bagShiftLinks(this.bagMode())) {
          this.deps.insertItemChatLink(s.itemId);
          return;
        }
        const action = bagItemAction(item, this.bagMode());
        switch (action) {
          case 'transferBlockedSoulbound':
            this.deps.showError(t('hudChrome.itemSoulbound'));
            return;
          case 'trade':
            this.deps.addItemToTrade(s.itemId);
            break;
          case 'mailAttachBlocked':
            this.deps.showError(t('hudChrome.mailbox.cannotMail'));
            return;
          case 'mailAttach':
            this.deps.stageMailParcel(s.itemId);
            break;
          case 'marketSellBlockedQuest':
            this.deps.showError(t('itemUi.errors.noQuestItems'));
            return;
          case 'marketSellBlockedNoMarket':
            this.deps.showError(t('itemUi.tooltip.cannotMarket'));
            return;
          case 'marketSell':
            this.deps.stageMarketSell(s.itemId);
            break;
          case 'vendorSell':
            this.sellBagItem(s, ev);
            break;
          case 'bankDeposit': {
            // The command is inventory-index-based, so resolve the exact clicked stack
            // by reference (duplicate stacks / distinct instanced copies share an
            // itemId); a stale click whose stack already left the bags is a no-op.
            const index = bagStackIndex(this.deps.world().inventory, s);
            if (index < 0) break;
            if (ev.shiftKey && bankDepositOpensPrompt(s)) {
              this.showDepositQuantityPrompt(index, s, Math.max(1, Math.floor(s.count)));
            } else {
              // Whole-stack deposit (omitted count); an instanced slot always moves whole.
              this.deps.world().bankDeposit(index);
              this.deps.hideTooltip();
              // Bank ops emit no client repaint event and the bags grid has no per-frame
              // refresh (only the bank grid does), so repaint here like the use / equip
              // local-action cases, not a bespoke path.
              this.render();
            }
            break;
          }
          case 'bankDepositBlockedQuest':
            // The sim would refuse this ('You cannot store quest items in the bank.');
            // pre-empt with the same deny wording via its established sim key (rendered
            // through the shared showError pipe), and send nothing.
            this.deps.showError(tSim('error.bankQuestItem'));
            return;
          case 'petFeedBlocked':
            this.deps.showError(t('hud.pet.petEatsFoodOnly'));
            return;
          case 'petFeed':
            this.deps.world().feedPet(s.itemId);
            this.deps.setPendingPetFeed(false);
            this.deps.resetPetBarSig();
            this.render();
            break;
          case 'discardQuest':
            this.showDiscardItemPrompt(s.itemId, Math.max(1, Math.floor(s.count)));
            break;
          case 'equipBag':
            this.deps.world().equipBag(s.itemId);
            this.deps.hideTooltip();
            this.render();
            break;
          case 'use':
            this.deps.world().useItem(s.itemId);
            this.render();
            this.deps.renderCharIfOpen();
            break;
        }
      });
      row.addEventListener('contextmenu', (ev) => {
        // A touch long-press belongs to the tooltip peek (the TouchPeekGuard
        // family): Chromium synthesizes contextmenu at ~500ms on a touch hold,
        // beating the 950ms peek timer, so a touch-sourced right-click inspects
        // and never sells or destroys. Desktop mouse right-click keeps both
        // affordances; an undefined pointerType on a mobile-touch device fails
        // safe to inspect (Firefox Android fires contextmenu as a MouseEvent).
        const pointerType = (ev as PointerEvent).pointerType;
        if (
          pointerType === 'touch' ||
          pointerType === 'pen' ||
          (document.body.classList.contains('mobile-touch') && pointerType !== 'mouse')
        ) {
          ev.preventDefault();
          return;
        }
        // At a vendor, Ctrl/Meta right-click owns the split-stack sell prompt.
        if (this.deps.vendorOpen()) {
          if (!ev.ctrlKey && !ev.metaKey) return;
          ev.preventDefault();
          this.sellBagItem(s, ev);
          return;
        }
        // Otherwise right-click destroys the item, reusing the quest-item destroy
        // prompt (confirm + quantity). noDiscard items stay protected (issue 1501).
        const destroy = bagDestroyAction(item, this.bagMode());
        if (destroy === 'none') return;
        ev.preventDefault();
        if (destroy === 'discardBlocked') {
          this.deps.showError(t('hudChrome.bags.cannotDestroy'));
          return;
        }
        this.showDiscardItemPrompt(s.itemId, Math.max(1, Math.floor(s.count)));
      });
      if (!this.deps.tradeOpen() && !this.deps.vendorOpen() && this.deps.isHotbarItemId(s.itemId)) {
        row.draggable = true;
        row.addEventListener('dragstart', (e) => {
          const action = { type: 'item' as const, id: s.itemId };
          this.deps.setDragAction(action);
          this.writeDraggedAction(e.dataTransfer, action);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
          this.deps.hideTooltip();
        });
        row.addEventListener('dragend', () => {
          this.deps.setDragAction(null);
          this.deps.clearActionDropTargets();
        });
      }
      this.deps.attachTooltip(row, () => {
        const mode = this.bagMode();
        const key = bagTooltipHintKey(item, mode);
        const extra = key ? `<div class="tt-sub">${esc(t(key))}</div>` : '';
        // Advertise the shift-click partial deposit on a splittable stack, the bank
        // window's withdrawPartialHint twin (tied to the deposit hint arm so a
        // blocked quest item never shows it).
        const partial =
          key === 'hudChrome.bank.depositHint' && bankDepositOpensPrompt(s)
            ? `<div class="tt-sub">${esc(t('hudChrome.bank.depositPartialHint'))}</div>`
            : '';
        // Advertise the right-click destroy affordance (issue 1501) only when the item is
        // actually destroyable here, so junk items are discoverable without a menu.
        const destroy =
          bagDestroyAction(item, mode) === 'discard'
            ? `<div class="tt-sub">${esc(t('hudChrome.bags.rightClickDestroy'))}</div>`
            : '';
        const link = bagShiftLinks(mode)
          ? `<div class="tt-sub">${esc(t('hudChrome.itemShare.linkHint'))}</div>`
          : '';
        return this.deps.itemTooltip(item) + extra + partial + destroy + link;
      });
      grid.appendChild(row);
    }
    // Free-slot squares (unfiltered view only): the classic empty sockets that
    // make the remaining capacity visible at a glance. Decorative, not focusable
    // (an .is-empty item-cell with no data-quality and no tab stop).
    for (let i = 0; i < model.emptyCells; i++) {
      const cell = document.createElement('div');
      cell.className = 'item-cell is-empty';
      cell.setAttribute('aria-hidden', 'true');
      grid.appendChild(cell);
    }
  }

  // Refresh only the grid contents (used by live search) so the search input keeps
  // focus and caret position across keystrokes.
  private refreshGrid(): void {
    const grid = this.deps.root().querySelector('.bag-grid') as HTMLElement | null;
    if (!grid) return;
    const prevScrollTop = grid.scrollTop;
    grid.innerHTML = '';
    this.fillGrid(grid);
    grid.scrollTop = prevScrollTop;
  }

  // The current open-window modes that change what a bag click does. Cross-window
  // state lives on the HUD; the painter reads it through the deps each click so it
  // never caches stale modes.
  private bagMode(): BagMode {
    return {
      tradeOpen: this.deps.tradeOpen(),
      mailAttach: this.deps.isMailAttach(),
      marketSell: this.deps.isMarketSell(),
      vendorOpen: this.deps.vendorOpen(),
      bankDeposit: this.deps.isBankOpen(),
      petFeed: this.deps.pendingPetFeed(),
    };
  }

  private sellBagItem(slot: InvSlot, ev: MouseEvent): void {
    const count = Math.max(1, Math.floor(slot.count));
    if (ev.ctrlKey || ev.metaKey) {
      this.deps.world().sellItem(slot.itemId, count);
    } else if (ev.shiftKey && count > 1) {
      this.showSellQuantityPrompt(slot.itemId, count);
    } else {
      this.deps.world().sellItem(slot.itemId);
    }
  }

  // WCAG 2.2 AA: the ad-hoc bag prompts (discard / sell quantity) are modal
  // dialogs but carried no role/name, no keyboard trap, and no focus return. This wires
  // role=dialog + aria-modal + aria-labelledby (the prompt text), a self-contained Tab
  // cycle among the prompt's controls (these prompts are appended to #prompt-stack,
  // outside the bag window's reach, so they own their own trap), an Escape close, and
  // focus return to the element that opened the prompt. Returns a close-and-return fn.
  private installPromptDialog(
    prompt: HTMLElement,
    opener: HTMLElement | null,
    close: () => void,
  ): { dismiss: () => void; dismissAndReturn: () => void } {
    prompt.setAttribute('role', 'dialog');
    prompt.setAttribute('aria-modal', 'true');
    // Mark the bag grid behind the modal prompt inert while it is open, so a screen
    // reader / Tab cannot reach the now-blocked inventory underneath. EVERY prompt
    // teardown path (confirm/submit, cancel, Escape) routes through dismiss(), which
    // clears inert before the prompt is removed; and if the bags window itself is
    // force-closed out from under an open prompt, close() clears inert as a teardown
    // backstop, so #bags is never left inert while hidden. The focus-returning variant
    // clears inert BEFORE refocusing (a focus into a still-inert subtree is silently
    // dropped, and the openers live inside #bags). This single chokepoint covers BOTH the
    // discard and sell prompts.
    const bagsRoot = this.deps.root();
    bagsRoot.inert = true;
    const titleEl = prompt.querySelector('.prompt-text') as HTMLElement | null;
    if (titleEl) {
      if (!titleEl.id) titleEl.id = `bags-prompt-title-${promptDialogSeq++}`;
      prompt.setAttribute('aria-labelledby', titleEl.id);
      // Name an unlabeled quantity field by the prompt's own question (the same titled
      // text, e.g. "Destroy how many Linen Cloth?") so a number input is never anonymous
      // (WCAG 1.3.1 / 4.1.2). The discard prompt's input had no name (the new bags axe
      // case caught it); the sell prompt's input already carries a dedicated aria-label,
      // so leave that one alone (aria-labelledby would otherwise shadow the better name).
      const numInput = prompt.querySelector('.prompt-number');
      if (numInput && !numInput.hasAttribute('aria-label')) {
        numInput.setAttribute('aria-labelledby', titleEl.id);
      }
    }
    // Clear inert THEN remove the prompt; the only teardown both the confirm and the
    // cancel paths share, so routing every close through it guarantees inert never leaks.
    const dismiss = (): void => {
      bagsRoot.inert = false;
      close();
    };
    const dismissAndReturn = (): void => {
      dismiss();
      opener?.focus();
    };
    prompt.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      // Escape: stopPropagation, not just preventDefault. The input layer's
      // window-level keydown runs the global escape action (closeAll) regardless of
      // defaultPrevented, and prompt BUTTONS are not tag-exempt like inputs, so
      // without it one keypress dismisses the prompt AND closes the whole window.
      if (ke.key === 'Escape') {
        ke.preventDefault();
        ke.stopPropagation();
        dismissAndReturn();
        return;
      }
      // Enter / Space: stopPropagation for the same reason, keeping the default so
      // native activation (Enter/Space on the confirm and cancel buttons) survives.
      // A submit handler on the quantity input runs at the target phase and removes
      // the prompt DURING this keydown, so a window-level gate keyed on the prompt's
      // presence runs too late: without the stop, the same press hits the global
      // chat/jump bind and steals the WCAG 2.4.3 focus return. The event path is
      // fixed at dispatch, so this listener still runs after the detach; only THEN
      // cancel the default too, or the browser runs the key's activation against
      // the freshly re-landed focus (Enter ghost-clicking [data-window-close] and closing
      // the whole window).
      if (ke.key === 'Enter' || ke.key === ' ' || ke.code === 'Space') {
        ke.stopPropagation();
        if (!prompt.isConnected) ke.preventDefault();
        return;
      }
      if (ke.key !== 'Tab') return;
      // Reuse the one canonical focusable set so a prompt that ever
      // gains an [href] / [tabindex] control stays inside the trap.
      const f = Array.from(prompt.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (f.length === 0) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (ke.shiftKey && document.activeElement === first) {
        ke.preventDefault();
        last.focus();
      } else if (!ke.shiftKey && document.activeElement === last) {
        ke.preventDefault();
        first.focus();
      }
    });
    return { dismiss, dismissAndReturn };
  }

  private showDiscardItemPrompt(itemId: string, maxCount: number): void {
    document.querySelectorAll('.discard-item-prompt').forEach((el) => {
      el.remove();
    });
    const opener = document.activeElement as HTMLElement | null;
    const item = ITEMS[itemId];
    const stack = document.getElementById('prompt-stack');
    if (!stack) return;
    const prompt = document.createElement('div');
    prompt.className = 'prompt panel discard-item-prompt';
    const itemName = item ? itemDisplayName(item) : itemId;
    prompt.innerHTML = `<div class="prompt-text">${esc(t('itemUi.bags.destroyTitle', { item: itemName }))}</div>`;
    let input: HTMLInputElement | null = null;
    if (maxCount > 1) {
      input = document.createElement('input');
      input.className = 'prompt-number';
      input.type = 'number';
      input.min = '1';
      input.max = String(maxCount);
      input.step = '1';
      input.value = '1';
      prompt.appendChild(input);
    }
    const confirm = document.createElement('button');
    confirm.className = 'btn';
    confirm.textContent = t('itemUi.bags.destroyConfirm');
    const cancel = document.createElement('button');
    cancel.className = 'btn';
    cancel.textContent = t('itemUi.bags.destroyCancel');
    const close = () => prompt.remove();
    prompt.append(confirm, cancel);
    const { dismiss, dismissAndReturn } = this.installPromptDialog(prompt, opener, close);
    const submit = () => {
      const count = input
        ? Math.max(1, Math.min(maxCount, Math.floor(Number(input.value) || 0)))
        : 1;
      this.deps.world().discardItem(itemId, count);
      dismiss();
      this.deps.hideTooltip();
      this.render();
      // Return focus into the bags window on the confirm path too (WCAG 2.4.3): cancel
      // and Escape return via dismissAndReturn, but render() innerHTML-rebuilds the grid,
      // detaching the opener slot, so land on the always-present window close button
      // rather than letting focus fall to <body>. dismiss() cleared inert first, so this
      // focus is not dropped into a still-inert subtree.
      (this.deps.root().querySelector('[data-window-close]') as HTMLElement | null)?.focus();
    };
    confirm.addEventListener('click', submit);
    cancel.addEventListener('click', dismissAndReturn);
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit();
      });
    }
    stack.appendChild(prompt);
    // Move focus into the modal: the quantity input when present, else the confirm
    // button, so a keyboard user is never left outside the prompt.
    window.setTimeout(() => {
      if (input) {
        input.focus();
        input.select();
      } else {
        confirm.focus();
      }
    }, 0);
  }

  private showSellQuantityPrompt(itemId: string, maxCount: number): void {
    document.querySelectorAll('.sell-quantity-prompt').forEach((el) => {
      el.remove();
    });
    const opener = document.activeElement as HTMLElement | null;
    const item = ITEMS[itemId];
    const stack = document.getElementById('prompt-stack');
    if (!stack) return;
    const prompt = document.createElement('div');
    prompt.className = 'prompt panel sell-quantity-prompt';
    const itemName = item ? itemDisplayName(item) : itemId;
    prompt.innerHTML = `<div class="prompt-text">${esc(t('itemUi.vendor.sellQuantityTitle', { item: itemName }))}</div>`;
    const input = document.createElement('input');
    input.className = 'prompt-number';
    input.type = 'number';
    input.setAttribute('aria-label', t('itemUi.vendor.sellQuantityInput'));
    input.min = '1';
    input.max = String(maxCount);
    input.step = '1';
    input.value = '1';
    const confirm = document.createElement('button');
    confirm.className = 'btn';
    confirm.textContent = t('itemUi.vendor.sellQuantityConfirm');
    const cancel = document.createElement('button');
    cancel.className = 'btn';
    cancel.textContent = t('itemUi.vendor.sellQuantityCancel');
    const close = () => prompt.remove();
    prompt.append(input, confirm, cancel);
    const { dismiss, dismissAndReturn } = this.installPromptDialog(prompt, opener, close);
    const submit = () => {
      const count = Math.max(1, Math.min(maxCount, Math.floor(Number(input.value) || 0)));
      this.deps.world().sellItem(itemId, count);
      dismiss();
      // Return focus to the vendor cell that opened the prompt on confirm too (WCAG
      // 2.4.3): it survives the sell, so unlike discard there is no rebuild to dodge
      // (cancel and Escape return via dismissAndReturn). dismiss() cleared inert first.
      opener?.focus();
    };
    confirm.addEventListener('click', submit);
    cancel.addEventListener('click', dismissAndReturn);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    stack.appendChild(prompt);
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

  // The partial-deposit prompt (shift-click a splittable stack while the bank is
  // open), cloned from the QA-hardened bank withdraw prompt: index-based, and AT
  // SUBMIT it re-resolves the live slot and refuses on an itemId mismatch (the bags
  // can repaint under the open prompt) while clamping the count to the live stack.
  // Reuses this window's installPromptDialog (role/aria-modal/aria-labelledby, the
  // Tab cycle, Escape preventDefault+stopPropagation, the #bags inert set/clear, and
  // focus return) and the shared prompt cancel label.
  private showDepositQuantityPrompt(index: number, captured: InvSlot, maxCount: number): void {
    dismissBagPrompts();
    const opener = document.activeElement as HTMLElement | null;
    const item = ITEMS[captured.itemId];
    const stack = document.getElementById('prompt-stack');
    if (!stack) return;
    const prompt = document.createElement('div');
    prompt.className = 'prompt panel bank-deposit-prompt';
    const itemName = item ? itemDisplayName(item) : captured.itemId;
    prompt.innerHTML = `<div class="prompt-text">${esc(t('hudChrome.bank.depositQuantityTitle', { item: itemName }))}</div>`;
    const input = document.createElement('input');
    input.className = 'prompt-number';
    input.type = 'number';
    input.setAttribute('aria-label', t('hudChrome.bank.depositQuantityInput'));
    input.min = '1';
    input.max = String(maxCount);
    input.step = '1';
    input.value = '1';
    const confirm = document.createElement('button');
    confirm.className = 'btn';
    confirm.textContent = t('hudChrome.bank.depositQuantityConfirm');
    const cancel = document.createElement('button');
    cancel.className = 'btn';
    cancel.textContent = t('itemUi.vendor.sellQuantityCancel');
    const close = () => prompt.remove();
    prompt.append(input, confirm, cancel);
    const { dismiss, dismissAndReturn } = this.installPromptDialog(prompt, opener, close);
    const submit = () => {
      // Re-resolve the live slot at the captured index: depositing the WRONG item
      // (the bags repainted under the prompt) is worse than dismissing. resolveDepositSubmit
      // returns null to refuse on a mismatch, else the count clamped to the live stack.
      const live = this.deps.world().inventory[index];
      const count = resolveDepositSubmit(live, captured, Number(input.value) || 0, maxCount);
      if (count === null) {
        dismiss();
        (this.deps.root().querySelector('[data-window-close]') as HTMLElement | null)?.focus();
        return;
      }
      this.deps.world().bankDeposit(index, count);
      dismiss();
      this.deps.hideTooltip();
      // render() rebuilds the grid, detaching the opener slot, so land focus on the
      // always-present close button rather than dropping it to <body>. dismiss()
      // cleared inert first, so this focus is not lost into a still-inert subtree.
      this.render();
      (this.deps.root().querySelector('[data-window-close]') as HTMLElement | null)?.focus();
    };
    confirm.addEventListener('click', submit);
    cancel.addEventListener('click', dismissAndReturn);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    stack.appendChild(prompt);
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

  // Write the dragged item onto the DataTransfer (reproduced from the exported
  // hotbar encoder so cross-window drag state stays on the HUD via the deps).
  private writeDraggedAction(dt: DataTransfer | null, action: { type: 'item'; id: string }): void {
    if (!dt) return;
    dt.setData(HOTBAR_ACTION_MIME, encodeHotbarAction(action));
    dt.setData('text/plain', action.id);
  }
}
