// The Smith's Heart bosses' health per tier (encounters/smith_heart/
// tier_health.ts): each encounter's difficulty row carries a healthMult the
// pull applies to the body's pool and the wipe gives back. Normal keeps the
// template's pool; Heroic's pools are the bot raid's calibration
// (E:/woc/entregas/raid_corazon/heroico/NOTAS.md: the 2026-11-05 heroic pass).

import { describe, expect, it } from 'vitest';
import { SMITH_HEART_MOBS } from '../src/sim/content/smith_heart';
import {
  BREATH_DIFFICULTY,
  COUNCIL_DIFFICULTY,
  FINAL_DIFFICULTY,
  HEAT_DIFFICULTY,
  QUENCH_DIFFICULTY,
} from '../src/sim/encounters/smith_heart';
import { FINAL_PHASE_DIFFICULTY } from '../src/sim/encounters/smith_heart/final_phase_ids';
import { applyTierHealth, restoreTierHealth } from '../src/sim/encounters/smith_heart/tier_health';
import type { Entity } from '../src/sim/types';
import { quenchFight } from './helpers/quench_fight';

const body = (hp: number, maxHp: number, dead = false) => ({ hp, maxHp, dead }) as Entity;

describe("Smith's Heart: a boss's pool per tier", () => {
  it('scales the pool and keeps the share already taken; the reset gives it back', () => {
    const e = body(9000, 10000);
    const base = applyTierHealth(e, 2.5);
    expect(base).toBe(10000);
    expect(e.maxHp).toBe(25000);
    expect(e.hp).toBe(22500);
    restoreTierHealth(e, base);
    expect(e.maxHp).toBe(10000);
    expect(e.hp).toBe(10000);
  });

  it('a multiplier of one and a dead body change nothing', () => {
    const e = body(8000, 10000);
    expect(applyTierHealth(e, 1)).toBe(10000);
    expect([e.hp, e.maxHp]).toEqual([8000, 10000]);
    const dead = body(0, 10000, true);
    applyTierHealth(dead, 3);
    expect([dead.hp, dead.maxHp]).toEqual([0, 10000]);
    restoreTierHealth(dead, 5000);
    expect([dead.hp, dead.maxHp]).toEqual([0, 5000]);
  });

  it('Normal keeps every template pool; Mythic never has less than Heroic', () => {
    for (const rows of [
      COUNCIL_DIFFICULTY,
      BREATH_DIFFICULTY,
      QUENCH_DIFFICULTY,
      HEAT_DIFFICULTY,
      FINAL_DIFFICULTY,
    ]) {
      expect(rows.normal.healthMult).toBe(1);
      expect(rows.heroic.healthMult).toBeGreaterThan(1);
      expect(rows.mythic.healthMult).toBeGreaterThanOrEqual(rows.heroic.healthMult);
    }
  });

  it('the pass of 2026-11-17 (a 1,400 DPS raid): every pool per tier', () => {
    const hp = (id: string) => SMITH_HEART_MOBS[id].hpBase;
    // Normal: the template bases (smith_heart_pools_1117.test.ts checks the clock).
    expect({
      heart_hammer_guardian: hp('heart_hammer_guardian'),
      heart_seam_singer: hp('heart_seam_singer'),
      heart_breath_guardian: hp('heart_breath_guardian'),
      heart_quench_guardian: hp('heart_quench_guardian'),
      heart_heat_guardian: hp('heart_heat_guardian'),
      heart_masterless_strength: hp('heart_masterless_strength'),
    }).toEqual({
      heart_hammer_guardian: 83800,
      heart_seam_singer: 71400,
      heart_breath_guardian: 140000,
      heart_quench_guardian: 155200,
      heart_heat_guardian: 124350,
      heart_masterless_strength: 138250,
    });
    const rows = {
      council: COUNCIL_DIFFICULTY,
      breath: BREATH_DIFFICULTY,
      quench: QUENCH_DIFFICULTY,
      heat: HEAT_DIFFICULTY,
      final: FINAL_DIFFICULTY,
    };
    expect(
      Object.entries(rows).map(([k, r]) => [k, r.heroic.healthMult, r.mythic.healthMult]),
    ).toEqual([
      ['council', 1.18, 1.65],
      ['breath', 1.09, 1.61],
      ['quench', 1.18, 1.65],
      ['heat', 1.22, 1.81],
      ['final', 1.14, 1.35],
    ]);
    // The adds whose health is the tier's: the Splinters and the isles' adds.
    expect(FINAL_PHASE_DIFFICULTY.normal.addHealth).toBe(6000);
    expect(FINAL_PHASE_DIFFICULTY.heroic.addHealth).toBe(7150);
    expect(FINAL_PHASE_DIFFICULTY.mythic.addHealth).toBeGreaterThanOrEqual(7150);
    expect(BREATH_DIFFICULTY.normal.addHealthMult).toBe(1.2);
    expect(BREATH_DIFFICULTY.heroic.addHealthMult).toBe(1.625);
    expect(BREATH_DIFFICULTY.mythic.addHealthMult).toBe(1.625);
  });

  it('a Heroic pull of the Quench takes the tier pool; the wipe gives the template pool back', () => {
    const f = quenchFight(3);
    const base = f.boss().maxHp;
    expect(f.dev('/dev heart quench heroic')).toBe(true);
    expect(f.dev('/dev heart quench pull')).toBe(true);
    f.tick(2);
    expect(f.state()?.difficulty).toBe('heroic');
    expect(f.boss().maxHp).toBe(Math.round(base * QUENCH_DIFFICULTY.heroic.healthMult));
    for (const p of f.players) f.sim.ctx.handleDeath(p, f.boss());
    f.tick(60, false);
    expect(f.state()).toBeNull();
    // At rest again it shows its tier's real pool, whole (showTierHealth).
    expect(f.boss().maxHp).toBe(Math.round(base * QUENCH_DIFFICULTY.heroic.healthMult));
    expect(f.boss().hp).toBe(f.boss().maxHp);
  });

  it('the dev pool scale (the bot raid human-equivalent check) multiplies the tier pool, and 1 clears it', () => {
    const f = quenchFight(3);
    const base = f.boss().maxHp;
    expect(f.dev('/dev heart pool 0.65')).toBe(true);
    expect(f.dev('/dev heart quench heroic')).toBe(true);
    expect(f.dev('/dev heart quench pull')).toBe(true);
    f.tick(2);
    expect(f.boss().maxHp).toBe(Math.round(base * QUENCH_DIFFICULTY.heroic.healthMult * 0.65));
    for (const p of f.players) f.sim.ctx.handleDeath(p, f.boss());
    f.tick(60, false);
    expect(f.boss().maxHp).toBe(Math.round(base * QUENCH_DIFFICULTY.heroic.healthMult * 0.65));
    expect(f.dev('/dev heart pool 1')).toBe(true);
  });

  it('a Normal pull keeps the template pool', () => {
    const f = quenchFight(3);
    const base = f.boss().maxHp;
    expect(f.dev('/dev heart quench pull')).toBe(true);
    f.tick(2);
    expect(f.state()?.difficulty).toBe('normal');
    expect(f.boss().maxHp).toBe(base);
  });
});
