import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { dist2d } from '../src/sim/types';

// Regression for the "no passive health regen while not in combat" report
// (imdutha / ruanhx): a warlock standing idle with a summoned Infernal could not
// regenerate health. The owner stayed flagged `inCombat` because the pet held a
// target it was not actually fighting, while mana kept regenerating on its own
// 5-second rule. Out-of-combat health regen must resume once the pet stops
// actively trading blows; a pet that IS fighting still keeps its owner in combat.

function makeWarlock(seed = 7) {
  const sim = new Sim({ seed, playerClass: 'warlock' as any, autoEquip: true });
  const p: any = sim.player;
  p.level = 20;
  return { sim, p };
}

function summonInfernal(sim: Sim, p: any) {
  (sim as any).createDemonPet(p, 'infernal', false);
  for (const e of sim.entities.values()) if ((e as any).ownerId === p.id) return e as any;
  throw new Error('pet not created');
}

function firstWildMob(sim: Sim) {
  let best: any = null, bd = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead || (e as any).ownerId !== null) continue;
    const d = dist2d(sim.player.pos, e.pos);
    if (d < bd) { bd = d; best = e; }
  }
  if (!best) throw new Error('no wild mob');
  return best;
}

describe('pet-held combat does not block owner health regen', () => {
  it('an idle pet (not trading blows) lets the owner regen health', () => {
    const { sim, p } = makeWarlock();
    const pet = summonInfernal(sim, p);
    const mob = firstWildMob(sim);

    // Give the pet a live, in-leash target it is NOT actually fighting: the mob
    // sits ~30yd off (inside PET_LEASH 40 so the pet keeps it as a target) and we
    // re-pin the pet beside the owner each tick so it never reaches melee range.
    // The pet's combatTimer therefore climbs past the linger window.
    const place = () => {
      pet.pos = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
      mob.pos = { x: p.pos.x + 30, y: p.pos.y, z: p.pos.z };
      pet.aggroTargetId = mob.id;
    };

    p.hp = Math.floor(p.maxHp * 0.4);
    p.resource = Math.floor(p.maxResource * 0.4);
    p.inCombat = false;
    p.combatTimer = 99;
    const hpStart = p.hp;

    for (let i = 0; i < 200; i++) { place(); sim.tick(); }

    expect(pet.aggroTargetId).toBe(mob.id); // pet still "has" the target
    expect(p.hp).toBeGreaterThan(hpStart); // but the owner regenerates
  });

  it('a pet actively trading blows still keeps its owner in combat (no regen)', () => {
    const { sim, p } = makeWarlock();
    const pet = summonInfernal(sim, p);
    const mob = firstWildMob(sim);

    // Park a high-HP target in melee range of the pet so it keeps swinging:
    // the pet's combatTimer stays low, so the owner stays in combat.
    mob.hp = 1_000_000; mob.maxHp = 1_000_000;
    pet.petMode = 'aggressive';
    const place = () => {
      pet.pos = { x: p.pos.x + 1, y: p.pos.y, z: p.pos.z };
      mob.pos = { x: p.pos.x + 2, y: p.pos.y, z: p.pos.z };
    };

    p.hp = Math.floor(p.maxHp * 0.4);
    p.inCombat = false;
    p.combatTimer = 99;
    const hpStart = p.hp;

    for (let i = 0; i < 200; i++) { place(); sim.tick(); }

    expect(pet.combatTimer).toBeLessThan(5); // pet is genuinely fighting
    expect(p.hp).toBe(hpStart); // owner remains in combat, no health regen
  });
});
