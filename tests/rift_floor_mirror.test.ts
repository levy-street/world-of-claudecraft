// The online rift floor mirror (src/net/rift_floor_mirror.ts): one swap rule for
// a riftState event and for a reset, keeping the collision region registered
// under the client's token in lockstep with the floor it reports. The
// ClientWorld wiring (spectate frames, the reconnect) is pinned end to end in
// tests/rift_spectate_floor.test.ts; the region's effect on movement in
// tests/rift_collision_region_online.test.ts.
import { describe, expect, it } from 'vitest';
import { type RiftStateEvent, swapMirroredRiftFloor } from '../src/net/rift_floor_mirror';
import { allocRiftCollisionToken } from '../src/sim/colliders';
import { riftInstanceOrigin } from '../src/sim/data';
import { riftRegionAt } from '../src/sim/rift_regions';

function riftState(overrides: Partial<RiftStateEvent> = {}): RiftStateEvent {
  return {
    type: 'riftState',
    pid: 1,
    active: true,
    eventId: 'rift-1',
    instanceId: 4,
    seed: 2,
    baseLevel: 20,
    floorIndex: 0,
    floorCount: 5,
    origin: riftInstanceOrigin(0, 0),
    contentId: 'procedural-v1:2:20',
    contentHash: 'procedural-v1:2:20',
    upgrade: null,
    name: 'Test Rift',
    themeName: 'Test Theme',
    tier: 'B',
    expiresAtMs: 123,
    ...overrides,
  };
}

const registered = (token: number, origin: { x: number; z: number }) =>
  riftRegionAt(token, origin.x, origin.z) !== null;

describe('swapMirroredRiftFloor', () => {
  it('mirrors an active floor and registers its region', () => {
    const token = allocRiftCollisionToken();
    const ev = riftState();
    const floor = swapMirroredRiftFloor(token, null, ev);
    expect(floor).toEqual({
      eventId: 'rift-1',
      instanceId: 4,
      seed: 2,
      baseLevel: 20,
      floorIndex: 0,
      floorCount: 5,
      origin: ev.origin,
      contentId: 'procedural-v1:2:20',
      contentHash: 'procedural-v1:2:20',
      upgrade: null,
      name: 'Test Rift',
      themeName: 'Test Theme',
      tier: 'B',
    });
    expect(registered(token, ev.origin)).toBe(true);
  });

  it('a descent clears the old floor region before registering the new one', () => {
    const token = allocRiftCollisionToken();
    const first = riftState();
    const second = riftState({ floorIndex: 1, origin: riftInstanceOrigin(0, 1) });
    const floor = swapMirroredRiftFloor(token, swapMirroredRiftFloor(token, null, first), second);
    expect(floor?.floorIndex).toBe(1);
    expect(registered(token, first.origin)).toBe(false);
    expect(registered(token, second.origin)).toBe(true);
  });

  it('an exit and a reset both leave no floor and no region', () => {
    for (const next of [riftState({ active: false }), null]) {
      const token = allocRiftCollisionToken();
      const ev = riftState();
      const floor = swapMirroredRiftFloor(token, null, ev);
      expect(swapMirroredRiftFloor(token, floor, next)).toBeNull();
      expect(registered(token, ev.origin)).toBe(false);
    }
  });

  it('touches only its own token', () => {
    const mine = allocRiftCollisionToken();
    const theirs = allocRiftCollisionToken();
    const ev = riftState();
    swapMirroredRiftFloor(theirs, null, ev);
    swapMirroredRiftFloor(mine, swapMirroredRiftFloor(mine, null, ev), null);
    expect(registered(mine, ev.origin)).toBe(false);
    expect(registered(theirs, ev.origin)).toBe(true);
  });
});
