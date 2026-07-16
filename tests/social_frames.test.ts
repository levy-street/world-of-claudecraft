import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed; the wire/frame paths are under test.
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
import { ClientWorld } from '../src/net/online';
import { grantDeed } from '../src/sim/deeds';
import type { PlayerClass } from '../src/sim/types';
import type { FriendInfo, SocialInfo } from '../src/world_api/social_graph';

// W9 ULTRACODE: event-frame parity for the two NON-SNAPSHOT facets the W0a
// round-trip gate is structurally blind to. `IWorldSocialGraph.socialInfo` rides
// the dedicated `social`/`socialpos` frames (there is NO `s.social` snapshot key);
// the fiesta part of `IWorldDuelArena` flows as SimEvents through the `events` queue
// (drainEvents) plus the `arena_augment` command. This pins those frames so a future
// slice that "tidies" a handler, drops a `?? []`/`?? null` default, or wires
// socialInfo into applySnapshot reddens here even while tsc + W0a stay green. Each
// assertion is mutation-sensitive (breaking the guard it pins fails the test).

interface FakeClient {
  sent: any[];
  ws: any;
}

function fakeWs(): FakeClient {
  const sent: any[] = [];
  return { sent, ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) } };
}

function lastSnap(sent: any[]): any {
  for (let i = sent.length - 1; i >= 0; i--) {
    if (sent[i].t === 'snap') return sent[i];
  }
  return null;
}

function joinServer(
  server: GameServer,
  fc: FakeClient,
  characterId: number,
  name: string,
  cls: PlayerClass = 'warrior',
): ClientSession {
  const session = server.join(fc.ws, characterId, characterId, name, cls, null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

function broadcast(server: GameServer): void {
  (server as any).broadcastSnapshots();
}

// A ClientWorld without the WebSocket plumbing, so we can feed it raw server frames
// via the private onMessage and drive applySnapshot directly (the snapshots.test.ts
// scaffolding).
function bareClient(pid: number): ClientWorld {
  const c: any = Object.create(ClientWorld.prototype);
  c.cfg = { seed: 20061, playerClass: 'warrior' };
  c.entities = new Map();
  c.playerId = pid;
  c.moveInput = {};
  c.inventory = [];
  c.vendorBuyback = [];
  c.equipment = {};
  c.accountCosmetics = { completedQuestIds: [], mechChromaIds: [] };
  c.copper = 0;
  c.xp = 0;
  c.known = [];
  c.questLog = new Map();
  c.questsDone = new Set();
  c.pendingQuestCommands = new Map();
  c.partyInfo = null;
  c.tradeInfo = null;
  c.duelInfo = null;
  c.socialInfo = null;
  c.arenaInfo = null;
  c.lockpickState = null;
  c.lastSnapAt = 0;
  c.snapInterval = 50;
  c.missingSince = new Map();
  c.pendingFacingDelta = 0;
  c.connected = true;
  c.eventQueue = [];
  c.mouselookFacing = null;
  c.lastInputSentAt = 0;
  c.lastInputSig = '';
  c.inputSeq = 0;
  c.pendingInputSeqSentAt = new Map();
  c.ackedInputSeq = 0;
  c.inputEchoSamples = [];
  return c;
}

function feed(c: ClientWorld, frame: Record<string, unknown>): void {
  (c as any).onMessage(JSON.stringify(frame));
}

describe('W9 socialInfo via the social/socialpos frames (non-snapshot)', () => {
  it('the `social` frame sets socialInfo and flips consumeSocialChanged exactly once', () => {
    const c = bareClient(7);
    const friends: FriendInfo[] = [
      {
        id: 2,
        name: 'Ally',
        cls: 'mage',
        level: 5,
        realm: 'R1',
        activeTitle: 'prog_veteran',
        online: true,
      },
    ];
    feed(c, {
      t: 'social',
      friends,
      blocks: [{ id: 9, name: 'Foe' }],
      guild: {
        id: 1,
        name: 'Guild',
        rank: 'leader',
        members: [
          {
            id: 3,
            name: 'Mate',
            cls: 'priest',
            level: 9,
            realm: 'R1',
            online: false,
            rank: 'member',
          },
        ],
        events: [],
      },
    });

    expect(c.socialInfo).toEqual({
      friends,
      blocks: [{ id: 9, name: 'Foe' }],
      ignores: [],
      guild: {
        id: 1,
        name: 'Guild',
        rank: 'leader',
        members: [
          {
            id: 3,
            name: 'Mate',
            cls: 'priest',
            level: 9,
            realm: 'R1',
            online: false,
            rank: 'member',
          },
        ],
        events: [],
      },
    });
    // the dirty flag flips true once, then back to false (HUD re-render poll)
    expect(c.consumeSocialChanged()).toBe(true);
    expect(c.consumeSocialChanged()).toBe(false);
  });

  it('the `social` frame applies the `?? []` / `?? null` defaults when fields are absent', () => {
    const c = bareClient(7);
    feed(c, { t: 'social' }); // no friends/blocks/guild
    expect(c.socialInfo).toEqual({ friends: [], blocks: [], ignores: [], guild: null });
  });

  it('the `social` frame carries each guild member last_login through unchanged', () => {
    const c = bareClient(7);
    const iso = '2026-01-02T03:04:05.000Z';
    feed(c, {
      t: 'social',
      guild: {
        id: 1,
        name: 'Guild',
        rank: 'leader',
        members: [
          {
            id: 3,
            name: 'Seen',
            cls: 'priest',
            level: 9,
            realm: 'R1',
            online: false,
            rank: 'member',
            lastLogin: iso,
          },
          {
            id: 4,
            name: 'NeverSeen',
            cls: 'mage',
            level: 2,
            realm: 'R1',
            online: false,
            rank: 'member',
            lastLogin: null,
          },
        ],
      },
    });
    const members = c.socialInfo!.guild!.members;
    expect(members.find((m) => m.name === 'Seen')?.lastLogin).toBe(iso);
    expect(members.find((m) => m.name === 'NeverSeen')?.lastLogin).toBeNull();
  });

  it('`socialpos` merges position in place for matched ids and leaves unmatched rows untouched', () => {
    const c = bareClient(7);
    const social: SocialInfo = {
      friends: [
        {
          id: 2,
          name: 'Ally',
          cls: 'mage',
          level: 5,
          realm: 'R1',
          activeTitle: null,
          online: false,
        },
        {
          id: 5,
          name: 'Stale',
          cls: 'rogue',
          level: 3,
          realm: 'R1',
          activeTitle: null,
          online: false,
        },
        {
          id: 6,
          name: 'Keeper',
          cls: 'hunter',
          level: 7,
          realm: 'R1',
          activeTitle: 'prog_veteran',
          online: false,
        },
      ],
      blocks: [],
      ignores: [],
      guild: {
        id: 1,
        name: 'Guild',
        rank: 'leader',
        members: [
          {
            id: 4,
            name: 'Mate',
            cls: 'priest',
            level: 9,
            realm: 'R1',
            activeTitle: 'prog_veteran',
            online: false,
            rank: 'member',
            lastLogin: null,
          },
        ],
        events: [],
      },
    };
    c.socialInfo = social;

    feed(c, {
      t: 'socialpos',
      list: [
        { id: 2, x: 10, z: 20, zone: 'Eastvale', status: 'combat', title: 'prog_veteran' },
        { id: 4, x: 30, z: 40, zone: 'Westwood', status: 'dungeon', title: null },
        { id: 6, x: 50, z: 60, zone: 'Northfen', status: 'online' },
      ],
    });

    // matched friend updated in place (and flipped online); a title-bearing row
    // sets the roster activeTitle so friends see title changes without relog
    const f2 = c.socialInfo!.friends.find((f) => f.id === 2)!;
    expect(f2).toMatchObject({ x: 10, z: 20, zone: 'Eastvale', status: 'combat', online: true });
    expect(f2.activeTitle).toBe('prog_veteran');
    // unmatched friend left exactly as it was (snapshots own online/offline)
    const f5 = c.socialInfo!.friends.find((f) => f.id === 5)!;
    expect(f5.x).toBeUndefined();
    expect(f5.zone).toBeUndefined();
    expect(f5.status).toBeUndefined();
    expect(f5.online).toBe(false);
    // a row WITHOUT the title field leaves activeTitle alone (an older server
    // that does not send titles must not wipe the DB-sourced roster value)
    const f6 = c.socialInfo!.friends.find((f) => f.id === 6)!;
    expect(f6).toMatchObject({ x: 50, z: 60, zone: 'Northfen', status: 'online', online: true });
    expect(f6.activeTitle).toBe('prog_veteran');
    // matched guildmate updated in place too; title: null clears the roster title
    const m4 = c.socialInfo!.guild!.members.find((m) => m.id === 4)!;
    expect(m4).toMatchObject({ x: 30, z: 40, zone: 'Westwood', status: 'dungeon', online: true });
    expect(m4.activeTitle).toBeNull();
  });

  it('`socialpos` is a no-op when there is no prior socialInfo (guarded)', () => {
    const c = bareClient(7);
    c.socialInfo = null;
    feed(c, { t: 'socialpos', list: [{ id: 2, x: 1, z: 1, zone: 'Z', status: 'online' }] });
    expect(c.socialInfo).toBeNull();
  });
});

describe('W9 socialInfo is NOT snapshot-driven', () => {
  it('a real server `snap` carries no `social` key and applySnapshot never touches socialInfo', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Snapper');
    broadcast(server);
    const snap = lastSnap(fc.sent);
    expect(snap).not.toBeNull();
    // the server emits NO self.social field - socialInfo rides its own frame
    expect(snap.self).not.toHaveProperty('social');

    const c = bareClient(session.pid);
    const sentinel: SocialInfo = { friends: [], blocks: [], ignores: [], guild: null };
    c.socialInfo = sentinel;
    (c as any).applySnapshot(snap);
    // reference identity preserved => applySnapshot did not write socialInfo
    expect(c.socialInfo).toBe(sentinel);
  });
});

describe('W9 fiesta via the events queue + the arena_augment command', () => {
  it('fiesta SimEvents pushed by an `events` frame survive drainEvents intact and in order', () => {
    const c = bareClient(7);
    const evs: Array<Record<string, unknown>> = [
      { type: 'fiestaDown', pid: 7 },
      { type: 'fiestaPowerupSpawn', id: 11, defId: 'haste' },
      { type: 'fiestaScore', team: 'A', scoreA: 1, scoreB: 0 },
    ];
    feed(c, { t: 'events', list: evs });

    const drained = c.drainEvents();
    expect(drained).toEqual(evs);
    // the queue is cleared after a drain (no double-delivery)
    expect(c.drainEvents()).toEqual([]);
  });

  it('the `arena_augment` command reaches sim.arenaAugmentPick(augment, pid)', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Augmenter');
    const sim = (server as any).sim;
    const spy = vi.spyOn(sim, 'arenaAugmentPick');

    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'arena_augment', augment: 'silver_haste' }),
    );
    expect(spy).toHaveBeenCalledWith('silver_haste', session.pid);

    // the server guards the field: a missing/invalid augment never reaches the sim
    spy.mockClear();
    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'arena_augment' }));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('guild/officer relay sender title (Book of Deeds)', () => {
  // actorFor stamps the LIVE sim meta's activeTitle onto the SocialActor, so
  // the guild/officer relay (which composes its own frames, sim-ignorant) can
  // ride the sender's title as `fromTitle`. Both the /g and /o dispatch arms
  // go through the one actorFor, so this covers them together.
  it('actorFor carries the live activeTitle to SocialService, and null once cleared', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Titled');
    const sim = (server as any).sim;
    const meta = sim.players.get(session.pid)!;
    grantDeed(sim.ctx, meta, 'prog_veteran');
    sim.setActiveTitle('prog_veteran', session.pid);

    const spy = vi.spyOn((server as any).social, 'guildChat').mockResolvedValue(false as never);
    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'chat', text: '/g hail' }));
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Titled', activeTitle: 'prog_veteran' }),
      'hail',
    );

    spy.mockClear();
    sim.setActiveTitle(null, session.pid);
    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'chat', text: '/g plain' }));
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Titled', activeTitle: null }),
      'plain',
    );
  });
});

describe('socialpos carries the live active title (Book of Deeds)', () => {
  // The roster title otherwise comes only from the full `social` frame, which
  // reads the persisted DB blob and lags the 30s autosave: without this, a
  // non-nearby friend/guildmate sees a title change only after a relog. The
  // 1 Hz socialpos push reads the LIVE sim meta, no DB round trip.
  function lastSocialPos(sent: any[]): any {
    for (let i = sent.length - 1; i >= 0; i--) {
      if (sent[i].t === 'socialpos') return sent[i];
    }
    return null;
  }

  it('broadcastSocialPositions rides the live activeTitle, and null once cleared', () => {
    const server = new GameServer();
    const changerFc = fakeWs();
    const changer = joinServer(server, changerFc, 1, 'Changer');
    const watcherFc = fakeWs();
    const watcher = joinServer(server, watcherFc, 2, 'Watcher');
    watcher.socialTrackedIds = [changer.characterId];

    const sim = (server as any).sim;
    const meta = sim.players.get(changer.pid)!;
    grantDeed(sim.ctx, meta, 'prog_veteran');
    sim.setActiveTitle('prog_veteran', changer.pid);

    (server as any).broadcastSocialPositions();
    const frame = lastSocialPos(watcherFc.sent);
    expect(frame).not.toBeNull();
    const row = frame.list.find((r: any) => r.id === changer.characterId);
    expect(row?.title).toBe('prog_veteran');

    sim.setActiveTitle(null, changer.pid);
    (server as any).broadcastSocialPositions();
    const row2 = lastSocialPos(watcherFc.sent).list.find((r: any) => r.id === changer.characterId);
    // the key is always present so a clear propagates as an explicit null
    expect(row2.title).toBeNull();
  });
});
