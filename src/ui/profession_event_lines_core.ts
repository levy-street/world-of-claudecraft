// Pure, host-agnostic render plans for the four profession SimEvents
// (professions/prof_nudges.ts + professions/attunement_events.ts): the trend
// nudge, the first-tier tutorial trigger, and the personal + zone attunement
// celebrations. The sim emits these text-free (ids and names only, the
// gatherDenied/masterworkZone idiom); this core maps each to a stable render
// plan (which chat line, which banner, which panel to open) that the HUD's thin
// switch cases execute, resolving the localized names themselves.
//
// The one real decision here is `attunementMasterForPair`: only the four
// wave-one archetype pairs have a seated anchor master (content/zone1.ts), so a
// trend nudge toward one of the other six ring pairs has no master to name and
// renders the no-master variant instead. The map is DERIVED from the attunement
// quest content (never a second hand-kept copy), so it can never drift from
// which master actually offers each pair's acceptance quest.
//
// This is the pure-core half of the pure-core + thin-consumer split (root
// CLAUDE.md; reference craft_celebration_view.ts): DOM-free and i18n-free so
// tests/profession_event_lines_core.test.ts drives it directly. Registered in
// the UI_PURE_CORES allowlist (tests/architecture.test.ts).

import { QUESTS } from '../sim/data';

// pairId (ARCHETYPE_PAIR_TARGETS) -> the NPC template id of the master whose
// attunement acceptance quest names that pair. Built once from the attunePair
// 'new' quests in content, so exactly the four wave-one pairs are present.
const ATTUNEMENT_MASTER_BY_PAIR: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const quest of Object.values(QUESTS)) {
    const effect = quest.completionEffect;
    if (effect?.type === 'attunePair' && effect.mode === 'new' && effect.pairId) {
      map[effect.pairId] = quest.giverNpcId;
    }
  }
  return map;
})();

/** The NPC template id of the anchor master whose attunement quest offers
 *  `pairId`, or null when this pair has no seated master yet (the six ring
 *  pairs outside the four wave-one archetypes). */
export function attunementMasterForPair(pairId: string): string | null {
  return ATTUNEMENT_MASTER_BY_PAIR[pairId] ?? null;
}

/** The four profession events, narrowed to the fields the plan reads.
 *  The HUD passes its already-narrowed SimEvent (extra fields such as `pid` are
 *  structurally ignored here). */
export type ProfessionEventInput =
  | { type: 'profTrendNudge'; pairId: string }
  | { type: 'profTierTutorial' }
  | { type: 'attuned'; pairId: string }
  | { type: 'attunedZone'; celebrantName: string; pairId: string };

/** The render plan the HUD executes. Ids and names only (never localized text):
 *  the thin HUD consumer resolves archetype titles and master/celebrant names. */
export type ProfessionEventPlan =
  // Trend nudge chat line: name the archetype the viewer trends toward, and the
  // master whose attunement quest waits (masterNpcId null -> the no-master
  // variant line, no dead pointer).
  | { kind: 'trendNudge'; pairId: string; masterNpcId: string | null }
  // Open the one-time first-tier tutorial panel (the sim already guarantees
  // once-ever; the client just renders).
  | { kind: 'tierTutorial' }
  // Zone broadcast chat line naming the newly attuned player and their new
  // archetype (the masterworkZoneLine precedent).
  | { kind: 'attunedZone'; celebrantName: string; pairId: string }
  // Personal attunement celebration banner naming the earned archetype title
  // (pairId IS the archetypePairId title identifier). Mirrors the
  // craft_celebration_view banner arm: at most one celebration sound, motion
  // gated by reducedMotion (information never is). Deed hook: a per
  // archetype deed unlock will fire from this same moment; today it is a pure
  // celebration.
  | { kind: 'attunement'; pairId: string; playSound: boolean; motion: boolean };

/** Map one profession event to its render plan. `reducedMotion` gates
 *  the attunement banner's motion flag only (the buildCraftCelebrationPlan
 *  contract); every other arm ignores it. */
export function planProfessionEvent(
  event: ProfessionEventInput,
  reducedMotion: boolean,
): ProfessionEventPlan {
  switch (event.type) {
    case 'profTrendNudge':
      return {
        kind: 'trendNudge',
        pairId: event.pairId,
        masterNpcId: attunementMasterForPair(event.pairId),
      };
    case 'profTierTutorial':
      return { kind: 'tierTutorial' };
    case 'attunedZone':
      return { kind: 'attunedZone', celebrantName: event.celebrantName, pairId: event.pairId };
    case 'attuned':
      return { kind: 'attunement', pairId: event.pairId, playSound: true, motion: !reducedMotion };
  }
}
