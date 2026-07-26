import { describe, expect, it, vi } from 'vitest';
import { handleDeath } from '../src/sim/combat/damage';
import { onCastCompleted } from '../src/sim/combat/talent_procs';
import type { ProceduralLegendaryPowerId } from '../src/sim/content/procedural_legendary_powers';
import { PROCEDURAL_LEGENDARY_POWERS } from '../src/sim/content/procedural_legendary_powers';
import { PROCEDURAL_ITEM_BASES } from '../src/sim/content/procedural_loot';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { MAX_ACTIVE_LEGENDARY_POWERS } from '../src/sim/equipment/equipment_effect_types';
import { generateProceduralItem } from '../src/sim/loot/procedural';
import { Sim } from '../src/sim/sim';
import type { Entity, EquipSlot, ItemInstancePayload, PlayerClass } from '../src/sim/types';

let uidSequence = 0;

function makeSim(cls: PlayerClass): Sim {
  const sim = new Sim({ seed: 71, playerClass: cls, autoEquip: false });
  sim.player.level = 40;
  return sim;
}

function powerPayload(
  powerId: ProceduralLegendaryPowerId,
  baseId: string | undefined = PROCEDURAL_LEGENDARY_POWERS[powerId].compatibleBaseIds?.[0],
): ItemInstancePayload {
  if (!baseId) throw new Error(`legendary power ${powerId} has no compatible base`);
  const definition = PROCEDURAL_LEGENDARY_POWERS[powerId];
  const uid = `pi1:equipment-integration:${++uidSequence}`;
  const generated = generateProceduralItem({
    seed: 71 + uidSequence,
    uid,
    context: {
      source: 'dev',
      sourceEntityId: 1,
      sourceSpawnSequence: uidSequence,
      lootSlotIndex: 0,
    },
    basePoolId: 'initial_all',
    rarityTableId: 'initial_dungeon_boss',
    sourceItemLevel: 20,
    forcedItemLevel: 20,
    forcedBaseId: baseId,
    forcedRarity: 'legendary',
  }).instance;
  const procedural = generated.procedural;
  procedural.legendaryPowerId = powerId;
  procedural.powerRevision = 1;
  procedural.legendaryRolls = Object.fromEntries(
    Object.entries(definition.rolls).map(([key, roll]) => [key, roll.min]),
  );
  procedural.generatedName = { baseId, legendaryNameId: powerId };
  return generated;
}

function equipPower(
  sim: Sim,
  powerId: ProceduralLegendaryPowerId,
  slot?: EquipSlot,
  baseId?: string,
): ItemInstancePayload {
  const resolvedBaseId = baseId ?? PROCEDURAL_LEGENDARY_POWERS[powerId].compatibleBaseIds?.[0];
  if (!resolvedBaseId) throw new Error(`legendary power ${powerId} has no compatible base`);
  const base = PROCEDURAL_ITEM_BASES[resolvedBaseId];
  if (!base)
    throw new Error(`legendary power ${powerId} references unknown base ${resolvedBaseId}`);
  const resolvedSlot: EquipSlot =
    slot ?? (base.slot === 'ring' ? 'ring1' : (base.slot as EquipSlot));
  const payload = powerPayload(powerId, resolvedBaseId);
  if (!payload.procedural) throw new Error('legendary fixture lost procedural payload');
  const uid = payload.procedural.uid;
  sim.addItemInstance(resolvedBaseId, payload, sim.playerId);
  sim.equipItemToSlot(resolvedBaseId, resolvedSlot, sim.playerId, uid);
  expect(sim.players.get(sim.playerId)?.equipmentInstance[resolvedSlot]?.procedural?.uid).toBe(uid);
  return payload;
}

function hostile(sim: Sim, offset: number, hp = 5000): Entity {
  const p = sim.player;
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x: p.pos.x + offset,
    y: p.pos.y,
    z: p.pos.z,
  });
  mob.hostile = true;
  mob.maxHp = hp;
  mob.hp = hp;
  sim.addEntity(mob);
  return mob;
}

describe('legendary equipment integration', () => {
  it('routes ability-cast cadence into authoritative area damage', () => {
    const sim = makeSim('mage');
    equipPower(sim, 'crown_last_pyre');
    const target = hostile(sim, 2);
    const nearby = hostile(sim, 3);

    onCastCompleted(sim.ctx, sim.player, 'fireball', target);
    onCastCompleted(sim.ctx, sim.player, 'fireball', target);
    expect(nearby.hp).toBe(nearby.maxHp);
    onCastCompleted(sim.ctx, sim.player, 'fireball', target);

    expect(target.hp).toBeLessThan(target.maxHp);
    expect(nearby.hp).toBeLessThan(nearby.maxHp);
  });

  it('applies a weapon-hit bleed and restores primary resource', () => {
    const sim = makeSim('warrior');
    equipPower(sim, 'greyjaws_edge');
    const target = hostile(sim, 2);
    sim.player.resource = 0;

    for (let hit = 0; hit < 3; hit += 1) {
      sim.ctx.triggerEquipmentEffects(sim.player, {
        kind: 'weapon_hit',
        targetId: target.id,
        critical: true,
        amount: 100,
      });
    }

    expect(target.auras.some((a) => a.kind === 'dot' && a.equipmentProcDepth === 1)).toBe(true);
    expect(sim.player.resource).toBe(4);
  });

  it('uses the chance gate and authoritative silence aura', () => {
    const sim = makeSim('hunter');
    equipPower(sim, 'hushwood_longbow');
    const target = hostile(sim, 2);
    vi.spyOn(sim.rng, 'next').mockReturnValue(0);

    onCastCompleted(sim.ctx, sim.player, 'aimed_shot', target);

    expect(target.auras.some((a) => a.kind === 'silence')).toBe(true);
  });

  it('dispatches a real kill into the haste-buff primitive', () => {
    const sim = makeSim('rogue');
    equipPower(sim, 'nightglass_fang');
    const target = hostile(sim, 2, 1);

    sim.ctx.dealDamage(sim.player, target, 1, false, 'physical', null, 'hit');

    expect(target.dead).toBe(true);
    expect(sim.player.auras.some((a) => a.kind === 'buff_haste')).toBe(true);
  });

  it('dispatches a real critical heal into a persistent healing ground area', () => {
    const sim = makeSim('priest');
    equipPower(sim, 'ysoleis_vigil');
    sim.player.hp = Math.max(1, sim.player.maxHp - 100);
    vi.spyOn(sim.rng, 'next').mockReturnValue(0);

    sim.ctx.applyHeal(sim.player, sim.player, 50, 'Flash Heal', 'flash_heal');

    expect(sim.ctx.groundAoEs).toHaveLength(1);
    expect(sim.ctx.groundAoEs[0].equipmentAllyHeal?.powerId).toBe('ysoleis_vigil');
  });

  it('chains every fourth lightning cast to nearby enemies but not the primary', () => {
    const sim = makeSim('shaman');
    equipPower(sim, 'stormwake_idol');
    const primary = hostile(sim, 2);
    const nearbyA = hostile(sim, 3);
    const nearbyB = hostile(sim, 4);

    for (let i = 0; i < 4; i++) onCastCompleted(sim.ctx, sim.player, 'lightning_bolt', primary);

    expect(primary.hp).toBe(primary.maxHp);
    expect(nearbyA.hp).toBeLessThan(nearbyA.maxHp);
    expect(nearbyB.hp).toBeLessThan(nearbyB.maxHp);
  });

  it('maps mark, shield, and resource powers onto existing primitives', () => {
    const warlock = makeSim('warlock');
    equipPower(warlock, 'ashbinders_seal');
    const marked = hostile(warlock, 2);
    for (let i = 0; i < 4; i++) onCastCompleted(warlock.ctx, warlock.player, 'shadow_bolt', marked);
    expect(marked.auras.some((a) => a.kind === 'vuln_source')).toBe(true);

    const paladin = makeSim('paladin');
    equipPower(paladin, 'dawnward_signet');
    onCastCompleted(paladin.ctx, paladin.player, 'holy_light', paladin.player);
    expect(paladin.player.auras.some((a) => a.kind === 'absorb')).toBe(true);

    const druid = makeSim('druid');
    equipPower(druid, 'feral_moonclasp');
    druid.player.resource = 0;
    for (let i = 0; i < 3; i++) onCastCompleted(druid.ctx, druid.player, 'moonfire');
    expect(druid.player.resource).toBe(4);
  });

  it('does not let Bell area damage recursively advance equipment triggers', () => {
    const sim = makeSim('mage');
    equipPower(sim, 'bell_of_the_ninth_peal', 'mainhand', 'ashwood_staff');
    const victims = [hostile(sim, 2), hostile(sim, 3), hostile(sim, 4), hostile(sim, 5)];

    for (let i = 0; i < 2; i++) {
      sim.ctx.dealDamage(sim.player, victims[0], 10, false, 'arcane', 'Arcane Test', 'hit');
    }

    const totalDamage = victims.reduce((sum, victim) => sum + (victim.maxHp - victim.hp), 0);
    expect(totalDamage).toBe(32);
    expect(victims.map((victim) => victim.maxHp - victim.hp)).toEqual([23, 3, 3, 3]);
  });

  it('routes real health crossing and accumulated movement events into defensive buffs', () => {
    const mantle = makeSim('mage');
    equipPower(mantle, 'mantle_of_borrowed_time');
    mantle.player.maxHp = 100;
    mantle.player.hp = 100;
    mantle.ctx.dealDamage(null, mantle.player, 70, false, 'shadow', 'Test', 'hit');
    expect(mantle.player.auras.some((a) => a.kind === 'shield_wall')).toBe(true);

    const boots = makeSim('mage');
    equipPower(boots, 'boots_of_the_unbroken_road');
    boots.ctx.triggerEquipmentEffects(boots.player, { kind: 'movement', movementDistance: 7 });
    expect(boots.player.auras.some((a) => a.kind === 'buff_speed')).toBe(false);
    boots.ctx.triggerEquipmentEffects(boots.player, { kind: 'movement', movementDistance: 8 });
    expect(boots.player.auras.some((a) => a.kind === 'buff_speed')).toBe(true);
  });

  it('rejects a second Legendary power before inventory mutation', () => {
    expect(MAX_ACTIVE_LEGENDARY_POWERS).toBe(1);
    const sim = makeSim('mage');
    equipPower(sim, 'bell_of_the_ninth_peal', 'mainhand', 'ashwood_staff');
    const boots = powerPayload('boots_of_the_unbroken_road', 'gravecaller_cloth_slippers');
    const bootsUid = boots.procedural?.uid;
    if (!bootsUid) throw new Error('legendary fixture lost procedural UID');
    sim.addItemInstance('gravecaller_cloth_slippers', boots, sim.playerId);
    sim.drainEvents();

    sim.equipItemToSlot('gravecaller_cloth_slippers', 'feet', sim.playerId, bootsUid);

    const meta = sim.players.get(sim.playerId);
    expect(meta?.equipment.feet).toBeUndefined();
    expect(meta?.inventory.some((slot) => slot.instance?.procedural?.uid === bootsUid)).toBe(true);
    expect(
      sim
        .drainEvents()
        .filter((event) => event.type === 'error')
        .map((event) => event.text),
    ).toContain('You can equip only one Legendary power at a time.');
  });

  it('allows a same-slot replacement while enforcing the one-power limit', () => {
    const sim = makeSim('priest');
    const first = equipPower(sim, 'bell_of_the_ninth_peal', 'mainhand', 'ashwood_staff');
    const firstUid = first.procedural?.uid;
    if (!firstUid) throw new Error('first legendary fixture lost procedural UID');
    const replacement = powerPayload('ysoleis_vigil', 'ashwood_staff');
    const replacementUid = replacement.procedural?.uid;
    if (!replacementUid) throw new Error('replacement legendary fixture lost procedural UID');
    sim.addItemInstance('ashwood_staff', replacement, sim.playerId);
    sim.drainEvents();

    sim.equipItemToSlot('ashwood_staff', 'mainhand', sim.playerId, replacementUid);

    const meta = sim.players.get(sim.playerId);
    expect(meta?.equipment.mainhand).toBe('ashwood_staff');
    expect(meta?.equipmentInstance.mainhand?.procedural?.uid).toBe(replacementUid);
    expect(meta?.inventory.some((slot) => slot.instance?.procedural?.uid === firstUid)).toBe(true);
    expect(
      sim
        .drainEvents()
        .filter((event) => event.type === 'error')
        .map((event) => event.text),
    ).not.toContain('You can equip only one Legendary power at a time.');
  });

  it('resets cadence on real unequip', () => {
    const reset = makeSim('mage');
    const payload = equipPower(reset, 'crown_last_pyre');
    const target = hostile(reset, 2);
    onCastCompleted(reset.ctx, reset.player, 'fireball', target);
    onCastCompleted(reset.ctx, reset.player, 'fireball', target);
    expect(reset.unequipItem('helmet')).toBe(true);
    const resetUid = payload.procedural?.uid;
    if (!resetUid) throw new Error('legendary fixture lost procedural UID');
    reset.equipItemToSlot('gravecaller_cloth_hood', 'helmet', reset.playerId, resetUid);
    onCastCompleted(reset.ctx, reset.player, 'fireball', target);
    expect(target.hp).toBe(target.maxHp);
  });

  it('clears internal cooldown state on death while retaining equipped selection', () => {
    const sim = makeSim('rogue');
    equipPower(sim, 'nightglass_fang');
    sim.ctx.triggerEquipmentEffects(sim.player, { kind: 'kill', targetId: 99 });
    expect(sim.player.auras.some((a) => a.kind === 'buff_haste')).toBe(true);

    handleDeath(sim.ctx, sim.player, null);
    sim.player.dead = false;
    sim.player.hp = sim.player.maxHp;
    sim.player.auras = [];
    sim.ctx.triggerEquipmentEffects(sim.player, { kind: 'kill', targetId: 100 });

    expect(sim.player.auras.some((a) => a.kind === 'buff_haste')).toBe(true);
  });
});
