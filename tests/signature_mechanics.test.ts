import { describe, expect, it } from 'vitest';
import { runEffects } from '../src/sim/combat/effect_dispatch';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { PlayerMeta, ResolvedAbility } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { directHealBonus } from '../src/sim/spell_scaling';
import type { AbilityDef, AbilityEffect, Aura, Entity, PlayerClass } from '../src/sim/types';

type TestSim = Sim & {
  nextId: number;
  players: Map<number, PlayerMeta>;
  addEntity(entity: Entity): void;
};

function harness(sim: Sim): TestSim {
  return sim as unknown as TestSim;
}

function makeSim(cls: PlayerClass, level = 20, seed = 31337): { sim: TestSim; p: Entity } {
  const sim = harness(new Sim({ seed, playerClass: cls, autoEquip: true }));
  sim.setPlayerLevel(level);
  const p = sim.player;
  p.resource = p.maxResource;
  return { sim, p };
}

function metaOf(sim: TestSim, p: Entity): PlayerMeta {
  const meta = sim.players.get(p.id);
  if (!meta) throw new Error(`missing player meta for ${p.id}`);
  return meta;
}

function entityOf(sim: TestSim, id: number): Entity {
  const entity = sim.entities.get(id);
  if (!entity) throw new Error(`missing entity ${id}`);
  return entity;
}

function spawnTarget(sim: TestSim, p: Entity, dz = 4): Entity {
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 1, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + dz,
  });
  mob.maxHp = 50000;
  mob.hp = 50000;
  mob.hostile = true;
  mob.aiState = 'idle';
  sim.addEntity(mob);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  sim.targetEntity(mob.id, p.id);
  return mob;
}

function aura(kind: Aura['kind'], sourceId = 0, id: string = kind): Aura {
  return {
    id,
    name: id,
    kind,
    remaining: 10,
    duration: 10,
    value: 0,
    sourceId,
    school: 'arcane',
  };
}

function resolved(
  id: string,
  cls: PlayerClass,
  school: AbilityDef['school'],
  effects: AbilityEffect[],
  opts: Partial<AbilityDef> = {},
): ResolvedAbility {
  const def: AbilityDef = {
    id,
    name: id,
    class: cls,
    learnLevel: 1,
    cost: 0,
    castTime: opts.castTime ?? 0,
    cooldown: 0,
    range: 30,
    school,
    requiresTarget: opts.requiresTarget ?? true,
    targetType: opts.targetType,
    effects,
    description: '',
  };
  return {
    def,
    rank: 1,
    cost: 0,
    castTime: def.castTime,
    cooldown: 0,
    effects,
    threatFlat: 0,
    threatMult: 1,
  };
}

function tickUntil(sim: TestSim, predicate: () => boolean, max = 200): void {
  for (let i = 0; i < max && !predicate(); i++) sim.tick();
}

describe('PR3 signature mechanics', () => {
  it('aoeHeal heals the caster and nearby friendly targets, not hostiles, with spell power', () => {
    const { sim, p } = makeSim('priest');
    const friendId = sim.addPlayer('mage', 'Friend');
    sim.setPlayerLevel(20, friendId);
    const friend = entityOf(sim, friendId);
    friend.pos = { x: p.pos.x + 2, y: p.pos.y, z: p.pos.z };
    friend.prevPos = { ...friend.pos };
    const hostile = spawnTarget(sim, p, 2);
    sim.tick();

    p.maxHp = 1000;
    p.hp = 800;
    friend.maxHp = 1000;
    friend.hp = 800;
    hostile.maxHp = 1000;
    hostile.hp = 800;
    p.stats.int = -62.5;
    p.spellPower = 140;
    sim.drainEvents();

    const res = resolved(
      'test_aoe_heal',
      'priest',
      'holy',
      [{ type: 'aoeHeal', min: 10, max: 10, radius: 8 }],
      { requiresTarget: false, castTime: 1.5 },
    );
    runEffects(sim.ctx, p, metaOf(sim, p), null, res);

    // AoE heals take the same per-target coefficient penalty as aoeDamage.
    const expected = 10 + directHealBonus(p.spellPower, res.castTime, true);
    expect(p.hp).toBe(800 + expected);
    expect(friend.hp).toBe(800 + expected);
    expect(hostile.hp).toBe(800);
    expect(expected).toBeLessThan(10 + directHealBonus(p.spellPower, res.castTime));
  });

  it('leech dots heal their live source by the exact fraction and stop when source is dead', () => {
    const { sim, p } = makeSim('warlock');
    const targetId = sim.addPlayer('mage', 'Target');
    sim.setPlayerLevel(20, targetId);
    const target = entityOf(sim, targetId);
    target.maxHp = 50000;
    target.hp = 50000;
    p.hp = p.maxHp - 100;
    p.inCombat = true;
    p.spellPower = 0;
    const res = resolved('test_leech_dot', 'warlock', 'shadow', [
      { type: 'dot', total: 90, duration: 9, interval: 3, leechPct: 0.5 },
    ]);
    runEffects(sim.ctx, p, metaOf(sim, p), target, res);

    for (let i = 0; i < 60; i++) {
      p.inCombat = true;
      p.combatTimer = 0;
      sim.tick();
    }
    expect(p.hp).toBe(p.maxHp - 85);

    p.dead = true;
    p.hp = 0;
    tickUntil(sim, () => target.auras.length === 0, 240);
    expect(p.hp).toBe(0);
  });

  it('consumeAura consumes a matching caster-owned dot and errors without consuming when absent', () => {
    const { sim, p } = makeSim('warlock');
    const target = spawnTarget(sim, p);
    target.auras.push({ ...aura('dot', 999, 'immolate'), value: 10 });
    const res = resolved('test_consume_dot', 'warlock', 'fire', [
      { type: 'consumeAura', auraIds: ['immolate'], deal: { min: 40, max: 40 } },
    ]);
    p.stats.int = -62.5;
    p.spellPower = 0;
    sim.drainEvents();

    runEffects(sim.ctx, p, metaOf(sim, p), target, res);
    expect(target.auras.some((a) => a.id === 'immolate')).toBe(true);
    expect(
      sim.drainEvents().some((e) => e.type === 'error' && e.text === 'Nothing to consume.'),
    ).toBe(true);

    target.auras = [{ ...aura('dot', p.id, 'immolate'), value: 10 }];
    const before = target.hp;
    runEffects(sim.ctx, p, metaOf(sim, p), target, res);

    expect(target.auras.some((a) => a.id === 'immolate')).toBe(false);
    expect(target.hp).toBe(before - 40);
  });

  it("consumeAura auraKind 'hot' consumes a HoT and heals the target", () => {
    const { sim, p } = makeSim('druid');
    const friendId = sim.addPlayer('priest', 'Friend');
    sim.setPlayerLevel(20, friendId);
    const friend = entityOf(sim, friendId);
    friend.maxHp = 1000;
    friend.hp = 700;
    friend.auras.push({ ...aura('hot', p.id, 'rejuvenation'), value: 20 });
    p.stats.int = -62.5;
    p.spellPower = 0;
    const res = resolved(
      'test_consume_hot',
      'druid',
      'nature',
      [{ type: 'consumeAura', auraKind: 'hot', heal: { min: 55, max: 55 } }],
      { targetType: 'friendly' },
    );

    runEffects(sim.ctx, p, metaOf(sim, p), friend, res);

    expect(friend.auras.some((a) => a.kind === 'hot')).toBe(false);
    expect(friend.hp).toBe(755);
  });

  it('form_moonkin and form_shadow toggle, exclude other forms, and allow spell casts', () => {
    const { sim, p } = makeSim('mage');
    spawnTarget(sim, p);
    const moonkin = resolved(
      'test_moonkin',
      'mage',
      'arcane',
      [{ type: 'selfBuff', kind: 'form_moonkin', value: 0, duration: 3600 }],
      { requiresTarget: false },
    );
    const shadow = resolved(
      'test_shadow',
      'mage',
      'shadow',
      [{ type: 'selfBuff', kind: 'form_shadow', value: 0, duration: 3600 }],
      { requiresTarget: false },
    );
    const bear = resolved(
      'test_bear',
      'mage',
      'physical',
      [{ type: 'selfBuff', kind: 'form_bear', value: 0, duration: 3600 }],
      { requiresTarget: false },
    );

    runEffects(sim.ctx, p, metaOf(sim, p), null, moonkin);
    expect(p.auras.some((a) => a.kind === 'form_moonkin')).toBe(true);
    runEffects(sim.ctx, p, metaOf(sim, p), null, moonkin);
    expect(p.auras.some((a) => a.kind === 'form_moonkin')).toBe(false);

    runEffects(sim.ctx, p, metaOf(sim, p), null, moonkin);
    runEffects(sim.ctx, p, metaOf(sim, p), null, shadow);
    expect(p.auras.some((a) => a.kind === 'form_moonkin')).toBe(false);
    expect(p.auras.some((a) => a.kind === 'form_shadow')).toBe(true);

    runEffects(sim.ctx, p, metaOf(sim, p), null, bear);
    expect(p.auras.some((a) => a.kind === 'form_shadow')).toBe(false);
    expect(p.auras.some((a) => a.kind === 'form_bear')).toBe(true);
    p.resource = p.maxResource;
    sim.castAbility('fireball');
    expect(p.castingAbility).toBeNull();
    expect(sim.drainEvents().some((e) => e.type === 'error' && /shapeshifted/.test(e.text))).toBe(
      true,
    );

    p.auras = p.auras.filter((a) => a.kind !== 'form_bear');
    runEffects(sim.ctx, p, metaOf(sim, p), null, moonkin);
    p.gcdRemaining = 0;
    p.resource = p.maxResource;
    sim.drainEvents();
    sim.castAbility('fireball');
    expect(p.castingAbility).toBe('fireball');
  });

  it('cross-shift billing: caster forms bill LIVE mana, resource forms bill the parked pool', () => {
    const { sim, p } = makeSim('druid');
    const meta = metaOf(sim, p);
    // A synthetic moonkin toggle joins the known list so the REAL castAbility
    // path (formShiftKind + spendAbilityCost) routes it, not a direct runEffects.
    const moonkinToggle = {
      ...resolved(
        'test_moonkin_form',
        'druid',
        'nature',
        [{ type: 'selfBuff' as const, kind: 'form_moonkin' as const, value: 0, duration: 3600 }],
        { requiresTarget: false },
      ),
      cost: 25,
    };
    meta.known.push(moonkinToggle);

    // no prior form: entering the caster form bills live mana normally
    p.resource = p.maxResource;
    const manaFull = p.resource;
    sim.castAbility('test_moonkin_form');
    expect(p.auras.some((a) => a.kind === 'form_moonkin')).toBe(true);
    expect(p.resource).toBe(manaFull - 25);

    // moonkin -> bear is a cross-shift, but moonkin never parked the mana pool,
    // so the bill lands on LIVE mana (the parked-pool debit would be discarded
    // by the recalc that parks mana on bear entry: the old free-shift bug).
    p.gcdRemaining = 0;
    const bear = sim.resolvedAbility('bear_form', p.id);
    if (!bear) throw new Error('druid should know bear_form at 20');
    const manaBeforeBear = p.resource;
    sim.castAbility('bear_form');
    expect(p.auras.some((a) => a.kind === 'form_bear')).toBe(true);
    expect(p.auras.some((a) => a.kind === 'form_moonkin')).toBe(false);
    expect(p.savedMana).toBe(manaBeforeBear - bear.cost);

    // bear -> moonkin is a cross-shift FROM a resource form: bills the parked
    // pool, and leaving bear restores the debited mana as the live bar.
    p.gcdRemaining = 0;
    p.cooldowns.delete('bear_form');
    p.cooldowns.delete('test_moonkin_form');
    const savedBefore = p.savedMana;
    sim.castAbility('test_moonkin_form');
    expect(p.auras.some((a) => a.kind === 'form_moonkin')).toBe(true);
    expect(p.auras.some((a) => a.kind === 'form_bear')).toBe(false);
    expect(p.resource).toBe(savedBefore - 25);
  });

  it('holy priest signature Holy Nova heals allies and damages enemies from real content', () => {
    const { sim, p } = makeSim('priest');
    expect(sim.setSpec('holy')).toBe(true);
    const friendId = sim.addPlayer('mage', 'Friend');
    sim.setPlayerLevel(20, friendId);
    const friend = entityOf(sim, friendId);
    friend.pos = { x: p.pos.x + 2, y: p.pos.y, z: p.pos.z };
    friend.prevPos = { ...friend.pos };
    const hostile = spawnTarget(sim, p, 2);
    sim.tick();

    p.hp = p.maxHp - 100;
    friend.hp = friend.maxHp - 100;
    const hostileBefore = hostile.hp;
    p.resource = p.maxResource;

    sim.castAbility('holy_nova');

    expect(p.hp).toBeGreaterThan(p.maxHp - 100);
    expect(friend.hp).toBeGreaterThan(friend.maxHp - 100);
    expect(hostile.hp).toBeLessThan(hostileBefore);
  });

  it('restoration druid signature Swiftmend consumes Rejuvenation from real content', () => {
    const { sim, p } = makeSim('druid');
    expect(sim.setSpec('restoration')).toBe(true);
    const friendId = sim.addPlayer('priest', 'Friend');
    sim.setPlayerLevel(20, friendId);
    const friend = entityOf(sim, friendId);
    friend.maxHp = 1000;
    friend.hp = 700;
    p.resource = p.maxResource;
    sim.targetEntity(friend.id, p.id);

    sim.castAbility('rejuvenation');
    expect(friend.auras.some((a) => a.id === 'rejuvenation' && a.kind === 'hot')).toBe(true);
    for (let i = 0; i < 31; i++) sim.tick();

    const beforeSwiftmend = friend.hp;
    p.resource = p.maxResource;
    sim.castAbility('swiftmend');

    expect(friend.auras.some((a) => a.id === 'rejuvenation')).toBe(false);
    expect(friend.hp).toBeGreaterThan(beforeSwiftmend);
  });

  it('haste multipliers survive talent damage scaling (Blade Flurry under combat mastery)', () => {
    // round(1.2 * meleeDmg 1.1) = 1 would be ZERO haste: multiplier-shaped
    // buff values must be exempt from the global damage scaling that
    // additive buff values (AP, armor, spellpower) take.
    const { sim, p } = makeSim('rogue');
    expect(sim.setSpec('combat')).toBe(true);
    const bf = sim.resolvedAbility('blade_flurry', p.id);
    const bfBuff = bf?.effects.find((e) => e.type === 'selfBuff');
    expect(bfBuff && bfBuff.type === 'selfBuff' ? bfBuff.value : 0).toBeCloseTo(1.2);
  });

  it('Trueshot Aura BUFFS the caster and nearby allies, never debuffing hostiles', () => {
    // Regression: it originally shipped as aoeAttackPower, which is the
    // Demoralizing Shout HOSTILE AP DEBUFF mechanic.
    const { sim, p } = makeSim('hunter');
    expect(sim.setSpec('marksmanship')).toBe(true);
    const friendId = sim.addPlayer('warrior', 'Friend');
    sim.setPlayerLevel(20, friendId);
    const friend = entityOf(sim, friendId);
    friend.pos = { x: p.pos.x + 3, y: p.pos.y, z: p.pos.z };
    friend.prevPos = { ...friend.pos };
    const hostile = spawnTarget(sim, p, 4);
    p.resource = p.maxResource;

    sim.castAbility('trueshot_aura');

    expect(p.auras.some((a) => a.kind === 'buff_ap' && a.id === 'trueshot_aura_ap')).toBe(true);
    expect(friend.auras.some((a) => a.kind === 'buff_ap' && a.id === 'trueshot_aura_ap')).toBe(
      true,
    );
    expect(hostile.auras.length).toBe(0);
  });

  it('Shadowform carries its Spell Power bonus in the form aura, dying with the toggle', () => {
    const { sim, p } = makeSim('priest');
    expect(sim.setSpec('shadow')).toBe(true);
    const spBefore = p.spellPower;

    // The resolved selfBuff value carries the mastery's global multiplier
    // (spell +12% scales buff values like any other), so assert against it.
    const sf = sim.resolvedAbility('shadowform', p.id);
    const rider = sf?.effects.find((e) => e.type === 'selfBuff');
    if (!rider || rider.type !== 'selfBuff') throw new Error('missing shadowform selfBuff');
    expect(rider.value).toBeGreaterThanOrEqual(15);

    p.resource = p.maxResource;
    sim.castAbility('shadowform');
    expect(p.auras.some((a) => a.kind === 'form_shadow')).toBe(true);
    expect(p.spellPower).toBe(spBefore + rider.value);

    p.gcdRemaining = 0;
    sim.castAbility('shadowform');
    expect(p.auras.some((a) => a.kind === 'form_shadow')).toBe(false);
    expect(p.spellPower).toBe(spBefore);
  });

  it('Bloodletting (bloodthirst) heals the caster for 3% of max health AND generates 12 rage', () => {
    const { sim, p } = makeSim('warrior');
    expect(sim.setSpec('fury')).toBe(true);
    spawnTarget(sim, p);
    sim.tick();

    p.hp = Math.round(p.maxHp / 2);
    const before = p.hp;
    // Bloodletting is now Fury's FREE generator (cost 0), not a spender.
    const cost = sim.resolvedAbility('bloodthirst')!.cost;
    expect(cost).toBe(0);
    // Start from an empty bar so the +12 mint is observable (not clamped at max).
    p.resource = 0;
    const rageBefore = p.resource;
    sim.castAbility('bloodthirst');

    // Without Furious Mending the self-heal stays 3% of maximum health.
    expect(p.hp - before).toBe(Math.round(p.maxHp * 0.03));
    // A free cast that mints 12 rage nets +12, leaving rage higher than before.
    expect(p.resource).toBe(rageBefore - cost + 12);
    expect(p.resource).toBe(12);
  });

  it('Maiming Strike (mortal_strike) halves healing the victim receives for 10 sec', () => {
    const { sim, p } = makeSim('warrior');
    expect(sim.setSpec('arms')).toBe(true);
    const mob = spawnTarget(sim, p);
    sim.tick();
    const heal = (
      sim as unknown as {
        applyHeal(source: Entity, target: Entity, amount: number, ability: string): void;
      }
    ).applyHeal.bind(sim);

    mob.hp = 10000;
    heal(p, mob, 1000, 'TestHeal');
    const healedClean = mob.hp - 10000;
    expect(healedClean).toBe(1000); // pins the non-crit baseline for this seed

    p.resource = p.maxResource;
    sim.castAbility('mortal_strike');
    const wound = mob.auras.find((a) => a.kind === 'mortal_wound');
    expect(wound).toBeTruthy();
    expect(wound!.value).toBeCloseTo(0.5);
    expect(wound!.duration).toBe(10);

    mob.hp = 10000;
    heal(p, mob, 1000, 'TestHeal');
    const healedWounded = mob.hp - 10000;
    expect(healedWounded).toBe(500);
  });

  it('Mortal Wound keeps its 0.5 multiplier under Arms talent damage scaling', () => {
    // Sharpened Blades (arms mastery) is meleeDmgPct 0.10: rounding the
    // multiplier-shaped debuff value (round(0.5 * 1.1) = 1) would suppress
    // ALL healing, so mortal_wound must be exempt like buff_haste.
    const { sim, p } = makeSim('warrior');
    expect(sim.setSpec('arms')).toBe(true);
    const ms = sim.resolvedAbility('mortal_strike', p.id);
    const wound = ms?.effects.find((e) => e.type === 'buffTarget');
    expect(wound && wound.type === 'buffTarget' ? wound.value : 0).toBeCloseTo(0.5);
    expect(wound && wound.type === 'buffTarget' ? wound.kind : '').toBe('mortal_wound');
  });
});
