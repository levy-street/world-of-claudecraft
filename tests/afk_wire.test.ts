import { describe, expect, it, vi } from 'vitest';

// The offline Sim implements IWorld directly, so an afk toggle reaches its own
// entity with no wire hop; the "other players see it" contract only reproduces
// through the REAL server snapshot path. This drives /afk over the wire on one
// session and asserts a second, co-located session sees the `ak` dynamic field
// flip on (set) and off (cleared by movement). Db is mocked so no Postgres runs
// (mirrors presence_zone / character_lease_game).
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  loadAccountFlair: vi.fn(async () => null),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { GameServer } from '../server/game';

type Rec = { id: number; ak?: number };

function joinAt(server: any, id: number, name: string, x: number, z: number) {
  const frames: any[] = [];
  const ws = {
    readyState: 1,
    send: (payload: string) => {
      const m = JSON.parse(payload);
      if (m.t === 'snap') frames.push(m);
    },
  };
  const session = server.join(ws, id, id, name, 'warrior', null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  const e = server.sim.entities.get(session.pid);
  e.pos.x = x;
  e.pos.z = z;
  return { session, e, frames };
}

/** The record for `pid` in the most recent frame that carried it in `ents`
 *  (records are elided from `ents` on ticks they do not change, so the latest
 *  emitted one is the current wire truth). */
function latestRecord(frames: any[], pid: number): Rec | undefined {
  for (let i = frames.length - 1; i >= 0; i--) {
    const rec = (frames[i].ents ?? []).find((r: Rec) => r.id === pid);
    if (rec) return rec;
  }
  return undefined;
}

function chat(server: any, session: any, text: string): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'chat', text }));
}

describe('/afk over the wire', () => {
  it('a co-located second client sees the ak flag flip on (afk) and off (move)', () => {
    const server: any = new GameServer();
    const a = joinAt(server, 1, 'Aleph', 0, 0);
    const b = joinAt(server, 2, 'Bet', 2, 0); // well within the interest bubble

    // Prime: B learns about A before the toggle, so A's next record is a genuine delta.
    server.sim.tick();
    server.broadcastSnapshots();
    b.frames.length = 0;

    // A goes AFK. The chat handler mutates the sim synchronously; the flag rides
    // the entity, so A's record re-emits with ak:1.
    chat(server, a.session, '/afk');
    expect(a.e.afk).toBe(true);
    server.sim.tick();
    server.broadcastSnapshots();
    expect(latestRecord(b.frames, a.session.pid)?.ak).toBe(1);

    // A moves under its own input: the sim tick clears AFK, so B's next record drops ak.
    b.frames.length = 0;
    server.sim.meta(a.session.pid).moveInput.forward = true;
    server.sim.tick();
    server.broadcastSnapshots();
    expect(a.e.afk).toBe(false);
    expect(latestRecord(b.frames, a.session.pid)?.ak).toBeUndefined();
  });
});
