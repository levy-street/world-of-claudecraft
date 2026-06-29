import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import {
  abilityScalingPower,
  channelTickBonus,
  directHitBonus,
  dotTickBonus,
} from '../src/sim/spell_scaling';
import type { Entity, PlayerClass } from '../src/sim/types';
import { MAX_LEVEL, SPELL_POWER_PER_INT } from '../src/sim/types';

function leveled(cls: PlayerClass, level = MAX_LEVEL) {
  const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
  const pid = sim.addPlayer(cls, 'Tester');
  sim.setPlayerLevel(level, pid);
  sim.tick();
  return { sim, pid, p: sim.entities.get(pid)! };
}

function spawnDummy(sim: Sim, target: Entity): Entity {
  const mob = createMob((sim as any).nextId++, MOBS.forest_wolf, MAX_LEVEL, {
    x: target.pos.x + 1,
    y: target.pos.y,
    z: target.pos.z,
  });
  mob.hostile = true;
  mob.maxHp = 100000;
  mob.hp = 100000;
  (sim as any).addEntity(mob);
  return mob;
}

describe('Spell Power derivation', () => {
  it('a caster derives spellPower = round(int * SPELL_POWER_PER_INT)', () => {
    const { p } = leveled('mage');
    expect(p.stats.int).toBeGreaterThan(0);
    expect(p.spellPower).toBe(Math.round(p.stats.int * SPELL_POWER_PER_INT));
    expect(p.spellPower).toBeGreaterThan(0);
  });

  it('grows with level (more int -> more spell power)', () => {
    const lo = leveled('mage', 5).p.spellPower;
    const hi = leveled('mage', MAX_LEVEL).p.spellPower;
    expect(hi).toBeGreaterThan(lo);
  });

  it('a pure-melee class (rogue) has far less spell power than a caster', () => {
    expect(leveled('rogue').p.spellPower).toBeLessThan(leveled('mage').p.spellPower / 3);
  });
});

// Balance band: at cap the Spell Power contribution to a flagship spell should be
// meaningful but not dominant. This pins the tuning of SPELL_POWER_PER_INT and the
// coefficient so a change that doubles caster damage fails loudly.
describe('Spell Power balance band (cap)', () => {
  it('Frostbolt gains a meaningful but bounded share of its hit from Spell Power', () => {
    const { p } = leveled('mage');
    const fb = abilitiesKnownAt('mage', MAX_LEVEL).find((k) => k.def.id === 'frostbolt')!;
    const dd = fb.effects.find((e) => e.type === 'directDamage') as { min: number; max: number };
    const avgBase = (dd.min + dd.max) / 2;
    const bonus = directHitBonus(p.spellPower, fb.def, fb.castTime);
    const share = bonus / (avgBase + bonus);
    expect(share).toBeGreaterThan(0.12);
    expect(share).toBeLessThan(0.5);
  });

  it('a DoT (Shadow Word: Pain) scales per tick within the band', () => {
    const { p } = leveled('priest');
    const swp = abilitiesKnownAt('priest', MAX_LEVEL).find((k) => k.def.id === 'shadow_word_pain')!;
    const dot = swp.effects.find((e) => e.type === 'dot') as {
      total: number;
      duration: number;
      interval: number;
    };
    const basePerTick = dot.total / (dot.duration / dot.interval);
    const bonusPerTick = dotTickBonus(p.spellPower, swp.def, dot.duration, dot.interval);
    const share = bonusPerTick / (basePerTick + bonusPerTick);
    expect(share).toBeGreaterThan(0.1);
    expect(share).toBeLessThan(0.55);
  });

  it('hunter Arcane Shot scales off Ranged AP (not Spell Power) within the band', () => {
    const { p } = leveled('hunter');
    const as = abilitiesKnownAt('hunter', MAX_LEVEL).find((k) => k.def.id === 'arcane_shot')!;
    expect(as.def.scalesWith).toBe('ranged');
    // scaling power is ranged AP, and it dwarfs the hunter's tiny spell power
    expect(abilityScalingPower(p, as.def)).toBe(p.rangedPower);
    expect(p.rangedPower).toBeGreaterThan(p.spellPower);
    const dd = as.effects.find((e) => e.type === 'directDamage') as { min: number; max: number };
    const avgBase = (dd.min + dd.max) / 2;
    const bonus = directHitBonus(p.rangedPower, as.def, as.castTime);
    const share = bonus / (avgBase + bonus);
    expect(share).toBeGreaterThan(0.1);
    expect(share).toBeLessThan(0.45);
  });

  it('warrior Execute scales off melee Attack Power (not Spell Power) within the band', () => {
    const { p } = leveled('warrior');
    const ex = abilitiesKnownAt('warrior', MAX_LEVEL).find((k) => k.def.id === 'execute')!;
    expect(ex.def.school).toBe('physical');
    expect(ex.def.scalesWith).toBeUndefined();
    // A physical special routes to melee Attack Power, which dwarfs a warrior's SP.
    expect(abilityScalingPower(p, ex.def)).toBe(p.attackPower);
    expect(p.attackPower).toBeGreaterThan(p.spellPower);
    const dd = ex.effects.find((e) => e.type === 'directDamage') as { min: number; max: number };
    const avgBase = (dd.min + dd.max) / 2;
    const bonus = directHitBonus(p.attackPower, ex.def, ex.castTime);
    expect(bonus).toBeGreaterThan(0);
    const share = bonus / (avgBase + bonus);
    expect(share).toBeGreaterThan(0.1);
    expect(share).toBeLessThan(0.45);
  });

  it('a warrior bleed (Rend) folds melee Attack Power into each DoT tick', () => {
    const { sim, p } = leveled('warrior');
    const dummy = spawnDummy(sim, p);
    p.targetId = dummy.id;
    p.resource = 100; // rage to pay for Rend
    const rend = abilitiesKnownAt('warrior', MAX_LEVEL).find((k) => k.def.id === 'rend')!;
    const dot = rend.effects.find((e) => e.type === 'dot') as {
      total: number;
      duration: number;
      interval: number;
    };
    sim.castAbility('rend', p.id);
    sim.tick();
    const aura = dummy.auras.find((a) => a.kind === 'dot' && a.id === 'rend')!;
    expect(aura).toBeDefined();
    const basePerTick = Math.max(1, Math.round(dot.total / (dot.duration / dot.interval)));
    const bonusPerTick = dotTickBonus(p.attackPower, rend.def, dot.duration, dot.interval);
    expect(bonusPerTick).toBeGreaterThan(0);
    expect(aura.value).toBe(basePerTick + bonusPerTick);
  });
});

// End-to-end: the snapshotted DoT tick value on the target reflects Spell Power.
describe('Spell Power end-to-end through the sim', () => {
  it('Shadow Word: Pain applies a per-tick value of base + Spell Power bonus', () => {
    const { sim, p } = leveled('priest');
    const dummy = spawnDummy(sim, p);
    p.targetId = dummy.id;
    const swp = abilitiesKnownAt('priest', MAX_LEVEL).find((k) => k.def.id === 'shadow_word_pain')!;
    const dot = swp.effects.find((e) => e.type === 'dot') as {
      total: number;
      duration: number;
      interval: number;
    };
    sim.castAbility('shadow_word_pain', p.id);
    sim.tick();
    const aura = dummy.auras.find((a) => a.kind === 'dot' && a.id === 'shadow_word_pain')!;
    expect(aura).toBeDefined();
    const basePerTick = Math.max(1, Math.round(dot.total / (dot.duration / dot.interval)));
    const bonusPerTick = dotTickBonus(p.spellPower, swp.def, dot.duration, dot.interval);
    expect(aura.value).toBe(basePerTick + bonusPerTick);
    expect(bonusPerTick).toBeGreaterThan(0); // SP actually contributed
  });

  it('Spell Power lifts Frostbolt damage above its no-SP base ceiling', () => {
    const { sim, p } = leveled('mage');
    const dummy = spawnDummy(sim, p);
    p.targetId = dummy.id;
    const fb = abilitiesKnownAt('mage', MAX_LEVEL).find((k) => k.def.id === 'frostbolt')!;
    const dd = fb.effects.find((e) => e.type === 'directDamage') as { min: number; max: number };
    const bonus = directHitBonus(p.spellPower, fb.def, fb.castTime);
    expect(bonus).toBeGreaterThan(0);

    // The dummy is only ever hit by our single Frostbolt (the wolf swings at the
    // mage, not the dummy), so its HP delta IS the spell's damage.
    const before = dummy.hp;
    sim.castAbility('frostbolt', p.id);
    for (let i = 0; i < 80 && dummy.hp === before; i++) sim.tick();
    const dealt = before - dummy.hp;
    expect(dealt).toBeGreaterThan(0);
    // a non-crit hit lands in [min+bonus, max+bonus]; that floor exceeds the no-SP
    // max, so any landed hit proves Spell Power was added.
    expect(dealt).toBeGreaterThan(dd.max);
  });

  it('each Arcane Missiles channel tick deals fixed base + Spell Power bonus', () => {
    const { sim, p } = leveled('mage');
    const dummy = spawnDummy(sim, p);
    p.targetId = dummy.id;
    const am = abilitiesKnownAt('mage', MAX_LEVEL).find((k) => k.def.id === 'arcane_missiles')!;
    const dd = am.effects.find((e) => e.type === 'directDamage') as { min: number; max: number };
    expect(dd.min).toBe(dd.max); // fixed per-missile base, no roll variance
    const perTickBonus = channelTickBonus(p.spellPower, am.def);
    expect(perTickBonus).toBeGreaterThan(0);

    const hits: number[] = [];
    let prev = dummy.hp;
    sim.castAbility('arcane_missiles', p.id);
    for (let i = 0; i < 80 && hits.length < 3; i++) {
      sim.tick();
      if (dummy.hp < prev) {
        hits.push(prev - dummy.hp);
        prev = dummy.hp;
      }
    }
    expect(hits.length).toBeGreaterThan(0);
    // the smallest tick is a non-crit missile: exactly base + the channel SP bonus
    expect(Math.min(...hits)).toBe(dd.min + perTickBonus);
  });
});
