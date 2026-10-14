// Intended legacy editor Playtest grant contract: max level, best gear in the
// original eleven paperdoll slots, and true invulnerability. This helper tests
// the Sim grant operations; it does not prove main.ts still wires the grant.

import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD } from '../src/sim/data';
import { bestGodLoadout } from '../src/sim/dev_loadout';
import { Sim } from '../src/sim/sim';
import { ALL_CLASSES, ALL_EQUIP_SLOTS, MAX_LEVEL, type PlayerClass } from '../src/sim/types';

// The legacy grant promises nine gear slots and two rings. Offhand is optional.
const PLAYTEST_EQUIP_SLOTS = [
  'mainhand',
  'helmet',
  'neck',
  'shoulder',
  'chest',
  'waist',
  'legs',
  'gloves',
  'feet',
  'ring1',
  'ring2',
] as const;

/** Exercise the intended legacy grant operations against a live Sim. */
function grantPlaytestGodMode(sim: Sim, cls: PlayerClass): void {
  sim.setPlayerLevel(MAX_LEVEL, sim.playerId);
  const loadout = bestGodLoadout(cls);
  for (const id of [...loadout.slots, ...loadout.rings]) {
    sim.addItem(id, 1, sim.playerId);
    sim.equipItem(id, sim.playerId);
  }
  const setDevGod = Reflect.get(sim, 'setDevGod');
  if (typeof setDevGod !== 'function') {
    throw new Error('Legacy editor playtest grant requires Sim.setDevGod');
  }
  setDevGod.call(sim, true, sim.playerId);
}

function makeSim(cls: PlayerClass) {
  // world: BUILTIN_WORLD stands in for the editor's custom world (the branch
  // only cares that `world !== undefined`).
  return new Sim({ seed: 3, playerClass: cls, playerName: 'Maker', world: BUILTIN_WORLD });
}

describe('editor playtest god mode', () => {
  it('maxes the level and fills every equip slot with best-in-slot gear', () => {
    for (const cls of ALL_CLASSES) {
      const sim = makeSim(cls);
      grantPlaytestGodMode(sim, cls);
      const p = sim.entities.get(sim.playerId);
      expect(p, cls).toBeDefined();
      if (!p) continue;
      expect(p.level).toBe(MAX_LEVEL);
      // All eleven paperdoll slots worn (nine gear + two rings).
      for (const slot of PLAYTEST_EQUIP_SLOTS) {
        expect(ALL_EQUIP_SLOTS).toContain(slot);
        expect(p.equippedItems[slot], `${cls} ${slot}`).toBeTruthy();
      }
    }
  });

  it('makes the player invulnerable (dealDamage no-ops)', () => {
    const sim = makeSim('warrior');
    grantPlaytestGodMode(sim, 'warrior');
    const p = sim.entities.get(sim.playerId);
    if (!p) throw new Error('no player');
    expect(p.devGod).toBe(true);
    const before = p.hp;
    // A would-be lethal hit is fully absorbed by god mode.
    (sim as unknown as { dealDamage: (...a: unknown[]) => void }).dealDamage(
      p,
      p,
      p.maxHp * 10,
      false,
      'physical',
      'Test',
      'hit',
      true,
    );
    expect(p.hp).toBe(before);
    expect(p.dead).toBe(false);
  });

  it('raises the health pool above a fresh level-1 character', () => {
    const fresh = makeSim('warrior');
    const freshHp = fresh.entities.get(fresh.playerId)?.maxHp ?? 0;
    const god = makeSim('warrior');
    grantPlaytestGodMode(god, 'warrior');
    const godHp = god.entities.get(god.playerId)?.maxHp ?? 0;
    expect(godHp).toBeGreaterThan(freshHp);
  });
});
