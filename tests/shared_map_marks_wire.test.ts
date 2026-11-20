// The raid map's shared marks over the wire: the `map_mark_set` /
// `map_mark_clear` commands (server/marker_commands.ts shape checks, the Sim
// owns the rules), the `mmarks` self-delta row (server/self_social_wire.ts,
// [symbol, page, x, z] rows or null) delivered to every group member in the
// instance and to nobody else, and the client decode + ClientWorld mirror
// (src/net/shared_map_marks_wire.ts). The wire strings are pinned as literals:
// the wire string IS the protocol.

import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { GameServer } from '../server/game';
import { decodeSharedMapMarks } from '../src/net/shared_map_marks_wire';
import { bareClient, broadcast, fakeWs, joinServer, lastSnap } from './helpers/bare_client';

const SKULL = 7;
const STAR = 0;

function cmd(server: GameServer, session: unknown, payload: object): void {
  server.handleMessage(session as never, JSON.stringify({ t: 'cmd', ...payload }));
}

/** A leader and a member in one party, both inside its crypt; an outsider in the world. */
function raidNight() {
  const server = new GameServer();
  const fa = fakeWs();
  const sa = joinServer(server, fa, 1, 'Aleph');
  const fb = fakeWs();
  const sb = joinServer(server, fb, 2, 'Bet');
  const fc = fakeWs();
  const sc = joinServer(server, fc, 3, 'Gimel');
  cmd(server, sa, { cmd: 'pinvite', id: sb.pid });
  cmd(server, sb, { cmd: 'paccept' });
  expect(server.sim.enterDungeon('hollow_crypt', sa.pid)).toBe(true);
  expect(server.sim.enterDungeon('hollow_crypt', sb.pid)).toBe(true);
  return { server, sa, sb, sc, fa, fb, fc };
}

describe('shared map marks: server wire', () => {
  it('a placed mark reaches every group member in the instance, and no one else', () => {
    const { server, sa, fa, fb, fc } = raidNight();
    cmd(server, sa, { cmd: 'map_mark_set', page: 1, x: 12.34, z: -8, symbol: SKULL });
    broadcast(server);
    expect(lastSnap(fa.sent).self.mmarks).toEqual([[SKULL, 1, 12.3, -8]]);
    expect(lastSnap(fb.sent).self.mmarks).toEqual([[SKULL, 1, 12.3, -8]]);
    expect(lastSnap(fc.sent).self.mmarks).toBeNull();
  });

  it('rides as a delta: unchanged marks are not resent, a clear is', () => {
    const { server, sa, sb, fb } = raidNight();
    cmd(server, sa, { cmd: 'map_mark_set', page: 0, x: 1, z: 2, symbol: STAR });
    broadcast(server);
    expect(lastSnap(fb.sent).self.mmarks).toEqual([[STAR, 0, 1, 2]]);
    broadcast(server);
    expect(lastSnap(fb.sent).self).not.toHaveProperty('mmarks');
    cmd(server, sb, { cmd: 'map_mark_clear', symbol: null });
    broadcast(server);
    expect(lastSnap(fb.sent).self.mmarks).toBeNull();
  });

  it('drops malformed frames before the sim', () => {
    const { server, sa, fa } = raidNight();
    const bad = [
      { cmd: 'map_mark_set', page: 0, x: '1', z: 2, symbol: STAR },
      { cmd: 'map_mark_set', page: 0.5, x: 1, z: 2, symbol: STAR },
      { cmd: 'map_mark_set', page: 0, x: 1, z: 2, symbol: 1.5 },
      { cmd: 'map_mark_set', page: 0, x: 1, symbol: STAR },
      { cmd: 'map_mark_set', page: 0, x: 1e9, z: 2, symbol: STAR },
      { cmd: 'map_mark_set', page: 0, x: 1, z: 2, symbol: 9 },
      { cmd: 'map_mark_clear', symbol: 'all' },
    ];
    for (const frame of bad) cmd(server, sa, frame);
    broadcast(server);
    expect(lastSnap(fa.sent).self.mmarks).toBeNull();
  });

  it('a raid member who is not the leader cannot place', () => {
    const { server, sa, sb, fa } = raidNight();
    const group = server.sim.partyOf(sa.pid);
    if (!group) throw new Error('no party');
    group.raid = true;
    cmd(server, sb, { cmd: 'map_mark_set', page: 0, x: 1, z: 2, symbol: STAR });
    broadcast(server);
    expect(lastSnap(fa.sent).self.mmarks).toBeNull();
    cmd(server, sa, { cmd: 'map_mark_set', page: 0, x: 1, z: 2, symbol: STAR });
    broadcast(server);
    expect(lastSnap(fa.sent).self.mmarks).toEqual([[STAR, 0, 1, 2]]);
  });

  it('the group disbanding clears the row on the next snapshot', () => {
    const { server, sa, sb, fa } = raidNight();
    cmd(server, sa, { cmd: 'map_mark_set', page: 0, x: 1, z: 2, symbol: STAR });
    broadcast(server);
    cmd(server, sb, { cmd: 'pleave' });
    broadcast(server);
    expect(lastSnap(fa.sent).self.mmarks).toBeNull();
  });
});

describe('shared map marks: client decode and mirror', () => {
  it('keeps well-formed rows and drops everything else', () => {
    expect(decodeSharedMapMarks(null)).toEqual([]);
    expect(decodeSharedMapMarks('x')).toEqual([]);
    expect(
      decodeSharedMapMarks([
        [SKULL, 1, 3, 4],
        [SKULL, 0, 9, 9], // a second skull: duplicates drop
        [8, 0, 1, 1], // symbol out of range
        [1.5, 0, 1, 1],
        [STAR, 9, 1, 1], // page out of range
        [STAR, 0, '1', 1],
        [STAR, 0, 1],
        { symbol: STAR },
        [STAR, 0, -2.5, 6],
      ]),
    ).toEqual([
      { symbol: SKULL, page: 1, x: 3, z: 4 },
      { symbol: STAR, page: 0, x: -2.5, z: 6 },
    ]);
  });

  it('ClientWorld mirrors mmarks, keeps it when absent, and sends the two commands', () => {
    const client = bareClient(1);
    const sent: unknown[] = [];
    (client as unknown as { cmd(c: unknown): void }).cmd = (c) => sent.push(c);
    const apply = (self: Record<string, unknown>) =>
      (client as unknown as { applySnapshot(v: unknown): void }).applySnapshot({
        t: 'snap',
        tick: 1,
        ents: [],
        self: {
          id: 1,
          k: 'player',
          tid: 'warrior',
          nm: 'A',
          lv: 20,
          x: 0,
          y: 0,
          z: 0,
          f: 0,
          hp: 1,
          mhp: 1,
          ...self,
        },
      });
    apply({ mmarks: [[SKULL, 0, 5, 6]] });
    expect(client.sharedMapMarks()).toEqual([{ symbol: SKULL, page: 0, x: 5, z: 6 }]);
    apply({});
    expect(client.sharedMapMarks()).toHaveLength(1);
    apply({ mmarks: null });
    expect(client.sharedMapMarks()).toEqual([]);
    client.placeSharedMapMark(1, 2, 3, STAR);
    client.clearSharedMapMarks(null);
    client.clearSharedMapMarks(SKULL);
    expect(sent).toEqual([
      { cmd: 'map_mark_set', page: 1, x: 2, z: 3, symbol: STAR },
      { cmd: 'map_mark_clear', symbol: null },
      { cmd: 'map_mark_clear', symbol: SKULL },
    ]);
  });
});
