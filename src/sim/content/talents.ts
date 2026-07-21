import type { AbilityEffect, AuraKind, ResourceType } from '../types';
import { ALL_CLASSES, MAX_LEVEL, type PlayerClass } from '../types';
import { specBaselineFor } from './spec_baselines';
import {
  isTalentRowLevel,
  ROW_LEVELS,
  rowForLevel,
  rowsUnlockedAtLevel,
  rowTreeFor,
  type TalentRowLevel,
} from './talent_rows';
import {
  DRUID_TALENTS,
  HUNTER_TALENTS,
  MAGE_TALENTS,
  PALADIN_TALENTS,
  PRIEST_TALENTS,
  ROGUE_TALENTS,
  SHAMAN_TALENTS,
  WARLOCK_TALENTS,
} from './talents_classic';
import { WARRIOR_TALENTS } from './talents_warrior';

export {
  type ClassChoiceRows,
  isTalentRowLevel,
  OPTIONS_PER_ROW,
  ROW_COUNT,
  ROW_LEVELS,
  ROW_TREES,
  type RowTree,
  rowForLevel,
  rowsUnlockedAtLevel,
  rowTreeFor,
  type TalentRow,
  type TalentRowLevel,
  type TalentRowOption,
  validateRowTree,
} from './talent_rows';

export type Role = 'tank' | 'healer' | 'dps';

export interface StatModEffect {
  str?: number;
  agi?: number;
  sta?: number;
  int?: number;
  spi?: number;
  armor?: number;
  ap?: number;
  crit?: number;
  dodge?: number;
  apPct?: number;
  staPct?: number;
  armorPct?: number;
  armorFromStrPct?: number;
  maxHpPct?: number;
  strPct?: number;
  agiPct?: number;
  intPct?: number;
  spiPct?: number;
}

export interface AbilityModEffect {
  ability: string;
  dmgPct?: number;
  dmgPctVsDotted?: number;
  dmgPctVsDottedAbility?: string;
  flatDmg?: number;
  costPct?: number;
  cooldownPct?: number;
  // Flat cooldown ADD in seconds (Snap Polymorph: an instant cast gains a real
  // cooldown). Applied after cooldownPct at the resolve site in classes.ts.
  cooldownFlat?: number;
  castPct?: number;
  buffPct?: number;
  // Ability-scoped critical strike chance ADD (the classic Improved Backstab
  // shape). Reaches the weaponStrike hit table (meleeSwing critBonus) and the
  // directDamage crit roll in effect_dispatch.ts.
  critPct?: number;
  castWhileMoving?: boolean;
  damagePushbackImmune?: boolean;
  bonusCharges?: number;
  addEffects?: AbilityEffect[];
}

export interface GlobalModEffect {
  meleeDmgPct?: number;
  spellDmgPct?: number;
  healPct?: number;
  // Max mana multiplier (e.g. Chronoweave mastery cushion) and out-of-combat
  // mana regen multiplier.
  manaPct?: number;
  manaRegenPct?: number;
  dotDmgPct?: number;
  hotHealPct?: number;
  absorbPct?: number;
  meleeHastePct?: number;
  petDmgPct?: number;
  petDmgSharePct?: number;
  threatPct?: number;
  critDmgSpellPct?: number;
  critDmgPhysPct?: number;
  critDmgHealPct?: number;
  spellHastePct?: number;
  critVsRooted?: number;
  // Thuggery mastery: chance for a landed mainhand auto-attack to trigger one
  // extra swing (the classic Sword Specialization shape; combat/auto_attack.ts).
  // The extra swing never chains into another proc.
  extraAttackPct?: number;
  // Nature's Fury (druid row): spell-crit fraction pulsed to the druid and
  // nearby party members while in Moonwing Form (combat/natures_fury.ts).
  moonwingPartyCritPct?: number;
  autoRagePct?: number;
  abilityRagePct?: number;
  onKillSpeedPct?: number;
  onKillSpeedDuration?: number;
  secondWindPctPerSec?: number;
  battleRhythm?: number;
  bloodbathPct?: number;
  bloodbathDuration?: number;
  bloodbathMaxPct?: number;
  cdrPerRage?: number;
  stanceMastery?: number;
  fearBreakPct?: number;
  masteryTwoHandDmgPct?: number;
  cheatDeathIcd?: number;
  // Mage choice rows (owner tree 2026-07-11):
  // Warded: fraction less damage taken while the caster's own personal barrier
  // (an ice_barrier absorb aura) is up. Folded target-side in combat/damage.ts.
  barrierDrPct?: number;
  // Overflowing Power: seconds shaved off the mage defensive cooldowns per 10%
  // of maximum mana spent, capped at 10 sec per 30 sec (casting_lifecycle's
  // spendAbilityCost, the Colossal Might pattern on mana).
  manaDefCdrPer10?: number;
  // Blink While Casting: 1 when picked; Flickerstep slips through the busy
  // guard without touching the cast in progress (casting_lifecycle).
  blinkCast?: number;
  // Elemental Convergence: 1 when picked; alternating a Fire and a Frost cast
  // opens the surge window (casting_lifecycle convergenceOnCast, marker +
  // ICD carried by auras so no entity field enters the parity hash).
  convergence?: number;
  // Ignition (fire mage mastery): fraction of a spell crit's damage banked as
  // a stacking burn (combat/fire_mage.ts igniteOnCrit copies the resolved
  // amount). Scales with level like every spec mastery.
  ignitionPct?: number;
}

export type ProcTrigger =
  // icd: optional internal cooldown in seconds (talent_procs.ts). While it
  // runs, matching casts/crits are ignored entirely: nothing fires and nothing
  // is banked toward n.
  // chance: optional 0-1 fire probability (the item-set Clearcasting shape).
  // Rolled through the sim Rng only at the moment the proc would otherwise
  // fire, so players without such a proc draw no rng. A failed castNth roll
  // still resets the counter; the icd arms only on a successful fire.
  | { on: 'castNth'; n: number; abilities: string[]; icd?: number; chance?: number }
  | { on: 'spellCrit'; abilities?: string[]; icd?: number; chance?: number }
  | { on: 'shieldConsumed'; ability: string }
  | { on: 'hotExpired'; ability: string }
  | { on: 'bigHitTaken'; hpFrac: number; icd: number }
  | { on: 'meleeSwingWhile'; auraKind: string; icd?: number; chance?: number }
  | { on: 'thornsReflect'; ability: string };

export type ProcResponse =
  | {
      kind: 'empowerNext';
      aura: 'next_cast_free' | 'next_execute_free' | 'next_cast_instant' | 'next_cast_cheap';
      abilities?: string[];
      duration: number;
      costPct?: number;
    }
  | { kind: 'cooldownRefund'; ability: string; seconds: number | 'reset' }
  | { kind: 'resource'; amount: number; resourceType?: ResourceType }
  // The pct-of-max-health variants (phase-2 defensive pass) override the flat
  // number when present. Most scale with the wearer; source scaling is for
  // shields whose proc owner can differ from the protected ally.
  | {
      kind: 'heal';
      amount?: number;
      amountPctMaxHp?: number;
      amountPctSourceMaxHp?: number;
    }
  | { kind: 'absorb'; amount?: number; amountPctMaxHp?: number; duration: number; name: string }
  | {
      kind: 'echo';
      belowFrac: number;
      window: number;
      heal?: number;
      healPctMaxHp?: number;
      name: string;
    }
  // A plain self-aura (Deathless Will's escape burst): applied to the proc
  // owner with the def's school; value semantics follow the aura kind (a
  // buff_speed of 1.4 is +40% movement).
  | { kind: 'aura'; auraKind: AuraKind; value: number; duration: number; name: string };

export interface ProcDef {
  id: string;
  name: string;
  school?: 'physical' | 'fire' | 'frost' | 'arcane' | 'shadow' | 'holy' | 'nature';
  trigger: ProcTrigger;
  responses: ProcResponse[];
}

export interface TalentEffect {
  stats?: StatModEffect;
  grant?: { ability: string; rank?: number };
  proc?: ProcDef;
  ability?: AbilityModEffect[];
  global?: GlobalModEffect;
}

export interface SpecDef {
  id: string;
  class: PlayerClass;
  name: string;
  role: Role;
  icon: string;
  description: string;
  signature: string;
  mastery: { name: string; description: string; effect: TalentEffect };
}

export interface ClassTalents {
  class: PlayerClass;
  specs: SpecDef[];
}

export interface TalentAllocation {
  spec: string | null;
  rows: Partial<Record<TalentRowLevel, string>>;
}

export function emptyAllocation(): TalentAllocation {
  return { spec: null, rows: {} };
}

export function cloneAllocation(allocation: TalentAllocation): TalentAllocation {
  return { spec: allocation.spec, rows: { ...allocation.rows } };
}

export interface SavedLoadout {
  name: string;
  alloc: TalentAllocation;
  bar: (string | null)[];
}

export const MAX_LOADOUTS = 10;
export const SAVED_LOADOUT_BAR_SLOTS = 33;

export interface ResolvedAbilityMod {
  dmgPct: number;
  dmgPctVsDotted: number;
  dmgPctVsDottedAbility?: string;
  flatDmg: number;
  costPct: number;
  cooldownPct: number;
  cooldownFlat: number;
  castPct: number;
  buffPct: number;
  critPct: number;
  castWhileMoving: boolean;
  damagePushbackImmune: boolean;
  bonusCharges: number;
  addEffects: AbilityEffect[];
}

export interface TalentModifiers {
  spec: string | null;
  role: Role | null;
  stats: Required<StatModEffect>;
  abilities: Record<string, ResolvedAbilityMod>;
  global: Required<GlobalModEffect>;
  grants: { ability: string; rank: number }[];
  procs: ProcDef[];
}

export const TALENTS = {
  warrior: WARRIOR_TALENTS,
  paladin: PALADIN_TALENTS,
  hunter: HUNTER_TALENTS,
  rogue: ROGUE_TALENTS,
  priest: PRIEST_TALENTS,
  shaman: SHAMAN_TALENTS,
  mage: MAGE_TALENTS,
  warlock: WARLOCK_TALENTS,
  druid: DRUID_TALENTS,
} satisfies Record<PlayerClass, ClassTalents>;

export function talentsFor(cls: PlayerClass): ClassTalents | null {
  return (TALENTS as Partial<Record<PlayerClass, ClassTalents>>)[cls] ?? null;
}

export function hasTalents(cls: PlayerClass): boolean {
  return talentsFor(cls) !== null;
}

export const SPEC_UNLOCK_LEVEL = ROW_LEVELS[0];
export const FIRST_TALENT_LEVEL = ROW_LEVELS[0];

export function talentPointsAtLevel(level: number): number {
  return rowsUnlockedAtLevel(Math.min(level, MAX_LEVEL));
}

export function rowsPicked(allocation: TalentAllocation): number {
  let picked = 0;
  for (const rowLevel of ROW_LEVELS) {
    if (typeof allocation.rows[rowLevel] === 'string') picked++;
  }
  return picked;
}

export function pointsSpent(allocation: TalentAllocation): number {
  return rowsPicked(allocation);
}

export function specLabel(
  cls: PlayerClass,
  allocation: TalentAllocation | undefined | null,
): string | null {
  if (!allocation?.spec) return null;
  return talentsFor(cls)?.specs.find((spec) => spec.id === allocation.spec)?.name ?? null;
}

export function validateTalentTree(talents: ClassTalents): string[] {
  const errors: string[] = [];
  const specIds = new Set<string>();
  for (const spec of talents.specs) {
    if (specIds.has(spec.id)) errors.push(`duplicate spec id "${spec.id}"`);
    specIds.add(spec.id);
    if (spec.class !== talents.class) {
      errors.push(`spec "${spec.id}" belongs to ${spec.class}, expected ${talents.class}`);
    }
    if (!spec.signature) errors.push(`spec "${spec.id}" has no signature ability`);
    if (!spec.mastery?.effect) errors.push(`spec "${spec.id}" has no mastery effect`);
  }
  return errors;
}

for (const cls of ALL_CLASSES) {
  const talents = TALENTS[cls];
  const errors = validateTalentTree(talents);
  if (errors.length > 0) {
    throw new Error(`Invalid specializations for ${cls}: ${errors.join('; ')}`);
  }
}

export interface AllocCheck {
  ok: boolean;
  reason?: string;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allow = new Set(allowed);
  return Object.keys(value).every((key) => allow.has(key));
}

function owns(value: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(value, key);
}

export function sanitizeAllocation(value: unknown): TalentAllocation {
  if (!isPlainRecord(value)) return emptyAllocation();
  const spec =
    owns(value, 'spec') && typeof value.spec === 'string' && value.spec.length <= 64
      ? value.spec
      : null;
  const rows: Partial<Record<TalentRowLevel, string>> = {};
  if (owns(value, 'rows') && isPlainRecord(value.rows)) {
    for (const [rawLevel, optionId] of Object.entries(value.rows)) {
      const rowLevel = Number(rawLevel);
      if (String(rowLevel) !== rawLevel || !isTalentRowLevel(rowLevel)) continue;
      if (typeof optionId !== 'string' || optionId.length === 0 || optionId.length > 128) continue;
      rows[rowLevel] = optionId;
    }
  }
  return { spec, rows };
}

export function validateAllocation(
  cls: PlayerClass,
  value: unknown,
  playerLevel: number,
): AllocCheck {
  const talents = talentsFor(cls);
  const tree = rowTreeFor(cls);
  if (!talents || !tree) return { ok: false, reason: 'no talent rows for class' };
  if (!Number.isFinite(playerLevel)) return { ok: false, reason: 'invalid player level' };
  if (
    !isPlainRecord(value) ||
    !hasOnlyKeys(value, ['spec', 'rows']) ||
    !owns(value, 'spec') ||
    !owns(value, 'rows')
  ) {
    return { ok: false, reason: 'invalid talent allocation shape' };
  }
  if (value.spec !== null && typeof value.spec !== 'string') {
    return { ok: false, reason: 'invalid specialization' };
  }
  if (typeof value.spec === 'string') {
    if (playerLevel < SPEC_UNLOCK_LEVEL) {
      return { ok: false, reason: `specialization requires level ${SPEC_UNLOCK_LEVEL}` };
    }
    if (!talents.specs.some((spec) => spec.id === value.spec)) {
      return { ok: false, reason: 'unknown specialization' };
    }
  }
  if (!isPlainRecord(value.rows)) {
    return { ok: false, reason: 'invalid talent rows' };
  }
  for (const [rawLevel, optionId] of Object.entries(value.rows)) {
    const rowLevel = Number(rawLevel);
    if (String(rowLevel) !== rawLevel || !isTalentRowLevel(rowLevel)) {
      return { ok: false, reason: 'unknown talent row' };
    }
    if (typeof optionId !== 'string' || optionId.length === 0 || optionId.length > 128) {
      return { ok: false, reason: 'invalid talent option' };
    }
    const row = rowForLevel(cls, rowLevel);
    if (!row || playerLevel < row.level) {
      return { ok: false, reason: `talent row requires level ${rowLevel}` };
    }
    if (!row.options.some((option) => option.id === optionId)) {
      return { ok: false, reason: 'unknown talent option' };
    }
  }
  return { ok: true };
}

export function repairAllocation(
  cls: PlayerClass,
  value: unknown,
  playerLevel: number,
): TalentAllocation {
  const talents = talentsFor(cls);
  const tree = rowTreeFor(cls);
  if (!talents || !tree || !Number.isFinite(playerLevel)) return emptyAllocation();

  const sanitized = sanitizeAllocation(value);
  const spec =
    playerLevel >= SPEC_UNLOCK_LEVEL &&
    sanitized.spec !== null &&
    talents.specs.some((candidate) => candidate.id === sanitized.spec)
      ? sanitized.spec
      : null;
  const rows: Partial<Record<TalentRowLevel, string>> = {};
  for (const row of tree) {
    const optionId = sanitized.rows[row.level];
    if (playerLevel < row.level || !optionId) continue;
    if (row.options.some((option) => option.id === optionId)) rows[row.level] = optionId;
  }
  return { spec, rows };
}

function zeroStats(): Required<StatModEffect> {
  return {
    str: 0,
    agi: 0,
    sta: 0,
    int: 0,
    spi: 0,
    armor: 0,
    ap: 0,
    crit: 0,
    dodge: 0,
    apPct: 0,
    staPct: 0,
    armorPct: 0,
    armorFromStrPct: 0,
    maxHpPct: 0,
    strPct: 0,
    agiPct: 0,
    intPct: 0,
    spiPct: 0,
  };
}

function zeroGlobal(): Required<GlobalModEffect> {
  return {
    meleeDmgPct: 0,
    spellDmgPct: 0,
    healPct: 0,
    manaPct: 0,
    manaRegenPct: 0,
    dotDmgPct: 0,
    hotHealPct: 0,
    absorbPct: 0,
    meleeHastePct: 0,
    petDmgPct: 0,
    petDmgSharePct: 0,
    threatPct: 0,
    critDmgSpellPct: 0,
    critDmgPhysPct: 0,
    critDmgHealPct: 0,
    spellHastePct: 0,
    critVsRooted: 0,
    extraAttackPct: 0,
    moonwingPartyCritPct: 0,
    autoRagePct: 0,
    abilityRagePct: 0,
    onKillSpeedPct: 0,
    onKillSpeedDuration: 0,
    secondWindPctPerSec: 0,
    battleRhythm: 0,
    bloodbathPct: 0,
    bloodbathDuration: 0,
    bloodbathMaxPct: 0,
    cdrPerRage: 0,
    stanceMastery: 0,
    fearBreakPct: 0,
    masteryTwoHandDmgPct: 0,
    cheatDeathIcd: 0,
    barrierDrPct: 0,
    manaDefCdrPer10: 0,
    blinkCast: 0,
    convergence: 0,
    ignitionPct: 0,
  };
}

function zeroAbilityMod(): ResolvedAbilityMod {
  return {
    dmgPct: 0,
    dmgPctVsDotted: 0,
    flatDmg: 0,
    costPct: 0,
    cooldownPct: 0,
    cooldownFlat: 0,
    castPct: 0,
    buffPct: 0,
    critPct: 0,
    castWhileMoving: false,
    damagePushbackImmune: false,
    bonusCharges: 0,
    addEffects: [],
  };
}

export function emptyModifiers(): TalentModifiers {
  return {
    spec: null,
    role: null,
    stats: zeroStats(),
    abilities: {},
    global: zeroGlobal(),
    grants: [],
    procs: [],
  };
}

export function accumulateTalentEffect(
  modifiers: TalentModifiers,
  effect: TalentEffect | undefined,
  multiplier = 1,
): void {
  if (!effect) return;
  if (effect.stats) {
    const target = modifiers.stats;
    const source = effect.stats;
    target.str += (source.str ?? 0) * multiplier;
    target.agi += (source.agi ?? 0) * multiplier;
    target.sta += (source.sta ?? 0) * multiplier;
    target.int += (source.int ?? 0) * multiplier;
    target.spi += (source.spi ?? 0) * multiplier;
    target.armor += (source.armor ?? 0) * multiplier;
    target.ap += (source.ap ?? 0) * multiplier;
    target.crit += (source.crit ?? 0) * multiplier;
    target.dodge += (source.dodge ?? 0) * multiplier;
    target.apPct += (source.apPct ?? 0) * multiplier;
    target.staPct += (source.staPct ?? 0) * multiplier;
    target.armorPct += (source.armorPct ?? 0) * multiplier;
    target.armorFromStrPct += (source.armorFromStrPct ?? 0) * multiplier;
    target.maxHpPct += (source.maxHpPct ?? 0) * multiplier;
    target.strPct += (source.strPct ?? 0) * multiplier;
    target.agiPct += (source.agiPct ?? 0) * multiplier;
    target.intPct += (source.intPct ?? 0) * multiplier;
    target.spiPct += (source.spiPct ?? 0) * multiplier;
  }
  if (effect.global) {
    const target = modifiers.global;
    const source = effect.global;
    target.meleeDmgPct += (source.meleeDmgPct ?? 0) * multiplier;
    target.spellDmgPct += (source.spellDmgPct ?? 0) * multiplier;
    target.healPct += (source.healPct ?? 0) * multiplier;
    target.manaPct += (source.manaPct ?? 0) * multiplier;
    target.manaRegenPct += (source.manaRegenPct ?? 0) * multiplier;
    target.dotDmgPct += (source.dotDmgPct ?? 0) * multiplier;
    target.hotHealPct += (source.hotHealPct ?? 0) * multiplier;
    target.absorbPct += (source.absorbPct ?? 0) * multiplier;
    target.meleeHastePct += (source.meleeHastePct ?? 0) * multiplier;
    target.petDmgPct += (source.petDmgPct ?? 0) * multiplier;
    target.petDmgSharePct += (source.petDmgSharePct ?? 0) * multiplier;
    target.threatPct += (source.threatPct ?? 0) * multiplier;
    target.critDmgSpellPct += (source.critDmgSpellPct ?? 0) * multiplier;
    target.critDmgPhysPct += (source.critDmgPhysPct ?? 0) * multiplier;
    target.critDmgHealPct += (source.critDmgHealPct ?? 0) * multiplier;
    target.spellHastePct += (source.spellHastePct ?? 0) * multiplier;
    target.critVsRooted += (source.critVsRooted ?? 0) * multiplier;
    target.extraAttackPct += (source.extraAttackPct ?? 0) * multiplier;
    target.moonwingPartyCritPct += (source.moonwingPartyCritPct ?? 0) * multiplier;
    target.autoRagePct += (source.autoRagePct ?? 0) * multiplier;
    target.abilityRagePct += (source.abilityRagePct ?? 0) * multiplier;
    target.onKillSpeedPct += (source.onKillSpeedPct ?? 0) * multiplier;
    target.onKillSpeedDuration += (source.onKillSpeedDuration ?? 0) * multiplier;
    target.secondWindPctPerSec += (source.secondWindPctPerSec ?? 0) * multiplier;
    target.battleRhythm += (source.battleRhythm ?? 0) * multiplier;
    target.bloodbathPct += (source.bloodbathPct ?? 0) * multiplier;
    target.bloodbathDuration += (source.bloodbathDuration ?? 0) * multiplier;
    target.bloodbathMaxPct += (source.bloodbathMaxPct ?? 0) * multiplier;
    target.cdrPerRage += (source.cdrPerRage ?? 0) * multiplier;
    target.stanceMastery += (source.stanceMastery ?? 0) * multiplier;
    target.fearBreakPct += (source.fearBreakPct ?? 0) * multiplier;
    target.masteryTwoHandDmgPct += (source.masteryTwoHandDmgPct ?? 0) * multiplier;
    target.cheatDeathIcd = Math.max(target.cheatDeathIcd, source.cheatDeathIcd ?? 0);
    target.barrierDrPct += (source.barrierDrPct ?? 0) * multiplier;
    target.manaDefCdrPer10 += (source.manaDefCdrPer10 ?? 0) * multiplier;
    target.blinkCast += (source.blinkCast ?? 0) * multiplier;
    target.convergence += (source.convergence ?? 0) * multiplier;
    target.ignitionPct += (source.ignitionPct ?? 0) * multiplier;
  }
  for (const ability of effect.ability ?? []) {
    const target = modifiers.abilities[ability.ability] ?? zeroAbilityMod();
    modifiers.abilities[ability.ability] = target;
    target.dmgPct += (ability.dmgPct ?? 0) * multiplier;
    target.dmgPctVsDotted += (ability.dmgPctVsDotted ?? 0) * multiplier;
    if (ability.dmgPctVsDottedAbility) {
      target.dmgPctVsDottedAbility = ability.dmgPctVsDottedAbility;
    }
    target.flatDmg += (ability.flatDmg ?? 0) * multiplier;
    target.costPct += (ability.costPct ?? 0) * multiplier;
    target.cooldownPct += (ability.cooldownPct ?? 0) * multiplier;
    target.cooldownFlat += (ability.cooldownFlat ?? 0) * multiplier;
    target.castPct += (ability.castPct ?? 0) * multiplier;
    target.buffPct += (ability.buffPct ?? 0) * multiplier;
    target.critPct += (ability.critPct ?? 0) * multiplier;
    target.bonusCharges += (ability.bonusCharges ?? 0) * multiplier;
    if (ability.castWhileMoving) target.castWhileMoving = true;
    if (ability.damagePushbackImmune) target.damagePushbackImmune = true;
    if (ability.addEffects) target.addEffects.push(...ability.addEffects);
  }
  if (effect.grant) {
    modifiers.grants.push({ ability: effect.grant.ability, rank: effect.grant.rank ?? 1 });
  }
  if (effect.proc) modifiers.procs.push(effect.proc);
}

export const accumulate = accumulateTalentEffect;

export function defaultBuild(cls: PlayerClass, playerLevel = MAX_LEVEL): TalentAllocation {
  const talents = talentsFor(cls);
  const tree = rowTreeFor(cls);
  if (!talents || !tree) return emptyAllocation();
  const rows: Partial<Record<TalentRowLevel, string>> = {};
  for (const row of tree) {
    if (row.level > playerLevel) continue;
    rows[row.level] = row.options[0].id;
  }
  return {
    spec: playerLevel >= SPEC_UNLOCK_LEVEL ? (talents.specs[0]?.id ?? null) : null,
    rows,
  };
}

export function computeTalentModifiers(
  cls: PlayerClass,
  value: unknown,
  level = MAX_LEVEL,
): TalentModifiers {
  const modifiers = emptyModifiers();
  const talents = talentsFor(cls);
  const tree = rowTreeFor(cls);
  if (!talents || !tree) return modifiers;

  const allocation = repairAllocation(cls, value, level);
  const spec = allocation.spec
    ? (talents.specs.find((candidate) => candidate.id === allocation.spec) ?? null)
    : null;
  if (spec) {
    modifiers.spec = spec.id;
    modifiers.role = spec.role;
    modifiers.grants.push({ ability: spec.signature, rank: 1 });
    accumulateTalentEffect(modifiers, spec.mastery.effect, Math.min(1, Math.max(0, level) / 20));
    accumulateTalentEffect(modifiers, specBaselineFor(cls, spec.id));
  }

  for (const row of tree) {
    const optionId = allocation.rows[row.level];
    if (!optionId) continue;
    const option = row.options.find((candidate) => candidate.id === optionId);
    if (option) accumulateTalentEffect(modifiers, option.effect);
  }
  return modifiers;
}

export const TALENT_BUILD_VERSION = 2;

function b64encode(value: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(value, 'utf-8').toString('base64');
  return btoa(unescape(encodeURIComponent(value)));
}

function b64decode(value: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(value, 'base64').toString('utf-8');
  return decodeURIComponent(escape(atob(value)));
}

export function exportBuild(cls: PlayerClass, allocation: TalentAllocation): string {
  const canonical = sanitizeAllocation(allocation);
  return b64encode(
    JSON.stringify({
      v: TALENT_BUILD_VERSION,
      c: cls,
      s: canonical.spec,
      r: canonical.rows,
    }),
  );
}

export type BuildImport =
  | { ok: true; cls: PlayerClass; alloc: TalentAllocation }
  | { ok: false; reason: string };

export function importBuild(value: string): BuildImport {
  if (value.length === 0 || value.length > 8192) {
    return { ok: false, reason: 'malformed build string' };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(b64decode(value.trim()));
  } catch {
    return { ok: false, reason: 'malformed build string' };
  }
  if (!isPlainRecord(payload) || !hasOnlyKeys(payload, ['v', 'c', 's', 'r'])) {
    return { ok: false, reason: 'malformed build string' };
  }
  if (payload.v !== TALENT_BUILD_VERSION) {
    return { ok: false, reason: 'incompatible build version' };
  }
  if (typeof payload.c !== 'string' || !hasTalents(payload.c as PlayerClass)) {
    return { ok: false, reason: 'unknown class build' };
  }
  const cls = payload.c as PlayerClass;
  const alloc = sanitizeAllocation({ spec: payload.s, rows: payload.r });
  if (!validateAllocation(cls, alloc, MAX_LEVEL).ok) {
    return { ok: false, reason: 'invalid talent build' };
  }
  return { ok: true, cls, alloc };
}
