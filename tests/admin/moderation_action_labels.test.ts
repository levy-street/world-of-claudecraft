import { describe, expect, it } from 'vitest';
import { MODERATION_ACTIONS } from '../../server/moderation_db';
import { t } from '../../src/admin/i18n';
import { en } from '../../src/admin/i18n.en';
import {
  MODERATION_ACTION_LABEL_KEYS,
  moderationActionLabel,
  moderationActionVariant,
} from '../../src/admin/labels';

// The audit trail is only worth writing if an operator can read it. Both history views
// (the account-scoped ModerationHistory component and the realm-wide ModerationHistoryPage)
// render an action they do not recognize as the unlabelled "Other action", so a new server
// action kind that nobody teaches the dashboard about silently disappears into that bucket.
// This pins the shared label table against the server's closed set: adding a kind to
// server/moderation_db.ts MODERATION_ACTIONS without a label here fails the suite.

const UNKNOWN = t('moderationHistory.actionUnknown');

describe('moderation action labels', () => {
  it('labels EVERY action kind the server can write (no silent "Other action")', () => {
    const unlabelled = MODERATION_ACTIONS.filter(
      (action) => moderationActionLabel(action) === UNKNOWN,
    );
    expect(unlabelled, 'server action kinds missing an admin label').toEqual([]);
    // sanity: the list is actually being read, not an empty import
    expect(MODERATION_ACTIONS.length).toBeGreaterThan(15);
  });

  it('resolves every label key against the admin catalog (t() would otherwise throw)', () => {
    for (const [action, key] of Object.entries(MODERATION_ACTION_LABEL_KEYS)) {
      expect(Object.keys(en), `${action} -> ${key}`).toContain(key);
    }
  });

  it('labels the flair actions and keeps them non-punitive', () => {
    expect(moderationActionLabel('set_ai')).toBe(t('moderationHistory.actionSetAi'));
    expect(moderationActionLabel('set_streamer')).toBe(t('moderationHistory.actionSetStreamer'));
    expect(moderationActionVariant('set_ai')).toBe('neutral');
    expect(moderationActionVariant('set_streamer')).toBe('neutral');
  });

  it('labels the ip-block history kinds, which only the realm-wide page surfaces', () => {
    expect(moderationActionLabel('block')).toBe(t('moderationHistory.actionIpBlock'));
    expect(moderationActionLabel('unblock')).toBe(t('moderationHistory.actionIpUnblock'));
  });

  it('keeps the sanction/relief badge variants', () => {
    expect(moderationActionVariant('ban')).toBe('bad');
    expect(moderationActionVariant('daily_rewards_ip_ban')).toBe('bad');
    expect(moderationActionVariant('suspend')).toBe('warn');
    expect(moderationActionVariant('unban')).toBe('success');
    expect(moderationActionVariant('unblock')).toBe('success');
    expect(moderationActionVariant('note')).toBe('neutral');
  });

  it('still falls back to the unknown label for an action it has never heard of', () => {
    expect(moderationActionLabel('teleported_to_the_moon')).toBe(UNKNOWN);
    expect(moderationActionVariant('teleported_to_the_moon')).toBe('neutral');
  });
});
