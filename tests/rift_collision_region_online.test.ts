// Issue #3479 (enable self-motion prediction inside rifts): ClientWorld now
// registers a real rift collision region under its own riftCollisionToken on
// every riftState event, instead of leaving the token permanently inert
// online. This is the region LIFECYCLE test the fix's own describe block in
// tests/self_motion.test.ts does not cover (that suite drives the predictor
// against the offline Sim's token via Sim.enterRift, never ClientWorld's own
// applyRiftStateEvent). Follows the bareClient() + call-the-private-handler
// idiom tests/rift_death_zone_online.test.ts already established for this
// exact class of test (Object.create bypasses field initializers, so any
// field a call path touches must be seeded first).

import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';
import { allocRiftCollisionToken, isBlocked } from '../src/sim/colliders';
import { riftInstanceOrigin } from '../src/sim/data';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import type { SimEvent } from '../src/sim/types';

// Same "chamber-waist" wall fixture tests/rift_wall_swept_collision.test.ts
// pins: seed 2, baseLevel 20, floorIndex 0 has a real side wall at local
// x=35, and the world seed (unrelated to the rift's own seed) does not
// affect its geometry.
const WORLD_SEED = 42;
const WALL_SEED = 2;
const WALL_BASE_LEVEL = 20;

function bareClient(): ClientWorld {
  return Object.create(ClientWorld.prototype) as ClientWorld;
}

// Object.create bypasses field initializers: seed every field
// applyRiftStateEvent's clear-then-set pair and a subsequent endSession()
// touch, mirroring what `new ClientWorld(...)` would have set.
function riftReadyClient(): ClientWorld {
  const client = bareClient();
  const c = client as any;
  c.riftFloor = null;
  c.riftCollisionToken = allocRiftCollisionToken();
  // endSession() prerequisites (see src/net/online.ts): a real ClientWorld
  // would have these from its constructor; a bare one needs them seeded to
  // return early rather than reach the WebSocket/timer fields this test
  // never constructs.
  c.actionBarSaveTimer = null;
  c.actionBarSavePending = null;
  c.pendingCommandOutcomes = undefined;
  c.sendTimer = undefined;
  c.reconnectTimer = undefined;
  c.nativeLifecycleHandle = undefined;
  c.sessionEnded = false;
  return client;
}

function riftStateEvent(overrides: Partial<SimEvent & { type: 'riftState' }>): SimEvent {
  return {
    type: 'riftState',
    pid: 1,
    active: true,
    eventId: null,
    instanceId: 0,
    seed: WALL_SEED,
    baseLevel: WALL_BASE_LEVEL,
    floorIndex: 0,
    floorCount: 5,
    origin: riftInstanceOrigin(0, 0),
    contentId: `procedural-v1:${WALL_SEED}:${WALL_BASE_LEVEL}`,
    contentHash: `procedural-v1:${WALL_SEED}:${WALL_BASE_LEVEL}`,
    upgrade: null,
    name: 'Test Rift',
    themeName: 'Test Theme',
    tier: null,
    expiresAtMs: null,
    ...overrides,
  } as SimEvent;
}

// The wall cell just past local x=35, at the same z the swept-collision
// fixture uses (61 is a known dead spot for STEPPED movement only, per the
// player_motion.ts rift test's comment; a single isBlocked point check is
// unaffected by that and matches tests/rift_wall_swept_collision.test.ts's
// own isBlocked assertion exactly).
function wallCellBlocked(client: ClientWorld, origin: { x: number; z: number }): boolean {
  return isBlocked(
    WORLD_SEED,
    origin.x + 35,
    origin.z + 61,
    PLAYER_BODY_RADIUS,
    true,
    undefined,
    client.riftCollisionToken,
  );
}

describe('ClientWorld rift collision region lifecycle (issue #3479)', () => {
  it('registers a real region on riftState(active:true): the wall cell is blocked, open elsewhere', () => {
    const client = riftReadyClient();
    const origin = riftInstanceOrigin(0, 0);
    expect(wallCellBlocked(client, origin), 'sanity: unregistered token reads open').toBe(false);

    (client as any).applyRiftStateEvent(riftStateEvent({}));

    expect(client.riftFloor).not.toBeNull();
    expect(wallCellBlocked(client, origin), 'wall cell blocked once registered').toBe(true);
  });

  it('descending to a new floor clears the OLD origin and registers the NEW one', () => {
    const client = riftReadyClient();
    const floor0Origin = riftInstanceOrigin(0, 0);
    const floor1Origin = riftInstanceOrigin(0, 1);
    expect(floor1Origin.z, 'sanity: floor 1 is a distinct origin').not.toBe(floor0Origin.z);

    (client as any).applyRiftStateEvent(riftStateEvent({ floorIndex: 0, origin: floor0Origin }));
    expect(wallCellBlocked(client, floor0Origin), 'floor 0 wall is blocked').toBe(true);

    (client as any).applyRiftStateEvent(
      riftStateEvent({ floorIndex: 1, origin: floor1Origin, seed: WALL_SEED }),
    );

    expect(client.riftFloor?.floorIndex).toBe(1);
    expect(wallCellBlocked(client, floor0Origin), 'old floor 0 region is cleared').toBe(false);
    // Floor 1's own generated geometry differs from floor 0's, so this does
    // not re-assert the exact same wall cell; it asserts the OLD one is
    // really gone, which is what a stale-region leak would fail.
  });

  it('riftState(active:false) clears the region on exit', () => {
    const client = riftReadyClient();
    const origin = riftInstanceOrigin(0, 0);
    (client as any).applyRiftStateEvent(riftStateEvent({}));
    expect(wallCellBlocked(client, origin)).toBe(true);

    (client as any).applyRiftStateEvent(riftStateEvent({ active: false }));

    expect(client.riftFloor).toBeNull();
    expect(wallCellBlocked(client, origin), 'region cleared on exit').toBe(false);
  });

  it('a duplicate riftState(active:true) for the same floor stays registered (idempotent)', () => {
    const client = riftReadyClient();
    const origin = riftInstanceOrigin(0, 0);
    (client as any).applyRiftStateEvent(riftStateEvent({}));
    (client as any).applyRiftStateEvent(riftStateEvent({}));
    expect(wallCellBlocked(client, origin)).toBe(true);
  });

  it('endSession() (close()/sendLogout()/reconnect-exhausted) clears a still-registered region', () => {
    const client = riftReadyClient();
    const origin = riftInstanceOrigin(0, 0);
    (client as any).applyRiftStateEvent(riftStateEvent({}));
    expect(wallCellBlocked(client, origin), 'registered before session end').toBe(true);

    (client as any).endSession();

    expect(
      wallCellBlocked(client, origin),
      'a session that ends inside a rift does not strand its region',
    ).toBe(false);
  });

  it('ignores a late riftState(active:true) after endSession()', () => {
    const client = riftReadyClient();
    const origin = riftInstanceOrigin(0, 0);
    (client as any).applyRiftStateEvent(riftStateEvent({}));
    expect(wallCellBlocked(client, origin), 'registered before session end').toBe(true);

    (client as any).endSession();
    (client as any).applyRiftStateEvent(riftStateEvent({}));

    expect(client.riftFloor).toBeNull();
    expect(
      wallCellBlocked(client, origin),
      'a late riftState after teardown cannot re-register the region',
    ).toBe(false);
  });
});

// riftReadyClient() above seeds riftCollisionToken via allocRiftCollisionToken()
// directly, the same as `new ClientWorld(...)`'s own readonly field initializer
// does, rather than running that real constructor (Object.create bypasses it,
// per bare_client.ts's own doc comment, since a real construction needs a live
// WebSocket/window/document this suite never stands up). That substitution is
// sound only if the allocator itself can never hand back 0, the reserved
// "no token" sentinel RIFT_REGIONS treats specially (setRiftRegion(0, ...)
// would publish under the same key every never-constructed fixture reads as
// "no region"). Pin that directly, since nothing else in this file exercises
// the real constructor to prove it.
describe('allocRiftCollisionToken never hands back the reserved sentinel', () => {
  it('is always non-zero', () => {
    expect(allocRiftCollisionToken()).not.toBe(0);
    expect(allocRiftCollisionToken()).not.toBe(0);
  });
});
