import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { saveCharacterAndMarketState } from '../server/db';
import { type ClientSession, GameServer } from '../server/game';
import type { CharacterState } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';

function fakeWs() {
  const sent: any[] = [];
  return { sent, ws: { readyState: 1, send: (p: string) => sent.push(JSON.parse(p)) } };
}

function join(
  server: GameServer,
  fc: ReturnType<typeof fakeWs>,
  id: number,
  name: string,
  state: CharacterState | null,
  cls: PlayerClass = 'warrior',
): ClientSession {
  const s = server.join(fc.ws as any, id, id, name, cls, state);
  if ('error' in s) throw new Error(s.error);
  s.blockListLoaded = true;
  return s;
}

describe('quest progress survives logout/login (server save -> load)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('restores in-progress kill counts after a save/leave/rejoin cycle', async () => {
    const server = new GameServer();
    const sim = (server as any).sim;

    // Join fresh, accept a kill quest and partially progress it.
    const fc1 = fakeWs();
    const s1 = join(server, fc1, 101, 'Annihilator', null);
    const pid = s1.pid;
    const meta = sim.meta(pid);

    // q_wolves: kill 8 forest_wolf. Seed the log with partial progress directly.
    meta.questLog.set('q_wolves', { questId: 'q_wolves', counts: [3], state: 'active' });
    expect(sim.questState('q_wolves', pid)).toBe('active');

    // Leave => server saves the serialized character state.
    await server.leave(s1, 'disconnected');
    const saved = (saveCharacterAndMarketState as any).mock.calls.at(-1)?.[2] as CharacterState;
    expect(saved).toBeTruthy();

    // Rejoin with exactly what the DB would have stored.
    const fc2 = fakeWs();
    const s2 = join(server, fc2, 101, 'Annihilator', saved);
    const meta2 = sim.meta(s2.pid);
    const qp2 = meta2.questLog.get('q_wolves');

    expect(qp2).toBeTruthy();
    expect(qp2.state).toBe('active');
    expect(qp2.counts[0]).toBe(3); // progress must NOT reset to 0
  });

  it('restores collect-objective progress (item-derived counts) after a rejoin', async () => {
    const server = new GameServer();
    const sim = (server as any).sim;

    const fc1 = fakeWs();
    const s1 = join(server, fc1, 102, 'Annihilator', null);
    const meta = sim.meta(s1.pid);

    // q_ogre_totems: collect 6 ogre_war_totem. Hold 4 totems + seed the count.
    sim.addItem('ogre_war_totem', 4, s1.pid);
    meta.questLog.set('q_ogre_totems', { questId: 'q_ogre_totems', counts: [4], state: 'active' });

    await server.leave(s1, 'disconnected');
    const saved = (saveCharacterAndMarketState as any).mock.calls.at(-1)?.[2] as CharacterState;

    const fc2 = fakeWs();
    const s2 = join(server, fc2, 102, 'Annihilator', saved);
    const meta2 = sim.meta(s2.pid);
    const qp2 = meta2.questLog.get('q_ogre_totems');

    expect(qp2?.state).toBe('active');
    expect(qp2?.counts[0]).toBe(4); // collected totems still counted after relog
    expect(sim.countItem('ogre_war_totem', s2.pid)).toBe(4); // and still in the bag
  });
});
