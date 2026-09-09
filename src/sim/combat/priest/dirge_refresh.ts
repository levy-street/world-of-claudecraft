import type { PlayerMeta } from '../../sim';
import type { SimContext } from '../../sim_context';
import type { Aura, Entity } from '../../types';
import { LIVING_COVENANT_MAX_EXTENSION, ownDirge, ownEffigy } from './vespers';

// v0.42.0 Vespers: reapplying Dirge to a mob that already carries the caster's
// own living Dirge refreshes every OTHER living hostile MOB (never a player)
// carrying this priest's own Dirge within Dirge's cast range, centered on the
// priest. No target cap. docs/design/class-balance-v042.md, "Vespers: reapply
// Dirge once to refresh every eligible mob".
export const DIRGE_ABILITY_ID = 'shadow_word_pain';
export const DIRGE_BASE_DURATION = 18;
export const DIRGE_MAX_DURATION = DIRGE_BASE_DURATION + LIVING_COVENANT_MAX_EXTENSION;
export const DIRGE_DEFAULT_RANGE = 30;

export interface DirgePriorState {
  priorAura: Aura | null;
}

// An "active" own Dirge: present, this priest's, and not yet expired
// (remaining > 0). A zero-or-negative remaining aura may still sit in
// `auras` for one tick before cleanup sweeps it; it must never count as
// live for capture or fan-out.
function activeOwnDirge(target: Entity, priestId: number): Aura | undefined {
  const dirge = ownDirge(target, priestId);
  return dirge && dirge.remaining > 0 ? dirge : undefined;
}

/** Call once, immediately BEFORE the dot-application seam's ctx.applyAura for
 * a shadow_word_pain cast; pass the result to
 * refreshDirgeFieldAfterReapplication after that seam runs. */
export function captureDirgeReapplication(target: Entity, priestId: number): DirgePriorState {
  return { priorAura: activeOwnDirge(target, priestId) ?? null };
}

// Refresh to 18s, never shortening currently-live time above 18s, and never
// restoring extension time that already elapsed: the carried duration is
// derived from `prior.remaining` AT THE MOMENT OF REFRESH, not from the
// `extendedBy` counter (which only ever grows and does not decay as the dot
// ticks down, so it cannot say how much extra time is still actually live).
function carriedDuration(prior: Aura): number {
  return Math.min(DIRGE_MAX_DURATION, Math.max(DIRGE_BASE_DURATION, prior.remaining));
}

function carryDirgeTiming(fresh: Aura, prior: Aura): void {
  fresh.tickTimer = prior.tickTimer;
  fresh.gloomtitheTick = prior.gloomtitheTick;
  const duration = carriedDuration(prior);
  const extendedBy = Math.max(0, duration - DIRGE_BASE_DURATION);
  fresh.duration = duration;
  fresh.remaining = duration;
  fresh.extendedBy = extendedBy > 0 ? extendedBy : undefined;
}

// Keeps an already-bound own Effigy's remaining lifetime in step with its
// Dirge. Never creates, rebinds, or moves an Effigy (only bindEffigy does),
// and never grants Gloomtithe.
function resyncEffigyToDirge(priest: Entity, target: Entity, dirgeRemaining: number): void {
  const effigy = ownEffigy(target, priest.id);
  if (!effigy) return;
  const duration = Math.max(0.05, dirgeRemaining);
  effigy.remaining = duration;
  effigy.duration = duration;
}

/** Call once, immediately AFTER the dot-application seam applies a fresh
 * Dirge to `target` for a shadow_word_pain cast (the before/after pair with
 * captureDirgeReapplication). Inert for a first application, a non-mob
 * primary, a non-Vespers caster, or a rejected apply.
 *
 * `range` should be the currently-resolved Dirge ability range (its authored
 * `def.range`, in case a future modifier ever changes it at cast time);
 * callers without a resolved ability may omit it for the authored default.
 */
export function refreshDirgeFieldAfterReapplication(
  ctx: SimContext,
  priest: Entity,
  meta: PlayerMeta,
  target: Entity,
  prior: DirgePriorState,
  range: number = DIRGE_DEFAULT_RANGE,
): void {
  if (meta.cls !== 'priest' || meta.talents.spec !== 'shadow') return;
  if (target.kind !== 'mob') return; // never propagates to an enemy player
  if (!prior.priorAura) return;

  // ctx.applyAura splices out any prior same-id/same-source aura and pushes a
  // NEW object; a rejected apply (one of applyAura's early-return guards)
  // leaves the OLD object untouched. Comparing identity against the captured
  // prior is the only reliable "did this actually replace" proof.
  const primary = activeOwnDirge(target, priest.id);
  if (!primary || primary === prior.priorAura) return;

  carryDirgeTiming(primary, prior.priorAura);
  resyncEffigyToDirge(priest, target, primary.remaining);

  // Sorted by id (not raw hostilesInRadius grid order) so the fanned-out
  // refresh, and the per-target events it emits, are roster-independent,
  // matching doctrine_rescue.ts's own id-sorted candidate order.
  const hostiles = [...ctx.hostilesInRadius(priest, priest.pos, range)].sort((a, b) => a.id - b.id);
  for (const hostile of hostiles) {
    if (hostile.id === target.id || hostile.kind !== 'mob') continue;
    const existing = activeOwnDirge(hostile, priest.id);
    if (!existing) continue; // clean/expired targets are never spread or recreated
    if (!ctx.hasLineOfSight(priest, hostile)) continue;
    const fresh: Aura = {
      ...existing,
      value: primary.value,
      school: primary.school,
      name: primary.name,
      leechPct: primary.leechPct,
    };
    carryDirgeTiming(fresh, existing);
    ctx.applyAura(hostile, fresh);
    // The recipient apply can itself be rejected; only sync Effigy on proven success.
    if (activeOwnDirge(hostile, priest.id) === fresh) {
      resyncEffigyToDirge(priest, hostile, fresh.remaining);
    }
  }
}
