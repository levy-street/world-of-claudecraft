import { describe, expect, it } from 'vitest';
import { characterPaladinWingsActive } from '../src/render/character_effects';
import { paladinDevotionConflicts } from '../src/sim/combat/paladin_support';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { activateDivineAscension, grantDevotion } from '../src/sim/paladin_devotion';
import { type ResolvedAbility, Sim } from '../src/sim/sim';
import { fiestaDownEntity } from '../src/sim/social/fiesta';
import { threatModifier } from '../src/sim/threat';
import type { Aura, Entity } from '../src/sim/types';

function hostileNear(sim: Sim): Entity {
  const player = sim.player;
  const mob = createMob(9101, MOBS.ridge_stalker, 20, {
    x: player.pos.x + 2,
    y: player.pos.y,
    z: player.pos.z,
  });
  mob.maxHp = mob.hp = 1_000_000;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  return mob;
}

function resolve(sim: Sim, id: string): ResolvedAbility {
  const ability = sim.resolvedAbility(id);
  if (!ability) throw new Error(`missing ability ${id}`);
  return ability;
}

function run(sim: Sim, target: Entity | null, resolved: ResolvedAbility): void {
  const internals = sim as unknown as {
    players: Map<number, unknown>;
    ctx: {
      runEffects(
        player: Entity,
        meta: unknown,
        target: Entity | null,
        ability: ResolvedAbility,
      ): void;
      applyHeal(
        source: Entity,
        target: Entity,
        amount: number,
        ability: string,
        abilityId: string | null,
        canCrit: boolean,
      ): number;
    };
  };
  internals.ctx.runEffects(sim.player, internals.players.get(sim.playerId), target, resolved);
}

function runAs(sim: Sim, caster: Entity, target: Entity | null, resolved: ResolvedAbility): void {
  const meta = sim.meta(caster.id);
  if (!meta) throw new Error(`missing metadata for caster ${caster.id}`);
  sim.ctx.runEffects(caster, meta, target, resolved);
}

function aura(
  id: string,
  kind: Aura['kind'],
  sourceId: number,
  value: number,
  value2?: number,
): Aura {
  return {
    id,
    name: id,
    kind,
    remaining: 1800,
    duration: 1800,
    value,
    value2,
    sourceId,
    school: 'holy',
  };
}

describe('Paladin support abilities', () => {
  it('applies Guardian Covenant to both a targeted ally and the Retribution paladin', () => {
    const sim = new Sim({ seed: 159, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.setSpec('retribution');
    const allyId = sim.addPlayer('priest', 'Guardian Ally');
    sim.setPlayerLevel(20, allyId);
    const ally = sim.entities.get(allyId);
    if (!ally) throw new Error('missing Guardian Covenant ally');

    sim.castAbilityOn('guardian_covenant', allyId);

    const covenantAura = expect.objectContaining({
      id: 'guardian_covenant',
      kind: 'buff_dr',
      value: 0.2,
      remaining: 8,
    });
    expect(ally.auras).toContainEqual(covenantAura);
    expect(sim.player.auras).toContainEqual(covenantAura);
    expect(characterPaladinWingsActive(ally)).toBe(true);
    expect(characterPaladinWingsActive(sim.player)).toBe(true);
  });

  it('self-casts Guardian Covenant when no friendly target is selected', () => {
    const sim = new Sim({ seed: 160, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(12);
    sim.setSpec('retribution');
    const hostile = hostileNear(sim);
    sim.targetEntity(hostile.id);

    sim.castAbility('guardian_covenant');

    const covenantAuras = sim.player.auras.filter(({ id }) => id === 'guardian_covenant');
    expect(covenantAuras).toEqual([
      expect.objectContaining({
        kind: 'buff_dr',
        value: 0.2,
        remaining: 8,
      }),
    ]);
  });

  it('empowers both Guardian Covenant recipients during a real Ascension cast', () => {
    const sim = new Sim({ seed: 161, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.setSpec('retribution');
    const allyId = sim.addPlayer('priest', 'Ascended Guardian Ally');
    sim.setPlayerLevel(20, allyId);
    const ally = sim.entities.get(allyId);
    if (!ally) throw new Error('missing Ascended Guardian Covenant ally');
    grantDevotion(sim.player, 20);
    expect(activateDivineAscension(sim.player)).toBe(true);

    sim.castAbilityOn('guardian_covenant', allyId);

    const empoweredAura = expect.objectContaining({
      id: 'guardian_covenant',
      kind: 'buff_dr',
      value: 0.3,
      remaining: 8,
    });
    expect(ally.auras).toContainEqual(empoweredAura);
    expect(sim.player.auras).toContainEqual(empoweredAura);
    expect(sim.player.paladinDevotion?.ascensionCharges).toBe(4);
  });

  it('exposes the restored support kit with the requested values and gates', () => {
    expect(ABILITIES.lay_on_hands).toMatchObject({
      name: 'Last Rite',
      cooldown: 600,
      castTime: 0,
    });
    expect(ABILITIES.lay_on_hands.hiddenFromPlayer).not.toBe(true);
    expect(ABILITIES.lay_on_hands.effects).toEqual([
      { type: 'heal', min: 0, max: 0, casterMaxHpPct: 1, canCrit: false },
    ]);
    expect(ABILITIES.lay_on_hands.ranks).toBeUndefined();
    expect(ABILITIES.hammer_of_justice).toMatchObject({
      name: 'Sundering Gavel',
      cooldown: 60,
      range: 10,
    });
    expect(ABILITIES.hammer_of_justice.hiddenFromPlayer).not.toBe(true);
    expect(ABILITIES.hammer_of_justice.effects).toEqual([{ type: 'stun', duration: 3 }]);
    expect(ABILITIES.hammer_of_justice.ranks).toBeUndefined();
    expect(ABILITIES.sacred_challenge).toMatchObject({
      name: 'Sacred Goad',
      range: 30,
      specs: ['protection'],
      effects: [{ type: 'taunt' }],
    });
    expect(ABILITIES.holy_taunt.hiddenFromPlayer).toBe(true);
    expect(ABILITIES.righteous_fury).toMatchObject({
      name: 'Burning Oath',
      passive: true,
      specs: ['protection'],
    });
    expect(ABILITIES.righteous_fury.hiddenFromPlayer).not.toBe(true);
    expect(ABILITIES.consecration).toMatchObject({
      name: 'Holy Ground',
      // Taught at specialization, so both melee specs open with their ground kit.
      learnLevel: 5,
      cooldown: 12,
      specs: ['protection', 'retribution'],
    });
    expect(ABILITIES.consecration.hiddenFromPlayer).not.toBe(true);
    expect(ABILITIES.retribution_aura).toMatchObject({
      name: 'Requital Aura',
    });
    expect(ABILITIES.retribution_aura.hiddenFromPlayer).not.toBe(true);
    expect(ABILITIES.guardian_covenant).toMatchObject({
      name: 'Guardian Covenant',
      learnLevel: 12,
      specs: ['retribution'],
      requiresTarget: true,
      targetType: 'friendly',
    });

    const mods = (spec: 'protection' | 'holy' | 'retribution') =>
      computeTalentModifiers('paladin', { spec, ranks: {}, choices: {} }, 20);
    const known = (spec: 'protection' | 'holy' | 'retribution') =>
      abilitiesKnownAt('paladin', 20, mods(spec)).map((entry) => entry.def.id);
    const tankOnly = [
      'vowkeeper_strike',
      'bastion_rite',
      'sunward_disc',
      'sacred_challenge',
      'bastion_sweep',
      'oath_chain',
    ];
    expect(known('protection')).toEqual(
      expect.arrayContaining([...tankOnly, 'righteous_fury', 'consecration', 'hushbrand']),
    );
    expect(known('retribution')).toEqual(
      expect.arrayContaining(['consecration', 'hushbrand', 'guardian_covenant']),
    );
    expect(known('holy')).toEqual(expect.arrayContaining(['solar_step', 'solar_invocation']));
    for (const id of [...tankOnly, 'righteous_fury', 'consecration', 'hushbrand']) {
      expect(known('holy')).not.toContain(id);
    }
    for (const id of tankOnly) {
      expect(known('retribution')).not.toContain(id);
    }
    for (const id of ['guardian_covenant', 'solar_invocation']) {
      expect(known('protection')).not.toContain(id);
    }
    expect(known('holy')).not.toContain('guardian_covenant');
    expect(known('retribution')).not.toContain('solar_invocation');
    expect(known('protection')).toContain('solar_step');
    expect(known('retribution')).toContain('solar_step');
    expect(known('protection')).toContain('avenging_wrath');
    expect(known('holy')).toContain('avenging_wrath');
    expect(known('retribution')).toContain('avenging_wrath');
    expect(known('retribution')).not.toContain('righteous_fury');
    const retired = [
      'seal_of_righteousness',
      'devotion_aura',
      'blessing_of_might',
      'holy_taunt',
      'flash_of_light',
      'exorcism',
      'rebuke',
      'sacred_bulwark',
      'holy_shock',
      'crusader_strike',
    ];
    for (const spec of ['protection', 'holy', 'retribution'] as const) {
      for (const id of retired) expect(known(spec)).not.toContain(id);
    }
    const authority = new Sim({ seed: 102, playerClass: 'paladin', autoEquip: true });
    authority.setPlayerLevel(20);
    expect(authority.setSpec('retribution')).toBe(true);
    for (const id of retired) {
      expect(authority.resolvedAbility(id), id).toBeNull();
      authority.castAbility(id);
    }
    expect(authority.player.cooldowns.size).toBe(0);
    expect(ABILITIES.unbinding_blessing).toBeUndefined();
    expect(ABILITIES.citadel_of_faith).toBeUndefined();
  });

  it("makes every spec's Last Rite heal for caster maximum health and preserve two RNG draws", () => {
    for (const [index, spec] of ['holy', 'protection', 'retribution'].entries()) {
      const sim = new Sim({ seed: 164 + index, playerClass: 'paladin', autoEquip: true });
      sim.setPlayerLevel(20);
      expect(sim.setSpec(spec as 'holy' | 'protection' | 'retribution')).toBe(true);
      const allyId = sim.addPlayer('warrior', `Last Rite ${spec} Ally`, { autoEquip: true });
      sim.setPlayerLevel(20, allyId);
      const ally = sim.entities.get(allyId);
      if (!ally) throw new Error('missing Last Rite ally');
      ally.maxHp = sim.player.maxHp * 3;
      ally.hp = 1;
      sim.player.spellPower = 10_000;
      let rangeCalls = 0;
      let chanceCalls = 0;
      sim.rng.range = () => {
        rangeCalls++;
        return 0;
      };
      sim.rng.chance = () => {
        chanceCalls++;
        return true;
      };

      run(sim, ally, resolve(sim, 'lay_on_hands'));

      expect(ally.hp).toBe(1 + sim.player.maxHp);
      expect(rangeCalls).toBe(1);
      expect(chanceCalls).toBe(1);
      expect(sim.drainEvents()).toContainEqual(
        expect.objectContaining({
          type: 'heal2',
          sourceId: sim.playerId,
          targetId: allyId,
          amount: sim.player.maxHp,
          crit: false,
        }),
      );
    }
  });

  it('offers every Devotion to all three Paladin specializations', () => {
    const devotionIds = [
      'devotion_ward',
      'radiant_devotion',
      'dawn_devotion',
      'grace_devotion',
      'retribution_aura',
    ];
    const mods = (spec: 'protection' | 'holy' | 'retribution') =>
      computeTalentModifiers('paladin', { spec, ranks: {}, choices: {} }, 20);
    for (const spec of ['protection', 'holy', 'retribution'] as const) {
      const known = abilitiesKnownAt('paladin', 20, mods(spec)).map((entry) => entry.def.id);
      expect(known).toEqual(expect.arrayContaining(devotionIds));
    }
    const known = abilitiesKnownAt('paladin', 20).map((entry) => entry.def.id);
    expect(known).not.toContain('devotion_aura');
  });

  it('authors the requested first-pass values and spec restrictions', () => {
    const paladin = new Sim({ seed: 101, playerClass: 'paladin', autoEquip: true });
    paladin.setPlayerLevel(20);

    expect(resolve(paladin, 'devotion_ward').effects).toEqual([
      {
        type: 'buffTarget',
        kind: 'buff_dr',
        value: 0.05,
        duration: 0,
        permanent: true,
        party: true,
      },
    ]);
    // Rank 3 at level 20: the reflect is a flat number that no stat scales, so it
    // ranks up (5 at 7, 12 at 13, 22 at 18) instead of staying at its level-7 value.
    expect(resolve(paladin, 'retribution_aura').effects).toEqual([
      {
        type: 'buffTarget',
        kind: 'thorns',
        value: 22,
        duration: 0,
        permanent: true,
        party: true,
      },
    ]);
    expect(resolve(paladin, 'radiant_devotion').def.exclusiveGroup).toBeUndefined();
    expect(resolve(paladin, 'radiant_devotion').def).toMatchObject({
      effects: [
        { type: 'buffTarget', kind: 'buff_spellpower', value: 20, duration: 1800, party: true },
      ],
    });
    expect(resolve(paladin, 'dawn_devotion').def.exclusiveGroup).toBeUndefined();
    expect(resolve(paladin, 'dawn_devotion').def).toMatchObject({
      effects: [{ type: 'buffTarget', kind: 'buff_ap', value: 40, duration: 1800, party: true }],
    });
    expect(resolve(paladin, 'grace_devotion').def.exclusiveGroup).toBeUndefined();
    expect(resolve(paladin, 'grace_devotion').def).toMatchObject({
      effects: [
        {
          type: 'buffTarget',
          kind: 'buff_mana_grace',
          value: 15,
          value2: 0.03,
          duration: 1800,
          party: true,
        },
      ],
    });
    expect(resolve(paladin, 'solar_step')).toMatchObject({ cooldown: 30 });
    expect(resolve(paladin, 'solar_step').effects).toEqual([
      { type: 'selfBuff', kind: 'buff_speed', value: 2.5, duration: 2 },
    ]);
    expect(paladin.setSpec('holy')).toBe(true);
    expect(resolve(paladin, 'solar_invocation')).toMatchObject({
      castTime: 0,
      cooldown: 8,
    });
    expect(resolve(paladin, 'solar_invocation').def).toMatchObject({
      range: 30,
      requiresTarget: true,
      targetType: 'any',
    });
    expect(resolve(paladin, 'solar_invocation').effects).toEqual([
      { type: 'heal', min: 180, max: 220 },
      { type: 'directDamage', min: 120, max: 150 },
    ]);
    const hammerOfGrace = resolve(paladin, 'hammer_of_grace');
    expect(hammerOfGrace).toMatchObject({
      castTime: 0,
      cooldown: 7,
      effects: [
        {
          type: 'directDamage',
          min: 95,
          max: 115,
          restoreMana: 70,
          selfHealDamageFrac: 0.5,
        },
      ],
    });
    expect(hammerOfGrace.def).toMatchObject({
      range: 20,
      school: 'holy',
      projectile: true,
    });
    expect(paladin.resolvedAbility('hammer_of_light')).toBeNull();
    expect(ABILITIES.judgement).toBeUndefined();
    expect(paladin.resolvedAbility('judgement')).toBeNull();

    expect(paladin.setSpec('retribution')).toBe(true);
    expect(paladin.resolvedAbility('sacred_form')).toBeNull();
    expect(paladin.setSpec('holy')).toBe(true);
    expect(resolve(paladin, 'sacred_form').effects).toEqual([
      {
        type: 'selfBuff',
        kind: 'sacred_form',
        value: 0.1,
        value2: 0.05,
        value3: 0.5,
        duration: 0,
        permanent: true,
      },
    ]);
  });

  it('keeps one long Devotion per Paladin while preserving foreign Devotions and aura choices', () => {
    const current = [
      aura('radiant_devotion', 'buff_spellpower', 1, 20),
      aura('dawn_devotion', 'buff_ap', 2, 40),
      aura('grace_devotion', 'buff_mana_grace', 1, 15),
    ];

    expect(paladinDevotionConflicts(current, 1, 'devotion_ward')).toEqual([]);
    expect(paladinDevotionConflicts(current, 2, 'devotion_ward')).toEqual([]);
    expect(paladinDevotionConflicts(current, 1, 'dawn_devotion')).toEqual([2, 0]);
    expect(paladinDevotionConflicts(current, 2, 'grace_devotion')).toEqual([1]);

    const sim = new Sim({ seed: 102, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    run(sim, null, resolve(sim, 'radiant_devotion'));
    run(sim, null, resolve(sim, 'dawn_devotion'));
    run(sim, null, resolve(sim, 'grace_devotion'));
    run(sim, null, resolve(sim, 'devotion_ward'));
    sim.player.auras.push(aura('dawn_devotion', 'buff_ap', 999, 40));
    expect(sim.player.auras).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'devotion_ward', sourceId: sim.player.id }),
        expect.objectContaining({ id: 'grace_devotion', sourceId: sim.player.id }),
        expect.objectContaining({ id: 'dawn_devotion', sourceId: 999 }),
      ]),
    );
    expect(sim.player.auras).not.toContainEqual(
      expect.objectContaining({ id: 'radiant_devotion', sourceId: sim.player.id }),
    );
    expect(sim.player.auras).not.toContainEqual(
      expect.objectContaining({ id: 'dawn_devotion', sourceId: sim.player.id }),
    );

    run(sim, null, resolve(sim, 'retribution_aura'));
    expect(sim.player.auras.some((active) => active.id === 'devotion_ward')).toBe(false);
    expect(sim.player.auras).toContainEqual(
      expect.objectContaining({ id: 'grace_devotion', sourceId: sim.player.id }),
    );
    expect(sim.player.auras).toContainEqual(
      expect.objectContaining({ id: 'dawn_devotion', sourceId: 999 }),
    );
  });

  it('casts Hammer of Grace instantly at 20 m, pays out on impact, and refuses 20.01 m', () => {
    const setupAtDistance = (distance: number): { sim: Sim; target: Entity } => {
      const sim = new Sim({ seed: 157, playerClass: 'paladin', autoEquip: true });
      sim.setPlayerLevel(20);
      sim.setSpec('retribution');
      const target = hostileNear(sim);
      target.pos.x = sim.player.pos.x;
      target.pos.z = sim.player.pos.z + distance;
      target.prevPos = { ...target.pos };
      (sim as unknown as { rebucket(entity: Entity): void }).rebucket(target);
      sim.ctx.lineOfSightBlocked = () => false;
      sim.targetEntity(target.id);
      return { sim, target };
    };

    const { sim: boundary, target: boundaryTarget } = setupAtDistance(20);
    boundary.player.resource = 0;
    boundary.player.hp = 1;
    boundary.rng.next = () => 0.9;
    const hpBefore = boundaryTarget.hp;
    boundary.castAbility('hammer_of_grace');
    expect(boundary.player.castingAbility).toBeNull();
    expect(boundary.player.cooldowns.get('hammer_of_grace')).toBe(7);
    expect(boundaryTarget.hp).toBe(hpBefore);
    expect(boundary.ctx.pendingProjectiles).toHaveLength(1);
    for (let tick = 0; tick < 200 && boundary.ctx.pendingProjectiles.length > 0; tick++)
      boundary.tick();
    expect(boundary.ctx.pendingProjectiles).toHaveLength(0);
    expect(boundaryTarget.hp).toBeLessThan(hpBefore);
    expect(boundary.player.resource).toBeGreaterThanOrEqual(70);
    expect(boundary.player.hp).toBeGreaterThan(1);
    expect(boundary.player.paladinDevotion?.value).toBe(1);

    const { sim: beyond } = setupAtDistance(20.01);
    beyond.castAbility('hammer_of_grace');
    expect(beyond.player.castingAbility).toBeNull();
    expect(beyond.player.cooldowns.has('hammer_of_grace')).toBe(false);
  });

  it('replaces one Paladin long Devotion party-wide without removing another Paladin copy', () => {
    const sim = new Sim({ seed: 154, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    const secondId = sim.addPlayer('paladin', 'Second Light', { autoEquip: true });
    const allyId = sim.addPlayer('priest', 'Shared Ally');
    sim.setPlayerLevel(20, secondId);
    sim.setPlayerLevel(20, allyId);
    sim.partyInvite(secondId, sim.player.id);
    sim.partyAccept(secondId);
    sim.partyInvite(allyId, sim.player.id);
    sim.partyAccept(allyId);
    const second = sim.entities.get(secondId);
    const ally = sim.entities.get(allyId);
    if (!second || !ally) throw new Error('missing multi-Paladin party member');

    run(sim, null, resolve(sim, 'radiant_devotion'));
    runAs(sim, second, null, resolve(sim, 'dawn_devotion'));
    run(sim, null, resolve(sim, 'grace_devotion'));

    for (const entity of [sim.player, second, ally]) {
      expect(entity.auras).toContainEqual(
        expect.objectContaining({ id: 'grace_devotion', sourceId: sim.player.id }),
      );
      expect(entity.auras).toContainEqual(
        expect.objectContaining({ id: 'dawn_devotion', sourceId: second.id }),
      );
      expect(entity.auras).not.toContainEqual(
        expect.objectContaining({ id: 'radiant_devotion', sourceId: sim.player.id }),
      );
    }
  });

  it('recalculates a former party member after replacing the caster long Devotion', () => {
    const sim = new Sim({ seed: 152, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    const allyId = sim.addPlayer('priest', 'Former Devotee');
    sim.setPlayerLevel(20, allyId);
    sim.partyInvite(allyId, sim.player.id);
    sim.partyAccept(allyId);
    const ally = sim.entities.get(allyId);
    if (!ally) throw new Error('missing former Devotee');
    const baseSpellPower = ally.spellPower;

    run(sim, null, resolve(sim, 'radiant_devotion'));
    expect(ally.spellPower).toBe(baseSpellPower + 20);

    sim.partyLeave(allyId);
    run(sim, null, resolve(sim, 'dawn_devotion'));

    expect(ally.auras).not.toContainEqual(
      expect.objectContaining({ id: 'radiant_devotion', sourceId: sim.player.id }),
    );
    expect(ally.spellPower).toBe(baseSpellPower);
  });

  it('switches Devotion and Requital through one aura family across the party', () => {
    const sim = new Sim({ seed: 142, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    const allyId = sim.addPlayer('priest', 'Aura Ally');
    sim.setPlayerLevel(20, allyId);
    sim.partyInvite(allyId, sim.player.id);
    sim.partyAccept(allyId);
    const ally = sim.entities.get(allyId);
    if (!ally) throw new Error('missing aura ally');

    run(sim, null, resolve(sim, 'devotion_ward'));
    expect(ally.auras).toContainEqual(
      expect.objectContaining({ id: 'devotion_ward', sourceId: sim.player.id }),
    );
    ally.auras.push(aura('devotion_ward', 'buff_dr', 999, 0.05));
    sim.player.auras.push(aura('devotion_ward', 'buff_dr', 999, 0.05));

    run(sim, null, resolve(sim, 'retribution_aura'));
    expect(sim.player.auras).toContainEqual(
      expect.objectContaining({ id: 'retribution_aura', sourceId: sim.player.id }),
    );
    expect(sim.player.auras).toContainEqual(
      expect.objectContaining({ id: 'devotion_ward', sourceId: 999 }),
    );
    expect(ally.auras).not.toContainEqual(
      expect.objectContaining({ id: 'devotion_ward', sourceId: sim.player.id }),
    );
    expect(ally.auras).toContainEqual(
      expect.objectContaining({ id: 'retribution_aura', sourceId: sim.player.id }),
    );
    expect(ally.auras).toContainEqual(
      expect.objectContaining({ id: 'devotion_ward', sourceId: 999 }),
    );

    run(sim, null, resolve(sim, 'devotion_ward'));
    expect(sim.player.auras).not.toContainEqual(
      expect.objectContaining({ id: 'retribution_aura', sourceId: sim.player.id }),
    );
  });

  it('removes a permanent Devotion from allies when its Paladin dies', () => {
    const sim = new Sim({ seed: 143, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    const allyId = sim.addPlayer('priest', 'Aura Survivor');
    sim.setPlayerLevel(20, allyId);
    sim.partyInvite(allyId, sim.player.id);
    sim.partyAccept(allyId);
    const ally = sim.entities.get(allyId);
    if (!ally) throw new Error('missing aura survivor');

    run(sim, null, resolve(sim, 'devotion_ward'));
    ally.auras.push(aura('devotion_ward', 'buff_dr', 999, 0.05));
    expect(ally.auras).toContainEqual(
      expect.objectContaining({ id: 'devotion_ward', sourceId: sim.player.id, permanent: true }),
    );

    const attacker = hostileNear(sim);
    (
      sim as unknown as {
        dealDamage(
          source: Entity,
          target: Entity,
          amount: number,
          crit: boolean,
          school: string,
          ability: string,
          kind: 'hit',
        ): void;
      }
    ).dealDamage(attacker, sim.player, 1_000_000, false, 'holy', 'Test', 'hit');

    expect(ally.auras).not.toContainEqual(
      expect.objectContaining({ id: 'devotion_ward', sourceId: sim.player.id }),
    );
    expect(ally.auras).toContainEqual(
      expect.objectContaining({ id: 'devotion_ward', sourceId: 999 }),
    );
  });

  it('removes a permanent Devotion from allies through the Fiesta death path', () => {
    const sim = new Sim({ seed: 145, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    const allyId = sim.addPlayer('priest', 'Fiesta Aura Ally');
    sim.setPlayerLevel(20, allyId);
    sim.partyInvite(allyId, sim.player.id);
    sim.partyAccept(allyId);
    const ally = sim.entities.get(allyId);
    if (!ally) throw new Error('missing Fiesta aura ally');

    run(sim, null, resolve(sim, 'devotion_ward'));
    fiestaDownEntity(sim.ctx, sim.player, null);

    expect(ally.auras).not.toContainEqual(
      expect.objectContaining({ id: 'devotion_ward', sourceId: sim.player.id }),
    );
  });

  it("removes only the casting Paladin's permanent Devotion from the party when canceled", () => {
    const sim = new Sim({ seed: 144, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    const allyId = sim.addPlayer('priest', 'Aura Cancel Ally');
    sim.setPlayerLevel(20, allyId);
    sim.partyInvite(allyId, sim.player.id);
    sim.partyAccept(allyId);
    const ally = sim.entities.get(allyId);
    if (!ally) throw new Error('missing aura cancel ally');

    run(sim, null, resolve(sim, 'devotion_ward'));
    sim.player.auras.unshift(aura('devotion_ward', 'buff_dr', 999, 0.05));
    ally.auras.push(aura('devotion_ward', 'buff_dr', 999, 0.05));

    sim.cancelAura('devotion_ward');

    for (const entity of [sim.player, ally]) {
      expect(entity.auras).not.toContainEqual(
        expect.objectContaining({ id: 'devotion_ward', sourceId: sim.player.id }),
      );
      expect(entity.auras).toContainEqual(
        expect.objectContaining({ id: 'devotion_ward', sourceId: 999 }),
      );
    }
  });

  it('makes Hammer of Grace restore mana and heal on one successful hit', () => {
    const grace = new Sim({ seed: 107, playerClass: 'paladin', autoEquip: true });
    grace.setPlayerLevel(20);
    grace.setSpec('retribution');
    const graceTarget = hostileNear(grace);
    grace.player.resource = 0;
    grace.player.hp = 1;
    grace.rng.next = () => 0.9;
    run(grace, graceTarget, resolve(grace, 'hammer_of_grace'));
    expect(grace.player.resource).toBe(70);
    const events = grace.drainEvents();
    const damage = events.find(
      (event) => event.type === 'damage' && event.targetId === graceTarget.id,
    );
    expect(damage?.type).toBe('damage');
    if (damage?.type !== 'damage') throw new Error('missing Hammer of Grace damage');
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'heal2',
        targetId: grace.player.id,
        amount: Math.round(damage.amount * 0.5),
      }),
    );
  });

  it('lets Hammer of Grace generate Devotion for every specialization', () => {
    for (const spec of ['holy', 'protection', 'retribution'] as const) {
      const sim = new Sim({ seed: 151, playerClass: 'paladin', autoEquip: true });
      sim.setPlayerLevel(20);
      sim.setSpec(spec);
      const target = hostileNear(sim);
      sim.player.hp = 1;
      sim.rng.next = () => 0.9;

      run(sim, target, resolve(sim, 'hammer_of_grace'));

      expect(sim.player.hp).toBeGreaterThan(1);
      expect(sim.player.paladinDevotion?.value).toBe(1);
    }
  });

  it('lets a pure Mending Light heal generate Devotion for every specialization', () => {
    for (const spec of ['holy', 'protection', 'retribution'] as const) {
      const sim = new Sim({ seed: 153, playerClass: 'paladin', autoEquip: true });
      sim.setPlayerLevel(20);
      sim.setSpec(spec);
      sim.player.hp = 1;

      run(sim, sim.player, resolve(sim, 'holy_light'));

      expect(sim.player.hp).toBeGreaterThan(1);
      expect(sim.player.paladinDevotion?.value).toBe(1);
    }
  });

  it('restores mana on an absorbed Hammer of Grace but heals from effective damage only', () => {
    const absorbed = new Sim({ seed: 114, playerClass: 'paladin', autoEquip: true });
    absorbed.setPlayerLevel(20);
    absorbed.setSpec('retribution');
    const absorbedTarget = hostileNear(absorbed);
    absorbedTarget.auras.push(aura('test_absorb', 'absorb', absorbedTarget.id, 1_000_000));
    absorbed.player.resource = 0;
    absorbed.player.hp = 1;
    absorbed.rng.next = () => 0.9;
    run(absorbed, absorbedTarget, resolve(absorbed, 'hammer_of_grace'));
    expect(absorbedTarget.hp).toBe(absorbedTarget.maxHp);
    expect(absorbed.player.resource).toBe(70);
    expect(absorbed.player.hp).toBe(1);
    expect(absorbed.player.paladinDevotion?.value).toBe(0);
    expect(absorbed.drainEvents()).not.toContainEqual(
      expect.objectContaining({ type: 'heal2', ability: 'Hammer of Grace' }),
    );
  });

  it('damages enemies with Solar Invocation and grants Devotion for either valid use', () => {
    const sim = new Sim({ seed: 129, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.setSpec('holy');
    const enemy = hostileNear(sim);
    sim.drainEvents();

    run(sim, enemy, resolve(sim, 'solar_invocation'));
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
    expect(sim.player.paladinDevotion?.value).toBe(1);
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'spellfx',
        fx: 'paladinHolyShock',
        targetId: enemy.id,
        impact: 'offensive',
      }),
    );

    sim.player.hp = 1;
    run(sim, sim.player, resolve(sim, 'solar_invocation'));
    expect(sim.player.hp).toBeGreaterThan(1);
    expect(sim.player.paladinDevotion?.value).toBe(2);
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'spellfx',
        fx: 'paladinHolyShock',
        targetId: sim.playerId,
        impact: 'healing',
      }),
    );
  });

  it('applies Sacred Form healing and threat modifiers', () => {
    const sim = new Sim({ seed: 113, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.setSpec('holy');
    const critBefore = sim.ctx.spellCrit(sim.player);
    run(sim, null, resolve(sim, 'sacred_form'));

    expect(threatModifier(sim.player, 'holy')).toBeCloseTo(0.5, 10);
    expect(sim.ctx.spellCrit(sim.player)).toBeCloseTo(critBefore + 0.05, 10);
    expect(sim.player.auras.filter((active) => active.id.startsWith('sacred_form'))).toEqual([
      expect.objectContaining({
        id: 'sacred_form',
        kind: 'sacred_form',
        permanent: true,
        remaining: Number.POSITIVE_INFINITY,
      }),
    ]);
    sim.player.hp = 1;
    const internals = sim as unknown as {
      ctx: {
        applyHeal(
          source: Entity,
          target: Entity,
          amount: number,
          ability: string,
          abilityId: string | null,
          canCrit: boolean,
        ): number;
      };
    };
    expect(internals.ctx.applyHeal(sim.player, sim.player, 100, 'Test', null, false)).toBe(110);

    for (let i = 0; i < 40; i++) sim.tick();
    expect(sim.player.auras).toContainEqual(
      expect.objectContaining({ id: 'sacred_form', permanent: true }),
    );

    const attacker = hostileNear(sim);
    (
      sim as unknown as {
        dealDamage(
          source: Entity,
          target: Entity,
          amount: number,
          crit: boolean,
          school: string,
          ability: string,
          kind: 'hit',
        ): void;
      }
    ).dealDamage(attacker, sim.player, 1_000_000, false, 'holy', 'Test', 'hit');
    expect(sim.player.dead).toBe(true);
    expect(sim.player.auras.some((active) => active.id === 'sacred_form')).toBe(false);
  });

  it('lets Solar Step remain stationary until the player supplies movement input', () => {
    const sim = new Sim({ seed: 127, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    run(sim, null, resolve(sim, 'solar_step'));
    const before = { ...sim.player.pos };

    sim.tick();

    expect(sim.player.pos).toEqual(before);
    expect(sim.player.auras).toContainEqual(
      expect.objectContaining({ id: 'solar_step', kind: 'buff_speed' }),
    );

    sim.moveInput.forward = true;
    sim.tick();
    expect(Math.hypot(sim.player.pos.x - before.x, sim.player.pos.z - before.z)).toBeGreaterThan(0);
  });

  it('heals one target with Solar Invocation and splashes around that target in Ascension', () => {
    const sim = new Sim({ seed: 131, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.setSpec('holy');
    const primaryId = sim.addPlayer('priest', 'Solar Primary');
    const nearbyId = sim.addPlayer('warrior', 'Solar Nearby');
    const casterSideId = sim.addPlayer('mage', 'Solar Caster Side');
    const primary = sim.entities.get(primaryId);
    const nearby = sim.entities.get(nearbyId);
    const casterSide = sim.entities.get(casterSideId);
    if (!primary || !nearby || !casterSide) throw new Error('missing Solar Invocation ally');
    primary.pos.x = sim.player.pos.x + 20;
    nearby.pos.x = sim.player.pos.x + 25;
    casterSide.pos.x = sim.player.pos.x + 2;
    for (const ally of [primary, nearby, casterSide]) ally.hp = 1;

    run(sim, primary, resolve(sim, 'solar_invocation'));
    expect(primary.hp).toBeGreaterThan(1);
    expect(nearby.hp).toBe(1);
    expect(casterSide.hp).toBe(1);

    for (const ally of [primary, nearby, casterSide]) ally.hp = 1;
    grantDevotion(sim.player, 20);
    expect(activateDivineAscension(sim.player)).toBe(true);
    run(sim, primary, resolve(sim, 'solar_invocation'));

    expect(primary.hp).toBeGreaterThan(1);
    expect(nearby.hp).toBeGreaterThan(1);
    expect(casterSide.hp).toBe(1);
    expect(sim.player.paladinDevotion?.ascensionCharges).toBe(4);
  });

  it('never turns an offensive Ascension Solar Invocation into an area heal after a kill', () => {
    const sim = new Sim({ seed: 133, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.setSpec('holy');
    const target = hostileNear(sim);
    target.hp = 1;
    target.maxHp = 1;
    const allyId = sim.addPlayer('priest', 'Solar Bystander');
    const ally = sim.entities.get(allyId);
    if (!ally) throw new Error('missing Solar Invocation bystander');
    ally.pos.x = target.pos.x + 1;
    ally.pos.z = target.pos.z;
    ally.hp = 1;
    grantDevotion(sim.player, 20);
    expect(activateDivineAscension(sim.player)).toBe(true);

    run(sim, target, resolve(sim, 'solar_invocation'));

    expect(target.dead).toBe(true);
    expect(ally.hp).toBe(1);
  });

  it('stacks Devotion Aura by source in the real damage pipeline', () => {
    const sim = new Sim({ seed: 137, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    const attacker = hostileNear(sim);
    sim.player.auras.push(aura('devotion_ward', 'buff_dr', 50, 0.05));
    sim.player.auras.push(aura('devotion_ward', 'buff_dr', 51, 0.05));
    sim.player.hp = sim.player.maxHp;
    const before = sim.player.hp;

    (
      sim as unknown as {
        dealDamage(
          source: Entity,
          target: Entity,
          amount: number,
          crit: boolean,
          school: string,
          ability: string,
          kind: 'hit',
        ): void;
      }
    ).dealDamage(attacker, sim.player, 100, false, 'physical', 'Test', 'hit');

    expect(before - sim.player.hp).toBe(90);
  });
});
