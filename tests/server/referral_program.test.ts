import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canAcceptRedemption,
  completionCountsForRewards,
  DEFAULT_BOND_END_LEVEL,
  DEFAULT_BOND_XP_MULTIPLIER,
  DEFAULT_MAX_ACTIVE_REFERRALS,
  DEFAULT_REFERRAL_MILESTONE_LEVELS,
  DEFAULT_REFERRAL_SEASON_DAYS,
  DEFAULT_REFERRAL_TIER_THRESHOLDS,
  DEFAULT_REFERRER_MIN_ACCOUNT_AGE_DAYS,
  DEFAULT_REFERRER_MIN_LEVEL,
  DEFAULT_SEASON_REFERRAL_CAP,
  DEFAULT_SUMMON_FRIEND_COOLDOWN_SECONDS,
  generateReferralCode,
  isValidReferralCodeShape,
  ladderTierForCount,
  loadReferralProgramConfig,
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  referrerEligibility,
} from '../../server/referral_program';

describe('referral program config', () => {
  it('applies the PRD defaults when env is unset', () => {
    const cfg = loadReferralProgramConfig({});
    expect(cfg.minAccountAgeDays).toBe(7);
    expect(cfg.minLevel).toBe(20);
    expect(cfg.maxActiveReferrals).toBe(10);
    expect(cfg.seasonReferralCap).toBe(5);
    expect(cfg.seasonDays).toBe(90);
    expect(cfg.bondXpMultiplier).toBe(2);
    expect(cfg.bondEndLevel).toBe(20);
    expect(cfg.milestoneLevels).toEqual([10, 20]);
    expect(cfg.tierThresholds).toEqual([1, 3, 5]);
    expect(cfg.summonCooldownSeconds).toBe(1800);
    // The exported literals pin the same values (a revert to a different
    // hardcoded default fails here, not just silently changes behavior).
    expect(DEFAULT_REFERRER_MIN_ACCOUNT_AGE_DAYS).toBe(7);
    expect(DEFAULT_REFERRER_MIN_LEVEL).toBe(20);
    expect(DEFAULT_MAX_ACTIVE_REFERRALS).toBe(10);
    expect(DEFAULT_SEASON_REFERRAL_CAP).toBe(5);
    expect(DEFAULT_REFERRAL_SEASON_DAYS).toBe(90);
    expect(DEFAULT_BOND_XP_MULTIPLIER).toBe(2);
    expect(DEFAULT_BOND_END_LEVEL).toBe(20);
    expect(DEFAULT_REFERRAL_MILESTONE_LEVELS).toEqual([10, 20]);
    expect(DEFAULT_REFERRAL_TIER_THRESHOLDS).toEqual([1, 3, 5]);
    expect(DEFAULT_SUMMON_FRIEND_COOLDOWN_SECONDS).toBe(1800);
  });

  it('honors explicit values, including an explicit 0 disabling a gate', () => {
    const cfg = loadReferralProgramConfig({
      REFERRER_MIN_ACCOUNT_AGE_DAYS: '0',
      REFERRER_MIN_LEVEL: '10',
      MAX_ACTIVE_REFERRALS: '3',
      SEASON_REFERRAL_CAP: '2',
      BOND_XP_MULTIPLIER: '1.5',
      BOND_END_LEVEL: '30',
      REFERRAL_MILESTONE_LEVELS: '5,15,30',
      REFERRAL_TIER_THRESHOLDS: '2,4',
      SUMMON_FRIEND_COOLDOWN_SECONDS: '600',
    });
    expect(cfg.minAccountAgeDays).toBe(0);
    expect(cfg.minLevel).toBe(10);
    expect(cfg.maxActiveReferrals).toBe(3);
    expect(cfg.seasonReferralCap).toBe(2);
    expect(cfg.bondXpMultiplier).toBe(1.5);
    expect(cfg.bondEndLevel).toBe(30);
    expect(cfg.milestoneLevels).toEqual([5, 15, 30]);
    expect(cfg.tierThresholds).toEqual([2, 4]);
    expect(cfg.summonCooldownSeconds).toBe(600);
  });

  it('treats whitespace and garbage as unset (trimmed, fail-safe polarity)', () => {
    const cfg = loadReferralProgramConfig({
      REFERRER_MIN_ACCOUNT_AGE_DAYS: '   ',
      REFERRER_MIN_LEVEL: 'abc',
      REFERRAL_MILESTONE_LEVELS: '10,abc',
      REFERRAL_TIER_THRESHOLDS: '3,1',
    });
    expect(cfg.minAccountAgeDays).toBe(7);
    expect(cfg.minLevel).toBe(20);
    // A garbage entry or a non-ascending ladder rejects the whole list.
    expect(cfg.milestoneLevels).toEqual([10, 20]);
    expect(cfg.tierThresholds).toEqual([1, 3, 5]);
  });

  it('is wired to process.env through referralProgramConfig (tunability pin)', () => {
    // The env-wiring pin (tests/server/tunables.test.ts idiom): a revert to a
    // hardcoded config object would leave the parser unit tests green; only
    // this source scrape fails it. Comments are stripped so a commented-out
    // line cannot keep the pin falsely green.
    const src = fs
      .readFileSync(path.join(process.cwd(), 'server', 'referral_program.ts'), 'utf8')
      .replace(/(?<!:)\/\/.*$/gm, '');
    expect(src).toContain('loadReferralProgramConfig(process.env)');
    expect(src).toContain('env.REFERRER_MIN_ACCOUNT_AGE_DAYS');
    expect(src).toContain('env.REFERRER_MIN_LEVEL');
    expect(src).toContain('env.MAX_ACTIVE_REFERRALS');
    expect(src).toContain('env.SEASON_REFERRAL_CAP');
    expect(src).toContain('env.REFERRAL_SEASON_DAYS');
    expect(src).toContain('env.BOND_XP_MULTIPLIER');
    expect(src).toContain('env.BOND_END_LEVEL');
    expect(src).toContain('env.REFERRAL_MILESTONE_LEVELS');
    expect(src).toContain('env.REFERRAL_TIER_THRESHOLDS');
    expect(src).toContain('env.SUMMON_FRIEND_COOLDOWN_SECONDS');
  });

  it('documents every key in .env.example', () => {
    const example = fs.readFileSync(path.join(process.cwd(), '.env.example'), 'utf8');
    for (const key of [
      'REFERRER_MIN_ACCOUNT_AGE_DAYS',
      'REFERRER_MIN_LEVEL',
      'MAX_ACTIVE_REFERRALS',
      'SEASON_REFERRAL_CAP',
      'REFERRAL_SEASON_DAYS',
      'BOND_XP_MULTIPLIER',
      'BOND_END_LEVEL',
      'REFERRAL_MILESTONE_LEVELS',
      'REFERRAL_TIER_THRESHOLDS',
      'SUMMON_FRIEND_COOLDOWN_SECONDS',
    ]) {
      expect(example).toContain(key);
    }
  });
});

describe('referral codes', () => {
  it('generates codes of the pinned shape from the injected rng', () => {
    let calls = 0;
    const rng = () => {
      calls++;
      return 0.5;
    };
    const code = generateReferralCode(rng);
    expect(code).toHaveLength(REFERRAL_CODE_LENGTH);
    expect(calls).toBe(REFERRAL_CODE_LENGTH);
    expect(isValidReferralCodeShape(code)).toBe(true);
  });

  it('rejects wrong length, confusable characters, and card-slug shapes', () => {
    expect(isValidReferralCodeShape('abcd234')).toBe(false);
    expect(isValidReferralCodeShape('abcd23456')).toBe(false);
    // 0/o/1/l/i are excluded from the alphabet on purpose.
    expect(REFERRAL_CODE_ALPHABET).not.toContain('0');
    expect(REFERRAL_CODE_ALPHABET).not.toContain('o');
    expect(REFERRAL_CODE_ALPHABET).not.toContain('1');
    expect(REFERRAL_CODE_ALPHABET).not.toContain('l');
    expect(REFERRAL_CODE_ALPHABET).not.toContain('i');
    expect(isValidReferralCodeShape('abcd234o')).toBe(false);
    expect(isValidReferralCodeShape('my-card1')).toBe(false);
  });
});

describe('referrer eligibility and caps', () => {
  const cfg = loadReferralProgramConfig({});

  it('gates on account age and character level with reasons', () => {
    expect(referrerEligibility({ accountAgeDays: 30, maxCharacterLevel: 20 }, cfg)).toEqual({
      eligible: true,
      reasons: [],
    });
    expect(referrerEligibility({ accountAgeDays: 3, maxCharacterLevel: 20 }, cfg)).toEqual({
      eligible: false,
      reasons: ['account_too_new'],
    });
    expect(referrerEligibility({ accountAgeDays: 30, maxCharacterLevel: 19 }, cfg)).toEqual({
      eligible: false,
      reasons: ['level_too_low'],
    });
  });

  it('a 0 gate disables that gate', () => {
    const open = loadReferralProgramConfig({
      REFERRER_MIN_ACCOUNT_AGE_DAYS: '0',
      REFERRER_MIN_LEVEL: '0',
    });
    expect(referrerEligibility({ accountAgeDays: 0, maxCharacterLevel: 1 }, open).eligible).toBe(
      true,
    );
  });

  it('caps concurrent active referrals and season reward counting', () => {
    expect(canAcceptRedemption(9, cfg)).toBe(true);
    expect(canAcceptRedemption(10, cfg)).toBe(false);
    expect(completionCountsForRewards(4, cfg)).toBe(true);
    expect(completionCountsForRewards(5, cfg)).toBe(false);
    const uncapped = loadReferralProgramConfig({
      MAX_ACTIVE_REFERRALS: '0',
      SEASON_REFERRAL_CAP: '0',
    });
    expect(canAcceptRedemption(1000, uncapped)).toBe(true);
    expect(completionCountsForRewards(1000, uncapped)).toBe(true);
  });

  it('maps completed counts onto ladder tiers', () => {
    expect(ladderTierForCount(0, cfg)).toBe(0);
    expect(ladderTierForCount(1, cfg)).toBe(1);
    expect(ladderTierForCount(2, cfg)).toBe(1);
    expect(ladderTierForCount(3, cfg)).toBe(2);
    expect(ladderTierForCount(4, cfg)).toBe(2);
    expect(ladderTierForCount(5, cfg)).toBe(3);
    expect(ladderTierForCount(50, cfg)).toBe(3);
  });
});
