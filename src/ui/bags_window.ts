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
  bagItemAction,
  bagQualityKey,
  bagTooltipHintKey,
  buildBagGrid,
} from './bags_view';
import { itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import { FOCUSABLE_SELECTOR } from './focus_manager';
import { encodeHotbarAction, HOTBAR_ACTION_MIME } from './hotbar';
import { formatNumber, type TranslationKey, t } from './i18n';
import { QUALITY_COLOR } from './icons';
import type { PainterHostPresentation } from './painter_host';
import { svgIcon } from './ui_icons';

const BAG_FILTER_KEY = 'woc_bag_filter';

// Monotonic id source for the ad-hoc prompt dialogs' aria-labelledby target, so the
// id never couples to class ordering (was prompt.classList[last]).
let promptDialogSeq = 0;

// The ad-hoc discard / sell quantity prompts mount into #prompt-stack (outside #bags).
// A window-level close() removes any that are open so it never leaves an orphaned
// aria-modal dialog floating over the closed window (the show* paths already clear a
// prior same-type prompt with these classes).
const BAG_PROMPT_SELECTOR = '.discard-item-prompt, .sell-quantity-prompt';
function dismissBagPrompts(): void {
  for (const p of document.querySelectorAll(BAG_PROMPT_SELECTOR)) p.remove();
}

// The unranked quality fallback as a CSS custom property. The shared
// QUALITY_COLOR map carries the real per-quality hex; this token covers the rare
// item with no quality field, so no raw hex lives in the painter.
const QUALITY_DEFAULT_COLOR = 'var(--color-quality-default)';

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
  pendingPetFeed(): boolean;
  // Cross-window commands the bag click fans out to.
  closeVendor(): void;
  addItemToTrade(itemId: string): void;
  /** Stage a bag item for a Market listing (selects it + repaints the market). */
  stageMarketSell(itemId: string): void;
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
  }

  render(): void {
    const el = this.deps.root();
    const world = this.deps.world();
    // .bag-grid (not #bags) is the scroll container; it is recreated on every
    // rebuild, so capture its scroll offset and reapply it to the fresh grid:
    // otherwise using an item (e.g. a potion) snaps the list back to the top.
    const prevScrollTop = el.querySelector('.bag-grid')?.scrollTop ?? 0;
    el.innerHTML = `<div class="panel-title"><span>${esc(t('itemUi.bags.title'))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('itemUi.bags.close'))}">${svgIcon('close')}</button></div>`;
    // Skip the chip/search row entirely when the bag is empty: a full filter bar
    // above a single "(empty)" line is just noise.
    if (world.inventory.length > 0) el.appendChild(this.buildFilterBar());
    const grid = document.createElement('div');
    grid.className = 'bag-grid';
    this.fillGrid(grid);
    el.appendChild(grid);
    grid.scrollTop = prevScrollTop;
    const moneyRow = document.createElement('div');
    moneyRow.className = 'money';
    moneyRow.innerHTML = `${this.deps.wocBalanceHtml()}${this.deps.moneyHtml(world.copper)}`;
    el.appendChild(moneyRow);
    el.querySelector('[data-close]')?.addEventListener('click', () => {
      if (this.deps.vendorOpen() && document.body.classList.contains('mobile-touch')) {
        this.deps.closeVendor();
        return;
      }
      this.close();
    });
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
    chips.className = 'bag-chips';
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', t('hudChrome.bags.filterGroupAria'));
    for (const category of BAG_CATEGORIES) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `bag-chip${this.filter.category === category ? ' active' : ''}`;
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
    tools.appendChild(search);

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
    const model = buildBagGrid(world.inventory, (id) => ITEMS[id], this.filter);
    if (model.state === 'empty') {
      grid.innerHTML = `<div class="bag-empty">${esc(t('itemUi.bags.empty'))}</div>`;
      return;
    }
    if (model.state === 'noMatch') {
      grid.innerHTML = `<div class="bag-empty">${esc(t('hudChrome.bags.noMatch'))}</div>`;
      return;
    }
    for (const s of model.visible) {
      const item = ITEMS[s.itemId];
      if (!item) continue;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'bag-item';
      const qColor = QUALITY_COLOR[bagQualityKey(item)] ?? QUALITY_DEFAULT_COLOR;
      const itemName = itemDisplayName(item);
      row.setAttribute(
        'aria-label',
        t('itemUi.bags.itemAria', {
          item: itemName,
          count: formatNumber(s.count, { maximumFractionDigits: 0 }),
        }),
      );
      row.innerHTML = `${this.deps.itemIcon(item)}<span style="color:${qColor}">${esc(itemName)}</span><span class="bi-count">${s.count > 1 ? esc(t('itemUi.bags.stackCount', { count: formatNumber(s.count, { maximumFractionDigits: 0 }) })) : ''}</span>`;
      row.addEventListener('click', (ev) => {
        const action = bagItemAction(item, this.bagMode());
        switch (action) {
          case 'trade':
            this.deps.addItemToTrade(s.itemId);
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
          case 'use':
            this.deps.world().useItem(s.itemId);
            this.render();
            this.deps.renderCharIfOpen();
            break;
        }
      });
      row.addEventListener('contextmenu', (ev) => {
        if (!this.deps.vendorOpen() || (!ev.ctrlKey && !ev.metaKey)) return;
        ev.preventDefault();
        this.sellBagItem(s, ev);
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
        const key = bagTooltipHintKey(item, this.bagMode());
        const extra = key ? `<div class="tt-sub">${esc(t(key))}</div>` : '';
        return this.deps.itemTooltip(item) + extra;
      });
      grid.appendChild(row);
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
      marketSell: this.deps.isMarketSell(),
      vendorOpen: this.deps.vendorOpen(),
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
      if (ke.key === 'Escape') {
        ke.preventDefault();
        dismissAndReturn();
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

  // Write the dragged item onto the DataTransfer (reproduced from the exported
  // hotbar encoder so cross-window drag state stays on the HUD via the deps).
  private writeDraggedAction(dt: DataTransfer | null, action: { type: 'item'; id: string }): void {
    if (!dt) return;
    dt.setData(HOTBAR_ACTION_MIME, encodeHotbarAction(action));
    dt.setData('text/plain', action.id);
  }
}
