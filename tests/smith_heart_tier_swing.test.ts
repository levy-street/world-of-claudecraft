// The Smith's Heart's parse-calibrated pass of 2026-11-16: each boss's own
// swing per tier (encounters/smith_heart/tier_swing.ts, the rows' swingMult,
// applied at the pull and given back at a wipe), the raid's damage per tier
// (damageMult) and the lethal punishments held where they were (punishMult,
// the Quench's shatterMult).

import { describe, expect, it } from 'vitest';
import {
  BREATH_DIFFICULTY,
  COUNCIL_DIFFICULTY,
  COUNCIL_TUNING,
  FINAL_DIFFICULTY,
  HEAT_DIFFICULTY,
  QUENCH_DIFFICULTY,
} from '../src/sim/encounters/smith_heart';
import { applyTierSwing, restoreTierSwing } from '../src/sim/encounters/smith_heart/tier_swing';
import type { Entity } from '../src/sim/types';
import { quenchFight } from './helpers/quench_fight';

const body = (min: number, max: number, dead = false) =>
  ({ weapon: { min, max, speed: 2.6 }, dead }) as Entity;

describe("Smith's Heart: a boss's swing per tier", () => {
  it('scales the weapon and gives it back; one and a dead body change nothing', () => {
    const e = body(200, 300);
    const base = applyTierSwing(e, 1.15);
    expect(base).toEqual({ min: 200, max: 300 });
    expect([e.weapon.min, e.weapon.max]).toEqual([230, 345]);
    restoreTierSwing(e, base);
    expect([e.weapon.min, e.weapon.max]).toEqual([200, 300]);
    expect(applyTierSwing(e, 1)).toBeUndefined();
    const dead = body(200, 300, true);
    expect(applyTierSwing(dead, 2)).toBeUndefined();
    expect([dead.weapon.min, dead.weapon.max]).toEqual([200, 300]);
    restoreTierSwing(e, undefined);
    expect([e.weapon.min, e.weapon.max]).toEqual([200, 300]);
  });

  it('a Normal pull of the Quench swings twice as hard; the wipe gives the swing back', () => {
    const f = quenchFight(3);
    const { min, max } = f.boss().weapon;
    expect(f.dev('/dev heart quench pull')).toBe(true);
    f.tick(2);
    expect(f.state()?.difficulty).toBe('normal');
    const k = QUENCH_DIFFICULTY.normal.swingMult;
    expect(k).toBe(2);
    expect(f.boss().weapon.min).toBe(Math.round(min * k));
    expect(f.boss().weapon.max).toBe(Math.round(max * k));
    for (const p of f.players) f.sim.ctx.handleDeath(p, f.boss());
    f.tick(60, false);
    expect(f.state()).toBeNull();
    expect([f.boss().weapon.min, f.boss().weapon.max]).toEqual([min, max]);
  });

  it('a Heroic pull of the Quench takes Heroic swing', () => {
    const f = quenchFight(3);
    const { min } = f.boss().weapon;
    expect(f.dev('/dev heart quench heroic')).toBe(true);
    expect(f.dev('/dev heart quench pull')).toBe(true);
    f.tick(2);
    expect(f.state()?.difficulty).toBe('heroic');
    expect(f.boss().weapon.min).toBe(Math.round(min * QUENCH_DIFFICULTY.heroic.swingMult));
  });
});

describe("Smith's Heart: the pass of 2026-11-16's damage per tier", () => {
  it('Normal: the raid +15 percent on every fight, the Quench twice', () => {
    for (const rows of [COUNCIL_DIFFICULTY, BREATH_DIFFICULTY, HEAT_DIFFICULTY, FINAL_DIFFICULTY]) {
      expect(rows.normal.damageMult).toBe(1.15);
      expect(rows.normal.swingMult).toBe(1.15);
      expect(rows.normal.punishMult).toBe(1);
    }
    expect(QUENCH_DIFFICULTY.normal.damageMult).toBe(2);
    // The shatter only +15 percent on Normal.
    const shatter = QUENCH_DIFFICULTY.normal.damageMult * QUENCH_DIFFICULTY.normal.shatterMult;
    expect(shatter).toBeCloseTo(1.15, 6);
  });

  it('Heroic: the Council and the final boss unchanged, the Breath and the Quench +25, the Heat +15', () => {
    expect(COUNCIL_DIFFICULTY.heroic.damageMult).toBe(1.25);
    expect(COUNCIL_DIFFICULTY.heroic.swingMult).toBe(1);
    expect(FINAL_DIFFICULTY.heroic.damageMult).toBe(1.1);
    expect(FINAL_DIFFICULTY.heroic.swingMult).toBe(1);
    expect(BREATH_DIFFICULTY.heroic.damageMult).toBeCloseTo(1.25 * 1.25, 6);
    expect(BREATH_DIFFICULTY.heroic.swingMult).toBe(1.25);
    expect(QUENCH_DIFFICULTY.heroic.damageMult).toBeCloseTo(1.25 * 1.25, 6);
    expect(QUENCH_DIFFICULTY.heroic.swingMult).toBe(1.25);
    expect(HEAT_DIFFICULTY.heroic.damageMult).toBeCloseTo(1.25 * 1.15, 6);
    expect(HEAT_DIFFICULTY.heroic.swingMult).toBe(1.15);
    // Shattering Cold on Heroic keeps its total (2.5 times the tuning).
    const shatter = QUENCH_DIFFICULTY.heroic.damageMult * QUENCH_DIFFICULTY.heroic.shatterMult;
    expect(shatter).toBeCloseTo(2.5, 6);
  });

  it('the lethal punishments keep the tier factor they had before the pass', () => {
    const before = {
      council: { normal: 1, heroic: 1.25, mythic: 1.25 },
      breath: { normal: 1, heroic: 1.25, mythic: 1.25 },
      heat: { normal: 1, heroic: 1.25, mythic: 1.25 },
      final: { normal: 1, heroic: 1.1, mythic: 1.3 },
    };
    const rows = {
      council: COUNCIL_DIFFICULTY,
      breath: BREATH_DIFFICULTY,
      heat: HEAT_DIFFICULTY,
      final: FINAL_DIFFICULTY,
    };
    for (const key of Object.keys(before) as (keyof typeof before)[])
      for (const tier of ['normal', 'heroic', 'mythic'] as const)
        expect(rows[key][tier].punishMult, `${key} ${tier}`).toBe(before[key][tier]);
    // Normal's Mountain's Wrath: still 440 to 520 on whoever no pillar hides.
    const n = COUNCIL_DIFFICULTY.normal;
    expect(COUNCIL_TUNING.wrathMin * n.punishMult * n.wrathMult).toBe(440);
    expect(COUNCIL_TUNING.wrathMax * n.punishMult * n.wrathMult).toBe(520);
  });
});
