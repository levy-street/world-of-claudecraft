// maybeSendGuildTrendLetter eligibility clauses. Split from
// tests/professions_trend.test.ts along describe boundaries for CI shard
// balance (a pure move; shared helpers in professions_trend_util.ts).

import { describe, expect, it } from 'vitest';
import { maybeSendGuildTrendLetter } from '../src/sim/professions/guild_letter';
import { spyCtx, unitMeta } from './professions_trend_util';

describe('maybeSendGuildTrendLetter eligibility clauses', () => {
  it('books for a fully eligible character, one-shot flag flipped BEFORE the send', () => {
    const meta = unitMeta({});
    const { ctx, booked } = spyCtx();
    expect(maybeSendGuildTrendLetter(meta, ctx)).toBe(true);
    expect(booked).toHaveLength(1);
    expect(booked[0].letter.letterId).toBe('guild_trend_engineering_alchemy');
    // The re-entrant-save contract: the callback must already observe the flag.
    expect(booked[0].flagAtCall).toBe(true);
    expect(meta.guildLetterSent).toBe(true);
  });

  it('guildLetterSent alone disqualifies', () => {
    const meta = unitMeta({ guildLetterSent: true });
    const { ctx, booked } = spyCtx();
    expect(maybeSendGuildTrendLetter(meta, ctx)).toBe(false);
    expect(booked).toHaveLength(0);
  });

  it('a non-null activeArchetype alone disqualifies, attunedPairs empty', () => {
    const meta = unitMeta({ activeArchetype: 'engineering' });
    const { ctx, booked } = spyCtx();
    expect(maybeSendGuildTrendLetter(meta, ctx)).toBe(false);
    expect(booked).toHaveLength(0);
    expect(meta.guildLetterSent).toBe(false);
  });

  it('non-empty attunedPairs alone disqualifies, activeArchetype null', () => {
    const meta = unitMeta({ attunedPairs: ['engineering+alchemy'] });
    const { ctx, booked } = spyCtx();
    expect(maybeSendGuildTrendLetter(meta, ctx)).toBe(false);
    expect(booked).toHaveLength(0);
    expect(meta.guildLetterSent).toBe(false);
  });

  it('an uncrossed trend books nothing and never burns the one-shot flag', () => {
    const meta = unitMeta({ craftSkills: { engineering: 12, alchemy: 12 } });
    const { ctx, booked } = spyCtx();
    expect(maybeSendGuildTrendLetter(meta, ctx)).toBe(false);
    expect(booked).toHaveLength(0);
    expect(meta.guildLetterSent).toBe(false);
  });
});
