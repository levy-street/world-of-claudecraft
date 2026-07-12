import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/content/classes';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { ENRAGE_DMG_DONE, ENRAGE_HASTE_PCT, ENRAGE_MOVE_MULT } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

// Fury Enrage (owner 2026-07-08): a short self-buff procced by Bloodletting (30%)
// and Desenfreno / Rampage (always). +11% damage, +25% HASTE folded into the real
// haste stat (faster swings AND casts, visible in the Haste stat, never touching
// the GCD), and +10% move speed. The 'enrage' aura carries the damage + move
// halves directly; the haste half rides meleeHaste/spellHaste via recalcPlayerStats.

const makeFury = (seed = 42): Sim => {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.setSpec('fury')).toBe(true);
  sim.tick();
  return sim;
};

const nearestMob = (sim: Sim): Entity => {
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead) continue;
    const d = (e.pos.x - sim.player.pos.x) ** 2 + (e.pos.z - sim.player.pos.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  if (!best) throw new Error('no mob');
  return best;
};

const approach = (sim: Sim, mob: Entity): void => {
  const p = sim.player;
  p.pos.x = mob.pos.x;
  p.pos.z = mob.pos.z - 1.5;
  p.pos.y = terrainHeight(p.pos.x, p.pos.z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
};

// Put a Fury warrior in melee, give rage, and cast Desenfreno (always enrages).
// One tick after resolves the cast and runs the recalc that folds the haste half.
const enrageViaRedHarvest = (sim: Sim, mob: Entity): void => {
  approach(sim, mob);
  sim.player.resource = 80;
  sim.player.gcdRemaining = 0;
  sim.targetEntity(mob.id);
  sim.castAbility('red_harvest');
  sim.tick();
};

const dealPhysical = (sim: Sim, mob: Entity, amount: number): void => {
  (sim as unknown as { dealDamage: (...a: unknown[]) => void }).dealDamage(
    sim.player,
    mob,
    amount,
    false,
    'physical',
    null,
    'hit',
  );
};

const moveMult = (sim: Sim): number =>
  (sim as unknown as { moveSpeedMult(e: Entity): number }).moveSpeedMult(sim.player);

describe('Fury Enrage: proc sources', () => {
  it('Desenfreno (red_harvest) always Enrages for 4 sec', () => {
    expect(ABILITIES.red_harvest.effects).toContainEqual({
      type: 'enrageChance',
      chance: 1,
      duration: 4,
    });
  });

  it('Bloodletting (bloodthirst) has a 30% Enrage chance for 4 sec', () => {
    expect(ABILITIES.bloodthirst.effects).toContainEqual({
      type: 'enrageChance',
      chance: 0.3,
      duration: 4,
    });
  });

  it('casting Desenfreno applies the enrage buff (guaranteed proc)', () => {
    const sim = makeFury();
    const mob = nearestMob(sim);
    mob.maxHp = 100_000;
    mob.hp = mob.maxHp;
    enrageViaRedHarvest(sim, mob);
    const a = sim.player.auras.find((x) => x.id === 'fury_enrage');
    expect(a?.kind).toBe('enrage');
    expect(a?.value).toBe(ENRAGE_DMG_DONE);
    expect(a?.duration).toBe(4);
  });
});

describe('Fury Enrage: the buff carries all three halves', () => {
  it('grants +25% real haste (melee AND spell), +10% move speed and +11% damage', () => {
    const sim = makeFury();
    const p = sim.player;
    const mob = nearestMob(sim);
    mob.maxHp = 1_000_000;

    const baseHaste = p.spellHaste;
    const baseMove = moveMult(sim);

    // Damage baseline (no enrage). Same armor DR applies to both deals, so the
    // ratio isolates the +11% amp.
    mob.hp = mob.maxHp;
    dealPhysical(sim, mob, 1000);
    const dropNoEnrage = mob.maxHp - mob.hp;

    enrageViaRedHarvest(sim, mob);

    // Haste: +25% folded into the REAL haste stat (both channels), so it speeds
    // swings and casts and shows in the Haste stat (never the GCD).
    expect(p.spellHaste).toBeCloseTo(baseHaste + ENRAGE_HASTE_PCT, 5);
    expect(p.meleeHaste).toBeCloseTo(baseHaste + ENRAGE_HASTE_PCT, 5);
    // Move speed: +10% (non-stacking max).
    expect(moveMult(sim)).toBeCloseTo(baseMove * ENRAGE_MOVE_MULT, 5);
    // Outgoing damage: +11%.
    mob.hp = mob.maxHp;
    dealPhysical(sim, mob, 1000);
    const dropEnrage = mob.maxHp - mob.hp;
    expect(dropEnrage / dropNoEnrage).toBeCloseTo(1 + ENRAGE_DMG_DONE, 2);
  });

  it('the haste falls off when the enrage expires', () => {
    const sim = makeFury();
    const p = sim.player;
    const mob = nearestMob(sim);
    mob.maxHp = 100_000;
    mob.hp = mob.maxHp;
    const baseHaste = p.spellHaste;
    enrageViaRedHarvest(sim, mob);
    expect(p.spellHaste).toBeCloseTo(baseHaste + ENRAGE_HASTE_PCT, 5);
    // Run past the 4 sec buff; the haste must return to baseline (recalc on fade).
    for (let i = 0; i < 20 * 5; i++) sim.tick();
    expect(sim.player.auras.some((x) => x.id === 'fury_enrage')).toBe(false);
    expect(p.spellHaste).toBeCloseTo(baseHaste, 5);
  });
});
