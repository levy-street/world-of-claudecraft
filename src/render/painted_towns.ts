// The painted towns' views (sim/painted_towns/): every town after Highwatch
// whose kit houses were replaced by painted Tidehold buildings, each one the
// shared placed-town view (placed_town_buildings.ts) over its layout's
// buildings, made once at module load. A town that stands nothing yet builds an
// empty view. The renderer takes Highwatch's view and these as one list
// (buildPlacedTownViews), so a newly painted town needs no renderer edit.
import { PAINTED_TOWNS } from '../sim/painted_towns';
import type { BuildingDef } from '../sim/types';
import type { IWorld } from '../world_api';
import type { GfxSettings } from './gfx';
import { buildHighwatchTownView } from './highwatch_town';
import { createPlacedTownKit, type PlacedTownView } from './placed_town_buildings';

export type { PlacedTownView } from './placed_town_buildings';

const KITS = PAINTED_TOWNS.map((town) =>
  createPlacedTownKit({
    town: town.id,
    layoutId: town.layoutId,
    rootName: `${town.id}TownRebuild`,
    revealKey: `${town.id}-town-static`,
    hub: town.hub,
    buildings: town.buildings,
    promotedBy: 'paintedTowns',
  }),
);

if (typeof window !== 'undefined') {
  for (const kit of KITS) kit.registerPreloads();
}

/** Every painted town's view, in the list's order. */
export function buildPaintedTownViews(seed: number): PlacedTownView[] {
  return KITS.map((kit) => kit.buildView(seed));
}

/** Highwatch's view and every painted town's: the towns made only of placed
 *  painted buildings, which the renderer loops beside Eastbrook and Fenbridge.
 *  With the viewing `world`, Highwatch's guild trophy room follows the viewer's
 *  dungeon clears (highwatch_town.ts). */
export function buildPlacedTownViews(
  seed: number,
  world?: Pick<IWorld, 'deedStats'>,
): PlacedTownView[] {
  return [buildHighwatchTownView(seed, world), ...buildPaintedTownViews(seed)];
}

/** The painted buildings follow the profile's texture tier (the target's). */
export function preparePaintedTownProfileAssets(
  target?: Pick<GfxSettings, 'placedTextureTier'>,
): Promise<void> {
  return Promise.all(KITS.map((kit) => kit.prepareProfileAssets(target))).then(() => undefined);
}

export function resetPaintedTownProfileCaches(): void {
  for (const kit of KITS) kit.resetProfileCaches();
}

/** Stable-ID matching only; the props caller applies the built-in-world gate. */
export function isPaintedTownRebuildBuilding(building: BuildingDef): boolean {
  return KITS.some((kit) => kit.isRebuildBuilding(building));
}

/** Test-only access to the kits (asset URLs, cull radii, source builds). */
export const paintedTownsInternalsForTest = {
  kits: KITS,
  towns: PAINTED_TOWNS,
};
