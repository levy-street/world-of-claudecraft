import { describe, expect, it } from 'vitest';
import {
  TURRET_SCENARIO_HARD,
  TURRET_SCENARIO_INTRODUCTION,
  TURRET_SCENARIO_STANDARD,
  TURRET_SCENARIOS,
} from '../src/sim/content/fire_and_fly_scenarios';
import { TURRET_TIMING } from '../src/sim/content/turret_defense';
import type { ThrowProbe } from '../src/sim/minigames/thrown_body';
import {
  createTurretDefense,
  type TurretEvent,
  type TurretPhase,
  type TurretStats,
  tickTurretDefense,
} from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan, type TurretPlan } from '../src/sim/minigames/turret_defense_plan';
import {
  TURRET_BONUS_CAP,
  TURRET_POINTS,
  turretMedalBarPoints,
  turretResult,
} from '../src/sim/minigames/turret_result';
import { turretSessionView } from '../src/sim/turret_defense_session';
import type { TurretScenarioDef, TurretSession } from '../src/sim/types';

const START = 1000;
const flat: ThrowProbe = { ground: () => 0, water: () => null };

function final(
  phase: TurretPhase,
  integrity: number,
  stats: Partial<Pick<TurretStats, 'kills' | 'barrelKills' | 'bowled'>> = {},
) {
  return { phase, integrity, stats: { kills: 0, barrelKills: 0, bowled: 0, ...stats } };
}

describe('the medal bars of each scenario', () => {
  it('asks for a share of the tower points, rounded up to whole points', () => {
    const bars = TURRET_SCENARIOS.map((s) => {
      const plan = resolveTurretPlan(s);
      return [
        s.boardKey,
        turretMedalBarPoints(plan.medals.gold.minIntegrityShare, plan.integrity),
        turretMedalBarPoints(plan.medals.silver.minIntegrityShare, plan.integrity),
      ];
    });
    expect(bars).toEqual([
      ['introduction', 147, 135],
      ['standard', 97, 60],
      ['hard', 95, 60],
    ]);
    expect(turretMedalBarPoints(0.9, 100)).toBe(90);
    expect(turretMedalBarPoints(0.901, 100)).toBe(91);
    expect(turretMedalBarPoints(1, 150)).toBe(150);
  });

  it.each(TURRET_SCENARIOS.map((s) => [s.boardKey, s] as const))(
    'gives %s gold at its bar, silver just under it and down to its own bar, bronze below',
    (_key, scenario) => {
      const plan = resolveTurretPlan(scenario);
      const gold = turretMedalBarPoints(plan.medals.gold.minIntegrityShare, plan.integrity);
      const silver = turretMedalBarPoints(plan.medals.silver.minIntegrityShare, plan.integrity);
      const medal = (integrity: number) => turretResult(plan, final('won', integrity)).medal;
      expect(medal(plan.integrity)).toBe('gold');
      expect(medal(gold)).toBe('gold');
      expect(medal(gold - 1)).toBe('silver');
      expect(medal(silver)).toBe('silver');
      expect(medal(silver - 1)).toBe('bronze');
      expect(medal(1)).toBe('bronze');
    },
  );

  it('scales with the tower: the same shares ask for more points of a bigger tower', () => {
    const big = resolveTurretPlan({ ...TURRET_SCENARIO_STANDARD, integrity: 400 });
    expect(turretResult(big, final('won', 388)).medal).toBe('gold');
    expect(turretResult(big, final('won', 387)).medal).toBe('silver');
    expect(turretResult(big, final('won', 239)).medal).toBe('bronze');
  });
});

describe('a run with no medal', () => {
  it('earns none for a loss, whatever the tower kept, nor while the run lasts', () => {
    const plan = resolveTurretPlan();
    const lost = turretResult(plan, final('lost', 0, { kills: 40 }));
    expect(lost).toMatchObject({ won: false, medal: null });
    expect(lost.points).toBe(40 * TURRET_POINTS.kill);
    for (const phase of ['intro', 'wave', 'between', 'lost'] as const) {
      expect(turretResult(plan, final(phase, plan.integrity)).medal).toBeNull();
      expect(turretResult(plan, final(phase, plan.integrity)).won).toBe(false);
    }
  });
});

describe('the points', () => {
  const plan = resolveTurretPlan();

  it('adds each term: kills, tower points kept, keg kills and bodies bowled over', () => {
    const r = turretResult(plan, final('won', 97, { kills: 71, barrelKills: 4, bowled: 17 }));
    expect(r.breakdown).toEqual({
      kills: 71 * TURRET_POINTS.kill,
      integrity: 97 * TURRET_POINTS.integrity,
      kegKills: 4 * TURRET_POINTS.kegKill,
      bowled: 17 * TURRET_POINTS.bowled,
    });
    expect(r.points).toBe(1420 + 19_400 + 20 + 17);
    expect(r).toMatchObject({ won: true, medal: 'gold' });
  });

  it('counts only the tower points the plan can hold, never below none', () => {
    expect(turretResult(plan, final('won', 250)).breakdown.integrity).toBe(
      plan.integrity * TURRET_POINTS.integrity,
    );
    expect(turretResult(plan, final('lost', -5)).breakdown.integrity).toBe(0);
  });

  it('caps the keg and bowling bonus under one tower point, the keg kills first', () => {
    expect(TURRET_BONUS_CAP).toBe(TURRET_POINTS.integrity - 1);
    const kegs = turretResult(plan, final('won', 90, { barrelKills: 500, bowled: 50 }));
    expect(kegs.breakdown).toMatchObject({ kegKills: TURRET_BONUS_CAP, bowled: 0 });
    const both = turretResult(plan, final('won', 90, { barrelKills: 10, bowled: 5000 }));
    expect(both.breakdown).toMatchObject({ kegKills: 50, bowled: TURRET_BONUS_CAP - 50 });
    const b = both.breakdown;
    expect(both.points).toBe(b.kills + b.integrity + b.kegKills + b.bowled);
  });

  describe('never lets the bonus outrank a cleaner defense', () => {
    const most = { barrelKills: 10_000, bowled: 10_000 };

    it('a tower point more outranks every bonus, the kills equal', () => {
      for (const integrity of [1, 59, 60, 89, 99]) {
        const cleaner = turretResult(plan, final('won', integrity + 1, { kills: 70 }));
        const funnier = turretResult(plan, final('won', integrity, { kills: 70, ...most }));
        expect(cleaner.points).toBeGreaterThan(funnier.points);
      }
    });

    it('an untouched tower with every monster killed outranks any run a monster struck', () => {
      const s = TURRET_SCENARIO_STANDARD;
      const monsters = resolveTurretPlan(s).waves.reduce((n, w) => n + w.spawns.length, 0);
      const clean = turretResult(plan, final('won', s.integrity, { kills: monsters }));
      // The mildest strike: one point off the tower, one kill short, the whole bonus.
      const struck = turretResult(
        plan,
        final('won', s.integrity - 1, { kills: monsters - 1, ...most }),
      );
      expect(clean.medal).toBe(struck.medal);
      expect(clean.points).toBeGreaterThan(struck.points);
    });

    it('breaks a tie between equal defenses by the fun parts', () => {
      const plain = turretResult(plan, final('won', 100, { kills: 71 }));
      const kegs = turretResult(plan, final('won', 100, { kills: 71, barrelKills: 3, bowled: 9 }));
      expect(kegs.points - plain.points).toBe(3 * TURRET_POINTS.kegKill + 9);
    });
  });
});

describe('the result at the end of a run', () => {
  function seat(plan: TurretPlan): TurretSession {
    return {
      kind: 'turret',
      origin: { x: 0, y: 0, z: 0 },
      defense: createTurretDefense(plan, { x: 0, z: 0 }, 9, START),
      priorMountKey: '',
      returnTo: { x: 0, y: 0, z: 0, facing: 0 },
      feedback: [],
      nextFeedbackSeq: 1,
    };
  }

  /** Six unshot wolves on a 5 point tower: three strikes of 2 take it down. */
  const doomed: TurretScenarioDef = {
    ...TURRET_SCENARIO_INTRODUCTION,
    id: 'test_doomed',
    integrity: 5,
    medals: { gold: { minIntegrityShare: 0.8 }, silver: { minIntegrityShare: 0.4 } },
    waves: [
      {
        entries: [{ templateId: 'forest_wolf', count: 6, level: 2 }],
        coreDamage: 60,
        gapMinTicks: 16,
        gapMaxTicks: 32,
        barrels: { count: 0, minRadius: 0, maxRadius: 0 },
      },
    ],
  };

  it('sets the result once, deep-frozen, on the state, the end entry and the shared view', () => {
    const session = seat(resolveTurretPlan(doomed));
    const state = session.defense;
    expect(state.result).toBeNull();
    const events: TurretEvent[] = [];
    for (let t = START + 1; t < START + 20 * 120 && state.phase !== 'lost'; t++) {
      events.push(...tickTurretDefense(state, t, flat));
    }
    expect(state.phase).toBe('lost');
    const result = state.result!;
    expect(result).toEqual(turretResult(state.plan, state));
    expect(result).toMatchObject({ won: false, medal: null });
    expect(Object.isFrozen(result.breakdown)).toBe(true);
    const ended = events.filter((e) => e.type === 'ended');
    expect(ended).toEqual([
      {
        type: 'ended',
        result: 'lost',
        stats: state.stats,
        medal: null,
        points: result.points,
        breakdown: result.breakdown,
      },
    ]);
    expect(turretSessionView(session).defense.result).toBe(result);
    for (let t = state.tick + 1; t < state.tick + 40; t++) tickTurretDefense(state, t, flat);
    expect(state.result).toBe(result);
  });

  it('medals a won run from the tower it kept', () => {
    const plan = resolveTurretPlan(TURRET_SCENARIO_HARD);
    const state = createTurretDefense(plan, { x: 0, z: 0 }, 5, START);
    // Every wave cleared with nobody spawned: the plan's last wave ends the run.
    state.phase = 'wave';
    state.wave = plan.waves.length - 1;
    state.spawnCursor = plan.waves[state.wave].spawns.length;
    state.integrity = 84;
    const events = tickTurretDefense(state, START + TURRET_TIMING.introTicks, flat);
    expect(state.phase).toBe('won');
    expect(state.result).toMatchObject({ won: true, medal: 'silver' });
    expect(events.at(-1)).toMatchObject({ type: 'ended', result: 'won', medal: 'silver' });
  });
});
