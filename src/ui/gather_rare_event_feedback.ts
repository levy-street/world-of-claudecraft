// Pure decision core for the HUD's single gatherRareEvent case: which
// localized line key a recipient renders, and which cues fire FOR THAT
// RECIPIENT. Extracted at the Phase 10 QA so the finder-only rules are
// behaviorally testable (a Vitest drives every flavor x recipient quadrant
// directly) instead of resting on index-order source pins over hud.ts, which
// are comment-blind and polarity-blind by construction.
//
// The rules, stated once:
// - EVERY in-zone recipient renders the flavor line (the soft zone broadcast
//   delivers one pid-scoped copy each; rendering is unconditional here).
// - The shared celebratory achievement cue is FINDER-ONLY, every flavor.
// - The ui_farm_golden sting LAYERS on top of the shared cue (never replaces
//   it), golden_harvest AND finder-only.
// The `satisfies Record` table is the production-side exhaustiveness guard:
// a fifth GatherRareEventFlavor member fails tsc HERE, in the shipping
// module, before the old catch-all chain could silently render it as the
// golden line (the test-side table in tests/gather_event_i18n.test.ts was
// the only tripwire before).
import type { GatherRareEventFlavor } from '../sim/types';
import type { TranslationKey } from './i18n';

export const GATHER_RARE_EVENT_LINE_KEYS = {
  pristine_vein: 'gatherEvent.pristineVein',
  ancient_heartwood: 'gatherEvent.ancientHeartwood',
  moonlit_bloom: 'gatherEvent.moonlitBloom',
  golden_harvest: 'gatherEvent.goldenHarvest',
} as const satisfies Record<GatherRareEventFlavor, TranslationKey>;

export interface GatherRareEventFeedback {
  lineKey: TranslationKey;
  /** The shared celebratory cue (audio.achievement), finder-only. */
  achievementCue: boolean;
  /** The layered golden sting (audio.farmGolden), golden and finder-only. */
  farmGoldenSting: boolean;
}

export function gatherRareEventFeedback(
  flavor: GatherRareEventFlavor,
  finderPid: number,
  myPid: number,
): GatherRareEventFeedback {
  const isFinder = finderPid === myPid;
  // The ?? belt: an OFF-UNION runtime flavor (a version-skewed server; the
  // event crosses the wire generically) must keep the pre-extraction
  // catch-all behavior, the golden line, never hand hud.ts an undefined key
  // (t() throws on unknown keys in dev builds, inside the event switch).
  // Same off-union defense the sim side takes with its != null belief. The
  // sting check below reads the RAW flavor, so an unknown flavor can never
  // inherit the golden sting through this fallback.
  return {
    lineKey: GATHER_RARE_EVENT_LINE_KEYS[flavor] ?? GATHER_RARE_EVENT_LINE_KEYS.golden_harvest,
    achievementCue: isFinder,
    farmGoldenSting: isFinder && flavor === 'golden_harvest',
  };
}
