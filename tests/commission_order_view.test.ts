// Pure-core tests for the commission order board (issue #1298).
// buildCommissionOrderBoardModel is DOM-free; drive it directly with a
// hand-built CommissionOrderView[] (the IWorld projection shape both hosts
// mirror) the way tests/crafting_view.test.ts drives buildCraftingView.

import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { buildCommissionOrderBoardModel } from '../src/ui/commission_order_view';
import type { CommissionOrderView } from '../src/world_api/professions';

const SWORD_RECIPE = 'recipe_eastbrook_arming_sword';
const SWORD = 'eastbrook_arming_sword'; // weapon, commission-eligible
const POTION_RECIPE = 'recipe_minor_healing_potion';
const POTION = 'minor_healing_potion'; // commission-ineligible

function order(overrides: Partial<CommissionOrderView> = {}): CommissionOrderView {
  return {
    id: 1,
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

describe('buildCommissionOrderBoardModel', () => {
  it('buckets a row the viewer opened into myOrders', () => {
    const model = buildCommissionOrderBoardModel([order({ mine: true })], [], ITEMS);
    expect(model.myOrders).toHaveLength(1);
    expect(model.toCraft).toHaveLength(0);
    expect(model.board).toHaveLength(0);
    expect(model.myOrders[0].item?.name).toBe(ITEMS[SWORD].name);
  });

  it('buckets a row the viewer is crafting (accepted or targeted-open) into toCraft', () => {
    const accepted = order({
      id: 2,
      mineToCraft: true,
      status: 'accepted',
      acceptedByName: 'Borin',
    });
    const targeted = order({ id: 3, mineToCraft: true, scope: 'crafter', crafterName: 'Borin' });
    const model = buildCommissionOrderBoardModel([accepted, targeted], [], ITEMS);
    expect(model.myOrders).toHaveLength(0);
    expect(model.toCraft).toHaveLength(2);
    expect(model.board).toHaveLength(0);
  });

  it('buckets every other visible row into the general open board', () => {
    const model = buildCommissionOrderBoardModel([order()], [], ITEMS);
    expect(model.myOrders).toHaveLength(0);
    expect(model.toCraft).toHaveLength(0);
    expect(model.board).toHaveLength(1);
  });

  it('resolves canCancel/canAccept/canDeliver off mine/mineToCraft/status, not off scope', () => {
    const cancelable = order({ id: 1, mine: true, status: 'open' });
    const notCancelableAccepted = order({ id: 2, mine: true, status: 'accepted' });
    const acceptable = order({ id: 3, status: 'open' });
    const acceptableTargetedAtMe = order({
      id: 4,
      status: 'open',
      mineToCraft: true,
      scope: 'crafter',
      crafterName: 'Borin',
    });
    const deliverable = order({ id: 5, mineToCraft: true, status: 'accepted' });
    const model = buildCommissionOrderBoardModel(
      [cancelable, notCancelableAccepted, acceptable, acceptableTargetedAtMe, deliverable],
      [],
      ITEMS,
    );
    const byId = new Map(
      [...model.myOrders, ...model.toCraft, ...model.board].map((r) => [r.id, r]),
    );
    expect(byId.get(1)).toMatchObject({ canCancel: true, canAccept: false, canDeliver: false });
    expect(byId.get(2)).toMatchObject({ canCancel: false, canAccept: false, canDeliver: false });
    expect(byId.get(3)).toMatchObject({ canCancel: false, canAccept: true, canDeliver: false });
    // #4 is mineToCraft (a 'crafter'-scope order still open, targeted at the
    // viewer): it lands in the "My Commissions" section (toCraft), and it IS
    // acceptable there, since the named crafter is the only one who can
    // accept a 'crafter'-scope order. Not yet accepted, so not deliverable.
    expect(byId.get(4)).toMatchObject({ canCancel: false, canAccept: true, canDeliver: false });
    expect(byId.get(5)).toMatchObject({ canCancel: false, canAccept: false, canDeliver: true });
  });

  it('the "open a new order" picker lists only known, commission-eligible recipes', () => {
    const model = buildCommissionOrderBoardModel(
      [],
      [
        { id: SWORD_RECIPE, resultItemId: SWORD },
        { id: POTION_RECIPE, resultItemId: POTION },
      ],
      ITEMS,
    );
    expect(model.openableRecipes).toEqual([
      { recipeId: SWORD_RECIPE, itemId: SWORD, item: ITEMS[SWORD] },
    ]);
  });

  it('an unresolved item id (stale content) still rows without throwing', () => {
    const model = buildCommissionOrderBoardModel(
      [order({ itemId: 'qa_no_such_item', mine: true })],
      [],
      ITEMS,
    );
    expect(model.myOrders[0].item).toBeUndefined();
    expect(model.myOrders[0].itemId).toBe('qa_no_such_item');
  });
});
