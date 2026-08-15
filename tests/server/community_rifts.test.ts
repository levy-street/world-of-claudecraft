// The one-per-zone rift population policy (which replaced the retired
// COMMUNITY_TEST_RIFTS public-test profile): boot restore, per-zone hourly
// cadence derived from persisted events, tolerant load, and instance capacity.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const riftDb = vi.hoisted(() => ({
  load: vi.fn<() => Promise<unknown | null>>(),
  save: vi.fn<(state: unknown) => Promise<void>>(),
}));

vi.mock('../../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  closePlaySession: vi.fn(async () => {}),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountWeaponSkins: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  loadAccountFlair: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  loadMarketState: vi.fn(async () => null),
  loadRiftState: () => riftDb.load(),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  openPlaySession: vi.fn(async () => 1),
  releaseCharacterLease: vi.fn(async () => {}),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  saveCharacterState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveRiftState: (state: unknown) => riftDb.save(state),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
  touchCharacterLogin: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
}));

import { GameServer } from '../../server/game';
import { RIFT_SLOT_COUNT, riftInstanceOrigin, riftOriginAt } from '../../src/sim/data';
import { serializeRiftWorldState } from '../../src/sim/rift/persistence';
import {
  closeNaturalRiftPortal,
  eligibleRiftZones,
  RIFT_PORTAL_FIRST_AT,
  RIFT_PORTAL_LIFETIME,
  RIFT_PORTAL_ZONE_CYCLE,
  spawnNaturalRiftPortal,
  updateRiftPortals,
} from '../../src/sim/rift/portals';
import { RIFT_EVENT_INSTANCE_CAP } from '../../src/sim/rift/runs';
import { Sim } from '../../src/sim/sim';

function runPortalScheduler(sim: Sim): void {
  sim.tickCount += (10 - (sim.tickCount % 20) + 20) % 20;
  updateRiftPortals(sim.ctx);
}

// The scheduler spawns at most ONE portal per 1 Hz pass (tick-budget cap), so
// filling or refilling the population means pumping one pass per zone.
function pumpScheduler(sim: Sim, passes = eligibleRiftZones().length + 1): void {
  for (let pass = 0; pass < passes; pass++) {
    runPortalScheduler(sim);
    sim.time += 1;
  }
}

function fillPopulation(sim: Sim): void {
  sim.time = Math.max(sim.time, RIFT_PORTAL_FIRST_AT) + 0.1;
  pumpScheduler(sim);
}

describe('rift population boot and persistence (one-per-zone rotation)', () => {
  beforeEach(() => {
    riftDb.load.mockReset();
    riftDb.save.mockReset();
    riftDb.load.mockResolvedValue(null);
    riftDb.save.mockResolvedValue();
  });

  it('fills one portal per eligible zone at the first boundary and persists the population', async () => {
    const server = new GameServer();
    await server.loadRifts();
    expect(server.sim.naturalRiftPortals).toHaveLength(0);

    fillPopulation(server.sim);
    const zoneCount = eligibleRiftZones().length;
    expect(zoneCount).toBe(11);
    // Literal cadence pins: the tuning itself is load-bearing (an uncleared
    // collapse replaces immediately only while the lifetime stays an exact
    // multiple of the cycle, so the collapse lands on a boundary).
    expect(RIFT_PORTAL_LIFETIME).toBe(2 * 60 * 60);
    expect(RIFT_PORTAL_ZONE_CYCLE).toBe(60 * 60);
    expect(RIFT_PORTAL_LIFETIME % RIFT_PORTAL_ZONE_CYCLE).toBe(0);
    expect(RIFT_PORTAL_FIRST_AT).toBe(120);
    expect(server.sim.naturalRiftPortals).toHaveLength(zoneCount);
    expect(new Set(server.sim.naturalRiftPortals.map((portal) => portal.zoneId)).size).toBe(
      zoneCount,
    );
    for (const portal of server.sim.naturalRiftPortals) {
      expect(portal.expiresAt - portal.openedAt).toBe(RIFT_PORTAL_LIFETIME);
    }
    expect(server.sim.riftPortalSpawnCount).toBe(zoneCount);

    await server.saveRifts();
    expect(riftDb.save).toHaveBeenCalledTimes(1);
    expect(riftDb.save.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        version: 1,
        spawnCount: zoneCount,
        events: expect.arrayContaining([expect.objectContaining({ status: 'open' })]),
      }),
    );
  });

  it('derives each zone cadence from persisted events across a restart', async () => {
    // Source realm: full population, then one zone first-cleared (sealed) early.
    const source = new Sim({
      seed: 20061,
      playerClass: 'warrior',
      noPlayer: true,
      riftPortals: true,
    });
    fillPopulation(source);
    const sealed = source.naturalRiftPortals[0];
    const sealedZoneId = sealed.zoneId;
    const sealedOpenedAt = sealed.openedAt;
    source.time = sealedOpenedAt + 600;
    closeNaturalRiftPortal(source.ctx, sealed.id, 'sealed');
    const sealedEvent = source.riftEvents.find((event) => event.eventId === sealed.eventId)!;
    sealedEvent.status = 'cleared'; // production seal always follows the claim
    sealedEvent.firstClear = {
      partyKey: 'solo:1',
      memberIds: [1],
      memberNames: ['Sealer'],
      duration: 600,
      clearedAt: source.time,
    };
    // Serialize against the real host clock: GameServer.loadRifts restores with
    // Date.now(), so a synthetic past timestamp would read as days of downtime
    // and collapse every event before it loads.
    riftDb.load.mockResolvedValueOnce(serializeRiftWorldState(source.ctx, Date.now()));

    // Restarted realm, restored from the same wall-clock instant.
    const server = new GameServer();
    await server.loadRifts();
    const sim = server.sim;
    const zoneCount = eligibleRiftZones().length;
    expect(sim.naturalRiftPortals).toHaveLength(zoneCount - 1);
    expect(sim.naturalRiftPortals.some((portal) => portal.zoneId === sealedZoneId)).toBe(false);

    // The sealed zone must NOT reopen before its original hourly boundary,
    // which sits CYCLE minus already-elapsed sim-seconds after the restart
    // (loadRiftWorldState shifts openedAt into the past to absorb downtime).
    const elapsedAtSave = source.time - sealedOpenedAt;
    const boundary = RIFT_PORTAL_ZONE_CYCLE - elapsedAtSave;
    sim.time = boundary - 5;
    runPortalScheduler(sim);
    expect(sim.naturalRiftPortals.some((portal) => portal.zoneId === sealedZoneId)).toBe(false);

    sim.time = boundary + 5;
    pumpScheduler(sim, zoneCount + 12);
    const reopened = sim.naturalRiftPortals.find((portal) => portal.zoneId === sealedZoneId);
    expect(reopened).toBeDefined();
    expect(reopened!.eventId).not.toBe(sealed.eventId);
    // The sealed zone is whole again, and its still-open siblings (2 h
    // lifetime, only about 1 h elapsed) survive the window untouched, so the
    // population stays one portal per zone across the board.
    expect(new Set(sim.naturalRiftPortals.map((portal) => portal.zoneId)).size).toBe(zoneCount);
  });

  it('clamps an oversized legacy nextPortalAtMs so the upgrade boot cannot starve spawns', async () => {
    // Before the rotation policy, nextPortalAtMs was the 2-4 h natural spawn
    // deadline; the live prod row holds such a value at upgrade time. Loading
    // it into the new backoff gate unclamped would silence every zone for
    // hours.
    riftDb.load.mockResolvedValueOnce({
      version: 1,
      savedAtMs: Date.now(),
      spawnCount: 1,
      nextPortalAtMs: Date.now() + 3 * 60 * 60 * 1000,
      events: [],
    });
    const server = new GameServer();
    await server.loadRifts();
    const sim = server.sim;
    expect(sim.riftPortalNextAt - sim.time).toBeLessThanOrEqual(60);
    sim.time = Math.max(sim.time, RIFT_PORTAL_FIRST_AT) + 61;
    pumpScheduler(sim);
    expect(sim.naturalRiftPortals).toHaveLength(eligibleRiftZones().length);
  });

  it('does not consume the shared simulation RNG while filling the population', async () => {
    const filled = new GameServer();
    await filled.loadRifts();
    fillPopulation(filled.sim);
    const idle = new GameServer();
    expect(filled.sim.rng.next()).toBe(idle.sim.rng.next());
  });

  it('tolerates a rift load failure and still fills a fresh population', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const loadFailure = new Error('rift db unavailable');
    riftDb.load.mockRejectedValueOnce(loadFailure);
    const server = new GameServer();

    await expect(server.loadRifts()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith('failed to load shared Rift state:', loadFailure);
    expect(server.sim.naturalRiftPortals).toHaveLength(0);
    fillPopulation(server.sim);
    expect(server.sim.naturalRiftPortals).toHaveLength(eligibleRiftZones().length);
    error.mockRestore();
  });

  it('treats unsupported persisted state as a fresh world instead of failing boot', async () => {
    riftDb.load.mockResolvedValueOnce({ version: 99, events: [] });
    const server = new GameServer();
    await expect(server.loadRifts()).resolves.toBeUndefined();
    expect(server.sim.naturalRiftPortals).toHaveLength(0);
    expect(riftDb.save).not.toHaveBeenCalled();
  });
});

describe('rift instance capacity', () => {
  it('allocates the full slot pool and maps the final slot back to its own origin', () => {
    const sim = new Sim({ seed: 99221, playerClass: 'warrior', noPlayer: true, riftPortals: true });
    // Literal pins: the pool and cap values are the tuning under test, so a
    // silent constant change must fail here, not just shift both sides.
    expect(RIFT_SLOT_COUNT).toBe(64);
    expect(RIFT_EVENT_INSTANCE_CAP).toBe(32);
    expect(sim.riftInstances).toHaveLength(RIFT_SLOT_COUNT);
    const finalOrigin = riftInstanceOrigin(RIFT_SLOT_COUNT - 1, 0);
    expect(riftOriginAt(finalOrigin.z)).toEqual(finalOrigin);
  });

  it('admits solo groups up to the per-event cap and rejects the next cleanly', () => {
    const sim = new Sim({ seed: 77441, playerClass: 'warrior', noPlayer: true, riftPortals: true });
    const pids = Array.from({ length: RIFT_EVENT_INSTANCE_CAP + 1 }, (_, index) =>
      sim.addPlayer('warrior', `Rifter${index}`),
    );

    for (const pid of pids.slice(0, RIFT_EVENT_INSTANCE_CAP)) sim.enterRift(424242, 20, pid);
    expect(sim.riftInstances.filter((instance) => instance.partyKey !== null)).toHaveLength(
      RIFT_EVENT_INSTANCE_CAP,
    );

    sim.drainEvents();
    const overflow = pids[RIFT_EVENT_INSTANCE_CAP];
    sim.enterRift(424242, 20, overflow);
    expect(sim.riftInstances.some((instance) => instance.memberIds.has(overflow))).toBe(false);
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'error',
        pid: overflow,
        text: 'All rifts are unstable right now. Try again soon.',
      }),
    );
  });

  it('caps a natural PORTAL event the same way, with free slots remaining', () => {
    const sim = new Sim({ seed: 77441, playerClass: 'warrior', noPlayer: true, riftPortals: true });
    expect(spawnNaturalRiftPortal(sim.ctx, 0)).toBe(true);
    const info = sim.naturalRiftPortals[0];
    const portal = sim.entities.get(info.id)!;
    const pids = Array.from({ length: RIFT_EVENT_INSTANCE_CAP + 1 }, (_, index) => {
      const pid = sim.addPlayer('warrior', `Walker${index}`);
      sim.setPlayerLevel(20, pid);
      return pid;
    });
    for (const pid of pids.slice(0, RIFT_EVENT_INSTANCE_CAP)) {
      sim.enterRift(portal.riftSeed!, portal.riftBaseLevel!, pid, undefined, portal);
    }
    const eventRuns = sim.riftInstances.filter(
      (instance) => instance.partyKey !== null && instance.eventId === info.eventId,
    );
    expect(eventRuns).toHaveLength(RIFT_EVENT_INSTANCE_CAP);
    // The pool still has headroom: the denial below is provably the EVENT cap.
    expect(sim.riftInstances.some((instance) => instance.partyKey === null)).toBe(true);

    sim.drainEvents();
    const overflow = pids[RIFT_EVENT_INSTANCE_CAP];
    sim.enterRift(portal.riftSeed!, portal.riftBaseLevel!, overflow, undefined, portal);
    expect(sim.riftInstances.some((instance) => instance.memberIds.has(overflow))).toBe(false);
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'error',
        pid: overflow,
        text: 'All rifts are unstable right now. Try again soon.',
      }),
    );
  });
});
