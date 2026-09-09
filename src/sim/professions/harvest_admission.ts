// Corpse-harvest ADMISSION (Intentional Gathering, PR3): may this actor start a
// harvest cast on this body, and with which pick?
//
// Pure leaf: plain facts in, a verdict out. No SimContext, no Entity, no clock,
// no rng, no I/O, no mutation of anything the caller owns. It starts no cast,
// takes no reservation, spends no claim and reserves no resource; the session
// coordinator owns every side effect and owns the existing yield inputs (town
// focus, tools), which is why none of them are accepted or frozen here.
//
// Timing is RELATIVE and caller-supplied (seconds remaining), so this leaf never
// reads a clock and never extends a corpse's lifetime: it can only refuse one.
// Fields here are an in-memory decision shape, not a persistence or wire
// decision.

import type { GathererIdentity } from '../material_gatherer';
import {
  corpseHarvestPreferenceOptions,
  type HarvestMaterialOption,
  type HarvestPreference,
  resolveHarvestPreferenceOnCorpse,
} from './harvest_preference';

/** The corpse-harvest cast length. A body with less life left than this is
 *  refused rather than admitted into a cast it cannot finish. */
export const HARVEST_CAST_SECONDS = 1.5;

/** How long the kill-credit group keeps the body to itself before it opens to
 *  everyone. */
export const HARVEST_PRIORITY_SECONDS = 10;

/**
 * The stable priority-window identity for one actor: domain-prefixed from a
 * TRUSTED persisted identity (`character:<id>` for an online character,
 * `offline:<id>` / `headless:<id>` for a persisted local identity, the same
 * `GathererIdentity` `material_gatherer.ts` already mints and never invents),
 * or `entity:<id>` for an actor with no such identity yet (a bare test Sim,
 * an unpersisted host). NEVER derived from a display name: two characters can
 * share a name, and a rename must never move a priority claim.
 *
 * This is what lets a snapshotted killer's priority survive a disconnect and
 * reconnect (which mints a fresh entity id) while still keeping two same-named
 * but distinct characters, or a namesake bystander, fully isolated.
 */
export function harvestPriorityKeyFor(actor: {
  readonly entityId: number;
  readonly gathererIdentity?: GathererIdentity;
}): string {
  const identity = actor.gathererIdentity;
  return identity ? `${identity.kind}:${identity.id}` : `entity:${actor.entityId}`;
}

export interface HarvestActorFacts {
  readonly entityId: number;
  /**
   * The actor's STABLE priority identity (see `harvestPriorityKeyFor`):
   * domain-prefixed (`character:<id>` / `offline:<id>` / `headless:<id>`)
   * from a trusted persisted identity, or `entity:<id>` for an unpersisted
   * test/host actor. Compared against `HarvestCorpseFacts.priorityMemberKeys`
   * instead of the raw entity id so a disconnect/rejoin (which mints a new
   * entity id) does not forfeit an earned priority window. Never a display
   * name.
   */
  readonly priorityKey: string;
  readonly alive: boolean;
  readonly inCombat: boolean;
  /** Any cast or session already running: one harvest at a time. */
  readonly alreadyCasting: boolean;
  readonly hasFieldKit: boolean;
  readonly inRange: boolean;
  /** Same world/instance as the corpse, resolved by the caller. */
  readonly sameWorld: boolean;
  /** Room for the ORDINARY yield, decided by the caller's capacity gate. */
  readonly ordinaryYieldFits: boolean;
}

export interface HarvestCorpseFacts {
  readonly entityId: number;
  /** Still an interactable corpse (not decayed, despawned or looted away). */
  readonly valid: boolean;
  /** The single-use claim is already spent. */
  readonly claimed: boolean;
  readonly remainingSeconds: number;
  readonly priorityRemainingSeconds: number;
  /**
   * The kill-credit group's STABLE priority keys AS OF DEATH (see
   * `HarvestActorFacts.priorityKey`). A death snapshot, never a live party
   * read: joining the killer's party afterwards must not grant priority, and
   * there is deliberately no input through which current membership could
   * arrive. Empty means nobody is owed the window, so the body is public at
   * once. Keyed on stable identity (not entity id) so a snapshotted member
   * who disconnects and reconnects mid-window keeps their admission.
   */
  readonly priorityMemberKeys: readonly string[];
  /** A live reservation the caller has already verified, or null. */
  readonly reservationOwnerId: number | null;
  readonly componentTags: readonly string[];
}

export interface HarvestAdmissionInput {
  readonly actor: HarvestActorFacts;
  readonly corpse: HarvestCorpseFacts;
  /** null = the persisted preference was malformed; the player owes an explicit
   *  new choice and nothing may be harvested until they make one. */
  readonly preference: HarvestPreference | null;
}

/** Stable codes, never English: the caller maps one to its own refusal event. */
export type HarvestAdmissionReason =
  | 'malformed_input'
  | 'actor_dead'
  | 'actor_in_combat'
  | 'actor_busy'
  | 'corpse_invalid'
  | 'wrong_world'
  | 'out_of_range'
  | 'no_field_kit'
  | 'already_harvested'
  | 'reserved'
  | 'priority_protected'
  | 'corpse_expiring'
  | 'preference_malformed'
  | 'nothing_to_harvest'
  | 'material_unavailable'
  | 'bags_full';

/** What an admitted attempt is allowed to do, cloned so nothing aliases the
 *  caller's facts. `chosenComponents` is the `chosen` argument the canonical
 *  harvest path already takes (empty = the canonical spread). */
export interface AdmittedHarvest {
  readonly actorEntityId: number;
  readonly corpseEntityId: number;
  readonly preference: HarvestPreference;
  readonly chosenComponents: readonly string[];
}

export type HarvestAdmission =
  | { readonly ok: true; readonly admitted: AdmittedHarvest }
  | {
      readonly ok: false;
      readonly reason: HarvestAdmissionReason;
      /** Only on `material_unavailable`: what this body does offer. */
      readonly available?: readonly HarvestMaterialOption[];
    };

/** Max length for a stable priority key (`character:<id>` etc): generous
 *  enough for any real identity, tight enough to reject garbage input. */
const MAX_PRIORITY_KEY_LENGTH = 128;

function isEntityId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isFiniteSeconds(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidPriorityKey(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PRIORITY_KEY_LENGTH;
}

function isMalformed(input: HarvestAdmissionInput): boolean {
  const { actor, corpse } = input;
  if (!isEntityId(actor.entityId) || !isEntityId(corpse.entityId)) return true;
  if (!isValidPriorityKey(actor.priorityKey)) return true;
  if (!isFiniteSeconds(corpse.remainingSeconds)) return true;
  if (!isFiniteSeconds(corpse.priorityRemainingSeconds)) return true;
  if (corpse.reservationOwnerId !== null && !isEntityId(corpse.reservationOwnerId)) return true;
  return corpse.priorityMemberKeys.some((key) => !isValidPriorityKey(key));
}

/** Is the death snapshot still holding this body against this actor? Empty
 *  snapshot: nobody is protected. Exactly 0 seconds left opens it publicly. */
function priorityProtects(corpse: HarvestCorpseFacts, actorPriorityKey: string): boolean {
  if (corpse.priorityMemberKeys.length === 0) return false;
  if (corpse.priorityMemberKeys.includes(actorPriorityKey)) return false;
  return corpse.priorityRemainingSeconds > 0;
}

function clonePreference(preference: HarvestPreference): HarvestPreference {
  return preference.kind === 'material'
    ? { kind: 'material', itemId: preference.itemId }
    : { kind: 'all' };
}

function cloneOptions(options: readonly HarvestMaterialOption[]): HarvestMaterialOption[] {
  return options.map((option) => ({ itemId: option.itemId, components: [...option.components] }));
}

/**
 * The one admission decision.
 *
 * PRECEDENCE, stable and outermost-scope-first, so a stacked failure always
 * reports the widest true cause: structure, actor state, corpse existence,
 * reachability, the actor's own kit, exclusive claim state, kill-credit rights,
 * time left, what the harvest would yield, and last the room to hold it.
 *
 * A non-positive lifetime is `corpse_invalid` (there is no corpse left), while a
 * positive one under the cast length is `corpse_expiring` (there is a corpse,
 * but not for long enough).
 */
export function admitCorpseHarvest(input: HarvestAdmissionInput): HarvestAdmission {
  const { actor, corpse, preference } = input;
  if (isMalformed(input)) return { ok: false, reason: 'malformed_input' };
  if (!actor.alive) return { ok: false, reason: 'actor_dead' };
  if (actor.inCombat) return { ok: false, reason: 'actor_in_combat' };
  if (actor.alreadyCasting) return { ok: false, reason: 'actor_busy' };
  if (!corpse.valid || corpse.remainingSeconds <= 0) return { ok: false, reason: 'corpse_invalid' };
  if (!actor.sameWorld) return { ok: false, reason: 'wrong_world' };
  if (!actor.inRange) return { ok: false, reason: 'out_of_range' };
  if (!actor.hasFieldKit) return { ok: false, reason: 'no_field_kit' };
  if (corpse.claimed) return { ok: false, reason: 'already_harvested' };
  // A held reservation refuses everyone, its owner included: a second admitted
  // attempt would be a duplicate cast against one reservation, and this leaf
  // cannot see whose cast is live.
  if (corpse.reservationOwnerId !== null) return { ok: false, reason: 'reserved' };
  if (priorityProtects(corpse, actor.priorityKey)) {
    return { ok: false, reason: 'priority_protected' };
  }
  if (corpse.remainingSeconds < HARVEST_CAST_SECONDS) {
    return { ok: false, reason: 'corpse_expiring' };
  }
  if (preference === null) return { ok: false, reason: 'preference_malformed' };
  // The supported families ARE the preference module's picker rows, so what an
  // admission accepts and what a picker offers cannot drift.
  const supported = corpseHarvestPreferenceOptions(corpse.componentTags).filter(
    (option) => option.kind === 'material',
  );
  if (supported.length === 0) return { ok: false, reason: 'nothing_to_harvest' };
  const resolved = resolveHarvestPreferenceOnCorpse(corpse.componentTags, preference);
  if (resolved.kind === 'unavailable') {
    const available = cloneOptions(resolved.available);
    return { ok: false, reason: 'material_unavailable', available };
  }
  if (!actor.ordinaryYieldFits) return { ok: false, reason: 'bags_full' };
  return {
    ok: true,
    admitted: {
      actorEntityId: actor.entityId,
      corpseEntityId: corpse.entityId,
      preference: clonePreference(preference),
      chosenComponents: [...resolved.chosenComponents],
    },
  };
}
