import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed; snapshot logic is under test.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
}));

import { censorChatText, GameServer, ClientSession } from '../server/game';
import { saveCharacterState } from '../server/db';
import { ClientWorld } from '../src/net/online';
import type { PlayerClass } from '../src/sim/types';

const DELTA_KEYS = ['inv', 'buyback', 'equip', 'qlog', 'qdone', 'cds', 'stats', 'weapon', 'party', 'trade', 'duel'];

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

function joinServer(server: GameServer, fc: FakeClient, characterId: number, name: string, cls: PlayerClass = 'warrior'): ClientSession {
  const session = server.join(fc.ws, characterId, characterId, name, cls, null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

function eventTexts(sent: any[]): string[] {
  return sent
    .flatMap((msg) => msg.t === 'events' ? msg.list : [])
    .filter((ev) => ev.type === 'log' || ev.type === 'error')
    .map((ev) => ev.text);
}

function broadcast(server: GameServer): void {
  (server as any).broadcastSnapshots();
}

// A ClientWorld without the WebSocket plumbing, to drive applySnapshot directly.
function bareClient(pid: number): ClientWorld {
  const c: any = Object.create(ClientWorld.prototype);
  c.cfg = { seed: 20061, playerClass: 'warrior' };
  c.entities = new Map();
  c.playerId = pid;
  c.moveInput = {};
  c.inventory = [];
  c.vendorBuyback = [];
  c.equipment = {};
  c.copper = 0;
  c.xp = 0;
  c.known = [];
  c.questLog = new Map();
  c.questsDone = new Set();
  c.pendingQuestCommands = new Map();
  c.partyInfo = null;
  c.tradeInfo = null;
  c.duelInfo = null;
  c.lastSnapAt = 0;
  c.snapInterval = 50;
  c.pendingFacingDelta = 0;
  c.connected = true;
  c.eventQueue = [];
  c.mouselookFacing = null;
  return c;
}

function withChatCensorConfig(list: string | undefined, file: string | undefined, test: () => void): void {
  const prev = process.env.CHAT_CENSOR_LIST;
  const prevFile = process.env.CHAT_CENSOR_FILE;
  if (list === undefined) delete process.env.CHAT_CENSOR_LIST;
  else process.env.CHAT_CENSOR_LIST = list;
  if (file === undefined) delete process.env.CHAT_CENSOR_FILE;
  else process.env.CHAT_CENSOR_FILE = file;
  try {
    test();
  } finally {
    if (prev === undefined) delete process.env.CHAT_CENSOR_LIST;
    else process.env.CHAT_CENSOR_LIST = prev;
    if (prevFile === undefined) delete process.env.CHAT_CENSOR_FILE;
    else process.env.CHAT_CENSOR_FILE = prevFile;
  }
}

function withChatCensorList(list: string | undefined, test: () => void): void {
  withChatCensorConfig(list, undefined, test);
}

describe('delta snapshots', () => {
  let server: GameServer;
  let fc: FakeClient;
  let session: ClientSession;

  beforeEach(() => {
    server = new GameServer();
    fc = fakeWs();
    session = joinServer(server, fc, 1, 'Testa');
  });

  it('first snapshot carries the full self state', () => {
    broadcast(server);
    const snap = lastSnap(fc.sent);
    expect(snap).not.toBeNull();
    for (const key of DELTA_KEYS) {
      expect(snap.self, `self.${key} missing from first snapshot`).toHaveProperty(key);
    }
    expect(snap.self.party).toBeNull();
    expect(snap.self.trade).toBeNull();
    expect(Array.isArray(snap.self.inv)).toBe(true);
    expect(Array.isArray(snap.ents)).toBe(true);
  });

  it('omits unchanged heavy fields from subsequent snapshots', () => {
    broadcast(server);
    fc.sent.length = 0;
    server.sim.tick();
    broadcast(server);
    const snap = lastSnap(fc.sent);
    for (const key of DELTA_KEYS) {
      expect(snap.self, `self.${key} resent although unchanged`).not.toHaveProperty(key);
    }
    // the always-on fields are still present every snapshot
    for (const key of ['x', 'z', 'hp', 'mhp', 'res', 'gcd', 'xp', 'copper', 'target']) {
      expect(snap.self).toHaveProperty(key);
    }
  });

  it('sell command forwards bounded stack quantities', () => {
    const player = server.sim.entities.get(session.pid)!;
    const vendor = [...server.sim.entities.values()].find((e) => e.templateId === 'trader_wilkes')!;
    player.pos = { ...vendor.pos, x: vendor.pos.x + 2 };
    player.prevPos = { ...player.pos };
    server.sim.addItem('wolf_fang', 5, session.pid);

    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'sell', item: 'wolf_fang', count: 3 }));

    expect(server.sim.meta(session.pid)?.copper).toBe(12);
    expect(server.sim.countItem('wolf_fang', session.pid)).toBe(2);

    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'sell', item: 'wolf_fang', count: 99 }));

    expect(server.sim.meta(session.pid)?.copper).toBe(20);
    expect(server.sim.countItem('wolf_fang', session.pid)).toBe(0);
  });

  it('discard command mirrors inventory and quest progress changes', () => {
    const meta = server.sim.meta(session.pid)!;
    meta.questLog.set('q_widows', { questId: 'q_widows', counts: [10, 0], state: 'active' });
    server.sim.addItem('widow_venom_sac', 6, session.pid);
    broadcast(server);
    fc.sent.length = 0;

    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'discard', item: 'widow_venom_sac', count: 2 }));
    broadcast(server);

    expect(server.sim.countItem('widow_venom_sac', session.pid)).toBe(4);
    expect(meta.questLog.get('q_widows')).toMatchObject({ counts: [10, 4], state: 'active' });
    const snap = lastSnap(fc.sent);
    expect(snap.self.inv).toEqual([{ itemId: 'widow_venom_sac', count: 4 }]);
    expect(snap.self.qlog).toEqual([{ questId: 'q_widows', counts: [10, 4], state: 'active' }]);
  });

  it('resends a heavy field once it changes', () => {
    broadcast(server);
    fc.sent.length = 0;
    server.sim.addItem('baked_bread', 2, session.pid);
    broadcast(server);
    const snap = lastSnap(fc.sent);
    expect(snap.self).toHaveProperty('inv');
    expect(snap.self.inv.some((s: any) => s.itemId === 'baked_bread')).toBe(true);
    expect(snap.self).not.toHaveProperty('qlog');
    expect(snap.self).not.toHaveProperty('stats');
  });

  it('mirrors vendor buyback deltas to the client', () => {
    const wilkes = [...server.sim.entities.values()].find((e) => e.templateId === 'trader_wilkes')!;
    const player = server.sim.entities.get(session.pid)!;
    player.pos.x = wilkes.pos.x + 2;
    player.pos.z = wilkes.pos.z;
    player.prevPos = { ...player.pos };
    server.sim.addItem('apprentice_staff', 1, session.pid);
    broadcast(server);
    const client = bareClient(session.pid);
    (client as any).applySnapshot(lastSnap(fc.sent));
    expect(client.vendorBuyback).toEqual([]);
    expect(client.consumeInventoryChanged()).toBe(true);

    fc.sent.length = 0;
    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'sell', item: 'apprentice_staff' }));
    broadcast(server);
    const snap = lastSnap(fc.sent);
    expect(snap.self).toHaveProperty('buyback');
    expect(snap.self.buyback).toEqual([{ itemId: 'apprentice_staff', count: 1 }]);

    const buybackOnly = { ...snap, self: { ...snap.self } };
    delete buybackOnly.self.inv;
    (client as any).applySnapshot(buybackOnly);
    expect(client.vendorBuyback).toEqual([{ itemId: 'apprentice_staff', count: 1 }]);
    expect(client.consumeInventoryChanged()).toBe(true);
  });

  it('quest commands force a quest-state resync even when rejected', () => {
    broadcast(server);
    fc.sent.length = 0;
    // unknown quest: the sim rejects it and quest state does not change, but
    // the next snapshot must still carry quest fields so stale client UI
    // converges back to the server's truth
    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'accept', quest: 'no_such_quest' }));
    broadcast(server);
    const snap = lastSnap(fc.sent);
    expect(snap.self).toHaveProperty('qlog');
    expect(snap.self).toHaveProperty('qdone');
    expect(snap.self).not.toHaveProperty('inv');
  });

  it('rejected distant quest accepts resync the authoritative quest state', () => {
    broadcast(server);
    fc.sent.length = 0;
    const player = server.sim.entities.get(session.pid)!;
    player.pos.x = 0;
    player.pos.z = -40;

    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'accept', quest: 'q_wolves' }));
    broadcast(server);
    const snap = lastSnap(fc.sent);
    expect(snap.self.qlog).toEqual([]);
    expect(snap.self.qdone).toEqual([]);
  });

  it('each client gets full state on its own first snapshot', () => {
    broadcast(server);
    const fc2 = fakeWs();
    joinServer(server, fc2, 2, 'Testb');
    broadcast(server);
    const snapNew = lastSnap(fc2.sent);
    for (const key of DELTA_KEYS) {
      expect(snapNew.self, `self.${key} missing for fresh session`).toHaveProperty(key);
    }
    // the veteran session still gets deltas only
    const snapOld = lastSnap(fc.sent);
    expect(snapOld.self).not.toHaveProperty('inv');
    // both players spawn together, so each sees the other in ents
    expect(snapNew.ents.some((e: any) => e.id === session.pid)).toBe(true);
  });
});

describe('chat moderation', () => {
  it('rate-limits chat bursts per connected client before cooldown', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Testa');
    fc.sent.length = 0;

    for (let i = 0; i < 6; i++) {
      server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'chat', text: `msg ${i}` }));
    }
    (server as any).routeEvents(server.sim.tick());

    const events = fc.sent.flatMap((msg) => msg.t === 'events' ? msg.list : []);
    expect(events.filter((ev) => ev.type === 'chat')).toHaveLength(5);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'error',
      text: 'You are sending messages too quickly. Slow down.',
    }));
  });

  it('locks chat for 20 seconds after repeated over-limit messages', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Testa');
    fc.sent.length = 0;

    for (let i = 0; i < 8; i++) {
      server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'chat', text: `msg ${i}` }));
    }
    (server as any).routeEvents(server.sim.tick());

    const events = fc.sent.flatMap((msg) => msg.t === 'events' ? msg.list : []);
    expect(events.filter((ev) => ev.type === 'chat')).toHaveLength(5);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'error',
      text: 'Chat locked for 20s because you are sending messages too quickly.',
    }));
  });

  it('censors configured terrible words while still sending chat', () => {
    withChatCensorList('blockedterm', () => {
      expect(censorChatText('hello blockedterm and bl0ckedt3rm')).toBe('hello *********** and ***********');

      const server = new GameServer();
      const fc = fakeWs();
      const session = joinServer(server, fc, 1, 'Testa');
      fc.sent.length = 0;
      server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'chat', text: 'hello blockedterm' }));
      (server as any).routeEvents(server.sim.tick());

      const events = fc.sent.flatMap((msg) => msg.t === 'events' ? msg.list : []);
      expect(events).toContainEqual(expect.objectContaining({
        type: 'chat',
        text: 'hello ***********',
      }));
    });
  });

  it('caches file-backed censor terms until censor env changes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'claudecraft-censor-'));
    const firstFile = join(dir, 'first.txt');
    const secondFile = join(dir, 'second.txt');
    writeFileSync(firstFile, 'fileterm\n');
    writeFileSync(secondFile, 'otherterm\n');

    try {
      withChatCensorConfig(undefined, firstFile, () => {
        expect(censorChatText('fileterm again')).toBe('******** again');
        writeFileSync(firstFile, 'changedterm\n');
        expect(censorChatText('fileterm changedterm')).toBe('******** changedterm');

        process.env.CHAT_CENSOR_FILE = secondFile;
        expect(censorChatText('fileterm otherterm')).toBe('fileterm *********');

        delete process.env.CHAT_CENSOR_FILE;
        expect(censorChatText('otherterm')).toBe('otherterm');
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('retries file-backed censor terms after a failed read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'claudecraft-censor-missing-'));
    const missingFile = join(dir, 'missing.txt');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      withChatCensorConfig(undefined, missingFile, () => {
        expect(censorChatText('laterterm')).toBe('laterterm');
        expect(warn).toHaveBeenCalledOnce();

        writeFileSync(missingFile, 'laterterm\n');
        expect(censorChatText('laterterm')).toBe('*********');
      });
    } finally {
      warn.mockRestore();
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe('autosaves', () => {
  beforeEach(() => {
    vi.mocked(saveCharacterState).mockReset();
    vi.mocked(saveCharacterState).mockResolvedValue(undefined);
  });

  it('skips overlapping saveAll runs while saving each current session once', async () => {
    const server = new GameServer();
    joinServer(server, fakeWs(), 1, 'Testa');
    joinServer(server, fakeWs(), 2, 'Testb');
    joinServer(server, fakeWs(), 3, 'Testc');

    let resolveFirstSave!: () => void;
    const firstSave = new Promise<void>((resolve) => {
      resolveFirstSave = resolve;
    });
    vi.mocked(saveCharacterState).mockImplementationOnce(() => firstSave);

    const firstRun = server.saveAll('test');
    await vi.waitFor(() => {
      expect(saveCharacterState).toHaveBeenCalledTimes(3);
    });

    await server.saveAll('test');
    expect(saveCharacterState).toHaveBeenCalledTimes(3);

    resolveFirstSave();
    await firstRun;

    const savedCharacterIds = vi.mocked(saveCharacterState).mock.calls.map((call) => call[0]);
    expect(savedCharacterIds.sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('waits for an active autosave before running the shutdown save pass', async () => {
    const server = new GameServer();
    joinServer(server, fakeWs(), 1, 'Testa');
    joinServer(server, fakeWs(), 2, 'Testb');

    let resolveFirstSave!: () => void;
    const firstSave = new Promise<void>((resolve) => {
      resolveFirstSave = resolve;
    });
    vi.mocked(saveCharacterState).mockImplementationOnce(() => firstSave);

    const autosave = server.saveAll('autosave');
    await vi.waitFor(() => {
      expect(saveCharacterState).toHaveBeenCalledTimes(2);
    });

    const shutdown = server.saveAll('shutdown');
    await Promise.resolve();
    expect(saveCharacterState).toHaveBeenCalledTimes(2);

    resolveFirstSave();
    await autosave;
    await shutdown;

    const savedCharacterIds = vi.mocked(saveCharacterState).mock.calls.map((call) => call[0]);
    expect(savedCharacterIds.sort((a, b) => a - b)).toEqual([1, 1, 2, 2]);
  });
});

describe('/who command', () => {
  it('lists online players with class, level, realm, and zone metadata', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const self = joinServer(server, fc, 1, 'Aleph', 'warrior');
    const fc2 = fakeWs();
    const other = joinServer(server, fc2, 2, 'Bet', 'mage');
    server.sim.setPlayerLevel(7, other.pid);
    fc.sent.length = 0;

    server.handleMessage(self, JSON.stringify({ t: 'cmd', cmd: 'chat', text: '/who' }));

    const text = eventTexts(fc.sent).join('\n');
    expect(text).toContain('Who: 2 players online on Claudemoon.');
    expect(text).toContain('Aleph - level 1 warrior - Eastbrook Vale');
    expect(text).toContain('Bet - level 7 mage - Eastbrook Vale');
  });

  it('hides ignored players and players who ignored the requester', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const self = joinServer(server, fc, 1, 'Aleph');
    const fcIgnored = fakeWs();
    const ignored = joinServer(server, fcIgnored, 2, 'Bet');
    const fcBlocking = fakeWs();
    const blocking = joinServer(server, fcBlocking, 3, 'Gimel');
    self.blockedIds = new Set([ignored.characterId]);
    blocking.blockedIds = new Set([self.characterId]);
    fc.sent.length = 0;

    server.handleMessage(self, JSON.stringify({ t: 'cmd', cmd: 'chat', text: '/who' }));

    const text = eventTexts(fc.sent).join('\n');
    expect(text).toContain('Who: 1 player online on Claudemoon.');
    expect(text).toContain('Aleph - level 1 warrior - Eastbrook Vale');
    expect(text).not.toContain('Bet');
    expect(text).not.toContain('Gimel');
  });

  it('waits for the requester ignore list before showing online players', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const self = joinServer(server, fc, 1, 'Aleph');
    joinServer(server, fakeWs(), 2, 'Bet');
    self.blockListLoaded = false;
    fc.sent.length = 0;

    server.handleMessage(self, JSON.stringify({ t: 'cmd', cmd: 'chat', text: '/who' }));

    expect(eventTexts(fc.sent)).toContain('Your ignore list is still loading. Try /who again in a moment.');
  });

  it('omits players whose own ignore list is still loading', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const self = joinServer(server, fc, 1, 'Aleph');
    const pending = joinServer(server, fakeWs(), 2, 'Bet');
    pending.blockListLoaded = false;
    fc.sent.length = 0;

    server.handleMessage(self, JSON.stringify({ t: 'cmd', cmd: 'chat', text: '/who' }));

    const text = eventTexts(fc.sent).join('\n');
    expect(text).toContain('Who: 1 player online on Claudemoon.');
    expect(text).toContain('Aleph - level 1 warrior - Eastbrook Vale');
    expect(text).not.toContain('Bet');
  });
});

describe('client-side delta merge', () => {
  it('does not apply optimistic quest accept or completion state', () => {
    const client = bareClient(1);
    const sent: any[] = [];
    (client as any).ws = { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) };
    const oldWebSocket = (globalThis as any).WebSocket;
    (globalThis as any).WebSocket = { OPEN: 1 };
    try {
      client.acceptQuest('q_wolves');
      expect(client.questLog.has('q_wolves')).toBe(false);
      expect(client.questState('q_wolves')).toBe('active');
      expect(sent).toContainEqual({ t: 'cmd', cmd: 'accept', quest: 'q_wolves' });

      (client as any).pendingQuestCommands.clear();
      client.questLog.set('q_wolves', { questId: 'q_wolves', counts: [8], state: 'ready' });
      client.turnInQuest('q_wolves');
      expect(client.questLog.has('q_wolves')).toBe(true);
      expect(client.questsDone.has('q_wolves')).toBe(false);
      expect(client.questState('q_wolves')).toBe('active');
      expect(sent).toContainEqual({ t: 'cmd', cmd: 'turnin', quest: 'q_wolves' });
    } finally {
      (globalThis as any).WebSocket = oldWebSocket;
    }
  });

  it('keeps previous structures when delta fields are omitted', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Testa');
    const client = bareClient(session.pid);

    server.sim.addItem('conjured_water', 1, session.pid);
    broadcast(server);
    (client as any).applySnapshot(lastSnap(fc.sent));
    expect(client.inventory.length).toBeGreaterThan(0);
    const invRef = client.inventory;
    const qlogRef = client.questLog;
    const qdoneRef = client.questsDone;
    const cdsRef = client.player.cooldowns;

    fc.sent.length = 0;
    server.sim.tick();
    broadcast(server);
    (client as any).applySnapshot(lastSnap(fc.sent));
    // omitted fields neither reset nor get rebuilt
    expect(client.inventory).toBe(invRef);
    expect(client.questLog).toBe(qlogRef);
    expect(client.questsDone).toBe(qdoneRef);
    expect(client.player.cooldowns).toBe(cdsRef);

    fc.sent.length = 0;
    server.sim.addItem('baked_bread', 1, session.pid);
    broadcast(server);
    (client as any).applySnapshot(lastSnap(fc.sent));
    expect(client.inventory).not.toBe(invRef);
    expect(client.inventory.some((s) => s.itemId === 'baked_bread')).toBe(true);
  });
});
