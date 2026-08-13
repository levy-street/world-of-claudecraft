import { describe, expect, it } from 'vitest';
import { petCanForceTaunt } from '../src/sim/pet/pet_taunt_gate';

// petCanForceTaunt is the single predicate the command surface (pet_commands.ts),
// the passive AI (pet_ai.ts), and the HUD pet bar (hud.ts) all read, so a ranged
// pet's Growl/taunt control can never disagree with what the sim actually allows.
describe('petCanForceTaunt', () => {
  it('is false for the ranged Warlock pet Emberkin', () => {
    expect(petCanForceTaunt('emberkin')).toBe(false);
  });

  it('is false for the explicitly flagged mage Water Elemental', () => {
    expect(petCanForceTaunt('water_elemental')).toBe(false);
  });

  it('is true for a melee hunter pet with no override', () => {
    expect(petCanForceTaunt('forest_wolf')).toBe(true);
  });

  it('defaults to true for an unknown template id', () => {
    expect(petCanForceTaunt('does_not_exist')).toBe(true);
  });
});
