// Fair crowd control inside a Buried Hoard. In the open world and in Rifts a mob
// can land a fear, stun, silence or hex the instant its swing connects or its
// timer fires, with nothing the player can do about it. Inside a Buried Hoard
// (a treasure map's one-room vault, src/sim/treasure_vault.ts) every such hard
// control is a REAL CAST instead: the mob shows a cast bar, the spell is
// interruptible by any school-lockout interrupt (registered in
// SCRIPTED_INTERRUPTIBLE_CHANNELS, src/sim/mob/healer_channel.ts), and the
// control only lands if the bar completes. The mob keeps fighting while it
// casts (the bigCast precedent), so the counterplay is the interrupt, not a lull.
//
// Owns no balance: durations, names and schools come from the mob template's
// authored proc; this module only moves WHEN the control lands.

import { MOBS } from '../data';
import type { SimContext } from '../sim_context';
import { type Aura, DT, dist2d, type Entity } from '../types';
import {
  HOARD_CAST_FEAR,
  HOARD_CAST_HEX,
  HOARD_CAST_SILENCE,
  HOARD_CAST_STUN,
} from './hoard_control_cast_ids';
import type { RiftInstance } from './types';

export {
  HOARD_CAST_FEAR,
  HOARD_CAST_HEX,
  HOARD_CAST_SILENCE,
  HOARD_CAST_STUN,
  HOARD_CONTROL_CAST_SCHOOLS,
} from './hoard_control_cast_ids';

/** Bar length for a single-target control and for a room-wide one. */
/** Owner rule: no hoard caster bar is shorter than two seconds. Three gives a
 *  player who is mid-swing time to find the caster and kick (playtest). */
export const HOARD_CONTROL_CAST_SEC = 3.0;
/** A fear takes a player out of the fight outright, so it is the slowest bar to
 *  land: the single-target Dread and, slower still, the room-wide terrify. */
export const HOARD_CONTROL_FEAR_CAST_SEC = 3.5;
export const HOARD_CONTROL_AOE_CAST_SEC = 4.2;

/** On-hit controls a hoard boss simply does not have. Tempest Vharok already
 *  asks a lot (Tempest Judgment, Storm Surge, static, his casters' Lightning
 *  Strikes); a stun on top of that was one ask too many. */
export const HOARD_DROPPED_CONTROLS: Readonly<Record<string, readonly Aura['kind'][]>> = {
  rift_boss_storm: ['stun'],
};

export type HoardControlCast =
  | { castId: string; kind: 'aura'; targetId: number; aura: Aura }
  | {
      castId: string;
      kind: 'terrify';
      radius: number;
      duration: number;
      name: string;
      school: Aura['school'];
    };

function castIdForAura(aura: Aura): string {
  if (aura.kind === 'silence') return HOARD_CAST_SILENCE;
  if (aura.kind === 'polymorph') return HOARD_CAST_HEX;
  if (aura.kind === 'incapacitate') return HOARD_CAST_FEAR;
  return HOARD_CAST_STUN;
}

/** The Buried Hoard run a mob belongs to, or null anywhere else. */
export function buriedHoardOf(ctx: SimContext, mob: Entity): RiftInstance | null {
  for (const inst of ctx.riftInstances) {
    if (!inst.vault || inst.partyKey === null) continue;
    if (inst.bossId === mob.id || inst.mobIds.includes(mob.id)) return inst;
  }
  return null;
}

function beginCast(mob: Entity, pending: HoardControlCast, seconds: number): void {
  mob.hoardControlCast = pending;
  mob.castingAbility = pending.castId;
  mob.castTotal = seconds;
  mob.castRemaining = seconds;
  mob.castTargetId = pending.kind === 'aura' ? pending.targetId : null;
  mob.channeling = false;
}

/**
 * A landed on-hit control proc. Inside a Buried Hoard it becomes an
 * interruptible cast and this returns true (the caller must NOT apply the aura);
 * a mob already mid-cast simply loses the proc. Anywhere else returns false and
 * the caller applies the aura at once, exactly as before.
 */
export function deferHoardControlAura(
  ctx: SimContext,
  mob: Entity,
  target: Entity,
  aura: Aura,
): boolean {
  if (!buriedHoardOf(ctx, mob)) return false;
  // Dropped outright for this boss inside a hoard (owner playtest): swallowed,
  // never cast, never applied.
  if (HOARD_DROPPED_CONTROLS[mob.templateId]?.includes(aura.kind)) return true;
  if (mob.castingAbility !== null) return true;
  beginCast(
    mob,
    { castId: castIdForAura(aura), kind: 'aura', targetId: target.id, aura },
    aura.kind === 'incapacitate' ? HOARD_CONTROL_FEAR_CAST_SEC : HOARD_CONTROL_CAST_SEC,
  );
  return true;
}

/** The periodic room-wide terrify. Same contract as deferHoardControlAura. */
export function deferHoardTerrify(
  ctx: SimContext,
  mob: Entity,
  terrify: { radius: number; duration: number; name: string; school?: Aura['school'] },
): boolean {
  if (!buriedHoardOf(ctx, mob)) return false;
  if (mob.castingAbility !== null) return true;
  beginCast(
    mob,
    {
      castId: HOARD_CAST_FEAR,
      kind: 'terrify',
      radius: terrify.radius,
      duration: terrify.duration,
      name: terrify.name,
      school: terrify.school ?? 'shadow',
    },
    HOARD_CONTROL_AOE_CAST_SEC,
  );
  return true;
}

function land(ctx: SimContext, mob: Entity, pending: HoardControlCast): void {
  if (pending.kind === 'aura') {
    const target = ctx.entities.get(pending.targetId);
    if (!target || target.dead) return;
    ctx.applyAura(target, { ...pending.aura });
    ctx.emit({
      type: 'spellfx',
      sourceId: mob.id,
      targetId: target.id,
      school: pending.aura.school ?? 'shadow',
      fx: 'nova',
    });
    return;
  }
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: mob.id,
    school: pending.school,
    fx: 'nova',
  });
  if (!MOBS[mob.templateId]?.quietMechanics)
    ctx.emit({
      type: 'log',
      text: `${mob.name} unleashes ${pending.name}!`,
      color: '#ff9933',
      entityId: mob.id,
    });
  for (const meta of ctx.players.values()) {
    const pe = ctx.entities.get(meta.entityId);
    if (!pe || pe.dead || dist2d(pe.pos, mob.pos) > pending.radius) continue;
    const remaining = ctx.diminishedCrowdControlDuration(mob, pe, 'fear', pending.duration);
    if (remaining === null) continue;
    const heading = ctx.rng.range(-Math.PI, Math.PI);
    // The boss's current target holds their ground (the terrify driver's rule).
    if (pe.id === mob.aggroTargetId) continue;
    ctx.applyAura(pe, {
      id: 'fear_incap',
      name: pending.name,
      kind: 'incapacitate',
      remaining,
      duration: remaining,
      value: heading,
      sourceId: mob.id,
      school: pending.school,
      breaksOnDamage: true,
    });
  }
}

/** Advance every pending hoard control cast one tick: an interrupted or
 *  cancelled bar drops its control, a finished bar lands it. */
export function tickHoardControlCasts(ctx: SimContext): void {
  for (const inst of ctx.riftInstances) {
    if (!inst.vault || inst.partyKey === null) continue;
    for (const id of inst.mobIds) {
      const mob = ctx.entities.get(id);
      const pending = mob?.hoardControlCast;
      if (!mob || !pending) continue;
      if (mob.dead || mob.hp <= 0 || mob.castingAbility !== pending.castId) {
        // Interrupted (cancelCast cleared the bar), killed, or replaced.
        if (mob.castingAbility === pending.castId) {
          mob.castingAbility = null;
          mob.castRemaining = 0;
          mob.castTotal = 0;
          mob.castTargetId = null;
        }
        mob.hoardControlCast = undefined;
        continue;
      }
      mob.castRemaining = Math.max(0, mob.castRemaining - DT);
      if (mob.castRemaining > 0) continue;
      mob.castingAbility = null;
      mob.castTotal = 0;
      mob.castTargetId = null;
      mob.hoardControlCast = undefined;
      land(ctx, mob, pending);
    }
  }
}
