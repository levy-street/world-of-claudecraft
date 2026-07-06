// Active-archetype state and quest-gated switching (issue #1129, superseded scope).
//
// Per the #107 decision (see the maintainer comment on #1129), the conserved-mass
// budget / opposite-craft-drain model this issue originally described was dropped.
// Knowledge in all ten crafts (see wheel.ts) stays flat and purely additive: this
// module never reads or writes CraftSkills, and archetype selection/switching NEVER
// touches any craft skill value. Archetype identity instead comes from a single
// "active archetype" field: one of the ten crafts on the ring (content/professions.ts)
// a character has declared as their identity. It starts unset (null).
//
// The active archetype is set for the first time by a zone-1 acceptance lore quest,
// and can only be changed afterward by first completing a repeatable, escalating
// "make amends" quest. Each successful switch increments a persisted per-character
// switchCount, and the amount of amends-quest progress required to switch again
// scales with that count (see requiredAmendsProgress below).
//
// STUB, documented explicitly: this module implements the full state machine (the
// interesting, testable logic), but the two quests themselves are content stubs.
// Real quest giver/turn-in NPC placement and dialogue authoring for a zone-1 lore
// quest, plus a genuinely repeatable turn-in flow (the existing quest engine in
// src/sim/quests/ is one-time only: turnInQuestCore adds the quest id to
// `questsDone` and there is no re-accept path), are out of scope for this change.
// Instead, acceptArchetypeQuest/advanceAmendsProgress are the direct entry points a
// (future) quest-completion hook calls; see content/zone1.ts for the placeholder
// QuestDef records these stand in for.
//
// This module is `src/sim`-pure (see src/sim/CLAUDE.md): no DOM/render/ui/game/net
// imports, no Math.random/Date.now, host-agnostic so it runs offline, on the
// server, and in the headless RL env unchanged.

import { CRAFT_RING } from '../content/professions';
import type { SimContext } from '../sim_context';

/** A character's active-archetype progression, persisted in CharacterState. */
export interface ArchetypeState {
  // The chosen craft id (see content/professions.ts CRAFT_RING), or null before the
  // zone-1 acceptance quest has ever been completed.
  activeArchetype: string | null;
  // Total number of successful archetype switches this character has ever made.
  switchCount: number;
  // Progress toward the CURRENT switch's amends requirement (see
  // requiredAmendsProgress). Reset to 0 on every successful switch.
  amendsProgress: number;
}

/** A fresh character: no archetype chosen yet, never switched. */
export function emptyArchetypeState(): ArchetypeState {
  return { activeArchetype: null, switchCount: 0, amendsProgress: 0 };
}

/** Backfill a persisted/partial record so an older save (predating this field)
 *  loads cleanly as a fresh, unset archetype state. */
export function normalizeArchetypeState(
  saved: Partial<ArchetypeState> | undefined | null,
): ArchetypeState {
  const state = emptyArchetypeState();
  if (!saved) return state;
  if (typeof saved.activeArchetype === 'string' && isCraftId(saved.activeArchetype)) {
    state.activeArchetype = saved.activeArchetype;
  }
  if (
    typeof saved.switchCount === 'number' &&
    Number.isFinite(saved.switchCount) &&
    saved.switchCount >= 0
  ) {
    state.switchCount = saved.switchCount;
  }
  if (
    typeof saved.amendsProgress === 'number' &&
    Number.isFinite(saved.amendsProgress) &&
    saved.amendsProgress >= 0
  ) {
    state.amendsProgress = saved.amendsProgress;
  }
  return state;
}

function isCraftId(id: string): boolean {
  return CRAFT_RING.some((craft) => craft.id === id);
}

// Escalation formula for the repeatable "make amends" quest: a modest linear
// ramp, base 5 (matching the typical zone-1 kill/collect objective count seen in
// content/zone1.ts) plus 3 more per prior switch, so switching gets meaningfully
// harder each time without inventing an unrelated balance number. switchCount is
// the number of switches already made BEFORE this attempt (0 for the very first
// switch away from the acceptance-quest archetype).
export function requiredAmendsProgress(switchCount: number): number {
  const priorSwitches = Math.max(0, Math.floor(switchCount));
  return 5 + priorSwitches * 3;
}

/** Read surface: a copy of a player's archetype state. Backs the IWorld
 *  `activeArchetype`/`archetypeSwitchCount` reads (professions facet). */
export function archetypeStateFor(ctx: SimContext, pid: number): ArchetypeState {
  const meta = ctx.players.get(pid);
  return meta ? { ...meta.archetype } : emptyArchetypeState();
}

// TODO(#1129/#1203): this module only tracks WHICH craft is the active archetype,
// not the empowerment ceiling that makes it matter. Per #1129's revised acceptance
// criteria, the reachable ceiling for a craft is
// min(tierCapability from #1128/#1203, archetypeCapability derived from this state:
// unlimited for the two active-archetype majors, capped at "rare" for the hobby
// (the opposite craft on CRAFT_RING), capped at "common" for every other craft once
// an archetype is set, uncapped-to-rare before any archetype is set at all). That
// composition point does not exist yet: crafting.ts is still common-tier only
// (#1127 scope) and wheel.ts's gainCraftSkill has no ceiling at all. Whichever of
// #1203 (tier capability) or this module lands second should wire this in, so the
// archetype gate does not silently slip. #1281's Battlefield Experience trickle
// calls the same gainCraftSkill primitive and will compose automatically once the
// ceiling lands there (see its own TODO(#1149/#1205)).

/** The zone-1 acceptance quest's stubbed completion hook: on FIRST completion only,
 *  sets the chosen craft as the character's active archetype. A no-op (does not
 *  re-trigger, does not change the archetype) if one is already set, since the
 *  acceptance quest exists once per character; changing an existing archetype
 *  always goes through switchArchetype/the make-amends quest instead. Returns
 *  whether the archetype was set. */
export function acceptArchetypeQuest(ctx: SimContext, pid: number, craftId: string): boolean {
  const meta = ctx.players.get(pid);
  if (!meta || !isCraftId(craftId)) return false;
  if (meta.archetype.activeArchetype !== null) return false;
  meta.archetype.activeArchetype = craftId;
  return true;
}

/** The repeatable "make amends" quest's stubbed per-completion credit: advances
 *  progress toward the currently required threshold by one. A no-op before an
 *  archetype has ever been chosen (there is nothing to switch away from yet). */
export function advanceAmendsProgress(ctx: SimContext, pid: number): void {
  const meta = ctx.players.get(pid);
  if (!meta || meta.archetype.activeArchetype === null) return;
  meta.archetype.amendsProgress += 1;
}

/** Attempt to switch the active archetype to a different craft. Blocked (a
 *  complete no-op: archetype, switchCount, and amendsProgress all unchanged) unless
 *  an archetype is already set, the target is a different, valid craft, and enough
 *  amends progress has accrued (see requiredAmendsProgress). On success: sets the
 *  new archetype, increments switchCount by exactly 1, and resets amendsProgress to
 *  0 for the next switch's requirement. Never touches craftSkills. Returns whether
 *  the switch happened. */
export function switchArchetype(ctx: SimContext, pid: number, craftId: string): boolean {
  const meta = ctx.players.get(pid);
  if (!meta || !isCraftId(craftId)) return false;
  const state = meta.archetype;
  if (state.activeArchetype === null || state.activeArchetype === craftId) return false;
  if (state.amendsProgress < requiredAmendsProgress(state.switchCount)) return false;
  state.activeArchetype = craftId;
  state.switchCount += 1;
  state.amendsProgress = 0;
  return true;
}
