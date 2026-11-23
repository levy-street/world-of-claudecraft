import { describe, expect, it, vi } from 'vitest';
import {
  recordGloomtitheGeneration,
  resetSpiritBombProgress,
  SPIRIT_BOMB_ID,
  SPIRIT_BOMB_PROGRESS_ID,
  SPIRIT_BOMB_REQUIRED_GENERATION,
  spiritBombProgress,
} from '../src/sim/combat/priest/spirit_bomb';
import { addGloomtithe } from '../src/sim/combat/priest/vespers';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers, emptyAllocation } from '../src/sim/content/talents';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { aurasSurvivingDeath } from '../src/sim/resurrection';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, SimEvent } from '../src/sim/types';
import { abilityEffectText } from '../src/ui/ability_description';

function fixture(crit = 0) {
  const sim = new Sim({ seed: 2814, playerClass: 'priest', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.setSpec('shadow')).toBe(true);
  const ctx = (sim as unknown as { ctx: SimContext }).ctx;
  for (const entity of [...sim.entities.values()]) {
    if (entity.id !== sim.playerId) ctx.dropEntity(entity.id);
  }
  sim.tick();
  const priest = sim.player;
  priest.hitBonus = 1;
  ctx.spellCrit = () => crit;
  ctx.lineOfSightBlocked = () => false;
  const target = createMob(9900, MOBS.training_dummy, 20, {
    ...priest.pos,
    z: priest.pos.z + 24,
  });
  target.hostile = true;
  target.moveSpeed = 0;
  target.maxHp = target.hp = 100000;
  ctx.addEntity(target);
  sim.targetEntity(target.id);
  return { sim, ctx, priest, target };
}

type Fixture = ReturnType<typeof fixture>;

function advance(f: Fixture, ticks: number): SimEvent[] {
  return Array.from({ length: ticks }, () => f.sim.tick()).flat();
}

function cast(f: Fixture, id: string, ticks = 65): SimEvent[] {
  f.priest.gcdRemaining = 0;
  f.priest.resource = f.priest.maxResource;
  f.sim.castAbility(id);
  return [...f.sim.drainEvents(), ...advance(f, ticks)];
}

function ready(f: Fixture, amount = SPIRIT_BOMB_REQUIRED_GENERATION): void {
  recordGloomtitheGeneration(f.ctx, f.priest, amount);
  f.sim.tick(); // Settle stat recalculation caused by the new engine aura.
}

function ownDirge(f: Fixture): void {
  f.target.auras.push({
    id: 'shadow_word_pain',
    name: 'Dirge of Decay',
    kind: 'dot',
    remaining: 60,
    duration: 60,
    tickInterval: 60,
    tickTimer: 60,
    value: 1,
    sourceId: f.priest.id,
    school: 'shadow',
  });
}

function extraTarget(f: Fixture, id: number, dx: number, dz: number, hostile = true): Entity {
  const entity = createMob(id, MOBS.training_dummy, 20, {
    x: f.target.pos.x + dx,
    y: f.target.pos.y,
    z: f.target.pos.z + dz,
  });
  entity.hostile = hostile;
  entity.moveSpeed = 0;
  entity.maxHp = entity.hp = 100000;
  f.ctx.addEntity(entity);
  return entity;
}

function bombHits(events: SimEvent[]) {
  return events.filter(
    (event): event is Extract<SimEvent, { type: 'damage' }> =>
      event.type === 'damage' && event.ability === ABILITIES[SPIRIT_BOMB_ID].name,
  );
}

describe('Tithe Bomb content and Gloomtithe generation', () => {
  it('is a Shadow-only level 20, free three-second targeted AoE with a twenty-generation gate', () => {
    expect(SPIRIT_BOMB_REQUIRED_GENERATION).toBe(20);
    for (const spec of ['shadow', 'holy', 'discipline', null]) {
      const mods = computeTalentModifiers('priest', { ...emptyAllocation(), spec }, 20);
      expect(
        abilitiesKnownAt('priest', 19, mods).some((known) => known.def.id === SPIRIT_BOMB_ID),
      ).toBe(false);
      expect(
        abilitiesKnownAt('priest', 20, mods).some((known) => known.def.id === SPIRIT_BOMB_ID),
      ).toBe(spec === 'shadow');
    }
    expect(ABILITIES[SPIRIT_BOMB_ID]).toMatchObject({
      name: 'Tithe Bomb',
      school: 'shadow',
      range: 30,
      castTime: 3,
      cost: 0,
      cooldown: 0,
      projectile: false,
      requiresAuraKind: 'spirit_bomb_charge',
      requiresAuraStacks: 20,
    });
    expect(ABILITIES[SPIRIT_BOMB_ID].effects).toEqual([
      expect.objectContaining({
        type: 'aoeDamage',
        min: 270,
        max: 270,
        radius: 8,
        canCrit: true,
        softCap: 5,
      }),
    ]);
  });

  it.each([0, 1, 2, 5])(
    'does not double-credit generation when accepted VT spends from %s banked',
    (bank) => {
      const f = fixture();
      addGloomtithe(f.ctx, f.priest, bank);
      cast(f, 'vampiric_touch', 32);
      expect(f.target.auras.some((aura) => aura.id === 'vampiric_touch')).toBe(true);
      expect(spiritBombProgress(f.priest)).toBe(bank);
      expect(f.priest.auras.find((aura) => aura.kind === 'gloomtithe')?.stacks ?? 0).toBe(
        bank >= 2 ? bank - 2 : bank,
      );
      advance(f, 70); // The DoT damage and healing do not generate Gloomtithe.
      expect(spiritBombProgress(f.priest)).toBe(bank);
    },
  );

  it.each([1, 2, 3, 4, 5])(
    'does not double-credit generation when summoning a %s-stack Tithefiend',
    (bank) => {
      const f = fixture();
      ownDirge(f);
      addGloomtithe(f.ctx, f.priest, bank);
      cast(f, 'summon_tithefiend', 1);
      expect(
        [...f.sim.entities.values()].some(
          (entity) => entity.ownerId === f.priest.id && entity.guardianState?.key === 'tithefiend',
        ),
      ).toBe(true);
      expect(spiritBombProgress(f.priest)).toBe(bank);
      expect(f.priest.auras.some((aura) => aura.kind === 'gloomtithe')).toBe(false);
    },
  );

  it('observes Vampiric Touch healing without generating extra Gloomtithe', () => {
    const f = fixture();
    addGloomtithe(f.ctx, f.priest, 5);
    f.priest.hp = Math.floor(f.priest.maxHp / 2);
    cast(f, 'vampiric_touch', 32);
    expect(spiritBombProgress(f.priest)).toBe(5);
    const events = advance(f, 65);
    const heals = events.filter(
      (event) =>
        event.type === 'heal2' &&
        event.ability === 'Vampiric Touch' &&
        event.targetId === f.priest.id &&
        event.amount > 0,
    );
    expect(heals.length).toBeGreaterThan(0);
    expect(
      events.some(
        (event) =>
          event.type === 'damage' && event.ability === 'Vampiric Touch' && event.amount > 0,
      ),
    ).toBe(true);
    expect(spiritBombProgress(f.priest)).toBe(5);
  });

  it('observes Tithefiend strikes without generating extra Gloomtithe', () => {
    const f = fixture();
    ownDirge(f);
    addGloomtithe(f.ctx, f.priest, 3);
    cast(f, 'summon_tithefiend', 1);
    expect(spiritBombProgress(f.priest)).toBe(3);
    const events = advance(f, 65);
    const strikes = events.filter(
      (event) =>
        event.type === 'damage' && event.ability === 'Tithefiend Strike' && event.amount > 0,
    );
    expect(strikes.length).toBeGreaterThan(0);
    expect(spiritBombProgress(f.priest)).toBe(3);
  });

  it.each(['cancel', 'resist', 'range', 'rejected aura'] as const)(
    'does not change generation credit when a VT cast fails through %s',
    (reason) => {
      const f = fixture();
      addGloomtithe(f.ctx, f.priest, 5);
      if (reason === 'resist') f.priest.hitBonus = -10;
      if (reason === 'range') f.target.pos.z = f.priest.pos.z + 31;
      const apply = f.ctx.applyAura;
      const observer =
        reason === 'rejected aura'
          ? vi.spyOn(f.ctx, 'applyAura').mockImplementation((target, aura) => {
              if (aura.id !== 'vampiric_touch') apply(target, aura);
            })
          : null;
      f.sim.castAbility('vampiric_touch');
      if (reason === 'cancel') f.ctx.cancelCast(f.priest);
      advance(f, 35);
      observer?.mockRestore();
      expect(spiritBombProgress(f.priest)).toBe(5);
      expect(f.priest.auras.find((aura) => aura.kind === 'gloomtithe')?.stacks).toBe(5);
    },
  );

  it('keeps generation credit through expiry and a rejected fiend summon', () => {
    const f = fixture();
    addGloomtithe(f.ctx, f.priest, 5);
    expect(spiritBombProgress(f.priest)).toBe(5);
    cast(f, 'summon_tithefiend', 1);
    expect(spiritBombProgress(f.priest)).toBe(5);
    expect(f.priest.auras.find((aura) => aura.kind === 'gloomtithe')?.stacks).toBe(5);
    advance(f, 320);
    expect(f.priest.auras.some((aura) => aura.kind === 'gloomtithe')).toBe(false);
    expect(spiritBombProgress(f.priest)).toBe(5);
  });

  it('charges from real Dirge and Mindfracture even at five Gloomtithe without a pet', () => {
    const f = fixture();
    cast(f, 'shadow_word_pain', 1);
    expect(spiritBombProgress(f.priest)).toBe(0);
    cast(f, 'mind_blast', 50); // Include the projectile flight to the dummy 24 yards away.
    expect(spiritBombProgress(f.priest)).toBe(1);
    expect(f.priest.auras.find((aura) => aura.kind === 'gloomtithe')?.stacks).toBe(1);
    advance(f, 60);
    expect(spiritBombProgress(f.priest)).toBe(2);
    addGloomtithe(f.ctx, f.priest, 3);
    expect(spiritBombProgress(f.priest)).toBe(5);
    expect(f.priest.auras.find((aura) => aura.kind === 'gloomtithe')?.stacks).toBe(5);
    advance(f, 60);
    expect(spiritBombProgress(f.priest)).toBe(6);
    expect(f.priest.auras.find((aura) => aura.kind === 'gloomtithe')?.stacks).toBe(5);
    expect([...f.sim.entities.values()].some((entity) => entity.ownerId === f.priest.id)).toBe(
      false,
    );
  });

  it('caps at twenty through generation without spending or accumulating a second bomb', () => {
    const f = fixture();
    addGloomtithe(f.ctx, f.priest, 19);
    expect(spiritBombProgress(f.priest)).toBe(19);
    expect(f.priest.auras.find((aura) => aura.kind === 'gloomtithe')?.stacks).toBe(5);
    addGloomtithe(f.ctx, f.priest);
    expect(spiritBombProgress(f.priest)).toBe(20);
    addGloomtithe(f.ctx, f.priest, 5);
    expect(spiritBombProgress(f.priest)).toBe(20);
    const aura = f.priest.auras.find((entry) => entry.id === SPIRIT_BOMB_PROGRESS_ID);
    expect(aura).toMatchObject({ kind: 'spirit_bomb_charge', stacks: 20, undispellable: true });
    expect(Number.isFinite(aura?.duration)).toBe(true);
    expect(Number.isFinite(aura?.remaining)).toBe(true);
    expect(bombHits(cast(f, SPIRIT_BOMB_ID))).toHaveLength(1);
    expect(spiritBombProgress(f.priest)).toBe(0);
    expect(f.priest.auras.find((entry) => entry.kind === 'gloomtithe')?.stacks).toBe(5);
    expect(bombHits(cast(f, SPIRIT_BOMB_ID))).toHaveLength(0);
  });

  it('keeps generation isolated to the priest who generated the charges', () => {
    const f = fixture();
    const id = f.sim.addPlayer('priest', 'Other Shadow');
    f.sim.setPlayerLevel(20, id);
    expect(f.sim.setSpec('shadow', id)).toBe(true);
    const other = f.sim.entities.get(id);
    if (!other) throw new Error('Other priest missing');
    other.pos = { ...f.priest.pos };
    recordGloomtitheGeneration(f.ctx, other, 9);
    addGloomtithe(f.ctx, f.priest, 5);
    cast(f, 'vampiric_touch', 32);
    expect(spiritBombProgress(f.priest)).toBe(5);
    expect(spiritBombProgress(other)).toBe(9);
  });
});

describe('Tithe Bomb casting and impact', () => {
  it.each([0, 19])('rejects an incomplete %s/20 meter without a cast, GCD, or cost', (progress) => {
    const f = fixture();
    if (progress) ready(f, progress);
    const mana = f.priest.resource;
    f.sim.castAbility(SPIRIT_BOMB_ID);
    expect(f.priest.castingAbility).toBeNull();
    expect(f.priest.gcdRemaining).toBe(0);
    expect(f.priest.resource).toBe(mana);
    expect(spiritBombProgress(f.priest)).toBe(progress);
    expect(bombHits(advance(f, 65))).toHaveLength(0);
  });

  it('holds its bank during the cast and releases one impact at completion', () => {
    const f = fixture();
    ready(f);
    f.priest.resource = 0;
    f.sim.castAbility(SPIRIT_BOMB_ID);
    expect(f.priest.castingAbility).toBe(SPIRIT_BOMB_ID);
    expect(bombHits(advance(f, 59))).toHaveLength(0);
    expect(spiritBombProgress(f.priest)).toBe(20);
    expect(bombHits(advance(f, 1))).toHaveLength(1);
    expect(spiritBombProgress(f.priest)).toBe(0);
    expect(f.priest.cooldowns.has(SPIRIT_BOMB_ID)).toBe(false);
  });

  it.each([
    'cancel',
    'movement',
    'shadow lockout',
    'target death',
    'target range',
    'target LoS',
  ] as const)('preserves the bank when the running cast fails through %s', (reason) => {
    const f = fixture();
    ready(f);
    f.sim.castAbility(SPIRIT_BOMB_ID);
    advance(f, 10);
    if (reason === 'cancel') f.ctx.cancelCast(f.priest);
    if (reason === 'movement') f.sim.moveInput.forward = true;
    if (reason === 'shadow lockout')
      f.ctx.applyAura(f.priest, {
        id: 'test_shadow_lockout',
        name: 'Shadow lockout',
        kind: 'lockout',
        remaining: 5,
        duration: 5,
        value: 0,
        sourceId: f.target.id,
        school: 'shadow',
      });
    if (reason === 'target death') f.target.dead = true;
    if (reason === 'target range') f.target.pos.z = f.priest.pos.z + 40;
    if (reason === 'target LoS') f.ctx.lineOfSightBlocked = () => true;
    expect(bombHits(advance(f, 65))).toHaveLength(0);
    expect(f.priest.castingAbility).toBeNull();
    expect(spiritBombProgress(f.priest)).toBe(20);
  });

  it('consumes the completed cast even when the primary target resists', () => {
    const f = fixture();
    ready(f);
    f.priest.hitBonus = -10;
    const events = cast(f, SPIRIT_BOMB_ID);
    expect(spiritBombProgress(f.priest)).toBe(0);
    expect(
      events.some(
        (event) =>
          event.type === 'damage' && event.ability === 'Tithe Bomb' && event.kind === 'resist',
      ),
    ).toBe(true);
  });

  it('centers damage on the target and excludes friends, dead enemies, range, and blocked LoS', () => {
    const f = fixture();
    const inside = extraTarget(f, 9901, 7.9, 0);
    const outside = extraTarget(f, 9902, 8.1, 0);
    const casterNeighbor = extraTarget(f, 9903, 0, -22);
    const friend = extraTarget(f, 9904, 1, 0, false);
    const dead = extraTarget(f, 9905, 2, 0);
    dead.dead = true;
    dead.respawnTimer = 99999;
    const blocked = extraTarget(f, 9906, 3, 0);
    f.ctx.hasLineOfSight = (_source, target) => target.id !== blocked.id;
    ready(f);
    const hits = bombHits(cast(f, SPIRIT_BOMB_ID));
    expect(hits.map((event) => event.targetId).sort((a, b) => a - b)).toEqual([
      f.target.id,
      inside.id,
    ]);
    for (const entity of [outside, casterNeighbor, friend, dead, blocked]) {
      expect(entity.hp).toBe(100000);
    }
  });

  it('soft-caps the same total damage across ten targets as across five', () => {
    const totals = [5, 10].map((count) => {
      const f = fixture();
      for (let index = 1; index < count; index++) extraTarget(f, 9900 + index, index * 0.2, 0);
      ready(f);
      const hits = bombHits(cast(f, SPIRIT_BOMB_ID));
      expect(hits).toHaveLength(count);
      return hits.reduce((sum, event) => sum + event.amount, 0);
    });
    // Integer rounding can differ by at most one damage per extra target.
    expect(Math.abs(totals[0] - totals[1])).toBeLessThanOrEqual(5);
  });

  it.each([
    [5, 338],
    [6, 282],
  ])('deals the literal per-target damage at the %s-target soft-cap boundary', (count, damage) => {
    const f = fixture();
    for (let index = 1; index < count; index++) extraTarget(f, 9900 + index, index * 0.2, 0);
    ready(f);
    f.priest.spellPower = 0;
    const hits = bombHits(cast(f, SPIRIT_BOMB_ID));
    expect(hits).toHaveLength(count);
    expect(hits.map((hit) => hit.amount)).toEqual(Array(count).fill(damage));
  });

  it.each([0, 100])('matches live tooltip damage at %s Spell Power', (power) => {
    const f = fixture();
    ready(f);
    f.priest.spellPower = power;
    const resolved = f.sim.resolvedAbility(SPIRIT_BOMB_ID);
    if (!resolved) throw new Error('Tithe Bomb resolution missing');
    const text = abilityEffectText(resolved, {
      spellPower: power,
      healPower: 0,
      attackPower: 0,
      rangedPower: 0,
    });
    const hits = bombHits(cast(f, SPIRIT_BOMB_ID));
    expect(hits).toHaveLength(1);
    const displayedAmounts = text.match(/\d+/g)?.map(Number) ?? [];
    expect(displayedAmounts.reduce((sum, amount) => sum + amount, 0)).toBe(hits[0].amount);
    // Shadow's level-20 1.25 multiplier applies to the base and the classic
    // 3 / 3.5 x 0.333 AoE Spell Power rider: round(270 x 1.25) + round(SP x coeff x 1.25).
    expect(hits[0].amount).toBe(power === 0 ? 338 : 374);
  });

  it('rolls one shared spell critical outcome for the explosion', () => {
    const amounts = [0, 1].map((crit) => {
      const f = fixture(crit);
      extraTarget(f, 9901, 2, 0);
      ready(f);
      const hits = bombHits(cast(f, SPIRIT_BOMB_ID));
      expect(hits).toHaveLength(2);
      expect(hits.every((hit) => hit.crit === Boolean(crit))).toBe(true);
      expect(hits[0].amount).toBe(hits[1].amount);
      return hits[0].amount;
    });
    expect(amounts[1]).toBe(Math.round(amounts[0] * 1.5));
  });

  it('uses one critical roll even when a second target roll would disagree', () => {
    const critChance = 0.371;
    const f = fixture(critChance);
    extraTarget(f, 9901, 2, 0);
    ready(f);
    const ordinaryChance = f.sim.rng.chance.bind(f.sim.rng);
    let critRolls = 0;
    const mixedRolls = vi.spyOn(f.sim.rng, 'chance').mockImplementation((probability) => {
      if (probability !== critChance) return ordinaryChance(probability);
      critRolls += 1;
      return critRolls === 1;
    });
    let hits: ReturnType<typeof bombHits>;
    try {
      hits = bombHits(cast(f, SPIRIT_BOMB_ID));
    } finally {
      mixedRolls.mockRestore();
    }
    expect(critRolls).toBe(1);
    expect(hits).toHaveLength(2);
    expect(hits.map((hit) => hit.crit)).toEqual([true, true]);
    expect(hits[0].amount).toBe(hits[1].amount);
  });
});

describe('Tithe Bomb lifetime and replay', () => {
  it('death during charging removes readiness and prevents the explosion', () => {
    const f = fixture();
    ready(f);
    f.sim.castAbility(SPIRIT_BOMB_ID);
    advance(f, 10);
    expect(f.priest.castingAbility).toBe(SPIRIT_BOMB_ID);
    f.ctx.handleDeath(f.priest, f.target, 'Test death');
    expect(spiritBombProgress(f.priest)).toBe(0);
    expect(bombHits(advance(f, 65))).toHaveLength(0);
  });

  it.each([17, 20])(
    'retains %s progress between pulls but clears it on death and resurrection filtering',
    (progress) => {
      const f = fixture();
      ready(f, progress);
      f.priest.inCombat = true;
      f.priest.combatTimer = 4.9;
      advance(f, 10);
      expect(f.priest.inCombat).toBe(false);
      const bank = f.priest.auras.find((aura) => aura.id === SPIRIT_BOMB_PROGRESS_ID);
      if (!bank) throw new Error('Progress aura missing');
      bank.remaining = 0.1;
      advance(f, 400);
      expect(spiritBombProgress(f.priest)).toBe(progress);
      expect(aurasSurvivingDeath([bank])).toEqual([]);
      f.ctx.handleDeath(f.priest, f.target, 'Test death');
      expect(f.priest.dead).toBe(true);
      expect(spiritBombProgress(f.priest)).toBe(0);
      advance(f, 80);
      expect(spiritBombProgress(f.priest)).toBe(0);
    },
  );

  it('clears the bank when leaving Shadow and cannot carry it back into the spec', () => {
    const f = fixture();
    ready(f);
    expect(f.sim.setSpec('holy')).toBe(true);
    expect(spiritBombProgress(f.priest)).toBe(0);
    expect(f.sim.setSpec('shadow')).toBe(true);
    expect(spiritBombProgress(f.priest)).toBe(0);
  });

  it('cannot restore a dead priest bank on a Shadow to Holy to Shadow switch', () => {
    const f = fixture();
    ready(f);
    f.ctx.handleDeath(f.priest, f.target, 'Test death');
    expect(f.priest.dead).toBe(true);
    expect(spiritBombProgress(f.priest)).toBe(0);
    f.priest.inCombat = false;
    f.priest.combatTimer = 5;
    expect(f.sim.setSpec('holy')).toBe(true);
    expect(spiritBombProgress(f.priest)).toBe(0);
    expect(f.sim.setSpec('shadow')).toBe(true);
    expect(spiritBombProgress(f.priest)).toBe(0);
  });

  it('keeps the meter session-only across a saved-character reconnect', () => {
    const f = fixture();
    ready(f);
    const state = f.sim.serializeCharacter(f.priest.id);
    if (!state) throw new Error('Character save missing');
    const reconnected = new Sim({ seed: 2814, playerClass: 'priest', noPlayer: true });
    const pid = reconnected.addPlayer('priest', 'Reconnected Shadow', { state });
    const priest = reconnected.entities.get(pid);
    if (!priest) throw new Error('Reconnected priest missing');
    expect(spiritBombProgress(priest)).toBe(0);
    expect(reconnected.resolvedAbility(SPIRIT_BOMB_ID, pid)).not.toBeNull();
  });

  it('explicit reset removes partial progress and denies an already running bomb', () => {
    const f = fixture();
    ready(f, 19);
    resetSpiritBombProgress(f.ctx, f.priest);
    expect(spiritBombProgress(f.priest)).toBe(0);
    ready(f);
    f.sim.castAbility(SPIRIT_BOMB_ID);
    advance(f, 10);
    resetSpiritBombProgress(f.ctx, f.priest);
    expect(bombHits(advance(f, 65))).toHaveLength(0);
    expect(spiritBombProgress(f.priest)).toBe(0);
  });

  it('replays generation, optional VT spending, and critical AoE deterministically', () => {
    const run = () => {
      const f = fixture(0.4);
      extraTarget(f, 9901, 4, 0);
      addGloomtithe(f.ctx, f.priest, 5);
      const events = cast(f, 'vampiric_touch', 32);
      expect(spiritBombProgress(f.priest)).toBe(5);
      ready(f, 15);
      events.push(...cast(f, SPIRIT_BOMB_ID));
      return {
        events,
        hp: [...f.sim.entities.values()].map((entity) => [entity.id, entity.hp]),
        bank: spiritBombProgress(f.priest),
        rngTail: Array.from({ length: 4 }, () => f.sim.rng.range(0, 1)),
      };
    };
    expect(run()).toEqual(run());
  });
});
