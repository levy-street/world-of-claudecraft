// Classic instant-attack normalization for Wicked Slash (sinister_strike).
// Before this, an energy-gated instant used the weapon's RAW per-swing roll, so
// a slow high-per-hit weapon (Thronebane, 46-74 @ 2.8) inflated the button it
// is spammed at will. Normalization scales the weapon-damage portion to a fixed
// speed by weapon class (dagger 1.7, other one-hand 2.4), so the instant tracks
// weapon DPS, not raw per-hit. Guards the mechanism and the DPS-based invariant.

import { describe, expect, it } from 'vitest';
import {
  DAGGER_NORMALIZED_SPEED,
  normalizedInstantSpeed,
  ONE_HAND_NORMALIZED_SPEED,
} from '../src/sim/combat/form_swing';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { WeaponInfo } from '../src/sim/types';

describe('normalizedInstantSpeed', () => {
  it('normalizes daggers to 1.7 and every other one-hander to 2.4', () => {
    const dagger: WeaponInfo = { min: 20, max: 30, speed: 1.8, dagger: true };
    const sword: WeaponInfo = { min: 46, max: 74, speed: 2.8 };
    expect(normalizedInstantSpeed(dagger)).toBe(DAGGER_NORMALIZED_SPEED);
    expect(normalizedInstantSpeed(dagger)).toBe(1.7);
    expect(normalizedInstantSpeed(sword)).toBe(ONE_HAND_NORMALIZED_SPEED);
    expect(normalizedInstantSpeed(sword)).toBe(2.4);
  });
});

// Fire one Wicked Slash with the given weapon profile against an immortal,
// 0-armor dummy (crit zeroed) and return the landed hit amount. AP and armor DR
// are identical across weapons (weapon min/max/speed do not feed either), so any
// difference in the result is purely the normalization.
function wickedSlashHit(weapon: WeaponInfo): number {
  const sim = new Sim({ seed: 4242, playerClass: 'rogue', autoEquip: true }) as Sim &
    Record<string, any>;
  sim.setPlayerLevel(20);
  const p = sim.player;
  p.critChance = 0;
  const target = createMob(93001, MOBS.training_dummy, 20, {
    x: p.pos.x + 1,
    y: p.pos.y,
    z: p.pos.z,
  });
  sim.addEntity(target);
  const wsName = ABILITIES.sinister_strike.name;
  for (let i = 0; i < 60; i++) {
    // Re-assert the controlled state each tick: weapon profile, full energy, a
    // living immortal 0-armor target adjacent and in front, no combo pressure.
    p.weapon = { ...weapon };
    p.resource = p.maxResource;
    target.hp = target.maxHp = 1e9;
    target.dead = false;
    target.level = 1;
    target.stats.armor = 0;
    target.hostile = true;
    target.pos = { x: p.pos.x + 1, y: p.pos.y, z: p.pos.z };
    p.facing = Math.atan2(target.pos.x - p.pos.x, target.pos.z - p.pos.z);
    p.targetId = target.id;
    sim.targetEntity(target.id);
    sim.castAbility('sinister_strike');
    const evs = sim.tick();
    const hit = evs.find(
      (e: any) =>
        e.type === 'damage' && e.sourceId === p.id && e.kind === 'hit' && e.ability === wsName,
    );
    if (hit && hit.type === 'damage' && hit.amount > 0) return hit.amount;
  }
  throw new Error('no Wicked Slash hit landed');
}

describe('Wicked Slash normalization (behavior)', () => {
  it('two equal-DPS one-handers of different speed hit identically (DPS-based, not raw roll)', () => {
    // Both 20 weapon DPS: raw behavior would deal 56 vs 40 (the raw rolls);
    // normalized, both resolve at 20 DPS x 2.4 for the weapon portion.
    const slow = wickedSlashHit({ min: 56, max: 56, speed: 2.8 });
    const fast = wickedSlashHit({ min: 40, max: 40, speed: 2.0 });
    expect(slow).toBe(fast);
  });

  it('a slow one-hander no longer beats a fast one of the same DPS', () => {
    // The exploit signature: without normalization the 2.8 weapon (raw roll 56)
    // strictly out-hit the 2.0 weapon (raw roll 40). Prove that gap is gone.
    const slow = wickedSlashHit({ min: 56, max: 56, speed: 2.8 });
    const fast = wickedSlashHit({ min: 40, max: 40, speed: 2.0 });
    expect(slow).not.toBeGreaterThan(fast);
  });

  it('a dagger of equal DPS hits softer than a one-hander (normalizes to 1.7, not 2.4)', () => {
    const oneHand = wickedSlashHit({ min: 56, max: 56, speed: 2.8 }); // 20 DPS, -> 2.4
    const dagger = wickedSlashHit({ min: 34, max: 34, speed: 1.7, dagger: true }); // 20 DPS, -> 1.7
    expect(dagger).toBeLessThan(oneHand);
  });
});
