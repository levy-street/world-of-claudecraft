import { describe, expect, it } from 'vitest';
import {
  isChatFilterWrite,
  isIgnorableChannel,
  parseChatFilterCommand,
} from '../server/chat_filter_commands';
import { parseModerationChatCommand } from '../server/moderation_commands';

describe('parseChatFilterCommand', () => {
  it('parses the IGNORE family (the chat-only tier)', () => {
    expect(parseChatFilterCommand('/ignore Bob')).toEqual({ kind: 'ignore', name: 'Bob' });
    expect(parseChatFilterCommand('/unignore Bob')).toEqual({ kind: 'unignore', name: 'Bob' });
    expect(parseChatFilterCommand('/ignorelist')).toEqual({ kind: 'ignoreList' });
  });

  it('parses the BLOCK family (the heavy tier)', () => {
    expect(parseChatFilterCommand('/block Bob')).toEqual({ kind: 'block', name: 'Bob' });
    expect(parseChatFilterCommand('/unblock Bob')).toEqual({ kind: 'unblock', name: 'Bob' });
    expect(parseChatFilterCommand('/blocklist')).toEqual({ kind: 'blockList' });
  });

  // THE separation-of-concepts property. There are THREE distinct things here:
  //   /ignore  a player's own chat-only filter   (this parser)
  //   /block   a player's own heavy social block (this parser)
  //   /mute    the ADMIN account silence         (moderation_commands.ts)
  // A player command must never claim the admin verb, in either direction.
  it('claims NO player-facing /mute: a mute is the ADMIN account silence', () => {
    expect(parseChatFilterCommand('/mute Bob')).toBeNull();
    expect(parseChatFilterCommand('/unmute Bob')).toBeNull();
    expect(parseChatFilterCommand('/mutelist')).toBeNull();
    expect(parseChatFilterCommand('/mute "Bob" 30 spam')).toBeNull();
  });

  it('and the admin parser claims none of the player verbs', () => {
    expect(parseModerationChatCommand('/mute "Bob" 30 spam')).toEqual({
      kind: 'mute',
      name: 'Bob',
      minutes: 30,
      reason: 'spam',
    });
    for (const text of [
      '/ignore Bob',
      '/unignore Bob',
      '/ignorelist',
      '/block Bob',
      '/unblock Bob',
      '/blocklist',
    ]) {
      expect(parseModerationChatCommand(text), text).toBeNull();
    }
  });

  it('is case-insensitive and collapses interior whitespace in the name', () => {
    expect(parseChatFilterCommand('/IGNORE   Bob   Smith ')).toEqual({
      kind: 'ignore',
      name: 'Bob Smith',
    });
    expect(parseChatFilterCommand('/UnBlOcK Bob')).toEqual({ kind: 'unblock', name: 'Bob' });
  });

  it('bounds the name so a 16 KiB "name" never round-trips to Postgres', () => {
    expect(parseChatFilterCommand(`/ignore ${'A'.repeat(500)}`)).toEqual({
      kind: 'ignore',
      name: 'A'.repeat(32),
    });
  });

  it('claims a bare verb with no name so it can answer with usage, not "unknown command"', () => {
    expect(parseChatFilterCommand('/ignore')).toEqual({ kind: 'ignore', name: '' });
    expect(parseChatFilterCommand('/block')).toEqual({ kind: 'block', name: '' });
  });

  it('the list verbs are not swallowed by the add arms', () => {
    // regression guard: a /^\/ignore/ prefix match without a boundary would read
    // "/ignorelist" as ignoring a player called "list"
    expect(parseChatFilterCommand('/ignorelist')).toEqual({ kind: 'ignoreList' });
    expect(parseChatFilterCommand('/blocklist')).toEqual({ kind: 'blockList' });
    expect(parseChatFilterCommand('/unignore Bob')).toEqual({ kind: 'unignore', name: 'Bob' });
    expect(parseChatFilterCommand('/unblock Bob')).toEqual({ kind: 'unblock', name: 'Bob' });
  });

  it('marks exactly the four writes as writes, so only they cost a chat token', () => {
    for (const text of ['/ignore Bob', '/unignore Bob', '/block Bob', '/unblock Bob']) {
      expect(isChatFilterWrite(parseChatFilterCommand(text)!), text).toBe(true);
    }
    for (const text of ['/ignorelist', '/blocklist']) {
      expect(isChatFilterWrite(parseChatFilterCommand(text)!), text).toBe(false);
    }
  });

  it('claims nothing else', () => {
    expect(parseChatFilterCommand('/who')).toBeNull();
    expect(parseChatFilterCommand('/ignoring Bob')).toBeNull();
    expect(parseChatFilterCommand('/blocked Bob')).toBeNull();
    expect(parseChatFilterCommand('hello /ignore Bob')).toBeNull();
    expect(parseChatFilterCommand('ignore Bob')).toBeNull();
  });
});

describe('isIgnorableChannel', () => {
  it('an ignore hides every public channel', () => {
    for (const ch of [
      'say',
      'yell',
      'general',
      'party',
      'guild',
      'officer',
      'world',
      'lfg',
      'emote',
    ]) {
      expect(isIgnorableChannel(ch), ch).toBe(true);
    }
    // an absent channel is ordinary chat
    expect(isIgnorableChannel(undefined)).toBe(true);
  });

  it('an ignore NEVER hides whispers or rolls', () => {
    // These ride the SAME chat event as public chat. If the filter keyed on the
    // event TYPE instead of the channel, an ignore would silently become a block
    // (no whispers), and would hide an ignored player's loot roll mid need/greed.
    expect(isIgnorableChannel('whisper')).toBe(false);
    expect(isIgnorableChannel('roll')).toBe(false);
  });
});
