import { describe, expect, it } from 'vitest';
import {
  isRelayInput,
  matchRelayCommands,
  parseRelayCommand,
  RELAY_COMMANDS,
  RELAY_MAX_MESSAGE,
  relayCommandById,
} from '../src/sim/discord_relay';

describe('relay command catalog', () => {
  it('has unique ids, tags and a sane color', () => {
    const ids = RELAY_COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of RELAY_COMMANDS) {
      expect(c.id).toMatch(/^[a-z]+$/);
      expect(c.tag.length).toBeGreaterThan(0);
      expect(c.color).toBeGreaterThanOrEqual(0);
    }
  });

  it('looks up by id case-insensitively', () => {
    expect(relayCommandById('lfg')?.tag).toBe('LFG');
    expect(relayCommandById('LFG')?.tag).toBe('LFG');
    expect(relayCommandById('nope')).toBeUndefined();
  });
});

describe('parseRelayCommand', () => {
  it('parses a "!cmd message" line', () => {
    const r = parseRelayCommand('!lfg need a healer for crypt');
    expect(r?.command.id).toBe('lfg');
    expect(r?.message).toBe('need a healer for crypt');
  });

  it('allows a bare command with no message', () => {
    expect(parseRelayCommand('!wts')?.message).toBe('');
  });

  it('returns null for non-"!" text and unknown commands', () => {
    expect(parseRelayCommand('hello world')).toBeNull();
    expect(parseRelayCommand('!frobnicate stuff')).toBeNull();
    expect(parseRelayCommand('/lfg x')).toBeNull();
  });

  it('caps the message length', () => {
    const long = `!help ${'a'.repeat(RELAY_MAX_MESSAGE + 50)}`;
    expect(parseRelayCommand(long)?.message.length).toBe(RELAY_MAX_MESSAGE);
  });

  it('tolerates leading whitespace and is case-insensitive on the command', () => {
    expect(parseRelayCommand('  !LFG hi')?.command.id).toBe('lfg');
  });
});

describe('dropdown helpers', () => {
  it('matches commands by prefix after "!"', () => {
    expect(matchRelayCommands('').length).toBe(RELAY_COMMANDS.length);
    expect(matchRelayCommands('w').map((c) => c.id)).toEqual(['wts', 'wtb']);
    expect(matchRelayCommands('lfg').map((c) => c.id)).toEqual(['lfg']);
    expect(matchRelayCommands('zz')).toEqual([]);
  });

  it('detects when the dropdown should show', () => {
    expect(isRelayInput('!')).toBe(true);
    expect(isRelayInput('!lf')).toBe(true);
    expect(isRelayInput('!lfg need help')).toBe(true);
    expect(isRelayInput('hello')).toBe(false);
    expect(isRelayInput('/who')).toBe(false);
  });
});
