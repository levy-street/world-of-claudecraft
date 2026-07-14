// Pure model for the classic-style chat channel tabs (no DOM, no Three). The HUD
// (hud.ts) owns the tab DOM and wiring; this module owns the *rules*: which
// channels a tab can bind to, the slash prefix each one prepends to plain text,
// and the localStorage parse/serialize. Keeping it DOM-free lets the logic be
// unit-tested without a browser.

import type { TranslationKey } from './i18n';

// Channels a chat tab can be bound to, in the order shown in the "add channel"
// menu. `say` is the engine default for unprefixed text. `whisper` is omitted
// on purpose (it targets a specific player and has no standing channel).
export const CHAT_TAB_CHANNELS = [
  'say',
  'yell',
  'party',
  'general',
  'world',
  'lfg',
  'guild',
  'officer',
] as const;
export type ChatTabChannel = (typeof CHAT_TAB_CHANNELS)[number];

export function isChatTabChannel(v: unknown): v is ChatTabChannel {
  return typeof v === 'string' && (CHAT_TAB_CHANNELS as readonly string[]).includes(v);
}

// The whisper "channel" has no standing SEND channel (each whisper targets a
// specific player), so it is deliberately kept out of CHAT_TAB_CHANNELS above.
// It can still be opened as a FILTER-ONLY tab that collects every whisper (sent
// and received, all carrying chan 'whisper') in one place, away from the busy
// All view. Typing in that tab replies to the last whisperer (see
// composeWhisperReply); it never binds a send prefix like a real channel.
export const WHISPER_TAB = 'whisper';
export type WhisperTab = typeof WHISPER_TAB;

// A tab the "+" menu can open: a send-capable channel OR the whisper collector.
export type ChatOpenTab = ChatTabChannel | WhisperTab;

export function isChatOpenTab(v: unknown): v is ChatOpenTab {
  return v === WHISPER_TAB || isChatTabChannel(v);
}

// The two always-present built-in views: the combined chat log and the combat
// log. They are not openable tabs (no send channel, never removed).
export type ChatTabId = 'all' | 'combat' | ChatOpenTab;

// Slash prefix prepended to plain text typed while a channel tab is active, so a
// message reaches that channel without the player retyping the command. These
// mirror the commands parsed in src/sim/sim.ts and server/game.ts:
//  - `say` is explicit: online sessions remember whisper/guild modes, so a
//    neutral Say input must reset that server-side state instead of relying on
//    unprefixed text.
//  - `/general ` (not `/g `, which the server routes to GUILD) hits the
//    always-on general channel.
//  - `/gu ` / `/o ` are guild / officer (server-side social channels).
const CHANNEL_SEND_PREFIX: Record<ChatTabChannel, string> = {
  say: '/say ',
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

// The whisper collector tab reuses the existing "Whisper" action label for its
// short tab caption, so it needs no new i18n key (and reads localized at once).
export const WHISPER_TAB_LABEL_KEY: TranslationKey = 'hud.chat.context.whisper';

// The i18n key for any openable tab's short caption (channel name or whisper).
export function chatOpenTabLabelKey(tab: ChatOpenTab): TranslationKey {
  return tab === WHISPER_TAB ? WHISPER_TAB_LABEL_KEY : CHANNEL_LABEL_KEYS[tab];
}

// Per-channel display colors: the single source of truth shared by the chat LOG
// lines (hud.ts tints each line by channel) and the chat INPUT (whose text is
// tinted to signal the channel a plain typed line will reach). Kept here,
// DOM-free, so both consumers read one table instead of duplicating hex
// literals. Covers the send-capable tab channels plus the non-tab log channels
// (whisper, emote, roll). `say` is the neutral default: it doubles as the
// fallback for any unrecognized log channel and as the "no tint" signal below.
export type ChatColorChannel = ChatTabChannel | WhisperTab | 'emote' | 'roll';

const CHAT_CHANNEL_COLORS: Record<ChatColorChannel, string> = {
  say: '#f0ead8',
  yell: '#ff5040',
  party: '#7fd4ff',
  general: '#ffc864',
  world: '#ff9d5c',
  lfg: '#5cd6a0',
  guild: '#40d264',
  officer: '#4ce0c0',
  whisper: '#ff80ff',
  emote: '#ff8040',
  roll: '#ffd100',
};

// Color for a chat LOG line on the given channel. Unknown channels fall back to
// the neutral `say` color, matching the chat switch's historical default arm.
export function chatChannelColor(channel: string): string {
  return CHAT_CHANNEL_COLORS[channel as ChatColorChannel] ?? CHAT_CHANNEL_COLORS.say;
}

// The tint target for the chat input: a standing send channel or the whisper
// collector (whose plain text replies as a whisper).
export type ChatInputTintTarget = ChatTabChannel | WhisperTab;

// Tint color for the chat INPUT when a plain typed line will reach `channel`, or
// null to keep the input's default color. `say` (the neutral default) and no
// channel both fall back to the default; every other channel tints to its color.
export function chatInputTint(channel: ChatInputTintTarget | null): string | null {
  if (channel === null || channel === 'say') return null;
  return CHAT_CHANNEL_COLORS[channel];
}

// Compose the text actually sent for a message typed while a channel tab is
// active. An explicit slash command the player typed always wins (so "/w bob hi"
// from the World tab still whispers); otherwise the channel prefix is prepended.
export function composeChatLine(channel: ChatTabChannel, typed: string): string {
  const text = typed.trim();
  if (!text || text.startsWith('/')) return text;
  return channelSendPrefix(channel) + text;
}

// Compose the text sent for a message typed while the whisper collector tab is
// active. Plain text defaults to a reply to whoever last whispered you (/r), so
// reading and answering whispers both happen from that one tab. An explicit
// slash command still wins (so "/w Bob hi" whispers Bob directly), exactly like
// composeChatLine. With no one to reply to, the sim surfaces its existing
// "no one has whispered you recently" notice.
export function composeWhisperReply(typed: string): string {
  const text = typed.trim();
  if (!text || text.startsWith('/')) return text;
  return `/r ${text}`;
}

// The standing channel the actually-sent line reached, used to update the sticky
// "last used" send channel so the next opened input (on the All tab) defaults
// there. Plain text (no leading slash) went to `say`. An explicit slash command
// maps by its leading token; only the standing channels below are recognized, so
// whisper / reply (`/w`, `/r`), emotes (`/me`, `/dance`), rolls (`/roll`),
// channel membership (`/join`, `/leave`), the ambiguous bare `/g` (say offline,
// guild online), and any unknown command return null and leave the sticky
// channel unchanged. Host-independent by design: only prefixes that route
// identically offline and online are mapped (hence `/gu`/`/general`, never `/g`).
export function sentLineChannel(line: string): ChatTabChannel | null {
  const text = line.trim();
  if (!text) return null;
  if (!text.startsWith('/')) return 'say';
  if (/^\/p(arty)?\s/i.test(text)) return 'party';
  if (/^\/y(ell)?\s/i.test(text)) return 'yell';
  if (/^\/s(ay)?\s/i.test(text)) return 'say';
  if (/^\/gu(ild)?\s/i.test(text)) return 'guild';
  if (/^\/o(fficer)?\s/i.test(text)) return 'officer';
  if (/^\/general\s/i.test(text)) return 'general';
  if (/^\/world\s/i.test(text)) return 'world';
  if (/^\/lfg\s/i.test(text)) return 'lfg';
  return null;
}

// Persistence: the ordered list of channel tabs the player has opened. The
// built-in `all` / `combat` views are implicit and not stored. Parsing is
// defensive: unknown, duplicate, or malformed entries are dropped so a corrupt
// or forward-version blob can never throw inside the HUD.
export function parseChatTabs(raw: string | null): ChatOpenTab[] {
  if (!raw) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: ChatOpenTab[] = [];
  for (const v of arr) {
    if (isChatOpenTab(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

export function serializeChatTabs(tabs: ChatOpenTab[]): string {
  return JSON.stringify(tabs);
}
