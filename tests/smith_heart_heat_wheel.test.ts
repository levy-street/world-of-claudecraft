// The Wheel of the Hearth over a REAL Sim claim: every tier and every fighting phase
// since the rework of 2026-11-18 (Normal slowest with the longest warning, Heroic
// quicker, Mythic quicker still and a round longer), four slices round the wellspring,
// three erupt and one stays safe, the tier's rounds back to back with the next safe
// slice shown as the last erupts, never over Wakefire, deterministic, and a wipe clears
// it. Plus the slices' geometry, the template ids and the shader's arcs.

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

/** A spot on the shore in `slice`, `r` yards from the wellspring. */
function spot(slice: number, r = 22) {
  const deg = (slice * 45 + 22.5) * (Math.PI / 180);
  return { x: HEARTH_WELL.x + Math.sin(deg) * r, z: HEARTH_WELL.z + Math.cos(deg) * r };
}

/** A run whose safe slices step two over at least once (the hard crossing). */
function twoStepRun(rounds: number): number {
  for (let run = 0; run < 200; run++) {
    const safes = wheelSafes(run, rounds);
    for (let i = 1; i < safes.length; i++) if (Math.abs(safes[i] - safes[i - 1]) === 2) return run;
  }
  throw new Error('no two-step run');
}

/** A slice's bearing span (radians, sim facing). */
function arcOf(slice: number): [number, number] {
  const [a, b] = WHEEL_ARCS_DEG[slice];
  return [(a * Math.PI) / 180, (b * Math.PI) / 180];
}

/** The walk from slice `from` to slice `to` at `ring` yards from the
 *  wellspring: from `inset` inside `from`'s edge toward `to` to `inset` inside
 *  `to`, the short way (over the shore), straight where that line clears the
 *  lip wall by a body's half yard, else round it; one point per tick at run
 *  speed. */
function crossingPath(from: number, to: number, ring: number, inset: number) {
  const [f0, f1] = arcOf(from);
  const [t0, t1] = arcOf(to);
  const up = to > from;
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

  it('the slices: four round the shore, every bearing in exactly one', () => {
    for (let slice = 0; slice < WHEEL_SLICES; slice++) {
      const p = spot(slice);
      expect(wheelSliceAt(p.x, p.z)).toBe(slice);
    }
    // Behind the wellspring it belongs to the slice at that end.
    expect(wheelSliceAt(HEARTH_WELL.x - 5, HEARTH_WELL.z + 20)).toBe(0);
    expect(wheelSliceAt(HEARTH_WELL.x - 5, HEARTH_WELL.z - 20)).toBe(3);
  });

  it('the painted arcs are the same slices', () => {
    for (let slice = 0; slice < WHEEL_SLICES; slice++) {
      const arc = wheelArc(slice);
      const p = spot(slice);
      const bearing = Math.atan2(p.x - HEARTH_WELL.x, p.z - HEARTH_WELL.z);
      expect(bearing).toBeGreaterThan(arc.from);
      expect(bearing).toBeLessThan(arc.to);
    }
  });

  it('the safe slices: hashed, never the same twice running, one or two apart', () => {
    for (let run = 0; run < 40; run++) {
      const safes = wheelSafes(run, M.rounds);
      expect(safes.length).toBe(M.rounds);
      for (let i = 0; i < safes.length; i++) {
        expect(safes[i]).toBeGreaterThanOrEqual(0);
        expect(safes[i]).toBeLessThan(WHEEL_SLICES);
        if (i === 0) continue;
        const gap = Math.abs(safes[i] - safes[i - 1]);
        expect(gap === 1 || gap === 2).toBe(true);
      }
    }
    expect(wheelSafes(5, 3)).toEqual(wheelSafes(5, 3));
    expect(wheelSafes(5, 4).slice(0, 3)).toEqual(wheelSafes(5, 3));
  });

  it('the crossing: the slices between, then the next safe one, the short way over the shore', () => {
    expect(wheelCrossing(0, 1)).toEqual([1]);
    expect(wheelCrossing(0, 2)).toEqual([1, 2]);
    expect(wheelCrossing(3, 1)).toEqual([2, 1]);
    expect(wheelCrossing(2, 0)).toEqual([1, 0]);
    expect(wheelCrossing(2, 2)).toEqual([]);
  });

  it('the templates read back', () => {
    expect(wheelOf(wheelTemplate(2, 'warn', 4))).toEqual({ slice: 2, state: 'warn', seconds: 4 });
    expect(wheelOf(wheelTemplate(0, 'safe', 4))).toEqual({ slice: 0, state: 'safe', seconds: 4 });
    expect(wheelOf('sh_heat_zone_0_warn_40')).toBeNull();
  });

  it('three slices warn and one shows safe, only the red ones erupt', () => {
    const f = mythic();
    f.dev('/dev heart heat wheel');
    const st = f.state();
    if (!st) throw new Error('no fight');
    const objects = f.objects(HEAT_OBJECTS.wheelPrefix).map((e) => wheelOf(e.templateId));
    expect(objects.filter((o) => o?.state === 'warn').length).toBe(3);
    expect(objects.filter((o) => o?.state === 'safe').length).toBe(1);
    const safe = st.wheelSafes[0];
    const red = (safe + 1) % WHEEL_SLICES;
    const [a, b] = f.players;
    const sp = spot(safe);
    const rp = spot(red);
    f.put(a, sp.x, sp.z);
    f.put(b, rp.x, rp.z);
    const ev = f.tick(ticks(M.warn) + 1);
    expect(hitsOf(ev, HEAT_NAMES.wheel, a.id)).toEqual([]);
    expect(hitsOf(ev, HEAT_NAMES.wheel, b.id).length).toBeGreaterThanOrEqual(1);
    expect(hitsOf(ev, HEAT_NAMES.wheel, b.id)[0]).toBeGreaterThanOrEqual(T.wheelMin);
  });

  it('as one round erupts the next shows, on another slice, and three run in all', () => {
    const f = mythic();
    f.dev('/dev heart heat wheel');
    const st = f.state();
    if (!st) throw new Error('no fight');
    const safes = [...st.wheelSafes];
    expect(safes.length).toBe(M.rounds);
    f.tick(ticks(M.warn) + 1);
    const shown = f
      .objects(HEAT_OBJECTS.wheelPrefix)
      .map((e) => wheelOf(e.templateId))
      .filter((o) => o?.state === 'safe');
    expect(shown.map((o) => o?.slice)).toEqual([safes[1]]);
    f.tick(ticks(M.warn) * (M.rounds - 1) + ticks(T.wheelBurn) + 4);
    expect(st.wheelRounds).toEqual([]);
    expect(f.objects(HEAT_OBJECTS.wheelPrefix)).toEqual([]);
  });

  it('standing in the new safe slice as the last burn dies keeps you whole', () => {
    const f = mythic();
    f.dev('/dev heart heat wheel');
    const st = f.state();
    if (!st) throw new Error('no fight');
    const [a] = f.players;
    let hits = 0;
    const count = (ev: SimEvent[]) => {
      hits += hitsOf(ev, HEAT_NAMES.wheel, a.id).length;
    };
    for (const safe of [...st.wheelSafes]) {
      const sp = spot(safe);
      f.put(a, sp.x, sp.z);
      // Rests on this round's safe slice until its eruption and its burn pass.
      count(f.tick(ticks(M.warn) + 1));
    }
    expect(hits).toBeLessThanOrEqual(M.rounds * Math.ceil(T.wheelBurn / T.wheelTick));
    expect(st.wheelSafes.length).toBe(M.rounds);
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
  // there is no time to get in". The last round's fire burned the next safe
  // slice (and the slice between, two over) for its whole wheelBurn, so the
  // crossing only opened warn - wheelBurn before the next eruption (Heroic 2 s,
  // Mythic 1.5 s) while the wall had pushed the shore two yards out.
  it('the way to the next safe slice is put out at once: stepping in at the eruption is never burned', () => {
    for (const name of ['normal', 'heroic', 'mythic'] as const) {
      const w = HEAT_DIFFICULTY[name].wheel;
      const f = tier(name, 2);
      const st = f.state();
      if (!st) throw new Error('no fight');
      st.wheelRuns = twoStepRun(w.rounds);
      f.dev('/dev heart heat wheel');
      const safes = [...st.wheelSafes];
      const [a, b] = f.players;
      const sp = spot(safes[0], 16);
      f.put(a, sp.x, sp.z);
      f.put(b, sp.x, sp.z);
      f.tick(ticks(w.warn) + 1);
      expect(st.wheelRounds.length).toBe(2);
      // The instant the next safe slice shows, step onto it (a) and onto the
      // slice crossed to reach it (b).
      const crossing = wheelCrossing(safes[0], safes[1]);
      expect(crossing[crossing.length - 1]).toBe(safes[1]);
      const np = spot(safes[1], 16);
      f.put(a, np.x, np.z);
      const via = crossing.length > 1 ? spot(crossing[0], 16) : np;
      f.put(b, via.x, via.z);
      const ev = f.tick(ticks(T.wheelBurn) + 2);
      expect(hitsOf(ev, HEAT_NAMES.wheel, a.id)).toEqual([]);
      expect(hitsOf(ev, HEAT_NAMES.wheel, b.id)).toEqual([]);
    }
  });

  it('the next safe slice reads safe within wheelDouse: its fire, and the fire on the way, go out', () => {
    const w = HEAT_DIFFICULTY.heroic.wheel;
    const f = tier('heroic', 2);
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.wheelRuns = twoStepRun(w.rounds);
    f.dev('/dev heart heat wheel');
    const safes = [...st.wheelSafes];
    const slices = () => f.objects(HEAT_OBJECTS.wheelPrefix).map((e) => wheelOf(e.templateId));
    const burns = () => slices().filter((o) => o?.state === 'burn');
    // Walk to the two-step crossing.
    let k = 1;
    while (Math.abs(safes[k] - safes[k - 1]) !== 2) k++;
    f.tick((ticks(w.warn) + 1) * k);
    const crossing = wheelCrossing(safes[k - 1], safes[k]);
    expect(crossing.length).toBe(2);
    // At the eruption every red flares (the blow is seen), the way across only
    // briefly; the next round's safe slice is shown at once, its warning whole.
    const now = burns();
    expect(now.length).toBe(WHEEL_SLICES - 1);
    for (const o of now)
      expect(o?.seconds).toBeCloseTo(
        crossing.includes(o?.slice ?? -1) ? T.wheelDouse : T.wheelBurn,
        6,
      );
    expect(T.wheelDouse).toBeLessThan(T.wheelTick);
    expect(
      slices()
        .filter((o) => o?.state === 'safe')
        .map((o) => o?.slice),
    ).toEqual([safes[k]]);
    for (const o of slices().filter((o) => o?.state === 'warn')) expect(o?.seconds).toBe(w.warn);
    f.tick(ticks(T.wheelDouse) + 1);
    const left = burns().map((o) => o?.slice);
    for (const slice of crossing) expect(left).not.toContain(slice);
    expect(left.length).toBe(WHEEL_SLICES - 1 - crossing.length);
  });

  it('the last round of a run burns every red slice its whole time (nothing to cross to)', () => {
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
    expect(burns.length).toBe(WHEEL_SLICES - 1);
  });

  it('every crossing is walkable round the lip wall in time, at the melee and the ranged ring', () => {
    // From just inside the old safe slice's edge toward the next to just inside
    // the next, round the wall, at run speed, after the brief flare on the way.
    const inset = (3 * Math.PI) / 180;
    for (const name of ['normal', 'heroic', 'mythic'] as const) {
      const w = HEAT_DIFFICULTY[name].wheel;
      const window = w.warn - T.wheelDouse;
      for (const [ring, spare] of [
        [HEAT_LIP_WALL.outer + 1, 1],
        [HEAT_LIP_WALL.outer + 7, name === 'mythic' ? 0.3 : 0.75],
      ] as const) {
        for (let from = 0; from < WHEEL_SLICES; from++) {
          for (const to of [from - 2, from - 1, from + 1, from + 2]) {
            if (to < 0 || to >= WHEEL_SLICES) continue;
            const path = crossingPath(from, to, ring, inset);
            for (const p of path.points) {
              expect(inHearthFloor(p.x, p.z)).toBe(true);
              expect(Math.hypot(p.x - HEARTH_WELL.x, p.z - HEARTH_WELL.z)).toBeGreaterThan(
                HEAT_LIP_WALL.outer,
              );
            }
            expect(path.length / RUN_SPEED + spare).toBeLessThanOrEqual(window);
          }
        }
      }
    }
  });

  it('a raider walking the wall at run speed, half a second late, crosses every round unburnt', () => {
    for (const name of ['heroic', 'mythic'] as const) {
      const w = HEAT_DIFFICULTY[name].wheel;
      const f = tier(name, 1);
      const st = f.state();
      if (!st) throw new Error('no fight');
      st.wheelRuns = twoStepRun(w.rounds);
      f.dev('/dev heart heat wheel');
      const safes = [...st.wheelSafes];
      const [a] = f.players;
      const ring = HEAT_LIP_WALL.outer + 1.5;
      const inset = (3 * Math.PI) / 180;
      const start = crossingPath(safes[0], safes[1], ring, inset).points[0];
      f.put(a, start.x, start.z);
      let hits = hitsOf(f.tick(ticks(w.warn) + 1), HEAT_NAMES.wheel, a.id).length;
      for (let k = 1; k < safes.length; k++) {
        const path = crossingPath(safes[k - 1], safes[k], ring, inset);
        const late = ticks(0.5);
        hits += hitsOf(f.tick(late), HEAT_NAMES.wheel, a.id).length;
        for (const p of path.points) {
          f.put(a, p.x, p.z);
          hits += hitsOf(f.tick(1), HEAT_NAMES.wheel, a.id).length;
        }
        // Rest on the new safe slice (at its edge toward the next) to its eruption.
        const next =
          k + 1 < safes.length ? crossingPath(safes[k], safes[k + 1], ring, inset) : null;
        if (next) f.put(a, next.points[0].x, next.points[0].z);
        const rest = ticks(w.warn) + 1 - late - path.points.length;
        expect(rest).toBeGreaterThan(0);
        hits += hitsOf(f.tick(rest), HEAT_NAMES.wheel, a.id).length;
      }
      expect(hits).toBe(0);
    }
  });

  it('names itself; the guardian calls it, no banner does', () => {
    expect(localizeSimAuraName(HEAT_NAMES.wheel)).toBe('Wheel of the Hearth');
    expect(t('hudChrome.heatGuardian.say.wheel' as never)).toContain('Hearth turns');
  });
});
