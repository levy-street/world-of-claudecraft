import { describe, expect, it } from 'vitest';
import { isCancelableAura } from '../src/sim/combat/aura_cancel';
import { isInStasis, isStunned } from '../src/sim/combat/cc';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers, emptyAllocation } from '../src/sim/content/talents';
import { MOBS, NPCS } from '../src/sim/data';
import { createMob, createNpc } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import {
  type Aura,
  type Entity,
  TEMPORAL_HOURGLASS_DURATION,
  TEMPORAL_HOURGLASS_HEAL_FRACTION,
} from '../src/sim/types';

const FLAT_X = 700;

function knownIds(spec: 'arcane' | 'fire' | 'frost'): string[] {
  const mods = computeTalentModifiers('mage', { ...emptyAllocation(), spec } as never);
  return abilitiesKnownAt('mage', 14, mods).map((known) => known.def.id);
}

function makeChronomancer(): { sim: Sim; mage: Entity } {
  const sim = new Sim({ seed: 147, playerClass: 'mage' });
  sim.setPlayerLevel(14);
  expect(sim.setSpec('arcane')).toBe(true);
  sim.tick();
  const mage = sim.player;
  mage.pos = sim.groundPos(FLAT_X, 0);
  mage.prevPos = { ...mage.pos };
  mage.resource = mage.maxResource;
  (sim as unknown as { rebucket(e: Entity): void }).rebucket(mage);
  return { sim, mage };
}

function addHostile(sim: Sim, x: number, z = 0, template = MOBS.forest_wolf): Entity {
  const host = sim as unknown as { nextId: number; addEntity(e: Entity): void };
  const mob = createMob(host.nextId++, template, 20, sim.groundPos(x, z));
  mob.hostile = true;
  mob.maxHp = mob.hp = 10_000;
  host.addEntity(mob);
  return mob;
}

function addAlly(sim: Sim, mage: Entity, x: number, grouped = true): Entity {
  const allyId = sim.addPlayer('warrior', `Ally-${x}`);
  const ally = sim.entities.get(allyId);
  if (!ally) throw new Error('ally missing');
  ally.pos = sim.groundPos(x, 0);
  ally.prevPos = { ...ally.pos };
  (sim as unknown as { rebucket(e: Entity): void }).rebucket(ally);
  if (grouped) {
    sim.partyInvite(allyId, mage.id);
    sim.partyAccept(allyId);
  }
  return ally;
}

function castAt(sim: Sim, mage: Entity, x: number, z = 0): void {
  mage.gcdRemaining = 0;
  mage.resource = mage.maxResource;
  mage.cooldowns.delete('temporal_hourglass');
  sim.castAbility('temporal_hourglass', mage.id, { x, z });
}

function hourglassAura(entity: Entity): Aura | undefined {
  return entity.auras.find((aura) => aura.id === 'temporal_hourglass');
}

function advance(sim: Sim, seconds: number): void {
  for (let tick = 0; tick < Math.round(seconds * 20); tick++) sim.tick();
}

describe('Hourglass of Suspension content', () => {
  it('belongs only to Chronomancy and uses provisional ground-targeted balance', () => {
    expect(knownIds('arcane')).toContain('temporal_hourglass');
    expect(knownIds('fire')).not.toContain('temporal_hourglass');
    expect(knownIds('frost')).not.toContain('temporal_hourglass');

    const { sim } = makeChronomancer();
    const resolved = sim.resolvedAbility('temporal_hourglass');
    expect(resolved?.def).toMatchObject({
      class: 'mage',
      specs: ['arcane'],
      targetMode: 'position',
      requiresTarget: false,
      cooldown: 50,
      range: 28,
      learnLevel: 14,
    });
  });
});

describe('Hourglass of Suspension hostile mode', () => {
  it('suspends one valid PvE enemy for sixty seconds without dealing damage', () => {
    const { sim, mage } = makeChronomancer();
    const enemy = addHostile(sim, FLAT_X + 8);
    const second = addHostile(sim, FLAT_X + 8.5);
    const hp = enemy.hp;

    castAt(sim, mage, enemy.pos.x);

    expect(hourglassAura(enemy)).toMatchObject({
      kind: 'incapacitate',
      remaining: 60,
      duration: 60,
      breaksOnDamage: true,
    });
    expect(hourglassAura(second)).toBeUndefined();
    expect(enemy.hp).toBe(hp);
    expect(isStunned(enemy)).toBe(true);
  });

  it('limits suspension against a PvP opponent to ten seconds', () => {
    const { sim, mage } = makeChronomancer();
    const opponent = addAlly(sim, mage, FLAT_X + 8, false);
    sim.duelRequest(opponent.id, mage.id);
    sim.duelAccept(opponent.id);
    for (let tick = 0; tick < 80; tick++) sim.tick();

    castAt(sim, mage, opponent.pos.x);

    expect(hourglassAura(opponent)).toMatchObject({
      kind: 'incapacitate',
      duration: 10,
      remaining: 10,
      breaksOnDamage: true,
    });
  });

  it('uses hostile PvP mode for a dueling party member', () => {
    const { sim, mage } = makeChronomancer();
    const opponent = addAlly(sim, mage, FLAT_X + 8);
    sim.duelRequest(opponent.id, mage.id);
    sim.duelAccept(opponent.id);
    for (let tick = 0; tick < 80; tick++) sim.tick();

    castAt(sim, mage, opponent.pos.x);

    expect(hourglassAura(opponent)).toMatchObject({ kind: 'incapacitate', duration: 10 });
  });

  it('prevents movement, attacks, and ability casts through canonical control predicates', () => {
    const { sim, mage } = makeChronomancer();
    const enemy = addHostile(sim, FLAT_X + 2);
    enemy.targetId = mage.id;
    const start = { ...enemy.pos };
    const hp = mage.hp;

    castAt(sim, mage, enemy.pos.x);
    advance(sim, 1);

    expect(enemy.pos.x).toBeCloseTo(start.x);
    expect(enemy.pos.z).toBeCloseTo(start.z);
    expect(mage.hp).toBe(hp);
    expect(isStunned(enemy)).toBe(true);
  });

  it('breaks after a damaging hit while applying that hit normally', () => {
    const { sim, mage } = makeChronomancer();
    const enemy = addHostile(sim, FLAT_X + 8);
    castAt(sim, mage, enemy.pos.x);
    const hp = enemy.hp;

    (
      sim as unknown as {
        dealDamage(
          source: Entity,
          target: Entity,
          amount: number,
          crit: boolean,
          school: Aura['school'],
          ability: string,
          kind: 'hit',
        ): void;
      }
    ).dealDamage(mage, enemy, 137, false, 'arcane', 'Test hit', 'hit');

    expect(enemy.hp).toBe(hp - 137);
    expect(hourglassAura(enemy)).toBeUndefined();
  });

  it('ignores allies, dead or distant enemies, and canonical control-immune bosses', () => {
    const { sim, mage } = makeChronomancer();
    const outsider = addAlly(sim, mage, FLAT_X + 7, false);
    const dead = addHostile(sim, FLAT_X + 10);
    dead.dead = true;
    dead.hp = 0;
    const distant = addHostile(sim, FLAT_X + 14);

    castAt(sim, mage, outsider.pos.x);
    expect(hourglassAura(outsider)).toBeUndefined();
    castAt(sim, mage, dead.pos.x);
    expect(hourglassAura(dead)).toBeUndefined();
    castAt(sim, mage, distant.pos.x - 3);
    expect(hourglassAura(distant)).toBeUndefined();

    const boss = addHostile(sim, FLAT_X + 18, 0, MOBS.nythraxis_skeleton_warrior);
    castAt(sim, mage, boss.pos.x);
    expect(hourglassAura(boss)).toBeUndefined();
  });
});

describe('Hourglass of Suspension protective modes', () => {
  it('selects the caster exclusively when aimed at their feet', () => {
    const { sim, mage } = makeChronomancer();
    const enemy = addHostile(sim, FLAT_X + 0.5);

    castAt(sim, mage, mage.pos.x);

    expect(hourglassAura(mage)?.kind).toBe('stasis');
    expect(hourglassAura(enemy)).toBeUndefined();
    expect(isInStasis(mage)).toBe(true);
  });

  it('makes the protected target immune and blocks all actions', () => {
    const { sim, mage } = makeChronomancer();
    const ally = addAlly(sim, mage, FLAT_X + 8);
    const enemy = addHostile(sim, FLAT_X + 10);
    const hp = ally.hp;
    const start = { ...ally.pos };

    castAt(sim, mage, ally.pos.x);
    const meta = sim.players.get(ally.id);
    if (!meta) throw new Error('ally metadata missing');
    meta.moveInput.forward = true;
    sim.targetEntity(enemy.id, ally.id);
    sim.castAbility('heroic_strike', ally.id);
    (
      sim as unknown as {
        dealDamage(
          source: Entity,
          target: Entity,
          amount: number,
          crit: boolean,
          school: Aura['school'],
          ability: string,
          kind: 'hit',
        ): void;
      }
    ).dealDamage(mage, ally, 500, false, 'arcane', 'Test hit', 'hit');

    expect(ally.hp).toBe(hp);
    expect(isStunned(ally)).toBe(true);
    expect(isInStasis(ally)).toBe(true);
    expect(hourglassAura(ally)).toBeDefined();
    expect(ally.autoAttack).toBe(false);
    expect(ally.queuedOnSwing).toBeNull();
    advance(sim, 0.5);
    expect(ally.pos.x).toBeCloseTo(start.x);
    expect(ally.pos.z).toBeCloseTo(start.z);
  });

  it('heals exactly 30 percent of maximum health over five seconds and caps at maximum', () => {
    const { sim, mage } = makeChronomancer();
    mage.hp = Math.floor(mage.maxHp * 0.4);
    mage.inCombat = true;
    mage.combatTimer = 0;
    const start = mage.hp;
    castAt(sim, mage, mage.pos.x);
    advance(sim, TEMPORAL_HOURGLASS_DURATION);

    expect(mage.hp - start).toBe(Math.round(mage.maxHp * TEMPORAL_HOURGLASS_HEAL_FRACTION));
    expect(hourglassAura(mage)).toBeUndefined();

    mage.hp = mage.maxHp - 1;
    castAt(sim, mage, mage.pos.x);
    advance(sim, TEMPORAL_HOURGLASS_DURATION);
    expect(mage.hp).toBe(mage.maxHp);
  });

  it('advances the caster cooldowns at 2x but excludes the hourglass itself', () => {
    const { sim, mage } = makeChronomancer();
    mage.cooldowns.set('blink', 20);
    castAt(sim, mage, mage.pos.x);
    const ownStart = mage.cooldowns.get('temporal_hourglass') ?? 0;
    expect(ownStart).toBe(50);
    advance(sim, TEMPORAL_HOURGLASS_DURATION);

    expect(mage.cooldowns.get('blink')).toBeCloseTo(20 - TEMPORAL_HOURGLASS_DURATION * 2, 5);
    expect(mage.cooldowns.get('temporal_hourglass')).toBeCloseTo(
      ownStart - TEMPORAL_HOURGLASS_DURATION,
      5,
    );
  });

  it('applies the same beneficial cancelable aura to a living group ally', () => {
    const { sim, mage } = makeChronomancer();
    const ally = addAlly(sim, mage, FLAT_X + 8);
    ally.hp = Math.floor(ally.maxHp * 0.4);
    ally.inCombat = true;
    ally.combatTimer = 0;
    ally.cooldowns.set('charge', 20);

    castAt(sim, mage, ally.pos.x);
    const aura = hourglassAura(ally);

    expect(aura?.kind).toBe('stasis');
    expect(aura && isCancelableAura(aura)).toBe(true);
    advance(sim, TEMPORAL_HOURGLASS_DURATION);
    expect(ally.hp).toBe(Math.floor(ally.maxHp * 0.4) + Math.round(ally.maxHp * 0.3));
    expect(ally.cooldowns.get('charge')).toBeCloseTo(11.25, 5);
  });

  it('leaves a single-use hourglass on empty ground for thirty seconds', () => {
    const { sim, mage } = makeChronomancer();

    castAt(sim, mage, FLAT_X + 8);

    expect(sim.activeTemporalHourglasses).toEqual([
      expect.objectContaining({
        x: FLAT_X + 8,
        z: 0,
        duration: 30,
        remaining: 30,
      }),
    ]);
  });

  it('consumes an empty-ground hourglass when a valid ally crosses it', () => {
    const { sim, mage } = makeChronomancer();
    const ally = addAlly(sim, mage, FLAT_X + 11);
    castAt(sim, mage, FLAT_X + 8);
    ally.prevPos = sim.groundPos(FLAT_X + 11, 0);
    ally.pos = sim.groundPos(FLAT_X + 8, 0);

    sim.tick();

    expect(hourglassAura(ally)?.kind).toBe('stasis');
    expect(sim.activeTemporalHourglasses).toEqual([]);
  });

  it('applies the correct protective mode when the caster steps on the ground hourglass', () => {
    const { sim, mage } = makeChronomancer();
    castAt(sim, mage, FLAT_X + 8);
    mage.prevPos = sim.groundPos(FLAT_X + 11, 0);
    mage.pos = sim.groundPos(FLAT_X + 8, 0);

    sim.tick();

    expect(hourglassAura(mage)).toMatchObject({ kind: 'stasis', value: 2, duration: 5 });
    expect(sim.activeTemporalHourglasses).toEqual([]);
  });

  it('applies the PvE hostile mode when an enemy steps on the ground hourglass', () => {
    const { sim, mage } = makeChronomancer();
    const enemy = addHostile(sim, FLAT_X + 11);
    castAt(sim, mage, FLAT_X + 8);
    enemy.prevPos = sim.groundPos(FLAT_X + 11, 0);
    enemy.pos = sim.groundPos(FLAT_X + 8, 0);

    sim.tick();

    expect(hourglassAura(enemy)).toMatchObject({ kind: 'incapacitate', duration: 60 });
    expect(sim.activeTemporalHourglasses).toEqual([]);
  });

  it('does not consume the ground hourglass for an invalid outsider', () => {
    const { sim, mage } = makeChronomancer();
    const outsider = addAlly(sim, mage, FLAT_X + 11, false);
    castAt(sim, mage, FLAT_X + 8);
    outsider.prevPos = sim.groundPos(FLAT_X + 11, 0);
    outsider.pos = sim.groundPos(FLAT_X + 8, 0);

    sim.tick();

    expect(hourglassAura(outsider)).toBeUndefined();
    expect(sim.activeTemporalHourglasses).toHaveLength(1);
  });

  it('expires an unused ground hourglass after thirty seconds', () => {
    const { sim, mage } = makeChronomancer();
    castAt(sim, mage, FLAT_X + 8);

    advance(sim, 30);

    expect(sim.activeTemporalHourglasses).toEqual([]);
  });

  it('does not retroactively trigger from movement completed before placement', () => {
    const { sim, mage } = makeChronomancer();
    const enemy = addHostile(sim, FLAT_X + 11);
    enemy.prevPos = sim.groundPos(FLAT_X + 7, 0);
    enemy.pos = sim.groundPos(FLAT_X + 11, 0);
    castAt(sim, mage, FLAT_X + 8);

    sim.tick();

    expect(hourglassAura(enemy)).toBeUndefined();
    expect(sim.activeTemporalHourglasses).toHaveLength(1);
  });

  it('removes the ground hourglass when its caster dies', () => {
    const { sim, mage } = makeChronomancer();
    castAt(sim, mage, FLAT_X + 8);
    mage.dead = true;
    mage.hp = 0;

    sim.tick();

    expect(sim.activeTemporalHourglasses).toEqual([]);
  });

  it('removes the ground hourglass when its caster changes region', () => {
    const { sim, mage } = makeChronomancer();
    castAt(sim, mage, FLAT_X + 8);
    mage.pos = sim.groundPos(FLAT_X, 1000);

    sim.tick();

    expect(sim.activeTemporalHourglasses).toEqual([]);
  });

  it('manual cancellation immediately stops immunity, healing, and acceleration', () => {
    const { sim, mage } = makeChronomancer();
    const ally = addAlly(sim, mage, FLAT_X + 8);
    ally.hp = Math.floor(ally.maxHp * 0.4);
    ally.cooldowns.set('charge', 20);
    castAt(sim, mage, ally.pos.x);
    advance(sim, 2);
    const hpAtCancel = ally.hp;
    const cooldownAtCancel = ally.cooldowns.get('charge') ?? 0;

    sim.cancelAura('temporal_hourglass', ally.id);
    expect(hourglassAura(ally)).toBeUndefined();
    expect(isInStasis(ally)).toBe(false);
    advance(sim, 1);

    expect(ally.hp).toBe(hpAtCancel);
    expect(ally.cooldowns.get('charge')).toBeCloseTo(cooldownAtCancel - 1, 5);
  });

  it('rejects ungrouped players, neutral NPCs, pets, and dead group members', () => {
    const { sim, mage } = makeChronomancer();
    const outsider = addAlly(sim, mage, FLAT_X + 8, false);
    castAt(sim, mage, outsider.pos.x);
    expect(hourglassAura(outsider)).toBeUndefined();

    const pet = addHostile(sim, FLAT_X + 10);
    pet.hostile = false;
    pet.ownerId = mage.id;
    castAt(sim, mage, pet.pos.x);
    expect(hourglassAura(pet)).toBeUndefined();

    const host = sim as unknown as { nextId: number; addEntity(e: Entity): void };
    const neutral = createNpc(host.nextId++, NPCS.trader_wilkes, sim.groundPos(FLAT_X + 11, 0));
    host.addEntity(neutral);
    castAt(sim, mage, neutral.pos.x);
    expect(hourglassAura(neutral)).toBeUndefined();

    const deadAlly = addAlly(sim, mage, FLAT_X + 12);
    deadAlly.dead = true;
    deadAlly.hp = 0;
    castAt(sim, mage, deadAlly.pos.x);
    expect(hourglassAura(deadAlly)).toBeUndefined();
  });

  it('is deterministic and introduces no random selection', () => {
    const run = (): string => {
      const { sim, mage } = makeChronomancer();
      const one = addHostile(sim, FLAT_X + 8, -0.5);
      const two = addHostile(sim, FLAT_X + 8, 0.5);
      castAt(sim, mage, FLAT_X + 8);
      return [one, two].map((enemy) => `${enemy.id}:${Boolean(hourglassAura(enemy))}`).join('|');
    };

    expect(run()).toBe(run());
  });
});
