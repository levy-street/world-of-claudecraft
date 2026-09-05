import { describe, expect, it, vi } from 'vitest';
import {
  cleanupCraftedCollectionAuras,
  craftedPetDamageMultiplier,
  onCraftedCollectionDamage,
  onCraftedCollectionHeal,
  resetCraftedCollectionState,
} from '../src/sim/combat/crafted_collection_effects';
import { createPlayer } from '../src/sim/entity';
import type { SimContext } from '../src/sim/sim_context';
import type { Aura, Entity } from '../src/sim/types';

function wearer(id: number, collection = 'crucible_str_mail'): Entity {
  const entity = createPlayer(id, 'warrior', { x: 0, y: 0, z: 0 }, 'Crafter');
  entity.craftedCollectionId = collection;
  entity.inCombat = true;
  entity.auras = [];
  entity.maxHp = 1000;
  entity.hp = 1000;
  return entity;
}

function harness(...entities: Entity[]) {
  const ctx = {
    time: 0,
    tickCount: 0,
    entities: new Map(entities.map((entity) => [entity.id, entity])),
    rng: { chance: vi.fn(), next: vi.fn() },
    emit: vi.fn(),
    isHostileTo: (source: Entity, target: Entity) => source.id !== target.id,
    applyAura: (target: Entity, aura: Aura) => {
      target.auras = target.auras.filter(
        (active) => active.id !== aura.id || active.sourceId !== aura.sourceId,
      );
      target.auras.push(aura);
    },
  };
  return { ctx: ctx as unknown as SimContext, raw: ctx };
}

function advance(ctx: SimContext, seconds: number): void {
  (ctx as { time: number }).time += seconds;
  for (const entity of ctx.entities.values()) {
    entity.auras = entity.auras
      .map((aura) => ({ ...aura, remaining: aura.remaining - seconds }))
      .filter((aura) => aura.remaining > 0);
  }
}

function damage(ctx: SimContext, source: Entity, target: Entity, amount = 100): void {
  onCraftedCollectionDamage(ctx, source, target, amount, 'physical', true);
}

describe('crafted collection damage windows', () => {
  it('grants 8% damage for 6 seconds after six spaced landed attacks, without RNG', () => {
    const source = wearer(1);
    const target = wearer(2, '');
    const { ctx, raw } = harness(source, target);
    for (let count = 0; count < 5; count++) {
      damage(ctx, source, target);
      advance(ctx, 1);
    }
    expect(source.auras.some((aura) => aura.kind === 'buff_dmg_done')).toBe(false);
    damage(ctx, source, target);
    expect(source.auras.find((aura) => aura.kind === 'buff_dmg_done')).toMatchObject({
      value: 0.08,
      duration: 6,
      remaining: 6,
    });
    expect(raw.rng.chance).not.toHaveBeenCalled();
    expect(raw.rng.next).not.toHaveBeenCalled();
  });

  it('shares one charge per second across area targets, both hands, and pets', () => {
    const source = wearer(1);
    const pet = wearer(3, '');
    pet.kind = 'mob';
    pet.ownerId = source.id;
    const target = wearer(2, '');
    const { ctx } = harness(source, pet, target);
    for (let count = 0; count < 30; count++) {
      damage(ctx, count % 2 === 0 ? source : pet, target);
    }
    expect(source.auras.find((aura) => aura.id.includes('_charge'))?.value).toBe(1);
    advance(ctx, 1);
    damage(ctx, pet, target);
    expect(source.auras.find((aura) => aura.id.includes('_charge'))?.value).toBe(2);
  });

  it('physical requires direct Physical damage; caster includes periodic magic damage', () => {
    const physical = wearer(1);
    const caster = wearer(2, 'crucible_caster_cloth');
    const target = wearer(3, '');
    const { ctx } = harness(physical, caster, target);
    onCraftedCollectionDamage(ctx, physical, target, 100, 'physical', false);
    onCraftedCollectionDamage(ctx, physical, target, 100, 'fire', true);
    onCraftedCollectionDamage(ctx, caster, target, 100, 'shadow', false);
    expect(physical.auras).toHaveLength(0);
    expect(caster.auras.find((aura) => aura.id.includes('_charge'))?.value).toBe(1);
  });

  it('expired charge banks start again; misses and resolved copies do not build', () => {
    const source = wearer(1);
    const target = wearer(2, '');
    const { ctx } = harness(source, target);
    damage(ctx, source, target);
    advance(ctx, 8);
    damage(ctx, source, target, 0);
    onCraftedCollectionDamage(ctx, source, target, 100, 'physical', true, true);
    expect(source.auras).toHaveLength(0);
    damage(ctx, source, target);
    expect(source.auras.find((aura) => aura.id.includes('_charge'))?.value).toBe(1);
  });

  it('pets read the active owner window live and cannot retain it after a set swap', () => {
    const source = wearer(1);
    const pet = wearer(3, '');
    pet.kind = 'mob';
    pet.ownerId = source.id;
    const target = wearer(2, '');
    const { ctx } = harness(source, pet, target);
    for (let count = 0; count < 6; count++) {
      damage(ctx, pet, target);
      if (count < 5) advance(ctx, 1);
    }
    expect(craftedPetDamageMultiplier(ctx, pet)).toBe(1.08);
    damage(ctx, source, target);
    expect(source.auras.some((aura) => aura.id.includes('_charge'))).toBe(false);
    resetCraftedCollectionState(source, undefined);
    expect(craftedPetDamageMultiplier(ctx, pet)).toBe(1);
    expect(source.auras).toHaveLength(0);
  });
});

describe('crafted collection tank shelter', () => {
  it('works without a shield, after 40% max HP lost, with a 20-second cooldown', () => {
    const tank = wearer(1, 'crucible_tank_leather');
    const enemy = wearer(2, '');
    const { ctx } = harness(tank, enemy);
    damage(ctx, enemy, tank, 399);
    expect(tank.auras.some((aura) => aura.kind === 'absorb')).toBe(false);
    damage(ctx, enemy, tank, 1);
    expect(tank.auras.find((aura) => aura.kind === 'absorb')).toMatchObject({
      value: 80,
      remaining: 6,
    });
    advance(ctx, 6);
    damage(ctx, enemy, tank, 500);
    expect(tank.auras.some((aura) => aura.kind === 'absorb')).toBe(false);
    advance(ctx, 14);
    damage(ctx, enemy, tank, 400);
    expect(tank.auras.find((aura) => aura.kind === 'absorb')?.value).toBe(80);
  });

  it('ignores self damage, environmental damage, zero loss, and lethal loss', () => {
    const tank = wearer(1, 'crucible_tank_mail');
    const enemy = wearer(2, '');
    const { ctx } = harness(tank, enemy);
    damage(ctx, tank, tank, 500);
    onCraftedCollectionDamage(ctx, null, tank, 500, 'fire', false);
    damage(ctx, enemy, tank, 0);
    tank.hp = 0;
    damage(ctx, enemy, tank, 500);
    expect(tank.auras).toHaveLength(0);
  });

  it('does not accumulate chip damage across more than ten seconds', () => {
    const tank = wearer(1, 'crucible_tank_mail');
    const enemy = wearer(2, '');
    const { ctx } = harness(tank, enemy);
    damage(ctx, enemy, tank, 200);
    advance(ctx, 10);
    damage(ctx, enemy, tank, 200);
    expect(tank.auras.some((aura) => aura.kind === 'absorb')).toBe(false);
  });
});

describe('crafted collection overheal protection', () => {
  it('converts 20% of overheal, capped at 5% recipient maximum health', () => {
    const healer = wearer(1, 'crucible_healer_cloth');
    const ally = wearer(2, '');
    const { ctx } = harness(healer, ally);
    onCraftedCollectionHeal(ctx, healer, ally, 100);
    expect(ally.auras.find((aura) => aura.kind === 'absorb')?.value).toBe(20);
    onCraftedCollectionHeal(ctx, healer, ally, 1000);
    expect(ally.auras.find((aura) => aura.kind === 'absorb')).toMatchObject({
      value: 50,
      remaining: 6,
    });
  });

  it('shares the cap across healers without extending an earlier contribution', () => {
    const first = wearer(1, 'crucible_healer_cloth');
    const second = wearer(3, 'crucible_healer_mail');
    const ally = wearer(2, '');
    const { ctx } = harness(first, second, ally);
    onCraftedCollectionHeal(ctx, first, ally, 200);
    advance(ctx, 5);
    onCraftedCollectionHeal(ctx, second, ally, 200);
    expect(ally.auras.reduce((sum, aura) => sum + aura.value, 0)).toBe(50);
    expect(ally.auras.find((aura) => aura.sourceId === first.id)?.remaining).toBe(1);
    advance(ctx, 1);
    expect(ally.auras.reduce((sum, aura) => sum + aura.value, 0)).toBe(10);
  });

  it('cannot stockpile before combat or retain shields after owner death or set loss', () => {
    const healer = wearer(1, 'crucible_healer_cloth');
    const ally = wearer(2, '');
    const { ctx } = harness(healer, ally);
    healer.inCombat = false;
    onCraftedCollectionHeal(ctx, healer, ally, 1000);
    expect(ally.auras).toHaveLength(0);
    healer.inCombat = true;
    onCraftedCollectionHeal(ctx, healer, ally, 1000);
    healer.dead = true;
    cleanupCraftedCollectionAuras(ctx, ally);
    expect(ally.auras).toHaveLength(0);
    healer.dead = false;
    onCraftedCollectionHeal(ctx, healer, ally, 1000);
    healer.craftedCollectionId = undefined;
    cleanupCraftedCollectionAuras(ctx, ally);
    expect(ally.auras).toHaveLength(0);
  });

  it('leaves all pre-existing auras and RNG untouched for players without a collection', () => {
    const source = wearer(1, '');
    const target = wearer(2, '');
    const { ctx, raw } = harness(source, target);
    const original: Aura = {
      id: 'old_ward', name: 'Old Ward', kind: 'absorb', value: 30,
      remaining: 10, duration: 10, sourceId: source.id, school: 'holy',
    };
    target.auras = [original];
    damage(ctx, source, target);
    onCraftedCollectionHeal(ctx, source, target, 1000);
    cleanupCraftedCollectionAuras(ctx, target);
    expect(target.auras).toEqual([original]);
    expect(target.auras[0]).toBe(original);
    expect(raw.emit).not.toHaveBeenCalled();
    expect(raw.rng.chance).not.toHaveBeenCalled();
  });
});
