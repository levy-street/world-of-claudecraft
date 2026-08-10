import { describe, expect, it, vi } from 'vitest';
import { addSoulFragments, necromancyCastError } from '../src/sim/combat/necromancy';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import { emptyModifiers, specLabel } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { petCleaveAttack, petRangedAttack } from '../src/sim/pet/pet_ai';
import { type ArenaMatch, Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, SimEvent } from '../src/sim/types';

const NECROMANCY_IDS = new Set([
  'graveguard',
  'necromancy_skeletal_warrior',
  'necromancy_bone_mage',
  'necromancy_gravewing',
]);

function makeNecromancer(seed = 42): Sim {
  const sim = new Sim({ seed, playerClass: 'warlock', autoEquip: true });
  sim.setPlayerLevel(20);
  sim.setSpec('demonology');
  sim.player.resource = sim.player.maxResource;
  return sim;
}

function knownAbilities(sim: Sim): string[] {
  return sim.players.get(sim.playerId)?.known.map((ability) => ability.def.id) ?? [];
}

function addTarget(sim: Sim): Entity {
  const p = sim.player;
  const target = createMob(
    (sim as unknown as { nextId: number }).nextId++,
    MOBS.ridge_stalker,
    20,
    {
      x: p.pos.x,
      y: p.pos.y,
      z: p.pos.z + 10,
    },
  );
  target.maxHp = 100_000;
  target.hp = target.maxHp;
  target.weapon.min = 0;
  target.weapon.max = 0;
  target.hostile = true;
  sim.addEntity(target);
  sim.targetEntity(target.id);
  p.facing = 0;
  return target;
}

function addNearbyTarget(sim: Sim, primary: Entity, xOffset: number): Entity {
  const target = createMob(
    (sim as unknown as { nextId: number }).nextId++,
    MOBS.ridge_stalker,
    20,
    {
      x: primary.pos.x + xOffset,
      y: primary.pos.y,
      z: primary.pos.z,
    },
  );
  target.maxHp = 100_000;
  target.hp = target.maxHp;
  target.weapon.min = 0;
  target.weapon.max = 0;
  target.hostile = true;
  sim.addEntity(target);
  return target;
}

function finishCast(sim: Sim, abilityId: string): void {
  sim.player.resource = sim.player.maxResource;
  sim.castAbility(abilityId);
  for (let i = 0; i < 20 * 8 && sim.player.castingAbility; i++) sim.tick();
  for (let i = 0; i < 40 && sim.player.gcdRemaining > 0; i++) sim.tick();
}

function drain(sim: Sim): SimEvent[] {
  return (sim as unknown as { drainEvents(): SimEvent[] }).drainEvents();
}

function finishCastEvents(sim: Sim, abilityId: string): SimEvent[] {
  sim.player.resource = sim.player.maxResource;
  sim.castAbility(abilityId);
  const events = drain(sim);
  for (let i = 0; i < 20 * 8 && sim.player.castingAbility; i++) events.push(...sim.tick());
  return events;
}

function castAndCollect(sim: Sim, abilityId: string, seconds = 4): SimEvent[] {
  sim.player.resource = sim.player.maxResource;
  sim.castAbility(abilityId);
  const events = drain(sim);
  for (let i = 0; i < 20 * seconds; i++) events.push(...sim.tick());
  return events;
}

function fragmentCount(p: Entity): number {
  return p.auras.find((aura) => aura.kind === 'soul_fragments')?.stacks ?? 0;
}

function deathEchoes(p: Entity): Entity['auras'] {
  return p.auras.filter((aura) => aura.kind === 'necromancy_death_echo');
}

function ownedUndead(sim: Sim): Entity[] {
  return [...sim.entities.values()].filter(
    (entity) =>
      entity.kind === 'mob' &&
      entity.ownerId === sim.playerId &&
      NECROMANCY_IDS.has(entity.templateId),
  );
}

describe('Necromancy Warlock', () => {
  it('learns the Necromancy core kit at the assigned levels', () => {
    const at = (level: number) =>
      abilitiesKnownAt('warlock', level, {
        ...emptyModifiers(),
        spec: 'demonology',
      }).map((known) => known.def.id);

    expect(at(1)).toEqual(expect.arrayContaining(['soul_harvest', 'raise_graveguard']));
    expect(at(4)).not.toContain('raise_skeletal_warrior');
    expect(at(5)).toEqual(expect.arrayContaining(['raise_skeletal_warrior', 'funeral_harvest']));
    expect(at(7)).not.toContain('searing_pain');
    expect(at(6)).not.toContain('sacrifice_undead');
    expect(at(8)).toEqual(expect.arrayContaining(['raise_bone_mage', 'bone_armor']));
    expect(at(9)).toContain('soul_lance');
    expect(at(11)).toContain('corpse_explosion');
    expect(at(12)).toContain('ossuary_mark');
    expect(at(13)).toContain('unholy_command');
    expect(at(14)).toContain('reaping_command');
    expect(at(7)).toContain('sacrifice_undead');
    expect(at(15)).not.toContain('army_of_the_dead');
    expect(at(16)).toContain('army_of_the_dead');
  });

  it('replaces Demonology with the Necromancy identity while preserving its internal id', () => {
    const sim = makeNecromancer();
    const meta = sim.players.get(sim.playerId);
    const known = knownAbilities(sim);

    expect(meta?.talents.spec).toBe('demonology');
    expect(specLabel('warlock', meta?.talents)).toBe('Necromancy');
    expect(known).toEqual(
      expect.arrayContaining([
        'soul_harvest',
        'soul_lance',
        'raise_graveguard',
        'raise_skeletal_warrior',
        'raise_bone_mage',
        'raise_gravewing',
        'ossuary_mark',
        'funeral_harvest',
        'corpse_explosion',
        'bone_armor',
        'unholy_command',
        'reaping_command',
        'sacrifice_undead',
        'army_of_the_dead',
        'metamorphosis',
      ]),
    );
    expect(known).toEqual(
      expect.arrayContaining(['demon_skin', 'life_tap', 'umbral_anchor', 'fear', 'spell_lock']),
    );
    for (const removed of [
      'shadow_bolt',
      'immolate',
      'corruption',
      'curse_of_agony',
      'drain_life',
    ]) {
      expect(known, removed).not.toContain(removed);
    }
  });

  it('explains each summon role and the persistent two-slot Dominion in ability tooltips', () => {
    expect(ABILITIES.raise_graveguard.description).toContain('intercepts 20%');
    expect(ABILITIES.raise_graveguard.description).toContain('take 30% less damage for 4 sec');
    expect(ABILITIES.raise_skeletal_warrior.description).toContain('persistent');
    expect(ABILITIES.raise_skeletal_warrior.description).toContain('2-slot Dominion');
    expect(ABILITIES.raise_skeletal_warrior.description).toContain('45% damage every 6 sec');
    expect(ABILITIES.raise_bone_mage.description).toContain('5% more magic damage for 6 sec');
    expect(ABILITIES.raise_bone_mage.description).toContain('raises that weakness to 8%');
    expect(ABILITIES.raise_gravewing.description).toContain('65% damage every 5 sec');
    expect(ABILITIES.raise_gravewing.description).toContain('take 8% more damage for 5 sec');
    expect(ABILITIES.army_of_the_dead.description).toContain(
      'temporary Skeletal Warrior, Bone Mage, and Gravewing',
    );
    expect(ABILITIES.army_of_the_dead.description).toContain(
      'filling the ranks your standing Dominion servants leave empty',
    );
    expect(ABILITIES.sacrifice_undead.description).toContain('Dominion servant');
  });

  it('rebuilds the owner kit when changing from Destruction to Necromancy', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warlock', autoEquip: true });
    sim.setPlayerLevel(20);

    expect(sim.setSpec('destruction')).toBe(true);
    expect(knownAbilities(sim)).toEqual(
      expect.arrayContaining(['shadow_bolt', 'immolate', 'drain_life']),
    );

    expect(sim.setSpec('demonology')).toBe(true);
    const known = knownAbilities(sim);
    expect(known).toEqual(
      expect.arrayContaining(['demon_skin', 'life_tap', 'umbral_anchor', 'fear', 'spell_lock']),
    );
    for (const removed of [
      'shadow_bolt',
      'immolate',
      'corruption',
      'curse_of_agony',
      'drain_life',
    ]) {
      expect(known, removed).not.toContain(removed);
    }
  });

  it('learns the retained Necromancy class kit at its assigned levels', () => {
    const at = (level: number) =>
      abilitiesKnownAt('warlock', level, {
        ...emptyModifiers(),
        spec: 'demonology',
      }).map((ability) => ability.def.id);

    const boundaries = [
      { level: 1, learned: 'demon_skin' },
      { level: 5, learned: 'umbral_anchor' },
      { level: 6, learned: 'life_tap' },
      { level: 9, learned: 'soul_lance' },
      { level: 10, learned: 'spell_lock' },
      { level: 12, learned: 'ossuary_mark' },
      { level: 10, learned: 'fear' },
    ] as const;
    for (const { level, learned } of boundaries) {
      expect(at(level), `${learned} at level ${level}`).toContain(learned);
      if (level > 1) {
        expect(at(level - 1), `${learned} before level ${level}`).not.toContain(learned);
      }
    }
  });

  it('defines Soul Lance and Ossuary Mark at their exact progression values', () => {
    expect(ABILITIES.soul_lance).toMatchObject({
      specs: ['demonology'],
      learnLevel: 9,
      cost: 35,
      castTime: 1.6,
      cooldown: 8,
      range: 30,
      school: 'shadow',
      effects: [{ type: 'directDamage', min: 30, max: 36 }],
      ranks: [
        {
          rank: 2,
          level: 14,
          cost: 50,
          effects: [{ type: 'directDamage', min: 50, max: 60 }],
        },
        {
          rank: 3,
          level: 20,
          cost: 65,
          effects: [{ type: 'directDamage', min: 80, max: 95 }],
        },
      ],
    });
    expect(ABILITIES.ossuary_mark).toMatchObject({
      specs: ['demonology'],
      learnLevel: 12,
      cost: 30,
      castTime: 0,
      cooldown: 20,
      range: 30,
      school: 'shadow',
      effects: [
        {
          type: 'necromancyOssuaryMark',
          duration: 12,
          storedDamagePct: 0.2,
          soulLanceBonusPct: 0.5,
          deathRadius: 6,
        },
      ],
    });
  });

  it('pins the level-20 Essence Reap sustain cost', () => {
    expect(ABILITIES.soul_harvest.ranks?.find((rank) => rank.rank === 3)).toMatchObject({
      level: 20,
      cost: 55,
      effects: [
        { type: 'directDamage', min: 44, max: 55 },
        { type: 'gainSoulFragments', amount: 1 },
      ],
    });
  });

  it('emits stable premium-VFX identities for Soul Lance and every Ossuary Mark phase', () => {
    const sim = makeNecromancer();
    const target = addTarget(sim);
    sim.player.hitBonus = 1;

    const applyEvents = finishCastEvents(sim, 'ossuary_mark');
    expect(applyEvents).toContainEqual({
      type: 'spellfx',
      sourceId: sim.playerId,
      targetId: target.id,
      school: 'shadow',
      fx: 'selfCast',
      ability: 'ossuary_mark',
    });

    sim.player.gcdRemaining = 0;
    const lanceEvents = castAndCollect(sim, 'soul_lance');
    expect(lanceEvents).toContainEqual({
      type: 'spellfx',
      sourceId: sim.playerId,
      targetId: target.id,
      school: 'shadow',
      fx: 'projectile',
      ability: 'soul_lance',
    });

    sim.player.gcdRemaining = 0;
    sim.castAbility('ossuary_mark');
    expect(drain(sim)).toContainEqual({
      type: 'spellfx',
      sourceId: sim.playerId,
      targetId: target.id,
      school: 'shadow',
      fx: 'nova',
      ability: 'ossuary_mark_detonate',
    });
  });

  it('stores owner and undead damage in Ossuary Mark but ignores outsiders', () => {
    const sim = makeNecromancer();
    const target = addTarget(sim);
    finishCast(sim, 'raise_graveguard');
    finishCast(sim, 'ossuary_mark');
    const mark = target.auras.find((aura) => aura.kind === 'necromancy_ossuary_mark');
    const graveguard = sim.petOf(sim.playerId);
    if (!mark || !graveguard) throw new Error('Expected Ossuary Mark and Graveguard');
    const storedBefore = mark.damageAccrued ?? 0;

    sim.dealDamage(
      sim.player,
      target,
      100,
      false,
      'shadow',
      'Owner Test',
      'hit',
      true,
      undefined,
      true,
      false,
      true,
      'owner_test',
      false,
      undefined,
      true,
    );
    sim.dealDamage(
      graveguard,
      target,
      100,
      false,
      'physical',
      'Undead Test',
      'hit',
      true,
      undefined,
      true,
      false,
      true,
      'undead_test',
      false,
      undefined,
      true,
    );

    const outsiderId = sim.addPlayer('mage', 'Outsider');
    const outsider = sim.entities.get(outsiderId);
    if (!outsider) throw new Error('Expected outsider');
    sim.dealDamage(
      outsider,
      target,
      100,
      false,
      'arcane',
      'Outsider Test',
      'hit',
      true,
      undefined,
      true,
      false,
      true,
      'outsider_test',
      false,
      undefined,
      true,
    );

    expect(mark.damageAccrued).toBeCloseTo(storedBefore + 40, 5);
  });

  it('feeds 70% of landed Soul Lance damage into Ossuary Mark', () => {
    const sim = makeNecromancer();
    const target = addTarget(sim);
    sim.player.hitBonus = 1;
    finishCast(sim, 'ossuary_mark');

    const events = castAndCollect(sim, 'soul_lance', 8);
    const lance = events.find(
      (event): event is Extract<SimEvent, { type: 'damage' }> =>
        event.type === 'damage' && event.targetId === target.id && event.ability === 'Soul Lance',
    );
    const mark = target.auras.find((aura) => aura.kind === 'necromancy_ossuary_mark');

    expect(lance).toBeDefined();
    expect(mark?.damageAccrued).toBeCloseTo((lance?.amount ?? 0) * 0.7, 5);
  });

  it('reactivates Ossuary Mark for free without restarting its cooldown', () => {
    const sim = makeNecromancer();
    const target = addTarget(sim);
    sim.player.hitBonus = 1;
    finishCast(sim, 'ossuary_mark');
    sim.dealDamage(
      sim.player,
      target,
      100,
      false,
      'shadow',
      'Charge Mark',
      'hit',
      true,
      undefined,
      true,
      false,
      true,
      'charge_mark',
      false,
      undefined,
      true,
    );
    const hpBefore = target.hp;
    const cooldownBefore = sim.player.cooldowns.get('ossuary_mark') ?? 0;
    sim.player.resource = 0;

    sim.castAbility('ossuary_mark');

    expect(target.hp).toBe(hpBefore - 20);
    expect(target.auras.some((aura) => aura.kind === 'necromancy_ossuary_mark')).toBe(false);
    expect(sim.player.resource).toBe(0);
    expect(sim.player.cooldowns.get('ossuary_mark')).toBeLessThanOrEqual(cooldownBefore);
  });

  it('detonates Ossuary Mark automatically when its duration expires', () => {
    const sim = makeNecromancer();
    const target = addTarget(sim);
    sim.player.hitBonus = 1;
    finishCast(sim, 'ossuary_mark');
    sim.dealDamage(
      sim.player,
      target,
      100,
      false,
      'shadow',
      'Charge Mark',
      'hit',
      true,
      undefined,
      true,
      false,
      true,
      'charge_mark',
      false,
      undefined,
      true,
    );
    const hpBefore = target.hp;

    for (
      let tick = 0;
      tick < 20 * 15 && target.auras.some((aura) => aura.kind === 'necromancy_ossuary_mark');
      tick++
    ) {
      sim.tick();
    }

    expect(target.auras.some((aura) => aura.kind === 'necromancy_ossuary_mark')).toBe(false);
    expect(target.hp).toBe(hpBefore - 20);
  });

  it('detonates a marked death around the victim and grants only one fragment', () => {
    const sim = makeNecromancer();
    const victim = addTarget(sim);
    const nearby = addTarget(sim);
    nearby.pos.x = victim.pos.x + 3;
    nearby.pos.z = victim.pos.z;
    nearby.prevPos = { ...nearby.pos };
    sim.ctx.rebucket(nearby);
    sim.targetEntity(victim.id);
    sim.player.hitBonus = 1;
    victim.maxHp = 200;
    victim.hp = 200;
    finishCast(sim, 'ossuary_mark');

    for (const amount of [100, 100]) {
      sim.dealDamage(
        sim.player,
        victim,
        amount,
        false,
        'shadow',
        'Marked Kill',
        'hit',
        true,
        undefined,
        true,
        false,
        true,
        'marked_kill',
        false,
        undefined,
        true,
      );
    }

    expect(victim.dead).toBe(true);
    expect(nearby.hp).toBe(nearby.maxHp - 40);
    expect(fragmentCount(sim.player)).toBe(1);
    expect(deathEchoes(sim.player)).toHaveLength(0);
    expect(drain(sim)).toContainEqual({
      type: 'spellfxAt',
      x: victim.pos.x,
      z: victim.pos.z,
      school: 'shadow',
      fx: 'nova',
      radius: 6,
      sourceId: sim.playerId,
      ability: 'ossuary_mark_detonate',
    });
  });

  it('keeps each committed Warlock kit free of legacy cross-spec fillers', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warlock', autoEquip: true });
    sim.setPlayerLevel(20);

    expect(sim.setSpec('destruction')).toBe(true);
    expect(knownAbilities(sim)).toEqual(
      expect.arrayContaining(['shadow_bolt', 'immolate', 'drain_life', 'life_tap']),
    );

    expect(sim.setSpec('affliction')).toBe(true);
    expect(knownAbilities(sim)).toContain('drain_life');
    expect(knownAbilities(sim)).not.toEqual(expect.arrayContaining(['immolate']));
    expect(knownAbilities(sim)).not.toContain('life_tap');

    expect(sim.setSpec(null)).toBe(true);
    expect(knownAbilities(sim)).toEqual(
      expect.arrayContaining(['corruption', 'curse_of_agony', 'drain_life']),
    );
    expect(knownAbilities(sim)).not.toEqual(expect.arrayContaining(['immolate']));

    expect(sim.setSpec('affliction')).toBe(true);
    sim.setPlayerLevel(13);
    expect(knownAbilities(sim)).toContain('life_tap');
    sim.setPlayerLevel(14);
    expect(knownAbilities(sim)).not.toContain('life_tap');
  });

  it('spends fragments to make every undead reap the primary target in unison', () => {
    const sim = makeNecromancer(43);
    const primary = addTarget(sim);
    const secondary = addTarget(sim);
    secondary.pos.x = primary.pos.x + 2;
    secondary.pos.z = primary.pos.z;
    secondary.prevPos = { ...secondary.pos };
    sim.ctx.rebucket(secondary);

    finishCast(sim, 'raise_graveguard');
    for (let fragment = 0; fragment < 5; fragment++) finishCast(sim, 'soul_harvest');
    finishCast(sim, 'raise_skeletal_warrior');
    finishCast(sim, 'raise_bone_mage');
    expect(fragmentCount(sim.player)).toBe(2);

    const undead = ownedUndead(sim);
    sim.targetEntity(primary.id);
    drain(sim);
    const events = finishCastEvents(sim, 'reaping_command');
    const primaryHits = events.filter(
      (event): event is Extract<SimEvent, { type: 'damage' }> =>
        event.type === 'damage' &&
        event.targetId === primary.id &&
        event.ability === 'Reaping Command',
    );
    const secondaryHits = events.filter(
      (event): event is Extract<SimEvent, { type: 'damage' }> =>
        event.type === 'damage' &&
        event.targetId === secondary.id &&
        event.ability === 'Reaping Command',
    );

    expect(fragmentCount(sim.player)).toBe(0);
    expect(sim.player.cooldowns.get('reaping_command')).toBeGreaterThan(0);
    expect(primaryHits).toHaveLength(undead.length);
    expect(new Set(primaryHits.map((event) => event.sourceId))).toEqual(
      new Set(undead.map((servant) => servant.id)),
    );
    expect(secondaryHits).toHaveLength(1);
    expect(secondaryHits[0]?.sourceId).toBe(
      undead.find((servant) => servant.templateId === 'necromancy_skeletal_warrior')?.id,
    );
    const graveguard = undead.find((servant) => servant.templateId === 'graveguard');
    expect(primary.forcedTargetId).toBe(graveguard?.id);
    expect(graveguard?.auras).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'reaping_command_graveguard',
          kind: 'shield_wall',
          value: 0.3,
          duration: 4,
        }),
      ]),
    );
    expect(primary.auras).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'reaping_command_warrior',
          kind: 'slow',
          value: 0.6,
          duration: 4,
        }),
        expect.objectContaining({
          id: 'reaping_command_bone_mage',
          kind: 'spellvuln',
          value: 0.08,
          duration: 6,
        }),
      ]),
    );
  });

  it('lets Gravewing turn Reaping Command into an area vulnerability', () => {
    const sim = makeNecromancer();
    const primary = addTarget(sim);
    const secondary = addTarget(sim);
    secondary.pos.x = primary.pos.x + 2;
    secondary.pos.z = primary.pos.z;
    secondary.prevPos = { ...secondary.pos };
    sim.ctx.rebucket(secondary);

    finishCast(sim, 'army_of_the_dead');
    addSoulFragments(sim.ctx, sim.player, 2);
    sim.targetEntity(primary.id);
    finishCast(sim, 'reaping_command');

    for (const victim of [primary, secondary]) {
      expect(victim.auras).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'reaping_command_gravewing',
            kind: 'vulnerability',
            value: 0.08,
            duration: 5,
          }),
        ]),
      );
    }
  });

  it('Army of the Dead fills only the missing archetypes, never duplicating a standing servant', () => {
    const sim = makeNecromancer();
    addTarget(sim);
    addSoulFragments(sim.ctx, sim.player, 5);
    finishCast(sim, 'raise_gravewing');
    const living = (templateId: string) =>
      [...sim.entities.values()].filter((e) => e.templateId === templateId && !e.dead).length;
    expect(living('necromancy_gravewing')).toBe(1);

    addSoulFragments(sim.ctx, sim.player, 5);
    sim.player.resource = sim.player.maxResource;
    finishCast(sim, 'army_of_the_dead');

    // The duplicate gate: the standing Gravewing is NOT doubled; the missing
    // warrior and bone mage archetypes join it instead.
    expect(living('necromancy_gravewing')).toBe(1);
    expect(living('necromancy_skeletal_warrior')).toBe(1);
    expect(living('necromancy_bone_mage')).toBe(1);
  });

  it('refuses Reaping Command without undead before spending mana or fragments', () => {
    const sim = makeNecromancer();
    addTarget(sim);
    addSoulFragments(sim.ctx, sim.player, 2);
    const manaBefore = sim.player.resource;

    sim.castAbility('reaping_command');

    expect(fragmentCount(sim.player)).toBe(2);
    expect(sim.player.resource).toBe(manaBefore);
    expect(sim.player.cooldowns.has('reaping_command')).toBe(false);
  });

  it('commits every Reaping Command cleave before an earlier servant kills the primary', () => {
    const sim = makeNecromancer();
    const primary = addTarget(sim);
    const secondary = addTarget(sim);
    secondary.pos.x = primary.pos.x + 2;
    secondary.pos.z = primary.pos.z;
    secondary.prevPos = { ...secondary.pos };
    sim.ctx.rebucket(secondary);

    finishCast(sim, 'raise_graveguard');
    addSoulFragments(sim.ctx, sim.player, 3);
    finishCast(sim, 'raise_skeletal_warrior');
    primary.hp = 1;
    sim.targetEntity(primary.id);
    drain(sim);

    const events = finishCastEvents(sim, 'reaping_command');
    const cleaves = events.filter(
      (event): event is Extract<SimEvent, { type: 'damage' }> =>
        event.type === 'damage' &&
        event.targetId === secondary.id &&
        event.ability === 'Reaping Command',
    );

    expect(primary.dead).toBe(true);
    expect(cleaves).toHaveLength(1);
    expect(cleaves[0]?.sourceId).toBe(
      ownedUndead(sim).find((servant) => servant.templateId === 'necromancy_skeletal_warrior')?.id,
    );
  });

  it('refuses Reaping Command with undead but fewer than two Soul Fragments', () => {
    const sim = makeNecromancer();
    addTarget(sim);
    finishCast(sim, 'raise_graveguard');
    addSoulFragments(sim.ctx, sim.player, 1);
    const manaBefore = sim.player.resource;

    sim.castAbility('reaping_command');

    expect(fragmentCount(sim.player)).toBe(1);
    expect(sim.player.resource).toBe(manaBefore);
    expect(sim.player.cooldowns.has('reaping_command')).toBe(false);
  });

  it('harvests a recently marked death caused by another actor at the exact lockout', () => {
    const sim = makeNecromancer();
    const mark = (source: Entity, target: Entity) =>
      sim.dealDamage(
        source,
        target,
        1,
        false,
        'shadow',
        'Test Mark',
        'hit',
        false,
        undefined,
        true,
      );
    const kill = (source: Entity, target: Entity) =>
      sim.dealDamage(source, target, target.hp, false, 'physical', 'Third Party', 'hit');
    const thirdParty = addTarget(sim);

    const first = addTarget(sim);
    mark(sim.player, first);
    kill(thirdParty, first);
    expect(first.dead).toBe(true);
    expect(fragmentCount(sim.player)).toBe(1);

    const locked = addTarget(sim);
    mark(sim.player, locked);
    for (let tick = 0; tick < 59; tick++) sim.tick();
    kill(thirdParty, locked);
    expect(locked.dead).toBe(true);
    expect(fragmentCount(sim.player)).toBe(1);

    sim.tick();
    const afterLockout = addTarget(sim);
    mark(sim.player, afterLockout);
    kill(thirdParty, afterLockout);
    expect(afterLockout.dead).toBe(true);
    expect(fragmentCount(sim.player)).toBe(2);

    const expired = addTarget(sim);
    mark(sim.player, expired);
    for (let tick = 0; tick < 101; tick++) sim.tick();
    kill(thirdParty, expired);
    expect(expired.dead).toBe(true);
    expect(fragmentCount(sim.player)).toBe(2);
  });

  it('accepts undead damage but rejects non-undead owned mobs for Funeral Harvest', () => {
    const sim = makeNecromancer();
    const thirdParty = addTarget(sim);
    finishCast(sim, 'raise_graveguard');
    const graveguard = sim.petOf(sim.playerId);
    if (!graveguard) throw new Error('Expected Graveguard');

    const undeadVictim = addTarget(sim);
    sim.dealDamage(graveguard, undeadVictim, 1, false, 'physical', 'Claw', 'hit');
    sim.dealDamage(thirdParty, undeadVictim, undeadVictim.hp, false, 'physical', 'Finish', 'hit');
    expect(fragmentCount(sim.player)).toBe(1);

    for (let tick = 0; tick < 61; tick++) sim.tick();
    const familiar = addTarget(sim);
    familiar.ownerId = sim.playerId;
    familiar.hostile = false;
    const rejectedVictim = addTarget(sim);
    sim.dealDamage(familiar, rejectedVictim, 1, false, 'shadow', 'Familiar Bite', 'hit');
    sim.dealDamage(
      thirdParty,
      rejectedVictim,
      rejectedVictim.hp,
      false,
      'physical',
      'Finish',
      'hit',
    );
    expect(fragmentCount(sim.player)).toBe(1);
  });

  it('harvests a one-shot ranked-arena elimination before the death clears marks', () => {
    const sim = makeNecromancer();
    const victimId = sim.addPlayer('warrior', 'Arena Victim');
    const survivorId = sim.addPlayer('priest', 'Arena Survivor');
    const victim = sim.entities.get(victimId);
    if (!victim) throw new Error('Expected arena victim');
    const match: ArenaMatch = {
      id: 91,
      format: '2v2',
      teamA: [sim.playerId],
      teamB: [victimId, survivorId],
      slot: 0,
      state: 'active',
      timer: 0,
      returns: new Map(),
      ratingA: 1500,
      ratingB: 1500,
      defeated: new Set(),
    };
    sim.ctx.arenaMatches.set(sim.playerId, match);
    sim.ctx.arenaMatches.set(victimId, match);
    sim.ctx.arenaMatches.set(survivorId, match);

    sim.dealDamage(sim.player, victim, victim.hp + 100, false, 'shadow', 'Arena Reap', 'hit');
    const events = sim.drainEvents();

    expect(victim.dead).toBe(true);
    expect(match.defeated.has(victimId)).toBe(true);
    const damageIndex = events.findIndex(
      (event) => event.type === 'damage' && event.targetId === victimId,
    );
    const markIndex = events.findIndex(
      (event) =>
        event.type === 'aura' &&
        event.targetId === victimId &&
        event.gained === true &&
        event.name === 'Funeral Harvest',
    );
    expect(damageIndex).toBeGreaterThanOrEqual(0);
    expect(markIndex).toBeGreaterThan(damageIndex);
    expect(fragmentCount(sim.player)).toBe(1);
  });

  it('builds Soul Fragments with its filler and spends exact amounts on undead', () => {
    const sim = makeNecromancer();
    addTarget(sim);
    for (let i = 0; i < 6; i++) {
      sim.player.hitBonus = 1;
      finishCast(sim, 'soul_harvest');
    }
    expect(fragmentCount(sim.player)).toBe(5);

    finishCast(sim, 'raise_graveguard');
    expect(sim.petOf(sim.playerId)?.templateId).toBe('graveguard');
    expect(fragmentCount(sim.player)).toBe(5);

    finishCast(sim, 'raise_skeletal_warrior');
    expect(fragmentCount(sim.player)).toBe(4);

    finishCast(sim, 'raise_bone_mage');
    expect(fragmentCount(sim.player)).toBe(2);
    expect(ownedUndead(sim).map((pet) => pet.templateId)).toEqual(
      expect.arrayContaining(['graveguard', 'necromancy_skeletal_warrior', 'necromancy_bone_mage']),
    );
    expect(sim.petOf(sim.playerId)?.templateId).toBe('graveguard');
  });

  it('refuses a spender without enough fragments and leaves mana untouched', () => {
    const sim = makeNecromancer();
    const manaBefore = sim.player.resource;

    sim.castAbility('raise_bone_mage');

    expect(fragmentCount(sim.player)).toBe(0);
    expect(sim.player.resource).toBe(manaBefore);
    expect(ownedUndead(sim)).toHaveLength(0);
  });

  it('caps Dominion at two unique servants', () => {
    const sim = makeNecromancer();
    addTarget(sim);

    addSoulFragments(sim.ctx, sim.player, 5);
    finishCast(sim, 'raise_skeletal_warrior');
    finishCast(sim, 'raise_bone_mage');
    sim.castAbility('raise_gravewing');

    const temporary = ownedUndead(sim).filter((pet) => pet.templateId !== 'graveguard');
    expect(temporary.map((pet) => pet.templateId)).toEqual([
      'necromancy_skeletal_warrior',
      'necromancy_bone_mage',
    ]);
    expect(fragmentCount(sim.player)).toBe(2);
  });

  it('makes Dominion a persistent two-servant choice with unique archetypes', () => {
    const sim = makeNecromancer();
    addTarget(sim);
    addSoulFragments(sim.ctx, sim.player, 5);

    finishCast(sim, 'raise_skeletal_warrior');
    const fragmentsAfterWarrior = fragmentCount(sim.player);
    const manaBeforeDuplicate = sim.player.resource;
    sim.castAbility('raise_skeletal_warrior');

    expect(
      ownedUndead(sim).filter((servant) => servant.templateId === 'necromancy_skeletal_warrior'),
    ).toHaveLength(1);
    expect(fragmentCount(sim.player)).toBe(fragmentsAfterWarrior);
    expect(sim.player.resource).toBe(manaBeforeDuplicate);

    finishCast(sim, 'raise_bone_mage');
    expect(
      ownedUndead(sim)
        .filter((servant) => servant.templateId !== 'graveguard')
        .map((servant) => servant.templateId),
    ).toEqual(['necromancy_skeletal_warrior', 'necromancy_bone_mage']);

    const fragmentsAtCap = fragmentCount(sim.player);
    const manaAtCap = sim.player.resource;
    sim.castAbility('raise_gravewing');
    expect(fragmentCount(sim.player)).toBe(fragmentsAtCap);
    expect(sim.player.resource).toBe(manaAtCap);
    expect(ownedUndead(sim).filter((servant) => servant.templateId !== 'graveguard')).toHaveLength(
      2,
    );

    for (let tick = 0; tick < 20 * 31; tick++) sim.tick();
    expect(
      ownedUndead(sim)
        .filter((servant) => servant.templateId !== 'graveguard')
        .map((servant) => servant.templateId),
    ).toEqual(['necromancy_skeletal_warrior', 'necromancy_bone_mage']);
  });

  it('summons a persistent Gravewing and rejects its duplicate without spending resources', () => {
    const sim = makeNecromancer();
    addTarget(sim);
    addSoulFragments(sim.ctx, sim.player, 4);
    const manaBefore = sim.player.resource;

    sim.castAbility('raise_gravewing');

    const gravewing = ownedUndead(sim).find(
      (servant) => servant.templateId === 'necromancy_gravewing',
    );
    if (!gravewing) throw new Error('Expected Gravewing');
    expect(gravewing.despawnTimer).toBeUndefined();
    expect(fragmentCount(sim.player)).toBe(2);
    expect(sim.player.resource).toBe(manaBefore - 45);

    sim.player.gcdRemaining = 0;
    const fragmentsBeforeDuplicate = fragmentCount(sim.player);
    const manaBeforeDuplicate = sim.player.resource;
    sim.castAbility('raise_gravewing');
    expect(fragmentCount(sim.player)).toBe(fragmentsBeforeDuplicate);
    expect(sim.player.resource).toBe(manaBeforeDuplicate);
    expect(
      ownedUndead(sim).filter((servant) => servant.templateId === 'necromancy_gravewing'),
    ).toHaveLength(1);

    for (let tick = 0; tick < 20 * 31; tick++) sim.tick();
    expect(sim.entities.has(gravewing.id)).toBe(true);
  });

  it('gives each undead servant a distinct combat role', () => {
    expect(MOBS.graveguard.petRole).toBe('melee_tank');
    expect(MOBS.graveguard.petCanTaunt).toBe(true);
    expect(MOBS.necromancy_skeletal_warrior.petCleave).toEqual({
      radius: 4,
      mult: 0.45,
      cooldown: 6,
    });
    expect(MOBS.necromancy_bone_mage.petRanged?.spellVuln).toEqual({
      amp: 0.05,
      duration: 6,
    });
    expect(MOBS.necromancy_gravewing.dmgBase).toBe(2);
    expect(MOBS.necromancy_gravewing.dmgPerLevel).toBe(1.25);
    expect(MOBS.necromancy_gravewing.petCleave).toEqual({
      radius: 5,
      mult: 0.65,
      cooldown: 5,
    });
  });

  it('arms the Graveguard auto-taunt but leaves Dominion damage servants passive', () => {
    const sim = makeNecromancer();
    addTarget(sim);
    for (let attempt = 0; attempt < 5; attempt++) finishCast(sim, 'soul_harvest');

    finishCast(sim, 'raise_graveguard');
    finishCast(sim, 'raise_skeletal_warrior');

    const graveguard = ownedUndead(sim).find((undead) => undead.templateId === 'graveguard');
    const warrior = ownedUndead(sim).find(
      (undead) => undead.templateId === 'necromancy_skeletal_warrior',
    );
    expect(graveguard?.petAutoTaunt).toBe(true);
    expect(warrior?.petAutoTaunt).toBe(false);
  });

  it('spends 3 Soul Fragments and empowers every owned undead for 12 sec', () => {
    const empty = makeNecromancer();
    addSoulFragments(empty.ctx, empty.player, 3);
    const manaBefore = empty.player.resource;
    empty.castAbility('unholy_command');
    expect(empty.player.resource).toBe(manaBefore);
    expect(fragmentCount(empty.player)).toBe(3);
    expect(empty.player.cooldowns.has('unholy_command')).toBe(false);

    const sim = makeNecromancer();
    addTarget(sim);
    addSoulFragments(sim as unknown as SimContext, sim.player, 4);
    finishCast(sim, 'raise_graveguard');
    finishCast(sim, 'raise_skeletal_warrior');
    sim.player.gcdRemaining = 0;
    sim.player.resource = sim.player.maxResource;

    sim.castAbility('unholy_command');

    expect(ABILITIES.unholy_command.soulFragmentCost).toBe(3);
    expect(fragmentCount(sim.player)).toBe(0);
    const undead = ownedUndead(sim);
    expect(undead).toHaveLength(2);
    for (const servant of undead) {
      expect(servant.auras).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'unholy_command',
            kind: 'buff_dmg_done',
            value: 0.25,
            remaining: 12,
            sourceId: sim.playerId,
          }),
          expect.objectContaining({
            id: 'unholy_command_haste',
            kind: 'pet_spellhaste',
            value: 0.2,
            remaining: 12,
            sourceId: sim.playerId,
          }),
        ]),
      );
    }
  });

  it('lets the Skeletal Warrior cleave nearby secondary enemies', () => {
    const sim = makeNecromancer();
    const primary = addTarget(sim);
    const secondary = createMob(
      (sim as unknown as { nextId: number }).nextId++,
      MOBS.ridge_stalker,
      20,
      {
        x: primary.pos.x + 2,
        y: primary.pos.y,
        z: primary.pos.z,
      },
    );
    secondary.maxHp = 100_000;
    secondary.hp = secondary.maxHp;
    secondary.hostile = true;
    sim.addEntity(secondary);
    for (let attempt = 0; attempt < 5 && fragmentCount(sim.player) < 1; attempt++) {
      finishCast(sim, 'soul_harvest');
    }
    finishCast(sim, 'raise_skeletal_warrior');
    const warrior = ownedUndead(sim).find(
      (undead) => undead.templateId === 'necromancy_skeletal_warrior',
    );
    if (!warrior) throw new Error('Expected a Skeletal Warrior');
    const cleave = MOBS.necromancy_skeletal_warrior.petCleave;
    if (!cleave) throw new Error('Expected Skeletal Warrior cleave tuning');
    const primaryHp = primary.hp;
    const secondaryHp = secondary.hp;

    petCleaveAttack(
      (sim as unknown as { ctx: Parameters<typeof petCleaveAttack>[0] }).ctx,
      warrior,
      primary,
      cleave,
    );

    expect(primary.hp).toBe(primaryHp);
    expect(secondary.hp).toBeLessThan(secondaryHp);
  });

  it('does not consume combat RNG when Skeletal Warrior cleave has no secondary target', () => {
    const sim = makeNecromancer();
    const primary = addTarget(sim);
    addSoulFragments(sim as unknown as SimContext, sim.player, 1);
    finishCast(sim, 'raise_skeletal_warrior');
    const warrior = ownedUndead(sim).find(isDominionServant);
    const cleave = MOBS.necromancy_skeletal_warrior.petCleave;
    if (!warrior || !cleave) throw new Error('Expected Skeletal Warrior cleave');
    const ctx = (sim as unknown as { ctx: SimContext }).ctx;
    const range = vi.spyOn(ctx.rng, 'range');

    petCleaveAttack(ctx, warrior, primary, cleave);

    expect(range).not.toHaveBeenCalled();
  });

  it('does not cleave a secondary target through blocked line of sight', () => {
    const sim = makeNecromancer();
    const primary = addTarget(sim);
    const secondary = createMob(
      (sim as unknown as { nextId: number }).nextId++,
      MOBS.ridge_stalker,
      20,
      { x: primary.pos.x + 2, y: primary.pos.y, z: primary.pos.z },
    );
    secondary.maxHp = 100_000;
    secondary.hp = secondary.maxHp;
    secondary.hostile = true;
    sim.addEntity(secondary);
    addSoulFragments(sim as unknown as SimContext, sim.player, 1);
    finishCast(sim, 'raise_skeletal_warrior');
    const warrior = ownedUndead(sim).find(isDominionServant);
    const cleave = MOBS.necromancy_skeletal_warrior.petCleave;
    if (!warrior || !cleave) throw new Error('Expected Skeletal Warrior cleave');
    const ctx = (sim as unknown as { ctx: SimContext }).ctx;
    vi.spyOn(ctx, 'hasLineOfSight').mockReturnValue(false);
    const hpBefore = secondary.hp;

    petCleaveAttack(ctx, warrior, primary, cleave);

    expect(secondary.hp).toBe(hpBefore);
  });

  it('lets the Bone Mage expose targets without changing its ranged shot timing or damage', () => {
    const runShot = (ability: string | undefined) => {
      const sim = makeNecromancer();
      const target = addTarget(sim);
      for (let attempt = 0; attempt < 5 && fragmentCount(sim.player) < 2; attempt++) {
        finishCast(sim, 'soul_harvest');
      }
      finishCast(sim, 'raise_bone_mage');
      const mage = ownedUndead(sim).find((undead) => undead.templateId === 'necromancy_bone_mage');
      if (!mage) throw new Error('Expected a Bone Mage');
      const ranged = MOBS.necromancy_bone_mage.petRanged;
      if (!ranged) throw new Error('Expected Bone Mage ranged tuning');
      target.auras = target.auras.filter((aura) => aura.id !== 'raise_bone_mage');
      const hpBefore = target.hp;
      const ctx = (sim as unknown as { ctx: Parameters<typeof petRangedAttack>[0] }).ctx;
      const pendingBefore = ctx.pendingProjectiles.length;

      petRangedAttack(ctx, mage, target, { ...ranged, ability });
      const immediateDamage = hpBefore - target.hp;
      const pendingAtLaunch = ctx.pendingProjectiles.length - pendingBefore;
      let launchAbility: string | undefined;
      let landingTick: number | undefined;
      for (let tick = 1; tick <= 80; tick++) {
        const events = sim.tick();
        const launchEvent = events.find(
          (event) =>
            event.type === 'spellfx' &&
            event.sourceId === mage.id &&
            event.targetId === target.id &&
            event.school === 'shadow' &&
            event.fx === 'projectile',
        );
        if (launchEvent?.type === 'spellfx') launchAbility = launchEvent.ability;
        if (landingTick === undefined && target.hp < hpBefore) landingTick = tick;
        if (
          landingTick !== undefined &&
          target.auras.some((aura) => aura.id === 'raise_bone_mage') &&
          ctx.pendingProjectiles.length === pendingBefore
        ) {
          break;
        }
      }
      const aura = target.auras.find(
        (candidate) => candidate.id === 'raise_bone_mage' && candidate.kind === 'spellvuln',
      );

      return {
        launchAbility,
        outcome: {
          immediateDamage,
          pendingAtLaunch,
          landingTick,
          damage: hpBefore - target.hp,
          pendingAfter: ctx.pendingProjectiles.length - pendingBefore,
          aura: aura && {
            value: aura.value,
            duration: aura.duration,
            sourceIsOwner: aura.sourceId === sim.playerId,
            school: aura.school,
          },
        },
      };
    };

    const authored = runShot('bone_mage_shadow_bolt');
    const legacy = runShot(undefined);

    expect(authored.launchAbility).toBe('bone_mage_shadow_bolt');
    expect(legacy.launchAbility).toBeUndefined();
    expect(authored.outcome).toEqual(legacy.outcome);
    expect(authored.outcome).toMatchObject({
      immediateDamage: 0,
      pendingAtLaunch: 1,
      pendingAfter: 0,
      aura: {
        value: 0.05,
        duration: 6,
        sourceIsOwner: true,
        school: 'shadow',
      },
    });
    expect(authored.outcome.landingTick).toBeGreaterThan(0);
    expect(authored.outcome.damage).toBeGreaterThan(0);
  });

  it('uses Bone Armor as a max-health shield', () => {
    const sim = makeNecromancer();

    finishCast(sim, 'bone_armor');

    const shield = sim.player.auras.find((aura) => aura.id === 'bone_armor');
    expect(shield?.kind).toBe('absorb');
    expect(shield?.value).toBe(Math.round(sim.player.maxHp * 0.2));
  });

  it('Lich Form fills fragments and empowers the whole undead army', () => {
    const sim = makeNecromancer();
    finishCast(sim, 'raise_graveguard');
    addTarget(sim);
    for (let attempt = 0; attempt < 5 && fragmentCount(sim.player) === 0; attempt++) {
      finishCast(sim, 'soul_harvest');
    }
    finishCast(sim, 'raise_skeletal_warrior');

    const fragmentsBefore = fragmentCount(sim.player);
    finishCast(sim, 'metamorphosis');

    expect(sim.player.auras.some((aura) => aura.kind === 'form_lich')).toBe(true);
    expect(fragmentCount(sim.player)).toBe(Math.min(5, fragmentsBefore + 3));
    for (const undead of ownedUndead(sim)) {
      expect(undead.auras).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'lich_form_army',
            kind: 'buff_dmg_done',
            value: 0.5,
            duration: 20,
            sourceId: sim.playerId,
          }),
          expect.objectContaining({
            id: 'lich_form_army_haste',
            kind: 'pet_spellhaste',
            value: 0.2,
            duration: 20,
            sourceId: sim.playerId,
          }),
        ]),
      );
    }
  });

  it('makes Soul Lance pierce the two nearest enemies during Lich Form', () => {
    const sim = makeNecromancer(43);
    const primary = addTarget(sim);
    const nearest = addNearbyTarget(sim, primary, 0.5);
    const secondNearest = addNearbyTarget(sim, primary, 1);
    const excluded = addNearbyTarget(sim, primary, 1.5);
    for (const target of [primary, nearest, secondNearest, excluded]) {
      target.weapon.speed = 1000;
    }
    sim.player.hitBonus = 1;
    finishCast(sim, 'metamorphosis');
    drain(sim);

    const events = castAndCollect(sim, 'soul_lance', 8);
    const primaryHit = events.find(
      (event): event is Extract<SimEvent, { type: 'damage' }> =>
        event.type === 'damage' && event.targetId === primary.id && event.ability === 'Soul Lance',
    );
    const pierceHits = events.filter(
      (event): event is Extract<SimEvent, { type: 'damage' }> =>
        event.type === 'damage' && event.ability === 'Lich Soul Lance',
    );

    expect(primaryHit).toBeDefined();
    expect(pierceHits.map((event) => event.targetId)).toEqual([nearest.id, secondNearest.id]);
    expect(pierceHits.map((event) => event.amount)).toEqual([
      Math.max(1, Math.round((primaryHit?.amount ?? 0) * 0.5)),
      Math.max(1, Math.round((primaryHit?.amount ?? 0) * 0.5)),
    ]);
    expect(pierceHits.some((event) => event.targetId === excluded.id)).toBe(false);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'spellfx',
          sourceId: primary.id,
          targetId: nearest.id,
          fx: 'projectile',
          ability: 'soul_lance',
        }),
        expect.objectContaining({
          type: 'spellfx',
          sourceId: primary.id,
          targetId: secondNearest.id,
          fx: 'projectile',
          ability: 'soul_lance',
        }),
      ]),
    );
  });

  it('keeps Soul Lance single-target outside Lich Form', () => {
    const sim = makeNecromancer();
    const primary = addTarget(sim);
    addNearbyTarget(sim, primary, 0.5);
    sim.player.hitBonus = 1;

    const events = castAndCollect(sim, 'soul_lance', 8);

    expect(
      events.some((event) => event.type === 'damage' && event.ability === 'Lich Soul Lance'),
    ).toBe(false);
  });

  it.each([
    [0, 3],
    [3, 5],
    [4, 5],
    [5, 5],
  ])('Lich Form grants exactly three fragments from %i and caps at %i', (before, after) => {
    const sim = makeNecromancer();
    if (before > 0) addSoulFragments(sim as unknown as SimContext, sim.player, before);

    finishCast(sim, 'metamorphosis');

    expect(fragmentCount(sim.player)).toBe(after);
    expect(sim.player.auras.filter((aura) => aura.kind === 'soul_fragments')).toHaveLength(1);
  });

  it('emits a transformation cue when Lich Form begins', () => {
    const sim = makeNecromancer();
    drain(sim);

    sim.castAbility('metamorphosis');
    const event = drain(sim).find(
      (candidate) => candidate.type === 'spellfx' && candidate.fx === 'lichTransform',
    );

    expect(event).toMatchObject({
      type: 'spellfx',
      sourceId: sim.playerId,
      targetId: sim.playerId,
      school: 'shadow',
      fx: 'lichTransform',
      ability: 'metamorphosis',
    });
  });

  it('identifies transformed Soul Harvest bolts for the dual-hand visual', () => {
    const sim = makeNecromancer();
    addTarget(sim);
    finishCast(sim, 'metamorphosis');
    drain(sim);

    const events = finishCastEvents(sim, 'soul_harvest');

    expect(
      events.find(
        (event) =>
          event.type === 'spellfx' && event.fx === 'projectile' && event.ability === 'soul_harvest',
      ),
    ).toBeDefined();
  });

  it('sacrifices a Dominion servant and explodes at the chosen location without a Death Echo', () => {
    const sim = makeNecromancer();
    const target = addTarget(sim);
    const chosenLocation = { x: target.pos.x, z: target.pos.z };
    addSoulFragments(sim.ctx, sim.player, 5);
    finishCast(sim, 'raise_skeletal_warrior');
    finishCast(sim, 'raise_bone_mage');
    const warrior = ownedUndead(sim).find(
      (servant) => servant.templateId === 'necromancy_skeletal_warrior',
    );
    const mage = ownedUndead(sim).find((servant) => servant.templateId === 'necromancy_bone_mage');
    if (!warrior || !mage) throw new Error('Expected a full Dominion');
    warrior.hp = 1;
    mage.despawnTimer = 3;
    const magePosition = { ...mage.pos };
    const fragmentsBefore = fragmentCount(sim.player);
    const hpBefore = target.hp;
    sim.player.resource = sim.player.maxResource;
    const manaBefore = sim.player.resource;
    sim.ctx.applyAura(sim.player, {
      id: 'legacy_death_echo',
      name: 'Death Echo',
      kind: 'necromancy_death_echo',
      remaining: 10,
      duration: 10,
      value: chosenLocation.x,
      value2: chosenLocation.z,
      sourceId: sim.playerId,
      school: 'shadow',
    });
    drain(sim);

    sim.castAbilityAt('corpse_explosion', chosenLocation);
    const events = drain(sim);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'spellfxAt',
        x: chosenLocation.x,
        z: chosenLocation.z,
        fx: 'nova',
        ability: 'corpse_explosion',
      }),
    );
    expect(events).toContainEqual({
      type: 'spellfxAt',
      x: magePosition.x,
      z: magePosition.z,
      school: 'shadow',
      fx: 'burst',
      sourceId: sim.playerId,
      ability: 'corpse_explosion_sacrifice',
    });
    const sacrificeIndex = events.findIndex(
      (event) => event.type === 'spellfxAt' && event.ability === 'corpse_explosion_sacrifice',
    );
    const explosionIndex = events.findIndex(
      (event) => event.type === 'spellfxAt' && event.ability === 'corpse_explosion',
    );
    const damageIndex = events.findIndex(
      (event) => event.type === 'damage' && event.targetId === target.id,
    );
    expect(sacrificeIndex).toBeGreaterThanOrEqual(0);
    expect(explosionIndex).toBeGreaterThan(sacrificeIndex);
    expect(damageIndex).toBeGreaterThan(explosionIndex);
    expect(target.hp).toBeLessThan(hpBefore);
    expect(sim.player.resource).toBe(manaBefore - 30);
    expect(fragmentCount(sim.player)).toBe(fragmentsBefore);
    expect(sim.entities.has(mage.id)).toBe(false);
    expect(sim.entities.has(warrior.id)).toBe(true);
    expect(deathEchoes(sim.player)).toEqual([expect.objectContaining({ id: 'legacy_death_echo' })]);
    expect(sim.player.cooldowns.get('corpse_explosion')).toBeGreaterThan(0);
    expect(ABILITIES.corpse_explosion.cooldown).toBe(8);
  });

  it('keeps Funeral Harvest fragment generation without creating obsolete Death Echoes', () => {
    const sim = makeNecromancer();
    const target = addTarget(sim);
    target.maxHp = 100;
    target.hp = 100;

    sim.dealDamage(sim.player, target, 100, false, 'shadow', 'Harvest', 'hit');

    expect(fragmentCount(sim.player)).toBe(1);
    expect(deathEchoes(sim.player)).toHaveLength(0);
  });

  it('requires a living Dominion servant for Corpse Explosion without spending mana or GCD', () => {
    const sim = makeNecromancer();
    const target = addTarget(sim);
    const hpBefore = target.hp;
    const manaBefore = sim.player.resource;

    sim.castAbilityAt('corpse_explosion', { x: target.pos.x, z: target.pos.z });
    expect(drain(sim)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'error',
          text: 'That ability is not ready yet.',
        }),
      ]),
    );
    expect(target.hp).toBe(hpBefore);
    expect(sim.player.resource).toBe(manaBefore);
    expect(sim.player.gcdRemaining).toBe(0);
    expect(ABILITIES.corpse_explosion.soulFragmentCost).toBeUndefined();
  });

  it('does not treat Graveguard as a Corpse Explosion sacrifice', () => {
    const sim = makeNecromancer();
    const target = addTarget(sim);
    finishCast(sim, 'raise_graveguard');
    const graveguard = sim.petOf(sim.playerId);
    if (!graveguard) throw new Error('Expected Graveguard');
    const hpBefore = target.hp;
    const manaBefore = sim.player.resource;
    drain(sim);

    sim.castAbilityAt('corpse_explosion', { x: target.pos.x, z: target.pos.z });
    const events = drain(sim);

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'error', text: 'That ability is not ready yet.' }),
    );
    expect(events.some((event) => event.type === 'damage')).toBe(false);
    expect(sim.entities.has(graveguard.id)).toBe(true);
    expect(target.hp).toBe(hpBefore);
    expect(sim.player.resource).toBe(manaBefore);
    expect(sim.player.gcdRemaining).toBe(0);
    expect(sim.player.cooldowns.has('corpse_explosion')).toBe(false);
  });

  it('passes the active Lich Form empowerment to undead raised during the form', () => {
    const sim = makeNecromancer();
    addTarget(sim);
    finishCast(sim, 'metamorphosis');
    finishCast(sim, 'raise_skeletal_warrior');

    const warrior = ownedUndead(sim).find(
      (undead) => undead.templateId === 'necromancy_skeletal_warrior',
    );
    expect(warrior?.auras).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'lich_form_army',
          kind: 'buff_dmg_done',
          value: 0.5,
          sourceId: sim.playerId,
        }),
        expect.objectContaining({
          id: 'lich_form_army_haste',
          kind: 'pet_spellhaste',
          value: 0.2,
          sourceId: sim.playerId,
        }),
      ]),
    );
  });

  it('Army of the Dead tears open a portal for one servant of every temporary type', () => {
    const sim = makeNecromancer();
    addTarget(sim);
    finishCast(sim, 'raise_graveguard');
    const graveguard = ownedUndead(sim).find((pet) => pet.templateId === 'graveguard');
    if (!graveguard) throw new Error('Expected a Graveguard');
    drain(sim);

    const events = finishCastEvents(sim, 'army_of_the_dead');

    const temporary = ownedUndead(sim).filter((pet) => pet.templateId !== 'graveguard');
    expect(temporary.map((pet) => pet.templateId)).toEqual([
      'necromancy_skeletal_warrior',
      'necromancy_bone_mage',
      'necromancy_gravewing',
    ]);
    expect(sim.entities.get(graveguard.id)).toBe(graveguard);
    expect(temporary.every((pet) => pet.despawnTimer === 20)).toBe(true);
    expect(MOBS.necromancy_gravewing.elite).toBe(true);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'spellfxAt',
        x: sim.player.pos.x,
        z: sim.player.pos.z + 2.5,
        school: 'shadow',
        fx: 'burst',
        sourceId: sim.playerId,
        ability: 'army_of_the_dead',
      }),
    );
    const expectedFormation = [
      [sim.player.pos.x - 1.15, sim.player.pos.z + 3.55],
      [sim.player.pos.x, sim.player.pos.z + 3.55],
      [sim.player.pos.x + 1.15, sim.player.pos.z + 3.55],
    ];
    temporary.forEach((pet, index) => {
      expect(pet.pos.x).toBeCloseTo(expectedFormation[index][0], 6);
      expect(pet.pos.z).toBeCloseTo(expectedFormation[index][1], 6);
    });
  });

  it('Army of the Dead preserves a full Dominion and fills only the missing archetype', () => {
    const sim = makeNecromancer();
    addTarget(sim);
    addSoulFragments(sim.ctx, sim.player, 5);
    finishCast(sim, 'raise_skeletal_warrior');
    finishCast(sim, 'raise_bone_mage');
    const dominionIds = ownedUndead(sim)
      .filter((servant) => servant.templateId !== 'graveguard')
      .map((servant) => servant.id);

    finishCast(sim, 'army_of_the_dead');

    // The duplicate gate: with a warrior and bone mage standing, the portal
    // raises ONLY the missing Gravewing; the standing pair is never doubled.
    const duringArmy = ownedUndead(sim).filter((servant) => servant.templateId !== 'graveguard');
    const temporary = duringArmy.filter((servant) => servant.despawnTimer !== undefined);
    expect(temporary.map((servant) => servant.templateId)).toEqual(['necromancy_gravewing']);
    expect(dominionIds.every((id) => sim.entities.has(id))).toBe(true);
    expect(temporary.every((servant) => servant.despawnTimer === 20)).toBe(true);
    expect(duringArmy).toHaveLength(3);

    for (let tick = 0; tick < 20 * 21; tick++) sim.tick();
    expect(
      ownedUndead(sim)
        .filter((servant) => servant.templateId !== 'graveguard')
        .map((servant) => servant.templateId),
    ).toEqual(['necromancy_skeletal_warrior', 'necromancy_bone_mage']);
    expect(dominionIds.every((id) => sim.entities.has(id))).toBe(true);
  });

  it('Army of the Dead raises the two missing archetypes around one chosen servant', () => {
    const sim = makeNecromancer();
    addTarget(sim);
    addSoulFragments(sim.ctx, sim.player, 2);
    finishCast(sim, 'raise_gravewing');
    const chosen = ownedUndead(sim).find(
      (servant) => servant.templateId === 'necromancy_gravewing',
    );
    if (!chosen) throw new Error('Expected chosen Gravewing');

    finishCast(sim, 'army_of_the_dead');

    // The chosen Gravewing stays the ONLY Gravewing; the portal supplies the
    // warrior and bone mage it was missing.
    const army = ownedUndead(sim).filter((servant) => servant.templateId !== 'graveguard');
    const temporary = army.filter((servant) => servant.despawnTimer !== undefined);
    expect(temporary.map((servant) => servant.templateId)).toEqual([
      'necromancy_skeletal_warrior',
      'necromancy_bone_mage',
    ]);
    expect(chosen.despawnTimer).toBeUndefined();
    expect(temporary.every((servant) => servant.despawnTimer === 20)).toBe(true);
  });

  it.each([
    ['raise_skeletal_warrior', 1],
    ['raise_bone_mage', 2],
  ] as const)(
    'treats the portal army as all three temporary slots and rejects %s without spending resources',
    (abilityId, fragments) => {
      const sim = makeNecromancer();
      addTarget(sim);

      finishCast(sim, 'army_of_the_dead');
      addSoulFragments(sim as unknown as SimContext, sim.player, fragments);
      sim.player.resource = sim.player.maxResource;
      const manaBefore = sim.player.resource;
      sim.castAbility(abilityId);

      const temporary = ownedUndead(sim).filter((pet) => pet.templateId !== 'graveguard');
      expect(temporary.map((pet) => pet.templateId)).toEqual([
        'necromancy_skeletal_warrior',
        'necromancy_bone_mage',
        'necromancy_gravewing',
      ]);
      expect(fragmentCount(sim.player)).toBe(fragments);
      expect(sim.player.resource).toBe(manaBefore);
    },
  );

  it('reopens the Dominion slots after the portal army expires', () => {
    const sim = makeNecromancer();
    addTarget(sim);

    finishCast(sim, 'army_of_the_dead');
    for (let tick = 0; tick < 20 * 20 + 1; tick++) sim.tick();
    expect(
      ownedUndead(sim).filter((pet) => pet.templateId === 'necromancy_gravewing'),
    ).toHaveLength(0);

    addSoulFragments(sim as unknown as SimContext, sim.player, 1);
    sim.player.resource = sim.player.maxResource;
    const manaBefore = sim.player.resource;
    sim.castAbility('raise_skeletal_warrior');

    const temporary = ownedUndead(sim).filter((pet) => pet.templateId !== 'graveguard');
    expect(temporary.map((pet) => pet.templateId)).toEqual(['necromancy_skeletal_warrior']);
    expect(fragmentCount(sim.player)).toBe(0);
    expect(sim.player.resource).toBe(manaBefore - 20);
  });

  it('despawns the entire portal army immediately when its owner dies', () => {
    const sim = makeNecromancer();
    addTarget(sim);
    finishCast(sim, 'army_of_the_dead');
    const armyIds = ownedUndead(sim)
      .filter((pet) => pet.templateId !== 'graveguard')
      .map((pet) => pet.id);
    expect(armyIds).toHaveLength(3);

    sim.dealDamage(null, sim.player, sim.player.maxHp + 1, false, 'physical', null, 'hit');

    expect(sim.player.dead).toBe(true);
    expect(armyIds.every((id) => !sim.entities.has(id))).toBe(true);
  });

  it('keeps pet damage attributed after owner death despawns the source', () => {
    const sim = makeNecromancer();
    const target = addTarget(sim);
    addSoulFragments(sim.ctx, sim.player, 1);
    finishCast(sim, 'raise_skeletal_warrior');
    const warrior = ownedUndead(sim).find(
      (pet) => pet.templateId === 'necromancy_skeletal_warrior',
    );
    if (!warrior) throw new Error('Expected Skeletal Warrior');
    drain(sim);

    sim.ctx.dealDamage(warrior, target, 17, false, 'physical', 'Dominion Test', 'hit');
    sim.dealDamage(null, sim.player, sim.player.maxHp + 1, false, 'physical', null, 'hit');

    expect(sim.entities.has(warrior.id)).toBe(false);
    expect(
      drain(sim).find((event) => event.type === 'damage' && event.ability === 'Dominion Test'),
    ).toMatchObject({ sourceId: warrior.id, sourceOwnerId: sim.playerId, amount: 17 });
  });

  it('allows pet attack commands to direct Gravewing and the persistent Graveguard', () => {
    const sim = makeNecromancer();
    const target = addTarget(sim);
    finishCast(sim, 'army_of_the_dead');
    const gravewing = ownedUndead(sim).find((pet) => pet.templateId === 'necromancy_gravewing');
    if (!gravewing) throw new Error('Expected Gravewing');
    gravewing.aggroTargetId = null;
    gravewing.inCombat = false;

    sim.petAttack();

    expect(gravewing.aggroTargetId).toBe(target.id);
    expect(gravewing.inCombat).toBe(true);

    finishCast(sim, 'raise_graveguard');
    const graveguard = ownedUndead(sim).find((pet) => pet.templateId === 'graveguard');
    if (!graveguard) throw new Error('Expected a Graveguard');
    for (const pet of [gravewing, graveguard]) {
      pet.aggroTargetId = null;
      pet.inCombat = false;
    }

    sim.petAttack();

    expect(gravewing.aggroTargetId).toBe(target.id);
    expect(graveguard.aggroTargetId).toBe(target.id);
  });

  it('applies the primary pet stance to existing and newly raised Dominion servants', () => {
    const sim = makeNecromancer();
    const target = addTarget(sim);
    finishCast(sim, 'raise_graveguard');
    addSoulFragments(sim.ctx, sim.player, 1);
    finishCast(sim, 'raise_skeletal_warrior');

    for (const servant of ownedUndead(sim)) {
      servant.aggroTargetId = target.id;
      servant.inCombat = true;
      servant.autoAttack = true;
    }
    sim.setPetMode('passive');

    expect(ownedUndead(sim)).not.toHaveLength(0);
    for (const servant of ownedUndead(sim)) {
      expect(servant.petMode).toBe('passive');
      expect(servant.aggroTargetId).toBeNull();
      expect(servant.inCombat).toBe(false);
      expect(servant.autoAttack).toBe(false);
    }

    finishCast(sim, 'army_of_the_dead');
    expect(
      ownedUndead(sim).filter((servant) => servant.templateId !== 'graveguard'),
    ).not.toHaveLength(0);
    expect(ownedUndead(sim).every((servant) => servant.petMode === 'passive')).toBe(true);
  });

  it('Sacrifice Undead consumes a Dominion servant and restores health', () => {
    const sim = makeNecromancer();
    addTarget(sim);
    for (let attempt = 0; attempt < 5 && fragmentCount(sim.player) === 0; attempt++) {
      finishCast(sim, 'soul_harvest');
    }
    finishCast(sim, 'raise_skeletal_warrior');
    expect(ownedUndead(sim).filter((pet) => pet.templateId !== 'graveguard')).toHaveLength(1);
    sim.player.hp = Math.round(sim.player.maxHp * 0.5);
    const hpBefore = sim.player.hp;

    const victim = ownedUndead(sim).find((pet) => pet.templateId !== 'graveguard');
    if (!victim) throw new Error('Expected a Dominion servant');
    drain(sim);
    sim.castAbility('sacrifice_undead');
    const sacrificeFx = drain(sim).find(
      (event) => event.type === 'spellfxAt' && event.fx === 'soulTravel',
    );

    expect(sim.player.cooldowns.has('sacrifice_undead')).toBe(true);
    expect(ownedUndead(sim).filter((pet) => pet.templateId !== 'graveguard')).toHaveLength(0);
    expect(sim.player.hp).toBe(hpBefore + Math.round(sim.player.maxHp * 0.25));
    expect(sacrificeFx).toMatchObject({
      type: 'spellfxAt',
      x: victim.pos.x,
      z: victim.pos.z,
      school: 'shadow',
      fx: 'soulTravel',
      targetId: sim.playerId,
      ability: 'sacrifice_undead',
    });
  });

  it('caps Sacrifice Undead healing at maximum health', () => {
    const sim = makeNecromancer();
    addTarget(sim);
    addSoulFragments(sim as unknown as SimContext, sim.player, 1);
    finishCast(sim, 'raise_skeletal_warrior');
    sim.player.hp = sim.player.maxHp - 1;

    sim.castAbility('sacrifice_undead');

    expect(sim.player.hp).toBe(sim.player.maxHp);
  });

  it('Sacrifice Undead consumes the lowest-health Dominion servant and never the Graveguard', () => {
    const sim = makeNecromancer();
    addTarget(sim);
    for (let attempt = 0; attempt < 5; attempt++) finishCast(sim, 'soul_harvest');
    finishCast(sim, 'raise_graveguard');
    finishCast(sim, 'raise_skeletal_warrior');
    finishCast(sim, 'raise_bone_mage');

    const graveguard = ownedUndead(sim).find((undead) => undead.templateId === 'graveguard');
    const warrior = ownedUndead(sim).find(
      (undead) => undead.templateId === 'necromancy_skeletal_warrior',
    );
    const mage = ownedUndead(sim).find((undead) => undead.templateId === 'necromancy_bone_mage');
    if (!graveguard || !warrior || !mage) throw new Error('Expected all three undead servants');

    graveguard.hp = 1;
    warrior.hp = Math.round(warrior.maxHp * 0.2);
    mage.hp = Math.round(mage.maxHp * 0.4);
    sim.castAbility('sacrifice_undead');

    expect(sim.entities.has(graveguard.id)).toBe(true);
    expect(sim.entities.has(warrior.id)).toBe(false);
    expect(sim.entities.has(mage.id)).toBe(true);
  });

  it('Sacrifice Undead consumes the oldest Dominion servant when health is tied', () => {
    const sim = makeNecromancer();
    addTarget(sim);
    addSoulFragments(sim.ctx, sim.player, 3);
    finishCast(sim, 'raise_skeletal_warrior');
    finishCast(sim, 'raise_bone_mage');

    const servants = ownedUndead(sim)
      .filter(isDominionServant)
      .sort((a, b) => a.id - b.id);
    expect(servants).toHaveLength(2);
    for (const servant of servants) servant.hp = Math.round(servant.maxHp * 0.5);

    sim.castAbility('sacrifice_undead');

    expect(sim.entities.has(servants[0].id)).toBe(false);
    expect(sim.entities.has(servants[1].id)).toBe(true);
  });

  it('does not arm Sacrifice Undead when there is no Dominion servant', () => {
    const sim = makeNecromancer();
    sim.castAbility('sacrifice_undead');

    expect(sim.player.cooldowns.has('sacrifice_undead')).toBe(false);
  });

  it('does not sacrifice the Graveguard when it is the only undead servant', () => {
    const sim = makeNecromancer();
    finishCast(sim, 'raise_graveguard');
    const graveguard = ownedUndead(sim).find((servant) => servant.templateId === 'graveguard');
    if (!graveguard) throw new Error('Expected Graveguard');
    sim.player.hp = Math.round(sim.player.maxHp * 0.5);
    const hpBefore = sim.player.hp;

    sim.castAbility('sacrifice_undead');

    expect(sim.entities.has(graveguard.id)).toBe(true);
    expect(sim.player.hp).toBe(hpBefore);
    expect(sim.player.cooldowns.has('sacrifice_undead')).toBe(false);
  });

  it('dismisses every Necromancy summon when the owner changes specialization', () => {
    const sim = makeNecromancer();
    addSoulFragments(sim as unknown as SimContext, sim.player, 1);
    finishCast(sim, 'raise_graveguard');
    finishCast(sim, 'raise_skeletal_warrior');
    finishCast(sim, 'metamorphosis');
    const summonIds = ownedUndead(sim).map((undead) => undead.id);
    const target = addTarget(sim);
    sim.ctx.applyAura(target, {
      id: 'ossuary_mark',
      name: 'Ossuary Mark',
      kind: 'necromancy_ossuary_mark',
      remaining: 12,
      duration: 12,
      value: 0.2,
      sourceId: sim.playerId,
      school: 'shadow',
    });

    expect(summonIds).toHaveLength(2);
    expect(fragmentCount(sim.player)).toBe(3);
    expect(sim.player.auras.some((aura) => aura.kind === 'form_lich')).toBe(true);
    expect(sim.setSpec('affliction')).toBe(true);

    for (const summonId of summonIds) expect(sim.entities.has(summonId)).toBe(false);
    expect(sim.petOf(sim.playerId, true)).toBeNull();
    expect(fragmentCount(sim.player)).toBe(0);
    expect(sim.player.auras.some((aura) => aura.kind === 'form_lich')).toBe(false);
    expect(target.auras.some((aura) => aura.kind === 'necromancy_ossuary_mark')).toBe(false);
  });

  it('removes Dominion servants immediately when their owner leaves', () => {
    const sim = makeNecromancer();
    addSoulFragments(sim as unknown as SimContext, sim.player, 1);
    finishCast(sim, 'raise_skeletal_warrior');
    const warrior = ownedUndead(sim).find(isDominionServant);
    if (!warrior) throw new Error('Expected a Dominion servant');

    sim.removePlayer(sim.playerId);

    expect(sim.entities.has(warrior.id)).toBe(false);
  });

  it('rejects a persisted Graveguard when restoring into a non-Necromancy build', () => {
    const source = makeNecromancer();
    finishCast(source, 'raise_graveguard');
    const state = source.serializeCharacter(source.playerId);
    if (!state) throw new Error('Expected a character snapshot');
    state.talents = {
      spec: 'affliction',
      rows: { ...(state.talents?.rows ?? {}) },
    };

    const restored = new Sim({
      seed: 43,
      playerClass: 'warlock',
      noPlayer: true,
      autoEquip: true,
    });
    const pid = restored.addPlayer('warlock', 'Restored', { state });

    expect(restored.petOf(pid, true)).toBeNull();
  });

  it('round-trips the persistent Graveguard without serializing Dominion servants', () => {
    const source = makeNecromancer();
    addTarget(source);
    addSoulFragments(source as unknown as SimContext, source.player, 1);
    finishCast(source, 'raise_graveguard');
    finishCast(source, 'raise_skeletal_warrior');
    const state = source.serializeCharacter(source.playerId);
    if (!state) throw new Error('Expected a character snapshot');
    expect(state.pet?.templateId).toBe('graveguard');

    const restored = new Sim({
      seed: 44,
      playerClass: 'warlock',
      noPlayer: true,
      autoEquip: true,
    });
    const pid = restored.addPlayer('warlock', 'Restored', { state });

    expect(restored.petOf(pid, true)?.templateId).toBe('graveguard');
    expect(
      [...restored.entities.values()].filter(
        (entity) => entity.ownerId === pid && entity.templateId === 'necromancy_skeletal_warrior',
      ),
    ).toHaveLength(0);
    expect(restored.serializeCharacter(pid)?.pet?.templateId).toBe('graveguard');
  });

  it('gives slain Dominion servants a bounded corpse lifetime', () => {
    const sim = makeNecromancer();
    addSoulFragments(sim as unknown as SimContext, sim.player, 1);
    finishCast(sim, 'raise_skeletal_warrior');
    const warrior = ownedUndead(sim).find(isDominionServant);
    if (!warrior) throw new Error('Expected a Dominion servant');

    sim.dealDamage(null, warrior, warrior.maxHp + 1, false, 'physical', null, 'hit');
    for (let tick = 0; tick < 20 * 4; tick++) sim.tick();

    expect(sim.entities.has(warrior.id)).toBe(false);
  });

  it('does not inspect the world roster for abilities without Necromancy effects', () => {
    const ctx = {
      get entities() {
        throw new Error('unexpected entity scan');
      },
    } as unknown as SimContext;

    expect(necromancyCastError(ctx, {} as Entity, ABILITIES.shadow_bolt)).toBeNull();
  });

  it('replays the same summon combat deterministically for a fixed seed', () => {
    const run = () => {
      const sim = makeNecromancer(17_031);
      const target = addTarget(sim);
      addSoulFragments(sim as unknown as SimContext, sim.player, 5);
      finishCast(sim, 'raise_graveguard');
      finishCast(sim, 'raise_skeletal_warrior');
      finishCast(sim, 'raise_bone_mage');
      drain(sim);

      const events: SimEvent[] = [];
      for (let tick = 0; tick < 20 * 8; tick++) events.push(...sim.tick());

      return {
        events,
        undead: ownedUndead(sim)
          .sort((a, b) => a.id - b.id)
          .map((entity) => ({
            id: entity.id,
            templateId: entity.templateId,
            hp: entity.hp,
            pos: entity.pos,
            cooldowns: [...entity.cooldowns.entries()],
            aggroTargetId: entity.aggroTargetId,
          })),
        targetHp: target.hp,
      };
    };

    expect(run()).toEqual(run());
  });
});

function isDominionServant(entity: Entity): boolean {
  return entity.templateId !== 'graveguard';
}

// Necromancy sustain and persistent Dominion behavior: deliberate Ossuary Mark
// detonation pays health back (a natural expiry does not), while Reaping Command
// leaves persistent servant lifetimes unchanged.
describe('Necromancy sustain and Dominion persistence', () => {
  function bankOssuaryDamage(sim: Sim, target: Entity, amount: number): void {
    sim.dealDamage(
      sim.player,
      target,
      amount,
      false,
      'shadow',
      'Bank Mark',
      'hit',
      true,
      undefined,
      true,
      false,
      true,
      'bank_mark',
      false,
      undefined,
      true,
    );
  }

  function markedNecromancer(bank: number): { sim: Sim; target: Entity; stored: number } {
    const sim = makeNecromancer();
    const target = addTarget(sim);
    sim.player.hitBonus = 1;
    finishCast(sim, 'ossuary_mark');
    bankOssuaryDamage(sim, target, bank);
    const mark = target.auras.find((aura) => aura.kind === 'necromancy_ossuary_mark');
    if (!mark) throw new Error('Expected an Ossuary Mark');
    return { sim, target, stored: Math.round(mark.damageAccrued ?? 0) };
  }

  function ossuaryHeals(sim: Sim, events: SimEvent[]): Extract<SimEvent, { type: 'heal2' }>[] {
    return events.filter(
      (event): event is Extract<SimEvent, { type: 'heal2' }> =>
        event.type === 'heal2' &&
        event.targetId === sim.playerId &&
        event.ability === 'Ossuary Mark',
    );
  }

  function castReapingCommand(sim: Sim): void {
    sim.player.resource = sim.player.maxResource;
    sim.player.cooldowns.delete('reaping_command');
    sim.player.gcdRemaining = 0;
    addSoulFragments(sim.ctx, sim.player, 2);
    sim.castAbility('reaping_command');
  }

  it('heals the Necromancer for exactly a quarter of the bank on a deliberate detonation', () => {
    const { sim, target, stored } = markedNecromancer(1000);
    expect(stored).toBe(200);
    sim.player.hp = sim.player.maxHp - 100;
    const hpBefore = sim.player.hp;
    const targetHpBefore = target.hp;
    drain(sim);

    sim.castAbility('ossuary_mark');
    const heals = ossuaryHeals(sim, drain(sim));

    expect(target.hp).toBe(targetHpBefore - stored);
    expect(heals).toHaveLength(1);
    expect(heals[0]?.amount).toBe(50);
    expect(heals[0]?.crit).toBe(false);
    expect(heals[0]?.sourceId).toBe(sim.playerId);
    expect(sim.player.hp).toBe(hpBefore + 50);
  });

  it('pays no health back when an Ossuary Mark expires on its own', () => {
    const { sim, target, stored } = markedNecromancer(1000);
    expect(stored).toBe(200);
    sim.player.hp = sim.player.maxHp - 100;
    const targetHpBefore = target.hp;
    drain(sim);

    const events: SimEvent[] = [];
    for (
      let tick = 0;
      tick < 20 * 15 && target.auras.some((aura) => aura.kind === 'necromancy_ossuary_mark');
      tick++
    ) {
      events.push(...sim.tick());
    }

    expect(target.auras.some((aura) => aura.kind === 'necromancy_ossuary_mark')).toBe(false);
    expect(target.hp).toBe(targetHpBefore - stored);
    expect(ossuaryHeals(sim, events)).toHaveLength(0);
  });

  it('never overheals the Necromancer past maximum health on detonation', () => {
    const { sim, stored } = markedNecromancer(1000);
    expect(stored).toBe(200);
    sim.player.hp = sim.player.maxHp - 3;
    drain(sim);

    sim.castAbility('ossuary_mark');
    const heals = ossuaryHeals(sim, drain(sim));

    expect(heals).toHaveLength(1);
    expect(heals[0]?.amount).toBe(3);
    expect(sim.player.hp).toBe(sim.player.maxHp);
  });

  it('keeps persistent Dominion servants free of upkeep timers after Reaping Command', () => {
    const sim = makeNecromancer();
    const primary = addTarget(sim);
    finishCast(sim, 'raise_graveguard');
    for (let fragment = 0; fragment < 5; fragment++) finishCast(sim, 'soul_harvest');
    finishCast(sim, 'raise_skeletal_warrior');
    finishCast(sim, 'raise_bone_mage');
    sim.targetEntity(primary.id);

    const graveguard = ownedUndead(sim).find((undead) => undead.templateId === 'graveguard');
    const temporary = ownedUndead(sim)
      .filter(isDominionServant)
      .sort((a, b) => a.id - b.id);
    if (!graveguard) throw new Error('Expected a Graveguard');
    expect(temporary).toHaveLength(2);
    expect(graveguard.despawnTimer).toBeUndefined();

    expect(temporary.every((undead) => undead.despawnTimer === undefined)).toBe(true);

    castReapingCommand(sim);
    expect(temporary.every((undead) => undead.despawnTimer === undefined)).toBe(true);
    expect(
      temporary.every(
        (undead) => !undead.auras.some((aura) => aura.id === 'reaping_command_upkeep'),
      ),
    ).toBe(true);
    expect(graveguard.despawnTimer).toBeUndefined();

    castReapingCommand(sim);
    expect(temporary.every((undead) => undead.despawnTimer === undefined)).toBe(true);
    expect(graveguard.despawnTimer).toBeUndefined();
  });
});
