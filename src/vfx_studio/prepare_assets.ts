import { prepareProductionProfileAssets } from '../render/ability_vfx/production_assets';
import { prepareSimulationProfileAssets } from '../render/ability_vfx/simulation_assets';
import { assetsReady, beginStudioPreloads } from '../render/assets/preload';
import { prepareCharacterProfileAssets } from '../render/characters/assets';
import type { GfxSettings } from '../render/gfx';
import { prepareSurfaceDetailProfileAssets } from '../render/worn_stone';

/** Same combat art and character quality as the game, without world dressing. */
export async function prepareStudioAssets(profile: Readonly<GfxSettings>): Promise<void> {
  beginStudioPreloads();
  await Promise.all([
    assetsReady(),
    prepareCharacterProfileAssets(profile),
    prepareSurfaceDetailProfileAssets(profile),
    prepareProductionProfileAssets(profile),
    prepareSimulationProfileAssets(profile),
  ]);
}
