// The Guardian of the Heat's Live Coals over a REAL Sim claim (heat_coal.ts;
// the owner's design of 2026-11-24): Heroic and Mythic only, two non-tanks
// every 50 s of fighting, a heal absorb plus a burn, healed through it goes out,
// within 2 yd it leaps with what it has left (no ping-pong), unhealed it bursts
// round its bearer; never in an overflow, never as a Wheel begins.

import { describe, expect, it } from 'vitest';
import { applyHeal } from '../src/sim/combat/heal';
import {
  HEAT_AURAS,
  HEAT_CUES,
  HEAT_DIFFICULTY,
  HEAT_NAMES,
  HEAT_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import { coalAbsorb, coalHoldsWheel } from '../src/sim/encounters/smith_heart/heat_coal';
import { addThreat } from '../src/sim/threat';
import type { Aura, Entity, SimEvent } from '../src/sim/types';
import { hitsOf } from './helpers/council_fight';
import { type HeatFight, heatFight } from './helpers/heat_fight';

const ticks = (s: number) => Math.round(s * 20);
const H = HEAT_DIFFICULTY.heroic;

/** A pulled fight on `tier` in phase 2, every other clock held, the
 *  players spread 6 yd apart along the shore (none within a leap). */
function fight(tier: 'normal' | 'heroic' | 'mythic' = 'heroic', n = 6, seed = 31): HeatFight {
  const f = heatFight(n, seed);
  f.dev('/dev heart heat pull');
  if (tier !== 'normal') f.dev(`/dev heart heat ${tier}`);
  f.dev('/dev heart heat phase 2');
  const st = f.state();
  if (!st) throw new Error('no fight');
  st.seedTimer = 999;
  st.zoneTimer = 999;
  st.cinderTimer = 999;
  st.fistTimer = 999;
  st.wheelTimer = 999;
  st.flareTimer = 999;
  spread(f);
  return f;
}

/** `n` ticks, the tanks and the pools held each one. */
function run(f: HeatFight, n = 1): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    tanks(f);
    out.push(...f.tick());
  }
  return out;
}

function spread(f: HeatFight): void {
  f.players.forEach((p, i) => {
    f.put(p, -204, -15 + i * 6);
  });
}

const coalOf = (p: Entity): Aura | undefined => p.auras.find((a) => a.id === HEAT_AURAS.coal);
const bearers = (f: HeatFight) => f.players.filter((p) => coalOf(p));

/** Hold the boss's target on player 0 and Cinder Grip on player 1 (and
 *  every pool big: a stat refresh hands the level-1 raiders theirs back). */
function tanks(f: HeatFight): void {
  // Player 0 tops the threat table, so the mob AI keeps the guardian on it.
  addThreat(f.boss(), f.players[0].id, 1e9);
  for (const p of f.players) {
    p.maxHp = 50000;
    p.hp = Math.max(p.hp, 40000);
  }
  f.boss().aggroTargetId = f.players[0].id;
  if (!f.players[1].auras.some((a) => a.id === HEAT_AURAS.grip))
    f.players[1].auras.push({
      id: HEAT_AURAS.grip,
      name: HEAT_NAMES.grip,
      kind: 'dot',
      remaining: 999,
      duration: 999,
      value: 9,
      stacks: 2,
      sourceId: f.boss().id,
      school: 'fire',
    } as Aura);
}

/** Run until the first coals are set (tanks held every tick). */
function untilSet(f: HeatFight, max = 30): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks(max); i++) {
    tanks(f);
    out.push(...f.tick());
    if (bearers(f).length > 0) return out;
  }
  return out;
}

describe('Live Coal: who and when', () => {
  it('Heroic sets two coals on non-tanks at its first mark, a heal absorb of about 600', () => {
    const f = fight('heroic');
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.coalTimer = 1;
    const ev = untilSet(f, 3);
    const on = bearers(f);
    expect(on).toHaveLength(T.coalTargets);
    for (const p of on) {
      expect(p.id).not.toBe(f.players[0].id);
      expect(p.id).not.toBe(f.players[1].id);
      const a = coalOf(p) as Aura;
      expect(a.kind).toBe('heal_absorb');
      expect(a.name).toBe(HEAT_NAMES.coal);
      expect(a.value).toBe(Math.round(T.coalAbsorb * H.damageMult));
      expect(a.value).toBeGreaterThanOrEqual(580);
      expect(a.value).toBeLessThanOrEqual(620);
      expect(a.value2).toBe(a.value);
      expect(a.undispellable).toBe(true);
    }
    expect(
      ev.filter(
        (e) => e.type === 'spellfx' && (e as { ability?: string }).ability === HEAT_CUES.coal,
      ),
    ).toHaveLength(2);
    expect(st.coalTimer).toBeCloseTo(T.coalEvery, 1);
  });

  it('never takes a tank whose Cinder Grip ran out between swaps', () => {
    const f = fight('heroic', 4);
    const st = f.state();
    if (!st) throw new Error('no fight');
    tanks(f);
    // Player 0 holds the guardian with its own stacks.
    f.players[0].auras.push({
      ...(f.players[1].auras.find((a) => a.id === HEAT_AURAS.grip) as Aura),
    });
    run(f);
    // Player 1's stacks run out; four players, two tanks: only 2 and 3 may take it.
    f.players[1].auras = f.players[1].auras.filter((a) => a.id !== HEAT_AURAS.grip);
    f.boss().aggroTargetId = f.players[0].id;
    st.coalTimer = 0.05;
    for (let i = 0; i < 3; i++) {
      f.boss().aggroTargetId = f.players[0].id;
      f.tick();
    }
    expect(st.gripWorn).toContain(f.players[1].id);
    const on = bearers(f).map((p) => p.id);
    expect(on.length).toBeGreaterThan(0);
    expect(on).not.toContain(f.players[0].id);
    expect(on).not.toContain(f.players[1].id);
  });

  it('Normal never sets one', () => {
    const f = fight('normal');
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.coalTimer = 0.5;
    untilSet(f, 5);
    expect(bearers(f)).toHaveLength(0);
    expect(coalAbsorb({ rules: HEAT_DIFFICULTY.normal, boss: f.boss() })).toBeGreaterThan(0);
  });

  it('Mythic sets them like Heroic', () => {
    const f = fight('mythic');
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.coalTimer = 0.5;
    untilSet(f, 3);
    expect(bearers(f)).toHaveLength(2);
  });

  it('the picks are deterministic for a seed', () => {
    const ids = (seed: number) => {
      const f = fight('heroic', 6, seed);
      const st = f.state();
      if (!st) throw new Error('no fight');
      st.coalTimer = 0.5;
      untilSet(f, 3);
      return bearers(f).map((p) => f.players.indexOf(p));
    };
    expect(ids(31)).toEqual(ids(31));
  });

  it('waits out a Wheel on the floor or due soon, and a Wheel waits after a set', () => {
    const f = fight('heroic');
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.coalTimer = 0.5;
    st.wheelTimer = T.coalWheelGap - 1;
    for (let i = 0; i < ticks(1.5); i++) run(f);
    expect(bearers(f)).toHaveLength(0);
    // The Wheel starts and runs: still nothing set while it is on the floor.
    let sawWheel = false;
    for (let i = 0; i < ticks(30) && bearers(f).length === 0; i++) {
      tanks(f);
      run(f);
      if (st.wheelRounds.length > 0) {
        sawWheel = true;
        expect(bearers(f)).toHaveLength(0);
      }
    }
    expect(sawWheel).toBe(true);
    expect(bearers(f).length).toBeGreaterThan(0);
    // Just set: a due Wheel holds.
    expect(coalHoldsWheel(st)).toBe(true);
    st.wheelTimer = 0;
    run(f);
    expect(st.wheelRounds).toHaveLength(0);
    for (let i = 0; i < ticks(T.coalWheelGap + 0.2); i++) run(f);
    expect(st.wheelRounds.length).toBeGreaterThan(0);
  });

  it('its clock stands still in an overflow, and an overflow puts every coal out', () => {
    const f = fight('heroic');
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.coalTimer = 0.5;
    untilSet(f, 3);
    expect(bearers(f)).toHaveLength(2);
    st.coalTimer = 0.2;
    const ev: SimEvent[] = [];
    f.dev('/dev heart heat overflow');
    expect(st.coals).toHaveLength(0);
    expect(bearers(f)).toHaveLength(0);
    for (let i = 0; i < ticks(15); i++) ev.push(...f.tick());
    expect(st.stage).not.toBe('fight');
    expect(bearers(f)).toHaveLength(0);
    expect(st.coalTimer).toBeCloseTo(0.2, 5);
    expect(hitsOf(ev, HEAT_NAMES.coalBurst)).toHaveLength(0);
  });
});

describe('Live Coal: the burn, healing through, the leap, the burst', () => {
  function setOne(f: HeatFight): Entity {
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.coalTimer = 0.05;
    untilSet(f, 2);
    // Keep one coal only: the test watches it alone.
    const [a, b] = bearers(f);
    if (b) {
      b.auras = b.auras.filter((x) => x.id !== HEAT_AURAS.coal);
      st.coals = st.coals.filter((c) => c.pid !== b.id);
    }
    return a;
  }

  it('burns its bearer every second', () => {
    const f = fight('heroic');
    const p = setOne(f);
    const ev = run(f, ticks(3.05));
    const burns = hitsOf(ev, HEAT_NAMES.coal, p.id);
    expect(burns.length).toBe(3);
    for (const n of burns) {
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThanOrEqual(Math.ceil(T.coalBurnMax * H.damageMult));
    }
  });

  it('healing through the absorb puts it out: no burst', () => {
    const f = fight('heroic');
    const st = f.state();
    if (!st) throw new Error('no fight');
    const p = setOne(f);
    const healer = f.players.find((q) => q !== p) as Entity;
    const a = coalOf(p) as Aura;
    applyHeal(f.sim.ctx, healer, p, a.value - 100, 'Test Heal', null, false);
    expect(coalOf(p)?.value).toBe(100);
    applyHeal(f.sim.ctx, healer, p, 400, 'Test Heal', null, false);
    expect(coalOf(p)).toBeUndefined();
    const ev = run(f, ticks(T.coalSeconds + 1));
    expect(st.coalOuts).toBe(1);
    expect(st.coals).toHaveLength(0);
    expect(hitsOf(ev, HEAT_NAMES.coalBurst)).toHaveLength(0);
    expect(hitsOf(ev, HEAT_NAMES.coal, p.id)).toHaveLength(0);
  });

  it('leaps within 2 yd with the absorb it has left and its fuse, striking the taker', () => {
    const f = fight('heroic');
    const st = f.state();
    if (!st) throw new Error('no fight');
    const p = setOne(f);
    const healer = f.players.find((q) => q !== p && !coalOf(q)) as Entity;
    applyHeal(f.sim.ctx, healer, p, 200, 'Test Heal', null, false);
    const left = (coalOf(p) as Aura).value;
    run(f, ticks(2));
    const fuse = st.coals[0].fuse;
    // Someone walks into it (1.5 yd).
    const taker = f.players.find(
      (q) => q !== p && q !== f.players[0] && q !== f.players[1] && !coalOf(q),
    ) as Entity;
    // A level-20 pool: the coal's aura refreshes the taker's stats.
    taker.level = 20;
    const here = f.local(p);
    f.put(taker, here.x + 1.5, here.z);
    const ev = run(f);
    expect(coalOf(p)).toBeUndefined();
    const moved = coalOf(taker) as Aura;
    expect(moved.value).toBe(left);
    expect(moved.value2).toBe(coalAbsorb({ rules: H, boss: f.boss() }));
    expect(st.coals[0].pid).toBe(taker.id);
    expect(st.coals[0].fuse).toBeCloseTo(fuse - 1 / 20, 5);
    expect(st.coalLeaps).toBe(1);
    const hit = hitsOf(ev, HEAT_NAMES.coal, taker.id);
    expect(hit.length).toBeGreaterThanOrEqual(1);
    expect(Math.max(...hit)).toBeGreaterThanOrEqual(Math.floor(T.coalLeapMin * H.damageMult) - 1);
    // Standing together: no leap back inside the grace, nor to the old bearer
    // before its own grace lapses.
    run(f, ticks(T.coalGrace + 0.5));
    expect(st.coals[0].pid).toBe(taker.id);
    expect(st.coalLeaps).toBe(1);
  });

  it('rests a breath after it is set: a clumped neighbour can step away first', () => {
    const f = fight('heroic');
    const st = f.state();
    if (!st) throw new Error('no fight');
    const p = setOne(f);
    const near = f.players.find(
      (q) => q !== p && q !== f.players[0] && q !== f.players[1] && !coalOf(q),
    ) as Entity;
    near.level = 20;
    const here = f.local(p);
    f.put(near, here.x + 1, here.z);
    run(f, ticks(T.coalGrace - 0.3));
    expect(st.coals[0].pid).toBe(p.id);
    run(f, ticks(0.6));
    expect(st.coals[0].pid).toBe(near.id);
  });

  it('bursts at the fuse on everyone within its reach, the bearer too, never a whole cloth health', () => {
    const f = fight('heroic');
    const st = f.state();
    if (!st) throw new Error('no fight');
    const p = setOne(f);
    // One close (5 yd, out of a leap), one far (10 yd).
    const here = f.local(p);
    const others = f.players.filter((q) => q !== p && !coalOf(q));
    const near = others[0];
    const far = others[1];
    f.put(near, here.x, here.z + 5);
    f.put(far, here.x, here.z + 10);
    for (const q of others.slice(2)) f.put(q, here.x - 20, here.z);
    const ev = run(f, ticks(T.coalSeconds + 0.2));
    expect(st.coalBursts).toBe(1);
    expect(coalOf(p)).toBeUndefined();
    const onBearer = hitsOf(ev, HEAT_NAMES.coalBurst, p.id);
    const onNear = hitsOf(ev, HEAT_NAMES.coalBurst, near.id);
    expect(onBearer).toHaveLength(1);
    expect(onNear).toHaveLength(1);
    expect(hitsOf(ev, HEAT_NAMES.coalBurst, far.id)).toHaveLength(0);
    for (const n of [...onBearer, ...onNear]) {
      expect(n).toBeGreaterThanOrEqual(Math.floor(T.coalBurstMin * H.punishMult) - 1);
      expect(n).toBeLessThanOrEqual(Math.ceil(T.coalBurstMax * H.punishMult));
      // Under a level-20 cloth wearer's whole health (about 1,135 to 1,345).
      expect(n).toBeLessThan(1135);
    }
    expect(
      ev.some(
        (e) =>
          e.type === 'spellfxAt' && (e as { ability?: string }).ability === HEAT_CUES.coalBurst,
      ),
    ).toBe(true);
  });

  it('never goes straight back to the one it left, nor onto a tank', () => {
    const f = fight('heroic');
    const st = f.state();
    if (!st) throw new Error('no fight');
    const p = setOne(f);
    const q = f.players.find(
      (x) => x !== p && x !== f.players[0] && x !== f.players[1] && !coalOf(x),
    ) as Entity;
    q.level = 20;
    p.level = 20;
    run(f, ticks(T.coalGrace + 0.1));
    const here = f.local(p);
    f.put(q, here.x + 1, here.z);
    run(f);
    expect(st.coals[0].pid).toBe(q.id);
    // Both stand together past the leap grace but inside the back grace.
    run(f, ticks(T.coalGrace + 0.5));
    expect(st.coals[0].pid).toBe(q.id);
    expect(st.coals[0].prevGrace).toBeGreaterThan(0);
    // A tank walks right into the bearer: it stays.
    const tank = f.players[1];
    tank.level = 20;
    const there = f.local(q);
    f.put(p, there.x - 15, there.z);
    f.put(tank, there.x, there.z + 1);
    run(f, ticks(T.coalBackGrace));
    expect(st.coals[0].pid).toBe(q.id);
    expect(coalOf(tank)).toBeUndefined();
  });

  it('goes with its bearer at death; carried off the floor alive it bursts', () => {
    const f = fight('heroic');
    const st = f.state();
    if (!st) throw new Error('no fight');
    const p = setOne(f);
    p.hp = 0;
    p.dead = true;
    f.tick();
    expect(st.coals).toHaveLength(0);
    expect(st.coalBursts).toBe(0);
    expect(coalOf(p)).toBeUndefined();
    const g = fight('heroic', 6, 37);
    const gs = g.state();
    if (!gs) throw new Error('no fight');
    const b = setOne(g);
    b.level = 20;
    g.put(b, -150, 0);
    const ev = run(g, 2);
    expect(gs.coalBursts).toBe(1);
    expect(coalOf(b)).toBeUndefined();
    expect(hitsOf(ev, HEAT_NAMES.coalBurst, b.id).length).toBeGreaterThanOrEqual(1);
  });

  it('the aura shows the fuse and never lapses before the module resolves it', () => {
    const f = fight('heroic');
    const p = setOne(f);
    run(f, ticks(5));
    const a = coalOf(p) as Aura;
    expect(a.remaining).toBeGreaterThan(T.coalSeconds - 5.2);
    expect(a.remaining).toBeLessThan(T.coalSeconds - 4.8);
    expect(a.duration).toBe(T.coalSeconds);
  });

  it('a wipe clears every coal', () => {
    const f = fight('heroic');
    setOne(f);
    f.dev('/dev heart heat reset');
    expect(bearers(f)).toHaveLength(0);
  });
});
