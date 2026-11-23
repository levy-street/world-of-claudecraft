// The trinkets' mechanics (src/sim/combat/trinkets.ts, data in
// src/sim/content/trinkets.ts): using the worn trinket through useItem, its
// cooldown, and every use and passive against a real Sim.
import { describe, expect, it } from 'vitest';
import { applyHeal } from '../src/sim/combat/heal';
import { quenchDamage } from '../src/sim/combat/sanctum_trinkets';
import { restorableCooldown } from '../src/sim/combat/trinket_seams';
import { runTrinketTrigger, TRINKET_EQUIP_LOCKOUT } from '../src/sim/combat/trinkets';
import {
  SPIRIT_JAGUAR_GUARDIAN_KEY,
  SPIRIT_JAGUAR_REACH,
  seedburstDamage,
  spiritJaguarBite,
  spiritJaguarOf,
} from '../src/sim/combat/wildheart_trinkets';
import {
  GAMBLE,
  TRINKET_AURA,
  TRINKET_ITEMS,
  TRINKET_SPECS,
  trinketCooldownKey,
} from '../src/sim/content/trinkets';
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

function foe(sim: Sim, distance = 3, hp = 20000): Entity {
  const p = sim.player;
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + distance,
  });
  mob.maxHp = hp;
  mob.hp = hp;
  mob.hostile = true;
  mob.aiState = 'idle';
  sim.addEntity(mob);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  sim.targetEntity(mob.id, p.id);
  return mob;
}

const aura = (e: Entity, id: string) => e.auras.find((a) => a.id === id);
const damageBy = (events: SimEvent[], ability: string) =>
  events.filter((ev) => ev.type === 'damage' && ev.ability === ability);

describe('the trinket catalog', () => {
  it('ships twenty-nine trinkets, each with one attribute and a use', () => {
    const ids = Object.keys(TRINKET_ITEMS);
    // The eighteen of the trinket slot plus Balgath's five (content/trinkets.ts).
    // + the five-dungeon rework (PR 4352) on the v0.45.0 integration: 29.
    expect(ids).toHaveLength(29);
    for (const id of ids) {
      const item = TRINKET_ITEMS[id];
      expect(item.slot).toBe('trinket');
      expect(Object.keys(item.stats ?? {})).toHaveLength(1);
      expect(TRINKET_SPECS[id]?.cooldown).toBeGreaterThan(0);
      expect(TRINKET_SPECS[id]?.use).toBeDefined();
    }
  });

  it('keeps a trinket cooldown through a relog', () => {
    expect(restorableCooldown(trinketCooldownKey('stormjar'))).toBe(true);
    expect(restorableCooldown('not_an_ability')).toBe(false);
  });
});

describe('using a worn trinket', () => {
  it('uses it where it sits, starts its cooldown, and refuses while cooling down', () => {
    const sim = wearing('wayfarers_lodestone');
    sim.useItem('wayfarers_lodestone');
    expect(aura(sim.player, TRINKET_AURA.sprint)?.kind).toBe('buff_speed');
    const key = trinketCooldownKey('wayfarers_lodestone');
    expect(sim.player.cooldowns.get(key)).toBe(TRINKET_SPECS.wayfarers_lodestone.cooldown);
    // Still worn, never consumed.
    expect(sim.equipment.trinket).toBe('wayfarers_lodestone');
    sim.player.auras = sim.player.auras.filter((a) => a.id !== TRINKET_AURA.sprint);
    sim.useItem('wayfarers_lodestone');
    expect(aura(sim.player, TRINKET_AURA.sprint)).toBeUndefined();
  });

  it('never fires a trinket that sits in the bags', () => {
    // Another trinket is worn; the Lodestone sits in the bags.
    const sim = wearing('gamblers_die');
    sim.addItem('wayfarers_lodestone', 1);
    expect(sim.equipment.trinket).toBe('gamblers_die');
    // Using gear from the bags puts it on, as ever: the swap fires no effect,
    // and the freshly worn trinket starts only its on-equip lockout.
    sim.useItem('wayfarers_lodestone');
    expect(aura(sim.player, TRINKET_AURA.sprint)).toBeUndefined();
    expect(sim.player.cooldowns.get(trinketCooldownKey('wayfarers_lodestone'))).toBe(
      TRINKET_EQUIP_LOCKOUT,
    );
  });
});

describe('the on-equip lockout', () => {
  it('a freshly equipped trinket waits 30 sec before it can be used', () => {
    const sim = new Sim({ seed: 11, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.addItem('wayfarers_lodestone', 1);
    sim.equipItem('wayfarers_lodestone');
    const key = trinketCooldownKey('wayfarers_lodestone');
    expect(sim.player.cooldowns.get(key)).toBe(TRINKET_EQUIP_LOCKOUT);
    sim.useItem('wayfarers_lodestone');
    expect(aura(sim.player, TRINKET_AURA.sprint)).toBeUndefined();
  });

  it("swapping in another trinket inherits the used one's longer wait", () => {
    const sim = wearing('wayfarers_lodestone');
    sim.useItem('wayfarers_lodestone');
    const left = sim.player.cooldowns.get(trinketCooldownKey('wayfarers_lodestone')) ?? 0;
    expect(left).toBe(TRINKET_SPECS.wayfarers_lodestone.cooldown);
    sim.addItem('sundered_prism', 1);
    sim.equipItem('sundered_prism');
    expect(sim.equipment.trinket).toBe('sundered_prism');
    expect(sim.player.cooldowns.get(trinketCooldownKey('sundered_prism'))).toBe(left);
    // Swapping straight back keeps the original wait too: no chained uses.
    sim.equipItem('wayfarers_lodestone');
    expect(sim.player.cooldowns.get(trinketCooldownKey('wayfarers_lodestone'))).toBe(left);
  });
});

describe('the tank trinkets', () => {
  it('Bastion Sigil: a killing hit raises no shield on the corpse and keeps the cooldown', () => {
    const sim = wearing('bastion_sigil');
    const mob = foe(sim);
    const p = sim.player;
    p.hp = Math.round(p.maxHp * 0.1);
    sim.ctx.dealDamage(mob, p, p.maxHp * 2, false, 'physical', 'Bite', 'hit');
    expect(p.dead).toBe(true);
    expect(aura(p, TRINKET_AURA.lastStand)).toBeUndefined();
    expect(aura(p, TRINKET_AURA.lastStandIcd)).toBeUndefined();
  });

  it('Bastion Sigil: a last-stand shield below 35%, once per cooldown; the ward strikes back', () => {
    const sim = wearing('bastion_sigil');
    const mob = foe(sim);
    const p = sim.player;
    p.hp = Math.round(p.maxHp * 0.5);
    sim.ctx.dealDamage(mob, p, Math.round(p.maxHp * 0.2), false, 'physical', 'Bite', 'hit');
    const shield = aura(p, TRINKET_AURA.lastStand);
    expect(shield?.kind).toBe('absorb');
    expect(shield?.value).toBe(Math.round(p.maxHp * 0.15));
    p.auras = p.auras.filter((a) => a.id !== TRINKET_AURA.lastStand);
    sim.ctx.dealDamage(mob, p, 10, false, 'physical', 'Bite', 'hit');
    expect(aura(p, TRINKET_AURA.lastStand)).toBeUndefined();

    p.hp = p.maxHp;
    sim.useItem('bastion_sigil');
    sim.drainEvents();
    const mobHp = mob.hp;
    sim.ctx.dealDamage(mob, p, 100, false, 'physical', 'Bite', 'hit');
    expect(mob.hp).toBe(mobHp - 30);
  });

  it('Mooring Stone: shrugs off control and knockbacks, takes less damage, moves slower', () => {
    const sim = wearing('mooring_stone');
    const mob = foe(sim);
    const p = sim.player;
    const control = (kind: 'stun' | 'root') =>
      sim.ctx.applyAura(p, {
        id: `test_${kind}`,
        name: `Test ${kind}`,
        kind,
        remaining: 5,
        duration: 5,
        value: 0,
        sourceId: mob.id,
        school: 'physical',
      });
    // It cannot be used while already stunned: only the Medallion frees you.
    control('stun');
    sim.useItem('mooring_stone');
    expect(aura(p, TRINKET_AURA.anchor)).toBeUndefined();
    p.auras = p.auras.filter((a) => a.kind !== 'stun');
    // Used, it keeps every new control off, and every shove.
    sim.useItem('mooring_stone');
    expect(aura(p, TRINKET_AURA.anchor)).toBeDefined();
    control('stun');
    control('root');
    expect(p.auras.some((a) => a.kind === 'stun' || a.kind === 'root')).toBe(false);
    expect(sim.ctx.applyKnockback(mob, p, 10)).toBe(0);
    expect(aura(p, TRINKET_AURA.anchorGuard)?.kind).toBe('shield_wall');
  });

  it("Gaoler's Iron Key: roots the target, slows a control-immune one, needs a target in range", () => {
    const sim = wearing('gaolers_iron_key');
    const mob = foe(sim, 10);
    sim.useItem('gaolers_iron_key');
    const root = aura(mob, TRINKET_AURA.shackle);
    expect(root?.kind).toBe('root');
    expect(root?.remaining).toBe(6);
    expect(sim.player.cooldowns.get(trinketCooldownKey('gaolers_iron_key'))).toBe(
      TRINKET_SPECS.gaolers_iron_key.cooldown,
    );

    // A creature immune to control is slowed instead of rooted.
    const sim2 = wearing('gaolers_iron_key');
    const boss = foe(sim2, 10);
    boss.ccImmune = true;
    sim2.useItem('gaolers_iron_key');
    const slow = aura(boss, TRINKET_AURA.shackle);
    expect(slow?.kind).toBe('slow');
    expect(slow?.value).toBe(0.7);

    // Out of range: nothing lands and the cooldown is not spent.
    const sim3 = wearing('gaolers_iron_key');
    const far = foe(sim3, 40);
    sim3.useItem('gaolers_iron_key');
    expect(aura(far, TRINKET_AURA.shackle)).toBeUndefined();
    expect(sim3.player.cooldowns.get(trinketCooldownKey('gaolers_iron_key')) ?? 0).toBe(0);
  });
});

describe('the Gravewyrm Sanctum trinkets', () => {
  const QUENCH = TRINKET_SPECS.quenchwater_flask.use as Extract<
    (typeof TRINKET_SPECS)[string]['use'],
    { kind: 'quench' }
  >;
  const tickFor = (sim: Sim, seconds: number): void => {
    for (let t = 0; t < seconds - 1e-9; t += DT) sim.tick();
  };

  it("Foreman's Last Link: 30 percent of the ally's damage moves to the wearer for 10 sec", () => {
    const sim = wearing('foremans_last_link', 'priest');
    const wolf = foe(sim, 6);
    const allyId = sim.addPlayer('warrior', 'Linked');
    const ally = sim.ctx.entities.get(allyId) as Entity;
    ally.pos = { ...sim.player.pos, x: sim.player.pos.x + 4 };
    const me = sim.player;
    // Deep pools set after every aura lands (an aura re-derives the stats).
    const pools = () => {
      for (const e of [ally, me]) {
        e.maxHp = 50000;
        e.hp = 50000;
      }
    };
    // A hostile target is refused (and costs no cooldown).
    sim.useItem('foremans_last_link');
    expect(me.cooldowns.get(trinketCooldownKey('foremans_last_link')) ?? 0).toBe(0);
    expect(aura(me, TRINKET_AURA.tetherLink)).toBeUndefined();
    sim.targetEntity(ally.id, me.id);
    sim.useItem('foremans_last_link');
    expect(aura(ally, TRINKET_AURA.tether)?.sourceId).toBe(me.id);
    expect(aura(me, TRINKET_AURA.tetherLink)?.remaining).toBe(10);
    expect(me.cooldowns.get(trinketCooldownKey('foremans_last_link'))).toBe(120);
    pools();
    const allyBefore = ally.hp;
    const meBefore = me.hp;
    sim.ctx.dealDamage(
      wolf,
      ally,
      1000,
      false,
      'physical',
      'Bite',
      'hit',
      true,
      undefined,
      true,
      false,
      true,
    );
    expect(allyBefore - ally.hp).toBe(700);
    expect(meBefore - me.hp).toBe(300);
    // Once the chain falls off, the ally takes it all again.
    tickFor(sim, 10.1);
    expect(aura(ally, TRINKET_AURA.tether)).toBeUndefined();
    pools();
    const after = ally.hp;
    sim.ctx.dealDamage(
      wolf,
      ally,
      1000,
      false,
      'physical',
      'Bite',
      'hit',
      true,
      undefined,
      true,
      false,
      true,
    );
    expect(after - ally.hp).toBe(1000);
  });

  it('Phial of the Tithe: each enemy dying within 20 yd for 15 sec restores 5 percent health and mana', () => {
    const sim = wearing('phial_of_the_tithe', 'mage');
    const me = sim.player;
    sim.useItem('phial_of_the_tithe');
    expect(aura(me, TRINKET_AURA.harvest)?.remaining).toBe(15);
    me.hp = Math.round(me.maxHp / 2);
    me.resource = 0;
    const near = foe(sim, 8, 100);
    const far = foe(sim, 30, 100);
    sim.ctx.dealDamage(me, far, 1000, false, 'fire', 'Test', 'hit');
    expect(far.dead).toBe(true);
    expect(me.resource).toBe(0);
    const hp0 = me.hp;
    sim.ctx.dealDamage(me, near, 1000, false, 'fire', 'Test', 'hit');
    expect(near.dead).toBe(true);
    expect(me.hp - hp0).toBe(Math.round(me.maxHp * 0.05));
    expect(me.resource).toBe(Math.round(me.maxResource * 0.05));
    // Spent window: nothing more.
    tickFor(sim, 15.1);
    const late = foe(sim, 5, 100);
    const hp1 = me.hp;
    const mana1 = me.resource;
    sim.ctx.dealDamage(me, late, 1000, false, 'fire', 'Test', 'hit');
    expect(me.hp).toBe(hp1);
    expect(me.resource).toBe(mana1);
  });

  it('Quenchwater Flask: three weapon hits of frost, the third quenches the target', () => {
    const sim = wearing('quenchwater_flask', 'warrior');
    const wolf = foe(sim, 3);
    const me = sim.player;
    sim.useItem('quenchwater_flask');
    expect(aura(me, TRINKET_AURA.quench)?.stacks).toBe(3);
    sim.drainEvents();
    for (let i = 0; i < 4; i++) runTrinketTrigger(sim.ctx, me, wolf, 'weaponHit');
    const hits = damageBy(sim.drainEvents(), 'Quenchwater Flask');
    expect(hits).toHaveLength(3);
    const power = Math.max(me.attackPower, me.rangedPower);
    expect(quenchDamage(QUENCH, power)).toBe(Math.round(40 + 0.2 * power));
    expect(aura(me, TRINKET_AURA.quench)).toBeUndefined();
    const quenched = wolf.auras.find((a) => a.id === TRINKET_AURA.quenched);
    expect(quenched?.kind).toBe('attackspeed');
    expect(quenched?.value).toBeCloseTo(1 / 0.85, 9);
    expect(quenched?.remaining).toBe(8);
  });
});

describe('the Wildheart Basin trinkets', () => {
  const WHISTLE = TRINKET_SPECS.fanglords_whistle.use as Extract<
    (typeof TRINKET_SPECS)[string]['use'],
    { kind: 'spiritPack' }
  >;
  const SEEDPOD = TRINKET_SPECS.gorgebloom_seedpod.use as Extract<
    (typeof TRINKET_SPECS)[string]['use'],
    { kind: 'seedburst' }
  >;
  const tickFor = (sim: Sim, seconds: number): SimEvent[] => {
    const out: SimEvent[] = [];
    for (let t = 0; t < seconds - 1e-9; t += DT) out.push(...sim.tick());
    return out;
  };
  /** A hostile wolf at an offset from the player (not targeted). */
  const wolfAt = (sim: Sim, dx: number, dz: number, hp = 20000): Entity => {
    const p = sim.player;
    const mob = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
      x: p.pos.x + dx,
      y: p.pos.y,
      z: p.pos.z + dz,
    });
    mob.maxHp = hp;
    mob.hp = hp;
    mob.hostile = true;
    mob.aiState = 'idle';
    sim.addEntity(mob);
    return mob;
  };
  const hitsOn = (events: SimEvent[], ability: string, targetId: number) =>
    damageBy(events, ability).filter((ev) => ev.type === 'damage' && ev.targetId === targetId);
  const amountOf = (ev: SimEvent): number => (ev.type === 'damage' ? ev.amount : -1);
  const gap = (a: Entity, b: Entity) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);

  it("Fanglord's Whistle: needs a target, then a spirit jaguar runs to it and bites", () => {
    const sim = wearing('fanglords_whistle', 'rogue');
    // No target: refused, no cooldown spent, no jaguar.
    sim.player.targetId = null;
    expect(sim.useItem('fanglords_whistle')).toBeFalsy();
    expect(sim.player.cooldowns.get(trinketCooldownKey('fanglords_whistle')) ?? 0).toBe(0);
    expect(spiritJaguarOf(sim.ctx, sim.player.id)).toBeNull();

    const prey = foe(sim, 15);
    sim.useItem('fanglords_whistle');
    expect(sim.player.cooldowns.get(trinketCooldownKey('fanglords_whistle'))).toBe(120);
    expect(aura(sim.player, TRINKET_AURA.spiritPack)?.remaining).toBe(12);
    const jaguar = spiritJaguarOf(sim.ctx, sim.player.id);
    if (!jaguar) throw new Error('no jaguar');
    expect(jaguar.templateId).toBe(`guardian_${SPIRIT_JAGUAR_GUARDIAN_KEY}`);
    expect(jaguar.guardianState?.melee).toEqual({ moveSpeed: 8, reach: SPIRIT_JAGUAR_REACH });
    expect(jaguar.guardianState?.preferredTargetId).toBe(prey.id);
    const start = gap(jaguar, prey);
    expect(start).toBeGreaterThan(SPIRIT_JAGUAR_REACH);

    // It runs (it does not stand and fire from range): no bite until it closes.
    const firstTick = sim.tick();
    expect(hitsOn(firstTick, "Fanglord's Whistle", prey.id)).toHaveLength(0);
    expect(gap(jaguar, prey)).toBeLessThan(start);
    const bites = hitsOn(tickFor(sim, 4), "Fanglord's Whistle", prey.id);
    expect(bites.length).toBeGreaterThan(0);
    for (const bite of bites) expect(bite.type === 'damage' && bite.sourceId).toBe(jaguar.id);
    expect(gap(jaguar, prey)).toBeLessThanOrEqual(SPIRIT_JAGUAR_REACH + 0.5);
  });

  it("Fanglord's Whistle: the bite snapshots Attack Power, and the jaguar leaves at 12 sec", () => {
    const biteAt = (power: number) => {
      const sim = wearing('fanglords_whistle', 'rogue');
      foe(sim, 3);
      sim.player.attackPower = power;
      sim.player.rangedPower = 0;
      sim.useItem('fanglords_whistle');
      const state = spiritJaguarOf(sim.ctx, sim.player.id)?.guardianState;
      return { sim, min: state?.minDamage ?? 0, max: state?.maxDamage ?? 0 };
    };
    const low = biteAt(100);
    const high = biteAt(400);
    // 18 to 24 plus 8 percent of Attack Power: +24 per bite for +300 power.
    expect(spiritJaguarBite(WHISTLE, 100)).toEqual({ min: low.min, max: low.max });
    expect([low.min, low.max]).toEqual([26, 32]);
    expect([high.min, high.max]).toEqual([50, 56]);
    // Snapshotted: a later power change does not move the bite.
    high.sim.player.attackPower = 0;
    tickFor(high.sim, 1);
    expect(spiritJaguarOf(high.sim.ctx, high.sim.player.id)?.guardianState?.minDamage).toBe(50);
    // Still out at 11.9 sec, gone at 12 with its buff.
    tickFor(high.sim, 10.85);
    expect(spiritJaguarOf(high.sim.ctx, high.sim.player.id)).not.toBeNull();
    tickFor(high.sim, 0.2);
    expect(spiritJaguarOf(high.sim.ctx, high.sim.player.id)).toBeNull();
    expect(aura(high.sim.player, TRINKET_AURA.spiritPack)).toBeUndefined();
  });

  it("Fanglord's Whistle: the jaguar follows its owner's new target", () => {
    const sim = wearing('fanglords_whistle', 'rogue');
    foe(sim, 3);
    const other = wolfAt(sim, 4, 3);
    sim.useItem('fanglords_whistle');
    sim.targetEntity(other.id, sim.player.id);
    const events = tickFor(sim, 4);
    expect(spiritJaguarOf(sim.ctx, sim.player.id)?.guardianState?.preferredTargetId).toBe(other.id);
    expect(hitsOn(events, "Fanglord's Whistle", other.id).length).toBeGreaterThan(0);
  });

  it('Gorgebloom Seedpod: bursts at 6 sec on every enemy within 8 yd of the target', () => {
    const sim = wearing('gorgebloom_seedpod', 'mage');
    const host = foe(sim, 10);
    const near = wolfAt(sim, 0, 16); // 6 yd from the host
    const far = wolfAt(sim, 0, 20); // 10 yd from the host
    // The wolves hold still (no aggro chase) so the yards stay as placed.
    sim.devMobsFrozen = true;
    sim.useItem('gorgebloom_seedpod');
    expect(sim.player.cooldowns.get(trinketCooldownKey('gorgebloom_seedpod'))).toBe(120);
    const seed = host.auras.find((a) => a.id === TRINKET_AURA.seedburst);
    expect(seed?.sourceId).toBe(sim.player.id);
    expect(seed?.remaining).toBe(6);
    const expected = seedburstDamage(SEEDPOD, sim.player.spellPower, false);
    expect(Math.round(seed?.value ?? 0)).toBe(expected);

    const before = tickFor(sim, 5.9);
    expect(damageBy(before, 'Gorgebloom Seedpod')).toHaveLength(0);
    const burst = damageBy(tickFor(sim, 0.3), 'Gorgebloom Seedpod');
    expect(hitsOn(burst, 'Gorgebloom Seedpod', host.id)).toHaveLength(1);
    expect(hitsOn(burst, 'Gorgebloom Seedpod', near.id)).toHaveLength(1);
    expect(hitsOn(burst, 'Gorgebloom Seedpod', far.id)).toHaveLength(0);
    for (const hit of burst) expect(amountOf(hit)).toBe(expected);
    // It bursts once.
    expect(damageBy(tickFor(sim, 2), 'Gorgebloom Seedpod')).toHaveLength(0);
  });

  it('Gorgebloom Seedpod: 50 percent more where the target died first', () => {
    const sim = wearing('gorgebloom_seedpod', 'mage');
    const host = foe(sim, 10, 50);
    sim.devMobsFrozen = true;
    sim.useItem('gorgebloom_seedpod');
    // The host moves 12 yd off and dies there: the seed follows it to its
    // corpse, so a wolf beside the corpse is hit and one at the plant spot is not.
    const atPlantSpot = wolfAt(sim, 0, 10);
    tickFor(sim, 1);
    host.pos.x += 12;
    const besideCorpse = wolfAt(sim, 15, 10);
    tickFor(sim, 1);
    sim.ctx.dealDamage(sim.player, host, 500, false, 'physical', 'Test Strike', 'hit');
    expect(host.dead).toBe(true);
    // Death cleared the seed's aura; the seed itself lives on.
    expect(host.auras.some((a) => a.id === TRINKET_AURA.seedburst)).toBe(false);
    const burst = damageBy(tickFor(sim, 4.2), 'Gorgebloom Seedpod');
    const plain = seedburstDamage(SEEDPOD, sim.player.spellPower, false);
    const empowered = seedburstDamage(SEEDPOD, sim.player.spellPower, true);
    expect(empowered).toBe(Math.round((SEEDPOD.flat + SEEDPOD.coef * sim.player.spellPower) * 1.5));
    expect(empowered).toBeGreaterThan(plain);
    expect(hitsOn(burst, 'Gorgebloom Seedpod', besideCorpse.id)).toHaveLength(1);
    expect(hitsOn(burst, 'Gorgebloom Seedpod', atPlantSpot.id)).toHaveLength(0);
    for (const hit of burst) expect(amountOf(hit)).toBe(empowered);
  });

  it('Gorgebloom Seedpod: snapshots Spell Power at the plant; a dead planter withers it', () => {
    const plain = wearing('gorgebloom_seedpod', 'mage');
    const host = foe(plain, 5);
    plain.player.spellPower = 100;
    plain.useItem('gorgebloom_seedpod');
    plain.player.spellPower = 0;
    const burst = hitsOn(tickFor(plain, 6.2), 'Gorgebloom Seedpod', host.id);
    expect(burst.map(amountOf)).toEqual([Math.round(SEEDPOD.flat + SEEDPOD.coef * 100)]);

    const withered = wearing('gorgebloom_seedpod', 'mage');
    foe(withered, 5);
    withered.useItem('gorgebloom_seedpod');
    withered.player.hp = 0;
    withered.player.dead = true;
    expect(damageBy(tickFor(withered, 6.2), 'Gorgebloom Seedpod')).toHaveLength(0);
  });
});

describe('the healer trinkets', () => {
  it("Mender's Hourglass: overhealing fills it (capped), and a use shields the most wounded", () => {
    const sim = wearing('menders_hourglass', 'priest');
    const p = sim.player;
    p.hp = p.maxHp;
    applyHeal(sim.ctx, p, p, 5000, 'Test Heal');
    const cap = Math.round(p.maxHp * 0.3);
    expect(aura(p, TRINKET_AURA.hourglass)?.value).toBe(cap);
    sim.useItem('menders_hourglass');
    expect(aura(p, TRINKET_AURA.hourglassShield)?.value).toBe(cap);
    expect(aura(p, TRINKET_AURA.hourglass)).toBeUndefined();
  });

  it("Mender's Hourglass: an empty hourglass costs no cooldown", () => {
    const sim = wearing('menders_hourglass', 'priest');
    sim.useItem('menders_hourglass');
    expect(sim.player.cooldowns.get(trinketCooldownKey('menders_hourglass')) ?? 0).toBe(0);
  });

  it('Wellspring Seed: heals over time everyone standing near', () => {
    const sim = wearing('wellspring_seed', 'priest');
    sim.useItem('wellspring_seed');
    const hot = aura(sim.player, TRINKET_AURA.wellspring);
    expect(hot?.kind).toBe('hot');
    const use = TRINKET_SPECS.wellspring_seed.use as { tick: number; coef: number };
    expect(hot?.value).toBe(Math.round(use.tick + use.coef * sim.player.healPower));
  });
});

describe('the physical trinkets', () => {
  it('Paired Talons: while used, every weapon hit opens a stacking bleed', () => {
    const sim = wearing('paired_talons', 'rogue');
    const mob = foe(sim);
    sim.useItem('paired_talons');
    // Weapon hits ride the weapon-proc hook.
    sim.player.autoAttack = true;
    for (let t = 0; t < 8; t += DT) sim.tick();
    const bleed = mob.auras.find((a) => a.id === TRINKET_AURA.bleed);
    expect(bleed?.kind).toBe('dot');
    expect(bleed?.stacks ?? 0).toBeGreaterThan(0);
  });

  it('Paired Talons: a dead wearer opens no bleed', () => {
    const sim = wearing('paired_talons', 'rogue');
    const mob = foe(sim);
    sim.useItem('paired_talons');
    sim.player.dead = true;
    runTrinketTrigger(sim.ctx, sim.player, mob, 'weaponHit');
    expect(aura(mob, TRINKET_AURA.bleed)).toBeUndefined();
    sim.player.dead = false;
    runTrinketTrigger(sim.ctx, sim.player, mob, 'weaponHit');
    expect(aura(mob, TRINKET_AURA.bleed)?.kind).toBe('dot');
  });

  it('Paired Talons: the extra swing needs the target in melee reach', () => {
    const rolls = (distance: number) => {
      const sim = wearing('paired_talons', 'hunter');
      const mob = foe(sim, distance);
      let swings = 0;
      for (let i = 0; i < 400; i++) {
        runTrinketTrigger(sim.ctx, sim.player, mob, 'weaponHit');
        const icd = sim.player.auras.findIndex((a) => a.id === TRINKET_AURA.twinStrikeIcd);
        if (icd >= 0) {
          swings++;
          sim.player.auras.splice(icd, 1);
        }
      }
      return swings;
    };
    expect(rolls(3)).toBeGreaterThan(0);
    // A hunter's auto-shot at 25 yd lands as a weapon hit too: never a melee swing.
    expect(rolls(25)).toBe(0);
  });

  it("Hunter's Tally: crits and kills mark, a use spends every mark on one strike", () => {
    const sim = wearing('hunters_tally');
    const mob = foe(sim);
    for (let i = 0; i < 4; i++) sim.ctx.applySetProcs(sim.player, mob, 'weaponCrit');
    expect(aura(sim.player, TRINKET_AURA.tally)?.stacks).toBe(4);
    sim.drainEvents();
    sim.useItem('hunters_tally');
    const hits = damageBy(sim.drainEvents(), "Hunter's Tally");
    expect(hits).toHaveLength(1);
    expect(aura(sim.player, TRINKET_AURA.tally)).toBeUndefined();
  });
});

describe('the caster trinkets', () => {
  it('Stormjar: spells charge it, a use chains the charge through the pack', () => {
    const sim = wearing('stormjar', 'mage');
    const first = foe(sim, 6);
    const second = foe(sim, 10);
    sim.targetEntity(first.id);
    for (let i = 0; i < 5; i++) sim.ctx.applySetProcs(sim.player, first, 'spellCast');
    expect(aura(sim.player, TRINKET_AURA.storm)?.stacks).toBe(5);
    sim.drainEvents();
    sim.useItem('stormjar');
    const hits = damageBy(sim.drainEvents(), 'Stormjar');
    const struck = new Set(hits.map((ev) => (ev as { targetId: number }).targetId));
    expect(struck.has(first.id)).toBe(true);
    expect(struck.has(second.id)).toBe(true);
  });

  it('Echoing Lens: the next spell hits echo for a share, three times', () => {
    const sim = wearing('echoing_lens', 'mage');
    const mob = foe(sim, 8);
    sim.useItem('echoing_lens');
    sim.drainEvents();
    sim.ctx.dealDamage(sim.player, mob, 100, false, 'fire', 'Fireball', 'hit');
    const echoes = damageBy(sim.drainEvents(), 'Echoing Lens');
    expect(echoes).toHaveLength(1);
    expect(aura(sim.player, TRINKET_AURA.echo)?.stacks).toBe(2);
  });
});

describe('the rest', () => {
  it("Gambler's Die: always one fortune, announced; snake eyes refunds half the wait", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed < 40 && seen.size < 4; seed++) {
      const sim = wearing('gamblers_die', 'warrior', seed);
      sim.useItem('gamblers_die');
      const roll = sim.drainEvents().find((ev) => ev.type === 'trinketGamble') as
        | { fortune: string }
        | undefined;
      expect(roll).toBeDefined();
      seen.add(roll!.fortune);
      const cd = sim.player.cooldowns.get(trinketCooldownKey('gamblers_die'));
      const full = TRINKET_SPECS.gamblers_die.cooldown;
      expect(cd).toBe(
        roll!.fortune === 'snakeEyes' ? Math.round(full * (1 - GAMBLE.snakeEyesRefund)) : full,
      );
    }
    expect(seen.size).toBe(4);
  }, 60_000);

  it('Sundered Prism: a step forward and a moment of guard', () => {
    const sim = wearing('sundered_prism');
    const before = { ...sim.player.pos };
    sim.useItem('sundered_prism');
    expect(Math.hypot(sim.player.pos.x - before.x, sim.player.pos.z - before.z)).toBeGreaterThan(1);
    expect(aura(sim.player, TRINKET_AURA.riftGuard)?.kind).toBe('shield_wall');
  });

  it('Medallion of Defiance: works while stunned and breaks every control', () => {
    const sim = wearing('medallion_of_defiance');
    const mob = foe(sim);
    for (const kind of ['stun', 'root', 'slow'] as const) {
      sim.ctx.applyAura(sim.player, {
        id: `test_${kind}`,
        name: `Test ${kind}`,
        kind,
        remaining: 5,
        duration: 5,
        value: kind === 'slow' ? 0.5 : 0,
        sourceId: mob.id,
        school: 'physical',
      });
    }
    sim.useItem('medallion_of_defiance');
    expect(sim.player.auras.some((a) => ['stun', 'root', 'slow'].includes(a.kind))).toBe(false);
  });

  it("Duelist's Brand: only an enemy player can be branded", () => {
    const sim = wearing('duelists_brand');
    foe(sim);
    sim.useItem('duelists_brand');
    expect(sim.player.cooldowns.get(trinketCooldownKey('duelists_brand')) ?? 0).toBe(0);
  });
});

describe('determinism', () => {
  it('a character without a trinket plays byte for byte as before', () => {
    const run = (withTrinket: boolean) => {
      const sim = new Sim({ seed: 21, playerClass: 'warrior', autoEquip: true });
      sim.setPlayerLevel(20);
      if (withTrinket) {
        sim.addItem('wayfarers_lodestone', 1);
      }
      const mob = foe(sim);
      sim.player.autoAttack = true;
      for (let t = 0; t < 10; t += DT) sim.tick();
      return mob.hp;
    };
    // A trinket in the bags (not worn) changes nothing.
    expect(run(true)).toBe(run(false));
  });
});
