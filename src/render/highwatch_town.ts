// Highwatch's painted rebuild (sim/highwatch_layout.ts): a town of placed
// painted buildings and nothing else, so it is the shared placed-town view
// (placed_town_buildings.ts) over the layout's buildings. The square's well,
// stalls, station, mailbox, board and the Cairns stay with the props view.
import { HIGHWATCH_LAYOUT } from '../sim/highwatch_layout';
import type { BuildingDef } from '../sim/types';
import type { GfxSettings } from './gfx';
import { createPlacedTownKit, type PlacedTownView } from './placed_town_buildings';

const ROOT_NAME = 'highwatchTownRebuild';

const HIGHWATCH_TOWN = createPlacedTownKit({
  town: 'highwatch',
  layoutId: HIGHWATCH_LAYOUT.id,
  rootName: ROOT_NAME,
  revealKey: 'highwatch-town-static',
  hub: HIGHWATCH_LAYOUT.hub,
  buildings: HIGHWATCH_LAYOUT.buildings,
  promotedBy: 'highwatchTown',
});

if (typeof window !== 'undefined') HIGHWATCH_TOWN.registerPreloads();

export type HighwatchTownView = PlacedTownView;

export function buildHighwatchTownView(seed: number): HighwatchTownView {
  return HIGHWATCH_TOWN.buildView(seed);
}

/** The painted buildings follow the profile's texture tier (the target's). */
export function prepareHighwatchTownProfileAssets(
  target?: Pick<GfxSettings, 'placedTextureTier'>,
): Promise<void> {
  return HIGHWATCH_TOWN.prepareProfileAssets(target);
}

export function resetHighwatchTownProfileCaches(): void {
  HIGHWATCH_TOWN.resetProfileCaches();
}

/** Stable-ID matching only; the props caller applies the built-in-world gate. */
export function isHighwatchRebuildBuilding(building: BuildingDef): boolean {
  return HIGHWATCH_TOWN.isRebuildBuilding(building);
}

/** Test-only access to the kit (asset URLs, cull radius, source builds). */
export const highwatchTownInternalsForTest = {
  rootName: ROOT_NAME,
  kit: HIGHWATCH_TOWN,
};

export const HIGHWATCH_TOWN_ROOT_NAME = ROOT_NAME;
