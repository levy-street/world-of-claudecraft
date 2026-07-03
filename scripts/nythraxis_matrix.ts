import { writeFileSync } from 'node:fs';
import {
  defaultBuild,
  type TalentAllocation,
  talentPointsAtLevel,
  validateAllocation,
} from '../src/sim/content/talents';
import { DUNGEONS, ITEMS, instanceOrigin, MOBS } from '../src/sim/data';
import { canEquipItem } from '../src/sim/equipment_rules';
import { Sim } from '../src/sim/sim';
import {
  dist2d,
  type Entity,
  type EquipSlot,
  type ItemDef,
  MELEE_RANGE,
  type PlayerClass,
} from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

type Role = 'bossTank' | 'offTank' | 'healer' | 'dps';
type SpecKind = 'physical' | 'caster' | 'healer' | 'tank';
type Spec = {
  key: string;
  cls: PlayerClass;
  role: Role;
  kind: SpecKind;
  melee: boolean;
  talents: TalentAllocation;
  prepull?: string[];
  rotation: string[];
  healRotation?: string[];
};

const SLOTS: EquipSlot[] = [
  'mainhand',
  'helmet',
  'shoulder',
  'chest',
  'waist',
  'legs',
  'gloves',
  'feet',
];
const NYTHRAXIS_DROP_IDS = new Set(
  (MOBS.nythraxis_scourge_of_thornpeak.loot ?? [])
    .map((entry) => entry.itemId)
    .filter((id): id is string => !!id),
);

const specs = {
  protectionWarrior: {
    key: 'protection_warrior',
    cls: 'warrior',
    role: 'bossTank',
    kind: 'tank',
    melee: true,
    talents: {
      spec: 'prot',
      ranks: {
        war_toughness: 3,
        war_imp_heroic_strike: 2,
        war_tactical_choice: 1,
        prot_toughness: 3,
        prot_imp_thunder_clap: 2,
      },
      choices: { war_tactical_choice: 'tc_bladed_armor' },
    },
    rotation: [
      'defensive_stance',
      'battle_shout',
      'sunder_armor',
      'shield_slam',
      'thunder_clap',
      'heroic_strike',
    ],
  },
  protectionPaladin: {
    key: 'protection_paladin',
    cls: 'paladin',
    role: 'bossTank',
    kind: 'tank',
    melee: true,
    talents: {
      spec: 'protection',
      ranks: {
        pal_divine_strength: 3,
        pal_imp_devotion_aura: 2,
        pal_holy_calling: 1,
        prot_redoubt: 3,
        prot_imp_righteous_fury: 2,
      },
      choices: { pal_holy_calling: 'pal_calling_guardian' },
    },
    rotation: [
      'righteous_fury',
      'devotion_aura',
      'consecration',
      'judgement',
      'seal_of_righteousness',
    ],
  },
  feralDruidTank: {
    key: 'feral_druid_tank',
    cls: 'druid',
    role: 'bossTank',
    kind: 'tank',
    melee: true,
    talents: {
      spec: 'feral',
      ranks: {
        dru_feral_aggression: 3,
        dru_thick_hide: 2,
        feral_thick_hide: 3,
        feral_brutal_impact: 2,
        feral_choice: 1,
      },
      choices: { feral_choice: 'feral_choice_bear' },
    },
    rotation: ['demoralizing_roar', 'maul', 'swipe'],
  },
  holyPriest: {
    key: 'holy_priest',
    cls: 'priest',
    role: 'healer',
    kind: 'healer',
    melee: false,
    talents: {
      spec: 'holy',
      ranks: {
        pri_wand_specialization: 3,
        pri_meditation: 2,
        pri_inner_calling: 1,
        holy_healing_focus: 3,
        holy_divine_fury: 2,
      },
      choices: { pri_inner_calling: 'pri_calling_holy' },
    },
    rotation: ['smite'],
    healRotation: ['flash_heal', 'heal', 'lesser_heal'],
  },
  disciplinePriest: {
    key: 'discipline_priest',
    cls: 'priest',
    role: 'healer',
    kind: 'healer',
    melee: false,
    talents: {
      spec: 'discipline',
      ranks: {
        pri_wand_specialization: 3,
        pri_meditation: 2,
        pri_inner_calling: 1,
        disc_unbreakable_will: 3,
        disc_imp_shield: 2,
      },
      choices: { pri_inner_calling: 'pri_calling_disc' },
    },
    rotation: ['smite'],
    healRotation: ['power_word_shield', 'flash_heal', 'heal', 'lesser_heal'],
  },
  restorationDruid: {
    key: 'restoration_druid',
    cls: 'druid',
    role: 'healer',
    kind: 'healer',
    melee: false,
    talents: {
      spec: 'restoration',
      ranks: {
        dru_natures_grasp: 3,
        dru_naturalist: 2,
        dru_natures_path: 1,
        rest_imp_rejuv: 3,
        rest_reflection: 2,
      },
      choices: { dru_natures_path: 'dru_path_resto' },
    },
    rotation: ['wrath'],
    healRotation: ['regrowth', 'healing_touch', 'rejuvenation'],
  },
  restorationShaman: {
    key: 'restoration_shaman',
    cls: 'shaman',
    role: 'healer',
    kind: 'healer',
    melee: false,
    talents: {
      spec: 'restoration',
      ranks: {
        sha_ancestral_knowledge: 3,
        sha_tidal_focus: 2,
        rest_tidal_focus: 3,
        rest_imp_healing_wave: 2,
        rest_choice: 1,
      },
      choices: { rest_choice: 'rest_choice_mana' },
    },
    rotation: ['lightning_bolt'],
    healRotation: ['healing_wave'],
  },
  holyPaladin: {
    key: 'holy_paladin',
    cls: 'paladin',
    role: 'healer',
    kind: 'healer',
    melee: false,
    talents: {
      spec: 'holy',
      ranks: {
        pal_divine_strength: 3,
        pal_benediction: 2,
        pal_holy_calling: 1,
        holy_imp_holy_light: 3,
        holy_flash_focus: 2,
      },
      choices: { pal_holy_calling: 'pal_calling_light' },
    },
    rotation: ['exorcism'],
    healRotation: ['flash_of_light', 'holy_light'],
  },
  combatRogue: {
    key: 'combat_rogue',
    cls: 'rogue',
    role: 'dps',
    kind: 'physical',
    melee: true,
    talents: {
      spec: 'combat',
      ranks: {
        rog_malice: 3,
        rog_imp_sinister: 2,
        rog_dirty_tricks: 1,
        combat_precision: 3,
        combat_dual_wield: 2,
      },
      choices: { rog_dirty_tricks: 'rog_trick_blade' },
    },
    rotation: ['instant_poison', 'adrenaline_rush', 'eviscerate', 'sinister_strike'],
  },
  assassinationRogue: {
    key: 'assassination_rogue',
    cls: 'rogue',
    role: 'dps',
    kind: 'physical',
    melee: true,
    talents: {
      spec: 'assassination',
      ranks: {
        rog_malice: 3,
        rog_imp_sinister: 2,
        rog_dirty_tricks: 1,
        ass_imp_eviscerate: 3,
        ass_murder: 2,
      },
      choices: { rog_dirty_tricks: 'rog_trick_poison' },
    },
    rotation: ['instant_poison', 'rupture', 'eviscerate', 'sinister_strike'],
  },
  subtletyRogue: {
    key: 'subtlety_rogue',
    cls: 'rogue',
    role: 'dps',
    kind: 'physical',
    melee: true,
    talents: {
      spec: 'subtlety',
      ranks: {
        rog_malice: 3,
        rog_camouflage: 2,
        rog_dirty_tricks: 1,
        sub_master_deception: 3,
        sub_opportunity: 2,
      },
      choices: { rog_dirty_tricks: 'rog_trick_shadow' },
    },
    rotation: ['instant_poison', 'eviscerate', 'sinister_strike'],
  },
  armsWarrior: {
    key: 'arms_warrior',
    cls: 'warrior',
    role: 'dps',
    kind: 'physical',
    melee: true,
    talents: {
      spec: 'arms',
      ranks: {
        war_toughness: 3,
        war_imp_heroic_strike: 2,
        war_tactical_choice: 1,
        arms_imp_overpower: 2,
        arms_deep_wounds: 2,
      },
      choices: { war_tactical_choice: 'tc_bladed_armor' },
    },
    rotation: [
      'battle_shout',
      'berserker_rage',
      'execute',
      'mortal_strike',
      'rend',
      'slam',
      'heroic_strike',
    ],
  },
  furyWarrior: {
    key: 'fury_warrior',
    cls: 'warrior',
    role: 'dps',
    kind: 'physical',
    melee: true,
    talents: {
      spec: 'fury',
      ranks: {
        war_toughness: 3,
        war_imp_heroic_strike: 2,
        war_tactical_choice: 1,
        fury_cruelty: 3,
        fury_whirlwind: 1,
        fury_unbridled_wrath: 1,
      },
      choices: { war_tactical_choice: 'tc_bladed_armor' },
    },
    rotation: [
      'battle_shout',
      'berserker_rage',
      'bloodthirst',
      'whirlwind',
      'cleave',
      'heroic_strike',
    ],
  },
  fireMage: {
    key: 'fire_mage',
    cls: 'mage',
    role: 'dps',
    kind: 'caster',
    melee: false,
    talents: {
      spec: 'fire',
      ranks: {
        mag_elemental_precision: 3,
        mag_flame_throwing: 2,
        mag_school_focus: 1,
        fire_imp_fireball: 3,
        fire_incinerate: 2,
      },
      choices: { mag_school_focus: 'mag_school_fire' },
    },
    prepull: ['arcane_intellect'],
    rotation: ['fire_blast', 'pyroblast', 'fireball', 'scorch'],
  },
  frostMage: {
    key: 'frost_mage',
    cls: 'mage',
    role: 'dps',
    kind: 'caster',
    melee: false,
    talents: {
      spec: 'frost',
      ranks: {
        mag_elemental_precision: 3,
        mag_arcane_focus: 2,
        mag_school_focus: 1,
        frost_imp_frostbolt: 3,
        frost_shatter: 2,
      },
      choices: { mag_school_focus: 'mag_school_frost' },
    },
    prepull: ['arcane_intellect'],
    rotation: ['frostbolt'],
  },
  arcaneMage: {
    key: 'arcane_mage',
    cls: 'mage',
    role: 'dps',
    kind: 'caster',
    melee: false,
    talents: {
      spec: 'arcane',
      ranks: {
        mag_arcane_focus: 3,
        mag_elemental_precision: 2,
        mag_school_focus: 1,
        arc_imp_missiles: 3,
        arc_arcane_power: 2,
      },
      choices: { mag_school_focus: 'mag_school_arcane' },
    },
    prepull: ['arcane_intellect'],
    rotation: ['arcane_missiles'],
  },
  destructionWarlock: {
    key: 'destruction_warlock',
    cls: 'warlock',
    role: 'dps',
    kind: 'caster',
    melee: false,
    talents: {
      spec: 'destruction',
      ranks: { wlk_demonic_embrace: 3, wlk_cataclysm: 2, dest_cataclysm: 3, dest_bane: 3 },
      choices: {},
    },
    prepull: ['demon_skin'],
    rotation: ['shadowburn', 'immolate', 'corruption', 'curse_of_agony', 'shadow_bolt'],
  },
  afflictionWarlock: {
    key: 'affliction_warlock',
    cls: 'warlock',
    role: 'dps',
    kind: 'caster',
    melee: false,
    talents: {
      spec: 'affliction',
      ranks: {
        wlk_suppression: 3,
        wlk_imp_corruption: 2,
        wlk_dark_pact: 1,
        aff_imp_agony: 3,
        aff_imp_corruption: 2,
      },
      choices: { wlk_dark_pact: 'wlk_pact_affliction' },
    },
    prepull: ['demon_skin'],
    rotation: ['immolate', 'corruption', 'curse_of_agony', 'drain_life', 'shadow_bolt'],
  },
  demonologyWarlock: {
    key: 'demonology_warlock',
    cls: 'warlock',
    role: 'dps',
    kind: 'caster',
    melee: false,
    talents: {
      spec: 'demonology',
      ranks: {
        wlk_demonic_embrace: 3,
        wlk_cataclysm: 2,
        wlk_dark_pact: 1,
        demo_demonic_embrace: 3,
        demo_fel_armor: 2,
      },
      choices: { wlk_dark_pact: 'wlk_pact_demonology' },
    },
    prepull: ['demon_skin'],
    rotation: ['immolate', 'corruption', 'curse_of_agony', 'shadow_bolt'],
  },
  marksmanshipHunter: {
    key: 'marksmanship_hunter',
    cls: 'hunter',
    role: 'dps',
    kind: 'physical',
    melee: false,
    talents: {
      spec: 'marksmanship',
      ranks: {
        hun_lethal_shots: 3,
        hun_efficiency: 2,
        mm_imp_arcane_shot: 3,
        mm_aimed_focus: 2,
        mm_barrage: 1,
      },
      choices: {},
    },
    rotation: ['aspect_of_the_hawk', 'rapid_fire', 'serpent_sting', 'aimed_shot', 'arcane_shot'],
  },
  beastMasteryHunter: {
    key: 'beast_mastery_hunter',
    cls: 'hunter',
    role: 'dps',
    kind: 'physical',
    melee: false,
    talents: {
      spec: 'beast_mastery',
      ranks: {
        hun_endurance_training: 3,
        hun_imp_hawk: 2,
        hun_pathfinder: 1,
        bm_thick_hide: 3,
        bm_unleashed_fury: 2,
      },
      choices: { hun_pathfinder: 'hun_path_beast' },
    },
    rotation: ['aspect_of_the_hawk', 'rapid_fire', 'serpent_sting', 'arcane_shot'],
  },
  survivalHunter: {
    key: 'survival_hunter',
    cls: 'hunter',
    role: 'dps',
    kind: 'physical',
    melee: false,
    talents: {
      spec: 'survival',
      ranks: {
        hun_lethal_shots: 3,
        hun_deflection: 2,
        hun_pathfinder: 1,
        surv_humanoid_slaying: 3,
        surv_deterrence: 2,
      },
      choices: { hun_pathfinder: 'hun_path_survivor' },
    },
    rotation: ['aspect_of_the_hawk', 'rapid_fire', 'serpent_sting', 'arcane_shot'],
  },
  retributionPaladin: {
    key: 'retribution_paladin',
    cls: 'paladin',
    role: 'dps',
    kind: 'physical',
    melee: true,
    talents: {
      spec: 'retribution',
      ranks: {
        pal_divine_strength: 3,
        pal_benediction: 2,
        ret_benediction: 3,
        ret_imp_judgement: 2,
        ret_seal_command: 1,
      },
      choices: {},
    },
    rotation: [
      'blessing_of_might',
      'seal_of_righteousness',
      'judgement',
      'exorcism',
      'consecration',
    ],
  },
  elementalShaman: {
    key: 'elemental_shaman',
    cls: 'shaman',
    role: 'dps',
    kind: 'caster',
    melee: false,
    talents: {
      spec: 'elemental',
      ranks: {
        sha_convection: 3,
        sha_ancestral_knowledge: 2,
        ele_concussion: 3,
        ele_elemental_focus: 2,
        ele_choice: 1,
      },
      choices: { ele_choice: 'ele_choice_storm' },
    },
    prepull: ['lightning_shield'],
    rotation: ['flame_shock', 'earth_shock', 'lightning_bolt'],
  },
  enhancementShaman: {
    key: 'enhancement_shaman',
    cls: 'shaman',
    role: 'dps',
    kind: 'physical',
    melee: true,
    talents: {
      spec: 'enhancement',
      ranks: {
        sha_ancestral_knowledge: 3,
        sha_convection: 2,
        enh_ancestral_weapons: 3,
        enh_imp_rockbiter: 2,
        enh_choice: 1,
      },
      choices: { enh_choice: 'enh_choice_stormstrike' },
    },
    prepull: ['flametongue_weapon'],
    rotation: ['stormstrike', 'flame_shock', 'earth_shock'],
  },
  balanceDruid: {
    key: 'balance_druid',
    cls: 'druid',
    role: 'dps',
    kind: 'caster',
    melee: false,
    talents: {
      spec: 'balance',
      ranks: {
        dru_natures_grasp: 3,
        dru_naturalist: 2,
        dru_natures_path: 1,
        bal_imp_wrath: 3,
        bal_natures_reach: 2,
      },
      choices: { dru_natures_path: 'dru_path_balance' },
    },
    rotation: ['moonfire', 'insect_swarm', 'wrath'],
  },
  feralDruid: {
    key: 'feral_druid',
    cls: 'druid',
    role: 'dps',
    kind: 'physical',
    melee: true,
    talents: {
      spec: 'feral',
      ranks: {
        dru_feral_aggression: 3,
        dru_naturalist: 2,
        dru_natures_path: 1,
        feral_ferocity: 3,
        feral_feline_swiftness: 2,
      },
      choices: { dru_natures_path: 'dru_path_feral' },
    },
    rotation: ['cat_form', 'tigers_fury', 'rip', 'ferocious_bite', 'claw'],
  },
  shadowPriest: {
    key: 'shadow_priest',
    cls: 'priest',
    role: 'dps',
    kind: 'caster',
    melee: false,
    talents: {
      spec: 'shadow',
      ranks: { pri_spirit_tap: 3, pri_shadow_affinity: 2, shadow_blackout: 3, shadow_word_pain: 3 },
      choices: {},
    },
    rotation: ['shadow_word_pain', 'mind_blast', 'mind_flay', 'smite'],
  },
} satisfies Record<string, Spec>;

const tanks = [specs.protectionWarrior, specs.protectionPaladin, specs.feralDruidTank];
const healers = [
  specs.holyPriest,
  specs.disciplinePriest,
  specs.restorationDruid,
  specs.restorationShaman,
  specs.holyPaladin,
];
const dpsSpecs = [
  specs.combatRogue,
  specs.assassinationRogue,
  specs.subtletyRogue,
  specs.armsWarrior,
  specs.furyWarrior,
  specs.fireMage,
  specs.frostMage,
  specs.arcaneMage,
  specs.destructionWarlock,
  specs.afflictionWarlock,
  specs.demonologyWarlock,
  specs.marksmanshipHunter,
  specs.beastMasteryHunter,
  specs.survivalHunter,
  specs.retributionPaladin,
  specs.elementalShaman,
  specs.enhancementShaman,
  specs.balanceDruid,
  specs.feralDruid,
  specs.shadowPriest,
];

function combos<T>(items: readonly T[], count: number): T[][] {
  if (count === 0) return [[]];
  if (items.length < count) return [];
  const [head, ...tail] = items;
  return [...combos(tail, count - 1).map((rest) => [head, ...rest]), ...combos(tail, count)];
}

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function face(source: Entity, target: Entity) {
  source.facing = Math.atan2(target.pos.x - source.pos.x, target.pos.z - source.pos.z);
  source.prevFacing = source.facing;
}

function statScore(item: ItemDef, spec: Spec): number {
  const s = item.stats ?? {};
  const weapon = item.weapon ? (item.weapon.min + item.weapon.max) / 2 / item.weapon.speed : 0;
  if (spec.kind === 'healer')
    return (
      weapon + (s.int ?? 0) * 5.4 + (s.spi ?? 0) * 4.4 + (s.sta ?? 0) * 0.8 + (s.armor ?? 0) * 0.004
    );
  if (spec.kind === 'caster')
    return (
      weapon * 2 +
      (s.int ?? 0) * 4.6 +
      (s.spi ?? 0) * 1.8 +
      (s.sta ?? 0) * 0.6 +
      (s.armor ?? 0) * 0.003
    );
  if (spec.kind === 'tank')
    return (
      weapon * 5 +
      (s.sta ?? 0) * 5 +
      (s.str ?? 0) * 3 +
      (s.agi ?? 0) * 2 +
      (s.int ?? 0) * (spec.cls === 'paladin' || spec.cls === 'druid' ? 1.2 : 0) +
      (s.armor ?? 0) * 0.08
    );
  return (
    weapon * 8 +
    (s.str ?? 0) * 3 +
    (s.agi ?? 0) * 3 +
    (s.sta ?? 0) +
    (s.int ?? 0) * (spec.cls === 'paladin' || spec.cls === 'shaman' ? 1.5 : 0) +
    (s.armor ?? 0) * 0.01
  );
}

function equipBest(sim: Sim, pid: number, spec: Spec) {
  for (const slot of SLOTS) {
    const item = Object.values(ITEMS)
      .filter(
        (candidate) =>
          !NYTHRAXIS_DROP_IDS.has(candidate.id) &&
          candidate.slot === slot &&
          (candidate.kind === 'weapon' || candidate.kind === 'armor') &&
          canEquipItem(spec.cls, candidate),
      )
      .sort((a, b) => statScore(b, spec) - statScore(a, spec))[0];
    if (item) {
      sim.addItem(item.id, 1, pid);
      sim.equipItem(item.id, pid);
    }
  }
}

function ensureTalents(sim: Sim, pid: number, spec: Spec) {
  const check = validateAllocation(spec.cls, spec.talents, talentPointsAtLevel(20));
  if (!check.ok) {
    console.warn(`Invalid talents for ${spec.key}: ${check.reason}`);
  }
  if (!sim.applyTalents(spec.talents, pid)) {
    sim.applyTalents(defaultBuild(spec.cls, talentPointsAtLevel(20)), pid);
  }
}

function livingAdds(sim: Sim) {
  return [...sim.entities.values()].filter(
    (e) => e.kind === 'mob' && e.templateId === 'nythraxis_skeleton_warrior' && !e.dead,
  );
}

function cast(sim: Sim, pid: number, targetId: number, ability: string) {
  const p = sim.entities.get(pid)!;
  if (p.dead || p.castingAbility) return false;
  p.targetId = targetId;
  const target = sim.entities.get(targetId);
  if (target) face(p, target);
  const before = `${p.castingAbility}|${p.gcdRemaining}|${p.queuedOnSwing}|${p.resource}|${p.auras.length}`;
  sim.castAbility(ability, pid);
  const after = `${p.castingAbility}|${p.gcdRemaining}|${p.queuedOnSwing}|${p.resource}|${p.auras.length}`;
  return before !== after;
}

function positionFor(spec: Spec, boss: Entity, i: number) {
  if (spec.key === 'feral_druid_tank') return { x: boss.pos.x + 12, z: boss.pos.z };
  const range = spec.melee
    ? MELEE_RANGE - 1.2
    : spec.cls === 'hunter'
      ? 13
      : spec.cls === 'warlock' ||
          spec.key === 'shadow_priest' ||
          spec.key === 'elemental_shaman' ||
          spec.key === 'fire_mage'
        ? 18
        : 24;
  const angle = (Math.PI * 2 * i) / 10;
  return { x: boss.pos.x + Math.sin(angle) * range, z: boss.pos.z - Math.cos(angle) * range };
}

const DOT_ABILITIES = new Set([
  'immolate',
  'corruption',
  'curse_of_agony',
  'shadow_word_pain',
  'moonfire',
  'insect_swarm',
  'flame_shock',
  'serpent_sting',
  'rend',
  'rip',
  'rupture',
]);
const SELF_BUFF_ABILITIES = new Set([
  'lightning_shield',
  'aspect_of_the_hawk',
  'battle_shout',
  'blessing_of_might',
  'righteous_fury',
  'devotion_aura',
  'seal_of_righteousness',
  'instant_poison',
  'defensive_stance',
  'bear_form',
  'cat_form',
  'barkskin',
  'rockbiter_weapon',
  'demon_skin',
]);
const TARGET_DEBUFF_ABILITIES = new Set(['demoralizing_roar', 'faerie_fire']);
const FIVE_COMBO_FINISHERS = new Set(['eviscerate', 'rip', 'rupture', 'ferocious_bite']);

function auraActive(entity: Entity, id: string, sourceId?: number): boolean {
  return entity.auras.some(
    (a) => a.id === id && (sourceId === undefined || a.sourceId === sourceId) && a.remaining > 0.2,
  );
}

function sunderStacks(target: Entity): number {
  return target.auras.find((a) => a.kind === 'sunder')?.stacks ?? 0;
}

function shouldTryAbility(caster: Entity, target: Entity, ability: string): boolean {
  if (DOT_ABILITIES.has(ability) && auraActive(target, ability, caster.id)) return false;
  if (SELF_BUFF_ABILITIES.has(ability) && auraActive(caster, ability)) return false;
  if (TARGET_DEBUFF_ABILITIES.has(ability) && auraActive(target, ability, caster.id)) return false;
  if (ability === 'demoralizing_roar' && auraActive(target, 'demoralizing_roar_ap', caster.id))
    return false;
  if (FIVE_COMBO_FINISHERS.has(ability) && caster.comboPoints < 5) return false;
  if ((ability === 'growl' || ability === 'taunt') && target.aggroTargetId === caster.id)
    return false;
  if ((ability === 'maul' || ability === 'heroic_strike') && caster.queuedOnSwing === ability)
    return false;
  if (ability === 'sunder_armor' && sunderStacks(target) >= 5) return false;
  if (
    ability === 'judgement' &&
    !caster.auras.some((a) => a.kind === 'imbue' && a.value2 !== undefined)
  )
    return false;
  return true;
}

function plannedAbilityReady(sim: Sim, caster: Entity, target: Entity, spec: Spec): boolean {
  const known = sim.meta(caster.id)?.known ?? [];
  return spec.rotation.some((ability) => {
    if (!shouldTryAbility(caster, target, ability)) return false;
    const entry = known.find((candidate) => candidate.def.id === ability);
    if (!entry) return false;
    return caster.resource >= entry.cost && !caster.cooldowns.has(ability);
  });
}

function shouldRangedAutoFallback(sim: Sim, caster: Entity, target: Entity, spec: Spec): boolean {
  return (
    !spec.melee &&
    (spec.cls === 'mage' || spec.cls === 'priest' || spec.cls === 'warlock') &&
    !plannedAbilityReady(sim, caster, target, spec)
  );
}

function setupHunterPet(sim: Sim, pid: number) {
  const hunter = sim.entities.get(pid)!;
  const beast = [...sim.entities.values()].find(
    (e) => e.kind === 'mob' && e.templateId === 'forest_wolf' && e.ownerId === null && !e.dead,
  );
  if (!beast) return;
  teleport(sim, pid, beast.pos.x + 5, beast.pos.z);
  sim.targetEntity(beast.id, pid);
  face(hunter, beast);
  sim.castAbility('tame_beast', pid);
  for (let i = 0; i < 20 * 7; i++) sim.tick();
}

function setupWarlockImp(sim: Sim, pid: number) {
  if (sim.petOf(pid)) return;
  sim.castAbility('summon_imp', pid);
  for (let i = 0; i < 20 * 12 && sim.entities.get(pid)?.castingAbility; i++) sim.tick();
}

type Result = {
  key: string;
  killed: boolean;
  seconds: number;
  bossHp: number;
  deaths: number;
  firstHealerOom?: number;
  deathlessFailures: number;
  breakReason: string;
  tankSwaps: {
    time: number;
    from: string;
    to: string;
    reason: string;
  }[];
  deathLog: {
    time: number;
    spec: string;
    ability: string | null;
    amount: number;
    source: string;
  }[];
  mechanics: {
    soulRendCasts: number;
    soulRendTargets: Record<string, number>;
    soulRendDeaths: number;
    soulRendDamage: number;
    deathlessCasts: number;
    deathlessInterrupted: number;
    deathlessFailed: number;
    deathlessDamage: number;
    gravebreakerDamage: number;
    addDeaths: number;
    addLooseTicks: number;
    addLooseEvents: number;
  };
  actors: Record<
    string,
    {
      spec: string;
      role: Role;
      cls: PlayerClass;
      playerId: number;
      resourceType: Entity['resourceType'];
      maxHp: number;
      maxResource: number;
      startResource: number;
      finalHp: number;
      finalResource: number;
      dead: boolean;
      deathTime?: number;
      damageDone: number;
      dps: number;
      healingDone: number;
      hps: number;
      damageTaken: number;
      healingTaken: number;
      castsStarted: Record<string, number>;
      attemptedCasts: Record<string, number>;
      damageDoneByAbility: Record<string, number>;
      damageTakenByAbility: Record<string, number>;
      healingDoneByAbility: Record<string, number>;
      healingTakenByAbility: Record<string, number>;
      firstOom?: number;
      oomSeconds: number;
      minResource: number;
      resourceSamples: { time: number; value: number; resourceType: Entity['resourceType'] }[];
      resourceTransitions: {
        time: number;
        from: Entity['resourceType'];
        to: Entity['resourceType'];
        value: number;
      }[];
      hpSamples: { time: number; value: number }[];
    }
  >;
  boss: {
    hpStart: number;
    hpEnd: number;
    hpPctEnd: number;
    phase2Time?: number;
    hpSamples: { time: number; value: number; pct: number }[];
    targetTimeline: { time: number; target: string | null }[];
    threatSnapshots: { time: number; top: { spec: string; threat: number }[] }[];
  };
  combatLog: {
    time: number;
    type: string;
    source?: string;
    target?: string;
    ability?: string | null;
    amount?: number;
    detail?: string;
  }[];
  dps: Record<string, number>;
  healing: Record<string, number>;
  healerMana: Record<string, number>;
  petDeaths: number;
};

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function addRecordValue(
  record: Record<string, number>,
  key: string | null | undefined,
  amount: number,
): void {
  const normalized = key ?? 'melee';
  record[normalized] = (record[normalized] ?? 0) + amount;
}

function threatLeadFor(add: Entity, tankPid: number): number {
  const tankThreat = add.threat.get(tankPid) ?? 0;
  let nextThreat = 0;
  for (const [pid, threat] of add.threat.entries()) {
    if (pid !== tankPid) nextThreat = Math.max(nextThreat, threat);
  }
  return tankThreat - nextThreat;
}

function secureAddThreat(add: Entity, tankPid: number, lead: number): void {
  const nextThreat = Math.max(
    0,
    ...[...add.threat.entries()].filter(([pid]) => pid !== tankPid).map(([, threat]) => threat),
  );
  const currentThreat = add.threat.get(tankPid) ?? 0;
  if (add.aggroTargetId !== tankPid || currentThreat - nextThreat < lead) {
    add.threat.set(tankPid, Math.max(currentThreat, nextThreat + lead));
    add.aggroTargetId = tankPid;
  }
}

function runGroup(groupSpecs: Spec[], key: string): Result {
  const sim = new Sim({ seed: 42, noPlayer: true, playerClass: 'warrior' });
  const pids = groupSpecs.map((spec, i) => sim.addPlayer(spec.cls, `${spec.key}_${i}`));
  for (let i = 0; i < pids.length; i++) {
    sim.players.get(pids[i])?.questsDone.add('q_nythraxis_bound_guardian');
    sim.setPlayerLevel(20, pids[i]);
    ensureTalents(sim, pids[i], groupSpecs[i]);
    equipBest(sim, pids[i], groupSpecs[i]);
  }
  for (let i = 0; i < pids.length; i++) {
    if (groupSpecs[i].cls === 'hunter') setupHunterPet(sim, pids[i]);
    if (groupSpecs[i].cls === 'warlock') setupWarlockImp(sim, pids[i]);
  }
  for (const pid of pids.slice(1)) {
    sim.partyInvite(pid, pids[0]);
    sim.partyAccept(pid);
  }
  sim.convertPartyToRaid(pids[0]);
  sim.enterDungeon('nythraxis_boss_arena', pids[0]);
  const leader = sim.entities.get(pids[0])!;
  const origin = instanceOrigin(
    DUNGEONS.nythraxis_boss_arena.index,
    sim.instanceSlotAt(leader.pos)!,
  );
  const boss = [...sim.entities.values()].find(
    (e) => e.kind === 'mob' && e.templateId === 'nythraxis_scourge_of_thornpeak' && !e.dead,
  )!;
  const actorSpecs = new Map(pids.map((pid, i) => [pid, groupSpecs[i]]));
  const actorMetrics = new Map<number, Result['actors'][string]>();
  for (let i = 0; i < pids.length; i++) {
    const pos = positionFor(groupSpecs[i], boss, i);
    teleport(sim, pids[i], pos.x, pos.z);
    sim.entities.get(pids[i])!.targetId = boss.id;
    face(sim.entities.get(pids[i])!, boss);
    if (groupSpecs[i].key === 'feral_druid_tank') {
      cast(sim, pids[i], boss.id, 'bear_form');
      cast(sim, pids[i], boss.id, 'enrage');
      cast(sim, pids[i], boss.id, 'bear_charge');
    }
    if (groupSpecs[i].key === 'feral_druid') cast(sim, pids[i], boss.id, 'cat_form');
    if (groupSpecs[i].key === 'protection_warrior') cast(sim, pids[i], boss.id, 'defensive_stance');
    for (const ability of groupSpecs[i].prepull ?? []) cast(sim, pids[i], boss.id, ability);
    sim.startAutoAttack(pids[i]);
    const pet = sim.petOf(pids[i]);
    if (pet) {
      pet.pos = { ...sim.entities.get(pids[i])?.pos };
      pet.prevPos = { ...pet.pos };
      pet.aggroTargetId = boss.id;
      pet.inCombat = true;
    }
    const e = sim.entities.get(pids[i])!;
    actorMetrics.set(pids[i], {
      spec: groupSpecs[i].key,
      role: groupSpecs[i].role,
      cls: groupSpecs[i].cls,
      playerId: pids[i],
      resourceType: e.resourceType,
      maxHp: e.maxHp,
      maxResource: e.maxResource,
      startResource: e.resource,
      finalHp: e.hp,
      finalResource: e.resource,
      dead: false,
      damageDone: 0,
      dps: 0,
      healingDone: 0,
      hps: 0,
      damageTaken: 0,
      healingTaken: 0,
      castsStarted: {},
      attemptedCasts: {},
      damageDoneByAbility: {},
      damageTakenByAbility: {},
      healingDoneByAbility: {},
      healingTakenByAbility: {},
      oomSeconds: 0,
      minResource: e.resource,
      resourceSamples: [],
      resourceTransitions: [],
      hpSamples: [],
    });
  }
  boss.inCombat = true;
  boss.aiState = 'attack';
  boss.aggroTargetId = pids[0];
  boss.threat.set(pids[0], 1000);

  const healerPids = pids.filter((_, i) => groupSpecs[i].role === 'healer');
  const tankCandidatePids = pids.filter((_, i) => groupSpecs[i].kind === 'tank');
  let activeBossTankPid = pids[0];
  let previousBossTargetId: number | null = boss.aggroTargetId;
  const damage = new Map<number, number>();
  const healing = new Map<number, number>();
  let firstHealerOom: number | undefined;
  let deathlessFailures = 0;
  let petDeaths = 0;
  const seenDeadPets = new Set<number>();
  const lastIncoming = new Map<
    number,
    { time: number; ability: string | null; amount: number; source: string }
  >();
  const deathLog: Result['deathLog'] = [];
  const tankSwaps: Result['tankSwaps'] = [];
  const combatLog: Result['combatLog'] = [];
  const mechanics: Result['mechanics'] = {
    soulRendCasts: 0,
    soulRendTargets: {},
    soulRendDeaths: 0,
    soulRendDamage: 0,
    deathlessCasts: 0,
    deathlessInterrupted: 0,
    deathlessFailed: 0,
    deathlessDamage: 0,
    gravebreakerDamage: 0,
    addDeaths: 0,
    addLooseTicks: 0,
    addLooseEvents: 0,
  };
  const bossMetrics: Result['boss'] = {
    hpStart: boss.maxHp,
    hpEnd: boss.hp,
    hpPctEnd: boss.hp / boss.maxHp,
    hpSamples: [{ time: 0, value: Math.round(boss.hp), pct: round1((boss.hp / boss.maxHp) * 100) }],
    targetTimeline: [{ time: 0, target: groupSpecs[0].key }],
    threatSnapshots: [],
  };
  let previousPhase = boss.nythraxis?.phase ?? 'phase1';
  let previousDeathlessRemaining = boss.nythraxis?.deathlessCastRemaining ?? 0;
  let previousDeathlessFailureHits = 0;
  let lastSoulRendAuraTime = -999;
  let breakReason = 'timeout';
  const describeEntity = (id: number): string => {
    const entity = sim.entities.get(id);
    const ownerSpec =
      entity?.ownerId !== undefined && entity.ownerId !== null
        ? actorSpecs.get(entity.ownerId)?.key
        : undefined;
    return ownerSpec
      ? `${ownerSpec}_pet`
      : (actorSpecs.get(id)?.key ?? entity?.templateId ?? entity?.name ?? String(id));
  };

  for (let tick = 0; tick < 20 * 950 && !boss.dead; tick++) {
    const t = (sim as unknown as { time: number }).time;
    if (tick % (20 * 5) === 0) {
      for (const pid of pids) {
        const e = sim.entities.get(pid)!;
        const metric = actorMetrics.get(pid)!;
        metric.resourceSamples.push({
          time: round1(t),
          value: Math.round(e.resource),
          resourceType: e.resourceType,
        });
        metric.hpSamples.push({ time: round1(t), value: Math.round(e.hp) });
      }
      if (tick > 0) {
        bossMetrics.hpSamples.push({
          time: round1(t),
          value: Math.round(boss.hp),
          pct: round1((boss.hp / boss.maxHp) * 100),
        });
      }
    }
    for (const pid of pids) {
      const e = sim.entities.get(pid)!;
      const metric = actorMetrics.get(pid)!;
      metric.minResource = Math.min(metric.minResource, e.resource);
      if (!e.dead && e.resourceType === 'mana' && e.maxResource > 0 && e.resource <= 0) {
        metric.oomSeconds += 0.05;
        if (metric.firstOom === undefined) {
          metric.firstOom = t;
          combatLog.push({
            time: round1(t),
            type: 'oom',
            source: actorSpecs.get(pid)?.key,
            detail: 'mana_empty',
          });
        }
      }
    }
    const activeTank = sim.entities.get(activeBossTankPid);
    if (!activeTank || activeTank.dead) {
      const replacementPid = tankCandidatePids.find(
        (pid) => pid !== activeBossTankPid && !sim.entities.get(pid)?.dead,
      );
      if (replacementPid === undefined) {
        breakReason = 'no_tank_alive';
        break;
      }
      const oldSpec = actorSpecs.get(activeBossTankPid)?.key ?? String(activeBossTankPid);
      const replacementSpec = actorSpecs.get(replacementPid)?.key ?? String(replacementPid);
      activeBossTankPid = replacementPid;
      const topThreat = Math.max(0, ...[...boss.threat.values()]);
      boss.threat.set(replacementPid, topThreat + 10000);
      boss.aggroTargetId = replacementPid;
      tankSwaps.push({
        time: round1(t),
        from: oldSpec,
        to: replacementSpec,
        reason: 'main_tank_dead',
      });
      combatLog.push({
        time: round1(t),
        type: 'tank_swap',
        source: oldSpec,
        target: replacementSpec,
        detail: 'main_tank_dead',
      });
    }
    const adds = livingAdds(sim);
    const offTankPid = tankCandidatePids.find(
      (pid) => pid !== activeBossTankPid && !sim.entities.get(pid)?.dead,
    );
    let offTankFocusAdd: Entity | undefined;
    if (offTankPid !== undefined) {
      const offTank = sim.entities.get(offTankPid)!;
      const looseAdd = adds.find((add) => add.aggroTargetId !== offTank.id);
      offTankFocusAdd =
        looseAdd ??
        [...adds].sort((a, b) => threatLeadFor(a, offTank.id) - threatLeadFor(b, offTank.id))[0];
      for (const add of adds) {
        secureAddThreat(add, offTank.id, add === offTankFocusAdd ? 2500 : 1500);
      }
      if (offTankFocusAdd) {
        if (dist2d(offTank.pos, offTankFocusAdd.pos) > 5)
          teleport(sim, offTankPid, offTankFocusAdd.pos.x, offTankFocusAdd.pos.z - 3);
        offTank.targetId = offTankFocusAdd.id;
        face(offTank, offTankFocusAdd);
        sim.startAutoAttack(offTankPid);
      }
    }

    if (boss.nythraxis?.soulRendMarks.length) {
      const stack = { x: origin.x - 12, z: origin.z + 72 };
      for (const mark of boss.nythraxis.soulRendMarks) {
        const e = sim.entities.get(mark.playerId);
        if (e && !e.dead) teleport(sim, e.id, stack.x, stack.z);
      }
    }
    if (boss.nythraxis?.deathlessCastRemaining && boss.nythraxis.deathlessCastRemaining > 0) {
      const wards = [...sim.entities.values()]
        .filter(
          (e) =>
            e.kind === 'object' &&
            e.objectItemId === 'bastion_ward_stone' &&
            dist2d(e.pos, boss.spawnPos) < 140,
        )
        .sort((a, b) => a.id - b.id);
      const livingHealers = healerPids.filter((pid) => !sim.entities.get(pid)?.dead);
      const livingDps = pids.filter(
        (pid, i) => !sim.entities.get(pid)?.dead && groupSpecs[i].role === 'dps',
      );
      for (const { obj, pid } of [
        ...wards.map((obj, i) => ({ obj, pid: livingHealers[i] ?? livingDps[i] })),
      ]) {
        if (pid === undefined) continue;
        const p = sim.entities.get(pid)!;
        teleport(sim, pid, obj.pos.x, obj.pos.z);
        if (p.castingAbility !== 'nythraxis_ward_channel') {
          p.castingAbility = null;
          p.channeling = false;
          p.castRemaining = 0;
          p.castTotal = 0;
        }
        sim.pickUpObject(obj.id, pid);
      }
    }

    const liveFriendlies = pids.map((pid) => sim.entities.get(pid)!).filter((p) => !p.dead);
    for (const pid of pids) {
      const pet = sim.petOf(pid, true);
      if (pet?.dead && !seenDeadPets.has(pet.id)) {
        seenDeadPets.add(pet.id);
        petDeaths++;
      }
    }
    const lowest = liveFriendlies.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    for (const hpid of healerPids) {
      const h = sim.entities.get(hpid)!;
      if (h.dead || h.castingAbility === 'nythraxis_ward_channel') continue;
      const spec = groupSpecs[pids.indexOf(hpid)];
      const target =
        lowest && lowest.hp / lowest.maxHp < 0.9 ? lowest : sim.entities.get(activeBossTankPid)!;
      if (target && target.hp < target.maxHp * 0.96) {
        for (const heal of spec.healRotation ?? []) {
          const metric = actorMetrics.get(hpid)!;
          metric.attemptedCasts[heal] = (metric.attemptedCasts[heal] ?? 0) + 1;
          if (cast(sim, hpid, target.id, heal)) break;
        }
      }
    }

    for (let i = 0; i < pids.length; i++) {
      const spec = groupSpecs[i];
      const pid = pids[i];
      const p = sim.entities.get(pid)!;
      if (p.dead || p.castingAbility || spec.role === 'healer') continue;
      const target =
        pid === activeBossTankPid
          ? boss
          : pid === offTankPid
            ? (offTankFocusAdd ?? adds[0] ?? boss)
            : !spec.melee
              ? (offTankFocusAdd ?? adds[0] ?? boss)
              : boss;
      if (target.dead) continue;
      if (spec.melee && dist2d(p.pos, target.pos) > MELEE_RANGE - 0.2)
        teleport(sim, pid, target.pos.x, target.pos.z - 3);
      p.targetId = target.id;
      face(p, target);
      sim.startAutoAttack(pid);
      const pet = sim.petOf(pid);
      if (pet && target !== boss) {
        pet.aggroTargetId = target.id;
        pet.targetId = target.id;
      }
      if (shouldRangedAutoFallback(sim, p, target, spec)) continue;
      if (
        spec.key === 'feral_druid_tank' &&
        target.aggroTargetId !== p.id &&
        shouldTryAbility(p, target, 'growl')
      ) {
        const metric = actorMetrics.get(pid)!;
        metric.attemptedCasts.growl = (metric.attemptedCasts.growl ?? 0) + 1;
        if (cast(sim, pid, target.id, 'growl')) continue;
      }
      for (const ability of spec.rotation) {
        if (!shouldTryAbility(p, target, ability)) continue;
        const metric = actorMetrics.get(pid)!;
        metric.attemptedCasts[ability] = (metric.attemptedCasts[ability] ?? 0) + 1;
        if (cast(sim, pid, target.id, ability)) break;
      }
    }

    const events = sim.tick();
    for (const event of events) {
      if (event.type === 'damage' && event.targetId === boss.id && event.kind === 'hit') {
        const source = sim.entities.get(event.sourceId);
        const creditId = source?.ownerId ?? event.sourceId;
        damage.set(creditId, (damage.get(creditId) ?? 0) + event.amount);
        const metric = actorMetrics.get(creditId);
        if (metric) {
          metric.damageDone += event.amount;
          addRecordValue(metric.damageDoneByAbility, event.ability, event.amount);
        }
        combatLog.push({
          time: round1(t),
          type: 'damage_boss',
          source: describeEntity(event.sourceId),
          target: 'nythraxis',
          ability: event.ability ?? 'melee',
          amount: Math.round(event.amount),
        });
      }
      if (event.type === 'damage' && event.kind === 'hit' && pids.includes(event.targetId)) {
        const source = sim.entities.get(event.sourceId);
        const targetMetric = actorMetrics.get(event.targetId);
        if (targetMetric) {
          targetMetric.damageTaken += event.amount;
          addRecordValue(targetMetric.damageTakenByAbility, event.ability, event.amount);
        }
        if (event.ability === 'Soul Rend') {
          mechanics.soulRendDamage += event.amount;
        } else if (event.ability === 'Deathless Rage') {
          mechanics.deathlessDamage += event.amount;
        } else if (event.ability === 'Gravebreaker') {
          mechanics.gravebreakerDamage += event.amount;
        }
        lastIncoming.set(event.targetId, {
          time: t,
          ability: event.ability,
          amount: event.amount,
          source: source?.templateId ?? source?.name ?? String(event.sourceId),
        });
        combatLog.push({
          time: round1(t),
          type: 'damage_player',
          source: describeEntity(event.sourceId),
          target: describeEntity(event.targetId),
          ability: event.ability ?? 'melee',
          amount: Math.round(event.amount),
        });
      }
      if (event.type === 'heal2') {
        healing.set(event.sourceId, (healing.get(event.sourceId) ?? 0) + event.amount);
        const sourceMetric = actorMetrics.get(event.sourceId);
        if (sourceMetric) {
          sourceMetric.healingDone += event.amount;
          addRecordValue(sourceMetric.healingDoneByAbility, event.ability, event.amount);
        }
        const targetMetric = actorMetrics.get(event.targetId);
        if (targetMetric) {
          targetMetric.healingTaken += event.amount;
          addRecordValue(targetMetric.healingTakenByAbility, event.ability, event.amount);
        }
        combatLog.push({
          time: round1(t),
          type: 'heal',
          source: describeEntity(event.sourceId),
          target: describeEntity(event.targetId),
          ability: event.ability,
          amount: Math.round(event.amount),
        });
      }
      if (event.type === 'castStart' && pids.includes(event.entityId)) {
        const metric = actorMetrics.get(event.entityId)!;
        metric.castsStarted[event.ability] = (metric.castsStarted[event.ability] ?? 0) + 1;
        combatLog.push({
          time: round1(t),
          type: 'cast_start',
          source: describeEntity(event.entityId),
          ability: event.ability,
        });
      }
      if (event.type === 'aura' && event.name === 'Soul Rend' && event.gained) {
        if (t - lastSoulRendAuraTime > 0.2) {
          mechanics.soulRendCasts += 1;
          lastSoulRendAuraTime = t;
          combatLog.push({
            time: round1(t),
            type: 'soul_rend_cast',
            source: 'nythraxis',
            ability: 'Soul Rend',
          });
        }
        const spec = actorSpecs.get(event.targetId)?.key;
        if (spec) {
          mechanics.soulRendTargets[spec] = (mechanics.soulRendTargets[spec] ?? 0) + 1;
          combatLog.push({
            time: round1(t),
            type: 'soul_rend_mark',
            source: 'nythraxis',
            target: spec,
            ability: 'Soul Rend',
          });
        }
      }
      if (event.type === 'aura' && event.name === 'Deathless Rage Interrupted' && event.gained) {
        mechanics.deathlessInterrupted += 1;
        combatLog.push({
          time: round1(t),
          type: 'deathless_interrupted',
          source: describeEntity(event.targetId),
          ability: 'Deathless Rage Interrupted',
        });
      }
      if (event.type === 'damage' && event.ability === 'Deathless Rage' && event.kind === 'hit')
        deathlessFailures += 1;
      if (event.type === 'death' && pids.includes(event.entityId)) {
        const spec = groupSpecs[pids.indexOf(event.entityId)];
        const last = lastIncoming.get(event.entityId);
        const killer = sim.entities.get(event.killerId);
        const metric = actorMetrics.get(event.entityId)!;
        metric.dead = true;
        metric.deathTime = round1(t);
        if (last?.ability === 'Soul Rend') mechanics.soulRendDeaths += 1;
        deathLog.push({
          time: Math.round(t * 10) / 10,
          spec: spec.key,
          ability: last?.ability ?? null,
          amount: last?.amount ?? 0,
          source: last?.source ?? killer?.templateId ?? killer?.name ?? String(event.killerId),
        });
        combatLog.push({
          time: round1(t),
          type: 'player_death',
          source: last?.source ?? describeEntity(event.killerId),
          target: spec.key,
          ability: last?.ability ?? null,
          amount: Math.round(last?.amount ?? 0),
        });
      }
      if (event.type === 'death') {
        const dead = sim.entities.get(event.entityId);
        if (dead?.templateId === 'nythraxis_skeleton_warrior') {
          mechanics.addDeaths += 1;
          combatLog.push({
            time: round1(t),
            type: 'add_death',
            target: 'nythraxis_skeleton_warrior',
          });
        }
      }
    }
    const liveOffTankAfterTick =
      offTankPid !== undefined ? sim.entities.get(offTankPid) : undefined;
    if (liveOffTankAfterTick && !liveOffTankAfterTick.dead) {
      for (const add of livingAdds(sim))
        secureAddThreat(add, liveOffTankAfterTick.id, add.id === offTankFocusAdd?.id ? 2500 : 1500);
    }
    const currentPhase = boss.nythraxis?.phase ?? previousPhase;
    if (previousPhase !== 'phase2' && currentPhase === 'phase2') {
      bossMetrics.phase2Time = round1(t);
      combatLog.push({
        time: round1(t),
        type: 'phase_change',
        source: 'nythraxis',
        detail: 'phase2',
      });
    }
    previousPhase = currentPhase;
    const deathlessRemaining = boss.nythraxis?.deathlessCastRemaining ?? 0;
    if (previousDeathlessRemaining <= 0 && deathlessRemaining > 0) {
      mechanics.deathlessCasts += 1;
      combatLog.push({
        time: round1(t),
        type: 'deathless_cast_start',
        source: 'nythraxis',
        ability: 'Deathless Rage',
      });
    }
    if (previousDeathlessRemaining > 0 && deathlessRemaining <= 0) {
      if (deathlessFailures > previousDeathlessFailureHits) {
        mechanics.deathlessFailed += 1;
        combatLog.push({
          time: round1(t),
          type: 'deathless_failed',
          source: 'nythraxis',
          ability: 'Deathless Rage',
        });
      }
      previousDeathlessFailureHits = deathlessFailures;
    }
    previousDeathlessRemaining = deathlessRemaining;
    if (boss.aggroTargetId !== previousBossTargetId) {
      previousBossTargetId = boss.aggroTargetId;
      bossMetrics.targetTimeline.push({
        time: round1(t),
        target:
          boss.aggroTargetId === null
            ? null
            : (actorSpecs.get(boss.aggroTargetId)?.key ??
              sim.entities.get(boss.aggroTargetId)?.name ??
              String(boss.aggroTargetId)),
      });
      combatLog.push({
        time: round1(t),
        type: 'boss_target_change',
        source: 'nythraxis',
        target: boss.aggroTargetId === null ? null : describeEntity(boss.aggroTargetId),
      });
    }
    for (const pid of pids) {
      const e = sim.entities.get(pid)!;
      const metric = actorMetrics.get(pid)!;
      if (e.resourceType !== metric.resourceType) {
        metric.resourceTransitions.push({
          time: round1(t),
          from: metric.resourceType,
          to: e.resourceType,
          value: Math.round(e.resource),
        });
        combatLog.push({
          time: round1(t),
          type: 'resource_transition',
          source: actorSpecs.get(pid)?.key,
          detail: `${metric.resourceType}->${e.resourceType}`,
        });
        metric.resourceType = e.resourceType;
        metric.maxResource = e.maxResource;
        if (metric.startResource === 0 || metric.resourceTransitions.length === 1)
          metric.startResource = e.resource;
      }
    }
    if (tick % (20 * 10) === 0) {
      const top = [...boss.threat.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([pid, threat]) => ({
          spec: actorSpecs.get(pid)?.key ?? sim.entities.get(pid)?.name ?? String(pid),
          threat: Math.round(threat),
        }));
      bossMetrics.threatSnapshots.push({ time: round1(t), top });
    }
    if (
      tick % 20 === 0 &&
      offTankPid !== undefined &&
      liveOffTankAfterTick &&
      !liveOffTankAfterTick.dead
    ) {
      const looseAdds = livingAdds(sim).filter((add) => add.aggroTargetId !== offTankPid);
      if (looseAdds.length > 0) {
        mechanics.addLooseTicks += looseAdds.length;
        mechanics.addLooseEvents += 1;
        combatLog.push({
          time: round1(t),
          type: 'loose_add',
          target: looseAdds.map((add) => describeEntity(add.id)).join(','),
          detail: `count=${looseAdds.length}`,
        });
      }
    }
    const healerMana = healerPids
      .map((pid) => sim.entities.get(pid)!)
      .filter((e) => !e.dead)
      .map((e) => e.resource);
    if (firstHealerOom === undefined && healerMana.some((m) => m <= 0)) firstHealerOom = t;
    if (pids.filter((pid) => !sim.entities.get(pid)?.dead).length < 4) {
      breakReason = 'fewer_than_4_players_alive';
      break;
    }
  }

  const seconds = (sim as unknown as { time: number }).time;
  if (boss.dead) breakReason = 'boss_killed';
  bossMetrics.hpEnd = boss.hp;
  bossMetrics.hpPctEnd = boss.hp / boss.maxHp;
  const dps: Record<string, number> = {};
  const healingBySpec: Record<string, number> = {};
  const healerMana: Record<string, number> = {};
  const actors: Result['actors'] = {};
  for (let i = 0; i < pids.length; i++) {
    const keyName = groupSpecs[i].key;
    const e = sim.entities.get(pids[i])!;
    const metric = actorMetrics.get(pids[i])!;
    metric.finalHp = e.hp;
    metric.finalResource = e.resource;
    metric.dead = e.dead;
    metric.dps = metric.damageDone / seconds;
    metric.hps = metric.healingDone / seconds;
    metric.oomSeconds = round1(metric.oomSeconds);
    metric.minResource = Math.round(metric.minResource);
    actors[keyName] = {
      ...metric,
      finalHp: Math.round(metric.finalHp),
      finalResource: Math.round(metric.finalResource),
      damageDone: Math.round(metric.damageDone),
      dps: round1(metric.dps),
      healingDone: Math.round(metric.healingDone),
      hps: round1(metric.hps),
      damageTaken: Math.round(metric.damageTaken),
      healingTaken: Math.round(metric.healingTaken),
    };
    dps[keyName] = (dps[keyName] ?? 0) + (damage.get(pids[i]) ?? 0);
    healingBySpec[keyName] = (healingBySpec[keyName] ?? 0) + (healing.get(pids[i]) ?? 0);
    if (groupSpecs[i].role === 'healer') {
      healerMana[keyName] = Math.round(e.resource);
    }
  }
  return {
    key,
    killed: boss.dead,
    seconds,
    bossHp: boss.hp,
    deaths: pids.filter((pid) => sim.entities.get(pid)?.dead).length,
    firstHealerOom,
    deathlessFailures,
    breakReason,
    tankSwaps,
    deathLog,
    mechanics,
    actors,
    boss: {
      ...bossMetrics,
      hpEnd: Math.round(bossMetrics.hpEnd),
      hpPctEnd: round1(bossMetrics.hpPctEnd * 100),
    },
    combatLog,
    dps,
    healing: healingBySpec,
    healerMana,
    petDeaths,
  };
}

const healerCombos = combos(healers, 3);
const dpsCombos = combos(dpsSpecs, 5);
const tankPlans = tanks.map((tank) => {
  const offTank =
    tank.key === 'protection_paladin' ? specs.protectionWarrior : specs.protectionPaladin;
  return { tank, offTank: { ...offTank, role: 'offTank' as Role } };
});

function planKey(plan: { tank: Spec; healerSet: Spec[]; dpsSet: Spec[] }): string {
  return `${plan.tank.key}|${plan.healerSet.map((s) => s.key).join('+')}|${plan.dpsSet.map((s) => s.key).join('+')}`;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const limit = Number(process.env.MATRIX_LIMIT ?? '96');
const plans: { tank: Spec; healerSet: Spec[]; dpsSet: Spec[] }[] = [];
for (const { tank } of tankPlans) {
  for (const healerSet of healerCombos) {
    for (const dpsSet of dpsCombos) plans.push({ tank, healerSet, dpsSet });
  }
}
const selected =
  plans.length <= limit
    ? plans
    : [...plans].sort((a, b) => hashString(planKey(a)) - hashString(planKey(b))).slice(0, limit);
const shardCount = Number(process.env.MATRIX_SHARD_COUNT ?? '1');
const shardIndex = Number(process.env.MATRIX_SHARD_INDEX ?? '0');
if (!Number.isInteger(shardCount) || shardCount < 1)
  throw new Error('MATRIX_SHARD_COUNT must be a positive integer');
if (!Number.isInteger(shardIndex) || shardIndex < 0 || shardIndex >= shardCount)
  throw new Error('MATRIX_SHARD_INDEX must be between 0 and MATRIX_SHARD_COUNT - 1');
const selectedForShard = selected.filter((_, index) => index % shardCount === shardIndex);
const attempted = plans.length;
const results: Result[] = [];
for (const { tank, healerSet, dpsSet } of selectedForShard) {
  const offTank = (
    tank.key === 'protection_paladin' ? specs.protectionWarrior : specs.protectionPaladin
  ) as Spec;
  const group = [tank, { ...offTank, role: 'offTank' as Role }, ...healerSet, ...dpsSet];
  results.push(runGroup(group, planKey({ tank, healerSet, dpsSet })));
}

const killed = results.filter((r) => r.killed);
const avgBy = (selector: (r: Result) => string, metric: (r: Result) => number) => {
  const rows = new Map<string, { n: number; v: number; kills: number }>();
  for (const r of results) {
    const k = selector(r);
    const row = rows.get(k) ?? { n: 0, v: 0, kills: 0 };
    row.n++;
    row.v += metric(r);
    if (r.killed) row.kills++;
    rows.set(k, row);
  }
  return [...rows.entries()]
    .map(([k, row]) => ({ key: k, n: row.n, killRate: row.kills / row.n, avg: row.v / row.n }))
    .sort((a, b) => b.killRate - a.killRate || a.avg - b.avg);
};

const specDamage = new Map<string, { n: number; damage: number }>();
const specDps = new Map<string, { n: number; dps: number }>();
const specHealing = new Map<string, { n: number; healing: number }>();
const specResources = new Map<
  string,
  {
    n: number;
    resourceType: Entity['resourceType'];
    startResource: number;
    finalResource: number;
    maxResource: number;
    oomCount: number;
    firstOomTotal: number;
    minFirstOom: number;
    maxFirstOom: number;
    oomSeconds: number;
    minResource: number;
  }
>();
const deathBySpec = new Map<
  string,
  {
    deaths: number;
    soulRend: number;
    deathless: number;
    melee: number;
    gravebreaker: number;
    other: number;
  }
>();
const wipeReasons = new Map<string, number>();
const tankSwapCounts = new Map<string, number>();
for (const r of results) {
  if (!r.killed) wipeReasons.set(r.breakReason, (wipeReasons.get(r.breakReason) ?? 0) + 1);
  for (const swap of r.tankSwaps) {
    const key = `${swap.from}->${swap.to}`;
    tankSwapCounts.set(key, (tankSwapCounts.get(key) ?? 0) + 1);
  }
  for (const actor of Object.values(r.actors)) {
    const row = specResources.get(actor.spec) ?? {
      n: 0,
      resourceType: actor.resourceType,
      startResource: 0,
      finalResource: 0,
      maxResource: 0,
      oomCount: 0,
      firstOomTotal: 0,
      minFirstOom: Infinity,
      maxFirstOom: 0,
      oomSeconds: 0,
      minResource: 0,
    };
    row.n++;
    row.startResource += actor.startResource;
    row.finalResource += actor.finalResource;
    row.maxResource += actor.maxResource;
    row.oomSeconds += actor.oomSeconds;
    row.minResource += actor.minResource;
    if (actor.firstOom !== undefined) {
      row.oomCount++;
      row.firstOomTotal += actor.firstOom;
      row.minFirstOom = Math.min(row.minFirstOom, actor.firstOom);
      row.maxFirstOom = Math.max(row.maxFirstOom, actor.firstOom);
    }
    specResources.set(actor.spec, row);
  }
  for (const death of r.deathLog) {
    const row = deathBySpec.get(death.spec) ?? {
      deaths: 0,
      soulRend: 0,
      deathless: 0,
      melee: 0,
      gravebreaker: 0,
      other: 0,
    };
    row.deaths++;
    if (death.ability === 'Soul Rend') row.soulRend++;
    else if (death.ability === 'Deathless Rage') row.deathless++;
    else if (death.ability === 'Gravebreaker') row.gravebreaker++;
    else if (death.ability === null) row.melee++;
    else row.other++;
    deathBySpec.set(death.spec, row);
  }
  for (const [k, v] of Object.entries(r.dps)) {
    const row = specDamage.get(k) ?? { n: 0, damage: 0 };
    row.n++;
    row.damage += v;
    specDamage.set(k, row);
    const dpsRow = specDps.get(k) ?? { n: 0, dps: 0 };
    dpsRow.n++;
    dpsRow.dps += v / r.seconds;
    specDps.set(k, dpsRow);
  }
  for (const [k, v] of Object.entries(r.healing)) {
    const row = specHealing.get(k) ?? { n: 0, healing: 0 };
    row.n++;
    row.healing += v;
    specHealing.set(k, row);
  }
}

const output = {
  attempted,
  selected: selected.length,
  shardIndex,
  shardCount,
  run: results.length,
  killed: killed.length,
  topKills: killed
    .sort((a, b) => a.seconds - b.seconds)
    .slice(0, 10)
    .map((r) => ({
      key: r.key,
      seconds: Math.round(r.seconds * 10) / 10,
      deaths: r.deaths,
      firstHealerOom: r.firstHealerOom,
      petDeaths: r.petDeaths,
    })),
  tankSummary: avgBy(
    (r) => r.key.split('|')[0],
    (r) => r.seconds,
  ),
  healerSummary: avgBy(
    (r) => r.key.split('|')[1],
    (r) => r.firstHealerOom ?? 999,
  ),
  specDps: [...specDps.entries()]
    .map(([key, row]) => ({ key, avgDps: Math.round((row.dps / row.n) * 10) / 10 }))
    .sort((a, b) => b.avgDps - a.avgDps),
  specDamage: [...specDamage.entries()]
    .map(([key, row]) => ({ key, avgDamage: Math.round(row.damage / row.n) }))
    .sort((a, b) => b.avgDamage - a.avgDamage),
  specHealing: [...specHealing.entries()]
    .map(([key, row]) => ({ key, avgHealing: Math.round(row.healing / row.n) }))
    .sort((a, b) => b.avgHealing - a.avgHealing),
  resourceSummary: [...specResources.entries()]
    .map(([key, row]) => ({
      key,
      n: row.n,
      resourceType: row.resourceType,
      avgStartResource: Math.round(row.startResource / row.n),
      avgFinalResource: Math.round(row.finalResource / row.n),
      avgMaxResource: Math.round(row.maxResource / row.n),
      oomRate: row.oomCount / row.n,
      avgFirstOom: row.oomCount > 0 ? round1(row.firstOomTotal / row.oomCount) : null,
      earliestOom: row.oomCount > 0 ? round1(row.minFirstOom) : null,
      latestOom: row.oomCount > 0 ? round1(row.maxFirstOom) : null,
      avgOomSeconds: round1(row.oomSeconds / row.n),
      avgMinResource: Math.round(row.minResource / row.n),
    }))
    .sort((a, b) => b.oomRate - a.oomRate || (a.avgFirstOom ?? 9999) - (b.avgFirstOom ?? 9999)),
  deathSummary: [...deathBySpec.entries()]
    .map(([key, row]) => ({ key, ...row }))
    .sort((a, b) => b.deaths - a.deaths),
  wipeReasonSummary: [...wipeReasons.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count),
  tankSwapSummary: [...tankSwapCounts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count),
  mechanicSummary: {
    soulRendCasts: results.reduce((sum, r) => sum + r.mechanics.soulRendCasts, 0),
    soulRendDeaths: results.reduce((sum, r) => sum + r.mechanics.soulRendDeaths, 0),
    deathlessCasts: results.reduce((sum, r) => sum + r.mechanics.deathlessCasts, 0),
    deathlessInterrupted: results.reduce((sum, r) => sum + r.mechanics.deathlessInterrupted, 0),
    deathlessFailed: results.reduce((sum, r) => sum + r.mechanics.deathlessFailed, 0),
    addDeaths: results.reduce((sum, r) => sum + r.mechanics.addDeaths, 0),
    addLooseTicks: results.reduce((sum, r) => sum + r.mechanics.addLooseTicks, 0),
    addLooseEvents: results.reduce((sum, r) => sum + r.mechanics.addLooseEvents, 0),
  },
  failures: results
    .filter((r) => !r.killed)
    .slice(0, 10)
    .map((r) => ({
      key: r.key,
      bossHp: r.bossHp,
      deaths: r.deaths,
      seconds: Math.round(r.seconds * 10) / 10,
      firstHealerOom: r.firstHealerOom,
      deathlessFailures: r.deathlessFailures,
      breakReason: r.breakReason,
      deathLog: r.deathLog,
    })),
  runs: results,
};

const outputPath =
  process.env.MATRIX_OUTPUT_PATH ??
  (shardCount > 1
    ? `tmp/nythraxis_matrix_shard_${shardIndex}_of_${shardCount}.json`
    : 'tmp/nythraxis_matrix_last.json');
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      outputPath,
      attempted: output.attempted,
      run: output.run,
      killed: output.killed,
      wipeReasonSummary: output.wipeReasonSummary,
      tankSwapSummary: output.tankSwapSummary,
      mechanicSummary: output.mechanicSummary,
      specDps: output.specDps,
      resourceSummary: output.resourceSummary,
      deathSummary: output.deathSummary,
    },
    null,
    2,
  ),
);
