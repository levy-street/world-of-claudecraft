// Pure, host-agnostic model for the first-tier tutorial panel (Professions 2.0
// Phase 14): the one-time explainer fired by the `profTierTutorial` SimEvent the
// first time any craft skill crosses tier 1. The sim guarantees once-ever
// (professions/prof_nudges.ts, a persisted one-shot flag), so this model is
// static content: it lists the ordered explainer paragraphs (the tier cap that
// just bit, the craft-wheel identity concept, and that masters offer attunement
// quests) plus the first-tier target skill drawn from the sim constant so the
// copy never hardcodes 25.
//
// The pure-core half of the pure-core + thin-consumer split (root CLAUDE.md;
// reference options_view.ts): DOM-free and i18n-free (it emits stable
// TranslationKey identifiers the thin painter localizes), so
// tests/profession_tutorial_view.test.ts drives it directly. Registered in the
// UI_PURE_CORES allowlist (tests/architecture.test.ts).

import { TIER_SKILL_STEP } from '../sim/professions/wheel';
import type { TranslationKey } from './i18n';

export interface ProfessionTutorialModel {
  titleKey: TranslationKey;
  /** Ordered explainer paragraphs. The first (tier cap) interpolates
   *  {skill} = targetSkill. */
  bodyKeys: TranslationKey[];
  dismissKey: TranslationKey;
  /** The first-tier skill threshold (TIER_SKILL_STEP), for the tier-cap line. */
  targetSkill: number;
}

/** Build the static first-tier tutorial model. No inputs: the sim decides WHEN
 *  it fires; the client only decides WHAT it says. */
export function buildProfessionTutorialModel(): ProfessionTutorialModel {
  return {
    titleKey: 'hudChrome.crafting.tierTutorial.title',
    bodyKeys: [
      'hudChrome.crafting.tierTutorial.tierCap',
      'hudChrome.crafting.tierTutorial.radar',
      'hudChrome.crafting.tierTutorial.masters',
    ],
    dismissKey: 'hudChrome.crafting.tierTutorial.dismiss',
    targetSkill: TIER_SKILL_STEP,
  };
}
