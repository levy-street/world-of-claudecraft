import { beforeEach, describe, expect, it, vi } from 'vitest';
import { preloadInternalsForTest } from '../src/render/assets/preload';
import type { GfxSettings } from '../src/render/gfx';

const mocks = vi.hoisted(() => {
  const prepare = () => vi.fn<() => Promise<void>>(() => Promise.resolve());
  return {
    terrain: prepare(),
    water: prepare(),
    stone: prepare(),
    surface: prepare(),
    canopy: prepare(),
    greatTree: prepare(),
    foliage: prepare(),
    props: prepare(),
    characters: prepare(),
    sky: prepare(),
    cliff: prepare(),
    town: prepare(),
    armoury: prepare(),
    mailbox: prepare(),
    noticeboard: prepare(),
    reset: vi.fn(),
  };
});

vi.mock('../src/render/terrain', () => ({
  prepareTerrainProfileAssets: mocks.terrain,
}));
vi.mock('../src/render/water', () => ({
  prepareWaterProfileAssets: mocks.water,
}));
vi.mock('../src/render/detail_normals', () => ({
  prepareStoneDetailProfileAssets: mocks.stone,
}));
vi.mock('../src/render/worn_stone', () => ({
  prepareSurfaceDetailProfileAssets: mocks.surface,
  resetSurfaceDetailProfileCaches: mocks.reset,
}));
vi.mock('../src/render/canopy_detail', () => ({
  prepareCanopyDetailProfileAssets: mocks.canopy,
}));
vi.mock('../src/render/great_tree_prewarm', () => ({
  prepareGreatTreeProfileAssets: mocks.greatTree,
}));
vi.mock('../src/render/foliage', () => ({
  prepareFoliageProfileAssets: mocks.foliage,
  resetFoliageProfileCaches: mocks.reset,
}));
vi.mock('../src/render/props', () => ({
  preparePropProfileAssets: mocks.props,
  resetPropProfileCaches: mocks.reset,
}));
vi.mock('../src/render/characters/assets', () => ({
  prepareCharacterProfileAssets: mocks.characters,
  resetCharacterProfileCaches: mocks.reset,
}));
vi.mock('../src/render/sky', () => ({
  ensureSkyAssetsAt: mocks.sky,
}));
vi.mock('../src/render/cliff_scree', () => ({
  prepareCliffScreeProfileAssets: mocks.cliff,
  resetCliffScreeProfileCaches: mocks.reset,
}));
vi.mock('../src/render/eastbrook_town', () => ({
  prepareEastbrookTownProfileAssets: mocks.town,
  resetEastbrookTownProfileCaches: mocks.reset,
}));
vi.mock('../src/render/eastbrook_grand_armoury', () => ({
  prepareEastbrookGrandArmouryProfileAssets: mocks.armoury,
  resetEastbrookGrandArmouryProfileCaches: mocks.reset,
}));
vi.mock('../src/render/mailbox', () => ({
  prepareMailboxProfileAssets: mocks.mailbox,
  resetMailboxProfileCaches: mocks.reset,
}));
vi.mock('../src/render/noticeboard', () => ({
  prepareNoticeboardProfileAssets: mocks.noticeboard,
  resetNoticeboardProfileCaches: mocks.reset,
}));
vi.mock('../src/render/banker_chest', () => ({
  resetBankerChestProfileCaches: mocks.reset,
}));
vi.mock('../src/render/castle_features', () => ({
  resetCastleFeatureProfileCaches: mocks.reset,
}));
vi.mock('../src/render/door_portal', () => ({
  resetDoorPortalProfileCaches: mocks.reset,
}));
vi.mock('../src/render/eastbrook_surface_atlas', () => ({
  resetEastbrookSurfaceProfileCaches: mocks.reset,
}));
vi.mock('../src/render/fireball_travel_visual', () => ({
  resetFireballTravelProfileCaches: mocks.reset,
}));
vi.mock('../src/render/frost_nova_root_visual', () => ({
  resetFrostNovaRootProfileCaches: mocks.reset,
}));
vi.mock('../src/render/ice_block_visual', () => ({
  resetIceBlockProfileCaches: mocks.reset,
}));
vi.mock('../src/render/jail_scene', () => ({
  resetJailSceneProfileCaches: mocks.reset,
}));
vi.mock('../src/render/quest_objects', () => ({
  resetQuestObjectProfileCaches: mocks.reset,
}));
vi.mock('../src/render/stations', () => ({
  resetStationProfileCaches: mocks.reset,
}));
vi.mock('../src/render/temporal_hourglass_visual', () => ({
  resetTemporalHourglassProfileCaches: mocks.reset,
}));
vi.mock('../src/render/vale_cup_ball', () => ({
  resetValeCupBallProfileCaches: mocks.reset,
}));
vi.mock('../src/render/vale_cup_stadium', () => ({
  resetValeCupStadiumProfileCaches: mocks.reset,
}));
vi.mock('../src/render/wildheart_terrain', () => ({
  resetWildheartTerrainProfileCaches: mocks.reset,
}));
vi.mock('../src/render/gfx', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/render/gfx')>();
  return { ...original, resetSurfaceMaterialProfileCache: mocks.reset };
});

import {
  graphicsProfileAssetsInternalsForTest,
  prepareGraphicsProfileAssets,
  resetGraphicsProfileDerivedCaches,
} from '../src/render/assets/graphics_profile';

const prepareSpies = [
  mocks.terrain,
  mocks.water,
  mocks.stone,
  mocks.surface,
  mocks.canopy,
  mocks.greatTree,
  mocks.foliage,
  mocks.props,
  mocks.characters,
  mocks.sky,
  mocks.cliff,
  mocks.town,
  mocks.armoury,
  mocks.mailbox,
  mocks.noticeboard,
];

beforeEach(() => {
  preloadInternalsForTest.reset();
  for (const prepare of prepareSpies) prepare.mockReset().mockResolvedValue(undefined);
  mocks.reset.mockClear();
});

describe('graphics profile asset preparation', () => {
  it('forwards the requested settings, reports channel progress, and registers no boot task', async () => {
    const target = { tier: 'ultra' } as unknown as GfxSettings;
    const position = { x: 14, z: -27 };
    const progress: [number, number][] = [];

    await prepareGraphicsProfileAssets(target, position, (done, total) => {
      progress.push([done, total]);
    });

    for (const prepare of prepareSpies.slice(0, 9)) expect(prepare).toHaveBeenCalledWith(target);
    expect(mocks.sky).toHaveBeenCalledWith(position.x, position.z, target);
    expect(mocks.cliff).toHaveBeenCalledWith(target);
    for (const prepare of [mocks.town, mocks.armoury, mocks.mailbox, mocks.noticeboard]) {
      expect(prepare).toHaveBeenCalledWith();
    }
    expect(progress).toHaveLength(graphicsProfileAssetsInternalsForTest.channelCount);
    expect(progress.map(([done]) => done).sort((a, b) => a - b)).toEqual(
      Array.from({ length: progress.length }, (_, index) => index + 1),
    );
    expect(new Set(progress.map(([, total]) => total))).toEqual(
      new Set([graphicsProfileAssetsInternalsForTest.channelCount]),
    );
    expect(preloadInternalsForTest.tasks()).toHaveLength(0);
  });

  it('does not latch a rejected channel, so a later call retries it', async () => {
    const target = {} as GfxSettings;
    mocks.terrain.mockRejectedValueOnce(new Error('transient terrain failure'));

    await expect(prepareGraphicsProfileAssets(target, { x: 0, z: 0 })).rejects.toThrow(
      'transient terrain failure',
    );
    await expect(prepareGraphicsProfileAssets(target, { x: 0, z: 0 })).resolves.toBeUndefined();
    expect(mocks.terrain).toHaveBeenCalledTimes(2);
  });
});

describe('graphics profile derived-cache reset', () => {
  it('pins the closed process-lifetime owner list', () => {
    expect(graphicsProfileAssetsInternalsForTest.resetOwners).toEqual([
      'gfx',
      'surface_detail',
      'foliage',
      'props',
      'characters',
      'stations',
      'castle_features',
      'eastbrook_surface_atlas',
      'eastbrook_town',
      'banker_chest',
      'mailbox',
      'noticeboard',
      'eastbrook_grand_armoury',
      'quest_objects',
      'jail_scene',
      'cliff_scree',
      'door_portal',
      'vale_cup_ball',
      'vale_cup_stadium',
      'wildheart_terrain',
      'fireball_travel_visual',
      'frost_nova_root_visual',
      'ice_block_visual',
      'temporal_hourglass_visual',
    ]);
    expect(() => resetGraphicsProfileDerivedCaches()).not.toThrow();
    expect(mocks.reset).toHaveBeenCalledTimes(
      graphicsProfileAssetsInternalsForTest.resetOwners.length,
    );
  });
});
