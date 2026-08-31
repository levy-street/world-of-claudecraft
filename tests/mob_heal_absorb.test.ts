// Necrotic mobs (e.g. the Gravecaller Summoner's "Grave Blight") can brand a
// victim on a melee hit with a heal-absorb shield: the next chunk of incoming
// healing is devoured before any of it lands. This is the sibling of Mortal
// Strike — where Mortal Strike scales every heal down for its whole duration,
// Grave Blight eats a FIXED pool of healing once, then fades.
import { describe, expect, it } from 'vitest';
import { updateAuras } from '../src/sim/combat/auras';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { type Aura, DT, type Entity } from '../src/sim/types';

function makeSim(playerClass: 'warrior' | 'mage' = 'warrior') {
  return new Sim({ seed: 7, playerClass, autoEquip: true });
}

// Spawn a Gravecaller Summoner adjacent to the player, engaged and ready to swing.
function spawnSummoner(sim: Sim, target: Entity): Entity {
  const template = MOBS['gravecaller_summoner'];
  const mob = createMob((sim as any).nextId++, template, 12, {
    x: target.pos.x,
    y: target.pos.y,
    z: target.pos.z,
  });
  mob.hostile = true;
  (sim as any).addEntity(mob);
  return mob;
}

function swing(sim: Sim, mob: Entity, target: Entity) {
  // Force the swing to land regardless of world-gen RNG state. mobSwing's first
  // rng.next() is the miss/dodge roll; return a high value for just that call so
  // the hit always connects, then restore the real RNG for damage/crit rolls.
  const rng = (sim as any).rng;
  const realNext = rng.next.bind(rng);
  let firstRoll = true;
  rng.next = () => {
    if (firstRoll) {
      firstRoll = false;
      return 0.999;
    }
    return realNext();
  };
  try {
    (sim as any).mobSwing(mob, target);
  } finally {
    rng.next = realNext;
  }
}

describe('mob heal-absorb ("Grave Blight")', () => {
  it('seeds the heal-absorb mechanic on the Gravecaller Summoner', () => {
    expect(MOBS['gravecaller_summoner'].healAbsorb).toEqual({
      chance: 0.25,
      amount: 120,
      duration: 10,
      name: 'Grave Blight',
      school: 'shadow',
    });
  });

  it('applies a heal_absorb aura on a landed hit when it rolls', () => {
    const sim = makeSim();
    const p = sim.player;
    p.maxHp = 100000;
    p.hp = 100000;
    const mob = spawnSummoner(sim, p);
    MOBS['gravecaller_summoner'].healAbsorb!.chance = 1; // deterministic for the test
    swing(sim, mob, p);
    MOBS['gravecaller_summoner'].healAbsorb!.chance = 0.25;
    const aura = p.auras.find((a) => a.kind === 'heal_absorb');
    expect(aura).toBeTruthy();
    expect(aura!.name).toBe('Grave Blight');
    expect(aura!.value).toBe(120);
    expect(aura!.remaining).toBe(10);
  });

  it('devours healing up to its budget, then leaves the rest, depleting the shield', () => {
    const sim = makeSim();
    const p = sim.player;
    p.auras.push({
      id: 'heal_absorb_test',
      name: 'Grave Blight',
      kind: 'heal_absorb',
      remaining: 10,
      duration: 10,
      value: 120,
      sourceId: 999,
      school: 'shadow',
    });
    // A 50-point heal is fully eaten; the shield drains to 70 and remains.
    expect((sim as any).consumeHealAbsorb(p, 50)).toBe(0);
    expect(p.auras.find((a) => a.kind === 'heal_absorb')!.value).toBe(70);
    // A 200-point heal eats the remaining 70 and 130 survives; the shield drops.
    expect((sim as any).consumeHealAbsorb(p, 200)).toBe(130);
    expect(p.auras.some((a) => a.kind === 'heal_absorb')).toBe(false);
  });

  it('blocks real healing while a shield is active, then heals normally after it lapses', () => {
    const sim = makeSim();
    const p = sim.player;
    p.maxHp = 1000;
    p.hp = 500;
    // A shield larger than any heal (crit included) absorbs the whole heal.
    p.auras.push({
      id: 'heal_absorb_test',
      name: 'Grave Blight',
      kind: 'heal_absorb',
      remaining: 10,
      duration: 10,
      value: 100000,
      sourceId: 999,
      school: 'shadow',
    });
    (sim as any).applyHeal(p, p, 200, 'Test Heal');
    expect(p.hp).toBe(500); // fully absorbed
    // Drop the shield and the same heal now lands (>= base, crit may add more).
    p.auras = p.auras.filter((a) => a.kind !== 'heal_absorb');
    (sim as any).applyHeal(p, p, 200, 'Test Heal');
    expect(p.hp).toBeGreaterThanOrEqual(700);
  });
});

// The shield is documented as the sibling of Mortal Wound: a fixed pool of
// incoming healing it devours before any of it lands. That contract is about
// healing the target RECEIVES, so the periodic heal paths (HoT ticks, a DoT's
// leech self-heal, the Temporal Hourglass pool) have to drain it exactly the
// way applyHeal does, or a Renew ticking through a blight defeats the mechanic.
function shield(value: number, id = 'heal_absorb_test'): Aura {
  return {
    id,
    name: 'Grave Blight',
    kind: 'heal_absorb',
    remaining: 60,
    duration: 60,
    value,
    sourceId: 999,
    school: 'shadow',
  };
}

function primedHot(value: number, id = 'rejuvenation'): Aura {
  return {
    id,
    name: 'Rejuvenation',
    kind: 'hot',
    remaining: 60,
    duration: 60,
    value,
    tickInterval: DT,
    sourceId: -1,
    school: 'nature',
  };
}

function spawnTarget(sim: Sim, maxHp: number): Entity {
  const mob = createMob((sim as any).nextId++, MOBS['forest_wolf'], 5, { x: 40, y: 0, z: 40 });
  mob.maxHp = maxHp;
  mob.hp = maxHp;
  (sim as any).addEntity(mob);
  return mob;
}

describe('heal-absorb vs periodic healing', () => {
  it('drains the pool from HoT ticks and only lands the excess', () => {
    const sim = makeSim();
    const mob = spawnTarget(sim, 1000);
    mob.hp = 500;
    mob.auras.push(shield(120), primedHot(100));

    updateAuras(sim.ctx, mob);
    // The whole tick is devoured: the target stays exactly where it was.
    expect(mob.hp).toBe(500);
    expect(mob.auras.find((a) => a.kind === 'heal_absorb')!.value).toBe(20);
    let heals = (sim.drainEvents() as any[]).filter((e) => e.type === 'heal2');
    expect(heals).toHaveLength(1);
    expect(heals[0]).toMatchObject({
      hot: true,
      abilityId: 'rejuvenation',
      amount: 0,
      absorbed: 100,
    });

    updateAuras(sim.ctx, mob);
    // 20 left in the pool, so 80 of the 100 lands.
    expect(mob.hp).toBe(580);
    heals = (sim.drainEvents() as any[]).filter((e) => e.type === 'heal2');
    expect(heals).toHaveLength(1);
    expect(heals[0]).toMatchObject({
      hot: true,
      abilityId: 'rejuvenation',
      amount: 80,
      absorbed: 20,
    });
  });

  it('drops the pool once HoT ticks empty it, the same way applyHeal does', () => {
    const sim = makeSim();
    const mob = spawnTarget(sim, 1000);
    mob.hp = 500;
    mob.auras.push(shield(60), primedHot(100));

    updateAuras(sim.ctx, mob);
    expect(mob.auras.some((a) => a.kind === 'heal_absorb')).toBe(false);
    expect(mob.hp).toBe(540);
  });

  it("drains the attacker's own pool on a DoT leech self-heal", () => {
    const sim = makeSim();
    const p = sim.player;
    p.maxHp = 1000;
    p.hp = 500;
    p.auras.push(shield(30));
    const mob = spawnTarget(sim, 100000);
    mob.auras.push({
      id: 'leech_dot_test',
      name: 'Siphon',
      kind: 'dot',
      remaining: 60,
      duration: 60,
      value: 100,
      leechPct: 0.5,
      tickInterval: DT,
      sourceId: p.id,
      school: 'shadow',
    });

    updateAuras(sim.ctx, mob);
    // 50 leeched, 30 eaten by the attacker's own blight, 20 lands.
    expect(p.hp).toBe(520);
    expect(p.auras.some((a) => a.kind === 'heal_absorb')).toBe(false);
  });

  it('emits absorbed feedback when a DoT leech self-heal is fully eaten', () => {
    const sim = makeSim();
    const p = sim.player;
    p.maxHp = 1000;
    p.hp = 500;
    p.auras.push(shield(80));
    const mob = spawnTarget(sim, 100000);
    mob.auras.push({
      id: 'leech_dot_test',
      name: 'Siphon',
      kind: 'dot',
      remaining: 60,
      duration: 60,
      value: 100,
      leechPct: 0.5,
      tickInterval: DT,
      sourceId: p.id,
      school: 'shadow',
    });

    sim.drainEvents();
    updateAuras(sim.ctx, mob);

    expect(p.hp).toBe(500);
    expect(p.auras.find((a) => a.kind === 'heal_absorb')!.value).toBe(30);
    const heals = (sim.drainEvents() as any[]).filter((e) => e.type === 'heal2');
    expect(heals).toHaveLength(1);
    expect(heals[0]).toMatchObject({
      sourceId: p.id,
      targetId: p.id,
      ability: 'Siphon',
      amount: 0,
      absorbed: 50,
    });
  });

  it('applies both healingTakenMult and heal-absorb to Temporal Hourglass healing', () => {
    const sim = makeSim();
    const mob = spawnTarget(sim, 1000);
    mob.hp = 500;
    mob.auras.push(
      shield(30),
      {
        id: 'mortal_wound_test',
        name: 'Maiming Strike',
        kind: 'mortal_wound',
        remaining: 60,
        duration: 60,
        value: 0.5,
        sourceId: 999,
        school: 'physical',
      },
      {
        id: 'temporal_hourglass',
        name: 'Temporal Hourglass',
        kind: 'stasis',
        remaining: 60,
        duration: 60,
        value: 1,
        tickInterval: DT,
        sourceId: -1,
        school: 'arcane',
        temporalHealRemaining: 200,
        temporalHealTicksRemaining: 2,
      } as Aura,
    );

    sim.drainEvents();
    updateAuras(sim.ctx, mob);
    // 100 planned, halved to 50 by the Mortal Wound, 30 eaten by the blight.
    expect(mob.hp).toBe(520);
    expect(mob.auras.some((a) => a.kind === 'heal_absorb')).toBe(false);
    const heals = (sim.drainEvents() as any[]).filter((e) => e.type === 'heal2');
    expect(heals).toHaveLength(1);
    expect(heals[0]).toMatchObject({ amount: 20, absorbed: 30 });
    // The pool budget still drains by the PLANNED share, not the landed one.
    expect(mob.auras.find((a) => a.kind === 'stasis')!.temporalHealRemaining).toBe(100);
  });

  it('emits absorbed feedback when Temporal Hourglass healing is fully eaten', () => {
    const sim = makeSim();
    const mob = spawnTarget(sim, 1000);
    mob.hp = 500;
    mob.auras.push(shield(100), {
      id: 'temporal_hourglass',
      name: 'Temporal Hourglass',
      kind: 'stasis',
      remaining: 60,
      duration: 60,
      value: 1,
      tickInterval: DT,
      sourceId: -1,
      school: 'arcane',
      temporalHealRemaining: 100,
      temporalHealTicksRemaining: 1,
    } as Aura);

    sim.drainEvents();
    updateAuras(sim.ctx, mob);

    expect(mob.hp).toBe(500);
    expect(mob.auras.some((a) => a.kind === 'heal_absorb')).toBe(false);
    const heals = (sim.drainEvents() as any[]).filter((e) => e.type === 'heal2');
    expect(heals).toHaveLength(1);
    expect(heals[0]).toMatchObject({
      ability: 'Temporal Hourglass',
      amount: 0,
      absorbed: 100,
    });
  });

  it('leaves an unshielded HoT tick exactly as it was', () => {
    const sim = makeSim();
    const mob = spawnTarget(sim, 1000);
    mob.hp = 500;
    mob.auras.push(primedHot(100));

    sim.drainEvents();
    updateAuras(sim.ctx, mob);
    expect(mob.hp).toBe(600);
    const heals = (sim.drainEvents() as any[]).filter((e) => e.type === 'heal2');
    expect(heals).toHaveLength(1);
    expect(heals[0]).toMatchObject({ hot: true, abilityId: 'rejuvenation', amount: 100 });
    expect(heals[0].absorbed).toBeUndefined();
    expect(heals[0].overheal).toBeUndefined();
  });
});
