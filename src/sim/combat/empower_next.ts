import type { SimContext } from '../sim_context';
import type { Aura, AuraKind, Entity } from '../types';

// An empowerment aura may be ability-scoped (talent procs set empowerAbilities);
// an unscoped aura (item sets, fiesta powerups) matches any cast.
function matches(a: Aura, abilityId?: string): boolean {
  if (!a.empowerAbilities) return true;
  return abilityId !== undefined && a.empowerAbilities.includes(abilityId);
}

export function consumeAuraKind(
  ctx: SimContext,
  e: Entity,
  kind: AuraKind,
  abilityId?: string,
): Aura | null {
  const idx = e.auras.findIndex((a) => a.kind === kind && matches(a, abilityId));
  if (idx < 0) return null;
  const [aura] = e.auras.splice(idx, 1);
  ctx.emit({ type: 'aura', targetId: e.id, name: aura.name, gained: false, auraKind: aura.kind });
  return aura;
}

export function hasNextCastFree(e: Entity, abilityId?: string): boolean {
  return e.auras.some(
    (a) => (a.kind === 'next_cast_free' || a.kind === 'next_execute_free') && matches(a, abilityId),
  );
}

export function hasNextExecuteFree(e: Entity, abilityId: string): boolean {
  return e.auras.some(
    (a) =>
      (a.kind === 'next_execute_free' && matches(a, abilityId)) ||
      (abilityId === 'execute' && a.kind === 'sudden_death'),
  );
}

/** Returns a matching cheap-cast multiplier without consuming its aura. */
export function nextCastCheapMultiplier(e: Entity, abilityId?: string): number | null {
  const aura = e.auras.find((a) => a.kind === 'next_cast_cheap' && matches(a, abilityId));
  return aura?.value ?? null;
}

export function consumeNextCastFree(ctx: SimContext, e: Entity, abilityId?: string): boolean {
  return (
    consumeAuraKind(ctx, e, 'next_cast_free', abilityId) !== null ||
    consumeAuraKind(ctx, e, 'next_execute_free', abilityId) !== null
  );
}

// Battle Trance (warrior baseline, excluding Fury): the ability-SCOPED sibling
// of next_cast_free. Connected auto swings arm the aura (auto_attack.ts), but
// NOT for Fury, which owns none of the consuming abilities below; only these
// abilities may spend it. The action bar imports the same predicate for its
// proc glow / usable state, so sim and UI can never disagree on scope.
// Maiming Strike is Arms-granted, so it only participates for committed Arms
// (its owner restructure 2026-07-08 free-proc), never for Fury / no-spec.
// Brute Swing (slam) left the scope 2026-07-10 with its redesign into the free
// Arms rage builder: a 0-cost ability can never spend a free-cost proc.
export const BATTLE_TRANCE_ABILITIES: ReadonlySet<string> = new Set([
  'heroic_strike',
  'mortal_strike',
]);

// Revenge free-cost proc (Protection): the dodge/parry-armed sibling of
// battle_trance. Applied in mobSwing when the warrior dodges or parries; only
// Revenge may spend it. The action bar imports the same predicate for its proc
// glow / usable state, so sim and UI can never disagree on scope.
export const REVENGE_FREE_ABILITIES: ReadonlySet<string> = new Set(['revenge']);

/** Pure aura-list predicate: is `abilityId`'s cost covered by a free-cost
 *  proc? Structural input so the UI drives it with a mirrored aura list. */
export function freeCostAuraActive(
  auras: readonly { kind: string; empowerAbilities?: string[] }[],
  abilityId: string,
): boolean {
  for (const a of auras) {
    if (
      (a.kind === 'next_cast_free' || a.kind === 'next_execute_free') &&
      (a.empowerAbilities === undefined || a.empowerAbilities.includes(abilityId))
    )
      return true;
    if (a.kind === 'battle_trance' && BATTLE_TRANCE_ABILITIES.has(abilityId)) return true;
    if (a.kind === 'revenge_free' && REVENGE_FREE_ABILITIES.has(abilityId)) return true;
    // Sudden Death (Arms): a free Early Grave (execute); the HP gate is bypassed
    // in casting_lifecycle when this aura is worn.
    if (a.kind === 'sudden_death' && abilityId === 'execute') return true;
  }
  return false;
}

export function hasFreeCostFor(e: Entity, abilityId: string): boolean {
  return freeCostAuraActive(e.auras, abilityId);
}

/** Consume whichever free-cost proc covers `abilityId` (the generic
 *  next_cast_free first, then a scope-matched Battle Trance). */
export function consumeFreeCostFor(ctx: SimContext, e: Entity, abilityId: string): boolean {
  // Pass the ability id so an ability-SCOPED next_cast_free aura (empowerAbilities
  // set by a talent proc, e.g. Searing Light / Fault Line) is only spent by an
  // ability it actually empowers. An unscoped aura still matches any cast.
  if (consumeNextCastFree(ctx, e, abilityId)) return true;
  if (BATTLE_TRANCE_ABILITIES.has(abilityId) && consumeAuraKind(ctx, e, 'battle_trance'))
    return true;
  if (abilityId === 'execute' && consumeAuraKind(ctx, e, 'sudden_death')) return true;
  return REVENGE_FREE_ABILITIES.has(abilityId) && consumeAuraKind(ctx, e, 'revenge_free') !== null;
}

export function consumeNextCastInstant(ctx: SimContext, e: Entity, abilityId?: string): boolean {
  return consumeAuraKind(ctx, e, 'next_cast_instant', abilityId) !== null;
}

// Unscoped instant-cast effects remain spell-only, but a talent proc that names a
// specific physical cast-time ability (Long Draw) is allowed to empower it.
export function hasScopedNextCastInstant(e: Entity, abilityId: string): boolean {
  return e.auras.some(
    (a) =>
      a.kind === 'next_cast_instant' &&
      a.empowerAbilities !== undefined &&
      a.empowerAbilities.includes(abilityId),
  );
}

/** Returns the cost multiplier (e.g. 0.5) or null when no cheap charge matches. */
export function consumeNextCastCheap(
  ctx: SimContext,
  e: Entity,
  abilityId?: string,
): number | null {
  const aura = consumeAuraKind(ctx, e, 'next_cast_cheap', abilityId);
  return aura ? aura.value : null;
}

export function consumeNextAttackCrit(ctx: SimContext, e: Entity): boolean {
  return consumeAuraKind(ctx, e, 'next_attack_crit') !== null;
}
