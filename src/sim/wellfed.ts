// Well Fed: the buff-dish completion arm (farming Phase 11).
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
//
// NAMESPACE: the aura id is wellfed_<kind> (today wellfed_buff_sta), a
// deliberate sibling of the elixir arm's elixir_<kind> (src/sim/items.ts).
// Aura replacement keys on aura.id + sourceId (auraReplacementConflicts,
// src/sim/combat/aura_stacking.ts), so food and an elixir of the SAME stat
// kind coexist and neither ever clobbers the other, while all buff dishes of
// one kind share one id: last eaten wins, exactly like same-kind elixirs.
//
// This function draws ZERO rng (no Rng access at all): the mint is a pure
// def lookup plus applyAura, so the shared draw stream is untouched. The
// minted aura is TRANSIENT across save/load: no persistence path serializes
// entity auras (serializeCharacter carries no auras key), so a relog drops
// the buff, matching every other temporary aura.

import { ITEMS } from './data';
import type { SimContext } from './sim_context';
import type { Consuming, Entity } from './types';

/**
 * Mint the Well Fed buff for a just-completed meal. Called from updateRegen
 * (src/sim/combat/auras.ts) at the moment the consume timer runs out, before
 * the slot is nulled. A dish without a `wellfed` field (every plain food and
 * all drinks) is a no-op.
 */
export function applyWellfedOnConsumeComplete(
  ctx: SimContext,
  p: Entity,
  consumed: Consuming,
): void {
  // FOOD ONLY, by contract (D15: well-fed is buff FOOD): the completion hook
  // fires for both consume slots, so this guard is what keeps a future drink
  // record carrying a wellfed field from silently minting at gulp completion
  // with nothing having decided that. tests/wellfed.test.ts pins both the
  // guard and the content-level rule (every wellfed carrier is kind 'food').
  if (consumed.kind !== 'food') return;
  const dishDef = ITEMS[consumed.itemId];
  const w = dishDef && 'wellfed' in dishDef ? dishDef.wellfed : undefined;
  if (!w) return;
  // Field for field the elixir arm's applyAura call (src/sim/items.ts), with
  // the wellfed_ id prefix carrying the coexistence rule above. No log emit:
  // the aura-gain event already covers the feedback (keeps S3 clean).
  ctx.applyAura(p, {
    id: `wellfed_${w.kind}`,
    name: w.aura,
    kind: w.kind,
    remaining: w.duration,
    duration: w.duration,
    value: w.value,
    sourceId: p.id,
    school: 'nature',
  });
}
