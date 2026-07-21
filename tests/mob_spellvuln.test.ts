import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { Aura } from '../src/sim/types';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';

const SEED = 5150;
const makeSim = () => new Sim({ seed: SEED, playerClass: 'warrior' });

function spellVulnAura(value: number, remaining = 10): Aura {
  return {
    id: 'spellvuln_test', name: 'Static Charge', kind: 'spellvuln',
    remaining, duration: 10, value, sourceId: -1, school: 'nature',
  };
}

// Drive a single damage application and report how much HP it removed. The mob
// `src` carries no stance/affix, so dealDamage applies only the spell-vuln math.
function dmgTaken(sim: Sim, school: string, base = 100): number {
  const p = sim.entities.get(sim.playerId)!;
  const src = createMob(900600, MOBS.forest_wolf, 5, { x: 50, y: 0, z: 50 });
  p.hp = 100000;
  (sim as any).dealDamage(src, p, base, false, school, null, 'hit', true);
  return 100000 - p.hp;
}

describe('Spell Vulnerability (spellvuln) debuff', () => {
  it('amplifies non-physical damage by the debuff fraction', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000;
    expect(dmgTaken(sim, 'fire')).toBe(100); // baseline, no debuff

    p.auras.push(spellVulnAura(0.18));
    expect(dmgTaken(sim, 'fire')).toBe(118); // +18%
    expect(dmgTaken(sim, 'shadow')).toBe(118); // any magic school
  });

  it('does not amplify physical or holy (healing-school) damage', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000;
    p.auras.push(spellVulnAura(0.18));
    expect(dmgTaken(sim, 'physical')).toBe(100); // armor-school, untouched
    expect(dmgTaken(sim, 'holy')).toBe(100); // healing-school, excluded
  });

  it('stacks additively across multiple spellvuln auras', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000;
    p.auras.push({ ...spellVulnAura(0.18), id: 'a', sourceId: 1 });
    p.auras.push({ ...spellVulnAura(0.18), id: 'b', sourceId: 2 });
    expect(dmgTaken(sim, 'frost')).toBe(136); // 100 * (1 + 0.18 + 0.18)
  });

  it('a landed stormcrag_elemental swing can inflict Static Charge', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000; p.hp = 100000; // survive every swing so we observe the debuff
    const tmpl = MOBS.stormcrag_elemental;
    const saved = tmpl.spellVuln!.chance;
    tmpl.spellVuln!.chance = 1; // force the proc; misses/dodges still possible
    try {
      const mob = createMob(900601, tmpl, 18, { x: 0, y: 0, z: 0 });
      let applied = false;
      for (let i = 0; i < 60 && !applied; i++) {
        (sim as any).mobSwing(mob, p);
        applied = p.auras.some((a) => a.kind === 'spellvuln');
      }
      expect(applied).toBe(true);
      const a = p.auras.find((x) => x.kind === 'spellvuln')!;
      expect(a.name).toBe('Static Charge');
      expect(a.value).toBeCloseTo(0.18, 6);
    } finally {
      tmpl.spellVuln!.chance = saved;
    }
  });

  it('a friendly pet swing (hostile=false) never inflicts Static Charge', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000; p.hp = 100000;
    const tmpl = MOBS.stormcrag_elemental;
    const saved = tmpl.spellVuln!.chance;
    tmpl.spellVuln!.chance = 1;
    try {
      const pet = createMob(900602, tmpl, 18, { x: 0, y: 0, z: 0 });
      pet.hostile = false; // pets call mobSwing too
      for (let i = 0; i < 60; i++) (sim as any).mobSwing(pet, p);
      expect(p.auras.some((a) => a.kind === 'spellvuln')).toBe(false);
    } finally {
      tmpl.spellVuln!.chance = saved;
    }
  });

  it('a mob without spellVuln applies no debuff', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000; p.hp = 100000;
    const mob = createMob(900603, MOBS.forest_wolf, 5, { x: 0, y: 0, z: 0 });
    for (let i = 0; i < 40; i++) (sim as any).mobSwing(mob, p);
    expect(p.auras.some((a) => a.kind === 'spellvuln')).toBe(false);
  });
});
