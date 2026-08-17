import { describe, expect, it, vi } from 'vitest';
import {
  PACK_FEROCITY_AURA_ID,
  packlordActionGlowActive,
  STAMPEDE_GUARDIAN_KEY_PREFIX,
  STAMPEDE_READY_AURA_ID,
} from '../src/sim/combat/hunter_packlord';
import { PRIMAL_MASTERY_INSTANT_ID } from '../src/sim/combat/shaman_thundercall';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers, emptyAllocation } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, PlayerClass, SimEvent } from '../src/sim/types';
import { abilityEffectText } from '../src/ui/hud';

type TestSim = Sim & {
  addEntity(entity: Entity): void;
  nextId: number;
};

function knownAt(playerClass: PlayerClass, spec: string): Set<string> {
  const mods = computeTalentModifiers(playerClass, { ...emptyAllocation(), spec }, 20);
  return new Set(abilitiesKnownAt(playerClass, 20, mods).map((ability) => ability.def.id));
}

function advance(sim: Sim, seconds: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let tick = 0; tick < seconds * 20; tick++) events.push(...sim.tick());
  return events;
}

function place(sim: Sim, entity: Entity, x: number, z: number): void {
  entity.pos = sim.groundPos(x, z);
  entity.prevPos = { ...entity.pos };
  (sim as unknown as { rebucket(entity: Entity): void }).rebucket(entity);
}

function addTarget(sim: TestSim, id: number, x: number, z: number): Entity {
  const target = createMob(id, MOBS.training_dummy, 20, sim.groundPos(x, z));
  target.hostile = true;
  target.hp = target.maxHp = 1_000_000;
  sim.addEntity(target);
  return target;
}

function addHunterPet(sim: TestSim): Entity {
  const pet = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x + 1,
    y: sim.player.pos.y,
    z: sim.player.pos.z + 2,
  });
  pet.hostile = false;
  pet.ownerId = sim.playerId;
  pet.hp = pet.maxHp = 1_000;
  sim.addEntity(pet);
  return pet;
}

function seedFerocity(hunter: Entity, stacks: number): void {
  hunter.auras.push({
    id: PACK_FEROCITY_AURA_ID,
    name: 'Pack Ferocity',
    kind: 'hunter_ferocity',
    remaining: 30,
    duration: 30,
    value: stacks,
    stacks,
    sourceId: hunter.id,
    school: 'physical',
  });
}

function killAt(entity: Entity, x: number, z: number): void {
  entity.pos = { x, y: entity.pos.y, z };
  entity.prevPos = { ...entity.pos };
  entity.dead = true;
  entity.ghost = false;
  entity.corpsePos = { ...entity.pos };
  entity.hp = 0;
  entity.resource = 0;
}

describe('approved Packlord follow-up', () => {
  it('grants Stampede only to Packlord and defines the approved twelve-second cooldown', () => {
    expect(knownAt('hunter', 'beast_mastery')).toContain('stampede');
    expect(knownAt('hunter', 'marksmanship')).not.toContain('stampede');
    expect(knownAt('hunter', 'survival')).not.toContain('stampede');
    expect(ABILITIES.stampede).toMatchObject({
      class: 'hunter',
      specs: ['beast_mastery'],
      learnLevel: 17,
      cooldown: 90,
      requiresTarget: true,
    });
    expect(ABILITIES.stampede.effects).toContainEqual(
      expect.objectContaining({
        type: 'hunterStampede',
        beasts: 3,
        duration: 12,
        attackInterval: 2,
      }),
    );
  });

  it('summons three beasts whose damage snapshots Pack Ferocity and is attributed to the Hunter', () => {
    const sim = new Sim({ seed: 2918, playerClass: 'hunter', autoEquip: true }) as TestSim;
    sim.setPlayerLevel(20);
    expect(sim.setSpec('beast_mastery')).toBe(true);
    place(sim, sim.player, 700, 0);
    const target = addTarget(sim, sim.nextId++, 700, 8);
    addHunterPet(sim);
    sim.targetEntity(target.id);
    seedFerocity(sim.player, 3);

    sim.castAbility('stampede');
    const guardians = [...sim.entities.values()].filter((entity) =>
      entity.guardianState?.key.startsWith(STAMPEDE_GUARDIAN_KEY_PREFIX),
    );
    expect(guardians).toHaveLength(3);
    expect(guardians.every((guardian) => guardian.ownerId === sim.playerId)).toBe(true);
    const snapshottedDamage = guardians.map((guardian) => ({
      min: guardian.guardianState?.minDamage,
      max: guardian.guardianState?.maxDamage,
    }));
    const stampede = sim.resolvedAbility('stampede');
    if (!stampede) throw new Error('missing Stampede');
    const displayed = abilityEffectText(stampede, {
      spellPower: 0,
      rangedPower: sim.player.rangedPower,
      attackPower: 0,
    });
    expect(displayed).toContain(`(+${Math.round(sim.player.rangedPower * 0.08)})`);
    const expectedMinimum = Math.round((18 + sim.player.rangedPower * 0.08) * 1.25 * 1.3);
    expect(guardians[0].guardianState?.minDamage).toBe(expectedMinimum);

    sim.player.auras = sim.player.auras.filter((aura) => aura.id !== PACK_FEROCITY_AURA_ID);
    expect(
      guardians.map((guardian) => ({
        min: guardian.guardianState?.minDamage,
        max: guardian.guardianState?.maxDamage,
      })),
    ).toEqual(snapshottedDamage);

    const events = advance(sim, 12);
    const guardianIds = new Set(guardians.map((guardian) => guardian.id));
    const hits = events.filter(
      (event) =>
        event.type === 'damage' &&
        guardianIds.has(event.sourceId) &&
        event.targetId === target.id &&
        event.ability === 'Stampede',
    );
    expect(hits).toHaveLength(18);
  });

  it('resets Stampede after five failed eligible proc rolls, but never while its beasts are active', () => {
    const sim = new Sim({ seed: 2919, playerClass: 'hunter', autoEquip: true }) as TestSim;
    sim.setPlayerLevel(20);
    expect(sim.setSpec('beast_mastery')).toBe(true);
    const target = addTarget(sim, sim.nextId++, sim.player.pos.x, sim.player.pos.z + 3);
    addHunterPet(sim);
    sim.targetEntity(target.id);
    vi.spyOn(sim.ctx.rng, 'chance').mockReturnValue(false);

    sim.castAbility('stampede');
    sim.player.auras = sim.player.auras.filter((aura) => aura.id !== PACK_FEROCITY_AURA_ID);
    sim.player.gcdRemaining = 0;
    sim.player.cooldowns.delete('pack_command');
    sim.castAbility('pack_command');
    advance(sim, 0.1);
    expect(sim.player.cooldowns.get('stampede')).toBeGreaterThan(0);
    expect(sim.player.auras.some((aura) => aura.id === STAMPEDE_READY_AURA_ID)).toBe(false);

    advance(sim, 12);
    for (let attempt = 1; attempt <= 5; attempt++) {
      sim.player.auras = sim.player.auras.filter((aura) => aura.id !== PACK_FEROCITY_AURA_ID);
      sim.player.gcdRemaining = 0;
      sim.player.cooldowns.delete('pack_command');
      sim.castAbility('pack_command');
      advance(sim, 0.1);
      expect(sim.player.cooldowns.has('stampede')).toBe(attempt < 5);
    }
    expect(sim.player.auras.some((aura) => aura.id === STAMPEDE_READY_AURA_ID)).toBe(true);
    expect(packlordActionGlowActive(sim.player.auras, 'stampede')).toBe(true);
  });

  it('clears Stampede beasts and reset state when the Hunter leaves Packlord', () => {
    const sim = new Sim({ seed: 2923, playerClass: 'hunter', autoEquip: true }) as TestSim;
    sim.setPlayerLevel(20);
    expect(sim.setSpec('beast_mastery')).toBe(true);
    const target = addTarget(sim, sim.nextId++, sim.player.pos.x, sim.player.pos.z + 3);
    addHunterPet(sim);
    sim.targetEntity(target.id);
    seedFerocity(sim.player, 3);

    sim.castAbility('stampede');
    sim.player.auras.push({
      id: STAMPEDE_READY_AURA_ID,
      name: 'Stampede Ready',
      kind: 'internal_cd',
      remaining: 30,
      duration: 30,
      value: 1,
      sourceId: sim.playerId,
      school: 'physical',
    });
    expect(
      [...sim.entities.values()].filter((entity) =>
        entity.guardianState?.key.startsWith(STAMPEDE_GUARDIAN_KEY_PREFIX),
      ),
    ).toHaveLength(3);

    expect(sim.setSpec('marksmanship')).toBe(true);
    expect(
      [...sim.entities.values()].filter((entity) =>
        entity.guardianState?.key.startsWith(STAMPEDE_GUARDIAN_KEY_PREFIX),
      ),
    ).toHaveLength(0);
    expect(sim.player.auras.some((aura) => aura.id === STAMPEDE_READY_AURA_ID)).toBe(false);
  });
});

describe('approved Thundercall Chain Lightning follow-up', () => {
  it('grants Skybranch only to Thundercall and lets Primal Mastery make it instant', () => {
    expect(knownAt('shaman', 'elemental')).toContain('chain_lightning');
    expect(knownAt('shaman', 'enhancement')).not.toContain('chain_lightning');
    expect(knownAt('shaman', 'restoration')).not.toContain('chain_lightning');
    expect(ABILITIES.chain_lightning).toMatchObject({
      specs: ['elemental'],
      learnLevel: 14,
      castTime: 2.5,
      cooldown: 6,
      requiresTarget: true,
    });
    const chain = abilitiesKnownAt(
      'shaman',
      20,
      computeTalentModifiers('shaman', { ...emptyAllocation(), spec: 'elemental' }),
    ).find((ability) => ability.def.id === 'chain_lightning');
    if (!chain) throw new Error('missing Skybranch');
    // v0.36 composition re-pin: Earthen Fury mastery now applies whole-hit per
    // the composed talent scaling, raising the zero-power band.
    expect(abilityEffectText(chain, { spellPower: 0, rangedPower: 0, attackPower: 0 })).toBe(
      '60 to 69',
    );
    expect(abilityEffectText(chain, { spellPower: 100, rangedPower: 0, attackPower: 0 })).not.toBe(
      '60 to 69',
    );

    const sim = new Sim({ seed: 2920, playerClass: 'shaman' });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('elemental')).toBe(true);
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('elemental_mastery');
    expect(
      sim.player.auras.find((aura) => aura.id === PRIMAL_MASTERY_INSTANT_ID)?.empowerAbilities,
    ).toEqual(['lightning_bolt', 'chain_lightning']);
  });

  it('hits at most three enemies and grants one Thunder for the whole cast', () => {
    const sim = new Sim({ seed: 2921, playerClass: 'shaman', autoEquip: true }) as TestSim;
    sim.setPlayerLevel(20);
    expect(sim.setSpec('elemental')).toBe(true);
    place(sim, sim.player, 700, 0);
    const targets = [
      addTarget(sim, sim.nextId++, 700, 10),
      addTarget(sim, sim.nextId++, 704, 12),
      addTarget(sim, sim.nextId++, 708, 12),
      addTarget(sim, sim.nextId++, 712, 12),
    ];
    sim.targetEntity(targets[0].id);
    sim.player.resource = sim.player.maxResource;

    sim.castAbility('chain_lightning');
    const events = advance(sim, 4);
    const hits = events.filter(
      (event) =>
        event.type === 'damage' &&
        event.sourceId === sim.playerId &&
        event.ability === 'Skybranch' &&
        event.kind === 'hit',
    );
    expect(hits).toHaveLength(3);
    expect(new Set(hits.map((event) => (event.type === 'damage' ? event.targetId : -1))).size).toBe(
      3,
    );
    expect(sim.player.auras.find((aura) => aura.id === 'shaman_thunder_charges')?.stacks).toBe(1);
  });
});

describe('approved Spiritmend group revive follow-up', () => {
  it("grants Ancestors' Return only to Spiritmend as a seven-second out-of-combat cast", () => {
    expect(knownAt('shaman', 'restoration')).toContain('ancestor_return');
    expect(knownAt('shaman', 'elemental')).not.toContain('ancestor_return');
    expect(knownAt('shaman', 'enhancement')).not.toContain('ancestor_return');
    expect(ABILITIES.ancestor_return).toMatchObject({
      class: 'shaman',
      specs: ['restoration'],
      learnLevel: 20,
      castTime: 7,
      requiresTarget: false,
      requiresOutOfCombat: true,
    });
    expect(ABILITIES.ancestor_return.effects).toContainEqual({
      type: 'massResurrectGroup',
      hpFrac: 0.3,
    });
  });

  it('offers every dead group member a resurrection and leaves strangers alone', () => {
    const sim = new Sim({ seed: 2922, playerClass: 'shaman' });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('restoration')).toBe(true);
    const fallenId = sim.addPlayer('warrior', 'Fallen Ally');
    sim.partyInvite(fallenId, sim.playerId);
    sim.partyAccept(fallenId);
    const fallen = sim.entities.get(fallenId) as Entity;
    killAt(fallen, sim.player.pos.x + 3, sim.player.pos.z + 2);
    const strangerId = sim.addPlayer('priest', 'Stranger');
    const stranger = sim.entities.get(strangerId) as Entity;
    killAt(stranger, sim.player.pos.x + 1, sim.player.pos.z + 1);
    sim.player.resource = sim.player.maxResource;

    sim.castAbility('ancestor_return');
    expect(sim.player.castingAbility).toBe('ancestor_return');
    const events = advance(sim, 7);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'resurrectionOffer',
        pid: fallenId,
        fromName: sim.player.name,
      }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: 'resurrectionOffer', pid: strangerId }),
    );
    expect(
      events.some(
        (event) => event.type === 'spellfxAt' && event.school === 'nature' && event.fx === 'nova',
      ),
    ).toBe(true);
  });
});
