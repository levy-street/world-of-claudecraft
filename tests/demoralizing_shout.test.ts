// Direhowl is the winning Protection Warrior's defensive area cooldown. The
// shared `aoeAttackPower` effect carries its percentage damage-done reduction;
// flat `debuff_ap` coverage below remains for other retained class content.
import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt, CLASSES } from '../src/sim/content/classes';
import { computeTalentModifiers } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

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

describe('warrior Direhowl', () => {
  it('is defined as a level-12 Protection area damage debuff', () => {
    const def = ABILITIES.demoralizing_shout;
    expect(def).toBeTruthy();
    expect(def.class).toBe('warrior');
    expect(def.learnLevel).toBe(12);
    expect(def.specs).toEqual(['prot']);
    expect(def.requiresTarget).toBe(false);
    expect(def.cooldown).toBe(45);
    expect(def.effects[0]).toMatchObject({
      type: 'aoeAttackPower',
      amount: 0,
      pct: 0.2,
      duration: 20,
      radius: 10,
    });
    expect(def.ranks).toBeUndefined();
  });

  it('sits in the warrior learn order and gates on level and Protection spec', () => {
    expect(CLASSES.warrior.abilities).toContain('demoralizing_shout');
    const prot11 = computeTalentModifiers('warrior', { spec: 'prot', rows: {} }, 11);
    const prot12 = computeTalentModifiers('warrior', { spec: 'prot', rows: {} }, 12);
    const arms20 = computeTalentModifiers('warrior', { spec: 'arms', rows: {} }, 20);
    expect(
      abilitiesKnownAt('warrior', 11, prot11).some((k) => k.def.id === 'demoralizing_shout'),
    ).toBe(false);
    expect(
      abilitiesKnownAt('warrior', 12, prot12).find((k) => k.def.id === 'demoralizing_shout')?.rank,
    ).toBe(1);
    expect(
      abilitiesKnownAt('warrior', 20, arms20).some((k) => k.def.id === 'demoralizing_shout'),
    ).toBe(false);
  });

  it('reduces nearby enemies damage dealt by 20% on cast', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    const p = sim.player;
    sim.setPlayerLevel(12, p.id);
    expect(sim.setSpec('prot', p.id)).toBe(true);
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
    expect(aura?.duration).toBe(20);
    expect(aura?.remaining).toBeGreaterThan(0);
  });

  it('cuts an enemy player effective attack power (PvP)', () => {
    // PvP regression: debuff_ap landed on an enemy player but recalcPlayerStats
    // never folded it, so the shout was a no-op versus players (it only bit mobs,
    // whose AP is folded live in effectiveAttackPower). The aura must lower the
    // target player's baked attackPower.
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const casterId = sim.addPlayer('warrior', 'Caster');
    const victimId = sim.addPlayer('warrior', 'Victim');
    sim.setPlayerLevel(20, victimId);
    const victim = sim.entities.get(victimId) as Entity;
    const before = victim.attackPower;
    expect(before).toBeGreaterThan(30);

    (sim as any).applyAura(victim, {
      id: 'demoralizing_shout_ap',
      name: 'Demoralizing Shout',
      kind: 'debuff_ap',
      remaining: 30,
      duration: 30,
      value: 30,
      sourceId: casterId,
      school: 'physical',
    });

    expect(victim.attackPower).toBe(before - 30);
  });

  it('restores enemy player attack power when the debuff expires', () => {
    // The baked-stat path must un-fold debuff_ap on expiry too: updateAuras only
    // re-runs recalcPlayerStats when a stats-affecting aura drops, so debuff_ap
    // has to mark stats dirty or the AP cut would persist forever after fade.
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const casterId = sim.addPlayer('warrior', 'Caster');
    const victimId = sim.addPlayer('warrior', 'Victim');
    sim.setPlayerLevel(20, victimId);
    const victim = sim.entities.get(victimId) as Entity;
    const before = victim.attackPower;

    (sim as any).applyAura(victim, {
      id: 'demoralizing_shout_ap',
      name: 'Demoralizing Shout',
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
      id: 'demoralizing_shout_ap',
      name: 'Demoralizing Shout',
      kind: 'debuff_ap',
      remaining: 30,
      duration: 30,
      value: victim.attackPower + 1000, // far exceeds base AP
      sourceId: casterId,
      school: 'physical',
    });

    expect(victim.attackPower).toBe(0);
  });

  it('does not touch a far-away enemy', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    const p = sim.player;
    sim.setPlayerLevel(12, p.id);
    expect(sim.setSpec('prot', p.id)).toBe(true);
    p.gm = true;
    p.resource = 100; // rage for the shout
    const far = spawnDummy(sim, p);
    far.pos = { x: p.pos.x + 60, y: p.pos.y, z: p.pos.z };

    sim.castAbility('demoralizing_shout', p.id);
    sim.tick();

    expect(far.auras.find((a) => a.id === 'demoralizing_shout_ap')).toBeUndefined();
  });
});
