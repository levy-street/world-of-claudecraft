import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import { ITEMS } from '../src/sim/data';
import { createGroundObject } from '../src/sim/entity';
import { runDespawnDecay } from '../src/sim/entity_roster';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import {
  SOUL_STONE_ITEM_ID,
  SOUL_STONE_MAX,
  SOULWELL_DURATION,
  SOULWELL_FOOTPRINT_RADIUS,
  SOULWELL_OBJECT_ITEM_ID,
  summonSoulwell,
} from '../src/sim/soulwell';
import type { Entity } from '../src/sim/types';

function ctx(sim: Sim): SimContext {
  return (sim as unknown as { ctx: SimContext }).ctx;
}

function entity(sim: Sim, id: number): Entity {
  const found = sim.entities.get(id);
  if (!found) throw new Error(`Missing test entity ${id}`);
  return found;
}

function summon(sim: Sim, owner: Entity): Entity {
  const well = summonSoulwell(ctx(sim), owner, SOULWELL_DURATION);
  if (!well) throw new Error('Missing test Soulwell');
  return well;
}

function world(): {
  sim: Sim;
  ownerId: number;
  allyId: number;
  strangerId: number;
  owner: Entity;
  ally: Entity;
} {
  const sim = new Sim({ seed: 83, playerClass: 'warlock', noPlayer: true });
  const ownerId = sim.addPlayer('warlock', 'Wellkeeper');
  const allyId = sim.addPlayer('warrior', 'Companion');
  const strangerId = sim.addPlayer('mage', 'Stranger');
  sim.setPlayerLevel(8, ownerId);
  sim.partyInvite(allyId, ownerId);
  sim.partyAccept(allyId);
  const owner = entity(sim, ownerId);
  const ally = entity(sim, allyId);
  owner.resource = owner.maxResource;
  return { sim, ownerId, allyId, strangerId, owner, ally };
}

function finishCast(sim: Sim, caster: Entity): void {
  for (let i = 0; i < 20 * 5 && caster.castingAbility; i++) sim.tick();
}

function liveWells(sim: Sim): Entity[] {
  return [...sim.entities.values()].filter(
    (entity) => entity.kind === 'object' && entity.objectItemId === SOULWELL_OBJECT_ITEM_ID,
  );
}

describe('Warlock Soulwell', () => {
  it('is a level-8 class utility with the authored duration and stone contract', () => {
    expect(abilitiesKnownAt('warlock', 7).some(({ def }) => def.id === 'soulwell')).toBe(false);
    expect(abilitiesKnownAt('warlock', 8).some(({ def }) => def.id === 'soulwell')).toBe(true);
    expect(ABILITIES.soulwell).toMatchObject({
      class: 'warlock',
      castTime: 3,
      cooldown: 300,
      requiresOutOfCombat: true,
      effects: [{ type: 'summonSoulwell', duration: SOULWELL_DURATION }],
    });
    expect(ABILITIES.soulwell.description).toContain('While outside combat');
    expect(ITEMS[SOUL_STONE_ITEM_ID]).toMatchObject({
      kind: 'potion',
      stackSize: SOUL_STONE_MAX,
      potionHpPctMax: 0.25,
      soulbound: true,
      noMarketList: true,
    });
  });

  it('casts a temporary well and replaces the same Warlock previous well', () => {
    const { sim, ownerId, allyId, owner } = world();
    sim.castAbility('soulwell', ownerId);
    finishCast(sim, owner);

    const first = liveWells(sim);
    expect(first).toHaveLength(1);
    expect(first[0].soulwell).toEqual({
      ownerId,
      eligiblePlayerIds: [ownerId, allyId],
      wardAbsorbPctMax: 0,
      wardedPlayerIds: [],
    });
    expect(first[0].despawnTimer).toBeGreaterThan(179);
    expect(
      isBlocked(ctx(sim).cfg.seed, first[0].pos.x, first[0].pos.z, SOULWELL_FOOTPRINT_RADIUS),
    ).toBe(false);

    const replacement = summon(sim, owner);
    expect(liveWells(sim)).toEqual([replacement]);
    expect(sim.entities.has(first[0].id)).toBe(false);
  });

  it('refills each group member to three while active and rejects outsiders', () => {
    const { sim, owner, ownerId, allyId, strangerId } = world();
    const well = summon(sim, owner);

    expect(sim.pickUpObject(well.id, allyId)).toBe(true);
    expect(sim.countItem(SOUL_STONE_ITEM_ID, allyId)).toBe(3);
    expect(entity(sim, allyId).auras.some((aura) => aura.id === 'soulwell')).toBe(false);

    // A consumed stone can be replenished while this well remains active.
    const ally = entity(sim, allyId);
    ally.hp = Math.floor(ally.maxHp / 2);
    sim.useItem(SOUL_STONE_ITEM_ID, allyId);
    expect(sim.countItem(SOUL_STONE_ITEM_ID, allyId)).toBe(2);
    expect(sim.pickUpObject(well.id, allyId)).toBe(true);
    expect(sim.countItem(SOUL_STONE_ITEM_ID, allyId)).toBe(3);

    // The owner has an independent claim.
    expect(sim.pickUpObject(well.id, ownerId)).toBe(true);
    expect(sim.countItem(SOUL_STONE_ITEM_ID, ownerId)).toBe(3);

    // A nearby player outside the owner's group cannot take any.
    expect(sim.pickUpObject(well.id, strangerId)).toBe(true);
    expect(sim.countItem(SOUL_STONE_ITEM_ID, strangerId)).toBe(0);
  });

  it('keeps the summoned group roster eligible after the owner disconnects', () => {
    const { sim, owner, ownerId, allyId } = world();
    const well = summon(sim, owner);

    sim.removePlayer(ownerId);

    expect(sim.entities.has(well.id)).toBe(true);
    expect(sim.pickUpObject(well.id, allyId)).toBe(true);
    expect(sim.countItem(SOUL_STONE_ITEM_ID, allyId)).toBe(3);
  });

  it('grants the 15% Deep Hunger ward once per eligible player and well', () => {
    const { sim, owner, ownerId, allyId, ally } = world();
    sim.setPlayerLevel(11, ownerId);
    expect(
      sim.applyTalents({ spec: 'demonology', rows: { 11: 'wlk_r11_demon_armor' } }, ownerId),
    ).toBe(true);
    const well = summon(sim, owner);

    expect(well.soulwell).toMatchObject({
      wardAbsorbPctMax: 0.15,
      wardedPlayerIds: [],
    });

    sim.removePlayer(ownerId);
    expect(sim.entities.has(well.id)).toBe(true);
    sim.pickUpObject(well.id, allyId);
    const ward = ally.auras.find((aura) => aura.id === 'soulwell');
    expect(ward).toMatchObject({
      name: 'Soulwell',
      kind: 'absorb',
      value: Math.round(ally.maxHp * 0.15),
      remaining: 30,
      duration: 30,
      sourceId: ownerId,
      school: 'shadow',
    });
    expect(well.soulwell?.wardedPlayerIds).toEqual([allyId]);

    if (!ward) throw new Error('Missing Deep Hunger Soulwell ward');
    ward.remaining = 7;
    sim.pickUpObject(well.id, allyId);
    expect(ally.auras.find((aura) => aura.id === 'soulwell')).toBe(ward);
    expect(ward.remaining).toBe(7);
    expect(well.soulwell?.wardedPlayerIds).toEqual([allyId]);
  });

  it('grants neither stones nor a Deep Hunger ward while the player is in combat', () => {
    const { sim, owner, ownerId, allyId, ally } = world();
    sim.setPlayerLevel(11, ownerId);
    expect(
      sim.applyTalents({ spec: 'demonology', rows: { 11: 'wlk_r11_demon_armor' } }, ownerId),
    ).toBe(true);
    const well = summon(sim, owner);
    ally.inCombat = true;

    expect(sim.pickUpObject(well.id, allyId)).toBe(true);
    expect(sim.countItem(SOUL_STONE_ITEM_ID, allyId)).toBe(0);
    expect(ally.auras.some((aura) => aura.id === 'soulwell')).toBe(false);
    expect(well.soulwell?.wardedPlayerIds).toEqual([]);

    ally.inCombat = false;
    expect(sim.pickUpObject(well.id, allyId)).toBe(true);
    expect(sim.countItem(SOUL_STONE_ITEM_ID, allyId)).toBe(3);
    expect(ally.auras.some((aura) => aura.id === 'soulwell')).toBe(true);
    expect(well.soulwell?.wardedPlayerIds).toEqual([allyId]);
  });

  it('fills only to three and lets a capped player refill after using a stone', () => {
    const partial = world();
    partial.sim.addItem(SOUL_STONE_ITEM_ID, 2, partial.allyId);
    const partialWell = summon(partial.sim, partial.owner);

    partial.sim.pickUpObject(partialWell.id, partial.allyId);
    expect(partial.sim.countItem(SOUL_STONE_ITEM_ID, partial.allyId)).toBe(3);

    const capped = world();
    capped.sim.addItem(SOUL_STONE_ITEM_ID, 3, capped.allyId);
    const cappedWell = summon(capped.sim, capped.owner);

    capped.sim.pickUpObject(cappedWell.id, capped.allyId);
    expect(capped.sim.countItem(SOUL_STONE_ITEM_ID, capped.allyId)).toBe(3);
    capped.ally.hp = Math.floor(capped.ally.maxHp / 2);
    capped.sim.useItem(SOUL_STONE_ITEM_ID, capped.allyId);
    expect(capped.sim.countItem(SOUL_STONE_ITEM_ID, capped.allyId)).toBe(2);

    capped.sim.pickUpObject(cappedWell.id, capped.allyId);
    expect(capped.sim.countItem(SOUL_STONE_ITEM_ID, capped.allyId)).toBe(3);
  });

  it('despawns after three minutes', () => {
    const { sim, owner } = world();
    const well = summon(sim, owner);

    for (let i = 0; i < 20 * 179; i++) runDespawnDecay(ctx(sim));
    expect(sim.entities.has(well.id)).toBe(true);

    for (let i = 0; i < 21; i++) runDespawnDecay(ctx(sim));
    expect(sim.entities.has(well.id)).toBe(false);
  });

  it('restores 25% maximum health, consumes one stone, and shares the potion cooldown', () => {
    const { sim, allyId, ally } = world();
    sim.addItem(SOUL_STONE_ITEM_ID, 3, allyId);
    sim.addItem('minor_healing_potion', 1, allyId);
    ally.hp = Math.floor(ally.maxHp * 0.4);
    const before = ally.hp;

    sim.useItem(SOUL_STONE_ITEM_ID, allyId);

    expect(ally.hp - before).toBe(Math.round(ally.maxHp * 0.25));
    expect(sim.countItem(SOUL_STONE_ITEM_ID, allyId)).toBe(2);
    expect(ally.potionCdRemaining).toBe(120);

    const afterStone = ally.hp;
    sim.useItem('minor_healing_potion', allyId);
    expect(sim.countItem('minor_healing_potion', allyId)).toBe(1);
    expect(ally.hp).toBe(afterStone);

    const reverse = world();
    reverse.sim.addItem(SOUL_STONE_ITEM_ID, 3, reverse.allyId);
    reverse.sim.addItem('minor_healing_potion', 1, reverse.allyId);
    reverse.ally.hp = Math.floor(reverse.ally.maxHp * 0.25);
    reverse.sim.useItem('minor_healing_potion', reverse.allyId);
    const afterPotion = reverse.ally.hp;

    reverse.sim.useItem(SOUL_STONE_ITEM_ID, reverse.allyId);
    expect(reverse.sim.countItem(SOUL_STONE_ITEM_ID, reverse.allyId)).toBe(3);
    expect(reverse.ally.hp).toBe(afterPotion);
  });

  it('deterministically avoids an object occupying the preferred spawn point', () => {
    const run = (): { x: number; z: number; blockerDistance: number } => {
      const { sim, owner } = world();
      owner.pos = sim.groundPos(40, 0);
      owner.prevPos = { ...owner.pos };
      owner.facing = 0;
      const simCtx = ctx(sim);
      const blocker = createGroundObject(
        simCtx.nextId++,
        'wolf_fang',
        'Placement blocker',
        sim.groundPos(40, 2.6),
      );
      simCtx.addEntity(blocker);

      const well = summon(sim, owner);
      expect(isBlocked(simCtx.cfg.seed, well.pos.x, well.pos.z, SOULWELL_FOOTPRINT_RADIUS)).toBe(
        false,
      );
      return {
        x: well.pos.x,
        z: well.pos.z,
        blockerDistance: Math.hypot(well.pos.x - blocker.pos.x, well.pos.z - blocker.pos.z),
      };
    };

    const first = run();
    expect(first.blockerDistance).toBeGreaterThanOrEqual(SOULWELL_FOOTPRINT_RADIUS + 0.8);
    expect(run()).toEqual(first);
  });

  it('refuses summoning in combat before paying mana or creating an object', () => {
    const { sim, ownerId, owner } = world();
    owner.inCombat = true;
    const mana = owner.resource;

    sim.castAbility('soulwell', ownerId);

    expect(owner.resource).toBe(mana);
    expect(liveWells(sim)).toEqual([]);
  });
});
