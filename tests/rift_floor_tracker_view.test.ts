import { describe, expect, it } from 'vitest';
import { riftFloorTrackerModel, riftTimerParts } from '../src/ui/hud/rift/rift_floor_tracker_view';
import type { IWorld } from '../src/world_api';
import type { RiftFloorView } from '../src/world_api/dungeons';

function floor(overrides: Partial<RiftFloorView> = {}): RiftFloorView {
  return {
    eventId: 'evt1',
    instanceId: 1,
    seed: 42,
    baseLevel: 20,
    floorIndex: 1,
    floorCount: 5,
    origin: { x: 0, z: 0 },
    contentId: 'procedural-v1:42:20',
    contentHash: 'procedural-v1:42:20',
    upgrade: null,
    name: 'Sunken Hall',
    themeName: 'flooded',
    tier: 'B',
    ...overrides,
  };
}

type World = Pick<IWorld, 'riftFloor' | 'riftEventMsRemaining'>;

function world(riftFloor: RiftFloorView | null, msRemaining: number | null): World {
  return { riftFloor, riftEventMsRemaining: () => msRemaining };
}

describe('riftFloorTrackerModel', () => {
  it('is null outside a rift, regardless of what riftEventMsRemaining answers', () => {
    expect(riftFloorTrackerModel(world(null, 12_345))).toBeNull();
    expect(riftFloorTrackerModel(world(null, null))).toBeNull();
  });

  it('reports the 1-based floor (issue #2655 worked example: floorIndex 1 of 5 -> "Floor 2 of 5")', () => {
    const model = riftFloorTrackerModel(world(floor({ floorIndex: 1, floorCount: 5 }), null));
    expect(model).toEqual({ floor: 2, floorCount: 5, timerSeconds: null });
  });

  it('reports the first floor as 1 of N', () => {
    const model = riftFloorTrackerModel(world(floor({ floorIndex: 0, floorCount: 3 }), 60_000));
    expect(model?.floor).toBe(1);
    expect(model?.floorCount).toBe(3);
  });

  it('degrades the timer to null for a dev-spawned rift (no backing RiftEvent)', () => {
    const model = riftFloorTrackerModel(world(floor(), null));
    expect(model?.timerSeconds).toBeNull();
  });

  it('floors the live remaining ms into whole seconds (Sim/ClientWorld both hand back ms)', () => {
    const model = riftFloorTrackerModel(world(floor(), 65_999));
    expect(model?.timerSeconds).toBe(65);
  });

  it('hides the timer once the countdown reaches zero rather than sticking at "0:00"', () => {
    // riftEventMsRemaining() keeps answering 0 after the backing RiftEvent's portal
    // closes (the party inside keeps playing; the event is not deleted until
    // trimEventHistory purges it), so the model degrades the same way it does for a
    // dev-spawned rift: floor progress stays, the timer line disappears.
    expect(riftFloorTrackerModel(world(floor(), 0))?.timerSeconds).toBeNull();
    expect(riftFloorTrackerModel(world(floor(), 500))?.timerSeconds).toBeNull();
  });

  it('hides the timer for a negative or expired remaining span rather than going negative', () => {
    const model = riftFloorTrackerModel(world(floor(), -500));
    expect(model?.timerSeconds).toBeNull();
  });

  it('same-input-same-output against both a Sim- and a ClientWorld-shaped stub', () => {
    // Sim's riftFloor getter and ClientWorld's mirrored field satisfy the exact
    // same RiftFloorView shape; the model only reads the two declared members,
    // so either backing produces an identical model for identical values.
    const simShaped: World = {
      riftFloor: floor({ floorIndex: 2, floorCount: 6 }),
      riftEventMsRemaining: () => 90_000,
    };
    const clientShaped: World = {
      riftFloor: floor({ floorIndex: 2, floorCount: 6 }),
      riftEventMsRemaining: () => 90_000,
    };
    expect(riftFloorTrackerModel(simShaped)).toEqual(riftFloorTrackerModel(clientShaped));
  });
});

describe('riftTimerParts', () => {
  it('splits a sub-hour span into minutes/seconds with hours at zero', () => {
    expect(riftTimerParts(65)).toEqual({ hours: 0, minutes: 1, seconds: 5 });
  });

  it('splits a multi-hour span (community rifts run up to six hours)', () => {
    expect(riftTimerParts(2 * 3600 + 3 * 60 + 9)).toEqual({ hours: 2, minutes: 3, seconds: 9 });
  });

  it('clamps a non-positive span to zero', () => {
    expect(riftTimerParts(0)).toEqual({ hours: 0, minutes: 0, seconds: 0 });
    expect(riftTimerParts(-5)).toEqual({ hours: 0, minutes: 0, seconds: 0 });
  });

  it('truncates a fractional second rather than rounding up', () => {
    expect(riftTimerParts(59.9)).toEqual({ hours: 0, minutes: 0, seconds: 59 });
  });
});
