import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  AFFLICTION_DOOM_DURATION,
  AFFLICTION_DOOM_MAX,
  AFFLICTION_EYE_DEATH_GAIN,
  consumeDoom,
  doomValue,
  FATE_THREAD_DURATION,
  FATE_THREAD_MAX,
  FATE_THREAD_SENTENCE_DAMAGE_PER_STACK,
  gainDoom,
  JUDGMENT_SENTENCE_DAMAGE_MULT,
  maledictGazeDamage,
  onAfflictionDamage,
  possessedSentenceEchoMultiplier,
  resolveNeedleOfFate,
  resolveSentence,
  SENTENCE_THREAT_MULT,
  sentenceBaseDamage,
  sentenceEndgameDamageMultiplier,
} from '../src/sim/combat/affliction';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import { emptyModifiers } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { abilityScalingPower, channelTickBonus } from '../src/sim/spell_scaling';
import type { Entity, SimEvent } from '../src/sim/types';

function makeAffliction(seed = 42): Sim {
  const sim = new Sim({ seed, playerClass: 'warlock', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.setSpec('affliction')).toBe(true);
  sim.player.resource = sim.player.maxResource;
  sim.player.hitBonus = 1;
  return sim;
}

function addTarget(sim: Sim, z = 10): Entity {
  const target = createMob(
    (sim as unknown as { nextId: number }).nextId++,
    MOBS.ridge_stalker,
    20,
    {
      x: sim.player.pos.x,
      y: sim.player.pos.y,
      z: sim.player.pos.z + z,
    },
  );
  target.maxHp = 100_000;
  target.hp = target.maxHp;
  target.weapon.min = 0;
  target.weapon.max = 0;
  target.weapon.speed = 1000;
  target.swingTimer = 1000;
  target.moveSpeed = 0;
  target.hostile = true;
  sim.addEntity(target);
  return target;
}

function ctx(sim: Sim): SimContext {
  return (sim as unknown as { ctx: SimContext }).ctx;
}

function finishCast(sim: Sim, abilityId: string, target?: Entity): SimEvent[] {
  if (target) sim.targetEntity(target.id);
  sim.player.resource = sim.player.maxResource;
  sim.castAbility(abilityId);
  const events: SimEvent[] = [];
  for (let i = 0; i < 20 * 10 && sim.player.castingAbility; i++) events.push(...sim.tick());
  for (let i = 0; i < 40 && sim.player.gcdRemaining > 0; i++) events.push(...sim.tick());
  for (let i = 0; i < 200 && ctx(sim).pendingProjectiles.length > 0; i++)
    events.push(...sim.tick());
  return events;
}

function eye(target: Entity, sourceId: number, secondary = false): boolean {
  return target.auras.some(
    (aura) =>
      aura.sourceId === sourceId &&
      aura.kind === (secondary ? 'affliction_eye_secondary' : 'affliction_eye'),
  );
}

function fateThreads(target: Entity, sourceId: number): number {
  return (
    target.auras.find(
      (aura) => aura.sourceId === sourceId && aura.kind === 'affliction_fate_threads',
    )?.stacks ?? 0
  );
}

function doomRemaining(player: Entity): number {
  return player.auras.find((aura) => aura.kind === 'affliction_doom')?.remaining ?? 0;
}

// Kills through the real damage path so the death runs the whole dealDamage ->
// handleDeath teardown, not a hand-set hp/dead pair.
function kill(sim: Sim, target: Entity): void {
  ctx(sim).dealDamage(
    sim.player,
    target,
    target.maxHp * 5,
    false,
    'shadow',
    'Sentence',
    'hit',
    true,
  );
}

function sentenceBursts(events: readonly SimEvent[]): SimEvent[] {
  return events.filter((event) => event.type === 'spellfx' && event.fx === 'sentenceBurst');
}

describe('Affliction Warlock', () => {
  it('unlocks the complete Condemnation kit across levels 5 to 20', () => {
    const at = (level: number) =>
      abilitiesKnownAt('warlock', level, {
        ...emptyModifiers(),
        spec: 'affliction',
      }).map((known) => known.def.id);

    expect(at(4)).not.toContain('evil_eye');
    expect(at(5)).toEqual(
      expect.arrayContaining(['evil_eye', 'maledict_gaze', 'needle_of_fate', 'sentence']),
    );
    expect(ABILITIES.maledict_gaze.passive).toBe(true);
    expect(at(7)).toContain('cursed_accomplice');
    expect(at(6)).not.toContain('drain_life');
    expect(at(7)).toContain('drain_life');
    expect(at(7)).not.toContain('searing_pain');
    expect(at(7)).not.toContain('litany_of_guilt');
    expect(at(8)).toContain('litany_of_guilt');
    expect(at(9)).toContain('cruel_pact');
    expect(at(11)).toContain('litany_of_guilt');
    expect(at(12)).toContain('hex_of_violence');
    expect(at(13)).toContain('life_tap');
    expect(at(13)).toContain('possess_evil_eye');
    expect(at(14)).not.toContain('life_tap');
    expect(at(14)).toContain('vicarious_suffering');
    expect(at(16)).not.toContain('coven');
    expect(at(17)).toContain('coven');
    expect(at(19)).not.toContain('hour_of_judgment');
    expect(at(20)).toContain('hour_of_judgment');
    expect(at(20)).not.toContain('curse_of_agony');
    expect(at(20)).not.toEqual(
      expect.arrayContaining([
        'shadow_bolt',
        'immolate',
        'corruption',
        'curse_of_agony',
        'siphon_life',
        'summon_imp',
        'summon_voidwalker',
        'summon_succubus',
        'summon_felhunter',
        'summon_felguard',
        'summon_infernal',
        'summon_doomguard',
      ]),
    );
  });

  it('authors Consume as a three-second, three-pulse channel with proportional mana costs', () => {
    expect(ABILITIES.drain_life).toMatchObject({
      cost: 25,
      channel: { duration: 3, ticks: 3 },
      ranks: [
        { rank: 2, level: 14, cost: 35 },
        { rank: 3, level: 20, cost: 45 },
      ],
    });
  });

  it('rate-caps the enemy-action doom stream to one gain per eye per second', () => {
    const sim = makeAffliction();
    const target = addTarget(sim);
    finishCast(sim, 'evil_eye', target);
    expect(eye(target, sim.player.id)).toBe(true);
    const doom = () =>
      sim.player.auras.find((aura) => aura.kind === 'affliction_doom')?.stacks ?? 0;

    // Act: the marked enemy deals damage twice at the same instant.
    onAfflictionDamage(ctx(sim), target, sim.player, 10);
    const afterFirst = doom();
    expect(afterFirst).toBeGreaterThan(0);
    onAfflictionDamage(ctx(sim), target, sim.player, 10);

    // Assert: the second same-second event is inside the lockout and grants nothing.
    expect(doom()).toBe(afterFirst);

    // A second later the stream flows again (delta-based: other doom arms may
    // trickle during the ticks, so compare around the third event only).
    for (let i = 0; i < 21; i++) sim.tick();
    const beforeThird = doom();
    onAfflictionDamage(ctx(sim), target, sim.player, 10);
    expect(doom()).toBeGreaterThan(beforeThird);
  });

  it('pins the level-20 Needle and Maledict Gaze damage floor', () => {
    expect(ABILITIES.needle_of_fate.ranks?.find((rank) => rank.rank === 3)).toMatchObject({
      level: 20,
      effects: [{ type: 'afflictionNeedle' }, { type: 'directDamage', min: 41, max: 49 }],
    });
    expect(maledictGazeDamage(19)).toBe(9);
    expect(maledictGazeDamage(20)).toBe(10);
  });

  it('turns Condemnation gains into bounded Litany cleave around the primary Eye', () => {
    const sim = makeAffliction();
    const primary = addTarget(sim, 10);
    const nearby = [11, 12, 13, 17.9, 18.1].map((z) => addTarget(sim, z));

    finishCast(sim, 'evil_eye', primary);
    finishCast(sim, 'litany_of_guilt', primary);
    const litany = sim.player.auras.find((aura) => aura.kind === 'affliction_litany');
    // Rank 1 is the early level 8 cleave; ranks 2 and 3 keep the values Litany
    // carried at 11 and 20 before the early rank existed.
    expect(ABILITIES.litany_of_guilt.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'afflictionLitany', damage: 5, maxTargets: 2 }),
      ]),
    );
    expect(ABILITIES.litany_of_guilt.ranks?.[0]?.level).toBe(11);
    expect(ABILITIES.litany_of_guilt.ranks?.[0]?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'afflictionLitany', damage: 9, maxTargets: 4 }),
      ]),
    );
    expect(ABILITIES.litany_of_guilt.ranks?.[1]?.level).toBe(20);
    expect(ABILITIES.litany_of_guilt.ranks?.[1]?.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'afflictionLitany', damage: 14 })]),
    );
    expect(litany?.duration).toBe(8);
    // 14 authored, 15 resolved: the Hexcraft mastery covers Litany now.
    expect(litany?.value).toBe(15);
    expect(litany?.value2).toBe(8);
    expect(litany?.value3).toBe(4);
    const friendly = addTarget(sim, 11.5);
    friendly.hostile = false;
    const dead = addTarget(sim, 12.5);
    dead.hp = 0;
    dead.dead = true;
    dead.corpseTimer = 999;
    sim.drainEvents();

    const hpBefore = new Map(nearby.map((target) => [target.id, target.hp]));
    gainDoom(ctx(sim), sim.player, 5);
    const events = sim.drainEvents();
    const litanyHits = events.filter(
      (event): event is Extract<SimEvent, { type: 'damage' }> =>
        event.type === 'damage' && event.ability === 'Litany of Guilt',
    );

    expect(doomValue(sim.player)).toBe(5);
    expect(litanyHits).toHaveLength(4);
    expect(new Set(litanyHits.map((event) => event.amount))).toEqual(new Set([15]));
    expect(new Set(litanyHits.map((event) => event.targetId))).toEqual(
      new Set(nearby.slice(0, 4).map((target) => target.id)),
    );
    expect(nearby.slice(0, 4).every((target) => target.hp < (hpBefore.get(target.id) ?? 0))).toBe(
      true,
    );
    expect(nearby[4].hp).toBe(hpBefore.get(nearby[4].id));
    expect(litanyHits.some((event) => event.targetId === primary.id)).toBe(false);
    expect(litanyHits.some((event) => event.targetId === friendly.id)).toBe(false);
    expect(litanyHits.some((event) => event.targetId === dead.id)).toBe(false);

    sim.drainEvents();
    gainDoom(ctx(sim), sim.player, 3);
    expect(
      sim
        .drainEvents()
        .filter((event) => event.type === 'damage' && event.ability === 'Litany of Guilt'),
    ).toHaveLength(0);

    for (let tick = 0; tick < 19; tick++) sim.tick();
    sim.drainEvents();
    gainDoom(ctx(sim), sim.player, 3);
    expect(
      sim
        .drainEvents()
        .filter((event) => event.type === 'damage' && event.ability === 'Litany of Guilt'),
    ).toHaveLength(0);

    sim.tick();
    sim.drainEvents();
    gainDoom(ctx(sim), sim.player, 3);
    expect(
      sim
        .drainEvents()
        .filter((event) => event.type === 'damage' && event.ability === 'Litany of Guilt'),
    ).toHaveLength(4);
  });

  it('refuses Litany away from the primary Evil Eye before charging mana or cooldown', () => {
    const sim = makeAffliction();
    const primary = addTarget(sim, 10);
    const unmarked = addTarget(sim, 12);
    finishCast(sim, 'evil_eye', primary);
    sim.targetEntity(unmarked.id);
    sim.player.gcdRemaining = 0;
    sim.player.resource = sim.player.maxResource;
    const manaBefore = sim.player.resource;

    sim.castAbility('litany_of_guilt');

    expect(sim.player.resource).toBe(manaBefore);
    expect(sim.player.cooldowns.has('litany_of_guilt')).toBe(false);
    expect(sim.player.auras.some((aura) => aura.kind === 'affliction_litany')).toBe(false);
  });

  it('has the Maledict Eye attack only the selected primary Evil Eye with its own ray', () => {
    const sim = makeAffliction();
    const target = addTarget(sim, 8);
    finishCast(sim, 'evil_eye', target);
    const currentTarget = addTarget(sim, 10);
    sim.drainEvents();
    sim.player.inCombat = true;
    sim.player.combatTimer = 0;
    target.inCombat = true;
    currentTarget.inCombat = true;
    sim.targetEntity(currentTarget.id);
    const primaryEye = target.auras.find((aura) => aura.kind === 'affliction_eye');
    if (!primaryEye) throw new Error('Expected primary Evil Eye');
    primaryEye.tickTimer = 0.05;
    const hpBefore = target.hp;
    const events: SimEvent[] = [];

    events.push(...sim.tick());

    expect(hpBefore - target.hp).toBe(maledictGazeDamage(sim.player.level));
    expect(
      events.some(
        (event) =>
          event.type === 'spellfx' &&
          event.fx === 'evilEyeGaze' &&
          event.sourceId === sim.playerId &&
          event.targetId === target.id &&
          event.ability === 'maledict_gaze',
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === 'spellfx' &&
          event.fx === 'projectile' &&
          event.ability === 'maledict_gaze',
      ),
    ).toBe(false);
  });

  it('does not let the Maledict Eye auto-pull or attack a secondary Coven eye', () => {
    const sim = makeAffliction();
    const primary = addTarget(sim, 25);
    const secondary = addTarget(sim, 27);
    finishCast(sim, 'evil_eye', primary);
    finishCast(sim, 'coven', primary);
    sim.drainEvents();
    sim.player.inCombat = false;
    sim.player.targetId = null;
    const primaryHp = primary.hp;
    const secondaryHp = secondary.hp;

    for (let i = 0; i < 60; i++) sim.tick();

    expect(primary.hp).toBe(primaryHp);
    expect(secondary.hp).toBe(secondaryHp);
  });

  it('does not auto-pull a fresh Eye while fighting elsewhere', () => {
    const sim = makeAffliction();
    const marked = addTarget(sim, 8);
    finishCast(sim, 'evil_eye', marked);
    marked.pos.z = sim.player.pos.z + 25;
    marked.prevPos = { ...marked.pos };
    marked.spawnPos = { ...marked.pos };
    marked.inCombat = false;
    marked.aggroTargetId = null;
    marked.threat.clear();
    const engaged = addTarget(sim, 8);
    sim.player.inCombat = true;
    engaged.inCombat = true;
    sim.targetEntity(marked.id);
    const primaryEye = marked.auras.find((aura) => aura.kind === 'affliction_eye');
    if (!primaryEye) throw new Error('Expected primary Evil Eye');
    const hpBefore = marked.hp;

    primaryEye.tickTimer = 0.05;
    sim.tick();
    expect(marked.hp).toBe(hpBefore);
  });

  it('doubles Maledict Gaze attack speed during Possess the Evil Eye', () => {
    const gazeCount = (possessed: boolean): number => {
      const sim = makeAffliction(possessed ? 920 : 919);
      const target = addTarget(sim, 8);
      finishCast(sim, 'evil_eye', target);
      if (possessed) finishCast(sim, 'possess_evil_eye', target);
      sim.drainEvents();
      sim.player.inCombat = true;
      sim.player.combatTimer = 0;
      sim.targetEntity(target.id);
      const primaryEye = target.auras.find((aura) => aura.kind === 'affliction_eye');
      if (!primaryEye) throw new Error('Expected primary Evil Eye');
      primaryEye.tickTimer = possessed ? 1.25 : 2.5;
      const events: SimEvent[] = [];
      for (let i = 0; i < 50; i++) events.push(...sim.tick());
      return events.filter((event) => event.type === 'spellfx' && event.fx === 'evilEyeGaze')
        .length;
    };

    expect(gazeCount(false)).toBe(1);
    expect(gazeCount(true)).toBe(2);
  });

  it('turns Possess the Evil Eye into a 15 sec off-GCD burst window', () => {
    const sim = makeAffliction();
    const target = addTarget(sim, 8);
    finishCast(sim, 'evil_eye', target);
    gainDoom(ctx(sim), sim.player, 40);
    sim.player.gcdRemaining = 0;
    sim.player.resource = sim.player.maxResource;
    const mana = sim.player.resource;
    sim.player.gcdRemaining = 1;
    sim.targetEntity(target.id);
    sim.castAbility('possess_evil_eye');

    const possession = sim.player.auras.find((aura) => aura.kind === 'affliction_possession');
    expect(possession?.remaining).toBe(15);
    expect(sim.player.resource).toBe(mana - 75);
    expect(sim.player.cooldowns.get('possess_evil_eye')).toBe(45);
    expect(doomValue(sim.player)).toBe(75);
    expect(sim.player.gcdRemaining).toBe(1);
  });

  it('opens Hour of Judgment with three Threads, Possession, and accelerated Condemnation', () => {
    const sim = makeAffliction();
    const target = addTarget(sim, 8);
    finishCast(sim, 'evil_eye', target);
    sim.player.gcdRemaining = 1;
    sim.player.resource = sim.player.maxResource;
    sim.targetEntity(target.id);

    expect(ABILITIES.hour_of_judgment).toMatchObject({
      cost: 0,
      castTime: 0,
      cooldown: 90,
      offGcd: true,
      range: 30,
      requiresTarget: true,
      effects: [{ type: 'afflictionJudgment', duration: 15, doom: 40, refund: 50 }],
    });

    sim.castAbility('hour_of_judgment');

    expect(sim.player.cooldowns.get('hour_of_judgment')).toBe(90);
    expect(sim.player.gcdRemaining).toBe(1);
    expect(doomValue(sim.player)).toBe(40);
    expect(fateThreads(target, sim.playerId)).toBe(3);
    expect(target.auras.find((aura) => aura.kind === 'affliction_fate_threads')?.id).toBe(
      'needle_of_fate',
    );
    expect(sim.player.auras.find((aura) => aura.kind === 'affliction_judgment')?.remaining).toBe(
      15,
    );
    expect(sim.player.auras.find((aura) => aura.kind === 'affliction_possession')?.remaining).toBe(
      15,
    );

    sim.player.gcdRemaining = 0;
    finishCast(sim, 'needle_of_fate', target);
    expect(doomValue(sim.player)).toBe(58);
  });

  it('does not double Hour of Judgment generation through a secondary Eye', () => {
    const sim = makeAffliction();
    const primary = addTarget(sim, 8);
    const secondary = addTarget(sim, 10);
    finishCast(sim, 'evil_eye', primary);
    finishCast(sim, 'coven', primary);
    expect(eye(secondary, sim.playerId, true)).toBe(true);
    finishCast(sim, 'hour_of_judgment', primary);

    finishCast(sim, 'needle_of_fate', secondary);

    expect(doomValue(sim.player)).toBe(45);
  });

  it('refunds 50 Condemnation from only the first Sentence during Hour of Judgment', () => {
    const sim = makeAffliction(44);
    const target = addTarget(sim, 8);
    finishCast(sim, 'evil_eye', target);
    finishCast(sim, 'hour_of_judgment', target);
    gainDoom(ctx(sim), sim.player, 40);

    finishCast(sim, 'sentence', target);
    expect(doomValue(sim.player)).toBe(50);

    gainDoom(ctx(sim), sim.player, 30);
    finishCast(sim, 'sentence', target);
    expect(doomValue(sim.player)).toBe(0);
  });

  it('increases Sentence damage by 20% throughout Hour of Judgment', () => {
    const sentenceHit = (judgment: boolean): number => {
      const sim = makeAffliction(1944);
      const target = addTarget(sim, 8);
      finishCast(sim, 'evil_eye', target);
      if (judgment) {
        sim.player.auras.push({
          id: 'hour_of_judgment',
          name: 'Hour of Judgment',
          kind: 'affliction_judgment',
          remaining: 15,
          duration: 15,
          value: 50,
          charges: 0,
          sourceId: sim.playerId,
          school: 'shadow',
        });
      }
      gainDoom(ctx(sim), sim.player, 50);
      const hpBefore = target.hp;

      resolveSentence(ctx(sim), sim.player, target, 'Sentence');

      return hpBefore - target.hp;
    };

    expect(JUDGMENT_SENTENCE_DAMAGE_MULT).toBe(1.2);
    expect(sentenceHit(true) / sentenceHit(false)).toBe(1.2);
  });

  it('refuses Hour of Judgment unless the selected enemy bears the primary Evil Eye', () => {
    const sim = makeAffliction();
    const marked = addTarget(sim, 8);
    const unmarked = addTarget(sim, 10);
    finishCast(sim, 'evil_eye', marked);
    sim.player.gcdRemaining = 0;
    sim.targetEntity(unmarked.id);

    sim.castAbility('hour_of_judgment');

    expect(sim.player.cooldowns.has('hour_of_judgment')).toBe(false);
    expect(sim.player.auras.some((aura) => aura.kind === 'affliction_judgment')).toBe(false);
    expect(doomValue(sim.player)).toBe(0);
  });

  it('refuses possession unless the selected enemy bears the primary Evil Eye', () => {
    const sim = makeAffliction();
    const marked = addTarget(sim, 8);
    const unmarked = addTarget(sim, 10);
    finishCast(sim, 'evil_eye', marked);
    sim.player.gcdRemaining = 0;
    sim.player.resource = sim.player.maxResource;
    const mana = sim.player.resource;

    sim.targetEntity(unmarked.id);
    sim.castAbility('possess_evil_eye');

    expect(sim.player.resource).toBe(mana);
    expect(sim.player.cooldowns.has('possess_evil_eye')).toBe(false);
    expect(sim.player.auras.some((aura) => aura.kind === 'affliction_possession')).toBe(false);
  });

  it('accelerates Needle of Fate and grants 2 extra Condemnation while possessed', () => {
    const sim = makeAffliction();
    const target = addTarget(sim, 8);
    finishCast(sim, 'evil_eye', target);
    sim.player.gcdRemaining = 0;
    sim.player.resource = sim.player.maxResource;
    sim.targetEntity(target.id);
    sim.castAbility('possess_evil_eye');
    sim.player.gcdRemaining = 0;

    sim.castAbility('needle_of_fate');

    expect(sim.player.castingAbility).toBe('needle_of_fate');
    expect(sim.player.castTotal).toBeCloseTo(1, 5);
    while (sim.player.castingAbility) sim.tick();
    for (let i = 0; i < 200 && ctx(sim).pendingProjectiles.length > 0; i++) sim.tick();
    expect(doomValue(sim.player)).toBe(44);
  });

  it('keeps Consume channeling while moving during possession', () => {
    const sim = makeAffliction();
    const target = addTarget(sim, 8);
    finishCast(sim, 'evil_eye', target);
    sim.player.gcdRemaining = 0;
    sim.player.resource = sim.player.maxResource;
    sim.targetEntity(target.id);
    sim.castAbility('possess_evil_eye');
    sim.player.gcdRemaining = 0;
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('drain_life');
    expect(sim.player.castingAbility).toBe('drain_life');

    sim.moveInput.forward = true;
    sim.tick();

    expect(sim.player.castingAbility).toBe('drain_life');
  });

  it('delays the level-scaled Sentence discharge without rebounding it through Coven', () => {
    const sim = makeAffliction();
    const primary = addTarget(sim, 8);
    const secondary = addTarget(sim, 10);
    finishCast(sim, 'evil_eye', primary);
    finishCast(sim, 'coven', primary);
    sim.player.cooldowns.delete('possess_evil_eye');
    sim.player.gcdRemaining = 0;
    sim.player.resource = sim.player.maxResource;
    sim.targetEntity(primary.id);
    sim.castAbility('possess_evil_eye');
    sim.player.gcdRemaining = 0;
    gainDoom(ctx(sim), sim.player, 20);
    const secondaryHp = secondary.hp;

    sim.castAbility('sentence');
    const sentenceEvents: SimEvent[] = [];
    for (let i = 0; i < 200 && ctx(sim).pendingProjectiles.length > 0; i++)
      sentenceEvents.push(...sim.tick());
    const initialPrimaryDamage = sentenceEvents
      .filter(
        (event) =>
          event.type === 'damage' &&
          event.targetId === primary.id &&
          event.ability === 'Sentence' &&
          event.amount > 0,
      )
      .reduce((sum, event) => sum + (event.type === 'damage' ? event.amount : 0), 0);
    const secondaryAfterSentence = secondary.hp;
    expect(initialPrimaryDamage).toBeGreaterThan(0);
    expect(secondaryHp - secondaryAfterSentence).toBeGreaterThan(0);
    expect(sentenceBursts(sentenceEvents)).toHaveLength(1);

    const delayedEvents: SimEvent[] = [];
    for (let i = 0; i < 20; i++) delayedEvents.push(...sim.tick());

    expect(
      delayedEvents
        .filter(
          (event) =>
            event.type === 'damage' &&
            event.targetId === primary.id &&
            event.ability === 'Demonic Sentence',
        )
        .reduce((sum, event) => sum + (event.type === 'damage' ? event.amount : 0), 0),
    ).toBe(Math.round(initialPrimaryDamage * possessedSentenceEchoMultiplier(sim.player.level)));
    expect(secondary.hp).toBe(secondaryAfterSentence);
    expect(sentenceBursts(delayedEvents)).toHaveLength(0);
  });

  it('increases the primary Sentence hit by exactly 25% during Possession', () => {
    const sentenceHit = (possessed: boolean): number => {
      const sim = makeAffliction(1942);
      const target = addTarget(sim, 8);
      finishCast(sim, 'evil_eye', target);
      if (possessed) finishCast(sim, 'possess_evil_eye', target);
      consumeDoom(ctx(sim), sim.player);
      gainDoom(ctx(sim), sim.player, 50);
      const hpBefore = target.hp;

      resolveSentence(ctx(sim), sim.player, target, 'Sentence');

      return hpBefore - target.hp;
    };

    expect(sentenceHit(true) / sentenceHit(false)).toBe(1.25);
  });

  it('moves one primary Evil Eye without refreshing Condemnation', () => {
    const sim = makeAffliction();
    const first = addTarget(sim, 8);
    const second = addTarget(sim, 12);
    gainDoom(ctx(sim), sim.player, 40);
    const before = sim.player.auras.find((aura) => aura.kind === 'affliction_doom')?.remaining;

    finishCast(sim, 'evil_eye', first);
    const afterFirst = sim.player.auras.find((aura) => aura.kind === 'affliction_doom')?.remaining;
    finishCast(sim, 'evil_eye', second);
    const afterSecond = sim.player.auras.find((aura) => aura.kind === 'affliction_doom')?.remaining;

    expect(eye(first, sim.playerId)).toBe(false);
    expect(eye(second, sim.playerId)).toBe(true);
    expect(afterFirst).toBeLessThan(before ?? 0);
    expect(afterSecond).toBeLessThan(afterFirst ?? 0);
  });

  it('applies Evil Eye immediately without a projectile or resist roll', () => {
    const sim = makeAffliction();
    const target = addTarget(sim);
    target.level = 60;
    sim.player.hitBonus = 0;
    const chance = vi.spyOn(ctx(sim).rng, 'chance').mockReturnValue(false);

    sim.targetEntity(target.id);
    sim.castAbility('evil_eye');
    const events = sim.drainEvents();

    expect(eye(target, sim.playerId)).toBe(true);
    expect(ctx(sim).pendingProjectiles).toHaveLength(0);
    expect(chance).not.toHaveBeenCalled();
    expect(
      events.some(
        (event) =>
          event.type === 'spellfx' &&
          event.sourceId === sim.playerId &&
          event.targetId === target.id &&
          event.fx === 'projectile',
      ),
    ).toBe(false);
    expect(
      events.some(
        (event) =>
          event.type === 'damage' &&
          event.sourceId === sim.playerId &&
          (event.kind === 'miss' || event.kind === 'resist'),
      ),
    ).toBe(false);
  });

  it('lets Needle auto-mark only when no eye exists and awards 7 Condemnation', () => {
    const sim = makeAffliction();
    const first = addTarget(sim, 8);
    const second = addTarget(sim, 12);

    const events = finishCast(sim, 'needle_of_fate', first);
    expect(eye(first, sim.playerId)).toBe(true);
    expect(doomValue(sim.player)).toBe(7);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'spellfx',
        sourceId: sim.playerId,
        targetId: first.id,
        fx: 'projectile',
        ability: 'needle_of_fate',
      }),
    );

    finishCast(sim, 'needle_of_fate', second);
    expect(eye(first, sim.playerId)).toBe(true);
    expect(eye(second, sim.playerId)).toBe(false);
    expect(doomValue(sim.player)).toBe(7);
  });

  it('stacks and refreshes up to three Fate Threads only on the primary Evil Eye', () => {
    const sim = makeAffliction();
    const first = addTarget(sim, 8);
    const second = addTarget(sim, 12);
    finishCast(sim, 'evil_eye', first);

    for (let cast = 0; cast < FATE_THREAD_MAX; cast++) {
      finishCast(sim, 'needle_of_fate', first);
      expect(fateThreads(first, sim.playerId)).toBe(cast + 1);
    }

    const capped = first.auras.find((aura) => aura.kind === 'affliction_fate_threads');
    expect(FATE_THREAD_MAX).toBe(3);
    expect(FATE_THREAD_DURATION).toBe(12);
    expect(capped?.duration).toBe(FATE_THREAD_DURATION);
    if (!capped) throw new Error('Expected Fate Threads');
    capped.remaining = 3;

    resolveNeedleOfFate(ctx(sim), sim.player, first);

    expect(fateThreads(first, sim.playerId)).toBe(FATE_THREAD_MAX);
    expect(capped.remaining).toBe(FATE_THREAD_DURATION);

    finishCast(sim, 'evil_eye', second);

    expect(fateThreads(first, sim.playerId)).toBe(0);
    expect(fateThreads(second, sim.playerId)).toBe(0);
  });

  it('expires Fate Threads after exactly 12 seconds without another Needle', () => {
    const sim = makeAffliction();
    const target = addTarget(sim);
    finishCast(sim, 'evil_eye', target);
    finishCast(sim, 'needle_of_fate', target);
    const threads = target.auras.find((aura) => aura.kind === 'affliction_fate_threads');
    if (!threads) throw new Error('Expected Fate Threads');
    threads.remaining = FATE_THREAD_DURATION;

    for (let tick = 0; tick < FATE_THREAD_DURATION * 20 - 1; tick++) sim.tick();
    expect(fateThreads(target, sim.playerId)).toBe(1);

    sim.tick();

    expect(fateThreads(target, sim.playerId)).toBe(0);
  });

  it('lets Needle claim a new primary Eye after the previous target dies', () => {
    const sim = makeAffliction();
    const first = addTarget(sim, 8);
    const second = addTarget(sim, 12);
    finishCast(sim, 'evil_eye', first);
    ctx(sim).handleDeath(first, sim.player);

    finishCast(sim, 'needle_of_fate', second);

    expect(eye(second, sim.playerId)).toBe(true);
    expect(doomValue(sim.player)).toBe(AFFLICTION_EYE_DEATH_GAIN + 7);
  });

  it('never rebuilds Affliction state from an in-flight Needle after leaving the spec', () => {
    const sim = makeAffliction();
    const target = addTarget(sim, 19);
    sim.targetEntity(target.id);
    sim.player.resource = sim.player.maxResource;
    const hpBefore = target.hp;

    sim.castAbility('needle_of_fate');
    while (sim.player.castingAbility) sim.tick();
    expect(ctx(sim).pendingProjectiles.length).toBeGreaterThan(0);
    expect(sim.setSpec(null)).toBe(true);
    // setSpec recalcs stats and drops the harness's never-resist hitBonus;
    // restore it so a surviving bolt cannot resist (this test is about the
    // state rebuild, not the impact roll).
    sim.player.hitBonus = 1;

    // Composition-dependent arm: on a line that carries the respec-cancels-
    // projectiles rule (cancelPendingProjectilesFrom) the bolt fizzles at the
    // respec and nothing lands; standalone, the bolt still lands for damage.
    // The INVARIANT both arms share, and the point of this test, is below:
    // no Affliction state is ever rebuilt off-spec. The arm taken is pinned
    // to the composition's actual code (a source scan, the repo's guard
    // idiom), so this cannot silently self-fulfill either way.
    const canceledAtRespec = ctx(sim).pendingProjectiles.length === 0;
    const talentsSource = readFileSync(
      new URL('../src/sim/progression/talents.ts', import.meta.url),
      'utf8',
    );
    expect(canceledAtRespec).toBe(talentsSource.includes('cancelPendingProjectilesFrom('));
    for (let tick = 0; tick < 200 && ctx(sim).pendingProjectiles.length > 0; tick++) sim.tick();
    if (canceledAtRespec) expect(target.hp).toBe(hpBefore);
    else expect(target.hp).toBeLessThan(hpBefore);
    expect(eye(target, sim.playerId)).toBe(false);
    expect(fateThreads(target, sim.playerId)).toBe(0);
    expect(doomValue(sim.player)).toBe(0);
  });

  it('clears every owned Affliction mark and Condemnation when leaving the spec', () => {
    const sim = makeAffliction();
    const target = addTarget(sim);
    finishCast(sim, 'evil_eye', target);
    gainDoom(ctx(sim), sim.player, 40);
    sim.player.inCombat = false;

    expect(sim.setSpec(null)).toBe(true);

    expect(doomValue(sim.player)).toBe(0);
    expect(eye(target, sim.playerId)).toBe(false);
  });

  it('caps Condemnation at 100 and loses the whole pool after 20 seconds without generation', () => {
    const sim = makeAffliction();
    gainDoom(ctx(sim), sim.player, 140);
    const doom = sim.player.auras.find((aura) => aura.kind === 'affliction_doom');

    expect(AFFLICTION_DOOM_MAX).toBe(100);
    expect(AFFLICTION_DOOM_DURATION).toBe(20);
    expect(doomValue(sim.player)).toBe(AFFLICTION_DOOM_MAX);
    expect(doom?.remaining).toBe(AFFLICTION_DOOM_DURATION);

    for (let i = 0; i < AFFLICTION_DOOM_DURATION * 20 + 1; i++) sim.tick();
    expect(doomValue(sim.player)).toBe(0);
  });

  it('refreshes the 20 second expiry whenever Condemnation is generated', () => {
    const sim = makeAffliction();
    gainDoom(ctx(sim), sim.player, 10);
    for (let i = 0; i < 10 * 20; i++) sim.tick();

    gainDoom(ctx(sim), sim.player, 1);

    expect(doomValue(sim.player)).toBe(11);
    expect(sim.player.auras.find((aura) => aura.kind === 'affliction_doom')?.remaining).toBe(20);
  });

  it('builds 9 Condemnation from a complete three-tick Consume channel', () => {
    const sim = makeAffliction();
    const target = addTarget(sim);
    finishCast(sim, 'evil_eye', target);

    finishCast(sim, 'drain_life', target);

    expect(doomValue(sim.player)).toBe(9);
  });

  it.each([1, 2, 3])(
    'spends %i Fate Threads at Consume start and adds one Condemnation per Thread per tick',
    (threadCount) => {
      const sim = makeAffliction();
      const target = addTarget(sim);
      finishCast(sim, 'evil_eye', target);
      for (let cast = 0; cast < threadCount; cast++) {
        finishCast(sim, 'needle_of_fate', target);
      }
      consumeDoom(ctx(sim), sim.player);
      const primaryEye = target.auras.find((aura) => aura.kind === 'affliction_eye');
      if (!primaryEye) throw new Error('Expected primary Evil Eye');
      primaryEye.tickTimer = 1000;
      sim.targetEntity(target.id);
      sim.player.resource = sim.player.maxResource;

      sim.castAbility('drain_life');

      expect(fateThreads(target, sim.playerId)).toBe(0);
      expect(
        sim.player.auras.find((aura) => aura.kind === 'affliction_consume_threads')?.stacks,
      ).toBe(threadCount);
      const doomDeltas: number[] = [];
      let previousDoom = doomValue(sim.player);
      for (
        let tick = 0;
        tick < 20 * 7 && (sim.player.castingAbility || ctx(sim).pendingProjectiles.length > 0);
        tick++
      ) {
        sim.tick();
        const currentDoom = doomValue(sim.player);
        if (currentDoom === previousDoom) continue;
        doomDeltas.push(currentDoom - previousDoom);
        previousDoom = currentDoom;
      }

      expect(doomDeltas).toEqual([...Array(3).fill(2 + threadCount), 3]);
      expect(doomValue(sim.player)).toBe(9 + threadCount * 3);
      expect(sim.player.auras.some((aura) => aura.kind === 'affliction_consume_threads')).toBe(
        false,
      );
    },
  );

  it('still spends Fate Threads when Consume is interrupted and does not leak their bonus', () => {
    const sim = makeAffliction();
    const target = addTarget(sim);
    finishCast(sim, 'evil_eye', target);
    for (let cast = 0; cast < FATE_THREAD_MAX; cast++) {
      finishCast(sim, 'needle_of_fate', target);
    }
    consumeDoom(ctx(sim), sim.player);
    const primaryEye = target.auras.find((aura) => aura.kind === 'affliction_eye');
    if (!primaryEye) throw new Error('Expected primary Evil Eye');
    primaryEye.tickTimer = 1000;
    sim.targetEntity(target.id);
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('drain_life');

    ctx(sim).cancelCast(sim.player);

    expect(fateThreads(target, sim.playerId)).toBe(0);
    expect(sim.player.auras.some((aura) => aura.kind === 'affliction_consume_threads')).toBe(false);
    expect(doomValue(sim.player)).toBe(0);
    for (let tick = 0; tick < 40 && sim.player.gcdRemaining > 0; tick++) sim.tick();

    finishCast(sim, 'drain_life', target);

    expect(doomValue(sim.player)).toBe(9);
  });

  it('renders Consume as one sustained green beam without per-tick projectiles', () => {
    const sim = makeAffliction();
    const target = addTarget(sim);
    finishCast(sim, 'evil_eye', target);
    sim.targetEntity(target.id);
    sim.player.resource = sim.player.maxResource;

    sim.castAbility('drain_life');
    const events = sim.tick();
    while (sim.player.castingAbility) events.push(...sim.tick());

    expect(
      events.filter(
        (event) =>
          event.type === 'spellfx' &&
          event.fx === 'drainBeam' &&
          event.sourceId === sim.playerId &&
          event.targetId === target.id &&
          event.duration === 3,
      ),
    ).toHaveLength(1);
    expect(
      events.some(
        (event) =>
          event.type === 'spellfx' && event.fx === 'projectile' && event.sourceId === sim.playerId,
      ),
    ).toBe(false);
    expect(
      events.filter(
        (event) =>
          event.type === 'spellfx' &&
          event.fx === 'drainBeam' &&
          event.sourceId === sim.playerId &&
          event.duration === 0,
      ),
    ).toHaveLength(1);
  });

  it('stops the Consume beam immediately when the channel is cancelled', () => {
    const sim = makeAffliction();
    const target = addTarget(sim);
    finishCast(sim, 'evil_eye', target);
    sim.targetEntity(target.id);
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('drain_life');
    const doomBeforeCancel = doomValue(sim.player);
    const hpBeforeCancel = target.hp;

    ctx(sim).cancelCast(sim.player);
    const events = sim.tick();
    for (let tick = 0; tick < 20 * 6; tick++) events.push(...sim.tick());

    expect(
      events.some(
        (event) =>
          event.type === 'spellfx' &&
          event.fx === 'drainBeam' &&
          event.sourceId === sim.playerId &&
          event.targetId === target.id &&
          event.duration === 0,
      ),
    ).toBe(true);
    expect(sim.player.castingAbility).toBeNull();
    expect(sim.player.channeling).toBe(false);
    expect(doomValue(sim.player)).toBe(doomBeforeCancel);
    expect(
      events.some(
        (event) =>
          event.type === 'damage' &&
          event.targetId === target.id &&
          event.ability === 'Consume' &&
          event.amount > 0,
      ),
    ).toBe(false);
    expect(target.hp).toBeLessThanOrEqual(hpBeforeCancel);
  });

  it('stops the Consume beam when its caster dies', () => {
    const sim = makeAffliction();
    const target = addTarget(sim);
    finishCast(sim, 'evil_eye', target);
    sim.targetEntity(target.id);
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('drain_life');
    sim.tick();

    ctx(sim).handleDeath(sim.player, target);
    const events = sim.tick();

    expect(
      events.some(
        (event) =>
          event.type === 'spellfx' &&
          event.fx === 'drainBeam' &&
          event.sourceId === sim.playerId &&
          event.duration === 0,
      ),
    ).toBe(true);
  });

  it('cancels an active Consume channel when Sentence is cast', () => {
    const sim = makeAffliction();
    const target = addTarget(sim);
    finishCast(sim, 'evil_eye', target);
    gainDoom(ctx(sim), sim.player, 50);
    sim.targetEntity(target.id);
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('drain_life');

    while (sim.player.gcdRemaining > 0) sim.tick();
    expect(sim.player.castingAbility).toBe('drain_life');
    expect(sim.player.channeling).toBe(true);
    sim.drainEvents();

    sim.castAbility('sentence');
    const events = sim.drainEvents();
    for (let tick = 0; tick < 200 && ctx(sim).pendingProjectiles.length > 0; tick++) {
      events.push(...sim.tick());
    }

    expect(sim.player.castingAbility).toBeNull();
    expect(sim.player.channeling).toBe(false);
    expect(doomValue(sim.player)).toBe(0);
    expect(sentenceBursts(events)).toHaveLength(1);
    expect(
      events.some(
        (event) =>
          event.type === 'castStop' && event.entityId === sim.playerId && event.success === false,
      ),
    ).toBe(true);
  });

  it('keeps all 9 Condemnation when the third Consume tick is lethal, plus the Eye death gain', () => {
    const sim = makeAffliction();
    const target = addTarget(sim);
    finishCast(sim, 'evil_eye', target);
    const resolved = ctx(sim).resolvedAbility('drain_life', sim.playerId);
    if (!resolved) throw new Error('Expected Consume');
    const effect = resolved.effects.find((candidate) => candidate.type === 'drainTick');
    if (effect?.type !== 'drainTick') throw new Error('Expected drain tick');
    const tickDamage =
      effect.min + channelTickBonus(abilityScalingPower(sim.player, resolved.def), resolved.def);
    target.hp = tickDamage * 3;
    const primaryEye = target.auras.find((aura) => aura.kind === 'affliction_eye');
    if (!primaryEye) throw new Error('Expected primary Evil Eye');
    primaryEye.tickTimer = 1000;

    finishCast(sim, 'drain_life', target);

    expect(target.dead).toBe(true);
    // Three drain ticks (9) plus the primary Eye death payout: the lethal tick
    // both generates and kills, and the kill pays once.
    expect(doomValue(sim.player)).toBe(9 + AFFLICTION_EYE_DEATH_GAIN);
  });

  it('keeps consecutive long-range Consume completion bonuses isolated', () => {
    const sim = makeAffliction();
    const target = addTarget(sim, 19);
    target.moveSpeed = 0;
    finishCast(sim, 'evil_eye', target);

    for (let channel = 0; channel < 2; channel++) {
      target.pos = {
        x: sim.player.pos.x,
        y: sim.player.pos.y,
        z: sim.player.pos.z + 19,
      };
      sim.player.facing = 0;
      sim.targetEntity(target.id);
      sim.player.resource = sim.player.maxResource;
      sim.castAbility('drain_life');
      expect(sim.player.castingAbility).toBe('drain_life');
      for (let i = 0; i < 20 * 6 && sim.player.castingAbility; i++) sim.tick();
    }
    for (let i = 0; i < 60; i++) sim.tick();

    expect(doomValue(sim.player)).toBe(18);
  });

  it('normalizes an accomplice contribution to one gain every two seconds', () => {
    const sim = makeAffliction();
    const target = addTarget(sim);
    const allyId = sim.addPlayer('warrior', 'Ally');
    const ally = sim.entities.get(allyId);
    if (!ally) throw new Error('Expected ally');
    sim.partyInvite(allyId, sim.playerId);
    sim.partyAccept(allyId);
    ally.pos = { ...sim.player.pos };
    finishCast(sim, 'evil_eye', target);
    finishCast(sim, 'cursed_accomplice', ally);
    expect(
      ally.auras.find(
        (aura) => aura.kind === 'affliction_accomplice' && aura.sourceId === sim.playerId,
      )?.value,
    ).toBe(3);

    ctx(sim).dealDamage(ally, target, 10, false, 'physical', 'Strike', 'hit');
    ctx(sim).dealDamage(ally, target, 10, false, 'physical', 'Strike', 'hit');
    expect(doomValue(sim.player)).toBe(3);

    for (let i = 0; i < 41; i++) sim.tick();
    ctx(sim).dealDamage(ally, target, 10, false, 'physical', 'Strike', 'hit');
    expect(doomValue(sim.player)).toBe(6);
  });

  it('links exactly one grouped accomplice and rejects an external friendly player', () => {
    const sim = makeAffliction();
    const firstId = sim.addPlayer('warrior', 'First accomplice');
    const secondId = sim.addPlayer('mage', 'Second accomplice');
    const outsiderId = sim.addPlayer('priest', 'Outsider');
    const first = sim.entities.get(firstId);
    const second = sim.entities.get(secondId);
    const outsider = sim.entities.get(outsiderId);
    if (!first || !second || !outsider) throw new Error('Expected friendly players');
    for (const ally of [first, second, outsider]) ally.pos = { ...sim.player.pos };
    sim.partyInvite(firstId, sim.playerId);
    sim.partyAccept(firstId);
    sim.partyInvite(secondId, sim.playerId);
    sim.partyAccept(secondId);

    const mana = sim.player.resource;
    sim.targetEntity(outsiderId);
    sim.castAbility('cursed_accomplice');
    expect(sim.player.resource).toBe(mana);
    expect(
      outsider.auras.some(
        (aura) => aura.kind === 'affliction_accomplice' && aura.sourceId === sim.playerId,
      ),
    ).toBe(false);

    finishCast(sim, 'cursed_accomplice', first);
    expect(
      first.auras.some(
        (aura) => aura.kind === 'affliction_accomplice' && aura.sourceId === sim.playerId,
      ),
    ).toBe(true);

    finishCast(sim, 'cursed_accomplice', second);
    expect(
      first.auras.some(
        (aura) => aura.kind === 'affliction_accomplice' && aura.sourceId === sim.playerId,
      ),
    ).toBe(false);
    expect(
      second.auras.filter(
        (aura) => aura.kind === 'affliction_accomplice' && aura.sourceId === sim.playerId,
      ),
    ).toHaveLength(1);
  });

  it('turns marked enemy attacks into Condemnation and Hex of Violence reprisals', () => {
    const sim = makeAffliction();
    const target = addTarget(sim);
    const victimId = sim.addPlayer('warrior', 'Victim');
    const victim = sim.entities.get(victimId);
    if (!victim) throw new Error('Expected victim');
    victim.pos = { ...sim.player.pos };
    finishCast(sim, 'evil_eye', target);
    finishCast(sim, 'hex_of_violence', target);
    const hpBefore = target.hp;

    ctx(sim).dealDamage(target, victim, 10, false, 'physical', 'Claw', 'hit');

    expect(doomValue(sim.player)).toBe(9);
    expect(target.hp).toBe(hpBefore - 16);
    expect(ABILITIES.hex_of_violence.description).toContain('16 Shadow damage');
  });

  it('safely clears Hex of Violence when its reprisal kills the acting enemy', () => {
    const sim = makeAffliction();
    const target = addTarget(sim);
    const victimId = sim.addPlayer('warrior', 'Reprisal Victim');
    const victim = sim.entities.get(victimId);
    if (!victim) throw new Error('Expected victim');
    victim.pos = { ...sim.player.pos };
    finishCast(sim, 'evil_eye', target);
    finishCast(sim, 'hex_of_violence', target);
    target.hp = 10;

    expect(() =>
      ctx(sim).dealDamage(target, victim, 1, false, 'physical', 'Claw', 'hit'),
    ).not.toThrow();
    expect(target.dead).toBe(true);
  });

  it('caps Vicarious Suffering at 15 Condemnation across hostile hits', () => {
    const sim = makeAffliction();
    const attacker = addTarget(sim);
    const allyId = sim.addPlayer('warrior', 'Vicarious Ally');
    const ally = sim.entities.get(allyId);
    if (!ally) throw new Error('Expected ally');
    ally.pos = { ...sim.player.pos };
    finishCast(sim, 'vicarious_suffering', ally);

    for (let hit = 0; hit < 6; hit++) {
      ctx(sim).dealDamage(attacker, ally, 1, false, 'physical', 'Claw', 'hit');
    }

    expect(doomValue(sim.player)).toBe(15);
  });

  it('redirects 20% of allied damage to the warlock while generating Condemnation', () => {
    const sim = makeAffliction();
    const attacker = addTarget(sim);
    const allyId = sim.addPlayer('warrior', 'Protected Ally');
    const ally = sim.entities.get(allyId);
    if (!ally) throw new Error('Expected ally');
    ally.pos = { ...sim.player.pos };
    finishCast(sim, 'vicarious_suffering', ally);
    const allyHp = ally.hp;
    const warlockHp = sim.player.hp;

    ctx(sim).dealDamage(attacker, ally, 100, false, 'physical', 'Claw', 'hit');

    expect(allyHp - ally.hp).toBe(80);
    expect(warlockHp - sim.player.hp).toBe(20);
    expect(doomValue(sim.player)).toBe(3);
  });

  it('turns Vicarious Suffering into 20% personal mitigation when self-cast', () => {
    const sim = makeAffliction();
    const attacker = addTarget(sim);
    sim.player.targetId = null;
    finishCast(sim, 'vicarious_suffering');
    const hp = sim.player.hp;

    ctx(sim).dealDamage(attacker, sim.player, 100, false, 'physical', 'Claw', 'hit');

    expect(hp - sim.player.hp).toBe(80);
    expect(doomValue(sim.player)).toBe(3);
  });

  it('never redirects Vicarious Suffering below 15% health or fabricates mitigation', () => {
    const sim = makeAffliction();
    const attacker = addTarget(sim);
    const allyId = sim.addPlayer('warrior', 'Floor Ally');
    const ally = sim.entities.get(allyId);
    if (!ally) throw new Error('Expected ally');
    ally.pos = { ...sim.player.pos };
    finishCast(sim, 'vicarious_suffering', ally);
    const floor = Math.ceil(sim.player.maxHp * 0.15);
    sim.player.hp = floor + 7;
    const allyHp = ally.hp;

    ctx(sim).dealDamage(attacker, ally, 100, false, 'physical', 'Claw', 'hit');

    expect(sim.player.hp).toBe(floor);
    expect(allyHp - ally.hp).toBe(93);
  });

  it('replaces Hard Bargain with health-paid mana and Condemnation at level 14', () => {
    const sim = makeAffliction();
    const fullHp = sim.player.hp;
    sim.player.resource = 0;

    sim.castAbility('cruel_pact');
    expect(sim.player.hp).toBe(fullHp - Math.round(sim.player.maxHp * 0.12));
    expect(sim.player.resource).toBe(Math.round(sim.player.maxResource * 0.015));
    expect(doomValue(sim.player)).toBe(20);

    for (let i = 0; i < 20 * 20; i++) sim.tick();
    sim.player.hp = Math.floor(sim.player.maxHp * 0.2);
    const mana = sim.player.resource;
    const doom = doomValue(sim.player);
    sim.castAbility('cruel_pact');
    expect(sim.player.hp).toBe(Math.floor(sim.player.maxHp * 0.2));
    expect(sim.player.resource).toBe(mana);
    expect(doomValue(sim.player)).toBe(doom);
  });

  it('spends the full pool with Sentence and scales its damage at 20, 50, 80, and 100', () => {
    expect([20, 50, 80, 100].map(sentenceBaseDamage)).toEqual([138, 400, 620, 910]);
    const losses: number[] = [];
    for (const amount of [20, 50, 80, 100]) {
      const sim = makeAffliction(amount);
      const target = addTarget(sim);
      finishCast(sim, 'evil_eye', target);
      gainDoom(ctx(sim), sim.player, amount);
      const events = finishCast(sim, 'sentence', target);

      expect(sentenceBursts(events)).toEqual([
        {
          type: 'spellfx',
          sourceId: sim.player.id,
          targetId: target.id,
          school: 'shadow',
          fx: 'sentenceBurst',
          level: amount,
        },
      ]);
      losses.push(
        events
          .filter(
            (event) =>
              event.type === 'damage' &&
              event.targetId === target.id &&
              event.ability === 'Sentence',
          )
          .reduce((sum, event) => sum + (event.type === 'damage' ? event.amount : 0), 0),
      );
      expect(doomValue(sim.player)).toBe(0);
    }

    expect(losses).toEqual([83, 242, 375, 551]);
  });

  it('compresses Sentence and its demonic echo only across levels 17 to 20', () => {
    expect([5, 13, 16].map(sentenceEndgameDamageMultiplier)).toEqual([1, 1, 1]);
    expect([17, 18, 19, 20].map(sentenceEndgameDamageMultiplier)).toEqual([
      0.888, 0.775, 0.663, 0.55,
    ]);
    expect([5, 13, 16].map(possessedSentenceEchoMultiplier)).toEqual([0.6, 0.6, 0.6]);
    expect([17, 18, 19, 20].map(possessedSentenceEchoMultiplier)).toEqual([
      0.525, 0.45, 0.375, 0.3,
    ]);
  });

  it('applies every endgame compression step to real Sentence and demonic echo damage', () => {
    const observed = [17, 18, 19].map((level) => {
      const sim = new Sim({ seed: 1900 + level, playerClass: 'warlock', autoEquip: true });
      sim.setPlayerLevel(level);
      expect(sim.setSpec('affliction')).toBe(true);
      sim.player.resource = sim.player.maxResource;
      sim.player.hitBonus = 1;
      const target = addTarget(sim, 8);
      target.level = level;
      finishCast(sim, 'evil_eye', target);
      finishCast(sim, 'possess_evil_eye', target);
      consumeDoom(ctx(sim), sim.player);
      gainDoom(ctx(sim), sim.player, 50);
      const hpBefore = target.hp;

      resolveSentence(ctx(sim), sim.player, target, 'Sentence');
      const primary = hpBefore - target.hp;
      let echo = 0;
      for (let tick = 0; tick < 20; tick++) {
        echo += sim
          .tick()
          .filter((event) => event.type === 'damage' && event.ability === 'Demonic Sentence')
          .reduce((sum, event) => sum + (event.type === 'damage' ? event.amount : 0), 0);
      }

      return { level, primary, echo };
    });

    expect(observed).toEqual([
      { level: 17, primary: 377, echo: 198 },
      { level: 18, primary: 349, echo: 157 },
      { level: 19, primary: 315, echo: 118 },
    ]);
  });

  it('routes Sentence through the Evil Eye at 35% of normal threat', () => {
    const sim = makeAffliction(1943);
    const target = addTarget(sim, 8);
    finishCast(sim, 'evil_eye', target);
    gainDoom(ctx(sim), sim.player, 20);
    const hpBefore = target.hp;
    const threatBefore = target.threat.get(sim.playerId) ?? 0;

    resolveSentence(ctx(sim), sim.player, target, 'Sentence');

    const damage = hpBefore - target.hp;
    expect(SENTENCE_THREAT_MULT).toBe(0.35);
    expect((target.threat.get(sim.playerId) ?? 0) - threatBefore).toBeCloseTo(
      damage * SENTENCE_THREAT_MULT,
      5,
    );
  });

  it('can retain Fate Threads for a stronger Sentence instead of feeding them to Consume', () => {
    const sentenceLoss = (
      threadCount: number,
    ): { loss: number; events: SimEvent[]; sim: Sim; target: Entity } => {
      const sim = makeAffliction(1931);
      const target = addTarget(sim);
      finishCast(sim, 'evil_eye', target);
      for (let thread = 0; thread < threadCount; thread++) {
        finishCast(sim, 'needle_of_fate', target);
      }
      consumeDoom(ctx(sim), sim.player);
      gainDoom(ctx(sim), sim.player, 50);
      sim.player.hitBonus = 1;
      const hpBefore = target.hp;
      const events = finishCast(sim, 'sentence', target);
      return { loss: hpBefore - target.hp, events, sim, target };
    };

    const plain = sentenceLoss(0);
    const threaded = sentenceLoss(3);

    expect(FATE_THREAD_SENTENCE_DAMAGE_PER_STACK).toBe(0.06);
    expect(threaded.loss / plain.loss).toBeGreaterThan(1.15);
    expect(threaded.loss / plain.loss).toBeLessThanOrEqual(1.18);
    expect(sentenceBursts(threaded.events)).toEqual([
      expect.objectContaining({
        type: 'spellfx',
        fx: 'sentenceBurst',
        level: 50,
        threads: 3,
      }),
    ]);
    expect(fateThreads(threaded.target, threaded.sim.playerId)).toBe(0);
  });

  it('refuses to spend Condemnation with Sentence on an enemy outside the Evil Eye', () => {
    const sim = makeAffliction();
    const marked = addTarget(sim, 8);
    const unmarked = addTarget(sim, 12);
    finishCast(sim, 'evil_eye', marked);
    gainDoom(ctx(sim), sim.player, 50);
    const mana = sim.player.resource;

    sim.targetEntity(unmarked.id);
    sim.castAbility('sentence');
    const events = sim.drainEvents();

    expect(doomValue(sim.player)).toBe(50);
    expect(sim.player.resource).toBe(mana);
    expect(sentenceBursts(events)).toHaveLength(0);
    expect(ctx(sim).pendingProjectiles).toHaveLength(0);
  });

  it('refuses Sentence below 20 Condemnation without spending or emitting its verdict', () => {
    const sim = makeAffliction();
    const target = addTarget(sim);
    finishCast(sim, 'evil_eye', target);
    gainDoom(ctx(sim), sim.player, 19);
    const mana = sim.player.resource;
    const hp = target.hp;

    sim.targetEntity(target.id);
    sim.castAbility('sentence');
    const events = sim.drainEvents();

    expect(doomValue(sim.player)).toBe(19);
    expect(sim.player.resource).toBe(mana);
    expect(target.hp).toBe(hp);
    expect(sentenceBursts(events)).toHaveLength(0);
    expect(ctx(sim).pendingProjectiles).toHaveLength(0);
  });

  it('applies Sentence healing, splash, boss bonus, and normal-enemy execution tiers', () => {
    const healingSim = makeAffliction(504);
    const healingTarget = addTarget(healingSim);
    finishCast(healingSim, 'evil_eye', healingTarget);
    healingSim.player.hp = 1;
    gainDoom(ctx(healingSim), healingSim.player, 50);
    finishCast(healingSim, 'sentence', healingTarget);
    expect(healingSim.player.hp).toBe(49);

    const splashSim = makeAffliction(502);
    const splashTarget = addTarget(splashSim, 8);
    const nearby = addTarget(splashSim, 12);
    const distant = addTarget(splashSim, 25);
    finishCast(splashSim, 'evil_eye', splashTarget);
    gainDoom(ctx(splashSim), splashSim.player, 80);
    const nearHp = nearby.hp;
    const farHp = distant.hp;
    finishCast(splashSim, 'sentence', splashTarget);
    expect(nearHp - nearby.hp).toBe(131);
    expect(distant.hp).toBe(farHp);

    const bossSim = makeAffliction(503);
    const boss = createMob((bossSim as unknown as { nextId: number }).nextId++, MOBS.morthen, 20, {
      x: bossSim.player.pos.x,
      y: bossSim.player.pos.y,
      z: bossSim.player.pos.z + 8,
    });
    boss.maxHp = 100_000;
    boss.hp = boss.maxHp;
    bossSim.addEntity(boss);
    finishCast(bossSim, 'evil_eye', boss);
    gainDoom(ctx(bossSim), bossSim.player, 100);
    const bossHp = boss.hp;
    const bossNearby = addTarget(bossSim, 12);
    const bossNearbyHp = bossNearby.hp;
    const bossEvents = finishCast(bossSim, 'sentence', boss);
    expect(
      bossEvents
        .filter(
          (event) =>
            event.type === 'damage' && event.targetId === boss.id && event.ability === 'Sentence',
        )
        .reduce((sum, event) => sum + (event.type === 'damage' ? event.amount : 0), 0),
    ).toBe(579);
    expect(boss.hp).toBeLessThan(bossHp);
    expect(bossNearbyHp - bossNearby.hp).toBe(193);

    const executeSim = makeAffliction(504);
    const executeTarget = addTarget(executeSim);
    finishCast(executeSim, 'evil_eye', executeTarget);
    executeTarget.hp = Math.floor(executeTarget.maxHp * 0.19);
    gainDoom(ctx(executeSim), executeSim.player, 100);
    const executeEvents = finishCast(executeSim, 'sentence', executeTarget);
    expect(executeTarget.dead).toBe(true);
    expect(sentenceBursts(executeEvents)).toEqual([
      expect.objectContaining({
        sourceId: executeSim.playerId,
        targetId: executeTarget.id,
        level: 100,
      }),
    ]);
  });

  it('keeps the level 5 Sentence below its level 20 damage curve', () => {
    const sim = new Sim({ seed: 55, playerClass: 'warlock', autoEquip: true });
    sim.setPlayerLevel(5);
    expect(sim.setSpec('affliction')).toBe(true);
    sim.player.resource = sim.player.maxResource;
    sim.player.hitBonus = 1;
    const target = addTarget(sim);
    target.level = 5;
    finishCast(sim, 'evil_eye', target);
    gainDoom(ctx(sim), sim.player, 20);
    const hpBefore = target.hp;

    finishCast(sim, 'sentence', target);

    expect(hpBefore - target.hp).toBeGreaterThan(0);
    expect(hpBefore - target.hp).toBeLessThan(55);
  });

  it('links Cursed Accomplice to the Eye when no allied player is selected', () => {
    const sim = makeAffliction();
    sim.player.targetId = null;
    const mana = sim.player.resource;

    sim.castAbility('cursed_accomplice');

    expect(sim.player.resource).toBe(mana - 40);
    expect(sim.player.auras).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'affliction_accomplice',
          sourceId: sim.playerId,
          value: 2,
          icdMax: 2,
        }),
      ]),
    );
  });

  it('makes an Eye-linked Maledict Gaze generate 2 Condemnation at most every 2 sec', () => {
    const sim = makeAffliction();
    const target = addTarget(sim, 8);
    finishCast(sim, 'evil_eye', target);
    finishCast(sim, 'cursed_accomplice');
    sim.player.inCombat = true;
    sim.player.combatTimer = 0;
    sim.targetEntity(target.id);
    const primaryEye = target.auras.find((aura) => aura.kind === 'affliction_eye');
    const link = sim.player.auras.find((aura) => aura.kind === 'affliction_accomplice');
    if (!primaryEye || !link) throw new Error('Expected Eye and accomplice link');
    const doomBefore = doomValue(sim.player);
    primaryEye.tickTimer = 0.05;
    link.icd = 0;

    sim.tick();
    expect(doomValue(sim.player)).toBe(doomBefore + 2);

    primaryEye.tickTimer = 0.05;
    sim.tick();
    expect(doomValue(sim.player)).toBe(doomBefore + 2);
  });

  it('doubles Eye-linked Cursed Accomplice generation during Hour of Judgment', () => {
    const sim = makeAffliction();
    const target = addTarget(sim, 8);
    finishCast(sim, 'evil_eye', target);
    finishCast(sim, 'cursed_accomplice');
    finishCast(sim, 'hour_of_judgment', target);
    sim.player.inCombat = true;
    target.inCombat = true;
    const primaryEye = target.auras.find((aura) => aura.kind === 'affliction_eye');
    const link = sim.player.auras.find((aura) => aura.kind === 'affliction_accomplice');
    if (!primaryEye || !link) throw new Error('Expected Eye and accomplice link');
    const doomBefore = doomValue(sim.player);
    primaryEye.tickTimer = 0.05;
    link.icd = 0;

    sim.tick();

    expect(doomValue(sim.player)).toBe(doomBefore + 4);
  });

  it('creates up to four temporary secondary eyes with Coven', () => {
    const sim = makeAffliction();
    const primary = addTarget(sim, 8);
    const secondary = [10, 12, 14, 16, 18].map((z) => addTarget(sim, z));
    finishCast(sim, 'evil_eye', primary);

    finishCast(sim, 'coven', primary);

    expect(eye(primary, sim.playerId)).toBe(true);
    expect(secondary.filter((target) => eye(target, sim.playerId, true))).toHaveLength(4);
  });

  it('applies Coven immediately without a projectile or resist roll', () => {
    const sim = makeAffliction();
    const primary = addTarget(sim, 8);
    const secondary = addTarget(sim, 10);
    finishCast(sim, 'evil_eye', primary);
    sim.player.gcdRemaining = 0;
    sim.player.resource = sim.player.maxResource;
    sim.player.hitBonus = 0;
    primary.level = 60;
    const chance = vi.spyOn(ctx(sim).rng, 'chance').mockReturnValue(false);

    sim.targetEntity(primary.id);
    sim.castAbility('coven');
    const events = sim.drainEvents();

    expect(eye(secondary, sim.playerId, true)).toBe(true);
    expect(ctx(sim).pendingProjectiles).toHaveLength(0);
    expect(chance).not.toHaveBeenCalled();
    expect(
      events.some(
        (event) =>
          event.type === 'spellfx' &&
          event.sourceId === sim.playerId &&
          event.targetId === primary.id &&
          event.fx === 'projectile',
      ),
    ).toBe(false);
    expect(
      events.some(
        (event) =>
          event.type === 'damage' &&
          event.sourceId === sim.playerId &&
          (event.kind === 'miss' || event.kind === 'resist'),
      ),
    ).toBe(false);
  });

  it('halves generation on a secondary Eye and echoes Sentence for 35%', () => {
    const sim = makeAffliction();
    const primary = addTarget(sim, 8);
    const secondary = addTarget(sim, 10);
    finishCast(sim, 'evil_eye', primary);
    finishCast(sim, 'coven', primary);
    expect(eye(secondary, sim.playerId, true)).toBe(true);

    finishCast(sim, 'needle_of_fate', secondary);
    expect(doomValue(sim.player)).toBe(4);
    expect(fateThreads(secondary, sim.playerId)).toBe(0);

    gainDoom(ctx(sim), sim.player, 16);
    const secondaryHp = secondary.hp;
    const events = finishCast(sim, 'sentence', primary);
    expect(secondaryHp - secondary.hp).toBe(29);
    expect(sentenceBursts(events)).toHaveLength(1);
  });

  it('keeps the 100-Condemnation boss bonus out of the Coven echo', () => {
    const sim = makeAffliction(506);
    const boss = createMob((sim as unknown as { nextId: number }).nextId++, MOBS.morthen, 20, {
      x: sim.player.pos.x,
      y: sim.player.pos.y,
      z: sim.player.pos.z + 8,
    });
    boss.maxHp = 100_000;
    boss.hp = boss.maxHp;
    sim.addEntity(boss);
    const secondary = addTarget(sim, 10);

    finishCast(sim, 'evil_eye', boss);
    finishCast(sim, 'coven', boss);
    expect(eye(secondary, sim.playerId, true)).toBe(true);
    secondary.pos.z = sim.player.pos.z + 30;
    gainDoom(ctx(sim), sim.player, 100);
    const secondaryHp = secondary.hp;

    finishCast(sim, 'sentence', boss);

    // Coven echoes 35% of the shared mastery-adjusted verdict, not 35% of the
    // boss-only 20% amplified primary hit. Moving it out of the splash radius
    // isolates the Coven component.
    expect(secondaryHp - secondary.hp).toBe(193);
  });

  it('requires the primary Evil Eye for Sentence and preserves resources on a secondary Eye', () => {
    const sim = makeAffliction();
    const primary = addTarget(sim, 8);
    const secondary = addTarget(sim, 10);
    finishCast(sim, 'evil_eye', primary);
    finishCast(sim, 'coven', primary);
    expect(eye(secondary, sim.playerId, true)).toBe(true);
    gainDoom(ctx(sim), sim.player, 20);
    const primaryHp = primary.hp;
    const secondaryHp = secondary.hp;
    sim.player.resource = sim.player.maxResource;
    const mana = sim.player.resource;

    const events = finishCast(sim, 'sentence', secondary);

    expect(doomValue(sim.player)).toBe(20);
    expect(sim.player.resource).toBe(mana);
    expect(secondary.hp).toBe(secondaryHp);
    expect(primary.hp).toBe(primaryHp);
    expect(sentenceBursts(events)).toHaveLength(0);
  });

  it('halves the complete possessed Needle and Hex generation package on secondary Eyes', () => {
    const sim = makeAffliction();
    const primary = addTarget(sim, 8);
    const secondary = addTarget(sim, 10);
    const victimId = sim.addPlayer('warrior', 'Coven Victim');
    const victim = sim.entities.get(victimId);
    if (!victim) throw new Error('Expected victim');
    victim.pos = { ...sim.player.pos };
    finishCast(sim, 'evil_eye', primary);
    finishCast(sim, 'coven', primary);
    finishCast(sim, 'possess_evil_eye', primary);

    finishCast(sim, 'needle_of_fate', secondary);
    expect(doomValue(sim.player)).toBe(40);

    finishCast(sim, 'hex_of_violence', secondary);
    ctx(sim).dealDamage(secondary, victim, 10, false, 'physical', 'Claw', 'hit');
    expect(doomValue(sim.player)).toBe(45);
  });

  it('feeds Condemnation and refreshes the expiry when a primary Eye target dies', () => {
    const sim = makeAffliction();
    const target = addTarget(sim, 8);
    finishCast(sim, 'evil_eye', target);
    consumeDoom(ctx(sim), sim.player);
    gainDoom(ctx(sim), sim.player, 10);
    for (let i = 0; i < 40; i++) sim.tick();
    const decayed = doomRemaining(sim.player);
    expect(decayed).toBeLessThan(AFFLICTION_DOOM_DURATION);
    expect(doomValue(sim.player)).toBe(10);

    kill(sim, target);

    expect(target.dead).toBe(true);
    expect(doomValue(sim.player)).toBe(10 + AFFLICTION_EYE_DEATH_GAIN);
    expect(doomRemaining(sim.player)).toBe(AFFLICTION_DOOM_DURATION);
  });

  it('pays the primary Eye when a scripted death enters through the shared lifecycle', () => {
    const sim = makeAffliction();
    const target = addTarget(sim, 8);
    finishCast(sim, 'evil_eye', target);

    ctx(sim).handleDeath(target, sim.player);

    expect(target.dead).toBe(true);
    expect(doomValue(sim.player)).toBe(AFFLICTION_EYE_DEATH_GAIN);
  });

  it('halves the Eye death Condemnation on a secondary Coven Eye', () => {
    const sim = makeAffliction();
    const primary = addTarget(sim, 8);
    const secondary = addTarget(sim, 10);
    finishCast(sim, 'evil_eye', primary);
    finishCast(sim, 'coven', primary);
    expect(eye(secondary, sim.playerId, true)).toBe(true);
    consumeDoom(ctx(sim), sim.player);

    kill(sim, secondary);

    expect(secondary.dead).toBe(true);
    expect(primary.dead).toBe(false);
    expect(doomValue(sim.player)).toBe(AFFLICTION_EYE_DEATH_GAIN / 2);
    expect(doomRemaining(sim.player)).toBe(AFFLICTION_DOOM_DURATION);
  });

  it('grants no Condemnation when an enemy without one of the caster Eyes dies', () => {
    const sim = makeAffliction();
    const marked = addTarget(sim, 8);
    const unmarked = addTarget(sim, 12);
    finishCast(sim, 'evil_eye', marked);
    consumeDoom(ctx(sim), sim.player);
    gainDoom(ctx(sim), sim.player, 10);
    for (let i = 0; i < 40; i++) sim.tick();
    const decayed = doomRemaining(sim.player);

    kill(sim, unmarked);

    expect(unmarked.dead).toBe(true);
    expect(doomValue(sim.player)).toBe(10);
    expect(doomRemaining(sim.player)).toBe(decayed);
  });

  it('caps the Eye death Condemnation at the Condemnation maximum', () => {
    const sim = makeAffliction();
    const target = addTarget(sim, 8);
    finishCast(sim, 'evil_eye', target);
    consumeDoom(ctx(sim), sim.player);
    gainDoom(ctx(sim), sim.player, AFFLICTION_DOOM_MAX - 5);

    kill(sim, target);

    expect(target.dead).toBe(true);
    expect(doomValue(sim.player)).toBe(AFFLICTION_DOOM_MAX);
  });

  it('does not echo Sentence into a secondary Eye that is no longer hostile', () => {
    const sim = makeAffliction();
    const primary = addTarget(sim, 8);
    const secondary = addTarget(sim, 10);
    finishCast(sim, 'evil_eye', primary);
    finishCast(sim, 'coven', primary);
    secondary.hostile = false;
    gainDoom(ctx(sim), sim.player, 20);
    const hp = secondary.hp;

    resolveSentence(ctx(sim), sim.player, primary, 'Sentence', 1.1);

    expect(secondary.hp).toBe(hp);
  });
});
