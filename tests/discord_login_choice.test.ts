// @vitest-environment happy-dom
//
// The first-time Discord login-chooser persistence (src/game/discord_login_choice.ts,
// moved out of src/main.ts by the R11 review-round ratchet payment): the OAuth
// bounce page parks a single-use link token here; a stale, expired, or garbled
// entry must clear itself so it never traps a visitor on the chooser.
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearDiscordChoice,
  DISCORD_CHOICE_KEY,
  readDiscordChoice,
} from '../src/game/discord_login_choice';

afterEach(() => {
  localStorage.clear();
});

describe('readDiscordChoice', () => {
  it('returns a fresh parked choice', () => {
    localStorage.setItem(
      DISCORD_CHOICE_KEY,
      JSON.stringify({ linkToken: 'tok1', username: 'Trev', ts: Date.now() }),
    );
    expect(readDiscordChoice()).toEqual({
      provider: 'discord',
      linkToken: 'tok1',
      username: 'Trev',
    });
  });

  it('a non-string username degrades to empty, never a crash', () => {
    localStorage.setItem(
      DISCORD_CHOICE_KEY,
      JSON.stringify({ linkToken: 'tok1', username: 7, ts: Date.now() }),
    );
    expect(readDiscordChoice()?.username).toBe('');
  });

  it('an EXPIRED entry is cleared and yields null', () => {
    localStorage.setItem(
      DISCORD_CHOICE_KEY,
      JSON.stringify({ linkToken: 'tok1', username: 'Trev', ts: Date.now() - 16 * 60 * 1000 }),
    );
    expect(readDiscordChoice()).toBeNull();
    expect(localStorage.getItem(DISCORD_CHOICE_KEY)).toBeNull();
  });

  it('a GARBLED entry is cleared and yields null', () => {
    localStorage.setItem(DISCORD_CHOICE_KEY, '{not json');
    expect(readDiscordChoice()).toBeNull();
    expect(localStorage.getItem(DISCORD_CHOICE_KEY)).toBeNull();
  });

  it('an absent entry yields null without touching storage', () => {
    expect(readDiscordChoice()).toBeNull();
  });
});

describe('clearDiscordChoice', () => {
  it('removes the parked entry', () => {
    localStorage.setItem(DISCORD_CHOICE_KEY, 'x');
    clearDiscordChoice();
    expect(localStorage.getItem(DISCORD_CHOICE_KEY)).toBeNull();
  });
});
