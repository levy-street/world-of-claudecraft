// Pure model for the WoW-style chat channel tabs (no DOM, no Three). The HUD
// (hud.ts) owns the tab DOM and wiring; this module owns the *rules*: which
// channels a tab can bind to, the slash prefix each one prepends to plain text,
// and the localStorage parse/serialize. Keeping it DOM-free lets the logic be
// unit-tested without a browser.

import type { TranslationKey } from './i18n';

// Channels a chat tab can be bound to, in the order shown in the "add channel"
// menu. `say` is the engine default for unprefixed text. `whisper` is omitted
// on purpose — it targets a specific player and has no standing channel.
export const CHAT_TAB_CHANNELS = [
  'say', 'yell', 'party', 'general', 'world', 'lfg', 'guild', 'officer',
] as const;
export type ChatTabChannel = (typeof CHAT_TAB_CHANNELS)[number];

// The two always-present built-in views: the combined chat log and the combat
// log. They are not channel tabs (no send channel, never removed).
export type ChatTabId = 'all' | 'combat' | ChatTabChannel;

export function isChatTabChannel(v: unknown): v is ChatTabChannel {
  return typeof v === 'string' && (CHAT_TAB_CHANNELS as readonly string[]).includes(v);
}

// Slash prefix prepended to plain text typed while a channel tab is active, so a
// message reaches that channel without the player retyping the command. These
// mirror the commands parsed in src/sim/sim.ts and server/game.ts:
//  - `say` is empty: unprefixed text is /say by default.
//  - `/general ` (not `/g `, which the server routes to GUILD) hits the
//    always-on general channel.
//  - `/gu ` / `/o ` are guild / officer (server-side social channels).
const CHANNEL_SEND_PREFIX: Record<ChatTabChannel, string> = {
  say: '',
  yell: '/y ',
  party: '/p ',
  general: '/general ',
  world: '/world ',
  lfg: '/lfg ',
  guild: '/gu ',
  officer: '/o ',
};

export function channelSendPrefix(channel: ChatTabChannel): string {
  return CHANNEL_SEND_PREFIX[channel];
}

// Opt-in global channels that need an explicit /join before the sim/server will
// deliver to them. Opening a tab for one of these auto-joins it.
export const AUTO_JOIN_CHANNELS: readonly ChatTabChannel[] = ['world', 'lfg'];

export function channelNeedsJoin(channel: ChatTabChannel): boolean {
  return AUTO_JOIN_CHANNELS.includes(channel);
}

// i18n keys for each channel's short tab label.
export const CHANNEL_LABEL_KEYS: Record<ChatTabChannel, TranslationKey> = {
  say: 'hud.core.chatChannels.names.say',
  yell: 'hud.core.chatChannels.names.yell',
  party: 'hud.core.chatChannels.names.party',
  general: 'hud.core.chatChannels.names.general',
  world: 'hud.core.chatChannels.names.world',
  lfg: 'hud.core.chatChannels.names.lfg',
  guild: 'hud.core.chatChannels.names.guild',
  officer: 'hud.core.chatChannels.names.officer',
};

// Compose the text actually sent for a message typed while a channel tab is
// active. An explicit slash command the player typed always wins (so "/w bob hi"
// from the World tab still whispers); otherwise the channel prefix is prepended.
export function composeChatLine(channel: ChatTabChannel, typed: string): string {
  const text = typed.trim();
  if (!text || text.startsWith('/')) return text;
  return channelSendPrefix(channel) + text;
}

// Persistence: the ordered list of channel tabs the player has opened. The
// built-in `all` / `combat` views are implicit and not stored. Parsing is
// defensive — unknown, duplicate, or malformed entries are dropped so a corrupt
// or forward-version blob can never throw inside the HUD.
export function parseChatTabs(raw: string | null): ChatTabChannel[] {
  if (!raw) return [];
  let arr: unknown;
  try { arr = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  const out: ChatTabChannel[] = [];
  for (const v of arr) {
    if (isChatTabChannel(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

export function serializeChatTabs(tabs: ChatTabChannel[]): string {
  return JSON.stringify(tabs);
}
