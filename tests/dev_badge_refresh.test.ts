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
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { GameServer } from '../server/game';
import { resetContributorsCache } from '../server/github_contributors';
import { setActiveTitle } from '../src/sim/deeds';

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

  // The rung titles are NOT deeds (src/sim/dev_badge_titles.ts): wearability is
  // the live resolved tier, checked by the one title validator and re-checked on
  // every refresh.
  async function joinWith(login: string | null, mergedPrs: number) {
    dbMock.query.mockImplementation(githubLinksRouter(login));
    mockMergedPrsFetch(login ?? 'nobody', mergedPrs);
    const server = new GameServer();
    const fc = fakeWs();
    const session = server.join(fc.ws, 1, 1, 'Devvy', 'warrior', null);
    if ('error' in session) throw new Error(session.error);
    session.blockListLoaded = true;
    const meta = server.sim.meta(session.pid)!;
    const e = server.sim.entities.get(session.pid)!;
    return { server, session, meta, e, fc };
  }

  it('the title validator offers every rung up to the resolved tier and refuses above it', async () => {
    const { server, session, meta, e } = await joinWith('jgyy', 15); // Runesmith (rung 3)
    // Before the tier resolves, no rung title can be picked.
    setActiveTitle(meta, e, 'dev:tinkerer');
    expect(e.title ?? null).toBe(null);

    await (server as any).refreshDevBadge(session);

    setActiveTitle(meta, e, 'dev:artificer');
    expect(e.title).toBe('dev:artificer');
    expect(meta.activeTitle).toBe('dev:artificer');
    setActiveTitle(meta, e, 'dev:runesmith');
    expect(e.title).toBe('dev:runesmith');
    setActiveTitle(meta, e, 'dev:architect'); // above the tier: silent no-op
    expect(e.title).toBe('dev:runesmith');
    setActiveTitle(meta, e, 'dev:not_a_rung');
    expect(e.title).toBe('dev:runesmith');
    // Nothing touched the Book of Deeds.
    expect([...meta.deedsEarned.keys()].some((id) => id.includes('dev'))).toBe(false);
  });

  it('keeps a restored rung title the resolved tier still reaches', async () => {
    const { server, session, meta, e } = await joinWith('jgyy', 15);
    // The join restore takes the persisted id as saved (the tier is unknown yet).
    setActiveTitle(meta, e, 'dev:artificer', { restore: true });
    expect(e.title).toBe('dev:artificer');

    await (server as any).refreshDevBadge(session);

    expect(e.title).toBe('dev:artificer');
    expect(meta.activeTitle).toBe('dev:artificer');
  });

  it('clears a restored rung title above the resolved tier', async () => {
    const { server, session, meta, e } = await joinWith('jgyy', 15);
    setActiveTitle(meta, e, 'dev:worldwright', { restore: true });

    await (server as any).refreshDevBadge(session);

    expect(e.title ?? null).toBe(null);
    expect(meta.activeTitle).toBe(null);
  });

  it('clears a worn rung title once the GitHub link is gone, and leaves a deed title alone', async () => {
    const { server, session, meta, e } = await joinWith(null, 0);
    setActiveTitle(meta, e, 'dev:tinkerer', { restore: true });
    await (server as any).refreshDevBadge(session);
    expect(meta.activeTitle).toBe(null);
    expect(e.title ?? null).toBe(null);

    // A deed title is never the badge refresh's business.
    meta.activeTitle = 'prog_veteran';
    e.title = 'prog_veteran';
    await (server as any).refreshDevBadge(session);
    expect(meta.activeTitle).toBe('prog_veteran');
    expect(e.title).toBe('prog_veteran');
  });

  it('a cold GitHub outage (no snapshot loaded yet) never clears a worn rung title', async () => {
    const { server, session, meta, e } = await joinWith('jgyy', 15);
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      ok: false,
      status: 503,
      headers: { get: () => null },
      json: () => Promise.resolve({}),
    } as any);
    setActiveTitle(meta, e, 'dev:runesmith', { restore: true });

    await (server as any).refreshDevBadge(session);

    // The failure reads as 0 merged PRs (the badge hides, as before), but that
    // is "unknown", not "zero": the worn title survives for the next refresh.
    expect(e.devTier ?? 0).toBe(0);
    expect(meta.activeTitle).toBe('dev:runesmith');
    expect(e.title).toBe('dev:runesmith');

    // Once a real snapshot loads and still says the rung is out of reach, it clears.
    resetContributorsCache();
    vi.restoreAllMocks();
    mockMergedPrsFetch('jgyy', 5); // Artificer only
    await (server as any).refreshDevBadge(session);
    expect(meta.activeTitle).toBe(null);
  });

  it('a cleared rung title reaches the owner over the self wire', async () => {
    const { server, session, meta, e, fc } = await joinWith(null, 0);
    setActiveTitle(meta, e, 'dev:runesmith', { restore: true });
    (server as any).broadcastSnapshots();
    const before = fc.sent.filter((m) => m.t === 'snap').at(-1);
    expect(before.self.atitle).toBe('dev:runesmith');

    await (server as any).refreshDevBadge(session);
    (server as any).broadcastSnapshots();

    const after = fc.sent.filter((m) => m.t === 'snap').at(-1);
    expect(after.self.atitle).toBe(null);
  });
});
