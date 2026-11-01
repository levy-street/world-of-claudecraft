// The blades' slashes over a REAL Sim claim: two blades wake with the pull and the
// other two at half health; a round marks players in order and each blade flies down a
// line across the whole lake that follows its mark until it locks; the flight strikes and
// chills what is on the line once, moves no one, and never the tank while anyone else stands; the blade stays
// where it landed; a wipe sends everything home.

import { describe, expect, it } from 'vitest';
import { QUENCH_BLADE_SPOTS } from '../src/sim/content/smith_heart_layout';
import {
  bladeStateOf,
  insideRimewall,
  laneOf,
  laneTemplate,
  QUENCH_AURAS,
  QUENCH_CASTS,
  QUENCH_DIFFICULTY,
  QUENCH_LAKE_MIDDLE,
  QUENCH_NAMES,
  QUENCH_OBJECTS,
  segmentDistance,
  slashEase,
  slashLine,
  QUENCH_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import { DT, type Entity } from '../src/sim/types';
import { hitsOf } from './helpers/council_fight';
import { type QuenchFight, quenchFight } from './helpers/quench_fight';

const ticks = (s: number) => Math.round(s / DT);
const has = (e: Entity, id: string) => e.auras.some((a) => a.id === id);
const aura = (e: Entity, id: string) => e.auras.find((a) => a.id === id);

function bladeStates(f: QuenchFight): (string | null)[] {
  return f
    .state()
    ?.blades.map((b) => bladeStateOf(f.sim.entities.get(b.objectId)?.templateId ?? '')) as (
    | string
    | null
  )[];
}

/** A pulled fight past its first awakening: two blades float, no round yet. */
function twoAwake(n = 6, tier?: 'heroic' | 'mythic'): QuenchFight {
  const f = quenchFight(n, 31);
  f.dev('/dev heart quench pull');
  f.tick(1);
  if (tier) expect(f.dev(`/dev heart quench ${tier} on`)).toBe(true);
  const st = f.state();
  if (!st) throw new Error('no fight');
  st.breathTimer = 999;
  f.tick(ticks(T.rimRise + T.wakeCast) + 2);
  st.slashTimer = 999;
  return f;
}

function allAwake(n = 6, tier?: 'heroic' | 'mythic'): QuenchFight {
  const f = twoAwake(n, tier);
  expect(f.dev('/dev heart quench blades')).toBe(true);
  const st = f.state();
  if (st) st.slashTimer = 999;
  return f;
}

function round(f: QuenchFight) {
  expect(f.dev('/dev heart quench slash')).toBe(true);
  const slash = f.state()?.slash;
  if (!slash) throw new Error('no round');
  return slash;
}

function playerOf(f: QuenchFight, id: number): Entity {
  return f.players.find((p) => p.id === id) as Entity;
}

/** Everyone well apart on the lake, so one line strikes one body at most. */
function spread(f: QuenchFight): void {
  const st = f.state();
  if (!st) throw new Error('no fight');
  const mid = QUENCH_BLADE_SPOTS.reduce((a, s) => ({ x: a.x + s.x / 4, z: a.z + s.z / 4 }), {
    x: 0,
    z: 0,
  });
  f.players.forEach((p, i) => {
    const a = (i / f.players.length) * Math.PI * 2;
    f.put(p, mid.x + Math.sin(a) * 14, mid.z + Math.cos(a) * 14);
  });
}

describe('Guardian of the Quench: the blades wake in two steps', () => {
  it('two opposite blades wake with the pull, the other two at half health', () => {
    const f = quenchFight(4, 31);
    f.dev('/dev heart quench pull');
    f.tick(1);
    expect(bladeStates(f)).toEqual(['sunk', 'sunk', 'sunk', 'sunk']);
    f.tick(ticks(T.rimRise) + 2);
    expect(f.boss().castingAbility).toBe(QUENCH_CASTS.wake);
    expect(bladeStates(f)).toEqual(['wake', 'sunk', 'wake', 'sunk']);
    f.tick(ticks(T.wakeCast) + 2);
    expect(bladeStates(f)).toEqual(['float', 'sunk', 'float', 'sunk']);
    expect(f.state()?.half).toBe('lake');
    // Only the second step is phase 2: no marker, no deepening yet.
    expect(has(f.boss(), QUENCH_AURAS.awake)).toBe(false);

    const b = f.boss();
    b.hp = Math.floor(b.maxHp * 0.49);
    for (let i = 0; i < 120 && f.state()?.half === 'lake'; i++) f.tick(1);
    expect(f.state()?.half).toBe('wake');
    expect(bladeStates(f)).toEqual(['float', 'wake', 'float', 'wake']);
    f.tick(ticks(T.wakeCast) + 2);
    expect(f.state()?.half).toBe('awake');
    expect(bladeStates(f)).toEqual(['float', 'float', 'float', 'float']);
    expect(has(b, QUENCH_AURAS.awake)).toBe(true);
  });

  it('an awake blade stops being a wall; a sunk one stays one', () => {
    const f = twoAwake(3);
    const st = f.state();
    for (const bl of st?.blades ?? []) {
      const e = f.sim.entities.get(bl.objectId);
      expect(e?.kitObject?.kind).toBe(bl.awake ? undefined : 'wall');
    }
  });
});

describe('Guardian of the Quench: the marks', () => {
  it('the mark counts per tier: more with four blades awake, and harder up the tiers', () => {
    expect([
      QUENCH_DIFFICULTY.normal.slashMarksLake,
      QUENCH_DIFFICULTY.normal.slashMarksAwake,
    ]).toEqual([1, 2]);
    expect([
      QUENCH_DIFFICULTY.heroic.slashMarksLake,
      QUENCH_DIFFICULTY.heroic.slashMarksAwake,
    ]).toEqual([2, 3]);
    expect([
      QUENCH_DIFFICULTY.mythic.slashMarksLake,
      QUENCH_DIFFICULTY.mythic.slashMarksAwake,
    ]).toEqual([2, 4]);
    expect(QUENCH_DIFFICULTY.normal.slashChain).toBe(false);
    expect(QUENCH_DIFFICULTY.heroic.slashChain).toBe(false);
    expect(QUENCH_DIFFICULTY.mythic.slashChain).toBe(true);

    for (const [tier, two, four] of [
      [undefined, 1, 2],
      ['heroic', 2, 3],
      ['mythic', 2, 4],
    ] as const) {
      const a = twoAwake(6, tier);
      expect(round(a).marks.length, `${tier} two`).toBe(two);
      const b = allAwake(6, tier);
      expect(round(b).marks.length, `${tier} four`).toBe(four);
    }
  });

  it('numbers each mark on its aura and never marks the tank while anyone else stands', () => {
    const f = allAwake(6, 'mythic');
    const tank = f.boss().aggroTargetId;
    const slash = round(f);
    expect(slash.marks).not.toContain(tank);
    expect(new Set(slash.marks).size).toBe(slash.marks.length);
    slash.marks.forEach((id, i) => {
      const a = aura(playerOf(f, id), QUENCH_AURAS.marked);
      expect(a?.value).toBe(i + 1);
      expect(a?.value2).toBe(slash.marks.length);
    });
  });

  it('a round starts by itself, on the clock', () => {
    const f = twoAwake(4);
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.slashTimer = 0.2;
    expect(st.slash).toBeNull();
    f.tick(ticks(0.3));
    expect(st.slash).not.toBeNull();
    // Back on its clock when the round is done, a whole wait away.
    f.tick(ticks(QUENCH_DIFFICULTY.normal.slashAim + T.slashFly + T.slashGap) + 4);
    expect(st.slash).toBeNull();
    expect(st.slashTimer).toBeGreaterThan(T.slashEveryLake - 1);
  });
});

describe('Guardian of the Quench: the line', () => {
  it('runs from the blade through the mark across the whole lake, in whole yards, stopping short of the shore ice', () => {
    const from = { x: QUENCH_BLADE_SPOTS[0].x, z: QUENCH_BLADE_SPOTS[0].z };
    // Toward the lake's middle, 10 yd off.
    const way = Math.atan2(QUENCH_LAKE_MIDDLE.x - from.x, QUENCH_LAKE_MIDDLE.z - from.z);
    const target = { x: from.x + Math.sin(way) * 10, z: from.z + Math.cos(way) * 10 };
    const l = slashLine(from, target, 0);
    expect(l.facing).toBeCloseTo(way);
    expect(Number.isInteger(l.length)).toBe(true);
    // A target at arm's length still gets the whole crossing, the same as a far one.
    expect(l.length).toBeGreaterThan(20);
    const near = slashLine(from, { x: from.x + Math.sin(way), z: from.z + Math.cos(way) }, 0);
    expect(near.facing).toBeCloseTo(l.facing);
    expect(near.length).toBe(l.length);
    const farOnLine = {
      x: from.x + Math.sin(l.facing) * 200,
      z: from.z + Math.cos(l.facing) * 200,
    };
    expect(slashLine(from, farOnLine, 0).length).toBe(l.length);
    // One yard further would be past the margin.
    expect(
      insideRimewall(
        from.x + Math.sin(l.facing) * (l.length + 1),
        from.z + Math.cos(l.facing) * (l.length + 1),
        T.slashRimMargin,
      ),
    ).toBe(false);
    // However far the target, the end stays inside the ring.
    for (let a = 0; a < 16; a++) {
      const far = { x: from.x + Math.sin(a) * 200, z: from.z + Math.cos(a) * 200 };
      const line = slashLine(from, far, 0);
      if (line.length === T.slashMinLength) continue;
      const x = from.x + Math.sin(line.facing) * line.length;
      const z = from.z + Math.cos(line.facing) * line.length;
      expect(insideRimewall(x, z, T.slashRimMargin)).toBe(true);
    }
    // A target on the blade keeps the fallback's way.
    expect(slashLine(from, from, 1.25).facing).toBe(1.25);
  });

  it('carries its state and length in the template', () => {
    const of = laneOf(laneTemplate('warn', 2.5, 17));
    expect(of).toEqual({ state: 'warn', seconds: 2.5, length: 17 });
    expect(laneOf(laneTemplate('fly', 0.6, 3))?.state).toBe('fly');
    expect(laneOf('sh_quench_lane_crack_20_3')).toBeNull();
    expect(laneOf('sh_quench_hole')).toBeNull();
  });

  it('follows its mark while it aims and holds once locked', () => {
    const f = twoAwake(4);
    spread(f);
    const slash = round(f);
    const p = playerOf(f, slash.marks[0]);
    f.tick(2);
    const lane = f.objects(QUENCH_OBJECTS.lanePrefix)[0];
    const aim = (who: Entity) =>
      Math.atan2(f.local(who).x - slash.from.x, f.local(who).z - slash.from.z);
    expect(lane.facing).toBeCloseTo(aim(p), 1);
    // A walk off to the side turns the line with it.
    const before = lane.facing;
    f.put(p, f.local(p).x + 10, f.local(p).z - 4);
    f.tick(1);
    expect(lane.facing).not.toBeCloseTo(before, 1);
    expect(lane.facing).toBeCloseTo(aim(p), 1);
    // Past the lock it holds, whatever the mark does.
    f.tick(ticks(QUENCH_DIFFICULTY.normal.slashAim - T.slashLock));
    const locked = lane.facing;
    f.put(p, f.local(p).x - 12, f.local(p).z + 6);
    f.tick(2);
    expect(lane.facing).toBe(locked);
  });
});

describe('Guardian of the Quench: the flight', () => {
  it('a mark who stays on the line is struck and chilled once, and the blade goes through without moving them', () => {
    const f = twoAwake(4);
    spread(f);
    const slash = round(f);
    const p = playerOf(f, slash.marks[0]);
    const coldBefore = f.state()?.chill[p.id]?.cold ?? 0;
    const spot = f.local(p);
    const ev = f.tick(ticks(QUENCH_DIFFICULTY.normal.slashAim + T.slashFly) + 2);
    expect(Math.hypot(f.local(p).x - spot.x, f.local(p).z - spot.z)).toBeLessThan(0.01);
    const hits = hitsOf(ev, QUENCH_NAMES.cross, p.id);
    expect(hits.length).toBe(1);
    expect((f.state()?.chill[p.id]?.cold ?? 0) - coldBefore).toBeGreaterThan(T.crossCold * 0.5);
  });

  it('a mark who steps off the locked line takes nothing, and neither does anyone away from it', () => {
    const f = twoAwake(4);
    spread(f);
    const slash = round(f);
    const p = playerOf(f, slash.marks[0]);
    f.tick(ticks(QUENCH_DIFFICULTY.normal.slashAim - T.slashLock) + 1);
    const from = slash.from;
    const to = {
      x: from.x + Math.sin(slash.facing) * slash.length,
      z: from.z + Math.cos(slash.facing) * slash.length,
    };
    const side = slash.facing + Math.PI / 2;
    const here = f.local(p);
    f.put(
      p,
      here.x + Math.sin(side) * (T.laneHalf + 3),
      here.z + Math.cos(side) * (T.laneHalf + 3),
    );
    expect(segmentDistance(from, to, f.local(p))).toBeGreaterThan(T.laneHalf);
    const ev = f.tick(ticks(T.slashLock + T.slashFly) + 2);
    expect(hitsOf(ev, QUENCH_NAMES.cross, p.id)).toEqual([]);
  });

  it('a bystander standing on the line is struck too', () => {
    const f = twoAwake(4);
    spread(f);
    const slash = round(f);
    f.tick(ticks(QUENCH_DIFFICULTY.normal.slashAim - T.slashLock) + 1);
    const other = f.players.find((e) => e.id !== slash.marks[0]) as Entity;
    const k = Math.min(3, slash.length / 2);
    f.put(
      other,
      slash.from.x + Math.sin(slash.facing) * k,
      slash.from.z + Math.cos(slash.facing) * k,
    );
    const ev = f.tick(ticks(T.slashLock + T.slashFly) + 2);
    expect(hitsOf(ev, QUENCH_NAMES.cross, other.id).length).toBe(1);
  });

  it('flies on the one eased curve the painter draws, and stays where it lands', () => {
    const f = twoAwake(4);
    spread(f);
    const slash = round(f);
    const index = slash.blade;
    const bl = f.state()?.blades[index];
    if (!bl) throw new Error('no blade');
    const home = { x: bl.x, z: bl.z };
    f.tick(ticks(QUENCH_DIFFICULTY.normal.slashAim));
    const obj = f.sim.entities.get(bl.objectId) as Entity;
    expect(bladeStateOf(obj.templateId)).toBe('fly');
    expect(laneOf(f.objects(QUENCH_OBJECTS.lanePrefix)[0].templateId)?.state).toBe('fly');
    f.tick(ticks(T.slashFly / 2));
    const done = Math.hypot(bl.x - home.x, bl.z - home.z) / slash.length;
    expect(done).toBeCloseTo(slashEase(0.5), 0);
    f.tick(ticks(T.slashFly / 2) + 2);
    expect(bladeStateOf(obj.templateId)).toBe('float');
    expect(Math.hypot(bl.x - home.x, bl.z - home.z)).toBeCloseTo(slash.length, 0);
    expect(f.objects(QUENCH_OBJECTS.lanePrefix)).toEqual([]);
    expect(has(playerOf(f, slash.marks[0]), QUENCH_AURAS.marked)).toBe(false);
  });

  it('non-mythic rounds rotate the blades; a mythic round is one blade from where it landed', () => {
    const normal = allAwake(6);
    const a = round(normal);
    const firstBlade = a.blade;
    normal.tick(ticks(QUENCH_DIFFICULTY.normal.slashAim + T.slashFly + T.slashGap) + 2);
    expect(a.step).toBe(1);
    expect(a.blade).not.toBe(firstBlade);

    const mythic = allAwake(6, 'mythic');
    spread(mythic);
    const m = round(mythic);
    const only = m.blade;
    const start = { ...m.from };
    mythic.tick(ticks(QUENCH_DIFFICULTY.mythic.slashAim + T.slashFly + T.slashGap) + 2);
    expect(m.step).toBe(1);
    expect(m.blade).toBe(only);
    const bl = mythic.state()?.blades[only];
    expect(Math.hypot(m.from.x - start.x, m.from.z - start.z)).toBeGreaterThan(1);
    expect(m.from.x).toBeCloseTo(bl?.x ?? 0);
    expect(m.from.z).toBeCloseTo(bl?.z ?? 0);
  });

  it('a mark who dies before the lock is skipped', () => {
    const f = allAwake(6);
    spread(f);
    const slash = round(f);
    const first = playerOf(f, slash.marks[0]);
    f.sim.ctx.handleDeath(first, f.boss());
    f.tick(2, false);
    expect(slash.step).toBe(1);
    expect(f.state()?.slash).toBe(slash);
    expect(f.objects(QUENCH_OBJECTS.lanePrefix).length).toBe(1);
  });
});

describe('Guardian of the Quench: the round ends with the fight', () => {
  it('a reset takes the line and the marks, and the blades sink home wherever they landed', () => {
    const f = allAwake(4);
    spread(f);
    const slash = round(f);
    f.tick(ticks(QUENCH_DIFFICULTY.normal.slashAim + T.slashFly) + 2);
    const marks = [...slash.marks];
    expect(f.dev('/dev heart quench reset')).toBe(true);
    expect(f.objects(QUENCH_OBJECTS.lanePrefix)).toEqual([]);
    for (const id of marks) expect(has(playerOf(f, id), QUENCH_AURAS.marked)).toBe(false);
    const homes = f
      .objects(QUENCH_OBJECTS.bladePrefix)
      .map((e) =>
        QUENCH_BLADE_SPOTS.findIndex(
          (s) => Math.hypot(s.x - f.local(e).x, s.z - f.local(e).z) < 0.01,
        ),
      );
    expect(homes.includes(-1)).toBe(false);
    expect(new Set(homes).size).toBe(4);
  });

  it('the same seed and raid fly the same round', () => {
    const run = () => {
      const f = allAwake(6, 'heroic');
      const slash = round(f);
      f.tick(ticks(8));
      return { marks: slash.marks.map((id) => f.pids.indexOf(id)), hp: f.players.map((p) => p.hp) };
    };
    expect(run()).toEqual(run());
  });
});
