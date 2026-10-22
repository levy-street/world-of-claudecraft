import type { PlacedStreetlamp } from '../streetlamp_layout';
import { STREETLAMP_COLLIDER_RADIUS, type StreetlampStyleId } from '../streetlamp_style';

export interface LayoutStreetlamp {
  source: { x: number; z: number; style: StreetlampStyleId };
  target: {
    x: number;
    z: number;
    lift: number;
    groundY?: number;
    fixtureYaw: number;
    areaId: string | null;
  } | null;
}

/** Keep the current road plan, replacing only reviewed anchors. Authored posts
 * own their clearance footprint, so regenerated lamps cannot overlap them. */
export function placeLayoutStreetlamps(
  plan: PlacedStreetlamp[],
  edits: readonly LayoutStreetlamp[] | undefined,
  groundAt: (x: number, z: number) => number,
): PlacedStreetlamp[] {
  if (!edits?.length) return plan;
  const kept = plan.filter((lamp) =>
    edits.every(
      ({ source, target }) =>
        !(lamp.x === source.x && lamp.z === source.z && lamp.style === source.style) &&
        (!target ||
          Math.hypot(lamp.x - target.x, lamp.z - target.z) >
            STREETLAMP_COLLIDER_RADIUS[lamp.style] +
              STREETLAMP_COLLIDER_RADIUS[source.style] +
              1.1),
    ),
  );
  return [
    ...kept,
    ...edits.flatMap(({ source, target }) =>
      target
        ? [
            {
              x: target.x,
              z: target.z,
              y: (target.groundY ?? groundAt(target.x, target.z)) + target.lift,
              style: source.style,
              roadYaw: 0,
              fixtureYaw: target.fixtureYaw,
              placementY: target.lift,
              ...(target.groundY === undefined ? {} : { groundY: target.groundY }),
              areaId: target.areaId,
              authored: true,
            },
          ]
        : [],
    ),
  ];
}
