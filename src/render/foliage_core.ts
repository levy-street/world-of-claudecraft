import { isEastbrookGrandArmoury } from '../sim/building_layout';
import {
  TAVERN_HALL,
  TAVERN_PORCH,
  TAVERN_STEPS_MAX_RUN,
  TAVERN_TOWER,
  TAVERN_WING,
  tavernToWorld,
} from '../sim/content/mirefen_tavern';
import { activeDungeonDoorPos, DUNGEONS, getActiveWorldContent } from '../sim/data';
import { EASTBROOK_LAYOUT } from '../sim/eastbrook_layout';
import { FENBRIDGE_LAYOUT } from '../sim/fenbridge_layout';
import { HIGHWATCH_LAYOUT } from '../sim/highwatch_layout';
import { tavernGroundsRects } from '../sim/mirefen_tavern_grounds';
import type { BuildingDef, NoticeboardDef } from '../sim/types';
import {
  onWildheartBasinEntranceCauseway,
  WILDHEART_BASIN_ENTRANCE_DUNGEON_ID,
} from '../sim/wildheart_basin_entrance';
import { onHighwatchManorLane } from './highwatch_manor_lane_core';

/** The foliage placement hash: a deterministic [0, 1) value per (a, b, salt k).
 *  Shared by foliage.ts and the dressing-spot generator (foliage_dressing_spots.ts). */
export function hashAt(a: number, b: number, k: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7 + k * 74.7) * 43758.5453123;
  return s - Math.floor(s);
}

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

/** True when a grass candidate falls on a set piece's paving: the meadow does
 *  not grow through the flagstones of the Jaguar Maw's causeway (the Wildheart
 *  Basin's world door, src/sim/wildheart_basin_entrance.ts). Every grass
 *  system asks this (the tuft ring and both blade carpets), so the paving
 *  reads as paving at every distance. */
export function insidePavedGrassExclusion(x: number, z: number): boolean {
  const dungeon = DUNGEONS[WILDHEART_BASIN_ENTRANCE_DUNGEON_ID];
  if (
    dungeon !== undefined &&
    onWildheartBasinEntranceCauseway(activeDungeonDoorPos(dungeon), x, z, 0.3)
  ) {
    return true;
  }
  return insideHighwatchManorGround(x, z);
}

// The Highwatch manor (sim/highwatch_layout.ts) is a walk-in house whose model brings its
// own ground: flagged floors a hand over the pad, the porch, the garden's lawn, path and
// beds. The meadow must not grow through any of it, so its whole reach is paving. Asked
// only while the active world stands the manor where the layout does (its built-in record,
// or a Studio placement of its model at the same anchor), cached per world.
const MANOR = HIGHWATCH_LAYOUT.buildings.find((building) => building.id === 'highwatch_manor');
const manorStands = new WeakMap<object, boolean>();

function activeWorldStandsManor(): boolean {
  if (!MANOR) return false;
  const content = getActiveWorldContent();
  const cached = manorStands.get(content);
  if (cached !== undefined) return cached;
  const stands =
    (content.props?.buildings ?? []).some((building) => building.id === MANOR.id) ||
    (content.placements ?? []).some(
      (placement) =>
        placement.path === MANOR.assetId &&
        Math.abs(placement.x - MANOR.placement.x) < 1e-6 &&
        Math.abs(placement.z - MANOR.placement.z) < 1e-6,
    );
  manorStands.set(content, stands);
  return stands;
}

/** True inside the Highwatch manor's reach, or on its lane's paving from the road to the
 *  gate (highwatch_manor_lane_core.ts), while the active world stands it. */
export function insideHighwatchManorGround(x: number, z: number): boolean {
  if (!MANOR) return false;
  const reach = MANOR.reach;
  if (
    (Math.abs(x - reach.center.x) > reach.halfWidth ||
      Math.abs(z - reach.center.z) > reach.halfDepth) &&
    !onHighwatchManorLane(x, z)
  ) {
    return false;
  }
  return activeWorldStandsManor();
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
 * Snapshot the geometry that must remain grass-free. Built-in towns use their
 * canonical layouts (including walls, civic furniture, repeated boardwalks,
 * and service aprons), while custom worlds only honor landmarks explicitly
 * present in their own prop table and never inherit fixed world coordinates.
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
      // A placed building clears its whole reach (porch, stair, awning), not
      // only its wall box: grass would otherwise grow through its forge deck.
      exclusions.push(
        layoutObb(building.id, 'reach' in building ? building.reach : building.footprint),
      );
      exclusions.push({
        kind: 'circle',
        id: `${building.id}:serviceApron`,
        x: building.frontStandingPoint.x,
        z: building.frontStandingPoint.z,
        radius: 1.5,
      });
    }
    const well = EASTBROOK_LAYOUT.civic.monument;
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

    for (const building of FENBRIDGE_LAYOUT.buildings) {
      // A painted building clears its whole reach (porch, stair, awning), not
      // only its wall box, as Eastbrook's do.
      exclusions.push(layoutObb(building.id, building.reach));
      exclusions.push({
        kind: 'circle',
        id: `${building.id}:serviceApron`,
        x: building.frontStandingPoint.x,
        z: building.frontStandingPoint.z,
        radius: 1.5,
      });
    }
    const cistern = FENBRIDGE_LAYOUT.civic.cistern;
    exclusions.push({
      kind: 'circle',
      id: cistern.id,
      x: cistern.position.x,
      z: cistern.position.z,
      radius: cistern.radius,
    });
    exclusions.push(
      layoutObb(
        FENBRIDGE_LAYOUT.civic.provisionStall.id,
        FENBRIDGE_LAYOUT.civic.provisionStall.footprint,
      ),
    );
    for (const [id, point] of [
      [
        `${FENBRIDGE_LAYOUT.civic.provisionStall.id}:customerApron`,
        FENBRIDGE_LAYOUT.civic.provisionStall.customerStandingPoint,
      ],
      [
        `${FENBRIDGE_LAYOUT.civic.provisionStall.id}:vendorApron`,
        FENBRIDGE_LAYOUT.civic.provisionStall.vendorStandingPoint,
      ],
      [
        `${FENBRIDGE_LAYOUT.services.bank.teller.id}:serviceApron`,
        FENBRIDGE_LAYOUT.services.bank.teller.standingPoint,
      ],
      [
        'fenbridge_lantern_chapel_archive:serviceApron',
        FENBRIDGE_LAYOUT.services.npcs.find((npc) => npc.id === 'chronicler_osric_fenn')?.position,
      ],
      [
        `${FENBRIDGE_LAYOUT.services.stations[0].id}:serviceApron`,
        FENBRIDGE_LAYOUT.services.stations[0].position,
      ],
      [
        `${FENBRIDGE_LAYOUT.services.mailbox.id}:serviceApron`,
        FENBRIDGE_LAYOUT.services.mailbox.frontStandingPoint,
      ],
    ] as const) {
      if (!point) continue;
      exclusions.push({ kind: 'circle', id, x: point.x, z: point.z, radius: 1.2 });
    }
    exclusions.push(
      layoutObb(
        FENBRIDGE_LAYOUT.civic.musterBoard.id,
        FENBRIDGE_LAYOUT.civic.musterBoard.footprint,
      ),
    );
    exclusions.push({
      kind: 'circle',
      id: `${FENBRIDGE_LAYOUT.civic.musterBoard.id}:serviceApron`,
      x: FENBRIDGE_LAYOUT.civic.musterBoard.frontStandingPoint.x,
      z: FENBRIDGE_LAYOUT.civic.musterBoard.frontStandingPoint.z,
      radius: 1.2,
    });
    // Fenbridge stands open: grass grows up to the town on every side, with no
    // palisade or gate footing to clear.
    for (const boardwalk of FENBRIDGE_LAYOUT.repeated.boardwalks) {
      exclusions.push({
        kind: 'obb',
        id: boardwalk.id,
        x: boardwalk.position.x,
        z: boardwalk.position.z,
        halfWidth: boardwalk.nativeDimensions.width / 2,
        halfDepth: boardwalk.nativeDimensions.depth / 2,
        rotation: boardwalk.rotation,
      });
    }
    for (const order of FENBRIDGE_LAYOUT.repeated.musterOrders) {
      exclusions.push({
        kind: 'circle',
        id: order.id,
        x: order.position.x,
        z: order.position.z,
        radius: 0.7,
      });
    }
  }

  if (builtInWorld) {
    // Highwatch's painted buildings clear their whole reach and their door
    // aprons, the Fenbridge rule; the rest of its square is the props view's.
    for (const building of HIGHWATCH_LAYOUT.buildings) {
      exclusions.push(layoutObb(building.id, building.reach));
      exclusions.push({
        kind: 'circle',
        id: `${building.id}:serviceApron`,
        x: building.frontStandingPoint.x,
        z: building.frontStandingPoint.z,
        radius: 1.5,
      });
    }
  }
  if (builtInWorld) exclusions.push(...mirefenTavernGrassExclusions());

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

/** The Mirefen tavern's floor keeps its grass out (sim/content/mirefen_tavern.ts): the hall,
 *  the wing, the round tower, the porch and the run of its steps, and its grounds
 *  (sim/mirefen_tavern_grounds.ts: the cobbled forecourt, the stable's floor and the pieces on
 *  the terrain). The tavern's local axes run along the world's (its door faces +x), so each
 *  rectangle is a plain one. */
export function mirefenTavernGrassExclusions(): EastbrookGrassExclusion[] {
  const rect = (id: string, x0: number, x1: number, z0: number, z1: number) => {
    const a = tavernToWorld(x0, z0);
    const b = tavernToWorld(x1, z1);
    return {
      kind: 'obb' as const,
      id,
      x: (a.x + b.x) / 2,
      z: (a.z + b.z) / 2,
      halfWidth: Math.abs(b.x - a.x) / 2,
      halfDepth: Math.abs(b.z - a.z) / 2,
      rotation: 0,
    };
  };
  const tower = tavernToWorld(TAVERN_TOWER.x, TAVERN_TOWER.z);
  const H = TAVERN_HALL;
  const W = TAVERN_WING;
  const P = TAVERN_PORCH;
  return [
    rect('mirefen_tavern:hall', H.x0, H.x1, H.z0, H.z1),
    rect('mirefen_tavern:wing', W.x0, W.x1, W.z0, W.z1),
    {
      kind: 'circle',
      id: 'mirefen_tavern:tower',
      x: tower.x,
      z: tower.z,
      radius: TAVERN_TOWER.rOut,
    },
    rect('mirefen_tavern:porch', P.x0, P.x1, P.z0, P.z1 + TAVERN_STEPS_MAX_RUN),
    ...tavernGroundsRects().map((r, i) =>
      rect(`mirefen_tavern:grounds:${i}`, r[0], r[1], r[2], r[3]),
    ),
  ];
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
