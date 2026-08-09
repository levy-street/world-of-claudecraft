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
// No raw hex: the item-quality color comes from the shared
// QUALITY_COLOR map, and the unranked fallback is the --color-quality-default token
// (not a literal white hex).

import { audio } from '../game/audio';
import { BACKPACK_SLOTS, bagSlotsOf } from '../sim/bags';
import { ITEMS, QUESTS } from '../sim/data';
import { FIREBOTTLE_COOLDOWN_SECS, FIREBOTTLE_ITEM_ID } from '../sim/interactions/firebottle_hut';
import type { EquipSlot, InvSlot, ItemDef, ItemInstancePayload } from '../sim/types';
import type { IWorld } from '../world_api';
import { bagCornerMark, bagRimClasses } from './bag_corner_mark_view';
import {
  BAG_CATEGORIES,
  BAG_SORTS,
  type BagCategory,
  type BagFilterState,
  type BagSort,
  bagOrderIsManual,
  bagQuestItemCount,
  DEFAULT_BAG_FILTER,
  parseBagFilter,
  serializeBagFilter,
} from './bag_filter';
import { bagFineMark } from './bag_fine_mark_view';
import { bagInstanceGlyphKind } from './bag_instance_glyph_view';
import { bagItemHasContextActions } from './bag_item_context_menu';
import { bagQuestMarkKind, bagQuestMarkProgressFromLog } from './bag_quest_mark_view';
import { BagQuestTrackerHighlight } from './bag_quest_tracker_highlight';
import { bagQuestTrackerHighlightId } from './bag_quest_tracker_highlight_view';
import {
  type BagDestroyAction,
  type BagMode,
  bagDestroyAction,
  bagItemAction,
  bagNoMatchKind,
  bagQualityKey,
  bagShiftLinks,
  bagSortSignature,
  bagStackIndex,
  bagsMoneyRowStale,
  bagTooltipHintKey,
  bagUnknownAction,
  bankDepositOpensPrompt,
  buildBagBar,
  buildBagGrid,
  buildBagListRows,
  resolveDepositSubmit,
} from './bags_view';
import { showQuantityPrompt } from './bank_quantity_prompt';
import { markDialogRoot } from './dialog_root';
import { itemDisplayName } from './entity_i18n';
import { isPaperdollDraggable } from './equip_drop_core';
import { esc } from './esc';
import { captureFocusKey, focusedWithin, restoreFirstEnabled } from './focus_restore';
import { encodeHotbarAction, HOTBAR_ACTION_MIME } from './hud/action_bar/hotbar';
import { formatNumber, type TranslationKey, t } from './i18n';
import { iconDataUrl, QUALITY_COLOR } from './icons';
import type { BagItemDrag, ItemDragState } from './item_drag_state';
import { resolveDropTargetAt } from './item_drop_hit_test';
import {
  cornerMarkHtml,
  INSTANCE_GLYPH_ARIA_KEYS,
  instanceGlyphMarkHtml,
  UNKNOWN_INSTANCE_GLYPH_ARIA_KEYS,
} from './item_instance_glyph_mark';
import { knownItemDef } from './known_item';
import type { PainterHostPresentation } from './painter_host';
import {
  installPromptDialog as installModalPromptDialog,
  type PromptDialogHandle,
} from './prompt_dialog';
import { tSim } from './sim_i18n';
import { bindTouchItemDrag } from './touch_item_drag';
import { svgIcon } from './ui_icons';
import { unknownItemIconHtml } from './unknown_item_icon';
import { totalHeldCount } from './vendor_sell_quantity';
import { dropOnWorld } from './world_drop_target';

const BAG_FILTER_KEY = 'woc_bag_filter';

// Sort settle ripple: how long an armed settle waits for the tidied grid to
// arrive before giving up (the bank deposit status timeout-backstop pattern:
// a no-op sort on an already-tidy bag must not stay armed forever), and the
// per-cell stagger cap that keeps a full 72-cell bag inside half a second.
const SORT_SETTLE_MS = 3000;
const SORT_SETTLE_STAGGER_CAP = 20;

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

// The unranked quality fallback as a CSS custom property. The shared
// QUALITY_COLOR map carries the real per-quality hex; this token covers the rare
// item with no quality field, so no raw hex lives in the painter.
const QUALITY_DEFAULT_COLOR = 'var(--color-quality-default)';

// Per-copy aria keys and corner-mark HTML live in item_instance_glyph_mark.ts
// so bags, bank, and guild bank paint the same masterwork seal / glyphs. Quest
// stacks still use itemAriaQuest here (purpose class outranks copy flags for
// the spoken name; the rim/wash always marks them as quest for sighted players).
// Fine-grade stacks deliberately have NO dedicated aria key: every fine id's
// item NAME already carries the grade word in every locale (Fine Copper Ore),
// so a grade arm would announce it twice while costing an instanced fine copy
// its per-copy flag (bound is the flag a player checks before trading). The
// rim/wash/seal are salience for sighted scanning, not new information.

const BAG_CATEGORY_LABEL_KEYS: Record<BagCategory, TranslationKey> = {
  all: 'hudChrome.bags.filterAll',
  weapon: 'hudChrome.bags.filterWeapon',
  armor: 'hudChrome.bags.filterArmor',
  consumable: 'hudChrome.bags.filterConsumable',
  material: 'hudChrome.bags.filterMaterial',
  tool: 'hudChrome.bags.filterTool',
  quest: 'hudChrome.bags.filterQuest',
  mount: 'hudChrome.bags.filterMount',
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
  /** Localized launcher for the Claudium store, empty when the feature is not available. */
  claudiumLauncherHtml(): string;
  openClaudium(): void;
  openWallet(): void;
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
  /** The bank window is open (docked beside the bags): the mobile close arm
   *  collapses the whole cluster through it. NOT the deposit predicate, which
   *  is isPersonalBankTab below. */
  isBankOpen(): boolean;
  /** The bank window is open ON ITS PERSONAL TAB: a click deposits the stack.
   *  Open-and-not-guild is NOT the same test: while the guild pane's Log view
   *  shows, the personal grid is off screen too, so neither deposit is armed. */
  isPersonalBankTab(): boolean;
  /** The bank window is open ON ITS GUILD TAB: a click deposits into the guild
   *  bank instead (officer-plus only; the tab exists only while guildBankInfo
   *  is non-null, so this can never be true for a member or offline). */
  isGuildBankTab(): boolean;
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
  /** Stage a bag item for a Market listing (selects it + repaints the market).
   *  `instance` is the clicked slot's payload (issue 1165): an instanced copy stages
   *  as ITSELF (single-copy listing), a plain stack stages fungibly. */
  stageMarketSell(itemId: string, instance?: ItemInstancePayload): void;
  /** Stage a bag stack as a mail parcel (repaints the mailbox Send tab).
   *  `instance` mirrors stageMarketSell: an instanced copy stages as itself. */
  stageMailParcel(itemId: string, instance?: ItemInstancePayload): void;
  /** Shift-click: insert a readable item link into the chat input. */
  insertItemChatLink(itemId: string): void;
  /** Surface a deps-owned error toast (reins-use denials and drag rejects). */
  showError(text: string): void;
  setPendingPetFeed(active: boolean): void;
  resetPetBarSig(): void;
  /** Gathering-tool click routing (#2343): true when the interact-style
   *  handler consumed the use (nearest matching node + autorun stop); false
   *  falls back to the plain useItem command. */
  useGatherTool(item: ItemDef): boolean;
  // Hotbar drag plumbing (cross-window drag state lives on the HUD).
  isHotbarItemId(itemId: string): boolean;
  setDragAction(action: { type: 'item'; id: string } | null): void;
  clearActionDropTargets(): void;
  /** The shared in-flight bag-item drag every drop target reads (paperdoll socket,
   *  world canvas). Hud owns the single instance. */
  dragState: ItemDragState;
  /** True on the touch HUD: the pointer drag replaces HTML5 drag-and-drop there. */
  isTouchHud(): boolean;
  /** Light up (or clear) the paperdoll sockets that accept the stack in flight, so
   *  the drag advertises where it can land. Cleared on every drag teardown. */
  markEquipDropTargets(itemId: string | null): void;
  /** Equip a touch-dragged stack into the socket it was released on. The character
   *  window owns the paperdoll drop (and its refusals); this is the touch arm's way
   *  in, since a finger release has no drop event to land on that window. */
  dropOnEquipSlot(itemId: string, slot: EquipSlot, target?: { slotIndex: number }): void;
  /** Place a touch-dragged stack on a hotbar seat (the desktop drop's item
   *  branch, reached by finger): `slot` is the 1-based bar slot a desktop
   *  row button stamps. The HUD owns eligibility (isHotbarItemId) and the
   *  layout write; an ineligible item is a silent cancel, the desktop rule. */
  dropOnActionSlot(itemId: string, slot: number): void;
  /** Same, released over a mobile action-ring button: `ringIndex` is the
   *  RING position; the HUD resolves the underlying bar slot from the live
   *  page at drop time (the paged-ring mapping is HUD state). */
  dropOnActionRingSlot(itemId: string, ringIndex: number): void;
  /** Open the bag-item action menu (Disenchant / Salvage / Apply Enchant)
   *  for a stack at a viewport point. `runDefault` runs the exact classic
   *  left-click action for the clicked slot, so the menu's first row stays
   *  byte-identical to a plain click. */
  openItemActionMenu(
    def: ItemDef,
    itemId: string,
    slotIndex: number,
    x: number,
    y: number,
    runDefault: () => void,
  ): void;
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

  // Set when a touch drag completed on a bag row: the synthetic click the release
  // fires must not ALSO run the row's action (drag a potion to the paperdoll and it
  // would otherwise be drunk on release). One flag: only one drag can be live.
  private suppressNextClick = false;

  // The element that opened the bags window, captured on open and refocused on close
  // (WCAG 2.4.3). Null when bags was opened by a pointer-driven cross-window path
  // (vendor / mobile), where a null restore is a safe no-op.
  private openerFocus: HTMLElement | null = null;

  // The purse as of the last money-row paint (issue #2373), re-armed by every paint
  // whatever caused it. -1 is the cold sentinel: a real purse is never negative, so
  // a window shown without a paint would always converge on the first probe.
  private lastMoneyCopper = -1;

  // Bag hover/focus -> quest-tracker title highlight. One active row at a time;
  // cleared on leave/focusout, programmatic tooltip hide, rebuild, and close so
  // a stale class never sticks after the cell is torn down.
  private readonly trackerHighlight = new BagQuestTrackerHighlight(document);

  // One-shot sort settle animation. Armed by the sort button; the NEXT grid
  // paint whose INVENTORY signature (bagSortSignature: id, count, cell hint)
  // differs from the PRESS-TIME baseline plays the CSS settle ripple and
  // disarms. Keyed on the inventory rather than the painted grid because the
  // press both resets an active filter (a shape switch that is not a sort
  // effect) and, online, repaints the still-unsorted mirror first: the tidied
  // inventory only lands with the heavy self snapshot. Comparing against the
  // baseline (not the previous paint) keeps intermediate paints, or a close
  // and reopen inside the window, from shifting what "changed" means. A
  // timestamp backstop (SORT_SETTLE_MS) keeps a no-op sort (already tidy)
  // from arming forever.
  private sortSettleArmedAt = 0;
  private lastSortBaseline = '';

  constructor(private readonly deps: BagsWindowDeps) {}

  private armSortSettle(): void {
    this.sortSettleArmedAt = performance.now();
    // Captured BEFORE the sort command runs (offline the sim mutates
    // synchronously on the same call stack as the click handler).
    this.lastSortBaseline = bagSortSignature(this.deps.world().inventory);
  }

  /**
   * Repaint the money row when the purse moved, the staleness contract this window
   * owns (issue #2373). Joins the refreshIfChanged family the HUD's slow band drives
   * (bank / mailbox / market / social / deeds / professions / calendar), so the
   * coordinator stays a one-line consumer.
   *
   * Deliberately NOT a full render(): nothing else inside #bags reads copper, and a
   * rebuild would tear down the hovered row's tooltip, the bag-search caret and an
   * armed touch drag. This edge fires from a server credit or a coin-only mob loot
   * with no user action behind it, so unlike the user-initiated paint paths it must
   * not move anything the player is holding. Same reason refreshGrid() exists for
   * live search.
   */
  refreshIfChanged(): void {
    const el = this.deps.root();
    if (!bagsMoneyRowStale(el.style.display, this.deps.world().copper, this.lastMoneyCopper))
      return;
    this.refreshMoneyRow();
  }

  /** Rewrite ONLY the .money footer in place, re-binding its two launchers. Every
   *  paint path runs through here (the full render(), the purse probe, and the async
   *  $WOC / Claudium balance reads), so the latch arms on all of them.
   *
   *  Deliberately does NOT restore focus across the rewrite, unlike the
   *  deeds/professions refocus family. Two reasons, both settled on PR #2377: the
   *  footer's launchers are BUTTONs, and input.ts leaves a focused button's Enter
   *  default alone on the chat edge, so parking focus back on one makes the player's
   *  next Enter open chat AND re-fire the button; and #bags is non-modal and absent
   *  from isModalOpen(), so canUseGameKeys() stays true and Tab is swallowed by
   *  target-nearest, which means keyboard focus never lands in here to begin with. */
  private paintMoneyRow(row: HTMLElement, copper: number): void {
    row.innerHTML = `${this.deps.wocBalanceHtml()}${this.deps.claudiumLauncherHtml()}${this.deps.moneyHtml(copper)}`;
    row.querySelector('[data-claudium-launcher]')?.addEventListener('click', () => {
      this.deps.openClaudium();
    });
    row.querySelector('[data-wallet-action]')?.addEventListener('click', () => {
      this.deps.openWallet();
    });
    this.lastMoneyCopper = copper;
  }

  /** The narrow repaint: find the existing footer and re-paint it. A window that has
   *  never been rendered has no .money row yet, so this is a no-op rather than a
   *  partial paint. Public because the async $WOC / Claudium balance reads land on
   *  their own schedule and need the same footer-only treatment: before this they
   *  called the HUD's full renderBags() from a promise resolve, which tore the window
   *  down under a player who had not touched anything. */
  refreshMoneyRow(): void {
    const row = this.deps.root().querySelector('.money') as HTMLElement | null;
    if (!row) return;
    this.paintMoneyRow(row, this.deps.world().copper);
  }

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
    this.clearTrackerHighlight();
    this.deps.hideTooltip();
    this.deps.cancelPetFeed();
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
    this.deps.onClosed();
  }

  render(): void {
    // Rebuild tears down hovered cells without mouseleave; drop any tracker glow.
    this.clearTrackerHighlight();
    const el = this.deps.root();
    const world = this.deps.world();
    // The focused control's identity, carried across the rebuild (the vendor
    // ladder pattern, the phase 13 QA hand-off): this window rebuilds whole
    // on the same onInventoryChanged hook the vendor does, and used to drop
    // keyboard focus to <body> every time a stack changed. Captured BEFORE
    // teardown, with the focused grid SLOT for the outward-walk rung.
    const focusKey = captureFocusKey(el);
    const preRows = [...el.querySelectorAll<HTMLElement>('.bag-grid [data-focus-key]')];
    const focusedNode = focusedWithin(el);
    const focusedSlot = focusedNode instanceof HTMLElement ? preRows.indexOf(focusedNode) : -1;
    // .bag-grid (not #bags) is the scroll container; it is recreated on every
    // rebuild, so capture its scroll offset and reapply it to the fresh grid:
    // otherwise using an item (e.g. a potion) snaps the list back to the top.
    const prevScrollTop = el.querySelector('.bag-grid')?.scrollTop ?? 0;
    // Bags is a non-modal companion window (vendor / trade / market can be open
    // alongside it), so it gets the accessible name and role=dialog like every
    // other window in the family, but NO focus trap: markDialogRoot never installs
    // one on its own (that is a separate opt-in, see prompt_dialog.ts for the modal
    // recipe this window's own prompts use).
    markDialogRoot(el, { label: t('itemUi.bags.title') });
    el.innerHTML = `<div class="panel-title"><span>${esc(t('itemUi.bags.title'))}</span><button type="button" class="x-btn" data-close data-focus-key="close" aria-label="${esc(t('itemUi.bags.close'))}">${svgIcon('close')}</button></div>`;
    el.appendChild(this.buildBagBar());
    // Skip the chip/search row entirely when the bag is empty: a full filter bar
    // above a grid of empty squares is just noise.
    if (world.inventory.length > 0) el.appendChild(this.buildFilterBar());
    const grid = document.createElement('div');
    grid.className = 'bag-grid';
    this.fillGrid(grid);
    el.appendChild(grid);
    grid.scrollTop = prevScrollTop;
    const moneyRow = document.createElement('div');
    moneyRow.className = 'money';
    el.appendChild(moneyRow);
    this.paintMoneyRow(moneyRow, world.copper);
    // The restore ladder (the vendor contract): the exact control when it
    // survived, else the same grid slot walking outward (after a consumed
    // stack the slot holds the NEXT item, the useful landing), else Close.
    // Every rung resolves by dataset equality (jsdom has no CSS.escape).
    if (focusKey !== null) {
      const keyed = [...el.querySelectorAll<HTMLElement>('[data-focus-key]')];
      const exact = keyed.find((node) => node.dataset.focusKey === focusKey);
      const rows = [...el.querySelectorAll<HTMLElement>('.bag-grid [data-focus-key]')];
      const slot = focusedSlot >= 0 ? Math.min(focusedSlot, rows.length - 1) : -1;
      const neighbors: (HTMLElement | undefined)[] = [];
      if (slot >= 0) {
        for (let step = 0; step < rows.length; step++) {
          if (rows[slot + step]) neighbors.push(rows[slot + step]);
          // The backward rung is NEAR-dead by construction: the clamp above
          // guarantees rows[slot] resolves whenever any row survives, so
          // walking backward only matters if forward rungs are all
          // disabled. Kept deliberately: restoreFirstEnabled skips
          // disabled controls, and a grid tail of aria-disabled rows is a
          // real state (the unknown-cell ladder).
          if (step > 0 && rows[slot - step]) neighbors.push(rows[slot - step]);
        }
      }
      restoreFirstEnabled([
        exact,
        ...neighbors,
        el.querySelector<HTMLElement>('[data-close]') ?? undefined,
      ]);
    }
    el.querySelector('[data-close]')?.addEventListener('click', () => {
      // On touch the vendor / bank clusters hide their LEFT panel's own x-btn, so
      // this bags x-btn is the whole cluster's single close control: it closes the
      // companion window too (mirroring closeVendor's / onBankClosed's teardown),
      // never leaving a half-screen orphan.
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
    });
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
    backpack.dataset.focusKey = 'bagsocket:backpack';
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
        btn.dataset.focusKey = `bagsocket:${socket.socket}`;
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
        emptySocket.dataset.focusKey = `bagsocket:${socket.socket}`;
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
    const world = this.deps.world();
    // Quest chip badge: total stack count of quest items (bagQuestItemCount).
    // Only painted when N > 0 so an empty bag of quest pieces stays quiet.
    const questCount = bagQuestItemCount(world.inventory, (id) => knownItemDef(ITEMS, id));

    const chips = document.createElement('div');
    chips.className = 'bag-chips';
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', t('hudChrome.bags.filterGroupAria'));
    for (const category of BAG_CATEGORIES) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `bag-chip${this.filter.category === category ? ' active' : ''}`;
      chip.dataset.focusKey = `bagchip:${category}`;
      const label = t(BAG_CATEGORY_LABEL_KEYS[category]);
      if (category === 'quest' && questCount > 0) {
        const countText = formatNumber(questCount, { maximumFractionDigits: 0 });
        chip.innerHTML = `${esc(label)}<span class="bag-chip-count" aria-hidden="true">${esc(countText)}</span>`;
        chip.setAttribute(
          'aria-label',
          t('hudChrome.bags.filterQuestCountAria', { count: countText }),
        );
      } else {
        chip.textContent = label;
      }
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

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'bag-search';
    search.dataset.focusKey = 'bag-search';
    search.placeholder = t('hudChrome.bags.searchPlaceholder');
    search.setAttribute('aria-label', t('hudChrome.bags.searchAria'));
    search.value = this.filter.search;
    search.addEventListener('input', () => {
      this.filter.search = search.value;
      this.persistFilter();
      this.refreshGrid();
    });
    tools.appendChild(search);

    const sort = document.createElement('select');
    sort.className = 'bag-sort';
    // The one filter-bar control the ladder missed (the phase 14 QA): its
    // change handler rebuilds the window, and keyless it fell to <body>
    // mid-interaction (a closed select fires change per arrow press).
    sort.dataset.focusKey = 'bag-sort';
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

    // The one-shot clean-up button (world.sortInventory): unlike the view-only
    // dropdown beside it, this rearranges the REAL cells (server-side online,
    // so both hosts land the identical grid). Pressing it also resets any
    // active filter/search/view back to the pristine cells: the whole point of
    // the press is seeing the tidied bag, and a derived list would hide it.
    const sortBtn = document.createElement('button');
    sortBtn.type = 'button';
    sortBtn.className = 'bag-sort-btn';
    sortBtn.dataset.focusKey = 'bag-sort-btn';
    sortBtn.innerHTML = `${svgIcon('sort')}<span>${esc(t('hudChrome.bags.sortButton'))}</span>`;
    sortBtn.setAttribute('aria-label', t('hudChrome.bags.sortButtonAria'));
    this.deps.attachTooltip(
      sortBtn,
      () => `<div class="tt-sub">${esc(t('hudChrome.bags.sortButtonHint'))}</div>`,
    );
    sortBtn.addEventListener('click', () => {
      audio.cardShuffle();
      this.armSortSettle();
      this.deps.world().sortInventory();
      // In-memory only, deliberately NOT persisted: the press shows the
      // tidied cells NOW, but the player's saved category/sort/search
      // preference (woc_bag_filter) survives into the next session.
      this.filter = { ...DEFAULT_BAG_FILTER };
      this.render();
    });
    tools.appendChild(sortBtn);

    bar.appendChild(tools);
    return bar;
  }

  // Whether an armed sort settle should play on THIS paint: only while the
  // arming is fresh (the backstop clears a no-op sort) and only once the
  // inventory actually differs from its press-time state (online, the tidied
  // inventory arrives with the heavy self snapshot, not the press's own
  // repaint; the press's filter reset alone must never fire it).
  private consumeSortSettle(signature: string): boolean {
    if (this.sortSettleArmedAt === 0) return false;
    if (performance.now() - this.sortSettleArmedAt >= SORT_SETTLE_MS) {
      this.sortSettleArmedAt = 0;
      return false;
    }
    if (signature === this.lastSortBaseline) return false;
    this.sortSettleArmedAt = 0;
    return true;
  }

  // The CSS-only settle ripple: a class on the grid plus a per-cell stagger
  // index. No JS driver and no layout read (the cold-window contract); the
  // stagger caps so a full 72-cell bag still settles inside half a second,
  // and reduced-motion turns the whole thing off in the stylesheet.
  private applySortSettle(grid: HTMLElement): void {
    grid.classList.add('bag-grid-settle');
    for (let i = 0; i < grid.children.length; i++) {
      (grid.children[i] as HTMLElement).style.setProperty(
        '--settle-i',
        String(Math.min(i, SORT_SETTLE_STAGGER_CAP)),
      );
    }
  }

  // Populate (or repopulate) the .bag-grid scroll container from the current filter
  // state. Split out so a search keystroke can refresh just the grid (refreshGrid)
  // without rebuilding the filter bar and stealing input focus.
  private fillGrid(grid: HTMLElement): void {
    const world = this.deps.world();
    const model = buildBagGrid(
      world.inventory,
      (id) => knownItemDef(ITEMS, id),
      this.filter,
      world.bagCapacity,
    );
    // Settle bookkeeping rides every paint: the class never persists across a
    // repaint (each replay would re-run the animation on the fresh nodes).
    grid.classList.remove('bag-grid-settle');
    const settle = this.consumeSortSettle(bagSortSignature(world.inventory));
    if (model.state === 'empty') {
      grid.innerHTML = `<div class="bag-empty">${esc(t('itemUi.bags.empty'))}</div>`;
      return;
    }
    if (model.state === 'noMatch') {
      // Warm purpose-class copy when the Quest chip matches nothing; generic
      // no-match line for every other filter (bagNoMatchKind pure discriminant).
      const noMatchKey =
        bagNoMatchKind(this.filter) === 'quest'
          ? 'hudChrome.bags.noQuestItems'
          : 'hudChrome.bags.noMatch';
      grid.innerHTML = `<div class="bag-empty">${esc(t(noMatchKey))}</div>`;
      return;
    }
    // The pristine view paints the bag's REAL cells (model.cells): every stack sits in
    // the square the player parked it in, and the squares between them stay empty. Any
    // other view (a filter, a search, a sort) is a derived LIST, whose squares hold no
    // position: those are still drop targets, but the drop is REFUSED with a toast
    // rather than silently doing nothing, which is what a broken drag looks like.
    // Soft Quest section headers are NEVER inserted here: bagOrderIsManual is true,
    // and a header node in the cell stream would shift bagIndex drop targets
    // (state.md locked decision 7). Rim/seal alone marks quest stacks in this view.
    if (model.cells.length > 0) {
      for (let cell = 0; cell < model.cells.length; cell++) {
        const stack = model.cells[cell];
        const item = stack ? knownItemDef(ITEMS, stack.itemId) : undefined;
        // Stale-client guard (R34): a stack whose id this bundle predates is
        // still an OCCUPIED slot; painting it as an empty square is how a
        // counted slot turns invisible.
        grid.appendChild(
          stack && item
            ? this.buildStackCell(stack, item, cell)
            : stack
              ? this.buildUnknownStackCell(stack, cell)
              : this.buildEmptyCell(cell),
        );
      }
      if (settle) this.applySortSettle(grid);
      return;
    }
    // Derived list: soft Quest section headers only when buildBagListRows allows
    // them (not manual All+recent; mixed quest + non-quest). Section rows are not
    // drop targets and carry no bag cell index. No `continue` in this loop: the
    // R34 pin holds fillGrid to zero continues so an unknown stack can never be
    // skipped (tests/bags_window.test.ts).
    for (const row of buildBagListRows(
      model.visible,
      (id) => knownItemDef(ITEMS, id),
      this.filter,
    )) {
      if (row.kind === 'section') {
        grid.appendChild(this.buildSectionHeader(row.section));
      } else {
        const s = row.slot;
        const item = knownItemDef(ITEMS, s.itemId);
        grid.appendChild(
          item ? this.buildStackCell(s, item, null) : this.buildUnknownStackCell(s, null),
        );
      }
    }
    for (let i = 0; i < model.emptyCells; i++) grid.appendChild(this.buildEmptyCell(null));
    if (settle) this.applySortSettle(grid);
  }

  // Soft parchment section caption for a derived bag list (Quest grouping). Not a
  // drop target, not focusable, not counted as a bag cell.
  private buildSectionHeader(_section: 'quest'): HTMLElement {
    const el = document.createElement('div');
    el.className = 'bag-section-header bag-section-quest';
    el.setAttribute('role', 'presentation');
    // Reuse the Quest chip label so the section and filter share one string.
    el.textContent = t(BAG_CATEGORY_LABEL_KEYS.quest);
    return el;
  }

  // One occupied square. `cell` is the bag CELL it sits in (the drop-target position), or
  // null in a derived list view where a square names no position.
  private buildStackCell(
    s: InvSlot,
    item: (typeof ITEMS)[string],
    cell: number | null,
  ): HTMLElement {
    const world = this.deps.world();
    {
      const row = document.createElement('button');
      row.type = 'button';
      // Quest-purpose mark (bag_quest_mark_view.ts): kind===quest gets the
      // .bag-quest rim/wash class; questReady adds .bag-quest-ready for the
      // brighter seal. Purpose class, not a quality tier.
      // Fine-grade mark (bag_fine_mark_view.ts): fine_* materials get .bag-fine
      // rim/wash + seal so they never read as plain white reagents. Grade class,
      // not a quality tier; distinct lineage from quest gold. Purpose outranks
      // grade: bagRimClasses never emits both rim classes at once.
      const questMark = bagQuestMarkKind(item, this.questMarkProgress(item));
      const questReady = questMark === 'questReady';
      const fineMark = bagFineMark(item.id);
      row.className = `bag-item q-${bagQualityKey(item)}${bagRimClasses(questMark, fineMark)}`;
      // The stack's live inventory INDEX, resolved by REFERENCE (duplicate stacks and
      // instanced copies share an itemId): that is what the move command sends as `from`.
      const index = bagStackIndex(world.inventory, s);
      if (cell !== null) row.dataset.bagIndex = String(cell);
      // Focus identity for the rebuild ladder (the vendor pattern): itemId
      // plus the stack's ORDINAL among same-item stacks, not the raw
      // inventory index (the phase 14 QA): consuming an earlier
      // different-item stack shifts every later index, and an index-keyed
      // exact rung then lands focus one stack over. The ordinal only moves
      // when an earlier SAME-item stack goes, where the same-slot rung is
      // the honest landing anyway. Distinct 'bagu:' prefix on the
      // unknown-cell builder keeps the two families from colliding on a
      // shared miss value.
      row.dataset.focusKey = `bag:${s.itemId}:${this.stackOrdinal(world.inventory, s)}`;
      this.bindBagCellDrop(row, cell);
      const qColor = QUALITY_COLOR[bagQualityKey(item)] ?? QUALITY_DEFAULT_COLOR;
      const itemName = itemDisplayName(item);
      // Corner-glyph priority (bag_corner_mark_view.ts, composed from
      // bag_instance_glyph_view + bag_quest_mark_view + bag_fine_mark_view):
      // masterwork > quest seal > fine seal > enchanted / signed / bound >
      // generic wedge. The fine rim/wash is independent of which seal wins the
      // corner (a masterwork fine stack keeps its rim).
      const glyphKind = bagInstanceGlyphKind(s.instance);
      const cornerMark = bagCornerMark(glyphKind, questMark, fineMark);
      row.style.setProperty('--bag-slot-quality', qColor);
      // Accessible name: quest stacks always announce quest item (the seal is
      // aria-hidden). Instanced stacks keep their per-copy flag. Plain stacks,
      // fine included, keep the plain label: a fine id's NAME already carries
      // the grade word (see the fine-grade aria note above the category map).
      const itemAriaKey = questMark
        ? 'hudChrome.bags.itemAriaQuest'
        : glyphKind
          ? INSTANCE_GLYPH_ARIA_KEYS[glyphKind]
          : 'itemUi.bags.itemAria';
      row.setAttribute(
        'aria-label',
        t(itemAriaKey, {
          item: itemName,
          count: formatNumber(s.count, { maximumFractionDigits: 0 }),
        }),
      );
      // Exactly one corner treatment ever renders (cornerMark is a single
      // discriminant): masterwork seal, quest seal, fine seal, or an instance
      // glyph/tab, all minted through the shared cornerMarkHtml dispatch
      // (item_instance_glyph_mark.ts) so bank/guild-bank cells paint the same
      // art and no painter re-derives the corner from the raw glyph kind.
      // Composes with the bottom-right count badge, always visible without
      // hover on desktop and touch, identical on every graphics preset (no
      // --fx gate). Ready seals share the seal markup and brighten via
      // .bi-quest-seal-ready (static; optional pulse is CSS-only).
      const cornerSeal = cornerMarkHtml(cornerMark, { questReady });
      row.innerHTML = `${this.deps.itemIcon(item)}${cornerSeal}<span class="bi-count">${s.count > 1 ? esc(t('itemUi.bags.stackCount', { count: formatNumber(s.count, { maximumFractionDigits: 0 }) })) : ''}</span>`;
      // A firebottle mid-throw-cooldown paints a draining curtain on its slot so the
      // 5s throw pacing is visible in the bag. The bag is a cold window with no
      // per-frame driver, so the sweep is a self-contained CSS animation seeded from
      // the wired remaining seconds (world.player.firebottleCdRemaining), not a
      // per-frame-repainted --cd-fill like the action bar. Appended after the
      // innerHTML build so the quest seal markup above is not overwritten.
      if (item.id === FIREBOTTLE_ITEM_ID && world.player.firebottleCdRemaining > 0) {
        const remaining = world.player.firebottleCdRemaining;
        const curtain = document.createElement('span');
        curtain.className = 'bag-cd-curtain';
        curtain.setAttribute('aria-hidden', 'true');
        curtain.style.setProperty(
          '--cd-start',
          `${Math.min(100, (remaining / FIREBOTTLE_COOLDOWN_SECS) * 100)}%`,
        );
        curtain.style.setProperty('--cd-dur', `${remaining}s`);
        row.appendChild(curtain);
      }
      // Bag hover / keyboard focus lights the matching quest-tracker title
      // (information-add). Mouse and focus both drive the same highlight so Tab
      // navigation matches pointer hover; leave/focusout clear it. Touch peek
      // still relies on the tooltip path alone (no mouseenter on long-press).
      const trackerQuestId = bagQuestTrackerHighlightId(item);
      if (trackerQuestId) {
        row.addEventListener('mouseenter', () => this.trackerHighlight.set(trackerQuestId));
        row.addEventListener('mouseleave', () => this.clearTrackerHighlight());
        row.addEventListener('focusin', () => this.trackerHighlight.set(trackerQuestId));
        row.addEventListener('focusout', () => this.clearTrackerHighlight());
      }
      row.addEventListener('click', (ev) => {
        // On touch, the click that ends a long-press peek inspects the stack (its
        // tooltip is already shown) instead of running its action (use / sell /
        // deposit / feed): the release dismisses the tooltip and fires nothing. A
        // plain tap / desktop click falls through.
        if (this.deps.consumePeek()) {
          this.hideTooltipClearingTracker();
          return;
        }
        // The synthetic click that trails a completed touch drag must not ALSO run
        // the stack's action: dragging a potion onto the paperdoll would otherwise
        // drink it on release.
        if (this.suppressNextClick) {
          this.suppressNextClick = false;
          return;
        }
        if (ev.shiftKey && bagShiftLinks(this.bagMode())) {
          this.deps.insertItemChatLink(s.itemId);
          return;
        }
        // Touch has no right-click, so a tap on an item with an action
        // (Disenchant / Salvage / Apply Enchant) opens the action menu instead of
        // running the classic action directly; the menu's first row is that
        // classic action, so nothing is lost. A plain item taps straight through,
        // byte-identical to today. Long-press still peeks (handled above).
        if (this.deps.isTouchHud() && this.itemMenuAvailable(item, s.itemId)) {
          this.openItemMenuFor(item, s, ev);
          return;
        }
        this.runBagAction(item, s, ev);
      });
      row.addEventListener('contextmenu', (ev) => {
        // A touch long-press belongs to the tooltip peek (the TouchPeekGuard
        // family): Chromium synthesizes contextmenu at ~500ms on a touch hold,
        // beating the 950ms peek timer, so a touch-sourced right-click inspects
        // and never acts. Desktop mouse right-click keeps its affordance; an
        // undefined pointerType on a mobile-touch device fails safe to inspect
        // (Firefox Android fires contextmenu as a MouseEvent).
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
        ev.preventDefault();
        // An item with an action (Disenchant / Salvage / Apply Enchant)
        // opens the action menu, whose FIRST row is the classic left-click action
        // so that binding survives. Every other item keeps today's behavior
        // byte-identical: right-click runs the SAME action as left-click (use /
        // equip), never a destroy (destroying is the drag-out-to-world gesture).
        if (this.itemMenuAvailable(item, s.itemId)) {
          this.openItemMenuFor(item, s, ev);
          return;
        }
        this.runBagAction(item, s, ev);
      });
      // Every bag stack is draggable now, not just the hotbar-eligible ones: the
      // drag feeds three targets (an action-bar slot for a usable item, a paperdoll
      // socket for a gear piece, the world to destroy), and each target decides for
      // itself whether to accept. The hotbar payload still rides the DataTransfer
      // (the action bar reads it there), while dragState carries the stack for the
      // targets that must decide during dragover, where the DataTransfer is unreadable.
      row.draggable = !this.deps.tradeOpen() && !this.deps.vendorOpen();
      row.addEventListener('dragstart', (e) => {
        const drag: BagItemDrag = {
          itemId: s.itemId,
          count: Math.max(1, Math.floor(s.count)),
          index: index >= 0 ? index : null,
        };
        this.deps.dragState.begin(drag);
        if (this.deps.isHotbarItemId(s.itemId)) {
          const action = { type: 'item' as const, id: s.itemId };
          this.deps.setDragAction(action);
          this.writeDraggedAction(e.dataTransfer, action);
        }
        if (e.dataTransfer) {
          e.dataTransfer.setData('text/plain', s.itemId);
          e.dataTransfer.effectAllowed = 'copyMove';
        }
        this.deps.markEquipDropTargets(s.itemId);
        // Drag dismisses the tooltip without mouseleave; clear the tracker glow too.
        this.hideTooltipClearingTracker();
      });
      row.addEventListener('dragend', () => {
        this.deps.dragState.end();
        this.deps.setDragAction(null);
        this.deps.clearActionDropTargets();
        this.deps.markEquipDropTargets(null);
      });
      // A fresh press clears any stale suppression: the flag is only ever meant to
      // swallow the ONE synthetic click that trails the drag it was set by, so a drag
      // that somehow ends without that click can never eat a later, real tap.
      row.addEventListener('pointerdown', () => {
        this.suppressNextClick = false;
      });
      // The touch arm of the same drag (HTML5 drag-and-drop does not exist there).
      bindTouchItemDrag(row, {
        state: this.deps.dragState,
        isTouchHud: () => this.deps.isTouchHud(),
        payload: () =>
          this.deps.tradeOpen() || this.deps.vendorOpen()
            ? null
            : {
                itemId: s.itemId,
                count: Math.max(1, Math.floor(s.count)),
                index: index >= 0 ? index : null,
              },
        ghostHtml: () => this.deps.itemIcon(item),
        onStart: () => {
          this.hideTooltipClearingTracker();
          this.deps.markEquipDropTargets(s.itemId);
        },
        onMove: () => {
          /* the paperdoll sockets are already lit; the ghost tracks the finger */
        },
        onDrop: (x, y) => {
          // Suppress the synthetic click the release fires on the source row.
          this.suppressNextClick = true;
          const target = resolveDropTargetAt(x, y);
          const count = Math.max(1, Math.floor(s.count));
          // The paperdoll drop belongs to the character window (it owns the sockets
          // and the equip refusals); the world drop belongs here, where the destroy
          // prompt lives. Releasing anywhere else is a plain cancel.
          if (target.kind === 'equip') {
            // `index` above is bagStackIndex over the live inventory, so it names
            // the exact stack this drag started from.
            this.deps.dropOnEquipSlot(
              s.itemId,
              target.slot,
              index >= 0 ? { slotIndex: index } : undefined,
            );
          } else if (target.kind === 'bagCell')
            this.dropOnBagCell(index >= 0 ? index : null, target.index);
          else if (target.kind === 'actionSlot') this.deps.dropOnActionSlot(s.itemId, target.slot);
          else if (target.kind === 'actionRingSlot')
            this.deps.dropOnActionRingSlot(s.itemId, target.ringIndex);
          else if (target.kind === 'world') this.dropOnWorldToDestroy(s.itemId, count);
        },
        onEnd: () => {
          this.deps.markEquipDropTargets(null);
        },
      });
      this.attachRowTooltip(row, item, s);
      return row;
    }
  }

  // One empty square: free space in the bag. In the pristine view it is a real CELL a
  // stack can be parked in (a hole, deliberately), so it accepts a drop; in a derived
  // list view it is decorative padding. Never focusable either way.
  private buildEmptyCell(cell: number | null): HTMLElement {
    const el = document.createElement('div');
    el.className = 'bag-item empty';
    el.setAttribute('aria-hidden', 'true');
    if (cell !== null) {
      el.dataset.bagIndex = String(cell);
      this.bindBagCellDrop(el, cell);
    }
    return el;
  }

  // An occupied square whose def this bundle cannot resolve (stale-client
  // guard, R34): inventory is server truth, so an id minted by content this
  // bundle predates still holds a real, counted slot. The cell renders the
  // fallback icon, its count badge, the raw id as its label, and the def-free
  // corner glyph (the instance payload is wire truth, so a bound or enchanted
  // copy keeps its marker and its aria flag). It keeps every DEF-FREE
  // capability and only those: it is a drop target in the pristine view, a
  // DRAG SOURCE (moveInventoryItem acts on indices alone, the same argument
  // that keeps the bank's withdraw live), and with the bank open it DEPOSITS
  // (bankDeposit is index-based too, so the withdraw the guard kept live is
  // not a one-way trip). Use / sell / equip all need a def, so outside the
  // bank the cell is a focusable no-op and aria-disabled is honest.
  // Shift-click chat linking is not wired because it would be a silent no-op
  // anyway: the send path (insertItemLink) refuses an id with no resolvable
  // display name. (The "[?]" a stale client can see in chat is the
  // RECEIVER's degradation of a link a current client sent; nothing here
  // affects it.) Everything acts again once the client updates.
  // The same-item ordinal for the focus keys (the phase 14 QA): stable when
  // an earlier DIFFERENT-item stack goes, unlike the raw index. Computed as
  // ONE pass per inventory array and cached on the array's identity (both
  // worlds hand back a stable array between changes; a world that copied
  // per access would only degrade this to the per-row cost it replaced).
  private ordinalCache: { inv: readonly InvSlot[]; map: Map<InvSlot, number> } | null = null;
  private stackOrdinal(inventory: readonly InvSlot[], s: InvSlot): number {
    if (this.ordinalCache?.inv !== inventory) {
      const map = new Map<InvSlot, number>();
      const counts = new Map<string, number>();
      for (const slot of inventory) {
        const n = counts.get(slot.itemId) ?? 0;
        map.set(slot, n);
        counts.set(slot.itemId, n + 1);
      }
      this.ordinalCache = { inv: inventory, map };
    }
    return this.ordinalCache.map.get(s) ?? -1;
  }

  private buildUnknownStackCell(s: InvSlot, cell: number | null): HTMLElement {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'bag-item q-common';
    row.dataset.focusKey = `bagu:${s.itemId}:${
      cell ?? this.stackOrdinal(this.deps.world().inventory, s)
    }`;
    row.style.setProperty('--bag-slot-quality', QUALITY_DEFAULT_COLOR);
    // The known cell's ladder gives trade, mail-attach, market-sell, and
    // vendor precedence over the deposit; those four all need a def, so on
    // the unknown cell an active higher mode means NO action (the honest
    // aria-disabled no-op), never a deposit that jumps the ladder. The
    // decision itself lives beside bagItemAction (bags_view.ts
    // bagUnknownAction) so the two ladders cannot drift apart.
    const canDeposit = bagUnknownAction(this.bagMode()) === 'bankDeposit';
    if (!canDeposit) row.setAttribute('aria-disabled', 'true');
    // The accessible name says UNKNOWN, not just the raw id: the hover
    // tooltip is mouse-only, and the two channels must agree (the glyph
    // aria-key rule above). The def-free glyph kind rides the same aria keys
    // the known cell uses, with the unknown label as the item token.
    const glyphKind = bagInstanceGlyphKind(s.instance);
    row.setAttribute(
      'aria-label',
      glyphKind
        ? // A glyphed unknown stack carries BOTH aria facts: the UNKNOWN
          // signal and the per-copy flag (bound is the one a player checks
          // before trading). The per-kind unknown keys keep the pair as one
          // localizable sentence.
          t(UNKNOWN_INSTANCE_GLYPH_ARIA_KEYS[glyphKind], {
            id: s.itemId,
            count: formatNumber(s.count, { maximumFractionDigits: 0 }),
          })
        : t('itemUi.bags.unknownItemAria', {
            id: s.itemId,
            count: formatNumber(s.count, { maximumFractionDigits: 0 }),
          }),
    );
    if (cell !== null) row.dataset.bagIndex = String(cell);
    this.bindBagCellDrop(row, cell);
    // Deliberately no quest or fine mark here: both need the item DEF (quest
    // kind) or a MATERIAL_GRADES row the client shipped WITH its ITEMS row, so
    // an unknown-def stack can never honestly claim either. The per-copy
    // marks are def-free (instance payload only) and do apply, minted through
    // the shared item_instance_glyph_mark helper.
    const instanceMark = instanceGlyphMarkHtml(glyphKind);
    row.innerHTML = `${unknownItemIconHtml(s.itemId)}${instanceMark}<span class="bi-count">${s.count > 1 ? esc(t('itemUi.bags.stackCount', { count: formatNumber(s.count, { maximumFractionDigits: 0 }) })) : ''}</span>`;
    if (canDeposit) {
      row.addEventListener('click', (ev) => {
        // The same peek and trailing-synthetic-click dance as the known cell:
        // this cell has a drag source, so a completed touch drag must not
        // also deposit on release.
        if (this.deps.consumePeek()) {
          this.deps.hideTooltip();
          return;
        }
        if (this.suppressNextClick) {
          this.suppressNextClick = false;
          return;
        }
        // The known cell's bankDeposit arm, def-free by construction: resolve
        // the exact clicked stack by reference and send the index. The prompt
        // (shift, multi-count fungible stacks) is def-free too.
        const index = bagStackIndex(this.deps.world().inventory, s);
        if (index < 0) return;
        if (ev.shiftKey && bankDepositOpensPrompt(s)) {
          this.showDepositQuantityPrompt(index, s, Math.max(1, Math.floor(s.count)));
        } else {
          this.deps.world().bankDeposit(index);
          this.deps.hideTooltip();
          this.render();
        }
      });
    }
    // A touch long-press belongs to the tooltip peek here exactly as on the
    // known cell (Chromium synthesizes contextmenu at ~500ms, beating the
    // peek timer, and this cell's tooltip is the only channel that explains
    // it to a sighted touch player); desktop right-click stays inert since
    // the cell has no secondary action to offer.
    row.addEventListener('contextmenu', (ev) => {
      const pointerType = (ev as PointerEvent).pointerType;
      if (
        pointerType === 'touch' ||
        pointerType === 'pen' ||
        (document.body.classList.contains('mobile-touch') && pointerType !== 'mouse')
      ) {
        ev.preventDefault();
      }
    });
    // A fresh press clears any stale suppression, mirroring the known cell's
    // contract: the flag only ever swallows the ONE synthetic click trailing
    // the drag that set it, and a drag that ends without that click (release
    // over another element, a rebuild destroying the source row) must never
    // eat a later, real deposit tap.
    row.addEventListener('pointerdown', () => {
      this.suppressNextClick = false;
    });
    this.deps.attachTooltip(
      row,
      () =>
        `<div class="tt-title">${esc(s.itemId)}</div><div class="tt-sub">${esc(t('itemUi.bags.unknownItem'))}</div>`,
    );
    // The drag source, trimmed from buildStackCell's wiring: no hotbar
    // payload (a hotbar action needs a def), and markEquipDropTargets is
    // def-gated and lights nothing for an unknown id; the world/paperdoll
    // drop arms no-op the same way, leaving the bag-cell move as the one
    // live target, which is the point. The click-suppression dance IS here
    // (the deposit click above, the onDrop flag below, and the pointerdown
    // reset): with the bank open this cell has a real click action now.
    const index = bagStackIndex(this.deps.world().inventory, s);
    row.draggable = !this.deps.tradeOpen() && !this.deps.vendorOpen();
    row.addEventListener('dragstart', (e) => {
      this.deps.dragState.begin({
        itemId: s.itemId,
        count: Math.max(1, Math.floor(s.count)),
        index: index >= 0 ? index : null,
      });
      if (e.dataTransfer) {
        e.dataTransfer.setData('text/plain', s.itemId);
        e.dataTransfer.effectAllowed = 'copyMove';
      }
      this.deps.markEquipDropTargets(s.itemId);
      this.deps.hideTooltip();
    });
    row.addEventListener('dragend', () => {
      this.deps.dragState.end();
      this.deps.clearActionDropTargets();
      this.deps.markEquipDropTargets(null);
    });
    bindTouchItemDrag(row, {
      state: this.deps.dragState,
      isTouchHud: () => this.deps.isTouchHud(),
      payload: () =>
        this.deps.tradeOpen() || this.deps.vendorOpen()
          ? null
          : {
              itemId: s.itemId,
              count: Math.max(1, Math.floor(s.count)),
              index: index >= 0 ? index : null,
            },
      ghostHtml: () => unknownItemIconHtml(s.itemId),
      onStart: () => {
        this.deps.hideTooltip();
        this.deps.markEquipDropTargets(s.itemId);
      },
      onMove: () => {
        /* nothing to light beyond the shared drag ghost */
      },
      onDrop: (x, y) => {
        // Suppress the synthetic click the release fires on the source row
        // (touch_item_drag.ts contract): with the bank open this cell HAS a
        // click action now, and without the flag a reorganize drag would
        // also deposit the stack on release.
        this.suppressNextClick = true;
        // Only the bag-cell move is live for a def-less stack: equip and the
        // world-destroy prompt both need the def, so releasing there is a
        // plain cancel rather than a half-working action.
        const target = resolveDropTargetAt(x, y);
        if (target.kind === 'bagCell') this.dropOnBagCell(index >= 0 ? index : null, target.index);
      },
      onEnd: () => {
        this.deps.markEquipDropTargets(null);
      },
    });
    return row;
  }

  // A bag square as a drop target for a stack dragged out of the SAME bag. `cell` is the
  // square's bag position, or null in a derived list view (where the drop is refused with
  // a toast: the square holds no position there, so honoring it would move a stack the
  // player never aimed at).
  private bindBagCellDrop(el: HTMLElement, cell: number | null): void {
    el.addEventListener('dragover', (e) => {
      const drag = this.deps.dragState.get();
      if (!drag || drag.index === null) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      // Only a real cell can accept, so only a real cell lights up; the list-view square
      // still takes the drop, purely to explain why it cannot.
      if (cell !== null) el.classList.add('drop-target');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
    el.addEventListener('drop', (e) => {
      const drag = this.deps.dragState.get();
      el.classList.remove('drop-target');
      if (!drag || drag.index === null) return;
      e.preventDefault();
      // Stop the drop bubbling to the #bags unequip drop target behind the grid.
      e.stopPropagation();
      const from = drag.index;
      this.deps.dragState.end();
      this.dropOnBagCell(from, cell);
    });
  }

  // Run the reorder. Both ends are re-validated by the sim (a stale index after a
  // repaint, or a hand-crafted pair, is simply refused there), so this only dispatches.
  private dropOnBagCell(from: number | null, to: number | null): void {
    if (from === null) return;
    if (to === null || !bagOrderIsManual(this.filter)) {
      // A filtered / searched / sorted grid is a derived LIST: its squares hold no bag
      // position, so a drop there would move a stack the player never aimed at. Say so
      // instead of doing nothing, which is indistinguishable from a broken drag.
      this.deps.showError(t('hudChrome.bags.reorderNeedsRecent'));
      return;
    }
    this.deps.world().moveInventoryItem(from, to);
    audio.click();
    this.deps.hideTooltip();
    this.render();
  }

  /** Open the destroy prompt for a stack dropped on the world. Public so the HUD's
   *  world-canvas drop target (the desktop arm of the same gesture) shares this one
   *  entry point with the touch arm above. */
  promptDestroy(itemId: string, count: number): void {
    this.showDiscardItemPrompt(itemId, Math.max(1, Math.floor(count)));
  }

  /** What dropping `itemId` on the world does right now (pure decision, shared with
   *  the tooltip hint). Public for the HUD-installed canvas drop target. */
  destroyAction(itemId: string): BagDestroyAction {
    const item = knownItemDef(ITEMS, itemId);
    if (!item) return 'none';
    return bagDestroyAction(item, this.bagMode());
  }

  /** The blocked-destroy toast (a noDiscard item). Public for the same reason. */
  showDestroyBlocked(): void {
    this.deps.showError(t('hudChrome.bags.cannotDestroy'));
  }

  private dropOnWorldToDestroy(itemId: string, count: number): void {
    dropOnWorld(
      {
        destroyAction: (id) => this.destroyAction(id),
        promptDestroy: (id, n) => this.promptDestroy(id, n),
        showBlocked: () => this.showDestroyBlocked(),
      },
      itemId,
      count,
    );
  }

  // The click / right-click dispatch for a bag stack: the mode-dependent action the
  // pure bagItemAction decided. Both buttons run it (right-click is the classic
  // use/equip binding), so the two can never drift apart.
  private runBagAction(item: (typeof ITEMS)[string], s: InvSlot, ev: MouseEvent): void {
    const action = bagItemAction(item, this.bagMode(), s.instance);
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
      case 'mailAttachBlockedBound':
        this.deps.showError(t('hudChrome.mailbox.cannotMail'));
        return;
      case 'mailAttach':
        this.deps.stageMailParcel(s.itemId, s.instance);
        break;
      case 'marketSellBlockedQuest':
        this.deps.showError(t('itemUi.errors.noQuestItems'));
        return;
      case 'marketSellBlockedNoMarket':
        this.deps.showError(t('itemUi.tooltip.cannotMarket'));
        return;
      case 'marketSellBlockedBound':
        this.deps.showError(t('hud.errors.marketListBound'));
        return;
      case 'marketSell':
        this.deps.stageMarketSell(s.itemId, s.instance);
        break;
      case 'vendorSellBlocked':
        this.deps.showError(t('itemUi.tooltip.cannotVendor'));
        return;
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
      case 'bankDepositBlockedNoTarget':
        // The bank is open with no grid on screen to drop into (its guild pane's
        // Log view). SPEAK, do not go quiet: this is a deliberate click on an
        // item, in a docked window whose every other click either deposits or
        // says why it will not, so silence here reads as a broken bag. The line
        // is the same terse one the hover advertises, matching how the vendor
        // and market denies reuse their cannot-hint wording.
        this.deps.showError(t('hudChrome.bank.cannotDepositNow'));
        return;
      case 'guildBankDeposit': {
        // The guild twin of bankDeposit: same reference-resolved index, same
        // shift split prompt, sent through the IWorldGuildBank facet.
        const index = bagStackIndex(this.deps.world().inventory, s);
        if (index < 0) break;
        if (ev.shiftKey && bankDepositOpensPrompt(s)) {
          this.showDepositQuantityPrompt(index, s, Math.max(1, Math.floor(s.count)), 'guild');
        } else {
          this.deps.world().guildBankDeposit(index);
          this.deps.hideTooltip();
          this.render();
        }
        break;
      }
      // The guild pipe's pre-empt denies, each voicing the exact line the sim
      // would refuse with (its established sim_i18n keys), sending nothing.
      case 'guildBankDepositBlockedQuest':
        // The guild pipe's OWN quest line, not the personal bank's
        // error.bankQuestItem: the sim voices error.guildBankQuestItem here, and
        // a pre-empt that voiced a different sentence would silently diverge.
        this.deps.showError(tSim('error.guildBankQuestItem'));
        return;
      case 'guildBankDepositBlockedSoulbound':
        this.deps.showError(tSim('error.guildBankSoulbound'));
        return;
      case 'guildBankDepositBlockedNoTransfer':
        this.deps.showError(tSim('error.guildBankNoTransfer'));
        return;
      case 'petFeedBlocked':
        this.deps.showError(t('hud.pet.petEatsFoodOnly'));
        return;
      case 'petFeed':
        this.deps.world().feedPet(s.itemId, this.copyRefFor(s));
        this.deps.setPendingPetFeed(false);
        this.deps.resetPetBarSig();
        this.render();
        break;
      case 'discardQuest':
        this.showDiscardItemPrompt(s.itemId, Math.max(1, Math.floor(s.count)));
        break;
      case 'equipBag':
        this.deps.world().equipBag(s.itemId, undefined, this.copyRefFor(s));
        this.deps.hideTooltip();
        this.render();
        break;
      case 'use': {
        // Gathering tools (#2343) route through the interact-style handler
        // (nearest matching node + autorun stop) when main.ts has wired it;
        // everything else, and any unwired host, keeps the plain useItem.
        if (!item || !this.deps.useGatherTool(item)) {
          this.deps.world().useItem(s.itemId, this.copyRefFor(s));
        }
        this.render();
        this.deps.renderCharIfOpen();
        break;
      }
    }
  }

  // The stack's tooltip: the item card, the mode hint, and the affordance hints
  // (partial deposit, drag-to-equip, drag-out-to-destroy, chat link).
  private attachRowTooltip(row: HTMLElement, item: (typeof ITEMS)[string], s: InvSlot): void {
    this.deps.attachTooltip(row, () => {
      const mode = this.bagMode();
      const key = bagTooltipHintKey(item, mode, s.instance);
      const extra = key ? `<div class="tt-sub">${esc(t(key))}</div>` : '';
      // Advertise the shift-click partial deposit on a splittable stack, the bank
      // window's withdrawPartialHint twin (tied to the deposit hint arm so a
      // blocked quest item never shows it).
      // Both bank modes advertise the shift split on their deposit-hint arm
      // (a blocked item never shows it): the guild target reuses the partial
      // wording, only the primary hint key differs.
      const partial =
        (key === 'hudChrome.bank.depositHint' || key === 'hudChrome.bank.guildDepositHint') &&
        bankDepositOpensPrompt(s)
          ? `<div class="tt-sub">${esc(t('hudChrome.bank.depositPartialHint'))}</div>`
          : '';
      // Advertise the two drag gestures that replaced right-click-destroy: a gear
      // piece drags onto the character sheet to equip, and anything destroyable here
      // drags out onto the world to throw away (which opens the prompt, issue 1501).
      const equipDrag = isPaperdollDraggable(item)
        ? `<div class="tt-sub">${esc(t('hudChrome.bags.dragEquipHint'))}</div>`
        : '';
      const destroy =
        bagDestroyAction(item, mode) === 'discard'
          ? `<div class="tt-sub">${esc(t('hudChrome.bags.dragDestroyHint'))}</div>`
          : '';
      const link = bagShiftLinks(mode)
        ? `<div class="tt-sub">${esc(t('hudChrome.itemShare.linkHint'))}</div>`
        : '';
      return this.deps.itemTooltip(item, s.instance) + extra + partial + equipDrag + destroy + link;
    });
  }

  /** Plain progress inputs for bagQuestMarkKind (questReady). Null when the
   *  stack is not a quest kind or the player does not hold the related quest. */
  private questMarkProgress(item: ItemDef) {
    if (item.kind !== 'quest' || !item.questId) return null;
    // Optional chain: thin IWorld fakes in unit harnesses may omit questLog.
    const log = this.deps.world().questLog?.get(item.questId);
    if (!log) return null;
    const quest = QUESTS[item.questId];
    return bagQuestMarkProgressFromLog(
      item.id,
      {
        counts: log.counts,
        state: log.state,
        resolvedCounts: log.resolvedCounts,
      },
      quest?.objectives.map((objective) => ({
        type: objective.type,
        itemId: 'itemId' in objective ? objective.itemId : undefined,
        count: objective.count,
      })),
    );
  }

  private clearTrackerHighlight(): void {
    this.trackerHighlight.clear();
  }

  /** Hide the shared tooltip and drop any bag-driven tracker highlight. */
  private hideTooltipClearingTracker(): void {
    this.clearTrackerHighlight();
    this.deps.hideTooltip();
  }

  // Refresh only the grid contents (used by live search) so the search input keeps
  // focus and caret position across keystrokes.
  private refreshGrid(): void {
    // Grid rebuild tears down hovered cells without mouseleave.
    this.clearTrackerHighlight();
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
      // At most ONE of the two bank modes, and possibly NEITHER: each is armed
      // only while its own grid is actually on screen to drop into. The guild
      // pane's Log view arms neither, because a bag click while reading the
      // history must not silently deposit the item that was clicked.
      //
      // bankOpen carries the fact the two deposit flags no longer can: that the
      // bank cluster owns the bag slot at all. Without it, disarming both
      // deposits reads downstream as "no window is open", which demotes the
      // click to the plain use/equip default and re-arms the destroy prompt and
      // the item action menu over a reading surface.
      bankOpen: this.deps.isBankOpen(),
      bankDeposit: this.deps.isPersonalBankTab(),
      guildBankDeposit: this.deps.isGuildBankTab(),
      petFeed: this.deps.pendingPetFeed(),
    };
  }

  // Whether the action menu should open for this item. Offered ONLY in
  // the plain-use default mode (never trade / mail / market / vendor / bank /
  // pet-feed, whose own click owns the slot), mirroring bagDestroyAction's
  // transactional-mode gate, and only when the item has an eligible action.
  // The bank arm reads bankOpen for the same reason bagDestroyAction does: a
  // bank view with no deposit target is still the bank owning the slot, and the
  // menu's rows are the very use / equip / destroy actions this surface refuses.
  private itemMenuAvailable(item: ItemDef, itemId: string): boolean {
    const mode = this.bagMode();
    const inDefaultMode =
      !mode.tradeOpen &&
      !mode.mailAttach &&
      !mode.marketSell &&
      !mode.vendorOpen &&
      !mode.bankOpen &&
      !mode.bankDeposit &&
      !mode.guildBankDeposit &&
      !mode.petFeed;
    return inDefaultMode && bagItemHasContextActions(item, itemId);
  }

  // Open the action menu at the event's viewport point (falling back to the row
  // box for a keyboard-activated click), passing the exact classic action for
  // this slot as the menu's first row.
  private openItemMenuFor(item: ItemDef, s: InvSlot, ev: MouseEvent): void {
    this.deps.hideTooltip();
    const rect = (ev.currentTarget as HTMLElement | null)?.getBoundingClientRect();
    const x = ev.clientX || rect?.left || 0;
    const y = ev.clientY || rect?.top || 0;
    const index = bagStackIndex(this.deps.world().inventory, s);
    this.deps.openItemActionMenu(item, s.itemId, index, x, y, () => this.runBagAction(item, s, ev));
  }

  /** The copy selection for a clicked stack, or undefined when the stack is no
   *  longer in the live inventory.
   *
   *  bagStackIndex is indexOf, so a stale click yields -1. Sending -1 would be
   *  REFUSED by the sim (the leaf rejects any out-of-range index by design), which
   *  turns a stale click into a silent no-op. Falling back to no-selection keeps
   *  the pre-feature behavior for exactly the case where we cannot name the copy. */
  private copyRefFor(slot: InvSlot): { slotIndex: number } | undefined {
    const index = bagStackIndex(this.deps.world().inventory, slot);
    return index >= 0 ? { slotIndex: index } : undefined;
  }

  private sellBagItem(slot: InvSlot, ev: MouseEvent): void {
    const count = Math.max(1, Math.floor(slot.count));
    if (ev.ctrlKey || ev.metaKey) {
      this.deps.world().sellItem(slot.itemId, count);
    } else if (ev.shiftKey && count > 1) {
      // The prompt's cap is every copy of this item across the whole bag, not just
      // the ONE slot that was clicked: a stackable item's per-slot count tops out at
      // its stackSize (commonly 20), so a player holding more sits in other slots.
      const heldTotal = Math.max(count, totalHeldCount(this.deps.world().inventory, slot.itemId));
      this.showSellQuantityPrompt(slot.itemId, heldTotal);
    } else {
      this.deps.world().sellItem(slot.itemId, undefined, this.copyRefFor(slot));
    }
  }

  // WCAG 2.2 AA modal prompt wiring, the shared recipe (src/ui/prompt_dialog.ts):
  // #bags is the inert root while a prompt is open, and if the bags window itself
  // is force-closed out from under an open prompt, close() clears inert as a
  // teardown backstop, so #bags is never left inert while hidden. This single
  // chokepoint covers the discard, sell, and bank-deposit prompts.
  private installPromptDialog(
    prompt: HTMLElement,
    opener: HTMLElement | null,
    close: () => void,
  ): PromptDialogHandle {
    return installModalPromptDialog(prompt, opener, close, {
      inertRoot: this.deps.root(),
      idPrefix: 'bags-prompt-title',
    });
  }

  private showDiscardItemPrompt(itemId: string, maxCount: number): void {
    document.querySelectorAll('.discard-item-prompt').forEach((el) => {
      el.remove();
    });
    const opener = document.activeElement as HTMLElement | null;
    const item = knownItemDef(ITEMS, itemId);
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
      (this.deps.root().querySelector('[data-close]') as HTMLElement | null)?.focus();
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
    const item = knownItemDef(ITEMS, itemId);
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
  // open). The shared builder (bank_quantity_prompt.ts) owns the chrome; this
  // owns the bags closures: the stale-slot re-resolve (resolveDepositSubmit
  // refuses on an itemId mismatch, else clamps to the live stack) and the send.
  // `target` picks which facet command the submit sends: the personal pane's
  // bankDeposit (default) or the Guild tab's guildBankDeposit; everything else
  // is identical between the two.
  private showDepositQuantityPrompt(
    index: number,
    captured: InvSlot,
    maxCount: number,
    target: 'bank' | 'guild' = 'bank',
  ): void {
    // knownItemDef, not a raw ITEMS index: the release's stale-client sweep
    // made every bags item read tolerate an id this client does not know.
    const item = knownItemDef(ITEMS, captured.itemId);
    const itemName = item ? itemDisplayName(item) : captured.itemId;
    showQuantityPrompt(
      {
        installPromptDialog: (prompt, opener, close) =>
          this.installPromptDialog(prompt, opener, close),
        dismissSiblings: dismissBagPrompts,
      },
      {
        className: 'bank-deposit-prompt',
        titleText: t('hudChrome.bank.depositQuantityTitle', { item: itemName }),
        inputAriaText: t('hudChrome.bank.depositQuantityInput'),
        confirmText: t('hudChrome.bank.depositQuantityConfirm'),
        cancelText: t('itemUi.vendor.sellQuantityCancel'),
        maxCount,
        resolveCount: (requested) => {
          // Re-resolve the live slot at the captured index: depositing the
          // WRONG item (the bags repainted under the prompt) is worse than
          // dismissing.
          const live = this.deps.world().inventory[index];
          return resolveDepositSubmit(live, captured, requested, maxCount);
        },
        send: (count) => {
          if (target === 'guild') this.deps.world().guildBankDeposit(index, count);
          else this.deps.world().bankDeposit(index, count);
        },
        afterClose: (sent) => {
          if (sent) {
            this.deps.hideTooltip();
            // render() rebuilds the grid, detaching the opener slot; dismiss()
            // cleared inert first, so the focus below is not lost into a
            // still-inert subtree.
            this.render();
          }
          // Land focus on the always-present close button rather than letting
          // it drop to <body> (the opener slot is gone on both arms).
          (this.deps.root().querySelector('[data-close]') as HTMLElement | null)?.focus();
        },
      },
    );
  }

  // Write the dragged item onto the DataTransfer (reproduced from the exported
  // hotbar encoder so cross-window drag state stays on the HUD via the deps).
  private writeDraggedAction(dt: DataTransfer | null, action: { type: 'item'; id: string }): void {
    if (!dt) return;
    dt.setData(HOTBAR_ACTION_MIME, encodeHotbarAction(action));
    dt.setData('text/plain', action.id);
  }
}
