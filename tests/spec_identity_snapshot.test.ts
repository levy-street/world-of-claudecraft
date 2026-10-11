import { describe, expect, it, vi } from 'vitest';

// End to end for another player's spec on the mouseover tooltip: the sim
// stamps Entity.specId, server/game.ts identityFields ships it as `spc` through
// writePlayerIdentityWire, and the online.ts identity block decodes it through
// decodePlayerIdentityWire onto the viewer's ClientWorld mirror. The module
// pair is round-tripped in tests/player_identity_wire.test.ts; THIS suite fails
// if either monolith stops calling its half.

// Mock the db layer so no Postgres is needed (hoisted above the server import).
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  walletForAccount: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
}));

import { GameServer } from '../server/game';
import { classSpecs } from '../src/sim/content/talents';
import { bareClient, broadcast, fakeWs, joinServer, lastSnap } from './helpers/bare_client';

type SnapshotApplier = { applySnapshot(snapshot: unknown): void };

function setup() {
  const server = new GameServer();
  const viewerWs = fakeWs();
  const viewer = joinServer(server, viewerWs, 1, 'Watcher');
  const other = joinServer(server, fakeWs(), 2, 'Maribel', 'priest');
  server.sim.setPlayerLevel(20, other.pid);
  const client = bareClient(viewer.pid) as unknown as SnapshotApplier & {
    entities: Map<number, { specId?: string | null; guild: string }>;
  };
  // One server beat: tick (the per-entity wire cache refreshes once per sim
  // tick, as on the live loop), broadcast, apply the viewer's newest
  // snapshot, and return the peer's record.
  const pump = () => {
    server.sim.tick();
    viewerWs.sent.length = 0;
    broadcast(server);
    const snap = lastSnap(viewerWs.sent);
    client.applySnapshot(snap);
    // biome-ignore lint/suspicious/noExplicitAny: untyped wire JSON
    return snap.ents.find((e: any) => e.id === other.pid);
  };
  return { server, other, client, pump };
}

describe('another player spec on the identity wire', () => {
  it('ships a chosen spec as `spc` and the viewer mirror decodes it', () => {
    const { server, other, client, pump } = setup();
    const [first] = classSpecs('priest');
    expect(server.sim.setSpec(first, other.pid)).toBe(true);
    const wire = pump();
    expect(wire.k).toBe('player'); // first sight: a full identity record
    expect(wire.spc).toBe(first);
    expect(client.entities.get(other.pid)?.specId).toBe(first);
  });

  it('re-sends the identity record when the spec changes, and clears it on a spec clear', () => {
    const { server, other, client, pump } = setup();
    const [first, second] = classSpecs('priest');
    server.sim.setSpec(first, other.pid);
    pump();
    // Nothing changed: no identity keys ride (the record is dynamics only, or
    // elided whole when nothing moved).
    const idle = pump();
    expect(idle?.k).toBeUndefined();
    expect(idle?.spc).toBeUndefined();

    expect(server.sim.setSpec(second, other.pid)).toBe(true);
    const switched = pump();
    expect(switched.k).toBe('player');
    expect(switched.spc).toBe(second);
    expect(client.entities.get(other.pid)?.specId).toBe(second);

    expect(server.sim.setSpec(null, other.pid)).toBe(true);
    const cleared = pump();
    // The key is sparse: a full record WITHOUT `spc` is how "no spec" ships.
    expect(cleared.k).toBe('player');
    expect(cleared).not.toHaveProperty('spc');
    expect(client.entities.get(other.pid)?.specId).toBeNull();
  });

  it('keeps the older identity lines riding the same records unchanged', () => {
    const { server, other, client, pump } = setup();
    const ent = server.sim.entities.get(other.pid);
    if (!ent) throw new Error('peer entity missing');
    ent.guild = 'Order of Dawn';
    const wire = pump();
    expect(wire.gd).toBe('Order of Dawn');
    expect(client.entities.get(other.pid)?.guild).toBe('Order of Dawn');
  });
});
