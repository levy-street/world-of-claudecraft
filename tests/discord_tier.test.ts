import { describe, expect, it } from 'vitest';
import {
  canClaimSwag,
  DISCORD_REWARD_GRANTS,
  DISCORD_STATUS_DEFS,
  DISCORD_SWAG,
  discordStatusByIndex,
  discordStatusForPoints,
  discordStatusIndexForPoints,
  pointsToNextStatus,
  swagById,
} from '../src/sim/discord_tier';

describe('discord status ladder', () => {
  it('maps lifetime points to the right rung', () => {
    expect(discordStatusIndexForPoints(0)).toBe(1); // initiate from 0
    expect(discordStatusIndexForPoints(99)).toBe(1);
    expect(discordStatusIndexForPoints(100)).toBe(2); // squire
    expect(discordStatusIndexForPoints(4_999)).toBe(4); // knight (2000..4999)
    expect(discordStatusIndexForPoints(5_000)).toBe(5); // champion
    expect(discordStatusIndexForPoints(150_000)).toBe(8); // mythic
    expect(discordStatusIndexForPoints(9_999_999)).toBe(8); // capped at top rung
  });

  it('treats negative or non-finite points as the first rung', () => {
    expect(discordStatusForPoints(-50).key).toBe('initiate');
    expect(discordStatusForPoints(Number.NaN).key).toBe('initiate');
  });

  it('looks up a rung by 1-based index and rejects out of range', () => {
    expect(discordStatusByIndex(1)?.key).toBe('initiate');
    expect(discordStatusByIndex(8)?.key).toBe('mythic');
    expect(discordStatusByIndex(0)).toBeUndefined();
    expect(discordStatusByIndex(9)).toBeUndefined();
    expect(discordStatusByIndex(2.5)).toBeUndefined();
  });

  it('reports points to the next rung, null at the top', () => {
    expect(pointsToNextStatus(0)).toBe(100); // initiate -> squire
    expect(pointsToNextStatus(50)).toBe(50);
    expect(pointsToNextStatus(150_000)).toBeNull(); // already mythic
  });

  it('keeps thresholds monotonically increasing', () => {
    for (let i = 1; i < DISCORD_STATUS_DEFS.length; i++) {
      expect(DISCORD_STATUS_DEFS[i].threshold).toBeGreaterThan(
        DISCORD_STATUS_DEFS[i - 1].threshold,
      );
    }
  });
});

describe('reward grant table', () => {
  it('has positive point values and stable reasons', () => {
    for (const grant of Object.values(DISCORD_REWARD_GRANTS)) {
      expect(grant.points).toBeGreaterThan(0);
      expect(grant.reason).toMatch(/^[a-z_]+$/);
    }
  });
});

describe('swag catalog + claim rules', () => {
  it('finds swag by id', () => {
    expect(swagById('title_discordian')?.kind).toBe('title');
    expect(swagById('nope')).toBeUndefined();
  });

  it('allows a claim only when tier, points, and not-already-claimed all hold', () => {
    const swag = DISCORD_SWAG.find((s) => s.id === 'chroma_blurple')!; // cost 1000, minTier 3
    expect(canClaimSwag({ swag, spendablePoints: 1_000, statusTier: 3, claimedIds: [] })).toEqual({
      ok: true,
      reason: 'ok',
    });
    expect(
      canClaimSwag({ swag, spendablePoints: 1_000, statusTier: 2, claimedIds: [] }).reason,
    ).toBe('tier');
    expect(canClaimSwag({ swag, spendablePoints: 999, statusTier: 3, claimedIds: [] }).reason).toBe(
      'points',
    );
    expect(
      canClaimSwag({ swag, spendablePoints: 9_999, statusTier: 9, claimedIds: ['chroma_blurple'] })
        .reason,
    ).toBe('claimed');
  });

  it('lets a free tier-1 title be claimed immediately after linking', () => {
    const swag = swagById('title_discordian')!;
    expect(canClaimSwag({ swag, spendablePoints: 0, statusTier: 1, claimedIds: [] }).ok).toBe(true);
  });
});
