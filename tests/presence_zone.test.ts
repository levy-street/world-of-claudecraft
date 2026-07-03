import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed (mirrors who_filter/snapshots tests).
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { GameServer } from '../server/game';
import { delveOrigin, instanceOrigin } from '../src/sim/data';

function makeServerWithPlayer(): { server: any; session: any; entity: any } {
  const server: any = new GameServer();
  const ws = { readyState: 1, send: () => {} };
  const session = server.join(ws, 1, 1, 'Tester', 'warrior', null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  const entity = server.sim.entities.get(session.pid);
  return { server, session, entity };
}

describe('presenceOf zone resolution', () => {
  it('reports the overworld zone for a freshly spawned player', () => {
    const { server, session } = makeServerWithPlayer();
    const presence = server.presenceOf(session);
    expect(presence.zone).toBe('Eastbrook Vale');
    expect(presence.status).toBe('online');
  });

  it('names the dungeon and reports "dungeon" status when dungeonId is set', () => {
    const { server, session, entity } = makeServerWithPlayer();
    entity.dungeonId = 'hollow_crypt';
    const presence = server.presenceOf(session);
    expect(presence.zone).toBe('The Hollow Crypt');
    expect(presence.status).toBe('dungeon');
  });

  it('names the dungeon by instance position (no dungeonId on the player entity)', () => {
    const { server, session, entity } = makeServerWithPlayer();
    // Players moved into a dungeon get their position set to the instance origin
    // but never get e.dungeonId assigned, so the position must resolve the zone.
    entity.dungeonId = null;
    const origin = instanceOrigin(0, 0); // hollow_crypt is index 0
    entity.pos.x = origin.x;
    entity.pos.z = origin.z;
    const presence = server.presenceOf(session);
    expect(presence.zone).toBe('The Hollow Crypt');
    expect(presence.status).toBe('dungeon');
  });

  it('names the delve and reports "dungeon" status at a delve instance position', () => {
    const { server, session, entity } = makeServerWithPlayer();
    entity.dungeonId = null;
    const origin = delveOrigin(0, 0); // collapsed_reliquary is index 0
    entity.pos.x = origin.x;
    entity.pos.z = origin.z;
    const presence = server.presenceOf(session);
    expect(presence.zone).toBe('The Collapsed Reliquary');
    expect(presence.status).toBe('dungeon');
  });
});
