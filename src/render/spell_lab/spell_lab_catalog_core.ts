// Pure catalog builder for the Spell & VFX Review Lab.
//
// Collects every class ability, spec signature, talent-row ability grant,
// action-replacement transform, and basic combat action across all 9 classes
// and 27 specializations, resolving each entry's live WOC animation clip
// (including weapon-loadout swaps) and AbilityVfxSpec metadata.
//
// Node-only (RENDER_PURE_CORES): no Three.js, no DOM, no i18n, deterministic.

import { ABILITIES, CLASSES } from '../../sim/content/classes';
import { ROW_TREES } from '../../sim/content/talent_rows';
import { type Role, TALENTS } from '../../sim/content/talents';
import {
  type AbilityDef,
  type ActionReplacementRule,
  ALL_CLASSES,
  type PlayerClass,
} from '../../sim/types';
import { abilityVfxFullSpec, abilityVfxSpec } from '../ability_vfx_registry';
import { VISUALS } from '../characters/manifest';
import { swappedClip, type WeaponLoadout, weaponLoadout } from '../characters/weapon_loadout_core';

export type SpellLabLoadoutPresetId =
  | 'default'
  | 'sword_shield'
  | 'mace_shield'
  | 'single_1h'
  | 'twohand_sword'
  | 'twohand_maul'
  | 'dual_daggers'
  | 'dual_swords'
  | 'staff'
  | 'wand_tome';

export interface SpellLabLoadoutPreset {
  id: SpellLabLoadoutPresetId;
  label: string;
  mainhandItemId: string | null;
  offhandItemId: string | null;
}

export const SPELL_LAB_LOADOUT_PRESETS: readonly SpellLabLoadoutPreset[] = [
  {
    id: 'default',
    label: 'Class Default',
    mainhandItemId: null,
    offhandItemId: null,
  },
  {
    id: 'sword_shield',
    label: '1H Sword + Shield',
    mainhandItemId: 'eastbrook_arming_sword',
    offhandItemId: 'eastbrook_buckler',
  },
  {
    id: 'mace_shield',
    label: '1H Mace + Shield',
    mainhandItemId: 'training_mace',
    offhandItemId: 'eastbrook_buckler',
  },
  {
    id: 'single_1h',
    label: 'Single 1H (Free Offhand)',
    mainhandItemId: 'eastbrook_arming_sword',
    offhandItemId: null,
  },
  {
    id: 'twohand_sword',
    label: '2H Greatsword',
    mainhandItemId: 'eastbrook_greatsword',
    offhandItemId: null,
  },
  {
    id: 'twohand_maul',
    label: '2H Maul',
    mainhandItemId: 'ironshod_maul',
    offhandItemId: null,
  },
  {
    id: 'dual_daggers',
    label: 'Dual Daggers',
    mainhandItemId: 'rusty_dagger',
    offhandItemId: 'rusty_dagger',
  },
  {
    id: 'dual_swords',
    label: 'Dual Swords',
    mainhandItemId: 'eastbrook_arming_sword',
    offhandItemId: 'eastbrook_arming_sword',
  },
  {
    id: 'staff',
    label: '2H Staff',
    mainhandItemId: 'gnarled_staff',
    offhandItemId: null,
  },
  {
    id: 'wand_tome',
    label: 'Wand + Grimoire',
    mainhandItemId: 'palecoil_rod',
    offhandItemId: 'silverleaf_primer',
  },
];

export const CLASS_ACCENT_HEX: Readonly<Record<PlayerClass, string>> = {
  warrior: '#c69b6d',
  paladin: '#f48cba',
  hunter: '#aad372',
  rogue: '#fff468',
  priest: '#f0ebe0',
  shaman: '#0070dd',
  mage: '#3fc7eb',
  warlock: '#8788ee',
  druid: '#ff7c0a',
};

export interface SpellLabSpecSummary {
  id: string;
  name: string;
  role: Role;
  signature: string;
  description: string;
}

export type SpellLabCategory = 'basic' | 'base' | 'spec' | 'talent';

export interface SpellLabEntry {
  id: string;
  name: string;
  description: string;
  cls: PlayerClass;
  kind: 'basic' | 'ability';
  category: SpellLabCategory;
  /** Spec IDs this ability is exclusive to or signature for (empty = shared across specs). */
  specIds: readonly string[];
  /** Specs that explicitly exclude this ability at max level (e.g. Heroic Strike for Prot). */
  excludeSpecs: readonly string[];
  isSpecSignature: boolean;
  talentRowLevel: number | null;
  talentName: string | null;
  transformedFromId: string | null;
  passive: boolean;
  cost: number;
  castTime: number;
  channeled: boolean;
  channelDuration: number;
  cooldown: number;
  range: number;
  minRange: number;
  school: string;
  requiresForm: 'bear' | 'cat' | null;
  requiresStealth: boolean;
  requiresShield: boolean;
  requiresExecute: boolean;
  /** Final WOC animation clip played on release/strike under the active weapon loadout. */
  resolvedClip: string;
  baseClip: string;
  /** Looping cast/channel preparation clip when castTime > 0 or channeled. */
  castLoopClip: string | null;
  /** Registered AbilityVfxSpec archetype (or fallback cue kind). */
  vfxArchetype: string;
  vfxSchool: string;
  vfxMotifs: readonly string[];
}

export interface ClassSpellCatalog {
  cls: PlayerClass;
  className: string;
  classColor: string;
  specs: readonly SpellLabSpecSummary[];
  loadoutPresetId: SpellLabLoadoutPresetId;
  mainhandItemId: string | null;
  offhandItemId: string | null;
  resolvedLoadout: WeaponLoadout | null;
  entries: readonly SpellLabEntry[];
}

export function resolveClassLoadoutItems(
  cls: PlayerClass,
  presetId: SpellLabLoadoutPresetId,
): {
  mainhandItemId: string | null;
  offhandItemId: string | null;
  resolvedLoadout: WeaponLoadout | null;
} {
  const cdef = CLASSES[cls];
  const vdef = VISUALS[`player_${cls}`];
  const preset =
    SPELL_LAB_LOADOUT_PRESETS.find((p) => p.id === presetId) ?? SPELL_LAB_LOADOUT_PRESETS[0];
  const mainhandItemId =
    preset.id === 'default' ? (cdef.startWeapon ?? null) : preset.mainhandItemId;
  const offhandItemId =
    preset.id === 'default' ? (cdef.startOffhand ?? null) : preset.offhandItemId;
  const showsMainhand = (vdef?.weaponSlots?.length ?? 0) > 0;
  const showsOffhand = Boolean(vdef?.offhandSlot);
  const fixedOffhand = cls === 'warlock';
  const resolvedLoadout = weaponLoadout({
    mainhandItemId,
    offhandItemId,
    stowed: false,
    showsMainhand,
    showsOffhand,
    fixedOffhand,
  });
  return { mainhandItemId, offhandItemId, resolvedLoadout };
}

function firstClipName(spec: string | readonly string[] | undefined, fallback: string): string {
  if (!spec) return fallback;
  if (typeof spec === 'string') return spec;
  return spec[0] ?? fallback;
}

function swapForLoadout(cls: PlayerClass, loadout: WeaponLoadout | null, clipName: string): string {
  const vdef = VISUALS[`player_${cls}`];
  const swapMap = loadout ? (vdef?.clips.loadoutSwaps?.[loadout] ?? null) : null;
  return swappedClip(swapMap, clipName, () => true) ?? clipName;
}

export function formatSpellLabDescription(def: AbilityDef): string {
  let damageText = 'moderate';
  let overTimeText = 'additional';
  let buffText = '10';
  let durationText = '8';

  for (const eff of def.effects) {
    if (
      'min' in eff &&
      'max' in eff &&
      typeof eff.min === 'number' &&
      typeof eff.max === 'number'
    ) {
      damageText = eff.min === eff.max ? `${eff.min}` : `${eff.min} to ${eff.max}`;
      break;
    }
    if ('bonus' in eff && typeof eff.bonus === 'number') {
      damageText = `${eff.bonus}`;
      break;
    }
    if ('amount' in eff && typeof eff.amount === 'number' && eff.amount > 0) {
      damageText = `${eff.amount}`;
      break;
    }
    if ('damage' in eff && typeof eff.damage === 'number') {
      damageText = `${eff.damage}`;
      break;
    }
    if ('baseDamage' in eff && typeof eff.baseDamage === 'number') {
      damageText = `${eff.baseDamage}`;
      break;
    }
    if ('maxHpPct' in eff && typeof eff.maxHpPct === 'number') {
      damageText = `${Math.round(eff.maxHpPct * 100)}`;
      break;
    }
    if (eff.type === 'sunder') {
      damageText = `${eff.armor}`;
      break;
    }
  }

  for (const eff of def.effects) {
    if (eff.type === 'dot' || eff.type === 'hot') {
      overTimeText = `${eff.total}`;
      if (damageText === 'moderate') damageText = `${eff.total}`;
      break;
    }
    if (eff.type === 'absorb') {
      const absVal =
        'maxHpFrac' in eff && typeof eff.maxHpFrac === 'number' && eff.maxHpFrac > 0
          ? Math.round(eff.maxHpFrac * 100)
          : eff.amount;
      if (damageText === 'moderate') damageText = `${absVal}`;
      if (buffText === '10') buffText = `${absVal}`;
    }
  }

  for (const eff of def.effects) {
    if (eff.type === 'druidOverbloom') {
      buffText = `${Math.round(eff.harvestPct * 100)}`;
      break;
    }
    if (eff.type === 'selfBuff' || eff.type === 'buffTarget') {
      const v = eff.kind === 'form_fireball' ? Math.round((eff.value - 1) * 100) : eff.value;
      buffText = `${v}`;
      if (damageText === 'moderate') damageText = `${v}`;
      break;
    }
    if (eff.type === 'aoeAttackPower') {
      const v = eff.pct != null ? Math.round(eff.pct * 100) : (eff.amount ?? 10);
      buffText = `${v}`;
      break;
    }
  }

  for (const eff of def.effects) {
    if (eff.type === 'extendDot') {
      durationText = `${eff.maxBonus}`;
      break;
    }
    if ('duration' in eff && typeof eff.duration === 'number') {
      durationText = `${eff.duration}`;
      break;
    }
  }

  return def.description
    .replace(/\$d/g, damageText)
    .replace(/\$o/g, overTimeText)
    .replace(/\$b/g, buffText)
    .replace(/\$t/g, durationText);
}

function resolveAbilityAnimationClips(
  cls: PlayerClass,
  def: AbilityDef,
  loadout: WeaponLoadout | null,
): { baseClip: string; resolvedClip: string; castLoopClip: string | null } {
  const vdef = VISUALS[`player_${cls}`];
  const clips = vdef?.clips;
  if (!clips) {
    return { baseClip: 'Woc_Attack_1H_0', resolvedClip: 'Woc_Attack_1H_0', castLoopClip: null };
  }

  const formReq = primaryFormRequirement(def);
  if (
    def.id === 'bear_form' ||
    def.id === 'bear_charge' ||
    formReq === 'bear' ||
    def.id === 'cat_form' ||
    formReq === 'cat'
  ) {
    return { baseClip: 'Attack', resolvedClip: 'Attack', castLoopClip: null };
  }
  if (def.id === 'travel_form') {
    return { baseClip: 'Run', resolvedClip: 'Run', castLoopClip: null };
  }

  const hasCastLoop = def.castTime > 0 || Boolean(def.channel) || Boolean(def.empowerStages);
  let rawLoop: string | null = null;
  if (hasCastLoop) {
    const byCast = clips.castByAbility?.[def.id];
    if (byCast) {
      rawLoop = firstClipName(byCast, 'Woc_Cast_Directed');
    } else if (def.channel) {
      rawLoop =
        cls === 'hunter'
          ? 'Woc_Attack_Rifle'
          : def.targetType === 'friendly' || def.selfCentered || !def.requiresTarget
            ? 'Woc_Cast_Omni'
            : 'Woc_Channel_Directed';
    } else if (def.targetType === 'friendly' || def.selfCentered || !def.requiresTarget) {
      rawLoop = 'Woc_Cast_Omni';
    } else {
      rawLoop = firstClipName(clips.cast ?? clips.idle, 'Woc_Cast_Directed');
    }
  }
  const castLoopClip = rawLoop ? swapForLoadout(cls, loadout, rawLoop) : null;

  const fullVfx = abilityVfxFullSpec(def.id);
  const isShout = def.castFx === 'shout' || fullVfx?.archetype === 'shout';
  const byAbility = clips.attackByAbility?.[def.id];
  let baseClip: string;
  if (byAbility) {
    baseClip = firstClipName(byAbility, 'Woc_Attack_1H_0');
  } else if (def.id === 'whirlwind' || def.id === 'bladestorm' || def.id === 'dawnfall') {
    baseClip = 'Woc_Special_1H';
  } else if (def.id === 'storm_bolt') {
    baseClip = 'Signature_storm_bolt';
  } else if (isShout) {
    baseClip = 'Woc_Shout';
  } else if (def.passive) {
    baseClip = firstClipName(clips.combatIdle ?? clips.idle, 'Woc_Combat_Idle_1H');
  } else if (def.channel) {
    baseClip = castLoopClip ?? 'Woc_Channel_Directed';
  } else if (cls === 'hunter' && def.range > 8 && def.targetType !== 'friendly') {
    baseClip = def.castTime > 0 ? 'Woc_Attack_Rifle#release' : 'Woc_Attack_Rifle';
  } else if (
    def.school === 'physical' &&
    def.targetType !== 'friendly' &&
    !def.selfCentered &&
    def.requiresTarget
  ) {
    baseClip = firstClipName(clips.meleeAttack ?? clips.attack, 'Woc_Attack_1H_0');
  } else if (
    def.targetType !== 'friendly' &&
    !def.selfCentered &&
    def.requiresTarget &&
    def.targetMode !== 'position' &&
    def.range > 6
  ) {
    baseClip = 'Woc_Cast_Shoot';
  } else {
    baseClip = 'Woc_Cast_Omni_Release';
  }
  const resolvedClip = swapForLoadout(cls, loadout, baseClip);
  return { baseClip, resolvedClip, castLoopClip };
}

function resolveAbilityVfxInfo(def: AbilityDef): {
  vfxArchetype: string;
  vfxSchool: string;
  vfxMotifs: readonly string[];
} {
  const full = abilityVfxFullSpec(def.id);
  const spec = abilityVfxSpec(def.id);
  if (full || spec) {
    return {
      vfxArchetype: full?.archetype ?? spec?.a ?? 'custom',
      vfxSchool: def.school,
      vfxMotifs: full?.motifs ?? [],
    };
  }
  if (def.id === 'final_edict') {
    return { vfxArchetype: 'paladinFinalEdict', vfxSchool: def.school, vfxMotifs: ['verdict'] };
  }
  if (def.id === 'dawnfall') {
    return { vfxArchetype: 'paladinDawnfall', vfxSchool: def.school, vfxMotifs: ['holy_storm'] };
  }
  if (def.id === 'bastion_sweep') {
    return {
      vfxArchetype: 'paladinBastionSweep',
      vfxSchool: def.school,
      vfxMotifs: ['shield_arc'],
    };
  }
  if (def.id === 'sunward_disc') {
    return {
      vfxArchetype: 'paladinSunwardDisc',
      vfxSchool: def.school,
      vfxMotifs: ['ricochet_shield'],
    };
  }
  if (def.id === 'holy_shock' || def.id === 'solar_invocation') {
    return { vfxArchetype: 'paladinHolyShock', vfxSchool: def.school, vfxMotifs: ['holy_beam'] };
  }
  if (def.id === 'divine_ascension') {
    return {
      vfxArchetype: 'paladinAscension',
      vfxSchool: def.school,
      vfxMotifs: ['ascension_wings'],
    };
  }
  if (def.castFx) {
    return {
      vfxArchetype: def.castFx,
      vfxSchool: def.school,
      vfxMotifs: [def.castFx],
    };
  }
  if (def.projectileFx) {
    return {
      vfxArchetype: def.projectileFx,
      vfxSchool: def.school,
      vfxMotifs: ['projectile', def.projectileFx],
    };
  }
  if (def.channel) {
    return {
      vfxArchetype: 'channel',
      vfxSchool: def.school,
      vfxMotifs: ['channel'],
    };
  }
  return {
    vfxArchetype: def.passive ? 'passive' : 'school_default',
    vfxSchool: def.school,
    vfxMotifs: [],
  };
}

function primaryFormRequirement(def: AbilityDef): 'bear' | 'cat' | null {
  if (!def.requiresForm) return null;
  if (Array.isArray(def.requiresForm)) {
    return def.requiresForm[0] ?? null;
  }
  return def.requiresForm as 'bear' | 'cat';
}

function replacementRules(def: AbilityDef): readonly ActionReplacementRule[] {
  if (!def.actionReplacement) return [];
  return Array.isArray(def.actionReplacement) ? def.actionReplacement : [def.actionReplacement];
}

function buildBasicEntries(cls: PlayerClass, loadout: WeaponLoadout | null): SpellLabEntry[] {
  const clips = VISUALS[`player_${cls}`]?.clips;
  const meleeBase = firstClipName(clips?.meleeAttack ?? clips?.attack, 'Woc_Attack_1H_0');
  const meleeResolved = swapForLoadout(cls, loadout, meleeBase);
  const combatIdleBase = firstClipName(clips?.combatIdle ?? clips?.idle, 'Woc_Combat_Idle_1H');
  const combatIdleResolved = swapForLoadout(cls, loadout, combatIdleBase);
  const hitBase = firstClipName(clips?.hit, 'Woc_Hit');
  const hitResolved = swapForLoadout(cls, loadout, hitBase);

  const out: SpellLabEntry[] = [
    {
      id: '__auto_melee',
      name: 'Melee Auto-Attack',
      description:
        'Standard melee weapon swing at close range using the active weapon loadout animation.',
      cls,
      kind: 'basic',
      category: 'basic',
      specIds: [],
      excludeSpecs: [],
      isSpecSignature: false,
      talentRowLevel: null,
      talentName: null,
      transformedFromId: null,
      passive: false,
      cost: 0,
      castTime: 0,
      channeled: false,
      channelDuration: 0,
      cooldown: 0,
      range: 5,
      minRange: 0,
      school: 'physical',
      requiresForm: null,
      requiresStealth: false,
      requiresShield: false,
      requiresExecute: false,
      resolvedClip: meleeResolved,
      baseClip: meleeBase,
      castLoopClip: null,
      vfxArchetype: 'melee_swing',
      vfxSchool: 'physical',
      vfxMotifs: ['contact_spark'],
    },
  ];

  if (cls === 'hunter') {
    const rangedBase = firstClipName(clips?.attack, 'Woc_Aim_Crossbow');
    out.push({
      id: '__auto_ranged',
      name: 'Ranged Auto-Shot',
      description: 'Standard ranged bow or crossbow shot at a distant target.',
      cls,
      kind: 'basic',
      category: 'basic',
      specIds: [],
      excludeSpecs: [],
      isSpecSignature: false,
      talentRowLevel: null,
      talentName: null,
      transformedFromId: null,
      passive: false,
      cost: 0,
      castTime: 0,
      channeled: false,
      channelDuration: 0,
      cooldown: 0,
      range: 35,
      minRange: 8,
      school: 'physical',
      requiresForm: null,
      requiresStealth: false,
      requiresShield: false,
      requiresExecute: false,
      resolvedClip: swapForLoadout(cls, loadout, rangedBase),
      baseClip: rangedBase,
      castLoopClip: null,
      vfxArchetype: 'ranged_shot',
      vfxSchool: 'physical',
      vfxMotifs: ['projectile'],
    });
  }

  if (clips?.wandAttack) {
    const wandBase = firstClipName(clips.wandAttack, 'Woc_Attack_Wand');
    out.push({
      id: '__auto_wand',
      name: 'Wand Shoot',
      description: 'Fires a quick bolt of magical energy from an equipped wand.',
      cls,
      kind: 'basic',
      category: 'basic',
      specIds: [],
      excludeSpecs: [],
      isSpecSignature: false,
      talentRowLevel: null,
      talentName: null,
      transformedFromId: null,
      passive: false,
      cost: 0,
      castTime: 0,
      channeled: false,
      channelDuration: 0,
      cooldown: 0,
      range: 30,
      minRange: 0,
      school: CLASSES[cls].abilities.includes('fireball')
        ? 'fire'
        : cls === 'priest'
          ? 'holy'
          : cls === 'warlock'
            ? 'shadow'
            : 'nature',
      requiresForm: null,
      requiresStealth: false,
      requiresShield: false,
      requiresExecute: false,
      resolvedClip: swapForLoadout(cls, loadout, wandBase),
      baseClip: wandBase,
      castLoopClip: null,
      vfxArchetype: 'wand_bolt',
      vfxSchool: 'arcane',
      vfxMotifs: ['projectile', 'wand'],
    });
  }

  out.push(
    {
      id: '__pose_combat_idle',
      name: 'Combat Ready Stance',
      description: 'Looping in-combat ready stance for the current weapon loadout.',
      cls,
      kind: 'basic',
      category: 'basic',
      specIds: [],
      excludeSpecs: [],
      isSpecSignature: false,
      talentRowLevel: null,
      talentName: null,
      transformedFromId: null,
      passive: false,
      cost: 0,
      castTime: 0,
      channeled: false,
      channelDuration: 0,
      cooldown: 0,
      range: 5,
      minRange: 0,
      school: 'physical',
      requiresForm: null,
      requiresStealth: false,
      requiresShield: false,
      requiresExecute: false,
      resolvedClip: combatIdleResolved,
      baseClip: combatIdleBase,
      castLoopClip: null,
      vfxArchetype: 'stance',
      vfxSchool: 'physical',
      vfxMotifs: ['combat_idle'],
    },
    {
      id: '__pose_hit',
      name: 'Hit Reaction / Flinch',
      description: 'Physical impact flinch animation played when taking direct damage.',
      cls,
      kind: 'basic',
      category: 'basic',
      specIds: [],
      excludeSpecs: [],
      isSpecSignature: false,
      talentRowLevel: null,
      talentName: null,
      transformedFromId: null,
      passive: false,
      cost: 0,
      castTime: 0,
      channeled: false,
      channelDuration: 0,
      cooldown: 0,
      range: 5,
      minRange: 0,
      school: 'physical',
      requiresForm: null,
      requiresStealth: false,
      requiresShield: false,
      requiresExecute: false,
      resolvedClip: hitResolved,
      baseClip: hitBase,
      castLoopClip: null,
      vfxArchetype: 'hit_react',
      vfxSchool: 'physical',
      vfxMotifs: ['flinch'],
    },
  );

  return out;
}

export function buildClassSpellCatalog(
  cls: PlayerClass,
  loadoutPresetId: SpellLabLoadoutPresetId = 'default',
): ClassSpellCatalog {
  const cdef = CLASSES[cls];
  const talents = TALENTS[cls];
  const rows = ROW_TREES[cls] ?? [];
  const { mainhandItemId, offhandItemId, resolvedLoadout } = resolveClassLoadoutItems(
    cls,
    loadoutPresetId,
  );

  const specs: SpellLabSpecSummary[] = talents.specs.map((s) => ({
    id: s.id,
    name: s.name,
    role: s.role,
    signature: s.signature,
    description: s.description,
  }));

  const signatureSpecByAbility = new Map<string, string>();
  for (const s of specs) {
    signatureSpecByAbility.set(s.signature, s.id);
  }

  const talentGrantByAbility = new Map<string, { level: number; name: string }>();
  for (const row of rows) {
    for (const opt of row.options) {
      const granted = opt.effect.grant?.ability;
      if (granted && !talentGrantByAbility.has(granted)) {
        talentGrantByAbility.set(granted, { level: row.level, name: opt.name });
      }
    }
  }

  // Ordered collection of ability IDs for this class:
  // 1. Class kit abilities (`CLASSES[cls].abilities`)
  // 2. Spec signature abilities (`TALENTS[cls].specs[].signature`)
  // 3. Talent row granted abilities (`ROW_TREES[cls]`)
  // 4. Action-replacement target abilities (`def.actionReplacement`)
  // 5. Any remaining non-hidden abilities in `ABILITIES` whose `def.class === cls`
  const orderedIds: string[] = [];
  const transformedFrom = new Map<string, string>();
  const seen = new Set<string>();

  const pushId = (id: string, parentId?: string): void => {
    if (!id || seen.has(id)) return;
    const def = ABILITIES[id];
    if (!def) return;
    seen.add(id);
    if (parentId) transformedFrom.set(id, parentId);
    orderedIds.push(id);
    for (const rule of replacementRules(def)) {
      pushId(rule.abilityId, id);
    }
  };

  for (const id of cdef.abilities) pushId(id);
  for (const s of specs) pushId(s.signature);
  for (const [id] of talentGrantByAbility) pushId(id);
  for (const [id, def] of Object.entries(ABILITIES)) {
    if (def.class === cls && !def.hiddenFromPlayer) {
      pushId(id);
    }
  }

  const entries: SpellLabEntry[] = [...buildBasicEntries(cls, resolvedLoadout)];

  for (const id of orderedIds) {
    const def = ABILITIES[id];
    if (!def) continue;

    const sigSpec = signatureSpecByAbility.get(id);
    const talentInfo = talentGrantByAbility.get(id);
    const parentId = transformedFrom.get(id) ?? null;
    const parentDef = parentId ? ABILITIES[parentId] : null;

    const specSet = new Set<string>();
    if (sigSpec) specSet.add(sigSpec);
    for (const s of def.specs ?? []) specSet.add(s);
    if (parentDef) {
      const parentSig = signatureSpecByAbility.get(parentDef.id);
      if (parentSig) specSet.add(parentSig);
      for (const s of parentDef.specs ?? []) specSet.add(s);
    }

    let category: SpellLabCategory;
    if (sigSpec || (def.specs && def.specs.length > 0)) {
      category = 'spec';
    } else if (talentInfo) {
      category = 'talent';
    } else {
      category = 'base';
    }

    const { baseClip, resolvedClip, castLoopClip } = resolveAbilityAnimationClips(
      cls,
      def,
      resolvedLoadout,
    );
    const { vfxArchetype, vfxSchool, vfxMotifs } = resolveAbilityVfxInfo(def);

    entries.push({
      id: def.id,
      name: def.name,
      description: formatSpellLabDescription(def),
      cls,
      kind: 'ability',
      category,
      specIds: [...specSet],
      excludeSpecs: def.excludeSpecs ? [...def.excludeSpecs] : [],
      isSpecSignature: Boolean(sigSpec),
      talentRowLevel: talentInfo?.level ?? null,
      talentName: talentInfo?.name ?? null,
      transformedFromId: parentId,
      passive: Boolean(def.passive),
      cost: def.cost,
      castTime: def.castTime,
      channeled: Boolean(def.channel),
      channelDuration: def.channel?.duration ?? 0,
      cooldown: def.cooldown,
      range: def.range,
      minRange: def.minRange ?? 0,
      school: def.school,
      requiresForm: primaryFormRequirement(def),
      requiresStealth: Boolean(def.requiresStealth),
      requiresShield: Boolean(def.requiresShield),
      requiresExecute:
        def.requiresTargetHpBelow !== undefined || def.executeThreshold !== undefined,
      resolvedClip,
      baseClip,
      castLoopClip,
      vfxArchetype,
      vfxSchool,
      vfxMotifs,
    });
  }

  return {
    cls,
    className: cdef.name,
    classColor: CLASS_ACCENT_HEX[cls],
    specs,
    loadoutPresetId,
    mainhandItemId,
    offhandItemId,
    resolvedLoadout,
    entries,
  };
}

export type SpellLabFilterTab = 'all' | 'basic' | 'base' | 'talents' | string;

export interface SpellLabFilterOptions {
  tab: SpellLabFilterTab;
  /** When viewing a specific spec tab, true shows only that spec's exclusive + signature spells; false shows the full kit playable by that spec. */
  specExclusiveOnly?: boolean;
  /** Hide passive talent traits so the list focuses on active animations + VFX. */
  hidePassives?: boolean;
  query?: string;
}

export function filterSpellCatalogEntries(
  entries: readonly SpellLabEntry[],
  options: SpellLabFilterOptions,
): SpellLabEntry[] {
  const q = (options.query ?? '').trim().toLowerCase();
  return entries.filter((entry) => {
    if (options.hidePassives && entry.passive) return false;

    const { tab } = options;
    if (tab === 'basic') {
      if (entry.category !== 'basic') return false;
    } else if (tab === 'base') {
      if (entry.category !== 'base') return false;
    } else if (tab === 'talents') {
      if (entry.category !== 'talent') return false;
    } else if (tab !== 'all') {
      // Specific spec ID (e.g. 'arms', 'fury', 'prot')
      if (options.specExclusiveOnly) {
        if (!entry.specIds.includes(tab)) return false;
      } else {
        if (entry.excludeSpecs.includes(tab)) return false;
        if (entry.specIds.length > 0 && !entry.specIds.includes(tab)) return false;
      }
    }

    if (q.length > 0) {
      const hay =
        `${entry.name} ${entry.id} ${entry.resolvedClip} ${entry.baseClip} ${entry.castLoopClip ?? ''} ${entry.vfxArchetype} ${entry.vfxSchool} ${entry.specIds.join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** Optimal practice-dummy distance (in yards) in front of the player for reviewing `entry`. */
export function optimalDummyDistanceForSpell(entry: SpellLabEntry): number {
  if (entry.id === '__auto_ranged') return 14;
  if (entry.id === '__auto_wand') return 10;
  if (entry.kind === 'basic') return 3.2;
  if (entry.minRange >= 8) return Math.max(14, entry.minRange + 4);
  if (
    entry.id === 'charge' ||
    entry.id === 'intercept' ||
    entry.id === 'intervene' ||
    entry.id === 'feral_charge' ||
    entry.id === 'lunge' ||
    entry.id === 'heroic_leap'
  ) {
    return 13;
  }
  if (entry.range > 0 && entry.range <= 6) return 3.2;
  if (entry.range > 6) return Math.min(11, Math.max(7, entry.range * 0.35));
  return 3.5;
}

/** Build the full 9-class catalog summary for tests and quick inspection. */
export function buildAllClassSpellCatalogs(
  loadoutPresetId: SpellLabLoadoutPresetId = 'default',
): Record<PlayerClass, ClassSpellCatalog> {
  const out = {} as Record<PlayerClass, ClassSpellCatalog>;
  for (const cls of ALL_CLASSES) {
    out[cls] = buildClassSpellCatalog(cls, loadoutPresetId);
  }
  return out;
}
