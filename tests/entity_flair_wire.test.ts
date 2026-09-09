// Paired suite for src/net/entity_flair_wire.ts: the full identity record's
// cosmetic flair decode, extracted whole out of online.ts's applyWire so the
// per-field defaulting is unit-testable without a socket.
import { describe, expect, it } from 'vitest';

import { decodeEntityFlairWire } from '../src/net/entity_flair_wire';

describe('decodeEntityFlairWire', () => {
  it('resets every field to its no-flair default on a bare record', () => {
    expect(decodeEntityFlairWire({})).toEqual({
      holderTier: 0,
      holderBalance: undefined,
      discordTier: 0,
      discordAvatar: undefined,
      discordName: undefined,
      discordJoined: undefined,
      discordRole: undefined,
      devTier: 0,
      devMergedPrs: undefined,
      githubLogin: undefined,
      curatorRank: 0,
      relicsOwned: undefined,
      relicsTotal: undefined,
      aiAccount: false,
      streamerLinks: undefined,
      cheaterMark: false,
    });
  });

  it('decodes a fully-populated identity record', () => {
    const result = decodeEntityFlairWire({
      ht: 7,
      hb: 12_500,
      dt: 3,
      dav: 'https://cdn.discordapp.com/avatar.png',
      dnm: 'Someplayer',
      dj: 1_700_000_000_000,
      dr: 'moderator',
      dvt: 2,
      dvc: 14,
      dgl: 'octocat',
      crk: 4,
      cro: 6,
      crt: 30,
      ai: 1,
      slk: { twitch: 'https://twitch.tv/someplayer' },
      chm: 1,
    });
    expect(result).toEqual({
      holderTier: 7,
      holderBalance: 12_500,
      discordTier: 3,
      discordAvatar: 'https://cdn.discordapp.com/avatar.png',
      discordName: 'Someplayer',
      discordJoined: 1_700_000_000_000,
      discordRole: 'moderator',
      devTier: 2,
      devMergedPrs: 14,
      githubLogin: 'octocat',
      curatorRank: 4,
      relicsOwned: 6,
      relicsTotal: 30,
      aiAccount: true,
      streamerLinks: { twitch: 'https://twitch.tv/someplayer' },
      cheaterMark: true,
    });
  });

  it('drops a malformed streamer link but keeps the account AI-operated', () => {
    const result = decodeEntityFlairWire({
      ai: 1,
      slk: { twitch: 'javascript:alert(1)' },
    });
    expect(result.aiAccount).toBe(true);
    expect(result.streamerLinks).toBeUndefined();
  });

  it('floors and caps curator/relic counts, and reads a zero or negative count as absent', () => {
    expect(decodeEntityFlairWire({ crk: 3.9, cro: 0, crt: -5 })).toMatchObject({
      curatorRank: 3,
      relicsOwned: undefined,
      relicsTotal: undefined,
    });
    expect(decodeEntityFlairWire({ crk: 1e12 }).curatorRank).toBe(1e9);
  });

  it('ignores wrong-typed string fields rather than throwing', () => {
    const result = decodeEntityFlairWire({
      hb: 'not-a-number',
      dav: 42,
      dj: 'yesterday',
    });
    expect(result.holderBalance).toBeUndefined();
    expect(result.discordAvatar).toBeUndefined();
    expect(result.discordJoined).toBeUndefined();
  });
});
