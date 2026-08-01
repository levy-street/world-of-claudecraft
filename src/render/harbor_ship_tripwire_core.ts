import {
  type HarborDef,
  type HarborShipLocalBounds,
  harborShipLocalBounds,
} from '../sim/harbor_layout';
import type { SceneAttachFrame } from '../sim/types';

const OVERLAP_EPSILON = 0.05;

export interface HarborHullColliderOverlap {
  readonly harborId: HarborDef['id'];
  readonly colliderKind: 'deck' | 'ramp';
  readonly colliderIndex: number;
}

interface AxisAlignedRect {
  readonly x: number;
  readonly z: number;
  readonly hw: number;
  readonly hd: number;
}

function horizontalOverlap(
  frame: SceneAttachFrame,
  bounds: HarborShipLocalBounds,
  rect: AxisAlignedRect,
): boolean {
  const cosYaw = Math.cos(frame.yaw);
  const sinYaw = Math.sin(frame.yaw);
  const centerX = frame.position.x + bounds.x * cosYaw + bounds.z * sinYaw;
  const centerZ = frame.position.z - bounds.x * sinYaw + bounds.z * cosYaw;
  const dx = rect.x - centerX;
  const dz = rect.z - centerZ;
  const hullXProjection = Math.abs(dx * cosYaw - dz * sinYaw);
  const hullZProjection = Math.abs(dx * sinYaw + dz * cosYaw);
  const rectOnHullX = Math.abs(cosYaw) * rect.hw + Math.abs(sinYaw) * rect.hd;
  const rectOnHullZ = Math.abs(sinYaw) * rect.hw + Math.abs(cosYaw) * rect.hd;
  if (hullXProjection >= bounds.hw + rectOnHullX - OVERLAP_EPSILON) return false;
  if (hullZProjection >= bounds.hd + rectOnHullZ - OVERLAP_EPSILON) return false;

  const hullOnWorldX = Math.abs(cosYaw) * bounds.hw + Math.abs(sinYaw) * bounds.hd;
  const hullOnWorldZ = Math.abs(sinYaw) * bounds.hw + Math.abs(cosYaw) * bounds.hd;
  return (
    Math.abs(dx) < hullOnWorldX + rect.hw - OVERLAP_EPSILON &&
    Math.abs(dz) < hullOnWorldZ + rect.hd - OVERLAP_EPSILON
  );
}

function verticalOverlap(
  frame: SceneAttachFrame,
  bounds: HarborShipLocalBounds,
  lowY: number,
  highY: number,
): boolean {
  const hullBottom = frame.position.y + bounds.bottomY;
  const hullTop = frame.position.y + bounds.topY;
  return highY > hullBottom + OVERLAP_EPSILON && lowY < hullTop - OVERLAP_EPSILON;
}

export function firstHarborHullColliderOverlap(
  movingHarbor: HarborDef,
  frame: SceneAttachFrame,
  harbors: readonly HarborDef[],
): HarborHullColliderOverlap | null {
  const bounds = harborShipLocalBounds(movingHarbor.berth);
  for (const harbor of harbors) {
    for (let i = 0; i < harbor.decks.length; i++) {
      const deck = harbor.decks[i];
      // The ship's own boarding bridge deliberately meets the hull skin at
      // the berth, so the coarse full-beam sweep skips it; the linter's
      // measured-volume mating check owns that seam.
      if (harbor.id === movingHarbor.id && deck === harbor.bridge) continue;
      if (
        verticalOverlap(frame, bounds, deck.y, deck.y) &&
        horizontalOverlap(frame, bounds, deck)
      ) {
        return { harborId: harbor.id, colliderKind: 'deck', colliderIndex: i };
      }
    }
    for (let i = 0; i < harbor.ramps.length; i++) {
      const ramp = harbor.ramps[i];
      if (
        verticalOverlap(frame, bounds, ramp.lowY, ramp.highY) &&
        horizontalOverlap(frame, bounds, ramp)
      ) {
        return { harborId: harbor.id, colliderKind: 'ramp', colliderIndex: i };
      }
    }
  }
  return null;
}
