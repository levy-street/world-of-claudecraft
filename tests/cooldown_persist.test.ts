// Bug fix: spell/ability cooldowns (Sprint, etc.) and the shared combat-potion
// cooldown were never serialized, so logging out and back in wiped them and let a
// player bypass long cooldowns by relogging. cooldown_persist.ts is the pure leaf
// that snapshots the remaining time (clock-independent deltas) and re-anchors it on
// load; this test pins both the leaf and the full Sim serializeCharacter <-> addPlayer
// round-trip.

import { describe, expect, it } from 'vitest';
import { applyCooldowns, serializeCooldowns } from '../src/sim/cooldown_persist';
import { Sim } from '../src/sim/sim';

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

  it('applyCooldowns(undefined) leaves an empty map and no potion cooldown', () => {
    const fresh = new Map<string, number>();
    expect(applyCooldowns(undefined, fresh, 0)).toBe(-1);
    expect(fresh.size).toBe(0);
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
    e.cooldowns.set('shield_wall', 180);
    e.potionCooldownUntil = sim.time + 30;

    const s1 = sim.serializeCharacter(pid)!;
    expect(s1.cooldowns).toEqual({ abilities: { sprint: 25, shield_wall: 180 }, potion: 30 });
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
