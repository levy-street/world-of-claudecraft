import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { summonPet } from '../src/sim/pet/pet_commands';
import { Sim } from '../src/sim/sim';
import { DT, type Entity } from '../src/sim/types';

function addDummy(sim: Sim, x = sim.player.pos.x, z = sim.player.pos.z + 4): Entity {
  const mob = createMob((sim as any).nextId++, MOBS.ridge_stalker, 20, {
    x,
    y: sim.player.pos.y,
    z,
  });
  mob.maxHp = 1_000_000;
  mob.hp = mob.maxHp;
  mob.hostile = true;
  sim.entities.set(mob.id, mob);
  (sim as any).rebucket(mob);
  return mob;
}

describe('signature mechanics v2', () => {
  it('Howling Rage arms Unleash Beast and extends its frenzy', () => {
    const sim = new Sim({ seed: 11, playerClass: 'hunter', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('beast_mastery')).toBe(true);
    const hunter = sim.player;
    summonPet(sim.ctx, hunter, 'forest_wolf');
    const target = addDummy(sim);
    sim.targetEntity(target.id);

    sim.castAbility('bestial_wrath');

    expect(hunter.auras.find((aura) => aura.id === 'pack_ferocity')?.stacks).toBe(3);
    expect(hunter.auras.find((aura) => aura.id === 'howling_rage_empower')?.value).toBe(1.5);
    expect(sim.resolvedAbility('pack_command')?.def.id).toBe('unleash_beast');

    const hpBefore = target.hp;
    sim.castAbility('pack_command');

    expect(target.hp).toBeLessThan(hpBefore);
    expect(hunter.auras.find((aura) => aura.kind === 'hunter_frenzy')).toMatchObject({
      remaining: 12,
      duration: 12,
    });
    expect(hunter.auras.some((aura) => aura.id === 'howling_rage_empower')).toBe(false);
  });

  it('Cold Focus strengthens Measured Shot and discounts Long Draw', () => {
    const sim = new Sim({ seed: 12, playerClass: 'hunter', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('marksmanship')).toBe(true);

    expect(sim.resolvedAbility('measured_shot')?.effects).toContainEqual({
      type: 'gainResource',
      amount: 20,
    });
    expect(sim.resolvedAbility('aimed_shot')).toMatchObject({ cost: 35, castTime: 2 });

    sim.castAbility('cold_focus');

    expect(sim.player.auras).toContainEqual(
      expect.objectContaining({ id: 'cold_focus', kind: 'hunter_cold_focus', remaining: 12 }),
    );
    expect(sim.resolvedAbility('measured_shot')?.effects).toContainEqual({
      type: 'gainResource',
      amount: 30,
    });
    expect(sim.resolvedAbility('aimed_shot')).toMatchObject({ cost: 26, castTime: 1.4 });
  });

  it('hemorrhage applies bleed vulnerability and makes later bleed ticks hit harder', () => {
    const sim = new Sim({ seed: 13, playerClass: 'rogue', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('subtlety')).toBe(true);
    const rogue = sim.player;
    rogue.resource = rogue.maxResource;
    rogue.facing = 0;
    const target = addDummy(sim, rogue.pos.x, rogue.pos.z + 4);
    sim.targetEntity(target.id);

    sim.castAbility('hemorrhage');
    const vuln = target.auras.find(
      (a) => a.kind === 'bleed_vuln' && a.id === 'hemorrhage_bleed_vuln',
    );
    expect(vuln?.value).toBe(0.4);

    target.auras = target.auras.filter((a) => a.kind !== 'dot');
    target.hp = target.maxHp;
    const hpBefore = target.hp;
    target.auras.push({
      id: 'test_bleed',
      name: 'Test Bleed',
      kind: 'dot',
      remaining: 3,
      duration: 3,
      value: 10,
      tickInterval: DT,
      tickTimer: DT,
      sourceId: rogue.id,
      school: 'physical',
    });
    const events = sim.tick();
    const tick = events.find(
      (e) =>
        e.type === 'damage' &&
        e.sourceId === rogue.id &&
        e.targetId === target.id &&
        e.ability === 'Test Bleed',
    );
    expect(tick?.type === 'damage' ? tick.amount : 0).toBe(14);
    expect(hpBefore - target.hp).toBe(14);
  });
});
