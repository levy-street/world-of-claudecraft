// Bug fix: spell/ability cooldowns (Sprint, etc.) and the shared combat-potion
// cooldown were never serialized, so logging out and back in wiped them and let a
// player bypass long cooldowns by relogging. cooldown_persist.ts is the pure leaf
// that snapshots the remaining time (clock-independent deltas) and re-anchors it on
// load; this test pins both the leaf and the full Sim serializeCharacter <-> addPlayer
// round-trip.

import { describe, expect, it } from 'vitest';
import { updateTimers } from '../src/sim/combat/auras';
import {
  type AbilityChargeState,
  applyCooldowns,
  type SavedCooldowns,
  serializeCooldowns,
} from '../src/sim/cooldown_persist';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

describe('cooldown_persist leaf', () => {
  it('round-trips ability cooldowns as remaining seconds (frozen across the save)', () => {
    const cds = new Map<string, number>([
      ['sprint', 22.5],
      ['shield_wall', 180],
    ]);
    const saved = serializeCooldowns(cds, -1, 0)!;
    expect(saved.abilities).toEqual({ sprint: 22.5, shield_wall: 180 });

    // load into a fresh entity's empty map at an unrelated clock value: the
    // remaining time is preserved (re-anchored), not the original absolute clock.
    const fresh = new Map<string, number>();
    const potion = applyCooldowns(saved, fresh, 9999);
    expect(fresh.get('sprint')).toBe(22.5);
    expect(fresh.get('shield_wall')).toBe(180);
    expect(potion).toBe(-1); // no potion cooldown was saved
  });

  it('persists the shared combat-potion cooldown as remaining time, re-anchored on load', () => {
    // potionCooldownUntil is absolute sim-time; at now=100 with 40s left it is 140.
    const saved = serializeCooldowns(new Map(), 140, 100)!;
    expect(saved.potion).toBe(40);
    // restoring into a sim whose clock reads 5 re-anchors to 5 + 40 = 45.
    const until = applyCooldowns(saved, new Map(), 5);
    expect(until).toBe(45);
  });

  it('returns undefined when nothing is on cooldown (keeps clean saves minimal)', () => {
    expect(serializeCooldowns(new Map(), -1, 0)).toBeUndefined();
    // already-expired potion (until <= now) is not persisted.
    expect(serializeCooldowns(new Map(), 50, 60)).toBeUndefined();
  });

  it('ignores non-finite and non-positive values from a tampered/legacy save', () => {
    const fresh = new Map<string, number>();
    const until = applyCooldowns(
      { abilities: { good: 10, zero: 0, neg: -5, nan: Number.NaN }, potion: -1 },
      fresh,
      0,
    );
    expect([...fresh.keys()]).toEqual(['good']);
    expect(until).toBe(-1);
  });

  it('drops cooldowns for abilities removed from the current kit during restore', () => {
    const fresh = new Map<string, number>();
    applyCooldowns(
      { abilities: { sprint: 12, ironhold: 180 } },
      fresh,
      0,
      undefined,
      undefined,
      (id) => id !== 'ironhold',
    );
    expect([...fresh]).toEqual([['sprint', 12]]);
  });

  it('applyCooldowns(undefined) leaves an empty map and no potion cooldown', () => {
    const fresh = new Map<string, number>();
    expect(applyCooldowns(undefined, fresh, 0)).toBe(-1);
    expect(fresh.size).toBe(0);
  });

  it('persists a mid-recharge charge pool literally and skips full pools', () => {
    const saved = serializeCooldowns(new Map(), -1, 0, {
      raging_gale: { charges: 1, maxCharges: 2, recharge: 5.5, rechargeLength: 8 },
      // a full pool carries no information: it reconstructs on the next cast
      ice_block: { charges: 2, maxCharges: 2, recharge: 0, rechargeLength: 240 },
    })!;
    expect(saved.abilityCharges).toEqual({
      raging_gale: { charges: 1, maxCharges: 2, recharge: 5.5, rechargeLength: 8 },
    });
    expect(saved.charges).toBeUndefined(); // the legacy Map field is never written

    const pools: Record<string, AbilityChargeState> = {};
    const fresh = new Map<string, number>();
    applyCooldowns(saved, fresh, 0, pools);
    expect(pools.raging_gale).toEqual({
      charges: 1,
      maxCharges: 2,
      recharge: 5.5,
      rechargeLength: 8,
    });
    expect(fresh.has('raging_gale')).toBe(false); // a use is stored: no empty-pool mirror
  });

  it('re-arms the empty-pool cooldown mirror when a pool restores with zero charges', () => {
    const saved = serializeCooldowns(new Map([['raging_gale', 6]]), -1, 0, {
      raging_gale: { charges: 0, maxCharges: 2, recharge: 6, rechargeLength: 8 },
    })!;
    const pools: Record<string, AbilityChargeState> = {};
    const fresh = new Map<string, number>();
    applyCooldowns(saved, fresh, 0, pools);
    expect(pools.raging_gale.charges).toBe(0);
    expect(fresh.get('raging_gale')).toBe(6); // still blocked after the relog
  });

  it('converts a LEGACY {spent, cdMax} save onto the recharge model using current caps', () => {
    const saved: SavedCooldowns = {
      abilities: { raging_gale: 5 },
      charges: { raging_gale: { spent: 1, cdMax: 8 } },
    };
    const pools: Record<string, AbilityChargeState> = {};
    const fresh = new Map<string, number>();
    applyCooldowns(
      saved,
      fresh,
      0,
      pools,
      new Map([['raging_gale', { maxCharges: 2, cooldown: 8 }]]),
    );
    expect(pools.raging_gale).toEqual({
      charges: 1,
      maxCharges: 2,
      recharge: 5,
      rechargeLength: 8,
    });
    expect(fresh.has('raging_gale')).toBe(false); // one use stored: pool open
  });
});

describe('Sim cooldown persistence round-trip (anti-relog-reset)', () => {
  const makeWorld = () => new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });

  it('an ability cooldown survives serializeCharacter -> addPlayer (no relog reset)', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Sprinter');
    const e = sim.entities.get(pid)!;
    e.cooldowns.set('sprint', 25);
    e.potionCooldownUntil = sim.time + 30;

    const state = sim.serializeCharacter(pid)!;
    const sim2 = makeWorld();
    const pid2 = sim2.addPlayer('warrior', 'Sprinter', { state });
    const e2 = sim2.entities.get(pid2)!;
    expect(e2.cooldowns.get('sprint')).toBe(25);
    expect(e2.potionCooldownUntil).toBe(sim2.time + 30);
  });

  it('a removed Ironhold cooldown is scrubbed from a legacy character on load', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Legacy Tank');
    const state = sim.serializeCharacter(pid)!;
    state.cooldowns = { abilities: { sprint: 25, ironhold: 180 } };

    const sim2 = makeWorld();
    const pid2 = sim2.addPlayer('warrior', 'Legacy Tank', { state });
    expect([...sim2.entities.get(pid2)!.cooldowns]).toEqual([['sprint', 25]]);
    expect(sim2.serializeCharacter(pid2)?.cooldowns).toEqual({ abilities: { sprint: 25 } });
  });

  it('re-anchors the derived potion display copy (potionCdRemaining) on load', () => {
    // Regression: load restored the authoritative potionCooldownUntil but left the
    // derived display copy at 0, so after a relog inside the shared potion cooldown the
    // action bar painted the potion READY (no swipe) while the sim gate still rejected
    // the quaff. The display copy must be re-derived from the restored authority.
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Quaffer');
    const e = sim.entities.get(pid)!;
    e.potionCooldownUntil = sim.time + 40; // 40s left on the shared potion cooldown
    e.potionCdRemaining = 40; // as a quaff materializes it

    const state = sim.serializeCharacter(pid)!;
    const sim2 = makeWorld();
    const pid2 = sim2.addPlayer('warrior', 'Quaffer', { state });
    const e2 = sim2.entities.get(pid2)!;
    // Authority restored, so the use-gate still blocks...
    expect(e2.potionCooldownUntil).toBe(sim2.time + 40);
    // ...and the display copy is re-derived to match, so the swipe/countdown shows.
    expect(e2.potionCdRemaining).toBeCloseTo(40, 5);
  });

  it('a populated character round-trips deep-equal through serialize -> load -> serialize', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Onco');
    const e = sim.entities.get(pid)!;
    e.cooldowns.set('sprint', 25);
    e.cooldowns.set('battle_shout', 180);
    e.potionCooldownUntil = sim.time + 30;

    const s1 = sim.serializeCharacter(pid)!;
    expect(s1.cooldowns).toEqual({ abilities: { sprint: 25, battle_shout: 180 }, potion: 30 });
    const sim2 = makeWorld();
    const pid2 = sim2.addPlayer('warrior', 'Onco', { state: s1 });
    expect(sim2.serializeCharacter(pid2)).toEqual(s1);
  });

  it('a character with no cooldowns still round-trips deep-equal', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Idle');
    const s1 = sim.serializeCharacter(pid)!;
    expect(s1.cooldowns).toBeUndefined();
    const sim2 = makeWorld();
    const pid2 = sim2.addPlayer('warrior', 'Idle', { state: s1 });
    expect(sim2.serializeCharacter(pid2)).toEqual(s1);
  });
});

// An empty world to relog into (mirrors the makeWorld helper scoped above).
function emptyWorld(): Sim {
  return new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
}

// A live Fury warrior at cap with a melee target, for driving REAL charge spends
// (raging_gale is fury-gated, learnLevel 7; def maxCharges 2, cooldown 8).
function makeFuryWarrior(seed: number): { sim: Sim; p: Entity } {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.setSpec('fury')).toBe(true);
  const host = sim as Sim & { nextId: number; addEntity(entity: Entity): void };
  const p = sim.player;
  const mob = createMob(host.nextId++, MOBS.forest_wolf, 1, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + 2,
  });
  mob.maxHp = 1_000_000;
  mob.hp = mob.maxHp;
  mob.hostile = true;
  host.addEntity(mob);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  sim.targetEntity(mob.id, p.id);
  return { sim, p };
}

describe('Sim charge-pool persistence round-trip (anti-relog-refill)', () => {
  it('a really-spent Twinstrike charge survives serializeCharacter -> addPlayer with literal counts', () => {
    const { sim, p } = makeFuryWarrior(11);
    p.gcdRemaining = 0;
    sim.castAbility('raging_gale');
    expect(p.abilityCharges?.raging_gale).toEqual({
      charges: 1,
      maxCharges: 2,
      recharge: 8,
      rechargeLength: 8,
      recharges: [8],
    });

    const state = sim.serializeCharacter(p.id)!;
    expect(state.cooldowns?.abilityCharges).toEqual({
      raging_gale: { charges: 1, maxCharges: 2, recharge: 8, rechargeLength: 8, recharges: [8] },
    });

    const sim2 = emptyWorld();
    const pid2 = sim2.addPlayer('warrior', 'Twin', { state });
    const e2 = sim2.entities.get(pid2)!;
    // The relog neither refills the spent use (still 1, not 2) nor loses the
    // banked one; the recharge resumes where it left off.
    expect(e2.abilityCharges?.raging_gale).toEqual({
      charges: 1,
      maxCharges: 2,
      recharge: 8,
      rechargeLength: 8,
      recharges: [8],
    });
    expect(e2.cooldowns.has('raging_gale')).toBe(false); // a use is stored: castable
  });

  it('an EMPTY pool restores blocked (mirror intact) and refills only as the recharge elapses', () => {
    const { sim, p } = makeFuryWarrior(13);
    p.gcdRemaining = 0;
    sim.castAbility('raging_gale');
    p.gcdRemaining = 0;
    sim.castAbility('raging_gale');
    expect(p.abilityCharges?.raging_gale?.charges).toBe(0);
    expect(p.cooldowns.get('raging_gale')).toBe(8); // empty-pool cooldown mirror

    const state = sim.serializeCharacter(p.id)!;
    const sim2 = emptyWorld();
    const pid2 = sim2.addPlayer('warrior', 'Drained', { state });
    const e2 = sim2.entities.get(pid2)!;
    expect(e2.abilityCharges?.raging_gale?.charges).toBe(0);
    expect(e2.cooldowns.get('raging_gale')).toBe(8); // still blocked: no relog reset

    // Parallel per-charge recharge: both uses were spent back to back, so BOTH
    // timers run together and the whole pool is back after ~8s (each charge
    // returns its own cooldown after the moment IT was spent).
    for (let tick = 0; tick < 161; tick++) updateTimers(e2);
    expect(e2.abilityCharges?.raging_gale?.charges).toBe(2);
    expect(e2.cooldowns.has('raging_gale')).toBe(false);
    expect(e2.abilityCharges?.raging_gale?.recharge).toBe(0);
  });

  it('a LEGACY {spent, cdMax} save converts on load against the current resolved caps', () => {
    const { sim, p } = makeFuryWarrior(17);
    const base = sim.serializeCharacter(p.id)!;
    const state = {
      ...base,
      cooldowns: {
        abilities: { raging_gale: 5 },
        charges: { raging_gale: { spent: 1, cdMax: 8 } },
      },
    };
    const sim2 = emptyWorld();
    const pid2 = sim2.addPlayer('warrior', 'Legacy', { state });
    const e2 = sim2.entities.get(pid2)!;
    expect(e2.abilityCharges?.raging_gale).toEqual({
      charges: 1,
      maxCharges: 2,
      recharge: 5,
      rechargeLength: 8,
    });
    expect(e2.cooldowns.has('raging_gale')).toBe(false); // one use stored: pool open
  });
});
