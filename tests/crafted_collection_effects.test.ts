import { describe, expect, it, vi } from 'vitest';
import { updateAuras } from '../src/sim/combat/auras';
import { ARCANE_SURGE_ID, ECHO_ROTATION_CONVERSION_MULT } from '../src/sim/combat/chronomancy';
import {
  CRAFTED_OVERHEAL_CAP_FRACTION,
  CRAFTED_OVERHEAL_FRACTION,
  CRAFTED_WINDOW_SECONDS,
  cleanupCraftedCollectionAuras,
  craftedPetDamageMultiplier,
  onCraftedCollectionDamage,
  onCraftedCollectionHeal,
  resetCraftedCollectionState,
} from '../src/sim/combat/crafted_collection_effects';
import { dealDamage } from '../src/sim/combat/damage';
import { applyHeal } from '../src/sim/combat/heal';
import { DOCTRINE_AURA_ID } from '../src/sim/combat/priest/doctrine';
import * as talentProcs from '../src/sim/combat/talent_procs';
import { tickTemporalHourglassHealing } from '../src/sim/combat/temporal_hourglass';
import { CRUCIBLE_SIGNATURE_TEXT } from '../src/sim/content/crucible_collections';
import { MOBS } from '../src/sim/data';
import { createMob, createPlayer, recalcPlayerStats } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
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
    isFriendlyTo: (source: Entity, target: Entity) =>
      source.kind === 'player' && target.kind === 'player',
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
  it('keeps the defensive cooldown through collection changes and leaving combat', () => {
    const tank = wearer(1, 'crucible_tank_mail');
    const enemy = wearer(2, '');
    const { ctx } = harness(tank, enemy);
    damage(ctx, enemy, tank, 400);
    resetCraftedCollectionState(tank, undefined);
    tank.inCombat = false;
    cleanupCraftedCollectionAuras(ctx, tank);
    expect(tank.auras).toHaveLength(1);
    expect(tank.auras[0]).toMatchObject({ id: 'crafted_collection_tank_cooldown', remaining: 20 });
    resetCraftedCollectionState(tank, 'crucible_tank_leather');
    tank.inCombat = true;
    damage(ctx, enemy, tank, 400);
    expect(tank.auras.some((aura) => aura.kind === 'absorb')).toBe(false);
  });
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

function liveCollection(collection: string, cls: 'warrior' | 'mage' | 'priest' = 'warrior') {
  const sim = new Sim({ seed: 42, playerClass: cls, autoEquip: false });
  sim.setPlayerLevel(20);
  const source = sim.player;
  const meta = sim.players.get(source.id)!;
  meta.equipment.chest = `${collection}_chest`;
  meta.equipment.waist = `${collection}_waist`;
  recalcPlayerStats(source, cls, meta.equipment, meta.talentMods, meta.equipmentInstance);
  source.inCombat = true;
  const target = createMob(9500, MOBS.training_dummy, 20, { ...source.pos, z: source.pos.z + 3 });
  target.maxHp = target.hp = 100_000;
  target.inCombat = true;
  target.hostile = true;
  sim.entities.set(target.id, target);
  const ctx = (sim as unknown as { ctx: SimContext }).ctx;
  return { sim, source, target, ctx, meta };
}

describe('crafted signatures through the real shared combat hubs', () => {
  it('banks hostile raid-mob damage but excludes friendly and environmental damage', () => {
    const { source: tank, target: enemy, ctx } = liveCollection('crucible_tank_mail');
    const hit = Math.ceil(tank.maxHp * 0.4);
    enemy.hostile = false;
    dealDamage(ctx, enemy, tank, hit, false, 'fire', 'Friendly', 'hit');
    expect(tank.auras.some((aura) => aura.id.endsWith('_damage_bank'))).toBe(false);
    expect(tank.auras.some((aura) => aura.id.endsWith('_tank_ward'))).toBe(false);
    tank.hp = tank.maxHp;
    dealDamage(ctx, null, tank, hit, false, 'fire', 'Environment', 'hit');
    expect(tank.auras.some((aura) => aura.id.endsWith('_tank_ward'))).toBe(false);
    tank.hp = tank.maxHp;
    enemy.hostile = true;
    expect(ctx.isHostileTo(enemy, tank)).toBe(false);
    expect(ctx.isHostileTo(tank, enemy)).toBe(true);
    dealDamage(ctx, enemy, tank, hit, false, 'fire', 'Hostile', 'hit');
    expect(tank.auras.find((aura) => aura.id.endsWith('_tank_ward'))?.value).toBe(
      Math.round(tank.maxHp * 0.08),
    );
  });

  it('counts health actually lost before a reactive heal restores the tank', () => {
    const { sim, source: tank, target: enemy, ctx } = liveCollection('crucible_tank_mail');
    const healerId = sim.addPlayer('priest', 'Healer');
    const hit = Math.ceil(tank.maxHp * 0.4);
    tank.auras.push({
      id: 'test_reactive_heal',
      name: 'Reactive Heal',
      kind: 'heal_echo',
      value: hit,
      value2: 0.9,
      remaining: 10,
      duration: 10,
      sourceId: healerId,
      school: 'holy',
    });
    dealDamage(ctx, enemy, tank, hit, false, 'fire', 'Hit', 'hit');
    expect(tank.hp).toBe(tank.maxHp);
    expect(tank.auras.find((aura) => aura.id.endsWith('_tank_ward'))?.value).toBe(
      Math.round(tank.maxHp * 0.08),
    );
  });
  it('rank-zero armor activates the bonus and actual owner and pet hits gain 8%', () => {
    const { source, target, ctx, sim } = liveCollection('crucible_str_mail');
    expect(source.craftedCollectionId).toBe('crucible_str_mail');
    for (let index = 0; index < 6; index++) {
      dealDamage(ctx, source, target, 100, false, 'physical', 'Strike', 'hit');
      if (index < 5) advance(ctx, 1);
    }
    const before = target.hp;
    dealDamage(ctx, source, target, 100, false, 'physical', 'Strike', 'hit');
    expect(before - target.hp).toBe(108);
    const pet = createMob(9501, MOBS.training_dummy, 20, { ...source.pos });
    pet.ownerId = source.id;
    pet.inCombat = true;
    sim.entities.set(pet.id, pet);
    const beforePet = target.hp;
    dealDamage(ctx, pet, target, 100, false, 'fire', 'Pet Spell', 'hit');
    expect(beforePet - target.hp).toBe(108);
    const beforeCopy = target.hp;
    dealDamage(
      ctx,
      source,
      target,
      100,
      false,
      'fire',
      'Resolved Copy',
      'hit',
      true,
      undefined,
      false,
      false,
      true,
    );
    expect(beforeCopy - target.hp).toBe(100);
  });

  it('real periodic magic damage builds caster charges and expires after combat', () => {
    const { source, target, ctx } = liveCollection('crucible_caster_cloth', 'mage');
    target.auras.push({
      id: 'test_magic_dot',
      name: 'Magic Wound',
      kind: 'dot',
      value: 100,
      tickTimer: 0.05,
      tickInterval: 1,
      remaining: 7,
      duration: 7,
      sourceId: source.id,
      school: 'fire',
    });
    for (let tick = 0; tick < 101; tick++) {
      updateAuras(ctx, target);
      updateAuras(ctx, source);
    }
    expect(source.auras).toContainEqual(expect.objectContaining({ kind: 'buff_dmg_done' }));
    source.inCombat = false;
    updateAuras(ctx, source);
    expect(source.auras.some((aura) => aura.id.startsWith('crafted_collection_'))).toBe(false);
  });

  it('direct and HoT overheal make shields even when a full-health target receives no healing', () => {
    const { sim, source, ctx } = liveCollection('crucible_healer_cloth', 'priest');
    const allyId = sim.addPlayer('warrior', 'Ally');
    sim.setPlayerLevel(20, allyId);
    const ally = sim.entities.get(allyId)!;
    ally.inCombat = true;
    applyHeal(ctx, source, ally, 100, 'Heal', 'heal', false, false);
    expect(ally.auras.find((aura) => aura.id.endsWith('_heal_ward'))?.value).toBe(20);
    ally.auras = [];
    ally.auras.push({
      id: 'renew',
      name: 'Renew',
      kind: 'hot',
      value: 100,
      remaining: 3,
      duration: 3,
      tickInterval: 1,
      tickTimer: 0,
      sourceId: source.id,
      school: 'holy',
    });
    updateAuras(ctx, ally);
    expect(ally.auras.find((aura) => aura.id.endsWith('_heal_ward'))?.value).toBe(20);
  });

  it.each([
    ['mage', 'arcane', 'temporal_echo', 'arcane', null],
    ['priest', 'discipline', 'doctrine', 'holy', 'smite'],
  ] as const)(
    'includes %s conversion healing when weapon procs are disabled',
    (cls, spec, kind, school, abilityId) => {
      const { sim, source, ctx, target } = liveCollection('crucible_healer_cloth', cls);
      source.inCombat = false;
      expect(sim.setSpec(spec)).toBe(true);
      source.inCombat = true;
      const allyId = sim.addPlayer('warrior', 'Ally');
      sim.setPlayerLevel(20, allyId);
      const ally = sim.entities.get(allyId)!;
      ally.inCombat = true;
      // The v0.42 class rebalance scoped Doctrine's conversion recipients to
      // the priest's current party (isCurrentGroupMember /
      // isValidDoctrineRecipient in src/sim/combat/priest/doctrine.ts): an
      // un-partied ally is no longer an eligible link or fallback target.
      // Party the ally so the priest row still exercises live conversion
      // healing; harmless for the mage row, which has no group gate.
      sim.partyInvite(allyId, source.id);
      sim.partyAccept(allyId);
      ally.auras.push({
        id: kind === 'doctrine' ? DOCTRINE_AURA_ID : kind,
        name: kind,
        kind,
        remaining: 15,
        duration: 15,
        value: 0.4,
        sourceId: source.id,
        school: 'holy',
      });
      // Start the ally injured (not full HP) so conversion healing has real
      // room to land as HP before any excess spills into a ward; confirm no
      // ward exists yet so the assertions below prove conversion CREATES it.
      ally.hp = ally.maxHp - 20;
      expect(ally.auras.find((aura) => aura.id.endsWith('_heal_ward'))).toBeUndefined();
      const beforeHp = ally.hp;
      dealDamage(
        ctx,
        source,
        target,
        // Both conversion paths above use a 0.4 rate: 150 damage converts 60
        // healing. 20 of that restores the ally to full HP; the remaining 40
        // excess overheals into a ward at floor(40 * 0.2) = 8.
        150,
        false,
        school,
        'Spell',
        'hit',
        true,
        undefined,
        true,
        false,
        false,
        abilityId,
      );
      expect(ally.hp - beforeHp).toBe(20);
      expect(ally.hp).toBe(ally.maxHp);
      expect(ally.auras.find((aura) => aura.id.endsWith('_heal_ward'))?.value).toBe(8);
    },
  );

  it('caps a rotation-driven Aether Surge/Darts Echo overheal ward at 5% max HP with a fresh expiry', () => {
    // The it.each above always passes abilityId null for the mage/temporal_echo
    // row, so it never engages chronomancy.ts's x4 rotation multiplier
    // (isEchoRotationDriver only fires for arcane_surge/arcane_missiles). This
    // exercises the REAL driver id, which pushes the individual mark's 0.4 rate
    // to 1.6 (ECHO_ROTATION_CONVERSION_MULT), so the resulting overheal is large
    // enough to prove the crafted-collection ward clamps at the collection's 5%
    // max-HP cap rather than scaling unbounded with the rotation-boosted heal.
    // NOTE: this saturating case alone cannot catch a LOST x4 multiplier: even
    // at the un-multiplied 0.4 rate, 10x maxHp damage still overheals past the
    // 5% cap, so the assertions below would pass identically either way. The
    // below-cap tests further down are what actually pin the x4 rate.
    const { sim, source, ctx, target } = liveCollection('crucible_healer_cloth', 'mage');
    const allyId = sim.addPlayer('warrior', 'Ally');
    sim.setPlayerLevel(20, allyId);
    const ally = sim.entities.get(allyId)!;
    ally.inCombat = true;
    sim.partyInvite(allyId, source.id);
    sim.partyAccept(allyId);
    ally.auras.push({
      id: 'temporal_echo',
      name: 'Temporal Echo',
      kind: 'temporal_echo',
      remaining: 15,
      duration: 15,
      value: 0.4,
      echoGroup: false,
      echoConvertRate: 0.4,
      sourceId: source.id,
      school: 'arcane',
    });
    // Nearly full: almost the whole rotation-boosted conversion heal has to
    // spill into overheal rather than real HP.
    ally.hp = ally.maxHp - 1;
    expect(ally.auras.find((aura) => aura.id.endsWith('_heal_ward'))).toBeUndefined();
    dealDamage(
      ctx,
      source,
      target,
      // Deliberately huge relative to maxHp: even with the x4 rotation
      // multiplier converting most of it to healing, the ward must clamp at
      // the collection's cap rather than growing with the hit size.
      ally.maxHp * 10,
      false,
      'arcane',
      'Aether Surge',
      'hit',
      true,
      undefined,
      true,
      false,
      false,
      'arcane_surge',
    );
    expect(ally.hp).toBe(ally.maxHp);
    const ward = ally.auras.find((aura) => aura.id.endsWith('_heal_ward'));
    expect(ward?.value).toBe(Math.floor(ally.maxHp * CRAFTED_OVERHEAL_CAP_FRACTION));
    expect(ward?.remaining).toBe(CRAFTED_WINDOW_SECONDS);
    expect(ward?.duration).toBe(CRAFTED_WINDOW_SECONDS);
  });

  it.each([
    ['arcane_surge', ARCANE_SURGE_ID, 100],
    ['arcane_missiles', 'arcane_missiles', 70],
  ] as const)(
    'converts %s Echo healing at the exact x4 rotation rate, below the overheal cap',
    (_label, abilityId, dealt) => {
      // A damage size deliberately small enough that the resulting ward stays
      // UNDER the collection's 5% max-HP cap: with the x4 rotation multiplier
      // lost, the same dealt amount converts to a materially SMALLER ward
      // (base 0.4 rate instead of 1.6), so this fails loudly on that
      // regression instead of clamping to the same cap either way (contrast
      // the saturating case above).
      const { sim, source, ctx, target } = liveCollection('crucible_healer_cloth', 'mage');
      const allyId = sim.addPlayer('warrior', 'Ally');
      sim.setPlayerLevel(20, allyId);
      const ally = sim.entities.get(allyId)!;
      ally.inCombat = true;
      const baseRate = 0.4;
      ally.auras.push({
        id: 'temporal_echo',
        name: 'Temporal Echo',
        kind: 'temporal_echo',
        remaining: 15,
        duration: 15,
        value: baseRate,
        echoGroup: false,
        echoConvertRate: baseRate,
        sourceId: source.id,
        school: 'arcane',
      });
      const missing = 2;
      ally.hp = ally.maxHp - missing;
      const preClamp = Math.round(dealt * baseRate * ECHO_ROTATION_CONVERSION_MULT);
      const expectedAdded = Math.floor((preClamp - missing) * CRAFTED_OVERHEAL_FRACTION);
      const cap = Math.floor(ally.maxHp * CRAFTED_OVERHEAL_CAP_FRACTION);
      // Confirms the scenario is actually below-cap (would be vacuous otherwise).
      expect(expectedAdded).toBeLessThan(cap);
      dealDamage(
        ctx,
        source,
        target,
        dealt,
        false,
        'arcane',
        'Rotation Hit',
        'hit',
        true,
        undefined,
        true,
        false,
        false,
        abilityId,
      );
      expect(ally.hp).toBe(ally.maxHp);
      const ward = ally.auras.find((aura) => aura.id.endsWith('_heal_ward'));
      expect(ward?.value).toBe(expectedAdded);
      expect(ward?.remaining).toBe(CRAFTED_WINDOW_SECONDS);
    },
  );

  it("does not renew a repeated rotation hit's own ward age, only its banked value", () => {
    // Per crafted_collection_effects.ts onCraftedCollectionHeal: "Additional
    // healing may fill the original reserve, but cannot renew its age." Two
    // Aether Surge casts from the SAME mage, three seconds apart, must leave
    // the ward's countdown at 3 seconds remaining (never reset to a fresh 6),
    // even though the second cast is itself amplified by the x4 rotation rate
    // and banks more value into the same ward.
    const { sim, source, ctx, target } = liveCollection('crucible_healer_cloth', 'mage');
    const allyId = sim.addPlayer('warrior', 'Ally');
    sim.setPlayerLevel(20, allyId);
    const ally = sim.entities.get(allyId)!;
    ally.inCombat = true;
    const baseRate = 0.4;
    ally.auras.push({
      id: 'temporal_echo',
      name: 'Temporal Echo',
      kind: 'temporal_echo',
      remaining: 15,
      duration: 15,
      value: baseRate,
      echoGroup: false,
      echoConvertRate: baseRate,
      sourceId: source.id,
      school: 'arcane',
    });
    const missing = 2;
    ally.hp = ally.maxHp - missing;
    const firstDealt = 100;
    const firstPreClamp = Math.round(firstDealt * baseRate * ECHO_ROTATION_CONVERSION_MULT);
    const firstAdded = Math.floor((firstPreClamp - missing) * CRAFTED_OVERHEAL_FRACTION);
    dealDamage(
      ctx,
      source,
      target,
      firstDealt,
      false,
      'arcane',
      'Aether Surge',
      'hit',
      true,
      undefined,
      true,
      false,
      false,
      ARCANE_SURGE_ID,
    );
    expect(ally.hp).toBe(ally.maxHp);
    expect(ally.auras.find((aura) => aura.id.endsWith('_heal_ward'))).toMatchObject({
      value: firstAdded,
      remaining: CRAFTED_WINDOW_SECONDS,
    });

    advance(ctx, 3);

    const cap = Math.floor(ally.maxHp * CRAFTED_OVERHEAL_CAP_FRACTION);
    const room = cap - firstAdded;
    const secondDealt = 50;
    const secondPreClamp = Math.round(secondDealt * baseRate * ECHO_ROTATION_CONVERSION_MULT);
    const secondAdded = Math.min(Math.floor(secondPreClamp * CRAFTED_OVERHEAL_FRACTION), room);
    // Confirms the second cast really contributes (would be vacuous otherwise).
    expect(secondAdded).toBeGreaterThan(0);
    dealDamage(
      ctx,
      source,
      target,
      secondDealt,
      false,
      'arcane',
      'Aether Surge',
      'hit',
      true,
      undefined,
      true,
      false,
      false,
      ARCANE_SURGE_ID,
    );
    expect(ally.auras.find((aura) => aura.id.endsWith('_heal_ward'))).toMatchObject({
      value: firstAdded + secondAdded,
      remaining: CRAFTED_WINDOW_SECONDS - 3,
    });
  });

  it('includes Temporal Hourglass reserve healing without another healing action', () => {
    const { sim, source, ctx } = liveCollection('crucible_healer_cloth', 'mage');
    const allyId = sim.addPlayer('warrior', 'Ally');
    const ally = sim.entities.get(allyId)!;
    sim.setPlayerLevel(20, allyId);
    ally.inCombat = true;
    const aura: Aura = {
      id: 'temporal_hourglass',
      name: 'Temporal Hourglass',
      kind: 'stasis',
      remaining: 3,
      duration: 3,
      value: 1,
      sourceId: source.id,
      school: 'arcane',
      temporalHealTicksRemaining: 1,
      temporalHealRemaining: 100,
    };
    tickTemporalHourglassHealing(ctx, ally, aura);
    expect(ally.auras.find((active) => active.id.endsWith('_heal_ward'))?.value).toBe(20);
  });

  it('shields absorb real damage, cannot proc talent shield-consumption heals, and obey live set loss', () => {
    const { sim, source, target, ctx, meta } = liveCollection('crucible_healer_cloth', 'priest');
    const allyId = sim.addPlayer('warrior', 'Ally');
    sim.setPlayerLevel(20, allyId);
    const ally = sim.entities.get(allyId)!;
    ally.inCombat = true;
    onCraftedCollectionHeal(ctx, source, ally, 100);
    const consumed = vi.spyOn(talentProcs, 'onShieldConsumed');
    const hpBefore = ally.hp;
    dealDamage(ctx, target, ally, 50, false, 'fire', 'Hit', 'hit');
    expect(hpBefore - ally.hp).toBe(30);
    expect(consumed).not.toHaveBeenCalled();
    onCraftedCollectionHeal(ctx, source, ally, 100);
    delete meta.equipment.chest;
    recalcPlayerStats(source, 'priest', meta.equipment, meta.talentMods, meta.equipmentInstance);
    const afterUnequip = ally.hp;
    dealDamage(ctx, target, ally, 50, false, 'fire', 'Hit', 'hit');
    expect(afterUnequip - ally.hp).toBe(50);
    consumed.mockRestore();
  });

  it('keeps source text pinned to the tested mechanic magnitudes', () => {
    expect(CRUCIBLE_SIGNATURE_TEXT.physical).toContain('6 charges');
    expect(CRUCIBLE_SIGNATURE_TEXT.physical).toContain('8% more damage for 6 sec');
    expect(CRUCIBLE_SIGNATURE_TEXT.caster).toContain('including damage over time');
    expect(CRUCIBLE_SIGNATURE_TEXT.tank).toContain('40%');
    expect(CRUCIBLE_SIGNATURE_TEXT.tank).toContain('8%');
    expect(CRUCIBLE_SIGNATURE_TEXT.healer).toContain('20%');
    expect(CRUCIBLE_SIGNATURE_TEXT.healer).toContain('5%');
  });
});

describe('crafted collection overheal protection', () => {
  it.each([1000, 2000])('scales the total protection cap with %i maximum health', (maxHp) => {
    const healer = wearer(1, 'crucible_healer_cloth');
    const ally = wearer(2, '');
    ally.maxHp = ally.hp = maxHp;
    const { ctx } = harness(healer, ally);
    onCraftedCollectionHeal(ctx, healer, ally, 1000);
    expect(ally.auras[0]?.value).toBe(maxHp * 0.05);
  });

  it('revalidates the cap after a recipient maximum-health reduction', () => {
    const healer = wearer(1, 'crucible_healer_cloth');
    const ally = wearer(2, '');
    const { ctx } = harness(healer, ally);
    onCraftedCollectionHeal(ctx, healer, ally, 1000);
    ally.maxHp = 400;
    cleanupCraftedCollectionAuras(ctx, ally);
    expect(ally.auras.reduce((sum, aura) => sum + aura.value, 0)).toBe(20);
  });
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
    ally.inCombat = false;
    onCraftedCollectionHeal(ctx, healer, ally, 1000);
    expect(ally.auras).toHaveLength(0);
    ally.inCombat = true;
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
      id: 'old_ward',
      name: 'Old Ward',
      kind: 'absorb',
      value: 30,
      remaining: 10,
      duration: 10,
      sourceId: source.id,
      school: 'holy',
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
