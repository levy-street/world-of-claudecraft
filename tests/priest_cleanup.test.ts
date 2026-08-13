import { describe, expect, it } from 'vitest';
import { summonGuardian } from '../src/sim/combat/guardians';
import { placeDoctrineLink } from '../src/sim/combat/priest/doctrine';
import { addGloomtithe, bindEffigy, vespersOnEntityDeath } from '../src/sim/combat/priest/vespers';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Aura, Entity } from '../src/sim/types';

function ctxOf(sim: Sim): SimContext {
  return (sim as unknown as { ctx: SimContext }).ctx;
}

function setup(): { sim: Sim; priest: Entity; ctx: SimContext } {
  const sim = new Sim({ seed: 2920, playerClass: 'priest', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.setSpec('discipline')).toBe(true);
  sim.tick();
  return { sim, priest: sim.player, ctx: ctxOf(sim) };
}

function addAlly(sim: Sim): Entity {
  const id = sim.addPlayer('warrior', 'Cleanup Ally');
  sim.setPlayerLevel(20, id);
  const ally = sim.entities.get(id);
  if (!ally) throw new Error('ally missing');
  return ally;
}

function addMob(sim: Sim, id: number, z: number): Entity {
  const mob = createMob(id, MOBS.training_dummy, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + z,
  });
  mob.hostile = true;
  mob.maxHp = mob.hp = 100000;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  return mob;
}

function dirge(priestId: number): Aura {
  return {
    id: 'shadow_word_pain',
    name: 'Dirge of Decay',
    kind: 'dot',
    remaining: 18,
    duration: 18,
    value: 10,
    tickInterval: 3,
    tickTimer: 3,
    sourceId: priestId,
    school: 'shadow',
  };
}

function seedTransientState(
  sim: Sim,
  priest: Entity,
  ctx: SimContext,
): { ally: Entity; mob: Entity } {
  const ally = addAlly(sim);
  const mob = addMob(sim, 9970, 8);
  placeDoctrineLink(ctx, priest, ally);
  ally.auras.push({
    id: 'seraphic_vigil',
    name: 'Seraphic Vigil',
    kind: 'heal_echo',
    remaining: 30,
    duration: 30,
    value: 180,
    value2: 0.35,
    sourceId: priest.id,
    school: 'holy',
  });
  ally.auras.push({
    id: 'priest_second_verse_holy_nova_0',
    name: 'Sunburst Canticle',
    kind: 'hot',
    remaining: 2,
    duration: 2,
    value: 40,
    tickInterval: 2,
    tickTimer: 2,
    sourceId: priest.id,
    school: 'holy',
  });
  ally.auras.push({
    id: 'priest_living_covenant',
    name: 'Living Covenant',
    kind: 'absorb',
    remaining: 10,
    duration: 10,
    value: 40,
    sourceId: priest.id,
    school: 'holy',
  });
  mob.auras.push(dirge(priest.id));
  bindEffigy(ctx, priest, mob);
  priest.auras.push({
    id: 'priest_gloomtithe',
    name: 'Gloomtithe',
    kind: 'gloomtithe',
    remaining: 15,
    duration: 15,
    value: 0,
    stacks: 3,
    sourceId: priest.id,
    school: 'shadow',
  });
  summonGuardian(ctx, priest, {
    key: 'tithefiend',
    name: 'Tithefiend',
    color: 0x6c258a,
    scale: 0.82,
    remaining: 10,
    attackInterval: 2,
    minDamage: 20,
    maxDamage: 24,
    school: 'shadow',
    abilityId: 'tithefiend_strike',
    abilityName: 'Tithefiend Strike',
    preferredTargetId: mob.id,
    maxRange: 35,
  });
  return { ally, mob };
}

function expectCleared(sim: Sim, priest: Entity, ally: Entity, mob: Entity): void {
  expect(
    ally.auras.some((aura) => aura.sourceId === priest.id && aura.id === 'priest_doctrine'),
  ).toBe(false);
  expect(
    ally.auras.some((aura) => aura.sourceId === priest.id && aura.id === 'seraphic_vigil'),
  ).toBe(false);
  expect(
    ally.auras.some((aura) => aura.sourceId === priest.id && aura.id.startsWith('priest_')),
  ).toBe(false);
  expect(mob.auras.some((aura) => aura.sourceId === priest.id && aura.id === 'priest_effigy')).toBe(
    false,
  );
  expect(priest.auras.some((aura) => aura.kind === 'gloomtithe')).toBe(false);
  expect(
    [...sim.entities.values()].some(
      (entity) => entity.ownerId === priest.id && entity.guardianState,
    ),
  ).toBe(false);
}

describe('Priest transient lifecycle', () => {
  it('clears source-owned relationships and guardians on spec change', () => {
    const { sim, priest, ctx } = setup();
    const { ally, mob } = seedTransientState(sim, priest, ctx);
    expect(sim.setSpec('holy')).toBe(true);
    expectCleared(sim, priest, ally, mob);
  });

  it('clears expanded Twin Covenant state when the talent changes in the same spec', () => {
    const { sim, priest, ctx } = setup();
    expect(sim.applyTalents({ spec: 'discipline', rows: { 20: 'pri_r20_twin_covenant' } })).toBe(
      true,
    );
    const first = addAlly(sim);
    const secondId = sim.addPlayer('warrior', 'Cleanup Second Ally');
    sim.setPlayerLevel(20, secondId);
    const second = sim.entities.get(secondId);
    if (!second) throw new Error('second ally missing');
    placeDoctrineLink(ctx, priest, first);
    placeDoctrineLink(ctx, priest, second);
    expect(
      [first, second].filter((ally) =>
        ally.auras.some((aura) => aura.id === 'priest_doctrine' && aura.sourceId === priest.id),
      ),
    ).toHaveLength(2);

    expect(sim.applyTalents({ spec: 'discipline', rows: { 20: 'pri_r20_second_verse' } })).toBe(
      true,
    );

    expect(
      [first, second].filter((ally) =>
        ally.auras.some((aura) => aura.id === 'priest_doctrine' && aura.sourceId === priest.id),
      ),
    ).toHaveLength(0);
  });

  it('clears the same state during full disconnect preparation', () => {
    const { sim, priest, ctx } = setup();
    const { ally, mob } = seedTransientState(sim, priest, ctx);
    sim.preparePlayerLeave(priest.id);
    expectCleared(sim, priest, ally, mob);
  });

  it('clears the same state on priest death', () => {
    const { sim, priest, ctx } = setup();
    const { ally, mob } = seedTransientState(sim, priest, ctx);

    (
      sim as unknown as {
        dealDamage(
          source: Entity | null,
          target: Entity,
          amount: number,
          crit: boolean,
          school: string,
          ability: string,
          kind: 'hit',
        ): void;
      }
    ).dealDamage(mob, priest, priest.maxHp * 2, false, 'shadow', 'Cleanup Test', 'hit');

    expect(priest.dead).toBe(true);
    expectCleared(sim, priest, ally, mob);
  });

  it('persists the selected spec but never reconnects transient Priest relationships', () => {
    const { sim, priest, ctx } = setup();
    seedTransientState(sim, priest, ctx);
    const state = sim.serializeCharacter(priest.id);
    if (!state) throw new Error('priest state missing');

    sim.preparePlayerLeave(priest.id);
    const reconnected = new Sim({ seed: 2921, playerClass: 'priest', noPlayer: true });
    const reconnectedId = reconnected.addPlayer('priest', 'Reconnected Priest', { state });
    const loaded = reconnected.entities.get(reconnectedId);
    if (!loaded) throw new Error('reconnected priest missing');

    expect(reconnected.meta(reconnectedId)?.talents.spec).toBe('discipline');
    expect(loaded.auras.some((aura) => aura.kind === 'gloomtithe')).toBe(false);
    expect(
      [...reconnected.entities.values()].some(
        (entity) => entity.ownerId === reconnectedId && entity.guardianState,
      ),
    ).toBe(false);
  });

  it('transfers a dying Effigy to the nearest own-Dirge target by distance then id', () => {
    const { sim, priest, ctx } = setup();
    expect(sim.setSpec('shadow')).toBe(true);
    const dying = addMob(sim, 9980, 8);
    const lowerIdTie = addMob(sim, 9981, 10);
    const higherIdTie = addMob(sim, 9982, 10);
    for (const mob of [dying, lowerIdTie, higherIdTie]) mob.auras.push(dirge(priest.id));
    bindEffigy(ctx, priest, dying);

    vespersOnEntityDeath(ctx, dying);

    expect(lowerIdTie.auras.some((aura) => aura.id === 'priest_effigy')).toBe(true);
    expect(higherIdTie.auras.some((aura) => aura.id === 'priest_effigy')).toBe(false);
  });

  it('clears a dead final Effigy while preserving the Gloomtithe grace bank', () => {
    const { sim, priest, ctx } = setup();
    expect(sim.setSpec('shadow')).toBe(true);
    const dying = addMob(sim, 9983, 8);
    dying.auras.push(dirge(priest.id));
    bindEffigy(ctx, priest, dying);
    addGloomtithe(ctx, priest, 3);

    (
      sim as unknown as {
        dealDamage(
          source: Entity | null,
          target: Entity,
          amount: number,
          crit: boolean,
          school: string,
          ability: string,
          kind: 'hit',
        ): void;
      }
    ).dealDamage(priest, dying, dying.maxHp * 2, false, 'holy', 'Cleanup Test', 'hit');

    expect(dying.dead).toBe(true);
    expect(
      [...sim.entities.values()].some((entity) =>
        entity.auras.some(
          (effect) => effect.id === 'priest_effigy' && effect.sourceId === priest.id,
        ),
      ),
    ).toBe(false);
    expect(priest.auras.find((aura) => aura.kind === 'gloomtithe')?.stacks).toBe(3);
  });
});
