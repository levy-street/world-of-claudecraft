// The raid map's shared marks over the wire: the `map_mark_set` /
// `map_mark_clear` commands (server/marker_commands.ts shape checks, the Sim
// owns the rules), the `mmarks` self-delta row (server/self_social_wire.ts,
// [symbol, page, x, z, wx, y, wz] rows or null) delivered to every group member in the
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
import type { SharedMapMarks } from '../src/sim/social/shared_map_marks';
import { bareClient, broadcast, fakeWs, joinServer, lastSnap } from './helpers/bare_client';

const SKULL = 7;
const STAR = 0;

/** The map half of each mmarks row ([symbol, page, x, z]). */
function mapRows(rows: unknown): unknown {
  return Array.isArray(rows) ? rows.map((r) => (r as unknown[]).slice(0, 4)) : rows;
}

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
    expect(mapRows(lastSnap(fa.sent).self.mmarks)).toEqual([[SKULL, 1, 12.3, -8]]);
    expect(lastSnap(fb.sent).self.mmarks).toEqual(lastSnap(fa.sent).self.mmarks);
    // The world half: the instance origin plus the map point, at the sim's floor height.
    const [row] = lastSnap(fa.sent).self.mmarks as number[][];
    const store = (server.sim as unknown as { targeting: { mapMarks: SharedMapMarks } }).targeting
      .mapMarks;
    const marked = store.viewFor(sa.pid);
    expect(row.slice(4)).toEqual([marked[0].wx, marked[0].y, marked[0].wz]);
    expect(row[4] - row[2]).toBe(Math.round(row[4] - row[2]));
    expect(lastSnap(fc.sent).self.mmarks).toBeNull();
  });

  it('rides as a delta: unchanged marks are not resent, a clear is', () => {
    const { server, sa, sb, fb } = raidNight();
    cmd(server, sa, { cmd: 'map_mark_set', page: 0, x: 1, z: 2, symbol: STAR });
    broadcast(server);
    expect(mapRows(lastSnap(fb.sent).self.mmarks)).toEqual([[STAR, 0, 1, 2]]);
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
    expect(mapRows(lastSnap(fa.sent).self.mmarks)).toEqual([[STAR, 0, 1, 2]]);
  });

  it('map_mark_place puts a mark where the ground was clicked, for the whole group', () => {
    const { server, sa, sb, fa, fb, fc } = raidNight();
    const p = server.sim.entities.get(sa.pid)?.pos;
    if (!p) throw new Error('no body');
    cmd(server, sb, {
      cmd: 'map_mark_place',
      page: 0,
      x: p.x + 4,
      y: p.y,
      z: p.z - 2,
      symbol: SKULL,
    });
    broadcast(server);
    const rows = lastSnap(fa.sent).self.mmarks as number[][];
    expect(rows).toHaveLength(1);
    const [symbol, page, , , wx, y, wz] = rows[0];
    expect([symbol, page]).toEqual([SKULL, 0]);
    expect(wx).toBeCloseTo(p.x + 4, 0);
    expect(wz).toBeCloseTo(p.z - 2, 0);
    expect(Number.isFinite(y)).toBe(true);
    expect(lastSnap(fb.sent).self.mmarks).toEqual(rows);
    expect(lastSnap(fc.sent).self.mmarks).toBeNull();
  });

  it('drops malformed map_mark_place frames before the sim', () => {
    const { server, sa, fa } = raidNight();
    const p = server.sim.entities.get(sa.pid)?.pos ?? { x: 0, y: 0, z: 0 };
    const ok = { cmd: 'map_mark_place', page: 0, x: p.x, y: p.y, z: p.z, symbol: STAR };
    for (const frame of [
      { ...ok, y: undefined },
      { ...ok, y: 'up' },
      { ...ok, x: Number.NaN },
      { ...ok, page: 0.5 },
      { ...ok, symbol: 9 },
      { ...ok, x: p.x + 1e6 },
    ])
      cmd(server, sa, frame);
    broadcast(server);
    expect(lastSnap(fa.sent).self.mmarks).toBeNull();
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
        [SKULL, 1, 3, 4, 103, 5.5, 504],
        [SKULL, 0, 9, 9, 109, 5, 509], // a second skull: duplicates drop
        [8, 0, 1, 1, 101, 5, 501], // symbol out of range
        [1.5, 0, 1, 1, 101, 5, 501],
        [STAR, 9, 1, 1, 101, 5, 501], // page out of range
        [STAR, 0, '1', 1, 101, 5, 501],
        [STAR, 0, 1, 1, 101, Number.NaN, 501], // a non-finite world point
        [STAR, 0, 1, 1, 101, 5], // a short row
        [STAR, 0, 1, 1], // the old map-only row
        { symbol: STAR },
        [STAR, 0, -2.5, 6, 97.5, 4.25, 506],
      ]),
    ).toEqual([
      { symbol: SKULL, page: 1, x: 3, z: 4, wx: 103, y: 5.5, wz: 504 },
      { symbol: STAR, page: 0, x: -2.5, z: 6, wx: 97.5, y: 4.25, wz: 506 },
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
    apply({ mmarks: [[SKULL, 0, 5, 6, 205, 1.5, 706]] });
    expect(client.sharedMapMarks()).toEqual([
      { symbol: SKULL, page: 0, x: 5, z: 6, wx: 205, y: 1.5, wz: 706 },
    ]);
    apply({});
    expect(client.sharedMapMarks()).toHaveLength(1);
    apply({ mmarks: null });
    expect(client.sharedMapMarks()).toEqual([]);
    client.placeSharedMapMark(1, 2, 3, STAR);
    client.placeSharedWorldMark(0, 210.5, 2.25, 700, SKULL);
    client.clearSharedMapMarks(null);
    client.clearSharedMapMarks(SKULL);
    expect(sent).toEqual([
      { cmd: 'map_mark_set', page: 1, x: 2, z: 3, symbol: STAR },
      { cmd: 'map_mark_place', page: 0, x: 210.5, y: 2.25, z: 700, symbol: SKULL },
      { cmd: 'map_mark_clear', symbol: null },
      { cmd: 'map_mark_clear', symbol: SKULL },
    ]);
  });
});
