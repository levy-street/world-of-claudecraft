// The HUD's presentation of a dungeon lore guide's line (the view core is
// dungeon_guide_speech_view.ts): a spoken line is a quiet `say` bubble over
// the guide plus one `say` chat line ("Laverock says: ..."); an action line is
// one chat line on the emote channel. Both are plain log lines, never the
// player-chat sender button (an NPC has no whisper, invite or report menu).
// Hud members are private, so this router takes the Hud untyped, like
// quest_event_router.ts; the members it reads are welded to hud.ts in
// tests/dungeon_guide_ui.test.ts.

import type { SimEvent } from '../../../sim/types';
import { chatBubbleStyle } from '../../chat_bubble_style';
import { CHAT_TEMPLATE_KEYS } from '../../chat_template_keys';
import { t } from '../../i18n';
import { chatChannelColor } from '../chat/chat_channels';
import { guideLineView } from './dungeon_guide_speech_view';

/** The private Hud members the router drives. */
interface GuideSpeechHost {
  log(text: string, color?: string, decorativeIconUrl?: string, channel?: string): void;
  renderer: {
    showChatBubble(
      entityId: number,
      text: string,
      style?: ReturnType<typeof chatBubbleStyle>,
    ): void;
  };
}

/** Present one sim event if it is a guide's line. True when it was one, so the
 *  HUD's per-event switch skips it. */
export function applyDungeonGuideSpeech(hud: object, ev: SimEvent): boolean {
  if (ev.type !== 'dungeonGuideLine') return false;
  const view = guideLineView(ev);
  if (!view) return true;
  const h = hud as GuideSpeechHost;
  if (view.emote) {
    h.log(view.text, chatChannelColor('emote'), undefined, 'emote');
    return true;
  }
  const line = t(CHAT_TEMPLATE_KEYS.say, { name: view.speaker, message: view.text });
  h.log(line, chatChannelColor('say'), undefined, 'say');
  h.renderer.showChatBubble(view.npcId, view.text, chatBubbleStyle('say'));
  return true;
}
