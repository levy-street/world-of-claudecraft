// The cast-off cue's pure motion core (src/render/harbor_cast_off.ts): zero
// at the start, monotonic way-on with an ease-in (a ship leaves slowly),
// clamped and flagged done at the end, and allocation-free on the reuse path.
import { describe, expect, it } from 'vitest';
import { CAST_OFF_DURATION, castOffPose } from '../src/render/harbor_cast_off';

describe('castOffPose', () => {
  it('starts at rest and is clamped below zero', () => {
    expect(castOffPose(0)).toEqual({ forward: 0, yawDrift: 0, done: false });
    expect(castOffPose(-3).forward).toBe(0);
  });

  it('eases in: the first quarter covers far less than the last quarter', () => {
    const q1 = castOffPose(CAST_OFF_DURATION * 0.25).forward;
    const q4 =
      castOffPose(CAST_OFF_DURATION).forward - castOffPose(CAST_OFF_DURATION * 0.75).forward;
    expect(q1).toBeGreaterThan(0);
    expect(q4).toBeGreaterThan(q1 * 2);
  });

  it('grows monotonically and holds its final pose past the duration', () => {
    let last = -1;
    for (let t = 0; t <= CAST_OFF_DURATION; t += 0.5) {
      const pose = castOffPose(t);
      expect(pose.forward).toBeGreaterThanOrEqual(last);
      last = pose.forward;
    }
    const end = castOffPose(CAST_OFF_DURATION);
    const past = castOffPose(CAST_OFF_DURATION + 30);
    expect(end.done).toBe(true);
    expect(past.forward).toBe(end.forward);
    expect(past.yawDrift).toBe(end.yawDrift);
  });

  it('writes into the reused container on the per-frame path', () => {
    const out = { forward: 0, yawDrift: 0, done: false };
    const returned = castOffPose(3, out);
    expect(returned).toBe(out);
    expect(out.forward).toBeGreaterThan(0);
  });
});
