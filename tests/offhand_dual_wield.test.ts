import { describe, expect, it } from 'vitest';
import { meleeSwing, updatePlayerAutoAttack } from '../src/sim/combat/auto_attack';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';

type TestSim = Sim & {
  nextId: number;
  addEntity(entity: Entity): void;
  emit(event: SimEvent): void;
};
type Ev = {
  type?: string;
  amount?: number;
  kind?: string;
  sourceId?: number;
  targetId?: number;
};

function capture(sim: TestSim): Ev[] {
  const events: Ev[] = [];
  const orig = sim.emit.bind(sim);
  sim.emit = (e: SimEvent) => {
    events.push(e);
    orig(e);
  };
  return events;
}

function requireEntity(sim: Sim, id: number): Entity {
  const entity = sim.entities.get(id);
  if (!entity) {
    throw new Error(`Missing entity ${id}`);
  }
  return entity;
}

function requirePlayerMeta(sim: Sim, id: number) {
  const meta = sim.players.get(id);
  if (!meta) {
    throw new Error(`Missing player meta ${id}`);
  }
  return meta;
}

function spawnDummy(sim: TestSim, p: Entity, level = 1): Entity {
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, level, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + 2,
  });
  mob.maxHp = 500000;
  mob.hp = 500000;
  mob.hostile = true;
  mob.aiState = 'idle';
  sim.addEntity(mob);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  sim.targetEntity(mob.id, p.id);
  return mob;
}

describe('offhand equip routing', () => {
  it('a fresh warrior starts with a basic shield equipped', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true });
    expect(sim.equipment.mainhand).toBe('worn_sword');
    expect(sim.equipment.offhand).toBe('eastbrook_buckler');
    expect(sim.player.mainhandItemId).toBe('worn_sword');
    expect(sim.player.offhandItemId).toBe('eastbrook_buckler');
  });

  it('a fresh rogue starts with a real offhand weapon equipped', () => {
    const sim = new Sim({ seed: 7, playerClass: 'rogue', autoEquip: true });
    expect(sim.equipment.mainhand).toBe('rusty_dagger');
    expect(sim.equipment.offhand).toBe('rusty_dagger');
    expect(sim.player.mainhandItemId).toBe('rusty_dagger');
    expect(sim.player.offhandItemId).toBe('rusty_dagger');
  });

  it('a rogue equips a second one-hand weapon into offhand', () => {
    const sim = new Sim({ seed: 7, playerClass: 'rogue', autoEquip: true });
    sim.addItem('keen_dirk', 1);
    sim.equipItem('keen_dirk');
    expect(sim.equipment.mainhand).toBe('rusty_dagger');
    expect(sim.equipment.offhand).toBe('keen_dirk');
  });

  it('a Fury warrior equips a second one-hand weapon into offhand', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(10);
    expect(sim.setSpec('fury')).toBe(true);
    sim.addItem('redbrook_blade', 1);
    sim.equipItem('redbrook_blade');
    expect(sim.equipment.mainhand).toBe('worn_sword');
    expect(sim.equipment.offhand).toBe('redbrook_blade');
  });

  it('a non-dual-wield warrior replaces mainhand instead of filling offhand', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(10);
    expect(sim.setSpec('prot')).toBe(true);
    sim.addItem('redbrook_blade', 1);
    sim.equipItem('redbrook_blade');
    expect(sim.equipment.mainhand).toBe('redbrook_blade');
    expect(sim.equipment.offhand).toBe('eastbrook_buckler');
  });
});

describe('offhand combat rules', () => {
  it('an offhand weapon swing deals half the resolved mainhand damage with the same weapon', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true }) as TestSim;
    const p = sim.player;
    const targetId = sim.addPlayer('mage', 'Target');
    const target = requireEntity(sim, targetId);
    p.weapon = { min: 20, max: 20, speed: 2 };
    p.attackPower = 0;
    p.critChance = 0;
    target.stats.armor = 0;
    target.dodgeChance = 0;
    const events = capture(sim);
    expect(meleeSwing(sim.ctx, p, target, 0, null, { cannotBeDodged: true })).toBe(true);
    expect(
      meleeSwing(sim.ctx, p, target, 0, null, {
        cannotBeDodged: true,
        weapon: { min: 20, max: 20, speed: 2 },
        weaponMult: 0.5,
        apSwingSpeed: 2,
      }),
    ).toBe(true);
    const hits = events.filter((e) => e.type === 'damage' && e.kind === 'hit').map((e) => e.amount);
    expect(hits).toEqual([20, 10]);
  });

  it('the dual-wield white-hit penalty can turn a hit into a miss', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true }) as TestSim;
    const p = sim.player;
    const targetId = sim.addPlayer('mage', 'Target');
    const target = requireEntity(sim, targetId);
    p.critChance = 0;
    p.attackPower = 0;
    target.stats.armor = 0;
    target.dodgeChance = 0;
    sim.rng.next = () => 0.12;
    const events = capture(sim);
    expect(meleeSwing(sim.ctx, p, target, 0, null, { cannotBeDodged: true })).toBe(true);
    expect(
      meleeSwing(sim.ctx, p, target, 0, null, {
        cannotBeDodged: true,
        whiteDualWieldPenalty: true,
      }),
    ).toBe(false);
    expect(events.filter((e) => e.type === 'damage').map((e) => e.kind)).toEqual(['hit', 'miss']);
  });

  it('dual wielding arms both swing timers and emits both hands over auto-attack', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true }) as TestSim;
    sim.setPlayerLevel(10);
    expect(sim.setSpec('fury')).toBe(true);
    sim.addItem('redbrook_blade', 1);
    sim.equipItem('redbrook_blade');
    const p = sim.player;
    const meta = requirePlayerMeta(sim, p.id);
    const dummy = spawnDummy(sim, p);
    const events = capture(sim);
    p.autoAttack = true;
    p.swingTimer = 0;
    p.offhandSwingTimer = 0;
    updatePlayerAutoAttack(sim.ctx, p, meta);
    const swings = events.filter(
      (e) => e.type === 'damage' && e.sourceId === p.id && e.targetId === dummy.id,
    );
    expect(swings).toHaveLength(2);
    expect(p.swingTimer).toBeGreaterThan(0);
    expect(p.offhandSwingTimer).toBeGreaterThan(0);
  });
});

// A two-hander occupies both hands: mainhand 2H + a filled offhand must never
// coexist (equipItem displaces the other hand to the bags, classic style), or
// the two-hand mastery would stack with shield block / a dual-wield swing.
describe('two-hander hand exclusivity', () => {
  // autoEquip: true dresses the starting kit, but the pickup-time auto-equip on
  // addItem would race these explicit equips; turn the player toggle off.
  function freshWarrior(): Sim {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true });
    requirePlayerMeta(sim, sim.player.id).autoEquip = false;
    return sim;
  }

  it('equipping a 2H displaces the shield to the bags', () => {
    const sim = freshWarrior();
    expect(sim.equipment.offhand).toBe('eastbrook_buckler');
    sim.addItem('eastbrook_greatsword', 1);
    sim.equipItem('eastbrook_greatsword');
    expect(sim.equipment.mainhand).toBe('eastbrook_greatsword');
    expect(sim.equipment.offhand).toBeUndefined();
    expect(sim.countItem('eastbrook_buckler')).toBe(1); // displaced, not destroyed
    expect(sim.countItem('worn_sword')).toBe(1); // the old mainhand swap
  });

  it('equipping a shield while wielding a 2H displaces the 2H to the bags', () => {
    const sim = freshWarrior();
    sim.addItem('eastbrook_greatsword', 1);
    sim.equipItem('eastbrook_greatsword');
    expect(sim.equipment.offhand).toBeUndefined();
    sim.equipItem('eastbrook_buckler');
    expect(sim.equipment.offhand).toBe('eastbrook_buckler');
    expect(sim.equipment.mainhand).toBeUndefined();
    expect(sim.countItem('eastbrook_greatsword')).toBe(1); // displaced, not destroyed
  });

  it('refuses a 2H equip when the displaced shield has no bag room', () => {
    const sim = freshWarrior();
    sim.addItem('eastbrook_greatsword', 1);
    // Gear never stacks, so each copy fills one pooled slot: pack the bags solid.
    while (sim.canAddItem('worn_sword', 1)) sim.addItem('worn_sword', 1);
    sim.equipItem('eastbrook_greatsword');
    expect(sim.equipment.mainhand).toBe('worn_sword'); // unchanged
    expect(sim.equipment.offhand).toBe('eastbrook_buckler'); // unchanged
    expect(sim.countItem('eastbrook_greatsword')).toBe(1); // still in the bags
  });
});

// Titan's Grip (owner decision 2026-07-10): Fury, and only Fury, dual-wields
// two-handers, one per weapon slot. Shields still never sit beside a 2H.
describe("Titan's Grip: Fury dual-wields two-handers", () => {
  function furyWarrior(): Sim {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(10);
    expect(sim.setSpec('fury')).toBe(true);
    requirePlayerMeta(sim, sim.player.id).autoEquip = false;
    return sim;
  }

  function furyWithTwoGreatswords(): Sim {
    const sim = furyWarrior();
    sim.addItem('eastbrook_greatsword', 2);
    // The natural two-click flow (no unequip workaround): the first greatsword
    // fills the mainhand (the strong hand, benching the starting shield), the
    // second then routes to the offhand since the mainhand now holds a 2H.
    sim.equipItem('eastbrook_greatsword');
    expect(sim.equipment.mainhand).toBe('eastbrook_greatsword');
    expect(sim.equipment.offhand).toBeUndefined();
    sim.equipItem('eastbrook_greatsword');
    expect(sim.equipment.mainhand).toBe('eastbrook_greatsword');
    expect(sim.equipment.offhand).toBe('eastbrook_greatsword');
    return sim;
  }

  it('a lone greatsword routes to the mainhand (the strong hand), not the offhand', () => {
    const sim = furyWarrior();
    // The fresh kit is a one-hander (worn_sword) in the mainhand, so the routing
    // choice is real: the greatsword must not slip into the half-damage offhand.
    expect(sim.equipment.mainhand).toBe('worn_sword');
    sim.addItem('eastbrook_greatsword', 1);
    sim.equipItem('eastbrook_greatsword');
    expect(sim.equipment.mainhand).toBe('eastbrook_greatsword'); // strong hand, not offhand
    expect(sim.equipment.offhand).toBeUndefined();
  });

  it('a Fury warrior equips a two-hander in EACH weapon slot and dual-wields them', () => {
    const sim = furyWithTwoGreatswords();
    expect(sim.player.dualWielding).toBe(true);
  });

  it("a Titan's Grip pair swings BOTH hands over auto-attack", () => {
    const sim = furyWithTwoGreatswords() as TestSim;
    const p = sim.player;
    const meta = requirePlayerMeta(sim, p.id);
    const dummy = spawnDummy(sim, p);
    const events = capture(sim);
    p.autoAttack = true;
    p.swingTimer = 0;
    p.offhandSwingTimer = 0;
    updatePlayerAutoAttack(sim.ctx, p, meta);
    const swings = events.filter(
      (e) => e.type === 'damage' && e.sourceId === p.id && e.targetId === dummy.id,
    );
    expect(swings).toHaveLength(2);
  });

  it('a non-Fury warrior can NOT hold a second two-hander (it swaps the mainhand)', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true });
    requirePlayerMeta(sim, sim.player.id).autoEquip = false;
    sim.addItem('eastbrook_greatsword', 2);
    sim.equipItem('eastbrook_greatsword'); // displaces the shield, takes mainhand
    expect(sim.equipment.mainhand).toBe('eastbrook_greatsword');
    expect(sim.equipment.offhand).toBeUndefined();
    sim.equipItem('eastbrook_greatsword'); // the second one just swaps mainhand
    expect(sim.equipment.mainhand).toBe('eastbrook_greatsword');
    expect(sim.equipment.offhand).toBeUndefined();
    expect(sim.countItem('eastbrook_greatsword')).toBe(1); // the swapped-out copy
  });

  it("equipping a shield over a Titan's Grip pair benches BOTH greatswords", () => {
    const sim = furyWithTwoGreatswords();
    sim.equipItem('eastbrook_buckler');
    expect(sim.equipment.offhand).toBe('eastbrook_buckler');
    expect(sim.equipment.mainhand).toBeUndefined(); // never shield + 2H
    expect(sim.countItem('eastbrook_greatsword')).toBe(2); // both in the bags
  });

  it('switching Fury to Arms benches the now-illegal offhand two-hander', () => {
    const sim = furyWithTwoGreatswords();
    expect(sim.equipment.offhand).toBe('eastbrook_greatsword');
    expect(sim.setSpec('arms')).toBe(true);
    // Arms cannot dual-wield two-handers: the offhand piece must go to the bags,
    // never persist a state the equip path refuses to create.
    expect(sim.equipment.offhand).toBeUndefined();
    expect(sim.equipment.mainhand).toBe('eastbrook_greatsword'); // the mainhand 2H is fine for Arms
    expect(sim.countItem('eastbrook_greatsword')).toBe(1); // benched, not destroyed
  });

  it('switching Fury (dual one-handers) to Prot benches the offhand weapon', () => {
    const sim = furyWarrior();
    sim.addItem('redbrook_blade', 2);
    sim.equipItem('redbrook_blade'); // mainhand (starting worn_sword swapped out... actually offhand-routed)
    sim.equipItem('redbrook_blade');
    expect(sim.equipment.offhand).toBe('redbrook_blade'); // dual-wielding one-handers
    expect(sim.setSpec('prot')).toBe(true);
    // Prot cannot dual-wield: the offhand one-hander is benched.
    expect(sim.equipment.offhand).toBeUndefined();
  });
});
