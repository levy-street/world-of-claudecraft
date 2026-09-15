// The WOC Store's inspect-overlay wiring (src/ui/store_inspect_deps.ts): what
// the Armory and Machine Stable panels read from the world and where each
// action lands, pinned against a fake world and fake spend controllers so the
// store window stays a thin consumer.

import { describe, expect, it, vi } from 'vitest';
import { MOUNT_SKIN_IDS } from '../src/sim/content/mount_skins';
import {
  armoryInspectDeps,
  mountInspectDeps,
  storePreviewAppearance,
} from '../src/ui/store_inspect_deps';
import type { ArmorySkinRow, StoreMountRow } from '../src/ui/woc_store_view';

const REINS = MOUNT_SKIN_IDS[0];
const OTHER = MOUNT_SKIN_IDS[1];

interface FakeWorld {
  player: {
    templateId: string;
    skin: number;
    skinCatalog: 'class' | 'mech';
    mainhandItemId: string | null;
    offhandItemId: string | null;
    mountSkinId: string | null;
  };
  accountCosmetics: {
    weaponSkinIds: string[];
    weaponSkinLoadout: Record<string, string>;
    mountSkinIds: string[];
  };
  ownedMounts: ReturnType<typeof vi.fn>;
  changeMountSkin: ReturnType<typeof vi.fn>;
  changeWeaponSkin: ReturnType<typeof vi.fn>;
}

function fakeWorld(
  over: {
    loadout?: Record<string, string>;
    mountSkinIds?: string[];
    mountSkinId?: string | null;
    ownedMounts?: string[];
  } = {},
): FakeWorld {
  return {
    player: {
      templateId: 'warrior',
      skin: 0,
      skinCatalog: 'class',
      mainhandItemId: 'worn_sword',
      offhandItemId: null,
      mountSkinId: over.mountSkinId ?? null,
    },
    accountCosmetics: {
      weaponSkinIds: ['ice_fang_sword'],
      weaponSkinLoadout: over.loadout ?? {},
      mountSkinIds: over.mountSkinIds ?? [],
    },
    ownedMounts: vi.fn(() => over.ownedMounts ?? ['valorsteed']),
    changeMountSkin: vi.fn(),
    changeWeaponSkin: vi.fn(),
  };
}

function fakeSpend(rowById: (id: string) => StoreMountRow | null = () => null) {
  return {
    armory: { request: vi.fn() },
    mounts: { request: vi.fn(), rowById: vi.fn(rowById) },
  };
}

function storeRow(over: Partial<StoreMountRow> = {}): StoreMountRow {
  return {
    itemId: REINS,
    skinId: REINS,
    costClaudium: 1200,
    purchasable: true,
    owned: false,
    affordable: true,
    shortfall: null,
    ...over,
  };
}

describe('storePreviewAppearance', () => {
  it('carries the body, both hands, and the resolved Armory skin for the held sword', () => {
    const world = fakeWorld({ loadout: { sword: 'ice_fang_sword' } });
    world.player.offhandItemId = 'worn_shield';
    expect(storePreviewAppearance(world as never)).toEqual({
      cls: 'warrior',
      skin: 0,
      skinCatalog: 'class',
      mainhandItemId: 'worn_sword',
      offhandItemId: 'worn_shield',
      weaponSkinId: 'ice_fang_sword',
    });
  });

  it('resolves no weapon skin from an empty loadout and a null offhand', () => {
    const appearance = storePreviewAppearance(fakeWorld() as never);
    expect(appearance.weaponSkinId).toBeNull();
    expect(appearance.offhandItemId).toBeNull();
    expect(appearance.mainhandItemId).toBe('worn_sword');
  });

  it('ignores a loadout entry for a weapon type the mainhand is not', () => {
    const world = fakeWorld({ loadout: { axe: 'glaciersplit_axe' } });
    expect(storePreviewAppearance(world as never).weaponSkinId).toBeNull();
  });
});

describe('armoryInspectDeps', () => {
  function seams(world: FakeWorld, open: string | null = null) {
    const spend = fakeSpend();
    const afterArmoryChange = vi.fn();
    const deps = armoryInspectDeps({
      world: () => world as never,
      spend: spend as never,
      afterArmoryChange,
      openArmorySkinId: () => open,
    });
    return { deps, spend, afterArmoryChange };
  }

  it('reads the appearance from the world at call time', () => {
    const world = fakeWorld({ loadout: { sword: 'ice_fang_sword' } });
    const { deps } = seams(world);
    expect(deps.appearance().weaponSkinId).toBe('ice_fang_sword');
    world.accountCosmetics.weaponSkinLoadout = {};
    expect(deps.appearance().weaponSkinId).toBeNull();
  });

  it('routes a buy to the armory spend controller with the row', () => {
    const { deps, spend } = seams(fakeWorld());
    const target = { skin: { id: 'ice_fang_sword' } } as unknown as ArmorySkinRow;
    deps.requestBuy(target);
    expect(spend.armory.request).toHaveBeenCalledTimes(1);
    expect(spend.armory.request).toHaveBeenCalledWith(target);
  });

  it('applies a skin through the world, then re-projects that skin', () => {
    const world = fakeWorld();
    const { deps, afterArmoryChange } = seams(world);
    deps.applySkin('ice_fang_sword');
    expect(world.changeWeaponSkin).toHaveBeenCalledTimes(1);
    expect(world.changeWeaponSkin).toHaveBeenCalledWith('ice_fang_sword');
    expect(afterArmoryChange).toHaveBeenCalledTimes(1);
    expect(afterArmoryChange).toHaveBeenCalledWith('ice_fang_sword');
    expect(world.changeWeaponSkin.mock.invocationCallOrder[0]).toBeLessThan(
      afterArmoryChange.mock.invocationCallOrder[0],
    );
  });

  it('detaches by weapon type and re-projects the open panel skin', () => {
    const world = fakeWorld();
    const { deps, afterArmoryChange } = seams(world, 'ice_fang_sword');
    deps.detachSkin('sword');
    expect(world.changeWeaponSkin).toHaveBeenCalledTimes(1);
    expect(world.changeWeaponSkin).toHaveBeenCalledWith(null, 'sword');
    expect(afterArmoryChange).toHaveBeenCalledTimes(1);
    expect(afterArmoryChange).toHaveBeenCalledWith('ice_fang_sword');
  });

  it('detaches without a re-project when no panel skin is open', () => {
    const world = fakeWorld();
    const { deps, afterArmoryChange } = seams(world, null);
    deps.detachSkin('axe');
    expect(world.changeWeaponSkin).toHaveBeenCalledWith(null, 'axe');
    expect(afterArmoryChange).not.toHaveBeenCalled();
  });
});

describe('mountInspectDeps', () => {
  function seams(world: FakeWorld, rowById?: (id: string) => StoreMountRow | null) {
    const spend = fakeSpend(rowById);
    const deps = mountInspectDeps({ world: () => world as never, spend: spend as never });
    return { deps, spend };
  }

  it('projects the store row with the price and purchasability', () => {
    const { deps, spend } = seams(fakeWorld(), (id) => (id === REINS ? storeRow() : null));
    const row = deps.row(REINS);
    expect(spend.mounts.rowById).toHaveBeenCalledWith(REINS);
    expect(row).toMatchObject({
      skinId: REINS,
      costClaudium: 1200,
      purchasable: true,
      owned: false,
      worn: false,
      ownsAnyMount: true,
    });
  });

  it('unions owned from the store row and the account mirror', () => {
    const fromStore = seams(fakeWorld(), () => storeRow({ owned: true })).deps.row(REINS);
    expect(fromStore?.owned).toBe(true);
    const fromMirror = seams(fakeWorld({ mountSkinIds: [REINS] })).deps.row(REINS);
    expect(fromMirror?.owned).toBe(true);
    expect(fromMirror?.costClaudium).toBeNull();
    expect(fromMirror?.purchasable).toBe(false);
    const neither = seams(fakeWorld({ mountSkinIds: [OTHER] })).deps.row(REINS);
    expect(neither?.owned).toBe(false);
  });

  it('reads worn from the player and ownsAnyMount from the owned mounts', () => {
    const worn = seams(fakeWorld({ mountSkinIds: [REINS], mountSkinId: REINS })).deps.row(REINS);
    expect(worn?.worn).toBe(true);
    const bare = seams(
      fakeWorld({ mountSkinIds: [REINS], mountSkinId: OTHER, ownedMounts: [] }),
    ).deps.row(REINS);
    expect(bare?.worn).toBe(false);
    expect(bare?.ownsAnyMount).toBe(false);
  });

  it('returns null for a skin the catalog does not declare', () => {
    const { deps } = seams(fakeWorld({ mountSkinIds: ['not_a_skin'] }), () =>
      storeRow({ itemId: 'not_a_skin', skinId: 'not_a_skin' as never, owned: true }),
    );
    expect(deps.row('not_a_skin')).toBeNull();
  });

  it('routes buy, wear and take off to the spend controller and the world once each', () => {
    const world = fakeWorld();
    const { deps, spend } = seams(world);
    deps.requestBuy(REINS);
    expect(spend.mounts.request).toHaveBeenCalledTimes(1);
    expect(spend.mounts.request).toHaveBeenCalledWith(REINS);
    expect(world.changeMountSkin).not.toHaveBeenCalled();

    deps.wear(REINS);
    expect(world.changeMountSkin).toHaveBeenCalledTimes(1);
    expect(world.changeMountSkin).toHaveBeenNthCalledWith(1, REINS);

    deps.takeOff();
    expect(world.changeMountSkin).toHaveBeenCalledTimes(2);
    expect(world.changeMountSkin).toHaveBeenNthCalledWith(2, null);
    expect(spend.mounts.request).toHaveBeenCalledTimes(1);
  });
});
