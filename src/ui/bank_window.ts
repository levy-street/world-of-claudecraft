// Bank window painter: owns the #bank-window DOM and paints the pooled bank
// (the Gilded Strongbox deposit box) from the structured BankViewModel
// (bank_view.ts). The pure core decides which state the snapshot is in and what
// slots / empty cells / buy-row it shows; this thin consumer renders that and
// wires withdraw / buy-slots back through IWorld. It holds no Sim reference and
// reaches into Hud only through its deps.
//
// Cold, event-driven window (the MailboxWindow shape): innerHTML rebuild on open,
// on a real bank-data change, and on a language switch; the .bank-grid scroll
// offset is preserved across rebuilds; nothing bank-related runs per frame in
// Hud.update()'s hot path (the slow-band refreshIfChanged line mirrors mailbox).
//
// NON-modal companion of the bags window: the window itself installs no focus
// trap (the bags-style capture-and-return deps), and only the buy-slots confirm
// and withdraw-quantity prompts trap (their own Tab cycle, appended to
// #prompt-stack). No raw hex: the item-quality color comes from the shared
// QUALITY_COLOR map and the unranked fallback is the --color-quality-default token.

import { NATIVE_APP } from '../client_origin';
import { audio } from '../game/audio';
import { ITEMS } from '../sim/data';
import { guildBankRungsBought } from '../sim/guild_bank';
import { isItemLocked } from '../sim/item_lock';
import { vaultMaterialIds } from '../sim/materials_vault';
import type { IWorld } from '../world_api';
import { bagCornerMark, bagRimClasses } from './bag_corner_mark_view';
import {
  BAG_CATEGORIES,
  BAG_SORTS,
  type BagCategory,
  type BagFilterState,
  type BagSort,
  bagFilterIsDefault,
  DEFAULT_BAG_FILTER,
  parseBagFilter,
  serializeBagFilter,
} from './bag_filter';
import { bagFineMark } from './bag_fine_mark_view';
import { bagInstanceGlyphKind } from './bag_instance_glyph_view';
import { bankBonusSectionHtml } from './bank_bonus_view';
import { showBuyConfirmPrompt } from './bank_buy_prompt';
import { type BankScrollOffsets, planBankScrollRestore } from './bank_chrome_layout_core';
import { filterBankSlots } from './bank_filter';
import { bankMeterAriaLabel, bankMeterTooltipHtml } from './bank_meter_view';
import { showQuantityPrompt } from './bank_quantity_prompt';
import { BankRungPurchase } from './bank_rung_purchase_core';
import {
  bankRungClaudiumTagHtml,
  bankRungNoticeText,
  bankRungResultHtml,
  bankRungTopUpCopy,
  claudiumAmountText,
} from './bank_rung_view';
import { BankSocketPurchaseController } from './bank_socket_purchase_controller';
import {
  type BankBuySlotsModel,
  type BankClaudiumInput,
  type BankMeterModel,
  type BankSlotModel,
  type BankSocketCellModel,
  bankPoolsOf,
  bankSlotAction,
  buildBankView,
  type DepositAllPlan,
  depositAllSummaryKey,
  hasDepositableMaterials,
  planDepositAllMaterials,
} from './bank_view';
import type { ClaudiumPurchaseFacet } from './claudium_purchase_bridge';
import { formatCount } from './count_format';
import { markDialogRoot } from './dialog_root';
import { itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import { captureFocusKey, findFocusKey, focusedWithin, restoreFirstEnabled } from './focus_restore';
import { type GuildBankViewModel, guildBankSlotFocusKeys } from './guild_bank_view';
import {
  GUILD_PANEL_ID,
  GUILD_TAB_ID,
  type GuildBankPaneView,
  GuildBankTab,
} from './guild_bank_window';
import { formatMoney, type TranslationKey, t } from './i18n';
import { QUALITY_COLOR } from './icons';
import {
  cornerMarkHtml,
  INSTANCE_GLYPH_ARIA_KEYS,
  lockMarkHtml,
  UNKNOWN_INSTANCE_GLYPH_ARIA_KEYS,
} from './item_instance_glyph_mark';
import { knownItemDef } from './known_item';
import type { PainterHostPresentation } from './painter_host';
import {
  installPromptDialog as installModalPromptDialog,
  type PromptDialogHandle,
} from './prompt_dialog';
// The durable ledger factory, which owns the ONE key minter every
// Claudium-spending surface uses (a second minter is exactly the drift the
// packet warns about; see src/ui/purchase_intent_key.ts).
import { durableIntents, type PurchaseIntentLedger } from './purchase_intent_durability';
import { storageRungRefusalTargets } from './storage_rung_echo_core';
import { focusActiveTab, wireTabStrip } from './tab_strip_painter';
import { tabStripHtml, tabStripModel } from './tab_strip_view';
import { svgIcon } from './ui_icons';
import { unknownItemIconHtml } from './unknown_item_icon';
import { hasVaultDepositable, vaultSpecialContentKey } from './vault_view';
import { VAULT_PANEL_ID, VAULT_TAB_ID, VaultTab } from './vault_window';

// The unranked quality fallback as a CSS custom property. The shared QUALITY_COLOR
// map carries the real per-quality hex; this token covers an item with no quality
// field, so no raw hex lives in the painter (mirrors bags' --bag-slot-quality).
const QUALITY_DEFAULT_COLOR = 'var(--color-quality-default)';

// Grace before a null bankInfo closes the window: online the bank mirror rides the
// proximity snapshot, so it can lag the open by about a tick (copies the mailbox's
// MAIL_INFO_GRACE_MS semantics with a bank-named constant, same 3000 value).
const BANK_INFO_GRACE_MS = 3_000;

// The confirm / quantity prompts mount into #prompt-stack (outside #bank-window). A
// window-level close() removes any that are open so it never leaves an orphaned
// aria-modal dialog floating over the closed window.
const BANK_PROMPT_SELECTOR = '.bank-quantity-prompt, .bank-buy-prompt';
// Exported so the guild pane (guild_bank_window.ts), which shares this window's
// prompt classes and force-close teardown, can tear siblings down before
// mounting its own prompts.
//
// IT FIRES NO DISMISS HOOK, and which callers have to answer for that is stated
// here rather than left to be rediscovered. The node is removed directly, so
// bank_buy_prompt's onDismiss never runs on this path (its own comment used to
// claim otherwise; phase 17 corrected it). The two callers that can tear down a
// prompt the PLAYER left standing, close() and render(), therefore end the rung
// attempt themselves through BankRungPurchase.endPrompt().
//
// The other call sites deliberately do not, and the premise is load-bearing: the
// guild and vault panes' dismissPrompts deps and the dismissSiblings wirings all
// run while some OTHER prompt is being opened, and no other prompt can be opened
// while a rung confirm stands, because the confirm sets #bank-window inert.
// tests/bank_rung_purchase.test.ts pins that inert. showBuySlotsPrompt's own
// dismissSiblings is the one site that must NEVER end the attempt, because it
// runs immediately after arming it.
export function dismissBankPrompts(): void {
  for (const p of document.querySelectorAll(BANK_PROMPT_SELECTOR)) p.remove();
}

// The bank's window-local filter preferences persist under their OWN key, distinct
// from the bags' 'woc_bag_filter': the two windows share the state SHAPE (BagFilterState)
// and the tolerant serialize/parse, but keep independent category/sort choices. The
// SEARCH is per-visit only: close() resets the live value, persistFilter strips it
// from every write, and construction never restores it (and eagerly scrubs a
// non-empty stored query so storage never holds one even if the player never opens
// the bank this session). A reopened bank always starts unfiltered (a stale query
// silently hides slots). The bags window still keeps its search across sessions;
// aligning the family is a named follow-up, not an accident of this module.
const BANK_FILTER_KEY = 'woc_bank_filter';

// How long the transient deposit-all summary stays on screen before it clears. The
// summary is a polite aria-live status line INSIDE the window (the bank painter cannot
// reach Hud's toast without a hud.ts-wired deps callback, which the non-modal cluster
// forbids here), so it self-expires rather than lingering across later data refreshes.
const DEPOSIT_STATUS_MS = 4_000;

// The category chips and sort options REUSE the bags' generic label keys (All / Weapons
// / Recent / ...): those strings are not bags-specific, so duplicating them into the
// catalog would only add untranslated debt. The bank adds only its OWN aria labels
// (filterGroupAria / sortAria / searchAria) where the bags wording names "bags".
const BANK_CATEGORY_LABEL_KEYS: Record<BagCategory, TranslationKey> = {
  all: 'hudChrome.bags.filterAll',
  weapon: 'hudChrome.bags.filterWeapon',
  armor: 'hudChrome.bags.filterArmor',
  consumable: 'hudChrome.bags.filterConsumable',
  material: 'hudChrome.bags.filterMaterial',
  tool: 'hudChrome.bags.filterTool',
  quest: 'hudChrome.bags.filterQuest',
  mount: 'hudChrome.bags.filterMount',
};
const BANK_SORT_LABEL_KEYS: Record<BagSort, TranslationKey> = {
  recent: 'hudChrome.bags.sortRecent',
  quality: 'hudChrome.bags.sortQuality',
  name: 'hudChrome.bags.sortName',
};

/**
 * Hud-supplied glue. The icon/money/tooltip painters are the shared
 * PainterHostPresentation bag (Hud builds it once and hands it to every window that
 * renders item rows); this composes that base and adds the bank surface: the world
 * reads/commands, the non-trapping focus capture/return, and the close/teardown
 * chrome. The module never reaches into Hud directly and never hardcodes the
 * window id (always deps.root()).
 */
// `Partial<ClaudiumPurchaseFacet>` is the phase 13 addition: the four members of
// the shared Claudium spend seam (src/ui/claudium_purchase_bridge.ts), spread in
// whole by src/ui/hud.ts. OPTIONAL because they genuinely are: the offline
// browser world and the native builds construct this window with no Claudium
// anything, and the tag's absence there is the intended behavior rather than a
// degraded one.
export interface BankWindowDeps extends PainterHostPresentation, Partial<ClaudiumPurchaseFacet> {
  /** The #bank-window root (Hud owns the id; the painter stays instance-parameterized). */
  root(): HTMLElement;
  /** The live world (offline Sim or online ClientWorld mirror). */
  world(): IWorld;
  /** Close the sibling windows this one displaces (bank + bags cluster). */
  closeOthers(): void;
  hideTooltip(): void;
  /** True when this click is the release of a long-press tooltip peek, so the
   *  cell's withdraw must be SUPPRESSED (holding a cell to read its tooltip must
   *  not withdraw on release). Wired to the shared Hud TouchPeekGuard; a plain
   *  tap and every desktop click return false. */
  consumePeek(): boolean;
  // Non-modal focus capture/return (WCAG 2.4.3). The bank rides alongside the bags
  // window, so it does NOT trap focus; it only records its opener on open and returns
  // focus there on close. Wired to the FocusManager's activeFocusable / restore, NOT
  // the trap-installing windowFocus helper.
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  /** Hud teardown after close() (drop the body docking class, resync bags). */
  onClosed(): void;
  /** Nudge the Hud that a bank op just moved inventory or coin (withdraw, partial
   *  withdraw, deposit-all, buy-slots). Bank ops emit no client repaint event and the
   *  bags companion has no per-frame refresh, so the initiating window repaints it
   *  (the bags-side deposit idiom, see bags_window.ts). Offline the sim has already
   *  applied the op synchronously and this paint is the ONLY one; online it paints the
   *  still-stale mirror harmlessly and the snapshot echo repaints again
   *  authoritatively (main.ts consumeInventoryChanged). */
  onInventoryChanged(): void;
}

/** The three bank panes. The Guild tab exists only while guildBankInfo is
 *  non-null (any guild member at a banker, online with the book loaded;
 *  canEdit gates the actions); the Vault tab exists only while vaultInfo is
 *  non-null (standing at a banker, both hosts). */
export type BankTabId = 'personal' | 'vault' | 'guild';

export class BankWindow {
  private opened = false;
  private lastSig = '';
  private openerFocus: HTMLElement | null = null;
  private openedAt = 0;

  // Which pane is showing. Guild is reachable only while the strip renders
  // (guildBankInfo non-null); any render that finds it gone falls back to
  // Personal, and close() resets it so a reopened bank never starts on a
  // pane that may no longer exist.
  private tab: BankTabId = 'personal';
  // The pane the LAST paint drew, so the .bank-scroll offset is restored only
  // within one pane (a tab switch starts at the top, never mid-list).
  private lastRenderedTab: BankTabId = 'personal';
  // ...and which GUILD sub-view it drew, for the same reason one level down:
  // the contents grid and the log list both mount a .bank-scroll, so without
  // this the grid's offset would be pasted onto the log the moment a player
  // switched between them.
  private lastRenderedGuildView: GuildBankPaneView = 'contents';
  // The guild pane painter (guild_bank_view.ts core + guild_bank_window.ts),
  // sharing this window's presentation bag and prompt-dialog chrome.
  private readonly guildPane: GuildBankTab;
  // The Materials Vault pane (vault_view.ts core + vault_window.ts), on the
  // same composition terms.
  private readonly vaultPane: VaultTab;

  // Window-local filter state: category chips + sort persist across sessions under
  // BANK_FILTER_KEY; the live search is per-visit and starts empty even when a
  // reload while the bank sat open left a query in storage (close() never ran, see
  // BANK_FILTER_KEY). A non-empty stored search is also rewritten out at boot so
  // storage never holds a stranded query when the player never opens the bank.
  // Pure logic lives in bank_filter.ts (reusing bag_filter.ts); this is the
  // consumer. Tolerant parse: corrupt storage falls back to the default filter,
  // never throwing.
  private filter: BagFilterState = (() => {
    try {
      const parsed = parseBagFilter(localStorage.getItem(BANK_FILTER_KEY));
      const next = { ...parsed, search: '' };
      // Scrub a legacy or reload-stranded query at construction so storage never
      // holds a search value even if the player never opens the bank this session.
      // Category/sort stay; private-mode write failures are ignored like persistFilter.
      if (parsed.search !== '') {
        try {
          localStorage.setItem(BANK_FILTER_KEY, serializeBagFilter(next));
        } catch {
          /* storage unavailable (private mode); live state is still search-free */
        }
      }
      return next;
    } catch {
      return { ...DEFAULT_BAG_FILTER };
    }
  })();

  // The transient deposit-all summary and its self-expire timer. Rendered as a polite
  // aria-live line; re-painted (while fresh) across data-driven rebuilds so a repaint
  // that lands after the online mirror catches up does not swallow the feedback.
  private depositStatus: { text: string; at: number } | null = null;
  private statusTimer: number | null = null;

  // In-flight guard for deposit-all: the ONLINE mirror lags the sent commands by about
  // a tick, so a rapid second click would re-plan from the STALE mirror and re-send
  // slot indices the server has already spliced, banking whatever shifted into them
  // (the wrong-item class the stale-index prompt guard exists for). The button
  // stays disabled from send until the mirror echoes (refreshIfChanged sees a new data
  // signature) or the fallback timer clears a lost echo.
  private depositAllPending = false;
  private depositAllTimer: number | null = null;

  // The consent/echo latch survives close; only its transient status is reset.
  private readonly socketPurchase = new BankSocketPurchaseController({
    timers: {
      schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
      cancel: (handle) => window.clearTimeout(handle),
    },
    current: () => this.deps.world().bankInfo,
    send: () => {
      this.deps.world().bankUnlockSocket();
      audio.coin();
      this.deps.onInventoryChanged();
    },
    repaint: () => {
      if (this.opened) this.render();
    },
    root: () => this.deps.root(),
    installPromptDialog: (prompt, opener, close) => this.installPromptDialog(prompt, opener, close),
    dismissSiblings: dismissBankPrompts,
  });

  // --- The banker's Claudium rung purchase (Bank Storage phase 13) ---------
  // The money state machine lives in src/ui/bank_rung_purchase_core.ts (ruling
  // 30, taken by phase 17): the intent ledger, the sent latch, the in-flight
  // SKU, the result band, the confirm latch and the one-per-open re-prompt cap,
  // plus the spend and its refusal handling. What stays here is what needs the
  // WINDOW: the confirm prompt, the focus capture and return, the live-DOM busy
  // write, the live-region announcement, the repaint and the top-up handoff.
  //
  // The LEDGER is constructed here rather than in the controller, and stays one
  // line for one line. It is the same durable ledger the store's charter flow
  // uses, and the spelling below is what
  // tests/woc_store_window_contract.test.ts's ruling-19 pin reads for: reverting
  // either spending window to a memory-only ledger re-opens the double charge
  // phase 16 closed, so the pin names both windows and this line keeps meaning
  // what it says.
  private readonly rungIntents: PurchaseIntentLedger = durableIntents(() => this.deps.world());
  private readonly rungPurchase = new BankRungPurchase({
    intents: this.rungIntents,
    // The storage KIND is supplied HERE, at the one call site, so the wire
    // literal stays where a source pin over this painter can still read it.
    spend: (skuId, cost, key) => this.deps.spendStoreItem?.(skuId, 'storage', cost, key),
    isOpen: () => this.opened,
    setBusy: (busy) => this.setRungBusy(busy),
    repaint: () => this.repaintAfterRung(),
    currentOffer: () => this.currentRungOffer(),
    reprompt: (buy) => this.showBuySlotsPrompt(buy),
    needMoreClaudium: (blockSlots, cost, balance) =>
      this.openNeedMoreClaudiumDialog(blockSlots, cost, balance),
    coin: () => audio.coin(),
  });
  // The control that owned focus when the confirm prompt opened, captured
  // BEFORE it opens (see showBuySlotsPrompt) and consumed by the post-result
  // repaint. Window state, not purchase state: the controller answers WHETHER a
  // prompt abandoned an intent and this decides what that does to focus.
  //
  // EQUIVALENT-MUTANT NOTE, recorded so a later reader does not hunt for the arms
  // that pin the clear. It rides THREE sites now (the prompt's dismiss hook,
  // close() and render()), and removing it at any of them changes no reachable
  // outcome TODAY: the only consumer is repaintAfterRung, every path to a spend
  // goes through showBuySlotsPrompt, and that re-captures this key
  // unconditionally on the way in. So the key's real bound is the re-arm plus
  // close(), and the clear is defence in depth. That it is bounded by a
  // coincidence rather than by a stated rule is the StoreFocusStash shape
  // (src/ui/store_focus_policy.ts) and is recorded rather than taken here.
  private rungFocusReturnKey: string | null = null;
  // The monotonic sequence that keeps an identical repeated message announcing.
  private rungAnnounceSeq = 0;

  constructor(private readonly deps: BankWindowDeps) {
    this.guildPane = new GuildBankTab({
      root: () => this.deps.root(),
      world: () => this.deps.world(),
      itemIcon: (item) => this.deps.itemIcon(item),
      moneyHtml: (copper) => this.deps.moneyHtml(copper),
      itemTooltip: (item, instance) => this.deps.itemTooltip(item, instance),
      attachTooltip: (el, html) => this.deps.attachTooltip(el, html),
      hideTooltip: () => this.deps.hideTooltip(),
      consumePeek: () => this.deps.consumePeek(),
      onInventoryChanged: () => this.deps.onInventoryChanged(),
      installPromptDialog: (prompt, opener, close) =>
        this.installPromptDialog(prompt, opener, close),
      dismissPrompts: () => dismissBankPrompts(),
      requestRender: () => {
        if (this.opened) this.render();
      },
    });
    this.vaultPane = new VaultTab({
      root: () => this.deps.root(),
      world: () => this.deps.world(),
      itemIcon: (item) => this.deps.itemIcon(item),
      moneyHtml: (copper) => this.deps.moneyHtml(copper),
      itemTooltip: (item, instance) => this.deps.itemTooltip(item, instance),
      attachTooltip: (el, html) => this.deps.attachTooltip(el, html),
      hideTooltip: () => this.deps.hideTooltip(),
      consumePeek: () => this.deps.consumePeek(),
      onInventoryChanged: () => this.deps.onInventoryChanged(),
      installPromptDialog: (prompt, opener, close) =>
        this.installPromptDialog(prompt, opener, close),
      dismissPrompts: () => dismissBankPrompts(),
      requestRender: () => {
        if (this.opened) this.render();
      },
    });
  }

  get isOpen(): boolean {
    return this.opened;
  }

  /** True while the window is open on the PERSONAL pane: the bags companion
   *  reads this (via Hud) to route a bag click to bankDeposit.
   *
   *  It is deliberately NOT "open and not on the guild CONTENTS view": the
   *  guild pane's Log view is a reading surface, and while it shows, the
   *  personal grid is off screen behind it exactly like the guild grid is. A
   *  bag click there must arm NEITHER deposit, or reading the history silently
   *  banks the item that was clicked, which is the same trap guildTabActive
   *  documents below. */
  get personalTabActive(): boolean {
    return this.opened && this.tab === 'personal';
  }

  /** True while the window is open on the Guild pane: the bags companion
   *  reads this (via Hud) to route a bag click to guildBankDeposit. Also
   *  requires guildBankInfo to be live RIGHT NOW, so the one-frame window
   *  between the mirror nulling (walk-away, guild loss) and the slow-band
   *  repaint can never route a bag click at the guild facet. */
  get guildTabActive(): boolean {
    return (
      this.opened &&
      this.tab === 'guild' &&
      // ONLY the contents view routes bag clicks. The log is a reading surface:
      // a bag click while the player is reading the history must not silently
      // deposit the item they clicked (the whole point of that routing is that
      // the guild grid is on screen to drop into).
      this.guildPane.activeView === 'contents' &&
      // A READ-ONLY viewer's contents pane is a reading surface too (every
      // member sees the bank, only officer-plus may deposit): their bag click
      // must not arm the guild deposit, so it falls to the same speak-path the
      // Log view uses (bankOpen stays true, both deposit modes stay off).
      (this.deps.world().guildBankInfo?.canEdit ?? false)
    );
  }

  /** True while the window is open on the Vault pane with the vault UNLOCKED:
   *  the bags companion reads this (via Hud) to route a bag click to
   *  vaultDeposit. The LOCKED pane is a purchase surface, not a deposit
   *  target, so it arms nothing (bankOpen stays true and the click falls to
   *  the no-target speak-path, the guild Log rule); requiring the live
   *  vaultInfo also closes the one-frame window between the mirror nulling
   *  and the slow-band repaint, the guildTabActive rule. */
  get vaultTabActive(): boolean {
    return this.opened && this.tab === 'vault' && this.vaultPane.unlocked;
  }

  /** Observe raw authoritative refusals before Hud translates their text. */
  observeStorageText(text: string): string {
    const target = storageRungRefusalTargets(text);
    const socketCleared = this.socketPurchase.observeText(text);
    const guildCleared = target.guild ? this.guildPane.onDefinitivePurchaseRefusal() : false;
    const vaultCleared = target.vault ? this.vaultPane.onDefinitivePurchaseRefusal() : false;
    if ((socketCleared || guildCleared || vaultCleared) && this.opened) {
      this.render();
    }
    return text;
  }

  // Re-interacting with the banker while already open must not re-run the open
  // bookkeeping: re-capturing openerFocus could record a node INSIDE this window
  // (returned-to after close, i.e. destroyed), and a fresh render would tear an
  // open prompt down for no reason. Data changes ride refreshIfChanged.
  open(): void {
    if (this.opened) return;
    this.deps.closeOthers();
    this.openerFocus = this.deps.captureFocus();
    this.opened = true;
    this.lastSig = '';
    this.openedAt = performance.now();
    // Reset the one-per-open re-prompt cap on the way IN too: close() alone
    // leaves a refusal that resolved after the close holding the next open's cap.
    this.rungPurchase.resetRepromptCap();
    // Warm the lazy material-set memo on the open path: its first derive walks
    // the recipe/enchant/item tables, and without this the walk lands inside
    // the first bag CLICK or tooltip hover instead of here (a one-time hitch,
    // but the open already pays for a full render so it hides better).
    vaultMaterialIds();
    this.render();
    this.deps.root().style.display = 'flex';
    audio.bagOpen();
  }

  close(): void {
    if (!this.opened) return;
    // A confirm / quantity prompt is a modal CHILD that sets #bank-window inert. The
    // window can be force-closed out from under it (Esc / keybind), a path that never
    // runs the prompt's dismiss(); tear any open prompt down here so it is not left an
    // orphaned aria-modal dialog, then clear the inert it set (a hidden window must
    // never stay inert or the next open shows a dead grid).
    dismissBankPrompts();
    // ...and END the rung attempt that prompt belonged to. dismissBankPrompts
    // removes the NODE, so bank_buy_prompt's own dismiss hook never fires on this
    // path: without this line an unsent Claudium intent survives the close with
    // its cost FROZEN, and phase 16 made that record DURABLE, so it now outlives
    // the page too. Idempotent, so running it on every close is free.
    if (this.rungPurchase.endPrompt()) this.rungFocusReturnKey = null;
    // Drop any pending deposit-all summary (and its timer) so a reopened bank never
    // flashes a stale line, and no late timer fires render() on the hidden window.
    this.clearDepositStatus();
    this.clearDepositAllPending();
    // Drop the purchase-result band and the focus stash. The in-flight SPEND is
    // deliberately NOT cancelled and its intent is deliberately NOT dropped: a
    // request already on the wire may be sitting behind a live debit, so the key
    // must survive the close and let the next attempt replay under it. What is
    // cleared is only what would otherwise paint a stale result on the next open.
    this.rungPurchase.clearNotice();
    this.socketPurchase.clearStatus();
    this.rungFocusReturnKey = null;
    this.rungAnnounceSeq++;
    this.rungPurchase.resetRepromptCap();
    // The search is a per-visit filter: left set, the next open would start
    // pre-narrowed to a stale query (slots hidden with no cue why). Reset the
    // live value; the persist rewrite also scrubs any legacy pre-fix query out
    // of storage (persistFilter never stores the search). Category/sort stay.
    this.filter.search = '';
    this.persistFilter();
    const el = this.deps.root();
    el.style.display = 'none';
    el.inert = false;
    this.opened = false;
    // Walking away (or any close) empties the Guild tab state cleanly: the
    // next open starts on Personal, never on a pane that may no longer exist.
    this.tab = 'personal';
    this.lastRenderedTab = 'personal';
    // ...including the Guild pane's own sub-view: a reopened bank starts on the
    // contents, so the log is never refetched by an open the player did not
    // aim at it.
    this.guildPane.resetView();
    this.lastRenderedGuildView = 'contents';
    // ...and the Vault pane's transient state (summary line, pending guard),
    // so a reopened bank never flashes a stale line.
    this.vaultPane.reset();
    this.deps.hideTooltip();
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
    this.deps.onClosed();
  }

  private clearDepositStatus(): void {
    if (this.statusTimer !== null) {
      window.clearTimeout(this.statusTimer);
      this.statusTimer = null;
    }
    this.depositStatus = null;
  }

  private clearDepositAllPending(): void {
    if (this.depositAllTimer !== null) {
      window.clearTimeout(this.depositAllTimer);
      this.depositAllTimer = null;
    }
    this.depositAllPending = false;
  }

  render(): void {
    const el = this.deps.root();
    // A rebuild invalidates any open prompt (its localized text and its captured
    // slot index go stale against the fresh data/language) and destroys the focused
    // node. Tear prompts down first, clearing the inert they set, and remember
    // whether focus was inside the window or a prompt so it can re-land on the
    // fresh close button instead of dropping to <body> (WCAG 2.4.3).
    const active = document.activeElement as HTMLElement | null;
    // focusedWithin, not a bare root-containment check: the pointer-only focus
    // drop parks pointer focus on this root, and the parked root is not a control
    // to re-land on (it resolves no key and would take the close-button fallback).
    const hadFocus = focusedWithin(el) !== null || active?.closest(BANK_PROMPT_SELECTOR) != null;
    // Search focus survives a FULL rebuild too: the slow-band refreshIfChanged can
    // land a data repaint (a deposit's echo) moments after the player focused the
    // search box, and stealing focus to the close button mid-typing was a live bug
    // (proven by the online browser smoke probe). The fresh input's value is restored from
    // this.filter.search, so only focus + caret need carrying across.
    const searchEl = el.querySelector('.bag-search') as HTMLInputElement | null;
    const searchFocus =
      searchEl !== null && active === searchEl
        ? { start: searchEl.selectionStart, end: searchEl.selectionEnd }
        : null;
    // The focused control's identity (data-focus-key), captured BEFORE the wipe:
    // the guild refresh arm repaints on ANY officer's op, so an external echo
    // must not yank a keyboard user off the tab, cell, or button they were on.
    // Guild controls carry keys (guild_bank_window.ts + the tab annotation
    // below); personal controls keep the close-button fallback, except the
    // meter (bank:meter), whose whole payload is focus-revealed.
    const focusKey = hadFocus ? captureFocusKey(el) : null;
    if (document.querySelector(BANK_PROMPT_SELECTOR)) {
      dismissBankPrompts();
      // The SAME teardown close() performs, and the reachable one: render() takes
      // this branch whenever the repaint signature moves with a confirm open, and
      // the prompt's own dismiss hook does not see a raw node removal.
      if (this.rungPurchase.endPrompt()) this.rungFocusReturnKey = null;
      el.inert = false;
    }
    this.deps.hideTooltip();
    markDialogRoot(el, { label: t('hudChrome.bank.title') });
    // WHICH element scrolls depends on the viewport (bank_chrome_layout_core.ts):
    // the .bank-scroll region normally, the window itself in the short-phone
    // compact regime. Both are recreated or clamped by a rebuild, so both are
    // captured here and both are written back, else a withdraw snaps the list
    // back to the top (the bags idiom) on one viewport and not the other.
    const prevScroll = this.captureScroll(el);
    const bankInfo = this.deps.world().bankInfo;
    this.socketPurchase.observeRevision(bankInfo?.socketsUnlocked);
    const model = buildBankView(bankInfo, (id) => knownItemDef(ITEMS, id), this.claudiumInput());
    // The Guild tab exists ONLY while guildBankInfo is non-null (any guild
    // member at a banker, online, book loaded; a plain member's pane renders
    // read-only). When it goes away mid-open (leave,
    // kick, a reconcile window), the strip disappears and the pane falls back
    // to Personal on this same paint; the whole-window walk-away close stays
    // refreshIfChanged's grace-close on bankInfo.
    const guildModel = this.guildPane.model();
    const guildAvailable = guildModel.kind !== 'hidden'; // opened OR unopened pane
    if (!guildAvailable) {
      // Only the GUILD tab falls back: an unconditional reset here would
      // clobber the Vault tab for every guildless player (it did, in this
      // phase's first cut; tests/vault_window.test.ts pins the fix).
      if (this.tab === 'guild') this.tab = 'personal';
      // ...and drop the pane's OWN sub-view with it, the way close() does. The
      // log view is the one that fetches: leaving it selected on a pane that no
      // longer exists left a demoted client re-requesting a log the server
      // refuses, once per TTL, forever.
      this.guildPane.resetView();
    }
    // The Vault tab follows the guild collapse rule: it exists only while
    // vaultInfo is non-null (nearBanker in both hosts, the same gate as
    // bankInfo, so a lone one-tick null cannot outlive the whole-window grace
    // above), and the active tab snaps back to Personal when it disappears.
    // Availability is the null test alone; the full model (a sort plus two
    // catalog lookups per stocked material) is built only on the vault arm
    // below, where it is actually painted. LOOSE != so an undefined member
    // (a world double that predates the vault, or a host that never wires
    // it) reads unavailable exactly like the pure core's falsy test did:
    // a strict !== null renders a spurious tab for undefined.
    const vaultAvailable = this.deps.world().vaultInfo != null;
    if (!vaultAvailable && this.tab === 'vault') this.tab = 'personal';
    el.innerHTML =
      `<div class="panel-title"><span>${esc(t('hudChrome.bank.title'))} <span class="panel-subtitle">${esc(t('hudChrome.bank.subtitle'))}</span></span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.bank.close'))}">${svgIcon('close')}</button></div>`;
    el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    if (guildAvailable || vaultAvailable) {
      // The shared WAI-ARIA tab strip (tab_strip_view core + wireTabStrip),
      // the social/talents idiom. The PERSONAL pane's sections still mount
      // directly on the window root (wrapping them would disturb the flex
      // column the bank CSS sizes), so the strip carries no blanket `panelId`;
      // the GUILD and VAULT panes do build a real role=tabpanel (the guild one
      // holds a nested tab list of its own, and a lone unwrapped peer would
      // read as a second unrelated top level to a screen reader). Their
      // aria-controls are stamped below, once each panel exists.
      el.insertAdjacentHTML(
        'beforeend',
        tabStripHtml(
          tabStripModel({
            ariaLabel: t('hudChrome.bank.tabsAria'),
            stripClass: 'bank-tabs',
            tabClass: 'bank-tab',
            selectedClass: 'on',
            tabs: [
              { id: 'personal', label: t('hudChrome.bank.personalTab') },
              // The two conditional tabs carry stable button ids so their
              // panels can point aria-labelledby back at them. The vault sits
              // between Personal and Guild: both personal stores first, the
              // shared one last.
              ...(vaultAvailable
                ? [{ id: 'vault', label: t('hudChrome.bank.vaultTab'), buttonId: VAULT_TAB_ID }]
                : []),
              ...(guildAvailable
                ? [{ id: 'guild', label: t('hudChrome.bank.guildTab'), buttonId: GUILD_TAB_ID }]
                : []),
            ],
            selected: this.tab,
          }),
        ),
      );
      wireTabStrip(el, 'bank-tab', (id, focusFollow) => {
        if (id !== 'personal' && id !== 'guild' && id !== 'vault') return;
        if (this.tab !== id) audio.click();
        this.tab = id;
        this.render();
        if (focusFollow) focusActiveTab(this.deps.root(), 'bank-tab', 'on');
      });
      // Key the tab buttons so a repaint keeps focus on the tab the user was
      // on (the shared strip carries data-tab; the key namespace is ours).
      for (const tab of el.querySelectorAll<HTMLElement>('.bank-tab')) {
        tab.dataset.focusKey = `tab:${tab.dataset.tab}`;
      }
    }
    // A status timer armed while the vault pane was showing must not outlive
    // the pane onto another tab, where its firing would rebuild the whole
    // window for a line nobody can see.
    if (this.tab !== 'vault') this.vaultPane.pauseStatusTimer();
    if (this.tab === 'vault') {
      this.vaultPane.renderInto(el, this.vaultPane.model());
      // Close the tab/panel relationship now that the panel exists (the guild
      // pane's aria-controls rule below).
      const vaultTab = el.querySelector<HTMLElement>(`#${VAULT_TAB_ID}`);
      if (vaultTab && el.querySelector(`#${VAULT_PANEL_ID}`)) {
        vaultTab.setAttribute('aria-controls', VAULT_PANEL_ID);
      }
      this.annotateVaultFocusKeys(el);
      this.restoreScroll(el, prevScroll);
      if (hadFocus) this.restoreControlFocus(el, focusKey);
      return;
    }
    if (this.tab === 'guild') {
      this.guildPane.renderInto(el, guildModel);
      // Close the tab/panel relationship now that the panel exists: without it
      // the pane's own Contents/Log strip reads to assistive tech as a second,
      // unrelated top-level tab list that appeared out of nowhere.
      const guildTab = el.querySelector<HTMLElement>(`#${GUILD_TAB_ID}`);
      if (guildTab && el.querySelector(`#${GUILD_PANEL_ID}`)) {
        guildTab.setAttribute('aria-controls', GUILD_PANEL_ID);
      }
      this.annotateGuildFocusKeys(el, guildModel);
      this.restoreScroll(el, prevScroll);
      // The guild pane has no search box, so a searchFocus capture degrades
      // through the key ladder to the close button, never to <body>.
      if (hadFocus) this.restoreControlFocus(el, focusKey);
      return;
    }
    if (model.kind === 'away') {
      const away = document.createElement('div');
      away.className = 'bank-empty';
      away.textContent = t('hudChrome.bank.tooFar');
      el.appendChild(away);
      this.lastRenderedTab = this.tab;
      if (hadFocus) this.restoreControlFocus(el, focusKey);
      return;
    }
    // The bag-socket row (Bank Storage phase 07) sits above the toolbar: one
    // fixed-height strip (flex: none, the family's 40px cells), so at the
    // 360px-tall phone budget the scroll-region relocation below was measured
    // against it costs the grid one rigid band, absorbed because the grid
    // SCROLLS (the shared .bank-scroll region keeps every cell reachable on
    // any viewport; tests/mobile_window_coverage.test.ts holds the window's
    // coverage). The used/total readout lives in the footer meter below
    // (phase 08): no separate capacity band above the toolbar any more.
    el.appendChild(this.buildSocketRow(model.sockets));
    this.socketPurchase.appendStatus(el);
    // Always mount the toolbar in the bank state: the deposit-all button belongs there
    // even over an empty bank, while buildFilterBar drops the search/category/sort
    // controls when there is nothing yet to filter.
    el.appendChild(this.buildFilterBar(model.empty));
    const status = this.buildDepositStatus();
    if (status) el.appendChild(status);
    // One shared scroll region holds the grid plus the bonus breakdown as its tail:
    // at a 360px-tall phone the rigid chrome (title, socket row, toolbar,
    // footer (meter + buy)) leaves less than one cell row of flex space, so a
    // fixed below-the-buy-row footer either crushed the grid or clipped itself
    // (found live in QA); the phase 08 meter rides INSIDE that existing footer
    // band rather than adding a sixth band, so the 360px budget still holds.
    // Scrolling past the last cells reaches the bonus copy on every viewport, and
    // the transactional footer stays pinned below, visible everywhere the pane
    // itself fits its box (KNOWN BOUND, pre-existing: a stocked bank's rigid
    // chrome alone can overflow a ~390px-tall phone and clip the grid and this
    // footer, exactly as it clipped the old buy row; the structural deferral
    // and evidence live in hud.mobile.css and the bank-storage state ledger).
    const scroll = document.createElement('div');
    scroll.className = 'bank-scroll';
    const grid = document.createElement('div');
    grid.className = 'bank-grid';
    this.fillGrid(grid, model.slots, model.emptyCells, model.empty);
    scroll.appendChild(grid);
    // The bonus-slot breakdown is present only online (bonusSources is [] offline);
    // it advertises what account links earn. The core answers the empty string
    // there, which is a no-op at this one mount.
    scroll.insertAdjacentHTML('beforeend', bankBonusSectionHtml(model.bonus));
    el.appendChild(scroll);
    el.appendChild(this.buildFooter(model.meter, model.buy));
    // AFTER the footer: in the compact regime the window is the scroller, and a
    // write against a pane one band short clamps to that height and stays.
    this.restoreScroll(el, prevScroll);
    if (searchFocus) {
      const fresh = el.querySelector('.bag-search') as HTMLInputElement | null;
      if (fresh) {
        // preventScroll: the offset was just restored and on a short phone this
        // box can sit far above the fold (focus_restore.ts records the why).
        fresh.focus({ preventScroll: true });
        fresh.setSelectionRange(searchFocus.start, searchFocus.end);
      } else if (hadFocus) {
        // The rebuild dropped the search box (the bank emptied): fall back to the
        // close button rather than dropping focus to <body>.
        (el.querySelector('[data-close]') as HTMLElement | null)?.focus();
      }
    } else if (hadFocus) {
      this.restoreControlFocus(el, focusKey);
    }
  }

  // Stamp the guild pane's controls with their focus keys AFTER renderInto
  // returned: the shared data-focus-key namespace stays inside this module,
  // the one that imports focus_restore (the single-reader guard in
  // tests/focus_restore.test.ts), and the pane stays focus-agnostic. Cells are
  // keyed by semantic item/copy identity. Duplicate-group cardinality is part
  // of that key, so an ambiguous disappearing twin safely falls back instead
  // of transferring focus to a different physical copy.
  private annotateGuildFocusKeys(el: HTMLElement, model: GuildBankViewModel): void {
    // The Contents / Log sub-strip first: the log repaints on ANY officer's op
    // (its cache busts and the response lands), so a keyboard user reading it
    // must not be thrown off the strip by somebody else's deposit.
    for (const tab of el.querySelectorAll<HTMLElement>('.gbank-view-tab')) {
      tab.dataset.focusKey = `gbank:view:${tab.dataset.tab}`;
    }
    const slotKeys = model.kind === 'guild' ? guildBankSlotFocusKeys(model.slots) : [];
    // A key miss stamps NOTHING: '' would still satisfy the restore ladder.
    el.querySelectorAll<HTMLElement>('.bank-grid .bank-item:not(.empty)').forEach((cell, i) => {
      if (slotKeys[i] !== undefined) cell.dataset.focusKey = slotKeys[i];
    });
    const [deposit, withdraw] = Array.from(el.querySelectorAll<HTMLElement>('.gbank-gold-btn'));
    if (deposit) deposit.dataset.focusKey = 'gbank:deposit-gold';
    if (withdraw) withdraw.dataset.focusKey = 'gbank:withdraw-gold';
    const buy = el.querySelector<HTMLElement>('.bank-buy-btn');
    if (buy) buy.dataset.focusKey = 'gbank:buy';
  }

  // VaultTab owns semantic row/action keys because it has the row model in
  // hand. This window adds only its fixed footer controls after renderInto.
  private annotateVaultFocusKeys(el: HTMLElement): void {
    const deposit = el.querySelector<HTMLElement>('.vault-deposit-all');
    if (deposit) deposit.dataset.focusKey = 'vault:deposit-all';
    const unlock = el.querySelector<HTMLElement>('.vault-unlock-btn');
    if (unlock) unlock.dataset.focusKey = 'vault:unlock';
    const upgrade = el.querySelector<HTMLElement>('.vault-upgrade-btn');
    if (upgrade) upgrade.dataset.focusKey = 'vault:upgrade';
  }

  // Re-land focus after a full rebuild: the control the user was on (resolved
  // by its data-focus-key in the fresh tree, skipped when it came back
  // disabled), else the always-present close button. Never <body> (WCAG 2.4.3).
  private restoreControlFocus(el: HTMLElement, focusKey: string | null): void {
    restoreFirstEnabled([
      focusKey ? findFocusKey(el, focusKey) : null,
      el.querySelector('[data-close]') as HTMLElement | null,
    ]);
  }

  // Both candidate offsets, read off whichever elements exist right now; which
  // one is live depends on the viewport (bank_chrome_layout_core.ts owns why).
  private captureScroll(el: HTMLElement): BankScrollOffsets {
    const scroll = el.querySelector('.bank-scroll') as HTMLElement | null;
    return { inner: scroll?.scrollTop ?? 0, outer: el.scrollTop };
  }

  // Reapply the captured offsets to the freshly built pane, but only within one
  // pane (a tab switch starts at the top, never mid-list), and latch which pane
  // this paint drew. planBankScrollRestore owns that decision; every render path
  // that mounts a scroll region routes through here so the offset can never leak
  // across panes.
  private restoreScroll(el: HTMLElement, prev: BankScrollOffsets): void {
    const view = this.guildPane.activeView;
    const next = planBankScrollRestore(
      prev,
      { tab: this.lastRenderedTab, guildView: this.lastRenderedGuildView },
      { tab: this.tab, guildView: view },
    );
    const scroll = el.querySelector('.bank-scroll') as HTMLElement | null;
    if (scroll) scroll.scrollTop = next.inner;
    el.scrollTop = next.outer;
    this.lastRenderedTab = this.tab;
    this.lastRenderedGuildView = view;
  }

  // Per-frame (slow divider): refresh the grid when the mirror changes; close when the
  // player walks away from the banker (the mirror goes null past BANKER_RANGE).
  refreshIfChanged(): void {
    if (!this.opened) return;
    const info = this.deps.world().bankInfo;
    if (!info) {
      if (performance.now() - this.openedAt > BANK_INFO_GRACE_MS) this.close();
      return;
    }
    // The guild half rides the same signature: a guild op echo, an expansion,
    // the tab APPEARING or DISAPPEARING (guild loss, reconcile window), and a
    // canEdit flip (promotion or demotion at the banker: the buttons, action
    // rows, note, and bag-click routing all change with it) each repaint; null
    // collapses the whole guild arm so the strip drops and
    // the pane falls back to Personal in render(). Deliberately purse-free
    // (the guild enablement reads snapshot state only, see guild_bank_view.ts)
    // with ONE exception, scoped exactly like the vault purse term below:
    // only while the guild pane is SHOWING, the bank is UNOPENED
    // (purchasedSlots 0), the viewer may edit, AND a rung-0 price is quoted
    // does the open-the-bank row's shortfall marker join, and as an
    // AFFORDABILITY BOOLEAN, so ordinary copper churn never repaints the
    // pane (a read-only member or a priceless snapshot has no open row, so
    // their pane stays purse-free).
    // Nesting the guild arm under the bankInfo null-gate above is safe because
    // guildBankInfoFor's gate is a strict SUPERSET of bankInfoFor's (same
    // banker proximity, plus alive + guild membership + a loaded book):
    // guildBank can never be non-null while bankInfo is null.
    const g = this.deps.world().guildBankInfo;
    // The vault arm rides the same signature, CONTENT-keyed and never
    // identity-keyed. Identity is the wrong signal in BOTH directions:
    // offline, Sim.vaultInfoFor mints a FRESH clone on every read, so an
    // identity check would repaint the window on every poll (thrash); online,
    // ClientWorld adopts the wire object by reference and a stock key-order
    // churn (jsonb, or a full withdraw-then-redeposit) can re-ship an
    // unchanged vault as a new object (a spurious repaint). So the entries
    // are SORTED before serializing and the content string is the signal.
    // The stock term is scoped to the vault pane like the purse read below:
    // no other tab renders stock, so the sort never runs on their polls (the
    // first poll after entering the tab repaints once as the term joins;
    // harmless at the slow band). The one purse read is scoped like the
    // guild arm's: only while the vault pane is showing AND a next rung is
    // on offer does affordability join (as a boolean, so ordinary copper
    // churn never repaints the pane).
    const v = this.deps.world().vaultInfo;
    const sig = JSON.stringify([
      info.capacity,
      info.purchasedSlots,
      info.bonusSlots,
      info.nextExpansionCost,
      // The footer meter's own terms (Bank Storage phase 08): the meter reads
      // the wire split directly, and the split can move while every other
      // term holds (a server-side reclassification or allocation-rule change
      // moves pool numbers with capacity, slots, and socketBags unchanged),
      // the socket-terms precedent below.
      info.generalCapacity,
      info.materialsCapacity,
      info.generalUsed,
      info.materialsUsed,
      // The socket row's own terms (Bank Storage phase 07): an unlock moves
      // ONLY socketsUnlocked and nextSocketCost (an empty socket adds zero
      // capacity), and a same-size bag swap moves socketBags while capacity
      // holds, so without these three the row sits stale until unrelated
      // bank data happens to move, the exact failure mode this signature's
      // buy-button comment documents.
      info.socketsUnlocked,
      info.socketBags,
      info.nextSocketCost,
      // The Claudium tag's own terms (Bank Storage phase 13). The WIRED price
      // moves entirely on its own: the server re-joins its cached service
      // catalog every snapshot, so a retune, a service outage and a recovery
      // each change ONLY this field while capacity, slots and every other term
      // above hold. Without it the tag would sit at a stale price, or linger
      // after the service went away, until unrelated bank data happened to move.
      info.nextRungClaudiumPrice ?? null,
      // ...and the one host fact the wire cannot carry. `storeEnabled` flips
      // when main.ts attaches the economy hooks after the online handshake,
      // which is AFTER a bank opened at a bursar on a fast join. NATIVE_APP is
      // a build constant and needs no term of its own. There is deliberately no
      // affordability term: nothing on screen changes with it (bank_view.ts), so
      // phase 13's term only forced zero-pixel rebuilds whenever a balance
      // crossed the price.
      this.deps.storeEnabled?.() === true,
      info.slots,
      v && [
        v.upgrades,
        v.perMaterialCap,
        v.nextUpgradeCost,
        this.tab === 'vault' ? Object.entries(v.stock).sort() : null,
        this.tab === 'vault' ? vaultSpecialContentKey(v.special) : null,
        this.tab === 'vault' && v.nextUpgradeCost !== null
          ? this.deps.world().copper >= v.nextUpgradeCost
          : null,
        // The deposit-all button's enabled state reads the CARRIED bags, which
        // no other signature term covers: without this arm, looting a material
        // while the pane is open leaves the button stale-disabled until some
        // other bank data happens to move. Vault-pane-scoped like the purse
        // term (the personal tab's twin button has the same pre-existing gap,
        // recorded as a family follow-up).
        this.tab === 'vault'
          ? hasVaultDepositable(this.deps.world().inventory, vaultMaterialIds())
          : null,
      ],
      g && [
        g.treasury,
        g.capacity,
        g.purchasedSlots,
        g.nextExpansionPrice,
        g.slots,
        g.canEdit,
        // ...and only while the guild pane is showing AND a rung-0 price is
        // actually quoted: with a null price the pane renders no open row
        // (phase 09: the client never invents a price), and on another tab
        // the marker is not rendered at all, so there is nothing to keep
        // fresh. Coarsened to the affordability boolean the row actually
        // renders, so copper churn on the same side of the price never
        // repaints (the vault purse term's exact shape, three terms up).
        // guildBankRungsBought, not a bare === 0: the pane's own unopened
        // predicate (guild_bank_view.ts) treats ANY sub-first-rung value as
        // unopened, so the two must agree or a legacy row could render a
        // marker this term never refreshes.
        this.tab === 'guild' &&
        guildBankRungsBought(g.purchasedSlots) === 0 &&
        g.canEdit &&
        g.nextExpansionPrice !== null
          ? this.deps.world().copper >= g.nextExpansionPrice
          : null,
      ],
      // The activity log's own repaint arm, and NULL unless the log view is
      // actually open: the log is fetched on demand by reading it, so pulling
      // it into the signature unconditionally would make every officer standing
      // at a banker poll for a payload they are not looking at. When the view
      // IS open this is what turns the response landing (loading -> ready, or a
      // fresh row after another officer's op busted the server cache) into a
      // repaint, with no timer of its own.
      // ...and ONLY while the log view is on screen. `readAndRequestLog` reads
      // the log, and reading it is what SENDS the request, so this arm is gated
      // on the pane actually being visible rather than on the pane's remembered
      // sub-view alone: a player who opened the log and went back to the
      // Personal tab was otherwise re-requesting it every TTL for a pane nobody
      // was looking at.
      this.tab === 'guild' && g !== null ? this.guildPane.readAndRequestLog() : null,
    ]);
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    // The bank data moved: any in-flight deposit-all run has echoed back (online) or
    // already applied (offline), so the button may re-enable on this repaint.
    // Both panes' guards clear: the signature is shared.
    this.clearDepositAllPending();
    this.vaultPane.clearDepositAllPending();
    this.render();
  }

  private fmt(n: number): string {
    return formatCount(n);
  }

  private fillGrid(
    grid: HTMLElement,
    slots: BankSlotModel[],
    emptyCells: number,
    empty: boolean,
  ): void {
    if (empty) {
      grid.innerHTML = `<div class="bank-empty">${esc(t('hudChrome.bank.empty'))}</div>`;
      return;
    }
    // Apply the window-local filter/sort. slotIndex rides through, so a filtered or
    // sorted cell still acts on its ORIGINAL bank slot; filterBankSlots keeps
    // unknown-id slots visible in the everything view (bank contents are server
    // truth, so a stale bundle can hold ids it predates, R34) and excludes them
    // only from category chips and name searches, exactly as the bags filter does.
    const isDefault = bagFilterIsDefault(this.filter);
    const visible = filterBankSlots(
      slots,
      (id) => knownItemDef(ITEMS, id),
      this.filter,
      (id) => this.itemNameOf(id),
    );
    if (visible.length === 0) {
      // A narrowing filter matched nothing: show the no-match line. With NO filter active
      // (only dormant unknown-id slots remain) there is nothing to "match", so keep the
      // classic empty-square pad instead of a misleading no-match line.
      if (isDefault) this.appendEmptyCells(grid, emptyCells);
      else grid.innerHTML = `<div class="bank-empty">${esc(t('hudChrome.bags.noMatch'))}</div>`;
      return;
    }
    for (const slot of visible) {
      const item = knownItemDef(ITEMS, slot.itemId);
      const cell = document.createElement('button');
      cell.type = 'button';
      // Fine-grade mark (bag_fine_mark_view.ts): a banked fine_* stack keeps the
      // .bag-fine rim/wash bags gave it, so the grade never disappears on
      // deposit. Id-based, so no def is needed; a stale-client unknown id is
      // never in the local grade table and simply stays unmarked.
      const fineMark = bagFineMark(slot.itemId);
      cell.className = `bank-item q-${slot.qualityKey}${bagRimClasses(null, fineMark)}`;
      const qColor = QUALITY_COLOR[slot.qualityKey] ?? QUALITY_DEFAULT_COLOR;
      cell.style.setProperty('--bank-slot-quality', qColor);
      // Corner marks (masterwork seal, fine seal, enchanted / signed / bound
      // glyph, or the generic wedge): same shared helpers and priority core
      // bags use (bag_corner_mark_view.ts), so a banked masterwork or fine
      // stack keeps its seal visible at a glance. Aria-hidden mark; the cell
      // name carries the per-copy fact (the fine grade rides the item NAME).
      // Quest items cannot enter the bank, so the quest arm is always null.
      const glyphKind = bagInstanceGlyphKind(slot.instance);
      const cornerMark = bagCornerMark(glyphKind, null, fineMark);
      const instanceMark = cornerMarkHtml(cornerMark);
      // Player item lock (issue 3042): its own bottom-left badge (all-surfaces
      // family, item_instance_glyph_mark.ts), so a locked copy keeps its mark
      // visible after deposit exactly like the masterwork/fine seals above.
      const locked = isItemLocked(slot.instance);
      const lockSeal = lockMarkHtml(locked);
      // Stale-client guard (R34): an id this bundle predates still holds a
      // real, counted bank slot, so it renders (fallback icon, raw id as the
      // label) instead of vanishing. The withdraw click stays live because the
      // server resolves it by slotIndex, no def needed; only the def-derived
      // tooltip body is replaced.
      const countLabel = this.fmt(slot.count);
      cell.setAttribute(
        'aria-label',
        item
          ? t(
              locked
                ? 'hudChrome.bags.itemAriaLocked'
                : glyphKind
                  ? INSTANCE_GLYPH_ARIA_KEYS[glyphKind]
                  : 'itemUi.bags.itemAria',
              {
                item: itemDisplayName(item),
                count: countLabel,
              },
            )
          : t(
              glyphKind
                ? UNKNOWN_INSTANCE_GLYPH_ARIA_KEYS[glyphKind]
                : 'itemUi.bags.unknownItemAria',
              { id: slot.itemId, count: countLabel },
            ),
      );
      cell.innerHTML = `${item ? this.deps.itemIcon(item) : unknownItemIconHtml(slot.itemId)}${instanceMark}${lockSeal}<span class="bank-count">${slot.showCount ? esc(t('itemUi.bags.stackCount', { count: countLabel })) : ''}</span>`;
      cell.addEventListener('click', (ev) => {
        // On touch, the click that ends a long-press peek inspects the slot (its
        // tooltip is already shown) instead of withdrawing: the release dismisses
        // the tooltip and fires nothing. A plain tap / desktop click falls through.
        if (this.deps.consumePeek()) {
          this.deps.hideTooltip();
          return;
        }
        this.onSlotClick(slot.slotIndex, ev.shiftKey);
      });
      this.deps.attachTooltip(cell, () => {
        const partial = slot.showCount
          ? `<div class="tt-sub">${esc(t('hudChrome.bank.withdrawPartialHint'))}</div>`
          : '';
        const body = item
          ? this.deps.itemTooltip(item, slot.instance)
          : `<div class="tt-title">${esc(slot.itemId)}</div><div class="tt-sub">${esc(t('itemUi.bags.unknownItem'))}</div>`;
        return `${body}<div class="tt-sub">${esc(t('hudChrome.bank.withdrawHint'))}</div>${partial}`;
      });
      grid.appendChild(cell);
    }
    // Free-slot squares only in the unfiltered view: a narrowed view shows matches only,
    // never the remaining capacity (the bags precedent).
    this.appendEmptyCells(grid, isDefault ? emptyCells : 0);
  }

  // The classic empty sockets that make remaining capacity visible at a glance.
  // Decorative, not focusable (mirrors bags).
  private appendEmptyCells(grid: HTMLElement, n: number): void {
    for (let i = 0; i < n; i++) {
      const cell = document.createElement('div');
      cell.className = 'bank-item empty';
      cell.setAttribute('aria-hidden', 'true');
      grid.appendChild(cell);
    }
  }

  // Localized display name, used for search matching AND the name-sort so both agree
  // with the visible cell. An unknown id falls back to the raw id: that is the label
  // its cell renders (the stale-client guard above), so sort and search stay agreed.
  private itemNameOf(itemId: string): string {
    const item = knownItemDef(ITEMS, itemId);
    return item ? itemDisplayName(item) : itemId;
  }

  // Repaint ONLY the grid from the live bank + current filter, preserving the search
  // input's focus/caret (the toolbar is untouched) and the scroll offset. Used by the
  // live-search keystroke path; a full render() still handles open/language/data
  // changes (mirrors bags_window.refreshGrid).
  private refreshGrid(): void {
    const grid = this.deps.root().querySelector('.bank-grid') as HTMLElement | null;
    if (!grid) return;
    const info = this.deps.world().bankInfo;
    if (!info) return; // walked away; refreshIfChanged owns the grace-close
    const model = buildBankView(info, (id) => knownItemDef(ITEMS, id));
    if (model.kind !== 'bank') return;
    // Emptying the grid momentarily collapses whichever element is scrolling
    // (clamping its scrollTop to 0), so capture and reapply around the refill.
    // This is the SEARCH keystroke path, so getting it wrong on one viewport
    // means the view jumps under a player who is typing.
    const root = this.deps.root();
    const prev = this.captureScroll(root);
    grid.innerHTML = '';
    this.fillGrid(grid, model.slots, model.emptyCells, model.empty);
    const scroll = root.querySelector('.bank-scroll') as HTMLElement | null;
    if (scroll) scroll.scrollTop = prev.inner;
    root.scrollTop = prev.outer;
  }

  // The category-chip + sort + search toolbar, plus the deposit-all-materials button.
  // Reuses the bags filter-bar classes so the shared CSS carries the styling. A chip or
  // sort change re-renders (the bags idiom); a search keystroke routes through
  // refreshGrid so the input keeps focus and caret. The search / category / sort
  // controls only matter once the bank holds items, so they are skipped over an empty
  // bank; the deposit-all button (which acts on the BAGS) stays visible even then,
  // since dumping a fresh character's materials into an empty bank is its primary use.
  private buildFilterBar(bankEmpty: boolean): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'bag-filter-bar bank-filter-bar';

    const tools = document.createElement('div');
    tools.className = 'bag-tools';

    if (!bankEmpty) {
      const chips = document.createElement('div');
      chips.className = 'bag-chips';
      chips.setAttribute('role', 'group');
      chips.setAttribute('aria-label', t('hudChrome.bank.filterGroupAria'));
      for (const category of BAG_CATEGORIES) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `bag-chip${this.filter.category === category ? ' active' : ''}`;
        chip.textContent = t(BANK_CATEGORY_LABEL_KEYS[category]);
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

      const search = document.createElement('input');
      search.type = 'search';
      search.className = 'bag-search';
      search.placeholder = t('hudChrome.bags.searchPlaceholder');
      search.setAttribute('aria-label', t('hudChrome.bank.searchAria'));
      search.value = this.filter.search;
      search.addEventListener('input', () => {
        this.filter.search = search.value;
        this.persistFilter();
        this.refreshGrid();
      });
      tools.appendChild(search);

      const sort = document.createElement('select');
      sort.className = 'bag-sort';
      sort.setAttribute('aria-label', t('hudChrome.bank.sortAria'));
      for (const option of BAG_SORTS) {
        const opt = document.createElement('option');
        opt.value = option;
        opt.textContent = t(BANK_SORT_LABEL_KEYS[option]);
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
    }

    // Deposit all materials: one click banks every material stack that fully fits.
    // Disabled when the bags hold no material stack; a full bank is still actionable
    // (the click reports it), so it does not disable here.
    //
    // The clarification (junk moves too, not just tradeskill materials, and
    // gathering tools never do) is exposed two ways so it reaches touch and keyboard users, not
    // only a mouse-hover title: a `title` for desktop hover, PLUS a visually-hidden
    // aria-describedby span the button always carries. A screen reader announces
    // aria-describedby on both hover and keyboard focus, and reading it needs no
    // pointer at all, so it also covers touch users who tap the button directly.
    const deposit = document.createElement('button');
    deposit.type = 'button';
    deposit.className = 'bank-deposit-all';
    deposit.textContent = t('hudChrome.bank.depositAll');
    const depositTooltip = t('hudChrome.bank.depositAllTooltip');
    deposit.title = depositTooltip;
    deposit.setAttribute('aria-describedby', 'bank-deposit-all-desc');
    deposit.disabled =
      this.depositAllPending ||
      !hasDepositableMaterials(this.deps.world().inventory, (id) => knownItemDef(ITEMS, id));
    deposit.addEventListener('click', () => this.onDepositAll());
    tools.appendChild(deposit);

    const depositDesc = document.createElement('span');
    depositDesc.id = 'bank-deposit-all-desc';
    depositDesc.className = 'visually-hidden';
    depositDesc.textContent = depositTooltip;
    tools.appendChild(depositDesc);

    bar.appendChild(tools);
    return bar;
  }

  private persistFilter(): void {
    try {
      // The search is stripped at the serialize boundary: it is per-visit state
      // (close() resets it; construction never restores it), so no keystroke,
      // chip, sort, or close write ever lands a query in storage.
      localStorage.setItem(BANK_FILTER_KEY, serializeBagFilter({ ...this.filter, search: '' }));
    } catch {
      /* storage unavailable (private mode); the filter still works in-session */
    }
  }

  // Deposit every fully-fitting material stack in one go. The plan is computed against
  // ONE snapshot (inventory + bank at click time) and every command is sent without
  // re-reading state mid-run, because the online mirror lags the authoritative world by
  // ~1 tick; sending against a mid-run mirror would double-count or mis-index.
  private onDepositAll(): void {
    const world = this.deps.world();
    const info = world.bankInfo;
    if (!info) return; // walked away between render and click
    // The wire-fed pool split, never the flat capacity: with a materials
    // satchel socketed, a flat budget would plan deposits the sim's pool-aware
    // gate refuses (or skip ones it would accept).
    const plan = planDepositAllMaterials(world.inventory, info.slots, bankPoolsOf(info), (id) =>
      knownItemDef(ITEMS, id),
    );
    if (plan.sends.length === 0 && !plan.full) return; // nothing to do (button was disabled)
    for (const send of plan.sends) world.bankDeposit(send.slot, send.count);
    if (plan.sends.length > 0) {
      audio.coin();
      // Hold the button disabled until the data echoes back (see the field comment);
      // the timer only backstops a lost echo so the button can never wedge shut.
      this.depositAllPending = true;
      if (this.depositAllTimer !== null) window.clearTimeout(this.depositAllTimer);
      this.depositAllTimer = window.setTimeout(() => {
        this.depositAllTimer = null;
        if (!this.depositAllPending) return;
        this.depositAllPending = false;
        if (this.opened) this.render();
      }, DEPOSIT_STATUS_MS);
      // Material stacks just left the bags; repaint the companion (see the dep doc).
      // Inside the sends guard: a no-op click (nothing fit) moved nothing.
      this.deps.onInventoryChanged();
    }
    this.setDepositStatus(plan);
    this.render();
  }

  // Compose the transient summary from the PLAN (not post-facto state, which the online
  // mirror has not caught up to yet) and arm the self-expire.
  private setDepositStatus(plan: DepositAllPlan): void {
    // The arm choice (none fit / partially fit / all fit) lives in the pure core's
    // depositAllSummaryKey so its selection is unit-pinned; only the None arm
    // renders without a count token.
    const key = depositAllSummaryKey(plan);
    const text = plan.stacks === 0 ? t(key) : t(key, { count: this.fmt(plan.stacks) });
    this.depositStatus = { text, at: performance.now() };
  }

  // Build the polite aria-live summary line if one is still fresh, and arm a single timer
  // to clear it and repaint so it never lingers across later data-driven rebuilds.
  private buildDepositStatus(): HTMLElement | null {
    const s = this.depositStatus;
    if (!s) return null;
    const age = performance.now() - s.at;
    if (age >= DEPOSIT_STATUS_MS) {
      this.clearDepositStatus();
      return null;
    }
    const status = document.createElement('div');
    status.className = 'bank-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = s.text;
    if (this.statusTimer !== null) window.clearTimeout(this.statusTimer);
    this.statusTimer = window.setTimeout(() => {
      this.statusTimer = null;
      this.depositStatus = null;
      if (this.opened) this.render();
    }, DEPOSIT_STATUS_MS - age);
    return status;
  }

  // Plain click withdraws the whole stack; shift-click on a splittable stack opens a
  // quantity prompt. The pure bankSlotAction decides which (reading the live slot).
  private onSlotClick(slotIndex: number, shift: boolean): void {
    const slot = this.deps.world().bankInfo?.slots[slotIndex];
    const action = bankSlotAction(slot, slotIndex, shift);
    if (action.kind === 'withdraw') {
      this.deps.world().bankWithdraw(action.slotIndex);
      audio.click();
      // The item just moved into the bags; repaint the companion (see the dep doc).
      this.deps.onInventoryChanged();
    } else if (action.kind === 'withdrawPartial') {
      this.showWithdrawQuantityPrompt(action.slotIndex, action.max);
    }
  }

  // The bag-socket row (Bank Storage phase 07): one .bag-socket-family cell per
  // socket, mirroring the carried bag bar's grammar exactly. A FILLED socket is
  // a button whose click returns the bag to the carried inventory
  // (bankUnsocketBag; the bags-side unequip click, verbatim); an EMPTY unlocked
  // socket is the informational focusable no-op the bags render, its tooltip
  // pointing at the bags-grid click that fills it; the FIRST locked socket
  // offers the unlock purchase at the WIRE price (nextSocketCost; never a
  // client constant, the phase 09 tunables rule), and later locked sockets are
  // informational (sockets unlock in order, so they have no honest price yet).
  private buildSocketRow(cells: BankSocketCellModel[]): HTMLElement {
    const row = document.createElement('div');
    row.className = 'bank-sockets';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', t('hudChrome.bank.socketRowAria'));
    for (const cell of cells) {
      if (cell.kind === 'filled') {
        const item = knownItemDef(ITEMS, cell.itemId);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `bag-socket bank-socket q-${cell.qualityKey}`;
        btn.dataset.focusKey = `bank:socket:${cell.socket}`;
        // Stale-client guard (the grid's R34 rule): an id this bundle predates
        // still holds a real socket, so it renders with the fallback icon and
        // its raw id; the unsocket click stays live because the server
        // resolves it by socket index, no def needed.
        btn.innerHTML = item ? this.deps.itemIcon(item) : unknownItemIconHtml(cell.itemId);
        // The slots-line KEY is the core's decision (bagSlotsLineKey through
        // the model), and the aria REUSES the carried bag bar's generic
        // '{name}: {slots}' key: neither wording is bank-specific, the
        // category-chip reuse rule. On a def miss (the R34 stale-client cell)
        // the raw id stays as the name, but the slots line becomes the
        // unknown-item admission the cell's own tooltip already makes: the
        // client does not know the bag's slot count (the real slots ARE
        // feeding the pool server-side), so speaking the model's 0 fallback
        // would assert a count that is simply wrong.
        const slotsLine = item
          ? t(cell.slotsLineKey, { slots: this.fmt(cell.slots) })
          : t('itemUi.bags.unknownItem');
        btn.setAttribute(
          'aria-label',
          t('hudChrome.bags.bagSocketAria', {
            name: item ? itemDisplayName(item) : cell.itemId,
            slots: slotsLine,
          }),
        );
        btn.addEventListener('click', () => {
          // On touch, the click that ends a long-press peek inspects the
          // socketed bag (its tooltip is already shown) instead of unsocketing
          // it: the release dismisses the tooltip and fires nothing, the bank
          // grid cell's consumePeek rule. A plain tap / desktop click falls
          // through.
          if (this.deps.consumePeek()) {
            this.deps.hideTooltip();
            return;
          }
          // Server-authoritative like every bank op: the sim re-validates the
          // socket and the carried-side fit, and the pane repaints through its
          // signature when socketBags echoes back.
          this.deps.world().bankUnsocketBag(cell.socket);
          audio.click();
          this.deps.hideTooltip();
          // The bag just moved into the bags; repaint the companion (dep doc).
          this.deps.onInventoryChanged();
        });
        this.deps.attachTooltip(btn, () => {
          const body = item
            ? this.deps.itemTooltip(item)
            : `<div class="tt-title">${esc(cell.itemId)}</div><div class="tt-sub">${esc(t('itemUi.bags.unknownItem'))}</div>`;
          return `${body}<div class="tt-sub">${esc(t('hudChrome.bank.unsocketHint'))}</div>`;
        });
        row.appendChild(btn);
      } else if (cell.kind === 'empty') {
        // Informational, not actionable (the bags' empty-socket rendering): a
        // keyboard user still reaches the tooltip, which names the bags-grid
        // click that fills it.
        const empty = document.createElement('button');
        empty.type = 'button';
        empty.className = 'bag-socket bank-socket empty';
        empty.dataset.focusKey = `bank:socket:${cell.socket}`;
        empty.setAttribute('aria-disabled', 'true');
        empty.setAttribute('aria-label', t('hudChrome.bank.socketEmpty'));
        this.deps.attachTooltip(
          empty,
          () => `<div class="tt-sub">${esc(t('hudChrome.bank.socketEmptyHint'))}</div>`,
        );
        row.appendChild(empty);
      } else {
        const locked = document.createElement('button');
        locked.type = 'button';
        locked.className = 'bag-socket bank-socket locked';
        locked.dataset.focusKey = `bank:socket:${cell.socket}`;
        locked.innerHTML = svgIcon('lock');
        if (cell.unlockCost !== null) {
          const cost = cell.unlockCost;
          this.socketPurchase.markBusy(locked);
          locked.setAttribute(
            'aria-label',
            t('hudChrome.bank.socketUnlockAria', { price: formatMoney(cost) }),
          );
          locked.addEventListener('click', () => {
            // Same touch rule as the filled cell: a long-press peek's release
            // inspects the price tooltip, never pops the unlock confirm.
            if (this.deps.consumePeek()) {
              this.deps.hideTooltip();
              return;
            }
            this.socketPurchase.show({ socketsUnlocked: cell.socket, cost });
          });
          this.deps.attachTooltip(
            locked,
            () =>
              `<div class="tt-title">${esc(t('hudChrome.bank.socketLocked'))}</div>` +
              `<div class="bank-socket-price">${this.deps.moneyHtml(cost)}</div>` +
              `<div class="tt-sub">${esc(t('hudChrome.bank.socketUnlockHint'))}</div>`,
          );
        } else {
          locked.setAttribute('aria-disabled', 'true');
          locked.setAttribute('aria-label', t('hudChrome.bank.socketLocked'));
          this.deps.attachTooltip(
            locked,
            () => `<div class="tt-sub">${esc(t('hudChrome.bank.socketLockedLater'))}</div>`,
          );
        }
        row.appendChild(locked);
      }
    }
    return row;
  }

  // The one rigid band below the scroll region (phase 08): the capacity meter
  // over the expansion row (visibility bound: the KNOWN BOUND note at the
  // scroll-region comment above). The state classes are plain
  // className composition at build time (the cold-window idiom, the bags
  // counter's `bag-capacity over` twin): a state flip arrives as bank data,
  // which rebuilds the window through the signature.
  private buildFooter(meter: BankMeterModel, buy: BankBuySlotsModel): HTMLElement {
    const footer = document.createElement('div');
    footer.className = `bank-footer${meter.nearFull ? ' near-full' : ''}${meter.over ? ' over' : ''}`;
    footer.appendChild(this.buildMeter(meter));
    footer.appendChild(this.buildBuyRow(buy));
    footer.appendChild(this.buildRungNotice());
    return footer;
  }

  /** The Claudium purchase-result band plus the region that announces it. The
   *  markup, and the reason it is two nodes, live in bank_rung_view.ts. */
  private buildRungNotice(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'bank-rung-result';
    wrap.innerHTML = bankRungResultHtml(this.rungPurchase.notice);
    return wrap;
  }

  // The capacity meter: a non-actionable readout (no click, no peek guard) of
  // the summed display pair plus the two wire-fed pool segments. Geometry goes
  // out as unitless custom properties (each pool's share of the total, and its
  // fill CLAMPED to [0,1]; the model's fraction stays honest past 1) so the
  // stylesheet owns every visual decision. The materials segment always
  // renders; a zero share collapses it in CSS.
  private buildMeter(meter: BankMeterModel): HTMLElement {
    const el = document.createElement('div');
    el.className = 'bank-meter';
    // Focusable readout: the pool lines and the materials note live only in
    // the tooltip, whose host serves hover, long-press, AND focusin; without
    // a tab stop a keyboard-only user could never reach them. role=group
    // makes the aria-label conformant on the composite (bonus-section idiom).
    // The focus key keeps a parked reader on the meter across mirror-driven
    // rebuilds; the close-button fallback would silently defeat the tab stop.
    el.setAttribute('role', 'group');
    el.tabIndex = 0;
    el.dataset.focusKey = 'bank:meter';
    const share = (capacity: number): string =>
      String(meter.total > 0 ? capacity / meter.total : 0);
    const fill = (fraction: number): string => String(Math.min(1, Math.max(0, fraction)));
    el.style.setProperty('--bank-meter-general-share', share(meter.general.capacity));
    el.style.setProperty('--bank-meter-materials-share', share(meter.materials.capacity));
    el.style.setProperty('--bank-meter-general-fill', fill(meter.general.fraction));
    el.style.setProperty('--bank-meter-materials-fill', fill(meter.materials.fraction));
    const track = document.createElement('div');
    track.className = 'bank-meter-track';
    for (const seg of ['bank-meter-seg-general', 'bank-meter-seg-materials']) {
      const segment = document.createElement('div');
      segment.className = seg;
      const segFill = document.createElement('div');
      segFill.className = 'bank-meter-fill';
      segment.appendChild(segFill);
      track.appendChild(segment);
    }
    el.appendChild(track);
    const text = document.createElement('span');
    text.className = 'bank-meter-text';
    text.textContent = t('hudChrome.bank.meterLabel', {
      used: this.fmt(meter.used),
      total: this.fmt(meter.total),
    });
    el.appendChild(text);
    // Both the accessible name and the tooltip body are pure copy over this
    // same model (bank_meter_view.ts); the window keeps the ATTACH, which is
    // the half that owns DOM.
    el.setAttribute('aria-label', bankMeterAriaLabel(meter));
    this.deps.attachTooltip(el, () => bankMeterTooltipHtml(meter));
    return el;
  }

  // The footer expansion row: the next block's price on a buy button, or a maxed
  // label when purchased slots are capped. Never gated on affordability (the sim is
  // authoritative and emits its own refusal line, localized by the existing pipeline).
  // The price rides in a tags container (one product, one row, gold first and
  // visually primary) so a second tag can join without a layout change.
  // What the host knows that the wire does not, for the Claudium tag's gating
  // (phase 13). Every field is read fresh per paint: hooks attach after the
  // online handshake, and the balance latch moves on every spend. Returning
  // undefined is the offline shape and the core suppresses the tag outright,
  // which is why offline needs no second mechanism.
  private claudiumInput(): BankClaudiumInput {
    return {
      storeEnabled: this.deps.storeEnabled?.() === true,
      // The attach site in src/main.ts is already gated on !NATIVE_APP, so on a
      // native build there are no hooks and storeEnabled is false. This states
      // the platform rule at the render seam as well rather than resting on
      // that one call site: two independent gates, either sufficient.
      nativeBuild: NATIVE_APP,
    };
  }

  private buildBuyRow(buy: BankBuySlotsModel): HTMLElement {
    const row = document.createElement('div');
    row.className = 'bank-buy-row';
    if (buy.maxed || buy.nextCost === null) {
      const maxed = document.createElement('span');
      maxed.className = 'bank-buy-maxed';
      maxed.textContent = t('hudChrome.bank.buySlotsMaxed');
      row.appendChild(maxed);
      return row;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bank-buy-btn';
    // The focus identity the post-purchase repaint lands back on. Stamped here
    // rather than in an annotate pass because the guild pane's own annotation
    // claims '.bank-buy-btn' for gbank:buy, and only one of the two panes is
    // ever mounted; keying at construction keeps them independent.
    btn.dataset.focusKey = 'bank:buy';
    const claudium = buy.claudium;
    btn.innerHTML =
      `<span class="bank-buy-label">${esc(t('hudChrome.bank.buySlots', { count: this.fmt(buy.blockSlots) }))}</span>` +
      `<span class="bank-buy-tags"><span class="bank-buy-tag bank-buy-tag-gold">${this.deps.moneyHtml(buy.nextCost)}</span>` +
      // ONE button, TWO tags. Absent, never disabled, when the core offered no
      // Claudium side: there is no greyed-out Claudium tag anywhere, and a
      // service the client could not reach simply leaves a working gold-only
      // button with no error and no retry affordance.
      `${claudium ? bankRungClaudiumTagHtml(claudium) : ''}</span>`;
    if (claudium) {
      // Without this the button's accessible name is the two prices read back
      // to back, which says nothing about there being a choice. The label
      // states both rails as one spoken action; it is not a rate and not a
      // total, just the two per-product prices the button carries.
      btn.setAttribute(
        'aria-label',
        t('hudChrome.bank.buySlotsDualAria', {
          count: this.fmt(buy.blockSlots),
          price: formatMoney(buy.nextCost),
          cost: claudiumAmountText(claudium.cost),
        }),
      );
    }
    // The in-flight state is MARKUP, read while this element is being built, so
    // a data repaint that lands mid-spend cannot rebuild the button enabled.
    if (claudium && this.rungPurchase.isInFlight(claudium.skuId)) {
      btn.setAttribute('aria-busy', 'true');
      btn.disabled = true;
    }
    btn.addEventListener('click', () => this.showBuySlotsPrompt(buy));
    row.appendChild(btn);
    return row;
  }

  private showBuySlotsPrompt(buy: BankBuySlotsModel): void {
    if (buy.nextCost === null) return;
    // The price-changed arm re-enters here AFTER an await, so the bank may be
    // gone, exactly as for openNeedMoreClaudiumDialog and repaintAfterRung,
    // which both guard. Without this the automatic re-prompt mounts an
    // aria-modal confirm over a bare world and inerts the hidden #bank-window.
    if (!this.opened) return;
    const claudium = buy.claudium;
    // A spend for this rung is already on the wire. The button is rebuilt
    // disabled, but a keyboard Enter can still arrive between the send and the
    // repaint, and a second prompt over a live debit is the one thing this flow
    // must never open.
    if (claudium && this.rungPurchase.isInFlight(claudium.skuId)) return;
    // MINT THE INTENT HERE, before the prompt exists, and quote ITS cost. Three
    // things depend on it happening at this exact moment: the number the player
    // confirms is the number that goes on the wire (intentFor returns an
    // already-open intent unchanged and its cost is FROZEN, so on a retry after
    // an ambiguous outcome the wire still carries the frozen price while a
    // background refresh may have moved the wired one); the abandon path below
    // has something to drop, which it would not if the mint happened at send
    // time beside the sent-latch; and the focus key can still be read, because
    // the button holds focus right now and the prompt's own trap will have moved
    // it by the time either confirm arm runs.
    const intent = claudium ? this.rungPurchase.intentFor(claudium.skuId, claudium.cost) : null;
    this.rungFocusReturnKey = captureFocusKey(this.deps.root());
    this.rungPurchase.armPrompt(claudium?.skuId ?? null);
    const goldOnly = intent === null;
    showBuyConfirmPrompt(
      {
        installPromptDialog: (prompt, opener, close) =>
          this.installPromptDialog(prompt, opener, close),
        dismissSiblings: dismissBankPrompts,
      },
      {
        // The gold-only prompt is byte-for-byte what phase 08 shipped. The dual
        // prompt moves the gold price out of the question and onto its own
        // button so the two rails read as independent per-product prices: no
        // rate, no equivalence, no combined total, and gold primary BY POSITION.
        text: goldOnly
          ? t('hudChrome.bank.buyConfirm', {
              count: this.fmt(buy.blockSlots),
              price: formatMoney(buy.nextCost),
            })
          : t('hudChrome.bank.buyConfirmDual', { count: this.fmt(buy.blockSlots) }),
        // The economy disclaimer rides the click-gated confirm, not the always
        // visible footer: the price on the button is live wire data; the
        // caveat belongs where the player commits to it.
        secondaryText: t('hudChrome.bank.priceDisclaimer'),
        confirmLabel: goldOnly
          ? t('hudChrome.bank.buyConfirmAccept')
          : t('hudChrome.bank.buyConfirmGold', { price: formatMoney(buy.nextCost) }),
        cancelLabel: t('itemUi.vendor.sellQuantityCancel'),
        onConfirm: (dismiss) => {
          // Buying with GOLD abandons the Claudium intent this prompt minted,
          // while it is still unsent (the controller applies the sent latch and
          // the ledger applies the restored one).
          this.rungPurchase.confirmWithGold(claudium?.skuId ?? null);
          this.deps.world().bankBuySlots();
          audio.coin();
          // Coin just left the purse and the bags money row shows it (see the dep doc).
          this.deps.onInventoryChanged();
          dismiss();
          // render() rebuilds the window, detaching the opener button, so land focus on
          // the always-present close button rather than letting it fall to <body>.
          (this.deps.root().querySelector('[data-close]') as HTMLElement | null)?.focus();
        },
        ...(intent !== null && claudium !== undefined
          ? {
              altConfirm: {
                label: t('hudChrome.bank.buyConfirmClaudium', {
                  cost: claudiumAmountText(intent.costClaudium),
                }),
                onConfirm: (dismiss: () => void) => {
                  this.rungPurchase.confirmWithClaudium();
                  dismiss();
                  // Land focus before the await, as the gold arm does: dismiss()
                  // detaches the dialog, so focus falls to <body> and STAYS there
                  // for the whole round trip. repaintAfterRung restores it from
                  // rungFocusReturnKey only once the result lands.
                  (this.deps.root().querySelector('[data-close]') as HTMLElement | null)?.focus();
                  // The INTENT travels, not a loose cost. There is then exactly
                  // one number that can reach the wire and one place it comes
                  // from; a second cost parameter here would be a second thing
                  // to get wrong, and the ledger's freeze would silently hide
                  // the mistake rather than surface it.
                  void this.rungPurchase.spend(claudium.skuId, intent, buy.blockSlots);
                },
              },
            }
          : {}),
        onDismiss: () => {
          // Only an ABANDONMENT drops the intent, and only while it has never
          // reached the service. The controller owns that decision and answers
          // whether it took it; the focus stash is the window's own to drop, and
          // only on the abandonment, exactly as before.
          if (this.rungPurchase.endPrompt()) this.rungFocusReturnKey = null;
        },
      },
    );
  }

  /** The current buy sub-model, rebuilt from the live mirror. Used by the
   *  price-changed re-prompt so the second prompt quotes what the wire says NOW
   *  rather than anything cached from the first one. */
  private currentRungOffer(): BankBuySlotsModel | null {
    const model = buildBankView(
      this.deps.world().bankInfo,
      (id) => knownItemDef(ITEMS, id),
      this.claudiumInput(),
    );
    return model.kind === 'bank' ? model.buy : null;
  }

  /** Hand off to the Claudium top-up window and come back. */
  private openNeedMoreClaudiumDialog(
    blockSlots: number,
    cost: number,
    balance: number | null,
  ): void {
    // Reached after an await, so the bank may be gone by now. The confirm dialog
    // appends an aria-modal focus trap to document.body unconditionally, which
    // over a bare game world is a prompt about a window the player has already
    // walked away from.
    if (!this.opened) return;
    const copy = bankRungTopUpCopy(blockSlots, cost, balance ?? this.deps.claudiumBalance?.() ?? 0);
    // The last argument is the one return path out of the handoff: the Claudium
    // window fires it exactly once, when it closes, and the bank repaints with
    // the refreshed balance. No timer guessing when the player is done.
    this.deps.confirmDialog?.(copy.title, copy.body, copy.confirm, copy.cancel, () =>
      this.deps.openClaudium?.(() => this.refreshAfterTopUp()),
    );
  }

  /** Come back from the top-up window.
   *
   *  MEASURED, not assumed. The obvious guess is that the Claudium window closes
   *  the bank behind it, because its deps name a `closeOthers`; driving the real
   *  handoff at a live bursar showed it does NOT. Hud.closeOtherWindows ignores
   *  its argument and closes only the context menu and the tooltip, so the
   *  top-up window opens OVER a bank that stays open. The ordinary path is
   *  therefore the REPAINT: the player returns with a bigger balance and the
   *  tag's affordability and the shortfall the next handoff would quote both
   *  have to reflect it.
   *
   *  The re-open branch is deliberate defence for the case where the bank is
   *  NOT open by then (a walk-away grace close, a future chrome change that does
   *  displace it), and it is guarded on the world still reporting a readout,
   *  because the bank is proximity gated and re-opening after the player
   *  wandered off would paint the away state at a bursar they are no longer
   *  standing at. */
  private refreshAfterTopUp(): void {
    if (this.opened) {
      this.render();
      return;
    }
    if (this.deps.world().bankInfo === null) return;
    this.open();
  }

  /** Mark the buy button busy on the LIVE element for the span of one spend.
   *  The markup half of this state lives in buildBuyRow, which reads
   *  rungInFlight while building; this is only the immediate feedback before
   *  any repaint happens. */
  private setRungBusy(busy: boolean): void {
    // Addressed by the personal footer's OWN focus key, never by '.bank-buy-btn':
    // the guild and vault panes paint a button of that class into the SAME root,
    // and this write lands in a `finally` AFTER an await, so a tab switch mid
    // spend would otherwise aim the release at a foreign pane's control.
    const btn = this.deps
      .root()
      .querySelector<HTMLButtonElement>('.bank-footer [data-focus-key="bank:buy"]');
    if (!btn) return;
    if (busy) {
      btn.setAttribute('aria-busy', 'true');
      btn.disabled = true;
      return;
    }
    btn.removeAttribute('aria-busy');
    btn.disabled = false;
  }

  /** Write the current result into the freshly painted live region. */
  private announceRung(): void {
    const notice = this.rungPurchase.notice;
    // Scoped to the footer for the same reason setRungBusy is: only the personal
    // pane paints this region, and only its own copy may be written.
    const live = this.deps.root().querySelector<HTMLElement>('.bank-footer [data-rung-live]');
    if (!notice || !live) return;
    // Clear first, then write in a microtask: an identical repeated message (two
    // failed retries) is otherwise a no-op mutation and is not re-announced.
    const seq = ++this.rungAnnounceSeq;
    live.textContent = '';
    queueMicrotask(() => {
      if (seq === this.rungAnnounceSeq) live.textContent = bankRungNoticeText(notice);
    });
  }

  /** Repaint after a purchase outcome, announce it, and hand focus back to the
   *  control the player pressed. */
  private repaintAfterRung(): void {
    if (!this.opened) {
      // Nothing will paint, so nothing consumes the stash. Drop it rather than
      // leave it armed for whatever repaints next.
      this.rungFocusReturnKey = null;
      return;
    }
    this.render();
    this.announceRung();
    const key = this.rungFocusReturnKey;
    this.rungFocusReturnKey = null;
    if (key) this.restoreControlFocus(this.deps.root(), key);
  }

  // The shared quantity-prompt builder (bank_quantity_prompt.ts) owns the
  // chrome; this owns the bank-specific closures: the stale-index guard and
  // the withdraw send.
  private showWithdrawQuantityPrompt(slotIndex: number, maxCount: number): void {
    const slot = this.deps.world().bankInfo?.slots[slotIndex];
    if (!slot) return;
    // knownItemDef, not a raw ITEMS index: the release's stale-client sweep
    // made every bank item read tolerate an id this client does not know.
    const item = knownItemDef(ITEMS, slot.itemId);
    const itemName = item ? itemDisplayName(item) : slot.itemId;
    showQuantityPrompt(
      {
        installPromptDialog: (prompt, opener, close) =>
          this.installPromptDialog(prompt, opener, close),
        dismissSiblings: dismissBankPrompts,
      },
      {
        className: 'bank-quantity-prompt',
        titleText: t('hudChrome.bank.withdrawQuantityTitle', { item: itemName }),
        inputAriaText: t('hudChrome.bank.withdrawQuantityInput'),
        confirmText: t('hudChrome.bank.withdrawQuantityConfirm'),
        cancelText: t('itemUi.vendor.sellQuantityCancel'),
        maxCount,
        resolveCount: (requested) => {
          // The prompt captured slotIndex when it opened; the bank can repaint
          // under it (a server correction, another op landing), shifting what
          // sits at that index. Re-resolve the live slot and refuse on a
          // mismatch: silently withdrawing the WRONG item is worse than
          // dismissing the prompt. The count clamps to the live stack so a
          // shrunken stack withdraws what is there.
          const live = this.deps.world().bankInfo?.slots[slotIndex];
          if (!live || !slot || live.itemId !== slot.itemId) return null;
          return Math.max(1, Math.min(maxCount, live.count, requested));
        },
        send: (count) => {
          this.deps.world().bankWithdraw(slotIndex, count);
          audio.click();
          // The split just moved into the bags; repaint the companion (see the dep doc).
          this.deps.onInventoryChanged();
        },
        afterClose: () => {
          // The grid rebuilds on the withdraw event (and a stale refusal
          // destroyed the opener slot either way), so land on the
          // always-present close button rather than dropping focus to <body>.
          (this.deps.root().querySelector('[data-close]') as HTMLElement | null)?.focus();
        },
      },
    );
  }

  // #bank-window is the inert root while a prompt is open; close() clears it too
  // as a force-close backstop, so the window is never left inert while hidden.
  private installPromptDialog(
    prompt: HTMLElement,
    opener: HTMLElement | null,
    close: () => void,
  ): PromptDialogHandle {
    return installModalPromptDialog(prompt, opener, close, {
      inertRoot: this.deps.root(),
      idPrefix: 'bank-prompt-title',
    });
  }
}
