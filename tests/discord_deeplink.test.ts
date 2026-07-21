import { describe, expect, it } from 'vitest';
import {
  buildLfgWhisper,
  LFG_INTENT_TTL_MS,
  lfgIntentTarget,
  parseLfgCommand,
  parseLfgTarget,
} from '../src/ui/discord_deeplink';

describe('discord relay deep link', () => {
  it('parses a valid character-name target from the query string', () => {
    expect(parseLfgTarget('?lfg=Aldric')).toBe('Aldric');
    expect(parseLfgTarget('?foo=1&lfg=Mira2')).toBe('Mira2');
  });

  it('rejects missing or malformed targets', () => {
    expect(parseLfgTarget('')).toBeNull();
    expect(parseLfgTarget('?lfg=')).toBeNull();
    expect(parseLfgTarget('?lfg=1bad')).toBeNull(); // must start with a letter
    expect(parseLfgTarget('?lfg=has%20space')).toBeNull();
    expect(parseLfgTarget('?lfg=a')).toBeNull(); // too short (min 2)
    expect(parseLfgTarget(`?lfg=${'a'.repeat(40)}`)).toBeNull(); // too long
  });

  it('parses the relay command id, or null when unknown', () => {
    expect(parseLfgCommand('?lfg=Aldric&c=lfg')).toBe('lfg');
    expect(parseLfgCommand('?lfg=Aldric&c=WTS')).toBe('wts');
    expect(parseLfgCommand('?lfg=Aldric&c=bogus')).toBeNull();
    expect(parseLfgCommand('?lfg=Aldric')).toBeNull();
  });

  it('builds a per-command whisper line for the target', () => {
    expect(buildLfgWhisper('Aldric', 'lfg')).toContain('/w Aldric ');
    expect(buildLfgWhisper('Aldric', 'lfg')).toContain('join your group');
    expect(buildLfgWhisper('Aldric', 'recruit')).toContain('guild');
    expect(buildLfgWhisper('Aldric', 'wts')).toContain('trade');
    // Unknown / missing command falls back to the group opener.
    expect(buildLfgWhisper('Aldric', null)).toContain('join your group');
  });

  it('returns a fresh intent target, and null once stale or empty', () => {
    const now = 1_000_000;
    expect(lfgIntentTarget({ target: 'Aldric', ts: now }, now)).toBe('Aldric');
    expect(lfgIntentTarget({ target: 'Aldric', ts: now - 1000 }, now)).toBe('Aldric');
    expect(lfgIntentTarget({ target: 'Aldric', ts: now - LFG_INTENT_TTL_MS - 1 }, now)).toBeNull();
    expect(lfgIntentTarget({ target: '', ts: now }, now)).toBeNull();
    expect(lfgIntentTarget(null, now)).toBeNull();
  });
});
