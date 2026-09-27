// The Crucible of the Last Spring raid trinkets (src/sim/combat/trinkets.ts,
// data in src/sim/content/trinkets.ts), each against a real Sim: Forgefather's
// Temper, Kindling Orb, Molten Fletching, Last Flame Lantern and Heart of the
// Crucible.
import { describe, expect, it } from 'vitest';
import { rangedSwing } from '../src/sim/combat/auto_attack';
import { applyHeal } from '../src/sim/combat/heal';
import { onTrinketAvoidance, runTrinketTrigger } from '../src/sim/combat/trinkets';
import { TRINKET_AURA, TRINKET_SPECS, trinketCooldownKey } from '../src/sim/content/trinkets';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type PlayerClass, type SimEvent } from '../src/sim/types';

function wearing(itemId: string, cls: PlayerClass = 'warrior', seed = 11) {
  const sim = new Sim({ seed, playerClass: cls, autoEquip: true });
  sim.setPlayerLevel(20);
  sim.addItem(itemId, 1);
  sim.equipItem(itemId);
  // Skip the 30 sec on-equip lockout: these tests exercise the use itself.
  sim.player.cooldowns.delete(`trinket:${itemId}`);
  expect(sim.equipment.trinket).toBe(itemId);
  sim.drainEvents();
  return sim;
}

/** A hostile wolf `dz` yards in front of the player (on the z axis). */
function foe(sim: Sim, dz = 3, hp = 20000, target = true): Entity {
  const p = sim.player;
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + dz,
  });
  mob.maxHp = hp;
  mob.hp = hp;
  mob.hostile = true;
  mob.aiState = 'idle';
  sim.addEntity(mob);
  if (target) {
    p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
    sim.targetEntity(mob.id, p.id);
  }
  return mob;
}

const aura = (e: Entity, id: string) => e.auras.find((a) => a.id === id);
const damageBy = (events: SimEvent[], ability: string) =>
  events.filter(
    (ev): ev is Extract<SimEvent, { type: 'damage' }> =>
      ev.type === 'damage' && ev.ability === ability,
  );
const healsBy = (events: SimEvent[], ability: string) =>
  events.filter(
    (ev): ev is Extract<SimEvent, { type: 'heal2' }> =>
      ev.type === 'heal2' && ev.ability === ability,
  );

describe("Forgefather's Temper", () => {
  const use = TRINKET_SPECS.forgefathers_temper.use as Extract<
    (typeof TRINKET_SPECS)[string]['use'],
    { kind: 'temper' }
  >;

  it('weapon hits build heat to five, and the use spends it into hotter fire', () => {
    const sim = wearing('forgefathers_temper');
    const mob = foe(sim);
    const p = sim.player;
    for (let i = 0; i < 8; i++) runTrinketTrigger(sim.ctx, p, mob, 'weaponHit');
    expect(aura(p, TRINKET_AURA.heat)?.stacks).toBe(5);
    // No temper yet: a weapon hit adds no fire.
    expect(damageBy(sim.drainEvents(), "Forgefather's Temper")).toHaveLength(0);

    sim.useItem('forgefathers_temper');
    expect(aura(p, TRINKET_AURA.heat)).toBeUndefined();
    const temper = aura(p, TRINKET_AURA.temper);
    expect(temper?.value).toBe(5);
    expect(temper?.remaining).toBe(use.duration);
    sim.drainEvents();
    runTrinketTrigger(sim.ctx, p, mob, 'weaponHit');
    const fire = damageBy(sim.drainEvents(), "Forgefather's Temper");
    expect(fire).toHaveLength(1);
    const power = Math.max(p.attackPower, p.rangedPower);
    expect(fire[0].amount).toBe(Math.round((use.flat + use.coef * power) * (1 + use.perHeat * 5)));
    expect(fire[0].school).toBe('fire');
  });

  it('a kill extends the burn by two seconds, never past twenty from the use', () => {
    const sim = wearing('forgefathers_temper');
    const mob = foe(sim);
    const p = sim.player;
    sim.useItem('forgefathers_temper');
    const temper = aura(p, TRINKET_AURA.temper);
    if (!temper) throw new Error('expected the temper aura');
    // Three seconds of burn go by.
    for (let t = 0; t < 3; t += DT) sim.tick();
    const elapsed = temper.duration - temper.remaining;
    runTrinketTrigger(sim.ctx, p, mob, 'kill');
    expect(temper.duration).toBe(use.duration + use.killExtend);
    expect(temper.remaining).toBeCloseTo(use.duration + use.killExtend - elapsed, 5);
    for (let i = 0; i < 20; i++) runTrinketTrigger(sim.ctx, p, mob, 'kill');
    expect(temper.duration).toBe(use.maxDuration);
    // Elapsed plus what is left never exceeds the cap measured from the use.
    expect(elapsed + temper.remaining).toBeCloseTo(use.maxDuration, 5);
  });
});

describe('Kindling Orb', () => {
  it('while the orb floats, a spell at a hostile looses one bolt; never at a friend', () => {
    const sim = wearing('kindling_orb', 'mage');
    const mob = foe(sim, 8);
    const p = sim.player;
    // No orb: nothing.
    runTrinketTrigger(sim.ctx, p, mob, 'spellCast');
    expect(damageBy(sim.drainEvents(), 'Kindling Orb')).toHaveLength(0);

    sim.useItem('kindling_orb');
    expect(aura(p, TRINKET_AURA.kindlingOrb)?.remaining).toBe(
      TRINKET_SPECS.kindling_orb.use.kind === 'kindlingOrb'
        ? TRINKET_SPECS.kindling_orb.use.duration
        : -1,
    );
    sim.drainEvents();
    runTrinketTrigger(sim.ctx, p, mob, 'spellCast');
    const events = sim.drainEvents();
    const bolts = damageBy(events, 'Kindling Orb');
    expect(bolts).toHaveLength(1);
    expect(bolts[0].targetId).toBe(mob.id);
    expect(bolts[0].school).toBe('fire');
    expect(
      events.some(
        (ev) =>
          ev.type === 'spellfx' &&
          ev.ability === 'trinket_kindling_orb_bolt' &&
          ev.targetId === mob.id,
      ),
    ).toBe(true);
    // A heal on yourself is a spell cast too, but never at a hostile.
    runTrinketTrigger(sim.ctx, p, p, 'spellCast');
    expect(damageBy(sim.drainEvents(), 'Kindling Orb')).toHaveLength(0);
  });
});

describe('Molten Fletching', () => {
  it('a weapon crit ignites the target, refreshed rather than stacked', () => {
    const sim = wearing('molten_fletching', 'hunter');
    const mob = foe(sim, 20);
    const p = sim.player;
    runTrinketTrigger(sim.ctx, p, mob, 'weaponCrit');
    runTrinketTrigger(sim.ctx, p, mob, 'weaponCrit');
    const ignites = mob.auras.filter((a) => a.id === TRINKET_AURA.ignite);
    expect(ignites).toHaveLength(1);
    expect(ignites[0].kind).toBe('dot');
    expect(ignites[0].school).toBe('fire');
    expect(ignites[0].remaining).toBe(6);
    expect(ignites[0].stacks ?? 1).toBe(1);
    const passive = TRINKET_SPECS.molten_fletching.passive;
    if (passive?.kind !== 'ignite') throw new Error('expected the ignite passive');
    expect(ignites[0].value).toBe(
      Math.round(passive.flat + passive.coef * Math.max(p.attackPower, p.rangedPower)),
    );
  });

  it('pierce carries a hit into the nearest other enemy, and never chains on', () => {
    const sim = wearing('molten_fletching', 'hunter');
    const p = sim.player;
    const first = foe(sim, 10);
    // Six yards past the first: inside the 8 yd reach.
    const second = foe(sim, 16, 20000, false);
    // Six yards past the second, twelve from the first: only a chain reaches it.
    const third = foe(sim, 22, 20000, false);
    sim.useItem('molten_fletching');
    sim.drainEvents();
    sim.ctx.dealDamage(p, first, 100, false, 'physical', 'Auto Shot', 'hit');
    const pierced = damageBy(sim.drainEvents(), 'Molten Fletching');
    expect(pierced).toHaveLength(1);
    expect(pierced[0].targetId).toBe(second.id);
    expect(pierced[0].amount).toBe(40);
    expect(third.hp).toBe(third.maxHp);
    // A spell (non-physical) never pierces.
    sim.ctx.dealDamage(p, first, 100, false, 'fire', 'Fireball', 'hit');
    expect(damageBy(sim.drainEvents(), 'Molten Fletching')).toHaveLength(0);
  });

  it("a hunter's Auto Shot pierces when the shot lands", () => {
    const sim = wearing('molten_fletching', 'hunter');
    const first = foe(sim, 20);
    const second = foe(sim, 25, 20000, false);
    sim.useItem('molten_fletching');
    sim.drainEvents();
    const events: SimEvent[] = [];
    // Fire shots until one connects (a shot can miss); each lands in flight.
    for (
      let shot = 0;
      shot < 6 && damageBy(events, 'Auto Shot').every((ev) => ev.amount === 0);
      shot++
    ) {
      rangedSwing(sim.ctx, sim.player, first, { min: 20, max: 30, speed: 2.5 });
      for (let t = 0; t < 2; t += DT) {
        events.push(...sim.tick());
      }
    }
    const shots = damageBy(events, 'Auto Shot').filter((ev) => ev.amount > 0);
    expect(shots.length).toBeGreaterThan(0);
    const pierced = damageBy(events, 'Molten Fletching');
    expect(pierced.length).toBe(shots.length);
    expect(pierced.every((ev) => ev.targetId === second.id)).toBe(true);
  });
});

describe('Last Flame Lantern', () => {
  function lanternParty() {
    const sim = wearing('last_flame_lantern', 'priest');
    const p = sim.player;
    const add = (name: string, dz: number) => {
      const id = sim.addPlayer('warrior', name);
      const e = sim.entities.get(id);
      if (!e) throw new Error('expected a party member');
      sim.partyInvite(id, sim.playerId);
      sim.partyAccept(id);
      e.maxHp = 5000;
      e.hp = 5000;
      e.pos = { x: p.pos.x, y: p.pos.y, z: p.pos.z + dz };
      e.prevPos = { ...e.pos };
      sim.rebucket(e);
      return e;
    };
    const tank = add('Tank', 4);
    const near = add('Near', 8);
    const far = add('Far', 30);
    return { sim, p, tank, near, far };
  }

  it('a cast heal on an ally in the light splashes a quarter onto the most wounded other', () => {
    const { sim, p, tank, near, far } = lanternParty();
    sim.useItem('last_flame_lantern');
    const lantern = aura(p, TRINKET_AURA.lantern);
    expect(lantern?.value2).toBe(p.pos.x);
    expect(lantern?.value3).toBe(p.pos.z);
    // The wearer walks off: the lantern stays where it was set.
    p.pos = { ...p.pos, x: p.pos.x + 40 };
    tank.hp = Math.round(tank.maxHp * 0.5);
    near.hp = Math.round(near.maxHp * 0.6);
    far.hp = Math.round(far.maxHp * 0.1);
    sim.drainEvents();
    const healed = applyHeal(sim.ctx, p, tank, 400, 'Test Heal', null, false);
    const splashes = healsBy(sim.drainEvents(), 'Last Flame Lantern');
    expect(splashes).toHaveLength(1);
    // The far member is the most wounded, but outside the light.
    expect(splashes[0].targetId).toBe(near.id);
    expect(splashes[0].amount).toBe(Math.round(healed * 0.25));
    expect(far.hp).toBe(Math.round(far.maxHp * 0.1));
  });

  it('never splashes a heal landing outside the light, nor a derived heal', () => {
    const { sim, p, tank, near, far } = lanternParty();
    sim.useItem('last_flame_lantern');
    near.hp = Math.round(near.maxHp * 0.5);
    far.hp = Math.round(far.maxHp * 0.5);
    sim.drainEvents();
    // The far member stands 30 yd off: outside the 12 yd light.
    applyHeal(sim.ctx, p, far, 400, 'Test Heal', null, false);
    // A derived heal (a proc, an echo) never splashes either.
    tank.hp = Math.round(tank.maxHp * 0.5);
    applyHeal(sim.ctx, p, tank, 400, 'Proc Heal', null, false, false);
    expect(healsBy(sim.drainEvents(), 'Last Flame Lantern')).toHaveLength(0);
    // Past its duration it is out.
    for (let t = 0; t < 13; t += DT) sim.tick();
    expect(aura(p, TRINKET_AURA.lantern)).toBeUndefined();
    tank.hp = Math.round(tank.maxHp * 0.5);
    near.hp = Math.round(near.maxHp * 0.5);
    applyHeal(sim.ctx, p, tank, 400, 'Test Heal', null, false);
    expect(healsBy(sim.drainEvents(), 'Last Flame Lantern')).toHaveLength(0);
  });
});

describe('Heart of the Crucible', () => {
  it('with no heat the use is refused and costs no cooldown', () => {
    const sim = wearing('heart_of_the_crucible');
    foe(sim);
    sim.useItem('heart_of_the_crucible');
    const events = sim.drainEvents();
    expect(
      events.some((ev) => ev.type === 'error' && ev.text === 'Your heart holds no heat.'),
    ).toBe(true);
    expect(sim.player.cooldowns.get(trinketCooldownKey('heart_of_the_crucible')) ?? 0).toBe(0);
  });

  it("the mob swing's dodges heat it; the nova spends it, burns and taunts in radius", () => {
    const sim = wearing('heart_of_the_crucible');
    const p = sim.player;
    const near = foe(sim, 4);
    const other = foe(sim, 7, 20000, false);
    const distant = foe(sim, 20, 20000, false);
    // Every swing that does not miss is dodged, through the real mob swing shell.
    p.dodgeChance = 1;
    let dodges = 0;
    for (let i = 0; i < 6; i++) {
      sim.ctx.mobSwing(near, p);
      dodges += sim
        .drainEvents()
        .filter(
          (ev) =>
            ev.type === 'damage' &&
            ev.targetId === p.id &&
            (ev.kind === 'dodge' || ev.kind === 'parry' || ev.kind === 'block'),
        ).length;
    }
    expect(dodges).toBeGreaterThan(0);
    expect(aura(p, TRINKET_AURA.guardHeat)?.stacks).toBe(dodges);
    // Capped at ten.
    for (let i = 0; i < 20; i++) onTrinketAvoidance(sim.ctx, p);
    expect(aura(p, TRINKET_AURA.guardHeat)?.stacks).toBe(10);

    sim.useItem('heart_of_the_crucible');
    const events = sim.drainEvents();
    const hits = damageBy(events, 'Heart of the Crucible');
    const struck = new Set(hits.map((ev) => ev.targetId));
    expect(struck.has(near.id)).toBe(true);
    expect(struck.has(other.id)).toBe(true);
    expect(struck.has(distant.id)).toBe(false);
    const use = TRINKET_SPECS.heart_of_the_crucible.use;
    if (use.kind !== 'heartNova') throw new Error('expected the nova');
    expect(hits[0].amount).toBe(Math.round((use.flat + use.coef * p.attackPower) * 10));
    expect(near.forcedTargetId).toBe(p.id);
    expect(other.forcedTargetId).toBe(p.id);
    expect(distant.forcedTargetId ?? null).not.toBe(p.id);
    expect(aura(p, TRINKET_AURA.guardHeat)).toBeUndefined();
    expect(sim.player.cooldowns.get(trinketCooldownKey('heart_of_the_crucible'))).toBe(
      TRINKET_SPECS.heart_of_the_crucible.cooldown,
    );
  });
});

describe('raid trinket determinism', () => {
  it('the same seed plays the same fight twice, trinket effects included', () => {
    const run = () => {
      const sim = wearing('molten_fletching', 'rogue', 33);
      const first = foe(sim, 3);
      const second = foe(sim, 6, 20000, false);
      sim.useItem('molten_fletching');
      sim.player.autoAttack = true;
      const log: string[] = [];
      for (let t = 0; t < 10; t += DT) {
        for (const ev of sim.tick()) {
          if (ev.type === 'damage') log.push(`${ev.targetId}:${ev.ability}:${ev.amount}`);
        }
      }
      return { log, hp: [first.hp, second.hp] };
    };
    const a = run();
    const b = run();
    expect(a.log.some((line) => line.includes('Molten Fletching'))).toBe(true);
    expect(b).toEqual(a);
  });
});
