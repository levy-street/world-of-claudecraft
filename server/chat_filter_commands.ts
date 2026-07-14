// Player-facing commands for the two chat-suppression tiers a PLAYER controls.
//
//   IGNORE (/ignore, /unignore, /ignorelist)  chat-only. Hides the target's
//                                             public chat and their overhead
//                                             bubble from you. Their whispers,
//                                             rolls, invites and mail still land.
//   BLOCK  (/block, /unblock, /blocklist)     the heavy tool. Also drops
//                                             invites, whispers and mail, and
//                                             makes you mutually invisible in /who.
//
// There is deliberately NO player-facing "/mute" here. A MUTE in this game is the
// ADMIN account silence (/mute "<name>" <minutes>, server/moderation_commands.ts),
// a staff moderation action taken AGAINST a player. Keeping the player's own
// preference off that word is what stops the three concepts from collapsing into
// one another, in the code and in the player's head.
//
// This parser lives in its own module on purpose: tests/command_schema.test.ts
// scrapes `case '<token>':` labels out of the dispatchMessage region of game.ts
// to derive the dispatched wire vocabulary, so a switch over these kinds written
// inline there would register phantom wire commands and fail the gate.

// Character names are bounded well under this; the cap simply stops a 16 KiB
// "name" from round-tripping to Postgres.
const NAME_MAX = 32;

export type ChatFilterCommand =
  | { kind: 'ignore'; name: string }
  | { kind: 'unignore'; name: string }
  | { kind: 'ignoreList' }
  | { kind: 'block'; name: string }
  | { kind: 'unblock'; name: string }
  | { kind: 'blockList' };

/** True for the four commands that WRITE, so the caller can charge a chat token. */
export function isChatFilterWrite(cmd: ChatFilterCommand): boolean {
  return cmd.kind !== 'ignoreList' && cmd.kind !== 'blockList';
}

// Channels an IGNORE suppresses. Whispers and rolls ride the SAME chat SimEvent
// as public chat, so filtering on the event TYPE alone would silently make an
// ignore behave like a block (no whispers) and would hide an ignored player's
// loot roll mid need/greed. The gate is the CHANNEL, and this is the whole list
// of what an ignore may hide. An absent channel is ordinary chat, so it is hidden.
const UNIGNORABLE_CHANNELS = new Set(['whisper', 'roll']);

export function isIgnorableChannel(channel: string | undefined): boolean {
  return channel === undefined || !UNIGNORABLE_CHANNELS.has(channel);
}

// Collapse interior whitespace so `/ignore  Bob   Smith` resolves like `/ignore Bob Smith`.
function cleanName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX);
}

export function parseChatFilterCommand(text: string): ChatFilterCommand | null {
  const trimmed = text.trim();

  // List forms first. They cannot collide with the add/remove forms below (those
  // require whitespace or end-of-string after the verb), but matching them first
  // keeps the intent obvious.
  if (/^\/ignorelist$/i.test(trimmed)) return { kind: 'ignoreList' };
  if (/^\/blocklist$/i.test(trimmed)) return { kind: 'blockList' };

  const unignore = /^\/unignore(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (unignore) return { kind: 'unignore', name: cleanName(unignore[1] ?? '') };

  const unblock = /^\/unblock(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (unblock) return { kind: 'unblock', name: cleanName(unblock[1] ?? '') };

  const ignore = /^\/ignore(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (ignore) return { kind: 'ignore', name: cleanName(ignore[1] ?? '') };

  const block = /^\/block(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (block) return { kind: 'block', name: cleanName(block[1] ?? '') };

  return null;
}
