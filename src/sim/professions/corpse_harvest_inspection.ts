// Corpse-harvest INSPECTION (Intentional Gathering, PR3): the one shared COLD
// read behind both `startCorpseHarvest` (corpse_harvest_session.ts) and the
// query-facing `corpseHarvestInfo` a future IWorld facet member will expose.
//
// `evaluateCorpseHarvest` builds the exact same facts/admission/preview inputs
// `startCorpseHarvest` used to build inline: the private half, preserving the
// admission's own refusal precedence and denial reasons (a caller consuming it
// for a live cast start still sees `wrong_world`/`out_of_range`/... exactly as
// before). It returns null ONLY when there is nothing to reason about at all
// (no resolvable actor, an actor mid-leave, or no such corpse entity); it never
// short-circuits on scope or range, since a start attempt needs the real
// admission denial for those, not a bare refusal.
//
// `corpseHarvestInfo` is the public, DISCLOSURE-SAFE read: it applies its own
// coarser gate (missing/non-corpse, wrong scope, beyond the popup's reach)
// BEFORE calling into the shared evaluator, so a caller can never learn
// anything about a corpse it has no business seeing (another instance's
// reservation, componentTags on a body outside scope) and never pays the
// evaluator's inventory/tool scans for a query that was always going to
// refuse. Its answer clones every array/object it returns, carries no
// entity/character/priority id and no corpse life token, starts nothing,
// reserves nothing, spends no rng and never rebinds a delve run
// (`sameHarvestScope` is the same cold, non-mutating check the session uses).
//
// `src/sim`-pure: no DOM/Three/render-ui-game-net imports, no Math.random/
// Date.now (enforced by tests/architecture.test.ts).

import type { CorpseHarvestInfo } from '../../world_api';
import { corpseCanInteract } from '../corpse_interaction';
import { MOBS } from '../data';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { dist2d, type Entity, INTERACT_RANGE, isConsuming } from '../types';
import {
  type CorpseHarvestGrantInputs,
  snapshotCorpseHarvestGrantInputs,
} from './corpse_harvest_grant';
import { sameHarvestScope } from './corpse_harvest_scope';
import { harvestConcentrationBonus } from './gathering';
import {
  admitCorpseHarvest,
  type HarvestAdmission,
  harvestPriorityKeyFor,
} from './harvest_admission';
import { ordinaryYieldFitsFor } from './harvest_ordinary_fit';
import { type HarvestPreference, resolveHarvestPreferenceOnCorpse } from './harvest_preference';

/** The corpse choice popup's reach: how far the player may drift before the
 *  popup that named this body closes. Deliberately WIDER than the reach a
 *  harvest actually needs (`INTERACT_RANGE`, the admission's own `inRange`
 *  fact): a popup that survives a step backwards is a courtesy, while an
 *  entry that named a body out of harvest reach would be a lie. Sim-owned so
 *  `game/harvest_body_pick.ts` (the popup's opening entry) consumes the same
 *  number instead of a second hand-carried literal. */
export const CORPSE_HARVEST_POPUP_RANGE = 7;

/** The real facts, exact admission decision, and frozen preview inputs behind
 *  one corpse-harvest attempt on `corpseId` by `pid` (or the resolved default
 *  player). Null means there is nothing to evaluate at all: no resolvable
 *  actor, an actor mid-leave, or no such corpse entity. */
export interface CorpseHarvestEvaluation {
  readonly actor: Entity;
  readonly meta: PlayerMeta;
  readonly mob: Entity;
  readonly componentTags: readonly string[];
  readonly admission: HarvestAdmission;
  readonly previewInputs: CorpseHarvestGrantInputs;
}

export function evaluateCorpseHarvest(
  ctx: SimContext,
  corpseId: number,
  pid?: number,
): CorpseHarvestEvaluation | null {
  const r = ctx.resolve(pid);
  if (!r) return null;
  const { meta, e: actor } = r;
  if (meta.leaving) return null;
  const mob = ctx.entities.get(corpseId);
  if (!mob) return null;

  const componentTags = MOBS[mob.templateId]?.componentTags ?? [];
  const preference = meta.harvestPreference;
  // A preview resolution, only to size the capacity pre-check below:
  // admitCorpseHarvest re-resolves the same preference for its own verdict,
  // so the two can never disagree about what a valid preference extracts.
  let previewChosen: readonly string[] = [];
  if (preference !== null) {
    const previewResolved = resolveHarvestPreferenceOnCorpse(componentTags, preference);
    if (previewResolved.kind !== 'unavailable') previewChosen = previewResolved.chosenComponents;
  }
  const previewInputs = snapshotCorpseHarvestGrantInputs(meta, componentTags, previewChosen);

  const corpseState = mob.corpseHarvestState;
  const admission = admitCorpseHarvest({
    actor: {
      entityId: actor.id,
      priorityKey: harvestPriorityKeyFor(meta),
      alive: !actor.dead,
      inCombat: actor.inCombat,
      alreadyCasting: actor.castingAbility !== null || isConsuming(actor),
      hasFieldKit: ctx.countItem('field_kit', actor.id) > 0,
      inRange: dist2d(actor.pos, mob.pos) <= INTERACT_RANGE,
      sameWorld: sameHarvestScope(ctx, actor.id, mob),
      ordinaryYieldFits: ordinaryYieldFitsFor(meta, previewInputs),
    },
    corpse: {
      entityId: mob.id,
      valid: corpseCanInteract(mob),
      claimed: mob.harvestClaimedBy !== null,
      remainingSeconds: mob.corpseTimer,
      priorityRemainingSeconds: corpseState ? corpseState.priorityEndsAt - ctx.time : 0,
      priorityMemberKeys: corpseState?.priorityMemberKeys ?? [],
      reservationOwnerId: corpseState?.reservedBy ?? null,
      componentTags,
    },
    preference,
  });

  return { actor, meta, mob, componentTags, admission, previewInputs };
}

function clonePreferenceForView(preference: HarvestPreference | null): HarvestPreference | null {
  if (preference === null) return null;
  return preference.kind === 'material'
    ? { kind: 'material', itemId: preference.itemId }
    : { kind: 'all' };
}

function reservationViewFor(
  ctx: SimContext,
  mob: Entity,
  viewerId: number,
): { readonly name: string; readonly self: boolean } | null {
  const reservedBy = mob.corpseHarvestState?.reservedBy;
  if (reservedBy === null || reservedBy === undefined) return null;
  const ownerMeta = ctx.players.get(reservedBy);
  if (!ownerMeta) return null;
  return { name: ownerMeta.name, self: reservedBy === viewerId };
}

/** The frozen public read a corpse-choice popup asks for (the exact
 *  `CorpseHarvestInfo` shape frozen in `world_api/interaction.ts`): never a
 *  permission to harvest, only the current status. `null` means no usable
 *  current answer (no such corpse in reach, or wrong scope), NEVER a denial:
 *  a real denial (out of range, no field kit, reserved, ...) is a populated
 *  object with `denial` set from the SAME admission `startCorpseHarvest`
 *  would run. */
export function corpseHarvestInfo(
  ctx: SimContext,
  corpseId: number,
  pid?: number,
): CorpseHarvestInfo | null {
  const r = ctx.resolve(pid);
  if (!r) return null;
  const { meta, e: actor } = r;
  const mob = ctx.entities.get(corpseId);
  if (!mob) return null;
  // Missing/non-corpse (a living mob, a pet, a player, an already-decayed
  // body), wrong scope, and beyond the popup's own reach all refuse HERE,
  // before the evaluator's inventory/tool scans run and before any of this
  // body's status (componentTags, reservation) is built or disclosed. Order
  // matters for the last two: `corpseCanInteract` is a cheap kind/state
  // check with no position math, so it runs before `sameHarvestScope`'s
  // context-branch walk; the range check is written in the POSITIVE
  // (`<=`) sense so a non-finite distance (which `sameHarvestScope` already
  // guards against for both positions, but this stays independently
  // NaN-safe) can never read as "in range" the way a bare `> RANGE` would.
  if (!corpseCanInteract(mob)) return null;
  if (!sameHarvestScope(ctx, actor.id, mob)) return null;
  if (!(dist2d(actor.pos, mob.pos) <= CORPSE_HARVEST_POPUP_RANGE)) return null;

  const evaluation = evaluateCorpseHarvest(ctx, corpseId, pid);
  if (!evaluation) return null;

  const tags = evaluation.componentTags;
  const chosen = evaluation.previewInputs.chosenComponents;
  const tierBonus = harvestConcentrationBonus(tags, chosen) - harvestConcentrationBonus(tags, []);

  return {
    corpseId: mob.id,
    componentTags: [...evaluation.componentTags],
    preference: clonePreferenceForView(meta.harvestPreference),
    denial: evaluation.admission.ok ? null : evaluation.admission.reason,
    reservation: reservationViewFor(ctx, mob, actor.id),
    tierBonus,
  };
}
