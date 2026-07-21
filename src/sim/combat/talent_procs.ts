// Talent proc engine: the shared primitive behind behavior-changing choice-row
// options (docs/design/choice-row-quality-pass.md). A row option carries a
// declarative ProcDef; combat code reports moments (cast completed, crit,
// shield consumed, HoT expired, big hit taken, imbued swing) through single
// delegating calls here, and this module holds the per-player counters and
// internal cooldowns and applies the response. Counters and icds are plain
// tick math; a trigger with an optional `chance` draws through the sim Rng
// only at the moment it would otherwise fire, so players without such a proc
// draw no rng and replay determinism is untouched. Nothing is persisted.

import type { ProcDef, ProcResponse } from '../content/talents';

// Re-exported for consumers/tests that import the proc types from this module
// (the engine's former home for them).
export type { ProcDef, ProcResponse, ProcTrigger } from '../content/talents';

import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { convergenceOnCast } from './convergence';
import { PERSONAL_BARRIER_IDS } from './fire_mage';

function state(player: Entity): NonNullable<Entity['procState']> {
  if (!player.procState) player.procState = { counters: {}, icds: {} };
  return player.procState;
}

export function tickProcState(player: Entity, dt: number): void {
  const procState = player.procState;
  if (!procState) return;
  for (const key of Object.keys(procState.icds)) {
    procState.icds[key] -= dt;
    if (procState.icds[key] <= 0) delete procState.icds[key];
  }
}

export function resetProcState(player: Entity): void {
  player.procState = undefined;
}

function procsFor(ctx: SimContext, player: Entity): ProcDef[] {
  const meta = ctx.players.get(player.id);
  return meta ? ctx.playerMods(meta).procs : [];
}

function fire(ctx: SimContext, player: Entity, def: ProcDef, subject: Entity): void {
  for (const response of def.responses) fireOne(ctx, player, def, subject, response);
}

function fireOne(
  ctx: SimContext,
  player: Entity,
  def: ProcDef,
  subject: Entity,
  response: ProcResponse,
): void {
  switch (response.kind) {
    case 'empowerNext': {
      const existing = player.auras.find(
        (aura) => aura.id === def.id && aura.sourceId === player.id,
      );
      if (existing) {
        existing.kind = response.aura;
        existing.remaining = response.duration;
        existing.duration = response.duration;
        existing.value = response.costPct !== undefined ? 1 - response.costPct : 0;
        existing.empowerAbilities = response.abilities;
      } else {
        ctx.applyAura(player, {
          id: def.id,
          name: def.name,
          kind: response.aura,
          remaining: response.duration,
          duration: response.duration,
          value: response.costPct !== undefined ? 1 - response.costPct : 0,
          sourceId: player.id,
          school: def.school ?? 'holy',
          empowerAbilities: response.abilities,
        });
      }
      ctx.emit({
        type: 'spellfx',
        sourceId: player.id,
        targetId: player.id,
        school: def.school ?? 'holy',
        fx: 'procSurge',
      });
      break;
    }
    case 'cooldownRefund': {
      const remaining = player.cooldowns.get(response.ability);
      if (remaining === undefined) break;
      if (response.seconds === 'reset' || remaining - response.seconds <= 0) {
        player.cooldowns.delete(response.ability);
      } else {
        player.cooldowns.set(response.ability, remaining - response.seconds);
      }
      break;
    }
    case 'resource':
      if (response.resourceType !== undefined && player.resourceType !== response.resourceType) {
        break;
      }
      player.resource = Math.min(player.maxResource, player.resource + response.amount);
      break;
    case 'heal':
      ctx.applyHeal(
        player,
        subject,
        response.amountPctSourceMaxHp !== undefined
          ? Math.round(player.maxHp * response.amountPctSourceMaxHp)
          : response.amountPctMaxHp !== undefined
            ? Math.round(subject.maxHp * response.amountPctMaxHp)
            : (response.amount ?? 0),
        def.name,
      );
      break;
    case 'absorb':
      ctx.applyAura(subject, {
        id: def.id,
        name: def.name,
        kind: 'absorb',
        remaining: response.duration,
        duration: response.duration,
        value:
          response.amountPctMaxHp !== undefined
            ? Math.round(subject.maxHp * response.amountPctMaxHp)
            : (response.amount ?? 0),
        sourceId: player.id,
        school: def.school ?? 'holy',
      });
      ctx.emit({
        type: 'spellfx',
        sourceId: player.id,
        targetId: subject.id,
        school: def.school ?? 'holy',
        fx: 'wardBloom',
      });
      break;
    case 'aura':
      ctx.applyAura(player, {
        id: def.id,
        name: response.name,
        kind: response.auraKind,
        remaining: response.duration,
        duration: response.duration,
        value: response.value,
        sourceId: player.id,
        school: def.school ?? 'holy',
      });
      break;
    case 'echo':
      ctx.applyAura(subject, {
        id: def.id,
        name: def.name,
        kind: 'heal_echo',
        remaining: response.window,
        duration: response.window,
        value:
          response.healPctMaxHp !== undefined
            ? Math.round(subject.maxHp * response.healPctMaxHp)
            : (response.heal ?? 0),
        value2: response.belowFrac,
        sourceId: player.id,
        school: 'holy',
      });
      break;
  }
}

export function onCastCompleted(
  ctx: SimContext,
  player: Entity,
  abilityId: string,
  target?: Entity | null,
): void {
  // G1 guard: a cast that consumed an empower aura (flag set at the consume
  // funnel in empower_next.ts) never advances a castNth counter, so free-cast
  // relay procs cannot feed cast-counter procs. The flag covers exactly one
  // cast: read it, clear it.
  const wasEmpowered = player.castConsumedEmpower === true;
  if (player.castConsumedEmpower !== undefined) player.castConsumedEmpower = undefined;
  // Elemental Convergence (mage choice row): school-alternation memory, kept
  // here because every completed cast funnels through this hook. Draws no rng.
  convergenceOnCast(ctx, player, abilityId);
  if (wasEmpowered) return;
  for (const def of procsFor(ctx, player)) {
    const trigger = def.trigger;
    if (trigger.on !== 'castNth' || !trigger.abilities.includes(abilityId)) continue;
    const procState = state(player);
    // G2 guard: while a castNth internal cooldown runs, matching casts are
    // ignored entirely: nothing fires and nothing is banked toward n.
    if (trigger.icd !== undefined && procState.icds[def.id] !== undefined) continue;
    const count = (procState.counters[def.id] ?? 0) + 1;
    if (count >= trigger.n) {
      procState.counters[def.id] = 0;
      // G4: an optional fire chance (rolled only here, so proc-less players
      // draw no rng). A failed roll consumes the counted casts but arms no icd.
      if (trigger.chance !== undefined && !ctx.rng.chance(trigger.chance)) continue;
      if (trigger.icd !== undefined) procState.icds[def.id] = trigger.icd;
      fire(ctx, player, def, target && !target.dead ? target : player);
    } else {
      procState.counters[def.id] = count;
    }
  }
}

export function onThornsReflect(ctx: SimContext, player: Entity, abilityId: string): void {
  for (const def of procsFor(ctx, player)) {
    const trigger = def.trigger;
    if (trigger.on === 'thornsReflect' && trigger.ability === abilityId) {
      fire(ctx, player, def, player);
    }
  }
}

export function onSpellCrit(
  ctx: SimContext,
  player: Entity,
  abilityId: string | null,
  target: Entity,
): void {
  for (const def of procsFor(ctx, player)) {
    const trigger = def.trigger;
    if (trigger.on !== 'spellCrit') continue;
    if (trigger.abilities && (abilityId === null || !trigger.abilities.includes(abilityId))) {
      continue;
    }
    // G2 guard: an optional internal cooldown caps the fire rate (crit streams
    // from dot ticks and multi-target spells would otherwise chain-fire).
    if (trigger.icd !== undefined && state(player).icds[def.id] !== undefined) continue;
    // G4: optional fire chance; the icd arms only on a successful fire.
    if (trigger.chance !== undefined && !ctx.rng.chance(trigger.chance)) continue;
    if (trigger.icd !== undefined) state(player).icds[def.id] = trigger.icd;
    fire(ctx, player, def, target);
  }
}

export function onShieldConsumed(
  ctx: SimContext,
  player: Entity,
  shieldAbilityId: string,
  owner: Entity,
): void {
  for (const def of procsFor(ctx, player)) {
    const trigger = def.trigger;
    if (trigger.on !== 'shieldConsumed') continue;
    // 'personal_barrier' is the SLOT sentinel (owner rule): a row talent keyed
    // to it fires for whichever personal barrier the player's spec provides
    // (Frostveil or Blazing Barrier), never one hardcoded id.
    const matches =
      trigger.ability === 'personal_barrier'
        ? PERSONAL_BARRIER_IDS.includes(shieldAbilityId)
        : trigger.ability === shieldAbilityId;
    if (!matches) continue;
    fire(ctx, player, def, owner);
  }
}

export function onHotExpired(
  ctx: SimContext,
  player: Entity,
  hotAbilityId: string,
  owner: Entity,
): void {
  for (const def of procsFor(ctx, player)) {
    const trigger = def.trigger;
    if (trigger.on === 'hotExpired' && trigger.ability === hotAbilityId) {
      fire(ctx, player, def, owner);
    }
  }
}

export function onDamageTaken(ctx: SimContext, player: Entity, amount: number): void {
  if (player.maxHp <= 0) return;
  for (const def of procsFor(ctx, player)) {
    const trigger = def.trigger;
    if (trigger.on !== 'bigHitTaken' || amount < player.maxHp * trigger.hpFrac) continue;
    const procState = state(player);
    if (procState.icds[def.id] !== undefined) continue;
    procState.icds[def.id] = trigger.icd;
    fire(ctx, player, def, player);
  }
}

export function onMeleeSwing(ctx: SimContext, player: Entity): void {
  for (const def of procsFor(ctx, player)) {
    const trigger = def.trigger;
    if (trigger.on !== 'meleeSwingWhile') continue;
    if (!player.auras.some((aura) => aura.kind === trigger.auraKind)) continue;
    // G2/G4 (mirrors the cast triggers): optional internal cooldown and fire
    // chance; the icd arms only on a successful fire.
    if (trigger.icd !== undefined && state(player).icds[def.id] !== undefined) continue;
    if (trigger.chance !== undefined && !ctx.rng.chance(trigger.chance)) continue;
    if (trigger.icd !== undefined) state(player).icds[def.id] = trigger.icd;
    fire(ctx, player, def, player);
  }
}
