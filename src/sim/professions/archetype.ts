// Active-archetype state and quest-gated switching (issue #1129, superseded scope).
//
// Per the #107 decision (see the maintainer comment on #1129), the conserved-mass
// budget / opposite-craft-drain model this issue originally described was dropped.
// Knowledge in all ten crafts (see wheel.ts) stays flat and purely additive.
// Archetype selection may read skills to choose a deterministic hobby default,
// but it never mutates any craft skill value.
//
// Per #1129's actual text ("an adjacent pair, the two majors"), an archetype is
// NOT a single craft: it is `activeArchetype` (the craft the acceptance quest
// names; the granted TITLE is per pair, see getArchetypeTitle) PLUS `pairedMajor`, its ring-adjacent
// neighbor (content/professions.ts adjacentCrafts), together the two majors
// empowered past rare. Both start unset (null). Live profession quests select
// an exact adjacent pair through attuneArchetypePair. The legacy direct helpers
// acceptArchetypeQuest/switchArchetype retain their deterministic single-craft
// fallback for compatibility with older callers and saves.
//
// The active pair is set first by the zone-1 acceptance lore quest. New pairs
// use that repeatable quest, previously held pairs use the escalating make-amends
// quest, and hobby changes use their own repeatable quest. Quest effects validate
// the selected target at accept and turn-in before calling the transitions here.
//
// This module is `src/sim`-pure (see src/sim/CLAUDE.md): no DOM/render/ui/game/net
// imports, no Math.random/Date.now, host-agnostic so it runs offline, on the
// server, and in the headless RL env unchanged.

import { adjacentCrafts, CRAFT_RING, oppositeCraft } from '../content/professions';
import { COMBO_RECIPES } from '../content/recipes';
import type { SimContext } from '../sim_context';
import { type CraftSkills, tierCapability, tierForSkill, tierProgressMultiplier } from './wheel';

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
  // Explicit rare-capped hobby. For an active pair this is one of the two
  // crafts opposite its majors. Persisting it lets the hobby-switch quest
  // change the choice without changing either major.
  hobbyCraft: string | null;
  // Canonical unordered ids for every adjacent pair this character has held.
  // This distinguishes first-time lore attunement from a return that requires
  // make-amends.
  attunedPairs: string[];
  // Total number of successful archetype switches this character has ever made.
  switchCount: number;
  // Progress toward the CURRENT switch's amends requirement (see
  // requiredAmendsProgress). Reset to 0 on every successful switch.
  amendsProgress: number;
}

/** A fresh character: no archetype chosen yet, never switched. */
export function emptyArchetypeState(): ArchetypeState {
  return {
    activeArchetype: null,
    pairedMajor: null,
    hobbyCraft: null,
    attunedPairs: [],
    switchCount: 0,
    amendsProgress: 0,
  };
}

/** Backfill a persisted/partial record so an older save (predating this field, or
 *  predating `pairedMajor`) loads cleanly. A saved `pairedMajor` that is missing,
 *  invalid, or (from a pre-pair save) not ring-adjacent to `activeArchetype` is
 *  replaced by the deterministic default neighbor rather than left null, so an
 *  archetype set under the old single-craft model still gets a real pair. */
export function normalizeArchetypeState(
  saved: Partial<ArchetypeState> | undefined | null,
  skills: CraftSkills = {},
): ArchetypeState {
  const state = emptyArchetypeState();
  if (!saved) return state;
  if (typeof saved.activeArchetype === 'string' && isCraftId(saved.activeArchetype)) {
    state.activeArchetype = saved.activeArchetype;
  }
  if (state.activeArchetype !== null) {
    // The isAdjacent-or-redefault repair below CAN change pairedMajor when the
    // ring order changes between releases (v0.26.0 shipped this field, and the
    // Professions 2.0 reorder breaks 3 of the 10 old default pairs). That never
    // fires on a real save today for one reason only: every shipped build kept
    // the acceptance quests retired, so no production save holds a non-null
    // activeArchetype. THE INVARIANT THAT KEEPS THIS SAFE: the ring order and
    // the live quest wiring ship together (both land in PR 2039); never wire
    // the quests live in a release whose ring a later change intends to reorder.
    state.pairedMajor =
      typeof saved.pairedMajor === 'string' &&
      isCraftId(saved.pairedMajor) &&
      isAdjacent(state.activeArchetype, saved.pairedMajor)
        ? saved.pairedMajor
        : defaultPairedMajor(state.activeArchetype);
    const currentPairId = archetypePairId(state.activeArchetype, state.pairedMajor);
    const savedHistory = Array.isArray(saved.attunedPairs) ? saved.attunedPairs : [];
    // Drop-by-design: any saved pair id not in the CURRENT ARCHETYPE_PAIR_TARGETS
    // is silently discarded here. Safe for the same reason as pairedMajor above:
    // attunedPairs first ships WITH the reordered ring (and retired quests mean
    // no shipped save carries profession state at all), so a pre-reorder
    // canonical id cannot exist in production saves; anything unrecognized is a
    // hand-edited or corrupt value, and losing it is the intended behavior.
    // The current pair is re-derived and re-appended below, so an ACTIVE
    // attunement is never lost, only unrecognized history entries.
    state.attunedPairs = [...new Set(savedHistory.filter(isAdjacentPairTarget))];
    if (currentPairId && !state.attunedPairs.includes(currentPairId)) {
      state.attunedPairs.push(currentPairId);
    }
    const hobbyCandidates = hobbyCandidatesForPair(state.activeArchetype, state.pairedMajor);
    state.hobbyCraft =
      typeof saved.hobbyCraft === 'string' && hobbyCandidates.includes(saved.hobbyCraft)
        ? saved.hobbyCraft
        : defaultHobbyForPair(state.activeArchetype, state.pairedMajor, skills);
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

/** Stable unordered id for one adjacent pair. The order follows CRAFT_RING so
 * the same pair has one persisted/wire representation. */
export function archetypePairId(craftA: string, craftB: string | null): string | null {
  if (!craftB || !isCraftId(craftA) || !isCraftId(craftB) || !isAdjacent(craftA, craftB)) {
    return null;
  }
  const a = CRAFT_RING.findIndex((craft) => craft.id === craftA);
  const b = CRAFT_RING.findIndex((craft) => craft.id === craftB);
  if ((a + 1) % CRAFT_RING.length === b) return `${craftA}+${craftB}`;
  return `${craftB}+${craftA}`;
}

/** The ten selectable adjacent pair ids, in ring order. */
export const ARCHETYPE_PAIR_TARGETS: readonly string[] = CRAFT_RING.map(
  (craft, index) => `${craft.id}+${CRAFT_RING[(index + 1) % CRAFT_RING.length].id}`,
);

export function isAdjacentPairTarget(target: string): boolean {
  return ARCHETYPE_PAIR_TARGETS.includes(target);
}

export function craftsForPairTarget(target: string): [string, string] | null {
  if (!isAdjacentPairTarget(target)) return null;
  const [craftA, craftB] = target.split('+');
  return craftA && craftB ? [craftA, craftB] : null;
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

export function hobbyCandidatesForPair(activeArchetype: string, pairedMajor: string): string[] {
  if (
    !isCraftId(activeArchetype) ||
    !isCraftId(pairedMajor) ||
    !isAdjacent(activeArchetype, pairedMajor)
  ) {
    return [];
  }
  return [oppositeCraft(activeArchetype).id, oppositeCraft(pairedMajor).id];
}

/** Choose the higher retained-skill hobby, with ring order as the stable tie
 * break. This is used for first attunement and old-save backfill. */
export function defaultHobbyForPair(
  activeArchetype: string,
  pairedMajor: string,
  skills: CraftSkills = {},
): string | null {
  const candidates = hobbyCandidatesForPair(activeArchetype, pairedMajor);
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    const skillDelta = (skills[b] ?? 0) - (skills[a] ?? 0);
    if (skillDelta !== 0) return skillDelta;
    return (
      CRAFT_RING.findIndex((craft) => craft.id === a) -
      CRAFT_RING.findIndex((craft) => craft.id === b)
    );
  })[0];
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
  return meta
    ? { ...meta.archetype, attunedPairs: [...meta.archetype.attunedPairs] }
    : emptyArchetypeState();
}

// Issue #1130 (re-scoped per the comment on the live issue, then pair-named
// under the Professions 2.0 Phase 1 blueprint): a player's CURRENTLY-ACTIVE
// adjacent-pair attunement grants one named archetype title for that PAIR
// (Smith for weaponcrafting+armorcrafting, Bombardier for engineering+alchemy,
// and so on). There is no "Jack of All Trades" fallback under this model, since
// a character always has at most one active pair at a time; the natural analog
// of the old "below rare grants no title" rule is the pre-acceptance state
// (activeArchetype === null), which grants no title at all.
//
// `getArchetypeTitle` returns the TITLE'S IDENTIFIER, which is the active pair's
// CANONICAL PAIR ID (archetypePairId): the ten named titles are a strict
// one-to-one mapping onto the ten selectable adjacent pairs
// (ARCHETYPE_PAIR_TARGETS), so the pair id already uniquely identifies which
// title is granted. Keeping this an identifier (never localized English prose)
// matches the "IWorld is a string-free seam" rule (src/CLAUDE.md): the actual
// title WORDS are English-source, localized-at-client data, defined per pair id
// in src/ui/i18n.catalog/hud_chrome.ts under `archetypePair.<pairId>` (see that
// file for the ten title names chosen).

/** The granted title's identifier for a given active pair: the canonical pair
 *  id (archetypePairId) when a valid adjacent pair is set, or null before the
 *  acceptance quest (or for a malformed/non-adjacent pair, which should never
 *  happen for state that went through normalizeArchetypeState). */
export function getArchetypeTitle(
  activeArchetype: string | null,
  pairedMajor: string | null,
): string | null {
  if (activeArchetype === null) return null;
  return archetypePairId(activeArchetype, pairedMajor);
}

/** Read surface: the granted title identifier for a player's CURRENT active
 *  pair. Backs the IWorld `archetypeTitle` read (professions facet). Updates
 *  immediately when a pair transition changes the active archetype. */
export function archetypeTitleFor(ctx: SimContext, pid: number): string | null {
  const state = archetypeStateFor(ctx, pid);
  return getArchetypeTitle(state.activeArchetype, state.pairedMajor);
}

// Issue #1294 (the hobby): one opposite craft, empowered up to rare, is the
// player's explicit hobby alongside the two majors. Under the pair model each
// major has its own opposite craft, so a quest can switch between two candidates.

/** Legacy deterministic hobby fallback for saves/callers that only carry an
 *  active craft. Live identity reads use ArchetypeState.hobbyCraft. */
export function getHobbyCraft(activeArchetype: string | null): string | null {
  if (activeArchetype === null || !isCraftId(activeArchetype)) return null;
  return oppositeCraft(activeArchetype).id;
}

/** Read surface: the hobby craft id for a player's CURRENT active archetype.
 *  Backs the IWorld `hobbyCraft` read (professions facet). Updates
 *  immediately when switchArchetype changes the active archetype. */
export function hobbyCraftFor(ctx: SimContext, pid: number): string | null {
  return archetypeStateFor(ctx, pid).hobbyCraft;
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
  hobbyCraft: string | null = getHobbyCraft(activeArchetype),
): number {
  if (activeArchetype === null) return RARE_CEILING_TIER;
  if (craftId === activeArchetype || craftId === pairedMajor) return Infinity;
  if (craftId === hobbyCraft) return RARE_CEILING_TIER;
  return COMMON_CEILING_TIER;
}

/** The crafting skill-gain multiplier: the ONE composition both the sim's
 *  gainCraftSkill site (crafting.ts) and the crafting window's difficulty
 *  label consume, so the window hint can never diverge from the authoritative
 *  gain (#1129/#1148 doctrine). A recipe tier ABOVE this craft's ARCHETYPE
 *  ceiling grants zero, full stop: that is what makes a dormant or hobby
 *  craft's climb actually stop at its cap. The guard deliberately compares
 *  against the archetype ceiling ALONE, never craftCeiling's
 *  min-with-raw-capability: there is NO skillReq admission gate on crafting
 *  (content/recipes.ts documents that resolveCraft does not read skillReq),
 *  so a recipe tier above the player's RAW capability is the ordinary,
 *  doc-confirmed climb ("full at or above capability: this is how capability
 *  advances in the first place", wheel.ts). Below or at the ceiling, the
 *  ordinary curve (full at/above raw capability, reduced one tier under,
 *  zero two-plus under) applies off raw capability. */
export function craftSkillGainMultiplier(
  skills: CraftSkills,
  activeArchetype: string | null,
  pairedMajor: string | null,
  craftId: string,
  hobbyCraft: string | null,
  skillReq: number,
): number {
  const ceilingTier = archetypeCeilingFor(activeArchetype, pairedMajor, craftId, hobbyCraft);
  const recipeTier = tierForSkill(skillReq);
  return recipeTier > ceilingTier
    ? 0
    : tierProgressMultiplier(tierCapability(skills, craftId), recipeTier);
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
  hobbyCraft: string | null = getHobbyCraft(activeArchetype),
): number {
  return Math.min(
    tierCapability(skills, craftId),
    archetypeCeilingFor(activeArchetype, pairedMajor, craftId, hobbyCraft),
  );
}

/** Legacy single-craft acceptance hook: on FIRST completion only,
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
  meta.archetype.hobbyCraft = defaultHobbyForPair(
    craftId,
    meta.archetype.pairedMajor,
    meta.craftSkills,
  );
  const pairId = archetypePairId(craftId, meta.archetype.pairedMajor);
  if (pairId) meta.archetype.attunedPairs = [pairId];
  return true;
}

export type AttunementMode = 'new' | 'return';

/** Apply a quest-validated pair transition. New pairs do not raise the return
 * escalation counter. Returning to a held pair does. */
export function attuneArchetypePair(
  ctx: SimContext,
  pid: number,
  target: string,
  mode: AttunementMode,
): boolean {
  const meta = ctx.players.get(pid);
  const pair = craftsForPairTarget(target);
  if (!meta || !pair) return false;
  const [activeArchetype, pairedMajor] = pair;
  const state = meta.archetype;
  const current = archetypePairId(state.activeArchetype ?? '', state.pairedMajor);
  if (current === target) return false;
  const seen = state.attunedPairs.includes(target);
  if ((mode === 'new' && seen) || (mode === 'return' && !seen)) return false;

  state.activeArchetype = activeArchetype;
  state.pairedMajor = pairedMajor;
  state.hobbyCraft = defaultHobbyForPair(activeArchetype, pairedMajor, meta.craftSkills);
  if (!seen) state.attunedPairs.push(target);
  if (mode === 'return') state.switchCount += 1;
  state.amendsProgress = 0;
  return true;
}

export function canAttuneArchetypePair(
  state: ArchetypeState,
  target: string,
  mode: AttunementMode,
): boolean {
  if (!isAdjacentPairTarget(target)) return false;
  if (archetypePairId(state.activeArchetype ?? '', state.pairedMajor) === target) return false;
  const seen = state.attunedPairs.includes(target);
  return mode === 'new' ? !seen : seen;
}

export function canSwitchHobby(state: ArchetypeState, target: string): boolean {
  if (!state.activeArchetype || !state.pairedMajor || target === state.hobbyCraft) return false;
  return hobbyCandidatesForPair(state.activeArchetype, state.pairedMajor).includes(target);
}

export function switchHobby(ctx: SimContext, pid: number, target: string): boolean {
  const meta = ctx.players.get(pid);
  if (!meta || !canSwitchHobby(meta.archetype, target)) return false;
  meta.archetype.hobbyCraft = target;
  return true;
}

/** Legacy direct make-amends credit helper: advances
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
  state.hobbyCraft = defaultHobbyForPair(craftId, state.pairedMajor, meta.craftSkills);
  const pairId = archetypePairId(craftId, state.pairedMajor);
  if (pairId && !state.attunedPairs.includes(pairId)) state.attunedPairs.push(pairId);
  state.switchCount += 1;
  state.amendsProgress = 0;
  return true;
}
