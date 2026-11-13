// The chat log's line templates and the chat body localizer, moved out of hud.ts under
// the monolith ratchet: a static key table plus one pure function, no HUD state.

import type { EntityKind, SimEvent } from '../sim/types';
import { type TranslationKey, t } from './i18n';
import { localizeAuthoredYellSpeakerName } from './sim_i18n';

// The key table itself lives in chat_template_keys.ts (the dungeon guide's speech
// renders through it too); re-exported so the HUD keeps one import.
export { CHAT_TEMPLATE_KEYS } from './chat_template_keys';

export function localizeChatBody(ev: Extract<SimEvent, { type: 'chat' }>): string {
  return ev.textKey ? t(ev.textKey as TranslationKey, ev.textValues) : ev.text;
}

/** A raid warning's speaker: a player's name as written; an encounter's boss
 *  (the Hammer Council's calls carry the boss as their speaker entity) by its
 *  localized name, the yell speaker's rule. */
export function raidWarningSpeaker(
  ev: Extract<SimEvent, { type: 'chat' }>,
  speaker: { kind?: EntityKind; templateId?: string } | null | undefined,
): string {
  return localizeAuthoredYellSpeakerName(ev.from, speaker?.kind, speaker?.templateId, ev.classId);
}
