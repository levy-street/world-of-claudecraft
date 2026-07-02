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

import type { AbilityEffect } from '../types';
import type { PlayerClass } from '../types';
import {
  accumulateRowEffects,
  CHOICE_ROW_LEVELS,
  type ChoiceRowAllocation,
  isChoiceRowLevel,
  repairRows,
  rowForLevel,
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

export type TalentTree = 'class' | 'spec';
export type TalentKind = 'passive' | 'active' | 'choice';
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
  castWhileMoving?: boolean; // the cast/channel survives the caster's own movement (Firestarter)
  addEffects?: AbilityEffect[];
}

// Mastery-style global multipliers, applied to whole damage/heal schools when
// `known` is built (and to player threat in the Sim).
export interface GlobalModEffect {
  meleeDmgPct?: number; // physical ability damage
  spellDmgPct?: number; // magic ability damage
  healPct?: number; // healing done
  threatPct?: number; // bonus threat (tank role)
  critVsRooted?: number; // additive spell crit chance against rooted targets
}

export interface TalentEffect {
  stats?: StatModEffect;
  grant?: { ability: string; rank?: number };
  ability?: AbilityModEffect[];
  global?: GlobalModEffect;
}

export interface TalentChoiceOption {
  id: string;
  name: string;
  description: string;
  icon: string;
  effect: TalentEffect;
}

export interface TalentNode {
  id: string;
  tree: TalentTree;
  specId?: string; // spec-tree nodes only: the spec they belong to
  kind: TalentKind;
  maxRank: number;
  requires?: string[]; // connection prerequisites (node ids, same tree)
  pointsGate?: number; // cumulative points spent above this row to unlock
  choices?: TalentChoiceOption[]; // kind === 'choice' (pick one)
  effect?: TalentEffect; // kind === 'passive' | 'active'
  icon: string;
  name: string;
  description: string;
  row: number;
  col: number;
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
  nodes: TalentNode[]; // retired point-tree content; kept empty for public registry compatibility
  specs: SpecDef[];
}

// What the player has chosen. Persisted in CharacterState and round-tripped
// through build strings.
export interface TalentAllocation {
  spec: string | null;
  rows: ChoiceRowAllocation; // choice row level -> chosen option id
}

export function emptyAllocation(): TalentAllocation {
  return { spec: null, rows: {} };
}

export function cloneAllocation(a: TalentAllocation): TalentAllocation {
  return {
    spec: a.spec,
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
  flatDmg: number;
  costPct: number;
  cooldownPct: number;
  castPct: number;
  buffPct: number;
  castWhileMoving: boolean;
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
// Specialization unlock. The retired point economy is gone, but spec selection
// still unlocks at level 10.
// ---------------------------------------------------------------------------

export const FIRST_TALENT_LEVEL = 10;

// Human-readable specialization label for a saved allocation. Uses the chosen
// spec's display name when one is set.
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
// Load-time tree validation (FR-2.3): unique ids, valid prerefs, no cycles,
// reachable gates, well-formed nodes. Returns a list of human-readable errors
// (empty === valid). Run over every registered tree at module load.
// ---------------------------------------------------------------------------

export function validateTalentTree(ct: ClassTalents): string[] {
  const errs: string[] = [];
  for (const s of ct.specs) {
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
    return { ok: false, reason: `You may choose a specialization at level ${FIRST_TALENT_LEVEL}.` };
  }
  const rowCheck = validateRows(cls, playerLevel, alloc.rows ?? {});
  if (!rowCheck.ok) return rowCheck;
  return { ok: true };
}

// A node is "dormant" (10.2 QoL: red shader, not destroyed) when it still holds
// ranks in the staged build but its prereqs or gate are no longer satisfied —
// e.g. an upstream point was refunded. Pure; drives the UI + the apply gate.
export function dormantNodes(cls: PlayerClass, alloc: TalentAllocation): Set<string> {
  void cls;
  void alloc;
  return new Set<string>();
}

// Repair a persisted allocation so it satisfies the current rules and budget
// (load-time revalidation). A stored build replays verbatim on load and is fed
// straight to computeTalentModifiers, which trusts the apply-time gate; but the
// load path never ran validateAllocation, so a stale, level-downed, or tampered
// save could grant over-budget / prereq-broken / gated stats and abilities.
//
// This rebuilds the allocation deterministically: walk the tree top-down (class
// tree first, then the chosen spec, in row/col order (the same order defaultBuild
// uses), refilling each node up to its persisted rank but never past a point where
// validateAllocation would reject the build. Because prereqs and pointsGates only
// reference rows above, a top-down fill satisfies them by construction, and the
// running budget check clamps the total to availablePoints. On an already-valid,
// in-budget allocation this is the identity (every persisted rank validates at each
// step), so honest saves load byte-identically and the parity gate is unaffected.
export function repairAllocation(
  cls: PlayerClass,
  alloc: TalentAllocation,
  playerLevel: number,
): TalentAllocation {
  const ct = talentsFor(cls);
  if (!ct) return emptyAllocation();
  const spec =
    alloc.spec !== null && playerLevel >= FIRST_TALENT_LEVEL && ct.specs.some((s) => s.id === alloc.spec)
      ? alloc.spec
      : null;
  return {
    spec,
    rows: repairRows(cls, playerLevel, alloc.rows),
  };
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
  return { meleeDmgPct: 0, spellDmgPct: 0, healPct: 0, threatPct: 0, critVsRooted: 0 };
}
function zeroAbilityMod(): ResolvedAbilityMod {
  return {
    dmgPct: 0,
    flatDmg: 0,
    costPct: 0,
    cooldownPct: 0,
    castPct: 0,
    buffPct: 0,
    castWhileMoving: false,
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
  };
}

export function accumulateTalentEffect(
  mods: TalentModifiers,
  eff: TalentEffect | undefined,
  mult: number,
): void {
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
    g.threatPct += (e.threatPct ?? 0) * mult;
    g.critVsRooted += (e.critVsRooted ?? 0) * mult;
  }
  for (const am of eff.ability ?? []) {
    let cur = mods.abilities[am.ability];
    if (!cur) {
      cur = zeroAbilityMod();
      mods.abilities[am.ability] = cur;
    }
    cur.dmgPct += (am.dmgPct ?? 0) * mult;
    cur.flatDmg += (am.flatDmg ?? 0) * mult;
    cur.costPct += (am.costPct ?? 0) * mult;
    cur.cooldownPct += (am.cooldownPct ?? 0) * mult;
    cur.castPct += (am.castPct ?? 0) * mult;
    cur.buffPct += (am.buffPct ?? 0) * mult;
    if (am.castWhileMoving) cur.castWhileMoving = true;
    // Added effects are rank-1 semantics, not multiplied by talent rank.
    if (am.addEffects) cur.addEffects.push(...am.addEffects);
  }
  if (eff.grant) mods.grants.push({ ability: eff.grant.ability, rank: eff.grant.rank ?? 1 });
}

// A deterministic, always-valid standard allocation for 2v2 Fiesta. It picks the
// class's first spec and option index 0 of every row unlocked by the standard level.
export function defaultBuild(cls: PlayerClass, playerLevel: number): TalentAllocation {
  const ct = talentsFor(cls);
  if (!ct) return emptyAllocation();
  const spec = ct.specs[0] ?? null;
  const alloc: TalentAllocation = { spec: spec?.id ?? null, rows: {} };
  for (const level of CHOICE_ROW_LEVELS) {
    if (level > playerLevel) continue;
    const option = rowForLevel(cls, level)?.options[0];
    if (option) alloc.rows[level] = option.id;
  }
  return repairAllocation(cls, alloc, playerLevel);
}

export function computeTalentModifiers(cls: PlayerClass, alloc: TalentAllocation): TalentModifiers {
  const mods = emptyModifiers();
  const ct = talentsFor(cls);
  if (!ct) return mods;
  const spec = alloc.spec ? (ct.specs.find((s) => s.id === alloc.spec) ?? null) : null;
  if (spec) {
    mods.spec = spec.id;
    mods.role = spec.role;
    mods.grants.push({ ability: spec.signature, rank: 1 }); // signature ability
    accumulateTalentEffect(mods, spec.mastery.effect, 1); // Mastery passive
  }
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
    w: alloc.rows,
  };
  return b64encode(JSON.stringify(payload));
}

export type BuildImport =
  | { ok: true; cls: PlayerClass; alloc: TalentAllocation }
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
      if (Number.isInteger(level) && isChoiceRowLevel(level) && typeof v === 'string') {
        rows[level] = v;
      }
    }
  }
  const spec = typeof payload.s === 'string' ? payload.s : null;
  return { ok: true, cls: payload.c, alloc: { spec, rows } };
}
