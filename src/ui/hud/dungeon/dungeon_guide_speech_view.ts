// Pure: how one of a dungeon lore guide's id-only lines reads on this client
// (src/sim/dungeon_guide emits `dungeonGuideLine` with a guide id and a line
// id; never English). Resolves the line through the guide's record to its
// catalog key, the speaker's localized name, and whether it is a spoken line
// (a quiet `say` bubble plus a chat line) or an action line (the chat only).
// DOM-free; dungeon_guide_speech.ts paints it.

import { DUNGEON_GUIDES, dungeonGuideKey } from '../../../sim/content/dungeon_guides';
import type { SimEvent } from '../../../sim/types';
import { tEntity } from '../../entity_i18n';
import { type TranslationKey, t } from '../../i18n';

export interface GuideLineView {
  npcId: number;
  speaker: string;
  text: string;
  /** An action line ("Laverock lifts his voice..."): no bubble, no sender. */
  emote: boolean;
}

/** The line a `dungeonGuideLine` event speaks, or null for any other event
 *  and for an id this client's content does not know (a version skew drops
 *  the line rather than print a key). */
export function guideLineView(ev: SimEvent): GuideLineView | null {
  if (ev.type !== 'dungeonGuideLine') return null;
  const guide = DUNGEON_GUIDES[ev.guideId];
  const line = guide?.lines.find((l) => l.id === ev.lineId);
  if (!guide || !line) return null;
  const speaker = tEntity({ kind: 'npc', id: guide.npcId, field: 'name' });
  const text = t(dungeonGuideKey(guide, line.key) as TranslationKey, { name: speaker });
  return { npcId: ev.npcId, speaker, text, emote: line.emote === true };
}
