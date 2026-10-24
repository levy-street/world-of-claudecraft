// The trash engine's "freeze at N stacks" slow (FreezeStackDef): every hit
// that carries it adds a stack to one slow aura on the victim, each stack
// slowing `perStack` more of the run speed for `seconds` (refreshed on every
// stack); the `maxStacks`-th stack freezes the victim solid instead (a stun of
// `freezeSeconds`) and clears the stacks, so the count starts again from
// nothing once the ice breaks. First consumer: the Rime Whelp's Rime Breath
// (gravewyrm_sanctum.ts); any on-hit or area mechanic can carry one.
//
// A slow-immune body takes no stacks and never freezes; a control-immune one
// stacks the slow but is never frozen. Zero rng.

import { MOBS } from '../../data';
import type { SimContext } from '../../sim_context';
import type { Aura, Entity, FreezeStackDef } from '../../types';

/** The slow multiplier a stack count leaves (never below a crawl). */
export function freezeStackSlow(def: FreezeStackDef, stacks: number): number {
  return Math.max(0.2, 1 - def.perStack * stacks);
}

/** Stacks the victim carries of this def (0 when none). */
export function freezeStacksOf(victim: Entity, def: FreezeStackDef): number {
  return victim.auras.find((a) => a.id === def.auraId)?.stacks ?? 0;
}

/**
 * Add one stack from `source`. Returns 'stack' (the slow deepened), 'frozen'
 * (the cap was reached: the victim is frozen and the stacks cleared) or
 * 'immune'.
 */
export function applyFreezeStack(
  ctx: SimContext,
  source: Entity,
  victim: Entity,
  def: FreezeStackDef,
  school: Aura['school'],
): 'stack' | 'frozen' | 'immune' {
  if (victim.dead) return 'immune';
  const template = victim.kind === 'mob' ? MOBS[victim.templateId] : undefined;
  if (template?.slowImmune) return 'immune';
  const existing = victim.auras.find((a) => a.id === def.auraId);
  const stacks = (existing?.stacks ?? 0) + 1;
  if (stacks >= def.maxStacks && !template?.ccImmune) {
    if (existing) {
      victim.auras.splice(victim.auras.indexOf(existing), 1);
      ctx.emit({ type: 'aura', targetId: victim.id, name: existing.name, gained: false });
    }
    ctx.applyAura(victim, {
      id: def.freezeAuraId,
      name: def.freezeName,
      kind: 'stun',
      remaining: def.freezeSeconds,
      duration: def.freezeSeconds,
      value: 0,
      sourceId: source.id,
      school,
    });
    ctx.emit({
      type: 'spellfx',
      sourceId: source.id,
      targetId: victim.id,
      school,
      fx: 'nova',
      ability: def.freezeAuraId,
    });
    return 'frozen';
  }
  const capped = Math.min(stacks, def.maxStacks - 1);
  if (existing) {
    existing.stacks = capped;
    existing.value = freezeStackSlow(def, capped);
    existing.remaining = def.seconds;
    existing.duration = def.seconds;
    existing.sourceId = source.id;
    return 'stack';
  }
  ctx.applyAura(victim, {
    id: def.auraId,
    name: def.name,
    kind: 'slow',
    remaining: def.seconds,
    duration: def.seconds,
    value: freezeStackSlow(def, 1),
    stacks: 1,
    sourceId: source.id,
    school,
  });
  return 'stack';
}
