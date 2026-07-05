import { describe, expect, it } from 'vitest';
import { SAVED_LOADOUT_BAR_SLOTS } from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';
import { MAX_LEVEL } from '../src/sim/types';

describe('loadout action bar persistence', () => {
  it('preserves the full two-row action bar in saved loadouts', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    sim.setPlayerLevel(MAX_LEVEL);
    const fullBar = Array.from({ length: SAVED_LOADOUT_BAR_SLOTS + 1 }, (_, i) => `slot_${i}`);

    expect(sim.saveLoadout('Two Row Bar', fullBar)).toBe(0);
    expect(sim.loadouts[0].bar).toEqual(fullBar.slice(0, SAVED_LOADOUT_BAR_SLOTS));
  });
});
