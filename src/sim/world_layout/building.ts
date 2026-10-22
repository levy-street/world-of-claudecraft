import type { AuthoredTownBuildingRecord } from '../authored_town_registry';
import type { BuildingPlacement } from './types';

type Point = { readonly x: number; readonly z: number };
type Box = {
  readonly center: Point;
  readonly halfWidth: number;
  readonly halfDepth: number;
  readonly rotation: number;
};

interface Building extends AuthoredTownBuildingRecord {
  readonly footprint: Box;
  readonly maxCornerRadius: number;
  readonly frontClearance: number;
  readonly frontFacing: number;
  readonly sockets?: Readonly<
    Record<
      string,
      {
        readonly id: string;
        readonly localPosition: Point | null;
        readonly position: Point;
        readonly standingPoint: Point;
      }
    >
  >;
}

/** Transform all building geometry together, before downstream layout derivation. */
export function placeLayoutBuilding<T extends Building>(
  building: T,
  target?: BuildingPlacement,
): T & { placement: T['placement'] & { groundY?: number } } {
  if (!target) return building;
  if (target.path !== building.assetId) throw new Error(`Layout model mismatch: ${building.id}`);
  const size = building.placement.modelSize;
  if (!size || !Number.isFinite(size) || size <= 0)
    throw new Error(`Missing model size: ${building.id}`);
  if (
    ![target.x, target.z, target.rotation, target.scale, target.lift].every(Number.isFinite) ||
    target.scale <= 0 ||
    (target.groundY !== undefined && !Number.isFinite(target.groundY))
  ) {
    throw new Error(`Invalid building placement: ${building.id}`);
  }
  const scale = (target.scale * 2.2) / size;
  const ratio = scale / building.placement.scale;
  const turn = target.rotation - building.rotation;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const point = (p: Point) => {
    const dx = (p.x - building.placement.x) * ratio;
    const dz = (p.z - building.placement.z) * ratio;
    return { x: target.x + dx * cos + dz * sin, z: target.z - dx * sin + dz * cos };
  };
  const box = <B extends Box>(b: B): B => ({
    ...b,
    center: point(b.center),
    halfWidth: b.halfWidth * ratio,
    halfDepth: b.halfDepth * ratio,
    rotation: b.rotation + turn,
  });
  return {
    ...building,
    position: point(building.position),
    rotation: target.rotation,
    nativeDimensions: {
      width: building.nativeDimensions.width * ratio,
      depth: building.nativeDimensions.depth * ratio,
      height: (building.nativeDimensions.height - building.placement.lift) * ratio + target.lift,
    },
    footprint: box(building.footprint),
    reach: box(building.reach),
    annexes: building.annexes.map(box),
    maxCornerRadius: building.maxCornerRadius * ratio,
    frontClearance: building.frontClearance * ratio,
    frontStandingPoint: point(building.frontStandingPoint),
    frontFacing: Math.atan2(
      Math.sin(building.frontFacing + turn),
      Math.cos(building.frontFacing + turn),
    ),
    ...(building.sockets
      ? {
          sockets: Object.fromEntries(
            Object.entries(building.sockets).map(([key, socket]) => [
              key,
              {
                ...socket,
                localPosition: socket.localPosition && {
                  x: socket.localPosition.x * ratio,
                  z: socket.localPosition.z * ratio,
                },
                position: point(socket.position),
                standingPoint: point(socket.standingPoint),
              },
            ]),
          ),
        }
      : {}),
    placement: {
      ...building.placement,
      x: target.x,
      z: target.z,
      rotation: target.rotation,
      scale,
      lift: target.lift,
      groundY: target.groundY,
    },
  };
}
