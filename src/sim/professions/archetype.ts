// Active-archetype state and quest-gated switching (issue #1129, superseded scope).
//
// Per the #107 decision (see the maintainer comment on #1129), the conserved-mass
// budget / opposite-craft-drain model this issue originally described was dropped.
// Knowledge in all ten crafts (see wheel.ts) stays flat and purely additive: this
// module never reads or writes CraftSkills, and archetype selection/switching NEVER
// touches any craft skill value.
//
// Per #1129's actual text ("an adjacent pair, the two majors"), an archetype is
// NOT a single craft: it is `activeArchetype` (the craft the acceptance/title
// quest names, see getArchetypeTitle) PLUS `pairedMajor`, its ring-adjacent
// neighbor (content/professions.ts adjacentCrafts), together the two majors
// empowered past rare. Both start unset (null). Which of the two ring-adjacent
// neighbors becomes the pair is not yet a player choice (the acceptance quest
// is a content stub, like the rest of this module); acceptArchetypeQuest/
// switchArchetype default it deterministically via defaultPairedMajor below,
// preferring the neighbor a content combo recipe already pairs the craft with
// so no attunement choice strands its own themed combo. A real quest choosing
// the neighbor, and #1293's later hobby-flip, are both future content work
// over this same state shape.
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

import { adjacentCrafts, CRAFT_RING, oppositeCraft } from '../content/professions';
import { COMBO_RECIPES } from '../content/recipes';
import type { SimContext } from '../sim_context';
import { type CraftSkills, tierCapability } from './wheel';

/** A character's active-archetype progression, persisted in CharacterState. */
export interface ArchetypeState {
  // The chosen craft id (see content/professions.ts CRAFT_RING) naming the title/
  // identity major, or null before the zone-1 acceptance quest has ever been
  // completed.
  activeArchetype: string | null;
  // The second major: always ring-adjacent to activeArchetype (see
  // adjacentCrafts), together the "two majors" #1129 empowers past rare. Null
  // exactly when activeArchetype is null.
  pairedMajor: string | null;
  // Total number of successful archetype switches this character has ever made.
  switchCount: number;
  // Progress toward the CURRENT switch's amends requirement (see
  // requiredAmendsProgress). Reset to 0 on every successful switch.
  amendsProgress: number;
}

/** A fresh character: no archetype chosen yet, never switched. */
export function emptyArchetypeState(): ArchetypeState {
  return { activeArchetype: null, pairedMajor: null, switchCount: 0, amendsProgress: 0 };
}

/** Backfill a persisted/partial record so an older save (predating this field, or
 *  predating `pairedMajor`) loads cleanly. A saved `pairedMajor` that is missing,
 *  invalid, or (from a pre-pair save) not ring-adjacent to `activeArchetype` is
 *  replaced by the deterministic default neighbor rather than left null, so an
 *  archetype set under the old single-craft model still gets a real pair. */
export function normalizeArchetypeState(
  saved: Partial<ArchetypeState> | undefined | null,
): ArchetypeState {
  const state = emptyArchetypeState();
  if (!saved) return state;
  if (typeof saved.activeArchetype === 'string' && isCraftId(saved.activeArchetype)) {
    state.activeArchetype = saved.activeArchetype;
  }
  if (state.activeArchetype !== null) {
    state.pairedMajor =
      typeof saved.pairedMajor === 'string' &&
      isCraftId(saved.pairedMajor) &&
      isAdjacent(state.activeArchetype, saved.pairedMajor)
        ? saved.pairedMajor
        : defaultPairedMajor(state.activeArchetype);
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

/** Whether `b` is one of `a`'s two ring-adjacent neighbors. */
function isAdjacent(a: string, b: string): boolean {
  return adjacentCrafts(a).some((craft) => craft.id === b);
}

/** The ring-adjacent craft paired with `craftId` in a content combo recipe
 *  (content/recipes.ts COMBO_RECIPES), or null when no combo names it. Every
 *  combo pair is ring-adjacent by content contract (see meetsComboRequirement
 *  in crafting.ts), and no craft appears in more than one combo pair today. */
function comboPartnerOf(craftId: string): string | null {
  for (const recipe of COMBO_RECIPES) {
    const combo = recipe.comboRequirement;
    if (!combo) continue;
    if (combo.craftA === craftId) return combo.craftB;
    if (combo.craftB === craftId) return combo.craftA;
  }
  return null;
}

/** The deterministic default second major for a primary craft. See the module
 *  comment: which neighbor becomes the pair is not yet a player choice, so
 *  this prefers the neighbor a content combo recipe already commits the craft
 *  to (the design doc's own canonical adjacencies: armorcrafting with
 *  weaponcrafting, alchemy with engineering), so attuning EITHER side of a
 *  combo never strands that combo behind the common ceiling; a craft with no
 *  content combo defaults to its first ring-adjacent neighbor. */
function defaultPairedMajor(activeArchetype: string): string {
  const neighbors = adjacentCrafts(activeArchetype);
  const partner = comboPartnerOf(activeArchetype);
  const match = neighbors.find((craft) => craft.id === partner);
  return (match ?? neighbors[0]).id;
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

// Issue #1130 (re-scoped per the comment on the live issue, superseding its stale
// two-crafts-at-rare title/body): a player's CURRENTLY-ACTIVE archetype grants the
// named title for that craft. There is no "Jack of All Trades" fallback under this
// model, since a character always has at most one active archetype at a time; the
// natural analog of the old "below rare grants no title" rule is the pre-acceptance
// state (activeArchetype === null), which grants no title at all.
//
// `getArchetypeTitle` returns the TITLE'S IDENTIFIER, which is simply the active
// craft id itself: the ten named titles are a strict one-to-one mapping onto the
// ten crafts on the ring (see content/professions.ts CRAFT_RING), so the craft id
// already uniquely identifies which title is granted. Keeping this an identifier
// (never localized English prose) matches the "IWorld is a string-free seam" rule
// (src/CLAUDE.md): the actual title WORDS are English-source, localized-at-client
// data, defined per craft id in src/ui/i18n.catalog/hud_chrome.ts under
// `archetypeTitle.<craftId>` (see that file for the ten title names chosen).

/** The granted title's identifier for a given active archetype: the craft id
 *  itself when one is set and valid, or null before the acceptance quest (or for
 *  a malformed/unknown craft id, which should never happen for real state). */
export function getArchetypeTitle(activeArchetype: string | null): string | null {
  if (activeArchetype === null) return null;
  return isCraftId(activeArchetype) ? activeArchetype : null;
}

/** Read surface: the granted title identifier for a player's CURRENT active
 *  archetype. Backs the IWorld `archetypeTitle` read (professions facet). Updates
 *  immediately when switchArchetype changes the active archetype. */
export function archetypeTitleFor(ctx: SimContext, pid: number): string | null {
  return getArchetypeTitle(archetypeStateFor(ctx, pid).activeArchetype);
}

// Issue #1294 (the hobby): one opposite craft, empowered up to rare, is the
// player's "hobby" alongside their active archetype's two majors. Under the
// pair model each major has its own opposite craft, so there are two
// candidate hobby crafts (this is exactly what makes #1293's later hobby-flip
// quest meaningful: it would let a player pick between them). Which one is
// live today is not yet a player choice, so this deterministically picks the
// opposite of `activeArchetype` (the title-quest major), not `pairedMajor`.

/** The player's current hobby craft id: the opposite craft on CRAFT_RING from
 *  their active archetype, empowered up to rare per `archetypeCeilingFor`.
 *  `null` before any archetype has ever been chosen (there is no hobby
 *  without a major to be opposite of). */
export function getHobbyCraft(activeArchetype: string | null): string | null {
  if (activeArchetype === null || !isCraftId(activeArchetype)) return null;
  return oppositeCraft(activeArchetype).id;
}

/** Read surface: the hobby craft id for a player's CURRENT active archetype.
 *  Backs the IWorld `hobbyCraft` read (professions facet). Updates
 *  immediately when switchArchetype changes the active archetype. */
export function hobbyCraftFor(ctx: SimContext, pid: number): string | null {
  return getHobbyCraft(archetypeStateFor(ctx, pid).activeArchetype);
}

// #1129/#1203 empowerment ceiling: this is the composition point that makes the
// active archetype matter, not just track it. The reachable ceiling for a craft
// is min(tierCapability from #1128/#1203, archetypeCapability derived from this
// state below): unlimited for BOTH majors (activeArchetype and pairedMajor),
// capped at "rare" for the hobby (the opposite craft on CRAFT_RING from
// activeArchetype), capped at "common" for every other craft once an archetype
// is set, uncapped-to-rare before any archetype is set at all.
// `archetypeCeilingFor` computes the archetype-derived half of that min;
// `craftCeiling` composes it with wheel.ts's `tierCapability` for a given
// player's flat skill state. Consumers: crafting.ts's tier-progress multiplier
// (the gainCraftSkill call site), crafting.ts's output-quality roll, and
// `meetsComboRequirement`'s dual-craft tier gate, all of which read the
// ceiling instead of the raw tier capability. #1281's Battlefield Experience
// trickle calls the same gainCraftSkill primitive but gates on its own
// narrower "one of the two active majors" check (battlefield_xp.ts).

// Ceiling tiers, expressed in wheel.ts's tier-index units (see tierForSkill):
// tier 0 is the "common" free floor per wheel.ts's own naming; tier 2 is
// "rare" under the same five-rung ladder crafting.ts already reuses for
// output quality (gathering.ts's MaterialRarity: common=0, uncommon=1,
// rare=2, epic=3, legendary=4).
const COMMON_CEILING_TIER = 0;
const RARE_CEILING_TIER = 2;

/** The archetype-derived half of the empowerment ceiling for one craft: no
 *  cap (Infinity) for either of the player's two majors (`activeArchetype` or
 *  `pairedMajor`), capped at "rare" for the hobby (the opposite craft on
 *  CRAFT_RING from `activeArchetype`) and, before any archetype has ever been
 *  chosen, for every craft; capped at "common" for every other craft once an
 *  archetype is set. `pairedMajor` should be null exactly when
 *  `activeArchetype` is (see ArchetypeState); passing a non-null
 *  `activeArchetype` with a null `pairedMajor` (a malformed/pre-pair state
 *  that skipped `normalizeArchetypeState`) degrades to the single-craft
 *  reading rather than throwing. */
export function archetypeCeilingFor(
  activeArchetype: string | null,
  pairedMajor: string | null,
  craftId: string,
): number {
  if (activeArchetype === null) return RARE_CEILING_TIER;
  if (craftId === activeArchetype || craftId === pairedMajor) return Infinity;
  if (craftId === oppositeCraft(activeArchetype).id) return RARE_CEILING_TIER;
  return COMMON_CEILING_TIER;
}

/** The actually-reachable tier ceiling for one craft: the lesser of the raw
 *  flat-skill tier capability (wheel.ts `tierCapability`) and the
 *  archetype-derived ceiling above. This is what a crafting/skill-gain call
 *  site should read instead of raw `tierCapability` once archetype state is
 *  in play. */
export function craftCeiling(
  skills: CraftSkills,
  activeArchetype: string | null,
  pairedMajor: string | null,
  craftId: string,
): number {
  return Math.min(
    tierCapability(skills, craftId),
    archetypeCeilingFor(activeArchetype, pairedMajor, craftId),
  );
}

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
  meta.archetype.pairedMajor = defaultPairedMajor(craftId);
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
  state.pairedMajor = defaultPairedMajor(craftId);
  state.switchCount += 1;
  state.amendsProgress = 0;
  return true;
}
