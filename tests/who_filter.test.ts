import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed (mirrors snapshots.test.ts).
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { type ClientSession, GameServer } from '../server/game';
import type { PlayerClass } from '../src/sim/types';

interface FakeClient {
  sent: any[];
  session: ClientSession;
}

// sendWhoRoster is the substantive logic (roster + filter + header). We exercise
// it directly: the chat rate-limit/mute gate in handleMessage would otherwise
// swallow a bare unit-test message, and the /who dispatch is a one-line parse
// that forwards the sanitized filter here.
function makeServer(players: [number, string, PlayerClass][]): { server: any; viewer: FakeClient } {
  const server: any = new GameServer();
  let viewer: FakeClient | null = null;
  for (const [id, name, cls] of players) {
    const sent: any[] = [];
    const ws = { readyState: 1, send: (p: string) => sent.push(JSON.parse(p)) };
    const session = server.join(ws, id, id, name, cls, null);
    if ('error' in session) throw new Error(session.error);
    session.blockListLoaded = true;
    if (!viewer) viewer = { sent, session };
  }
  return { server, viewer: viewer! };
}

function who(server: any, viewer: FakeClient, filter?: string): string[] {
  viewer.sent.length = 0;
  server.sendWhoRoster(viewer.session, filter);
  return viewer.sent
    .flatMap((msg) => (msg.t === 'events' ? msg.list : []))
    .filter((ev: any) => ev.type === 'log' || ev.type === 'error')
    .map((ev: any) => ev.text);
}

const ROSTER: [number, string, PlayerClass][] = [
  [1, 'Mristan', 'warrior'],
  [2, 'Mrglglgl', 'shaman'],
  [3, 'Bobbins', 'mage'],
];

describe('/who name filter', () => {
  it('unfiltered lists everyone online', () => {
    const { server, viewer } = makeServer(ROSTER);
    const out = who(server, viewer);
    expect(out[0]).toMatch(/^Who: 3 players online on /);
    expect(out.some((t) => t.startsWith('Mristan'))).toBe(true);
    expect(out.some((t) => t.startsWith('Bobbins'))).toBe(true);
  });

  it('filters to names containing the query (case-insensitive)', () => {
    const { server, viewer } = makeServer(ROSTER);
    const out = who(server, viewer, 'mr');
    expect(out[0]).toBe('Who: 2 players matching "mr" on Claudemoon.');
    expect(out.some((t) => t.startsWith('Mristan'))).toBe(true);
    expect(out.some((t) => t.startsWith('Mrglglgl'))).toBe(true);
    expect(out.some((t) => t.startsWith('Bobbins'))).toBe(false);
  });

  it('matches a substring anywhere in the name and singularizes one result', () => {
    const { server, viewer } = makeServer(ROSTER);
    const out = who(server, viewer, 'bin');
    expect(out[0]).toBe('Who: 1 player matching "bin" on Claudemoon.');
    expect(out.some((t) => t.startsWith('Bobbins'))).toBe(true);
    expect(out.some((t) => t.startsWith('Mr'))).toBe(false);
  });

  it('reports zero matches for an unknown filter', () => {
    const { server, viewer } = makeServer(ROSTER);
    const out = who(server, viewer, 'zzz');
    expect(out).toEqual(['Who: 0 players matching "zzz" on Claudemoon.']);
  });
});

describe('/who zone filter', () => {
  // Freshly joined players all spawn in the overworld zone "Eastbrook Vale", so
  // a substring of that zone matches everyone, and a different zone matches no one.
  it('matches on zone name, not just player name', () => {
    const { server, viewer } = makeServer(ROSTER);
    const out = who(server, viewer, 'eastbrook');
    expect(out[0]).toBe('Who: 3 players matching "eastbrook" on Claudemoon.');
    expect(out.some((t) => t.startsWith('Mristan'))).toBe(true);
    expect(out.some((t) => t.startsWith('Mrglglgl'))).toBe(true);
    expect(out.some((t) => t.startsWith('Bobbins'))).toBe(true);
  });

  it('matches a multi-word zone substring (spaces preserved)', () => {
    const { server, viewer } = makeServer(ROSTER);
    const out = who(server, viewer, 'eastbrook vale');
    expect(out[0]).toBe('Who: 3 players matching "eastbrook vale" on Claudemoon.');
    expect(out.filter((t) => t.includes(' - level ')).length).toBe(3);
  });

  it('returns zero for a zone nobody is in', () => {
    const { server, viewer } = makeServer(ROSTER);
    const out = who(server, viewer, 'thornpeak heights');
    expect(out).toEqual(['Who: 0 players matching "thornpeak heights" on Claudemoon.']);
  });
});
