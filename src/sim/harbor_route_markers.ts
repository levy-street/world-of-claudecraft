// Harbor route markers (content/harbor_route_markers.ts): which way each
// sign's arrow turns and the one narrow collider around its post. The model's
// arrow points down its local +x (scripts/assets/harbor_route_marker/), so a
// marker is simply yawed until +x faces its berth's boarding point (the
// landing where the gangplank comes down); the destination name is drawn on
// both faces by the renderer, so no marker is ever mirrored.
//
// Pure leaf: deterministic, no SimContext, no rng. The post collider joins
// the static grid through transport_gates.ts (the berth's own colliders),
// ungated: the sign stands whether or not the ship is in.

import type { Collider } from './colliders';
import { HARBOR_ROUTE_MARKERS, type HarborRouteMarkerDef } from './content/harbor_route_markers';
import { TRANSPORT_ROUTES } from './content/transport_ships';
import { groundHeight } from './world';

/** The one collision volume: a circle around the post and its base collar
 *  (the model's post is 0.44 wide on a 0.62 collar). The board and the
 *  optional dressing stand above head height and collide with nothing. */
export const HARBOR_ROUTE_MARKER_POST_RADIUS = 0.35;
/** Sight-check top of the post (the model's cap), above its foot. */
export const HARBOR_ROUTE_MARKER_POST_TOP = 5.1;

/** The boarding point a marker points at: its berth's landing. */
export function harborRouteMarkerBoardingPoint(def: HarborRouteMarkerDef): {
  x: number;
  z: number;
} {
  const route = TRANSPORT_ROUTES.find((r) => r.id === def.route);
  const berth = route?.berths.find((b) => b.id === def.berth);
  if (!berth) throw new Error(`harbor route marker at unknown berth ${def.route}/${def.berth}`);
  return { x: berth.landing.x, z: berth.landing.z };
}

/**
 * The marker's yaw (three.js rotation.y convention): local +x (the arrow)
 * turned onto the direction from the post to its boarding point. Rotating by
 * `yaw` sends local +x to world (cos yaw, -sin yaw).
 */
export function harborRouteMarkerYaw(def: HarborRouteMarkerDef): number {
  const to = harborRouteMarkerBoardingPoint(def);
  return Math.atan2(-(to.z - def.z), to.x - def.x);
}

/** The world direction the arrow points for a marker yawed by `yaw`. */
export function harborRouteMarkerArrow(yaw: number): { x: number; z: number } {
  return { x: Math.cos(yaw), z: -Math.sin(yaw) };
}

/** The post colliders of every marker in the built-in world, seated on the
 *  planks they stand on. */
export function harborRouteMarkerColliders(
  seed: number,
  markers: readonly HarborRouteMarkerDef[] = HARBOR_ROUTE_MARKERS,
): Collider[] {
  return markers.map((m) => ({
    type: 'circle',
    x: m.x,
    z: m.z,
    r: HARBOR_ROUTE_MARKER_POST_RADIUS,
    cameraTopY: groundHeight(m.x, m.z, seed) + HARBOR_ROUTE_MARKER_POST_TOP,
  }));
}
