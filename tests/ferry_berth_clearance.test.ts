import { describe, expect, it } from 'vitest';
import { composeHarborShipAttachFrame } from '../src/render/harbor_ship_attach_core';
import { propPathPoseAt } from '../src/render/prop_path_core';
import {
  LAST_BELL_PROP_PATH_SEGMENTS,
  LAST_BELL_VOYAGE_SEGMENT_IDS,
  type LastBellPropPathSegmentId,
} from '../src/sim/content/last_bell_cinematics';
import {
  GULLHAVEN_HARBOR,
  HARBOR_RAIL_HALF_THICK,
  type HarborDef,
  type HarborRail,
  harborShipLocalBounds,
  MAINLAND_HARBOR,
} from '../src/sim/harbor_layout';
import type { SceneAttachFrame } from '../src/sim/types';

const BERTH_SWEEP_SAMPLE_STEP_SECONDS = 0.05;
const FENCE_INTERSECTION_EPSILON_YARDS = 0.01;

interface OrientedRect {
  readonly x: number;
  readonly z: number;
  readonly hw: number;
  readonly hd: number;
  readonly rot: number;
}

const BERTH_GLIDES: readonly {
  readonly harbor: HarborDef;
  readonly segmentIds: readonly LastBellPropPathSegmentId[];
}[] = [
  {
    harbor: MAINLAND_HARBOR,
    segmentIds: [
      LAST_BELL_VOYAGE_SEGMENT_IDS.out.castOff,
      LAST_BELL_VOYAGE_SEGMENT_IDS.back.arrival,
    ],
  },
  {
    harbor: GULLHAVEN_HARBOR,
    segmentIds: [
      LAST_BELL_VOYAGE_SEGMENT_IDS.back.castOff,
      LAST_BELL_VOYAGE_SEGMENT_IDS.out.arrival,
    ],
  },
];

function shipFrame(
  harbor: HarborDef,
  pose: { x: number; y: number; z: number; yaw: number } | null,
): SceneAttachFrame {
  return composeHarborShipAttachFrame(
    {
      baseX: harbor.berth.x,
      baseY: -harbor.berth.draft,
      baseZ: harbor.berth.z,
      baseRot: harbor.berth.rot,
    },
    pose === null ? null : { ...pose, done: false },
    { position: { x: 0, y: 0, z: 0 }, yaw: 0 },
  );
}

function hullRect(harbor: HarborDef, frame: SceneAttachFrame): OrientedRect {
  const bounds = harborShipLocalBounds(harbor.berth);
  const cos = Math.cos(frame.yaw);
  const sin = Math.sin(frame.yaw);
  return {
    x: frame.position.x + bounds.x * cos + bounds.z * sin,
    z: frame.position.z - bounds.x * sin + bounds.z * cos,
    hw: bounds.hw,
    hd: bounds.hd,
    rot: frame.yaw,
  };
}

function railRect(rail: HarborRail): OrientedRect {
  return {
    x: rail.x,
    z: rail.z,
    hw: rail.hw,
    hd: rail.halfThickness ?? HARBOR_RAIL_HALF_THICK,
    rot: rail.rot,
  };
}

function orientedRectsIntersect(left: OrientedRect, right: OrientedRect): boolean {
  const axesFor = (rect: OrientedRect) => {
    const cos = Math.cos(rect.rot);
    const sin = Math.sin(rect.rot);
    return [
      { x: cos, z: -sin },
      { x: sin, z: cos },
    ] as const;
  };
  const leftAxes = axesFor(left);
  const rightAxes = axesFor(right);
  const dx = right.x - left.x;
  const dz = right.z - left.z;
  for (const axis of [...leftAxes, ...rightAxes]) {
    const distance = Math.abs(dx * axis.x + dz * axis.z);
    const leftRadius =
      left.hw * Math.abs(leftAxes[0].x * axis.x + leftAxes[0].z * axis.z) +
      left.hd * Math.abs(leftAxes[1].x * axis.x + leftAxes[1].z * axis.z);
    const rightRadius =
      right.hw * Math.abs(rightAxes[0].x * axis.x + rightAxes[0].z * axis.z) +
      right.hd * Math.abs(rightAxes[1].x * axis.x + rightAxes[1].z * axis.z);
    if (leftRadius + rightRadius - distance <= FENCE_INTERSECTION_EPSILON_YARDS) {
      return false;
    }
  }
  return true;
}

function expectFenceClearance(
  harbor: HarborDef,
  frame: SceneAttachFrame,
  collisionGroup: string,
  label: string,
  collisions: Map<string, string>,
): void {
  const hull = hullRect(harbor, frame);
  for (const [railIndex, rail] of harbor.rails.entries()) {
    if (!orientedRectsIntersect(hull, railRect(rail))) continue;
    const key = `${harbor.id}:${collisionGroup}:${railIndex}`;
    if (!collisions.has(key)) {
      collisions.set(key, `${harbor.id} rail ${railIndex} intersects the hull at ${label}`);
    }
  }
}

describe('ferry berth fence clearance', () => {
  it('keeps both parked hulls and all four berth glides clear of dock rail colliders', () => {
    const collisions = new Map<string, string>();
    for (const { harbor, segmentIds } of BERTH_GLIDES) {
      expectFenceClearance(
        harbor,
        shipFrame(harbor, null),
        'parked',
        'the parked pose',
        collisions,
      );
      for (const segmentId of segmentIds) {
        const segment = LAST_BELL_PROP_PATH_SEGMENTS[segmentId];
        for (
          let elapsed = 0;
          elapsed < segment.duration;
          elapsed += BERTH_SWEEP_SAMPLE_STEP_SECONDS
        ) {
          expectFenceClearance(
            harbor,
            shipFrame(harbor, propPathPoseAt(segment, elapsed)),
            segmentId,
            `${segmentId} at ${elapsed.toFixed(2)} seconds`,
            collisions,
          );
        }
        expectFenceClearance(
          harbor,
          shipFrame(harbor, propPathPoseAt(segment, segment.duration)),
          segmentId,
          `${segmentId} at ${segment.duration.toFixed(2)} seconds`,
          collisions,
        );
      }
    }
    expect([...collisions.values()]).toEqual([]);
  });
});
