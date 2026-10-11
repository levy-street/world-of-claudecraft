// Lightning Strike: the Storm Caller's signature inside a Buried Hoard.
//
// The caller picks a living player, LOCKS that player's position at once, and
// marks it with a ground telegraph. About a second later a bolt lands on the
// stored spot and hurts whoever is standing in the circle at that instant:
// the original target if they stayed, anyone else who walked in, nobody if the
// circle is empty. The circle never follows anyone.
//
// The stages are kept apart on purpose:
//   targeting  -> pickTarget (a living player in reach, rotated per caller)
//   telegraph  -> a HoardBossCue 'storm-strike' mark, mirrored and drawn by the
//                 same pipeline as every boss warning (hoard_boss_fx.ts)
//   hitbox     -> pointInLightningStrike, a plain circle on the stored position
//   damage     -> ctx.dealDamage, the ordinary combat path
//   VFX        -> the renderer reads the cue; nothing visual decides a hit
//
// It is also a real cast bar on the caller, interruptible like every other
// hoard control, so a kick cancels the bolt and clears the circle. Death,
// despawn, a reset (the caller leaves combat) and an empty room cancel it too.

import { RIFT_REGION_HALF_X, RIFT_REGION_HALF_Z, riftInstanceOrigin } from '../data';
import type { SimContext } from '../sim_context';
import { DT, type Entity } from '../types';
import {
  HOARD_CAST_LIGHTNING_STRIKE,
  HOARD_LIGHTNING_STRIKE_CAST_SCHOOL,
} from './hoard_control_cast_ids';
import { hoardMechanicDamage } from './hoard_scaling';
import type { HoardBossCue, RiftInstance } from './types';

/** Every tunable in one place. */
export const HOARD_LIGHTNING_STRIKE = {
  /** Mob templates that know the ability. */
  casters: ['rift_storm_caller'] as readonly string[],
  /** Seconds between the circle appearing and the bolt landing. Owner rule: no
   *  hoard caster bar is shorter than two seconds, so a kick is always possible. */
  telegraphSec: 2.2,
  /** Circle radius in yards: the telegraph AND the hitbox. */
  radius: 3.2,
  /** Share of the reference health the bolt deals. */
  damageFraction: 0.22,
  /** Seconds between one caller's strikes, and before its first. */
  cooldownSec: 8,
  firstDelaySec: 2.5,
  /** A target further than this from the caller is not picked. */
  rangeYards: 32,
} as const;

export { HOARD_CAST_LIGHTNING_STRIKE, HOARD_LIGHTNING_STRIKE_CAST_SCHOOL };

/** Strike cue ids live far above the boss kit's own counter, so the two never
 *  collide inside one instance. */
const STRIKE_CUE_ID_BASE = 1_000_000;

export interface HoardLightningStrikeState {
  nextCueId: number;
  targetCursor: number;
  /** Seconds until each caller may strike again, by mob id. */
  cooldowns: Map<number, number>;
  /** Live circles, each owned by the caller channelling it. */
  strikes: Array<{ casterId: number; cue: Extract<HoardBossCue, { kind: 'mark' }> }>;
}

/** The gameplay hitbox: a circle on the stored position, nothing else. */
export function pointInLightningStrike(
  center: { x: number; z: number },
  point: { x: number; z: number },
  radius: number = HOARD_LIGHTNING_STRIKE.radius,
): boolean {
  const dx = point.x - center.x;
  const dz = point.z - center.z;
  return dx * dx + dz * dz <= radius * radius;
}

export function hoardLightningStrikeCues(inst: RiftInstance): HoardBossCue[] {
  return inst.hoardStrikes?.strikes.map((strike) => strike.cue) ?? [];
}

function roomPlayers(ctx: SimContext, inst: RiftInstance): Entity[] {
  const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);
  return [...inst.memberIds]
    .sort((a, b) => a - b)
    .map((id) => ctx.entities.get(id))
    .filter(
      (entity): entity is Entity =>
        entity !== undefined &&
        Math.abs(entity.pos.x - origin.x) <= RIFT_REGION_HALF_X &&
        Math.abs(entity.pos.z - origin.z) <= RIFT_REGION_HALF_Z,
    );
}

function emitCue(
  ctx: SimContext,
  inst: RiftInstance,
  players: readonly Entity[],
  cue: Extract<HoardBossCue, { kind: 'mark' }>,
  durationSecs: number,
): void {
  for (const player of players) {
    ctx.emit({
      type: 'hoardBossCue',
      pid: player.id,
      instanceId: inst.instanceId,
      cueId: cue.id,
      kind: 'mark',
      variant: cue.variant,
      phase: 'warning',
      x: cue.x,
      z: cue.z,
      radius: cue.radius,
      // A zero-length re-emit is how one circle is withdrawn: the mirror
      // replaces the cue by id and drops anything already expired.
      durationSecs,
    });
  }
}

/** Targeting: the caller's own aggro target when it is a living player in
 *  reach, otherwise the next living player in reach, rotated so a party does
 *  not see one member singled out. Deterministic: no rng draw. */
function pickTarget(
  caster: Entity,
  living: readonly Entity[],
  state: HoardLightningStrikeState,
): Entity | null {
  const range = HOARD_LIGHTNING_STRIKE.rangeYards;
  const inReach = living.filter((player) => pointInLightningStrike(caster.pos, player.pos, range));
  if (inReach.length === 0) return null;
  const aggro = inReach.find((player) => player.id === caster.aggroTargetId);
  // Alternate: even casts chase the tank, odd casts rotate through the room.
  if (aggro && state.targetCursor % 2 === 0) {
    state.targetCursor++;
    return aggro;
  }
  const picked = inReach[state.targetCursor % inReach.length];
  state.targetCursor++;
  return picked;
}

function strikeState(inst: RiftInstance): HoardLightningStrikeState {
  if (!inst.hoardStrikes) {
    inst.hoardStrikes = {
      nextCueId: STRIKE_CUE_ID_BASE,
      targetCursor: 0,
      cooldowns: new Map(),
      strikes: [],
    };
  }
  return inst.hoardStrikes;
}

function clearCast(caster: Entity | undefined): void {
  if (!caster || caster.castingAbility !== HOARD_CAST_LIGHTNING_STRIKE) return;
  caster.castingAbility = null;
  caster.castRemaining = 0;
  caster.castTotal = 0;
  caster.castTargetId = null;
}

function land(
  ctx: SimContext,
  inst: RiftInstance,
  caster: Entity,
  players: readonly Entity[],
  cue: Extract<HoardBossCue, { kind: 'mark' }>,
): void {
  for (const player of players) {
    if (player.dead || !pointInLightningStrike(cue, player.pos, cue.radius)) continue;
    ctx.dealDamage(
      caster,
      player,
      hoardMechanicDamage(inst, HOARD_LIGHTNING_STRIKE.damageFraction),
      false,
      'nature',
      'Lightning Strike',
      'hit',
      true,
    );
  }
  ctx.emit({
    type: 'spellfxAt',
    x: cue.x,
    z: cue.z,
    school: 'nature',
    fx: 'nova',
    ability: 'chain_lightning',
    radius: cue.radius,
    sourceId: caster.id,
  });
}

/** One tick of every Storm Caller in every live Buried Hoard. */
export function tickHoardLightningStrikes(ctx: SimContext): void {
  for (const inst of ctx.riftInstances) {
    if (!inst.vault || inst.partyKey === null) {
      if (inst.hoardStrikes) delete inst.hoardStrikes;
      continue;
    }
    const players = roomPlayers(ctx, inst);
    const living = players.filter((player) => !player.dead);
    const state = inst.hoardStrikes;

    // Resolve, or withdraw, every live circle first.
    if (state && state.strikes.length > 0) {
      const live: HoardLightningStrikeState['strikes'] = [];
      for (const strike of state.strikes) {
        const caster = ctx.entities.get(strike.casterId);
        const cancelled =
          !caster ||
          caster.dead ||
          caster.hp <= 0 ||
          // Interrupted (cancelCast cleared the bar) or replaced by another cast.
          caster.castingAbility !== HOARD_CAST_LIGHTNING_STRIKE ||
          // The encounter reset: the caller dropped combat, or nobody is left.
          (caster.aiState !== 'attack' && caster.aiState !== 'chase') ||
          living.length === 0;
        if (cancelled) {
          clearCast(caster);
          emitCue(ctx, inst, players, strike.cue, 0);
          continue;
        }
        strike.cue.remaining = Math.max(0, strike.cue.remaining - DT);
        caster.castRemaining = strike.cue.remaining;
        if (strike.cue.remaining > 0) {
          live.push(strike);
          continue;
        }
        clearCast(caster);
        land(ctx, inst, caster, players, strike.cue);
      }
      state.strikes = live;
    }

    if (living.length === 0) continue;
    for (const id of inst.mobIds) {
      const caster = ctx.entities.get(id);
      if (!caster || caster.dead || caster.hp <= 0) continue;
      if (!HOARD_LIGHTNING_STRIKE.casters.includes(caster.templateId)) continue;
      const engaged = caster.aiState === 'attack' || caster.aiState === 'chase';
      const own = strikeState(inst);
      if (!engaged) {
        // Out of combat: the next pull starts from the opening delay again.
        own.cooldowns.delete(caster.id);
        continue;
      }
      const cooldown = (own.cooldowns.get(caster.id) ?? HOARD_LIGHTNING_STRIKE.firstDelaySec) - DT;
      own.cooldowns.set(caster.id, cooldown);
      if (cooldown > 0 || caster.castingAbility !== null) continue;
      const target = pickTarget(caster, living, own);
      if (!target) continue;
      own.cooldowns.set(caster.id, HOARD_LIGHTNING_STRIKE.cooldownSec);
      const cue: Extract<HoardBossCue, { kind: 'mark' }> = {
        id: own.nextCueId++,
        kind: 'mark',
        variant: 'storm-strike',
        phase: 'warning',
        // Locked here and never updated: the circle does not follow anyone.
        x: target.pos.x,
        z: target.pos.z,
        radius: HOARD_LIGHTNING_STRIKE.radius,
        remaining: HOARD_LIGHTNING_STRIKE.telegraphSec,
        total: HOARD_LIGHTNING_STRIKE.telegraphSec,
      };
      own.strikes.push({ casterId: caster.id, cue });
      caster.castingAbility = HOARD_CAST_LIGHTNING_STRIKE;
      caster.castTotal = HOARD_LIGHTNING_STRIKE.telegraphSec;
      caster.castRemaining = HOARD_LIGHTNING_STRIKE.telegraphSec;
      caster.castTargetId = target.id;
      caster.channeling = false;
      emitCue(ctx, inst, players, cue, cue.total);
    }
  }
}
