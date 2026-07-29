// Ravenrift wire gate: the bg_queue / bg_leave / bg_flag commands through
// GameServer.handleMessage, the dev_bg_start ALLOW_DEV_COMMANDS env gate, and
// the `bg` self key riding the snapshot into ClientWorld.bgInfo (server encode
// -> ClientWorld decode). Harness modeled on tests/weapon_stow.test.ts +
// tests/snapshots.test.ts.
import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed; wire/dispatch logic is under test.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  // bank_ledger.ts (imported via game.ts recordBankOp) reads this at call time.
  insertBankLedgerRow: vi.fn(async () => {}),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

import { BG_MATCH_INTEREST_RADIUS, type ClientSession, GameServer } from '../server/game';
import { ClientWorld } from '../src/net/online';
import { BG_FLAG_Z, BG_PLAY_HALF_X, BG_PLAY_HALF_Z } from '../src/sim/battleground_layout';
import { battlegroundOrigin, bgOriginAt } from '../src/sim/data';
import type { PlayerClass } from '../src/sim/types';

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
  // The queue has a level floor (BG_MIN_LEVEL); wire tests stage eligible
  // champions unless a case is exercising the floor itself.
  const e = server.sim.entities.get(session.pid);
  if (e) e.level = 20;
  return session;
}

function cmd(server: GameServer, session: ClientSession, payload: Record<string, unknown>): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', ...payload }));
}

// A ClientWorld without the WebSocket plumbing, to drive applySnapshot directly.
function bareClient(pid: number): ClientWorld {
  const c: any = Object.create(ClientWorld.prototype);
  c.cfg = { seed: 20061, playerClass: 'warrior' };
  c.entities = new Map();
  c.playerId = pid;
  c.ownPlayerId = pid;
  c.ownPlayerClass = 'warrior';
  c.spectating = null;
  c.cupInfo = null;
  c.sportRole = null;
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
  c.selectedDungeonDifficulty = 'normal';
  c.tradeInfo = null;
  c.duelInfo = null;
  c.bgInfo = null;
  c.lastSnapAt = 0;
  c.snapInterval = 50;
  c.serverTickHz = null;
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
  c.spectateFacingPending = false;
  c.pendingSpectateFacing = null;
  return c;
}

describe('bg_queue / bg_leave dispatch', () => {
  it('bg_queue enqueues the session pid and bg_leave clears it', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Rifter');

    expect(server.sim.bgInfoFor(session.pid)!.queued).toBe(false);
    cmd(server, session, { cmd: 'bg_queue' });
    expect(server.sim.bgInfoFor(session.pid)!.queued).toBe(true);

    cmd(server, session, { cmd: 'bg_leave' });
    expect(server.sim.bgInfoFor(session.pid)!.queued).toBe(false);
  });
});

describe('the bg self key over the wire', () => {
  it('rides the snapshot with the base rating and mirrors into ClientWorld.bgInfo', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Ladderling');

    (server as any).broadcastSnapshots();
    const snap = lastSnap(fc.sent);
    expect(snap.self.bg).not.toBeNull();
    expect(snap.self.bg.rating).toBe(1500);
    expect(snap.self.bg.queued).toBe(false);
    expect(snap.self.bg.match).toBeNull();

    const client = bareClient(session.pid);
    expect(client.bgInfo).toBeNull();
    (client as any).applySnapshot(snap);
    expect(client.bgInfo).toEqual(snap.self.bg);
  });
});

describe('immersive-scale interest: the whole match stays tracked', () => {
  it('participants at flag-to-flag distance (236yd) still ship in each other snapshots', () => {
    const saved = process.env.ALLOW_DEV_COMMANDS;
    try {
      process.env.ALLOW_DEV_COMMANDS = '1';
      const server = new GameServer();
      const fa = fakeWs();
      const fb = fakeWs();
      const a = joinServer(server, fa, 1, 'FarSeerA');
      const b = joinServer(server, fb, 2, 'FarSeerB');
      cmd(server, a, { cmd: 'bg_queue' });
      cmd(server, b, { cmd: 'bg_queue' });
      cmd(server, a, { cmd: 'dev_bg_start' });
      const match = server.sim.bgMatchFor(a.pid)!;
      expect(match).toBeTruthy();
      // stand each on their own flag: the full 236yd apart, far beyond the
      // 90yd open-world interest radius
      const ea = server.sim.entities.get(a.pid)!;
      const eb = server.sim.entities.get(b.pid)!;
      const aTeam = match.teams[0].includes(a.pid) ? 0 : 1;
      const aHome = match.flags[aTeam].home;
      const bHome = match.flags[1 - aTeam].home;
      ea.pos = { x: aHome.x, y: ea.pos.y, z: aHome.z };
      ea.prevPos = { ...ea.pos };
      server.sim.ctx.rebucket(ea);
      eb.pos = { x: bHome.x, y: eb.pos.y, z: bHome.z };
      eb.prevPos = { ...eb.pos };
      server.sim.ctx.rebucket(eb);
      expect(Math.abs(ea.pos.z - eb.pos.z)).toBeGreaterThan(230);
      (server as any).broadcastSnapshots();
      const idsForA = (lastSnap(fa.sent).ents as { id: number }[]).map((row) => row.id);
      const idsForB = (lastSnap(fb.sent).ents as { id: number }[]).map((row) => row.id);
      expect(idsForA).toContain(b.pid);
      expect(idsForB).toContain(a.pid);
    } finally {
      if (saved === undefined) delete process.env.ALLOW_DEV_COMMANDS;
      else process.env.ALLOW_DEV_COMMANDS = saved;
    }
  });

  it('cross-slot pairs never ship: the raised interest is same-slot only', () => {
    const saved = process.env.ALLOW_DEV_COMMANDS;
    try {
      process.env.ALLOW_DEV_COMMANDS = '1';
      const server = new GameServer();
      const fa = fakeWs();
      const a = joinServer(server, fa, 1, 'SlotZeroA');
      const b = joinServer(server, fakeWs(), 2, 'SlotZeroB');
      cmd(server, a, { cmd: 'bg_queue' });
      cmd(server, b, { cmd: 'bg_queue' });
      cmd(server, a, { cmd: 'dev_bg_start' });
      const fc = fakeWs();
      const c = joinServer(server, fc, 3, 'SlotOneC');
      const d = joinServer(server, fakeWs(), 4, 'SlotOneD');
      cmd(server, c, { cmd: 'bg_queue' });
      cmd(server, d, { cmd: 'bg_queue' });
      cmd(server, c, { cmd: 'dev_bg_start' });
      const matchA = server.sim.bgMatchFor(a.pid)!;
      const matchC = server.sim.bgMatchFor(c.pid)!;
      expect(matchA).toBeTruthy();
      expect(matchC).toBeTruthy();
      expect(matchA.slot).not.toBe(matchC.slot);
      // Stand the probes just across the slot midpoint. They remain inside the
      // widened match radius, so only the explicit same-slot predicate can
      // keep them out of one another's snapshots.
      const [southMatch, northMatch] =
        battlegroundOrigin(matchA.slot).z < battlegroundOrigin(matchC.slot).z
          ? [matchA, matchC]
          : [matchC, matchA];
      const southProbe = server.sim.entities.get(southMatch === matchA ? a.pid : c.pid)!;
      const northProbe = server.sim.entities.get(northMatch === matchA ? a.pid : c.pid)!;
      const midpoint =
        (battlegroundOrigin(southMatch.slot).z + battlegroundOrigin(northMatch.slot).z) / 2;
      southProbe.pos = { ...southProbe.pos, z: midpoint - 100 };
      southProbe.prevPos = { ...southProbe.pos };
      server.sim.ctx.rebucket(southProbe);
      northProbe.pos = { ...northProbe.pos, z: midpoint + 100 };
      northProbe.prevPos = { ...northProbe.pos };
      server.sim.ctx.rebucket(northProbe);
      const gap = Math.abs(southProbe.pos.z - northProbe.pos.z);
      expect(gap).toBeGreaterThan(100); // beyond normal-world interest and drop radii
      expect(gap).toBeLessThan(BG_MATCH_INTEREST_RADIUS);
      expect(bgOriginAt(southProbe.pos.z).slot).toBe(southMatch.slot);
      expect(bgOriginAt(northProbe.pos.z).slot).toBe(northMatch.slot);
      (server as any).broadcastSnapshots();
      const idsForA = (lastSnap(fa.sent).ents as { id: number }[]).map((row) => row.id);
      const idsForC = (lastSnap(fc.sent).ents as { id: number }[]).map((row) => row.id);
      expect(idsForA).not.toContain(c.pid);
      expect(idsForC).not.toContain(a.pid);
    } finally {
      if (saved === undefined) delete process.env.ALLOW_DEV_COMMANDS;
      else process.env.ALLOW_DEV_COMMANDS = saved;
    }
  });

  it('the field diagonal keeps headroom inside the match interest radius', () => {
    // The whole-match-tracked design rests on the field fitting the raised
    // radius. Pin the radius itself AND compute the check from the exported
    // constants, so lowering the server radius fails here instead of silently
    // shrinking the guarantee under a still-green hardcoded number.
    expect(BG_MATCH_INTEREST_RADIUS).toBe(300);
    // Players fight inside the ramparts, not on the dressed slope beyond them:
    // that diagonal is what has to fit, and it does with real headroom.
    const playDiagonal = Math.hypot(2 * BG_PLAY_HALF_X, 2 * BG_PLAY_HALF_Z);
    expect(playDiagonal).toBeLessThan(BG_MATCH_INTEREST_RADIUS);
    // The flag-to-flag carry, the longest run the mode asks for, fits too.
    expect(2 * BG_FLAG_Z).toBeLessThan(BG_MATCH_INTEREST_RADIUS);
  });

  it('stealth filters BEFORE the widened match radius: a hidden enemy ships nowhere', () => {
    // The fairness half of whole-match interest: the wider bubble must reveal
    // nothing stealth hides (canObserveEntity runs before the limit branch).
    const saved = process.env.ALLOW_DEV_COMMANDS;
    try {
      process.env.ALLOW_DEV_COMMANDS = '1';
      const server = new GameServer();
      const fa = fakeWs();
      const fb = fakeWs();
      const a = joinServer(server, fa, 61, 'SeerOpen');
      const b = joinServer(server, fb, 62, 'SneakFar');
      cmd(server, a, { cmd: 'bg_queue' });
      cmd(server, b, { cmd: 'bg_queue' });
      cmd(server, a, { cmd: 'dev_bg_start' });
      const match = server.sim.bgMatchFor(a.pid)!;
      expect(match).toBeTruthy();
      const ea = server.sim.entities.get(a.pid)!;
      const eb = server.sim.entities.get(b.pid)!;
      // opposite teams (a 1v1 split), stood on their own flags: 236yd apart,
      // inside the widened same-slot radius
      const aTeam = match.teams[0].includes(a.pid) ? 0 : 1;
      const aHome = match.flags[aTeam].home;
      const bHome = match.flags[1 - aTeam].home;
      ea.pos = { x: aHome.x, y: ea.pos.y, z: aHome.z };
      ea.prevPos = { ...ea.pos };
      server.sim.ctx.rebucket(ea);
      eb.pos = { x: bHome.x, y: eb.pos.y, z: bHome.z };
      eb.prevPos = { ...eb.pos };
      server.sim.ctx.rebucket(eb);
      // visible first: the widened radius ships the enemy
      (server as any).broadcastSnapshots();
      let ids = (lastSnap(fa.sent).ents as { id: number }[]).map((row) => row.id);
      expect(ids).toContain(b.pid);
      // now hidden: same positions, stealth on, absent from the snapshot
      eb.stealthed = true;
      (server as any).broadcastSnapshots();
      ids = (lastSnap(fa.sent).ents as { id: number }[]).map((row) => row.id);
      expect(ids).not.toContain(b.pid);
    } finally {
      if (saved === undefined) delete process.env.ALLOW_DEV_COMMANDS;
      else process.env.ALLOW_DEV_COMMANDS = saved;
    }
  });
});

describe('dev_bg_start env gate', () => {
  it('is inert without ALLOW_DEV_COMMANDS=1 and force-starts a match with it', () => {
    const saved = process.env.ALLOW_DEV_COMMANDS;
    try {
      delete process.env.ALLOW_DEV_COMMANDS;
      const server = new GameServer();
      const a = joinServer(server, fakeWs(), 1, 'Crimson');
      const b = joinServer(server, fakeWs(), 2, 'Azure');
      cmd(server, a, { cmd: 'bg_queue' });
      cmd(server, b, { cmd: 'bg_queue' });
      expect(server.sim.bgInfoFor(a.pid)!.queued).toBe(true);
      expect(server.sim.bgInfoFor(b.pid)!.queued).toBe(true);

      // Env unset: the cheat must not run (production posture).
      cmd(server, a, { cmd: 'dev_bg_start' });
      expect(server.sim.bgInfoFor(a.pid)!.match).toBeNull();
      expect(server.sim.bgInfoFor(b.pid)!.match).toBeNull();

      // Empty string is still off: only the exact string '1' arms it.
      process.env.ALLOW_DEV_COMMANDS = '';
      cmd(server, a, { cmd: 'dev_bg_start' });
      expect(server.sim.bgInfoFor(a.pid)!.match).toBeNull();

      // Armed: the queued pair is force-started into a match.
      process.env.ALLOW_DEV_COMMANDS = '1';
      cmd(server, a, { cmd: 'dev_bg_start' });
      expect(server.sim.bgInfoFor(a.pid)!.match).not.toBeNull();
      expect(server.sim.bgInfoFor(b.pid)!.match).not.toBeNull();
    } finally {
      if (saved === undefined) delete process.env.ALLOW_DEV_COMMANDS;
      else process.env.ALLOW_DEV_COMMANDS = saved;
    }
  });
});

describe('bg_flag dispatch', () => {
  it('is a server-side no-op for a player not in a match (never throws)', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Flagless');
    expect(() => cmd(server, session, { cmd: 'bg_flag' })).not.toThrow();
    expect(server.sim.bgInfoFor(session.pid)!.match).toBeNull();
  });
});
