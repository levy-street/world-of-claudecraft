// The Wheel of the Hearth over a REAL Sim claim: every tier and every fighting phase
// since the rework of 2026-11-18 (Normal slowest with the longest warning, Heroic
// quicker, Mythic quicker still and a round longer). Jose's call of 2026-11-25: four
// 45 degree wedges in front of the guardian and the same four mirrored behind it,
// three erupting and one safe on EACH side, the two safe wedges picked apart; the
// tier's rounds back to back with the next safe wedges shown as the last erupt, never
// over Wakefire, deterministic, and a wipe clears it. Plus the wedges' geometry, the
// template ids and the shader's arcs.

import { describe, expect, it } from 'vitest';
import { wheelArc } from '../src/render/smith_heart_fx/heat_fight_fx_core';
import { HEARTH_WELL } from '../src/sim/content/smith_heart_layout';
import {
  FIST_SPAN,
  HEAT_DIFFICULTY,
  HEAT_LIP_WALL,
  HEAT_NAMES,
  HEAT_OBJECTS,
  HEAT_PHASE_KIT,
  HEAT_TUNING as T,
  WHEEL_ARCS_DEG,
  WHEEL_SIDE,
  WHEEL_SLICES,
  wheelOf,
  wheelSliceAt,
  wheelTemplate,
} from '../src/sim/encounters/smith_heart';
import { inHearthFloor } from '../src/sim/encounters/smith_heart/heat_geometry';
import { wheelCrossing, wheelSafes } from '../src/sim/encounters/smith_heart/heat_wheel';
import { RUN_SPEED, type SimEvent } from '../src/sim/types';
import { t } from '../src/ui/i18n';
import { localizeSimAuraName } from '../src/ui/sim_i18n';
import { hitsOf } from './helpers/council_fight';
import { type HeatFight, heatFight } from './helpers/heat_fight';

const ticks = (s: number) => Math.round(s * 20);
const DT_S = 1 / 20;
const M = HEAT_DIFFICULTY.mythic.wheel;

function mythic(n = 4): HeatFight {
  return tier('mythic', n);
}

/** A pulled fight on `tierName` in `phase`, every clock held. */
function tier(tierName: 'normal' | 'heroic' | 'mythic', n = 4, phase = 2): HeatFight {
  const f = heatFight(n, 31);
  f.dev('/dev heart heat pull');
  if (tierName !== 'normal') f.dev(`/dev heart heat ${tierName}`);
  f.dev(`/dev heart heat phase ${phase}`);
  const st = f.state();
  if (!st) throw new Error('no fight');
  st.seedTimer = 999;
  st.zoneTimer = 999;
  st.cinderTimer = 999;
  st.fistTimer = 999;
  st.wheelTimer = 999;
  return f;
}

/** A spot on the shore in the middle of `slice`, `r` yards from the wellspring. */
function spot(slice: number, r = 22) {
  const [a, b] = WHEEL_ARCS_DEG[slice];
  const deg = ((a + b) / 2) * (Math.PI / 180);
  return { x: HEARTH_WELL.x + Math.sin(deg) * r, z: HEARTH_WELL.z + Math.cos(deg) * r };
}

/** A wedge's bearing span (radians, sim facing). */
function arcOf(slice: number): [number, number] {
  const [a, b] = WHEEL_ARCS_DEG[slice];
  return [(a * Math.PI) / 180, (b * Math.PI) / 180];
}

/** The walk from wedge `from` to wedge `to` (the same side) at `ring` yards
 *  from the wellspring: from `inset` inside `from`'s edge toward `to` to
 *  `inset` inside `to`'s near edge, straight where that line clears the lip
 *  wall by a body's half yard, else round it; one point per tick at run
 *  speed. */
function crossingPath(from: number, to: number, ring: number, inset: number) {
  const [f0, f1] = arcOf(from);
  let [t0, t1] = arcOf(to);
  // The back wedges straddle the frame's seam (270 is -90): unwrap.
  const gap = (t0 + t1) / 2 - (f0 + f1) / 2;
  if (gap > Math.PI) {
    t0 -= 2 * Math.PI;
    t1 -= 2 * Math.PI;
  } else if (gap < -Math.PI) {
    t0 += 2 * Math.PI;
    t1 += 2 * Math.PI;
  }
  const up = (t0 + t1) / 2 > (f0 + f1) / 2;
  const a0 = up ? f1 - inset : f0 + inset;
  const a1 = up ? t0 + inset : t1 - inset;
  const at = (a: number) => ({
    x: HEARTH_WELL.x + Math.sin(a) * ring,
    z: HEARTH_WELL.z + Math.cos(a) * ring,
  });
  const half = Math.abs(a1 - a0) / 2;
  const straight = ring * Math.cos(half) > HEAT_LIP_WALL.outer + 0.5;
  const length = straight ? 2 * ring * Math.sin(half) : 2 * half * ring;
  const n = Math.max(1, Math.ceil(length / (RUN_SPEED * DT_S)));
  const p0 = at(a0);
  const p1 = at(a1);
  const points: { x: number; z: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    points.push(
      straight
        ? { x: p0.x + (p1.x - p0.x) * k, z: p0.z + (p1.z - p0.z) * k }
        : at(a0 + (a1 - a0) * k),
    );
  }
  return { points, length };
}

describe('Guardian of the Heat: the Wheel of the Hearth', () => {
  it('turns on every tier and in every fighting phase: Normal slowest, Mythic quickest and longest', () => {
    for (const phase of [1, 2, 3] as const) expect(HEAT_PHASE_KIT[phase].wheel).toBe(true);
    const n = HEAT_DIFFICULTY.normal.wheel;
    const h = HEAT_DIFFICULTY.heroic.wheel;
    expect(n.warn).toBeGreaterThan(h.warn);
    expect(h.warn).toBeGreaterThan(M.warn);
    expect(n.every).toBeGreaterThan(h.every);
    expect(n.rounds).toBe(3);
    expect(h.rounds).toBe(3);
    expect(M.rounds).toBe(4);
    // Normal: a heavy hit, never a death on its own; Heroic and Mythic the full blow.
    expect(n.hit).toBeLessThan(0.7);
    expect(h.hit).toBe(1);
    expect(M.hit).toBe(1);
  });

  it('the wedges: four of 45 degrees in front, their mirrors behind, every bearing in one', () => {
    expect(WHEEL_SLICES).toBe(2 * WHEEL_SIDE);
    expect(WHEEL_SIDE).toBe(4);
    for (const [a, b] of WHEEL_ARCS_DEG) expect(b - a).toBe(45);
    // In front (toward the door, east): bearings 0 to 180.
    for (let i = 0; i < WHEEL_SIDE; i++) {
      expect(WHEEL_ARCS_DEG[i][0]).toBeGreaterThanOrEqual(0);
      expect(WHEEL_ARCS_DEG[i][1]).toBeLessThanOrEqual(180);
      // Its mirror behind, across the north-south line.
      const [a, b] = WHEEL_ARCS_DEG[i];
      const [ma, mb] = WHEEL_ARCS_DEG[i + WHEEL_SIDE];
      const norm = (d: number) => ((d % 360) + 360) % 360;
      expect(norm(ma)).toBe(norm(360 - b));
      expect(norm(mb)).toBe(norm(360 - a));
    }
    for (let slice = 0; slice < WHEEL_SLICES; slice++) {
      const p = spot(slice);
      expect(wheelSliceAt(p.x, p.z)).toBe(slice);
    }
    const count = new Array(WHEEL_SLICES).fill(0);
    for (let i = 0; i < 360; i++) {
      const a = ((i + 0.5) * Math.PI) / 180;
      count[wheelSliceAt(HEARTH_WELL.x + Math.sin(a) * 20, HEARTH_WELL.z + Math.cos(a) * 20)]++;
    }
    expect(count).toEqual(new Array(WHEEL_SLICES).fill(45));
  });

  it('the painted arcs are the same wedges', () => {
    for (let slice = 0; slice < WHEEL_SLICES; slice++) {
      const arc = wheelArc(slice);
      const p = spot(slice);
      let bearing = Math.atan2(p.x - HEARTH_WELL.x, p.z - HEARTH_WELL.z);
      // The shader's frame: bearings from -90 degrees round to 270.
      if (bearing < -Math.PI / 2) bearing += 2 * Math.PI;
      expect(bearing).toBeGreaterThan(arc.from);
      expect(bearing).toBeLessThan(arc.to);
    }
  });

  it('the safe wedges: one each side, hashed apart, one or two over, never round the far side', () => {
    let differ = 0;
    for (let run = 0; run < 40; run++) {
      const { front, back } = wheelSafes(run, M.rounds);
      expect(front.length).toBe(M.rounds);
      expect(back.length).toBe(M.rounds);
      for (const [side, list] of [
        [0, front],
        [WHEEL_SIDE, back],
      ] as const) {
        for (let i = 0; i < list.length; i++) {
          expect(list[i]).toBeGreaterThanOrEqual(side);
          expect(list[i]).toBeLessThan(side + WHEEL_SIDE);
          if (i === 0) continue;
          const step = Math.abs(list[i] - list[i - 1]);
          expect(step).toBeGreaterThanOrEqual(1);
          expect(step).toBeLessThanOrEqual(2);
        }
      }
      if (back[0] - WHEEL_SIDE !== front[0]) differ++;
    }
    // Independent picks: the back's safe wedge is not the front's mirror.
    expect(differ).toBeGreaterThan(5);
    expect(wheelSafes(5, 3)).toEqual(wheelSafes(5, 3));
    expect(wheelSafes(5, 4).front.slice(0, 3)).toEqual(wheelSafes(5, 3).front);
  });

  it('the crossing: the wedges between on its own side, then the next safe one', () => {
    expect(wheelCrossing(0, 1)).toEqual([1]);
    expect(wheelCrossing(2, 1)).toEqual([1]);
    expect(wheelCrossing(0, 2)).toEqual([1, 2]);
    expect(wheelCrossing(7, 5)).toEqual([6, 5]);
    expect(wheelCrossing(2, 2)).toEqual([]);
  });

  it('a raider behind the guardian is struck by a red wedge there and spared on the safe one', () => {
    const f = mythic();
    f.dev('/dev heart heat wheel');
    const st = f.state();
    if (!st) throw new Error('no fight');
    const safe = st.wheelSafesBack[0];
    const red = safe === WHEEL_SIDE ? WHEEL_SIDE + 1 : WHEEL_SIDE;
    const [a, b] = f.players;
    const rp = spot(red);
    const sp = spot(safe);
    f.put(a, rp.x, rp.z);
    f.put(b, sp.x, sp.z);
    const ev = f.tick(ticks(M.warn) + 1);
    expect(hitsOf(ev, HEAT_NAMES.wheel, a.id).length).toBeGreaterThanOrEqual(1);
    expect(hitsOf(ev, HEAT_NAMES.wheel, b.id)).toEqual([]);
  });

  it('the templates read back', () => {
    expect(wheelOf(wheelTemplate(2, 'warn', 4))).toEqual({ slice: 2, state: 'warn', seconds: 4 });
    expect(wheelOf(wheelTemplate(6, 'safe', 4))).toEqual({ slice: 6, state: 'safe', seconds: 4 });
    expect(wheelOf('sh_heat_zone_0_warn_40')).toBeNull();
  });

  it('six wedges warn and two show safe (one each side), only the red ones erupt', () => {
    const f = mythic();
    f.dev('/dev heart heat wheel');
    const st = f.state();
    if (!st) throw new Error('no fight');
    const objects = f.objects(HEAT_OBJECTS.wheelPrefix).map((e) => wheelOf(e.templateId));
    expect(objects.filter((o) => o?.state === 'warn').length).toBe(WHEEL_SLICES - 2);
    const safes = objects.filter((o) => o?.state === 'safe').map((o) => o?.slice ?? -1);
    expect(safes.sort((x, y) => x - y)).toEqual([st.wheelSafes[0], st.wheelSafesBack[0]]);
    const [a, b, c] = f.players;
    const front = spot(st.wheelSafes[0]);
    const back = spot(st.wheelSafesBack[0]);
    const red = (st.wheelSafes[0] + 1) % WHEEL_SIDE;
    const rp = spot(red);
    f.put(a, front.x, front.z);
    f.put(b, rp.x, rp.z);
    f.put(c, back.x, back.z);
    const ev = f.tick(ticks(M.warn) + 1);
    expect(hitsOf(ev, HEAT_NAMES.wheel, a.id)).toEqual([]);
    expect(hitsOf(ev, HEAT_NAMES.wheel, c.id)).toEqual([]);
    expect(hitsOf(ev, HEAT_NAMES.wheel, b.id).length).toBeGreaterThanOrEqual(1);
    expect(hitsOf(ev, HEAT_NAMES.wheel, b.id)[0]).toBeGreaterThanOrEqual(T.wheelMin);
  });

  it('as one round erupts the next shows its two safe wedges, and the run ends after its rounds', () => {
    const f = mythic();
    f.dev('/dev heart heat wheel');
    const st = f.state();
    if (!st) throw new Error('no fight');
    const front = [...st.wheelSafes];
    const back = [...st.wheelSafesBack];
    expect(front.length).toBe(M.rounds);
    f.tick(ticks(M.warn) + 1);
    const shown = f
      .objects(HEAT_OBJECTS.wheelPrefix)
      .map((e) => wheelOf(e.templateId))
      .filter((o) => o?.state === 'safe')
      .map((o) => o?.slice ?? -1)
      .sort((x, y) => x - y);
    expect(shown).toEqual([front[1], back[1]]);
    f.tick(ticks(M.warn) * (M.rounds - 1) + ticks(T.wheelBurn) + 4);
    expect(st.wheelRounds).toEqual([]);
    expect(f.objects(HEAT_OBJECTS.wheelPrefix)).toEqual([]);
  });

  it('standing in each new safe wedge, in front and behind, keeps you whole', () => {
    const f = mythic();
    f.dev('/dev heart heat wheel');
    const st = f.state();
    if (!st) throw new Error('no fight');
    const [a, b] = f.players;
    let hits = 0;
    const count = (ev: SimEvent[]) => {
      hits += hitsOf(ev, HEAT_NAMES.wheel, a.id).length + hitsOf(ev, HEAT_NAMES.wheel, b.id).length;
    };
    const back = [...st.wheelSafesBack];
    [...st.wheelSafes].forEach((safe, i) => {
      const fp = spot(safe);
      const bp = spot(back[i]);
      f.put(a, fp.x, fp.z);
      f.put(b, bp.x, bp.z);
      count(f.tick(ticks(M.warn) + 1));
    });
    expect(hits).toBeLessThanOrEqual(2 * M.rounds * Math.ceil(T.wheelBurn / T.wheelTick));
  });

  it("starts by each tier's own clock in phase 1, warns its own time, and a reset clears it", () => {
    for (const name of ['normal', 'heroic', 'mythic'] as const) {
      const w = HEAT_DIFFICULTY[name].wheel;
      const f = tier(name, 2, 1);
      const st = f.state();
      if (!st) throw new Error('no fight');
      st.wheelTimer = w.first;
      f.tick(ticks(w.first) - 2);
      expect(f.objects(HEAT_OBJECTS.wheelPrefix)).toEqual([]);
      f.tick(3);
      const slices = f.objects(HEAT_OBJECTS.wheelPrefix).map((e) => wheelOf(e.templateId));
      expect(slices.length).toBe(WHEEL_SLICES);
      for (const o of slices) expect(o?.seconds).toBe(w.warn);
      expect(st.wheelSafes.length).toBe(w.rounds);
      // The next run waits its tier's gap.
      expect(st.wheelTimer).toBeCloseTo(w.every - DT_S, 6);
      f.dev('/dev heart heat reset');
      expect(f.objects(HEAT_OBJECTS.wheelPrefix)).toEqual([]);
    }
  });

  it('never shares the floor with Wakefire: a due Wheel waits out the run and room for a fist, then turns', () => {
    const f = tier('normal', 2, 2);
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.zoneTimer = 0.01;
    st.wheelTimer = 0.5;
    let wheelAt = -1;
    for (let i = 0; i < ticks(30) && wheelAt < 0; i++) {
      f.tick(1);
      for (const p of f.players) p.hp = p.maxHp;
      if (st.wheelRounds.length > 0) {
        wheelAt = i / 20;
        expect(st.zones).toEqual([]);
        expect(st.zoneRun).toBeNull();
      }
    }
    // The run's start spaces the Wheel past the run and a fist's whole span.
    const after = 2 * T.zoneStep + T.zoneWarn + T.zoneBurn + FIST_SPAN + 2;
    expect(wheelAt).toBeGreaterThan(after - 0.2);
    expect(wheelAt).toBeLessThan(after + 0.5);
  });

  it('waits out the Hearthseeds (the raid runs from them first), then turns', () => {
    const f = tier('normal', 3, 2);
    const st = f.state();
    if (!st) throw new Error('no fight');
    f.dev('/dev heart heat seeds');
    expect(st.seeds.length).toBeGreaterThan(0);
    st.wheelTimer = 0.05;
    let wheelAt = -1;
    for (let i = 0; i < ticks(20) && wheelAt < 0; i++) {
      f.tick(1);
      for (const p of f.players) p.hp = p.maxHp;
      if (st.wheelRounds.length > 0) {
        wheelAt = i / 20;
        expect(st.seeds).toEqual([]);
      }
    }
    expect(wheelAt).toBeGreaterThan(T.seedLife - 0.5);
  });

  // Jose's playtest of 2026-11-24 (Heroic, after the lip wall): "the next safe
  // zone takes a while to get coloured, and if you get distracted for a second
  // there is no time to get in". The way to each next safe wedge goes out at once.
  it('the way to the next safe wedges is put out at once: stepping in at the eruption is never burned', () => {
    for (const name of ['normal', 'heroic', 'mythic'] as const) {
      const w = HEAT_DIFFICULTY[name].wheel;
      const f = tier(name, 2);
      const st = f.state();
      if (!st) throw new Error('no fight');
      f.dev('/dev heart heat wheel');
      const front = [...st.wheelSafes];
      const back = [...st.wheelSafesBack];
      const [a, b] = f.players;
      const fp = spot(front[0], 16);
      const bp = spot(back[0], 16);
      f.put(a, fp.x, fp.z);
      f.put(b, bp.x, bp.z);
      f.tick(ticks(w.warn) + 1);
      expect(st.wheelRounds.length).toBe(2);
      // The instant the next safe wedges show, step onto the wedge crossed to
      // reach each (a in front, b behind).
      const cf = wheelCrossing(front[0], front[1]);
      const cb = wheelCrossing(back[0], back[1]);
      const vf = spot(cf[0], 16);
      const vb = spot(cb[0], 16);
      f.put(a, vf.x, vf.z);
      f.put(b, vb.x, vb.z);
      const ev = f.tick(ticks(T.wheelBurn) + 2);
      expect(hitsOf(ev, HEAT_NAMES.wheel, a.id)).toEqual([]);
      expect(hitsOf(ev, HEAT_NAMES.wheel, b.id)).toEqual([]);
    }
  });

  it('the next safe wedges read safe within wheelDouse: the fire on the way goes out', () => {
    const w = HEAT_DIFFICULTY.heroic.wheel;
    const f = tier('heroic', 2);
    const st = f.state();
    if (!st) throw new Error('no fight');
    f.dev('/dev heart heat wheel');
    const front = [...st.wheelSafes];
    const back = [...st.wheelSafesBack];
    const slices = () => f.objects(HEAT_OBJECTS.wheelPrefix).map((e) => wheelOf(e.templateId));
    const burns = () => slices().filter((o) => o?.state === 'burn');
    f.tick(ticks(w.warn) + 1);
    const crossing = [...wheelCrossing(front[0], front[1]), ...wheelCrossing(back[0], back[1])];
    const now = burns();
    expect(now.length).toBe(WHEEL_SLICES - 2);
    for (const o of now)
      expect(o?.seconds).toBeCloseTo(
        crossing.includes(o?.slice ?? -1) ? T.wheelDouse : T.wheelBurn,
        6,
      );
    expect(T.wheelDouse).toBeLessThan(T.wheelTick);
    for (const o of slices().filter((o) => o?.state === 'warn')) expect(o?.seconds).toBe(w.warn);
    f.tick(ticks(T.wheelDouse) + 1);
    const left = burns().map((o) => o?.slice);
    for (const slice of crossing) expect(left).not.toContain(slice);
    expect(left.length).toBe(WHEEL_SLICES - 2 - crossing.length);
  });

  it('the last round of a run burns every red wedge its whole time (nothing to cross to)', () => {
    const w = HEAT_DIFFICULTY.heroic.wheel;
    const f = tier('heroic', 2);
    const st = f.state();
    if (!st) throw new Error('no fight');
    f.dev('/dev heart heat wheel');
    f.tick((ticks(w.warn) + 1) * w.rounds);
    const burns = f
      .objects(HEAT_OBJECTS.wheelPrefix)
      .map((e) => wheelOf(e.templateId))
      .filter((o) => o?.state === 'burn' && o.seconds === T.wheelBurn);
    expect(burns.length).toBe(WHEEL_SLICES - 2);
  });

  it('every crossing (one or two over) is walkable round the lip wall in time, melee and ranged ring', () => {
    const inset = (3 * Math.PI) / 180;
    for (const name of ['normal', 'heroic', 'mythic'] as const) {
      const w = HEAT_DIFFICULTY[name].wheel;
      const window = w.warn - T.wheelDouse;
      for (const [ring, spare] of [
        [HEAT_LIP_WALL.outer + 1, 0.5],
        [HEAT_LIP_WALL.outer + 7, 0.2],
      ] as const) {
        for (const side of [0, WHEEL_SIDE])
          for (let from = side; from < side + WHEEL_SIDE; from++)
            for (const step of [-2, -1, 1, 2]) {
              const to = from + step;
              if (to < side || to >= side + WHEEL_SIDE) continue;
              const path = crossingPath(from, to, ring, inset);
              for (const p of path.points) {
                expect(inHearthFloor(p.x, p.z)).toBe(true);
                expect(Math.hypot(p.x - HEARTH_WELL.x, p.z - HEARTH_WELL.z)).toBeGreaterThan(
                  HEAT_LIP_WALL.outer,
                );
              }
              expect(
                path.length / RUN_SPEED + spare,
                `${name} ${from} to ${to}`,
              ).toBeLessThanOrEqual(window);
            }
      }
    }
  });

  it('names itself; the guardian calls it, no banner does', () => {
    expect(localizeSimAuraName(HEAT_NAMES.wheel)).toBe('Wheel of the Hearth');
    expect(t('hudChrome.heatGuardian.say.wheel' as never)).toContain('Hearth turns');
  });
});
