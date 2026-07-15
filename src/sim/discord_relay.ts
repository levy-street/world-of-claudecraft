// Shared catalog for the in-game "!" community commands that broadcast in-world
// AND post to Discord (looking-for-group, trade, recruiting, events, help).
//
// Pure + host-agnostic so the client (the chat dropdown) and the server (parsing
// + relaying) agree on the command set without crossing boundaries. Mirrors
// src/sim/discord_tier.ts. The "!" commands ride the normal chat cmd; the server
// intercepts a leading "!" in chat, so no new wire field is needed.

export interface RelayCommand {
  /** Command word typed after "!", e.g. "lfg". */
  id: string;
  /** Human label for the chat dropdown. */
  label: string;
  /** One-line hint shown in the dropdown. */
  hint: string;
  /** Short bracket tag shown on the in-game broadcast, e.g. "LFG". */
  tag: string;
  /** Discord embed accent colour. */
  color: number;
  /** Placeholder shown after the command is picked. */
  placeholder: string;
}

export const RELAY_MAX_MESSAGE = 280;

export const RELAY_COMMANDS: readonly RelayCommand[] = [
  {
    id: 'lfg',
    label: 'Looking for Group',
    hint: 'Find players for a dungeon or quest',
    tag: 'LFG',
    color: 0x5865f2,
    placeholder: 'e.g. Need a healer for Cragmaw Crypt',
  },
  {
    id: 'wts',
    label: 'Want to Sell',
    hint: 'Advertise an item or service for sale',
    tag: 'WTS',
    color: 0xc8941a,
    placeholder: 'e.g. Selling Ember Greatsword, 5g',
  },
  {
    id: 'wtb',
    label: 'Want to Buy',
    hint: 'Request an item you want to buy',
    tag: 'WTB',
    color: 0x2ea33c,
    placeholder: 'e.g. Buying linen cloth, paying well',
  },
  {
    id: 'recruit',
    label: 'Guild Recruiting',
    hint: 'Recruit players for your guild',
    tag: 'GUILD',
    color: 0x9b6cff,
    placeholder: 'e.g. <Vanguard> recruiting all classes',
  },
  {
    id: 'event',
    label: 'Event / Raid',
    hint: 'Announce a raid, meetup or event',
    tag: 'EVENT',
    color: 0xe0913f,
    placeholder: 'e.g. Crypt raid forming at the fountain',
  },
  {
    id: 'help',
    label: 'Need Help',
    hint: 'Ask the community for help',
    tag: 'HELP',
    color: 0xc0563f,
    placeholder: 'e.g. Stuck on the Aldric quest, any tips?',
  },
];

export function relayCommandById(id: string): RelayCommand | undefined {
  const key = id.toLowerCase();
  const exact = RELAY_COMMANDS.find((c) => c.id === key);
  if (exact) return exact;
  // Accept a natural plural ("!events" -> event, "!lfgs" -> lfg) only when the exact
  // word is unknown, so "!event" written as "!events" still posts.
  if (key.endsWith('s')) return RELAY_COMMANDS.find((c) => c.id === key.slice(0, -1));
  return undefined;
}

/**
 * Parse a chat line like "!lfg need a healer" into its command + message. Returns
 * null when it is not a "!" line or the command word is unknown. The message is
 * trimmed and capped at RELAY_MAX_MESSAGE; an empty message is allowed (the
 * command tag alone is still meaningful, e.g. "!lfg").
 */
export function parseRelayCommand(text: string): { command: RelayCommand; message: string } | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('!')) return null;
  const m = /^!([a-zA-Z]+)\s*([\s\S]*)$/.exec(trimmed);
  if (!m) return null;
  const command = relayCommandById(m[1]);
  if (!command) return null;
  return { command, message: m[2].trim().slice(0, RELAY_MAX_MESSAGE) };
}

/**
 * Commands whose id starts with the typed prefix (after "!"), for the chat
 * dropdown. An empty prefix (just "!") returns all commands.
 */
export function matchRelayCommands(afterBang: string): RelayCommand[] {
  const p = afterBang.toLowerCase();
  return RELAY_COMMANDS.filter((c) => c.id.startsWith(p));
}

/** Whether a chat input value is a "!" relay line (so the dropdown should show). */
export function isRelayInput(value: string): boolean {
  return /^\s*![a-zA-Z]*$/.test(value) || /^\s*![a-zA-Z]+\s/.test(value);
}
