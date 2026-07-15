// SwordMaster specialization identities and masteries. Class-wide choice rows
// live in swordmaster_rows.ts.

import type { ClassTalents, SpecDef } from './talents';

const SPECS: SpecDef[] = [
  {
    id: 'tempest',
    class: 'swordmaster',
    name: 'Tempest',
    role: 'dps',
    icon: '*',
    description: 'An area specialist who turns paired blades into a moving storm.',
    signature: 'blade_cyclone',
    mastery: {
      name: 'Gathering Storm',
      description: 'Increases physical ability damage by up to 12%.',
      effect: { global: { meleeDmgPct: 0.12 } },
    },
  },
  {
    id: 'duelist',
    class: 'swordmaster',
    name: 'Duelist',
    role: 'dps',
    icon: '/',
    description: 'A cadence specialist who overwhelms one opponent with relentless attacks.',
    signature: 'duelist_flurry',
    mastery: {
      name: 'Measured Tempo',
      description: 'Increases melee haste by up to 12% and critical strike chance by up to 3%.',
      effect: { global: { meleeHastePct: 0.12 }, stats: { crit: 0.03 } },
    },
  },
  {
    id: 'azure_blade',
    class: 'swordmaster',
    name: 'Azure Blade',
    role: 'dps',
    icon: '>',
    description: 'A mobile controller who crosses the battlefield in flashes of azure steel.',
    signature: 'azure_rush',
    mastery: {
      name: 'Azure Current',
      description: 'Increases Agility by up to 12% and dodge by up to 4%.',
      effect: { stats: { agiPct: 0.12, dodge: 0.04 } },
    },
  },
];

export const SWORDMASTER_TALENTS: ClassTalents = {
  class: 'swordmaster',
  specs: SPECS,
};
