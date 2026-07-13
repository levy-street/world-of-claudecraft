import type { SimContext } from '../sim_context';
import type { AuraKind, Entity } from '../types';

export function consumeAuraKind(ctx: SimContext, e: Entity, kind: AuraKind): boolean {
  const idx = e.auras.findIndex((a) => a.kind === kind);
  if (idx < 0) return false;
  const [aura] = e.auras.splice(idx, 1);
  ctx.emit({ type: 'aura', targetId: e.id, name: aura.name, gained: false });
  return true;
}

export function hasNextCastFree(e: Entity): boolean {
  return e.auras.some((a) => a.kind === 'next_cast_free');
}

export function consumeNextCastFree(ctx: SimContext, e: Entity): boolean {
  return consumeAuraKind(ctx, e, 'next_cast_free');
}

// Battle Trance (warrior baseline, excluding Fury): the ability-SCOPED sibling
// of next_cast_free. Connected auto swings arm the aura (auto_attack.ts), but
// NOT for Fury, which owns none of the consuming abilities below; only these
// abilities may spend it. The action bar imports the same predicate for its
// proc glow / usable state, so sim and UI can never disagree on scope.
// Maiming Strike is Arms-granted, so it only participates for committed Arms
// (its owner restructure 2026-07-08 free-proc), never for Fury / no-spec.
export const BATTLE_TRANCE_ABILITIES: ReadonlySet<string> = new Set([
  'heroic_strike',
  'slam',
  'mortal_strike',
]);

// Revenge free-cost proc (Protection): the dodge/parry-armed sibling of
// battle_trance. Applied in mobSwing when the warrior dodges or parries; only
// Revenge may spend it. The action bar imports the same predicate for its proc
// glow / usable state, so sim and UI can never disagree on scope.
export const REVENGE_FREE_ABILITIES: ReadonlySet<string> = new Set(['revenge']);

/** Pure aura-list predicate: is `abilityId`'s cost covered by a free-cost
 *  proc? Structural input so the UI drives it with a mirrored aura list. */
export function freeCostAuraActive(auras: readonly { kind: string }[], abilityId: string): boolean {
  for (const a of auras) {
    if (a.kind === 'next_cast_free') return true;
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
  if (consumeNextCastFree(ctx, e)) return true;
  if (BATTLE_TRANCE_ABILITIES.has(abilityId) && consumeAuraKind(ctx, e, 'battle_trance'))
    return true;
  if (abilityId === 'execute' && consumeAuraKind(ctx, e, 'sudden_death')) return true;
  return REVENGE_FREE_ABILITIES.has(abilityId) && consumeAuraKind(ctx, e, 'revenge_free');
}

export function consumeNextCastInstant(ctx: SimContext, e: Entity): boolean {
  return consumeAuraKind(ctx, e, 'next_cast_instant');
}

export function consumeNextAttackCrit(ctx: SimContext, e: Entity): boolean {
  return consumeAuraKind(ctx, e, 'next_attack_crit');
}
