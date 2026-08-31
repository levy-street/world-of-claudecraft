import { describe, expect, it } from 'vitest';
import { SelfMotionFrameBuffer } from '../src/game/self_motion_frame_buffer';
import type { MoveInput } from '../src/sim/types';
import type { RiftFloorView } from '../src/world_api/dungeons';

const moveInput = (forward: boolean): MoveInput => ({
  forward,
  back: false,
  turnLeft: false,
  turnRight: false,
  strafeLeft: false,
  strafeRight: false,
  jump: false,
  dive: false,
  surface: false,
});

const riftFloor: RiftFloorView = {
  eventId: null,
  instanceId: 1,
  seed: 42,
  baseLevel: 20,
  floorIndex: 0,
  floorCount: 4,
  origin: { x: 100, z: 200 },
  contentId: 'procedural-v1:42:20',
  contentHash: 'procedural-v1:42:20',
  upgrade: null,
  name: 'Test Rift',
  themeName: 'Test Theme',
  tier: null,
};

describe('self motion frame buffer', () => {
  it('updates one stable frame object in place', () => {
    const buffer = new SelfMotionFrameBuffer();
    const firstMove = moveInput(true);
    const first = buffer.write(true, firstMove, 1, 80, 4, 0.5, 1 / 60, 12, 50, null);
    const secondMove = moveInput(false);
    const second = buffer.write(false, secondMove, 2, 120, 8, 0.75, 1 / 30, 31, 52, riftFloor);

    expect(second).toBe(first);
    expect(second).toEqual({
      enabled: false,
      moveInput: secondMove,
      displayFacing: 2,
      echoMs: 120,
      jitterMs: 8,
      alpha: 0.75,
      frameDt: 1 / 30,
      snapAgeMs: 31,
      snapIntervalMs: 52,
      riftFloor,
    });

    // Clearing back to null (leaving a rift) must also land on the shared object.
    const third = buffer.write(false, secondMove, 2, 120, 8, 0.75, 1 / 30, 31, 52, null);
    expect(third).toBe(first);
    expect(third.riftFloor).toBeNull();
  });
});
