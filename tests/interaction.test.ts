// Direct unit tests for src/sim/interaction.ts (session W3). These call the moved
// module functions with a real Sim's SimContext (sim.ctx), exercising every arm the
// brief lists: loot permission + range gates, open/personal/shared loot slots, the
// generic + quest-gated object pickup, and interact's target-then-nearest dispatch
// into the loot / pickup / quest-NPC arms (the latter through the new ctx.talkToNpc +
// ctx.isQuestInteractionEntity callbacks that stay bound to Sim).
//
// The Sim facade keeps thin delegates (sim.lootCorpse/pickUpObject/interact) that
// forward into these same functions; the parity goldens (party_loot, l1_loot_distribution,
// nythraxis_full_pull) and the sim/fixes/social/nythraxis anchor suites pin the
// byte-identical behavior across the move. Here we assert the module's own surface.

import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createGroundObject, createMob } from '../src/sim/entity';
import * as interaction from '../src/sim/interaction';
import { Sim } from '../src/sim/sim';
import { type Entity, INTERACT_RANGE, OBJECT_RESPAWN } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;
type LootSlotLike = { itemId: string; count: number; openToAll?: boolean; personalFor?: number[] };

function ctxOf(sim: Sim) {
  return (sim as AnySim).ctx;
}

function place(sim: AnySim, e: AnyEntity, x: number, z: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = terrainHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  e.onGround = true;
  sim.rebucket(e);
}

// Drop every entity out of the lootable/scan picture so the nearest-entity scan
// in interact() sees only what a test deliberately enables (the world spawns
// ambient mobs/objects; this keeps the scan deterministic).
function freezeWorld(sim: AnySim): void {
  for (const e of sim.entities.values()) e.lootable = false;
}

function corpse(
  sim: AnySim,
  x: number,
  z: number,
  tappedById: number,
  items: LootSlotLike[],
): AnyEntity {
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 2, {
    x,
    y: terrainHeight(x, z, sim.cfg.seed),
    z,
  }) as AnyEntity;
  mob.dead = true;
  mob.lootable = true;
  mob.tappedById = tappedById;
  mob.loot = { copper: 0, items };
  sim.addEntity(mob);
  return mob;
}

function groundObj(sim: AnySim, itemId: string, x: number, z: number): AnyEntity {
  const obj = createGroundObject(sim.nextId++, itemId, itemId, {
    x,
    y: terrainHeight(x, z, sim.cfg.seed),
    z,
  }) as AnyEntity;
  sim.addEntity(obj);
  return obj;
}

function errors(sim: AnySim): string[] {
  return (sim.events as Array<{ type: string; text?: string }>)
    .filter((e) => e.type === 'error')
    .map((e) => e.text as string);
}

// Two unpartied players a (the looter under test) and b (a foreign tapper).
function twoPlayers(): { sim: AnySim; a: number; b: number } {
  const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true }) as AnySim;
  const a = sim.addPlayer('warrior', 'Aaa');
  const b = sim.addPlayer('mage', 'Bbb');
  freezeWorld(sim);
  place(sim, sim.entities.get(a) as AnyEntity, 20, 20);
  place(sim, sim.entities.get(b) as AnyEntity, 60, 60);
  return { sim, a, b };
}

describe('interaction.lootCorpse', () => {
  it('denies a corpse tapped by a non-party player with no personal/open slot', () => {
    const { sim, a, b } = twoPlayers();
    const mob = corpse(sim, 20, 22, b, [{ itemId: 'worn_sword', count: 1 }]);
    sim.events = [];
    expect(interaction.lootCorpse(ctxOf(sim), mob.id, a)).toBe(false);
    expect(errors(sim)).toContain("You don't have permission to loot that.");
    expect(sim.countItem('worn_sword', a)).toBe(0);
    expect(mob.loot?.items[0].count).toBe(1); // untouched: looting bailed before any mutation
  });

  it('gates on range with "Too far away."', () => {
    const { sim, a } = twoPlayers();
    // tapped by a (shared rights) but placed beyond INTERACT_RANGE.
    const mob = corpse(sim, 20 + INTERACT_RANGE + 3, 20, a, [{ itemId: 'worn_sword', count: 1 }]);
    sim.events = [];
    expect(interaction.lootCorpse(ctxOf(sim), mob.id, a)).toBe(false);
    expect(errors(sim)).toContain('Too far away.');
    expect(sim.countItem('worn_sword', a)).toBe(0);
  });

  it('awards an open-to-all slot to any looter and drains the count', () => {
    const { sim, a } = twoPlayers();
    const mob = corpse(sim, 20, 22, 999999, [{ itemId: 'wolf_fang', count: 2, openToAll: true }]);
    sim.events = [];
    expect(interaction.lootCorpse(ctxOf(sim), mob.id, a)).toBe(true);
    expect(sim.countItem('wolf_fang', a)).toBe(2);
    expect(mob.loot).toBeNull(); // open slot drained to 0 -> pruneCorpseLoot cleared it
  });

  it('awards a personal slot to its owner and filters them out', () => {
    const { sim, a } = twoPlayers();
    const mob = corpse(sim, 20, 22, 999999, [
      { itemId: 'gnarled_staff', count: 1, personalFor: [a] },
    ]);
    sim.events = [];
    expect(interaction.lootCorpse(ctxOf(sim), mob.id, a)).toBe(true);
    expect(sim.countItem('gnarled_staff', a)).toBe(1);
    // claimed personal slot is filtered to [] then pruned away -> corpse emptied.
    expect(mob.loot).toBeNull();
  });

  it('does a shared looter-takes-all direct add and clears the player target', () => {
    const { sim, a } = twoPlayers();
    const mob = corpse(sim, 20, 22, a, [{ itemId: 'worn_sword', count: 1 }]);
    const player = sim.entities.get(a) as AnyEntity;
    player.targetId = mob.id;
    sim.events = [];
    expect(interaction.lootCorpse(ctxOf(sim), mob.id, a)).toBe(true);
    expect(sim.countItem('worn_sword', a)).toBe(1);
    expect(mob.loot).toBeNull(); // pruneCorpseLoot cleared the emptied corpse
    expect(player.targetId).toBeNull();
  });
});

describe('interaction.pickUpObject', () => {
  it('picks up a generic non-quest object (ward/relic short-circuits fall through)', () => {
    const { sim, a } = twoPlayers();
    const obj = groundObj(sim, 'wolf_fang', 20, 21);
    sim.events = [];
    expect(interaction.pickUpObject(ctxOf(sim), obj.id, a)).toBe(true);
    expect(sim.countItem('wolf_fang', a)).toBe(1);
    expect(obj.lootable).toBe(false);
    expect(obj.respawnTimer).toBe(OBJECT_RESPAWN);
  });

  it('denies a quest object when the quest is not active (pickupDeny)', () => {
    const { sim, a } = twoPlayers();
    const obj = groundObj(sim, 'supply_crate', 20, 21);
    sim.events = [];
    expect(interaction.pickUpObject(ctxOf(sim), obj.id, a)).toBe(false);
    expect(sim.countItem('supply_crate', a)).toBe(0);
    expect(obj.lootable).toBe(true);
    // the relocated def.pickupDeny literal still emits unchanged at the new site.
    expect(errors(sim).length).toBeGreaterThan(0);
  });

  it('allows a quest object once the quest is active', () => {
    const { sim, a } = twoPlayers();
    const meta = sim.players.get(a) as Record<string, any>;
    meta.questLog.set('q_supplies', { questId: 'q_supplies', counts: [0], state: 'active' });
    const obj = groundObj(sim, 'supply_crate', 20, 21);
    sim.events = [];
    expect(interaction.pickUpObject(ctxOf(sim), obj.id, a)).toBe(true);
    expect(sim.countItem('supply_crate', a)).toBe(1);
    expect(obj.lootable).toBe(false);
  });

  it('gates object pickup on range with "Too far away."', () => {
    const { sim, a } = twoPlayers();
    const obj = groundObj(sim, 'wolf_fang', 20 + INTERACT_RANGE + 3, 20);
    sim.events = [];
    expect(interaction.pickUpObject(ctxOf(sim), obj.id, a)).toBe(false);
    expect(errors(sim)).toContain('Too far away.');
    expect(sim.countItem('wolf_fang', a)).toBe(0);
    expect(obj.lootable).toBe(true);
  });
});

describe('interaction.interact dispatch', () => {
  it('target-path: routes a targeted lootable corpse to lootCorpse', () => {
    const { sim, a } = twoPlayers();
    const mob = corpse(sim, 20, 22, a, [{ itemId: 'worn_sword', count: 1 }]);
    const player = sim.entities.get(a) as AnyEntity;
    player.targetId = mob.id;
    interaction.interact(ctxOf(sim), a);
    expect(sim.countItem('worn_sword', a)).toBe(1);
    expect(player.targetId).toBeNull();
  });

  it('target-path: routes a targeted lootable object to pickUpObject', () => {
    const { sim, a } = twoPlayers();
    const obj = groundObj(sim, 'wolf_fang', 20, 21);
    (sim.entities.get(a) as AnyEntity).targetId = obj.id;
    interaction.interact(ctxOf(sim), a);
    expect(sim.countItem('wolf_fang', a)).toBe(1);
    expect(obj.lootable).toBe(false);
  });

  it('nearest-scan: with no target, picks up the nearest lootable object', () => {
    const { sim, a } = twoPlayers();
    const obj = groundObj(sim, 'wolf_fang', 20, 21);
    (sim.entities.get(a) as AnyEntity).targetId = null;
    interaction.interact(ctxOf(sim), a);
    expect(sim.countItem('wolf_fang', a)).toBe(1);
    expect(obj.lootable).toBe(false);
  });

  it('nearest-scan: a nearer corpse wins over a farther object', () => {
    const { sim, a } = twoPlayers();
    const obj = groundObj(sim, 'wolf_fang', 20, 23); // farther
    const mob = corpse(sim, 20, 21, a, [{ itemId: 'worn_sword', count: 1 }]); // nearer
    (sim.entities.get(a) as AnyEntity).targetId = null;
    interaction.interact(ctxOf(sim), a);
    expect(sim.countItem('worn_sword', a)).toBe(1); // looted the nearer corpse
    expect(sim.countItem('wolf_fang', a)).toBe(0); // the object was not picked up
    expect(obj.lootable).toBe(true);
    expect(mob.loot).toBeNull();
  });

  it('routes a nearby quest NPC to talkToNpc via the ctx callbacks (quest accepted)', () => {
    // Single-player world at the q_wolves giver: interact's quest-entity arm fans
    // into ctx.isQuestInteractionEntity + ctx.talkToNpc, both bound to Sim.
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true }) as AnySim;
    const p = sim.player;
    place(sim, p, 4, 4);
    expect(sim.questState('q_wolves')).toBe('available');
    interaction.interact(ctxOf(sim), p.id);
    expect(sim.questState('q_wolves')).toBe('active');
  });
});
