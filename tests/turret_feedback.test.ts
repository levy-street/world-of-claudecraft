import { describe, expect, it } from 'vitest';
import { FIRE_AND_FLY_SCENARIOS } from '../src/sim/content/fire_and_fly_scenarios';
import { TURRET_EXPLOSIVE_BARREL, TURRET_WEAPON } from '../src/sim/content/turret_defense';
import type { TurretEvent } from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan, turretChargesGiven } from '../src/sim/minigames/turret_defense_plan';
import {
  recordTurretFeedback,
  TURRET_FEEDBACK_LIMIT,
  type TurretFeedback,
  turretFeedbackSince,
} from '../src/sim/minigames/turret_feedback';
import { TURRET_BOMBLETS, turretFragBomblets } from '../src/sim/minigames/turret_fragmentation';

const event = (wave: number): TurretEvent => ({ type: 'waveStart', wave, count: 1 });

describe('the turret feedback ring', () => {
  it('numbers events from the next seq with their tick, in order, and freezes them', () => {
    const ring: TurretFeedback[] = [];
    const next = recordTurretFeedback(ring, 1, 7, [event(0), event(1)]);
    expect(next).toBe(3);
    expect(ring.map((f) => [f.seq, f.tick, f.event])).toEqual([
      [1, 7, event(0)],
      [2, 7, event(1)],
    ]);
    expect(Object.isFrozen(ring[0])).toBe(true);
    expect(Object.isFrozen(ring[0].event)).toBe(true);
    expect(recordTurretFeedback(ring, next, 8, [])).toBe(next);
    expect(ring).toHaveLength(2);
  });

  it('holds the worst single-tick burst any scenario can emit, its leading impact included', () => {
    // Shells fired a reload apart land on one tick when their flights differ by a reload.
    const w = TURRET_WEAPON;
    const shells = Math.ceil((w.maxFlightTicks - w.minFlightTicks + 1) / w.cooldownTicks);
    expect(shells).toBe(2);
    // A frag's star lands one bomblet a tick, however many it holds: one per frag per tick.
    const landings = turretFragBomblets(0, 0, 0, 1, 0).map((b) => b.landTick);
    expect(new Set(landings).size).toBe(TURRET_BOMBLETS);
    // Per plan: every landing shell's impact (a frag's burst is one event more, with no blast
    // of its own), a bomblet of every frag shell a run holds, its resupplies included (each
    // frag lands one a tick),
    // the Shockwave's front and every barrel its cap lets stand blasting on one tick, each then
    // a launch and a kill per living body of its widest wave (every living monster is the
    // current wave's: the next one starts only once it is cleared), every barrel lit once,
    // and per knock a bowled, launch and kill; a seat's actions between two ticks add a shot
    // and a slam, and the blast that clears the wave adds its clear, then the end, or the
    // resupply, the next wave's start and its kegs, all on that tick.
    const bursts = FIRE_AND_FLY_SCENARIOS.map((scenario) => {
      const plan = resolveTurretPlan(scenario);
      const widest = Math.max(...plan.waves.map((wave) => wave.spawns.length));
      const cap = Math.max(
        ...plan.waves.map((wave) => wave.barrels.cap ?? TURRET_EXPLOSIVE_BARREL.cap),
      );
      const front = plan.arsenal.shockwave > 0 ? 1 : 0;
      const frags = turretChargesGiven(plan, plan.resupplyWaves.length).fragmentation;
      const blasts = shells + frags + front + cap;
      const ending = plan.waves.length > 1 ? 4 : 2;
      // A hunt's departure cue: rallies leave half a second apart, so at most one cue a tick.
      const cue = plan.waves.some((wave) => wave.hunt) ? 1 : 0;
      const burst =
        blasts * (1 + widest * 2) + shells + cap + widest * 3 + 1 + front + ending + cue;
      return [scenario.boardKey, burst] as const;
    });
    // The Powder Store's 63-monster finale through 12 standing kegs, with a third resupply's
    // frag (lot R4), sets the bound; The Deluge's 60 and The Pack's 34 beside its eight frags
    // come next. With no overlap (lot R5) the living are one wave's, and a clear adds its wave's
    // start and kegs on the same tick. The most one tick has recorded in a measured run is 58
    // entries (lot N2d), 41 in lot R5b's measured runs, far under any of these.
    expect(Object.fromEntries(bursts)).toEqual({
      introduction: 515,
      standard: 506,
      hard: 772,
      pack: 1220,
      giants: 781,
      deluge: 1888,
      brittle: 1303,
      powder: 2876,
    });
    const burst = Math.max(...bursts.map(([, n]) => n));
    expect(TURRET_FEEDBACK_LIMIT).toBeGreaterThanOrEqual(burst);
    expect(TURRET_FEEDBACK_LIMIT).toBe(2876);
    const ring: TurretFeedback[] = [];
    recordTurretFeedback(
      ring,
      1,
      0,
      Array.from({ length: burst }, (_, i) => event(i)),
    );
    expect(ring[0].seq).toBe(1);
    expect(ring).toHaveLength(burst);
  });

  it('keeps only the newest entries once past the limit', () => {
    const ring: TurretFeedback[] = [];
    let next = recordTurretFeedback(ring, 1, 0, [event(0), event(1)]);
    const burst = Array.from({ length: TURRET_FEEDBACK_LIMIT + 5 }, (_, i) => event(i + 2));
    next = recordTurretFeedback(ring, next, 1, burst);
    expect(next).toBe(3 + burst.length);
    expect(ring).toHaveLength(TURRET_FEEDBACK_LIMIT);
    expect(ring[0].seq).toBe(next - TURRET_FEEDBACK_LIMIT);
    expect(ring.map((f) => f.event)).toEqual(burst.slice(-TURRET_FEEDBACK_LIMIT));
  });

  it('hands a consumer each entry once, by seq', () => {
    const ring: TurretFeedback[] = [];
    recordTurretFeedback(ring, 1, 0, [event(0), event(1), event(2)]);
    expect(turretFeedbackSince(ring, 0).map((f) => f.seq)).toEqual([1, 2, 3]);
    expect(turretFeedbackSince(ring, 2).map((f) => f.seq)).toEqual([3]);
    expect(turretFeedbackSince(ring, 3)).toEqual([]);
    expect(turretFeedbackSince([], 5)).toEqual([]);
    // Nothing new is the per-frame read: one shared empty batch, never a fresh array.
    expect(turretFeedbackSince(ring, 3)).toBe(turretFeedbackSince([], 0));
    expect(turretFeedbackSince(ring, 0)).not.toBe(ring);
  });

  it('shows a consumer that fell behind the ring where the gap is', () => {
    const ring: TurretFeedback[] = [];
    const burst = Array.from({ length: TURRET_FEEDBACK_LIMIT + 3 }, (_, i) => event(i));
    recordTurretFeedback(ring, 1, 0, burst);
    const fresh = turretFeedbackSince(ring, 1);
    expect(fresh).toHaveLength(TURRET_FEEDBACK_LIMIT);
    expect(fresh[0].seq).toBeGreaterThan(1 + 1);
  });
});
