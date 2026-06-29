// Demoralizing Shout is the warrior's area attack-power debuff — the shout twin
// of the druid's Demoralizing Roar. It reuses the existing `aoeAttackPower`
// effect (which lands a `debuff_ap` aura on every nearby hostile), so it is a
// pure-data ability with zero sim-engine change.
import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt, CLASSES } from '../src/sim/content/classes';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

function spawnDummy(sim: Sim, target: Entity): Entity {
  const mob = createMob((sim as any).nextId++, MOBS['gravecaller_summoner'], 14, {
    x: target.pos.x,
    y: target.pos.y,
    z: target.pos.z,
  });
  mob.hostile = true;
  (sim as any).addEntity(mob);
  return mob;
}

describe('warrior Demoralizing Shout', () => {
  it('is defined as a level-14 area attack-power debuff', () => {
    const def = ABILITIES['demoralizing_shout'];
    expect(def).toBeTruthy();
    expect(def.class).toBe('warrior');
    expect(def.learnLevel).toBe(14);
    expect(def.requiresTarget).toBe(false);
    expect(def.effects[0]).toMatchObject({
      type: 'aoeAttackPower',
      amount: 30,
      duration: 30,
      radius: 10,
    });
    expect(def.ranks?.[0]).toMatchObject({ level: 20 });
  });

  it('sits in the warrior learn order and gates on level', () => {
    expect(CLASSES.warrior.abilities).toContain('demoralizing_shout');
    expect(abilitiesKnownAt('warrior', 13).some((k) => k.def.id === 'demoralizing_shout')).toBe(
      false,
    );
    const at14 = abilitiesKnownAt('warrior', 14).find((k) => k.def.id === 'demoralizing_shout');
    expect(at14?.rank).toBe(1);
    expect(
      abilitiesKnownAt('warrior', 20).find((k) => k.def.id === 'demoralizing_shout')?.rank,
    ).toBe(2);
  });

  it('debuffs the attack power of nearby enemies on cast', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    const p = sim.player;
    sim.setPlayerLevel(14, p.id);
    p.gm = true;
    p.resource = 100; // rage for the shout
    const mob = spawnDummy(sim, p);

    sim.castAbility('demoralizing_shout', p.id);
    sim.tick();

    const aura = mob.auras.find((a) => a.kind === 'debuff_ap' && a.id === 'demoralizing_shout_ap');
    expect(aura).toBeTruthy();
    expect(aura!.value).toBe(30);
    expect(aura!.remaining).toBeGreaterThan(0);
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
    sim.setPlayerLevel(14, p.id);
    p.gm = true;
    p.resource = 100; // rage for the shout
    const far = spawnDummy(sim, p);
    far.pos = { x: p.pos.x + 60, y: p.pos.y, z: p.pos.z };

    sim.castAbility('demoralizing_shout', p.id);
    sim.tick();

    expect(far.auras.find((a) => a.kind === 'debuff_ap')).toBeUndefined();
  });
});
