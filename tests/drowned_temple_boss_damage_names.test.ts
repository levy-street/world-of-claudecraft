// The Drowned Temple bosses' damage names (the dealDamage labels in
// src/sim/encounters/drowned_temple) reach the client's matcher: the combat
// log, the meters and the death recap localize each through
// src/ui/sim_i18n.ts localizeSimAuraName (null means it would show raw English).

import { describe, expect, it } from 'vitest';
import { localizeSimAuraName } from '../src/ui/sim_i18n';

const NAMES = [
  'Sea-Song',
  'Moonwater Bolt',
  'Drowning Aria',
  'Mere Surge',
  'Moonlight Lance',
  'Resonant Slam',
  'Prism Flare',
  'Tideglass Fracture',
  'Freezing Breath',
  'Crushing Torrent',
  // The Temple encounter pass: the Combined Breath, the moon's call, and the
  // Moonmantle Ray's renamed moves.
  'Frostlocked Torrent',
  'Venom Current',
  'Toxic Rime',
  'Ice Shards',
  'Moonlight Tear',
  'Falling Moon',
  'Spilled Moonlight',
  'Lunar Glide',
  'Tidal Wingbeat',
  'Nacre Cocoon',
  'Frozen',
  'Moonsear',
  'Moonswell',
  'Plenilune Ward',
  'Eclipsed',
  'Moonborne Might',
];

describe('the Drowned Temple boss damage names localize', () => {
  it.each(NAMES)('%s resolves through the client matcher', (name) => {
    const out = localizeSimAuraName(name);
    expect(out).not.toBeNull();
    expect(out).toBe(name);
  });
});
