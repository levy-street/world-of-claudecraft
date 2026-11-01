import type * as THREE from 'three';
import type { LightningProjectileOpts } from '../vfx';
import { arcBoltLeaderPlan } from './stepped_leader_core';

// The Arc Bolt cast read (the Shaman's lightning_bolt, and its Arc Overload
// echo): the pooled Vfx lightning projectile still does the flying and the
// arrival burst (it flies at the sim's projectile speed, so it lands on the
// damage tick), drawn as a small hot tip, while a stepped leader rides it from
// the caster's hand and stages the return stroke, restrike, afterglow and
// light at the moment it ARRIVES (the gallery's compressed instant sequence
// used to land its impact 0.15 s after release, long before the bolt got
// there). The gallery row's linger and finisher beats are deliberately not
// played for this ability: the afterglow is its linger. The painter routes both of the
// ability's spellfx cues here and falls back to its generic arms when this
// returns false (the spam-floor tier keeps the color-only projectile).

export const ARC_BOLT_ABILITY = 'lightning_bolt';

export interface ArcBoltPrimitives {
  lightningProjectile(
    sourceId: number,
    targetId: number,
    color?: number,
    opts?: LightningProjectileOpts,
  ): THREE.Vector3 | null | undefined;
}

type LeaderPlan = NonNullable<ReturnType<typeof arcBoltLeaderPlan>>;

export interface ArcBoltLeaderFx {
  steppedLeader(sourceId: number, targetId: number, head: THREE.Vector3, plan: LeaderPlan): number;
  steppedLeaderStrike(sourceId: number, targetId: number, plan: LeaderPlan): boolean;
  steppedLeaderImpact(handle: number, at: THREE.Vector3): void;
  steppedLeaderLost(handle: number): void;
}

/**
 * Play one Arc Bolt; false when the caller should draw its fallback (the
 * spam-floor tier). The cast rides the flying projectile; the Arc Overload
 * echo strikes at once, because the sim applies its damage on the tick the
 * cue is emitted (shaman_thundercall_kit.ts), so a flying echo showed its
 * number long before its strike.
 */
export function playArcBolt(
  vfx: ArcBoltPrimitives,
  fx: ArcBoltLeaderFx,
  sourceId: number,
  targetId: number,
  color: number,
  tier: number,
  overload: boolean,
  quality = 1,
): boolean {
  const plan = arcBoltLeaderPlan(tier, overload, quality);
  if (!plan) return false;
  if (overload) {
    fx.steppedLeaderStrike(sourceId, targetId, plan);
    return true;
  }
  let handle = -1;
  const head = vfx.lightningProjectile(sourceId, targetId, color, {
    tip: true,
    onImpact: (at) => fx.steppedLeaderImpact(handle, at),
    onLost: () => fx.steppedLeaderLost(handle),
  });
  // No head means the caster had no anchor: nothing was launched, and the
  // fallback would find no anchor either, so the cue is still handled.
  if (head) handle = fx.steppedLeader(sourceId, targetId, head, plan);
  return true;
}
