// Clue Scrolls on the wire: the `clue_hunt_abandon` command both ways (the
// ClientWorld send and the server's delegated world-quest dispatch), the
// command registry rows, and the owner-only `cluh` self key through a real
// GameServer snapshot (first send, the mirror, the explicit null after an
// abandon). The decode rules of `cluh` are pinned beside the sibling keys in
// tests/faction_snapshot_wire.test.ts; the sim half is tests/clue_scrolls.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchWorldQuestWire, isWorldQuestWireCommand } from '../server/quest_command_wire';
import { CLUE_HUNT_TEST_POOL, startClueHunt } from '../src/sim/clue_scrolls';
import type { ClueHuntDef } from '../src/sim/content/clue_hunts';
import { Sim } from '../src/sim/sim';
import { COMMAND_FACETS, COMMAND_NAMES, DISPATCH_ONLY_COMMANDS } from '../src/world_api';
import { bareClient, broadcast, fakeWs, joinServer, lastSnap } from './helpers/bare_client';
import { EMPTY_TEST_WORLD } from './sim_shared';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndGuildBankState: vi.fn(async () => true),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  saveMailPartitions: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
}));

const TEST_HUNT: ClueHuntDef = {
  id: 'hunt_wire_test',
  steps: [
    { kind: 'landmark', zoneId: 'drakelands', poiId: 'wyrmwatch' },
    { kind: 'dig', zoneId: 'drakelands', x: 330, z: 2100 },
  ],
};

beforeEach(() => {
  CLUE_HUNT_TEST_POOL.push(TEST_HUNT);
});
afterEach(() => {
  CLUE_HUNT_TEST_POOL.length = 0;
});

describe('the command registry', () => {
  it('clue_hunt_abandon is a client-sent IWorldQuests command', () => {
    expect(COMMAND_NAMES).toContain('clue_hunt_abandon');
    expect(COMMAND_FACETS.clue_hunt_abandon).toBe('IWorldQuests');
    expect(DISPATCH_ONLY_COMMANDS as readonly string[]).not.toContain('clue_hunt_abandon');
    expect(isWorldQuestWireCommand('clue_hunt_abandon')).toBe(true);
  });
});

describe('ClientWorld.abandonClueHunt', () => {
  it('sends the bare clue_hunt_abandon frame', () => {
    const client = bareClient(1);
    const cmd = vi.fn();
    (client as unknown as { cmd: typeof cmd }).cmd = cmd;
    client.abandonClueHunt();
    expect(cmd).toHaveBeenCalledTimes(1);
    expect(cmd).toHaveBeenCalledWith({ cmd: 'clue_hunt_abandon' });
  });
});

describe('the delegated dispatch', () => {
  it('routes clue_hunt_abandon to Sim.abandonClueHunt for the acting player', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', world: EMPTY_TEST_WORLD });
    const other = sim.addPlayer('mage', 'Bystander');
    const meta = sim.meta(sim.playerId);
    const otherMeta = sim.meta(other);
    if (!meta || !otherMeta) throw new Error('Missing player meta');
    startClueHunt(sim.ctx, meta, TEST_HUNT);
    startClueHunt(sim.ctx, otherMeta, TEST_HUNT);
    sim.drainEvents();
    dispatchWorldQuestWire(sim, { cmd: 'clue_hunt_abandon', junk: 1 }, sim.playerId);
    expect(meta.clueHunt).toBeNull();
    expect(otherMeta.clueHunt).toEqual({ huntId: TEST_HUNT.id, step: 0 });
    expect(sim.drainEvents()).toEqual([
      { type: 'clueHuntAbandoned', huntId: TEST_HUNT.id, pid: sim.playerId },
    ]);
    // No hunt: a no-op, no event.
    dispatchWorldQuestWire(sim, { cmd: 'clue_hunt_abandon' }, sim.playerId);
    expect(sim.drainEvents()).toEqual([]);
  });
});

describe('the cluh self key through a GameServer', () => {
  it('rides the first snapshot, mirrors onto clueHunt, and clears to null after an abandon', async () => {
    const { GameServer } = await import('../server/game');
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Digger');
    const meta = server.sim.meta(session.pid);
    if (!meta) throw new Error('Missing player meta');
    // The test hook replaces the pool on both sides, so the mirror decodes
    // the fixture id (a foreign id would decode to null, see the sibling suite).
    const hunt = TEST_HUNT;
    startClueHunt(server.sim.ctx, meta, hunt);
    broadcast(server);
    const first = lastSnap(fc.sent);
    expect(first.self.cluh).toEqual({ huntId: hunt.id, step: 0 });

    const client = bareClient(session.pid);
    client.applyQuestSelfSnapshot(first.self);
    expect(client.clueHunt).toEqual({ huntId: hunt.id, step: 0 });

    // The abandon frame, as the socket would deliver it: the server's own
    // dispatch (not a direct Sim call) is what clears the hunt.
    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'clue_hunt_abandon' }));
    expect(meta.clueHunt).toBeNull();
    broadcast(server);
    const next = lastSnap(fc.sent);
    expect(next.self).toHaveProperty('cluh');
    expect(next.self.cluh).toBeNull();
    client.applyQuestSelfSnapshot(next.self);
    expect(client.clueHunt).toBeNull();
  });
});
