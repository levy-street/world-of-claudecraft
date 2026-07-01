import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// GameServer.refreshDevBadge is the one entry point tests/dev_broadcast.test.ts
// never exercises (that file stamps devTier/devMergedPrs/githubLogin onto the
// entity directly to test the wire format, bypassing the DB lookup + cached
// merged-PR-stats resolution entirely). This file drives the REAL resolution
// path: a controllable pool.query router (so githubForAccount's SELECT can
// return a real github_links row) + a mocked global fetch (so
// mergedPrsForLogin's cached GitHub /pulls call resolves deterministically),
// proving refreshDevBadge genuinely turns a stored GitHub link into a
// broadcast tier rather than only proving the wire codec round-trips whatever
// is already on the entity.
const dbMock = vi.hoisted(() => {
  const query = vi.fn(async (_sql: string) => ({ rows: [] as any[] }));
  return { query };
});
vi.mock('../server/db', () => ({
  pool: { query: dbMock.query },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { GameServer } from '../server/game';
import { resetContributorsCache } from '../server/github_contributors';

interface FakeClient {
  sent: any[];
  ws: any;
}

function fakeWs(): FakeClient {
  const sent: any[] = [];
  return { sent, ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) } };
}

function githubLinksRouter(login: string | null) {
  return vi.fn(async (sql: string) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (s.includes('FROM github_links WHERE account_id')) {
      return login
        ? {
            rows: [
              { account_id: 1, github_user_id: '16779411', github_login: login, linked_at: 'now' },
            ],
          }
        : { rows: [] };
    }
    return { rows: [] };
  });
}

// Mocks the GitHub /pulls?state=closed endpoint mergedPrsForLogin resolves
// through: one merged-PR object per count, authored by `login`.
function mockMergedPrsFetch(login: string, mergedPrCount: number) {
  return vi.spyOn(globalThis, 'fetch' as any).mockImplementation((url: any) => {
    const u = String(url);
    if (u.includes('/pulls')) {
      const prs = Array.from({ length: mergedPrCount }, () => ({
        number: 1,
        user: { login, type: 'User' },
        merged_at: '2024-01-01T00:00:00Z',
      }));
      return Promise.resolve({
        ok: true,
        headers: { get: () => null },
        json: () => Promise.resolve(prs),
      } as any);
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as any);
  });
}

describe('GameServer.refreshDevBadge (real DB + contributor-cache resolution)', () => {
  beforeEach(() => {
    resetContributorsCache();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves a linked, contributing account to its earned tier and stamps the entity', async () => {
    dbMock.query.mockImplementation(githubLinksRouter('FernandoX7'));
    mockMergedPrsFetch('FernandoX7', 70);
    const server = new GameServer();
    const fc = fakeWs();
    const session = server.join(fc.ws, 1, 1, 'Devvy', 'warrior', null);
    if ('error' in session) throw new Error(session.error);
    session.blockListLoaded = true;

    await (server as any).refreshDevBadge(session);

    const e = server.sim.entities.get(session.pid)!;
    expect(e.devTier).toBe(5); // 70 merged PRs -> Worldwright
    expect(e.devMergedPrs).toBe(70);
    expect(e.githubLogin).toBe('FernandoX7');
  });

  it('resolves a linked but non-contributing account to no badge (tier 0, fields cleared)', async () => {
    dbMock.query.mockImplementation(githubLinksRouter('newdev'));
    mockMergedPrsFetch('someoneelse', 5); // 'newdev' is not in the merged-PR list
    const server = new GameServer();
    const fc = fakeWs();
    const session = server.join(fc.ws, 1, 1, 'Devvy', 'warrior', null);
    if ('error' in session) throw new Error(session.error);
    session.blockListLoaded = true;

    await (server as any).refreshDevBadge(session);

    const e = server.sim.entities.get(session.pid)!;
    expect(e.devTier ?? 0).toBe(0);
    expect(e.devMergedPrs).toBeUndefined();
    expect(e.githubLogin).toBeUndefined();
  });

  it('resolves an account with no GitHub link to no badge at all', async () => {
    dbMock.query.mockImplementation(githubLinksRouter(null));
    const fetchSpy = mockMergedPrsFetch('irrelevant', 999);
    const server = new GameServer();
    const fc = fakeWs();
    const session = server.join(fc.ws, 1, 1, 'Devvy', 'warrior', null);
    if ('error' in session) throw new Error(session.error);
    session.blockListLoaded = true;

    await (server as any).refreshDevBadge(session);

    const e = server.sim.entities.get(session.pid)!;
    expect(e.devTier ?? 0).toBe(0);
    expect(e.devMergedPrs).toBeUndefined();
    expect(e.githubLogin).toBeUndefined();
    // No linked login means mergedPrsForLogin is never even called.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('broadcasts the resolved tier over the wire (end to end: DB row -> entity -> snapshot)', async () => {
    dbMock.query.mockImplementation(githubLinksRouter('jgyy'));
    mockMergedPrsFetch('jgyy', 15); // 15 merged PRs -> Runesmith (rung 3)
    const server = new GameServer();
    const fc = fakeWs();
    const session = server.join(fc.ws, 1, 1, 'Devvy', 'warrior', null);
    if ('error' in session) throw new Error(session.error);
    session.blockListLoaded = true;

    await (server as any).refreshDevBadge(session);
    (server as any).broadcastSnapshots();

    const sent = fc.sent.filter((m) => m.t === 'snap').at(-1);
    expect(sent).toBeDefined();
    expect(sent.self.dvt).toBe(3);
    expect(sent.self.dvc).toBe(15);
    expect(sent.self.dgl).toBe('jgyy');
  });
});
