// The world quest entry banner, pure: what the shared #banner slot paints when a
// world quest becomes active for the player (the sim's `worldQuestStarted`
// event, fired as they first enter the quest's area). The quest name is the
// large gold title and "World Quest" the smaller line under it, on the
// 'worldQuest' plate variant (a subtle dark plate with a thin ornamental rule).
//
// The collision rule, both halves, so the banner never lands on another
// centre-screen line:
//   - Timing: it rides the ONE #banner slot and its scheduler
//     (src/ui/banner_queue.ts) as a `deed`-class celebration, never ambient. An
//     ambient arrival (the zone-entry name, the hoard goblin warning) REPLACES a
//     live ambient banner, so classed ambient the entry banner would wipe a zone
//     name mid-read or be wiped by one; queued, it waits for the live banner to
//     end, and a zone name that arrives while the plate is LIVE waits in the
//     pending seat and shows right after it (WORLD_QUEST_BANNER_MS is kept short
//     enough that this parked zone name is never aged out of that seat; a zone
//     name parked behind a plate that is itself still queued behind a level-up
//     can age out, the scheduler's ordinary stale-ambient rule).
//   - Space: the separate #subzone-banner line sits under the #banner slot, and
//     a two-line plate would reach down into it. The plate variant is anchored
//     by its BOTTOM edge above the subzone line's top (the shared
//     --subzone-banner-top token in hud.css, re-pinned per touch layout), so the
//     two stack instead of overlapping on every layout. Above it, the yellow
//     quest-progress flash (#quest-banner) YIELDS its lane while the plate is up
//     (QuestProgressBanner.yieldToPlate, called where the plate paints).
//
// DOM-free and clock-free; the router (quest_event_router.ts) hands the model to
// Hud.showBanner.

import { t } from '../../i18n';
import { worldQuestDisplayName } from '../../world_quest_view';

/** How long the entry banner holds before it fades (the #banner transition
 *  fades it in and out; reduced motion drops the fade in CSS). */
export const WORLD_QUEST_BANNER_MS = 3500;

export interface WorldQuestBannerModel {
  /** The localized world quest name: the large gold title. */
  readonly title: string;
  /** "World Quest": the smaller line under the title. */
  readonly subtitle: string;
  readonly variant: 'worldQuest';
  /** The banner scheduler class (src/ui/banner_queue.ts): queued, never ambient. */
  readonly bannerClass: 'deed';
  readonly durationMs: number;
}

export function worldQuestBannerModel(questId: string): WorldQuestBannerModel {
  return {
    title: worldQuestDisplayName(questId),
    subtitle: t('hudChrome.worldQuestBanner.subtitle'),
    variant: 'worldQuest',
    bannerClass: 'deed',
    durationMs: WORLD_QUEST_BANNER_MS,
  };
}
