// The Smith's Heart bosses' health per tier (encounters/smith_heart/
// tier_health.ts): each encounter's difficulty row carries a healthMult the
// pull applies to the body's pool and the wipe gives back. Normal keeps the
// template's pool; Heroic's pools are the bot raid's calibration
// (E:/woc/entregas/raid_corazon/heroico/NOTAS.md: the 2026-11-05 heroic pass).

import { describe, expect, it } from 'vitest';
import {
  BREATH_DIFFICULTY,
  COUNCIL_DIFFICULTY,
  FINAL_DIFFICULTY,
  HEAT_DIFFICULTY,
  QUENCH_DIFFICULTY,
} from '../src/sim/encounters/smith_heart';
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

  it('Normal keeps every template pool; Mythic is left as it was', () => {
    for (const rows of [
      COUNCIL_DIFFICULTY,
      BREATH_DIFFICULTY,
      QUENCH_DIFFICULTY,
      HEAT_DIFFICULTY,
      FINAL_DIFFICULTY,
    ]) {
      expect(rows.normal.healthMult).toBe(1);
      expect(rows.mythic.healthMult).toBe(1);
      expect(rows.heroic.healthMult).toBeGreaterThan(1);
    }
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

  it('a Normal pull keeps the template pool', () => {
    const f = quenchFight(3);
    const base = f.boss().maxHp;
    expect(f.dev('/dev heart quench pull')).toBe(true);
    f.tick(2);
    expect(f.state()?.difficulty).toBe('normal');
    expect(f.boss().maxHp).toBe(base);
  });
});
