import { describe, expect, it } from 'vitest';
import { MAGE_CHOICE_ROWS } from '../src/sim/content/choice_rows_classic';
import { talentEffectIconRef } from '../src/ui/talent_icons';

const expected = new Map([
  ['mag_r5_ice_floes', 'ice_floes'],
  ['mag_r5_double_blink', 'double_blink'],
  ['mag_r5_blink_cast', 'blink_while_casting'],
  ['mag_r8_warded', 'warded'],
  ['mag_r8_temporal_rift', 'temporal_rift'],
  ['mag_r8_greater_invis', 'greater_invisibility'],
  ['mag_r11_rings_of_frost', 'rings_of_frost'],
  ['mag_r11_snap_polymorph', 'snap_polymorph'],
  ['mag_r11_twin_nova', 'twin_frost_nova'],
  ['mag_r14_power_echo', 'power_echo'],
  ['mag_r14_overload', 'overload'],
  ['mag_r14_presence_of_mind', 'presence_of_mind'],
  ['mag_r17_convergence', 'elemental_convergence'],
  ['mag_r17_cold_snap', 'cold_snap'],
  ['mag_r17_mass_barrier', 'mass_barrier'],
  ['mag_r20_rune_of_power', 'rune_of_power'],
  ['mag_r20_overflowing_power', 'overflowing_power'],
  ['mag_r20_evocation', 'evocation'],
]);

describe('mage painted talent icons', () => {
  it('routes each custom-painted talent to its dedicated image id', () => {
    const options = MAGE_CHOICE_ROWS.rows.flatMap((row) => row.options);
    for (const [optionId, imageId] of expected) {
      const option = options.find((candidate) => candidate.id === optionId);
      expect(option, optionId).toBeDefined();
      expect(talentEffectIconRef(option?.effect)).toEqual({
        kind: 'ability',
        id: imageId,
      });
    }
  });
});
