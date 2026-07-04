import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed (mirrors backpressure.test.ts).
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
import type { Entity } from '../src/sim/types';

const GATE_ITEM = 'gravecaller_sigil';
const GATE_QUEST = 'q_whispers';

function fakeWs() {
  const sent: string[] = [];
  const ws: any = {
    readyState: 1,
    bufferedAmount: 0,
    sent,
    send: (payload: string) => sent.push(payload),
    terminate() {
      ws.readyState = 3;
    },
  };
  return ws;
}

function join(server: GameServer, ws: any, id: number, name: string) {
  const session = server.join(ws, id, id, name, 'warrior', null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

// The object entity id appears in a sent snapshot iff some frame's ents array
// carries an element with that id (wireEntity serializes `id`).
function objectSent(sent: string[], objId: number): boolean {
  for (const frame of sent) {
    const msg = JSON.parse(frame);
    if (msg.t !== 'snap' || !Array.isArray(msg.ents)) continue;
    if (msg.ents.some((e: { id: number }) => e.id === objId)) return true;
  }
  return false;
}

describe('server snapshot hides ground quest objects from non-questers', () => {
  let server: GameServer;
  beforeEach(() => {
    server = new GameServer();
  });

  function setup() {
    const ws = fakeWs();
    const session = join(server, ws, 1, 'Scout');
    const sim = (server as any).sim;
    const player = sim.entities.get(session.pid) as Entity;
    const obj = [...sim.entities.values()].find(
      (e: Entity) => e.kind === 'object' && e.objectItemId === GATE_ITEM,
    ) as Entity;
    if (!obj) throw new Error('gravecaller_sigil ground object not spawned');
    // stand the player on the object so it is well inside interest range
    player.pos = { ...obj.pos };
    player.prevPos = { ...obj.pos };
    return { ws, session, sim, player, obj };
  }

  it('does not send the object to a player not on the quest', () => {
    const { ws, obj } = setup();

    (server as any).broadcastSnapshots();

    expect(ws.sent.length).toBeGreaterThan(0);
    expect(objectSent(ws.sent, obj.id)).toBe(false);
  });

  it('sends the object once the player is on the quest', () => {
    const { ws, sim, session, obj } = setup();
    sim.meta(session.pid).questLog.set(GATE_QUEST, {
      questId: GATE_QUEST,
      counts: [0],
      state: 'active',
    });

    (server as any).broadcastSnapshots();

    expect(objectSent(ws.sent, obj.id)).toBe(true);
  });
});
