import { describe, expect, it } from 'vitest';
import {
  isMovementFrozen,
  isPlayerImmobilized,
  type SelfMotionGateArgs,
  selfMotionPredictionEnabled,
} from '../src/game/self_motion_gate';
import { DELVE_X_MIN, isDelvePos, isRiftPos, RIFT_X_MIN } from '../src/sim/data';
import type { Aura } from '../src/sim/types';
import type { RiftFloorView } from '../src/world_api/dungeons';

const aura = (kind: string): Aura =>
  ({ id: kind, name: kind, kind, remaining: 5, duration: 5, value: 0 }) as Aura;

// An open-world position: the two instanced bands are keyed off x alone.
const OPEN_WORLD_X = 0;

const riftFloor: RiftFloorView = {
  eventId: null,
  instanceId: 1,
  seed: 42,
  baseLevel: 20,
  floorIndex: 0,
  floorCount: 4,
  origin: { x: RIFT_X_MIN, z: 200 },
  contentId: 'procedural-v1:42:20',
  contentHash: 'procedural-v1:42:20',
  upgrade: null,
  name: 'Test Rift',
  themeName: 'Test Theme',
  tier: null,
};

const enabledArgs = (over: Partial<SelfMotionGateArgs> = {}): SelfMotionGateArgs => ({
  disabled: false,
  spectating: null,
  movementFrozen: false,
  playerImmobilized: false,
  posX: OPEN_WORLD_X,
  climbing: undefined,
  riftFloor: null,
  ...over,
});

describe('isPlayerImmobilized', () => {
  it('is true for each hard crowd-control aura kind', () => {
    for (const kind of ['stun', 'root', 'incapacitate', 'polymorph']) {
      expect(isPlayerImmobilized([aura(kind)]), kind).toBe(true);
    }
  });

  it('is false with no auras or only auras that still allow movement', () => {
    expect(isPlayerImmobilized([])).toBe(false);
    expect(isPlayerImmobilized([aura('slow'), aura('dot'), aura('haste')])).toBe(false);
  });

  it('finds an immobilizing aura anywhere in the list', () => {
    expect(isPlayerImmobilized([aura('slow'), aura('root'), aura('dot')])).toBe(true);
  });
});

describe('isMovementFrozen', () => {
  it('freezes only a corpse that has not released its spirit', () => {
    expect(isMovementFrozen({ dead: true, ghost: false })).toBe(true);
    expect(isMovementFrozen({ dead: true, ghost: true })).toBe(false);
    expect(isMovementFrozen({ dead: false, ghost: false })).toBe(false);
    expect(isMovementFrozen({ dead: false, ghost: true })).toBe(false);
  });
});

describe('selfMotionPredictionEnabled', () => {
  it('is on for a living, unheld player standing in the open world', () => {
    expect(selfMotionPredictionEnabled(enabledArgs())).toBe(true);
    expect(isDelvePos(OPEN_WORLD_X)).toBe(false);
    expect(isRiftPos(OPEN_WORLD_X)).toBe(false);
  });

  it('every condition turns it off on its own', () => {
    const cases: Partial<SelfMotionGateArgs>[] = [
      { disabled: true },
      { spectating: 'someone-else' },
      { movementFrozen: true },
      { playerImmobilized: true },
      { climbing: true },
    ];
    for (const over of cases) {
      expect(selfMotionPredictionEnabled(enabledArgs(over)), JSON.stringify(over)).toBe(false);
    }
  });

  it('is off inside a delve and inside a rift before the rift floor descriptor arrives', () => {
    const delveX = DELVE_X_MIN;
    const riftX = RIFT_X_MIN;
    expect(isDelvePos(delveX)).toBe(true);
    expect(isRiftPos(riftX)).toBe(true);
    expect(selfMotionPredictionEnabled(enabledArgs({ posX: delveX }))).toBe(false);
    expect(selfMotionPredictionEnabled(enabledArgs({ posX: riftX }))).toBe(false);
  });

  it('is on inside a rift once the mirrored rift floor descriptor is present', () => {
    expect(isRiftPos(RIFT_X_MIN)).toBe(true);
    expect(selfMotionPredictionEnabled(enabledArgs({ posX: RIFT_X_MIN, riftFloor }))).toBe(true);
  });

  it('treats only an explicit climbing:true as a climb', () => {
    expect(selfMotionPredictionEnabled(enabledArgs({ climbing: false }))).toBe(true);
    expect(selfMotionPredictionEnabled(enabledArgs({ climbing: undefined }))).toBe(true);
  });
});
