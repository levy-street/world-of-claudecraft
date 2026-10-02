// The chat log's line templates and the chat body localizer, moved out of hud.ts under
// the monolith ratchet: a static key table plus one pure function, no HUD state.

import type { SimEvent } from '../sim/types';
import { type TranslationKey, t } from './i18n';

export const CHAT_TEMPLATE_KEYS = {
  party: 'hud.chat.templates.party',
  battleground: 'hud.chat.templates.battleground',
  raidWarning: 'hud.chat.templates.raidWarning',
  yell: 'hud.chat.templates.yell',
  whisper: 'hud.chat.templates.whisper',
  toWhisper: 'hud.chat.templates.toWhisper',
  general: 'hud.chat.templates.general',
  world: 'hud.chat.templates.world',
  lfg: 'hud.chat.templates.lfg',
  guild: 'hud.chat.templates.guild',
  officer: 'hud.chat.templates.officer',
  emote: 'hud.chat.templates.emote',
  roll: 'hud.chat.templates.roll',
  say: 'hud.chat.templates.say',
} satisfies Record<string, TranslationKey>;

export function localizeChatBody(ev: Extract<SimEvent, { type: 'chat' }>): string {
  return ev.textKey ? t(ev.textKey as TranslationKey, ev.textValues) : ev.text;
}
