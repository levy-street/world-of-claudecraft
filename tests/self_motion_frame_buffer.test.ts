import { describe, expect, it } from 'vitest';
import type { InstancedMotionState } from '../src/game/self_motion_frame_buffer';
import { SelfMotionFrameBuffer } from '../src/game/self_motion_frame_buffer';
import type { DelveDoorClampSolid } from '../src/sim/delves/geometry';
import type { MoveInput } from '../src/sim/types';
import type { DelveRunInfo } from '../src/world_api/delves';
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

const delveRun: DelveRunInfo = {
  delveId: 'drowned_litany',
  tierId: 'normal',
  slot: 0,
  origin: { x: 4800, z: 0 },
  moduleIndex: 0,
  moduleCount: 1,
  modules: ['litany_sluice'],
  objective: { kind: 'kill_boss', counts: [0], complete: false },
  affixes: [],
  completed: false,
  exitPortalOpen: false,
  bountiful: false,
  rite: null,
};
const delveSolids: DelveDoorClampSolid[] = [{ kind: 'locked_door', x: 4800, z: 20, hp: 1 }];
const NOTHING_INSTANCED: InstancedMotionState = {
  riftFloor: null,
  delveRun: null,
  delveSolids: [],
};
const instanced: InstancedMotionState = { riftFloor, delveRun, delveSolids };

describe('self motion frame buffer', () => {
  it('updates one stable frame object in place', () => {
    const buffer = new SelfMotionFrameBuffer();
    const firstMove = moveInput(true);
    const first = buffer.write(true, firstMove, 1, 80, 4, 0.5, 1 / 60, 12, 50, NOTHING_INSTANCED);
    const secondMove = moveInput(false);
    const second = buffer.write(false, secondMove, 2, 120, 8, 0.75, 1 / 30, 31, 52, instanced);

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
      delveRun,
      delveSolids,
    });

    // Clearing back to null (leaving a rift/delve) must also land on the shared object.
    const third = buffer.write(
      false,
      secondMove,
      2,
      120,
      8,
      0.75,
      1 / 30,
      31,
      52,
      NOTHING_INSTANCED,
    );
    expect(third).toBe(first);
    expect(third.riftFloor).toBeNull();
    expect(third.delveRun).toBeNull();
    expect(third.delveSolids).toEqual([]);
  });
});
