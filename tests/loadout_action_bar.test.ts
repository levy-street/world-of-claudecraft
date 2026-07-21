import { describe, expect, it } from 'vitest';
import { SAVED_LOADOUT_BAR_SLOTS } from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';
import { MAX_LEVEL } from '../src/sim/types';
import { ACTION_BAR_ABILITY_SLOTS } from '../src/ui/hud/action_bar/action_bar_layout_core';

describe('loadout action bar persistence', () => {
  it('preserves the full three-row action bar in saved loadouts', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    sim.setPlayerLevel(MAX_LEVEL);
    const fullBar = Array.from({ length: SAVED_LOADOUT_BAR_SLOTS + 1 }, (_, i) => `slot_${i}`);

    expect(SAVED_LOADOUT_BAR_SLOTS).toBe(ACTION_BAR_ABILITY_SLOTS);
    expect(sim.saveLoadout('Three Row Bar', fullBar)).toBe(0);
    expect(sim.loadouts[0].bar).toEqual(fullBar.slice(0, SAVED_LOADOUT_BAR_SLOTS));
  });
});
