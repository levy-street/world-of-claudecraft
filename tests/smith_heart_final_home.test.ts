// The Masterless Strength always goes home whole (Jose's playtest of 28 Oct
// 2026: the boss sometimes stood somewhere other than his start after a run
// of dev commands). Over a REAL Sim and over the authoritative server's own
// chat path: whatever the order of `/dev heart final quarter`, `fill`,
// `pull`, `root` and `reset`, a reset, a wipe (the raid dead or gone, the
// boss evading) and a fresh claim all leave him on his authored home in the
// middle of the Anvil (HEART_ROOM, the dungeon's spawn record), facing the
// terrace, with no fight state, no quarter, no bar, no root and no centre
// stacks.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  loadAccountFlair: vi.fn(async () => null),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { GameServer } from '../server/game';
import { HEART_ROOM } from '../src/sim/content/smith_heart_layout';
import { HEART_QUARTER_ORDER } from '../src/sim/content/smith_heart_quarters';
import { finalBoss } from '../src/sim/encounters/smith_heart';
import { FINAL_AURAS, overloadAuraId } from '../src/sim/encounters/smith_heart/final_ids';
import type { Entity } from '../src/sim/types';
import { type FinalFight, finalFight } from './helpers/final_fight';

const sec = (s: number) => Math.round(s * 20);

const RULE_AURAS = [
  FINAL_AURAS.state,
  FINAL_AURAS.root,
  FINAL_AURAS.unbound,
  ...HEART_QUARTER_ORDER.map(overloadAuraId),
];

/** He stands home, whole, out of his fight, with nothing of it left. */
function expectHome(boss: Entity, local: { x: number; z: number }, home: { x: number; z: number }) {
  expect(Math.hypot(local.x - HEART_ROOM.x, local.z - HEART_ROOM.z), 'not home').toBeLessThan(0.6);
  expect(Math.hypot(boss.spawnPos.x - home.x, boss.spawnPos.z - home.z), 'home moved').toBeLessThan(
    1e-6,
  );
  expect(boss.smithHeartFinal).toBeUndefined();
  expect(boss.hp).toBe(boss.maxHp);
  expect(boss.inCombat).toBe(false);
  for (const id of RULE_AURAS)
    expect(
      boss.auras.some((a) => a.id === id),
      id,
    ).toBe(false);
}

/** Wait (up to `limit` s) for him to stand home out of his fight. */
function settle(f: FinalFight, limit = 40): void {
  for (let i = 0; i < sec(limit); i++) {
    const b = f.boss();
    if (!b.inCombat && b.aiState === 'idle' && !b.smithHeartFinal) {
      const at = f.local(b);
      if (Math.hypot(at.x - HEART_ROOM.x, at.z - HEART_ROOM.z) < 0.6) return;
    }
    f.tick(1, false);
  }
}

describe('the Masterless Strength goes home (offline)', () => {
  const home = (f: FinalFight) => {
    const b = f.boss();
    return { x: b.spawnPos.x, z: b.spawnPos.z };
  };

  it('starts on his authored home in the middle of the Anvil', () => {
    const f = finalFight(5);
    const at = f.local(f.boss());
    expect(Math.hypot(at.x - HEART_ROOM.x, at.z - HEART_ROOM.z)).toBeLessThan(0.6);
  });

  it('a quarter move out of his fight, then a reset: home', () => {
    const f = finalFight(5);
    const h = home(f);
    f.dev('/dev heart final quarter heat');
    f.tick(2);
    f.dev('/dev heart final reset');
    f.tick(2);
    expectHome(f.boss(), f.local(f.boss()), h);
  });

  it('pulled, moved round the quarters, filled and rooted, then reset mid-root: home and clean', () => {
    const f = finalFight(5);
    const h = home(f);
    f.pullIn('breath');
    f.dev('/dev heart final quarter hammer');
    f.dev('/dev heart final fill all 70');
    f.dev('/dev heart final root');
    f.tick(sec(2));
    expect(f.state()?.rootLeft).toBeGreaterThan(0);
    f.dev('/dev heart final reset');
    f.tick(2);
    expectHome(f.boss(), f.local(f.boss()), h);
  });

  it('dragged into the ring and stacking Heart Unbound, then reset: home and clean', () => {
    const f = finalFight(5);
    const h = home(f);
    f.pullIn('quench');
    f.dev('/dev heart final quarter ring');
    f.gather(HEART_ROOM.x + 3, HEART_ROOM.z, 2);
    f.tick(sec(3));
    expect(f.state()?.unbound ?? 0).toBeGreaterThan(0);
    // The raid steps back out of reach (else the reset is pulled at once).
    for (const p of f.players) f.put(p, 125, 110);
    f.dev('/dev heart final reset');
    f.tick(2);
    expectHome(f.boss(), f.local(f.boss()), h);
  });

  it('moved to a quarter in his fight, then the raid wipes: he walks home and stands clean', () => {
    const f = finalFight(5);
    const h = home(f);
    f.pullIn('heat');
    f.dev('/dev heart final quarter hammer');
    f.dev('/dev heart final fill hammer 60');
    f.tick(sec(3));
    // The raid dies.
    for (const p of f.players) {
      p.hp = 1;
      f.sim.ctx.dealDamage(f.boss(), p, 999999, false, 'physical', 'Strike', 'hit', true);
    }
    settle(f);
    expectHome(f.boss(), f.local(f.boss()), h);
  });

  it('a quarter move out of his fight, a pull, then the raid runs out: home', () => {
    const f = finalFight(5);
    const h = home(f);
    f.dev('/dev heart final quarter quench');
    f.dev('/dev heart final pull');
    f.tick(sec(3));
    for (const p of f.players) f.put(p, 125, 110);
    // Out of reach on the terrace: the fight is given up.
    f.dev('/dev heart final reset');
    settle(f);
    expectHome(f.boss(), f.local(f.boss()), h);
    // And the next pull starts fresh: no stale quarter or bar.
    f.gather(HEART_ROOM.x, HEART_ROOM.z + 8, 3);
    f.dev('/dev heart final pull');
    f.tick(2);
    const st = f.state();
    expect(st?.zone).toBe('ring');
    expect(st?.lastQuarter).toBeNull();
    for (const v of HEART_QUARTER_ORDER) expect(st?.overload[v]).toBe(0);
  });
});

// ---- online ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: the in-process server idiom (afk_wire.test.ts)
type Any = any;

describe('the Masterless Strength goes home (online, the server chat path)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_700_000_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('quarter, fill, pull, quarter, reset over the wire: home and clean', () => {
    const saved = process.env.ALLOW_DEV_COMMANDS;
    process.env.ALLOW_DEV_COMMANDS = '1';
    let server: Any;
    try {
      server = new GameServer();
    } finally {
      if (saved === undefined) delete process.env.ALLOW_DEV_COMMANDS;
      else process.env.ALLOW_DEV_COMMANDS = saved;
    }
    const sim = server.sim;
    const ws = { readyState: 1, bufferedAmount: 0, send: () => {}, close: () => {} };
    const session = server.join(ws, 1, 1, 'Tank', 'warrior', null, false, {});
    if ('error' in session) throw new Error(session.error);
    session.blockListLoaded = true;
    const pid = session.pid as number;
    sim.setPlayerLevel(20, pid);
    const say = (text: string) => {
      server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'chat', text }));
      // A second and a half between lines: inside the chat lane's budget.
      for (let i = 0; i < 30; i++) {
        vi.advanceTimersByTime(50);
        server.routeEvents(sim.tick());
        server.broadcastSnapshots();
      }
    };
    say('/dev heart enter');
    say('/dev heart tp final');
    say('/dev god');
    const inst = sim.ctx.instances.find((i: Any) => i.partyKey !== null && i.mobIds.length > 0);
    const boss = finalBoss(sim.ctx, inst) as Entity;
    const o = sim.ctx.instanceOriginOf(inst);
    const home = { x: boss.spawnPos.x, z: boss.spawnPos.z };
    expect(Math.hypot(home.x - o.x - HEART_ROOM.x, home.z - o.z - HEART_ROOM.z)).toBeLessThan(0.6);
    say('/dev heart final quarter breath');
    say('/dev heart final fill all 50');
    say('/dev heart final pull');
    say('/dev heart final quarter heat');
    say('/dev heart final reset');
    const local = { x: boss.pos.x - o.x, z: boss.pos.z - o.z };
    expectHome(boss, local, home);
  });
});
