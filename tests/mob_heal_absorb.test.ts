// Necrotic mobs (e.g. the Gravecaller Summoner's "Grave Blight") can brand a
// victim on a melee hit with a heal-absorb shield: the next chunk of incoming
// healing is devoured before any of it lands. This is the sibling of Mortal
// Strike — where Mortal Strike scales every heal down for its whole duration,
// Grave Blight eats a FIXED pool of healing once, then fades.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { Entity } from '../src/sim/types';

function makeSim(playerClass: 'warrior' | 'mage' = 'warrior') {
  return new Sim({ seed: 7, playerClass, autoEquip: true });
}

// Spawn a Gravecaller Summoner adjacent to the player, engaged and ready to swing.
function spawnSummoner(sim: Sim, target: Entity): Entity {
  const template = MOBS['gravecaller_summoner'];
  const mob = createMob((sim as any).nextId++, template, 12, { x: target.pos.x, y: target.pos.y, z: target.pos.z });
  mob.hostile = true;
  (sim as any).addEntity(mob);
  return mob;
}

function swing(sim: Sim, mob: Entity, target: Entity) {
  // Force the swing to land regardless of world-gen RNG state. mobSwing's first
  // rng.next() is the miss/dodge roll; return a high value for just that call so
  // the hit always connects, then restore the real RNG for damage/crit rolls.
  const rng = (sim as any).rng;
  const realNext = rng.next.bind(rng);
  let firstRoll = true;
  rng.next = () => { if (firstRoll) { firstRoll = false; return 0.999; } return realNext(); };
  try {
    (sim as any).mobSwing(mob, target);
  } finally {
    rng.next = realNext;
  }
}

describe('mob heal-absorb ("Grave Blight")', () => {
  it('seeds the heal-absorb mechanic on the Gravecaller Summoner', () => {
    expect(MOBS['gravecaller_summoner'].healAbsorb).toEqual({
      chance: 0.25, amount: 120, duration: 10, name: 'Grave Blight', school: 'shadow',
    });
  });

  it('applies a heal_absorb aura on a landed hit when it rolls', () => {
    const sim = makeSim();
    const p = sim.player;
    p.maxHp = 100000; p.hp = 100000;
    const mob = spawnSummoner(sim, p);
    MOBS['gravecaller_summoner'].healAbsorb!.chance = 1; // deterministic for the test
    swing(sim, mob, p);
    MOBS['gravecaller_summoner'].healAbsorb!.chance = 0.25;
    const aura = p.auras.find((a) => a.kind === 'heal_absorb');
    expect(aura).toBeTruthy();
    expect(aura!.name).toBe('Grave Blight');
    expect(aura!.value).toBe(120);
    expect(aura!.remaining).toBe(10);
  });

  it('devours healing up to its budget, then leaves the rest, depleting the shield', () => {
    const sim = makeSim();
    const p = sim.player;
    p.auras.push({
      id: 'heal_absorb_test', name: 'Grave Blight', kind: 'heal_absorb',
      remaining: 10, duration: 10, value: 120, sourceId: 999, school: 'shadow',
    });
    // A 50-point heal is fully eaten; the shield drains to 70 and remains.
    expect((sim as any).consumeHealAbsorb(p, 50)).toBe(0);
    expect(p.auras.find((a) => a.kind === 'heal_absorb')!.value).toBe(70);
    // A 200-point heal eats the remaining 70 and 130 survives; the shield drops.
    expect((sim as any).consumeHealAbsorb(p, 200)).toBe(130);
    expect(p.auras.some((a) => a.kind === 'heal_absorb')).toBe(false);
  });

  it('blocks real healing while a shield is active, then heals normally after it lapses', () => {
    const sim = makeSim();
    const p = sim.player;
    p.maxHp = 1000; p.hp = 500;
    // A shield larger than any heal (crit included) absorbs the whole heal.
    p.auras.push({
      id: 'heal_absorb_test', name: 'Grave Blight', kind: 'heal_absorb',
      remaining: 10, duration: 10, value: 100000, sourceId: 999, school: 'shadow',
    });
    (sim as any).applyHeal(p, p, 200, 'Test Heal');
    expect(p.hp).toBe(500); // fully absorbed
    // Drop the shield and the same heal now lands (>= base, crit may add more).
    p.auras = p.auras.filter((a) => a.kind !== 'heal_absorb');
    (sim as any).applyHeal(p, p, 200, 'Test Heal');
    expect(p.hp).toBeGreaterThanOrEqual(700);
  });
});
