import { describe, expect, it } from 'vitest';
import { CLASSES } from '../src/sim/content/classes';
import { Sim } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';

// Fresh characters set out provisioned: 5 bread for every class, plus 5 water
// for the mana classes. Saved characters load their own bags and are never
// re-granted the rations.

const ALL_CLASSES = Object.keys(CLASSES) as PlayerClass[];

function count(sim: Sim, itemId: string): number {
  return sim.inventory.filter((s) => s.itemId === itemId).reduce((total, s) => total + s.count, 0);
}

describe('starter rations', () => {
  for (const cls of ALL_CLASSES) {
    const wantsWater = CLASSES[cls].resourceType === 'mana';
    it(`a fresh ${cls} starts with 5 bread${wantsWater ? ' and 5 water' : ' and no water'}`, () => {
      const sim = new Sim({ seed: 42, playerClass: cls });
      expect(count(sim, 'baked_bread')).toBe(5);
      expect(count(sim, 'spring_water')).toBe(wantsWater ? 5 : 0);
    });
  }

  it('rage and energy classes are exactly the waterless ones', () => {
    const waterless = ALL_CLASSES.filter((c) => CLASSES[c].resourceType !== 'mana').sort();
    expect(waterless).toEqual(['rogue', 'warrior']);
  });

  it('a saved character keeps its bags as-is (no re-grant on load)', () => {
    const sim = new Sim({ seed: 42, playerClass: 'priest' });
    // The player ate two loaves and drank all the water before saving.
    sim.removeItem('baked_bread', 2);
    sim.removeItem('spring_water', 5);
    const state = sim.serializeCharacter(sim.primaryId);
    expect(state).not.toBeNull();

    const sim2 = new Sim({ seed: 42, playerClass: 'priest', noPlayer: true });
    const pid = sim2.addPlayer('priest', 'Reloaded', { state: state! });
    const meta = sim2.players.get(pid)!;
    const loaded = (id: string) =>
      meta.inventory.filter((s) => s.itemId === id).reduce((t, s) => t + s.count, 0);
    expect(loaded('baked_bread')).toBe(3);
    expect(loaded('spring_water')).toBe(0);
  });
});
