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
    variant?: 'default',
    subtext?: string,
    durationMs?: number,
  ): void;
  questDialog: { refresh(): void };
  worldQuestPuzzleWindow: { applyEventPresentation(presentation: QuestEventPresentation): void };
}

/** Present one sim event through the quest channels. True when it was a quest event,
 *  so the HUD's per-event switch skips it. */
export function applyQuestEventPresentation(hud: object, ev: SimEvent): boolean {
  const questEvent = questEventPresentation(ev);
  if (!questEvent) return false;
  const h = hud as QuestEventHost;
  if (questEvent.logText) h.log(questEvent.logText, HUD_LOG.PROGRESS);
  if (questEvent.flashText) h.questBanner.show(questEvent.flashText);
  if (questEvent.bannerText) h.showBanner(questEvent.bannerText);
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
