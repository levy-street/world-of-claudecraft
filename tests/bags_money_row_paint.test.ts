// @vitest-environment jsdom
// The bag money row's own staleness refresh (issue #2373), driven against the REAL
// BagsWindow painter in jsdom (the bags_window_instance_marker.test.ts idiom).
//
// The pure decision behind it (bagsMoneyRowStale) is a truth table in
// bags_view.test.ts; what this file pins is the painter half, and above all what the
// refresh must NOT disturb. Every other bags repaint path is user-initiated (a click,
// a keystroke) and hides the tooltip first. This one fires from a server credit or a
// coin-only mob loot with no user action behind it, so a full render() here would
// yank the bag-search caret mid-word, strand a hovered tooltip and drop an armed
// touch drag. Hence a narrow .money rewrite, and hence these assertions.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvSlot } from '../src/sim/types';
import { BagsWindow, type BagsWindowDeps } from '../src/ui/bags_window';
import { ItemDragState } from '../src/ui/item_drag_state';
import type { IWorld } from '../src/world_api';

const SWORD: InvSlot[] = [{ itemId: 'sword', count: 1 }];

interface Harness {
  window: BagsWindow;
  root: HTMLElement;
  setCopper(next: number): void;
  moneyText(): string;
  hideTooltip: ReturnType<typeof vi.fn>;
  /** How many times the money row has been PAINTED. Counted through the moneyHtml
   *  dep, which every paint calls exactly once. A marker attribute on the .money
   *  element cannot serve here: innerHTML replaces the row's children, not the row,
   *  so a marker survives a repaint and an elision assertion built on it would pass
   *  even with the latch removed entirely. */
  paints(): number;
}

function harness(startCopper = 1000, inventory: InvSlot[] = SWORD): Harness {
  const root = document.createElement('div');
  root.style.display = 'flex';
  document.body.appendChild(root);
  let copper = startCopper;
  let paints = 0;
  const noop = (): void => {};
  const hideTooltip = vi.fn();
  const deps: BagsWindowDeps = {
    itemIcon: () => '<span class="item-icon"></span>',
    // Echo the purse so an assertion can see WHICH value was painted, not merely
    // that something repainted, and count the paints for the elision assertions.
    moneyHtml: (c: number) => {
      paints++;
      return `<span class="coin-amount">${c}</span>`;
    },
    itemTooltip: () => '',
    attachTooltip: noop,
    root: () => root,
    world: () =>
      ({
        inventory,
        bags: [null, null, null, null],
        bagCapacity: 16,
        get copper() {
          return copper;
        },
      }) as unknown as IWorld,
    wocBalanceHtml: () => '',
    claudiumLauncherHtml: () => '',
    openClaudium: noop,
    openWallet: noop,
    hideTooltip,
    consumePeek: () => false,
    cancelPetFeed: noop,
    captureFocus: () => null,
    restoreFocus: noop,
    renderCharIfOpen: noop,
    vendorOpen: () => false,
    tradeOpen: () => false,
    isMarketSell: () => false,
    isMailAttach: () => false,
    isBankOpen: () => false,
    pendingPetFeed: () => false,
    closeVendor: noop,
    closeBank: noop,
    onClosed: noop,
    addItemToTrade: noop,
    stageMarketSell: noop,
    stageMailParcel: noop,
    insertItemChatLink: noop,
    showError: noop,
    setPendingPetFeed: noop,
    resetPetBarSig: noop,
    isHotbarItemId: () => false,
    useGatherTool: () => false,
    setDragAction: noop,
    clearActionDropTargets: noop,
    dragState: new ItemDragState(),
    isTouchHud: () => false,
    markEquipDropTargets: noop,
    dropOnEquipSlot: noop,
    openItemActionMenu: noop,
  };
  return {
    window: new BagsWindow(deps),
    root,
    setCopper: (next) => {
      copper = next;
    },
    moneyText: () => root.querySelector('.money')?.textContent ?? '',
    hideTooltip,
    paints: () => paints,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('BagsWindow.refreshIfChanged', () => {
  it('repaints the money row when the purse moves (the issue #2373 repro)', () => {
    const h = harness(1000);
    h.window.render();
    expect(h.moneyText()).toContain('1000');

    // The auctioneer pays out: proceeds land with no inventory change at all.
    h.setCopper(55321);
    h.window.refreshIfChanged();
    expect(h.moneyText()).toContain('55321');
  });

  it('elides when the purse has not moved', () => {
    const h = harness(1000);
    h.window.render();
    expect(h.paints()).toBe(1);
    // An elided probe must not rewrite the row at all, or the 500ms band would
    // churn the footer twice a second forever.
    h.window.refreshIfChanged();
    h.window.refreshIfChanged();
    expect(h.paints()).toBe(1);
    expect(h.moneyText()).toContain('1000');
  });

  it('paints nothing while the window is HIDDEN, then converges when it reopens', () => {
    const h = harness(1000);
    h.window.render();
    h.root.style.display = 'none';
    h.setCopper(7777);
    h.window.refreshIfChanged();
    expect(h.moneyText()).toContain('1000'); // still the pre-credit purse

    // Reopening rebuilds the whole window, which is what actually converges it.
    h.root.style.display = 'flex';
    h.window.render();
    expect(h.moneyText()).toContain('7777');
  });

  it('paints nothing on a never-opened window (cold display "", issue #1538)', () => {
    const h = harness(1000);
    h.window.render();
    h.root.style.display = ''; // the cold-load value the .window CSS rule hides
    h.setCopper(4242);
    h.window.refreshIfChanged();
    expect(h.moneyText()).toContain('1000');
  });

  it('re-arms the latch on a full render, so no probe owes a second paint', () => {
    const h = harness(1000);
    h.setCopper(9000);
    h.window.render(); // arms at 9000
    expect(h.paints()).toBe(1);
    h.window.refreshIfChanged();
    expect(h.paints()).toBe(1);
  });

  it('re-arms the latch on its OWN paint, so one credit paints exactly once', () => {
    // Without this the latch would stay at the -1 cold sentinel and every probe
    // would repaint: a 2 Hz rewrite of the footer for the rest of the session.
    const h = harness(1000);
    h.window.render();
    h.setCopper(5000);
    h.window.refreshIfChanged();
    expect(h.paints()).toBe(2);
    h.window.refreshIfChanged();
    h.window.refreshIfChanged();
    expect(h.paints()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The public entry point the async balance reads use. refreshIfChanged is the
// purse-driven probe and elides on an unmoved purse; refreshMoneyRow is the
// unconditional repaint, because the $WOC and Claudium balances move while `copper`
// stands still. Driving it directly is what keeps those two from collapsing into one.
// ---------------------------------------------------------------------------

describe('BagsWindow.refreshMoneyRow (the async balance-read entry point)', () => {
  it('repaints even when the purse has NOT moved', () => {
    // The whole reason it is a separate public method. A $WOC or Claudium balance
    // landing changes the footer markup with `copper` untouched, so a refreshMoneyRow
    // that consulted the lastMoneyCopper latch (or delegated to refreshIfChanged)
    // would silently never paint the new balance.
    const h = harness(1000);
    h.window.render();
    expect(h.paints()).toBe(1);

    h.window.refreshMoneyRow();
    expect(h.paints()).toBe(2);
    h.window.refreshMoneyRow();
    expect(h.paints()).toBe(3);
    expect(h.moneyText()).toContain('1000'); // and it repaints the CURRENT purse
  });

  it('re-arms the latch, so it never leaves a paint owed to the purse probe', () => {
    const h = harness(1000);
    h.window.render();
    h.setCopper(5000);
    h.window.refreshMoneyRow(); // paints 5000 off the balance read's own schedule
    expect(h.paints()).toBe(2);
    h.window.refreshIfChanged(); // the purse probe now has nothing left to do
    expect(h.paints()).toBe(2);
    expect(h.moneyText()).toContain('5000');
  });

  it('is a no-op on a window that has never rendered (no .money row yet)', () => {
    // Both call sites fire from a promise resolve, so this can land before the
    // player has ever opened the bag. It must not throw and must not half-paint.
    const h = harness(1000);
    expect(() => h.window.refreshMoneyRow()).not.toThrow();
    expect(h.paints()).toBe(0);
    expect(h.root.querySelector('.money')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// What the refresh must not disturb. These are the reason it is a narrow .money
// rewrite rather than renderBags(): this edge fires with no user action behind it.
// ---------------------------------------------------------------------------

describe('BagsWindow.refreshIfChanged preserves what the player is holding', () => {
  it('does not rebuild the grid (a hovered row keeps its identity and listeners)', () => {
    const h = harness(1000);
    h.window.render();
    const grid = h.root.querySelector('.bag-grid');
    const cell = grid?.firstElementChild;
    expect(grid).not.toBeNull();
    expect(cell).not.toBeNull();

    h.setCopper(5000);
    h.window.refreshIfChanged();

    // Same NODES, not merely equal markup: a rebuild would drop the tooltip and
    // drag listeners bound to the old cell, which is the #2375-adjacent hazard.
    expect(h.root.querySelector('.bag-grid')).toBe(grid);
    expect(h.root.querySelector('.bag-grid')?.firstElementChild).toBe(cell);
  });

  it('keeps focus and the caret in the bag-search box mid-word', () => {
    const h = harness(1000);
    h.window.render();
    const search = h.root.querySelector('.bag-search') as HTMLInputElement | null;
    expect(search, 'the filter bar renders whenever the bag has items').not.toBeNull();
    const box = search as HTMLInputElement;
    box.value = 'swo';
    box.focus();
    box.setSelectionRange(2, 2);
    expect(document.activeElement).toBe(box);

    // A coin-only mob loot lands while the player is typing.
    h.setCopper(1007);
    h.window.refreshIfChanged();

    expect(h.root.querySelector('.bag-search')).toBe(box); // never re-created
    expect(document.activeElement).toBe(box);
    expect(box.value).toBe('swo');
    expect(box.selectionStart).toBe(2);
    expect(h.moneyText()).toContain('1007');
  });

  it('never reaches for hideTooltip on this path', () => {
    // Scope note: this guards against ADDING a hideTooltip() to the refresh path,
    // it does not catch a regression to a full render(). render() does not call
    // hideTooltip either (only close() and the click/drag handlers do), so the
    // full-rebuild tooltip hazard is really the loss of the hovered row's LISTENERS,
    // and that is what the grid node-identity assertion above pins.
    // The click/drag paths dismiss the tooltip deliberately because the player just
    // acted. This edge has no user action behind it, so it must stay hands-off.
    const h = harness(1000);
    h.window.render();
    h.hideTooltip.mockClear();
    h.setCopper(5000);
    h.window.refreshIfChanged();
    expect(h.hideTooltip).not.toHaveBeenCalled();
  });

  // BOTH launchers, one case each. A single combined assertion is not enough here:
  // with only the Claudium arm, deleting the wallet re-bind from paintMoneyRow left
  // all 55 tests green, and the footer's Connect/Link wallet button would have gone
  // dead after the first purse-driven repaint. wocBalanceHtml emits
  // [data-wallet-action] only on its BUTTON variant (an unverified wallet), which is
  // exactly the case a real player hits before verifying.
  for (const launcher of [
    {
      name: 'Claudium',
      html: 'claudiumLauncherHtml',
      hook: 'openClaudium',
      attr: 'data-claudium-launcher',
    },
    { name: 'wallet', html: 'wocBalanceHtml', hook: 'openWallet', attr: 'data-wallet-action' },
  ] as const) {
    it(`keeps the ${launcher.name} launcher wired after an in-place rewrite`, () => {
      const opened: string[] = [];
      const h = harness(1000);
      const w = h.window as unknown as { deps: Record<string, unknown> };
      w.deps[launcher.html] = () => `<button ${launcher.attr}>x</button>`;
      w.deps[launcher.hook] = () => opened.push(launcher.name);
      h.window.render();
      h.setCopper(5000);
      h.window.refreshIfChanged();

      // Prove the click lands on a FRESH node. Without this the arm passes off the
      // binding render() already did, so a refreshIfChanged stubbed to a no-op would
      // stay green; two paints means the in-place rewrite the title claims really ran.
      expect(h.paints()).toBe(2);
      (h.root.querySelector(`[${launcher.attr}]`) as HTMLElement | null)?.click();
      expect(opened).toEqual([launcher.name]);
    });
  }

  it('deliberately does NOT restore focus onto the rewritten launcher (PR #2377 ruling)', () => {
    // Tempting to copy the deeds/professions "refocus the role-equivalent control"
    // family here, since the rewrite really does drop focus to <body>. Do not: it was
    // ruled out on PR #2377 and both reasons still hold.
    //  - Each footer control is a BUTTON, and src/game/input.ts cancels Enter's
    //    default on the chat edge only when `tag !== 'button'`, on the stated grounds
    //    that a button's own Enter activation is a real default action too. Parking
    //    focus back on one makes the player's next Enter (meaning "open chat") ALSO
    //    open the Claudium store or re-fire the wallet connect flow.
    //  - #bags is non-modal and absent from Hud.isModalOpen(), so canUseGameKeys()
    //    stays true and input.ts preventDefaults Tab for target-nearest. Keyboard
    //    focus cannot reach this footer at all, so there is no WCAG 2.4.3 debt to pay
    //    off here, only the Enter hazard to buy.
    // Pinned so the next reader finds the ruling instead of re-deriving the family.
    const h = harness(1000);
    const w = h.window as unknown as { deps: Record<string, unknown> };
    w.deps.claudiumLauncherHtml = () => '<button data-claudium-launcher>c</button>';
    h.window.render();
    const before = h.root.querySelector('[data-claudium-launcher]') as HTMLElement;
    before.focus();
    expect(document.activeElement).toBe(before);

    h.setCopper(5000);
    h.window.refreshIfChanged();

    // The rewrite happened (fresh node), and focus was left where the browser put it.
    expect(h.root.querySelector('[data-claudium-launcher]')).not.toBe(before);
    expect(document.activeElement).toBe(document.body);
  });
});
