// The paint half of the faction standing tier celebration: the deed-class
// plate naming the tier and faction with the faction title as its subtext,
// the durable gold chat line, the polite announce, and the achievement
// chime. The plan (faction_tier_celebration_view.ts) decides what plates and
// whether the chime fires; this module only resolves the copy and draws
// through the CelebrationHost seam.

import { audio } from '../../../game/audio';
import type { FactionId, StandingTier } from '../../../sim/factions';
import { HUD_LOG } from '../../hud_tones';
import { type TranslationKey, t } from '../../i18n';
import type { CelebrationHost } from '../professions/skill_level_toast_painter';
import {
  buildFactionTierCelebrationPlan,
  type FactionTierUp,
} from './faction_tier_celebration_view';

function factionName(factionId: FactionId): string {
  return t(`hudChrome.reputation.faction.${factionId}` as TranslationKey);
}

function tierName(tier: StandingTier): string {
  return t(`hudChrome.reputation.tier.${tier}` as TranslationKey);
}

function factionTitle(factionId: FactionId, tier: StandingTier): string {
  return t(`hudChrome.reputation.factionTitle.${factionId}.${tier}` as TranslationKey);
}

export function paintFactionTierCelebrations(
  host: CelebrationHost,
  tierUps: readonly FactionTierUp[],
  celebrationAlreadyChimed: boolean,
): void {
  const plan = buildFactionTierCelebrationPlan(
    tierUps,
    host.reducedMotion(),
    celebrationAlreadyChimed,
  );
  const lineText = (up: FactionTierUp) =>
    t('hudChrome.reputation.tierReachedLine', {
      tier: tierName(up.toTier),
      faction: factionName(up.factionId),
      title: factionTitle(up.factionId, up.toTier),
    });
  for (const up of plan.logs) host.log(lineText(up), HUD_LOG.NOTICE);
  if (plan.banner !== null) {
    const up = plan.banner;
    // The 'deed' class and variant: a celebration that queues behind a live
    // level-up plate instead of replacing it, never the gold ding treatment.
    host.showCelebrationBanner(
      t('hudChrome.reputation.tierReachedBanner', {
        tier: tierName(up.toTier),
        faction: factionName(up.factionId),
      }),
      'deed',
      'deed',
      plan.motion,
      undefined,
      t('hudChrome.reputation.tierReachedSubtext', {
        title: factionTitle(up.factionId, up.toTier),
      }),
    );
    // The banner div carries no live semantics; the polite live region hears
    // the full line (tier, faction and title in one string).
    host.announce(lineText(up));
  }
  if (plan.playSound) audio.achievement();
}
