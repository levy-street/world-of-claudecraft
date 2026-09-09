// @vitest-environment jsdom
//
// The commission board's gathering-goal Track control (Intentional Gathering
// PR4): rendered ONLY alongside Deliver (accepted AND mineToCraft), so an
// open order targeted at this viewer (which also carries mineToCraft) never
// shows it. Mirrors tests/commission_order_window.test.ts's rig.

import { describe, expect, it, vi } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { buildCommissionOrderBoardModel } from '../src/ui/hud/professions/commission_order_view';
import {
  type CommissionOrderWindowDeps,
  renderCommissionOrderWindow,
} from '../src/ui/hud/professions/commission_order_window';
import type { CommissionOrderView } from '../src/world_api/professions';

const SWORD_RECIPE = 'recipe_eastbrook_arming_sword';
const SWORD = 'eastbrook_arming_sword';

function order(overrides: Partial<CommissionOrderView> = {}): CommissionOrderView {
  return {
    id: 7,
    requesterName: 'Ayla',
    recipeId: SWORD_RECIPE,
    itemId: SWORD,
    scope: 'open',
    status: 'open',
    mine: false,
    mineToCraft: false,
    ...overrides,
  };
}

function deps(overrides: Partial<CommissionOrderWindowDeps> = {}): CommissionOrderWindowDeps {
  return {
    hideTooltip: vi.fn(),
    onOpen: vi.fn(),
    onCancel: vi.fn(),
    onAccept: vi.fn(),
    onDeliver: vi.fn(),
    onClose: vi.fn(),
    itemIcon: vi.fn(() => ''),
    moneyHtml: vi.fn(() => ''),
    itemTooltip: vi.fn(() => ''),
    attachTooltip: vi.fn(),
    ...overrides,
  };
}

function trackButtons(el: HTMLElement): HTMLButtonElement[] {
  return [...el.querySelectorAll<HTMLButtonElement>('.commission-order-track-btn')];
}

describe('renderCommissionOrderWindow: Track visibility, exactly canDeliver', () => {
  it('an ACCEPTED order this viewer is crafting shows Track', () => {
    const el = document.createElement('div');
    const model = buildCommissionOrderBoardModel(
      [order({ mineToCraft: true, status: 'accepted' })],
      [],
      ITEMS,
    );
    renderCommissionOrderWindow(el, model, deps({ onTrack: vi.fn() }));
    expect(trackButtons(el)).toHaveLength(1);
  });

  it('an OPEN order targeted at this viewer (mineToCraft true, status open) does NOT show Track', () => {
    const el = document.createElement('div');
    const model = buildCommissionOrderBoardModel(
      [order({ mineToCraft: true, status: 'open', scope: 'crafter' })],
      [],
      ITEMS,
    );
    renderCommissionOrderWindow(el, model, deps({ onTrack: vi.fn() }));
    expect(trackButtons(el)).toHaveLength(0);
  });

  it('an order this viewer did not accept to craft never shows Track, even when supplied', () => {
    const el = document.createElement('div');
    const model = buildCommissionOrderBoardModel(
      [order({ mineToCraft: false, status: 'accepted' })],
      [],
      ITEMS,
    );
    renderCommissionOrderWindow(el, model, deps({ onTrack: vi.fn() }));
    expect(trackButtons(el)).toHaveLength(0);
  });

  it('omitting onTrack renders no Track affordance at all, even on a deliverable row', () => {
    const el = document.createElement('div');
    const model = buildCommissionOrderBoardModel(
      [order({ mineToCraft: true, status: 'accepted' })],
      [],
      ITEMS,
    );
    renderCommissionOrderWindow(el, model, deps());
    expect(trackButtons(el)).toHaveLength(0);
  });
});

describe('renderCommissionOrderWindow: Track fires exactly once, only on explicit click', () => {
  it('rendering a deliverable row never calls onTrack by itself', () => {
    const el = document.createElement('div');
    const onTrack = vi.fn();
    const model = buildCommissionOrderBoardModel(
      [order({ id: 9, mineToCraft: true, status: 'accepted' })],
      [],
      ITEMS,
    );
    renderCommissionOrderWindow(el, model, deps({ onTrack }));
    expect(onTrack).not.toHaveBeenCalled();
  });

  it('clicking Track calls onTrack exactly once with the order id', () => {
    const el = document.createElement('div');
    const onTrack = vi.fn();
    const model = buildCommissionOrderBoardModel(
      [order({ id: 9, mineToCraft: true, status: 'accepted' })],
      [],
      ITEMS,
    );
    renderCommissionOrderWindow(el, model, deps({ onTrack }));
    const btn = trackButtons(el)[0];
    expect(btn).toBeDefined();
    btn.click();
    expect(onTrack).toHaveBeenCalledTimes(1);
    expect(onTrack).toHaveBeenCalledWith(9);
  });

  it('clicking Deliver (a separate action) never calls onTrack', () => {
    const el = document.createElement('div');
    const onTrack = vi.fn();
    const onDeliver = vi.fn();
    const model = buildCommissionOrderBoardModel(
      [order({ id: 9, mineToCraft: true, status: 'accepted' })],
      [],
      ITEMS,
    );
    renderCommissionOrderWindow(el, model, deps({ onTrack, onDeliver }));
    const deliverBtn = [...el.querySelectorAll('.commission-order-btn')].find(
      (b) => b.textContent === 'Deliver',
    ) as HTMLButtonElement;
    deliverBtn.click();
    expect(onDeliver).toHaveBeenCalledWith(9);
    expect(onTrack).not.toHaveBeenCalled();
  });
});
