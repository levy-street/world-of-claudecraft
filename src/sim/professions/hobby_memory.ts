// Quested-hobby memory (Professions 2.0): the per-PAIR record of the hobby a
// character explicitly chose through the hobby-switch quest, so a later return
// to that pair (the make-amends quest) restores that choice instead of silently
// re-deriving the skill default.
//
// Why a persisted per-pair record rather than a flag beside hobbyCraft: the
// explicit choice is destroyed at the transition AWAY, not at the return.
// attuneArchetypePair rewrites hobbyCraft to defaultHobbyForPair on EVERY
// transition, in both modes, so by the time the make-amends return runs there is
// nothing local left to keep. Keyed by canonical pair id (archetype.ts
// archetypePairId), the record survives an arbitrarily long dormant period and
// is bounded by the ten selectable pairs (ARCHETYPE_PAIR_TARGETS), so it cannot
// grow without limit.
//
// The shape follows professions/tier_mail.ts deliberately, field for field: a
// PlayerMeta Map persisted with zero-default omission, a normalize-on-load
// helper that keeps only entries the shipped ring can still explain, and ONE
// apply-at-every-pair-transition function whose three call sites are the quest
// effect path (quests/profession_quest_effects.ts) plus the two legacy sim.ts
// wrappers. Restoring from OUTSIDE archetype.ts is also what keeps the two
// modules from importing each other: this module reads archetype's pair
// vocabulary, so archetype.ts must not read this one.
//
// Only the QUEST path records, which is the whole point: the memory holds
// choices a player deliberately quested for, never a default the engine derived
// for them.
//
// This module is `src/sim`-pure (see src/sim/CLAUDE.md): no DOM/render/ui/game/
// net imports, no Math.random/Date.now, host-agnostic.

import type { PlayerMeta } from '../sim';
import { archetypePairId, craftsForPairTarget, hobbyCandidatesForPair } from './archetype';

/** The hobby candidates for a canonical pair id, or an empty list when the id
 *  is not one of the ten shipped pair targets. */
function candidatesForPairId(pairId: string): readonly string[] {
  const pair = craftsForPairTarget(pairId);
  return pair ? hobbyCandidatesForPair(pair[0], pair[1]) : [];
}

/** Rebuild the persisted quested-hobby record into a live map, keeping only
 *  entries whose KEY is one of the ten shipped pair ids and whose VALUE is a
 *  hobby candidate of that pair. A key from some other ring order, or a value
 *  that is no longer a candidate, drops on load and self-heals out of the
 *  record; the pair then simply falls back to its skill default on the next
 *  return, exactly as it did before this feature. Mirrors
 *  tier_mail.ts normalizeTierMailOnLoad, keeping the sim.ts load arm thin. */
export function normalizeHobbyMemoryOnLoad(
  saved: Record<string, string> | undefined | null,
): Map<string, string> {
  const map = new Map<string, string>();
  if (!saved) return map;
  for (const [pairId, hobby] of Object.entries(saved)) {
    if (typeof hobby !== 'string') continue;
    if (!candidatesForPairId(pairId).includes(hobby)) continue;
    map.set(pairId, hobby);
  }
  return map;
}

/** Record the character's CURRENT hobby as their explicit choice for their
 *  CURRENT pair. Called from the hobby-switch quest effect immediately AFTER
 *  the switch is applied, so a recorded value can only ever be a hobby the
 *  character actually held. A no-op for an unattuned or malformed state, and
 *  for a hobby that is not a candidate of the active pair. */
export function recordQuestedHobby(meta: PlayerMeta): void {
  const { activeArchetype, pairedMajor, hobbyCraft } = meta.archetype;
  if (!activeArchetype || !pairedMajor || !hobbyCraft) return;
  const pairId = archetypePairId(activeArchetype, pairedMajor);
  if (!pairId) return;
  if (!hobbyCandidatesForPair(activeArchetype, pairedMajor).includes(hobbyCraft)) return;
  meta.questedHobbies.set(pairId, hobbyCraft);
}

/** The pair-transition hobby rule, the one home for every transition entry
 *  point: after the transition has written the pair's DEFAULT hobby, restore
 *  the hobby this character once quested for the pair they just moved INTO.
 *  Called right after attuneArchetypePair / switchArchetype at each of their
 *  three entry points.
 *
 *  Deliberately mode-blind: the record is keyed by the pair the character is
 *  moving into and is only ever written while that pair is ACTIVE, so a 'new'
 *  attunement (a pair by definition never held) is a guaranteed miss and keeps
 *  its skill-derived default. A recorded value that is no longer a candidate of
 *  the pair is ignored, leaving the default in place (the load normalizer above
 *  is what heals the record itself).
 *
 *  Independent of applyPairTransitionTierMail at the same call sites: that rule
 *  reads and writes only the two MAJORS' acknowledged tiers, this one only the
 *  hobby, so the two commute and their order is narrative. */
export function applyPairTransitionHobbyMemory(meta: PlayerMeta): void {
  const { activeArchetype, pairedMajor } = meta.archetype;
  if (!activeArchetype || !pairedMajor) return;
  const pairId = archetypePairId(activeArchetype, pairedMajor);
  if (!pairId) return;
  const remembered = meta.questedHobbies.get(pairId);
  if (remembered === undefined) return;
  if (!hobbyCandidatesForPair(activeArchetype, pairedMajor).includes(remembered)) return;
  meta.archetype.hobbyCraft = remembered;
}
