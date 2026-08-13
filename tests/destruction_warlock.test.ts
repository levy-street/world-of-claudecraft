import { describe, expect, it } from 'vitest';
import {
  applyDuskfireClaim,
  PYRE_COLOSSUS_DURATION,
  ruinAmount,
  summonPyreColossus,
} from '../src/sim/combat/destruction';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers, emptyAllocation } from '../src/sim/content/talents';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { encodeObs } from '../src/sim/obs';
import { serializePet } from '../src/sim/pet/pet_commands';
import { Sim } from '../src/sim/sim';
import { channelTickBonus } from '../src/sim/spell_scaling';
import type { Entity, SimEvent } from '../src/sim/types';

function destructionAt(level = 20) {
  const sim = new Sim({ seed: 72, playerClass: 'warlock', autoEquip: true });
  sim.setPlayerLevel(level);
  expect(sim.setSpec('destruction')).toBe(true);
  sim.tick();
  const p = sim.player;
  p.resource = p.maxResource;
  return { sim, p };
}

function addDummy(sim: Sim, id: number, offsetX = 0, hp = 1_000_000): Entity {
  const p = sim.player;
  const mob = createMob(id, MOBS.training_dummy, 20, {
    x: p.pos.x + offsetX,
    y: p.pos.y,
    z: p.pos.z + 8,
  });
  mob.hostile = true;
  mob.maxHp = mob.hp = hp;
  mob.aiState = 'attack';
  mob.aggroTargetId = p.id;
  mob.combatTimer = 0;
  p.inCombat = true;
  p.combatTimer = 0;
  (sim as unknown as { addEntity(e: Entity): void }).addEntity(mob);
  return mob;
}

function collect(sim: Sim, seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds * 20); i++) out.push(...sim.tick());
  return out;
}

function resetGcd(p: Entity): void {
  p.gcdRemaining = 0;
}

function giveRuin(p: Entity, stacks: number): void {
  p.auras = p.auras.filter((aura) => aura.id !== 'destruction_ruin');
  if (stacks <= 0) return;
  p.auras.push({
    id: 'destruction_ruin',
    name: 'Ruin',
    kind: 'destruction_ruin',
    value: stacks,
    stacks,
    remaining: 3600,
    duration: 3600,
    sourceId: p.id,
    school: 'fire',
  });
}

function giveDesolation(p: Entity, stacks = 1): void {
  p.auras.push({
    id: 'desolation',
    name: 'Desolation',
    kind: 'desolation',
    value: stacks,
    stacks,
    remaining: 15,
    duration: 15,
    sourceId: p.id,
    school: 'fire',
  });
}

function castAndLand(sim: Sim, abilityId: string, seconds = 4): SimEvent[] {
  sim.castAbility(abilityId);
  return collect(sim, seconds);
}

function destructionKnownAt(level: number): string[] {
  const mods = computeTalentModifiers('warlock', {
    ...emptyAllocation(),
    spec: 'destruction',
  } as never);
  return abilitiesKnownAt('warlock', level, mods).map((known) => known.def.id);
}

describe('destruction progression', () => {
  it('labels the existing Gloom Bolt projectile cue for its dedicated renderer', () => {
    const { sim } = destructionAt(5);
    const mob = addDummy(sim, 9788);
    sim.targetEntity(mob.id);

    const events = castAndLand(sim, 'shadow_bolt', 2);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'spellfx',
        sourceId: sim.player.id,
        targetId: mob.id,
        fx: 'projectile',
        ability: 'shadow_bolt',
      }),
    );
  });

  it('introduces the spec loop in stages from Conflagrate to the Pyre Colossus', () => {
    expect(destructionKnownAt(5)).toContain('conflagrate');
    expect(destructionKnownAt(5)).toContain('chaos_bolt');
    expect(destructionKnownAt(4)).not.toContain('chaos_bolt');

    expect(destructionKnownAt(8)).toContain('rain_of_fire');
    expect(destructionKnownAt(7)).not.toContain('rain_of_fire');
    expect(destructionKnownAt(10)).toContain('ruinous_brand');
    expect(destructionKnownAt(9)).not.toContain('ruinous_brand');
    expect(destructionKnownAt(12)).toContain('shadowburn');
    expect(destructionKnownAt(11)).not.toContain('shadowburn');
    expect(destructionKnownAt(13)).toContain('summon_infernal');
    expect(destructionKnownAt(12)).not.toContain('summon_infernal');
    for (const retired of [
      'corruption',
      'curse_of_agony',
      'searing_pain',
      'summon_succubus',
      'summon_felhunter',
      'summon_felguard',
      'summon_doomguard',
    ]) {
      expect(destructionKnownAt(20), retired).not.toContain(retired);
    }
    expect(destructionKnownAt(20)).toEqual(
      expect.arrayContaining(['summon_imp', 'summon_voidwalker', 'soulwell']),
    );
    expect(destructionKnownAt(20)).toHaveLength(18);
    expect(
      destructionKnownAt(20).filter((id) =>
        ABILITIES[id]?.effects.some(
          (effect) => effect.type === 'summonDemon' || effect.type === 'summonPyreColossus',
        ),
      ),
    ).toEqual(['summon_imp', 'summon_voidwalker', 'summon_infernal']);
    expect(ABILITIES.rain_of_fire.effects).toEqual([
      expect.objectContaining({ type: 'groundAoE', min: 5, max: 7, duration: 4 }),
    ]);
    expect(ABILITIES.rain_of_fire.ranks?.[0]).toEqual(
      expect.objectContaining({
        rank: 2,
        level: 18,
        effects: [expect.objectContaining({ type: 'groundAoE', min: 8, max: 11, duration: 6 })],
      }),
    );
  });

  it('keeps the Ruin spenders exclusive to committed Destruction', () => {
    const mods = computeTalentModifiers('warlock', {
      ...emptyAllocation(),
      spec: 'affliction',
    } as never);
    const affliction = abilitiesKnownAt('warlock', 20, mods).map((known) => known.def.id);
    for (const id of ['chaos_bolt', 'shadowburn', 'ruinous_brand', 'rain_of_fire']) {
      expect(affliction, id).not.toContain(id);
    }
    expect(affliction).toEqual(
      expect.arrayContaining(['evil_eye', 'needle_of_fate', 'sentence', 'drain_life']),
    );
  });

  it('transfers 70% of Consume damage as health while Affliction transfers the full amount', () => {
    const consumeFraction = (spec: 'affliction' | 'destruction', level: number) => {
      const mods = computeTalentModifiers('warlock', {
        ...emptyAllocation(),
        spec,
      } as never);
      const consume = abilitiesKnownAt('warlock', level, mods).find(
        (known) => known.def.id === 'drain_life',
      );
      const drain = consume?.effects.find((effect) => effect.type === 'drainTick');
      if (drain?.type !== 'drainTick') throw new Error(`Missing ${spec} Consume drain`);
      return drain.healFrac;
    };

    for (const level of [9, 14, 20]) {
      expect(consumeFraction('destruction', level)).toBe(0.7);
      expect(consumeFraction('affliction', level)).toBe(1);
    }
  });

  it('applies the reduced transfer across all three live Destruction Consume ticks', () => {
    const { sim, p } = destructionAt();
    const mob = addDummy(sim, 9789);
    sim.targetEntity(mob.id);
    p.hp = 1;

    const consume = sim.ctx.resolvedAbility('drain_life', p.id);
    const drain = consume?.effects.find((effect) => effect.type === 'drainTick');
    if (!consume || drain?.type !== 'drainTick') throw new Error('Missing Destruction Consume');
    const spellPowerBonus = channelTickBonus(p.spellPower, consume.def);
    expect(spellPowerBonus).toBeGreaterThan(0);
    const rawTick = drain.min + spellPowerBonus;
    const expectedHeal = Math.round(rawTick * 0.7);

    sim.castAbility('drain_life');
    const events = collect(sim, 6);
    const heals = events.filter(
      (event) => event.type === 'heal2' && event.ability === consume.def.name,
    );

    expect(heals).toHaveLength(3);
    expect(heals).toEqual(
      Array.from({ length: 3 }, () =>
        expect.objectContaining({
          type: 'heal2',
          sourceId: p.id,
          targetId: p.id,
          amount: expectedHeal,
        }),
      ),
    );
    expect(p.hp).toBe(1 + expectedHeal * 3);
  });

  it('pins the siege tuning anchors and the shared major-offense/capstone choices', () => {
    expect(ABILITIES.chaos_bolt).toMatchObject({
      castTime: 2.5,
      cooldown: 0,
      ruinCost: 3,
      effects: [{ type: 'directDamage', min: 192, max: 235 }],
    });
    expect(ABILITIES.shadow_bolt.effects).toEqual([{ type: 'directDamage', min: 36, max: 50 }]);
    expect(ABILITIES.shadow_bolt.ranks?.map((rank) => rank.effects)).toEqual([
      [{ type: 'directDamage', min: 67, max: 87 }],
      [{ type: 'directDamage', min: 118, max: 148 }],
      [{ type: 'directDamage', min: 126, max: 156 }],
    ]);
    expect(ABILITIES.immolate.effects).toEqual([
      { type: 'directDamage', min: 31, max: 31 },
      { type: 'dot', total: 56, duration: 15, interval: 3 },
    ]);
    expect(ABILITIES.immolate.ranks?.map((rank) => rank.effects)).toEqual([
      [
        { type: 'directDamage', min: 62, max: 62 },
        { type: 'dot', total: 98, duration: 15, interval: 3 },
      ],
      [
        { type: 'directDamage', min: 70, max: 70 },
        { type: 'dot', total: 100, duration: 15, interval: 3 },
      ],
    ]);
    expect(ABILITIES.conflagrate.effects).toEqual([
      { type: 'destructionConflagrate' },
      { type: 'directDamage', min: 118, max: 140 },
    ]);
    expect(ABILITIES.summon_infernal).toMatchObject({
      castTime: 0,
      cooldown: 180,
      effects: [
        { type: 'aoeDamage', min: 58, max: 72, radius: 6 },
        { type: 'summonPyreColossus', duration: 30 },
      ],
    });
    expect(PYRE_COLOSSUS_DURATION).toBe(30);

    const majorOffense = computeTalentModifiers('warlock', {
      spec: 'destruction',
      rows: { 17: 'wlk_r17_death_coil' },
    });
    expect(majorOffense.abilities.chaos_bolt?.dmgPct).toBeUndefined();
    expect(majorOffense.abilities.hex_of_violence?.cooldownPct).toBe(-0.25);
    expect(majorOffense.abilities.unholy_command?.cooldownPct).toBe(-0.25);
    expect(majorOffense.abilities.ruinous_brand?.cooldownPct).toBe(-0.25);

    const capstone = computeTalentModifiers('warlock', {
      spec: 'destruction',
      rows: { 20: 'wlk_r20_chaos_bolt' },
    });
    expect(capstone.global.warlockUnbrokenRitual).toBe(0.5);
    expect(capstone.grants).not.toContainEqual({ ability: 'death_coil', rank: 1 });
  });
});

describe('Ruin engine and Desolation', () => {
  it('builds one Ruin per classic tick out of combat up to three, but not while fighting', () => {
    const { sim, p } = destructionAt();

    expect(ruinAmount(p)).toBe(0);
    collect(sim, 1.9);
    expect(ruinAmount(p)).toBe(0);
    collect(sim, 0.1);
    expect(ruinAmount(p)).toBe(1);
    collect(sim, 2);
    expect(ruinAmount(p)).toBe(2);
    collect(sim, 2);
    expect(ruinAmount(p)).toBe(3);

    collect(sim, 8);
    expect(ruinAmount(p)).toBe(3);

    giveRuin(p, 0);
    p.inCombat = true;
    p.combatTimer = 0;
    collect(sim, 2);
    expect(ruinAmount(p)).toBe(0);

    p.inCombat = false;
    p.combatTimer = 5;
    expect(sim.setSpec('affliction')).toBe(true);
    collect(sim, 6);
    expect(ruinAmount(p)).toBe(0);
  });

  it('clears Destruction-only state when the player leaves the specialization', () => {
    const { sim, p } = destructionAt();
    const mob = addDummy(sim, 9700);
    sim.targetEntity(mob.id);
    p.facing = 0;
    castAndLand(sim, 'shadow_bolt');
    resetGcd(p);
    castAndLand(sim, 'ruinous_brand', 1);
    giveDesolation(p);
    applyDuskfireClaim(sim.ctx, p, mob, 5);
    summonPyreColossus(sim.ctx, p);
    expect(ruinAmount(p)).toBe(1);
    expect(p.auras.some((aura) => aura.id === 'desolation')).toBe(true);
    expect(mob.auras.some((aura) => aura.id === 'ruinous_brand')).toBe(true);
    expect(mob.auras.some((aura) => aura.id === 'duskfire_claim')).toBe(true);
    expect(
      [...sim.entities.values()].some(
        (entity) => entity.ownerId === p.id && entity.templateId === 'pyre_colossus',
      ),
    ).toBe(true);

    p.inCombat = false;
    expect(sim.setSpec('affliction')).toBe(true);

    expect(ruinAmount(p)).toBe(0);
    expect(p.auras.some((aura) => aura.id === 'desolation')).toBe(false);
    expect(mob.auras.some((aura) => aura.id === 'ruinous_brand')).toBe(false);
    expect(mob.auras.some((aura) => aura.id === 'duskfire_claim')).toBe(false);
    expect(
      [...sim.entities.values()].some(
        (entity) => entity.ownerId === p.id && entity.templateId === 'pyre_colossus',
      ),
    ).toBe(false);
  });

  it('Gloom Bolt generates one Ruin on impact and caps the meter at five', () => {
    const { sim, p } = destructionAt();
    const mob = addDummy(sim, 9701);
    sim.targetEntity(mob.id);
    p.facing = 0;

    for (let cast = 0; cast < 6; cast++) {
      castAndLand(sim, 'shadow_bolt');
      resetGcd(p);
      p.resource = p.maxResource;
    }

    expect(ruinAmount(p)).toBe(5);
    const meter = p.auras.find((aura) => aura.id === 'destruction_ruin');
    expect(meter?.stacks).toBe(5);
  });

  it('does not grant Gloom Bolt Ruin before impact or when its projectile fizzles', () => {
    const { sim, p } = destructionAt();
    const mob = addDummy(sim, 9717, 0);
    sim.targetEntity(mob.id);
    p.facing = 0;

    sim.castAbility('shadow_bolt');
    for (let ticks = 0; ticks < 100 && sim.ctx.pendingProjectiles.length === 0; ticks++) sim.tick();
    expect(sim.ctx.pendingProjectiles).toHaveLength(1);
    expect(ruinAmount(p)).toBe(0);

    mob.dead = true;
    sim.tick();
    expect(sim.ctx.pendingProjectiles).toHaveLength(0);
    expect(ruinAmount(p)).toBe(0);
  });

  it('Conflagrate needs Burning Pact, advances one future tick, and grants Ruin + Desolation', () => {
    const { sim, p } = destructionAt();
    const mob = addDummy(sim, 9702);
    sim.targetEntity(mob.id);
    p.facing = 0;

    const manaBefore = p.resource;
    sim.castAbility('conflagrate');
    expect(p.resource).toBe(manaBefore);
    expect(p.cooldowns.has('conflagrate')).toBe(false);

    castAndLand(sim, 'immolate', 3);
    resetGcd(p);
    const pact = mob.auras.find((aura) => aura.id === 'immolate');
    expect(pact).toBeDefined();
    const remainingBefore = pact?.remaining ?? 0;

    castAndLand(sim, 'conflagrate', 1);

    expect(mob.auras.some((aura) => aura.id === 'immolate')).toBe(true);
    // Three seconds are pulled forward by Conflagrate and one more passes while
    // the instant projectile lands and the assertion window advances.
    expect(pact?.remaining).toBeCloseTo(remainingBefore - 4, 1);
    expect(ruinAmount(p)).toBe(1);
    expect(p.auras.find((aura) => aura.id === 'desolation')?.stacks).toBe(1);
    expect(p.abilityCharges?.conflagrate?.maxCharges).toBe(2);
  });

  it('Conflagrate spends two stored charges, rejects a third, and restores one after 18 seconds', () => {
    const { sim, p } = destructionAt();
    const mob = addDummy(sim, 9709);
    sim.targetEntity(mob.id);
    p.facing = 0;
    castAndLand(sim, 'immolate', 3);

    for (let use = 0; use < 2; use++) {
      resetGcd(p);
      p.resource = p.maxResource;
      sim.castAbility('conflagrate');
      collect(sim, 0.5);
    }
    expect(p.abilityCharges?.conflagrate?.charges).toBe(0);
    resetGcd(p);
    const manaBeforeThird = p.resource;
    sim.castAbility('conflagrate');
    expect(p.resource).toBe(manaBeforeThird);
    expect(p.abilityCharges?.conflagrate?.charges).toBe(0);

    collect(sim, 11);
    expect(p.abilityCharges?.conflagrate?.charges).toBe(0);
    // The two charges recharge in parallel from their own spend instants
    // (t=0 and t=0.5), so 18.2s after the first spend exactly one is back.
    collect(sim, 6.2);
    expect(p.abilityCharges?.conflagrate?.charges).toBe(1);
    const pact = mob.auras.find((aura) => aura.id === 'immolate');
    if (!pact) {
      mob.auras.push({
        id: 'immolate',
        name: 'Burning Pact',
        kind: 'dot',
        value: 12,
        remaining: 15,
        duration: 15,
        tickInterval: 3,
        tickTimer: 3,
        sourceId: p.id,
        school: 'fire',
      });
    }
    resetGcd(p);
    p.resource = p.maxResource;
    sim.castAbility('conflagrate');
    expect(p.abilityCharges?.conflagrate?.charges).toBe(0);
  });

  it('Ruinbolt costs three Ruin and Desolation shortens its cast without adding a cooldown', () => {
    const { sim, p } = destructionAt();
    const mob = addDummy(sim, 9703);
    sim.targetEntity(mob.id);
    p.facing = 0;

    sim.castAbility('chaos_bolt');
    expect(p.castingAbility).toBeNull();
    expect(ruinAmount(p)).toBe(0);

    for (let cast = 0; cast < 3; cast++) {
      castAndLand(sim, 'shadow_bolt');
      resetGcd(p);
      p.resource = p.maxResource;
    }
    giveDesolation(p);

    const baseCast = sim.resolvedAbility('chaos_bolt')?.castTime ?? 0;
    sim.castAbility('chaos_bolt');

    expect(p.castTotal).toBeCloseTo(baseCast * 0.7, 5);
    collect(sim, 4);
    expect(ruinAmount(p)).toBe(0);
    expect(p.cooldowns.has('chaos_bolt')).toBe(false);
    expect(p.auras.some((aura) => aura.id === 'desolation')).toBe(false);
  });

  it('Rain of Fire spends three Ruin without channel-locking the caster', () => {
    const { sim, p } = destructionAt();
    const mob = addDummy(sim, 9704);
    sim.targetEntity(mob.id);
    p.facing = 0;

    for (let cast = 0; cast < 3; cast++) {
      castAndLand(sim, 'shadow_bolt');
      resetGcd(p);
      p.resource = p.maxResource;
    }
    sim.castAbility('rain_of_fire', undefined, { x: mob.pos.x, z: mob.pos.z });

    expect(p.channeling).toBe(false);
    expect(p.castingAbility).toBeNull();
    expect(ruinAmount(p)).toBe(0);
    expect(
      collect(sim, 7).some(
        (event) =>
          event.type === 'damage' &&
          event.sourceId === p.id &&
          event.targetId === mob.id &&
          event.ability === 'Rain of Fire',
      ),
    ).toBe(true);
  });

  it('delays Rain of Fire normally but Desolation makes exactly its first wave immediate', () => {
    const normal = destructionAt();
    const normalMob = addDummy(normal.sim, 9710);
    normal.sim.targetEntity(normalMob.id);
    normal.p.facing = 0;
    giveRuin(normal.p, 3);
    const normalHp = normalMob.hp;
    normal.sim.castAbility('rain_of_fire', undefined, {
      x: normalMob.pos.x,
      z: normalMob.pos.z,
    });
    expect(normalMob.hp).toBe(normalHp);
    collect(normal.sim, 0.95);
    expect(normalMob.hp).toBe(normalHp);
    collect(normal.sim, 0.1);
    expect(normalMob.hp).toBeLessThan(normalHp);

    const empowered = destructionAt();
    const empoweredMob = addDummy(empowered.sim, 9711);
    empowered.sim.targetEntity(empoweredMob.id);
    empowered.p.facing = 0;
    giveRuin(empowered.p, 3);
    giveDesolation(empowered.p, 2);
    const empoweredHp = empoweredMob.hp;
    empowered.sim.castAbility('rain_of_fire', undefined, {
      x: empoweredMob.pos.x,
      z: empoweredMob.pos.z,
    });
    expect(empoweredMob.hp).toBeLessThan(empoweredHp);
    expect(empowered.p.auras.find((aura) => aura.id === 'desolation')?.stacks).toBe(1);
  });

  it('keeps all six Rain of Fire waves when Desolation moves only the first one forward', () => {
    const castRain = (empowered: boolean): SimEvent[] => {
      const { sim, p } = destructionAt();
      const mob = addDummy(sim, empowered ? 9731 : 9730);
      sim.targetEntity(mob.id);
      p.facing = 0;
      giveRuin(p, 3);
      if (empowered) giveDesolation(p);
      sim.castAbility('rain_of_fire', undefined, { x: mob.pos.x, z: mob.pos.z });
      return collect(sim, 7).filter(
        (event) =>
          event.type === 'damage' &&
          event.sourceId === p.id &&
          event.targetId === mob.id &&
          event.ability === 'Rain of Fire',
      );
    };

    expect(castRain(false)).toHaveLength(6);
    expect(castRain(true)).toHaveLength(6);
  });

  it('publishes Ruin and Ruin-spender readiness through the headless observation contract', () => {
    const { sim, p } = destructionAt();
    const slot = sim.known.findIndex((known) => known.def.id === 'chaos_bolt');
    expect(slot).toBeGreaterThanOrEqual(0);

    let obs = encodeObs(sim);
    expect(obs[13]).toBe(0);
    expect(obs[16 + slot * 2]).toBe(0);

    giveRuin(p, 3);
    obs = encodeObs(sim);
    expect(obs[13]).toBe(0.6);
    expect(obs[16 + slot * 2]).toBe(1);
  });
});

describe('Destruction finishers and target switching', () => {
  it('Duskfire is execute-only and refunds its Ruin when the marked target dies', () => {
    const { sim, p } = destructionAt();
    const mob = addDummy(sim, 9705, 0, 1_000);
    sim.targetEntity(mob.id);
    p.facing = 0;

    giveRuin(p, 1);
    mob.hp = mob.maxHp * 0.2;
    sim.castAbility('shadowburn');
    expect(mob.hp).toBe(mob.maxHp * 0.2);
    expect(ruinAmount(p)).toBe(1);

    resetGcd(p);
    p.hitBonus = 1;
    mob.hp = 99;
    const events = castAndLand(sim, 'shadowburn', 2);
    expect(
      events.some(
        (event) =>
          event.type === 'damage' && event.targetId === mob.id && event.ability === 'Duskfire',
      ),
    ).toBe(true);
    expect(ruinAmount(p)).toBe(0);
    expect(mob.auras.some((aura) => aura.id === 'duskfire_claim')).toBe(true);
    (sim as any).dealDamage(p, mob, mob.hp, false, 'physical', 'Test Finisher', 'hit');
    expect(ruinAmount(p)).toBe(1);
  });

  it('Duskfire spends first, refunds on a later death inside five seconds, and expires cleanly', () => {
    const inside = destructionAt();
    const insideMob = addDummy(inside.sim, 9712, 0, 500);
    inside.sim.targetEntity(insideMob.id);
    inside.p.facing = 0;
    inside.p.hitBonus = 1;
    insideMob.hp = 99;
    giveRuin(inside.p, 1);
    inside.sim.castAbility('shadowburn');
    expect(ruinAmount(inside.p)).toBe(0);
    collect(inside.sim, 0.5);
    expect(insideMob.dead).toBe(false);
    expect(insideMob.auras.some((aura) => aura.id === 'duskfire_claim')).toBe(true);
    (inside.sim as any).dealDamage(
      inside.p,
      insideMob,
      insideMob.hp,
      false,
      'physical',
      'Test Finisher',
      'hit',
    );
    expect(ruinAmount(inside.p)).toBe(1);

    const expired = destructionAt();
    const expiredMob = addDummy(expired.sim, 9713, 0, 500);
    expired.sim.targetEntity(expiredMob.id);
    expired.p.facing = 0;
    expiredMob.hp = 99;
    giveRuin(expired.p, 1);
    expired.sim.castAbility('shadowburn');
    expect(ruinAmount(expired.p)).toBe(0);
    collect(expired.sim, 0.5);
    collect(expired.sim, 5.1);
    (expired.sim as any).dealDamage(
      expired.p,
      expiredMob,
      expiredMob.hp,
      false,
      'physical',
      'Test Finisher',
      'hit',
    );
    expect(ruinAmount(expired.p)).toBe(0);
  });

  it('Ruinous Brand copies three direct casts at half power without generating extra Ruin', () => {
    const { sim, p } = destructionAt();
    const primary = addDummy(sim, 9706);
    const branded = addDummy(sim, 9707, 3);
    p.facing = 0;
    // Never-resist rig: a resisted bolt passes the half-power copy assertions
    // trivially (0 === 0.5 * 0) while silently dropping its impact Ruin, and
    // the spell-hit table keeps a 1% resist floor that hitBonus cannot
    // suppress, so draw-order moves from content merges can flake the final
    // count (they did on the v0.35.0 catch-up). Force only the near-certain
    // rolls (the capped hit roll) to succeed; crit and damage rolls stay real.
    p.hitBonus = 1;
    const realChance = sim.rng.chance.bind(sim.rng);
    sim.rng.chance = (chance: number) => (chance >= 0.98 ? true : realChance(chance));

    sim.targetEntity(branded.id);
    castAndLand(sim, 'ruinous_brand', 1);
    expect(branded.auras.find((aura) => aura.id === 'ruinous_brand')?.stacks).toBe(3);
    resetGcd(p);

    sim.targetEntity(primary.id);
    for (let cast = 0; cast < 3; cast++) {
      const primaryBefore = primary.hp;
      const brandedBefore = branded.hp;
      castAndLand(sim, 'shadow_bolt');
      const primaryDamage = primaryBefore - primary.hp;
      const brandDamage = brandedBefore - branded.hp;
      expect(brandDamage).toBe(Math.round(primaryDamage * 0.5));
      resetGcd(p);
      p.resource = p.maxResource;
    }

    expect(branded.auras.some((aura) => aura.id === 'ruinous_brand')).toBe(false);
    expect(ruinAmount(p)).toBe(3);
  });

  it('launches a second visible Ruinbolt from the caster toward a different branded target', () => {
    const { sim, p } = destructionAt();
    const primary = addDummy(sim, 9740);
    const branded = addDummy(sim, 9741, 3);
    p.facing = 0;

    sim.targetEntity(branded.id);
    castAndLand(sim, 'ruinous_brand', 1);
    resetGcd(p);
    p.resource = p.maxResource;
    giveRuin(p, 3);

    sim.targetEntity(primary.id);
    sim.castAbility('chaos_bolt');
    const beforePrimaryImpact: SimEvent[] = [];
    for (let ticks = 0; ticks < 100 && sim.ctx.pendingProjectiles.length === 0; ticks++) {
      beforePrimaryImpact.push(...sim.tick());
    }
    expect(sim.ctx.pendingProjectiles).toHaveLength(1);
    expect(
      beforePrimaryImpact.some(
        (event) => event.type === 'spellfx' && event.targetId === branded.id,
      ),
    ).toBe(false);
    let impactEvents: SimEvent[] = [];
    for (let ticks = 0; ticks < 100 && sim.ctx.pendingProjectiles.length > 0; ticks++) {
      const tickEvents = sim.tick();
      if (sim.ctx.pendingProjectiles.length > 0) {
        expect(
          tickEvents.some((event) => event.type === 'spellfx' && event.targetId === branded.id),
        ).toBe(false);
      } else {
        impactEvents = tickEvents;
      }
    }
    expect(sim.ctx.pendingProjectiles).toHaveLength(0);

    expect(
      impactEvents.filter(
        (event) =>
          event.type === 'spellfx' && event.sourceId === p.id && event.targetId === branded.id,
      ),
    ).toEqual([
      expect.objectContaining({
        type: 'spellfx',
        sourceId: p.id,
        targetId: branded.id,
        school: 'fire',
        fx: 'heavyBolt',
        ability: 'chaos_bolt',
      }),
    ]);
    expect(
      collect(sim, 1).some(
        (event) =>
          event.type === 'spellfx' && event.sourceId === p.id && event.targetId === branded.id,
      ),
    ).toBe(false);
  });

  it('Ruinous Brand echoes at quarter power on itself and half power across targets', () => {
    const { sim, p } = destructionAt();
    const primary = addDummy(sim, 9714);
    const branded = addDummy(sim, 9715, 3);
    p.facing = 0;
    sim.targetEntity(branded.id);
    castAndLand(sim, 'ruinous_brand', 1);
    resetGcd(p);
    branded.auras.push({
      id: 'test_brand_dr',
      name: 'Test Brand DR',
      kind: 'buff_dr',
      value: 0.5,
      remaining: 30,
      duration: 30,
      sourceId: branded.id,
      school: 'shadow',
    });

    const brandedBeforeSelfCast = branded.hp;
    const selfEvents = castAndLand(sim, 'shadow_bolt');
    const directSelfHit = selfEvents.find(
      (event) =>
        event.type === 'damage' && event.targetId === branded.id && event.ability === 'Gloom Bolt',
    );
    if (directSelfHit?.type !== 'damage') {
      throw new Error('missing branded-target Gloom Bolt damage');
    }
    expect(brandedBeforeSelfCast - branded.hp).toBe(
      directSelfHit.amount + Math.round(directSelfHit.amount * 0.25),
    );
    expect(branded.auras.find((aura) => aura.id === 'ruinous_brand')?.stacks).toBe(2);
    resetGcd(p);
    p.resource = p.maxResource;

    primary.auras.push({
      id: 'test_dr',
      name: 'Test DR',
      kind: 'buff_dr',
      value: 0.5,
      remaining: 30,
      duration: 30,
      sourceId: primary.id,
      school: 'shadow',
    });
    sim.targetEntity(primary.id);
    branded.auras.push({
      id: 'test_brand_absorb',
      name: 'Test Brand Absorb',
      kind: 'absorb',
      value: 10_000,
      remaining: 30,
      duration: 30,
      sourceId: branded.id,
      school: 'shadow',
    });
    const primaryHp = primary.hp;
    const brandedHp = branded.hp;
    castAndLand(sim, 'shadow_bolt');
    const resolvedPrimary = primaryHp - primary.hp;
    expect(brandedHp - branded.hp).toBe(Math.round(resolvedPrimary * 0.5));
    expect(branded.auras.find((aura) => aura.id === 'test_brand_absorb')?.value).toBe(10_000);
    expect(branded.auras.find((aura) => aura.id === 'ruinous_brand')?.stacks).toBe(1);
  });
  it('copies landed damage before reactive healing and spends a charge on a full absorb', () => {
    const { sim, p } = destructionAt();
    const primary = addDummy(sim, 9718);
    const branded = addDummy(sim, 9719, 3);
    p.facing = 0;
    sim.targetEntity(branded.id);
    castAndLand(sim, 'ruinous_brand', 1);
    resetGcd(p);

    primary.auras.push({
      id: 'test_heal_echo',
      name: 'Test Heal Echo',
      kind: 'heal_echo',
      value: 1_000,
      value2: 1,
      remaining: 30,
      duration: 30,
      sourceId: p.id,
      school: 'shadow',
    });
    sim.targetEntity(primary.id);
    const brandedHp = branded.hp;
    const events = castAndLand(sim, 'shadow_bolt');
    const landed = events.find(
      (event) =>
        event.type === 'damage' && event.targetId === primary.id && event.ability === 'Gloom Bolt',
    );
    if (!landed || landed.type !== 'damage') throw new Error('missing Gloom Bolt damage');
    expect(primary.hp).toBe(primary.maxHp);
    expect(brandedHp - branded.hp).toBe(Math.round(landed.amount * 0.5));
    expect(branded.auras.find((aura) => aura.id === 'ruinous_brand')?.stacks).toBe(2);

    primary.auras.push({
      id: 'test_absorb',
      name: 'Test Absorb',
      kind: 'absorb',
      value: 10_000,
      remaining: 30,
      duration: 30,
      sourceId: primary.id,
      school: 'shadow',
    });
    resetGcd(p);
    p.resource = p.maxResource;
    const hpBeforeAbsorb = branded.hp;
    castAndLand(sim, 'shadow_bolt');
    expect(branded.hp).toBe(hpBeforeAbsorb);
    expect(branded.auras.find((aura) => aura.id === 'ruinous_brand')?.stacks).toBe(1);
  });

  it('spends a Brand charge when a committed projectile later fizzles', () => {
    const { sim, p } = destructionAt();
    const primary = addDummy(sim, 9735);
    const branded = addDummy(sim, 9736, 3);
    p.facing = 0;
    sim.targetEntity(branded.id);
    castAndLand(sim, 'ruinous_brand', 1);
    resetGcd(p);
    p.resource = p.maxResource;

    sim.targetEntity(primary.id);
    sim.castAbility('shadow_bolt');
    for (let ticks = 0; ticks < 100 && sim.ctx.pendingProjectiles.length === 0; ticks++) sim.tick();

    expect(sim.ctx.pendingProjectiles).toHaveLength(1);
    expect(branded.auras.find((aura) => aura.id === 'ruinous_brand')?.stacks).toBe(2);
    const brandedHp = branded.hp;

    primary.dead = true;
    sim.tick();

    expect(sim.ctx.pendingProjectiles).toHaveLength(0);
    expect(branded.hp).toBe(brandedHp);
    expect(branded.auras.find((aura) => aura.id === 'ruinous_brand')?.stacks).toBe(2);
  });

  it('treats resolved HP-loss copies as source-final even if the caller omits alreadyFinal', () => {
    const { sim, p } = destructionAt();
    const target = addDummy(sim, 9737);
    p.auras.push({
      id: 'test_source_amp',
      name: 'Test Source Amp',
      kind: 'buff_dmg_done',
      value: 1,
      remaining: 30,
      duration: 30,
      sourceId: p.id,
      school: 'shadow',
    });
    const hpBefore = target.hp;

    sim.dealDamage(
      p,
      target,
      100,
      false,
      'shadow',
      'Resolved Copy',
      'hit',
      false,
      undefined,
      true,
      false,
      false,
      null,
      false,
      undefined,
      true,
    );

    expect(hpBefore - target.hp).toBe(100);
  });
});

describe('Pyre Colossus', () => {
  it('serves for 30 sec without replacing the controlled demon', () => {
    const { sim, p } = destructionAt();
    const mob = addDummy(sim, 9708);
    sim.targetEntity(mob.id);
    p.facing = 0;

    for (let cast = 0; cast < 3; cast++) {
      castAndLand(sim, 'shadow_bolt');
      resetGcd(p);
      p.resource = p.maxResource;
    }
    castAndLand(sim, 'summon_imp', 6);
    expect([...sim.entities.values()].some((entity) => entity.templateId === 'emberkin')).toBe(
      true,
    );
    resetGcd(p);
    p.resource = p.maxResource;

    const impactHp = mob.hp;
    sim.castAbility('summon_infernal', undefined, { x: mob.pos.x, z: mob.pos.z });
    const summonEvents = collect(sim, 3);
    expect(
      summonEvents.filter(
        (event) =>
          event.type === 'spellfxAt' &&
          event.sourceId === p.id &&
          (event.fx === 'nova' || event.fx === 'meteorFall'),
      ),
    ).toEqual([
      expect.objectContaining({
        type: 'spellfxAt',
        fx: 'meteorFall',
        sourceId: p.id,
        radius: 6,
      }),
    ]);
    const owned = [...sim.entities.values()].filter((entity) => entity.ownerId === p.id);
    expect(owned.some((entity) => entity.templateId === 'emberkin')).toBe(true);
    expect(owned.some((entity) => entity.templateId === 'pyre_colossus')).toBe(true);
    expect(sim.petOf(p.id)?.templateId).toBe('emberkin');
    expect(serializePet(sim.ctx, p.id)?.templateId).toBe('emberkin');
    expect(mob.hp).toBeLessThan(impactHp);

    collect(sim, 30);
    const remaining = [...sim.entities.values()].filter((entity) => entity.ownerId === p.id);
    expect(remaining.some((entity) => entity.templateId === 'pyre_colossus')).toBe(false);
    expect(remaining.some((entity) => entity.templateId === 'emberkin')).toBe(true);
  });

  it('pulses nearby enemies every 2 sec and generates 1 Ruin every 1 sec', () => {
    const { sim, p } = destructionAt();
    const primary = addDummy(sim, 9716);
    const nearby = addDummy(sim, 9717, 4);
    const boundary = addDummy(sim, 9718, 7.99);
    const outside = addDummy(sim, 9719, 8.01);
    const friendly = addDummy(sim, 9720, 2);
    friendly.hostile = false;
    sim.targetEntity(primary.id);
    p.facing = 0;
    sim.castAbility('summon_infernal', undefined, { x: primary.pos.x, z: primary.pos.z });
    collect(sim, 3);
    const guardian = [...sim.entities.values()].find(
      (entity) => entity.ownerId === p.id && entity.templateId === 'pyre_colossus',
    );
    if (!guardian) throw new Error('no Pyre guardian');
    giveRuin(p, 0);
    sim.drainEvents();

    const events = collect(sim, 4.1);
    const pulses = events.filter(
      (event) => event.type === 'damage' && event.ability === 'Pyre Aura',
    );

    expect(
      pulses.filter((event) => event.type === 'damage' && event.targetId === primary.id),
    ).toHaveLength(2);
    expect(
      pulses.filter((event) => event.type === 'damage' && event.targetId === nearby.id),
    ).toHaveLength(2);
    expect(
      pulses.filter((event) => event.type === 'damage' && event.targetId === boundary.id),
    ).toHaveLength(2);
    expect(
      pulses.filter((event) => event.type === 'damage' && event.targetId === outside.id),
    ).toHaveLength(0);
    expect(
      pulses.filter((event) => event.type === 'damage' && event.targetId === friendly.id),
    ).toHaveLength(0);
    expect(pulses.every((event) => event.type === 'damage' && event.amount === 60)).toBe(true);
    expect(ruinAmount(p)).toBe(4);
  });

  it('caps generated Ruin at five and no longer fires Worldfire from spenders', () => {
    const { sim, p } = destructionAt();
    const mob = addDummy(sim, 9721, 0);
    sim.targetEntity(mob.id);
    p.facing = 0;
    summonPyreColossus(sim.ctx, p);
    const guardian = [...sim.entities.values()].find(
      (entity) => entity.ownerId === p.id && entity.templateId === 'pyre_colossus',
    );
    expect(guardian?.auras.find((aura) => aura.kind === 'pyre_guardian')).toMatchObject({
      duration: 30,
      remaining: 30,
    });
    giveRuin(p, 4);

    const generation = collect(sim, 3.1);
    expect(ruinAmount(p)).toBe(5);
    expect(
      generation.some((event) => event.type === 'damage' && event.ability === 'Worldfire'),
    ).toBe(false);

    resetGcd(p);
    p.resource = p.maxResource;
    sim.castAbility('chaos_bolt');
    const spender = collect(sim, 3);
    expect(spender.some((event) => event.type === 'damage' && event.ability === 'Worldfire')).toBe(
      false,
    );
  });

  it('despawns immediately on owner death', () => {
    const { sim, p } = destructionAt();
    const mob = addDummy(sim, 9722);
    sim.targetEntity(mob.id);
    summonPyreColossus(sim.ctx, p);
    const guardian = [...sim.entities.values()].find(
      (entity) => entity.ownerId === p.id && entity.templateId === 'pyre_colossus',
    );

    if (!guardian) throw new Error('no Pyre guardian');
    const observerId = sim.addPlayer('mage', 'Observer');
    const observer = sim.entities.get(observerId);
    if (!observer) throw new Error('no observer');
    observer.targetId = guardian.id;
    p.dead = true;
    sim.tick();
    expect(sim.entities.has(guardian.id)).toBe(false);
    expect(observer.targetId).toBeNull();
  });

  it('scrubs guardian targets when its owner entity is removed', () => {
    const { sim, p } = destructionAt();
    summonPyreColossus(sim.ctx, p);
    const guardian = [...sim.entities.values()].find(
      (entity) => entity.ownerId === p.id && entity.templateId === 'pyre_colossus',
    );
    if (!guardian) throw new Error('no Pyre guardian');
    const observerId = sim.addPlayer('mage', 'Observer');
    const observer = sim.entities.get(observerId);
    if (!observer) throw new Error('no observer');
    observer.targetId = guardian.id;

    sim.entities.delete(p.id);
    sim.players.delete(p.id);
    sim.tick();

    expect(sim.entities.has(guardian.id)).toBe(false);
    expect(observer.targetId).toBeNull();
  });
});
