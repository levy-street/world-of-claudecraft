// Talent application, extracted from the Sim monolith (G1a).
//
// This module owns the sim-side talent METHOD layer: validate a staged allocation,
// re-bake the flat `TalentModifiers` struct, and manage specs + the named loadouts.
// The declarative trees + the pure helpers (`computeTalentModifiers`/
// `validateAllocation`/`talentsFor`) live in `content/talents` and are imported, never
// touched here.
//
// PRIME DIRECTIVE: this is a MOVE, not a rewrite. Every function below is the former
// `Sim` method verbatim, with `this.X` rewritten to `ctx.X` (the SimContext seam) or to
// a sibling function in this module. Statement order, branch order, validation order,
// and the in-place mutation (the refactor's immutability waiver: `r.meta.talents = ...`,
// `loadouts.push`, `delete cand.ranks[id]`, `meta.talentMods = ...`) are preserved
// exactly so the parity gate's full-state trace AND rng draw-order log stay byte-
// identical. Talent application draws NO rng.
//
// HOT-PATH INVARIANT: `recomputeTalents` is the SOLE place a talent tree is walked.
// The flat `meta.talentMods` struct is baked once per allocation change and read on the
// combat/stat hot path; never walk the tree per-tick, never add a second recompute site.
//
// FIESTA COUPLING: the stat pass reads modifiers through `ctx.playerMods(meta)` =
// `meta.fiestaMods ?? meta.talentMods`, NOT raw `meta.talentMods`, so a recompute during
// an active Fiesta bout keeps the augment overlay. The `ctx.playerMods(meta)` call is
// moved verbatim; do not "simplify" it to `meta.talentMods`.
//
// STATE STAYS ON Sim. The back-compat talent getters (`talents`/`talentSpec`/...),
// `playerMods`, `refreshKnownAbilities`, and `resolvedAbility` remain on `Sim`; this
// module reaches the ones it needs through SimContext. `Sim` keeps thin wrapper methods
// that delegate here (passing `this.ctx`), so the `IWorld`/server-command surface
// (`sim.applyTalents(...)` etc.) is unchanged.
//
// `src/sim`-pure: no DOM/Three/render/ui/game/net imports, no Math.random/Date.now
// (enforced by tests/architecture.test.ts).

import {
  cloneAllocation,
  computeTalentModifiers,
  FIRST_TALENT_LEVEL,
  MAX_LOADOUTS,
  pointsSpent,
  repairAllocation,
  SAVED_LOADOUT_BAR_SLOTS,
  type SavedLoadout,
  type TalentAllocation,
  talentPointsAtLevel,
  talentsFor,
  validateAllocation,
} from '../content/talents';
import { recalcPlayerStats } from '../entity';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

// The ONLY place a talent tree is walked. Re-resolves the flat modifier struct and
// refreshes the stat pass + known-ability resolver that consume it.
function recomputeTalents(ctx: SimContext, meta: PlayerMeta): void {
  meta.talentMods = computeTalentModifiers(meta.cls, meta.talents);
  const e = ctx.entities.get(meta.entityId);
  if (e) recalcPlayerStats(e, meta.cls, meta.equipment, ctx.playerMods(meta));
  ctx.refreshKnownAbilities(meta, false);
}

function talentLockReason(ctx: SimContext, p: Entity): string | null {
  if (p.inCombat) return 'You cannot change talents in combat.';
  if (ctx.arenaMatches.has(p.id)) return 'You cannot change talents during an arena match.';
  return null;
}

export function talentPointBudget(ctx: SimContext, pid?: number): { total: number; spent: number } {
  const r = ctx.resolve(pid);
  if (!r) return { total: 0, spent: 0 };
  return { total: talentPointsAtLevel(r.e.level), spent: pointsSpent(r.meta.talents) };
}

function sanitizeTalentAllocation(alloc: TalentAllocation): TalentAllocation {
  const sanitized: TalentAllocation = {
    spec: alloc.spec ?? null,
    ranks: {},
    choices: { ...alloc.choices },
  };
  for (const id in alloc.ranks) {
    const v = Math.floor(alloc.ranks[id]);
    if (v > 0) sanitized.ranks[id] = v;
  }
  return sanitized;
}

// Commit a whole staged allocation in one shot (the UI's "Apply"). Rejects any
// allocation that fails server-side validation with a reason event (FR-4.5).
export function applyTalentAllocation(
  ctx: SimContext,
  alloc: TalentAllocation,
  pid?: number,
): boolean {
  const r = ctx.resolve(pid);
  if (!r) return false;
  const lock = talentLockReason(ctx, r.e);
  if (lock) {
    ctx.error(r.e.id, lock);
    return false;
  }
  const sanitized = sanitizeTalentAllocation(alloc);
  if (sanitized.spec && r.e.level < FIRST_TALENT_LEVEL) {
    ctx.error(r.e.id, `You may choose a specialization at level ${FIRST_TALENT_LEVEL}.`);
    return false;
  }
  const check = validateAllocation(r.meta.cls, sanitized, talentPointsAtLevel(r.e.level));
  if (!check.ok) {
    ctx.error(r.e.id, check.reason ?? 'Invalid talent build.');
    return false;
  }
  r.meta.talents = sanitized;
  recomputeTalents(ctx, r.meta);
  ctx.emit({ type: 'log', pid: r.e.id, text: 'Talents updated.', color: '#ffd100' });
  return true;
}

// Spend a single point into a node (incremental API; the UI mostly stages then
// applies). Validated identically by building + checking a candidate alloc.
export function spendTalentPoint(ctx: SimContext, nodeId: string, pid?: number): boolean {
  const r = ctx.resolve(pid);
  if (!r) return false;
  const cand = cloneAllocation(r.meta.talents);
  cand.ranks[nodeId] = (cand.ranks[nodeId] ?? 0) + 1;
  return applyTalentAllocation(ctx, cand, pid);
}

// Choose / change specialization. Switching specs drops the previous spec
// tree's points (they belonged to that tree); the class tree is untouched.
export function setTalentSpec(ctx: SimContext, specId: string | null, pid?: number): boolean {
  const r = ctx.resolve(pid);
  if (!r) return false;
  const lock = talentLockReason(ctx, r.e);
  if (lock) {
    ctx.error(r.e.id, lock);
    return false;
  }
  const ct = talentsFor(r.meta.cls);
  if (specId !== null && !ct?.specs.some((s) => s.id === specId)) {
    ctx.error(r.e.id, 'Unknown specialization.');
    return false;
  }
  const cand = cloneAllocation(r.meta.talents);
  cand.spec = specId;
  for (const id of Object.keys(cand.ranks)) {
    const node = ct?.nodes.find((n) => n.id === id);
    if (node?.tree === 'spec' && node.specId !== specId) {
      delete cand.ranks[id];
      delete cand.choices[id];
    }
  }
  return applyTalentAllocation(ctx, cand, pid);
}

// Free respec (out of combat): wipe all talent points. Spec is retained.
export function respecTalents(ctx: SimContext, pid?: number): boolean {
  const r = ctx.resolve(pid);
  if (!r) return false;
  const lock = talentLockReason(ctx, r.e);
  if (lock) {
    ctx.error(r.e.id, lock);
    return false;
  }
  r.meta.talents = { spec: r.meta.talents.spec, ranks: {}, choices: {} };
  recomputeTalents(ctx, r.meta);
  ctx.emit({ type: 'log', pid: r.e.id, text: 'Talents reset.', color: '#ffd100' });
  return true;
}

// Save the current build (talents + spec + the given action-bar slot map) as a
// named loadout. A same-named loadout is overwritten; otherwise appended up to
// MAX_LOADOUTS. Returns the loadout index (-1 on failure).
export function saveTalentLoadout(
  ctx: SimContext,
  name: string,
  bar: (string | null)[],
  pidOrAlloc?: number | TalentAllocation,
  allocMaybe?: TalentAllocation,
): number {
  const pid = typeof pidOrAlloc === 'number' ? pidOrAlloc : undefined;
  const alloc = typeof pidOrAlloc === 'object' ? pidOrAlloc : allocMaybe;
  const r = ctx.resolve(pid);
  if (!r) return -1;
  if (alloc) {
    const lock = talentLockReason(ctx, r.e);
    if (lock) {
      ctx.error(r.e.id, lock);
      return -1;
    }
    const sanitized = sanitizeTalentAllocation(alloc);
    if (sanitized.spec && r.e.level < FIRST_TALENT_LEVEL) {
      ctx.error(r.e.id, `You may choose a specialization at level ${FIRST_TALENT_LEVEL}.`);
      return -1;
    }
    const check = validateAllocation(r.meta.cls, sanitized, talentPointsAtLevel(r.e.level));
    if (!check.ok) {
      ctx.error(r.e.id, check.reason ?? 'Invalid talent build.');
      return -1;
    }
    r.meta.talents = sanitized;
    recomputeTalents(ctx, r.meta);
  }
  const clean = (name || 'Build').toString().slice(0, 24);
  const safeBar = Array.isArray(bar)
    ? bar.slice(0, SAVED_LOADOUT_BAR_SLOTS).map((b) => (typeof b === 'string' ? b : null))
    : [];
  const lo: SavedLoadout = { name: clean, alloc: cloneAllocation(r.meta.talents), bar: safeBar };
  const existing = r.meta.loadouts.findIndex((l) => l.name === clean);
  if (existing >= 0) {
    r.meta.loadouts[existing] = lo;
    r.meta.activeLoadout = existing;
    ctx.emit({ type: 'log', pid: r.e.id, text: `Saved build "${clean}".`, color: '#ffd100' });
    return existing;
  }
  if (r.meta.loadouts.length >= MAX_LOADOUTS) {
    ctx.error(r.e.id, `You can save at most ${MAX_LOADOUTS} loadouts.`);
    return -1;
  }
  r.meta.loadouts.push(lo);
  r.meta.activeLoadout = r.meta.loadouts.length - 1;
  ctx.emit({ type: 'log', pid: r.e.id, text: `Saved build "${clean}".`, color: '#ffd100' });
  return r.meta.activeLoadout;
}

// Apply a saved loadout's talents (out of combat). The action bar is restored
// client-side from the loadout's stored slot map. Re-validated server-side.
export function switchTalentLoadout(ctx: SimContext, index: number, pid?: number): boolean {
  const r = ctx.resolve(pid);
  if (!r) return false;
  const lock = talentLockReason(ctx, r.e);
  if (lock) {
    ctx.error(r.e.id, lock);
    return false;
  }
  const lo = r.meta.loadouts[index];
  if (!lo) {
    ctx.error(r.e.id, 'No such loadout.');
    return false;
  }
  if (lo.alloc.spec && r.e.level < FIRST_TALENT_LEVEL) {
    ctx.error(r.e.id, 'That loadout needs a higher level.');
    return false;
  }
  const check = validateAllocation(r.meta.cls, lo.alloc, talentPointsAtLevel(r.e.level));
  if (!check.ok) {
    ctx.error(r.e.id, `Loadout invalid: ${check.reason ?? 'unknown'}`);
    return false;
  }
  r.meta.talents = cloneAllocation(lo.alloc);
  r.meta.activeLoadout = index;
  recomputeTalents(ctx, r.meta);
  ctx.emit({
    type: 'log',
    pid: r.e.id,
    text: `Loadout "${lo.name}" applied.`,
    color: '#ffd100',
  });
  return true;
}

export function deleteTalentLoadout(ctx: SimContext, index: number, pid?: number): boolean {
  const r = ctx.resolve(pid);
  if (!r || index < 0 || index >= r.meta.loadouts.length) return false;
  const wasActive = r.meta.activeLoadout === index;
  const name = r.meta.loadouts[index].name;
  r.meta.loadouts.splice(index, 1);
  if (wasActive) {
    r.meta.activeLoadout =
      r.meta.loadouts.length > 0 ? Math.min(index, r.meta.loadouts.length - 1) : -1;
    const next = r.meta.activeLoadout >= 0 ? r.meta.loadouts[r.meta.activeLoadout] : null;
    if (next) {
      // This is an AUTO-apply (no user gate), so repair against the level budget
      // first: switchTalentLoadout validates on its path, but here a stale or
      // tampered next loadout would otherwise be baked into live mods wholesale.
      r.meta.talents = repairAllocation(r.meta.cls, next.alloc, talentPointsAtLevel(r.e.level));
      recomputeTalents(ctx, r.meta);
    }
  } else if (r.meta.activeLoadout > index) r.meta.activeLoadout -= 1;
  ctx.emit({ type: 'log', pid: r.e.id, text: `Deleted build "${name}".`, color: '#ffd100' });
  return true;
}
