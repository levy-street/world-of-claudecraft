// @vitest-environment jsdom
// Behavioral pin for the WARFARE quartermaster's shop painter
// (src/ui/hud/vendor/warfare_vendor_window.ts). Round-2 review finding: the
// painter shipped with a pure-core test only, so the two behaviours phase 4.3
// says to copy EXACTLY from the Heroic Marks shop had no coverage at all.
// Modelled on tests/vendor_window_painter.test.ts, which drives the sibling
// grid painters the same way.
//
// The two behaviours, both driven through the real painter against a real DOM:
//   1. the focus ladder across an UNINITIATED repaint (an inventory or balance
//      delta repaints this window under the player), degrading to the outward
//      neighbour INSIDE THE SAME section grid and never across sections, which
//      is the whole reason the focus keys are namespaced buy:<section>:<item>;
//   2. focus restored AFTER the scroll restore, so a keyboard player's
//      focus-scroll-into-view wins over the raw offset.
// Plus the third contract that decides real money: the purchase command fires
// only from the confirm callback, never from the tile click.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ItemDef } from '../src/sim/types';
import { FocusManager } from '../src/ui/focus_manager';
import type {
  WarfareShopOffer,
  WarfareShopSection,
  WarfareShopView,
} from '../src/ui/hud/vendor/warfare_vendor_view';
import {
  renderWarfareVendorWindow,
  type WarfareVendorWindowDeps,
} from '../src/ui/hud/vendor/warfare_vendor_window';

const hud = readFileSync(join(__dirname, '../src/ui/hud.ts'), 'utf8');
const painterSource = readFileSync(
  join(__dirname, '../src/ui/hud/vendor/warfare_vendor_window.ts'),
  'utf8',
);

const SET_A = 'warfare_furyforged';
const SET_B = 'warfare_stormbound';

function item(id: string, slot: string): ItemDef {
  return {
    id,
    name: id,
    kind: 'armor',
    armorType: 'mail',
    slot,
    quality: 'epic',
    stats: {},
    priceHonor: 100,
    sellValue: 0,
  } as unknown as ItemDef;
}

function offer(
  itemId: string,
  slot: string,
  over: Partial<WarfareShopOffer> = {},
): WarfareShopOffer {
  return {
    itemId,
    item: item(itemId, slot),
    honor: 100,
    affordable: true,
    owned: false,
    ...over,
  };
}

function section(key: string, offers: WarfareShopOffer[]): WarfareShopSection {
  return {
    kind: 'set',
    key,
    setId: key,
    offers,
    tiers: [
      { pieces: 2, met: false },
      { pieces: 4, met: false },
    ],
    ownedPieces: 0,
    equippedPieces: 0,
    totalPieces: 7,
    nextTier: { pieces: 2, remaining: 2 },
  };
}

function view(sections: WarfareShopSection[], balance = 500): WarfareShopView {
  return { sections, balance };
}

function deps(over: Partial<WarfareVendorWindowDeps> = {}): WarfareVendorWindowDeps {
  return {
    itemIcon: () => '<img>',
    moneyHtml: (copper: number) => `${copper}c`,
    itemTooltip: () => '<div></div>',
    attachTooltip: () => {},
    hideTooltip: () => {},
    onBuy: () => {},
    onClose: () => {},
    ...over,
  };
}

/** Mount the panel and make scrollTop observable: jsdom implements no layout, so
 *  the real property never retains a written offset and the scroll-restore
 *  contract would be untestable through it. */
function mount(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'warfare-window';
  document.body.appendChild(el);
  let scrollTop = 0;
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
  return el;
}

function focusKeyOf(active: Element | null): string | undefined {
  return active instanceof HTMLElement ? active.dataset.focusKey : undefined;
}

function tile(el: HTMLElement, key: string): HTMLButtonElement {
  const match = el.querySelector<HTMLButtonElement>(`[data-focus-key="${key}"]`);
  expect(match, `tile ${key}`).not.toBeNull();
  return match as HTMLButtonElement;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('renderWarfareVendorWindow: focus keys are namespaced per section', () => {
  it('keys every tile buy:<sectionKey>:<itemId>, so one item id in two sections is two identities', () => {
    const el = mount();
    // The same item id deliberately appears in BOTH sections: without the
    // section in the key the two tiles would share one identity and the
    // restore ladder's exact match could land in the wrong section.
    renderWarfareVendorWindow(
      el,
      'Draven',
      view([
        section(SET_A, [offer('a_one', 'helmet'), offer('shared_piece', 'chest')]),
        section(SET_B, [offer('shared_piece', 'chest'), offer('b_two', 'legs')]),
      ]),
      deps(),
    );

    const keys = [...el.querySelectorAll<HTMLElement>('.vendor-item')].map(
      (button) => button.dataset.focusKey,
    );
    expect(keys).toEqual([
      `buy:${SET_A}:a_one`,
      `buy:${SET_A}:shared_piece`,
      `buy:${SET_B}:shared_piece`,
      `buy:${SET_B}:b_two`,
    ]);
    // Each section grid carries its own name, which is what scopes the
    // neighbour walk below to one grid.
    expect(
      [...el.querySelectorAll<HTMLElement>('.vendor-goods-grid')].map((grid) => grid.dataset.grid),
    ).toEqual([SET_A, SET_B]);
  });
});

describe('renderWarfareVendorWindow: the focus ladder across an uninitiated repaint', () => {
  it('keeps the exact tile when it comes back enabled', () => {
    const el = mount();
    const first = view([section(SET_A, [offer('a_one', 'helmet'), offer('a_two', 'chest')])]);
    renderWarfareVendorWindow(el, 'Draven', first, deps());
    tile(el, `buy:${SET_A}:a_two`).focus();

    renderWarfareVendorWindow(el, 'Draven', first, deps());

    expect(focusKeyOf(document.activeElement)).toBe(`buy:${SET_A}:a_two`);
  });

  it('degrades to the outward neighbour in the SAME grid when the tile comes back disabled', () => {
    const el = mount();
    renderWarfareVendorWindow(
      el,
      'Draven',
      view([
        section(SET_A, [
          offer('a_one', 'helmet'),
          offer('a_two', 'chest'),
          offer('a_three', 'legs'),
        ]),
        section(SET_B, [offer('b_one', 'helmet'), offer('b_two', 'chest')]),
      ]),
      deps(),
    );
    tile(el, `buy:${SET_A}:a_two`).focus();

    // The purchase the player just made spent the balance: the exact tile comes
    // back disabled, exactly the case a bare candidates[0].focus() drops.
    renderWarfareVendorWindow(
      el,
      'Draven',
      view([
        section(SET_A, [
          offer('a_one', 'helmet'),
          offer('a_two', 'chest', { affordable: false }),
          offer('a_three', 'legs'),
        ]),
        section(SET_B, [offer('b_one', 'helmet'), offer('b_two', 'chest')]),
      ]),
      deps(),
    );

    expect(focusKeyOf(document.activeElement)).toBe(`buy:${SET_A}:a_three`);
  });

  it('walks outward inside the focused grid when the tile is GONE, never onto the same id in another section', () => {
    const el = mount();
    renderWarfareVendorWindow(
      el,
      'Draven',
      view([
        section(SET_A, [
          offer('a_one', 'helmet'),
          offer('shared_piece', 'chest'),
          offer('a_three', 'legs'),
        ]),
        section(SET_B, [offer('b_one', 'helmet'), offer('shared_piece', 'chest')]),
      ]),
      deps(),
    );
    tile(el, `buy:${SET_A}:shared_piece`).focus();

    // The focused tile leaves section A entirely; section B still carries a tile
    // with the SAME item id. The ladder must stay in grid A.
    renderWarfareVendorWindow(
      el,
      'Draven',
      view([
        section(SET_A, [offer('a_one', 'helmet'), offer('a_three', 'legs')]),
        section(SET_B, [offer('b_one', 'helmet'), offer('shared_piece', 'chest')]),
      ]),
      deps(),
    );

    expect(focusKeyOf(document.activeElement)).toBe(`buy:${SET_A}:a_three`);
    expect(focusKeyOf(document.activeElement)).not.toBe(`buy:${SET_B}:shared_piece`);
  });

  it('falls to the close button rather than into another section when the focused grid has nothing enabled', () => {
    const el = mount();
    renderWarfareVendorWindow(
      el,
      'Draven',
      view([
        section(SET_A, [offer('a_one', 'helmet'), offer('a_two', 'chest')]),
        section(SET_B, [offer('b_one', 'helmet'), offer('b_two', 'chest')]),
      ]),
      deps(),
    );
    tile(el, `buy:${SET_A}:a_two`).focus();

    // Every rung of grid A is disabled; every tile of grid B is enabled. The
    // ladder's last rung is Close, so an implementation that leaked across
    // sections would land on a B tile here and fail.
    renderWarfareVendorWindow(
      el,
      'Draven',
      view([
        section(SET_A, [
          offer('a_one', 'helmet', { affordable: false }),
          offer('a_two', 'chest', { affordable: false }),
        ]),
        section(SET_B, [offer('b_one', 'helmet'), offer('b_two', 'chest')]),
      ]),
      deps(),
    );

    expect(focusKeyOf(document.activeElement)).toBe('close');
  });

  it('leaves focus alone when it was never inside this window', () => {
    const el = mount();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    renderWarfareVendorWindow(
      el,
      'Draven',
      view([section(SET_A, [offer('a_one', 'helmet')])]),
      deps(),
    );
    outside.focus();

    renderWarfareVendorWindow(
      el,
      'Draven',
      view([section(SET_A, [offer('a_one', 'helmet')])]),
      deps(),
    );

    expect(document.activeElement).toBe(outside);
  });
});

describe('renderWarfareVendorWindow: scroll restore, then focus', () => {
  it('carries the scroll offset across a repaint and focuses AFTER writing it', () => {
    const el = mount();
    renderWarfareVendorWindow(
      el,
      'Draven',
      view([section(SET_A, [offer('a_one', 'helmet'), offer('a_two', 'chest')])]),
      deps(),
    );
    tile(el, `buy:${SET_A}:a_two`).focus();
    el.scrollTop = 120;

    // Record the ORDER of the two effects: focus() may scroll its target into
    // view, so a focus written before the scroll restore would be overwritten
    // by it and a degraded target would land offscreen for a keyboard player.
    const order: string[] = [];
    const scrollSpy = vi.fn();
    let scrollTop = el.scrollTop;
    Object.defineProperty(el, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
        order.push('scroll');
        scrollSpy(value);
      },
    });
    const realFocus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function patched(this: HTMLElement, ...args: []) {
      order.push('focus');
      return realFocus.apply(this, args);
    };
    try {
      renderWarfareVendorWindow(
        el,
        'Draven',
        view([section(SET_A, [offer('a_one', 'helmet'), offer('a_two', 'chest')])]),
        deps(),
      );
    } finally {
      HTMLElement.prototype.focus = realFocus;
    }

    expect(el.scrollTop).toBe(120);
    expect(scrollSpy).toHaveBeenCalledWith(120);
    expect(order).toEqual(['scroll', 'focus']);
    expect(focusKeyOf(document.activeElement)).toBe(`buy:${SET_A}:a_two`);
  });
});

describe('renderWarfareVendorWindow: the purchase never fires from the tile', () => {
  it('reports the click through deps.onBuy and holds no command surface of its own', () => {
    const el = mount();
    const onBuy = vi.fn();
    const onClose = vi.fn();
    renderWarfareVendorWindow(
      el,
      'Draven',
      view([section(SET_A, [offer('a_one', 'helmet'), offer('a_two', 'chest')])]),
      deps({ onBuy, onClose }),
    );

    tile(el, `buy:${SET_A}:a_two`).click();

    expect(onBuy).toHaveBeenCalledTimes(1);
    expect(onBuy).toHaveBeenCalledWith('a_two');
    expect(onClose).not.toHaveBeenCalled();
    // The painter cannot buy anything even if a future edit wanted it to: it
    // never names the command, and it holds no world.
    expect(painterSource).not.toContain('buyItem');
    expect(painterSource).not.toContain('world');
  });

  it('hud.ts fires buyItem ONLY from the confirm dialog callback', () => {
    // The source pin is the honest unit here: no test in this repo constructs a
    // Hud, and the contract is about which callback the command sits in.
    const start = hud.indexOf('private requestWarfarePurchase(');
    expect(start, 'requestWarfarePurchase not found in hud.ts').toBeGreaterThanOrEqual(0);
    const body = hud.slice(start, hud.indexOf('\n  // ---', start));
    const confirmAt = body.indexOf('this.confirmDialog(');
    const buyAt = body.indexOf('this.sim.buyItem(');
    expect(confirmAt).toBeGreaterThanOrEqual(0);
    expect(buyAt).toBeGreaterThan(confirmAt);
    // The one occurrence sits inside an arrow handed to confirmDialog, which is
    // what makes the confirm a GATE rather than a notification beside the buy.
    expect(body.match(/this\.sim\.buyItem\(/g)).toHaveLength(1);
    expect(body).toContain('() => this.sim.buyItem(npcId, itemId),');
    // The tile click routes to the confirm-gated method, never to the command.
    expect(hud).toContain('onBuy: (itemId) => this.requestWarfarePurchase(npc.id, itemId),');
  });
});

describe('hud.ts wiring for #warfare-window', () => {
  it('repaints the open shop on the offline vendor event, beside the heroic one', () => {
    // Offline, onInventoryChanged fires only from bank ops and the online net
    // path, so without this arm an honor purchase left the balance, the
    // affordability, the Owned marks and the progress line stale until the
    // window was closed and reopened.
    const start = hud.indexOf("case 'vendor': {");
    expect(start).toBeGreaterThanOrEqual(0);
    const arm = hud.slice(start, hud.indexOf('break;', start));
    expect(arm).toContain('if (this.openHeroicVendorNpcId !== null) this.renderHeroicVendor();');
    expect(arm).toContain('if (this.openWarfareVendorNpcId !== null) this.renderWarfareVendor();');
  });

  it('installs the standalone Tab trap and releases it on close', () => {
    // The vendor / heroic windows deliberately do NOT trap, because they pair
    // with the #bags companion. The warfare shop has no bags companion, so it
    // takes the train / unbind / crafting standalone shape instead.
    expect(hud).toContain("this.windowFocus('#warfare-window')");
    const openStart = hud.indexOf('openWarfareVendor(npcId: number');
    const closeStart = hud.indexOf('closeWarfareVendor(): void {');
    expect(openStart).toBeGreaterThanOrEqual(0);
    expect(closeStart).toBeGreaterThan(openStart);
    expect(hud.slice(openStart, closeStart)).toContain('this.warfareWindowFocus.captureFocus()');
    expect(hud.slice(closeStart)).toContain(
      'this.warfareWindowFocus.restoreFocus(this.warfareVendorOpenerFocus)',
    );
  });
});

describe('#warfare-window traps Tab (WCAG 2.4.3 / 2.1.2)', () => {
  it('cycles focus inside the shop instead of letting Tab escape into the world HUD', () => {
    // jsdom implements no layout, so FocusManager.canFocus (isConnected plus a
    // non-empty client rect) would reject every node and the trap would
    // self-heal away. Stub the rect read for this case only.
    const realRects = Element.prototype.getClientRects;
    Element.prototype.getClientRects = function stub(this: Element) {
      return [{ width: 10, height: 10 }] as unknown as DOMRectList;
    };
    const el = mount();
    const world = document.createElement('button');
    world.id = 'outside-the-shop';
    document.body.appendChild(world);
    const manager = new FocusManager();
    try {
      renderWarfareVendorWindow(
        el,
        'Draven',
        view([section(SET_A, [offer('a_one', 'helmet'), offer('a_two', 'chest')])]),
        deps(),
      );
      const handle = manager.open({ root: () => el });
      // Stand on the LAST focusable in the window; a native Tab from here would
      // leave the dialog.
      const last = tile(el, `buy:${SET_A}:a_two`);
      last.focus();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));

      expect(el.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).not.toBe(world);
      expect(focusKeyOf(document.activeElement)).toBe('close');
      handle.release(false);
    } finally {
      Element.prototype.getClientRects = realRects;
    }
  });
});
