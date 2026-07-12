// ---------------------------------------------------------------------------
// Talents & Specializations — pure data model, validation, point economy, the
// flat-modifier precompute, and import/export build strings. Zero DOM/sim deps
// so it is fully unit-testable and shared verbatim by the authoritative Sim and
// the display-only network client.
//
// ARCHITECTURE: a player's talent allocation is resolved ONCE — at
// allocation / respec / loadout-switch — into a flat `TalentModifiers` struct
// (computeTalentModifiers). The combat + stat hot paths read only those flat
// numbers; they never walk the tree. See docs/prd/talents-and-specializations.md.
// ---------------------------------------------------------------------------

import type { ProcDef } from '../combat/talent_procs';
import type { AbilityEffect } from '../types';
import { MAX_LEVEL, type PlayerClass } from '../types';
import {
  accumulateRowEffects,
  CHOICE_ROWS,
  type ChoiceRowAllocation,
  repairRows,
  validateRows,
} from './choice_rows';
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

export type Role = 'tank' | 'healer' | 'dps';

// Per-rank stat changes contributed by a passive talent. Flat fields add; the
// `*Pct` fields are fractional multipliers (0.05 = +5%). All consumed by
// recalcPlayerStats (entity.ts).
export interface StatModEffect {
  str?: number;
  agi?: number;
  sta?: number;
  int?: number;
  spi?: number;
  armor?: number;
  ap?: number; // flat attack power
  crit?: number; // additive crit chance (0.02 = +2%)
  dodge?: number; // additive dodge chance
  apPct?: number;
  staPct?: number;
  armorPct?: number;
  maxHpPct?: number;
  // Primary-attribute multipliers (0.10 = +10%). Applied to the fully-summed attribute
  // (base + per-level + gear + auras + flat talent bonuses) in recalcPlayerStats, so a
  // capstone can promise "+10% Agility" instead of a flat amount.
  strPct?: number;
  agiPct?: number;
  intPct?: number;
  spiPct?: number;
}

// Per-ability combat modifier. Baked into the resolved ability's effects/cost/
// cooldown/cast when `known` is built, so runEffects only ever reads flat values.
export interface AbilityModEffect {
  ability: string;
  dmgPct?: number; // +0.10 = +10% to this ability's damage/heal effects
  flatDmg?: number; // flat add to the primary damage/bonus
  costPct?: number; // -0.20 = 20% cheaper
  cooldownPct?: number; // -0.50 = half cooldown
  castPct?: number; // -0.50 = half cast time
  buffPct?: number; // +0.20 = +20% to this ability's selfBuff/buffTarget value (e.g. Improved Devotion Aura)
  // Conditional damage: bonus multiplier when the CASTER'S damage-over-time
  // effect is ticking on the target (priest Twisted Faith). Applied in
  // effect_dispatch at hit time, never baked into the resolved min/max.
  dmgPctVsDotted?: number;
  // When present, the conditional bonus above requires this exact caster-owned
  // DoT rather than any DoT from the caster.
  dmgPctVsDottedAbility?: string;
  castWhileMoving?: boolean; // the cast/channel survives the caster's own movement (Firestarter)
  damagePushbackImmune?: boolean; // damage cannot delay a cast or shorten a channel
  bonusCharges?: number; // extra stored uses for cooldown abilities (1 = two total charges)
  addEffects?: AbilityEffect[];
}

// Mastery-style global multipliers, applied to whole damage/heal schools when
// `known` is built (and to player threat in the Sim).
export interface GlobalModEffect {
  meleeDmgPct?: number; // physical ability damage
  spellDmgPct?: number; // magic ability damage
  healPct?: number; // healing done
  dotDmgPct?: number; // damage-over-time effects
  hotHealPct?: number; // heal-over-time effects
  absorbPct?: number; // absorb shield strength
  meleeHastePct?: number; // passive melee attack haste
  petDmgPct?: number; // owner's passive pet damage
  petDmgSharePct?: number; // incoming damage redirected to a living pet
  threatPct?: number; // bonus threat (tank role)
  // Extra critical-strike damage (0.5 = +50%). Added to the base crit multiplier for BOTH
  // spell (base 1.5) and physical (base 2.0) crits: a spec mastery so a Fire mage's crits
  // hit harder. Baked onto Entity.critDmgBonus in recalcPlayerStats.
  critDmgPct?: number;
  // Passive spell haste from a spec mastery (0.1 = +10%). Folds into Entity.spellHaste, so
  // it shortens every cast and the cast-time tooltips reflect it live.
  spellHastePct?: number;
  critVsRooted?: number; // additive spell crit chance against rooted targets
  // Cheat death (Deathless Ardor style): a killing blow leaves the player at
  // 1 hp instead, once per this many seconds (0 disables). Consumed in
  // combat/damage.ts behind the procState internal cooldown.
  cheatDeathIcd?: number;
  fearBreakPct?: number;
  onKillSpeedPct?: number;
  onKillSpeedDuration?: number;
  bloodbathPct?: number;
  bloodbathDuration?: number;
  bloodbathMaxPct?: number;
  cdrPerRage?: number;
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
  signature: string; // ability id granted on spec selection
  mastery: { name: string; description: string; effect: TalentEffect };
}

export interface ClassTalents {
  class: PlayerClass;
  specs: SpecDef[];
}

// What the player has chosen. Persisted in CharacterState and round-tripped
// through build strings.
export interface CanonicalTalentAllocation {
  spec: string | null;
  rows: ChoiceRowAllocation;
  /** @deprecated Legacy point-tree input is accepted only so repair/sanitize can drop it. */
  ranks?: Record<string, number>;
  /** @deprecated Legacy point-tree input is accepted only so repair/sanitize can drop it. */
  choices?: Record<string, string>;
}

type LegacyTalentAllocation = Record<string, any>;

export type TalentAllocation = CanonicalTalentAllocation | LegacyTalentAllocation;

export function emptyAllocation(): CanonicalTalentAllocation {
  return { spec: null, rows: {} };
}

export function cloneAllocation(a: TalentAllocation): CanonicalTalentAllocation {
  return {
    spec: a.spec ?? null,
    rows: { ...(a.rows ?? {}) },
  };
}

export interface SavedLoadout {
  name: string;
  alloc: TalentAllocation;
  bar: (string | null)[]; // action-bar ability ids (per-build hotbar)
}

export const MAX_LOADOUTS = 10;
export const SAVED_LOADOUT_BAR_SLOTS = 22;

export interface ResolvedAbilityMod {
  dmgPct: number;
  dmgPctVsDotted: number;
  dmgPctVsDottedAbility?: string;
  flatDmg: number;
  costPct: number;
  cooldownPct: number;
  castPct: number;
  buffPct: number;
  castWhileMoving: boolean;
  damagePushbackImmune?: boolean;
  bonusCharges?: number;
  addEffects: AbilityEffect[];
}

// The flat precomputed struct read by the hot paths.
export interface TalentModifiers {
  spec: string | null;
  role: Role | null;
  stats: Required<StatModEffect>;
  abilities: Record<string, ResolvedAbilityMod>;
  global: Required<GlobalModEffect>;
  grants: { ability: string; rank: number }[];
  procs: ProcDef[];
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const TALENTS: Partial<Record<PlayerClass, ClassTalents>> = {
  warrior: WARRIOR_TALENTS,
  paladin: PALADIN_TALENTS,
  hunter: HUNTER_TALENTS,
  rogue: ROGUE_TALENTS,
  priest: PRIEST_TALENTS,
  shaman: SHAMAN_TALENTS,
  mage: MAGE_TALENTS,
  warlock: WARLOCK_TALENTS,
  druid: DRUID_TALENTS,
};

export function talentsFor(cls: PlayerClass): ClassTalents | null {
  return TALENTS[cls] ?? null;
}
export function hasTalents(cls: PlayerClass): boolean {
  return TALENTS[cls] !== undefined;
}

// ---------------------------------------------------------------------------
// Row economy. Each unlocked choice row allows one pick.
// ---------------------------------------------------------------------------

export const FIRST_TALENT_LEVEL = 10;

export function rowsUnlockedAtLevel(cls: PlayerClass, level: number): number {
  const capped = Math.max(1, Math.min(level, MAX_LEVEL));
  return (CHOICE_ROWS[cls]?.rows ?? []).filter((row) => row.level <= capped).length;
}

export function rowsPicked(alloc: TalentAllocation): number {
  return Object.keys(alloc.rows ?? {}).length;
}

// Human-readable specialization label for a saved allocation. Uses the chosen
// spec's display name when one is set. Returns null when none is chosen. Shared
// by the character sheet / public profile so
// spec display matches the in-game /talents readout.
export function specLabel(
  cls: PlayerClass,
  alloc: TalentAllocation | undefined | null,
): string | null {
  const ct = talentsFor(cls);
  if (!ct || !alloc) return null;
  if (alloc.spec) return ct.specs.find((s) => s.id === alloc.spec)?.name ?? null;
  return null;
}

// ---------------------------------------------------------------------------
// Load-time spec validation. Returns a list of human-readable errors
// (empty === valid). Run over every registered tree at module load.
// ---------------------------------------------------------------------------

export function validateTalentTree(ct: ClassTalents): string[] {
  const errs: string[] = [];
  const specIds = new Set(ct.specs.map((s) => s.id));

  // specs reference real signature/mastery
  for (const s of ct.specs) {
    if (specIds.size !== ct.specs.length) errs.push('duplicate spec id');
    if (!s.signature) errs.push(`spec "${s.id}" has no signature ability`);
    if (!s.mastery?.effect) errs.push(`spec "${s.id}" has no mastery effect`);
  }
  return errs;
}

// Fail-fast: a broken tree must never ship. Validated once at import.
(function assertTreesValid() {
  for (const ct of Object.values(TALENTS)) {
    if (!ct) continue;
    const errs = validateTalentTree(ct);
    if (errs.length) throw new Error(`Invalid talent tree for ${ct.class}: ${errs.join('; ')}`);
  }
})();

// ---------------------------------------------------------------------------
// Allocation validation (server-authoritative, FR-4.5). Shared by Sim apply,
// build-string import, and the UI's apply-enable check.
// ---------------------------------------------------------------------------

export interface AllocCheck {
  ok: boolean;
  reason?: string;
}

export function validateAllocation(
  cls: PlayerClass,
  alloc: TalentAllocation,
  playerLevel: number,
): AllocCheck {
  const ct = talentsFor(cls);
  if (!ct) return { ok: false, reason: 'no talent tree for class' };

  if (alloc.spec !== null && !ct.specs.some((s) => s.id === alloc.spec)) {
    return { ok: false, reason: 'unknown specialization' };
  }
  if (alloc.spec !== null && playerLevel < FIRST_TALENT_LEVEL) {
    return { ok: false, reason: `specialization requires level ${FIRST_TALENT_LEVEL}` };
  }

  const rowCheck = validateRows(cls, playerLevel, alloc.rows ?? {});
  if (!rowCheck.ok) return rowCheck;

  return { ok: true };
}

// Repair a persisted allocation so it satisfies the current row/spec rules.
export function repairAllocation(
  cls: PlayerClass,
  alloc: TalentAllocation,
  playerLevel: number,
): CanonicalTalentAllocation {
  const ct = talentsFor(cls);
  if (!ct) return emptyAllocation();
  const requestedSpec = alloc.spec ?? null;
  const spec =
    requestedSpec !== null &&
    playerLevel >= FIRST_TALENT_LEVEL &&
    ct.specs.some((s) => s.id === requestedSpec)
      ? requestedSpec
      : null;
  return { spec, rows: repairRows(cls, playerLevel, alloc.rows ?? {}) };
}

// ---------------------------------------------------------------------------
// Precompute (the heart of the architecture). Walk the allocation ONCE and fold
// every chosen node/spec into a flat TalentModifiers struct.
// ---------------------------------------------------------------------------

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
    dotDmgPct: 0,
    hotHealPct: 0,
    absorbPct: 0,
    meleeHastePct: 0,
    petDmgPct: 0,
    petDmgSharePct: 0,
    threatPct: 0,
    critDmgPct: 0,
    spellHastePct: 0,
    critVsRooted: 0,
    cheatDeathIcd: 0,
    fearBreakPct: 0,
    onKillSpeedPct: 0,
    onKillSpeedDuration: 0,
    bloodbathPct: 0,
    bloodbathDuration: 0,
    bloodbathMaxPct: 0,
    cdrPerRage: 0,
  };
}
function zeroAbilityMod(): ResolvedAbilityMod {
  return {
    dmgPct: 0,
    dmgPctVsDotted: 0,
    flatDmg: 0,
    costPct: 0,
    cooldownPct: 0,
    castPct: 0,
    buffPct: 0,
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

// Exported for the choice-row engine (choice_rows.ts folds a picked option's
// effect into the same flat TalentModifiers this module bakes).
export function accumulateTalentEffect(
  mods: TalentModifiers,
  eff: TalentEffect | undefined,
  mult: number,
): void {
  accumulate(mods, eff, mult);
}

function accumulate(mods: TalentModifiers, eff: TalentEffect | undefined, mult: number): void {
  if (!eff) return;
  if (eff.stats) {
    const s = mods.stats,
      e = eff.stats;
    s.str += (e.str ?? 0) * mult;
    s.agi += (e.agi ?? 0) * mult;
    s.sta += (e.sta ?? 0) * mult;
    s.int += (e.int ?? 0) * mult;
    s.spi += (e.spi ?? 0) * mult;
    s.armor += (e.armor ?? 0) * mult;
    s.ap += (e.ap ?? 0) * mult;
    s.crit += (e.crit ?? 0) * mult;
    s.dodge += (e.dodge ?? 0) * mult;
    s.apPct += (e.apPct ?? 0) * mult;
    s.staPct += (e.staPct ?? 0) * mult;
    s.armorPct += (e.armorPct ?? 0) * mult;
    s.maxHpPct += (e.maxHpPct ?? 0) * mult;
    s.strPct += (e.strPct ?? 0) * mult;
    s.agiPct += (e.agiPct ?? 0) * mult;
    s.intPct += (e.intPct ?? 0) * mult;
    s.spiPct += (e.spiPct ?? 0) * mult;
  }
  if (eff.global) {
    const g = mods.global,
      e = eff.global;
    g.meleeDmgPct += (e.meleeDmgPct ?? 0) * mult;
    g.spellDmgPct += (e.spellDmgPct ?? 0) * mult;
    g.healPct += (e.healPct ?? 0) * mult;
    g.dotDmgPct += (e.dotDmgPct ?? 0) * mult;
    g.hotHealPct += (e.hotHealPct ?? 0) * mult;
    g.absorbPct += (e.absorbPct ?? 0) * mult;
    g.meleeHastePct += (e.meleeHastePct ?? 0) * mult;
    g.petDmgPct += (e.petDmgPct ?? 0) * mult;
    g.petDmgSharePct += (e.petDmgSharePct ?? 0) * mult;
    g.threatPct += (e.threatPct ?? 0) * mult;
    g.critDmgPct += (e.critDmgPct ?? 0) * mult;
    g.spellHastePct += (e.spellHastePct ?? 0) * mult;
    g.critVsRooted += (e.critVsRooted ?? 0) * mult;
    g.fearBreakPct += (e.fearBreakPct ?? 0) * mult;
    g.onKillSpeedPct += (e.onKillSpeedPct ?? 0) * mult;
    g.onKillSpeedDuration += (e.onKillSpeedDuration ?? 0) * mult;
    g.bloodbathPct += (e.bloodbathPct ?? 0) * mult;
    g.bloodbathDuration += (e.bloodbathDuration ?? 0) * mult;
    g.bloodbathMaxPct += (e.bloodbathMaxPct ?? 0) * mult;
    g.cdrPerRage += (e.cdrPerRage ?? 0) * mult;
    // An ICD is a duration, not a rate: take the longest granted, ignore mult.
    g.cheatDeathIcd = Math.max(g.cheatDeathIcd, e.cheatDeathIcd ?? 0);
  }
  for (const am of eff.ability ?? []) {
    let cur = mods.abilities[am.ability];
    if (!cur) {
      cur = zeroAbilityMod();
      mods.abilities[am.ability] = cur;
    }
    cur.dmgPct += (am.dmgPct ?? 0) * mult;
    cur.dmgPctVsDotted += (am.dmgPctVsDotted ?? 0) * mult;
    if (am.dmgPctVsDottedAbility) cur.dmgPctVsDottedAbility = am.dmgPctVsDottedAbility;
    cur.flatDmg += (am.flatDmg ?? 0) * mult;
    cur.costPct += (am.costPct ?? 0) * mult;
    cur.cooldownPct += (am.cooldownPct ?? 0) * mult;
    cur.castPct += (am.castPct ?? 0) * mult;
    cur.buffPct += (am.buffPct ?? 0) * mult;
    cur.bonusCharges = (cur.bonusCharges ?? 0) + (am.bonusCharges ?? 0) * mult;
    if (am.castWhileMoving) cur.castWhileMoving = true;
    if (am.damagePushbackImmune) cur.damagePushbackImmune = true;
    // Added effects are rank-1 semantics, not multiplied by talent rank.
    if (am.addEffects) cur.addEffects.push(...am.addEffects);
  }
  if (eff.grant) mods.grants.push({ ability: eff.grant.ability, rank: eff.grant.rank ?? 1 });
  if (eff.proc) mods.procs.push(eff.proc);
}

// A deterministic, always-valid allocation for a class, used by 2v2 Fiesta to
// standardize everyone to the same level-20 build. Picks the class's first spec
// and the first option in every unlocked choice row.
export function defaultBuild(cls: PlayerClass, playerLevel = MAX_LEVEL): CanonicalTalentAllocation {
  const ct = talentsFor(cls);
  if (!ct) return emptyAllocation();
  const spec = ct.specs[0] ?? null;
  const rows: ChoiceRowAllocation = {};
  for (const row of CHOICE_ROWS[cls]?.rows ?? []) {
    if (row.level > playerLevel) continue;
    const opt = row.options[0];
    if (opt) rows[row.level] = opt.id;
  }
  return { spec: spec?.id ?? null, rows };
}

export function computeTalentModifiers(
  cls: PlayerClass,
  alloc: TalentAllocation,
  level = MAX_LEVEL,
): TalentModifiers {
  const mods = emptyModifiers();
  const ct = talentsFor(cls);
  if (!ct) return mods;

  const spec = alloc.spec ? (ct.specs.find((s) => s.id === alloc.spec) ?? null) : null;
  if (spec) {
    mods.spec = spec.id;
    mods.role = spec.role;
    mods.grants.push({ ability: spec.signature, rank: 1 }); // signature ability
    accumulate(mods, spec.mastery.effect, Math.min(1, level / 20)); // Mastery passive
  }

  // Choice-row picks fold into the same flat modifiers (grants included), so the
  // combat hot path never learns rows exist.
  accumulateRowEffects(mods, cls, alloc.rows ?? {});
  return mods;
}

// ---------------------------------------------------------------------------
// Import / export build strings (FR-6). Compact base64 of {version, class,
// spec, rows}. Import validates shape + version; the Sim re-validates
// the resulting allocation authoritatively before applying.
// ---------------------------------------------------------------------------

export const TALENT_BUILD_VERSION = 2;

function b64encode(s: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(s, 'utf-8').toString('base64');
  return btoa(unescape(encodeURIComponent(s)));
}
function b64decode(s: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(s, 'base64').toString('utf-8');
  return decodeURIComponent(escape(atob(s)));
}

export function exportBuild(cls: PlayerClass, alloc: TalentAllocation): string {
  const payload = {
    v: TALENT_BUILD_VERSION,
    c: cls,
    s: alloc.spec,
    w: alloc.rows ?? {},
  };
  return b64encode(JSON.stringify(payload));
}

export type BuildImport =
  | { ok: true; cls: PlayerClass; alloc: CanonicalTalentAllocation }
  | { ok: false; reason: string };

export function importBuild(str: string): BuildImport {
  let payload: any;
  try {
    payload = JSON.parse(b64decode(str.trim()));
  } catch {
    return { ok: false, reason: 'malformed build string' };
  }
  if (!payload || typeof payload !== 'object')
    return { ok: false, reason: 'malformed build string' };
  if (payload.v !== TALENT_BUILD_VERSION)
    return { ok: false, reason: 'incompatible build version' };
  if (typeof payload.c !== 'string' || !hasTalents(payload.c))
    return { ok: false, reason: 'unknown class build' };
  const rows: ChoiceRowAllocation = {};
  if (payload.w && typeof payload.w === 'object') {
    for (const k in payload.w) {
      const level = Number(k);
      const v = payload.w[k];
      if (Number.isInteger(level) && typeof v === 'string') {
        (rows as Record<number, string>)[level] = v;
      }
    }
  }
  const spec = typeof payload.s === 'string' ? payload.s : null;
  return { ok: true, cls: payload.c, alloc: { spec, rows } };
}
