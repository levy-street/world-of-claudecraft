import type { RowTree, TalentRowLevel } from './talent_rows';
import type { ClassTalents, SpecDef } from './talents';

function row(
  level: TalentRowLevel,
  prefix: string,
  names: readonly [string, string, string],
): RowTree[number] {
  return {
    level,
    options: [
      {
        id: `${prefix}_r${level}_vigor`,
        name: names[0],
        description: 'Increases Stamina by 5%.',
        effect: { stats: { staPct: 0.05 } },
      },
      {
        id: `${prefix}_r${level}_power`,
        name: names[1],
        description: 'Increases all damage you deal by 4%.',
        effect: { global: { spellDmgPct: 0.04 } },
      },
      {
        id: `${prefix}_r${level}_haste`,
        name: names[2],
        description: 'Increases spell haste by 5%.',
        effect: { global: { spellHastePct: 0.05 } },
      },
    ],
  };
}

function rows(prefix: string, vocabulary: readonly [string, string, string]): RowTree {
  return [5, 8, 11, 14, 17, 20].map((level) => row(level as TalentRowLevel, prefix, vocabulary));
}

const GRAVECALLER_SPECS: SpecDef[] = [
  {
    id: 'plagueweaver',
    class: 'gravecaller',
    name: 'Plagueweaver',
    role: 'dps',
    icon: 'the_wasting',
    description: 'A patient killer who layers wasting diseases and survives through stolen life.',
    signature: 'the_wasting',
    mastery: {
      name: 'Virulent Host',
      description: 'Increases periodic damage by 20%.',
      effect: { global: { dotDmgPct: 0.2 } },
    },
  },
  {
    id: 'ossuary',
    class: 'gravecaller',
    name: 'Ossuary',
    role: 'dps',
    icon: 'gravecaller_bone_coat',
    description: 'A bone sovereign who commands the dead and endures retaliation.',
    signature: 'gravecaller_bone_coat',
    mastery: {
      name: 'Grave Dominion',
      description: 'Increases pet damage by 25% and Stamina by 10%.',
      effect: { global: { petDmgPct: 0.25 }, stats: { staPct: 0.1 } },
    },
  },
  {
    id: 'bloodsage',
    class: 'gravecaller',
    name: 'Bloodsage',
    role: 'dps',
    icon: 'soul_siphon',
    description: 'A life-draining occultist who trades health for relentless spell pressure.',
    signature: 'soul_siphon',
    mastery: {
      name: 'Crimson Accounting',
      description: 'Increases spell damage by 12% and maximum health by 8%.',
      effect: { global: { spellDmgPct: 0.12 }, stats: { maxHpPct: 0.08 } },
    },
  },
];

const BRIAR_WARDEN_SPECS: SpecDef[] = [
  {
    id: 'thornbound',
    class: 'briar_warden',
    name: 'Thornbound',
    role: 'tank',
    icon: 'briar_skin',
    description: 'A damage-shield tank who destroys melee attackers by enduring their blows.',
    signature: 'briar_skin',
    mastery: {
      name: 'Living Rampart',
      description: 'Increases armor by 20%, Stamina by 25%, and threat by 40%.',
      effect: { stats: { armorPct: 0.2, staPct: 0.25 }, global: { threatPct: 0.4 } },
    },
  },
  {
    id: 'blightkeeper',
    class: 'briar_warden',
    name: 'Blightkeeper',
    role: 'dps',
    icon: 'spore_hex',
    description: 'A mobile curse bearer who weakens packs and lets hostile contact kill them.',
    signature: 'spore_hex',
    mastery: {
      name: 'Hostile Garden',
      description: 'Increases Nature and periodic damage by 15%.',
      effect: { global: { spellDmgPct: 0.15, dotDmgPct: 0.15 } },
    },
  },
  {
    id: 'grove_covenant',
    class: 'briar_warden',
    name: 'Grove Covenant',
    role: 'healer',
    icon: 'ironbark_boon',
    description:
      'A boon keeper who protects allies with armor, regeneration, and retaliatory growth.',
    signature: 'ironbark_boon',
    mastery: {
      name: 'Shared Roots',
      description: 'Increases healing by 20% and Spirit by 10%.',
      effect: { global: { healPct: 0.2 }, stats: { spiPct: 0.1 } },
    },
  },
];

export const GRAVECALLER_TALENTS: ClassTalents = {
  class: 'gravecaller',
  specs: GRAVECALLER_SPECS,
};

export const BRIAR_WARDEN_TALENTS: ClassTalents = {
  class: 'briar_warden',
  specs: BRIAR_WARDEN_SPECS,
};

export const GRAVECALLER_ROWS = rows('gc', ['Grave Vigor', 'Black Power', 'Deathly Tempo']);
export const BRIAR_WARDEN_ROWS = rows('bw', ['Rooted Vigor', 'Barbed Power', 'Verdant Tempo']);
