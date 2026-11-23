// Presence privacy (server/presence_privacy.ts): /presence everyone | friends |
// none decides who sees a character ONLINE through the social graph. Pinned
// here: the pure rule, the command parse and run, and every point it gates
// (canShowInWho for /who and the live position push, the roster rows, the login
// notices, and the watcher refresh after a change).
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

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

import { type ClientSession, GameServer } from '../server/game';
import {
  handlePresenceChatCommand,
  PRESENCE_NOTICES,
  PRESENCE_REFRESH_WINDOW_MS,
  type PresenceCommandHost,
  type PresenceSession,
  type PresenceSubject,
  parsePresenceCommand,
  presenceHiddenFrom,
  presenceHostFrom,
  runPresenceCommand,
} from '../server/presence_privacy';
import { type SocialDb, SocialService, type SocialTransport } from '../server/social';
import { canShowInWho } from '../server/who_roster';
import { defaultGuildRankLadder } from '../src/sim/guild_ranks';

const VIEWER = 2;

describe('presenceHiddenFrom: the pure rule', () => {
  it('everyone shows, none hides, friends shows only to the subject’s own friends', () => {
    const friends = new Set([VIEWER]);
    expect(presenceHiddenFrom({ characterId: 1 }, VIEWER), 'absent reads everyone').toBe(false);
    expect(presenceHiddenFrom({ characterId: 1, presenceMode: 'everyone' }, VIEWER)).toBe(false);
    expect(presenceHiddenFrom({ characterId: 1, presenceMode: 'none' }, VIEWER)).toBe(true);
    expect(
      presenceHiddenFrom({ characterId: 1, presenceMode: 'friends', friendIds: friends }, VIEWER),
    ).toBe(false);
    expect(
      presenceHiddenFrom({ characterId: 1, presenceMode: 'friends', friendIds: new Set() }, VIEWER),
    ).toBe(true);
    expect(
      presenceHiddenFrom({ characterId: 1, presenceMode: 'friends' }, VIEWER),
      'a friends list not loaded yet hides (fail closed)',
    ).toBe(true);
    expect(presenceHiddenFrom({ characterId: 1, presenceMode: 'none' }, 1), 'never from self').toBe(
      false,
    );
  });
});

describe('parsePresenceCommand', () => {
  it('reads the three settings and their aliases, the status form and a usage error', () => {
    expect(parsePresenceCommand('/presence')).toEqual({ kind: 'status' });
    expect(parsePresenceCommand('/presence everyone')).toEqual({ kind: 'set', mode: 'everyone' });
    expect(parsePresenceCommand('/presence ALL')).toEqual({ kind: 'set', mode: 'everyone' });
    expect(parsePresenceCommand('/presence friends')).toEqual({ kind: 'set', mode: 'friends' });
    expect(parsePresenceCommand('/presence none')).toEqual({ kind: 'set', mode: 'none' });
    expect(parsePresenceCommand('/presence off')).toEqual({ kind: 'set', mode: 'none' });
    expect(parsePresenceCommand('/presence maybe')).toEqual({ kind: 'usage' });
    expect(parsePresenceCommand('/presences')).toBeNull();
    expect(parsePresenceCommand('hello')).toBeNull();
  });
});

describe('runPresenceCommand', () => {
  function host() {
    const query = vi.fn(async () => ({ rows: [] }));
    const notices: string[] = [];
    const refresh = vi.fn(async () => {});
    const h: PresenceCommandHost<PresenceSession> = {
      pool: { query } as never,
      consumeCommandLane: () => true,
      refreshPresenceWatchers: refresh,
      resyncOwnPanel: vi.fn(),
      sendChatNotice: (_s, text) => notices.push(text),
    };
    return { h, query, notices, refresh };
  }

  it('writes a changed setting, refreshes the watchers and confirms it', async () => {
    const { h, query, notices, refresh } = host();
    const session: PresenceSession = {
      accountId: 7,
      characterId: 9,
      name: 'Hider',
      presenceMode: 'everyone',
    };
    await runPresenceCommand(h, session, { kind: 'set', mode: 'none' });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE characters SET presence_mode'),
      [9, 'none'],
    );
    expect(session.presenceMode).toBe('none');
    expect(refresh).toHaveBeenCalledOnce();
    expect(notices).toEqual([PRESENCE_NOTICES.none]);
  });

  it('a repeat of the current setting or a status read writes nothing', async () => {
    const { h, query, notices, refresh } = host();
    const session: PresenceSession = {
      accountId: 7,
      characterId: 9,
      name: 'Hider',
      presenceMode: 'friends',
    };
    await runPresenceCommand(h, session, { kind: 'set', mode: 'friends' });
    await runPresenceCommand(h, session, { kind: 'status' });
    expect(query).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(notices).toEqual([PRESENCE_NOTICES.friends, PRESENCE_NOTICES.friends]);
  });
});

describe('presenceHostFrom', () => {
  it('confirms through a quiet social log line, never the red error banner, and refreshes once', async () => {
    const noticeTo = vi.fn();
    const refreshPresenceWatchers = vi.fn(async () => {});
    const query = vi.fn(async () => ({ rows: [] }));
    const host = presenceHostFrom<PresenceSession>(
      { pool: { query } as never, consumeCommandLane: () => true },
      () => ({ noticeTo, refreshPresenceWatchers, resyncPanel: vi.fn() }),
    );
    const session: PresenceSession = {
      accountId: 7,
      characterId: 9,
      name: 'Hider',
      presenceMode: 'everyone',
    };
    await runPresenceCommand(host, session, { kind: 'set', mode: 'none' });
    expect(refreshPresenceWatchers).toHaveBeenCalledWith({ characterId: 9, name: 'Hider' });
    expect(noticeTo).toHaveBeenCalledWith(9, PRESENCE_NOTICES.none);
  });
});

describe('canShowInWho honours the candidate’s presence (/who and the position push)', () => {
  const viewer = { characterId: VIEWER, blockListLoaded: true, blockedIds: new Set<number>() };
  const base = { characterId: 1, blockListLoaded: true, blockedIds: new Set<number>() };
  it('hides a none candidate, and a friends candidate from anyone off their list', () => {
    expect(canShowInWho(viewer, base)).toBe(true);
    expect(canShowInWho(viewer, { ...base, presenceMode: 'none' })).toBe(false);
    expect(canShowInWho(viewer, { ...base, presenceMode: 'friends', friendIds: new Set() })).toBe(
      false,
    );
    expect(
      canShowInWho(viewer, { ...base, presenceMode: 'friends', friendIds: new Set([VIEWER]) }),
    ).toBe(true);
  });
});

describe('the live position push on the authoritative server', () => {
  function fakeWs() {
    const sent: { t: string; list?: { id: number }[] }[] = [];
    return { sent, ws: { readyState: 1, send: (raw: string) => sent.push(JSON.parse(raw)) } };
  }

  it('stops pushing a hidden friend’s position, and resumes once they show again', () => {
    const server = new GameServer();
    const wfc = fakeWs();
    const watcher = server.join(wfc.ws as never, 1, 1, 'Watcher', 'warrior', null) as ClientSession;
    const tfc = fakeWs();
    const tracked = server.join(tfc.ws as never, 2, 2, 'Tracked', 'warrior', null) as ClientSession;
    watcher.blockListLoaded = true;
    tracked.blockListLoaded = true;
    watcher.socialTrackedIds = [tracked.characterId];
    const push = (): boolean => {
      wfc.sent.length = 0;
      (server as unknown as { broadcastSocialPositions(): void }).broadcastSocialPositions();
      return wfc.sent.some((f) => f.t === 'socialpos');
    };
    expect(push(), 'visible by default').toBe(true);
    tracked.presenceMode = 'none';
    expect(push()).toBe(false);
    tracked.presenceMode = 'friends';
    tracked.friendAccountIds = new Set();
    expect(push(), 'not on the tracked player’s own friends list').toBe(false);
    tracked.friendAccountIds = new Set([watcher.accountId]);
    expect(push()).toBe(true);
  });
});

describe('the setting at join', () => {
  function fakeWs() {
    return { readyState: 1, send: () => {} };
  }

  it('applies the stored setting from the join metadata, and falls back on junk', () => {
    const server = new GameServer();
    const hidden = server.join(fakeWs() as never, 1, 1, 'Hider', 'warrior', null, false, {
      presenceMode: 'none',
    } as never) as ClientSession;
    expect(hidden.presenceMode).toBe('none');
    const junk = server.join(fakeWs() as never, 2, 2, 'Junk', 'warrior', null, false, {
      presenceMode: 'invisible',
    } as never) as ClientSession;
    expect(junk.presenceMode).toBe('everyone');
  });

  it('reads the column with the character row the join path selects', () => {
    const db = readFileSync(new URL('../server/db.ts', import.meta.url), 'utf8');
    expect(db).toMatch(
      /SELECT id, account_id, name,[^']*presence_mode FROM characters WHERE id = \$1/,
    );
    const auth = readFileSync(new URL('../server/ws_auth.ts', import.meta.url), 'utf8');
    expect(auth).toContain('presenceMode: character.presence_mode ?? null,');
  });
});

describe('the social service: roster rows, login notices and the refresh', () => {
  function service(hidden: boolean, opts: { leaveDuringReads?: boolean } = {}) {
    const delivered: number[] = [];
    const events: { type: string; text?: string }[] = [];
    const pushed: number[] = [];
    const subject: PresenceSubject = {
      characterId: 1,
      presenceMode: hidden ? 'none' : 'everyone',
      friendIds: new Set<number>(),
    };
    let live = true;
    let friends = [{ id: 2, name: 'Bet' }];
    const db = {
      whoFriended: async () => {
        if (opts.leaveDuringReads) live = false;
        return [2];
      },
      blockedIds: async () => [],
      listFriends: async () => friends,
      listBlocks: async () => [],
      listIgnores: async () => [],
      findCharacterByName: async () => ({ id: 2, name: 'Bet' }),
      removeFriend: async () => {
        friends = [];
      },
      addFriend: async () => {},
      guildMembership: async () => ({
        guildId: 5,
        guildName: 'G',
        rank: 'member',
        ranks: defaultGuildRankLadder(),
      }),
      guildMembers: async () => [
        {
          id: 1,
          name: 'Hider',
          cls: 'warrior',
          level: 20,
          rank: 'member',
          lastLogin: '2026-10-02T09:00:00Z',
        },
        {
          id: 3,
          name: 'Gimel',
          cls: 'mage',
          level: 20,
          rank: 'member',
          lastLogin: '2026-10-01T09:00:00Z',
        },
      ],
      guildEvents: async () => [],
      guildMotd: async () => ({ motd: '', motdSetBy: '' }),
      guildPledgeSettings: async () => null,
      guildPledges: async () => [],
      guildLifetimeXpTotal: async () => 0,
      pledgeOf: async () => null,
    } as unknown as SocialDb;
    const tx = {
      byCharacterId: (id: number) => ({ characterId: id, name: String(id) }),
      isOnline: (id: number) => (id === 1 ? live : id === 2 || id === 3),
      blockListLoaded: () => true,
      isBlocking: () => false,
      locationOf: () => ({ zone: 'Eastbrook Vale', status: 'online', x: 1, z: 2 }),
      deliver: (id: number, list: { type: string; text?: string }[]) => {
        delivered.push(id);
        events.push(...list);
      },
      pushSnapshot: (id: number) => pushed.push(id),
      presenceSubject: (id: number) => (id === 1 && live ? subject : null),
    } as unknown as SocialTransport;
    const svc = new SocialService(
      db,
      tx,
      () => 0,
      () => false,
      () => null,
    );
    return { svc, delivered, events, pushed, subject };
  }

  it('a hidden character reads offline with no zone or position', () => {
    const shown = (service(false).svc as never as { presence: Function }).presence(2, 1, new Set());
    expect(shown).toMatchObject({ online: true, zone: 'Eastbrook Vale', x: 1, z: 2 });
    const hidden = (service(true).svc as never as { presence: Function }).presence(2, 1, new Set());
    expect(hidden).toEqual({ online: false });
  });

  it('a hidden character’s login sends no “has come online” notice', async () => {
    const shown = service(false);
    await shown.svc.announcePresence({ characterId: 1, name: 'Hider' }, true);
    expect(shown.delivered).toContain(2);
    const hidden = service(true);
    await hidden.svc.announcePresence({ characterId: 1, name: 'Hider' }, true);
    expect(hidden.delivered).toEqual([]);
  });

  it('a hidden character logging out sends no “has gone offline”, even when the session leaves mid-read', async () => {
    // The logout race: the session leaves the live map while the announcement
    // reads the DB. The decision is taken before the first await.
    const hidden = service(true, { leaveDuringReads: true });
    await hidden.svc.announcePresence({ characterId: 1, name: 'Hider' }, false);
    expect(hidden.delivered).toEqual([]);
    const shown = service(false, { leaveDuringReads: true });
    await shown.svc.announcePresence({ characterId: 1, name: 'Hider' }, false);
    expect(shown.delivered, 'a visible player still says goodbye').toContain(2);
  });

  it('keeps deed and Reliquary celebrations from the audience a hider hides from', async () => {
    const hidden = service(true);
    await hidden.svc.broadcastDeedUnlock({ characterId: 1, name: 'Hider' }, 'pvp_duel_first_win');
    expect(hidden.delivered).toEqual([]);
    const shown = service(false);
    await shown.svc.broadcastDeedUnlock({ characterId: 1, name: 'Hider' }, 'pvp_duel_first_win');
    expect(shown.delivered.sort()).toEqual([2, 3]);
  });

  it('reads a hiding player offline on public surfaces (the guild board officers)', () => {
    const shown = service(false);
    expect(shown.svc.shownOnlinePublicly(1)).toBe(true);
    const hidden = service(true);
    expect(hidden.svc.shownOnlinePublicly(1)).toBe(false);
    hidden.subject.presenceMode = 'friends';
    expect(hidden.svc.shownOnlinePublicly(1), 'an anonymous viewer is nobody’s friend').toBe(false);
    expect(hidden.svc.shownOnlinePublicly(99), 'offline').toBe(false);
  });

  it('shows no “last seen” for a guildmate who hides from the viewer', async () => {
    const hidden = service(true);
    const snap = await hidden.svc.snapshot(2);
    const row = snap.guild?.members.find((m) => m.id === 1);
    expect(row).toMatchObject({ online: false, lastLogin: null });
    const other = snap.guild?.members.find((m) => m.id === 3);
    expect(other?.lastLogin, 'a visible member keeps it').toBe('2026-10-01T09:00:00Z');
  });

  it('a friend edge change refreshes the hider’s friend set at once and both panels', async () => {
    const { svc, pushed, subject } = service(true);
    subject.presenceMode = 'friends';
    subject.friendIds = new Set([2]);
    await svc.friendRemove({ characterId: 1, name: 'Hider' }, 'Bet');
    expect([...(subject.friendIds ?? [])]).toEqual([]);
    expect(pushed.sort()).toEqual([1, 2]);
  });

  it('delivers the confirmation as a log event, not an error', () => {
    const { svc, delivered, events } = service(false);
    svc.noticeTo(1, PRESENCE_NOTICES.friends);
    expect(delivered).toEqual([1]);
    expect(events).toEqual([{ type: 'log', text: PRESENCE_NOTICES.friends, color: '#7fd4ff' }]);
  });

  it('a setting change refreshes the actor and every online friend and guildmate once', async () => {
    const { svc, pushed, delivered } = service(true);
    await svc.refreshPresenceWatchers({ characterId: 1, name: 'Hider' });
    // The actor's own panel first (its Friends footer shows the setting), then
    // each watcher exactly once although the guild roster also lists the actor.
    expect(pushed).toEqual([1, 2, 3]);
    expect(delivered, 'a refresh is silent').toEqual([]);
  });
});

describe('a throttled or failed change, and the refresh window', () => {
  function liveSession(): PresenceSession {
    return { accountId: 7, characterId: 9, name: 'Hider', presenceMode: 'everyone' };
  }

  it('re-sends the sender’s own panel when the command lane refuses the change', () => {
    const resyncOwnPanel = vi.fn();
    const host = {
      pool: { query: vi.fn() } as never,
      consumeCommandLane: () => false,
      refreshPresenceWatchers: vi.fn(),
      resyncOwnPanel,
      sendChatNotice: vi.fn(),
    } as PresenceCommandHost<PresenceSession>;
    expect(handlePresenceChatCommand(host, liveSession(), '/presence none', 1)).toBe(true);
    expect(resyncOwnPanel).toHaveBeenCalledOnce();
  });

  it('re-sends the sender’s own panel when the save fails', async () => {
    const resyncOwnPanel = vi.fn();
    const host = {
      pool: { query: vi.fn(async () => Promise.reject(new Error('db down'))) } as never,
      consumeCommandLane: () => true,
      refreshPresenceWatchers: vi.fn(),
      resyncOwnPanel,
      sendChatNotice: vi.fn(),
    } as PresenceCommandHost<PresenceSession>;
    const session = liveSession();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    handlePresenceChatCommand(host, session, '/presence friends', 1);
    await vi.waitFor(() => expect(resyncOwnPanel).toHaveBeenCalledOnce());
    expect(session.presenceMode, 'the setting did not change').toBe('everyone');
  });

  it('refreshes the watchers at once, then once more at the end of the window however often it changes', async () => {
    vi.useFakeTimers();
    try {
      const refreshPresenceWatchers = vi.fn(async () => {});
      const resyncPanel = vi.fn();
      const host = presenceHostFrom<PresenceSession>(
        {
          pool: { query: vi.fn(async () => ({ rows: [] })) } as never,
          consumeCommandLane: () => true,
        },
        () => ({ noticeTo: vi.fn(), refreshPresenceWatchers, resyncPanel }),
      );
      const session = liveSession();
      await host.refreshPresenceWatchers(session);
      expect(refreshPresenceWatchers).toHaveBeenCalledOnce();
      for (let i = 0; i < 5; i++) await host.refreshPresenceWatchers(session);
      expect(refreshPresenceWatchers, 'coalesced inside the window').toHaveBeenCalledOnce();
      expect(resyncPanel, 'the sender still sees each change').toHaveBeenCalledTimes(5);
      await vi.advanceTimersByTimeAsync(PRESENCE_REFRESH_WINDOW_MS);
      expect(refreshPresenceWatchers, 'one trailing refresh').toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(PRESENCE_REFRESH_WINDOW_MS);
      expect(refreshPresenceWatchers, 'nothing pending, nothing more').toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
