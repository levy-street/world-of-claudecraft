import { describe, expect, it, vi } from 'vitest';
import { castAbility, updateCasting } from '../src/sim/combat/casting_lifecycle';
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
import { placePlayerInOpenField } from './helpers/open_field';

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

  it('applies Hushwood silence only after a successful projectile impact', () => {
    const sim = makeSim('hunter');
    sim.setPlayerLevel(20);
    placePlayerInOpenField(sim);
    equipPower(sim, 'hushwood_longbow');
    const target = hostile(sim, 20);
    sim.player.resource = sim.player.maxResource;
    sim.player.facing = Math.atan2(
      target.pos.x - sim.player.pos.x,
      target.pos.z - sim.player.pos.z,
    );
    sim.targetEntity(target.id);
    vi.spyOn(sim.rng, 'next').mockReturnValue(0);

    castAbility(sim.ctx, 'aimed_shot', sim.playerId);
    expect(sim.player.castingAbility).toBe('aimed_shot');
    const meta = sim.players.get(sim.playerId);
    expect(meta).toBeDefined();
    if (!meta) throw new Error('Expected the simulated player metadata to exist.');
    for (let i = 0; i < 100 && sim.player.castingAbility; i++) {
      updateCasting(sim.ctx, sim.player, meta);
    }

    expect(sim.ctx.pendingProjectiles).toHaveLength(1);
    expect(target.auras.some((a) => a.kind === 'silence')).toBe(false);

    for (let i = 0; i < 100 && !target.auras.some((a) => a.kind === 'silence'); i++) sim.tick();

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

  it('scales Dawnward from effective Holy Light healing and ignores zero healing', () => {
    const sim = makeSim('paladin');
    equipPower(sim, 'dawnward_signet');

    const overheal = sim.ctx.applyHeal(
      sim.player,
      sim.player,
      100,
      'Mending Light',
      'holy_light',
      false,
    );
    expect(overheal).toBe(0);
    expect(sim.player.auras.some((a) => a.kind === 'absorb')).toBe(false);

    sim.player.hp -= 100;
    const healed = sim.ctx.applyHeal(
      sim.player,
      sim.player,
      100,
      'Mending Light',
      'holy_light',
      false,
    );
    const shield = sim.player.auras.find((a) => a.kind === 'absorb');

    expect(healed).toBe(100);
    expect(shield?.value).toBe(16);
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

  it('maps mark and resource powers onto existing primitives', () => {
    const warlock = makeSim('warlock');
    equipPower(warlock, 'ashbinders_seal');
    const marked = hostile(warlock, 2);
    for (let i = 0; i < 4; i++) onCastCompleted(warlock.ctx, warlock.player, 'shadow_bolt', marked);
    expect(marked.auras.some((a) => a.kind === 'vuln_source')).toBe(true);

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
      sim.tick();
    }

    const totalDamage = victims.reduce((sum, victim) => sum + (victim.maxHp - victim.hp), 0);
    expect(totalDamage).toBe(32);
    expect(victims.map((victim) => victim.maxHp - victim.hp)).toEqual([23, 3, 3, 3]);
  });

  it('counts one Bell cadence step per direct spell, not per AoE victim or DoT tick', () => {
    const sim = makeSim('mage');
    equipPower(sim, 'bell_of_the_ninth_peal', 'mainhand', 'ashwood_staff');
    const victims = Array.from({ length: 8 }, (_, index) => hostile(sim, 2 + index * 0.25));

    for (const victim of victims) {
      sim.ctx.dealDamage(sim.player, victim, 10, false, 'arcane', 'Arcane Barrage', 'hit');
    }
    expect(
      sim
        .drainEvents()
        .filter((event) => event.type === 'damage' && event.ability === 'Bell of the Ninth Peal'),
    ).toHaveLength(0);

    sim.tick();
    sim.ctx.dealDamage(
      sim.player,
      victims[0],
      10,
      false,
      'arcane',
      'Periodic Test',
      'hit',
      false,
      undefined,
      false,
    );
    sim.tick();
    sim.ctx.dealDamage(sim.player, victims[0], 10, false, 'arcane', 'Arcane Test', 'hit');
    expect(
      sim
        .drainEvents()
        .filter((event) => event.type === 'damage' && event.ability === 'Bell of the Ninth Peal'),
    ).toHaveLength(5);
  });

  it('does not apply source output multipliers twice to Bell replay damage', () => {
    const sim = makeSim('mage');
    equipPower(sim, 'bell_of_the_ninth_peal', 'mainhand', 'ashwood_staff');
    const primary = hostile(sim, 2);
    const secondary = hostile(sim, 3);
    sim.player.auras.push({
      id: 'test_damage_done',
      name: 'Test Damage Done',
      kind: 'buff_dmg_done',
      value: 1,
      remaining: 60,
      duration: 60,
      sourceId: sim.player.id,
      school: 'arcane',
    });

    sim.ctx.dealDamage(sim.player, primary, 100, false, 'arcane', 'Arcane Test', 'hit');
    sim.tick();
    sim.ctx.dealDamage(sim.player, primary, 100, false, 'arcane', 'Arcane Test', 'hit');

    // The second 200 effective hit produces a 25% Bell replay (=50). Reapplying
    // the +100% source aura would incorrectly make the secondary take 100.
    expect(secondary.maxHp - secondary.hp).toBe(50);
  });

  it('requires LoS and prioritizes the primary target before the Bell target cap', () => {
    const sim = makeSim('mage');
    equipPower(sim, 'bell_of_the_ninth_peal', 'mainhand', 'ashwood_staff');
    const victims = Array.from({ length: 7 }, (_, index) => hostile(sim, 2 + index * 0.2));
    const primary = victims[6];
    const blocked = victims[0];
    vi.spyOn(sim.ctx, 'hasLineOfSight').mockImplementation(
      (_source, target) => target.id !== blocked.id,
    );

    sim.ctx.dealDamage(sim.player, primary, 20, false, 'arcane', 'Arcane Test', 'hit');
    sim.tick();
    sim.ctx.dealDamage(sim.player, primary, 20, false, 'arcane', 'Arcane Test', 'hit');

    const bellVictims = sim
      .drainEvents()
      .flatMap((event) =>
        event.type === 'damage' && event.ability === 'Bell of the Ninth Peal'
          ? [event.targetId]
          : [],
      );
    expect(bellVictims).toHaveLength(5);
    expect(bellVictims).toContain(primary.id);
    expect(bellVictims).not.toContain(blocked.id);
  });

  it('routes Hushwood silence through lockout DR and respects immunity', () => {
    const sim = makeSim('hunter');
    equipPower(sim, 'hushwood_longbow');
    const target = hostile(sim, 2);
    const dr = vi.spyOn(sim.ctx, 'diminishedCrowdControlDuration').mockReturnValue(null);
    vi.spyOn(sim.rng, 'next').mockReturnValue(0);

    sim.ctx.triggerEquipmentEffects(sim.player, {
      kind: 'ability_hit',
      abilityId: 'aimed_shot',
      targetId: target.id,
    });

    expect(dr).toHaveBeenCalledWith(sim.player, target, 'lockout', expect.any(Number));
    expect(target.auras.some((a) => a.kind === 'silence')).toBe(false);
  });

  it('scopes Ashbinder vulnerability to Shadow damage', () => {
    const sim = makeSim('warlock');
    equipPower(sim, 'ashbinders_seal');
    const target = hostile(sim, 2);
    for (let i = 0; i < 4; i++) onCastCompleted(sim.ctx, sim.player, 'shadow_bolt', target);

    const damageFor = (school: 'shadow' | 'fire' | 'physical') => {
      target.hp = target.maxHp;
      sim.ctx.dealDamage(sim.player, target, 100, false, school, 'School Probe', 'hit');
      return target.maxHp - target.hp;
    };
    expect(damageFor('shadow')).toBe(115);
    expect(damageFor('fire')).toBe(100);
    expect(damageFor('physical')).toBe(100);
  });

  it('fills Ysolei healing slots with injured allies and prioritizes the trigger target', () => {
    const sim = makeSim('priest');
    equipPower(sim, 'ysoleis_vigil');
    const full: Entity[] = [];
    const injured: Entity[] = [];
    for (let index = 0; index < 6; index++) {
      const pid = sim.addPlayer('warrior', `Full${index}`);
      const ally = sim.entities.get(pid)!;
      ally.pos = { ...sim.player.pos, x: sim.player.pos.x + 1 + index * 0.1 };
      ally.prevPos = { ...ally.pos };
      sim.rebucket(ally);
      full.push(ally);
    }
    for (let index = 0; index < 6; index++) {
      const pid = sim.addPlayer('warrior', `Injured${index}`);
      const ally = sim.entities.get(pid)!;
      ally.pos = { ...sim.player.pos, x: sim.player.pos.x + 2 + index * 0.1 };
      ally.prevPos = { ...ally.pos };
      ally.hp = Math.max(1, ally.maxHp - 100 - index);
      sim.rebucket(ally);
      injured.push(ally);
    }
    const before = new Map(injured.map((ally) => [ally.id, ally.hp]));

    sim.ctx.triggerEquipmentEffects(sim.player, {
      kind: 'heal',
      targetId: injured[5].id,
      critical: true,
      amount: 100,
    });
    for (let tick = 0; tick < 21; tick++) sim.tick();

    expect(full.every((ally) => ally.hp === ally.maxHp)).toBe(true);
    expect(injured[5].hp).toBeGreaterThan(before.get(injured[5].id)!);
    expect(injured.filter((ally) => ally.hp > before.get(ally.id)!).length).toBe(5);
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

  it('preserves internal cooldowns across unrelated gear changes and real re-equip', () => {
    const sim = makeSim('rogue');
    const payload = equipPower(sim, 'nightglass_fang');
    sim.ctx.triggerEquipmentEffects(sim.player, { kind: 'kill', targetId: 99 });
    expect(sim.player.auras.some((a) => a.kind === 'buff_haste')).toBe(true);

    sim.player.auras = [];
    sim.addItem('mirefen_leather_boots', 1, sim.playerId);
    sim.equipItemToSlot('mirefen_leather_boots', 'feet', sim.playerId);
    sim.ctx.triggerEquipmentEffects(sim.player, { kind: 'kill', targetId: 100 });
    expect(sim.player.auras.some((a) => a.kind === 'buff_haste')).toBe(false);

    const resetUid = payload.procedural?.uid;
    if (!resetUid) throw new Error('legendary fixture lost procedural UID');
    expect(sim.unequipItem('mainhand')).toBe(true);
    sim.equipItemToSlot('mirefen_dirk', 'mainhand', sim.playerId, resetUid);
    sim.ctx.triggerEquipmentEffects(sim.player, { kind: 'kill', targetId: 101 });
    expect(sim.player.auras.some((a) => a.kind === 'buff_haste')).toBe(false);
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
