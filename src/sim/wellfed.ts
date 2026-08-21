// Well Fed: the buff-food completion mint, unified (Masterwrought 11c).
//
// TIMING (locked design decision): the buff applies at COMPLETION of the 18s
// sit-restore (CONSUME_DURATION), the sit-through-the-meal ritual, never on
// the first bite. The immediate-on-consume alternative was rejected because a
// full buff for one bite defeats the ritual and the interruption cost. An
// interrupted meal (damage, death, match reset: anything that nulls the
// eating slot before its timer runs out) forfeits the buff entirely.
//
// HOOK: the one natural completion site is src/sim/combat/auras.ts
// updateRegen, in the eating/drinking loop where `c.remaining <= 0` nulls the
// slot. That is the only place a meal finishes on its own; every other exit
// from the slot is an interruption and correctly never reaches this function.
// The order there is clear-then-grant: the slot is nulled BEFORE this mint
// runs, so the meal is already over from every reader's point of view when
// applyAura lands.
//
// ONE AURA ID: every well-fed food shares WELL_FED_AURA_ID ('well_fed'),
// kind-agnostic, no <kind> suffix. This is the classic one-food-buff rule:
// aura replacement keys on aura.id + sourceId (auraReplacementConflicts,
// src/sim/combat/aura_stacking.ts) and Well Fed is self-sourced, so the whole
// food family is one-at-a-time and the newest meal always replaces the last,
// whatever stat it carries. The single id is the STRONGER rule than the
// retired per-kind wellfed_<kind> namespace: under per-kind ids two dishes of
// different stats could stack, which no classic food buff ever did. Elixir
// coexistence still holds for free, because 'well_fed' can never equal an
// 'elixir_<kind>' id; no group registration and no new stacking mechanism is
// involved.
//
// This function draws ZERO rng (no Rng access at all): the mint is a pure
// applyAura over the payload the meal CARRIED (Consuming.wellFed, copied off
// FoodItemDef.wellFed at sit-down by the src/sim/consuming.ts builder), so
// the shared draw stream is untouched and no catalog lookup happens here.
// The minted aura is TRANSIENT across save/load: no persistence path
// serializes entity auras (serializeCharacter carries no auras key), so a
// relog drops the buff, matching every other temporary aura.

import type { SimContext } from './sim_context';
import type { Entity, TimedStatBuffPayload } from './types';

/** The one Well Fed aura id, shared by every well-fed food. */
export const WELL_FED_AURA_ID = 'well_fed';

/**
 * Mint the Well Fed buff for a just-completed meal. Called from the
 * updateRegen completion site AFTER the consuming slot is nulled
 * (clear-then-grant); `wellFed` is the payload the meal carried, so the
 * grant is decided by what was eaten, not by what the catalog says now.
 * A meal that carried no payload (every drink and every plain food) is a
 * no-op. The kind guard the old farming module needed is unrepresentable
 * now: only FoodItemDef can spell a wellFed payload (types beat guards),
 * so no drink record can ever carry one into this call.
 */
export function applyWellFedOnMealComplete(
  ctx: SimContext,
  p: Entity,
  wellFed: TimedStatBuffPayload | undefined,
): void {
  if (!wellFed) return;
  // Field for field the elixir arm's applyAura call (src/sim/items.ts), on
  // the one shared id carrying the one-at-a-time rule above. No log emit:
  // the aura-gain event already covers the feedback (keeps S3 clean).
  ctx.applyAura(p, {
    id: WELL_FED_AURA_ID,
    name: wellFed.aura,
    kind: wellFed.kind,
    remaining: wellFed.duration,
    duration: wellFed.duration,
    value: wellFed.value,
    sourceId: p.id,
    school: 'nature',
  });
}
