import { describe, expect, it } from 'vitest';
import { corpseLootAvailability } from '../src/game/corpse_loot_availability';
import { bagCapacity } from '../src/sim/bags';
import { ITEMS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { CORPSE_INTERACT_GRACE_SECONDS } from '../src/sim/loot/loot_roll';
import { HARVEST_CAST_SECONDS } from '../src/sim/professions/harvest_admission';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { DT, type Entity } from '../src/sim/types';
import { completeCorpseHarvest } from './helpers/complete_corpse_harvest';
import { EMPTY_TEST_WORLD } from './sim_shared';

// Corpse lifecycle decoupling: the loot half and the harvest half of
// a tagged corpse can be consumed in either order without ever stranding the
// other. Fully looted with an unclaimed harvest keeps the corpse open for a
// short grace window (pruneCorpseLoot); a spent harvest claim shortens the
// remaining-loot window and collapses an exhausted corpse outright
// (harvestCorpse); the respawn gate in mob/locomotion.ts is UNTOUCHED, both
// arms steer it purely through corpseTimer/lootable writes.
//
// `harvestCorpse` is the real, timed PR3 cast (professions/corpse_harvest_
// session.ts): completing one always spends HARVEST_CAST_SECONDS of real
// ticks, and mob.corpseTimer decays by DT every one of those ticks
// (mob/locomotion.ts) independent of the harvest. So a completion that lands
// via the driver's tick loop always carries one MORE decay tick than a grant
// landed by a direct, non-ticking call: the completion clamp (corpse_harvest_
// grant.ts) reads corpseTimer BEFORE that final tick's own decay, so the
// value observed after the loop is `clampTarget - DT`. Every exact
// corpseTimer assertion below that follows a completed cast accounts for
// this precisely rather than dropping to an inequality.

type SimInternals = {
  entities: Map<number, Entity>;
  players: Map<number, PlayerMeta>;
  pendingLootRolls: Map<number, { mobId: number }>;
};

function placeCoherently(sim: Sim, e: Entity, x: number, z: number): void {
  e.pos = sim.groundPos(x, z);
  e.prevPos = { ...e.pos };
  e.vx = 0;
  e.vy = 0;
  e.vz = 0;
  e.onGround = true;
}

function setup(seed = 11) {
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true, world: EMPTY_TEST_WORLD });
  const internals = sim as unknown as SimInternals;
  const a = sim.addPlayer('warrior', 'Alpha');
  const b = sim.addPlayer('warrior', 'Bravo');
  sim.tick();
  // Both carry a Field Kit from the start: every case below that starts a
  // real harvest cast needs one, and supplying it here (rather than per case)
  // means a later full-bags case tests bags capacity, never a missing kit.
  for (const pid of [a, b]) {
    placeCoherently(sim, internals.entities.get(pid)!, 0, 0);
    sim.addItem('field_kit', 1, pid);
  }
  // A dead wolf corpse (componentTags: hide, fang) with both windows parked
  // far out so only the writes under test move them. tappedById stays null:
  // an untapped corpse grants shared loot rights to any looter.
  const template = MOBS.forest_wolf;
  const mob = createMob(9999, template, template.maxLevel, sim.groundPos(0, 0));
  mob.dead = true;
  mob.aiState = 'dead';
  mob.corpseTimer = 9999;
  mob.respawnTimer = 9999;
  internals.entities.set(mob.id, mob);
  return { sim, internals, a, b, mob };
}

function giveLoot(mob: Entity, copper = 10): void {
  mob.loot = { copper, items: [] };
  mob.lootable = true;
}

// Same idiom as tests/corpse_harvest_cast.test.ts fillBags: distinct 1-per-slot
// gear so the next add has nowhere to go.
function fillBags(sim: Sim, internals: SimInternals, pid: number): void {
  const m = internals.players.get(pid)!;
  const cap = bagCapacity(m.bags);
  const gearIds = Object.values(ITEMS)
    .filter((d) => d.kind === 'weapon' || d.kind === 'armor')
    .map((d) => d.id);
  let i = 0;
  while (m.inventory.length < cap) {
    sim.addItem(gearIds[i % gearIds.length], 1, pid);
    i++;
  }
}

describe('corpse lifecycle decoupling', () => {
  it('full loot with an unclaimed harvest keeps the corpse open on the grace clamp', () => {
    const { sim, mob, a } = setup();
    giveLoot(mob);
    expect(sim.lootCorpse(mob.id, a)).toBe(true);
    expect(mob.loot).toBeNull();
    expect(mob.lootable).toBe(true);
    expect(CORPSE_INTERACT_GRACE_SECONDS).toBe(30);
    expect(mob.corpseTimer).toBe(CORPSE_INTERACT_GRACE_SECONDS);
  });

  it('the grace clamp never RAISES a shorter remaining decay', () => {
    const { sim, mob, a } = setup();
    giveLoot(mob);
    mob.corpseTimer = 12; // already decayed below the grace window
    sim.lootCorpse(mob.id, a);
    expect(mob.lootable).toBe(true);
    expect(mob.corpseTimer).toBe(12);
  });

  it('the HARVEST-arm grace clamp never RAISES a shorter remaining decay either', () => {
    // The prune-path pin above covers lootCorpse; this is the harvestCorpse
    // grant's own Math.min clamp (loot still aboard, claim consumed).
    const { sim, mob, a } = setup();
    giveLoot(mob);
    mob.corpseTimer = 12;
    const result = completeCorpseHarvest(sim, mob.id, a);
    expect(result.started).toBe(true);
    expect(mob.harvestClaimedBy).toBe(a);
    expect(mob.lootable).toBe(true);
    // 12 was already below the grace window, so the clamp is a no-op; the
    // observed value is just the 1.5s of real cast decay.
    expect(mob.corpseTimer).toBeCloseTo(12 - HARVEST_CAST_SECONDS, 5);
  });

  it('the corpse still opens and harvests during the grace window, then collapses fast', () => {
    const { sim, mob, a, b } = setup();
    giveLoot(mob);
    sim.lootCorpse(mob.id, a);
    // Openable during grace: the harvest half is what keeps canOpen alive.
    const availability = corpseLootAvailability(mob, b);
    expect(availability.hasLoot).toBe(false);
    expect(availability.harvestable).toBe(true);
    expect(availability.canOpen).toBe(true);
    // The harvest succeeds inside the window; with the loot already gone the
    // corpse has both halves consumed and takes the fast arm.
    const result = completeCorpseHarvest(sim, mob.id, b);
    expect(result.started).toBe(true);
    expect(mob.harvestClaimedBy).toBe(b);
    expect(sim.countItem('rough_hide', b)).toBeGreaterThanOrEqual(1);
    expect(mob.lootable).toBe(false);
    // The fast-arm clamp (Math.min(_, 4)) lands mid-tick, then that same
    // tick's own corpse decay runs once more before the loop observes it.
    expect(mob.corpseTimer).toBeCloseTo(4 - DT, 5);
  });

  it('respawn fires when the grace window elapses, at the boundary tick', () => {
    const { sim, mob, a } = setup();
    giveLoot(mob);
    sim.lootCorpse(mob.id, a);
    expect(mob.corpseTimer).toBe(CORPSE_INTERACT_GRACE_SECONDS);
    mob.respawnTimer = 0; // isolate the corpse-window half of the respawn gate
    const boundaryTicks = Math.round(CORPSE_INTERACT_GRACE_SECONDS / DT);
    for (let i = 0; i < boundaryTicks - 1; i++) sim.tick();
    // One tick shy of the boundary the corpse still stands (corpseTimer > 0).
    expect(mob.dead).toBe(true);
    expect(mob.corpseTimer).toBeGreaterThan(0);
    sim.tick(); // the boundary tick: corpseTimer reaches 0 and the gate fires
    expect(mob.dead).toBe(false);
    // The respawn sweep still clears the harvest claim (existing contract).
    expect(mob.harvestClaimedBy).toBeNull();
  });

  it('full loot with the harvest claim already spent takes the fast arm', () => {
    const { sim, mob, a } = setup();
    giveLoot(mob);
    const result = completeCorpseHarvest(sim, mob.id, a);
    expect(result.started).toBe(true);
    expect(mob.harvestClaimedBy).toBe(a);
    // The subsequent lootCorpse call is a direct, non-ticking call: its own
    // fast-arm clamp is the last write, so this stays exact.
    expect(sim.lootCorpse(mob.id, a)).toBe(true);
    expect(mob.loot).toBeNull();
    expect(mob.lootable).toBe(false);
    expect(mob.corpseTimer).toBe(4);
  });

  it('harvest with loot remaining clamps to the grace window and the loot stays takeable', () => {
    const { sim, internals, mob, a } = setup();
    giveLoot(mob, 10);
    const result = completeCorpseHarvest(sim, mob.id, a);
    expect(result.started).toBe(true);
    expect(mob.harvestClaimedBy).toBe(a);
    expect(mob.lootable).toBe(true);
    expect(mob.corpseTimer).toBeCloseTo(CORPSE_INTERACT_GRACE_SECONDS - DT, 5);
    // Inside the window the loot half still delivers.
    const before = internals.players.get(a)!.copper;
    expect(sim.lootCorpse(mob.id, a)).toBe(true);
    expect(internals.players.get(a)!.copper - before).toBe(10);
  });

  it('harvest with loot exhausted takes the fast arm', () => {
    const { sim, mob, a } = setup();
    // rollLoot yielded nothing: the harvest-only shape (loot null, open).
    mob.loot = null;
    mob.lootable = true;
    const result = completeCorpseHarvest(sim, mob.id, a);
    expect(result.started).toBe(true);
    expect(mob.harvestClaimedBy).toBe(a);
    expect(mob.lootable).toBe(false);
    expect(mob.corpseTimer).toBeCloseTo(4 - DT, 5);
  });

  it('a harvested harvest-only corpse respawns fast and clears its claim', () => {
    const { sim, mob, a } = setup();
    mob.loot = null;
    mob.lootable = true;
    const result = completeCorpseHarvest(sim, mob.id, a);
    expect(result.started).toBe(true);
    expect(mob.harvestClaimedBy).toBe(a);
    mob.respawnTimer = 0;
    // lootable false makes the respawn gate ignore the corpse window: the
    // very next tick respawns in place.
    sim.tick();
    expect(mob.dead).toBe(false);
    expect(mob.harvestClaimedBy).toBeNull();
  });

  it('partial loot leaves the full decay window untouched', () => {
    const { sim, mob, a, b } = setup();
    mob.loot = { copper: 10, items: [{ itemId: 'wolf_fang', count: 1, personalFor: [b] }] };
    mob.lootable = true;
    expect(sim.lootCorpse(mob.id, a)).toBe(true); // takes the copper only
    expect(mob.loot?.items).toHaveLength(1); // Bravo's personal slot remains
    expect(mob.lootable).toBe(true);
    expect(mob.corpseTimer).toBe(9999);
  });

  it('a capacity-refused harvest neither consumes the claim nor clamps any timer', () => {
    const { sim, internals, mob, a } = setup();
    fillBags(sim, internals, a); // a already carries its Field Kit from setup()
    giveLoot(mob);
    sim.drainEvents();
    const result = completeCorpseHarvest(sim, mob.id, a);
    expect(result.started).toBe(false); // refused at admission: never ticks
    const ev = sim.drainEvents();
    expect(ev.some((e) => e.type === 'error' && e.text === 'Your bags are full.')).toBe(true);
    expect(mob.harvestClaimedBy).toBeNull();
    expect(mob.lootable).toBe(true);
    expect(mob.corpseTimer).toBe(9999);
  });

  it('a pending need-greed roll owns the timer: a harvest never clamps past it', () => {
    const { sim, internals, mob, a } = setup();
    mob.loot = null;
    mob.lootable = true;
    mob.corpseTimer = 62; // the pending-roll floor pruneCorpseLoot maintains
    internals.pendingLootRolls.set(1, { mobId: mob.id });
    const result = completeCorpseHarvest(sim, mob.id, a);
    expect(result.started).toBe(true);
    expect(mob.harvestClaimedBy).toBe(a); // the claim itself is untouched
    expect(mob.lootable).toBe(true);
    // The pending roll suppresses BOTH clamp branches: only the ordinary
    // per-tick corpse decay over the cast moves this number.
    expect(mob.corpseTimer).toBeCloseTo(62 - HARVEST_CAST_SECONDS, 5);
  });
});
