// The guildStampSeq fence (server/game.ts): sendSocialSnapshot's async DB read
// must never re-apply a STALE guild membership over a fresher SYNCHRONOUS stamp
// from a committed mutation (onGuildMembershipChanged). A stale officer stamp
// is privilege-escalation-shaped: the guild bank's officer-plus gate reads it
// (src/sim/guild_bank.ts requireOfficerBook), so a demote must win against any
// in-flight snapshot whose read started before the commit. This suite drives
// the REAL GameServer + Sim with a controllable deferred social.snapshot.
import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed (the holder_broadcast idiom).
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

import { type ClientSession, GameServer } from '../server/game';
import type { SocialSnapshot } from '../server/social';

function fakeWs(): { sent: unknown[]; ws: unknown } {
  const sent: unknown[] = [];
  return {
    sent,
    ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) },
  };
}

function joinServer(server: GameServer, characterId: number, name: string): ClientSession {
  const fc = fakeWs();
  const session = server.join(fc.ws as never, characterId, characterId, name, 'warrior', null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

const guildSnap = (rank: 'leader' | 'officer' | 'member'): SocialSnapshot => ({
  friends: [],
  blocks: [],
  ignores: [],
  guild: {
    id: 7,
    name: 'Iron Vanguard',
    rank,
    motd: '',
    motdSetBy: '',
    members: [],
    events: [],
  },
});

// Reach the private seams the fence spans: the async chokepoint and the
// transport's combined stamp entry point.
// biome-ignore lint/suspicious/noExplicitAny: the fence spans two private seams
const priv = (server: GameServer): any => server as any;

describe('the guild membership stamp fence (guildStampSeq)', () => {
  it('a mid-flight demote wins: the stale officer snapshot must not re-stamp', async () => {
    const server = new GameServer();
    const session = joinServer(server, 1, 'Offi');
    const sim = server.sim;
    // Seed the pre-demote state: the player is a stamped officer.
    priv(server).social.tx.onGuildMembershipChanged(1, {
      guildId: 7,
      guildName: 'Iron Vanguard',
      rank: 'officer',
    });
    expect(sim.players.get(session.pid)?.guildMembership).toEqual({ guildId: 7, rank: 'officer' });

    // An in-flight snapshot whose DB read STARTED before the demote resolves
    // with the stale officer rank.
    let resolveSnap: ((snap: SocialSnapshot) => void) | undefined;
    priv(server).social.snapshot = () =>
      new Promise<SocialSnapshot>((res) => {
        resolveSnap = res;
      });
    const inflight = priv(server).sendSocialSnapshot(1);

    // The demote COMMITS mid-flight: the synchronous combined stamp fires.
    priv(server).social.tx.onGuildMembershipChanged(1, {
      guildId: 7,
      guildName: 'Iron Vanguard',
      rank: 'member',
    });
    expect(sim.players.get(session.pid)?.guildMembership).toEqual({ guildId: 7, rank: 'member' });

    // The stale read resolves AFTER the commit: the fence must discard it.
    resolveSnap?.(guildSnap('officer'));
    await inflight;
    expect(sim.players.get(session.pid)?.guildMembership).toEqual({ guildId: 7, rank: 'member' });
    // And so the guild bank officer gate stays closed.
    expect(sim.guildBankInfoFor(session.pid)).toBeNull();
  });

  it('a mid-flight kick wins: the stale guilded snapshot must not restore the stamp', async () => {
    const server = new GameServer();
    const session = joinServer(server, 2, 'Kicked');
    const sim = server.sim;
    priv(server).social.tx.onGuildMembershipChanged(2, {
      guildId: 7,
      guildName: 'Iron Vanguard',
      rank: 'officer',
    });
    let resolveSnap: ((snap: SocialSnapshot) => void) | undefined;
    priv(server).social.snapshot = () =>
      new Promise<SocialSnapshot>((res) => {
        resolveSnap = res;
      });
    const inflight = priv(server).sendSocialSnapshot(2);
    priv(server).social.tx.onGuildMembershipChanged(2, null); // the kick commits
    expect(sim.players.get(session.pid)?.guildMembership).toBeNull();
    resolveSnap?.(guildSnap('officer'));
    await inflight;
    expect(sim.players.get(session.pid)?.guildMembership).toBeNull();
    expect(sim.entities.get(session.pid)?.guild).toBe(''); // the name stamp cleared with it
  });

  it('with no mid-flight stamp the chokepoint stamps the PAIR (the join path)', async () => {
    const server = new GameServer();
    const session = joinServer(server, 3, 'Joiner');
    const sim = server.sim;
    priv(server).social.snapshot = async () => guildSnap('officer');
    await priv(server).sendSocialSnapshot(3);
    expect(sim.players.get(session.pid)?.guildMembership).toEqual({ guildId: 7, rank: 'officer' });
    expect(sim.entities.get(session.pid)?.guild).toBe('Iron Vanguard');
    // And back to guildless when a later push reads no guild.
    priv(server).social.snapshot = async (): Promise<SocialSnapshot> => ({
      friends: [],
      blocks: [],
      ignores: [],
      guild: null,
    });
    await priv(server).sendSocialSnapshot(3);
    expect(sim.players.get(session.pid)?.guildMembership).toBeNull();
    expect(sim.entities.get(session.pid)?.guild).toBe('');
  });
});
