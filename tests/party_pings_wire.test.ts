// Party pings over the wire: the `ping` command (server/marker_commands.ts
// shape checks, the Sim owns the rules), the `pings` self-delta row
// (server/self_social_wire.ts, [id, kind, from, fromName, target, x, y, z,
// targetKind, targetTemplate, targetName] rows or null) delivered to every
// group member and to nobody else, and the client decode + ClientWorld mirror
// (src/net/party_pings_wire.ts). The wire strings are pinned as literals: the
// wire string IS the protocol.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
import { decodePartyPings, PartyPingReplayGuard } from '../src/net/party_pings_wire';
import { PING_ATTACK, PING_LOOK, PING_WARNING } from '../src/sim/social/party_pings';
import { bareClient, broadcast, fakeWs, joinServer, lastSnap } from './helpers/bare_client';

function cmd(server: GameServer, session: unknown, payload: object): void {
  server.handleMessage(session as never, JSON.stringify({ t: 'cmd', ...payload }));
}

/** Two players in one party and an outsider, all standing together. */
function group() {
  const server = new GameServer();
  const fa = fakeWs();
  const sa = joinServer(server, fa, 1, 'Aleph');
  const fb = fakeWs();
  const sb = joinServer(server, fb, 2, 'Bet');
  const fc = fakeWs();
  const sc = joinServer(server, fc, 3, 'Gimel');
  cmd(server, sa, { cmd: 'pinvite', id: sb.pid });
  cmd(server, sb, { cmd: 'paccept' });
  const at = server.sim.entities.get(sa.pid)?.pos;
  if (!at) throw new Error('no player');
  for (const s of [sb, sc]) {
    const e = server.sim.entities.get(s.pid);
    if (e) e.pos = { x: at.x + 2, y: at.y, z: at.z };
  }
  return { server, sa, sb, sc, fa, fb, fc, at };
}

describe('party pings: server wire', () => {
  it('a ping reaches every party member, and nobody else', () => {
    const { server, sa, fa, fb, fc, at } = group();
    cmd(server, sa, {
      cmd: 'ping',
      kind: PING_WARNING,
      target: null,
      x: at.x + 4,
      y: at.y,
      z: at.z,
    });
    broadcast(server);
    const rows = lastSnap(fa.sent).self.pings as unknown[][];
    expect(rows).toHaveLength(1);
    expect(rows[0].slice(0, 5)).toEqual([1, PING_WARNING, sa.pid, 'Aleph', 0]);
    expect(rows[0].slice(8)).toEqual(['', '', '']);
    expect(lastSnap(fb.sent).self.pings).toEqual(rows);
    expect(lastSnap(fc.sent).self.pings).toBeNull();
  });

  it('a unit ping names the unit on the wire', () => {
    const { server, sa, sb, fb } = group();
    cmd(server, sa, { cmd: 'ping', kind: PING_ATTACK, target: sb.pid, x: 0, y: 0, z: 0 });
    broadcast(server);
    const [row] = lastSnap(fb.sent).self.pings as unknown[][];
    expect(row[4]).toBe(sb.pid);
    expect(row.slice(8, 11)).toEqual(['player', expect.any(String), 'Bet']);
  });

  it('rides as a delta: unchanged pings are not resent', () => {
    const { server, sa, fb, at } = group();
    cmd(server, sa, { cmd: 'ping', kind: PING_LOOK, target: null, x: at.x, y: at.y, z: at.z });
    broadcast(server);
    expect(lastSnap(fb.sent).self.pings).toHaveLength(1);
    broadcast(server);
    expect(lastSnap(fb.sent).self).not.toHaveProperty('pings');
  });

  it('drops a malformed command before the sim sees it', () => {
    const { server, sa, fa, at } = group();
    const bad = [
      { kind: '1', target: null, x: at.x, y: at.y, z: at.z },
      { kind: 1.5, target: null, x: at.x, y: at.y, z: at.z },
      { kind: 0, target: 'me', x: at.x, y: at.y, z: at.z },
      { kind: 0, target: null, x: 'a', y: at.y, z: at.z },
      { kind: 0, target: null, x: at.x, z: at.z },
    ];
    for (const b of bad) cmd(server, sa, { cmd: 'ping', ...b });
    broadcast(server);
    expect(lastSnap(fa.sent).self.pings).toBeNull();
  });
});

describe('party pings: client decode', () => {
  const ok = [7, PING_ATTACK, 3, 'Aleph', 44, 1.5, 2, -3, 'mob', 'wolf', 'Gray Wolf'];

  it('decodes a unit row and a ground row', () => {
    const pings = decodePartyPings([ok, [8, PING_LOOK, 3, 'Aleph', 0, 4, 5, 6, '', '', '']]);
    expect(pings[0]).toEqual({
      id: 7,
      kind: PING_ATTACK,
      from: 3,
      fromName: 'Aleph',
      target: 44,
      targetKind: 'mob',
      targetTemplate: 'wolf',
      targetName: 'Gray Wolf',
      x: 1.5,
      y: 2,
      z: -3,
    });
    expect(pings[1]).toMatchObject({ target: null, targetKind: null, targetName: '' });
  });

  it('drops every malformed row', () => {
    const bad = [
      ok.slice(0, 10),
      [0, ...ok.slice(1)],
      [7, 9, ...ok.slice(2)],
      [7, 1, 3, 4, ...ok.slice(4)],
      [...ok.slice(0, 5), Number.NaN, ...ok.slice(6)],
      [...ok.slice(0, 8), 'dragon', ...ok.slice(9)],
      [...ok.slice(0, 4), -2, ...ok.slice(5)],
      'row',
    ];
    expect(decodePartyPings(bad)).toEqual([]);
    expect(decodePartyPings(null)).toEqual([]);
    expect(decodePartyPings([ok, ok])).toHaveLength(1);
  });

  it('the ClientWorld mirrors the row and sends the command', () => {
    const c = bareClient(1);
    const sent: unknown[] = [];
    (c as unknown as { cmd(m: unknown): void }).cmd = (m) => sent.push(m);
    c.partyPingList = decodePartyPings([ok]);
    expect(c.partyPings()).toHaveLength(1);
    c.sendPing(PING_WARNING, null, 1, 2, 3);
    expect(sent).toEqual([{ cmd: 'ping', kind: PING_WARNING, target: null, x: 1, y: 2, z: 3 }]);
  });
});

describe('party pings: no replay after a (re)connect', () => {
  const row = (id: number) => [id, PING_LOOK, 3, 'Jose', 0, 1, 2, 3, '', '', ''];

  it("flags a session's first row known; later pings stay new", () => {
    const g = new PartyPingReplayGuard();
    const first = g.mark(decodePartyPings([row(4), row(5)]));
    expect(first.map((p) => p.known)).toEqual([true, true]);
    const next = g.mark(decodePartyPings([row(5), row(6)]));
    expect(next.map((p) => [p.id, p.known === true])).toEqual([
      [5, true],
      [6, false],
    ]);
    // A reconnect: the new session's first row is the baseline again.
    g.newSession();
    const back = g.mark(decodePartyPings([row(6), row(7)]));
    expect(back.every((p) => p.known === true)).toBe(true);
    // An empty first row flags nothing, so the next ping is announced.
    g.newSession();
    g.mark(decodePartyPings(null));
    expect(g.mark(decodePartyPings([row(8)]))[0].known).toBeUndefined();
  });

  it('the ClientWorld guards its mirror and starts a baseline per socket', () => {
    const src = readFileSync(join(process.cwd(), 'src/net/online.ts'), 'utf8');
    expect(src).toContain('this.partyPingList = this.pingReplay.mark(decodePartyPings(s.pings));');
    expect(src).toMatch(/this\.ws = new WebSocket\(wsUrl\);\s+this\.pingReplay\.newSession\(\);/);
  });
});
