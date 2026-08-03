import { resetBankerChestProfileCaches } from '../banker_chest';
import { prepareCanopyDetailProfileAssets } from '../canopy_detail';
import { resetCastleFeatureProfileCaches } from '../castle_features';
import { prepareCharacterProfileAssets, resetCharacterProfileCaches } from '../characters/assets';
import { prepareCliffScreeProfileAssets, resetCliffScreeProfileCaches } from '../cliff_scree';
import { prepareStoneDetailProfileAssets } from '../detail_normals';
import { resetDoorPortalProfileCaches } from '../door_portal';
import {
  prepareEastbrookGrandArmouryProfileAssets,
  resetEastbrookGrandArmouryProfileCaches,
} from '../eastbrook_grand_armoury';
import { resetEastbrookSurfaceProfileCaches } from '../eastbrook_surface_atlas';
import {
  prepareEastbrookTownProfileAssets,
  resetEastbrookTownProfileCaches,
} from '../eastbrook_town';
import { resetFireballTravelProfileCaches } from '../fireball_travel_visual';
import { prepareFoliageProfileAssets, resetFoliageProfileCaches } from '../foliage';
import { resetFrostNovaRootProfileCaches } from '../frost_nova_root_visual';
import { type GfxSettings, resetSurfaceMaterialProfileCache } from '../gfx';
import { prepareGreatTreeProfileAssets } from '../great_tree_prewarm';
import { resetIceBlockProfileCaches } from '../ice_block_visual';
import { resetJailSceneProfileCaches } from '../jail_scene';
import { prepareMailboxProfileAssets, resetMailboxProfileCaches } from '../mailbox';
import { prepareNoticeboardProfileAssets, resetNoticeboardProfileCaches } from '../noticeboard';
import { preparePropProfileAssets, resetPropProfileCaches } from '../props';
import { resetQuestObjectProfileCaches } from '../quest_objects';
import { ensureSkyAssetsAt } from '../sky';
import { resetStationProfileCaches } from '../stations';
import { resetTemporalHourglassProfileCaches } from '../temporal_hourglass_visual';
import { prepareTerrainProfileAssets } from '../terrain';
import { resetValeCupBallProfileCaches } from '../vale_cup_ball';
import { resetValeCupStadiumProfileCaches } from '../vale_cup_stadium';
import { prepareWaterProfileAssets } from '../water';
import { resetWildheartTerrainProfileCaches } from '../wildheart_terrain';
import { prepareSurfaceDetailProfileAssets, resetSurfaceDetailProfileCaches } from '../worn_stone';

export type GraphicsProfilePosition = Readonly<{ x: number; z: number }>;
export type GraphicsProfileAssetProgress = (done: number, total: number) => void;

type GraphicsProfileAssetPreparer = (
  target: Readonly<GfxSettings>,
  position: GraphicsProfilePosition,
) => Promise<void>;

const PREPARERS: readonly GraphicsProfileAssetPreparer[] = [
  (target) => prepareTerrainProfileAssets(target),
  (target) => prepareWaterProfileAssets(target),
  (target) => prepareStoneDetailProfileAssets(target),
  (target) => prepareSurfaceDetailProfileAssets(target),
  (target) => prepareCanopyDetailProfileAssets(target),
  (target) => prepareGreatTreeProfileAssets(target),
  (target) => prepareFoliageProfileAssets(target),
  (target) => preparePropProfileAssets(target),
  (target) => prepareCharacterProfileAssets(target),
  (target, position) => ensureSkyAssetsAt(position.x, position.z, target),
  (target) =>
    Promise.all([
      prepareCliffScreeProfileAssets(target),
      prepareEastbrookTownProfileAssets(),
      prepareEastbrookGrandArmouryProfileAssets(),
      prepareMailboxProfileAssets(),
      prepareNoticeboardProfileAssets(),
    ]).then(() => undefined),
];

const RESETTERS = [
  ['gfx', resetSurfaceMaterialProfileCache],
  ['surface_detail', resetSurfaceDetailProfileCaches],
  ['foliage', resetFoliageProfileCaches],
  ['props', resetPropProfileCaches],
  ['characters', resetCharacterProfileCaches],
  ['stations', resetStationProfileCaches],
  ['castle_features', resetCastleFeatureProfileCaches],
  ['eastbrook_surface_atlas', resetEastbrookSurfaceProfileCaches],
  ['eastbrook_town', resetEastbrookTownProfileCaches],
  ['banker_chest', resetBankerChestProfileCaches],
  ['mailbox', resetMailboxProfileCaches],
  ['noticeboard', resetNoticeboardProfileCaches],
  ['eastbrook_grand_armoury', resetEastbrookGrandArmouryProfileCaches],
  ['quest_objects', resetQuestObjectProfileCaches],
  ['jail_scene', resetJailSceneProfileCaches],
  ['cliff_scree', resetCliffScreeProfileCaches],
  ['door_portal', resetDoorPortalProfileCaches],
  ['vale_cup_ball', resetValeCupBallProfileCaches],
  ['vale_cup_stadium', resetValeCupStadiumProfileCaches],
  ['wildheart_terrain', resetWildheartTerrainProfileCaches],
  ['fireball_travel_visual', resetFireballTravelProfileCaches],
  ['frost_nova_root_visual', resetFrostNovaRootProfileCaches],
  ['ice_block_visual', resetIceBlockProfileCaches],
  ['temporal_hourglass_visual', resetTemporalHourglassProfileCaches],
] as const satisfies readonly (readonly [owner: string, reset: () => void])[];

/**
 * Prepare every source asset channel needed by a requested graphics profile.
 * This calls loaders directly and never registers work in the boot preload
 * registry. Each channel owns its resident/in-flight state, so concurrent and
 * repeated calls share work, while a rejected load is removed and can retry.
 */
export async function prepareGraphicsProfileAssets(
  target: Readonly<GfxSettings>,
  position: GraphicsProfilePosition,
  onProgress?: GraphicsProfileAssetProgress,
): Promise<void> {
  const total = PREPARERS.length;
  let done = 0;
  const tasks = PREPARERS.map((prepare) =>
    Promise.resolve()
      .then(() => prepare(target, position))
      .finally(() => onProgress?.(++done, total)),
  );
  await Promise.all(tasks);
}

/**
 * Invalidate only profile-derived templates and materials. Loaded textures,
 * parsed source assets, and static URL/catalog recipes remain available for
 * the next rebuild.
 */
export function resetGraphicsProfileDerivedCaches(): void {
  for (const [, reset] of RESETTERS) reset();
}

export const graphicsProfileAssetsInternalsForTest = {
  channelCount: PREPARERS.length,
  resetOwners: RESETTERS.map(([owner]) => owner),
};
