import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { fiestaDownEntity } from '../src/sim/social/fiesta';
import { channelTickBonus, directHealBonus } from '../src/sim/spell_scaling';
import type { Aura, Entity } from '../src/sim/types';

function setup() {
  const sim = new Sim({ seed: 1701, playerClass: 'paladin', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.setSpec('holy')).toBe(true);
  const allyId = sim.addPlayer('priest', 'Dawn Ally');
  sim.setPlayerLevel(20, allyId);
  sim.partyInvite(allyId, sim.player.id);
  sim.partyAccept(allyId);
  const ally = sim.entities.get(allyId);
  if (!ally) throw new Error('missing Dawn ally');
  ally.pos = { ...sim.player.pos };
  return { sim, ally };
}

function hostileNear(sim: Sim): Entity {
  const mob = createMob(9701, MOBS.ridge_stalker, 20, {
    x: sim.player.pos.x + 2,
    y: sim.player.pos.y,
    z: sim.player.pos.z,
  });
  mob.maxHp = mob.hp = 1_000_000;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  return mob;
}

function protectionFrom(casterId: number) {
  return expect.objectContaining({
    id: `aegis_first_dawn_dr:${casterId}`,
    kind: 'shield_wall',
    value: 0.5,
    sourceId: casterId,
  });
}

describe('Aegis of the First Dawn', () => {
  it('authors a Holy-only self-centered 5-second support channel', () => {
    expect(ABILITIES.aegis_first_dawn).toMatchObject({
      name: 'Aegis of the First Dawn',
      specs: ['holy'],
      learnLevel: 18,
      cost: 150,
      cooldown: 180,
      castTime: 0,
      range: 0,
      requiresTarget: false,
      channel: { duration: 5, ticks: 5 },
    });
    expect(ABILITIES.aegis_first_dawn.effects).toEqual([
      {
        type: 'paladinAegis',
        radius: 10,
        tickMin: 35,
        tickMax: 45,
        finalMin: 120,
        finalMax: 150,
        damageReduction: 0.5,
        speedMult: 1.3,
        speedDuration: 4,
      },
    ]);
    expect(ABILITIES.aegis_first_dawn.effects).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'cleanseMovement' }),
        expect.objectContaining({ type: 'breakControl' }),
      ]),
    );

    const holy = computeTalentModifiers('paladin', { spec: 'holy', ranks: {}, choices: {} }, 20);
    const retribution = computeTalentModifiers(
      'paladin',
      { spec: 'retribution', ranks: {}, choices: {} },
      20,
    );
    expect(abilitiesKnownAt('paladin', 20, holy).map((entry) => entry.def.id)).toContain(
      'aegis_first_dawn',
    );
    expect(abilitiesKnownAt('paladin', 20, retribution).map((entry) => entry.def.id)).not.toContain(
      'aegis_first_dawn',
    );
  });

  it('protects only allies currently inside the dome', () => {
    const { sim, ally } = setup();
    sim.castAbility('aegis_first_dawn');

    expect(sim.player).toMatchObject({ castingAbility: 'aegis_first_dawn', channeling: true });
    expect(ally.auras).toContainEqual(protectionFrom(sim.player.id));

    const attacker = hostileNear(sim);
    ally.hp = ally.maxHp;
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
    ).dealDamage(attacker, ally, 100, false, 'holy', 'Test', 'hit');
    expect(ally.maxHp - ally.hp).toBe(50);

    ally.pos.x += 11;
    sim.tick();
    expect(ally.auras).not.toContainEqual(protectionFrom(sim.player.id));

    ally.pos = { ...sim.player.pos };
    sim.tick();
    expect(ally.auras).toContainEqual(protectionFrom(sim.player.id));
  });

  it('heals each second and grants the final heal and speed only on full completion', () => {
    const { sim, ally } = setup();
    ally.maxHp = 1_000_000;
    ally.hp = 1;
    sim.rng.next = () => 0.5;
    sim.castAbility('aegis_first_dawn');
    const events: ReturnType<Sim['tick']> = [];

    for (let i = 0; i < 21; i++) events.push(...sim.tick());
    expect(ally.hp).toBeGreaterThan(1);
    expect(ally.auras.some((aura) => aura.id === 'aegis_first_dawn_speed')).toBe(false);

    for (let i = 0; i < 80; i++) events.push(...sim.tick());
    expect(sim.player.castingAbility).toBeNull();
    const allyHeals = events.flatMap((event) =>
      event.type === 'heal2' &&
      event.targetId === ally.id &&
      event.ability === 'Aegis of the First Dawn'
        ? [event.amount]
        : [],
    );
    const tickHeal = 40 + channelTickBonus(sim.player.spellPower, ABILITIES.aegis_first_dawn);
    const finalHeal = 135 + directHealBonus(sim.player.spellPower, 0, true);
    expect(allyHeals).toEqual([tickHeal, tickHeal, tickHeal, tickHeal, tickHeal, finalHeal]);
    expect(ally.auras).toContainEqual(
      expect.objectContaining({
        id: 'aegis_first_dawn_speed',
        kind: 'buff_speed',
        value: 1.3,
        duration: 4,
      }),
    );
    expect(ally.auras).not.toContainEqual(protectionFrom(sim.player.id));
  });

  it('spends its mana after Grace Devotion cost reduction', () => {
    const { sim } = setup();
    sim.player.resource = 500;
    sim.player.auras.push({
      id: 'grace_devotion',
      name: 'Grace Devotion',
      kind: 'buff_mana_grace',
      remaining: Number.POSITIVE_INFINITY,
      duration: Number.POSITIVE_INFINITY,
      permanent: true,
      value: 15,
      value2: 0.03,
      sourceId: sim.player.id,
      school: 'holy',
    });

    sim.castAbility('aegis_first_dawn');

    expect(sim.player.resource).toBe(354);
  });

  it('ends immediately without a burst when stunned', () => {
    const { sim, ally } = setup();
    sim.castAbility('aegis_first_dawn');
    ally.hp = 1;
    for (let i = 0; i < 41; i++) sim.tick();
    const earnedHealing = ally.hp;
    expect(earnedHealing).toBeGreaterThan(1);
    sim.player.auras.push({
      id: 'test_stun',
      name: 'Test Stun',
      kind: 'stun',
      remaining: 2,
      duration: 2,
      value: 0,
      sourceId: 999,
      school: 'physical',
    });

    const postCancelEvents = [...sim.tick()];

    expect(sim.player.castingAbility).toBeNull();
    expect(ally.auras).not.toContainEqual(protectionFrom(sim.player.id));
    expect(ally.auras.some((aura) => aura.id === 'aegis_first_dawn_speed')).toBe(false);
    expect(ally.hp).toBe(earnedHealing);
    for (let i = 0; i < 100; i++) postCancelEvents.push(...sim.tick());
    expect(
      postCancelEvents.some(
        (event) =>
          event.type === 'heal2' &&
          event.targetId === ally.id &&
          event.ability === 'Aegis of the First Dawn',
      ),
    ).toBe(false);
  });

  it('cleans every sourced protection aura when the Paladin dies mid-channel', () => {
    const { sim, ally } = setup();
    sim.castAbility('aegis_first_dawn');
    expect(ally.auras).toContainEqual(protectionFrom(sim.player.id));

    const attacker = hostileNear(sim);
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
    ).dealDamage(attacker, sim.player, 1_000_000, false, 'holy', 'Test', 'hit');

    expect(sim.player.dead).toBe(true);
    expect(ally.auras).not.toContainEqual(protectionFrom(sim.player.id));
    expect(ally.auras.some((aura) => aura.id === 'aegis_first_dawn_speed')).toBe(false);
  });

  it('cleans every sourced protection aura through the Fiesta death path', () => {
    const { sim, ally } = setup();
    sim.castAbility('aegis_first_dawn');
    expect(ally.auras).toContainEqual(protectionFrom(sim.player.id));

    fiestaDownEntity(sim.ctx, sim.player, null);

    expect(sim.player.dead).toBe(true);
    expect(ally.auras).not.toContainEqual(protectionFrom(sim.player.id));
  });
});
