import { describe, expect, it } from 'vitest';
import { updateAuras } from '../src/sim/combat/auras';
import { castAbility, updateCasting } from '../src/sim/combat/casting_lifecycle';
import { dealDamage } from '../src/sim/combat/damage';
import { applyHeal } from '../src/sim/combat/heal';
import { CRUCIBLE_SIGNATURE_TEXT } from '../src/sim/content/crucible_collections';
import { MOBS } from '../src/sim/data';
import { createMob, recalcPlayerStats } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity } from '../src/sim/types';

function groveheart() {
  const sim = new Sim({ seed: 3872, playerClass: 'druid', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(sim.setSpec('restoration')).toBe(true);
  const healer = sim.player;
  const meta = sim.players.get(healer.id);
  if (!meta) throw new Error('Missing healer metadata');
  meta.equipment.chest = 'crucible_healer_leather_chest';
  meta.equipment.waist = 'crucible_healer_leather_waist';
  recalcPlayerStats(healer, 'druid', meta.equipment, meta.talentMods, meta.equipmentInstance);
  const allyId = sim.addPlayer('warrior', 'Tank');
  sim.setPlayerLevel(20, allyId);
  const ally = sim.entities.get(allyId);
  if (!ally) throw new Error('Missing tank');
  ally.pos = { ...healer.pos };
  const enemy = createMob(9500, MOBS.training_dummy, 20, {
    ...healer.pos,
    z: healer.pos.z + 3,
  });
  enemy.hostile = true;
  sim.entities.set(enemy.id, enemy);
  const ctx = (sim as unknown as { ctx: SimContext }).ctx;
  // Never force the healer's combat flag. Healing threat does not set it.
  expect(healer.inCombat).toBe(false);
  expect(healer.craftedCollectionId).toBe('crucible_healer_leather');
  sim.targetEntity(ally.id);
  return { sim, healer, ally, enemy, ctx, meta };
}

function ward(entity: Entity) {
  return entity.auras.find((aura) => aura.id.endsWith('_heal_ward'));
}

function tickAuras(ctx: SimContext, entity: Entity, count: number): void {
  for (let index = 0; index < count; index++) updateAuras(ctx, entity);
}

function engage(ctx: SimContext, enemy: Entity, ally: Entity): void {
  dealDamage(ctx, enemy, ally, 1, false, 'fire', 'Raid hit', 'hit');
  expect(ally.inCombat).toBe(true);
  enemy.threat.set(ally.id, 1000);
}

describe('Crucible healer participation through real combat healing', () => {
  it('a pure Groveheart cast wards its combat ally, survives ticking, and absorbs a real hit', () => {
    const { sim, healer, ally, enemy, ctx, meta } = groveheart();
    engage(ctx, enemy, ally);
    castAbility(ctx, 'regrowth', healer.id);
    expect(healer.castingAbility).toBe('regrowth');
    for (let tick = 0; healer.castingAbility && tick < 100; tick++) {
      updateCasting(ctx, healer, meta);
    }
    expect(healer.castingAbility).toBeNull();
    const heal = sim.events.find((event) => event.type === 'heal2' && event.sourceId === healer.id);
    expect(heal).toMatchObject({ type: 'heal2', targetId: ally.id, amount: 1 });
    if (heal?.type !== 'heal2') throw new Error('Regrowth did not heal the tank');
    expect(heal.overheal).toBeGreaterThan(0);
    expect(enemy.threat.get(healer.id)).toBeGreaterThan(0);
    expect(healer.inCombat).toBe(false);
    const reserve = Math.min(Math.floor((heal.overheal ?? 0) * 0.2), Math.floor(ally.maxHp * 0.05));
    expect(ward(ally)).toMatchObject({ value: reserve, remaining: 6 });
    updateAuras(ctx, ally);
    expect(ward(ally)).toMatchObject({ value: reserve, remaining: 5.95 });
    const before = ally.hp;
    dealDamage(ctx, enemy, ally, reserve + 10, false, 'fire', 'Raid hit', 'hit');
    expect(before - ally.hp).toBe(10);
    expect(ward(ally)).toBeUndefined();
    expect(healer.inCombat).toBe(false);
    expect(CRUCIBLE_SIGNATURE_TEXT.healer).toContain('Healing an ally who is in combat');
    expect(CRUCIBLE_SIGNATURE_TEXT.healer).not.toContain('you and the healed ally');
    expect(CRUCIBLE_SIGNATURE_TEXT.healer).toContain('the shielded ally leaves combat');
    expect(CRUCIBLE_SIGNATURE_TEXT.healer).not.toContain('you or the shielded ally');
  });

  it('a real Wildbloom cannot shield before the pull but its later combat tick can', () => {
    const { healer, ally, enemy, ctx } = groveheart();
    castAbility(ctx, 'rejuvenation', healer.id);
    expect(ally.auras.some((aura) => aura.id === 'rejuvenation')).toBe(true);
    tickAuras(ctx, ally, 60);
    expect(ward(ally)).toBeUndefined();
    engage(ctx, enemy, ally);
    tickAuras(ctx, ally, 60);
    expect(healer.inCombat).toBe(false);
    expect(ward(ally)?.value).toBeGreaterThan(0);
    updateAuras(ctx, ally);
    expect(ward(ally)?.value).toBeGreaterThan(0);
  });

  it('keeps the shared cap and original six-second expiry for a pure healer', () => {
    const { healer, ally, enemy, ctx } = groveheart();
    engage(ctx, enemy, ally);
    ally.hp = ally.maxHp;
    applyHeal(ctx, healer, ally, 100, 'Heal', 'regrowth', false, false);
    expect(ward(ally)?.value).toBe(20);
    tickAuras(ctx, ally, 20);
    const remaining = ward(ally)?.remaining;
    expect(remaining).toBeCloseTo(5);
    applyHeal(ctx, healer, ally, 1000, 'Heal', 'regrowth', false, false);
    expect(ward(ally)).toMatchObject({ value: Math.floor(ally.maxHp * 0.05), remaining });
    tickAuras(ctx, ally, 101);
    expect(ward(ally)).toBeUndefined();
    expect(healer.inCombat).toBe(false);
  });

  it.each([
    'prepull',
    'self-prepull',
    'dead source',
    'dead target',
    'hostile',
    'nonplayer',
    'foreign source',
    'foreign target',
  ])('does not admit %s healing', (invalid) => {
    const { sim, healer, ally, enemy, ctx } = groveheart();
    engage(ctx, enemy, ally);
    let recipient = ally;
    if (invalid === 'prepull') ally.inCombat = false;
    if (invalid === 'self-prepull') recipient = healer;
    if (invalid === 'dead source') healer.dead = true;
    if (invalid === 'dead target') ally.dead = true;
    if (invalid === 'hostile') {
      healer.jailed = true;
      ally.jailed = true;
      expect(ctx.isFriendlyTo(healer, ally)).toBe(false);
    }
    if (invalid === 'nonplayer') healer.kind = 'mob';
    if (invalid === 'foreign source') sim.entities.delete(healer.id);
    if (invalid === 'foreign target') sim.entities.delete(ally.id);
    applyHeal(ctx, healer, recipient, 1000, 'Heal', 'regrowth', false, false);
    expect(ward(recipient)).toBeUndefined();
  });

  it.each([
    'source death',
    'pair loss',
    'recipient combat exit',
    'hostility change',
    'source departure',
  ])('revalidates %s before absorbing damage', (change) => {
    const { sim, healer, ally, enemy, ctx, meta } = groveheart();
    engage(ctx, enemy, ally);
    applyHeal(ctx, healer, ally, 1000, 'Heal', 'regrowth', false, false);
    expect(ward(ally)?.value).toBeGreaterThan(0);
    if (change === 'source death') healer.dead = true;
    if (change === 'pair loss') {
      delete meta.equipment.chest;
      recalcPlayerStats(healer, 'druid', meta.equipment, meta.talentMods, meta.equipmentInstance);
    }
    if (change === 'recipient combat exit') ally.inCombat = false;
    if (change === 'hostility change') {
      healer.jailed = true;
      ally.jailed = true;
    }
    if (change === 'source departure') sim.entities.delete(healer.id);
    const before = ally.hp;
    dealDamage(ctx, enemy, ally, 50, false, 'fire', 'Raid hit', 'hit');
    expect(before - ally.hp).toBe(50);
    expect(ward(ally)).toBeUndefined();
  });

  it('allows ordinary combat self-healing but excludes the Zeal proc heal', () => {
    const { healer, enemy, ctx } = groveheart();
    engage(ctx, enemy, healer);
    applyHeal(ctx, healer, healer, 1000, 'Zeal', 'enchant_weapon_lastflame_zeal', false, false);
    expect(ward(healer)).toBeUndefined();
    applyHeal(ctx, healer, healer, 100, 'Heal', 'regrowth', false, false);
    expect(ward(healer)?.value).toBe(20);
  });
});
