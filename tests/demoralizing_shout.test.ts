// Direhowl (demoralizing_shout), the owner's rework: a 45s-cooldown defensive
// shout whose victims deal 20% less damage for 20s. The aoeAttackPower effect's
// pct form lands a NEGATIVE buff_dmg_done aura folded by the dealDamage amp
// loop, so it bites mobs (whose damage rides the weapon roll, where the old
// flat debuff_ap drain barely registered) and enemy players alike. The legacy
// flat form (debuff_ap) stays exercised via the druid's Demoralizing Roar
// (tests/threat.test.ts).
import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt, CLASSES } from '../src/sim/content/classes';
import { computeTalentModifiers, emptyAllocation } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

// Direhowl (demoralizing_shout) is prot-gated base kit (2026-07-07): it is only in
// the known list and castable once prot is committed.
const protMods = () => computeTalentModifiers('warrior', { ...emptyAllocation(), spec: 'prot' });

function spawnDummy(sim: Sim, target: Entity): Entity {
  const mob = createMob((sim as any).nextId++, MOBS.gravecaller_summoner, 14, {
    x: target.pos.x,
    y: target.pos.y,
    z: target.pos.z,
  });
  mob.hostile = true;
  (sim as any).addEntity(mob);
  return mob;
}

describe('warrior Direhowl (reworked)', () => {
  it('is a level-12, 45s-cooldown area damage-dealt debuff (20% for 20s)', () => {
    const def = ABILITIES.demoralizing_shout;
    expect(def).toBeTruthy();
    expect(def.class).toBe('warrior');
    expect(def.learnLevel).toBe(12);
    expect(def.requiresTarget).toBe(false);
    expect(def.cooldown).toBe(45);
    expect(def.effects[0]).toMatchObject({
      type: 'aoeAttackPower',
      pct: 0.2,
      duration: 20,
      radius: 10,
    });
    expect(def.ranks).toBeUndefined();
  });

  it('sits in the warrior learn order and gates on level', () => {
    expect(CLASSES.warrior.abilities).toContain('demoralizing_shout');
    expect(
      abilitiesKnownAt('warrior', 11, protMods()).some((k) => k.def.id === 'demoralizing_shout'),
    ).toBe(false);
    const at12 = abilitiesKnownAt('warrior', 12, protMods()).find(
      (k) => k.def.id === 'demoralizing_shout',
    );
    expect(at12?.rank).toBe(1);
  });

  it('lands the negative damage-dealt aura on nearby enemies and arms the cooldown', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    const p = sim.player;
    sim.setPlayerLevel(14, p.id);
    expect(sim.setSpec('prot', p.id)).toBe(true); // Direhowl is prot-gated base kit
    p.gm = true;
    p.resource = 100; // rage for the shout
    const mob = spawnDummy(sim, p);

    sim.castAbility('demoralizing_shout', p.id);
    sim.tick();

    const aura = mob.auras.find(
      (a) => a.kind === 'buff_dmg_done' && a.id === 'demoralizing_shout_ap',
    );
    expect(aura).toBeTruthy();
    expect(aura?.value).toBe(-0.2);
    expect(aura?.remaining).toBeGreaterThan(0);
    expect(p.cooldowns.get('demoralizing_shout')).toBeGreaterThan(40);
    // A negative-value buff_* aura classifies as a debuff on the target frame.
    expect(aura && aura.value < 0).toBe(true);
  });

  it('a demoralized attacker deals 20% less damage while the aura holds', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    const p = sim.player;
    sim.setPlayerLevel(14, p.id);
    p.gm = false;
    const mob = spawnDummy(sim, p);
    mob.hp = 1_000_000;
    mob.maxHp = 1_000_000;

    p.hp = p.maxHp;
    const hp0 = p.hp;
    (sim as any).dealDamage(mob, p, 100, false, 'physical', null, 'hit', true);
    const plain = hp0 - p.hp;

    mob.auras.push({
      id: 'demoralizing_shout_ap',
      name: 'Direhowl',
      kind: 'buff_dmg_done',
      value: -0.2,
      remaining: 20,
      duration: 20,
      sourceId: p.id,
      school: 'physical',
    });
    p.hp = p.maxHp;
    const hp1 = p.hp;
    (sim as any).dealDamage(mob, p, 100, false, 'physical', null, 'hit', true);
    const demoralized = hp1 - p.hp;

    expect(plain).toBe(100);
    expect(demoralized).toBe(80);
  });

  it('stacked demoralizes floor the damage multiplier at zero, never healing', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    const p = sim.player;
    const mob = spawnDummy(sim, p);
    for (let i = 0; i < 6; i++) {
      mob.auras.push({
        id: `demoralize_${i}`,
        name: 'Direhowl',
        kind: 'buff_dmg_done',
        value: -0.2,
        remaining: 20,
        duration: 20,
        sourceId: p.id,
        school: 'physical',
      });
    }
    p.hp = p.maxHp;
    const hp0 = p.hp;
    (sim as any).dealDamage(mob, p, 100, false, 'physical', null, 'hit', true);
    expect(hp0 - p.hp).toBe(0); // -120% floors at a 0x multiplier
  });

  it('does not touch a far-away enemy', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    const p = sim.player;
    sim.setPlayerLevel(14, p.id);
    expect(sim.setSpec('prot', p.id)).toBe(true); // Direhowl is prot-gated base kit
    p.gm = true;
    p.resource = 100; // rage for the shout
    const far = spawnDummy(sim, p);
    far.pos = { x: p.pos.x + 60, y: p.pos.y, z: p.pos.z };

    sim.castAbility('demoralizing_shout', p.id);
    sim.tick();

    expect(far.auras.find((a) => a.id === 'demoralizing_shout_ap')).toBeUndefined();
  });
});

describe('legacy flat aoeAttackPower (druid Demoralizing Roar path)', () => {
  it('cuts and restores an enemy player baked attack power (PvP fold + expiry)', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const casterId = sim.addPlayer('warrior', 'Caster');
    const victimId = sim.addPlayer('warrior', 'Victim');
    sim.setPlayerLevel(20, victimId);
    const victim = sim.entities.get(victimId) as Entity;
    const before = victim.attackPower;
    expect(before).toBeGreaterThan(30);

    (sim as any).applyAura(victim, {
      id: 'demoralizing_roar_ap',
      name: 'Demoralizing Roar',
      kind: 'debuff_ap',
      remaining: 1,
      duration: 1,
      value: 30,
      sourceId: casterId,
      school: 'physical',
    });
    expect(victim.attackPower).toBe(before - 30);

    for (let i = 0; i < 25 && victim.auras.some((a) => a.kind === 'debuff_ap'); i++) sim.tick();

    expect(victim.auras.some((a) => a.kind === 'debuff_ap')).toBe(false);
    expect(victim.attackPower).toBe(before);
  });

  it('floors a debuffed enemy player attack power at zero', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const casterId = sim.addPlayer('warrior', 'Caster');
    const victimId = sim.addPlayer('warrior', 'Victim');
    sim.setPlayerLevel(20, victimId);
    const victim = sim.entities.get(victimId) as Entity;

    (sim as any).applyAura(victim, {
      id: 'demoralizing_roar_ap',
      name: 'Demoralizing Roar',
      kind: 'debuff_ap',
      remaining: 30,
      duration: 30,
      value: victim.attackPower + 1000, // far exceeds base AP
      sourceId: casterId,
      school: 'physical',
    });

    expect(victim.attackPower).toBe(0);
  });
});
