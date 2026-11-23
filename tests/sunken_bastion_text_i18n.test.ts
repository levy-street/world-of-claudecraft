// The Sunken Bastion boss pass's sim English reaches the client matcher
// (src/ui/sim_i18n.ts): every Vael line resolves through localizeSimText, and
// every new aura or mechanic name through localizeSimAuraName, so a reworded
// line in the sim can never fall silently back to English on the client.

import { describe, expect, it } from 'vitest';
import {
  VAEL_INTRO_LINES,
  VAEL_RETURN_LINE,
  VAEL_VEIL_LINES,
} from '../src/sim/encounters/sunken_bastion';
import { localizeSimAuraName, localizeSimText } from '../src/ui/sim_i18n';

describe('Sunken Bastion boss pass: sim text round-trips through the client matcher', () => {
  it('every Vael line is a matcher row', () => {
    for (const line of [...VAEL_INTRO_LINES, VAEL_RETURN_LINE, ...VAEL_VEIL_LINES])
      expect(localizeSimText(line), line).toBe(line);
  });

  it('every new aura and mechanic name is a matcher row', () => {
    for (const name of [
      'Shrouded',
      'Beacon-Lit',
      'Hollow Shade',
      'Brine-Hallowed',
      'Hallowed Brine',
      'Rebounding Bulwark',
      'Sentence of the Tide',
      'Unbroken Oath',
    ])
      expect(localizeSimAuraName(name), name).toBe(name);
  });
});
