import { buildCivicServicePlacements } from '../sim/civic_service_placements';
import { getActiveWorldContent, getContentGeneration } from '../sim/data';
import type { CivicServicePlacement } from '../world_api/interaction';

export type CivicServicePlacementsReader = () => readonly CivicServicePlacement[];

/** Build a generation-aware cache owned by one ClientWorld instance. */
export function createCivicServicePlacementsReader(): CivicServicePlacementsReader {
  let cachedGeneration: number | undefined;
  let cachedPlacements: readonly CivicServicePlacement[] | undefined;

  return () => {
    const generation = getContentGeneration();
    if (cachedGeneration === generation && cachedPlacements !== undefined) {
      return cachedPlacements;
    }

    const services = getActiveWorldContent().services;
    cachedPlacements = buildCivicServicePlacements(
      services?.mailboxes ?? [],
      services?.noticeboards ?? [],
    );
    cachedGeneration = generation;
    return cachedPlacements;
  };
}
