// The Masterless Strength's drag (encounters/smith_heart/final_rules.ts,
// design doc 7.5; Jose's playtest of 28 Oct 2026: "it is hard to move the
// boss, many times it stands still"). Over a REAL Sim with the raid WALKING
// (its real move input, colliders and all, never a teleport): once its root
// ends the boss follows its tank over every ridge, at several radii and both
// ways round, promptly; a bar in flight plants it only for that bar; no
// planted bar begins while it is being dragged; a dip into the central ring
// and back out into the same quarter never roots it again. The online path:
// the same drag driven through the authoritative server's own input frames.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SmithHeartVein } from '../src/sim/content/smith_heart_layout';
import { HEART_ROOM } from '../src/sim/content/smith_heart_layout';
import {
  HEART_QUARTER_ORDER,
  heartQuarterAt,
  heartQuarterSpot,
  heartRidgeBearingDeg,
} from '../src/sim/content/smith_heart_quarters';
import {
  FINAL_AURAS,
  FINAL_CUES,
  FINAL_DIFFICULTY,
  FINAL_TUNING as T,
} from '../src/sim/encounters/smith_heart/final_ids';
import type { Entity, SimEvent } from '../src/sim/types';
import { type FinalFight, finalFight } from './helpers/final_fight';

const sec = (s: number) => Math.round(s * 20);
const DEG = Math.PI / 180;

/** A point `past` yards beyond ridge `k` at radius `r`, on the clockwise
 *  side (`cw`) or the counter-clockwise one. */
function pastRidge(k: number, r: number, past: number, cw: boolean): { x: number; z: number } {
  const b = heartRidgeBearingDeg(k, r) * DEG + ((cw ? 1 : -1) * past) / r;
  return { x: HEART_ROOM.x + Math.sin(b) * r, z: HEART_ROOM.z + Math.cos(b) * r };
}

/** One tick of the whole raid walking to `goal` (the tank on it, the rest in
 *  a small ring round it, as a raid follows its tank). */
function raidWalk(f: FinalFight, goal: { x: number; z: number }): boolean {
  let arrived = true;
  f.players.forEach((p, i) => {
    if (i === 0) return;
    const a = (i / f.players.length) * Math.PI * 2;
    const meta = f.sim.ctx.players.get(p.id);
    if (!meta) return;
    const here = f.local(p);
    const tx = goal.x + Math.sin(a) * 3;
    const tz = goal.z + Math.cos(a) * 3;
    const d = Math.hypot(tx - here.x, tz - here.z);
    meta.moveInput.forward = d > 1;
    if (d > 1) p.facing = Math.atan2(tx - here.x, tz - here.z);
  });
  arrived = f.walkStep(f.players[0], goal.x, goal.z);
  return arrived;
}

/** One tick of the raid walking to `goal` (the tank in front), its events. */
function raidWalkEvents(f: FinalFight, goal: { x: number; z: number }): SimEvent[] {
  f.players.forEach((p, i) => {
    const a = (i / f.players.length) * Math.PI * 2;
    const meta = f.sim.ctx.players.get(p.id);
    if (!meta) return;
    const here = f.local(p);
    const tx = i === 0 ? goal.x : goal.x + Math.sin(a) * 3;
    const tz = i === 0 ? goal.z : goal.z + Math.cos(a) * 3;
    const d = Math.hypot(tx - here.x, tz - here.z);
    meta.moveInput.forward = d > 1;
    if (d > 1) p.facing = Math.atan2(tx - here.x, tz - here.z);
  });
  return f.tick(1);
}

interface DragResult {
  /** Seconds from the drag's start until the boss's zone was `to`. */
  seconds: number;
  /** Seconds the boss stood still, free (no root, no bar) while its tank
   *  stood in another zone. */
  stuck: number;
  /** Planted bars begun while it was being dragged. */
  barsWhileDragged: number;
}

function drag(f: FinalFight, goal: { x: number; z: number }, to: SmithHeartVein, limit = 20) {
  const r: DragResult = { seconds: -1, stuck: 0, barsWhileDragged: 0 };
  for (let t = 0; t < sec(limit); t++) {
    const before = f.local(f.boss());
    const hadBar = f.state()?.bar !== null;
    raidWalk(f, goal);
    const st = f.state();
    if (!st) break;
    if (st.zone === to) {
      r.seconds = t / 20;
      break;
    }
    const tank = f.local(f.players[0]);
    const after = f.local(f.boss());
    const dragged = heartQuarterAt(tank.x, tank.z) !== st.zone;
    if (dragged && !hadBar && st.bar !== null) r.barsWhileDragged++;
    const moved = Math.hypot(after.x - before.x, after.z - before.z) > 1e-3;
    if (dragged && st.bar === null && !moved) r.stuck += 1 / 20;
  }
  return r;
}

describe('dragging the Masterless Strength (offline, the raid walking)', () => {
  // Every ridge, both ways round, at three radii (near the ring, the middle,
  // near the rim): the tank stops only six yards past the ridge.
  const RADII = [22, 34, 46];
  for (let k = 0; k < 4; k++)
    for (const cw of [true, false]) {
      const from = HEART_QUARTER_ORDER[cw ? k : (k + 1) % 4];
      const to = HEART_QUARTER_ORDER[cw ? (k + 1) % 4 : k];
      const r = RADII[(k + (cw ? 0 : 1)) % 3];
      it(`follows its tank from the ${from} over ridge ${k} into the ${to} at ${r} yd`, () => {
        const f = finalFight(5, 41 + k);
        f.pullIn(from);
        const goal = pastRidge(k, r, 6, cw);
        const start = f.local(f.boss());
        const path = Math.hypot(goal.x - start.x, goal.z - start.z);
        const res = drag(f, goal, to);
        // Promptly: about its walk over (it runs as fast as its tank), plus
        // the one bar it may already have had in flight, plus a breath.
        expect(res.seconds, 'never followed').toBeGreaterThanOrEqual(0);
        // (Weight of the Anvil, its own all fight since 2026-11-18, is the
        // longest bar that may be in flight: 6 s.)
        expect(res.seconds).toBeLessThan(
          path / 7 + Math.max(FINAL_DIFFICULTY.normal.fistCast, T.anvilCast) + 3,
        );
        expect(res.stuck).toBeLessThan(0.5);
        expect(res.barsWhileDragged).toBe(0);
        // And it never took root there (2026-11-19).
        expect(f.boss().auras.some((a) => a.kind === 'root')).toBe(false);
      });
    }

  it('a bar in flight plants it for that bar only, then it follows at once', () => {
    const f = finalFight(5, 43);
    f.pullIn('breath');
    f.dev('/dev heart final bolt');
    f.tick(1);
    expect(f.state()?.bar).not.toBeNull();
    const goal = pastRidge(0, 30, 6, true);
    const res = drag(f, goal, 'quench');
    expect(res.seconds).toBeGreaterThanOrEqual(0);
    expect(res.seconds).toBeLessThan(T.boltCast + 30 / 7 + 3);
    expect(res.stuck).toBeLessThan(0.5);
  });

  it('no planted bar begins while it is dragged, even one due the moment the drag starts', () => {
    for (const vein of ['heat', 'breath', 'hammer'] as const) {
      const f = finalFight(5, 44);
      f.pullIn(vein);
      // Every planted bar due the moment the drag begins.
      for (let i = 0; i < sec(1); i++) {
        const st = f.state();
        if (st) {
          st.kit.fist = 0.05;
          st.kit.bolt = 0.05;
          st.anvilClock = 0.05;
          st.bar = null;
          st.gap = 0;
          f.boss().castingAbility = null;
        }
        f.tick(1);
      }
      const i = HEART_QUARTER_ORDER.indexOf(vein);
      const to = HEART_QUARTER_ORDER[(i + 1) % 4];
      const res = drag(f, pastRidge(i, 34, 6, true), to);
      expect(res.seconds, vein).toBeGreaterThanOrEqual(0);
      expect(res.barsWhileDragged, vein).toBe(0);
    }
  });

  it('a dip into the ring and back out into the same quarter is no new quarter', () => {
    const f = finalFight(5, 45);
    f.pullIn('heat');
    // Its own Weight of the Anvil (all fight since 2026-11-18) held off: this
    // pins the quarter rule, not a bar planted in the ring.
    const st0 = f.state();
    if (st0) st0.anvilClock = 1e9;
    const clocks = { ...f.state()?.kit };
    const firstFist = clocks.fist;
    // Into the ring, straight in along the Heat's own middle (since its body
    // grew on 2026-11-25 it settles close on its tank, so a line off that
    // middle would carry it over the Breath's ridge on the way: another
    // quarter, not this pin's dip)...
    const home = heartQuarterSpot('heat');
    const hd = Math.hypot(home.x - HEART_ROOM.x, home.z - HEART_ROOM.z);
    const centre = {
      x: HEART_ROOM.x + ((home.x - HEART_ROOM.x) / hd) * 4,
      z: HEART_ROOM.z + ((home.z - HEART_ROOM.z) / hd) * 4,
    };
    let inRing = false;
    for (let t = 0; t < sec(20) && !inRing; t++) {
      raidWalk(f, centre);
      inRing = f.state()?.zone === 'ring';
    }
    expect(inRing).toBe(true);
    // ...and straight back out into the Heat.
    const back = heartQuarterSpot('heat');
    for (let t = 0; t < sec(12); t++) raidWalk(f, back);
    const st = f.state();
    expect(st?.zone).toBe('heat');
    expect(st?.switches).toBe(0);
    expect(f.boss().auras.some((a) => a.kind === 'root')).toBe(false);
    // Its kit kept counting (no fresh clocks for the same quarter).
    expect(st?.kit.fist).not.toBe(firstFist === undefined ? -1 : T.fistFirst);
  });

  it('dragged from a quarter through the ring into the opposite one, it follows all the way', () => {
    const f = finalFight(5, 46);
    f.pullIn('heat');
    const goal = heartQuarterSpot('quench');
    const res = drag(f, goal, 'quench', 30);
    expect(res.seconds).toBeGreaterThanOrEqual(0);
    expect(res.stuck).toBeLessThan(0.5);
  });
});

// ---- the online path ---------------------------------------------------------------------

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
import { finalBoss } from '../src/sim/encounters/smith_heart';

// biome-ignore lint/suspicious/noExplicitAny: the in-process server idiom (afk_wire.test.ts)
type Any = any;

describe('dragging the Masterless Strength online (the server input path)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_700_000_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a solo tank walking by its own input frames drags it over a ridge once its root ends', () => {
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
    sim.chat('/dev heart enter', pid);
    sim.chat('/dev heart tp final', pid);
    sim.chat('/dev god', pid);
    sim.chat('/dev heart final quarter heat', pid);
    sim.chat('/dev heart final pull', pid);
    const me: Entity = sim.entities.get(pid);
    const inst = sim.ctx.instances.find((i: Any) => i.partyKey !== null && i.mobIds.length > 0);
    const boss = finalBoss(sim.ctx, inst) as Entity;
    const o = sim.ctx.instanceOriginOf(inst);
    const local = (e: Entity) => ({ x: e.pos.x - o.x, z: e.pos.z - o.z });
    let seq = 1;
    const step = (goal: { x: number; z: number } | null) => {
      if (goal) {
        const here = local(me);
        const d = Math.hypot(goal.x - here.x, goal.z - here.z);
        const facing = Math.atan2(goal.x - here.x, goal.z - here.z);
        server.handleMessage(
          session,
          JSON.stringify({ t: 'input', seq: seq++, mi: { f: d > 1 ? 1 : 0 }, facing }),
        );
      }
      vi.advanceTimersByTime(50);
      server.routeEvents(sim.tick());
      server.broadcastSnapshots();
    };
    // A breath with the tank beside it (no root to wait out since 2026-11-19).
    for (let i = 0; i < sec(1); i++) step(null);
    expect(boss.smithHeartFinal?.zone).toBe('heat');
    // Heat to Breath over ridge 3 (Heat is the last of the bearing order).
    const k = HEART_QUARTER_ORDER.indexOf('heat');
    const goal = pastRidge(k, 30, 6, true);
    let seconds = -1;
    for (let t = 0; t < sec(20); t++) {
      step(goal);
      if (boss.smithHeartFinal?.zone === 'breath') {
        seconds = t / 20;
        break;
      }
    }
    expect(seconds, 'never followed online').toBeGreaterThanOrEqual(0);
    expect(seconds).toBeLessThan(12);
  });
});

describe('no Taking Root (Jose playtest of 2026-11-19: very annoying when you want to move it)', () => {
  it('never roots: from the pull its tank drags it straight into the next quarter', () => {
    const f = finalFight(5, 7);
    f.pullIn('heat');
    expect(f.boss().auras.some((a) => a.kind === 'root')).toBe(false);
    const goal = heartQuarterSpot('quench');
    const start = f.local(f.boss());
    let stillFor = 0;
    let moved = false;
    for (let i = 0; i < 20 * 12 && !moved; i++) {
      f.walkStep(f.players[0], goal.x, goal.z, 2);
      const here = f.local(f.boss());
      if (Math.hypot(here.x - start.x, here.z - start.z) > 0.5) moved = true;
      else stillFor++;
    }
    expect(moved).toBe(true);
    // Only its first planted bar (if one was in flight) may hold it, never a root.
    expect(stillFor / 20).toBeLessThan(T.anvilCast + 0.5);
  });

  it('dragged fast across the quarters, each crossing counts once: no flicker, no opener spam', () => {
    const f = finalFight(5, 9);
    f.pullIn('breath');
    const st = f.state();
    if (!st) throw new Error('no fight');
    // Its bars held off: this pins the crossings, not a planted bar.
    st.anvilClock = 1e9;
    const shifts: string[] = [];
    let entered = 0;
    let last = st.zone;
    const order = ['quench', 'hammer', 'heat', 'breath', 'quench'] as const;
    for (const vein of order) {
      const k = HEART_QUARTER_ORDER.indexOf(vein);
      const goal = heartQuarterSpot(HEART_QUARTER_ORDER[k]);
      for (let t = 0; t < sec(14) && st.zone !== vein; t++) {
        st.kit.fist = 99;
        st.kit.bolt = 99;
        st.kit.ice = 99;
        st.kit.tremor = 99;
        st.kit.devil = 99;
        for (const e of raidWalkEvents(f, goal))
          if (e.type === 'spellfx' && (e as { ability: string }).ability === FINAL_CUES.shift)
            shifts.push(st.zone);
        if (st.zone !== last && st.zone !== 'ring') entered++;
        if (st.zone !== 'ring') last = st.zone;
      }
      expect(st.zone, vein).toBe(vein);
    }
    // One opener (and one switch) per new quarter, never a flicker on a ridge.
    expect(st.switches).toBe(order.length);
    expect(shifts.length).toBe(order.length);
    expect(entered).toBe(order.length);
  });
});
