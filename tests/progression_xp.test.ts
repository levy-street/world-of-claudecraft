// Direct unit tests for src/sim/progression/xp.ts (G1b). These drive the EXPORTED
// module functions against a real Sim (and its SimContext for prestige) so the
// moved XP-shaping logic is exercised on its own, independent of the parity golden:
// the inn-footprint resting predicate, rested-XP accrual + the 1.5-level cap clamp,
// and the cap-gated cosmetic prestige (accept + below-threshold reject). Proves the
// extracted module is callable and the move preserved behavior.

import { describe, expect, it } from 'vitest';
import { PROPS } from '../src/sim/data';
import { isResting, prestige, updateRested } from '../src/sim/progression/xp';
import { Sim } from '../src/sim/sim';
import { DT, MAX_LEVEL, PRESTIGE_XP_PER_RANK, xpForLevel } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

type AnySim = Sim & Record<string, any>;

function makeSim(): AnySim {
  return new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true }) as AnySim;
}

function teleport(sim: AnySim, e: any, x: number, z: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = terrainHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

const inn = PROPS.buildings.find((b) => b.kind === 'inn')!;

describe('progression/xp — isResting (inn footprint)', () => {
  it('is true inside an inn footprint while out of combat', () => {
    const sim = makeSim();
    teleport(sim, sim.player, inn.x, inn.z);
    sim.player.inCombat = false;
    expect(isResting(sim.player)).toBe(true);
  });

  it('is false while in combat, even inside the inn', () => {
    const sim = makeSim();
    teleport(sim, sim.player, inn.x, inn.z);
    sim.player.inCombat = true;
    expect(isResting(sim.player)).toBe(false);
  });

  it('is false when standing away from any inn', () => {
    const sim = makeSim();
    teleport(sim, sim.player, -300, 0); // verified clear of inns
    sim.player.inCombat = false;
    expect(isResting(sim.player)).toBe(false);
  });
});

describe('progression/xp — updateRested (accrual + cap)', () => {
  it('accrues a positive pool, paced off DT, while resting', () => {
    const sim = makeSim();
    const meta = sim.meta(sim.playerId)!;
    teleport(sim, sim.player, inn.x, inn.z);
    sim.player.inCombat = false;
    meta.restedXp = 0;
    updateRested(sim.player, meta);
    const perSecond = (0.05 * xpForLevel(sim.player.level)) / (8 * 60);
    expect(meta.restedXp).toBeCloseTo(perSecond * DT, 6);
  });

  it('clamps the pool to 1.5 levels of XP', () => {
    const sim = makeSim();
    const meta = sim.meta(sim.playerId)!;
    teleport(sim, sim.player, inn.x, inn.z);
    sim.player.inCombat = false;
    meta.restedXp = 999_999_999;
    updateRested(sim.player, meta);
    expect(meta.restedXp).toBe(1.5 * xpForLevel(sim.player.level));
  });

  it('does not accrue while standing away from any inn', () => {
    const sim = makeSim();
    const meta = sim.meta(sim.playerId)!;
    teleport(sim, sim.player, -300, 0);
    sim.player.inCombat = false;
    meta.restedXp = 0;
    updateRested(sim.player, meta);
    expect(meta.restedXp).toBe(0);
  });

  it('does not accrue at the level cap (no XP bar to rest toward)', () => {
    const sim = makeSim();
    const meta = sim.meta(sim.playerId)!;
    sim.setPlayerLevel(MAX_LEVEL);
    teleport(sim, sim.player, inn.x, inn.z);
    sim.player.inCombat = false;
    meta.restedXp = 0;
    updateRested(sim.player, meta);
    expect(meta.restedXp).toBe(0);
  });
});

describe('progression/xp — prestige (cap-gated, cosmetic)', () => {
  it('accepts at the cap with a full post-cap bar: resets the bar, bumps rank, leaves lifetime/level', () => {
    const sim = makeSim();
    sim.setPlayerLevel(MAX_LEVEL);
    sim.grantXp(PRESTIGE_XP_PER_RANK); // exactly one prestige bar of post-cap XP
    const meta = sim.meta(sim.playerId)!;
    meta.xp = 123; // stray bar XP to prove the reset clears it
    const lifeBefore = sim.lifetimeXp;
    sim.events.length = 0;

    const ok = prestige(sim.ctx, sim.playerId);

    expect(ok).toBe(true);
    expect(sim.xp).toBe(0); // bar reset
    expect(sim.prestigeRank).toBe(1); // rank incremented
    expect(sim.lifetimeXp).toBe(lifeBefore); // lifetime untouched
    expect(sim.player.level).toBe(MAX_LEVEL); // no de-level / power loss
    // the gold prestige log emit fired through ctx.emit.
    expect(
      sim.events.some(
        (e: any) =>
          e.type === 'log' &&
          typeof e.text === 'string' &&
          e.text === 'You have prestiged! Prestige Rank 1.',
      ),
    ).toBe(true);
  });

  it('refuses a second prestige below the threshold and mutates nothing', () => {
    const sim = makeSim();
    sim.setPlayerLevel(MAX_LEVEL);
    sim.grantXp(PRESTIGE_XP_PER_RANK); // one bar -> first prestige succeeds
    expect(prestige(sim.ctx, sim.playerId)).toBe(true);
    const meta = sim.meta(sim.playerId)!;
    const lifeBefore = sim.lifetimeXp;
    sim.events.length = 0;

    const again = prestige(sim.ctx, sim.playerId); // no XP left for rank 2

    expect(again).toBe(false);
    expect(sim.prestigeRank).toBe(1); // unchanged
    expect(meta.lifetimeXp).toBe(lifeBefore); // unchanged
    expect(sim.events.some((e: any) => e.type === 'log')).toBe(false); // no emit on reject
  });

  it('refuses prestige below the level cap regardless of XP', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    expect(prestige(sim.ctx, sim.playerId)).toBe(false);
    expect(sim.prestigeRank).toBe(0);
  });
});
