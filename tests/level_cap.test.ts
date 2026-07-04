// The ACTIVE level cap (40 for the Valdris launch): the level bar freezes at
// ACTIVE_LEVEL_CAP while MAX_LEVEL (60) stays the content ceiling. XP past the
// active cap keeps flowing into lifetimeXp (virtual levels, milestones) exactly
// like the live veteran loop at the old cap of 20, rested XP stops accruing and
// stops being consumed, and prestige gates and prices at the active cap. When
// the cap raise ships, ACTIVE_LEVEL_CAP returns to MAX_LEVEL and every branch
// here degenerates to the pre-cap behavior.

import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import {
  ACTIVE_LEVEL_CAP,
  canPrestige,
  MAX_LEVEL,
  PRESTIGE_XP_PER_RANK,
  virtualLevel,
  xpForLevel,
  xpToReachLevel,
} from '../src/sim/types';

type AnySim = Sim & Record<string, any>;

function makeSim(): AnySim {
  return new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true }) as AnySim;
}

function levelTo(sim: AnySim, level: number): void {
  sim.setPlayerLevel(level);
}

describe('active level cap (40)', () => {
  it('is below the content ceiling and prices prestige at its own step', () => {
    expect(ACTIVE_LEVEL_CAP).toBe(40);
    expect(ACTIVE_LEVEL_CAP).toBeLessThanOrEqual(MAX_LEVEL);
    expect(PRESTIGE_XP_PER_RANK).toBe(xpForLevel(ACTIVE_LEVEL_CAP));
  });

  it('freezes the level bar at the cap: a ding into 40 zeroes the bar and stops leveling', () => {
    const sim = makeSim();
    levelTo(sim, ACTIVE_LEVEL_CAP - 1);
    const meta = sim.meta(sim.playerId)!;
    meta.xp = 0;
    sim.grantXp(xpForLevel(ACTIVE_LEVEL_CAP - 1) + 12_345); // dings into the cap with overflow
    expect(sim.player.level).toBe(ACTIVE_LEVEL_CAP);
    expect(meta.xp).toBe(0); // bar cleared, remainder lives in lifetimeXp
    sim.grantXp(999_999);
    expect(sim.player.level).toBe(ACTIVE_LEVEL_CAP); // never past the active cap
    expect(meta.xp).toBe(0);
  });

  it('keeps crediting lifetimeXp and virtual levels at the cap (veteran loop alive)', () => {
    const sim = makeSim();
    levelTo(sim, ACTIVE_LEVEL_CAP);
    const meta = sim.meta(sim.playerId)!;
    const before = meta.lifetimeXp;
    sim.grantXp(50_000);
    expect(meta.lifetimeXp).toBe(before + 50_000);
    // enough lifetime XP to sit past the cap boundary produces a virtual level > cap
    meta.lifetimeXp = xpToReachLevel(ACTIVE_LEVEL_CAP + 2) + 1;
    expect(virtualLevel(meta.lifetimeXp)).toBeGreaterThan(ACTIVE_LEVEL_CAP);
  });

  it('stops consuming and accruing rested XP at the cap', () => {
    const sim = makeSim();
    levelTo(sim, ACTIVE_LEVEL_CAP);
    const meta = sim.meta(sim.playerId)!;
    meta.restedXp = 5_000;
    const before = meta.lifetimeXp;
    sim.grantXp(1_000, undefined, { fromKill: true });
    expect(meta.restedXp).toBe(5_000); // untouched at the cap
    expect(meta.lifetimeXp).toBe(before + 1_000); // no rested doubling
  });

  it('gates and prices prestige at the active cap', () => {
    expect(canPrestige(ACTIVE_LEVEL_CAP - 1, Number.MAX_SAFE_INTEGER / 2, 0)).toBe(false);
    const lifetimeAtCap = xpToReachLevel(ACTIVE_LEVEL_CAP);
    expect(canPrestige(ACTIVE_LEVEL_CAP, lifetimeAtCap + PRESTIGE_XP_PER_RANK - 1, 0)).toBe(false);
    expect(canPrestige(ACTIVE_LEVEL_CAP, lifetimeAtCap + PRESTIGE_XP_PER_RANK, 0)).toBe(true);
    // a saved higher rank is preserved (only NEW ranks are capped)
    expect(canPrestige(ACTIVE_LEVEL_CAP, lifetimeAtCap + PRESTIGE_XP_PER_RANK, 5)).toBe(false);
  });

  it('quest-style XP granted at the cap goes to lifetime only', () => {
    const sim = makeSim();
    levelTo(sim, ACTIVE_LEVEL_CAP);
    const meta = sim.meta(sim.playerId)!;
    const before = meta.lifetimeXp;
    sim.grantXp(7_777); // quest turn-in path: no fromKill
    expect(sim.player.level).toBe(ACTIVE_LEVEL_CAP);
    expect(meta.xp).toBe(0);
    expect(meta.lifetimeXp).toBe(before + 7_777);
  });
});
