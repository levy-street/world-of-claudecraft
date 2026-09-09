// Corpse-harvest SESSION (Intentional Gathering, PR3): the timed
// HARVEST_CAST_SECONDS cast wrapping the unchanged corpse_harvest_grant.ts
// grant, behind the SimContext seam like every other profession session.
// Owns:
//   - the single live reservation + kill-credit priority window, kept on the
//     mob Entity (`Entity.corpseHarvestState`, types.ts);
//   - the frozen per-attempt session on `PlayerMeta.corpseHarvestSession`
//     (sim.ts): the admitted preference, the shared
//     `snapshotCorpseHarvestGrantInputs` result, and a start-position snapshot;
//   - the one admission decision (`admitCorpseHarvest`,
//     harvest_admission.ts), fed real facts;
//   - the per-tick recheck (`validateCorpseHarvestCast`) and completion
//     recheck (`completeCorpseHarvestCast`), both driven by
//     combat/casting_lifecycle.ts, sharing ONE validity check independent of
//     castingAbility (the coordinator clears it before calling completion);
//   - release on every cancellation path (`releaseCorpseHarvest`, called from
//     `cancelCast`, `handleDeath`, `preparePlayerLeave`, `dropEntityFromRoster`,
//     `respawnMob`).
//
// Zero rng: every gate here runs strictly before `grantCorpseHarvest`'s first
// roll, and every release/cancel path is a plain field write.
//
// `src/sim`-pure: no DOM/Three/render-ui-game-net imports, no Math.random/
// Date.now (enforced by tests/architecture.test.ts).

import { corpseCanInteract } from '../corpse_interaction';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import {
  CORPSE_HARVEST_CAST_ID,
  type CorpseHarvestState,
  dist2d,
  type Entity,
  INTERACT_RANGE,
  type Vec3,
} from '../types';
import {
  type CorpseHarvestGrantInputs,
  grantCorpseHarvest,
  snapshotCorpseHarvestGrantInputs,
} from './corpse_harvest_grant';
import { evaluateCorpseHarvest } from './corpse_harvest_inspection';
import { sameHarvestScope } from './corpse_harvest_scope';
import {
  HARVEST_CAST_SECONDS,
  HARVEST_PRIORITY_SECONDS,
  type HarvestAdmissionReason,
  harvestPriorityKeyFor,
} from './harvest_admission';
import { ordinaryYieldFitsFor } from './harvest_ordinary_fit';
import type { HarvestPreference } from './harvest_preference';

/** Any real displacement (all 3 axes) invalidates the cast; this tolerance is
 *  float-noise-only. */
const POSITION_DRIFT_EPS = 0.05;

export interface CorpseHarvestFrozenGrant {
  readonly inputs: CorpseHarvestGrantInputs;
  readonly preference: HarvestPreference;
}

/** The one in-flight corpse-harvest attempt a player may hold. */
export interface CorpseHarvestSession {
  readonly corpseEntityId: number;
  /** Reference-identity token from the corpse's own `corpseHarvestState` at
   *  admission; a mismatch means the corpse despawned/respawned/redied under
   *  the same entity id. */
  readonly corpseLifeToken: object;
  readonly grant: CorpseHarvestFrozenGrant;
  readonly startPos: Vec3;
}

/** Stable codes to player-facing text (a seam for the parent's later
 *  localization pass); reuses an existing registered literal wherever the
 *  concept already has one. */
export function corpseHarvestDenialText(reason: HarvestAdmissionReason): string {
  switch (reason) {
    case 'malformed_input':
      return 'That is not a valid target.';
    case 'actor_dead':
      return "You can't do that while dead.";
    case 'actor_in_combat':
      return "You can't do that while in combat.";
    case 'actor_busy':
      return 'You are busy.';
    case 'corpse_invalid':
    case 'nothing_to_harvest':
      return 'That corpse has nothing to harvest.';
    case 'wrong_world':
    case 'out_of_range':
      return 'Too far away.';
    case 'no_field_kit':
      return 'You need a Field Kit to harvest a corpse.';
    case 'already_harvested':
      return 'This corpse has already been harvested.';
    case 'reserved':
      return 'Someone else is already harvesting that corpse.';
    case 'priority_protected':
      return "You don't have permission to harvest that corpse yet.";
    case 'corpse_expiring':
      return 'That corpse will not last long enough to harvest.';
    case 'preference_malformed':
      return 'Choose a harvest preference before trying again.';
    case 'material_unavailable':
      return 'The material you chose is not on that corpse.';
    case 'bags_full':
      return 'Your bags are full.';
    default:
      return 'You cannot harvest that corpse right now.';
  }
}

/** Mints a fresh, empty, immediately-public corpse state: either
 *  `recordCorpseHarvestDeath` at a real kill, or lazily here for a corpse
 *  with no recorded death (a bare fixture, or content lootable outside a
 *  kill). */
function ensureCorpseHarvestState(mob: Entity): CorpseHarvestState {
  if (!mob.corpseHarvestState) {
    mob.corpseHarvestState = {
      token: {},
      priorityEndsAt: 0,
      priorityMemberKeys: [],
      reservedBy: null,
    };
  }
  return mob.corpseHarvestState;
}

/** True 3D displacement from the frozen start position, NaN/Infinity-safe. */
function displacedFromStart(pos: Vec3, start: Vec3): boolean {
  const dx = pos.x - start.x;
  const dy = pos.y - start.y;
  const dz = pos.z - start.z;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) return true;
  return Math.hypot(dx, dy, dz) > POSITION_DRIFT_EPS;
}

/**
 * The ONE validity check both the per-tick recheck and the completion
 * recheck run, independent of `castingAbility` (the coordinator clears it
 * before calling completion). Returns the live corpse when everything still
 * holds, else null. Does NOT check capacity (only completion does, against
 * the frozen inputs) and does NOT re-require any lifetime remaining on the
 * corpse (that was already settled at admission).
 */
function corpseHarvestStillValid(
  ctx: SimContext,
  player: Entity,
  meta: PlayerMeta,
  session: CorpseHarvestSession,
): Entity | null {
  if (meta.leaving) return null;
  if (player.dead || player.inCombat) return null;
  if (ctx.countItem('field_kit', player.id) === 0) return null;
  if (displacedFromStart(player.pos, session.startPos)) return null;
  const mob = ctx.entities.get(session.corpseEntityId);
  if (!mob || !mob.corpseHarvestState) return null;
  if (mob.corpseHarvestState.token !== session.corpseLifeToken) return null;
  if (mob.corpseHarvestState.reservedBy !== player.id) return null;
  if (mob.harvestClaimedBy !== null) return null;
  if (!corpseCanInteract(mob)) return null;
  if (dist2d(player.pos, mob.pos) > INTERACT_RANGE) return null;
  if (!sameHarvestScope(ctx, player.id, mob)) return null;
  return mob;
}

/** Clears `mob.corpseHarvestState.reservedBy` when `playerId` holds it. */
function clearReservationIfHeldBy(mob: Entity | undefined, playerId: number): void {
  const state = mob?.corpseHarvestState;
  if (state && state.reservedBy === playerId) state.reservedBy = null;
}

/**
 * Start a corpse-harvest cast: one admission decision (`admitCorpseHarvest`)
 * fed real, freshly-read facts. On success, reserves the corpse (first valid
 * actor wins; never a queue, never a duplicate, not even for the actor
 * already holding it), starts a `CORPSE_HARVEST_CAST_ID` cast, and emits the
 * matching `castStart`. Zero rng on every path, including every refusal;
 * never extends `mob.corpseTimer`.
 */
export function startCorpseHarvest(ctx: SimContext, corpseId: number, pid?: number): boolean {
  const evaluation = evaluateCorpseHarvest(ctx, corpseId, pid);
  if (!evaluation) return false;
  const { actor, meta, mob, admission, componentTags } = evaluation;

  if (!admission.ok) {
    ctx.error(actor.id, corpseHarvestDenialText(admission.reason));
    return false;
  }

  // First valid start reserves; no queue, no replacement body, no
  // corpseTimer extension.
  const state = ensureCorpseHarvestState(mob);
  state.reservedBy = actor.id;

  const frozenInputs = snapshotCorpseHarvestGrantInputs(
    meta,
    componentTags,
    admission.admitted.chosenComponents,
  );
  meta.corpseHarvestSession = {
    corpseEntityId: mob.id,
    corpseLifeToken: state.token,
    grant: { inputs: frozenInputs, preference: admission.admitted.preference },
    startPos: { ...actor.pos },
  };

  actor.castingAbility = CORPSE_HARVEST_CAST_ID;
  actor.castTotal = HARVEST_CAST_SECONDS;
  actor.castRemaining = HARVEST_CAST_SECONDS;
  actor.castTargetId = mob.id;
  actor.channeling = false;
  ctx.emit({
    type: 'castStart',
    entityId: actor.id,
    ability: CORPSE_HARVEST_CAST_ID,
    time: HARVEST_CAST_SECONDS,
  });
  return true;
}

/** The per-tick recheck `updateCasting` runs before decrementing
 *  `castRemaining`; false means the caller must `cancelCast` immediately. */
export function validateCorpseHarvestCast(
  ctx: SimContext,
  player: Entity,
  meta: PlayerMeta,
): boolean {
  const session = meta.corpseHarvestSession;
  if (!session) return false;
  return corpseHarvestStillValid(ctx, player, meta, session) !== null;
}

/**
 * Cast completion: the same validity check as every tick (never trusting
 * admission-time state, independent of `castingAbility`), then the ordinary
 * capacity recheck against the frozen inputs, then the unchanged
 * `grantCorpseHarvest`. Session and reservation clear EXACTLY ONCE, after the
 * result is known. Returns whether a grant landed; `castStop` reports the
 * cast itself finishing regardless.
 */
export function completeCorpseHarvestCast(
  ctx: SimContext,
  player: Entity,
  meta: PlayerMeta,
): boolean {
  const session = meta.corpseHarvestSession;
  if (!session) return false;
  const mob = corpseHarvestStillValid(ctx, player, meta, session);

  let granted = false;
  if (!mob) {
    ctx.error(player.id, 'The harvest was interrupted.');
  } else if (!ordinaryYieldFitsFor(meta, session.grant.inputs)) {
    ctx.error(player.id, 'Your bags are full.');
  } else {
    granted = grantCorpseHarvest(ctx, mob, meta, session.grant.inputs);
  }

  clearReservationIfHeldBy(ctx.entities.get(session.corpseEntityId), player.id);
  meta.corpseHarvestSession = null;
  return granted;
}

/** Release the reservation and clear the session for `playerId`: a cancel, a
 *  death, a disconnect, or the corpse being removed/reused. Idempotent. */
export function releaseCorpseHarvest(ctx: SimContext, playerId: number): void {
  const meta = ctx.players.get(playerId);
  const session = meta?.corpseHarvestSession;
  if (meta) meta.corpseHarvestSession = null;
  if (!session) return;
  const mob = ctx.entities.get(session.corpseEntityId);
  if (mob?.corpseHarvestState?.token === session.corpseLifeToken) {
    clearReservationIfHeldBy(mob, playerId);
  }
}

/** Called from `dropEntityFromRoster` and `respawnMob` BEFORE either mutates
 *  the corpse further, so a live reservation never survives its corpse.
 *  Cancels the reserving actor's cast, which releases via `cancelCast`. */
export function cancelCorpseHarvestForCorpse(ctx: SimContext, mob: Entity): void {
  const reservedBy = mob.corpseHarvestState?.reservedBy;
  if (reservedBy === null || reservedBy === undefined) return;
  const actor = ctx.entities.get(reservedBy);
  if (actor?.castingAbility === CORPSE_HARVEST_CAST_ID) {
    ctx.cancelCast(actor);
  } else {
    releaseCorpseHarvest(ctx, reservedBy);
  }
}

/**
 * Snapshot the kill-credit group as of death (the real `eligible` list
 * `handleDeath` already computed), replacing any prior corpse-harvest state
 * for this entity id (a fresh token, so a stale in-flight session can never
 * match again). Empty `eligible` means the corpse is public at once. Draws
 * no rng.
 */
export function recordCorpseHarvestDeath(
  ctx: SimContext,
  mob: Entity,
  eligible: readonly PlayerMeta[],
): void {
  mob.corpseHarvestState = {
    token: {},
    priorityEndsAt: ctx.time + HARVEST_PRIORITY_SECONDS,
    priorityMemberKeys: [...new Set(eligible.map((meta) => harvestPriorityKeyFor(meta)))],
    reservedBy: null,
  };
}
