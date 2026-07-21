import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ignoreKey,
  parseIgnoreList,
  resolvePlayerSocialFlags,
  serializeIgnoreList,
} from '../src/ui/chat_ignore_core';
import type { FriendInfo, SocialInfo } from '../src/world_api';

const friend = (name: string): FriendInfo => ({
  id: 1,
  name,
  cls: 'mage',
  level: 10,
  realm: 'R1',
  activeTitle: null,
  online: true,
});

const social = (over: Partial<SocialInfo> = {}): SocialInfo => ({
  friends: [],
  blocks: [],
  ignores: [],
  guild: null,
  ...over,
});

describe('ignoreKey', () => {
  it('is case- and whitespace-insensitive', () => {
    expect(ignoreKey('  BoB  ')).toBe('bob');
    expect(ignoreKey('bob')).toBe(ignoreKey('BOB'));
  });
});

describe('resolvePlayerSocialFlags online (the server graph is the source of truth)', () => {
  it('reads mute and block from their OWN lists, never from each other', () => {
    const info = social({
      ignores: [{ id: 2, name: 'Chatty' }],
      blocks: [{ id: 3, name: 'Jerk' }],
    });

    const chatty = resolvePlayerSocialFlags('Chatty', info, new Set());
    expect(chatty.ignored).toBe(true);
    expect(chatty.blocked).toBe(false);

    const jerk = resolvePlayerSocialFlags('Jerk', info, new Set());
    expect(jerk.blocked).toBe(true);
    expect(jerk.ignored).toBe(false);
  });

  it('lets a player be muted AND a friend: muting a chatty friend is normal', () => {
    const info = social({ friends: [friend('Chatty')], ignores: [{ id: 1, name: 'Chatty' }] });
    const flags = resolvePlayerSocialFlags('Chatty', info, new Set());
    expect(flags.ignored).toBe(true);
    expect(flags.isFriend).toBe(true);
  });

  it('matches names case-insensitively', () => {
    const info = social({ ignores: [{ id: 2, name: 'Chatty' }] });
    expect(resolvePlayerSocialFlags('cHaTtY', info, new Set()).ignored).toBe(true);
  });

  it('IGNORES the local set online, so a stale local mute cannot resurrect itself', () => {
    // The whole "I unmuted them and still cannot see them" bug in one assertion:
    // online, the account list is authoritative and the local list is not consulted.
    const flags = resolvePlayerSocialFlags('Chatty', social(), new Set(['chatty']));
    expect(flags.ignored).toBe(false);
  });

  it('resolves guild-invite permission from rank', () => {
    const asMember = social({
      guild: { id: 1, name: 'G', rank: 'member', members: [], events: [] },
    });
    expect(resolvePlayerSocialFlags('Bob', asMember, new Set()).canGuildInvite).toBe(false);

    const asOfficer = social({
      guild: { id: 1, name: 'G', rank: 'officer', members: [], events: [] },
    });
    expect(resolvePlayerSocialFlags('Bob', asOfficer, new Set()).canGuildInvite).toBe(true);
  });
});

describe('resolvePlayerSocialFlags offline (no account, no server graph)', () => {
  it('falls back to the local set for mutes and offers nothing else', () => {
    const flags = resolvePlayerSocialFlags('Chatty', null, new Set(['chatty']));
    expect(flags).toEqual({
      ignored: true,
      blocked: false,
      isFriend: false,
      canGuildInvite: false,
      alreadyGuilded: false,
      online: false,
    });
  });

  it('reports an unmuted name as unmuted', () => {
    expect(resolvePlayerSocialFlags('Someone', null, new Set(['chatty'])).ignored).toBe(false);
  });
});

// Two source-level guards. The Hud's DOM path is out of reach in a Node test, but
// both of these are one-line regressions with expensive, silent consequences, so
// pin them by source scrape (the precedent is the BANK_FILTER_KEY pin in
// tests/bank_window.test.ts).
describe('hud.ts ignore wiring (source guards)', () => {
  const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

  it('consults the local ignore list ONLY when offline', () => {
    // Dropping the `socialInfo === null &&` guard resurrects the invisible second
    // mute list: online, a stale local entry would keep hiding someone the player
    // has already unmuted on their account, and nothing would explain why.
    expect(hud).toContain(
      'if (this.sim.socialInfo === null && this.localIgnoredNames.has(ignoreKey(ev.from)))',
    );
  });

  it('keeps the HISTORICAL localStorage key, so existing offline lists survive', () => {
    // Renaming this silently wipes every offline player's mute list.
    expect(hud).toContain("const LOCAL_IGNORES_KEY = 'woc_ignored_chat_names';");
  });
});

describe('local ignore-list storage helpers', () => {
  it('round-trips through the serialized form', () => {
    const set = new Set(['bob', 'chatty']);
    expect(parseIgnoreList(serializeIgnoreList(set))).toEqual(set);
  });

  it('normalizes names on parse, so a legacy mixed-case entry still matches', () => {
    expect(parseIgnoreList('["BoB", " Chatty "]')).toEqual(new Set(['bob', 'chatty']));
  });

  it('survives absent, malformed, and wrong-shaped storage', () => {
    expect(parseIgnoreList(null)).toEqual(new Set());
    expect(parseIgnoreList('not json')).toEqual(new Set());
    expect(parseIgnoreList('{"nope":1}')).toEqual(new Set());
    expect(parseIgnoreList('[1, null, "bob"]')).toEqual(new Set(['bob']));
  });
});
