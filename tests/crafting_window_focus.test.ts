// @vitest-environment happy-dom
//
// The crafting window (#1127) was the one standalone-window holdout that
// never installed the shared Tab focus trap (windowFocus/FocusManager) or
// the markDialogRoot dialog role every sibling window (Talents/Social/
// Market/Deeds/Train/Unbind/...) carries. This drives the REAL
// renderCraftingWindow painter plus the REAL FocusManager/makeWindowFocus
// bridge (src/ui/CLAUDE.md's "windowFocus(rootSel)" contract), wired exactly
// the way Hud.openCrafting/closeCrafting install it, so a regression that
// drops either half fails here. The hud.ts coordinator itself is not
// instantiated (no test in this repo does; see train_window_hud.test.ts):
// its wiring is pinned by source, the established pattern for this
// monolith.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InvSlot, ItemDef } from '../src/sim/types';
import { buildCraftingView, type RecipeDefLike } from '../src/ui/crafting_view';
import { type CraftingWindowDeps, renderCraftingWindow } from '../src/ui/crafting_window';
import { FocusManager } from '../src/ui/focus_manager';
import { makeWindowFocus } from '../src/ui/window_focus';

function item(id: string): ItemDef {
  return { id, name: id, quality: 'common', kind: 'junk', sellValue: 0 } as unknown as ItemDef;
}

function table(...items: ItemDef[]): Record<string, ItemDef> {
  return Object.fromEntries(items.map((i) => [i.id, i]));
}

function recipe(id: string, reagents: { itemId: string; count: number }[]): RecipeDefLike {
  return {
    id,
    professionId: 'cooking',
    resultItemId: `${id}_result`,
    resultCount: 1,
    reagents,
    skillReq: 0,
  };
}

/** Dispatch a Tab keydown on document (the FocusManager listens there, capture
 *  phase) and report whether it was intercepted (preventDefault called). */
function pressTab(): boolean {
  return !document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
  );
}

function craftingDeps(): CraftingWindowDeps {
  return {
    hideTooltip: () => {},
    onCraft: () => {},
    onClose: () => {},
    onOpenOrders: () => {},
    craftQty: () => 1,
    onCraftQty: () => {},
    announce: () => {},
    itemIcon: () => '',
    moneyHtml: () => '',
    itemTooltip: () => '',
    attachTooltip: () => {},
    commissionChecked: () => false,
    onToggleCommission: () => {},
    selectedCraft: () => null,
    onSelectCraft: () => {},
  };
}

/** A view with one CRAFTABLE recipe, so the painted Craft button is enabled
 *  (a disabled button is excluded from FOCUSABLE_SELECTOR) and the window
 *  carries two focusable controls: Close and Craft. */
function craftableView() {
  const items = table(item('bone_fragments'), item('recipe_a_result'));
  const inventory: InvSlot[] = [{ itemId: 'bone_fragments', count: 3 }];
  return buildCraftingView(
    [recipe('recipe_a', [{ itemId: 'bone_fragments', count: 2 }])],
    inventory,
    items,
  );
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('renderCraftingWindow: dialog role', () => {
  it('marks the root role=dialog, aria-modal=false, tabindex=-1, and names it via the crafting title', () => {
    const el = document.createElement('div');
    renderCraftingWindow(el, craftableView(), craftingDeps());
    expect(el.getAttribute('role')).toBe('dialog');
    expect(el.getAttribute('aria-modal')).toBe('false');
    expect(el.getAttribute('tabindex')).toBe('-1');
    expect(el.getAttribute('aria-label')).toBe('Crafting');
    expect(el.hasAttribute('aria-labelledby')).toBe(false);
  });

  it('keeps the dialog role after a repaint (re-render is not a one-time stamp)', () => {
    const el = document.createElement('div');
    renderCraftingWindow(el, craftableView(), craftingDeps());
    renderCraftingWindow(el, craftableView(), craftingDeps());
    expect(el.getAttribute('role')).toBe('dialog');
    expect(el.getAttribute('aria-label')).toBe('Crafting');
  });
});

describe('crafting window: Tab focus trap and restore-on-close', () => {
  it('installs the trap on open (captureFocus records the opener) and traps Tab within the window', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const el = document.createElement('div');
    el.id = 'crafting-window';
    document.body.appendChild(el);

    // The exact bridge Hud.windowFocus() builds: makeWindowFocus(this.focusManager, () => $(rootSel)).
    const fm = new FocusManager();
    const bridge = makeWindowFocus(fm, () => el);

    // Mirrors Hud.openCrafting: paint first, THEN capture (the train/unbind/
    // townFocus ordering), so the trap installs over a populated, displayed root.
    renderCraftingWindow(el, craftableView(), craftingDeps());
    const capturedOpener = bridge.captureFocus();
    expect(capturedOpener).toBe(opener);

    // Document order: Orders then Close (panel-title), the cast strip
    // (tabindex -1, EXCLUDED from the Tab cycle), the craft's tab-strip
    // button (.crafting-tabs), then the recipe row's controls in
    // .crafting-body: the Craft row button, the qty stepper (dec is disabled
    // at the qty-1 floor, so Tab skips it), and Create All.
    const ordersBtn = el.querySelector<HTMLButtonElement>('[data-open-orders]');
    const closeBtn = el.querySelector<HTMLButtonElement>('[data-close]');
    const tabBtn = el.querySelector<HTMLButtonElement>('.crafting-tab');
    const craftBtn = el.querySelector<HTMLButtonElement>('.crafting-recipe-btn');
    const decBtn = el.querySelector<HTMLButtonElement>('[data-focus-key^="qty-dec:"]');
    const incBtn = el.querySelector<HTMLButtonElement>('[data-focus-key^="qty-inc:"]');
    const createAllBtn = el.querySelector<HTMLButtonElement>('.crafting-create-all-btn');
    const strip = el.querySelector<HTMLElement>('.crafting-cast-progress');
    expect(ordersBtn).not.toBeNull();
    expect(closeBtn).not.toBeNull();
    expect(tabBtn).not.toBeNull();
    expect(craftBtn).not.toBeNull();
    expect(craftBtn?.disabled).toBe(false); // the craftable fixture precondition
    expect(decBtn?.disabled).toBe(true); // qty floor: dec starts disabled
    // 3 bone_fragments against a 2-cost recipe: mats-fit is 1, so inc is
    // ALSO at its ceiling and disabled; Tab must skip the whole stepper.
    expect(incBtn?.disabled).toBe(true);
    expect(createAllBtn?.disabled).toBe(false);
    expect(strip?.tabIndex).toBe(-1); // programmatic focus only, never tabbed

    // Walk the FULL enumerated cycle: every Tab is intercepted (the trap is
    // really installed, not a no-op that happens to leave focus alone), the
    // disabled stepper buttons and the tabindex -1 strip are skipped, and it
    // wraps to Orders rather than ever reaching the opener or body.
    closeBtn?.focus();
    expect(document.activeElement).toBe(closeBtn);
    expect(pressTab()).toBe(true);
    expect(document.activeElement).toBe(tabBtn);
    expect(pressTab()).toBe(true);
    expect(document.activeElement).toBe(craftBtn);
    expect(pressTab()).toBe(true);
    expect(document.activeElement).toBe(createAllBtn);
    expect(pressTab()).toBe(true);
    expect(document.activeElement).toBe(ordersBtn); // wraps
    expect(pressTab()).toBe(true);
    expect(document.activeElement).toBe(closeBtn);
    expect(document.activeElement).not.toBe(opener);
    expect(document.activeElement).not.toBe(document.body);
  });

  it('moves focus into the dialog on the ordinary open path before Tab is pressed', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const el = document.createElement('div');
    el.id = 'crafting-window';
    document.body.appendChild(el);

    const fm = new FocusManager();
    const bridge = makeWindowFocus(fm, () => el);

    renderCraftingWindow(el, craftableView(), craftingDeps());
    const capturedOpener = bridge.captureFocus();
    fm.focusFirst(el);

    const tabBtn = el.querySelector<HTMLButtonElement>('.crafting-tab');
    await vi.waitFor(() => expect(document.activeElement).toBe(tabBtn));

    expect(pressTab()).toBe(true);
    expect(el.contains(document.activeElement)).toBe(true);

    bridge.restoreFocus(capturedOpener);
    await vi.waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('moves focus to the selected tab for the craftId handoff path', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const el = document.createElement('div');
    el.id = 'crafting-window';
    document.body.appendChild(el);

    const fm = new FocusManager();
    const bridge = makeWindowFocus(fm, () => el);

    renderCraftingWindow(el, craftableView(), craftingDeps());
    bridge.captureFocus();
    const selected = el.querySelector<HTMLButtonElement>('.crafting-tab.sel');
    selected?.focus();

    expect(document.activeElement).toBe(selected);
    expect(pressTab()).toBe(true);
    expect(el.contains(document.activeElement)).toBe(true);

    bridge.restoreFocus(null);
  });

  it('hands focus back to the opener on close, tearing the trap down', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const el = document.createElement('div');
    el.id = 'crafting-window';
    document.body.appendChild(el);

    const fm = new FocusManager();
    const bridge = makeWindowFocus(fm, () => el);

    renderCraftingWindow(el, craftableView(), craftingDeps());
    const capturedOpener = bridge.captureFocus();

    const closeBtn = el.querySelector<HTMLButtonElement>('[data-close]');
    closeBtn?.focus();
    expect(document.activeElement).toBe(closeBtn);

    // Mirrors Hud.closeCrafting: restoreFocus(the captured opener).
    bridge.restoreFocus(capturedOpener);
    // FocusManager.restore() defers one tick (window.setTimeout(0)).
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement).toBe(opener);

    // The trap released too: Tab no longer intercepts inside the (now
    // closed) crafting window.
    const stillPrevented = pressTab();
    expect(stillPrevented).toBe(false);
  });
});

describe('hud.ts crafting window wiring (source pins; Hud is a monolith no test instantiates)', () => {
  const hudSource = readFileSync(resolve(__dirname, '../src/ui/hud.ts'), 'utf8');

  it('builds the shared windowFocus bridge for #crafting-window, the train/unbind shape', () => {
    expect(hudSource).toContain(
      "private readonly craftingWindowFocus = this.windowFocus('#crafting-window');",
    );
    expect(hudSource).toContain('private craftingOpenerFocus: HTMLElement | null = null;');
  });

  it('openCrafting captures the opener AFTER the paint, mirroring openTrain/openUnbind', () => {
    const start = hudSource.indexOf('openCrafting(craftId?: string): void {');
    const end = hudSource.indexOf('private renderCrafting(focusReturnRecipeId = ');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = hudSource.slice(start, end);
    expect(body).toContain('this.renderCrafting();');
    expect(body).toContain('this.craftingOpenerFocus = this.craftingWindowFocus.captureFocus();');
    // AFTER, not before: the render call precedes the capture.
    expect(body.indexOf('this.renderCrafting();')).toBeLessThan(
      body.indexOf('this.craftingOpenerFocus = this.craftingWindowFocus.captureFocus();'),
    );
  });

  it('openCrafting moves focus inside for both ordinary opens and craftId handoffs', () => {
    const start = hudSource.indexOf('openCrafting(craftId?: string): void {');
    const end = hudSource.indexOf('private craftCastSessionForPlayer(): CraftCastSessionView {');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = hudSource.slice(start, end);
    const selectedTabFocus =
      "($('#crafting-window').querySelector('.crafting-tab.sel') as HTMLElement | null)?.focus();";
    const ordinaryFocus = "this.focusManager.focusFirst($('#crafting-window'));";
    expect(body).toContain(selectedTabFocus);
    expect(body).toContain(ordinaryFocus);
    expect(body.indexOf('if (craftId !== undefined) {')).toBeLessThan(
      body.indexOf(selectedTabFocus),
    );
    expect(body.indexOf(selectedTabFocus)).toBeLessThan(body.indexOf(ordinaryFocus));
  });

  it('closeCrafting restores focus to the opener and clears the field', () => {
    const start = hudSource.indexOf('closeCrafting(): void {');
    const end = hudSource.indexOf('private persistCraftingTab(): void {');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = hudSource.slice(start, end);
    expect(body).toContain('this.craftingWindowFocus.restoreFocus(this.craftingOpenerFocus);');
    expect(body).toContain('this.craftingOpenerFocus = null;');
  });
});
