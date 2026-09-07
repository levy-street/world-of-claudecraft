import { describe, expect, it } from 'vitest';
import {
  hasAuthoritativeSelfPositionDiscontinuity,
  SELF_MOTION_SNAP_DIST_SQ,
  updateSelfRenderFallback,
} from '../src/render/self_motion';

describe('self render fallback', () => {
  it('recognizes only the local completed-unstuck event as an authoritative discontinuity', () => {
    const completed = {
      type: 'unstuck',
      phase: 'completed',
      pid: 7,
      reason: 'moved_to_graveyard',
      area: { kind: 'overworld', id: 'eastbrook_vale' },
      origin: { x: 0, y: 0, z: 0, localX: 0, localZ: 0 },
      destination: { x: 0, y: 0, z: 4, localX: 0, localZ: 4 },
      duration: 10,
      distance: 4,
    } as const;
    expect(hasAuthoritativeSelfPositionDiscontinuity([completed], 7)).toBe(true);
    expect(hasAuthoritativeSelfPositionDiscontinuity([completed], 8)).toBe(false);
    expect(
      hasAuthoritativeSelfPositionDiscontinuity(
        [{ type: 'unstuck', phase: 'countdown', seconds: 4 }],
        7,
      ),
    ).toBe(false);
  });

  it('snaps the fallback pose on a sub-threshold authoritative recovery', () => {
    // Four yards is deliberately below the renderer's six-yard snap threshold.
    // The explicit completed-unstuck discontinuity must still win.
    const fallbackPose = { x: 0, y: 0, z: 0 };
    updateSelfRenderFallback(fallbackPose, 0, 0, 4, true, 1 / 60, true, false);
    expect(fallbackPose.z).toBeGreaterThan(0);
    expect(fallbackPose.z).toBeLessThan(4);
    fallbackPose.z = 0;
    updateSelfRenderFallback(fallbackPose, 0, 0, 4, true, 1 / 60, true, true);
    expect(fallbackPose).toEqual({ x: 0, y: 0, z: 4 });
  });

  it('pins the six-yard teleport rule the fallback snaps on', () => {
    expect(SELF_MOTION_SNAP_DIST_SQ).toBe(36);
    const fallbackPose = { x: 0, y: 0, z: 0 };
    updateSelfRenderFallback(fallbackPose, 0, 0, 7, true, 1 / 60, true, false);
    expect(fallbackPose).toEqual({ x: 0, y: 0, z: 7 });
  });
});
