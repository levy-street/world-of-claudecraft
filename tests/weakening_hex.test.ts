// Witch-doctor mobs (e.g. the Gravecaller Cultist's "Weakening Hex") can curse a
// victim on a melee hit, scaling BOTH the damage and the healing *they* deal by
// (1 - reductionPct) for a while. The hex is distinct from `demoralize` (a flat
// attack-power cut, physical only) and `mortal_wound` (healing *received*): it
// throttles the hexed player's whole offensive/support output.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { Entity } from '../src/sim/types';

function makeSim(playerClass: 'warrior' | 'priest' = 'priest') {
  return new Sim({ seed: 7, playerClass, autoEquip: true });
}

// Spawn a Gravecaller Cultist adjacent to the player, hostile and ready to swing.
function spawnCultist(sim: Sim, target: Entity): Entity {
  const template = MOBS['gravecaller_cultist'];
  const mob = createMob((sim as any).nextId++, template, 12, { x: target.pos.x, y: target.pos.y, z: target.pos.z });
  mob.hostile = true;
  (sim as any).addEntity(mob);
  return mob;
}

// Force a single landed swing (hex chance is rolled per landed hit).
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

const HEX_AURA = {
  id: 'hex_gravecaller_cultist', name: 'Weakening Hex', kind: 'hex' as const,
  remaining: 10, duration: 10, value: 0.2, sourceId: 999, school: 'shadow' as const,
};

describe('mob hex ("Weakening Hex")', () => {
  it('seeds the hex mechanic on the Gravecaller Cultist', () => {
    expect(MOBS['gravecaller_cultist'].hex).toEqual({
      chance: 0.3, reductionPct: 0.2, duration: 10, name: 'Weakening Hex', school: 'shadow',
    });
  });

  it('applies a hex aura on a landed hit when it rolls', () => {
    const sim = makeSim();
    const p = sim.player;
    p.maxHp = 100000; p.hp = 100000;
    const mob = spawnCultist(sim, p);
    MOBS['gravecaller_cultist'].hex!.chance = 1; // deterministic for the test
    swing(sim, mob, p);
    MOBS['gravecaller_cultist'].hex!.chance = 0.3;
    const aura = p.auras.find((a) => a.kind === 'hex');
    expect(aura).toBeTruthy();
    expect(aura!.name).toBe('Weakening Hex');
    expect(aura!.value).toBe(0.2);
    expect(aura!.remaining).toBe(10);
  });

  it('hexOutputMult scales by (1 - reductionPct) per hex aura', () => {
    const sim = makeSim();
    const p = sim.player;
    expect((sim as any).hexOutputMult(p)).toBe(1);
    p.auras.push({ ...HEX_AURA });
    expect((sim as any).hexOutputMult(p)).toBeCloseTo(0.8, 6);
    expect((sim as any).hexOutputMult(null)).toBe(1);
  });

  it('reduces the damage a hexed source deals', () => {
    const sim = makeSim('warrior');
    const p = sim.player;
    const dummy = spawnCultist(sim, p);
    dummy.maxHp = 100000; dummy.hp = 100000;
    // Baseline hit (unhexed).
    (sim as any).dealDamage(p, dummy, 1000, false, 'shadow', null, 'hit', true);
    const plain = 100000 - dummy.hp;
    dummy.hp = 100000;
    // Same hit while hexed.
    p.auras.push({ ...HEX_AURA });
    (sim as any).dealDamage(p, dummy, 1000, false, 'shadow', null, 'hit', true);
    const hexed = 100000 - dummy.hp;
    expect(hexed).toBeLessThan(plain);
    expect(hexed).toBeCloseTo(plain * 0.8, 0);
  });

  it('reduces the healing a hexed source does', () => {
    const sim = makeSim('priest');
    const p = sim.player;
    (sim as any).spellCrit = () => 0; // remove crit RNG so the ratio is exact
    p.maxHp = 100000; p.hp = 1; // huge deficit so nothing is capped by overheal
    (sim as any).applyHeal(p, p, 1000, 'Test Heal');
    const plain = p.hp - 1;
    p.hp = 1;
    p.auras.push({ ...HEX_AURA });
    (sim as any).applyHeal(p, p, 1000, 'Test Heal');
    const hexed = p.hp - 1;
    expect(hexed).toBeLessThan(plain);
    expect(hexed).toBeCloseTo(plain * 0.8, 0);
  });

  it('a friendly pet swing never hexes its target', () => {
    const sim = makeSim();
    const p = sim.player;
    p.maxHp = 100000; p.hp = 100000;
    const pet = spawnCultist(sim, p);
    pet.hostile = false; // a tamed/friendly cultist shape
    pet.ownerId = p.id;
    MOBS['gravecaller_cultist'].hex!.chance = 1;
    swing(sim, pet, p);
    MOBS['gravecaller_cultist'].hex!.chance = 0.3;
    expect(p.auras.some((a) => a.kind === 'hex')).toBe(false);
  });
});
