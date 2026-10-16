// The chat log's line templates, by channel: the catalog keys the HUD's chat
// event arm renders a sender and a message through.

import type { TranslationKey } from './i18n';

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
