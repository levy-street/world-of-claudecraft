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

import { MAX_LEVEL, type PlayerClass } from '../types';
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
}

// Mastery-style global multipliers, applied to whole damage/heal schools when
// `known` is built (and to player threat in the Sim).
export interface GlobalModEffect {
  meleeDmgPct?: number; // physical ability damage
  spellDmgPct?: number; // magic ability damage
  healPct?: number; // healing done
  threatPct?: number; // bonus threat (tank role)
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
  nodes: TalentNode[]; // both trees; spec nodes carry `specId`
  specs: SpecDef[];
}

// What the player has chosen. Persisted in CharacterState and round-tripped
// through build strings.
export interface TalentAllocation {
  spec: string | null;
  ranks: Record<string, number>; // nodeId -> ranks spent
  choices: Record<string, string>; // choice nodeId -> chosen option id
}

export function emptyAllocation(): TalentAllocation {
  return { spec: null, ranks: {}, choices: {} };
}

export function cloneAllocation(a: TalentAllocation): TalentAllocation {
  return { spec: a.spec, ranks: { ...a.ranks }, choices: { ...a.choices } };
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

function nodeIndex(ct: ClassTalents): Map<string, TalentNode> {
  const m = new Map<string, TalentNode>();
  for (const n of ct.nodes) m.set(n.id, n);
  return m;
}

// ---------------------------------------------------------------------------
// Point economy — 1 point per level from FIRST_TALENT_LEVEL (11 points at the
// level-20 cap). Recomputed from level so a tuning change is migration-safe.
// ---------------------------------------------------------------------------

export const FIRST_TALENT_LEVEL = 10;

export function talentPointsAtLevel(level: number): number {
  return Math.max(0, Math.min(level, MAX_LEVEL) - (FIRST_TALENT_LEVEL - 1));
}

export function pointsSpent(alloc: TalentAllocation): number {
  let n = 0;
  for (const k in alloc.ranks) n += alloc.ranks[k];
  return n;
}

function _pointsSpentInTree(ct: ClassTalents, alloc: TalentAllocation, tree: TalentTree): number {
  const idx = nodeIndex(ct);
  let n = 0;
  for (const id in alloc.ranks) {
    const node = idx.get(id);
    if (node && node.tree === tree) n += alloc.ranks[id];
  }
  return n;
}

// Human-readable specialization label for a saved allocation. Uses the chosen
// spec's display name when one is set, otherwise derives the dominant spec tree
// (the spec with the most points spent). Returns null when no spec points are
// spent and none is chosen. Shared by the character sheet / public profile so
// spec display matches the in-game /talents readout.
export function specLabel(
  cls: PlayerClass,
  alloc: TalentAllocation | undefined | null,
): string | null {
  const ct = talentsFor(cls);
  if (!ct || !alloc) return null;
  if (alloc.spec) return ct.specs.find((s) => s.id === alloc.spec)?.name ?? null;
  const byId = nodeIndex(ct);
  const pointsBySpec = new Map<string, number>();
  for (const id in alloc.ranks) {
    const node = byId.get(id);
    if (!node || node.tree === 'class' || !node.specId) continue;
    pointsBySpec.set(node.specId, (pointsBySpec.get(node.specId) ?? 0) + alloc.ranks[id]);
  }
  let bestId: string | null = null;
  let best = 0;
  for (const [specId, pts] of pointsBySpec) {
    if (pts > best) {
      best = pts;
      bestId = specId;
    }
  }
  return bestId ? (ct.specs.find((s) => s.id === bestId)?.name ?? null) : null;
}

// Points spent in `node`'s tree on nodes strictly above its row — what a
// pointsGate is measured against (avoids the self-reference paradox).
function pointsAboveRow(ct: ClassTalents, alloc: TalentAllocation, node: TalentNode): number {
  const idx = nodeIndex(ct);
  let n = 0;
  for (const id in alloc.ranks) {
    const other = idx.get(id);
    if (other && other.tree === node.tree && other.specId === node.specId && other.row < node.row) {
      n += alloc.ranks[id];
    }
  }
  return n;
}

// ---------------------------------------------------------------------------
// Load-time tree validation (FR-2.3): unique ids, valid prerefs, no cycles,
// reachable gates, well-formed nodes. Returns a list of human-readable errors
// (empty === valid). Run over every registered tree at module load.
// ---------------------------------------------------------------------------

export function validateTalentTree(ct: ClassTalents): string[] {
  const errs: string[] = [];
  const idx = new Map<string, TalentNode>();
  const specIds = new Set(ct.specs.map((s) => s.id));

  for (const n of ct.nodes) {
    if (idx.has(n.id)) errs.push(`duplicate node id "${n.id}"`);
    idx.set(n.id, n);
    if (n.maxRank < 1) errs.push(`node "${n.id}" maxRank must be >= 1`);
    if (typeof n.row !== 'number' || typeof n.col !== 'number')
      errs.push(`node "${n.id}" missing layout`);
    if (n.tree === 'spec' && (!n.specId || !specIds.has(n.specId)))
      errs.push(`spec node "${n.id}" has invalid specId`);
    if (n.tree === 'class' && n.specId) errs.push(`class node "${n.id}" must not carry a specId`);
    if (n.kind === 'choice') {
      if (n.maxRank !== 1) errs.push(`choice node "${n.id}" must be single-rank`);
      if (!n.choices || n.choices.length < 2) errs.push(`choice node "${n.id}" needs >= 2 options`);
    } else if (!n.effect) {
      errs.push(`node "${n.id}" (${n.kind}) has no effect`);
    }
    if (
      n.pointsGate !== undefined &&
      (n.pointsGate < 0 || n.pointsGate > talentPointsAtLevel(MAX_LEVEL))
    ) {
      errs.push(`node "${n.id}" pointsGate ${n.pointsGate} is unreachable`);
    }
  }

  // prereq references must exist, sit in the same tree/spec, and be above this row
  for (const n of ct.nodes) {
    for (const req of n.requires ?? []) {
      const r = idx.get(req);
      if (!r) {
        errs.push(`node "${n.id}" requires missing node "${req}"`);
        continue;
      }
      if (r.tree !== n.tree || r.specId !== n.specId)
        errs.push(`node "${n.id}" requires "${req}" from a different tree`);
      if (r.row >= n.row) errs.push(`node "${n.id}" requires "${req}" which is not above it`);
    }
  }

  // cycle detection over the requires DAG
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  const visit = (id: string): boolean => {
    color.set(id, GRAY);
    for (const req of idx.get(id)?.requires ?? []) {
      const c = color.get(req) ?? WHITE;
      if (c === GRAY) return true;
      if (c === WHITE && visit(req)) return true;
    }
    color.set(id, BLACK);
    return false;
  };
  for (const n of ct.nodes) {
    if ((color.get(n.id) ?? WHITE) === WHITE && visit(n.id)) {
      errs.push(`cycle detected at "${n.id}"`);
      break;
    }
  }

  // specs reference real signature/mastery
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
  availablePoints: number,
): AllocCheck {
  const ct = talentsFor(cls);
  if (!ct) return { ok: false, reason: 'no talent tree for class' };
  const idx = nodeIndex(ct);

  if (alloc.spec !== null && !ct.specs.some((s) => s.id === alloc.spec)) {
    return { ok: false, reason: 'unknown specialization' };
  }

  let total = 0;
  for (const id in alloc.ranks) {
    const rank = alloc.ranks[id];
    if (rank <= 0) continue;
    const node = idx.get(id);
    if (!node) return { ok: false, reason: `unknown talent "${id}"` };
    if (rank > node.maxRank) return { ok: false, reason: `"${node.name}" exceeds max rank` };
    if (node.tree === 'spec' && node.specId !== alloc.spec) {
      return { ok: false, reason: `"${node.name}" belongs to another specialization` };
    }
    if (node.kind === 'choice' && !node.choices?.some((c) => c.id === alloc.choices[id])) {
      return { ok: false, reason: `"${node.name}" needs a valid choice` };
    }
    for (const req of node.requires ?? []) {
      if ((alloc.ranks[req] ?? 0) <= 0)
        return { ok: false, reason: `"${node.name}" requires "${idx.get(req)?.name ?? req}"` };
    }
    if (node.pointsGate && pointsAboveRow(ct, alloc, node) < node.pointsGate) {
      return { ok: false, reason: `"${node.name}" needs ${node.pointsGate} points spent above it` };
    }
    total += rank;
  }
  if (total > availablePoints) return { ok: false, reason: 'not enough talent points' };
  return { ok: true };
}

// A node is "dormant" (10.2 QoL: red shader, not destroyed) when it still holds
// ranks in the staged build but its prereqs or gate are no longer satisfied —
// e.g. an upstream point was refunded. Pure; drives the UI + the apply gate.
export function dormantNodes(cls: PlayerClass, alloc: TalentAllocation): Set<string> {
  const out = new Set<string>();
  const ct = talentsFor(cls);
  if (!ct) return out;
  const idx = nodeIndex(ct);
  for (const id in alloc.ranks) {
    if (alloc.ranks[id] <= 0) continue;
    const node = idx.get(id);
    if (!node) {
      out.add(id);
      continue;
    }
    if (node.tree === 'spec' && node.specId !== alloc.spec) {
      out.add(id);
      continue;
    }
    let dormant = false;
    for (const req of node.requires ?? []) if ((alloc.ranks[req] ?? 0) <= 0) dormant = true;
    if (node.pointsGate && pointsAboveRow(ct, alloc, node) < node.pointsGate) dormant = true;
    if (dormant) out.add(id);
  }
  return out;
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
  availablePoints: number,
): TalentAllocation {
  const ct = talentsFor(cls);
  if (!ct) return emptyAllocation();
  // A spec needs a known id AND at least one talent point available; below
  // FIRST_TALENT_LEVEL (availablePoints === 0) a spec is illegal (it would still
  // grant the signature ability + mastery passive), matching the apply-time gate.
  const spec =
    alloc.spec !== null && availablePoints > 0 && ct.specs.some((s) => s.id === alloc.spec)
      ? alloc.spec
      : null;
  const out: TalentAllocation = { spec, ranks: {}, choices: {} };
  const order = [...ct.nodes].sort((a, b) => {
    if (a.tree !== b.tree) return a.tree === 'class' ? -1 : 1;
    return a.row - b.row || a.col - b.col;
  });
  for (const node of order) {
    if (node.tree === 'spec' && node.specId !== spec) continue;
    const want = Math.floor(alloc.ranks[node.id] ?? 0);
    if (want <= 0) continue;
    if (node.kind === 'choice') {
      const chosen = alloc.choices[node.id];
      if (!node.choices?.some((c) => c.id === chosen)) continue;
      out.choices[node.id] = chosen;
      out.ranks[node.id] = 1;
      if (!validateAllocation(cls, out, availablePoints).ok) {
        delete out.ranks[node.id];
        delete out.choices[node.id];
      }
      continue;
    }
    const max = Math.min(want, node.maxRank);
    for (let target = 1; target <= max; target++) {
      out.ranks[node.id] = target;
      if (!validateAllocation(cls, out, availablePoints).ok) {
        if (target === 1) delete out.ranks[node.id];
        else out.ranks[node.id] = target - 1;
        break;
      }
    }
  }
  return out;
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
  return { meleeDmgPct: 0, spellDmgPct: 0, healPct: 0, threatPct: 0 };
}
function zeroAbilityMod(): ResolvedAbilityMod {
  return { dmgPct: 0, flatDmg: 0, costPct: 0, cooldownPct: 0, castPct: 0, buffPct: 0 };
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
    g.threatPct += (e.threatPct ?? 0) * mult;
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
  }
  if (eff.grant) mods.grants.push({ ability: eff.grant.ability, rank: eff.grant.rank ?? 1 });
}

// A deterministic, always-valid "balanced" allocation for a class — used by 2v2
// Fiesta to standardize everyone to the same level-20 build. Picks the class's
// first spec and greedily fills the budget node-by-node (class tree first, then
// the chosen spec, in row/col order), validating after every point so the result
// always satisfies prereqs, gates, and the point cap. Pure + deterministic.
export function defaultBuild(cls: PlayerClass, points: number): TalentAllocation {
  const ct = talentsFor(cls);
  if (!ct) return emptyAllocation();
  const spec = ct.specs[0] ?? null;
  const alloc: TalentAllocation = { spec: spec?.id ?? null, ranks: {}, choices: {} };
  const order = [...ct.nodes].sort((a, b) => {
    if (a.tree !== b.tree) return a.tree === 'class' ? -1 : 1;
    return a.row - b.row || a.col - b.col;
  });
  let spent = 0;
  for (const node of order) {
    if (spent >= points) break;
    if (node.tree === 'spec' && node.specId !== alloc.spec) continue;
    while (spent < points) {
      const cur = alloc.ranks[node.id] ?? 0;
      if (node.kind === 'choice') {
        if (cur >= 1) break;
        const opt = node.choices?.[0];
        if (!opt) break;
        alloc.choices[node.id] = opt.id;
        alloc.ranks[node.id] = 1;
        if (validateAllocation(cls, alloc, points).ok) {
          spent++;
          break;
        }
        delete alloc.ranks[node.id];
        delete alloc.choices[node.id];
        break;
      }
      if (cur >= node.maxRank) break;
      alloc.ranks[node.id] = cur + 1;
      if (validateAllocation(cls, alloc, points).ok) {
        spent++;
        continue;
      }
      if (cur === 0) delete alloc.ranks[node.id];
      else alloc.ranks[node.id] = cur;
      break;
    }
  }
  return alloc;
}

export function computeTalentModifiers(cls: PlayerClass, alloc: TalentAllocation): TalentModifiers {
  const mods = emptyModifiers();
  const ct = talentsFor(cls);
  if (!ct) return mods;
  const idx = nodeIndex(ct);

  const spec = alloc.spec ? (ct.specs.find((s) => s.id === alloc.spec) ?? null) : null;
  if (spec) {
    mods.spec = spec.id;
    mods.role = spec.role;
    mods.grants.push({ ability: spec.signature, rank: 1 }); // signature ability
    accumulate(mods, spec.mastery.effect, 1); // Mastery passive
  }

  for (const id in alloc.ranks) {
    const rank = alloc.ranks[id];
    if (rank <= 0) continue;
    const node = idx.get(id);
    if (!node) continue;
    if (node.tree === 'spec' && node.specId !== mods.spec) continue; // dormant: ignore
    if (node.kind === 'choice') {
      const opt = node.choices?.find((c) => c.id === alloc.choices[id]);
      if (opt) accumulate(mods, opt.effect, 1);
    } else {
      accumulate(mods, node.effect, rank);
    }
  }
  return mods;
}

// ---------------------------------------------------------------------------
// Import / export build strings (FR-6). Compact base64 of {version, class,
// spec, ranks, choices}. Import validates shape + version; the Sim re-validates
// the resulting allocation authoritatively before applying.
// ---------------------------------------------------------------------------

export const TALENT_BUILD_VERSION = 1;

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
    r: alloc.ranks,
    h: alloc.choices,
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
  const ranks: Record<string, number> = {};
  if (payload.r && typeof payload.r === 'object') {
    for (const k in payload.r) {
      const v = payload.r[k];
      if (typeof v === 'number' && v > 0) ranks[k] = Math.floor(v);
    }
  }
  const choices: Record<string, string> = {};
  if (payload.h && typeof payload.h === 'object') {
    for (const k in payload.h) {
      const v = payload.h[k];
      if (typeof v === 'string') choices[k] = v;
    }
  }
  const spec = typeof payload.s === 'string' ? payload.s : null;
  return { ok: true, cls: payload.c, alloc: { spec, ranks, choices } };
}
