import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  releaseCharacterLease: vi.fn(async () => true),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { GameServer } from '../server/game';
import { createGroundObject } from '../src/sim/entity';

describe('online dungeon door command', () => {
  it('uses the nearby matching door when another instance has the same destination', () => {
    const server = new GameServer();
    const sent: unknown[] = [];
    const session = server.join(
      {
        readyState: 1,
        send: (payload: string) => sent.push(JSON.parse(payload)),
      } as never,
      3410,
      3410,
      'Gatewalker',
      'warrior',
      null,
    );
    if ('error' in session) throw new Error(session.error);
    session.blockListLoaded = true;

    const player = server.sim.entities.get(session.pid);
    if (!player) throw new Error('Online player did not spawn');
    const firstDoor = [...server.sim.entities.values()].find(
      (entity) => entity.templateId === 'dungeon_door' && entity.dungeonId === 'hollow_crypt',
    );
    if (!firstDoor) throw new Error('Hollow Crypt door did not spawn');
    expect(
      Math.hypot(player.pos.x - firstDoor.pos.x, player.pos.z - firstDoor.pos.z),
    ).toBeGreaterThan(8);

    const nearbyDoor = createGroundObject(server.sim.nextId++, '', 'Nearby duplicate destination', {
      ...player.pos,
    });
    nearbyDoor.templateId = 'dungeon_door';
    nearbyDoor.dungeonId = 'hollow_crypt';
    nearbyDoor.objectItemId = null;
    server.sim.addEntity(nearbyDoor);

    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'enter_dungeon', dungeon: 'hollow_crypt' }),
    );

    expect(server.sim.instanceInfoAt(player.pos)?.dungeonId).toBe('hollow_crypt');
  });
});
