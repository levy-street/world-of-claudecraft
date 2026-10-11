// @vitest-environment happy-dom
// The touch Destroy row's paint and dispatch: drives the real
// BagItemActionMenu.open() (the bag_item_action_menu_vendor_sell.test.ts
// fixture idiom). The row paints only when the bags window supplies
// runDestroy (touch HUD, destroyable stack), sits last, reads the destroy
// prompt's own "Destroy" label, and activating it hands back to the bags
// window's prompt: this painter never destroys, confirms, or refreshes.

import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { BagItemActionMenu } from '../src/ui/bag_item_action_menu';
import type { IWorld } from '../src/world_api';

const SCRAP = 'linen_scrap';

function harness() {
  const el = document.createElement('div');
  document.body.append(el);
  let destroyRuns = 0;
  let afterActions = 0;
  let activate: ((act: string) => void) | null = null;
  const world = {
    inventory: [{ itemId: SCRAP, count: 7 }],
    discardItem: () => {
      throw new Error('the Destroy row must route through the bags destroy prompt');
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
      throw new Error('the Destroy row uses the bags prompt, not the profession confirm');
    },
    slotName: () => '',
    isMobileLayout: () => true,
    afterAction: () => {
      afterActions += 1;
    },
  });
  const target = {
    index: 0,
    slot: world.inventory[0],
    refuseNotHeld: () => {
      throw new Error('the Destroy row must not refuse a held copy');
    },
  };
  const open = (withDestroy: boolean) =>
    menu.open(
      ITEMS[SCRAP],
      SCRAP,
      target,
      10,
      10,
      () => {},
      undefined,
      undefined,
      undefined,
      undefined,
      withDestroy
        ? () => {
            destroyRuns += 1;
          }
        : undefined,
    );
  const rowActs = () =>
    [...el.querySelectorAll('.ctx-item')].map((row) => row.getAttribute('data-act'));
  const click = (act: string) => {
    if (!activate) throw new Error('bind never called');
    activate(act);
  };
  return {
    open,
    rowActs,
    click,
    destroyRuns: () => destroyRuns,
    afterActions: () => afterActions,
  };
}

describe('BagItemActionMenu touch Destroy row', () => {
  it('paints Destroy last, with the destroy prompt label, when runDestroy is supplied', () => {
    const h = harness();
    h.open(true);
    expect(h.rowActs().at(-1)).toBe('destroy');
    expect(document.querySelector('.ctx-item[data-act="destroy"]')?.textContent).toBe('Destroy');
  });

  it('activating Destroy hands back to the bags destroy prompt and nothing else', () => {
    const h = harness();
    h.open(true);
    h.click('destroy');
    expect(h.destroyRuns()).toBe(1);
    expect(h.afterActions()).toBe(0);
  });

  it('paints no Destroy row without runDestroy (desktop, or a protected item)', () => {
    const h = harness();
    h.open(false);
    expect(h.rowActs()).not.toContain('destroy');
  });
});
