// The grant-SKU spend controller factory (src/ui/store_spend_controllers.ts):
// one seam object, two controllers. The arms prove the split that matters for
// money: the Armory spends with kind 'skin' and the Machine Stable with kind
// 'item', each through the SAME window spend seam, and the shared seams reach
// both controllers unchanged.

import { describe, expect, it, vi } from 'vitest';
import { STORE_MOUNT_ITEM_IDS } from '../src/sim/content/store_mounts';
import type { StoreSpendResult } from '../src/ui/claudium_purchase_bridge';
import { StoreArmoryPurchase } from '../src/ui/store_armory_purchase';
import { StoreMountPurchase } from '../src/ui/store_mount_purchase';
import {
  type StoreSpendControllerDeps,
  storeSpendControllers,
} from '../src/ui/store_spend_controllers';
import { buildArmorySections, type WocStoreItemInput } from '../src/ui/woc_store_view';

const REINS = STORE_MOUNT_ITEM_IDS[0];

function deps(): { [K in keyof StoreSpendControllerDeps]: ReturnType<typeof vi.fn> } {
  const granted: StoreSpendResult = { granted: true, balance: 0, costClaudium: 1, reason: null };
  return {
    balance: vi.fn(() => 5000),
    setBalance: vi.fn(),
    captureSurface: vi.fn(() => 1),
    surfaceIsCurrent: vi.fn(() => true),
    spend: vi.fn(async () => granted),
    showDecision: vi.fn(),
    showNeedMore: vi.fn(),
    showResult: vi.fn(),
    needMoreText: vi.fn(() => ''),
    setPriceChanged: vi.fn(),
    setError: vi.fn(),
    refreshStore: vi.fn(async () => {}),
    rebuildAndPaint: vi.fn(),
    armoryRowById: vi.fn(() => null),
    refreshInspector: vi.fn(),
  };
}

function firstArmoryRow(cost: number) {
  const skinId = buildArmorySections(0, [], {
    cosmetics: { weaponSkinIds: [], weaponSkinLoadout: {} },
    cls: 'warrior',
    mainhandItemId: null,
    skinCatalog: {} as never,
  })[0]?.rows[0]?.skin.id;
  if (!skinId) throw new Error('the shipped catalog projected no armory row');
  const service: WocStoreItemInput = {
    itemId: skinId,
    name: 'x',
    kind: 'skin',
    costClaudium: cost,
    owned: false,
  };
  const row = buildArmorySections(5000, [service], {
    cosmetics: { weaponSkinIds: [], weaponSkinLoadout: {} },
    cls: 'warrior',
    mainhandItemId: null,
    skinCatalog: {} as never,
  })
    .flatMap((section) => section.rows)
    .find((candidate) => candidate.skin.id === skinId);
  if (!row) throw new Error('the priced skin row went missing');
  return row;
}

describe('storeSpendControllers', () => {
  it('builds one controller per grant family over the same seams', () => {
    const controllers = storeSpendControllers(deps() as unknown as StoreSpendControllerDeps);
    expect(controllers.armory).toBeInstanceOf(StoreArmoryPurchase);
    expect(controllers.mounts).toBeInstanceOf(StoreMountPurchase);
  });

  it("the Machine Stable spends with kind 'item' through the shared spend seam", async () => {
    const d = deps();
    const { mounts } = storeSpendControllers(d as unknown as StoreSpendControllerDeps);
    const service: WocStoreItemInput = {
      itemId: REINS,
      name: 'x',
      kind: 'item',
      costClaudium: 1200,
      owned: false,
    };
    mounts.rebuild(5000, [service], []);
    const row = mounts.rowById(REINS);
    if (!row) throw new Error('no mount row');
    await mounts.purchase(row);
    expect(d.spend).toHaveBeenCalledWith(REINS, 'item', 1200);
    expect(d.refreshStore).toHaveBeenCalledTimes(1);
  });

  it("the Armory spends with kind 'skin' through the shared spend seam", async () => {
    const d = deps();
    const { armory } = storeSpendControllers(d as unknown as StoreSpendControllerDeps);
    const row = firstArmoryRow(900);
    d.armoryRowById.mockReturnValue({ ...row, owned: true });
    await armory.purchase(row);
    expect(d.spend).toHaveBeenCalledWith(row.skin.id, 'skin', 900);
    expect(d.refreshInspector).toHaveBeenCalledTimes(1);
  });

  it('routes the shared seams to both controllers (need-more from either family)', () => {
    const d = deps();
    d.balance.mockReturnValue(10);
    const { armory, mounts } = storeSpendControllers(d as unknown as StoreSpendControllerDeps);
    const skin = firstArmoryRow(900);
    armory.request({ ...skin, affordable: false });
    const service: WocStoreItemInput = {
      itemId: REINS,
      name: 'x',
      kind: 'item',
      costClaudium: 1200,
      owned: false,
    };
    mounts.rebuild(10, [service], []);
    mounts.request(REINS);
    expect(d.showNeedMore).toHaveBeenCalledTimes(2);
    expect(d.showDecision).not.toHaveBeenCalled();
  });
});
