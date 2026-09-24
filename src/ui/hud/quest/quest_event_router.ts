// The HUD's routing of a quest or world-quest event presentation
// (quest_event_view.ts): the log line, the progress flash, the banner, the sound,
// the quest dialog refresh and the world-quest puzzle window. Hud members are
// private, so the router takes the Hud untyped; the members it reads are welded
// to hud.ts in tests/quest_event_router.test.ts.
import { sfx } from '../../../game/sfx';
import type { SimEvent } from '../../../sim/types';
import { HUD_LOG } from '../../hud_tones';
import { t } from '../../i18n';
import { type QuestEventPresentation, questEventPresentation } from '../../quest_event_view';

/** The private Hud members the router drives. */
interface QuestEventHost {
  log(text: string, color?: string): void;
  questBanner: { show(text: string): void };
  showBanner(
    text: string,
    motion?: boolean,
    decorativeIconUrl?: string,
    variant?: 'default' | 'worldQuest',
    subtext?: string,
    durationMs?: number,
    source?: null,
    bannerClass?: 'deed',
  ): unknown;
  questDialog: { refresh(): void };
  worldQuestPuzzleWindow: { applyEventPresentation(presentation: QuestEventPresentation): void };
  treasureMapWindow: { open(): void; refresh(): void };
}

/** Present one sim event through the quest channels. True when it was a quest event,
 *  so the HUD's per-event switch skips it. */
export function applyQuestEventPresentation(hud: object, ev: SimEvent): boolean {
  const h = hud as QuestEventHost;
  // A read treasure map opens its parchment (a re-read has no log line, so
  // this runs before the presentation check); an upgrade or a dig repaints it.
  if (ev.type === 'treasureMapRead') h.treasureMapWindow.open();
  else if (ev.type === 'treasureMapUpgraded' || ev.type === 'treasureVaultOpened')
    h.treasureMapWindow.refresh();
  const questEvent = questEventPresentation(ev);
  if (!questEvent) return false;
  if (questEvent.logText) h.log(questEvent.logText, HUD_LOG.PROGRESS);
  if (questEvent.flashText) h.questBanner.show(questEvent.flashText);
  if (questEvent.bannerText) {
    if (questEvent.bannerVariant || questEvent.bannerClass)
      // A plate variant or a queued class (the world quest entry banner):
      // the full call, so the class reaches the banner scheduler.
      h.showBanner(
        questEvent.bannerText,
        true,
        questEvent.bannerIconUrl,
        questEvent.bannerVariant ?? 'default',
        questEvent.bannerSubtext,
        questEvent.bannerDurationMs,
        null,
        questEvent.bannerClass,
      );
    else if (questEvent.bannerSubtext || questEvent.bannerIconUrl || questEvent.bannerDurationMs)
      h.showBanner(
        questEvent.bannerText,
        true,
        questEvent.bannerIconUrl,
        'default',
        questEvent.bannerSubtext,
        questEvent.bannerDurationMs,
      );
    else h.showBanner(questEvent.bannerText);
  }
  if (questEvent.sound) sfx.playUi(questEvent.sound);
  if (questEvent.mountOwnedPrompt)
    h.showBanner(
      t('hudChrome.mountTraining.ownedMountPrompt'),
      true,
      undefined,
      'default',
      undefined,
      6000,
    );
  if (questEvent.refreshQuestDialog) h.questDialog.refresh();
  h.worldQuestPuzzleWindow.applyEventPresentation(questEvent);
  return true;
}
