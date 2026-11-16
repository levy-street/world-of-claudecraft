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

  it('the parse-calibrated pass of 2026-11-16: every pool per tier', () => {
    const hp = (id: string) => SMITH_HEART_MOBS[id].hpBase;
    // Normal: the template bases, each +20 percent over the 2026-11-12 pass.
    const normal: Record<string, [number, number]> = {
      heart_hammer_guardian: [54000, 64800],
      heart_seam_singer: [46000, 55200],
      heart_breath_guardian: [80000, 96000],
      heart_quench_guardian: [112000, 134400],
      heart_heat_guardian: [77000, 92400],
      heart_masterless_strength: [72000, 86400],
    };
    for (const [id, [was, now]] of Object.entries(normal)) {
      expect(hp(id), id).toBe(now);
      expect(now / was, id).toBeCloseTo(1.2, 6);
    }
    // Heroic: +30 percent over the old Heroic pool (the base's +20 percent
    // times the multiplier's 1.30/1.20), within a hundredth.
    const heroic: [string, readonly string[], number, number][] = [
      [
        'council',
        ['heart_hammer_guardian', 'heart_seam_singer'],
        1.85,
        COUNCIL_DIFFICULTY.heroic.healthMult,
      ],
      ['breath', ['heart_breath_guardian'], 1.65, BREATH_DIFFICULTY.heroic.healthMult],
      ['quench', ['heart_quench_guardian'], 2.0, QUENCH_DIFFICULTY.heroic.healthMult],
      ['heat', ['heart_heat_guardian'], 1.2, HEAT_DIFFICULTY.heroic.healthMult],
      ['final', ['heart_masterless_strength'], 2.1, FINAL_DIFFICULTY.heroic.healthMult],
    ];
    expect(heroic.map(([k, , , m]) => [k, m])).toEqual([
      ['council', 2.0],
      ['breath', 1.79],
      ['quench', 2.17],
      ['heat', 1.3],
      ['final', 2.28],
    ]);
    for (const [key, ids, oldMult, mult] of heroic) {
      const was = ids.reduce((sum, id) => sum + normal[id][0], 0) * oldMult;
      const now = ids.reduce((sum, id) => sum + normal[id][1], 0) * mult;
      expect(Math.abs(now / was - 1.3), key).toBeLessThan(0.01);
    }
    // Mythic: Heroic's pool on every boss.
    for (const rows of [
      COUNCIL_DIFFICULTY,
      BREATH_DIFFICULTY,
      QUENCH_DIFFICULTY,
      HEAT_DIFFICULTY,
      FINAL_DIFFICULTY,
    ])
      expect(rows.mythic.healthMult).toBe(rows.heroic.healthMult);
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
    expect(f.boss().maxHp).toBe(base);
    expect(f.boss().hp).toBe(base);
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
    expect(f.boss().maxHp).toBe(base);
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
