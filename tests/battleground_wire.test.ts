// Thornhollow Fields wire gate: the bg_queue / bg_leave / bg_flag commands through
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

import {
  BG_MATCH_DROP_RADIUS,
  BG_MATCH_INTEREST_RADIUS,
  type ClientSession,
  GameServer,
} from '../server/game';
import { ClientWorld } from '../src/net/online';
import { BG_FLAG_Z, BG_PLAY_HALF_X, BG_PLAY_HALF_Z } from '../src/sim/battleground_layout';
import { battlegroundOrigin, bgOriginAt } from '../src/sim/data';
import type { PlayerClass } from '../src/sim/types';
import { bareClient, type FakeClient, fakeWs, joinServer, lastSnap } from './helpers/bare_client';

/** The shared joinServer plus the queue's level floor: wire tests stage
 *  eligible champions unless a case is exercising the floor itself. */
function joinBgServer(
  server: GameServer,
  fc: FakeClient,
  characterId: number,
  name: string,
  cls: PlayerClass = 'warrior',
): ClientSession {
  const session = joinServer(server, fc, characterId, name, cls);
  const e = server.sim.entities.get(session.pid);
  if (e) e.level = 20;
  return session;
}

function cmd(server: GameServer, session: ClientSession, payload: Record<string, unknown>): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', ...payload }));
}

function snapIds(sent: any[]): number[] {
  return (lastSnap(sent).ents as { id: number }[]).map((row) => row.id);
}

// Move an entity and re-bucket it, the way the sim does at end of tick, so the
// broadcast's shared per-cell interest query finds it where the test put it.
function placeAt(server: GameServer, pid: number, x: number, z: number): void {
  const e = server.sim.entities.get(pid)!;
  e.pos = { x, y: e.pos.y, z };
  e.prevPos = { ...e.pos };
  server.sim.ctx.rebucket(e);
}

interface Bg2v2 {
  server: GameServer;
  // allyA / allyB share a team; foeC / foeD are the other side.
  allyA: ClientSession;
  allyB: ClientSession;
  foeC: ClientSession;
  foeD: ClientSession;
  wsA: FakeClient;
  wsB: FakeClient;
  wsC: FakeClient;
  wsD: FakeClient;
  match: any;
  myTeam: number;
}

// Four queued champions force-started into one match. devStartBg splits the
// queue in halves IN QUEUE ORDER, so the first two joined are teammates and the
// last two are the opposition; the helper asserts that rather than assuming it,
// so a change to the split fails here instead of silently making an "enemy"
// arm below into a teammate arm.
function start2v2(server: GameServer): Bg2v2 {
  const wsA = fakeWs();
  const wsB = fakeWs();
  const wsC = fakeWs();
  const wsD = fakeWs();
  const allyA = joinBgServer(server, wsA, 71, 'AllyOne');
  const allyB = joinBgServer(server, wsB, 72, 'AllyTwo');
  const foeC = joinBgServer(server, wsC, 73, 'FoeOne');
  const foeD = joinBgServer(server, wsD, 74, 'FoeTwo');
  for (const s of [allyA, allyB, foeC, foeD]) cmd(server, s, { cmd: 'bg_queue' });
  cmd(server, allyA, { cmd: 'dev_bg_start' });
  const match = server.sim.bgMatchFor(allyA.pid)!;
  expect(match).toBeTruthy();
  const myTeam = match.teams[0].includes(allyA.pid) ? 0 : 1;
  expect(match.teams[myTeam]).toContain(allyB.pid); // same side
  expect(match.teams[1 - myTeam]).toContain(foeC.pid); // opposite side
  expect(match.teams[1 - myTeam]).toContain(foeD.pid);
  return { server, allyA, allyB, foeC, foeD, wsA, wsB, wsC, wsD, match, myTeam };
}

function withDevCommands(run: () => void): void {
  const saved = process.env.ALLOW_DEV_COMMANDS;
  try {
    process.env.ALLOW_DEV_COMMANDS = '1';
    run();
  } finally {
    if (saved === undefined) delete process.env.ALLOW_DEV_COMMANDS;
    else process.env.ALLOW_DEV_COMMANDS = saved;
  }
}

describe('bg_queue / bg_leave dispatch', () => {
  it('bg_queue enqueues the session pid and bg_leave clears it', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinBgServer(server, fc, 1, 'Rifter');

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
    const session = joinBgServer(server, fc, 1, 'Ladderling');

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

  it('carries the LIVE online ladder, ranked, with the viewer on it', () => {
    const server = new GameServer();
    const fcA = fakeWs();
    const fcB = fakeWs();
    const a = joinBgServer(server, fcA, 1, 'Topper');
    const b = joinBgServer(server, fcB, 2, 'Runnerup');
    // Move one rating so the order is decided by the sort, not by join order.
    server.sim.players.get(a.pid)!.bgRating = 1700;
    server.sim.players.get(a.pid)!.bgWins = 3;

    (server as any).broadcastSnapshots();
    const ladder = lastSnap(fcA.sent).self.bg.ladder;
    expect(ladder.map((r: { name: string }) => r.name)).toEqual(['Topper', 'Runnerup']);
    expect(ladder[0]).toEqual({
      pid: a.pid,
      name: 'Topper',
      cls: 'warrior',
      rating: 1700,
      wins: 3,
      losses: 0,
    });
    // Realm-wide, so the other viewer receives the identical rows (this is what
    // makes the read viewer-identical, and therefore worth memoizing).
    expect(lastSnap(fcB.sent).self.bg.ladder).toEqual(ladder);
    expect(b.pid).not.toBe(a.pid);

    // ...and it mirrors onto ClientWorld with the rest of the key.
    const client = bareClient(a.pid);
    (client as any).applySnapshot(lastSnap(fcA.sent));
    expect(client.bgInfo!.ladder).toEqual(ladder);
  });

  it('builds the viewer-identical ladder ONCE per broadcast pass', () => {
    // The hot-path rule: bgInfoFor runs per session at BG_WIRE_HZ, and the
    // ladder scans every online player. A per-viewer build would count 2 here.
    const server = new GameServer();
    const fcA = fakeWs();
    const fcB = fakeWs();
    joinBgServer(server, fcA, 1, 'MemoOne');
    joinBgServer(server, fcB, 2, 'MemoTwo');
    const memo = (server as any).bgLadderReadout;
    expect(memo.objectBuilds).toBe(0);
    (server as any).broadcastSnapshots();
    expect(memo.objectBuilds).toBe(1);
    // Both sessions really did receive it from that one build.
    expect(lastSnap(fcA.sent).self.bg.ladder).toHaveLength(2);
    expect(lastSnap(fcB.sent).self.bg.ladder).toHaveLength(2);
  });
});

describe('match-scoped interest: own team and field objects, never enemy players', () => {
  // The rule under test (server/game.ts bgWideInterestApplies): inside one
  // battleground slot the raised radius covers your OWN team and the field's
  // non-player entities; an enemy PLAYER falls back to the open-world radii, so
  // their entity record (position, facing, hp, resource, cast, auras) is never
  // shipped past normal interest. Each arm below is asserted on its own, so
  // deleting either half of the predicate reds exactly one of them.

  it('a TEAMMATE at flag-to-flag distance (236yd) still ships both ways', () => {
    withDevCommands(() => {
      const server = new GameServer();
      const bg = start2v2(server);
      // Both allies stood on the two flag plinths: the longest span the mode
      // asks for, far outside every open-world radius, inside the raised one.
      const mine = bg.match.flags[bg.myTeam].home;
      const theirs = bg.match.flags[1 - bg.myTeam].home;
      placeAt(server, bg.allyA.pid, mine.x, mine.z);
      placeAt(server, bg.allyB.pid, theirs.x, theirs.z);
      const gap = Math.hypot(mine.x - theirs.x, mine.z - theirs.z);
      expect(gap).toBeGreaterThan(120); // beyond the widest open-world radius
      expect(gap).toBeLessThan(BG_MATCH_INTEREST_RADIUS);
      (server as any).broadcastSnapshots();
      expect(snapIds(bg.wsA.sent)).toContain(bg.allyB.pid);
      expect(snapIds(bg.wsB.sent)).toContain(bg.allyA.pid);
    });
  });

  it('an ENEMY at the same 236yd separation ships to NEITHER side', () => {
    // The regression arm. This is the one that reds if the team filter is
    // dropped and the raised radius goes back to covering every same-slot pair.
    withDevCommands(() => {
      const server = new GameServer();
      const bg = start2v2(server);
      const mine = bg.match.flags[bg.myTeam].home;
      const theirs = bg.match.flags[1 - bg.myTeam].home;
      placeAt(server, bg.allyA.pid, mine.x, mine.z);
      placeAt(server, bg.foeC.pid, theirs.x, theirs.z);
      // Park the two spare fighters on top of their own side, so nothing else
      // can account for a hit: only allyA and foeC sit at the long span.
      placeAt(server, bg.allyB.pid, mine.x, mine.z);
      placeAt(server, bg.foeD.pid, theirs.x, theirs.z);
      const gap = Math.hypot(mine.x - theirs.x, mine.z - theirs.z);
      expect(gap).toBeGreaterThan(120);
      expect(gap).toBeLessThan(BG_MATCH_INTEREST_RADIUS); // inside the raised radius
      (server as any).broadcastSnapshots();
      const idsForA = snapIds(bg.wsA.sent);
      const idsForC = snapIds(bg.wsC.sent);
      expect(idsForA).not.toContain(bg.foeC.pid);
      expect(idsForA).not.toContain(bg.foeD.pid);
      expect(idsForC).not.toContain(bg.allyA.pid);
      expect(idsForC).not.toContain(bg.allyB.pid);
      // Non-vacuous: the same snapshot DOES carry the teammate at that range,
      // so the absence above is the team filter and not an empty snapshot.
      expect(idsForA).toContain(bg.allyB.pid);
      expect(idsForC).toContain(bg.foeD.pid);
    });
  });

  it('an ENEMY inside standard interest still ships (only the WIDE arm narrowed)', () => {
    withDevCommands(() => {
      const server = new GameServer();
      const bg = start2v2(server);
      const mine = bg.match.flags[bg.myTeam].home;
      const toward = bg.match.flags[1 - bg.myTeam].home.z > mine.z ? 1 : -1;
      placeAt(server, bg.allyA.pid, mine.x, mine.z);
      placeAt(server, bg.foeC.pid, mine.x, mine.z + toward * 60); // 60yd: normal interest
      (server as any).broadcastSnapshots();
      expect(snapIds(bg.wsA.sent)).toContain(bg.foeC.pid);
      expect(snapIds(bg.wsC.sent)).toContain(bg.allyA.pid);
    });
  });

  it('the field objects (both flags) ship to BOTH sides at that same range', () => {
    // Rule (b): non-player entities in the slot are match furniture, tracked by
    // everyone. Asserted at the exact layout where the enemy PLAYERS above were
    // withheld, so the two rules are shown to be independent.
    withDevCommands(() => {
      const server = new GameServer();
      const bg = start2v2(server);
      const mine = bg.match.flags[bg.myTeam].home;
      const theirs = bg.match.flags[1 - bg.myTeam].home;
      placeAt(server, bg.allyA.pid, mine.x, mine.z);
      placeAt(server, bg.foeC.pid, theirs.x, theirs.z);
      const myFlagId = bg.match.flags[bg.myTeam].entityId as number;
      const theirFlagId = bg.match.flags[1 - bg.myTeam].entityId as number;
      expect(myFlagId).toBeGreaterThan(0);
      expect(theirFlagId).toBeGreaterThan(0);
      expect(server.sim.entities.get(theirFlagId)!.kind).not.toBe('player');
      (server as any).broadcastSnapshots();
      const idsForA = snapIds(bg.wsA.sent);
      const idsForC = snapIds(bg.wsC.sent);
      // each side sees the far flag it has to go take, and its own
      expect(idsForA).toContain(theirFlagId);
      expect(idsForA).toContain(myFlagId);
      expect(idsForC).toContain(myFlagId);
      expect(idsForC).toContain(theirFlagId);
    });
  });

  it('cross-slot pairs never ship: the raised interest is same-slot only', () => {
    const saved = process.env.ALLOW_DEV_COMMANDS;
    try {
      process.env.ALLOW_DEV_COMMANDS = '1';
      const server = new GameServer();
      const fa = fakeWs();
      const a = joinBgServer(server, fa, 1, 'SlotZeroA');
      const b = joinBgServer(server, fakeWs(), 2, 'SlotZeroB');
      cmd(server, a, { cmd: 'bg_queue' });
      cmd(server, b, { cmd: 'bg_queue' });
      cmd(server, a, { cmd: 'dev_bg_start' });
      const fc = fakeWs();
      const c = joinBgServer(server, fc, 3, 'SlotOneC');
      const d = joinBgServer(server, fakeWs(), 4, 'SlotOneD');
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
    // The teammate half of the design rests on the field fitting the raised
    // radius: the M map plots your own side across the whole field from
    // world.entities, so the radius has to exceed the field diagonal. Pin the
    // radius itself AND compute the check from the exported constants, so
    // lowering the server radius fails here instead of silently shrinking the
    // guarantee under a still-green hardcoded number.
    expect(BG_MATCH_INTEREST_RADIUS).toBe(300);
    expect(BG_MATCH_DROP_RADIUS).toBeGreaterThan(BG_MATCH_INTEREST_RADIUS);
    // Players fight inside the ramparts, not on the dressed slope beyond them:
    // that diagonal is what has to fit, and it does with real headroom.
    const playDiagonal = Math.hypot(2 * BG_PLAY_HALF_X, 2 * BG_PLAY_HALF_Z);
    expect(playDiagonal).toBeLessThan(BG_MATCH_INTEREST_RADIUS);
    // The flag-to-flag carry, the longest run the mode asks for, fits too.
    expect(2 * BG_FLAG_Z).toBeLessThan(BG_MATCH_INTEREST_RADIUS);
  });

  it('stealth filters BEFORE any interest branch: a hidden enemy ships nowhere', () => {
    // The fairness half: canObserveEntity runs ahead of the limit branch and
    // the narrowing above left it untouched. Exercised inside STANDARD interest
    // (60yd), which is the only range an enemy fighter ships at now, so the
    // toggle is what decides the assertion rather than the team filter.
    withDevCommands(() => {
      const server = new GameServer();
      const bg = start2v2(server);
      const mine = bg.match.flags[bg.myTeam].home;
      const toward = bg.match.flags[1 - bg.myTeam].home.z > mine.z ? 1 : -1;
      placeAt(server, bg.allyA.pid, mine.x, mine.z);
      placeAt(server, bg.foeC.pid, mine.x, mine.z + toward * 60);
      const foe = server.sim.entities.get(bg.foeC.pid)!;
      // visible first: at 60yd the enemy is inside ordinary interest
      (server as any).broadcastSnapshots();
      expect(snapIds(bg.wsA.sent)).toContain(bg.foeC.pid);
      // now hidden: same positions, stealth on, absent from the snapshot
      foe.stealthed = true;
      (server as any).broadcastSnapshots();
      expect(snapIds(bg.wsA.sent)).not.toContain(bg.foeC.pid);
    });
  });
});

describe('the bg readout refreshes match-wide on a respawn wave', () => {
  it('a wave raising one fighter re-ships bg to a member who did not respawn', () => {
    // The sim emits `respawn` pid-scoped for the fighter it raised, but the
    // readout it invalidates (the match-wide `dead` column) is read by every
    // member, so the server fans the refresh out to the whole match. Without
    // that fan-out the other scoreboards keep showing a body for up to one
    // BG_WIRE_HZ period, a divergence from the offline host, which recomputes
    // the view every frame.
    withDevCommands(() => {
      const server = new GameServer();
      const bg = start2v2(server);
      const bystander = joinBgServer(server, fakeWs(), 90, 'Bystander'); // no match
      const foe = server.sim.entities.get(bg.foeC.pid)!;
      const advance = (): void => {
        (server.sim as any).tickCount = server.sim.tickCount + 1;
      };

      // A body on the field, delivered to the teammate who is watching the
      // scoreboard (force the cadence gate open once to seed lastSent).
      foe.dead = true;
      foe.ghost = true;
      (bg.allyA as any).lastBgWireTick = -10_000;
      (server as any).broadcastSnapshots();
      const seeded = lastSnap(bg.wsA.sent).self.bg;
      expect(seeded.match.players.find((p: any) => p.pid === bg.foeC.pid).dead).toBe(true);

      // A respawn for somebody OUTSIDE the match must not open the gate: this
      // is the arm that reds if the fan-out refreshes every session.
      advance();
      foe.dead = false;
      foe.ghost = false;
      (server as any).routeEvents([{ type: 'respawn', pid: bystander.pid }]);
      (server as any).broadcastSnapshots();
      expect(lastSnap(bg.wsA.sent).self.bg).toBeUndefined(); // still throttled

      // The wave itself: pid-scoped to the fighter who stood up, yet the
      // teammate's readout refreshes on the very next snapshot.
      advance();
      (server as any).routeEvents([{ type: 'respawn', pid: bg.foeC.pid }]);
      (server as any).broadcastSnapshots();
      const fresh = lastSnap(bg.wsA.sent).self.bg;
      expect(fresh).toBeDefined();
      expect(fresh.match.players.find((p: any) => p.pid === bg.foeC.pid).dead).toBe(false);
      // and the fighter who respawned gets it too (they are in the fan-out set)
      expect(lastSnap(bg.wsC.sent).self.bg).toBeDefined();
    });
  });
});

describe('dev_bg_start env gate', () => {
  it('is inert without ALLOW_DEV_COMMANDS=1 and force-starts a match with it', () => {
    const saved = process.env.ALLOW_DEV_COMMANDS;
    try {
      delete process.env.ALLOW_DEV_COMMANDS;
      const server = new GameServer();
      const a = joinBgServer(server, fakeWs(), 1, 'Crimson');
      const b = joinBgServer(server, fakeWs(), 2, 'Azure');
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
    const session = joinBgServer(server, fc, 1, 'Flagless');
    expect(() => cmd(server, session, { cmd: 'bg_flag' })).not.toThrow();
    expect(server.sim.bgInfoFor(session.pid)!.match).toBeNull();
  });
});
