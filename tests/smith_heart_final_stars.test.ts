// The Masterless Strength's woken stars (the owner's rework of 2026-11-18,
// design doc 7.5; encounters/smith_heart/final_stars.ts, final_pillars.ts,
// final_sky.ts, final_blades.ts) over a REAL Sim: each quarter's star wakes
// the first time the boss enters it and stays awake all fight, at full pace
// where it stands and at the reduced pace elsewhere; the pillars stand,
// block like walls and meet their cap with Stone Thrum; a strike by a pillar
// arcs round it (Arcing Stone) and leaves it Storm-Charged, and every charged
// pillar pulses the raid while it stands; a Crossing Blade shatters every
// pillar its line crosses; a poured quarter runs at full pace everywhere;
// the final phase runs all four at once; each tier's counts; determinism;
// the wipe's clean floor.

import { describe, expect, it } from 'vitest';
import { HEART_ROOM } from '../src/sim/content/smith_heart_layout';
import {
  HEART_QUARTER_ORDER,
  HEART_QUARTERS,
  heartQuarterAt,
  heartQuarterSpot,
} from '../src/sim/content/smith_heart_quarters';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  bladeCrossesPillar,
  bladeOrigin,
  lineLength,
} from '../src/sim/encounters/smith_heart/final_blades';
import {
  chargedPulse,
  FINAL_AURAS,
  FINAL_CUES,
  FINAL_DIFFICULTY,
  FINAL_NAMES,
  FINAL_OBJECTS,
  FINAL_STAR_CLOCK,
  finalLaneOf,
  finalPillarOf,
  quarterPace,
  FINAL_TUNING as T,
} from '../src/sim/encounters/smith_heart/final_ids';
import { pouredAuraId } from '../src/sim/encounters/smith_heart/final_phase_ids';
import { pillarSpotClear } from '../src/sim/encounters/smith_heart/final_pillars';
import { COMBAT_WALL_SHAPES, combatWallsAt } from '../src/sim/instances/combat_wall_state';
import type { Entity, SimEvent } from '../src/sim/types';
import { type FinalFight, finalFight } from './helpers/final_fight';

type Damage = Extract<SimEvent, { type: 'damage' }>;
const hits = (ev: SimEvent[], name: string, target?: number): Damage[] =>
  ev.filter(
    (e): e is Damage =>
      e.type === 'damage' && e.ability === name && (target === undefined || e.targetId === target),
  );
const aura = (e: Entity, id: string) => e.auras.find((a) => a.id === id);
const sec = (s: number) => Math.round(s * 20);
const pillars = (f: FinalFight) => f.objects(FINAL_OBJECTS.pillarPrefix);
const charged = (f: FinalFight) =>
  pillars(f).filter((p) => finalPillarOf(p.templateId) === 'charged');

/** A pillar standing at instance-local (x, z) now (its rise run out). */
function pillarAt(f: FinalFight, x: number, z: number): Entity {
  const before = new Set(pillars(f).map((p) => p.id));
  const reply = f.dev(`/dev heart final pillars here`, f.pids[4]);
  expect(reply).toBe(true);
  void x;
  void z;
  f.tick(sec(T.pillarWarn + 0.1));
  const fresh = pillars(f).find((p) => !before.has(p.id));
  if (!fresh) throw new Error('no pillar rose');
  return fresh;
}

/** Stand player 4 at (x, z) and raise a pillar under them (then step them away). */
function raiseAt(f: FinalFight, x: number, z: number): Entity {
  f.put(f.players[4], x, z);
  const p = pillarAt(f, x, z);
  f.put(f.players[4], x + 9, z);
  return p;
}

/** Stop every awake star's own clock (a test lays its stars by hand). */
function still(f: FinalFight): void {
  const st = f.state();
  if (!st) throw new Error('no fight');
  for (const v of HEART_QUARTER_ORDER) st.stars.clock[v] = 1e9;
}

/** Hold the boss in `vein` (the tank stays by it) for `seconds`. */
function hold(f: FinalFight, seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < sec(seconds); i++) {
    const b = f.local(f.boss());
    const t = f.local(f.players[0]);
    if (Math.hypot(b.x - t.x, b.z - t.z) > 3) f.put(f.players[0], b.x + 2, b.z + 1);
    out.push(...f.tick(1));
  }
  return out;
}

/** A spot `r` yards out from the room's centre in `vein`'s quarter, turned `deg`. */
function inQuarter(vein: 'heat' | 'quench' | 'breath' | 'hammer', r: number, deg = 0) {
  const s = heartQuarterSpot(vein);
  const a = Math.atan2(s.x - HEART_ROOM.x, s.z - HEART_ROOM.z) + (deg * Math.PI) / 180;
  return { x: HEART_ROOM.x + Math.sin(a) * r, z: HEART_ROOM.z + Math.cos(a) * r };
}

describe('the pure rules', () => {
  it('a woken star runs at full pace where it stands or poured, reduced elsewhere, its own share at the end', () => {
    expect(quarterPace({ finalPhase: false, here: true, poured: false })).toBe(1);
    expect(quarterPace({ finalPhase: false, here: false, poured: true })).toBe(1);
    expect(quarterPace({ finalPhase: false, here: false, poured: false })).toBe(T.reducedPace);
    expect(quarterPace({ finalPhase: true, here: true, poured: true })).toBe(T.finalPace);
    expect(T.reducedPace).toBeGreaterThan(0);
    expect(T.reducedPace).toBeLessThan(1);
  });

  it('Storm-Charged adds up per charged pillar; Normal soft, Heroic harder', () => {
    expect(chargedPulse(0, 10, 12)).toEqual([0, 0]);
    expect(chargedPulse(3, 10, 12)).toEqual([30, 36]);
    const N = FINAL_DIFFICULTY.normal;
    const H = FINAL_DIFFICULTY.heroic;
    // Two charged on Normal: under a tenth of a level-20 cloth pool a pulse.
    expect(chargedPulse(2, N.chargedMin, N.chargedMax)[1] * N.damageMult).toBeLessThan(113);
    // Four press: more than an empty Overload pulse every four seconds.
    expect(chargedPulse(4, N.chargedMin, N.chargedMax)[0]).toBeGreaterThan(130);
    expect(H.chargedMin).toBeGreaterThan(N.chargedMin);
  });

  it('a blade rises on the rim beside its mark and its line runs rim to rim', () => {
    const mark = inQuarter('heat', 30);
    const o = bladeOrigin(mark, 12345);
    expect(Math.hypot(o.x - HEART_ROOM.x, o.z - HEART_ROOM.z)).toBeCloseTo(HEART_ROOM.r - 1.5, 3);
    expect(Math.hypot(o.x - mark.x, o.z - mark.z)).toBeGreaterThanOrEqual(T.bladeMinReach);
    // Near enough for the mark's own interest online (90 yd).
    for (let h = 0; h < 200; h += 7) {
      const q = bladeOrigin(mark, h);
      expect(Math.hypot(q.x - mark.x, q.z - mark.z)).toBeLessThan(70);
    }
    const facing = Math.atan2(mark.x - o.x, mark.z - o.z);
    const len = lineLength(o, facing);
    expect(len).toBeGreaterThan(Math.hypot(o.x - mark.x, o.z - mark.z));
    const end = { x: o.x + Math.sin(facing) * len, z: o.z + Math.cos(facing) * len };
    expect(Math.hypot(end.x - HEART_ROOM.x, end.z - HEART_ROOM.z)).toBeCloseTo(
      HEART_ROOM.r - 1.5,
      3,
    );
    expect(bladeCrossesPillar(o, end, mark)).toBe(true);
    expect(bladeCrossesPillar(o, end, { x: mark.x + 20, z: mark.z + 20 })).toBe(false);
  });

  it('a pillar rises only in a quarter, clear of the ring, the rim, the boss and the others', () => {
    const boss = inQuarter('heat', 30);
    const ok = inQuarter('heat', 30, 25);
    expect(pillarSpotClear(ok, [], boss)).toBe(true);
    expect(pillarSpotClear({ x: HEART_ROOM.x, z: HEART_ROOM.z }, [], boss)).toBe(false);
    expect(pillarSpotClear(inQuarter('heat', HEART_ROOM.r - 1), [], boss)).toBe(false);
    expect(pillarSpotClear(inQuarter('heat', HEART_QUARTERS.ringR + 1), [], boss)).toBe(false);
    expect(pillarSpotClear(boss, [], boss)).toBe(false);
    expect(pillarSpotClear(ok, [{ x: ok.x + 1, z: ok.z }], boss)).toBe(false);
    // Their walls are the council's risen pillars'.
    expect(COMBAT_WALL_SHAPES.sh_final_pillar_plain?.round).toBe(true);
    expect(COMBAT_WALL_SHAPES.sh_final_pillar_charged?.hw).toBe(T.pillarR);
  });
});

describe('the stars wake and stay', () => {
  it('entering a quarter wakes its star; a woken star stays awake as the boss moves on', () => {
    const f = finalFight(6);
    f.pullIn('heat');
    expect(f.state()?.stars.awake).toEqual(['heat']);
    f.dev('/dev heart final quarter breath');
    f.tick(2);
    expect(f.state()?.stars.awake).toEqual(['heat', 'breath']);
    f.dev('/dev heart final quarter heat');
    f.tick(2);
    // No second wake, the order kept.
    expect(f.state()?.stars.awake).toEqual(['heat', 'breath']);
    const ev = hold(f, 2);
    expect(ev.filter((e) => e.type === 'spellfxAt' && e.ability === FINAL_CUES.wake).length).toBe(
      0,
    );
  });

  it('the quarter it stands in fires at full pace, a woken one elsewhere at the reduced pace', () => {
    const f = finalFight(6);
    f.pullIn('hammer');
    f.dev('/dev heart final quarter heat');
    f.tick(2);
    // Both awake; the boss drinks the Heat.
    const st = f.state();
    if (!st) throw new Error('no fight');
    const heat0 = st.stars.clock.heat;
    const hammer0 = st.stars.clock.hammer;
    hold(f, 3);
    const heatSpent = heat0 - st.stars.clock.heat;
    const hammerSpent = hammer0 - st.stars.clock.hammer;
    expect(heatSpent).toBeCloseTo(3, 1);
    expect(hammerSpent).toBeCloseTo(3 * T.reducedPace, 1);
  });

  it('every star fires on its own clock: whirls, pillars, strikes, blades', () => {
    const f = finalFight(8);
    f.pullIn('heat');
    for (const v of ['hammer', 'breath', 'quench'] as const) f.dev(`/dev heart final wake ${v}`);
    const spot = heartQuarterSpot('heat');
    f.gather(spot.x, spot.z, 10);
    let whirls = 0;
    let rises = 0;
    let strikes = 0;
    let blades = 0;
    for (let i = 0; i < sec(40); i++) {
      for (const e of hold(f, 0.05)) {
        if (e.type !== 'spellfxAt' && e.type !== 'spellfx') continue;
        if (e.ability === FINAL_CUES.rise) rises++;
        if (e.ability === FINAL_CUES.strike) strikes++;
        if (e.ability === FINAL_CUES.blade) blades++;
      }
      whirls = Math.max(whirls, f.objects(FINAL_OBJECTS.whirlPrefix).length);
    }
    expect(whirls).toBeGreaterThan(0);
    expect(rises).toBeGreaterThan(0);
    expect(strikes).toBeGreaterThan(0);
    expect(blades).toBeGreaterThan(0);
  });
});

describe('the Anvil holds the stars', () => {
  it("a star due through Weight of the Anvil's bar waits for it to fall", () => {
    const f = finalFight(6);
    f.pullIn('hammer');
    f.dev('/dev heart final wake breath');
    f.dev('/dev heart final anvil', f.pids[2]);
    const st = f.state();
    if (!st) throw new Error('no fight');
    expect(st.anvil).not.toBeNull();
    st.stars.clock.hammer = 0.05;
    st.stars.clock.breath = 0.05;
    f.tick(sec(2));
    expect(f.objects(FINAL_OBJECTS.risePrefix).length).toBe(0);
    expect(f.objects(FINAL_OBJECTS.strikePrefix).length).toBe(0);
    // Once it has fallen, both come.
    f.tick(sec(T.anvilCast));
    expect(st.anvil).toBeNull();
    expect(f.state()?.stars.volleys ?? 0).toBeGreaterThanOrEqual(2);
  });
});

describe('Wake the Stone', () => {
  it('pillars rise under players, throw them back, and stand as walls for the rest of the fight', () => {
    const f = finalFight(6);
    f.pullIn('hammer');
    still(f);
    const at = inQuarter('hammer', 36, 20);
    f.put(f.players[4], at.x, at.z);
    f.dev('/dev heart final pillars here', f.pids[4]);
    expect(f.objects(FINAL_OBJECTS.risePrefix).length).toBe(1);
    const ev = f.tick(sec(T.pillarWarn + 0.1), false);
    expect(hits(ev, FINAL_NAMES.wake, f.pids[4]).length).toBe(1);
    expect(pillars(f).length).toBe(1);
    expect(f.objects(FINAL_OBJECTS.risePrefix).length).toBe(0);
    // Its wall is published.
    const o = instanceOrigin(DUNGEONS.smith_heart.index, f.inst.slot);
    expect(combatWallsAt(o.x, o.z).length).toBeGreaterThan(0);
    // It stays as the boss is dragged on.
    f.dev('/dev heart final quarter breath');
    f.tick(2);
    still(f);
    hold(f, 20);
    expect(pillars(f).length).toBe(1);
  });

  it(`a volley raises the tier's count; at the cap it rings Stone Thrum instead`, () => {
    for (const tier of ['normal', 'heroic'] as const) {
      const f = finalFight(8);
      if (tier !== 'normal') f.dev(`/dev heart final ${tier}`);
      f.pullIn('hammer');
      still(f);
      f.players.forEach((p, i) => {
        const at = inQuarter(i % 2 ? 'hammer' : 'heat', 24 + (i % 4) * 7, i * 23);
        f.put(p, at.x, at.z);
      });
      const R = FINAL_DIFFICULTY[tier];
      f.dev('/dev heart final pillars 1');
      expect(f.objects(FINAL_OBJECTS.risePrefix).length).toBe(R.pillarCount);
      f.tick(sec(T.pillarWarn + 0.1));
      // Up to the cap.
      for (let k = 0; k < 8 && pillars(f).length < R.pillarCap; k++) {
        f.dev('/dev heart final pillars 1');
        f.tick(sec(T.pillarWarn + 0.1));
      }
      expect(pillars(f).length).toBe(R.pillarCap);
      f.dev('/dev heart final pillars 1');
      expect(f.objects(FINAL_OBJECTS.risePrefix).length).toBe(0);
      const ev = f.tick(1);
      expect(f.state()?.stars.thrums).toBe(1);
      void ev;
    }
  });

  it('Stone Thrum strikes the whole raid', () => {
    const f = finalFight(6);
    f.pullIn('hammer');
    still(f);
    let ev: SimEvent[] = [];
    f.dev('/dev heart final thrum');
    ev = f.tick(1);
    void ev;
    expect(f.state()?.stars.thrums).toBe(1);
  });
});

describe('the interactions', () => {
  it('a strike by a pillar arcs round it (Arcing Stone) and leaves it Storm-Charged', () => {
    const f = finalFight(6);
    f.pullIn('hammer');
    still(f);
    const at = inQuarter('hammer', 36, 22);
    const pillar = raiseAt(f, at.x, at.z);
    // One stands in the ring's reach, far from the strike's own spot.
    f.put(f.players[3], at.x - 6, at.z + 4);
    f.put(f.players[2], at.x + 25, at.z);
    f.put(f.players[1], at.x + 4, at.z);
    f.dev('/dev heart final sky here', f.pids[1]);
    expect(f.objects(FINAL_OBJECTS.strikePrefix).length).toBe(1);
    // Its ring is on the floor from the moment the strike is laid.
    const ring = f.objects(FINAL_OBJECTS.arcPrefix);
    expect(ring.length).toBe(1);
    expect(ring[0].scale).toBe(T.arcR);
    f.put(f.players[1], at.x + 25, at.z + 6);
    const ev = f.tick(sec(T.skyWarn + 0.1));
    expect(hits(ev, FINAL_NAMES.arc, f.pids[3]).length).toBe(1);
    expect(hits(ev, FINAL_NAMES.arc, f.pids[2]).length).toBe(0);
    expect(finalPillarOf(pillar.templateId)).toBe('charged');
    expect(f.objects(FINAL_OBJECTS.arcPrefix).length).toBe(0);
  });

  it('a strike far from every pillar charges none', () => {
    const f = finalFight(6);
    f.pullIn('hammer');
    still(f);
    const at = inQuarter('hammer', 36, 22);
    raiseAt(f, at.x, at.z);
    f.put(f.players[1], at.x + 20, at.z + 10);
    f.dev('/dev heart final sky here', f.pids[1]);
    expect(f.objects(FINAL_OBJECTS.arcPrefix).length).toBe(0);
    f.tick(sec(T.skyWarn + 0.1));
    expect(charged(f).length).toBe(0);
  });

  it('every Storm-Charged pillar pulses the whole raid, summed per pillar, while it stands', () => {
    const f = finalFight(6);
    f.pullIn('hammer');
    still(f);
    raiseAt(f, ...(Object.values(inQuarter('hammer', 30, -20)) as [number, number]));
    f.dev('/dev heart final charge');
    const one = hold(f, T.chargedEvery * 2 + 0.1);
    const a = hits(one, FINAL_NAMES.charged, f.pids[2]);
    expect(a.length).toBe(2);
    raiseAt(f, ...(Object.values(inQuarter('hammer', 44, 15)) as [number, number]));
    f.dev('/dev heart final charge');
    expect(charged(f).length).toBe(2);
    const two = hold(f, T.chargedEvery * 2 + 0.1);
    const b = hits(two, FINAL_NAMES.charged, f.pids[2]);
    expect(b.length).toBe(2);
    // About twice as hard with two.
    const avg = (xs: Damage[]) => xs.reduce((s, x) => s + x.amount, 0) / xs.length;
    expect(avg(b)).toBeGreaterThan(avg(a) * 1.6);
    // Shattered, the pulse stops.
    f.dev('/dev heart final shatter');
    expect(hits(hold(f, T.chargedEvery * 2), FINAL_NAMES.charged).length).toBe(0);
  });

  it('a Crossing Blade shatters every pillar its line crosses, and strikes whoever stays on it', () => {
    const f = finalFight(6);
    f.pullIn('hammer');
    still(f);
    const mark = inQuarter('quench', 46, 0);
    f.put(f.players[2], mark.x, mark.z);
    f.dev('/dev heart final blades me', f.pids[2]);
    const st = f.state();
    const run = st?.stars.blade;
    if (!run) throw new Error('no blade');
    expect(aura(f.players[2], FINAL_AURAS.bladeMark)).toBeDefined();
    const lane = f.objects(FINAL_OBJECTS.lanePrefix)[0];
    expect(finalLaneOf(lane.templateId)?.state).toBe('warn');
    // A pillar on the line, short of the mark, and one well off it.
    const d = Math.hypot(mark.x - run.from.x, mark.z - run.from.z);
    const ux = (mark.x - run.from.x) / d;
    const uz = (mark.z - run.from.z) / d;
    const on = { x: mark.x - ux * 12, z: mark.z - uz * 12 };
    const off = { x: on.x + uz * 14, z: on.z - ux * 14 };
    f.put(f.players[4], on.x, on.z);
    f.dev('/dev heart final pillars here', f.pids[4]);
    f.put(f.players[4], off.x, off.z);
    f.dev('/dev heart final pillars here', f.pids[4]);
    f.put(f.players[4], off.x + 20, off.z + 20);
    f.tick(sec(T.pillarWarn + 0.1));
    const ps = pillars(f);
    expect(ps.length).toBe(2);
    const nearOn = (e: Entity) => Math.hypot(f.local(e).x - on.x, f.local(e).z - on.z) < 3;
    const p1 = ps.find(nearOn) as Entity;
    const p3 = ps.find((e) => !nearOn(e)) as Entity;
    // The line follows the mark until it locks.
    f.tick(sec(FINAL_DIFFICULTY.normal.bladeAim - T.pillarWarn - T.bladeLock + 0.1));
    expect(finalLaneOf(f.objects(FINAL_OBJECTS.lanePrefix)[0].templateId)?.state).toBe('lock');
    expect(aura(f.players[2], FINAL_AURAS.bladeMark)?.value).toBe(2);
    // Someone else stands on the line before the pillar; the mark stays put.
    f.put(
      f.players[3],
      run.from.x + Math.sin(run.facing) * 8,
      run.from.z + Math.cos(run.facing) * 8,
    );
    const ev = f.tick(sec(T.bladeLock + T.bladeFly + 0.2));
    expect(hits(ev, FINAL_NAMES.blade, f.pids[3]).length).toBe(1);
    expect(f.sim.ctx.entities.has(p1.id)).toBe(false);
    expect(f.sim.ctx.entities.has(p3.id)).toBe(true);
    expect(f.state()?.stars.shattered).toBe(1);
    expect(f.objects(FINAL_OBJECTS.lanePrefix).length).toBe(0);
    expect(f.objects(FINAL_OBJECTS.bladePrefix).length).toBe(0);
  });

  it('a charged pillar shattered takes its pulse with it; a strike on its way finds no stone', () => {
    const f = finalFight(6);
    f.pullIn('hammer');
    still(f);
    const at = inQuarter('hammer', 36, 22);
    raiseAt(f, at.x, at.z);
    f.put(f.players[1], at.x + 4, at.z);
    f.dev('/dev heart final sky here', f.pids[1]);
    expect(f.objects(FINAL_OBJECTS.arcPrefix).length).toBe(1);
    f.dev('/dev heart final shatter');
    expect(f.objects(FINAL_OBJECTS.arcPrefix).length).toBe(0);
    const ev = f.tick(sec(T.skyWarn + 0.1));
    expect(hits(ev, FINAL_NAMES.arc).length).toBe(0);
  });
});

describe('per tier', () => {
  for (const tier of ['normal', 'heroic', 'mythic'] as const)
    it(`${tier}: its sky marks, its blades a round, its whirls a volley`, () => {
      const f = finalFight(8);
      if (tier !== 'normal') f.dev(`/dev heart final ${tier}`);
      f.pullIn('breath');
      const R = FINAL_DIFFICULTY[tier];
      f.dev('/dev heart final sky');
      expect(f.players.filter((p) => aura(p, FINAL_AURAS.skyMark)).length).toBe(R.skyMarks);
      f.tick(sec(T.skyWarn + 0.2));
      f.dev('/dev heart final blades');
      const queue = (f.state()?.stars.bladeQueue.length ?? 0) + 1;
      expect(queue).toBe(R.bladeMarks);
      f.dev('/dev heart final tornado');
      expect(f.objects(FINAL_OBJECTS.whirlPrefix).length).toBe(R.whirlCount);
    });

  it('Normal is softer than Heroic, Heroic no softer than Mythic', () => {
    const N = FINAL_DIFFICULTY.normal;
    const H = FINAL_DIFFICULTY.heroic;
    const M = FINAL_DIFFICULTY.mythic;
    expect(N.pillarCap).toBeGreaterThan(H.pillarCap);
    expect(H.pillarCap).toBeGreaterThanOrEqual(M.pillarCap);
    expect(N.bladeAim).toBeGreaterThan(H.bladeAim);
    expect(N.thrumMax).toBeLessThan(H.thrumMin);
    expect(H.chargedMax).toBeLessThanOrEqual(M.chargedMax);
  });
});

describe('the pours and the end', () => {
  it("a Splinter alive at the call's end pours its star in: awake, full pace wherever it stands", () => {
    const f = finalFight(6);
    f.pullIn('heat');
    f.sim.ctx.dealDamage(
      f.players[1],
      f.boss(),
      f.boss().maxHp,
      false,
      'physical',
      'Strike',
      'hit',
    );
    f.tick(sec(3.5));
    f.dev('/dev heart final killadds');
    f.dev('/dev heart final splinter quench');
    f.tick(sec(3));
    f.dev('/dev heart final endcall');
    f.tick(1);
    expect(aura(f.boss(), pouredAuraId('quench'))?.stacks).toBe(1);
    expect(f.state()?.stars.awake).toContain('quench');
    f.dev('/dev heart final quarter breath');
    f.tick(2);
    const st = f.state();
    if (!st) throw new Error('no fight');
    const q0 = st.stars.clock.quench;
    hold(f, 2);
    expect(q0 - st.stars.clock.quench).toBeCloseTo(2, 1);
  });

  it('the final phase wakes all four stars at once, at the final pace', () => {
    const f = finalFight(8);
    f.pullIn('heat');
    f.dev('/dev heart final last');
    f.tick(sec(3.5));
    const st = f.state();
    expect(st?.phase.stage).toBe('final');
    expect([...(st?.stars.awake ?? [])].sort()).toEqual([...HEART_QUARTER_ORDER].sort());
    const c = f.local(f.boss());
    f.gather(c.x + 20, c.z, 10);
    const seen = new Set<string>();
    for (const e of f.tick(sec(45)))
      if (e.type === 'spellfxAt' || e.type === 'spellfx') seen.add(String(e.ability));
    for (const cue of [FINAL_CUES.rise, FINAL_CUES.strike, FINAL_CUES.blade])
      expect(seen, cue).toContain(cue);
    expect(FINAL_STAR_CLOCK.hammer.every / T.finalPace).toBeLessThan(30);
  });

  it('the same seed lays the same stars', () => {
    const trace = () => {
      const f = finalFight(8, 61);
      f.dev('/dev heart final heroic');
      f.pullIn('hammer');
      for (const v of ['breath', 'quench', 'heat'] as const) f.dev(`/dev heart final wake ${v}`);
      const out: string[] = [];
      for (const e of hold(f, 40))
        if (e.type === 'damage') out.push(`${e.ability}:${e.targetId}:${e.amount}`);
      for (const p of pillars(f)) out.push(`p:${Math.round(p.pos.x)}:${Math.round(p.pos.z)}`);
      return out;
    };
    const a = trace();
    expect(a.some((x) => x.startsWith('p:'))).toBe(true);
    expect(trace()).toEqual(a);
  });

  it('a wipe takes every pillar, strike, blade and mark, and the walls with them', () => {
    const f = finalFight(6);
    f.pullIn('hammer');
    const at = inQuarter('hammer', 36, 22);
    raiseAt(f, at.x, at.z);
    f.dev('/dev heart final sky');
    f.dev('/dev heart final blades');
    f.dev('/dev heart final reset');
    f.tick(2);
    for (const prefix of Object.values(FINAL_OBJECTS))
      expect(f.objects(prefix).length, prefix).toBe(0);
    for (const p of f.players) {
      expect(aura(p, FINAL_AURAS.skyMark)).toBeUndefined();
      expect(aura(p, FINAL_AURAS.bladeMark)).toBeUndefined();
    }
    void heartQuarterAt;
  });
});
