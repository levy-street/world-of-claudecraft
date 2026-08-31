// @vitest-environment happy-dom
// The vendor "Sell all (N)" row's dispatch (new-player-first-hour doc,
// section 6): drives the real BagItemActionMenu.open() with a vendorSellCount
// supplied (bag_item_action_menu_paint.test.ts covers the professions-menu
// paint/dispatch flows; this covers the sibling vendor row set the same
// painter now offers). Pins that the row only PAINTS above one held copy, and
// that activating it delegates back to BagsWindow's vendor sale policy instead
// of selling directly from this menu painter.

import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { BagItemActionMenu } from '../src/ui/bag_item_action_menu';
import type { IWorld } from '../src/world_api';

const BREAD = 'baked_bread';

function harness() {
  const el = document.createElement('div');
  document.body.append(el);
  let sellAllRuns = 0;
  let afterActions = 0;
  let activate: ((act: string) => void) | null = null;
  const world = {
    inventory: [{ itemId: BREAD, count: 8 }],
    sellItem: () => {
      throw new Error('Sell all must route through the bag-window vendor safety policy');
    },
  };
  const menu = new BagItemActionMenu({
    world: () => world as unknown as IWorld,
    ctxMenu: {
      element: () => el,
      place: () => {},
      bind: (onActivate) => {
        activate = onActivate;
      },
    },
    confirmDialog: () => {
      throw new Error('the vendor row set never opens a confirm dialog');
    },
    slotName: () => '',
    isMobileLayout: () => false,
    afterAction: () => {
      afterActions += 1;
    },
  });
  const open = (vendorSellCount?: number) =>
    menu.open(
      ITEMS[BREAD],
      BREAD,
      0,
      10,
      10,
      () => {},
      undefined,
      vendorSellCount,
      () => {
        sellAllRuns += 1;
      },
    );
  const rowActs = () =>
    [...el.querySelectorAll('.ctx-item')].map((row) => row.getAttribute('data-act'));
  const click = (act: string) => {
    if (!activate) throw new Error('bind never called');
    activate(act);
  };
  return { open, rowActs, click, sellAllRuns: () => sellAllRuns, afterActions: () => afterActions };
}

describe('BagItemActionMenu vendor Sell all dispatch', () => {
  it('paints only the classic Sell row when a single copy is held', () => {
    const h = harness();
    h.open(1);
    expect(h.rowActs()).toEqual(['default']);
  });

  it('adds the sellAll row once more than one copy is held, and its label carries the count', () => {
    const h = harness();
    h.open(8);
    expect(h.rowActs()).toEqual(['default', 'sellAll']);
    const sellAllRow = document.querySelector('.ctx-item[data-act="sellAll"]');
    expect(sellAllRow?.textContent).toBe('Sell all (8)');
  });

  it('activating Sell all delegates to the bag-window vendor safety policy', () => {
    const h = harness();
    h.open(8);
    h.click('sellAll');
    expect(h.sellAllRuns()).toBe(1);
    expect(h.afterActions()).toBe(0);
  });

  it('the professions row set is untouched when no vendorSellCount is supplied', () => {
    const h = harness();
    h.open(undefined);
    expect(h.rowActs()).not.toContain('sellAll');
  });
});
