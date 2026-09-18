// The paint half of the profession skill level-up celebration: the chat line
// for every floor climb (the classic per-point skill message), the copper
// skill plate, polite announce and celebration chime for a gathering
// milestone crossing. The cadence rules live in the pure plan
// (skill_level_toast_view.ts); this module only draws the plan through the
// CelebrationHost seam, so Hud stays a thin caller. Presentation is
// deliberately NOT the bare gold level-up language (players used to misread
// gathering milestones as character levels).

import { audio } from '../../../game/audio';
import { craftNameText } from '../../char_window';
import { HUD_LOG } from '../../hud_tones';
import { formatNumber, t } from '../../i18n';
import { gatheringProfessionNameKey } from './gathering_profession_name';
import { professionImageUrl } from './profession_art';
import {
  buildSkillLevelCelebrationPlan,
  type SkillLevelUp,
  skillLevelArtId,
} from './skill_level_toast_view';

/** The slice of Hud a celebration painter draws through: the chat log, the
 *  queued celebration banner slot, the polite live region, and the
 *  reduced-motion query. Nothing else of the coordinator leaks in. */
export interface CelebrationHost {
  log(text: string, color: string): void;
  showCelebrationBanner(
    text: string,
    bannerClass: 'levelup' | 'deed',
    variant: 'default' | 'deed' | 'skill',
    motion: boolean,
    decorativeIconUrl?: string,
    subtext?: string,
  ): void;
  announce(text: string): void;
  reducedMotion(): boolean;
}

export function paintSkillLevelCelebrations(
  host: CelebrationHost,
  craftUps: SkillLevelUp[],
  gatherUps: SkillLevelUp[],
  celebrationAlreadyChimed: boolean,
): void {
  const plan = buildSkillLevelCelebrationPlan(
    craftUps,
    gatherUps,
    host.reducedMotion(),
    celebrationAlreadyChimed,
  );
  const skillName = (skillId: string): string => {
    const gatherKey = gatheringProfessionNameKey(skillId);
    if (gatherKey) return t(gatherKey);
    return craftNameText(skillId);
  };
  const toastText = (up: SkillLevelUp) =>
    t('hudChrome.crafting.skillUpToast', {
      skill: skillName(up.skillId),
      level: formatNumber(up.toLevel, { maximumFractionDigits: 0 }),
    });
  for (const up of plan.skillUpLogs) host.log(toastText(up), HUD_LOG.NOTICE);
  if (plan.banner !== null) {
    const artUrl = professionImageUrl(skillLevelArtId(plan.banner.skillId));
    // Celebration class 'deed': queues behind level-ups, never ambient
    // replace, so a milestone landing after a ding still plays in order.
    // The skill VARIANT is the copper plate; class and variant are
    // orthogonal. The title is the skill name, already localized through
    // gatheringProfessionNameKey above, so no wrapper key is needed.
    host.showCelebrationBanner(
      skillName(plan.banner.skillId),
      'deed',
      'skill',
      plan.motion,
      artUrl ?? undefined,
      t('hudChrome.crafting.skillUpSubtext', {
        level: formatNumber(plan.banner.toLevel, { maximumFractionDigits: 0 }),
      }),
    );
    // The banner div carries no live semantics, so the polite #combat-live
    // region carries the combined line (skill name AND level in one string,
    // the level the visual title omits).
    host.announce(toastText(plan.banner));
  }
  if (plan.playSound) audio.achievement();
}
