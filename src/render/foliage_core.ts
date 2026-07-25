import { isEastbrookGrandArmoury } from '../sim/building_layout';
import { EASTBROOK_LAYOUT } from '../sim/eastbrook_layout';
import type { BuildingDef, NoticeboardDef } from '../sim/types';

export type EastbrookGrassExclusion =
  | {
      kind: 'obb';
      id: string;
      x: number;
      z: number;
      halfWidth: number;
      halfDepth: number;
      rotation: number;
    }
  | { kind: 'circle'; id: string; x: number; z: number; radius: number };

/** True when a grass candidate falls inside a hub owned by the active world. */
export function insideGrassHubExclusion(
  zones: readonly { hub: { x: number; z: number } }[],
  x: number,
  z: number,
  radius = 15,
): boolean {
  const radiusSq = radius * radius;
  for (const zone of zones) {
    const dx = x - zone.hub.x;
    const dz = z - zone.hub.z;
    if (dx * dx + dz * dz < radiusSq) return true;
  }
  return false;
}

/** Hub and camp clearings for bushes/ferns, sourced from the active world only. */
export function insideDressingExclusion(
  zones: readonly { hub: { x: number; z: number; radius: number } }[],
  camps: readonly { center: { x: number; z: number }; radius: number }[],
  x: number,
  z: number,
): boolean {
  for (const zone of zones) {
    if (Math.hypot(x - zone.hub.x, z - zone.hub.z) < zone.hub.radius + 4) return true;
  }
  for (const camp of camps) {
    if (Math.hypot(x - camp.center.x, z - camp.center.z) < camp.radius + 2) return true;
  }
  return false;
}

function layoutObb(
  id: string,
  footprint: {
    center: { x: number; z: number };
    halfWidth: number;
    halfDepth: number;
    rotation: number;
  },
): EastbrookGrassExclusion {
  return {
    kind: 'obb',
    id,
    x: footprint.center.x,
    z: footprint.center.z,
    halfWidth: footprint.halfWidth,
    halfDepth: footprint.halfDepth,
    rotation: footprint.rotation,
  };
}

function buildingObb(building: BuildingDef): EastbrookGrassExclusion {
  return {
    kind: 'obb',
    id: building.id ?? building.landmark ?? `${building.x}:${building.z}`,
    x: building.x,
    z: building.z,
    halfWidth: building.w / 2,
    halfDepth: building.d / 2,
    rotation: building.rot,
  };
}

/**
 * Snapshot the geometry that must remain grass-free. Built-in Eastbrook uses
 * the canonical layout (including wall, civic furniture, and service aprons),
 * while custom worlds only honor landmarks explicitly present in their own
 * prop table and never inherit fixed Eastbrook coordinates.
 */
export function eastbrookGrassExclusions(
  buildings: readonly BuildingDef[],
  builtInWorld: boolean,
  noticeboards: readonly NoticeboardDef[] = [],
): EastbrookGrassExclusion[] {
  const exclusions: EastbrookGrassExclusion[] = builtInWorld
    ? []
    : buildings.filter(isEastbrookGrandArmoury).map(buildingObb);

  if (builtInWorld) {
    for (const building of [
      ...EASTBROOK_LAYOUT.preservedBuildings,
      ...EASTBROOK_LAYOUT.buildings,
    ]) {
      exclusions.push(layoutObb(building.id, building.footprint));
      exclusions.push({
        kind: 'circle',
        id: `${building.id}:serviceApron`,
        x: building.frontStandingPoint.x,
        z: building.frontStandingPoint.z,
        radius: 1.5,
      });
    }
    const well = EASTBROOK_LAYOUT.civic.wellBeacon;
    exclusions.push({
      kind: 'circle',
      id: well.id,
      x: well.position.x,
      z: well.position.z,
      radius: well.radius,
    });
    for (const bench of EASTBROOK_LAYOUT.civic.benches) {
      exclusions.push(layoutObb(bench.id, bench.footprint));
    }
    for (const stall of EASTBROOK_LAYOUT.market.stalls) {
      exclusions.push(layoutObb(stall.id, stall.footprint));
    }
    for (const fence of EASTBROOK_LAYOUT.fences) {
      exclusions.push(layoutObb(fence.id, fence.footprint));
    }
    for (const wall of EASTBROOK_LAYOUT.wall.segments) {
      exclusions.push(layoutObb(wall.id, wall.footprint));
    }
  }

  for (const board of noticeboards) {
    exclusions.push({
      kind: 'obb',
      id: board.id,
      x: board.x,
      z: board.z,
      halfWidth: board.width / 2,
      halfDepth: board.depth / 2,
      rotation: board.rotation,
    });
    exclusions.push({
      kind: 'circle',
      id: `${board.id}:serviceApron`,
      x: board.frontStandingPoint.x,
      z: board.frontStandingPoint.z,
      radius: 1.2,
    });
  }
  return exclusions;
}

/** Pure candidate check used by streamed chunks after the one-time snapshot. */
export function insideEastbrookGrassExclusion(
  exclusions: readonly EastbrookGrassExclusion[],
  x: number,
  z: number,
  padding: number,
): boolean {
  for (let index = 0; index < exclusions.length; index++) {
    const exclusion = exclusions[index];
    if (exclusion.kind === 'circle') {
      const dx = x - exclusion.x;
      const dz = z - exclusion.z;
      const radius = exclusion.radius + padding;
      if (dx * dx + dz * dz < radius * radius) return true;
      continue;
    }
    const dx = x - exclusion.x;
    const dz = z - exclusion.z;
    const cosine = Math.cos(exclusion.rotation);
    const sine = Math.sin(exclusion.rotation);
    const localX = dx * cosine - dz * sine;
    const localZ = dx * sine + dz * cosine;
    if (
      Math.abs(localX) < exclusion.halfWidth + padding &&
      Math.abs(localZ) < exclusion.halfDepth + padding
    ) {
      return true;
    }
  }
  return false;
}
