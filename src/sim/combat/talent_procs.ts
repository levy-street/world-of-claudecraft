// Talent proc engine: the shared primitive behind behavior-changing choice-row
// options (docs/design/choice-row-quality-pass.md). A row option carries a
// declarative ProcDef; combat code reports moments (cast completed, crit,
// shield consumed, HoT expired, big hit taken, imbued swing) through single
// delegating calls here, and this module holds the per-player counters and
// internal cooldowns and applies the response. Everything is plain tick math:
// no rng, nothing persisted, so replay determinism is untouched.

import type { SimContext } from '../sim_context';
import type { Entity, ResourceType } from '../types';

export type ProcTrigger =
  | { on: 'castNth'; n: number; abilities: string[] }
  | { on: 'spellCrit'; abilities?: string[] }
  | { on: 'shieldConsumed'; ability: string }
  | { on: 'hotExpired'; ability: string }
  | { on: 'bigHitTaken'; hpFrac: number; icd: number }
  | { on: 'meleeSwingWhile'; auraKind: string }
  // A thorns aura reflected a hit. `ability` scopes the trigger to the
  // originating aura id (for example, Thunder Ward / lightning_shield).
  | { on: 'thornsReflect'; ability: string };

export type ProcResponse =
  | {
      kind: 'empowerNext';
      aura: 'next_cast_free' | 'next_execute_free' | 'next_cast_instant' | 'next_cast_cheap';
      abilities?: string[]; // which casts may consume it (undefined = any)
      duration: number;
      costPct?: number; // next_cast_cheap: fraction of the cost removed (0.5 = half off)
    }
  | { kind: 'cooldownRefund'; ability: string; seconds: number | 'reset' }
  | { kind: 'resource'; amount: number; resourceType?: ResourceType }
  | { kind: 'heal'; amount: number }
  | { kind: 'absorb'; amount: number; duration: number; name: string }
  | { kind: 'echo'; belowFrac: number; window: number; heal: number; name: string };

export interface ProcDef {
  id: string; // stable id: the counter/icd key and the granted aura id
  name: string; // display name for granted auras (localized via sim_i18n)
  // Visual school for the proc's spellfx moments (default holy).
  school?: 'physical' | 'fire' | 'frost' | 'arcane' | 'shadow' | 'holy' | 'nature';
  trigger: ProcTrigger;
  responses: ProcResponse[];
}

// Transient per-player proc state. Lives on Entity.procState (see types.ts),
// created lazily, reset on death, never serialized.
export interface ProcState {
  counters: Record<string, number>;
  icds: Record<string, number>;
}

function state(e: Entity): ProcState {
  if (!e.procState) e.procState = { counters: {}, icds: {} };
  return e.procState;
}

/** Tick down internal cooldowns; called once per tick from updateAuras. */
export function tickProcState(e: Entity, dt: number): void {
  const s = e.procState;
  if (!s) return;
  for (const k of Object.keys(s.icds)) {
    s.icds[k] -= dt;
    if (s.icds[k] <= 0) delete s.icds[k];
  }
}

export function resetProcState(e: Entity): void {
  e.procState = undefined;
}

function procsFor(ctx: SimContext, p: Entity): ProcDef[] {
  const meta = ctx.players.get(p.id);
  return meta ? ctx.playerMods(meta).procs : [];
}

function fire(ctx: SimContext, p: Entity, def: ProcDef, subject: Entity): void {
  for (const r of def.responses) fireOne(ctx, p, def, subject, r);
}

function fireOne(ctx: SimContext, p: Entity, def: ProcDef, subject: Entity, r: ProcResponse): void {
  switch (r.kind) {
    case 'empowerNext':
      // Refresh-not-stack: one pending empowerment per proc id.
      if (!p.auras.some((a) => a.id === def.id)) {
        ctx.applyAura(p, {
          id: def.id,
          name: def.name,
          kind: r.aura,
          remaining: r.duration,
          duration: r.duration,
          value: r.costPct !== undefined ? 1 - r.costPct : 0,
          sourceId: p.id,
          school: def.school ?? 'holy',
          empowerAbilities: r.abilities,
        });
        // The arming moment: a visible surge so the player feels the rhythm hit.
        ctx.emit({
          type: 'spellfx',
          sourceId: p.id,
          targetId: p.id,
          school: def.school ?? 'holy',
          fx: 'procSurge',
        });
      }
      break;
    case 'cooldownRefund': {
      const cur = p.cooldowns.get(r.ability);
      if (cur !== undefined) {
        if (r.seconds === 'reset') p.cooldowns.delete(r.ability);
        else if (cur - r.seconds <= 0) p.cooldowns.delete(r.ability);
        else p.cooldowns.set(r.ability, cur - r.seconds);
      }
      break;
    }
    case 'resource':
      if (r.resourceType !== undefined && p.resourceType !== r.resourceType) break;
      p.resource = Math.min(p.maxResource, p.resource + r.amount);
      break;
    case 'heal':
      ctx.applyHeal(p, subject, r.amount, def.name);
      break;
    case 'absorb':
      ctx.applyAura(subject, {
        id: def.id,
        name: def.name,
        kind: 'absorb',
        remaining: r.duration,
        duration: r.duration,
        value: r.amount,
        sourceId: p.id,
        school: def.school ?? 'holy',
      });
      ctx.emit({
        type: 'spellfx',
        sourceId: p.id,
        targetId: subject.id,
        school: def.school ?? 'holy',
        fx: 'wardBloom',
      });
      break;
    case 'echo':
      // applyAura replaces the same source+id, so repeated qualifying casts
      // refresh the echo's window and payload without stacking duplicates.
      ctx.applyAura(subject, {
        id: def.id,
        name: def.name,
        kind: 'heal_echo',
        remaining: r.window,
        duration: r.window,
        value: r.heal,
        value2: r.belowFrac,
        sourceId: p.id,
        school: 'holy',
      });
      break;
  }
}

/** A cast completed (casting_lifecycle). Drives castNth counters. The cast's
 * target (when friendly) is the subject for heal/absorb/echo responses. */
export function onCastCompleted(
  ctx: SimContext,
  p: Entity,
  abilityId: string,
  target?: Entity | null,
): void {
  for (const def of procsFor(ctx, p)) {
    const t = def.trigger;
    if (t.on !== 'castNth' || !t.abilities.includes(abilityId)) continue;
    const s = state(p);
    const c = (s.counters[def.id] ?? 0) + 1;
    if (c >= t.n) {
      s.counters[def.id] = 0;
      fire(ctx, p, def, target && !target.dead ? target : p);
    } else s.counters[def.id] = c;
  }
}

/** One of the player's thorns auras reflected a melee hit. */
export function onThornsReflect(ctx: SimContext, p: Entity, abilityId: string): void {
  for (const def of procsFor(ctx, p)) {
    const trigger = def.trigger;
    if (trigger.on !== 'thornsReflect') continue;
    if (trigger.ability !== abilityId) continue;
    fire(ctx, p, def, p);
  }
}

/** A spell (damage or heal) critically hit (dealDamage/applyHeal crit paths). */
export function onSpellCrit(
  ctx: SimContext,
  p: Entity,
  abilityId: string | null,
  target: Entity,
): void {
  for (const def of procsFor(ctx, p)) {
    const t = def.trigger;
    if (t.on !== 'spellCrit') continue;
    if (t.abilities && (abilityId === null || !t.abilities.includes(abilityId))) continue;
    fire(ctx, p, def, target);
  }
}

/** An absorb shield the player applied was fully consumed (damage.ts soak loop). */
export function onShieldConsumed(
  ctx: SimContext,
  p: Entity,
  shieldAbilityId: string,
  owner: Entity,
): void {
  for (const def of procsFor(ctx, p)) {
    const t = def.trigger;
    if (t.on !== 'shieldConsumed' || t.ability !== shieldAbilityId) continue;
    fire(ctx, p, def, owner);
  }
}

/** A HoT the player applied ran its full duration (auras.ts natural expiry). */
export function onHotExpired(
  ctx: SimContext,
  p: Entity,
  hotAbilityId: string,
  owner: Entity,
): void {
  for (const def of procsFor(ctx, p)) {
    const t = def.trigger;
    if (t.on !== 'hotExpired' || t.ability !== hotAbilityId) continue;
    fire(ctx, p, def, owner);
  }
}

/** The player took a single hit (post-mitigation, damage.ts). */
export function onDamageTaken(ctx: SimContext, p: Entity, amount: number): void {
  if (p.maxHp <= 0) return;
  for (const def of procsFor(ctx, p)) {
    const t = def.trigger;
    if (t.on !== 'bigHitTaken') continue;
    if (amount < p.maxHp * t.hpFrac) continue;
    const s = state(p);
    if (s.icds[def.id] !== undefined) continue;
    s.icds[def.id] = t.icd;
    fire(ctx, p, def, p);
  }
}

/** A melee auto-attack landed (combat swing path). */
export function onMeleeSwing(ctx: SimContext, p: Entity): void {
  for (const def of procsFor(ctx, p)) {
    const t = def.trigger;
    if (t.on !== 'meleeSwingWhile') continue;
    if (!p.auras.some((a) => a.kind === t.auraKind)) continue;
    fire(ctx, p, def, p);
  }
}
