// The chat log's line templates and the chat body localizer, moved out of hud.ts under
// the monolith ratchet: a static key table plus one pure function, no HUD state.

import type { SimEvent } from '../sim/types';
import { type TranslationKey, t } from './i18n';

// The key table itself lives in chat_template_keys.ts (the dungeon guide's speech
// renders through it too); re-exported so the HUD keeps one import.
export { CHAT_TEMPLATE_KEYS } from './chat_template_keys';

export function localizeChatBody(ev: Extract<SimEvent, { type: 'chat' }>): string {
  return ev.textKey ? t(ev.textKey as TranslationKey, ev.textValues) : ev.text;
}
